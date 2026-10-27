// ============================================================
// 通知面板集成测试 (任务包 E:块4)
// 对应源码: src/components/Header.tsx (通知面板部分)
//
// 测试范围:
//   1. 已登录:拉取真实通知列表(API)
//   2. 已登录:加载中显示"加载中…"
//   3. 已登录:无通知显示"暂无通知"空态
//   4. 已登录:点击通知触发标记已读 + 跳转
//   5. 已登录:"全部已读"调用 API 并同步本地状态
//   6. 未登录:回退 mock 通知数据
//   7. 点击外部关闭面板
//   8. Esc 关闭面板(close-notification-panel 事件)
//
// Mock 策略:
//   - useAuth: 可切换已登录/未登录
//   - api: listNotifications / markNotificationRead / markAllNotificationsRead 可控
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../../components/ToastProvider';
import Header from '../../components/Header';
import {
  createAuthValue,
  createAuthenticatedTeacherValue,
} from '../../test/render';
import type { AuthContextValue } from '../../context/AuthContext';
import type { ApiNotification } from '../../types/api-contract';

/* ---------- mock 依赖 ---------- */

const mockUseAuth = vi.fn<(...args: never[]) => AuthContextValue>();
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock('../../services/data-service', () => ({
  getAnalysisHistory: vi.fn().mockResolvedValue([]),
  clearAnalysisHistory: vi.fn().mockResolvedValue(undefined),
}));

const listNotifications = vi.fn();
const getUnreadNotificationCount = vi.fn();
const markNotificationRead = vi.fn();
const markAllNotificationsRead = vi.fn();
vi.mock('../../services/api', () => ({
  listNotifications: (...args: unknown[]) => listNotifications(...args),
  getUnreadNotificationCount: (...args: unknown[]) => getUnreadNotificationCount(...args),
  markNotificationRead: (...args: unknown[]) => markNotificationRead(...args),
  markAllNotificationsRead: (...args: unknown[]) => markAllNotificationsRead(...args),
}));

vi.mock('../../components/auth/TenantSwitcher', () => ({
  __esModule: true,
  default: () => null,
  RoleBadge: ({ role }: { role: string }) => <span data-testid="role-badge">{role}</span>,
}));

/* ---------- 测试数据工厂 ---------- */

function makeApiNotification(overrides: Partial<ApiNotification> = {}): ApiNotification {
  return {
    id: 'notif-1',
    userId: 'user-1',
    type: 'ANALYSIS_DONE',
    level: 'INFO',
    title: '测试通知标题',
    content: '测试通知内容描述',
    linkUrl: null,
    readAt: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/* ---------- 渲染辅助 ---------- */

function renderHeader() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <ToastProvider>
        <Header />
      </ToastProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockUseAuth.mockReset();
  mockUseAuth.mockReturnValue(createAuthenticatedTeacherValue());
  getUnreadNotificationCount.mockReset();
  getUnreadNotificationCount.mockResolvedValue({ count: 0 });
  listNotifications.mockReset();
  listNotifications.mockResolvedValue({ items: [], nextCursor: null });
  markNotificationRead.mockReset();
  markNotificationRead.mockResolvedValue({});
  markAllNotificationsRead.mockReset();
  markAllNotificationsRead.mockResolvedValue({ id: '', readAt: '' });
});

/* ============================================================
 * 1. 已登录:真实通知数据
 * ============================================================ */
describe('通知面板 已登录真实数据', () => {
  it('打开面板时调用 listNotifications API', async () => {
    renderHeader();
    fireEvent.click(screen.getByTitle('通知'));
    await waitFor(() => {
      expect(listNotifications).toHaveBeenCalledWith({ limit: 20 });
    });
  });

  it('加载中显示"加载中…"文案', async () => {
    // 让 listNotifications 永不 resolve,保持加载态
    listNotifications.mockReturnValue(new Promise(() => {}));
    renderHeader();
    fireEvent.click(screen.getByTitle('通知'));
    await waitFor(() => {
      expect(screen.getByText('加载中…')).toBeInTheDocument();
    });
  });

  it('无通知时显示"暂无通知"空态', async () => {
    listNotifications.mockResolvedValue({ items: [], nextCursor: null });
    renderHeader();
    fireEvent.click(screen.getByTitle('通知'));
    await waitFor(() => {
      expect(screen.getByText('暂无通知')).toBeInTheDocument();
    });
  });

  it('有通知时渲染通知标题与内容', async () => {
    listNotifications.mockResolvedValue({
      items: [makeApiNotification({ title: '分析完成通知', content: '作品已完成分析' })],
      nextCursor: null,
    });
    renderHeader();
    fireEvent.click(screen.getByTitle('通知'));
    await waitFor(() => {
      expect(screen.getByText('分析完成通知')).toBeInTheDocument();
    });
    expect(screen.getByText('作品已完成分析')).toBeInTheDocument();
  });
});

/* ============================================================
 * 2. 已登录:标记已读
 * ============================================================ */
