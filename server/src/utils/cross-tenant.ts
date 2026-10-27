// ============================================================
// 跨租户协作角色判定
// 需求:教师账号和上级账号(admin/owner)取消租户隔离,
//      其协作数据(争议仲裁/班级消息/组织分享/学生作品)不按当前激活租户过滤。
// 个人诊断历史仍按租户隔离(student 及所有角色的个人数据不受影响)。
// ============================================================

import type { UserRole } from '../types/api-contract.js';

/** 跨租户协作角色:教师/管理员/所有者 */
export const CROSS_TENANT_ROLES: readonly UserRole[] = ['teacher', 'admin', 'owner'];

/**
 * 判断角色是否跨租户协作
 * @param role 当前用户角色(authMiddleware 从 JWT 注入 req.role)
 * @returns true 表示该角色协作数据不按当前租户隔离
 */
export function isCrossTenantRole(role?: string | null): boolean {
  return !!role && (CROSS_TENANT_ROLES as readonly string[]).includes(role);
}
