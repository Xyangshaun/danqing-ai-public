// ============================================================
// 常量定义:权限码、标签字典、选项列表
// 注意:权限码为 API 契约键名(用于匹配后端返回的权限集合),
//      并非"角色-权限"映射的硬编码,实际权限由后端 /api/admin/roles 返回
// ============================================================

import type {
  ArtType,
  AuditAction,
  InvoiceStatus,
  PaymentProvider,
  PresenceState,
  ReviewAction,
  ReviewStatus,
  SubscriptionStatus,
  TenantPlan,
  TenantStatus,
  TenantType,
  UserRole,
  UserStatus,
  AnalysisStatus,
} from '@/types/api';

/** 权限码(与后端 server/src/config/permissions.ts 保持一致) */
export const PERM = {
  // 用户管理
  userRead: 'admin:user:read',
  userWrite: 'admin:user:write',
  userExport: 'admin:user:export',
  // 角色管理
  roleRead: 'admin:role:read',
  roleWrite: 'admin:role:write',
  // 内容管理
  artworkRead: 'admin:artwork:read',
  artworkWrite: 'admin:artwork:write',
  // 模板管理
  templateRead: 'admin:template:read',
  templateWrite: 'admin:template:write',
  // 订阅管理
  subscriptionRead: 'admin:subscription:read',
  subscriptionWrite: 'admin:subscription:write',
  // 套餐管理
  planRead: 'admin:plan:read',
  planWrite: 'admin:plan:write',
  // 数据看板
  statsRead: 'admin:stats:read',
  // 租户管理
  tenantRead: 'admin:tenant:read',
  tenantWrite: 'admin:tenant:write',
  // 审计日志
  auditRead: 'admin:audit:read',
  // API 密钥
  apiKeyRead: 'admin:apikey:read',
  apiKeyWrite: 'admin:apikey:write',
  // 系统健康
  systemHealth: 'admin:system:health',
  // 邀请码 / 批量导入(Phase 5)
  invitationWrite: 'admin:invitation:write',
  // 预设管理(Phase 5)
  presetRead: 'admin:preset:read',
  presetWrite: 'admin:preset:write',
  // 功能开关(开发者视图,对应 /api/v1/config/features,与后端 permissions.ts 一致)
  configFeaturesRead: 'config:features:read',
  configFeaturesWrite: 'config:features:write',
} as const;

/** 角色 → 中文 */
export const ROLE_LABEL: Record<UserRole, string> = {
  admin: '管理员',
  owner: '所有者',
  teacher: '教师',
  student: '学生',
};

/** 角色颜色(antd Tag) */
export const ROLE_COLOR: Record<UserRole, string> = {
  admin: 'red',
  owner: 'gold',
  teacher: 'blue',
  student: 'default',
};

/** 用户状态 → 中文 */
export const USER_STATUS_LABEL: Record<UserStatus, string> = {
  active: '正常',
  locked: '已锁定',
  deleted: '已删除',
};

/** 用户状态颜色 */
export const USER_STATUS_COLOR: Record<UserStatus, string> = {
  active: 'success',
  locked: 'error',
  deleted: 'default',
};

/** 租户类型 → 中文 */
export const TENANT_TYPE_LABEL: Record<TenantType, string> = {
  school: '学校',
  college: '学院',
  class: '班级',
  individual: '个人',
};

/** 套餐 → 中文 */
export const PLAN_LABEL: Record<TenantPlan, string> = {
  free: '免费版',
  standard: '标准版',
  enterprise: '院校版',
};

/** 套餐颜色 */
export const PLAN_COLOR: Record<TenantPlan, string> = {
  free: 'default',
  standard: 'blue',
  enterprise: 'gold',
};

/** 租户状态 → 中文 */
export const TENANT_STATUS_LABEL: Record<TenantStatus, string> = {
  active: '启用',
  disabled: '已禁用',
};

/** 租户状态颜色 */
export const TENANT_STATUS_COLOR: Record<TenantStatus, string> = {
  active: 'success',
  disabled: 'error',
};

/** 作品类型 → 中文 */
export const ART_TYPE_LABEL: Record<ArtType, string> = {
  painting: '绘画',
  design: '设计',
  product: '产品',
  sculpture: '雕塑',
};

/** 分析任务状态 → 中文 */
export const ANALYSIS_STATUS_LABEL: Record<AnalysisStatus, string> = {
  pending: '排队中',
  processing: '分析中',
  success: '已完成',
  failed: '失败',
};

/** 分析任务状态颜色 */
export const ANALYSIS_STATUS_COLOR: Record<AnalysisStatus, string> = {
  pending: 'default',
  processing: 'processing',
  success: 'success',
  failed: 'error',
};

/** 审核状态 → 中文 */
export const REVIEW_STATUS_LABEL: Record<ReviewStatus, string> = {
  pending: '待审核',
  approved: '已通过',
  rejected: '已拒绝',
  flagged: '已标记',
};

/** 审核状态颜色 */
export const REVIEW_STATUS_COLOR: Record<ReviewStatus, string> = {
  pending: 'default',
  approved: 'success',
  rejected: 'error',
  flagged: 'warning',
};

/** 审核动作 → 中文 */
export const REVIEW_ACTION_LABEL: Record<ReviewAction, string> = {
  approve: '通过',
  reject: '拒绝',
  flag: '标记',
};

