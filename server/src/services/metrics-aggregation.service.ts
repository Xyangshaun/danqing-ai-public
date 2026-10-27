// ============================================================
// AI 指标聚合 Service(M3 可观测性;对应 m3-observability-plan §2.2 方案 C)
//
// 职责:
//   1. getAiMetrics(query):GET /api/admin/metrics/ai 数据源
//      严格按冻结契约 AiMetricsResponse 返回(api-contract.ts §3.18)
//   2. getSlaMetrics(query):GET /api/admin/metrics/sla 数据源
//      严格按冻结契约 SlaMetricsResponse 返回
//   3. evaluateAndAlert():告警触发入口(供调度器每分钟调用),构造
//      近 1 分钟 OperationalMetricsInternal 快照 → alert.service.evaluateMetrics
//
// 缓存策略(方案 C:定时聚合 + Redis 缓存,复用 adminAiUsageService 模式):
//   - key:metrics:ai:{start}:{end}:{tenantId|all}   TTL=METRICS_CACHE_TTL_SECONDS
//   - key:metrics:sla:{days}:{tenantId|all}         TTL=METRICS_CACHE_TTL_SECONDS
//   - 缓存命中直接返回;未命中走 DB 聚合(走 (tenant_id,created_at) 索引 <100ms)
//   - Redis 读/写失败不阻断(缓存层非真源,记 warning 日志)
//
// 错误处理策略(对齐计划 §3.5):
//   - DB 聚合失败 + Redis 未命中 → 抛 METRICS_DATA_UNAVAILABLE(9201)
//   - Redis 读失败但 DB 成功 → 正常返回(记 warning)
//   - 多租户隔离:tenantId 由 controller 注入(非平台 owner 强制本人租户)
//
// 契约铁律:api-contract.ts 已冻结,本服务不新增任何契约类型;
//          OperationalMetricsInternal 仅服务端内部使用(不入契约)。
// ============================================================

import { aiUsageRepository } from '../repositories/ai-usage.repository.js';
import type { MetricsWhereOpts, UsageTypeFilter } from '../repositories/ai-usage.repository.js';
import { redis } from '../config/redis.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { BusinessError } from '../middlewares/error-handler.js';
import { ErrorCode } from '../types/api-contract.js';
import type {
  AiMetricsResponse,
  SlaMetricsQuery,
  SlaMetricsResponse,
  ISODateString,
} from '../types/api-contract.js';

const CACHE_KEY_PREFIX = 'metrics';
const DEFAULT_WINDOW_DAYS = 7;

/**
 * 服务端内部聚合中间结构(不入 api-contract.ts,仅本服务 + alert.service 使用)
 * 对应计划 §3.4 OperationalMetricsInternal
 */
export interface OperationalMetricsInternal {
  slaComplianceRate: number;
  aiFallbackRate: number;
  fallbackDetails: { jimpOnly: number; templateSuggestion: number; providerSwitch: number };
  providerAvailability: {
    glm: { successRate: number; switchCount: number };
    trae: { successRate: number; switchCount: number };
  };
  analysis: { total: number; successRate: number; avgDurationMs: number };
  costYuanToday: number;
  windowStart: ISODateString;
  windowEnd: ISODateString;
}

export interface AiMetricsQuery {
  /** 起始日期(YYYY-MM-DD,可选;默认近 7 天) */
  startDate?: string;
  /** 结束日期(YYYY-MM-DD,可选;默认当前时间) */
  endDate?: string;
  /** 多租户隔离(controller 注入;undefined=全局,仅平台 owner) */
  tenantId?: string;
  /** 用量类型过滤(可选) */
  usageType?: UsageTypeFilter;
}

/** 解析 YYYY-MM-DD 为 Date(0 点);非法返回 undefined */
function parseDayStart(value?: string): Date | undefined {
  if (!value) return undefined;
  const d = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return undefined;
  return d;
}

class MetricsAggregationServiceClass {
  // ============================================================
  // 缓存读写(fail-safe:失败仅记日志,不阻断)
  // ============================================================
  private async getCached<T>(key: string): Promise<T | null> {
    try {
      const raw = await redis().get(key);
      if (!raw) return null;
      return JSON.parse(raw) as T;
    } catch (err) {
      logger.warn({ err: (err as Error).message, key }, '[metrics] cache read failed');
      return null;
    }
  }

  private async setCached<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    try {
      await redis().set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch (err) {
      logger.warn({ err: (err as Error).message, key }, '[metrics] cache write failed');
    }
  }

