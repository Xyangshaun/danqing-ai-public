// ============================================================
// 标注反馈统计 Service(反馈闭环 Phase 5 批次①:数据飞轮备料)
// 对应 API:GET /api/admin/stats/feedback/{overview,by-dimension,by-worktype,trend}
//
// 职责:
//   1. 总览(overview):总量/up/down/有用率/独立用户/覆盖分析/近 7 天条数
//   2. 按维度分组(by-dimension):快照 dimension 聚合(哪个维度最常被点没用)
//   3. 按类型分组(by-worktype):workType 冗余列聚合(分类型训练集规模盘点)
//   4. 趋势(trend):最近 N 天按日聚合
//
// 缓存策略:Redis 5 分钟(照 ai-usage 同 TTL),key 形如
//   feedback-stats:overview:20260801:20260831 / feedback-stats:trend:7
// 权限:admin:stats:read(由路由层 requirePermission 强制)
// ============================================================

import { redis } from '../config/redis.js';
import { logger } from '../utils/logger.js';
import { markerFeedbackStatsRepository } from '../repositories/marker-feedback-stats.repository.js';
import type { FeedbackExportRawRow } from '../repositories/marker-feedback-stats.repository.js';
import type {
  AdminFeedbackStatsQuery,
  AdminFeedbackOverviewResponse,
  AdminFeedbackByDimensionResponse,
  AdminFeedbackByWorkTypeResponse,
  AdminFeedbackTrendResponse,
  AdminFeedbackDimensionStat,
  AdminFeedbackWorkTypeStat,
  AdminFeedbackTrendPoint,
  AdminFeedbackExportQuery,
  AdminFeedbackExportRow,
} from '../types/api-contract.js';

const CACHE_KEY_PREFIX = 'feedback-stats';
const CACHE_TTL_SECONDS = 300; // 5 分钟,与 ai-usage 一致

/**
 * 解析 startDate / endDate 字符串(YYYY-MM-DD)为 Date
 * startDate 转 00:00:00, endDate 转 23:59:59.999(闭区间)
 */
function parseDateRange(query: AdminFeedbackStatsQuery): { startDate?: Date; endDate?: Date } {
  const result: { startDate?: Date; endDate?: Date } = {};
  if (query.startDate) {
    const d = new Date(query.startDate);
    if (!isNaN(d.getTime())) {
      d.setHours(0, 0, 0, 0);
      result.startDate = d;
    }
  }
  if (query.endDate) {
    const d = new Date(query.endDate);
    if (!isNaN(d.getTime())) {
      d.setHours(23, 59, 59, 999);
      result.endDate = d;
    }
  }
  return result;
}

/** 有用率统一保留 4 位(0-1;总量 0 时为 0) */
function usefulRate(upCount: number, totalCount: number): number {
  return totalCount > 0 ? Number((upCount / totalCount).toFixed(4)) : 0;
}

class AdminFeedbackStatsServiceClass {
  private async getCached<T>(key: string): Promise<T | null> {
    try {
      const raw = await redis().get(key);
      if (!raw) return null;
      return JSON.parse(raw) as T;
    } catch (err) {
      logger.warn({ err: (err as Error).message }, '[feedback-stats] cache read failed, fallback to DB');
      return null;
    }
  }

  private async setCached<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    try {
      await redis().set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch (err) {
      logger.warn({ err: (err as Error).message }, '[feedback-stats] cache write failed');
    }
  }

  // ============================================================
  // 1. 总览
  // ============================================================
  async getOverview(query: AdminFeedbackStatsQuery): Promise<AdminFeedbackOverviewResponse> {
    const range = parseDateRange(query);
    const cacheKey = `${CACHE_KEY_PREFIX}:overview:${query.startDate ?? 'all'}:${query.endDate ?? 'all'}`;
    const cached = await this.getCached<AdminFeedbackOverviewResponse>(cacheKey);
    if (cached) return cached;

    const agg = await markerFeedbackStatsRepository.overview(range);

    const response: AdminFeedbackOverviewResponse = {
      startDate: query.startDate ?? null,
      endDate: query.endDate ?? null,
      totalCount: agg.totalCount,
      upCount: agg.upCount,
      downCount: agg.downCount,
      usefulRate: usefulRate(agg.upCount, agg.totalCount),
      uniqueUsers: agg.uniqueUsers,
      analysesCovered: agg.analysesCovered,
      last7DaysCount: agg.last7DaysCount,
    };

    await this.setCached(cacheKey, response, CACHE_TTL_SECONDS);
    return response;
  }