/** 订阅状态 → 中文 */
export const SUBSCRIPTION_STATUS_LABEL: Record<SubscriptionStatus, string> = {
  active: '生效中',
  past_due: '逾期',
  canceled: '已取消',
  expired: '已过期',
};

/** 订阅状态颜色 */
export const SUBSCRIPTION_STATUS_COLOR: Record<SubscriptionStatus, string> = {
  active: 'success',
  past_due: 'warning',
  canceled: 'default',
  expired: 'error',
};

/** 发票状态 → 中文 */
export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  pending: '待支付',
  paid: '已支付',
  failed: '支付失败',
  refunded: '已退款',
};

/** 发票状态颜色 */
export const INVOICE_STATUS_COLOR: Record<InvoiceStatus, string> = {
  pending: 'default',
  paid: 'success',
  failed: 'error',
  refunded: 'warning',
};

/** 支付渠道 → 中文 */
export const PAYMENT_PROVIDER_LABEL: Record<PaymentProvider, string> = {
  stripe: 'Stripe',
  alipay: '支付宝',
  wechat: '微信支付',
  manual: '人工',
};

/** 审计动作 → 中文 */
export const AUDIT_ACTION_LABEL: Record<AuditAction, string> = {
  create: '创建',
  update: '更新',
  delete: '删除',
  lock: '锁定/解锁',
  batch: '批量操作',
  review: '审核',
  cancel: '取消',
  refund: '退款',
  revoke: '吊销',
  login: '登录',
  logout: '登出',
};

/** 审计动作颜色 */
export const AUDIT_ACTION_COLOR: Record<AuditAction, string> = {
  create: 'success',
  update: 'processing',
  delete: 'error',
  lock: 'warning',
  batch: 'gold',
  review: 'blue',
  cancel: 'default',
  refund: 'orange',
  revoke: 'error',
  login: 'green',
  logout: 'default',
};

/** API 密钥状态 → 中文 */
export const API_KEY_STATUS_LABEL: Record<'active' | 'revoked', string> = {
  active: '生效中',
  revoked: '已吊销',
};

/** 批量操作上限(与后端一致) */
export const BATCH_LIMIT = 100;

/** 空闲自动登出阈值(30 分钟,毫秒) */
export const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
/** 空闲预警提前量(5 分钟前提示) */
export const IDLE_WARNING_BEFORE_MS = 5 * 60 * 1000;

/** 实时大屏轮询间隔(毫秒) */
export const REALTIME_POLL_INTERVAL = 5000;

/** 用户在线状态轮询间隔(固定 30s,防后端限流/写放大,勿调快) */
export const PRESENCE_POLL_INTERVAL = 30_000;

/** 在线状态三态 → 中文(全端统一,禁止自定义) */
export const PRESENCE_STATE_LABEL: Record<PresenceState, string> = {
  online: '在线',
  idle: '挂起',
  offline: '离线',
};

/** 在线状态三态 → antd Badge status(online 绿 / idle 黄 / offline 灰) */
export const PRESENCE_STATE_BADGE: Record<PresenceState, 'success' | 'warning' | 'default'> = {
  online: 'success',
  idle: 'warning',
  offline: 'default',
};

/** 选项数组(供 ProTable 筛选下拉) */
export const ROLE_OPTIONS = Object.entries(ROLE_LABEL).map(([value, label]) => ({
  value: value as UserRole,
  label,
}));

export const USER_STATUS_OPTIONS = Object.entries(USER_STATUS_LABEL).map(([value, label]) => ({
  value: value as UserStatus,
  label,
}));

export const PRESENCE_STATE_OPTIONS = Object.entries(PRESENCE_STATE_LABEL).map(
  ([value, label]) => ({ value: value as PresenceState, label }),
);

export const TENANT_TYPE_OPTIONS = Object.entries(TENANT_TYPE_LABEL).map(([value, label]) => ({
  value: value as TenantType,
  label,
}));

export const PLAN_OPTIONS = Object.entries(PLAN_LABEL).map(([value, label]) => ({
  value: value as TenantPlan,
  label,
}));

export const TENANT_STATUS_OPTIONS = Object.entries(TENANT_STATUS_LABEL).map(([value, label]) => ({
  value: value as TenantStatus,
  label,
}));

export const ART_TYPE_OPTIONS = Object.entries(ART_TYPE_LABEL).map(([value, label]) => ({
  value: value as ArtType,
  label,
}));

export const ANALYSIS_STATUS_OPTIONS = Object.entries(ANALYSIS_STATUS_LABEL).map(([value, label]) => ({
  value: value as AnalysisStatus,
  label,
}));

export const REVIEW_STATUS_OPTIONS = Object.entries(REVIEW_STATUS_LABEL).map(([value, label]) => ({
  value: value as ReviewStatus,
  label,
}));

export const SUBSCRIPTION_STATUS_OPTIONS = Object.entries(SUBSCRIPTION_STATUS_LABEL).map(
  ([value, label]) => ({ value: value as SubscriptionStatus, label }),
);

export const INVOICE_STATUS_OPTIONS = Object.entries(INVOICE_STATUS_LABEL).map(([value, label]) => ({
  value: value as InvoiceStatus,
  label,
}));

export const AUDIT_ACTION_OPTIONS = Object.entries(AUDIT_ACTION_LABEL).map(([value, label]) => ({
  value: value as AuditAction,
  label,
}));
