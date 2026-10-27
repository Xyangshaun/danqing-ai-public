// ============================================================
// 丹青有AI - 全局认证 Context
// 对应设计:auth-design.md §1.2 步骤 11(应用启动恢复登录态)
// ============================================================

import {
  createContext, useCallback, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import type {
  AuthMeResponse,
  FeishuCallbackResponse,
  TenantInfo,
  TenantMembership,
  UserProfile,
} from '../types/api-contract';
import {
  getCurrentUser,
  listTenants,
  logout as sdkLogout,
  refreshAccessToken,
  switchTenant as sdkSwitchTenant,
} from '../services/auth-sdk';
import { setAuthFailedHandler, setToastHandler } from '../services/api';
import type { ApiError } from '../services/api';
import { clearAccessToken, hasAccessToken } from '../services/token-store';
import { useToast } from '../components/ToastProvider';

/* ============================================================
 * Context 类型
 * ============================================================ */

export interface AuthContextValue {
  /** 当前用户(null 表示未登录) */
  user: UserProfile | null;
  /** 当前激活租户(null 表示未登录) */
  tenant: TenantInfo | null;
  /** 用户在所有租户中的成员关系(用于切换租户下拉) */
  memberships: TenantMembership[];
  /** 是否正在初始化(应用启动时恢复登录态) */
  isLoading: boolean;
  /** 是否已登录 */
  isAuthenticated: boolean;
  /** OAuth 回调成功后,设置登录态 */
  login: (data: FeishuCallbackResponse) => void;
  /** 登出:调用后端 + 清状态 + 跳登录页 */
  logout: (revokeAll?: boolean) => Promise<void>;
  /** 刷新用户信息(从后端重新拉取) */
  refreshUser: () => Promise<void>;
  /** 切换租户(更新 tenant + access_token) */
  switchTenant: (tenantId: string) => Promise<void>;
  /** 刷新用户所有租户成员关系(用于租户列表可能变化场景) */
  loadTenants: () => Promise<void>;
  /** 跳过登录(开发模式,注入 mock 用户数据) */
  skipLogin: () => void;
}

// eslint-disable-next-line react-refresh/only-export-components -- Context 对象与 Provider 同文件是 React 官方推荐组织方式
export const AuthContext = createContext<AuthContextValue | null>(null);

/* ============================================================
 * Provider
 * ============================================================ */

export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const toast = useToast();

  const [user, setUser] = useState<UserProfile | null>(null);
  const [tenant, setTenant] = useState<TenantInfo | null>(null);
  const [memberships, setMemberships] = useState<TenantMembership[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // 防止 useEffect 严格模式双重触发恢复流程
  const recoverStartedRef = useRef(false);

  /* ---------- 注入 api.ts 的外部回调 ---------- */
  // 登录失效处理:清状态 + 跳登录页
  const handleAuthFailed = useCallback(() => {
    setUser(null);
    setTenant(null);
    setMemberships([]);
    clearAccessToken();
    // 仅在已登录态被打断时跳登录页;首次加载未登录不跳
    navigate('/login', { replace: true });
  }, [navigate]);

  // Toast 回调(api.ts 业务错误统一通过此通道发 Toast)
  useEffect(() => {
    setToastHandler((type, title, desc) => {
      toast[type](title, desc);
    });
    setAuthFailedHandler(handleAuthFailed);
    return () => {
      setToastHandler(null);
      setAuthFailedHandler(null);
    };
  }, [toast, handleAuthFailed]);

  /* ---------- 应用启动:恢复登录态 ---------- */
  // 对应 auth-design.md §1.2 步骤 11:刷新页面 token 丢失,自动 /auth/refresh 恢复
  useEffect(() => {
    if (recoverStartedRef.current) return;
    recoverStartedRef.current = true;

    (async () => {
      setIsLoading(true);
      try {
        // 优先用内存 token 调 /auth/me
        if (hasAccessToken()) {
          try {
            const me = await getCurrentUser();
            applyAuthMe(me);
            return;
          } catch {
            // 内存 token 失效,降级走 refresh
          }
        }
        // 无 token 或失效:尝试基于 Cookie 的 refresh_token 恢复
        try {
          await refreshAccessToken();
          const me = await getCurrentUser();
          applyAuthMe(me);
        } catch {
          // refresh 失败:未登录态(不报错,静默)
          resetAuthState();
        }
      } finally {
        setIsLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- 内部工具 ---------- */
  const applyAuthMe = useCallback((me: AuthMeResponse) => {
    setUser(me.user);
    setTenant(me.tenant);
    setMemberships(me.memberships ?? []);
  }, []);

  const resetAuthState = useCallback(() => {
    setUser(null);
    setTenant(null);
    setMemberships([]);
    clearAccessToken();
  }, []);

  /* ---------- login:OAuth 回调成功后调用 ---------- */
  const login = useCallback(
    (data: FeishuCallbackResponse) => {
      setUser(data.user);
      setTenant(data.tenant);
      setMemberships([]);
      // access_token 已在 auth-sdk.handleFeishuCallback 内存入 token-store
    },
    []
  );

  /* ---------- logout:调用后端 + 清状态 + 跳登录页 ---------- */
  const logout = useCallback(
    async (revokeAll = false) => {
      try {
        await sdkLogout(revokeAll);
      } catch {
        // 后端登出失败不阻塞前端清状态(可能 token 已过期)
      } finally {
        resetAuthState();
        toast.success('已登出', '欢迎下次再来');
        navigate('/login', { replace: true });
      }
    },
    [resetAuthState, toast, navigate]
  );

  /* ---------- refreshUser:重新拉取 /auth/me ---------- */
  const refreshUser = useCallback(async () => {
    const me = await getCurrentUser();
    applyAuthMe(me);
  }, [applyAuthMe]);

  /* ---------- switchTenant:切换租户 ---------- */
  const switchTenant = useCallback(
    async (tenantId: string) => {
      const result = await sdkSwitchTenant(tenantId);
      setTenant(result.tenant);
      // 切换租户后用户角色可能变化,刷新 user(role 和 tenantId 会变化)
      try {
        await refreshUser();
      } catch {
        // 刷新 user 失败不阻塞(可能 token 已过期,由拦截器处理)
      }
      // 触发全局事件,通知各页面基于新租户重新加载数据
      // (data-service 通过 hasAccessToken 判断数据源,token 已更新会自动走 API)
      window.dispatchEvent(
        new CustomEvent('tenant-switched', {
          detail: { tenantId: result.tenant.id, tenantName: result.tenant.name },
        })
      );
      toast.success('租户已切换', result.tenant.name);
    },
    [refreshUser, toast]
  );

  /* ---------- loadTenants:刷新用户所有租户成员关系 ---------- */
  const loadTenants = useCallback(async () => {
    try {
      const list = await listTenants();
      setMemberships(list);
    } catch {
      // 刷新租户列表失败不阻塞(可能 token 已过期,由拦截器处理)
      // 保留现有 memberships,不清空
    }
  }, []);

  /* ---------- skipLogin:跳过登录(开发模式) ---------- */
  // 后端服务未启动时,注入 mock 用户数据,直接进入首页
  const skipLogin = useCallback(() => {
    const now = new Date().toISOString();
    setUser({
      id: 'dev-user',
      tenantId: 'dev-tenant',
      feishuOpenId: 'dev-open-id',
      feishuUnionId: 'dev-union-id',
      name: '开发者',
      avatar: '',
      email: 'dev@danqing.ai',
      phone: null,
      role: 'teacher',
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
    });
    setTenant({
      id: 'dev-tenant',
      name: '开发测试租户',
      plan: 'standard',
      status: 'active',
    } as TenantInfo);
    setMemberships([]);
    navigate('/', { replace: true });
  }, [navigate]);

  /* ---------- 暴露 Context 值 ---------- */
  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      tenant,
      memberships,
      isLoading,
      isAuthenticated: user !== null && tenant !== null,
      login,
      logout,
      refreshUser,
      switchTenant,
      loadTenants,
      skipLogin,
    }),
    [user, tenant, memberships, isLoading, login, logout, refreshUser, switchTenant, loadTenants, skipLogin]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/* ============================================================
 * 兼容导出:供组件按需导入 ApiError
 * ============================================================ */
export type { ApiError };
