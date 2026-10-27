// ============================================================
// AI 用量统计 Service(用量统计模块)
// 对应 API:GET /api/admin/stats/ai-usage/{overview,by-provider,by-user,trend}
//
// 职责:
//   1. 总览(overview):总次数/成功数/失败数/总token/总成本/平均耗时/成功率
//   2. 按 Provider 分组(by-provider):各 provider 的统计指标
//   3. 按用户分组(by-user):Top N 调用量的用户(关联 users 表补充姓名)
//   4. 趋势(trend):最近 N 天按日聚合
//
// 缓存策略:Redis 缓存 5 分钟(与 stats/ai-cost 同 TTL),key 形如 ai-usage:overview:20260801:20260831
// 权限:admin:stats:read(由路由层 requirePermission 强制)
// ============================================================

import { aiUsageRepository } from '../repositories/ai-usage.repository.js';
import { prisma } from '../config/prisma.js';
import { redis } from '../config/redis.js';
import { logger } from '../utils/logger.js';
import type {
  AdminAiUsageOverviewResponse,
  AdminAiUsageByProviderResponse,
  AdminAiUsageByUserResponse,
  AdminAiUsageTrendResponse,
  AdminAiUsageQuery,
  AdminAiUsageProviderStat,
  AdminAiUsageUserStat,
  AdminAiUsageTrendPoint,
} from '../types/api-contract.js';

const CACHE_KEY_PREFIX = 'ai-usage';
const CACHE_TTL_SECONDS = 300; // 5 分钟,与 stats/ai-cost 一致

/**
 * 解析 startDate / endDate 字符串(YYYY-MM-DD)为 Date
 * startDate 转 00:00:00, endDate 转 23:59:59.999(闭区间)
 */
