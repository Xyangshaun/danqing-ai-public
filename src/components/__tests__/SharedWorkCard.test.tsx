// ============================================================
// SharedWorkCard 组件测试 (Phase 4:组织动态流)
// 对应源码: src/components/org/SharedWorkCard.tsx
//
// 测试范围:
//   1. 渲染分享者/分数/caption/类型标签
//   2. 展开评论区 → 拉取完整评论列表
//   3. 发表评论 → 追加到列表并清空输入框
//   4. 学生视角不显示置顶按钮;教师视角显示置顶按钮
//   5. 教师删除他人分享 → 调 deleteSharedWork 并通知父级
//
// Mock 策略:
//   - mock services/api 的分享相关函数
//   - mock useAuth(学生/教师两种身份)
//   - SmartImage 替换为轻量 stub
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import SharedWorkCard from '../org/SharedWorkCard';
import type { SharedWorkItem, ShareCommentItem } from '../../types/api-contract';

/* ---------- mock 依赖 ---------- */

const listShareCommentsMock = vi.fn<(...args: unknown[]) => Promise<ShareCommentItem[]>>();
const createShareCommentMock = vi.fn<(...args: unknown[]) => Promise<ShareCommentItem>>();
const deleteSharedWorkMock = vi.fn<(...args: unknown[]) => Promise<void>>();
const pinSharedWorkMock = vi.fn();
const unpinSharedWorkMock = vi.fn();
const deleteShareCommentMock = vi.fn();

vi.mock('../../services/api', () => ({
  listShareComments: (...args: unknown[]) => listShareCommentsMock(...args),
  createShareComment: (...args: unknown[]) => createShareCommentMock(...args),
  deleteSharedWork: (...args: unknown[]) => deleteSharedWorkMock(...args),
  pinSharedWork: (...args: unknown[]) => pinSharedWorkMock(...args),
  unpinSharedWork: (...args: unknown[]) => unpinSharedWorkMock(...args),
  deleteShareComment: (...args: unknown[]) => deleteShareCommentMock(...args),
  ApiError: class ApiError extends Error {
    code: number;
    constructor(code: number, message: string) {
      super(message);
      this.code = code;
    }
  },
}));

/* 当前身份(测试间切换) */
let currentRole: 'student' | 'teacher' = 'student';
let currentUserId = 'u-other';
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: currentUserId, role: currentRole } }),
}));

