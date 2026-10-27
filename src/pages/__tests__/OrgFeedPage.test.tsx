// ============================================================
// OrgFeedPage 页面测试 (Phase 4:组织动态流)
// 对应源码: src/pages/OrgFeedPage.tsx
//
// 测试范围:
//   1. 加载中 → 显示加载提示
//   2. 有数据 → 渲染组织名/总数/卡片列表
//   3. 空态 → "还没有分享"引导文案
//   4. 接口失败 → 错误文案 + 重试按钮
//   5. 切换类型筛选 → 重新请求并透传 workType
//   6. hasMore=true → 显示"加载更多",点击后追加下一页
//
// Mock 策略:
//   - mock services/api 的 listOrgFeed
//   - mock useAuth(提供 tenant)
//   - SharedWorkCard 替换为轻量 stub(其自身行为单独测试)
//   - jsdom 无 IntersectionObserver,stub 为空实现
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import OrgFeedPage from '../OrgFeedPage';
import type { ListOrgFeedResponse, SharedWorkItem } from '../../types/api-contract';

/* ---------- mock 依赖 ---------- */

const listOrgFeedMock = vi.fn<(...args: unknown[]) => Promise<ListOrgFeedResponse>>();
vi.mock('../../services/api', () => ({
  listOrgFeed: (...args: unknown[]) => listOrgFeedMock(...args),
  ApiError: class ApiError extends Error {
    code: number;
    constructor(code: number, message: string) {
      super(message);
      this.code = code;
    }
  },
}));

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({
    tenant: { id: 't-1', name: '丹青画室' },
    user: { id: 'u-1', role: 'student' },
  }),
}));

const toastError = vi.fn();
vi.mock('../../components/ToastProvider', () => ({
  useToast: () => ({ success: vi.fn(), error: toastError }),
}));

vi.mock('../../components/org/SharedWorkCard', () => ({
  default: ({ item }: { item: SharedWorkItem }) => <div data-testid="work-card">{item.id}</div>,
}));

/* jsdom 无 IntersectionObserver,stub 空实现(不触发自动加载) */
class StubIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('IntersectionObserver', StubIntersectionObserver);

/* ---------- 测试数据工厂 ---------- */

function makeItem(id: string): SharedWorkItem {
  return {
    id,
    caption: null,
    isPinned: false,
    analysis: {
      id: `a-${id}`,
      workType: 'painting',
      imageUrl: 'https://example.com/work.png',
      title: null,
      overallScore: 85,
      status: 'succeeded',
      createdAt: '2026-08-01T00:00:00.000Z',
    },
    user: { id: 'u-1', name: '小明', avatar: '', role: 'student' },
    commentCount: 0,
    recentComments: [],
    createdAt: '2026-08-09T00:00:00.000Z',
    updatedAt: '2026-08-09T00:00:00.000Z',
  };
}

function makeFeed(items: SharedWorkItem[], overrides: Partial<ListOrgFeedResponse> = {}): ListOrgFeedResponse {
  return {
    items,
    total: items.length,
    page: 1,
    pageSize: 10,
    hasMore: false,
    ...overrides,
  };
}

beforeEach(() => {
  listOrgFeedMock.mockReset();
  toastError.mockClear();
});

/* ============================================================
 * 1. 加载与渲染
 * ============================================================ */
describe('OrgFeedPage 加载与渲染', () => {
  it('加载中显示提示', () => {
    listOrgFeedMock.mockReturnValue(new Promise(() => {}));
    render(<OrgFeedPage />);
    expect(screen.getByText('正在加载组织动态…')).toBeInTheDocument();
  });

  it('有数据时渲染组织名/总数/卡片', async () => {
    listOrgFeedMock.mockResolvedValue(makeFeed([makeItem('sw-1'), makeItem('sw-2')], { total: 2 }));
    render(<OrgFeedPage />);

    await waitFor(() => {
      expect(screen.getAllByTestId('work-card')).toHaveLength(2);
    });
    expect(screen.getByText('丹青画室 · 动态')).toBeInTheDocument();
    expect(screen.getByText(/2 条分享/)).toBeInTheDocument();
  });

  it('空态显示引导文案', async () => {
    listOrgFeedMock.mockResolvedValue(makeFeed([]));
    render(<OrgFeedPage />);

    await waitFor(() => {
      expect(screen.getByText('还没有分享')).toBeInTheDocument();
    });
  });

  it('接口失败显示错误与重试按钮', async () => {
    listOrgFeedMock.mockRejectedValue(new Error('network'));
    render(<OrgFeedPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
    });
  });
});

/* ============================================================
 * 2. 筛选与分页
 * ============================================================ */
describe('OrgFeedPage 筛选与分页', () => {
  it('切换"绘画"筛选后携带 workType 重新请求', async () => {
    listOrgFeedMock.mockResolvedValue(makeFeed([makeItem('sw-1')]));
    const user = userEvent.setup();
    render(<OrgFeedPage />);

    await waitFor(() => {
      expect(listOrgFeedMock).toHaveBeenCalledWith({ page: 1, pageSize: 10, workType: undefined });
    });

    await user.click(screen.getByRole('button', { name: '绘画' }));
    await waitFor(() => {
      expect(listOrgFeedMock).toHaveBeenCalledWith({ page: 1, pageSize: 10, workType: 'painting' });
    });
  });

  it('hasMore=true 显示"加载更多",点击追加下一页', async () => {
    listOrgFeedMock
      .mockResolvedValueOnce(makeFeed([makeItem('sw-1')], { total: 2, hasMore: true }))
      .mockResolvedValueOnce(makeFeed([makeItem('sw-2')], { total: 2, page: 2 }));
    const user = userEvent.setup();
    render(<OrgFeedPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '加载更多' })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: '加载更多' }));
    await waitFor(() => {
      expect(listOrgFeedMock).toHaveBeenCalledWith({ page: 2, pageSize: 10, workType: undefined });
    });
    /* 追加渲染两条卡片 */
    await waitFor(() => {
      expect(screen.getAllByTestId('work-card')).toHaveLength(2);
    });
  });
});
