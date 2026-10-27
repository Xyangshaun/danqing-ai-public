// ============================================================
// 丹青有AI - 管理后台类型(本地镜像,同步自 server/src/types/api-contract.ts)
// 说明:
//   前端 src/types/api-contract.ts 为只读同步副本,不含管理后台 admin 类型。
//   本文件按冻结契约原文定义本地镜像类型(与 services/api.ts 的批删镜像做法一致),
//   不改动只读副本。接口前缀为独立命名空间 /api/admin(非 /api/v1)。
// ============================================================

import type {
  ISODateString,
  UserRole,
  TenantType,
  TenantPlan,
  TenantStatus,
  PaginatedData,
} from './api-contract';

/* 再导出契约基础类型,便于管理后台页面统一从本模块引用 */
export type { TenantType, TenantPlan, TenantStatus, UserRole, ISODateString, PaginatedData };

/** 用户状态(管理后台;前端契约未导出,此处本地镜像) */
export type UserStatus = 'active' | 'locked' | 'deleted';

// ============ 数据看板:总览 / 实时 / 成长 ============

/** GET /api/admin/stats/overview 响应 */
export interface AdminStatsOverview {
  /** 日活用户数(当日登录) */
  dau: number;
  /** 月活用户数(30 日内登录) */
  mau: number;
  /** 总作品数(分析任务总数) */
  totalArtworks: number;
  /** 当日 AI 调用量 */
  todayAiCalls: number;
  /** 总租户数 */
  totalTenants: number;
  /** 总用户数 */
  totalUsers: number;
  /** 当日新增用户数 */
  todayNewUsers: number;
  /** 当日新增作品数 */
  todayNewArtworks: number;
  /** 统计时间戳 */
  timestamp: ISODateString;
}

/** GET /api/admin/stats/realtime 响应 */
export interface AdminStatsRealtime {
  /** 在线用户数(5 分钟内活跃) */
  onlineUsers: number;
  /** 当日累计 AI 调用 */
  todayAiCalls: number;
  /** 处理中任务数 */
  pendingTasks: number;
  /** 系统负载(0-1) */
  systemLoad: number;
  /** 最近 5 分钟请求量 */
  recentRequests: number;
  /** 统计时间戳 */
  timestamp: ISODateString;
}

/** 成长趋势数据点 */
export interface AdminGrowthDataPoint {
  date: ISODateString;
  /** 新增数量 */
  count: number;
  /** 累计总数 */
  cumulative: number;
}

/** GET /api/admin/stats/growth 响应 */
export interface AdminStatsGrowthResponse {
  granularity: string;
  metric: string;
  dataPoints: AdminGrowthDataPoint[];
}

// ============ 框架二 P2:AI-教师评分一致性 ============

/** GET /api/admin/stats/score-consistency 响应(框架二 P2) */
export interface ScoreConsistencyStats {
  /** 差异样本总数 */
  sampleCount: number;
  /** 平均绝对误差(MAE,分) */
  mae: number;
  /** 均方根误差(RMSE,分) */
  rmse: number;
  /** 平均带符号偏差(正值=AI 系统性偏低,负值=AI 系统性偏高) */
  meanDiff: number;
  /** AI 偏低次数(human > ai) */
  aiUnderCount: number;
  /** AI 偏高次数(human < ai) */
  aiOverCount: number;
  /** 完全一致次数(零偏差) */
  exactCount: number;
  /** 四档档位一致率(0-1) */
  bandAgreementRate: number;
  /** 维度级 MAE:{dimensionKey: mae} */
  dimensionMae: Record<string, number>;
  /** 按来源细分统计 */
  bySource: Record<string, {
    sampleCount: number;
    mae: number;
    bandAgreementRate: number;
  }>;
}

// ============ M3 可观测性:AI 指标 ============

/** GET /api/admin/metrics/ai 响应(冻结契约 §3.18) */
export interface AiMetricsResponse {
  startDate: ISODateString;
  endDate: ISODateString;
  /** AI 分析 SLA 达标率(0-1,durationMs≤3000 占比) */
  slaComplianceRate: number;
  /** AI 降级率(0-1,aiFallback 次数/总请求) */
  aiFallbackRate: number;
  providerAvailability: {
    glm: { successRate: number; switchCount: number };
    trae: { successRate: number; switchCount: number };
  };
  analysis: { total: number; successRate: number; avgDurationMs: number };
  costByDay: { date: ISODateString; costYuan: number }[];
  timestamp: ISODateString;
}

/** GET /api/admin/metrics/sla 响应 */
export interface SlaMetricsResponse {
  days: number;
  dailySla: { date: ISODateString; complianceRate: number; total: number }[];
  avgComplianceRate: number;
}

// ============ 用户管理 ============