  // ============================================================
  // 1. GET /api/admin/metrics/ai → AiMetricsResponse
  // ============================================================
  async getAiMetrics(query: AiMetricsQuery): Promise<AiMetricsResponse> {
    const now = new Date();
    const endDate = parseDayStart(query.endDate) ?? now;
    const startDate = parseDayStart(query.startDate);
    const effectiveStart = startDate ?? new Date(now.getTime() - DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const cacheKey = `${CACHE_KEY_PREFIX}:ai:${query.startDate ?? 'default'}:${query.endDate ?? 'now'}:${query.tenantId ?? 'all'}`;
    const cached = await this.getCached<AiMetricsResponse>(cacheKey);
    if (cached) return cached;

    const opts: MetricsWhereOpts = { tenantId: query.tenantId, usageType: query.usageType };

    let data: AiMetricsResponse;
    try {
      const [sla, fallback, provider, analysis, cost] = await Promise.all([
        aiUsageRepository.slaCompliance(effectiveStart, endDate, opts),
        aiUsageRepository.fallbackRate(effectiveStart, endDate, opts),
        aiUsageRepository.providerAvailability(effectiveStart, endDate, opts),
        aiUsageRepository.overview(effectiveStart, endDate, opts),
        aiUsageRepository.dailyCost(effectiveStart, endDate, opts),
      ]);

      data = {
        startDate: effectiveStart.toISOString(),
        endDate: endDate.toISOString(),
        slaComplianceRate: Number(sla.complianceRate.toFixed(4)),
        aiFallbackRate: Number(fallback.fallbackRate.toFixed(4)),
        providerAvailability: {
          glm: {
            successRate: Number(provider.glm.successRate.toFixed(4)),
            switchCount: provider.glm.switchCount,
          },
          trae: {
            successRate: Number(provider.trae.successRate.toFixed(4)),
            switchCount: provider.trae.switchCount,
          },
        },
        analysis: {
          total: analysis.totalCount,
          successRate: Number(analysis.successRate.toFixed(4)),
          avgDurationMs: Math.round(analysis.avgDurationMs),
        },
        costByDay: cost,
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      // DB 聚合失败 + 缓存未命中 → 抛 METRICS_DATA_UNAVAILABLE(9201,503),不返回部分数据
      logger.error({ err: (err as Error).message }, '[metrics] ai aggregation failed');
      throw new BusinessError(
        ErrorCode.METRICS_DATA_UNAVAILABLE,
        '指标数据暂不可用,请稍后再试',
        503,
      );
    }

    await this.setCached(cacheKey, data, env().metricsCacheTtlSeconds);
    return data;
  }

  // ============================================================
  // 2. GET /api/admin/metrics/sla → SlaMetricsResponse
  // ============================================================
  async getSlaMetrics(query: SlaMetricsQuery, tenantId?: string): Promise<SlaMetricsResponse> {
    const days = Math.min(Math.max(query.days ?? 7, 1), 90); // 1-90,默认 7
    const cacheKey = `${CACHE_KEY_PREFIX}:sla:${days}:${tenantId ?? 'all'}`;
    const cached = await this.getCached<SlaMetricsResponse>(cacheKey);
    if (cached) return cached;

    const opts: MetricsWhereOpts = { tenantId };
    let data: SlaMetricsResponse;
    try {
      const daily = await aiUsageRepository.slaComplianceByDay(days, opts);

      // 平均 SLA 达标率:按当日总量加权(更准确,避免小样本日拉低均值)
      const totalSum = daily.reduce((sum, d) => sum + d.total, 0);
      const compliantSum = daily.reduce((sum, d) => sum + d.complianceRate * d.total, 0);
      const avgComplianceRate = totalSum > 0 ? compliantSum / totalSum : 0;

      data = {
        days,
        dailySla: daily.map((d) => ({
          date: d.date,
          complianceRate: Number(d.complianceRate.toFixed(4)),
          total: d.total,
        })),
        avgComplianceRate: Number(avgComplianceRate.toFixed(4)),
      };
    } catch (err) {
      logger.error({ err: (err as Error).message }, '[metrics] sla aggregation failed');
      throw new BusinessError(
        ErrorCode.METRICS_DATA_UNAVAILABLE,
        '指标数据暂不可用,请稍后再试',
        503,
      );
    }

    await this.setCached(cacheKey, data, env().metricsCacheTtlSeconds);
    return data;
  }

  // ============================================================
  // 3. 告警触发入口(M3-T8;供调度器每分钟调用)
  //    构造近 1 分钟 OperationalMetricsInternal 快照 → alert.service.evaluateMetrics
  //    fail-safe:任何异常被 catch swallow,不阻断主链路
  // ============================================================
  async evaluateAndAlert(): Promise<void> {
    try {
      const now = new Date();
      const oneMinAgo = new Date(now.getTime() - 60 * 1000);
      const opts: MetricsWhereOpts = {};

      const [sla, fallback, provider, analysis] = await Promise.all([
        aiUsageRepository.slaCompliance(oneMinAgo, now, opts),
        aiUsageRepository.fallbackRate(oneMinAgo, now, opts),
        aiUsageRepository.providerAvailability(oneMinAgo, now, opts),
        aiUsageRepository.overview(oneMinAgo, now, opts),
      ]);

      const snapshot: OperationalMetricsInternal = {
        slaComplianceRate: sla.complianceRate,
        aiFallbackRate: fallback.fallbackRate,
        fallbackDetails: fallback.details,
        providerAvailability: provider,
        analysis: {
          total: analysis.totalCount,
          successRate: analysis.successRate,
          avgDurationMs: analysis.avgDurationMs,
        },
        costYuanToday: 0,
        windowStart: oneMinAgo.toISOString(),
        windowEnd: now.toISOString(),
      };

      const { alertService } = await import('./alert.service.js');
      await alertService.evaluateMetrics(snapshot);
    } catch (err) {
      // fail-safe:告警服务异常不阻断指标采集主链路(门禁 M3-4)
      logger.error({ err: (err as Error).message }, '[metrics] evaluateAndAlert failed (non-blocking)');
    }
  }
}

export const metricsAggregationService = new MetricsAggregationServiceClass();
