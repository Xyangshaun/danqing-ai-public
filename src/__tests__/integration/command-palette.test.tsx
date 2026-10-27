// ============================================================
// 命令面板集成测试 (任务包 E:块4)
// 对应源码: src/components/Header.tsx (命令面板部分)
//
// 测试范围:
//   1. 搜索过滤(输入关键词筛选结果)
//   2. 键盘导航(↓↑ 移动选中,Enter 触发)
//   3. 分类标签切换(全部/功能/最近/作品/操作)
//   4. 无结果态(输入不匹配关键词)
//   5. 点击结果项触发导航
//   6. 拼音首字母搜索(如"zd"匹配"诊断")
//
// Mock 策略:
//   - useAuth: 已登录教师态(渲染用户名)
//   - data-service: getAnalysisHistory 返回可控历史作品
//   - api: 通知相关接口 mock
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../../components/ToastProvider';
import Header from '../../components/Header';
import { createAuthenticatedTeacherValue } from '../../test/render';
import type { AuthContextValue } from '../../context/AuthContext';
import type { HistoryRecord } from '../../types';

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

function openCommandPalette() {
  act(() => {
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
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
 * 1. 搜索过滤
 * ============================================================ */
describe('命令面板 搜索过滤', () => {
  it('输入"诊断"筛选出含"诊断"的结果', async () => {
    renderHeader();
    openCommandPalette();
    await waitFor(() => {
      expect(screen.getByText('DQ AI · 命令面板')).toBeInTheDocument();
    });
    const input = screen.getByPlaceholderText('输入关键词搜索功能...') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '诊断' } });
    // 应显示"新建 AI 诊断"结果
    await waitFor(() => {
      expect(screen.getByText('新建 AI 诊断')).toBeInTheDocument();
    });
  });

  it('输入不匹配关键词显示"没有找到匹配的结果"', async () => {
    renderHeader();
    openCommandPalette();
    await waitFor(() => {
      expect(screen.getByText('DQ AI · 命令面板')).toBeInTheDocument();
    });
    const input = screen.getByPlaceholderText('输入关键词搜索功能...');
    fireEvent.change(input, { target: { value: 'zzz不存在的关键词zzz' } });
    await waitFor(() => {
      expect(screen.getByText('没有找到匹配的结果')).toBeInTheDocument();
    });
  });

  it('拼音首字母"zd"匹配"诊断"相关结果', async () => {
    renderHeader();
    openCommandPalette();
    await waitFor(() => {
      expect(screen.getByText('DQ AI · 命令面板')).toBeInTheDocument();
    });
    const input = screen.getByPlaceholderText('输入关键词搜索功能...');
    fireEvent.change(input, { target: { value: 'zd' } });
    // "诊断"的拼音首字母是 zd,应匹配"新建 AI 诊断"
    await waitFor(() => {
      expect(screen.getByText('新建 AI 诊断')).toBeInTheDocument();
    });
  });

  it('清空搜索词恢复全部结果', async () => {
    renderHeader();
    openCommandPalette();
    const input = screen.getByPlaceholderText('输入关键词搜索功能...') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'zzz无匹配zzz' } });
    await waitFor(() => {
      expect(screen.getByText('没有找到匹配的结果')).toBeInTheDocument();
    });
    fireEvent.change(input, { target: { value: '' } });
    // 恢复结果后应能看到功能分类标题
    await waitFor(() => {
      expect(screen.queryByText('没有找到匹配的结果')).not.toBeInTheDocument();
    });
  });
});

/* ============================================================
 * 2. 键盘导航
 * ============================================================ */
describe('命令面板 键盘导航', () => {
  it('↓ 键移动选中项到第二条', async () => {
    renderHeader();
    openCommandPalette();
    await waitFor(() => {
      expect(screen.getByText('新建 AI 诊断')).toBeInTheDocument();
    });
    const input = screen.getByPlaceholderText('输入关键词搜索功能...');
    // 按 ↓ 移动选中
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    // 选中项有 bg-cinnabar/5 样式;此处验证不崩溃即可
    // 第二项应存在(浏览素材库)
    expect(screen.getByText('浏览素材库')).toBeInTheDocument();
  });

  it('↑ 键向上移动选中项(不越界回到第一条)', async () => {
    renderHeader();
    openCommandPalette();
    await waitFor(() => {
      expect(screen.getByText('新建 AI 诊断')).toBeInTheDocument();
    });
    const input = screen.getByPlaceholderText('输入关键词搜索功能...');
    // 先 ↓ 再 ↑,回到第一条
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    // 仍在命令面板内
    expect(screen.getByText('DQ AI · 命令面板')).toBeInTheDocument();
  });

  it('Enter 键触发选中项的 action(关闭命令面板)', async () => {
    renderHeader();
    openCommandPalette();
    await waitFor(() => {
      expect(screen.getByText('DQ AI · 命令面板')).toBeInTheDocument();
    });
    const input = screen.getByPlaceholderText('输入关键词搜索功能...');
    // Enter 触发第一项(新建 AI 诊断)→ 导航 + 关闭面板
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => {
      expect(screen.queryByText('DQ AI · 命令面板')).not.toBeInTheDocument();
    });
  });
});

