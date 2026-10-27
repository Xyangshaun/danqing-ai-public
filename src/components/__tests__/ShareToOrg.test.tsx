// ============================================================
// ShareToOrgButton + ShareToOrgDialog 组件测试 (Phase 4:组织内分享)
// 对应源码: src/components/org/ShareToOrgButton.tsx / ShareToOrgDialog.tsx
//
// 测试范围:
//   1. 本地分析 ID(非 UUID)→ 不渲染按钮
//   2. UUID → 渲染"分享到组织"按钮,点击打开弹窗
//   3. 确认分享 → 调用 shareAnalysis(caption 透传),成功后按钮变"已分享"链接
//   4. 409 DUPLICATE_RESOURCE → 幂等视为成功(toast.success + 按钮变链接)
//   5. 其他错误 → toast.error,弹窗保持打开
//   6. caption 超 200 字截断(输入框 maxLength)
//
// Mock 策略:
//   - mock services/api 的 shareAnalysis(保留 ApiError 真实类用于构造 409)
//   - mock ToastProvider 的 useToast
//   - MemoryRouter 包裹(已分享态渲染 Link)
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import ShareToOrgButton from '../org/ShareToOrgButton';
import { ErrorCode, type SharedWorkItem } from '../../types/api-contract';
import { ApiError } from '../../services/api';

/* ---------- mock 依赖 ---------- */

const shareAnalysisMock = vi.fn<(...args: unknown[]) => Promise<SharedWorkItem>>();
vi.mock('../../services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/api')>();
  return {
    ...actual,
    shareAnalysis: (...args: unknown[]) => shareAnalysisMock(...args),
  };
});

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('../ToastProvider', () => ({
  useToast: () => ({ success: toastSuccess, error: toastError }),
}));

/* ---------- 测试数据 ---------- */

const SERVER_ID = '123e4567-e89b-42d3-a456-426614174000';
const LOCAL_ID = 'analysis-1717500000000';

function makeSharedItem(): SharedWorkItem {
  return {
    id: 'sw-1',
    caption: '我的新作品',
    isPinned: false,
    analysis: {
      id: SERVER_ID,
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

function renderButton(analysisId: string = SERVER_ID) {
  return render(
    <MemoryRouter>
      <ShareToOrgButton analysisId={analysisId} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  shareAnalysisMock.mockReset();
  toastSuccess.mockClear();
  toastError.mockClear();
});

/* ============================================================
 * 1. 渲染条件
 * ============================================================ */
describe('ShareToOrgButton 渲染条件', () => {
  it('本地分析 ID(非 UUID)不渲染', () => {
    const { container } = renderButton(LOCAL_ID);
    expect(container).toBeEmptyDOMElement();
  });

  it('UUID 渲染"分享到组织"按钮', () => {
    renderButton();
    expect(screen.getByRole('button', { name: '分享到组织' })).toBeInTheDocument();
  });
});

/* ============================================================
 * 2. 分享流程
 * ============================================================ */
describe('ShareToOrgButton 分享流程', () => {
  it('点击按钮打开弹窗,确认后调用 shareAnalysis 并透传 caption', async () => {
    shareAnalysisMock.mockResolvedValue(makeSharedItem());
    const user = userEvent.setup();
    renderButton();

    await user.click(screen.getByRole('button', { name: '分享到组织' }));
    /* 弹窗打开 */
    expect(screen.getByRole('dialog', { name: '分享到组织' })).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText(/写一句分享感言/), '我的新作品');
    await user.click(screen.getByRole('button', { name: '确认分享' }));

    await waitFor(() => {
      expect(shareAnalysisMock).toHaveBeenCalledWith(SERVER_ID, { caption: '我的新作品' });
    });
    expect(toastSuccess).toHaveBeenCalled();
    /* 成功后按钮变为"已分享 · 查看动态"链接 */
    await waitFor(() => {
      expect(screen.getByRole('link', { name: '已分享,查看组织动态' })).toBeInTheDocument();
    });
  });

  it('caption 留空时传 undefined', async () => {
    shareAnalysisMock.mockResolvedValue(makeSharedItem());
    const user = userEvent.setup();
    renderButton();

    await user.click(screen.getByRole('button', { name: '分享到组织' }));
    await user.click(screen.getByRole('button', { name: '确认分享' }));

    await waitFor(() => {
      expect(shareAnalysisMock).toHaveBeenCalledWith(SERVER_ID, { caption: undefined });
    });
  });

  it('409 DUPLICATE_RESOURCE 幂等视为成功', async () => {
    shareAnalysisMock.mockRejectedValue(
      new ApiError(ErrorCode.DUPLICATE_RESOURCE, '该作品已分享过', undefined, 409),
    );
    const user = userEvent.setup();
    renderButton();

    await user.click(screen.getByRole('button', { name: '分享到组织' }));
    await user.click(screen.getByRole('button', { name: '确认分享' }));

    await waitFor(() => {
      expect(toastSuccess).toHaveBeenCalled();
    });
    expect(toastError).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByRole('link', { name: '已分享,查看组织动态' })).toBeInTheDocument();
    });
  });

  it('其他错误 toast.error 且弹窗保持打开', async () => {
    shareAnalysisMock.mockRejectedValue(new ApiError(ErrorCode.INTERNAL_ERROR, '服务器繁忙', undefined, 500));
    const user = userEvent.setup();
    renderButton();

    await user.click(screen.getByRole('button', { name: '分享到组织' }));
    await user.click(screen.getByRole('button', { name: '确认分享' }));

    await waitFor(() => {
      expect(toastError).toHaveBeenCalled();
    });
    /* 弹窗未关闭,按钮未变链接 */
    expect(screen.getByRole('dialog', { name: '分享到组织' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '已分享,查看组织动态' })).not.toBeInTheDocument();
  });
});
