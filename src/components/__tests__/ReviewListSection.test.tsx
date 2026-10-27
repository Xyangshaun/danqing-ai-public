// ============================================================
// ReviewListSection 组件测试(反馈闭环 Phase 4 批次④)
// 对应源码: src/components/ReviewListSection.tsx
//
// 测试范围(ReviewRecord 展示断链修复):
//   1. 有评审 → 渲染评审人/总分/等级 chips/评语/时间
//   2. 等级 chips 计数(同等级多维合并 ×N)/ AI 评审标签
//   3. 空列表 → 不渲染(通知断链仅在有评审时修复)
//   4. 本地分析 ID(analysis-*)→ 不渲染且不调 API
//   5. 未登录 → 不渲染
//   6. 查询失败 → 静默降级不渲染
//
// Mock 策略:mock teacher-api.listReviews + useAuth(照 AnnotationWorkspace/
// OrgFeedPage 测试先例);组件无 Toast 依赖(纯展示)
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import ReviewListSection from '../ReviewListSection';
import type { ReviewRecordSummary } from '../../types/teacher';

/* ---------- mock 依赖 ---------- */

const listReviewsMock = vi.fn<(...args: unknown[]) => Promise<ReviewRecordSummary[]>>();
vi.mock('../../services/teacher-api', () => ({
  listReviews: (...args: unknown[]) => listReviewsMock(...args),
}));

let authUser: { id: string } | null = { id: 'u-student' };
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ tenant: { id: 't-a', name: '丹青画室' }, user: authUser }),
}));

/* ---------- 测试数据工厂 ---------- */

const SERVER_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

function makeReview(overrides: Partial<ReviewRecordSummary> = {}): ReviewRecordSummary {
  return {
    id: 'rev-1',
    reviewerId: 'u-teacher',
    reviewerName: '王老师',
    reviewerType: 'professor',
    presetId: null,
    scores: {
      dimensions: {
        composition: { score: 80, level: 'good' },
        color: { score: 70, level: 'qualified' },
      },
      overallScore: 78,
    },
    confidence: null,
    comment: '构图稳定,色彩略闷',
    status: 'submitted',
    createdAt: '2026-09-08T10:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  authUser = { id: 'u-student' };
});

/* ============================================================
 * 测试用例
 * ============================================================ */

describe('ReviewListSection(批次④:ReviewRecord 断链修复)', () => {
  it('有评审 → 渲染评审人/总分/等级 chips/评语/时间', async () => {
    listReviewsMock.mockResolvedValue([makeReview()]);
    render(<ReviewListSection analysisId={SERVER_ID} />);

    await waitFor(() => {
      expect(screen.getByText('评审记录')).toBeInTheDocument();
    });
    expect(listReviewsMock).toHaveBeenCalledWith(SERVER_ID);
    // 评审人 + 类型徽标
    expect(screen.getByText('王老师')).toBeInTheDocument();
    expect(screen.getByText('教授')).toBeInTheDocument();
    // 总分
    expect(screen.getByText('78')).toBeInTheDocument();
    // 等级 chips(良好/合格)
    expect(screen.getByText('良好')).toBeInTheDocument();
    expect(screen.getByText('合格')).toBeInTheDocument();
    // 评语
    expect(screen.getByText('构图稳定,色彩略闷')).toBeInTheDocument();
    // 计数副标题
    expect(screen.getByText('该作品收到的全部评审(共 1 条)')).toBeInTheDocument();
  });

  it('同等级多维合并计数(×N)+ AI 评审标签', async () => {
    listReviewsMock.mockResolvedValue([
      makeReview({
        id: 'rev-ai',
        reviewerId: null,
        reviewerName: null,
        reviewerType: 'ai',
        comment: null,
        scores: {
          dimensions: {
            composition: { score: 85, level: 'excellent' },
            color: { score: 82, level: 'excellent' },
            technique: { score: 70, level: 'good' },
          },
          overallScore: 82,
        },
      }),
    ]);
    render(<ReviewListSection analysisId={SERVER_ID} />);

    await waitFor(() => {
      expect(screen.getByText('评审记录')).toBeInTheDocument();
    });
    // AI 评审:reviewerName null → 类型标签兜底
    expect(screen.getAllByText('AI 评审').length).toBeGreaterThanOrEqual(2); // 名 + 徽标
    // excellent ×2 合并
    expect(screen.getByText('优秀 ×2')).toBeInTheDocument();
    expect(screen.getByText('良好')).toBeInTheDocument();
    // comment null 不渲染
    expect(screen.queryByText('null')).not.toBeInTheDocument();
  });

  it('空列表 → 不渲染(断链修复仅在有评审时可见)', async () => {
    listReviewsMock.mockResolvedValue([]);
    const { container } = render(<ReviewListSection analysisId={SERVER_ID} />);

    await waitFor(() => {
      expect(listReviewsMock).toHaveBeenCalled();
    });
    expect(container.firstChild).toBeNull();
    expect(screen.queryByText('评审记录')).not.toBeInTheDocument();
  });

  it('本地分析 ID(analysis-*)→ 不渲染且不调 API', () => {
    const { container } = render(<ReviewListSection analysisId="analysis-1757000000000" />);

    expect(container.firstChild).toBeNull();
    expect(listReviewsMock).not.toHaveBeenCalled();
  });

  it('未登录 → 不渲染且不调 API', () => {
    authUser = null;
    const { container } = render(<ReviewListSection analysisId={SERVER_ID} />);

    expect(container.firstChild).toBeNull();
    expect(listReviewsMock).not.toHaveBeenCalled();
  });

  it('查询失败 → 静默降级不渲染', async () => {
    listReviewsMock.mockRejectedValue(new Error('network'));
    const { container } = render(<ReviewListSection analysisId={SERVER_ID} />);

    await waitFor(() => {
      expect(listReviewsMock).toHaveBeenCalled();
    });
    // 等 microtask 中的 catch setState 完成
    await waitFor(() => {
      expect(container.firstChild).toBeNull();
    });
  });
});