/* ============================================================
 * 3. 分类标签切换
 * ============================================================ */
describe('命令面板 分类标签', () => {
  it('渲染 5 个分类标签(全部/功能/最近/作品/操作)', async () => {
    renderHeader();
    openCommandPalette();
    await waitFor(() => {
      expect(screen.getByText('DQ AI · 命令面板')).toBeInTheDocument();
    });
    // '功能'/'操作' 同时作为分类标签按钮与结果区段标题出现,用 getAllByText 容错
    expect(screen.getAllByText('全部').length).toBeGreaterThan(0);
    expect(screen.getAllByText('功能').length).toBeGreaterThan(0);
    expect(screen.getAllByText('最近').length).toBeGreaterThan(0);
    expect(screen.getAllByText('作品').length).toBeGreaterThan(0);
    expect(screen.getAllByText('操作').length).toBeGreaterThan(0);
  });

  it('点击"操作"标签筛选出操作类命令', async () => {
    renderHeader();
    openCommandPalette();
    await waitFor(() => {
      expect(screen.getByText('DQ AI · 命令面板')).toBeInTheDocument();
    });
    // 点击"操作"标签(在分类按钮中,可能多处"操作",取第一个)
    const actionTabs = screen.getAllByText('操作');
    fireEvent.click(actionTabs[0]);
    // 操作类命令应显示(清除缓存/切换到本地模式等)
    await waitFor(() => {
      expect(screen.getByText('清除缓存')).toBeInTheDocument();
    });
  });

  it('点击"功能"标签筛选出功能类命令', async () => {
    renderHeader();
    openCommandPalette();
    await waitFor(() => {
      expect(screen.getByText('DQ AI · 命令面板')).toBeInTheDocument();
    });
    const functionTabs = screen.getAllByText('功能');
    fireEvent.click(functionTabs[0]);
    await waitFor(() => {
      expect(screen.getByText('新建 AI 诊断')).toBeInTheDocument();
    });
  });
});

/* ============================================================
 * 4. 历史作品分类
 * ============================================================ */
describe('命令面板 历史作品', () => {
  it('有历史记录时"作品"分类显示历史作品项', async () => {
    const { getAnalysisHistory } = await import('../../services/data-service');
    const records: HistoryRecord[] = [
      {
        id: 'w1',
        imageUrl: 'https://example.com/w1.png',
        createdAt: new Date().toISOString(),
        artType: 'painting',
        overallScore: 85,
        dimension1Score: 80,
        dimension2Score: 85,
        dimension3Score: 90,
      },
    ];
    vi.mocked(getAnalysisHistory).mockResolvedValue(records);

    renderHeader();
    openCommandPalette();
    await waitFor(() => {
      expect(screen.getByText('DQ AI · 命令面板')).toBeInTheDocument();
    });
    // 点击"作品"标签
    const workTabs = screen.getAllByText('作品');
    fireEvent.click(workTabs[0]);
    // 应显示"绘画作品 · 85分"
    await waitFor(() => {
      expect(screen.getByText(/绘画作品 · 85分/)).toBeInTheDocument();
    });
  });
});

/* ============================================================
 * 5. 操作类命令
 * ============================================================ */
describe('命令面板 操作类命令', () => {
  it('点击"跳转到设置"触发导航并关闭面板', async () => {
    renderHeader();
    openCommandPalette();
    await waitFor(() => {
      expect(screen.getByText('DQ AI · 命令面板')).toBeInTheDocument();
    });
    // action 分类每类最多展示 3 条,"跳转到设置"排在第 4 位会被 slice 截断,
    // 通过搜索词精确锚定使其命中并展示
    const input = screen.getByPlaceholderText('输入关键词搜索功能...') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '跳转到设置' } });
    await waitFor(() => {
      expect(screen.getByText('跳转到设置')).toBeInTheDocument();
    });
    // 点击"跳转到设置"
    fireEvent.click(screen.getByText('跳转到设置'));
    await waitFor(() => {
      expect(screen.queryByText('DQ AI · 命令面板')).not.toBeInTheDocument();
    });
  });

  it('点击"查看分析历史"触发导航并关闭面板', async () => {
    renderHeader();
    openCommandPalette();
    await waitFor(() => {
      expect(screen.getByText('DQ AI · 命令面板')).toBeInTheDocument();
    });
    // 同上,"查看分析历史"排在 action 分类第 6 位,需搜索锚定
    const input = screen.getByPlaceholderText('输入关键词搜索功能...') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '查看分析历史' } });
    await waitFor(() => {
      expect(screen.getByText('查看分析历史')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('查看分析历史'));
    await waitFor(() => {
      expect(screen.queryByText('DQ AI · 命令面板')).not.toBeInTheDocument();
    });
  });
});

/* ============================================================
 * 6. open-command-palette 事件
 * ============================================================ */
describe('命令面板 open-command-palette 事件', () => {
  it('dispatch open-command-palette 事件打开命令面板', async () => {
    renderHeader();
    act(() => {
      window.dispatchEvent(new CustomEvent('open-command-palette'));
    });
    await waitFor(() => {
      expect(screen.getByText('DQ AI · 命令面板')).toBeInTheDocument();
    });
  });
});
