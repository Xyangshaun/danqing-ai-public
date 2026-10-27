// ============================================================
// 丹青有AI - 管理后台 API 封装
// 对应文档: docs/superpowers/specs/2026-08-08-admin-dashboard-api-design.md
//
// 设计说明:
//   管理后台挂载在独立命名空间 /api/admin(非 /api/v1)。
//   本模块所有 path 均以 '/api/admin' 开头,api.ts 的 buildUrl 会以原样透传
//   (不拼接默认 BASE_URL /api/v1),并复用同一套鉴权/401刷新/CSRF/错误处理逻辑。
//   只读轮询接口统一 silent:true(避免高频请求触发全局 Toast 噪声)。
// ============================================================

import { get, post, patch } from './api';
import type {
  AdminStatsOverview,
  AdminStatsRealtime,
  AdminStatsGrowthResponse,
  ScoreConsistencyStats,
  AdminSystemHealth,
  AiMetricsResponse,
  SlaMetricsResponse,
  AdminAiUsageQuery,
  AdminAiUsageOverviewResponse,
  AdminAiUsageByProviderResponse,
  AdminAiUsageByUserResponse,
  AdminAiUsageTrendResponse,
  AdminUserListItem,
  AdminUserDetail,
  ListAdminUsersQuery,
  ListAdminUsersResponse,
  UpdateAdminUserRequest,
  LockAdminUserResponse,
  BatchAdminUsersRequest,
  BatchAdminUsersResponse,
  ListAdminRolesResponse,
  AdminTenantListItem,
  ListAdminTenantsQuery,
  ListAdminTenantsResponse,
  AdminTenantStats,
  CreateAdminTenantRequest,
  UpdateAdminTenantRequest,
} from '../types/admin';

const ADMIN = '/api/admin';

/* ============================================================
 * 模块一:实时监控大屏
 * ============================================================ */

/** GET /api/admin/stats/realtime - 实时监控(不缓存,高频轮询) */
export function getStatsRealtime(): Promise<AdminStatsRealtime> {
  return get<AdminStatsRealtime>(`${ADMIN}/stats/realtime`, undefined, { silent: true });
}

/** GET /api/admin/system/health - 系统健康(不缓存,高频轮询) */
export function getSystemHealth(): Promise<AdminSystemHealth> {
  return get<AdminSystemHealth>(`${ADMIN}/system/health`, undefined, { silent: true });
}

/** GET /api/admin/metrics/sla - SLA 达标率(需 metrics 开关;非 owner 仅本租户) */
export function getMetricsSla(query?: { days?: number; tenantId?: string }): Promise<SlaMetricsResponse> {
  return get<SlaMetricsResponse>(`${ADMIN}/metrics/sla`, { ...query }, { silent: true });
}

/** GET /api/admin/metrics/ai - AI 指标(需 metrics 开关) */
export function getMetricsAi(query?: { startDate?: string; endDate?: string }): Promise<AiMetricsResponse> {
  return get<AiMetricsResponse>(`${ADMIN}/metrics/ai`, { ...query }, { silent: true });
}

/** GET /api/admin/stats/overview - 业务总览(缓存 5min) */
export function getStatsOverview(): Promise<AdminStatsOverview> {
  return get<AdminStatsOverview>(`${ADMIN}/stats/overview`, undefined, { silent: true });
}

/** GET /api/admin/stats/score-consistency - AI-教师评分一致性(框架二 P2) */
export function getScoreConsistency(query?: {
  tenantId?: string;
  days?: number;
}): Promise<ScoreConsistencyStats> {
  return get<ScoreConsistencyStats>(`${ADMIN}/stats/score-consistency`, { ...query }, { silent: true });
}

/** GET /api/admin/stats/growth - 成长趋势(Redis 5min) */
export function getStatsGrowth(query: {
  granularity: 'day' | 'week' | 'month';
  startDate: string;
  endDate: string;
  metric?: 'users' | 'artworks' | 'aiCalls' | 'revenue';
}): Promise<AdminStatsGrowthResponse> {
  return get<AdminStatsGrowthResponse>(`${ADMIN}/stats/growth`, { ...query }, { silent: true });
}

/* ---------- AI 用量统计(Redis 5min) ---------- */

/** GET /api/admin/stats/ai-usage/overview */
export function getAiUsageOverview(query?: AdminAiUsageQuery): Promise<AdminAiUsageOverviewResponse> {
  return get<AdminAiUsageOverviewResponse>(`${ADMIN}/stats/ai-usage/overview`, { ...query }, { silent: true });
}

/** GET /api/admin/stats/ai-usage/by-provider */
export function getAiUsageByProvider(query?: AdminAiUsageQuery): Promise<AdminAiUsageByProviderResponse> {
  return get<AdminAiUsageByProviderResponse>(`${ADMIN}/stats/ai-usage/by-provider`, { ...query }, { silent: true });
}

