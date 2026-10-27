// ============================================================
// 丹青有AI - 测试渲染辅助(任务包 E)
//
// 提供带 Router / ToastProvider 的 render 封装,减少各测试文件
// 重复的 Provider 包裹代码。位于 src/test/(ESLint 与 coverage 均排除)。
// ============================================================

import type { ReactElement, ReactNode } from 'react';
import { render, type RenderOptions } from '@testing-library/react';
import { MemoryRouter, type MemoryRouterProps } from 'react-router-dom';
import { vi } from 'vitest';
import { ToastProvider } from '../components/ToastProvider';
import type { AuthContextValue } from '../context/AuthContext';
import type { UserProfile, TenantInfo } from '../types/api-contract';

interface RouterProviderOptions {
  /** 初始路由路径(默认 '/') */
  initialEntries?: MemoryRouterProps['initialEntries'];
  /** 初始 index(默认 0) */
  initialIndex?: number;
}

interface WithProvidersOptions extends RouterProviderOptions {
  /** 是否包裹 ToastProvider(默认 true,多数组件用 useToast) */
  withToast?: boolean;
  /** 可选的额外 Provider 包裹层 */
  wrapper?: (children: ReactNode) => ReactNode;
}

/**
 * 包裹 Router + (可选)ToastProvider 的 render
 *
 * @param ui 待渲染的 React 元素
 * @param options 路由与 Provider 配置
 * @param renderOptions 透传给 @testing-library/react 的选项
 */
export function renderWithProviders(
  ui: ReactElement,
  options: WithProvidersOptions = {},
  renderOptions?: RenderOptions,
) {
  const {
    initialEntries = ['/'],
    initialIndex = 0,
    withToast = true,
    wrapper,
  } = options;

  function AllProviders({ children }: { children: ReactNode }) {
    let node: ReactNode = children;
    if (withToast) {
      node = <ToastProvider>{node}</ToastProvider>;
    }
    if (wrapper) {
      node = wrapper(node);
    }
    return (
      <MemoryRouter initialEntries={initialEntries} initialIndex={initialIndex}>
        {node}
      </MemoryRouter>
    );
  }

  return render(ui, { wrapper: AllProviders, ...renderOptions });
}

/** 仅包裹 MemoryRouter 的 render(不需要 Toast 的轻量组件) */
export function renderWithRouter(
  ui: ReactElement,
  options: RouterProviderOptions = {},
  renderOptions?: RenderOptions,
) {
  return renderWithProviders(ui, { ...options, withToast: false }, renderOptions);
}

/* ============================================================
 * useAuth mock 工厂
 * 各测试文件用 vi.mock('../../hooks/useAuth') 后,
 * 通过 mockUseAuth.mockReturnValue(createAuthValue({...})) 配置登录态
 * ============================================================ */

/** 构造一个完整的 AuthContextValue mock(默认未登录) */
export function createAuthValue(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  const user: UserProfile | null = overrides.user ?? null;
  const tenant: TenantInfo | null = overrides.tenant ?? null;
  return {
    user,
    tenant,
    memberships: overrides.memberships ?? [],
    isLoading: overrides.isLoading ?? false,
    isAuthenticated: overrides.isAuthenticated ?? (user !== null && tenant !== null),
    login: overrides.login ?? vi.fn(),
    logout: overrides.logout ?? vi.fn().mockResolvedValue(undefined),
    refreshUser: overrides.refreshUser ?? vi.fn().mockResolvedValue(undefined),
    switchTenant: overrides.switchTenant ?? vi.fn().mockResolvedValue(undefined),
    loadTenants: overrides.loadTenants ?? vi.fn().mockResolvedValue(undefined),
    skipLogin: overrides.skipLogin ?? vi.fn(),
  };
}

/** 构造一个已登录的教师用户 AuthContextValue */
export function createAuthenticatedTeacherValue(
  overrides: Partial<AuthContextValue> = {},
): AuthContextValue {
  const now = new Date().toISOString();
  const user: UserProfile = {
    id: 'user-1',
    tenantId: 'tenant-1',
    feishuOpenId: 'open-1',
    feishuUnionId: 'union-1',
    name: '张老师',
    avatar: '',
    email: 'teacher@danqing.ai',
    phone: null,
    role: 'teacher',
    createdAt: now,
    updatedAt: now,
    lastLoginAt: now,
  };
  const tenant: TenantInfo = {
    id: 'tenant-1',
    name: '测试艺术院校',
    type: 'college',
    feishuTenantKey: null,
    plan: 'standard',
    status: 'active',
    maxSeats: 100,
    parentId: null,
    createdAt: now,
  };
  return createAuthValue({ user, tenant, isAuthenticated: true, ...overrides });
}
