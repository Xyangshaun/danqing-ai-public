// ============================================================
// 二级只读管理员(轻量方案)
// - 后端权限不变,仅前端隐藏/禁用所有写操作入口
// - 依据 initialState.currentUser.email 判定,名单变更需改代码发布
// ============================================================

import { useModel } from '@umijs/max';

/** 二级只读管理员邮箱名单(后端权限不变,前端隐藏所有写操作入口) */
export const READONLY_ADMIN_EMAILS = ['subadmin@dq.edu'];

/** 判定指定邮箱是否为二级只读管理员 */
export const isReadonlyAdmin = (email?: string | null): boolean =>
  !!email && READONLY_ADMIN_EMAILS.includes(email);

/** Hook:当前登录用户是否为二级只读管理员(从 @@initialState 取 currentUser.email) */
export function useReadonlyAdmin(): boolean {
  const { initialState } = useModel('@@initialState');
  return isReadonlyAdmin(initialState?.currentUser?.email);
}