/** GET /api/admin/stats/ai-usage/by-user */
export function getAiUsageByUser(query?: AdminAiUsageQuery): Promise<AdminAiUsageByUserResponse> {
  return get<AdminAiUsageByUserResponse>(`${ADMIN}/stats/ai-usage/by-user`, { ...query }, { silent: true });
}

/** GET /api/admin/stats/ai-usage/trend */
export function getAiUsageTrend(query?: AdminAiUsageQuery): Promise<AdminAiUsageTrendResponse> {
  return get<AdminAiUsageTrendResponse>(`${ADMIN}/stats/ai-usage/trend`, { ...query }, { silent: true });
}

/* ============================================================
 * 模块二:用户管理
 * ============================================================ */

/** GET /api/admin/users - 用户列表(分页,脱敏) */
export function listAdminUsers(query?: ListAdminUsersQuery): Promise<ListAdminUsersResponse> {
  return get<ListAdminUsersResponse>(`${ADMIN}/users`, { ...query });
}

/** GET /api/admin/users/:id - 用户详情 */
export function getAdminUser(id: string): Promise<AdminUserDetail> {
  return get<AdminUserDetail>(`${ADMIN}/users/${id}`);
}

/** PATCH /api/admin/users/:id - 更新用户(角色/状态/姓名) */
export function updateAdminUser(id: string, body: UpdateAdminUserRequest): Promise<AdminUserDetail> {
  return patch<AdminUserDetail>(`${ADMIN}/users/${id}`, body);
}

/**
 * POST /api/admin/users/:id/lock - 锁定/解锁用户(高危)
 * @param confirmPassword 高危确认密码
 * @param idempotencyKey 幂等键(防重复提交)
 */
export function lockAdminUser(
  id: string,
  body: { locked: boolean; reason?: string; confirmPassword?: string },
  idempotencyKey?: string,
): Promise<LockAdminUserResponse> {
  return post<LockAdminUserResponse>(`${ADMIN}/users/${id}/lock`, body, {
    headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
  });
}

/** POST /api/admin/users/batch - 批量操作(updateRole/delete;delete 为高危需密码) */
export function batchAdminUsers(
  body: BatchAdminUsersRequest,
  idempotencyKey?: string,
): Promise<BatchAdminUsersResponse> {
  return post<BatchAdminUsersResponse>(`${ADMIN}/users/batch`, body, {
    headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
  });
}

/** GET /api/admin/roles - 角色权限矩阵 */
export function listAdminRoles(): Promise<ListAdminRolesResponse> {
  return get<ListAdminRolesResponse>(`${ADMIN}/roles`);
}

/**
 * GET /api/admin/users/export - 导出用户 CSV
 * 后端返回 text/csv(非 JSON),需绕过 api.ts 的 JSON 解包,用原生 fetch + blob 下载。
 */
export async function exportAdminUsers(query?: {
  fields?: string;
  search?: string;
  tenantId?: string;
  role?: string;
  status?: string;
}): Promise<void> {
  const { getAccessToken, getDeviceId } = await import('./token-store');
  const params = new URLSearchParams();
  Object.entries(query ?? {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') params.append(k, String(v));
  });
  const qs = params.toString();
  const url = `${ADMIN}/users/export${qs ? `?${qs}` : ''}`;

  const token = getAccessToken();
  const resp = await fetch(url, {
    method: 'GET',
    credentials: 'include',
    headers: {
      Accept: 'text/csv',
      'X-Client': 'web',
      'X-Client-Context': JSON.stringify({ device_id: getDeviceId(), client: 'web' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!resp.ok) {
    throw new Error(`导出失败(HTTP ${resp.status})`);
  }
  const blob = await resp.blob();
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `users-export-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
}

/* ============================================================
 * 模块三:租户管理
 * ============================================================ */

/** GET /api/admin/system/tenants - 租户列表(分页) */
export function listAdminTenants(query?: ListAdminTenantsQuery): Promise<ListAdminTenantsResponse> {
  return get<ListAdminTenantsResponse>(`${ADMIN}/system/tenants`, { ...query });
}

/** GET /api/admin/stats/tenant/:id - 单租户统计 */
export function getAdminTenantStats(id: string): Promise<AdminTenantStats> {
  return get<AdminTenantStats>(`${ADMIN}/stats/tenant/${id}`, undefined, { silent: true });
}

/** POST /api/admin/system/tenants - 创建租户 */
export function createAdminTenant(body: CreateAdminTenantRequest): Promise<AdminTenantListItem> {
  return post<AdminTenantListItem>(`${ADMIN}/system/tenants`, body);
}

/** PATCH /api/admin/system/tenants/:id - 更新租户 */
export function updateAdminTenant(id: string, body: UpdateAdminTenantRequest): Promise<AdminTenantListItem> {
  return patch<AdminTenantListItem>(`${ADMIN}/system/tenants/${id}`, body);
}

// 导出常用类型,便于页面统一从本模块引用
export type { AdminUserListItem, AdminTenantListItem };