vi.mock('../ToastProvider', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

vi.mock('../SmartImage', () => ({
  default: ({ alt }: { alt?: string }) => <div data-testid="smart-image">{alt}</div>,
}));

/* window.confirm 默认确认 */
vi.stubGlobal('confirm', vi.fn(() => true));

/* ---------- 测试数据工厂 ---------- */

function makeItem(overrides: Partial<SharedWorkItem> = {}): SharedWorkItem {
  return {
    id: 'sw-1',
    caption: '请大家指点一下构图',
    isPinned: false,
    analysis: {
      id: 'a-1',
      workType: 'painting',
      imageUrl: 'https://example.com/work.png',
      title: null,
      overallScore: 85,
      status: 'succeeded',
      createdAt: '2026-08-01T00:00:00.000Z',
    },
    user: { id: 'u-1', name: '小明', avatar: '', role: 'student' },
    commentCount: 1,
    recentComments: [
      {
        id: 'c-1',
        sharedWorkId: 'sw-1',
        content: '构图很稳!',
        user: { id: 'u-2', name: '老师', avatar: '', role: 'teacher' },
        createdAt: '2026-08-09T01:00:00.000Z',
      },
    ],
    createdAt: '2026-08-09T00:00:00.000Z',
    updatedAt: '2026-08-09T00:00:00.000Z',
    ...overrides,
  };
}

function renderCard(item: SharedWorkItem = makeItem(), onChanged: () => void = vi.fn()) {
  return {
    onChanged,
    ...render(
      <MemoryRouter>
        <SharedWorkCard item={item} onChanged={onChanged} />
      </MemoryRouter>,
    ),
  };
}

beforeEach(() => {
  listShareCommentsMock.mockReset();
  createShareCommentMock.mockReset();
  deleteSharedWorkMock.mockReset();
  currentRole = 'student';
  currentUserId = 'u-other';
});

/* ============================================================
 * 1. 基础渲染
 * ============================================================ */
describe('SharedWorkCard 基础渲染', () => {
  it('渲染分享者/分数/caption/类型标签', () => {
    renderCard();
    expect(screen.getByText('小明')).toBeInTheDocument();
    expect(screen.getByText('85')).toBeInTheDocument();
    expect(screen.getByText('请大家指点一下构图')).toBeInTheDocument();
    expect(screen.getByText('绘画')).toBeInTheDocument();
  });

  it('置顶作品显示"置顶"徽章', () => {
    renderCard(makeItem({ isPinned: true }));
    expect(screen.getByText('置顶')).toBeInTheDocument();
  });
});

/* ============================================================
 * 2. 评论交互
 * ============================================================ */
describe('SharedWorkCard 评论交互', () => {
  it('展开评论区拉取完整评论列表', async () => {
    listShareCommentsMock.mockResolvedValue(makeItem().recentComments);
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole('button', { name: /评论\(1\)/ }));
    await waitFor(() => {
      expect(listShareCommentsMock).toHaveBeenCalledWith('sw-1');
    });
    expect(screen.getByText('构图很稳!')).toBeInTheDocument();
  });

  it('发表评论后追加到列表并清空输入框', async () => {
    listShareCommentsMock.mockResolvedValue([]);
    createShareCommentMock.mockResolvedValue({
      id: 'c-2',
      sharedWorkId: 'sw-1',
      content: '色彩再暖一点会更好',
      user: { id: 'u-other', name: '同学', avatar: '', role: 'student' },
      createdAt: '2026-08-09T02:00:00.000Z',
    });
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole('button', { name: /评论\(1\)/ }));
    const input = await screen.findByPlaceholderText('写下你的点评…');
    await user.type(input, '色彩再暖一点会更好');
    await user.click(screen.getByRole('button', { name: '发送评论' }));

    await waitFor(() => {
      expect(createShareCommentMock).toHaveBeenCalledWith('sw-1', { content: '色彩再暖一点会更好' });
    });
    expect(screen.getByText('色彩再暖一点会更好')).toBeInTheDocument();
    expect((input as HTMLInputElement).value).toBe('');
  });
});

/* ============================================================
 * 3. 权限控制
 * ============================================================ */
describe('SharedWorkCard 权限控制', () => {
  it('学生视角不显示置顶按钮', () => {
    renderCard();
    expect(screen.queryByRole('button', { name: '置顶' })).not.toBeInTheDocument();
  });

  it('教师视角显示置顶按钮,点击调 pinSharedWork', async () => {
    currentRole = 'teacher';
    pinSharedWorkMock.mockResolvedValue({ id: 'sw-1', isPinned: true });
    const onChanged = vi.fn();
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <SharedWorkCard item={makeItem()} onChanged={onChanged} />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: '置顶' }));
    await waitFor(() => {
      expect(pinSharedWorkMock).toHaveBeenCalledWith('sw-1');
    });
    expect(onChanged).toHaveBeenCalled();
  });

  it('教师删除他人分享调 deleteSharedWork 并通知父级', async () => {
    currentRole = 'teacher';
    deleteSharedWorkMock.mockResolvedValue(undefined);
    const onChanged = vi.fn();
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <SharedWorkCard item={makeItem()} onChanged={onChanged} />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: '删除分享' }));
    await waitFor(() => {
      expect(deleteSharedWorkMock).toHaveBeenCalledWith('sw-1');
    });
    expect(onChanged).toHaveBeenCalled();
  });

  it('学生视角对他人分享不显示删除按钮', () => {
    /* currentUserId = u-other ≠ 分享者 u-1,且非教师 */
    renderCard();
    expect(screen.queryByRole('button', { name: '删除分享' })).not.toBeInTheDocument();
  });
});
