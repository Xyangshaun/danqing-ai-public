// ============================================================
// 丹青有AI - 教师角色守卫
// teacher / admin / owner 可访问教师工作台(/teacher/*);学生显示无权限占位
// ============================================================

import { type ReactNode } from 'react';
import { Navigate, Link } from 'react-router-dom';
import { GraduationCap } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';

export interface RequireTeacherRoleProps {
  children: ReactNode;
}

/** 判断是否为教师及以上角色(教师/院校管理员/平台 owner) */
export function isTeacherRole(role: string | undefined | null): boolean {
  return role === 'teacher' || role === 'admin' || role === 'owner';
}

export default function RequireTeacherRole({ children }: RequireTeacherRoleProps) {
  const { user, isLoading } = useAuth();

  // 登录态由外层 RequireAuth 保证;此处仅在已登录后按角色拦截
  if (isLoading) return null;

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!isTeacherRole(user.role)) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4 text-center px-6">
        <div className="w-14 h-14 rounded-full bg-stone/10 flex items-center justify-center">
          <GraduationCap className="w-7 h-7 text-stone" />
        </div>
        <h2 className="text-lg font-semibold text-ink-800">无教师权限</h2>
        <p className="text-sm text-ink-500 max-w-sm">
          教师工作台仅对教师(teacher)及以上角色开放。当前账号角色为「{user.role}」,
          如需访问请联系院校管理员调整角色。
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
