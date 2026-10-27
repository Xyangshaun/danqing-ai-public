// ============================================================
// 丹青有AI - 管理员角色守卫
// 仅 admin / owner 可访问管理后台(/admin/*);其余角色显示无权限占位
// 对应文档: docs/superpowers/specs/2026-08-08-admin-dashboard-api-design.md
// ============================================================

import { type ReactNode } from 'react';
import { Navigate, Link } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';

export interface RequireAdminRoleProps {
  children: ReactNode;
}

/** 判断是否为管理员(平台 owner 或租户 admin) */
export function isAdminRole(role: string | undefined | null): boolean {
  return role === 'admin' || role === 'owner';
}

export default function RequireAdminRole({ children }: RequireAdminRoleProps) {
  const { user, isLoading } = useAuth();

  // 登录态由外层 RequireAuth 保证;此处仅在已登录后按角色拦截
  if (isLoading) return null;

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!isAdminRole(user.role)) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4 text-center px-6">
        <div className="w-14 h-14 rounded-full bg-cinnabar/10 flex items-center justify-center">
          <ShieldAlert className="w-7 h-7 text-cinnabar" />
        </div>
        <h2 className="text-lg font-semibold text-ink-800">无管理权限</h2>
        <p className="text-sm text-ink-500 max-w-sm">
          管理后台仅对院校管理员(admin / owner)开放。当前账号角色为「{user.role}」,
          如需访问请联系管理员调整角色。
        </p>
        <Link
          to="/"
          className="mt-2 inline-flex items-center px-4 h-9 rounded-md bg-ink-800 text-rice-50 text-sm hover:bg-ink-700 transition-colors"
        >
          返回首页
        </Link>
      </div>
    );
  }

  return <>{children}</>;
}
