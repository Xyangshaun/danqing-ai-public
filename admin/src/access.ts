// ============================================================
// 权限 access 函数
// 对应 config/routes.ts 中各路由的 access 字段
// 权限集合由后端 /api/admin/roles 返回 → initialState.permissions
// 此处仅做"是否包含某权限码"的判定,不硬编码角色映射
// ============================================================

import { PERM } from '@/constants';

export interface InitialStateWithAuth {
  currentUser?: {
    role: string;
    name: string;
    avatar: string;
  };
  permissions?: string[];
  fetchUser?: () => Promise<unknown>;
}

const has = (perms: string[] | undefined, code: string): boolean => {
  if (!perms) return false;
  return perms.includes(code);
};

const access = (initialState?: InitialStateWithAuth) => {
  const perms = initialState?.permissions;
  return {
    // 数据看板
    canStatsRead: has(perms, PERM.statsRead),
    // 用户管理
    canUserRead: has(perms, PERM.userRead),
    canRoleRead: has(perms, PERM.roleRead),
    // 内容管理
    canArtworkRead: has(perms, PERM.artworkRead),
    canTemplateRead: has(perms, PERM.templateRead),
    // 订阅管理
    canSubscriptionRead: has(perms, PERM.subscriptionRead),
    canPlanRead: has(perms, PERM.planRead),
    // 系统管理(任一系统权限即可进入菜单)
    canSystemAccess:
      has(perms, PERM.tenantRead) ||
      has(perms, PERM.auditRead) ||
      has(perms, PERM.apiKeyRead) ||
      has(perms, PERM.systemHealth),
    canTenantRead: has(perms, PERM.tenantRead),
    canAuditRead: has(perms, PERM.auditRead),
    canApiKeyRead: has(perms, PERM.apiKeyRead),
    canSystemHealth: has(perms, PERM.systemHealth),
    // 邀请码 / 批量导入(Phase 5)
    canInvitationWrite: has(perms, PERM.invitationWrite),
    // 开发者视图(与数据看板同款权限码 admin:stats:read;
    // 其中功能开关页写操作由后端 config:features:write 校验,403 兜底提示)
    canDevView: has(perms, PERM.statsRead),
  };
};

export default access;