  // ============================================================
  // 2. 按维度分组
  // ============================================================
  async getByDimension(query: AdminFeedbackStatsQuery): Promise<AdminFeedbackByDimensionResponse> {
    const range = parseDateRange(query);
    const cacheKey = `${CACHE_KEY_PREFIX}:by-dimension:${query.startDate ?? 'all'}:${query.endDate ?? 'all'}`;
    const cached = await this.getCached<AdminFeedbackByDimensionResponse>(cacheKey);
    if (cached) return cached;

    const groups = await markerFeedbackStatsRepository.groupByDimension(range);

    const stats: AdminFeedbackDimensionStat[] = groups.map((g) => ({
      dimension: g.dimension,
      totalCount: g.totalCount,
      upCount: g.upCount,
      downCount: g.downCount,
      usefulRate: usefulRate(g.upCount, g.totalCount),
    }));

    const response: AdminFeedbackByDimensionResponse = {
      startDate: query.startDate ?? null,
      endDate: query.endDate ?? null,
      stats,
    };

    await this.setCached(cacheKey, response, CACHE_TTL_SECONDS);
    return response;
  }

  // ============================================================
  // 3. 按作品类型分组
  // ============================================================
  async getByWorkType(query: AdminFeedbackStatsQuery): Promise<AdminFeedbackByWorkTypeResponse> {
    const range = parseDateRange(query);
    const cacheKey = `${CACHE_KEY_PREFIX}:by-worktype:${query.startDate ?? 'all'}:${query.endDate ?? 'all'}`;
    const cached = await this.getCached<AdminFeedbackByWorkTypeResponse>(cacheKey);
    if (cached) return cached;

    const groups = await markerFeedbackStatsRepository.groupByWorkType(range);

    const stats: AdminFeedbackWorkTypeStat[] = groups.map((g) => ({
      workType: g.workType,
      totalCount: g.totalCount,
      upCount: g.upCount,
      downCount: g.downCount,
      usefulRate: usefulRate(g.upCount, g.totalCount),
    }));

    const response: AdminFeedbackByWorkTypeResponse = {
      startDate: query.startDate ?? null,
      endDate: query.endDate ?? null,
      stats,
    };

    await this.setCached(cacheKey, response, CACHE_TTL_SECONDS);
    return response;
  }

  // ============================================================
  // 4. 按日趋势(最近 N 天)
  // ============================================================
  async getTrend(query: AdminFeedbackStatsQuery): Promise<AdminFeedbackTrendResponse> {
    const days = Math.min(Math.max(query.days ?? 7, 1), 90); // 1-90,默认 7
    const cacheKey = `${CACHE_KEY_PREFIX}:trend:${days}`;
    const cached = await this.getCached<AdminFeedbackTrendResponse>(cacheKey);
    if (cached) return cached;

    const rows = await markerFeedbackStatsRepository.trend(days);

    const dataPoints: AdminFeedbackTrendPoint[] = rows.map((r) => ({
      date: r.date,
      totalCount: r.totalCount,
      upCount: r.upCount,
      downCount: r.downCount,
    }));

    const response: AdminFeedbackTrendResponse = {
      days,
      dataPoints,
    };

    await this.setCached(cacheKey, response, CACHE_TTL_SECONDS);
    return response;
  }

  // ============================================================
  // 5. 训练数据导出(Phase 5 批次②;无缓存——导出要求新鲜数据)
  //    tenantId 已由 controller 按数据主权规则解析(平台 owner 全局/任意租户;
  //    其他角色强制本租户),service 只负责平铺组装
  // ============================================================
  async exportRows(query: AdminFeedbackExportQuery, tenantId?: string): Promise<AdminFeedbackExportRow[]> {
    const range = parseDateRange(query);
    const rows = await markerFeedbackStatsRepository.exportRows(range, tenantId);
    return rows.map((r) => flattenExportRow(r));
  }
}

/**
 * 平铺单行导出数据:{...markerSnapshot, 元数据键后置覆盖}
 * 快照非对象(异常数据)时退化为纯元数据行,不炸导出
 */
function flattenExportRow(row: FeedbackExportRawRow): AdminFeedbackExportRow {
  const flat: Record<string, unknown> = {};
  const snapshot = row.markerSnapshot;
  if (typeof snapshot === 'object' && snapshot !== null && !Array.isArray(snapshot)) {
    Object.assign(flat, snapshot as Record<string, unknown>);
  }
  // 元数据键后置:同键时元数据优先(防御性约定;实践上 IssueMarker 无这些键名)
  Object.assign(flat, {
    analysisId: row.analysisId,
    markerId: row.markerId,
    markerIndex: row.markerIndex,
    action: row.action,
    workType: row.workType,
    diagnosisMode: row.diagnosisMode,
    collectedAt: row.createdAt.toISOString(),
  });
  return flat as AdminFeedbackExportRow;
}

export const adminFeedbackStatsService = new AdminFeedbackStatsServiceClass();
