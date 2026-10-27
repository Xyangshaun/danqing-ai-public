// ============================================================
// Header 组件单元测试
// 对应源码: src/components/Header.tsx
//
// 测试范围:
//   1. 渲染品牌 Logo + 命令面板触发按钮
//   2. 命令面板开关(Ctrl+K / 点击搜索按钮)
//   3. 通知面板开关(点击铃铛)
//   4. 未读数量徽章显示
//   5. 路由标题映射(不同 pathname 显示不同标题)
//   6. mock useAuth(已登录/未登录态)与通知 API
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../ToastProvider';
import Header from '../Header';
import {
  createAuthValue,
  createAuthenticatedTeacherValue,
} from '../../test/render';
import type { AuthContextValue } from '../../context/AuthContext';

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

/* TenantSwitcher 已登录时渲染,内部依赖较多,这里 mock 成占位 */
vi.mock('../auth/TenantSwitcher', () => ({
  __esModule: true,
  default: () => null,
  RoleBadge: ({ role }: { role: string }) => <span data-testid="role-badge">{role}</span>,
}));

/* ---------- 渲染辅助 ---------- */

function renderHeader({ initialPath = '/' }: { initialPath?: string } = {}) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <ToastProvider>
        <Header />
      </ToastProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockUseAuth.mockReset();
  mockUseAuth.mockReturnValue(createAuthValue());
  getUnreadNotificationCount.mockReset();
  getUnreadNotificationCount.mockResolvedValue({ count: 0 });
  listNotifications.mockReset();
  listNotifications.mockResolvedValue({ items: [], nextCursor: null });
  markNotificationRead.mockReset();
  markNotificationRead.mockResolvedValue({});
  markAllNotificationsRead.mockReset();
  markAllNotificationsRead.mockResolvedValue({ id: '', readAt: '' });
});

describe('Header 渲染', () => {
  it('渲染品牌 Logo(SVG)与全局搜索触发按钮', () => {
    renderHeader();
    // 搜索按钮(含 ⌘K 提示文字)
    expect(screen.getByText('搜索功能、作品、风格…')).toBeInTheDocument();
    // Logo SVG 存在
    expect(document.querySelector('svg')).toBeInTheDocument();
  });

  it('未登录时显示"登录"按钮', () => {
    mockUseAuth.mockReturnValue(createAuthValue());
    renderHeader();
    expect(screen.getByTitle('登录丹青有AI')).toBeInTheDocument();
  });

  it('已登录时显示用户名而非"登录"按钮', () => {
    mockUseAuth.mockReturnValue(createAuthenticatedTeacherValue());
    renderHeader();
    expect(screen.getByText('张老师')).toBeInTheDocument();
    expect(screen.queryByTitle('登录丹青有AI')).not.toBeInTheDocument();
  });
});

describe('Header 路由标题映射', () => {
  it('路由 / 显示"工作台"标题', () => {
    renderHeader({ initialPath: '/' });
    expect(screen.getByText('工作台')).toBeInTheDocument();
  });

  it('路由 /analyze 显示"AI 诊断"标题', () => {
    renderHeader({ initialPath: '/analyze' });
    expect(screen.getByText('AI 诊断')).toBeInTheDocument();
  });

  it('路由 /history 显示"历史记录"标题', () => {
    renderHeader({ initialPath: '/history' });
    expect(screen.getByText('历史记录')).toBeInTheDocument();
  });

  it('路由 /settings 显示"设置"标题', () => {
    renderHeader({ initialPath: '/settings' });
    expect(screen.getByText('设置')).toBeInTheDocument();
  });

  it('面包屑显示分类(如"核心工具")', () => {
    renderHeader({ initialPath: '/analyze' });
    expect(screen.getByText('核心工具')).toBeInTheDocument();
  });
});

describe('Header 命令面板开关', () => {
  it('点击全局搜索按钮打开命令面板', () => {
    renderHeader();
    fireEvent.click(screen.getByText('搜索功能、作品、风格…'));
    // 命令面板出现(底部提示文字)
    expect(screen.getByText('DQ AI · 命令面板')).toBeInTheDocument();
  });

  it('Ctrl+K 打开命令面板', () => {
    renderHeader();
    act(() => {
      fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    });
    expect(screen.getByText('DQ AI · 命令面板')).toBeInTheDocument();
  });

  it('Cmd+K 打开命令面板(macOS 语义)', () => {
    renderHeader();
    act(() => {
      fireEvent.keyDown(window, { key: 'k', metaKey: true });
    });
    expect(screen.getByText('DQ AI · 命令面板')).toBeInTheDocument();
  });

  it('Esc 关闭命令面板', () => {
    renderHeader();
    // 打开
    fireEvent.click(screen.getByText('搜索功能、作品、风格…'));
    expect(screen.getByText('DQ AI · 命令面板')).toBeInTheDocument();
    // Esc 关闭(命令面板内的 ESC 按钮/键盘事件)
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(screen.queryByText('DQ AI · 命令面板')).not.toBeInTheDocument();
  });

  it('点击遮罩层关闭命令面板', () => {
    renderHeader();
    fireEvent.click(screen.getByText('搜索功能、作品、风格…'));
    // 遮罩层是 cmd-overlay
    const overlay = document.querySelector('.cmd-overlay') as HTMLElement;
    expect(overlay).toBeInTheDocument();
    fireEvent.click(overlay);
    expect(screen.queryByText('DQ AI · 命令面板')).not.toBeInTheDocument();
  });
});

describe('Header 通知面板开关', () => {
  it('点击铃铛按钮打开通知面板(显示"通知"标题)', () => {
    renderHeader();
    const bell = screen.getByTitle('通知');
    fireEvent.click(bell);
    // 通知面板头部
    expect(screen.getAllByText('通知').length).toBeGreaterThan(0);
  });

  it('未登录时通知面板显示 mock 通知(作品分析完成)', () => {
    renderHeader();
    fireEvent.click(screen.getByTitle('通知'));
    expect(screen.getByText('作品分析完成')).toBeInTheDocument();
  });

  it('再次点击铃铛关闭通知面板', () => {
    renderHeader();
    const bell = screen.getByTitle('通知');
    fireEvent.click(bell);
    expect(screen.getByText('全部已读')).toBeInTheDocument();
    fireEvent.click(bell);
    expect(screen.queryByText('全部已读')).not.toBeInTheDocument();
  });
});

describe('Header 未读数量徽章', () => {
  it('已登录 + unreadCount>0 时显示数字徽章', async () => {
    mockUseAuth.mockReturnValue(createAuthenticatedTeacherValue());
    getUnreadNotificationCount.mockResolvedValue({ count: 5 });
    renderHeader();
    // 等待轮询拉取未读数
    await screen.findByText('5');
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('unreadCount=0 时不显示徽章', async () => {
    mockUseAuth.mockReturnValue(createAuthenticatedTeacherValue());
    getUnreadNotificationCount.mockResolvedValue({ count: 0 });
    renderHeader();
    // 无数字徽章(铃铛内无 cinnabar 圆点数字)
    const bell = screen.getByTitle('通知');
    // 等待异步拉取完成
    await vi.waitFor(() => {
      expect(getUnreadNotificationCount).toHaveBeenCalled();
    });
    // 铃铛内不应有数字
    expect(bell.querySelector('span')).toBeNull();
  });
});
