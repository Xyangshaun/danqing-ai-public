// ============================================================
// 开发者视图 API
// - GET   /api/admin/dev/accounts      账号在线(含汇总,条目含三态 presenceState)
// - GET   /api/admin/presence/online   实时在线三态汇总(admin:stats:read)
// - GET   /api/admin/dev/deployments   版本部署记录
// - GET   /api/v1/config/features      功能开关列表
// - PATCH /api/v1/config/features/:id  更新功能开关(仅 ADMIN/OWNER,403 兜底)
// ============================================================

import { get, patch } from './request';
import type { PresenceOnlineResponse, PresenceState } from '@/types/api';

// ============ 账号在线 ============

/** 账号在线条目 */
export interface DevAccountItem {
  id: string;
  email: string | null;
  name: string;
  role: 'admin' | 'owner' | 'teacher' | 'student';
  authType: string;
  status: string;
  tenantId: string;
  tenantName: string;
  isOnline: boolean;
  activeSessions: number;
  lastActiveAt: string | null;
  isTestAccount: boolean;
  /** 三态实时状态(M-4 追加):online 在线 / idle 挂起 / offline 离线 */
  presenceState: PresenceState;
}

/** 账号在线汇总 */
export interface DevAccountsSummary {
  total: number;
  online: number;
  /** 各角色账号数(role → count) */
  byRole: Record<string, number>;
}

export interface DevAccountsResponse {
  accounts: DevAccountItem[];
  summary: DevAccountsSummary;
}

/** 账号在线列表 + 汇总 */
export function getDevAccounts(): Promise<DevAccountsResponse> {
  return get<DevAccountsResponse>('/api/admin/dev/accounts');
}

// ============ 实时在线三态汇总(Presence) ============

/** 实时在线三态汇总(GET /api/admin/presence/online,需 admin:stats:read;响应含 items/summary/asOf) */
export function getPresenceOnline(): Promise<PresenceOnlineResponse> {
  return get<PresenceOnlineResponse>('/api/admin/presence/online');
}

// ============ 版本部署 ============

/** 部署记录条目 */
export interface DevDeploymentItem {
  id: string;
  timestamp: string;
  version: string;
  serverId: string;
  status: 'success' | 'failed' | string;
  deployer: string;
  branch: string;
  commitSha: string;
  details: Record<string, unknown> | null;
  errorMessage: string | null;
  sourceIp: string | null;
}

export interface DevDeploymentsResponse {
  deployments: DevDeploymentItem[];
  /** 最近一次部署(可能为 null) */
  latest: DevDeploymentItem | null;
}

/** 版本部署记录(默认近 20 条) */
export function getDevDeployments(limit = 20): Promise<DevDeploymentsResponse> {
  return get<DevDeploymentsResponse>('/api/admin/dev/deployments', { limit });
}

// ============ 功能开关 ============

/** 功能开关类型(对齐后端 api-contract FeatureFlagType) */
export type FeatureFlagType = 'boolean' | 'percentage' | 'user-list' | 'tenant-list';

/** 功能开关状态(对齐后端 api-contract FeatureFlagStatus) */
export type FeatureFlagStatus = 'enabled' | 'disabled' | 'gradual';

/** 功能开关(对齐后端 api-contract FeatureFlag) */
export interface FeatureFlag {
  featureId: string;
  name: string;
  description: string;
  type: FeatureFlagType;
  status: FeatureFlagStatus;
  /** 当前值(boolean / 百分比 0-100 / 名单列表) */
  value: boolean | number | string[];
  defaultValue: boolean | number | string[];
  targetUserIds: string[];
  targetTenantIds: string[];
}

/** 功能开关列表 */
export function getFeatures(): Promise<FeatureFlag[]> {
  return get<FeatureFlag[]>('/api/v1/config/features');
}

/**
 * 更新功能开关当前值
 * 请求体对齐后端 updateFeatureFlagBodySchema:{ status?, value?, targetUserIds?, targetTenantIds? }
 * 此处仅提交 value(状态变更由后端/运维侧控制)
 */
export function updateFeature(
  featureId: string,
  value: boolean | number | string[],
): Promise<FeatureFlag> {
  return patch<FeatureFlag>(`/api/v1/config/features/${encodeURIComponent(featureId)}`, { value });
}