function parseDateRange(query: AdminAiUsageQuery): { startDate?: Date; endDate?: Date } {
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

class AdminAiUsageServiceClass {
  private async getCached<T>(key: string): Promise<T | null> {
    try {
      const raw = await redis().get(key);
      if (!raw) return null;
      return JSON.parse(raw) as T;
    } catch (err) {
      logger.warn({ err: (err as Error).message }, '[ai-usage] cache read failed, fallback to DB');
      return null;
    }
  }

  private async setCached<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    try {
      await redis().set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch (err) {
      logger.warn({ err: (err as Error).message }, '[ai-usage] cache write failed');
    }
  }

  // ============================================================
  // 1. 总览
  // ============================================================
  async getOverview(query: AdminAiUsageQuery): Promise<AdminAiUsageOverviewResponse> {
    const { startDate, endDate } = parseDateRange(query);
    const cacheKey = `${CACHE_KEY_PREFIX}:overview:${query.startDate ?? 'all'}:${query.endDate ?? 'all'}`;
    const cached = await this.getCached<AdminAiUsageOverviewResponse>(cacheKey);
    if (cached) return cached;

    const agg = await aiUsageRepository.overview(startDate, endDate);

    const response: AdminAiUsageOverviewResponse = {
      startDate: query.startDate ?? null,
      endDate: query.endDate ?? null,
      totalCount: agg.totalCount,
      successCount: agg.successCount,
      failedCount: agg.failedCount,
      successRate: Number(agg.successRate.toFixed(4)),
      totalPromptTokens: agg.totalPromptTokens,
      totalCompletionTokens: agg.totalCompletionTokens,
      totalTokens: agg.totalTokens,
      totalCostYuan: Number(agg.totalCostYuan),
      avgDurationMs: Math.round(agg.avgDurationMs),
    };

    await this.setCached(cacheKey, response, CACHE_TTL_SECONDS);
    return response;
  }

  // ============================================================
  // 2. 按 Provider 分组
  // ============================================================
  async getByProvider(query: AdminAiUsageQuery): Promise<AdminAiUsageByProviderResponse> {
    const { startDate, endDate } = parseDateRange(query);
    const cacheKey = `${CACHE_KEY_PREFIX}:by-provider:${query.startDate ?? 'all'}:${query.endDate ?? 'all'}`;
    const cached = await this.getCached<AdminAiUsageByProviderResponse>(cacheKey);
    if (cached) return cached;

    const groups = await aiUsageRepository.groupByProvider(startDate, endDate);

    const stats: AdminAiUsageProviderStat[] = groups.map((g) => ({
      provider: g.provider,
      totalCount: g.totalCount,
      successCount: g.successCount,
      failedCount: g.failedCount,
      successRate: Number(g.successRate.toFixed(4)),
      totalPromptTokens: g.totalPromptTokens,
      totalCompletionTokens: g.totalCompletionTokens,
      totalTokens: g.totalTokens,
      totalCostYuan: Number(g.totalCostYuan),
      avgDurationMs: Math.round(g.avgDurationMs),
    }));

    const response: AdminAiUsageByProviderResponse = {
      startDate: query.startDate ?? null,
      endDate: query.endDate ?? null,
      stats,
      totalCostYuan: stats.reduce((sum, s) => sum + s.totalCostYuan, 0),
    };

    await this.setCached(cacheKey, response, CACHE_TTL_SECONDS);
    return response;
  }

  // ============================================================
  // 3. 按用户分组(Top N,关联 users 表补充姓名)
  // ============================================================
  async getByUser(query: AdminAiUsageQuery): Promise<AdminAiUsageByUserResponse> {
    const { startDate, endDate } = parseDateRange(query);
    const limit = Math.min(Math.max(query.limit ?? 10, 1), 100); // 1-100,默认 10
    const cacheKey = `${CACHE_KEY_PREFIX}:by-user:${query.startDate ?? 'all'}:${query.endDate ?? 'all'}:${limit}`;
    const cached = await this.getCached<AdminAiUsageByUserResponse>(cacheKey);
    if (cached) return cached;

    const groups = await aiUsageRepository.groupByUser(startDate, endDate, limit);

    // 关联 users 表批量查询用户信息(姓名/角色/租户名)
    const userIds = groups.map((g) => g.userId);
    const users = userIds.length > 0
      ? await prisma().user.findMany({
          where: { id: { in: userIds } },
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            tenant: { select: { id: true, name: true } },
          },
        })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u]));

    const stats: AdminAiUsageUserStat[] = groups.map((g) => {
      const u = userMap.get(g.userId);
      return {
        userId: g.userId,
        userName: u?.name ?? '(未知用户)',
        userEmail: u?.email ?? null,
        userRole: u?.role ?? null,
        tenantId: u?.tenant?.id ?? null,
        tenantName: u?.tenant?.name ?? null,
        totalCount: g.totalCount,
        successCount: g.successCount,
        failedCount: g.failedCount,
        successRate: g.totalCount > 0 ? Number((g.successCount / g.totalCount).toFixed(4)) : 0,
        totalTokens: g.totalTokens,
        totalCostYuan: Number(g.totalCostYuan),
        avgDurationMs: Math.round(g.avgDurationMs),
      };
    });

    const response: AdminAiUsageByUserResponse = {
      startDate: query.startDate ?? null,
      endDate: query.endDate ?? null,
      limit,
      stats,
      totalCostYuan: stats.reduce((sum, s) => sum + s.totalCostYuan, 0),
    };

    await this.setCached(cacheKey, response, CACHE_TTL_SECONDS);
    return response;
  }

  // ============================================================
  // 4. 按日期趋势(最近 N 天)
  // ============================================================
  async getTrend(query: AdminAiUsageQuery): Promise<AdminAiUsageTrendResponse> {
    const days = Math.min(Math.max(query.days ?? 7, 1), 90); // 1-90,默认 7
    const cacheKey = `${CACHE_KEY_PREFIX}:trend:${days}`;
    const cached = await this.getCached<AdminAiUsageTrendResponse>(cacheKey);
    if (cached) return cached;

    const rows = await aiUsageRepository.trend(days);

    const dataPoints: AdminAiUsageTrendPoint[] = rows.map((r) => ({
      date: r.date.toISOString().slice(0, 10), // YYYY-MM-DD
      totalCount: r.total_count,
      successCount: r.success_count,
      failedCount: r.failed_count,
      successRate: r.total_count > 0 ? Number((r.success_count / r.total_count).toFixed(4)) : 0,
      totalTokens: Number(r.total_tokens),
      totalCostYuan: Number(r.total_cost_yuan),
    }));

    const response: AdminAiUsageTrendResponse = {
      days,
      dataPoints,
      totalCostYuan: dataPoints.reduce((sum, p) => sum + p.totalCostYuan, 0),
    };

    await this.setCached(cacheKey, response, CACHE_TTL_SECONDS);
    return response;
  }
}

export const adminAiUsageService = new AdminAiUsageServiceClass();
