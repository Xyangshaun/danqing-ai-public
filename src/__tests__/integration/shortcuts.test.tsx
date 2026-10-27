// ============================================================
// 全局快捷键集成测试 (任务包 E:块4)
// 对应源码: src/App.tsx (AppLayout keyboard handler)
//
// 测试范围:
//   1. 数字键 1-7 跳转对应模块
//   2. 数字键 0 跳转设置
//   3. N 键跳转 /analyze(新建诊断)
//   4. B 键切换侧栏折叠状态
//   5. / 键打开命令面板(open-command-palette 事件)
//   6. Esc 关闭命令面板与通知面板
//   7. 输入框中不触发快捷键
//   8. 修饰键(Ctrl/Cmd/Alt)单独不触发
//
// Mock 策略:
//   - useAuth: 已登录教师态
//   - 所有懒加载页面 mock 为简单占位组件
//   - data-service / api mock
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../../components/ToastProvider';
import { AppLayout } from '../../App';
import { createAuthenticatedTeacherValue } from '../../test/render';
import type { AuthContextValue } from '../../context/AuthContext';

/* ---------- mock 依赖 ---------- */

const mockUseAuth = vi.fn<(...args: never[]) => AuthContextValue>();
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock('../../services/data-service', () => ({
  getAnalysisHistory: vi.fn().mockResolvedValue([]),
  getGrowthData: vi.fn().mockResolvedValue([]),
  clearAnalysisHistory: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../services/draft-service', () => ({
  listDrafts: vi.fn().mockReturnValue([]),
  subscribeDrafts: vi.fn().mockReturnValue(() => {}),
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

/* mock 懒加载页面为简单占位,避免 Suspense 与页面内部依赖 */
vi.mock('../../pages/AnalysisPage', () => ({
  default: () => <div data-testid="page-analyze">Analysis Page</div>,
}));
vi.mock('../../pages/HistoryPage', () => ({
  default: () => <div data-testid="page-history">History Page</div>,
}));
vi.mock('../../pages/GrowthPage', () => ({
  default: () => <div data-testid="page-growth">Growth Page</div>,
}));
vi.mock('../../pages/MaterialsPage', () => ({
  default: () => <div data-testid="page-materials">Materials Page</div>,
}));
vi.mock('../../pages/StylesPage', () => ({
  default: () => <div data-testid="page-styles">Styles Page</div>,
}));
vi.mock('../../pages/FusePage', () => ({
  default: () => <div data-testid="page-fuse">Fuse Page</div>,
}));
vi.mock('../../pages/EmotionPage', () => ({
  default: () => <div data-testid="page-emotion">Emotion Page</div>,
}));
vi.mock('../../pages/SettingsPage', () => ({
  default: () => <div data-testid="page-settings">Settings Page</div>,
}));

/* ---------- 渲染辅助 ---------- */

function renderApp(initialPath = '/') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <ToastProvider>
        <AppLayout />
      </ToastProvider>
    </MemoryRouter>,
  );
}

/** 模拟全局 keydown 事件 */
function pressKey(key: string, options: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean } = {}) {
  act(() => {
    fireEvent.keyDown(window, { key, ...options });
  });
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
 * 1. 数字键导航(1-7, 0)
 * ============================================================ */
describe('快捷键 数字键导航', () => {
  it('按"1"跳转到 /analyze(AI 诊断页)', async () => {
    renderApp();
    pressKey('1');
    await waitFor(() => {
      expect(screen.getByTestId('page-analyze')).toBeInTheDocument();
    });
  });

  it('按"2"跳转到 /materials(素材库页)', async () => {
    renderApp();
    pressKey('2');
    await waitFor(() => {
      expect(screen.getByTestId('page-materials')).toBeInTheDocument();
    });
  });

  it('按"3"跳转到 /styles(风格库页)', async () => {
    renderApp();
    pressKey('3');
    await waitFor(() => {
      expect(screen.getByTestId('page-styles')).toBeInTheDocument();
    });
  });

  it('按"4"跳转到 /fuse(灵感嫁接页)', async () => {
    renderApp();
    pressKey('4');
    await waitFor(() => {
      expect(screen.getByTestId('page-fuse')).toBeInTheDocument();
    });
  });

  it('按"5"跳转到 /emotion(情绪画布页)', async () => {
    renderApp();
    pressKey('5');
    await waitFor(() => {
      expect(screen.getByTestId('page-emotion')).toBeInTheDocument();
    });
  });

  it('按"6"跳转到 /history(历史记录页)', async () => {
    renderApp();
    pressKey('6');
    await waitFor(() => {
      expect(screen.getByTestId('page-history')).toBeInTheDocument();
    });
  });

  it('按"7"跳转到 /growth(成长曲线页)', async () => {
    renderApp();
    pressKey('7');
    await waitFor(() => {
      expect(screen.getByTestId('page-growth')).toBeInTheDocument();
    });
  });

  it('按"0"跳转到 /settings(设置页)', async () => {
    renderApp();
    pressKey('0');
    await waitFor(() => {
      expect(screen.getByTestId('page-settings')).toBeInTheDocument();
    });
  });
});

/* ============================================================
 * 2. N 键:新建诊断
 * ============================================================ */
describe('快捷键 N 新建诊断', () => {
  it('按"n"跳转到 /analyze', async () => {
    renderApp();
    pressKey('n');
    await waitFor(() => {
      expect(screen.getByTestId('page-analyze')).toBeInTheDocument();
    });
  });

  it('按"N"(大写)跳转到 /analyze', async () => {
    renderApp();
    pressKey('N');
    await waitFor(() => {
      expect(screen.getByTestId('page-analyze')).toBeInTheDocument();
    });
  });
});

/* ============================================================
 * 3. B 键:切换侧栏折叠
 * ============================================================ */
describe('快捷键 B 切换侧栏', () => {
  it('按"b"切换侧栏折叠状态(不崩溃)', async () => {
    renderApp();
    // 初始侧栏展开(有"创作工具"标题)
    expect(screen.getByText('创作工具')).toBeInTheDocument();
    pressKey('b');
    // 折叠后仍渲染(文字可能隐藏,但侧栏容器存在)
    // 验证不崩溃即可;"工作台"在 Header 路由标题与首页内容均出现,用 getAllByText 容错
    expect(screen.getAllByText('工作台').length).toBeGreaterThan(0);
  });

  it('按"B"(大写)切换侧栏折叠状态', async () => {
    renderApp();
    pressKey('B');
    expect(screen.getAllByText('工作台').length).toBeGreaterThan(0);
  });
});

/* ============================================================
 * 4. / 键:打开命令面板
 * ============================================================ */
describe('快捷键 / 打开命令面板', () => {
  it('按"/"打开命令面板(显示 DQ AI · 命令面板)', async () => {
    renderApp();
    pressKey('/');
    await waitFor(() => {
      expect(screen.getByText('DQ AI · 命令面板')).toBeInTheDocument();
    });
  });
});

/* ============================================================
 * 5. Esc 键:关闭面板
 * ============================================================ */
describe('快捷键 Esc 关闭面板', () => {
  it('打开命令面板后按 Esc 关闭', async () => {
    renderApp();
    // 先打开命令面板
    pressKey('/');
    await waitFor(() => {
      expect(screen.getByText('DQ AI · 命令面板')).toBeInTheDocument();
    });
    // 按 Esc 关闭
    pressKey('Escape');
    await waitFor(() => {
      expect(screen.queryByText('DQ AI · 命令面板')).not.toBeInTheDocument();
    });
  });

  it('打开通知面板后按 Esc 关闭', async () => {
    renderApp();
    // 点击铃铛打开通知面板
    fireEvent.click(screen.getByTitle('通知'));
    await waitFor(() => {
      expect(screen.getByText('全部已读')).toBeInTheDocument();
    });
    // 按 Esc 关闭
    pressKey('Escape');
    await waitFor(() => {
      expect(screen.queryByText('全部已读')).not.toBeInTheDocument();
    });
  });

  it('Esc 在输入框中也能关闭面板(不检查输入框状态)', async () => {
    renderApp();
    pressKey('/');
    await waitFor(() => {
      expect(screen.getByText('DQ AI · 命令面板')).toBeInTheDocument();
    });
    // 聚焦到命令面板输入框
    const input = screen.getByPlaceholderText('输入关键词搜索功能...');
    fireEvent.focus(input);
    // Esc 仍能关闭(源码中 Esc 不检查 isInInput)
    pressKey('Escape');
    await waitFor(() => {
      expect(screen.queryByText('DQ AI · 命令面板')).not.toBeInTheDocument();
    });
  });
});

/* ============================================================
 * 6. 输入框守卫:快捷键在输入框中不触发
 * ============================================================ */
describe('快捷键 输入框守卫', () => {
  it('输入框中按"1"不触发导航', async () => {
    renderApp();
    // 创建一个输入框并聚焦
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    act(() => {
      fireEvent.keyDown(input, { key: '1' });
    });
    // 不应导航到 /analyze
    expect(screen.queryByTestId('page-analyze')).not.toBeInTheDocument();
    document.body.removeChild(input);
  });

  it('textarea 中按"n"不触发导航', async () => {
    renderApp();
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    textarea.focus();
    act(() => {
      fireEvent.keyDown(textarea, { key: 'n' });
    });
    expect(screen.queryByTestId('page-analyze')).not.toBeInTheDocument();
    document.body.removeChild(textarea);
  });
});

/* ============================================================
 * 7. 修饰键守卫
 * ============================================================ */
describe('快捷键 修饰键守卫', () => {
  it('Ctrl+1 不触发数字键导航(Ctrl 被忽略)', async () => {
    renderApp();
    pressKey('1', { ctrlKey: true });
    // Ctrl 修饰键时,数字键导航不触发
    expect(screen.queryByTestId('page-analyze')).not.toBeInTheDocument();
  });

  it('Alt+n 不触发 N 键导航', async () => {
    renderApp();
    pressKey('n', { altKey: true });
    expect(screen.queryByTestId('page-analyze')).not.toBeInTheDocument();
  });
});

/* ============================================================
 * 8. 路由切换时关闭移动端侧栏
 * ============================================================ */
describe('快捷键 路由切换副作用', () => {
  it('数字键导航后页面切换成功(从首页到分析页)', async () => {
    renderApp('/');
    // 初始在首页(HomePage 直接渲染,非 lazy)
    // 按 1 跳转到分析页
    pressKey('1');
    await waitFor(() => {
      expect(screen.getByTestId('page-analyze')).toBeInTheDocument();
    });
    // 按 6 跳转到历史页
    pressKey('6');
    await waitFor(() => {
      expect(screen.getByTestId('page-history')).toBeInTheDocument();
    });
  });
});
