// ============================================================
// 丹青有AI - 路由鉴权守卫
// 未登录跳转 /login,加载中显示全屏 loading
// ============================================================

import { type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import LogoMark from '../LogoMark';
import { useAuth } from '../../hooks/useAuth';

export interface RequireAuthProps {
  children: ReactNode;
}

export default function RequireAuth({ children }: RequireAuthProps) {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  // 临时演示模式：通过 ?demo=1 绕过登录，用于本地 UI 验证
  const demo = new URLSearchParams(location.search).get('demo') === '1';

  // 应用启动时恢复登录态,期间显示全屏 loading
  if (isLoading && !demo) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-rice-200 ink-texture gap-4">
        <div className="relative">
          <div className="absolute inset-0 rounded-lg bg-cinnabar/20 blur-xl animate-pulse-slow" />
          <div className="relative">
            <LogoMark />
          </div>
        </div>
        <div className="flex items-center gap-2 text-ink-500">
          <Loader2 className="w-4 h-4 animate-spin text-cinnabar" />
          <span className="text-sm">正在加载...</span>
        </div>
      </div>
    );
  }

  // 未登录:跳转登录页,记录来源路径(登录后可回跳)
  if (!isAuthenticated && !demo) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}