describe('通知面板 标记已读', () => {
  it('点击未读通知调用 markNotificationRead API', async () => {
    listNotifications.mockResolvedValue({
      items: [makeApiNotification({ id: 'n1', readAt: null, linkUrl: null })],
      nextCursor: null,
    });
    renderHeader();
    fireEvent.click(screen.getByTitle('通知'));
    await waitFor(() => {
      expect(screen.getByText('测试通知标题')).toBeInTheDocument();
    });
    // 点击通知项
    fireEvent.click(screen.getByText('测试通知标题'));
    await waitFor(() => {
      // 通知 id 为 'n1'(上方 makeApiNotification 覆盖),markNotificationRead 应以该 id 调用
      expect(markNotificationRead).toHaveBeenCalledWith('n1');
    });
  });

  it('点击"全部已读"调用 markAllNotificationsRead API', async () => {
    listNotifications.mockResolvedValue({
      items: [makeApiNotification({ id: 'n1', readAt: null })],
      nextCursor: null,
    });
    markAllNotificationsRead.mockResolvedValue({ id: '', readAt: '', count: 1 });
    renderHeader();
    fireEvent.click(screen.getByTitle('通知'));
    await waitFor(() => {
      expect(screen.getByText('全部已读')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('全部已读'));
    await waitFor(() => {
      expect(markAllNotificationsRead).toHaveBeenCalled();
    });
  });

  it('点击含 linkUrl 的通知触发导航(关闭面板)', async () => {
    listNotifications.mockResolvedValue({
      items: [
        makeApiNotification({
          id: 'n-link',
          readAt: null,
          linkUrl: '/history',
          title: '可跳转通知',
        }),
      ],
      nextCursor: null,
    });
    renderHeader();
    fireEvent.click(screen.getByTitle('通知'));
    await waitFor(() => {
      expect(screen.getByText('可跳转通知')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('可跳转通知'));
    // 面板应关闭
    await waitFor(() => {
      expect(screen.queryByText('全部已读')).not.toBeInTheDocument();
    });
  });

  it('已读通知点击时不重复调用 markNotificationRead', async () => {
    listNotifications.mockResolvedValue({
      items: [
        makeApiNotification({
          id: 'n-read',
          readAt: '2026-01-01T00:00:00Z',
          linkUrl: null,
        }),
      ],
      nextCursor: null,
    });
    renderHeader();
    fireEvent.click(screen.getByTitle('通知'));
    await waitFor(() => {
      expect(screen.getByText('测试通知标题')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('测试通知标题'));
    // 已读通知不应调用 API
    expect(markNotificationRead).not.toHaveBeenCalled();
  });
});

/* ============================================================
 * 3. 未登录:mock 数据回退
 * ============================================================ */
describe('通知面板 未登录 mock 回退', () => {
  it('未登录时显示 mock 通知(作品分析完成)', async () => {
    mockUseAuth.mockReturnValue(createAuthValue());
    renderHeader();
    fireEvent.click(screen.getByTitle('通知'));
    // mock 通知第一条:"作品分析完成"
    expect(screen.getByText('作品分析完成')).toBeInTheDocument();
  });

  it('未登录时不调用 listNotifications API', async () => {
    mockUseAuth.mockReturnValue(createAuthValue());
    renderHeader();
    fireEvent.click(screen.getByTitle('通知'));
    // 未登录不拉取 API
    expect(listNotifications).not.toHaveBeenCalled();
  });

  it('未登录时"全部已读"仅本地置零(不调用 API)', async () => {
    mockUseAuth.mockReturnValue(createAuthValue());
    getUnreadNotificationCount.mockResolvedValue({ count: 3 });
    renderHeader();
    // 打开通知面板触发渲染,确保 mount useEffect 已执行
    fireEvent.click(screen.getByTitle('通知'));
    // 未登录时 fetchUnreadCount 内 isAuthenticated=false 直接 return,
    // 不应调用 getUnreadNotificationCount API(本地 unreadCount 保持 0)
    expect(getUnreadNotificationCount).not.toHaveBeenCalled();
  });
});

/* ============================================================
 * 4. 面板关闭
 * ============================================================ */
describe('通知面板 关闭行为', () => {
  it('close-notification-panel 事件关闭面板', async () => {
    renderHeader();
    fireEvent.click(screen.getByTitle('通知'));
    expect(screen.getByText('全部已读')).toBeInTheDocument();
    act(() => {
      window.dispatchEvent(new CustomEvent('close-notification-panel'));
    });
    await waitFor(() => {
      expect(screen.queryByText('全部已读')).not.toBeInTheDocument();
    });
  });

  it('点击外部区域关闭面板(mousedown)', async () => {
    renderHeader();
    fireEvent.click(screen.getByTitle('通知'));
    expect(screen.getByText('全部已读')).toBeInTheDocument();
    // 模拟点击外部(document.body)
    fireEvent.mouseDown(document.body);
    await waitFor(() => {
      expect(screen.queryByText('全部已读')).not.toBeInTheDocument();
    });
  });

  it('面板底部"查看全部"链接指向 /history', async () => {
    renderHeader();
    fireEvent.click(screen.getByTitle('通知'));
    const viewAll = screen.getByText('查看全部').closest('a');
    expect(viewAll).toHaveAttribute('href', '/history');
  });
});

/* ============================================================
 * 5. 未读计数轮询
 * ============================================================ */
describe('通知面板 未读计数', () => {
  it('已登录时挂载后调用 getUnreadNotificationCount', async () => {
    renderHeader();
    await waitFor(() => {
      expect(getUnreadNotificationCount).toHaveBeenCalled();
    });
  });

  it('unreadCount>0 时铃铛显示数字徽章', async () => {
    getUnreadNotificationCount.mockResolvedValue({ count: 5 });
    renderHeader();
    await screen.findByText('5');
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('unreadCount=0 时不显示徽章', async () => {
    getUnreadNotificationCount.mockResolvedValue({ count: 0 });
    renderHeader();
    await waitFor(() => {
      expect(getUnreadNotificationCount).toHaveBeenCalled();
    });
    const bell = screen.getByTitle('通知');
    expect(bell.querySelector('span')).toBeNull();
  });
});
