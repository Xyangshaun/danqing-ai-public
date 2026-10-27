// ============================================================
// ReviewService 评委评审服务单元测试(Phase 5)
// 对应源码: src/services/review.service.ts
// 对应文档: new-features-design.md §1.6, §2.3, §3.2
//
// 测试范围:
//   1. createReview:分析不存在 / 评分合法性(overallScore/维度/AI 置信度)/ AI reviewerId 置 null / 成功
//   2. listReviews:分析不存在 / 成功(含 reviewerName 解析)
//   3. getReview:分析不存在 / 评审不存在 / analysisId 不匹配 / 成功
//   4. checkDispute:分析不存在 / 委托 arbitrationService
//
// Mock 策略:
//   - vi.mock + vi.hoisted 替换 reviewRepository / analysisRepository / userRepository / arbitrationService
//   - 纯单元测试,与 preset.service.test.ts 同风格
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { reviewService } from '../src/services/review.service.js';
import { BusinessError } from '../src/middlewares/error-handler.js';
import { ErrorCode } from '../src/types/api-contract.js';
import type { ReviewRecord, User, Analysis } from '@prisma/client';

// ============================================================
// vi.mock:替换依赖模块(vi.hoisted 保证工厂执行时引用已初始化)
// ============================================================

const { mockReviewRepo, mockAnalysisRepo, mockUserRepo, mockArbitration } = vi.hoisted(() => ({
  mockReviewRepo: {
    create: vi.fn(),
    findById: vi.fn(),
    findByAnalysis: vi.fn(),
    listSubmittedByAnalysis: vi.fn(),
    updateStatus: vi.fn(),
  },
  mockAnalysisRepo: {
    findById: vi.fn(),
  },
  mockUserRepo: {
    findById: vi.fn(),
  },
  mockArbitration: {
    checkDispute: vi.fn(),
  },
}));

vi.mock('../src/repositories/review.repository.js', () => ({
  ReviewRepository: class {},
  reviewRepository: mockReviewRepo,
}));

vi.mock('../src/repositories/analysis.repository.js', () => ({
  AnalysisRepository: class {},
  analysisRepository: mockAnalysisRepo,
}));

vi.mock('../src/repositories/user.repository.js', () => ({
  UserRepository: class {},
  userRepository: mockUserRepo,
}));

vi.mock('../src/services/arbitration.service.js', () => ({
  ArbitrationServiceClass: class {},
  arbitrationService: mockArbitration,
}));

// ============================================================
// 测试常量与工厂
// ============================================================

const TENANT_A = 't-review-a';
const USER_TEACHER = 'u-teacher-review';
const ANALYSIS_ID = 'a-review-0001';

/** 构造分析任务(成功状态) */
function makeAnalysis(overrides: Partial<Analysis> = {}): Analysis {
  return {
    id: ANALYSIS_ID,
    tenantId: TENANT_A,
    userId: 'u-student-0001',
    workType: 'painting',
    imageUrl: 'https://example.com/test.jpg',
    title: null,
    remark: null,
    status: 'success',
    result: null,
    failureReason: null,
    overallScore: null,
    durationMs: null,
    reviewStatus: null,
    reviewedBy: null,
    reviewedAt: null,
    reviewNote: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    completedAt: new Date('2026-01-01T00:00:01Z'),
    ...overrides,
  } as Analysis;
}

/** 构造评审记录 */
function makeReviewRecord(overrides: Partial<ReviewRecord> = {}): ReviewRecord {
  return {
    id: 'r-review-0001',
    analysisId: ANALYSIS_ID,
    reviewerId: USER_TEACHER,
    reviewerType: 'professor',
    presetId: null,
    scores: {
      dimensions: {
        composition: { score: 85, level: 'good' },
        color: { score: 80, level: 'good' },
        brushwork: { score: 90, level: 'excellent' },
      },
      overallScore: 85,
    },
    confidence: null,
    comment: '构图严谨,色彩协调',
    status: 'submitted',
    createdAt: new Date('2026-01-01T00:00:05Z'),
    ...overrides,
  } as ReviewRecord;
}

/** 构造用户(评审人) */
function makeReviewer(overrides: Partial<User> = {}): User {
  return {
    id: USER_TEACHER,
    tenantId: TENANT_A,
    feishuOpenId: 'ou_teacher',
    feishuUnionId: 'on_teacher',
    name: '张教授',
    avatar: '',
    email: null,
    phone: null,
    role: 'teacher',
    status: 'active',
    lockedAt: null,
    lockedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastLoginAt: null,
    ...overrides,
  } as unknown as User;
}

