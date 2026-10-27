// ============================================================
// 数据看板 API
// 对应后端:/api/admin/stats/*
// ============================================================

import { get } from './request';
import type {
  AdminStatsOverview,
  AdminStatsGrowthQuery,
  AdminStatsGrowthResponse,
  AdminStatsRetentionQuery,
  AdminStatsRetentionResponse,
  AdminStatsAiCostQuery,
  AdminStatsAiCostResponse,
  AdminStatsRealtime,
  AdminTenantStats,
} from './types';

/** 总览统计(Redis 缓存 1 分钟) */
export function getStatsOverview(): Promise<AdminStatsOverview> {
  return get<AdminStatsOverview>('/api/admin/stats/overview');
}

/** 成长趋势(Redis 缓存 5 分钟) */
export function getStatsGrowth(params: AdminStatsGrowthQuery): Promise<AdminStatsGrowthResponse> {
  return get<AdminStatsGrowthResponse>('/api/admin/stats/growth', params);
}

/** 留存分析 */
export function getStatsRetention(
  params: AdminStatsRetentionQuery,
): Promise<AdminStatsRetentionResponse> {
  return get<AdminStatsRetentionResponse>('/api/admin/stats/retention', params);
}

/** AI 成本统计 */
export function getStatsAiCost(params: AdminStatsAiCostQuery): Promise<AdminStatsAiCostResponse> {
  return get<AdminStatsAiCostResponse>('/api/admin/stats/ai-cost', params);
}

/** 实时监控(不缓存) */
export function getStatsRealtime(): Promise<AdminStatsRealtime> {
  return get<AdminStatsRealtime>('/api/admin/stats/realtime');
}

/** 单租户统计 */
export function getTenantStats(tenantId: string): Promise<AdminTenantStats> {
  return get<AdminTenantStats>(`/api/admin/stats/tenant/${tenantId}`);
}