/** 管理后台用户列表项(脱敏) */
export interface AdminUserListItem {
  id: string;
  tenantId: string;
  name: string;
  avatar: string;
  /** 脱敏邮箱(如 z***@example.com) */
  email: string | null;
  /** 脱敏手机号(如 138****1234) */
  phone: string | null;
  role: UserRole;
  status: UserStatus;
  createdAt: ISODateString;
  lastLoginAt: ISODateString | null;
  lockedAt: ISODateString | null;
}

/** GET /api/admin/users 查询参数 */
export interface ListAdminUsersQuery {
  page?: number;
  pageSize?: number;
  /** 模糊搜索(name/email) */
  search?: string;
  /** 按租户筛选(可选,默认当前租户) */
  tenantId?: string;
  role?: UserRole;
  status?: UserStatus;
  startDate?: ISODateString;
  endDate?: ISODateString;
  sortBy?: 'createdAt' | 'lastLoginAt' | 'name';
  sortOrder?: 'asc' | 'desc';
}

/** GET /api/admin/users 响应 */
export type ListAdminUsersResponse = PaginatedData<AdminUserListItem>;

/** PATCH /api/admin/users/:id 请求 */
export interface UpdateAdminUserRequest {
  role?: UserRole;
  status?: UserStatus;
  name?: string;
}

/** POST /api/admin/users/:id/lock 响应 */
export interface LockAdminUserResponse {
  id: string;
  status: UserStatus;
  lockedAt: ISODateString | null;
}

/** 管理后台用户详情(脱敏后) */
export interface AdminUserDetail extends AdminUserListItem {
  feishuOpenId: string | null;
  updatedAt: ISODateString;
  lockedBy: string | null;
}

/** POST /api/admin/users/batch 请求 */
export interface BatchAdminUsersRequest {
  /** 用户 ID 列表(最多 100 条) */
  userIds: string[];
  /** 批量操作类型 */
  action: 'updateRole' | 'delete';
  /** updateRole 时必填 */
  role?: UserRole;
  /** 高危操作确认密码(action=delete 时必填) */
  confirmPassword?: string;
}

/** 批量操作单条结果 */
export interface BatchAdminUserResult {
  userId: string;
  success: boolean;
  error?: string;
}

/** POST /api/admin/users/batch 响应 */
export interface BatchAdminUsersResponse {
  total: number;
  succeeded: number;
  failed: number;
  results: BatchAdminUserResult[];
}

/** GET /api/admin/roles 响应项 */
export interface AdminRoleInfo {
  role: UserRole;
  roleName: string;
  description: string;
  permissions: string[];
}

/** GET /api/admin/roles 响应 */
export type ListAdminRolesResponse = AdminRoleInfo[];

// ============ 系统健康 ============

/** GET /api/admin/system/health 响应 */
export interface AdminSystemHealth {
  status: 'up' | 'degraded' | 'down';
  services: {
    database: 'up' | 'down';
    redis: 'up' | 'down';
    aiService: 'up' | 'down' | 'disabled';
  };
  /** 进程运行时间(秒) */
  uptime: number;
  /** 内存使用(MB) */
  memoryUsageMb: number;
  nodeVersion: string;
  timestamp: ISODateString;
}

// ============ AI 用量统计 ============

/** AI 用量公共查询参数 */
export interface AdminAiUsageQuery {
  startDate?: string;
  endDate?: string;
  days?: number;
  limit?: number;
}

/** GET /api/admin/stats/ai-usage/overview 响应 */
export interface AdminAiUsageOverviewResponse {
  startDate: string | null;
  endDate: string | null;
  totalCount: number;
  successCount: number;
  failedCount: number;
  successRate: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  totalCostYuan: number;
  avgDurationMs: number;
}

/** GET /api/admin/stats/ai-usage/by-provider 单项 */
export interface AdminAiUsageProviderStat {
  provider: string;
  totalCount: number;
  successCount: number;
  failedCount: number;
  successRate: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  totalCostYuan: number;
  avgDurationMs: number;
}

/** GET /api/admin/stats/ai-usage/by-provider 响应 */
export interface AdminAiUsageByProviderResponse {
  startDate: string | null;
  endDate: string | null;
  stats: AdminAiUsageProviderStat[];
  totalCostYuan: number;
}

/** GET /api/admin/stats/ai-usage/by-user 单项 */
export interface AdminAiUsageUserStat {
  userId: string;
  userName: string;
  userEmail: string | null;
  userRole: UserRole | null;
  tenantId: string | null;
  tenantName: string | null;
  totalCount: number;
  successCount: number;
  failedCount: number;
  successRate: number;
  totalTokens: number;
  totalCostYuan: number;
  avgDurationMs: number;
}

/** GET /api/admin/stats/ai-usage/by-user 响应 */
export interface AdminAiUsageByUserResponse {
  startDate: string | null;
  endDate: string | null;
  limit: number;
  stats: AdminAiUsageUserStat[];
  totalCostYuan: number;
}

