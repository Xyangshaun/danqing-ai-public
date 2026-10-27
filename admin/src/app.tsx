// ============================================================
// UmiJS 运行时配置
// - getInitialState:启动时拉取当前用户 + 权限矩阵
// - layout:ProLayout 运行时配置(顶部右侧操作区/菜单渲染)
// - rootContainer:注入 React Query + 主题 + 空闲登出
// ============================================================

import { history } from '@umijs/max';
import {
  QuestionCircleOutlined,
  LogoutOutlined,
} from '@ant-design/icons';
import { Dropdown, message, Avatar, Space } from 'antd';
import type { ReactNode } from 'react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntdApp } from 'antd';
import { getCurrentUser, logoutApi } from '@/services/auth';
import { listRoles } from '@/services/user';
import { isAuthenticated, clearAccessToken } from '@/utils/auth';
import { ROLE_LABEL } from '@/constants';
import { useIdleTimer } from '@/hooks/useIdleTimer';
import { IDLE_TIMEOUT_MS, IDLE_WARNING_BEFORE_MS } from '@/constants';
import './global.less';

/** React Query 客户端(服务端状态缓存) */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 60_000,
      gcTime: 5 * 60_000,
    },
  },
});

/** 非登录/layout-free 路径 */
const PUBLIC_PATHS = ['/login', '/auth/feishu/callback'];

type CurrentUser = {
  id: string;
  name: string;
  avatar: string;
  role: string;
  email?: string | null;
  phone?: string | null;
  tenantId: string;
  permissions?: string[];
  tenant?: { id: string; name: string; plan: string };
};

type InitialState = {
  currentUser?: CurrentUser;
  permissions?: string[];
  fetchUser?: () => Promise<CurrentUser | undefined>;
};

/**
 * 初始状态:当前用户 + 权限码集合
 * 权限码由后端 /api/admin/roles 返回的角色矩阵匹配得出(非前端硬编码)
 */
export async function getInitialState(): Promise<{
  currentUser?: CurrentUser;
  permissions?: string[];
  fetchUser?: () => Promise<CurrentUser | undefined>;
}> {
  const fetchUser = async () => {
    try {
      const me = await getCurrentUser();
      const roles = await listRoles();
      const roleInfo = roles.find((r) => r.role === me.user.role);
      const permissions = roleInfo?.permissions ?? [];
      return { ...me.user, permissions, tenant: me.tenant };
    } catch {
      return undefined;
    }
  };

  // 未登录或公开页:不拉取
  if (!isAuthenticated() || PUBLIC_PATHS.includes(window.location.pathname)) {
    return { fetchUser };
  }

  const currentUser = await fetchUser();
  if (!currentUser) {
    // 拉取失败(token 失效等):清登录态,但不强制跳转(由路由守卫处理)
    clearAccessToken();
    return { fetchUser };
  }
  return { currentUser, permissions: currentUser.permissions ?? [], fetchUser };
}

/** 顶栏右侧操作区 */
function RightContent({ initialState }: { initialState: InitialState }) {
  const currentUser = initialState?.currentUser;
  if (!currentUser) return null;

  const onLogout = async () => {
    try {
      await logoutApi(false);
    } catch {
      /* noop */
    } finally {
      clearAccessToken();
      message.success('已退出登录');
      history.replace('/login');
    }
  };

  const menuItems = [
    {
      key: 'profile',
      label: currentUser.name,
      disabled: true,
    },
    {
      type: 'divider' as const,
    },
    {
      key: 'role',
      icon: React.createElement(QuestionCircleOutlined),
      label: `角色:${ROLE_LABEL[currentUser.role as keyof typeof ROLE_LABEL] ?? currentUser.role}`,
      disabled: true,
    },
    {
      key: 'logout',
      icon: React.createElement(LogoutOutlined),
      label: '退出登录',
      onClick: onLogout,
    },
  ];

  return (
    <Space size={12}>
      <Dropdown menu={{ items: menuItems }} placement="bottomRight">
        <Space size={8} style={{ cursor: 'pointer' }}>
          <Avatar size={28} src={currentUser.avatar} style={{ backgroundColor: '#2e5c6e' }}>
            {currentUser.name?.charAt(0)}
          </Avatar>
          <span style={{ fontSize: 13, color: '#1a1a1a' }}>{currentUser.name}</span>
        </Space>
      </Dropdown>
    </Space>
  );
}

/** ProLayout 运行时配置 */
export const layout = ({ initialState }: { initialState?: InitialState }) => {
  return {
    title: '丹青有AI · 管理后台',
    logo: false,
    layout: 'mix',
    splitMenus: false,
    navTheme: 'light',
    fixedHeader: true,
    fixSiderbar: true,
    contentWidth: 'Fluid',
    siderWidth: 220,
    headerHeight: 52,
    onCollapse: undefined,
    // 顶部右侧
    rightContentRender: () => <RightContent initialState={initialState!} />,
    // 顶部标题
    headerTitleRender: () => (
      <div className="dq-header-title">
        <span className="dq-logo-mark">丹</span>
        <span className="dq-logo-text">丹青有AI</span>
        <span className="dq-logo-sub">管理后台</span>
      </div>
    ),
    // 底部版权
    footerRender: () => (
      <div className="dq-footer">
        © 2026 丹青有AI · 运营管理后台 · 仅限授权人员使用
      </div>
    ),
    // 菜单图标色
    menu: {
      locale: false,
      autoClose: false,
    },
    // 403
    unAccessible: <div style={{ padding: 48, textAlign: 'center' }}>无权限访问</div>,
    // 子项 loading
    childrenRender: (children: ReactNode) => {
      return <React.Fragment>{children}</React.Fragment>;
    },
  };
};

/** 空闲登出包装组件 */
function IdleGuard({ children }: { children: ReactNode }) {
  const onIdle = () => {
    clearAccessToken();
    message.warning('长时间未操作,已自动登出');
    history.replace('/login');
  };
  const onWarn = (remainingMs: number) => {
    message.warning({
      content: `${Math.ceil(remainingMs / 1000)} 秒后因无操作自动登出,请及时保存`,
      duration: Math.ceil(remainingMs / 1000),
    });
  };
  useIdleTimer({
    timeout: IDLE_TIMEOUT_MS,
    warnBefore: IDLE_WARNING_BEFORE_MS,
    onIdle,
    onWarn,
  });
  return <>{children}</>;
}

/** 根容器:注入 React Query + antd App 上下文 + 空闲守卫 */
export function rootContainer(container: ReactNode) {
  return React.createElement(
    QueryClientProvider,
    { client: queryClient },
    React.createElement(AntdApp, null, React.createElement(IdleGuard, null, container)),
  );
}

// 声明 API 命名空间(供 initialState 类型用)
declare module '@umijs/max' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace API {
    interface CurrentUser {
      id: string;
      name: string;
      avatar: string;
      role: string;
      email?: string | null;
      phone?: string | null;
      tenantId: string;
      permissions?: string[];
      tenant?: { id: string; name: string; plan: string };
    }
    interface InitialState {
      currentUser?: CurrentUser;
      permissions?: string[];
      fetchUser?: () => Promise<CurrentUser | undefined>;
    }
  }
}
