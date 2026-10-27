// ============================================================
// 权限包装组件:按钮级权限控制
// 无权限时不渲染(或渲染 fallback)
// 权限码由后端返回,前端仅做匹配
// ============================================================

import type { ReactNode } from 'react';
import { usePermission } from '@/hooks/usePermission';

interface AccessProps {
  /** 需要的权限码(任一满足即可) */
  permission: string | string[];
  children: ReactNode;
  /** 无权限时的兜底(默认不渲染) */
  fallback?: ReactNode;
}

export default function Access({ permission, children, fallback = null }: AccessProps) {
  const { hasPermission, hasAny } = usePermission();
  const ok = Array.isArray(permission) ? hasAny(permission) : hasPermission(permission);
  return <>{ok ? children : fallback}</>;
}