/** GET /api/admin/stats/ai-usage/trend 单日数据点 */
export interface AdminAiUsageTrendPoint {
  date: string;
  totalCount: number;
  successCount: number;
  failedCount: number;
  successRate: number;
  totalTokens: number;
  totalCostYuan: number;
}

/** GET /api/admin/stats/ai-usage/trend 响应 */
export interface AdminAiUsageTrendResponse {
  days: number;
  dataPoints: AdminAiUsageTrendPoint[];
  totalCostYuan: number;
}

// ============ 标注反馈统计(反馈闭环 Phase 5 批次①/②:数据飞轮备料) ============

/** 反馈统计公共查询参数(YYYY-MM-DD 闭区间;days 用于 trend) */
export interface AdminFeedbackStatsQuery {
  startDate?: string;
  endDate?: string;
  days?: number;
}

/** GET /api/admin/stats/feedback/overview 响应 */
export interface AdminFeedbackOverviewResponse {
  startDate: string | null;
  endDate: string | null;
  /** 反馈总条数 */
  totalCount: number;
  /** up(有用/认同)条数 */
  upCount: number;
  /** down(没用/不准确)条数 */
  downCount: number;
  /** 有用率(0-1) */
  usefulRate: number;
  /** 独立反馈用户数 */
  uniqueUsers: number;
  /** 被反馈覆盖的分析数 */
  analysesCovered: number;
  /** 最近 7 天反馈条数(恒为近 7 天口径) */
  last7DaysCount: number;
}

/** GET /api/admin/stats/feedback/by-dimension 单项 */
export interface AdminFeedbackDimensionStat {
  dimension: string;
  totalCount: number;
  upCount: number;
  downCount: number;
  usefulRate: number;
}

/** GET /api/admin/stats/feedback/by-dimension 响应 */
export interface AdminFeedbackByDimensionResponse {
  startDate: string | null;
  endDate: string | null;
  stats: AdminFeedbackDimensionStat[];
}

/** GET /api/admin/stats/feedback/by-worktype 单项 */
export interface AdminFeedbackWorkTypeStat {
  workType: string;
  totalCount: number;
  upCount: number;
  downCount: number;
  usefulRate: number;
}

/** GET /api/admin/stats/feedback/by-worktype 响应 */
export interface AdminFeedbackByWorkTypeResponse {
  startDate: string | null;
  endDate: string | null;
  stats: AdminFeedbackWorkTypeStat[];
}

/** GET /api/admin/stats/feedback/trend 单日数据点 */
export interface AdminFeedbackTrendPoint {
  date: string;
  totalCount: number;
  upCount: number;
  downCount: number;
}

/** GET /api/admin/stats/feedback/trend 响应 */
export interface AdminFeedbackTrendResponse {
  days: number;
  dataPoints: AdminFeedbackTrendPoint[];
}

/** 训练数据导出查询参数(批次②;tenantId 仅平台 owner 可传 all/具体租户) */
export interface AdminFeedbackExportQuery {
  tenantId?: string;
  startDate?: string;
  endDate?: string;
}

// ============ 租户管理 ============

/** 管理后台租户列表项 */
export interface AdminTenantListItem {
  id: string;
  name: string;
  type: TenantType;
  feishuTenantKey: string | null;
  plan: TenantPlan;
  status: TenantStatus;
  maxSeats: number;
  parentId: string | null;
  createdAt: ISODateString;
  /** 成员数(冗余字段,便于列表展示) */
  memberCount: number;
}

/** GET /api/admin/system/tenants 查询参数 */
export interface ListAdminTenantsQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  type?: TenantType;
  plan?: TenantPlan;
  status?: TenantStatus;
}

/** GET /api/admin/system/tenants 响应 */
export type ListAdminTenantsResponse = PaginatedData<AdminTenantListItem>;

/** GET /api/admin/stats/tenant/:id 响应(单租户统计) */
export interface AdminTenantStats {
  tenantId: string;
  tenantName: string;
  userCount: number;
  artworkCount: number;
  monthlyAiCalls: number;
  monthlyQuota: number;
  quotaUsageRate: number;
  usedSeats: number;
  maxSeats: number;
  plan: TenantPlan;
  last7dArtworks: number;
  avgScore: number;
}

/** PATCH /api/admin/system/tenants/:id 请求 */
export interface UpdateAdminTenantRequest {
  name?: string;
  plan?: TenantPlan;
  status?: TenantStatus;
  maxSeats?: number;
}

/** POST /api/admin/system/tenants 请求 */
export interface CreateAdminTenantRequest {
  name: string;
  type: TenantType;
  plan?: TenantPlan;
  maxSeats?: number;
  parentId?: string;
  feishuTenantKey?: string;
}