/** 标准绘画评分 payload */
const VALID_SCORES = {
  dimensions: {
    composition: { score: 85, level: 'good' as const },
    color: { score: 80, level: 'good' as const },
  },
  overallScore: 82,
};

// ============================================================
// 辅助:断言 BusinessError
// ============================================================

async function expectBusinessError(
  fn: () => Promise<unknown>,
  code: ErrorCode,
  httpStatus: number,
): Promise<void> {
  try {
    await fn();
    expect.fail(`expected BusinessError(code=${code}) but no error was thrown`);
  } catch (err) {
    expect(err).toBeInstanceOf(BusinessError);
    expect((err as BusinessError).code).toBe(code);
    expect((err as BusinessError).httpStatus).toBe(httpStatus);
  }
}

// ============================================================
// 测试组
// ============================================================

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ReviewService.createReview', () => {
  it('分析任务不存在 → ANALYSIS_NOT_FOUND 404', async () => {
    mockAnalysisRepo.findById.mockResolvedValue(null);

    await expectBusinessError(
      () =>
        reviewService.createReview(ANALYSIS_ID, TENANT_A, USER_TEACHER, {
          reviewerType: 'professor',
          scores: VALID_SCORES,
        }),
      ErrorCode.ANALYSIS_NOT_FOUND,
      404,
    );
    expect(mockReviewRepo.create).not.toHaveBeenCalled();
  });

  it('跨租户分析任务拒绝( findById 返回 null) → ANALYSIS_NOT_FOUND 404', async () => {
    // analysisRepository.findById 内部已带 tenantId 过滤,跨租户返回 null
    mockAnalysisRepo.findById.mockResolvedValue(null);

    await expectBusinessError(
      () =>
        reviewService.createReview(ANALYSIS_ID, 't-other-tenant', USER_TEACHER, {
          reviewerType: 'professor',
          scores: VALID_SCORES,
        }),
      ErrorCode.ANALYSIS_NOT_FOUND,
      404,
    );
  });

  it('overallScore 越界(>100) → PARAM_INVALID 400', async () => {
    mockAnalysisRepo.findById.mockResolvedValue(makeAnalysis());

    await expectBusinessError(
      () =>
        reviewService.createReview(ANALYSIS_ID, TENANT_A, USER_TEACHER, {
          reviewerType: 'professor',
          scores: { ...VALID_SCORES, overallScore: 150 },
        }),
      ErrorCode.PARAM_INVALID,
      400,
    );
  });

  it('维度评分为空 → PARAM_INVALID 400', async () => {
    mockAnalysisRepo.findById.mockResolvedValue(makeAnalysis());

    await expectBusinessError(
      () =>
        reviewService.createReview(ANALYSIS_ID, TENANT_A, USER_TEACHER, {
          reviewerType: 'professor',
          scores: { dimensions: {}, overallScore: 80 },
        }),
      ErrorCode.PARAM_INVALID,
      400,
    );
  });

  it('维度分数越界(<0) → PARAM_INVALID 400', async () => {
    mockAnalysisRepo.findById.mockResolvedValue(makeAnalysis());

    await expectBusinessError(
      () =>
        reviewService.createReview(ANALYSIS_ID, TENANT_A, USER_TEACHER, {
          reviewerType: 'professor',
          scores: {
            dimensions: { composition: { score: -5, level: 'good' } },
            overallScore: 80,
          },
        }),
      ErrorCode.PARAM_INVALID,
      400,
    );
  });

  it('AI 评审缺少 confidence → PARAM_INVALID 400', async () => {
    mockAnalysisRepo.findById.mockResolvedValue(makeAnalysis());

    await expectBusinessError(
      () =>
        reviewService.createReview(ANALYSIS_ID, TENANT_A, USER_TEACHER, {
          reviewerType: 'ai',
          scores: VALID_SCORES,
        }),
      ErrorCode.PARAM_INVALID,
      400,
    );
  });

  it('AI 评审 confidence 越界(>1) → PARAM_INVALID 400', async () => {
    mockAnalysisRepo.findById.mockResolvedValue(makeAnalysis());

    await expectBusinessError(
      () =>
        reviewService.createReview(ANALYSIS_ID, TENANT_A, USER_TEACHER, {
          reviewerType: 'ai',
          scores: VALID_SCORES,
          confidence: 1.5,
        }),
      ErrorCode.PARAM_INVALID,
      400,
    );
  });

  it('AI 评审 reviewerId 置 null,成功创建', async () => {
    mockAnalysisRepo.findById.mockResolvedValue(makeAnalysis());
    const aiReview = makeReviewRecord({
      id: 'r-ai-0001',
      reviewerId: null,
      reviewerType: 'ai',
      confidence: 0.85,
    });
    mockReviewRepo.create.mockResolvedValue(aiReview);

    const result = await reviewService.createReview(ANALYSIS_ID, TENANT_A, USER_TEACHER, {
      reviewerType: 'ai',
      scores: VALID_SCORES,
      confidence: 0.85,
    });

    const callArg = mockReviewRepo.create.mock.calls[0]![0];
    expect(callArg.reviewerId).toBeNull(); // AI 评审 reviewerId 必须为 null
    expect(callArg.reviewerType).toBe('ai');
    expect(callArg.confidence).toBe(0.85);
    expect(result.id).toBe('r-ai-0001');
    expect(result.reviewerId).toBeNull();
    expect(result.reviewerType).toBe('ai');
  });

  it('人工评审 reviewerId = 当前用户,成功创建', async () => {
    mockAnalysisRepo.findById.mockResolvedValue(makeAnalysis());
    mockReviewRepo.create.mockResolvedValue(makeReviewRecord());

    const result = await reviewService.createReview(ANALYSIS_ID, TENANT_A, USER_TEACHER, {
      reviewerType: 'professor',
      scores: VALID_SCORES,
      comment: '评审意见',
    });

    const callArg = mockReviewRepo.create.mock.calls[0]![0];
    expect(callArg.reviewerId).toBe(USER_TEACHER);
    expect(callArg.reviewerType).toBe('professor');
    expect(callArg.status).toBe('submitted'); // 默认状态
    expect(result.reviewerType).toBe('professor');
  });

  it('指定 status=draft 时创建为 draft', async () => {
    mockAnalysisRepo.findById.mockResolvedValue(makeAnalysis());
    const draftReview = makeReviewRecord({ status: 'draft' });
    mockReviewRepo.create.mockResolvedValue(draftReview);

    await reviewService.createReview(ANALYSIS_ID, TENANT_A, USER_TEACHER, {
      reviewerType: 'professor',
      scores: VALID_SCORES,
      status: 'draft',
    });

    const callArg = mockReviewRepo.create.mock.calls[0]![0];
    expect(callArg.status).toBe('draft');
  });
});

describe('ReviewService.listReviews', () => {
  it('分析任务不存在 → ANALYSIS_NOT_FOUND 404', async () => {
    mockAnalysisRepo.findById.mockResolvedValue(null);

    await expectBusinessError(
      () => reviewService.listReviews(ANALYSIS_ID, TENANT_A),
      ErrorCode.ANALYSIS_NOT_FOUND,
      404,
    );
    expect(mockReviewRepo.findByAnalysis).not.toHaveBeenCalled();
  });

  it('成功返回评审列表(含 reviewerName 解析)', async () => {
    mockAnalysisRepo.findById.mockResolvedValue(makeAnalysis());
    const review1 = makeReviewRecord({ id: 'r-0001', reviewerId: USER_TEACHER });
    const review2 = makeReviewRecord({
      id: 'r-0002',
      reviewerId: null,
      reviewerType: 'ai',
      confidence: 0.8,
    });
    mockReviewRepo.findByAnalysis.mockResolvedValue([review1, review2]);
    // 人工评审需要查用户名,AI 评审不需要
    mockUserRepo.findById.mockResolvedValue(makeReviewer({ name: '张教授' }));

    const result = await reviewService.listReviews(ANALYSIS_ID, TENANT_A);

    expect(result).toHaveLength(2);
    expect(result[0]!.id).toBe('r-0001');
    expect(result[0]!.reviewerName).toBe('张教授'); // 人工评审解析姓名
    expect(result[1]!.reviewerId).toBeNull();
    expect(result[1]!.reviewerName).toBeNull(); // AI 评审无姓名
    expect(result[1]!.reviewerType).toBe('ai');
  });

  it('人工评审但用户已被删除 → reviewerName 为 null', async () => {
    mockAnalysisRepo.findById.mockResolvedValue(makeAnalysis());
    mockReviewRepo.findByAnalysis.mockResolvedValue([makeReviewRecord({ reviewerId: 'u-deleted' })]);
    mockUserRepo.findById.mockResolvedValue(null); // 用户不存在

    const result = await reviewService.listReviews(ANALYSIS_ID, TENANT_A);

    expect(result[0]!.reviewerName).toBeNull();
  });
});

describe('ReviewService.getReview', () => {
  it('分析任务不存在 → ANALYSIS_NOT_FOUND 404', async () => {
    mockAnalysisRepo.findById.mockResolvedValue(null);

    await expectBusinessError(
      () => reviewService.getReview(ANALYSIS_ID, TENANT_A, 'r-0001'),
      ErrorCode.ANALYSIS_NOT_FOUND,
      404,
    );
  });

  it('评审记录不存在 → PHASE5_REVIEW_NOT_FOUND 404', async () => {
    mockAnalysisRepo.findById.mockResolvedValue(makeAnalysis());
    mockReviewRepo.findById.mockResolvedValue(null);

    await expectBusinessError(
      () => reviewService.getReview(ANALYSIS_ID, TENANT_A, 'r-non-existent'),
      ErrorCode.PHASE5_REVIEW_NOT_FOUND,
      404,
    );
  });

  it('评审记录 analysisId 不匹配 → PHASE5_REVIEW_NOT_FOUND 404', async () => {
    mockAnalysisRepo.findById.mockResolvedValue(makeAnalysis());
    mockReviewRepo.findById.mockResolvedValue(
      makeReviewRecord({ analysisId: 'a-other-analysis' }),
    );

    await expectBusinessError(
      () => reviewService.getReview(ANALYSIS_ID, TENANT_A, 'r-0001'),
      ErrorCode.PHASE5_REVIEW_NOT_FOUND,
      404,
    );
  });

  it('成功返回评审详情', async () => {
    mockAnalysisRepo.findById.mockResolvedValue(makeAnalysis());
    mockReviewRepo.findById.mockResolvedValue(makeReviewRecord());
    mockUserRepo.findById.mockResolvedValue(makeReviewer({ name: '李教授' }));

    const result = await reviewService.getReview(ANALYSIS_ID, TENANT_A, 'r-review-0001');

    expect(result.id).toBe('r-review-0001');
    expect(result.reviewerName).toBe('李教授');
    expect(result.scores.overallScore).toBe(85);
    expect(typeof result.createdAt).toBe('string');
  });
});

describe('ReviewService.checkDispute', () => {
  it('分析任务不存在 → ANALYSIS_NOT_FOUND 404', async () => {
    mockAnalysisRepo.findById.mockResolvedValue(null);

    await expectBusinessError(
      () => reviewService.checkDispute(ANALYSIS_ID, TENANT_A),
      ErrorCode.ANALYSIS_NOT_FOUND,
      404,
    );
    expect(mockArbitration.checkDispute).not.toHaveBeenCalled();
  });

  it('成功委托 arbitrationService.checkDispute(透传 analysisId + tenantId)', async () => {
    mockAnalysisRepo.findById.mockResolvedValue(makeAnalysis());
    const disputeResponse = {
      triggered: true,
      level: 'general' as const,
      reason: { totalRange: 12, dimDiffs: { composition: 12 }, gradeCrossCount: 1 },
      disputeCaseId: 'd-0001',
      reviewCount: 2,
    };
    mockArbitration.checkDispute.mockResolvedValue(disputeResponse);

    const result = await reviewService.checkDispute(ANALYSIS_ID, TENANT_A);

    expect(mockArbitration.checkDispute).toHaveBeenCalledWith(ANALYSIS_ID, TENANT_A);
    expect(result.triggered).toBe(true);
    expect(result.level).toBe('general');
    expect(result.disputeCaseId).toBe('d-0001');
  });

  it('未触发争议时返回 triggered=false', async () => {
    mockAnalysisRepo.findById.mockResolvedValue(makeAnalysis());
    mockArbitration.checkDispute.mockResolvedValue({
      triggered: false,
      level: null,
      reason: null,
      disputeCaseId: null,
      reviewCount: 1,
    });

    const result = await reviewService.checkDispute(ANALYSIS_ID, TENANT_A);
    expect(result.triggered).toBe(false);
    expect(result.level).toBeNull();
    expect(result.disputeCaseId).toBeNull();
    expect(result.reviewCount).toBe(1);
  });
});
