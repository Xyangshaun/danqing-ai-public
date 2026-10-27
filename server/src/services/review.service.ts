// ============================================================
// 评委评审业务服务(Phase 5)
// 对应文档:new-features-design.md §1.6, §2.3, §3.2
//
// 职责:
//   1. 创建评审记录(校验分析归属租户 + 评分合法性)
//   2. 列出某分析的所有评审
//   3. 查询评审详情
//   4. checkDispute:委托 arbitrationService 检查争议
//
// 安全约束:
//   - 所有查询通过 Analysis.tenantId 间接隔离(service 层先校验分析归属)
//   - AI 评审(reviewerType=ai)reviewerId 为 null,人工评审 reviewerId = 当前用户
//   - AI 评审必须提供 confidence(0-1)
//   - 评分范围 0-100,overallScore 由评委给出(不自动计算)
// ============================================================

import { reviewRepository } from '../repositories/review.repository.js';
import { analysisRepository } from '../repositories/analysis.repository.js';
import { userRepository } from '../repositories/user.repository.js';
import { arbitrationService } from './arbitration.service.js';
import { notificationService } from './notification.service.js';
import { BusinessError } from '../middlewares/error-handler.js';
import {
  ErrorCode,
  type CreateReviewRequest,
  type ReviewRecordSummary,
  type ReviewScoresPayload,
  type DisputeCheckResponse,
  type RequestDisputeResponse,
  type UserRole,
} from '../types/api-contract.js';
import type { ReviewerType, ReviewRecordStatus } from '../types/arbitration.js';
import type { ReviewRecord, Prisma } from '@prisma/client';
import { logger } from '../utils/logger.js';
import { recordDiff } from './score-audit.service.js';

class ReviewServiceClass {
  // ============================================================
  // 创建评审
  // ============================================================

  /**
   * 提交评审记录
   * @param analysisId 分析任务 ID
   * @param tenantId 租户 ID(强制隔离)
   * @param reviewerId 评审人 ID(从 JWT;AI 评审为 undefined → null)
   * @param body 请求体
   */
  async createReview(
    analysisId: string,
    tenantId: string,
    reviewerId: string,
    body: CreateReviewRequest,
  ): Promise<ReviewRecordSummary> {
    // 1. 校验分析归属租户(多租户隔离)
    const analysis = await analysisRepository.findById(tenantId, analysisId);
    if (!analysis) {
      throw new BusinessError(ErrorCode.ANALYSIS_NOT_FOUND, '分析任务不存在', 404);
    }

    // 2. 校验评分合法性
    this.validateScores(body.scores, body.reviewerType, body.confidence);

    // 3. AI 评审 reviewerId 为 null,人工评审 reviewerId = 当前用户
    const finalReviewerId = body.reviewerType === 'ai' ? null : reviewerId;

    // 4. 写入评审记录
    const status: ReviewRecordStatus = body.status ?? 'submitted';
    const record = await reviewRepository.create({
      analysisId,
      reviewerId: finalReviewerId,
      reviewerType: body.reviewerType as ReviewerType,
      presetId: body.presetId ?? null,
      scores: body.scores as unknown as Prisma.InputJsonValue,
      confidence: body.confidence ?? null,
      comment: body.comment ?? null,
      status,
    });

    logger.info(
      { reviewId: record.id, analysisId, reviewerType: body.reviewerType, status },
      '[review] created',
    );

    // 框架二 P2:人工评审(教师/教授)→ 记录 AI-教师评分差异(非阻塞,失败仅告警)
    if (body.reviewerType !== 'ai') {
      const humanDims: Record<string, number> = {};
      for (const [key, dim] of Object.entries(body.scores.dimensions ?? {})) {
        if (dim !== null && typeof dim === 'object' && typeof dim.score === 'number') {
          humanDims[key] = dim.score;
        }
      }
      void recordDiff({
        analysisId,
        tenantId,
        source: 'teacher_review',
        reviewerId: finalReviewerId,
        aiResult: analysis.result,
        humanScore: { overallScore: body.scores.overallScore, dimensions: humanDims },
        artType: analysis.workType,
      });
    }

    // 异步通知作品所有者:作品收到新评审(不阻塞评审提交,失败仅记录日志)
    notificationService
      .createNotification({
        tenantId,
        userId: analysis.userId,
        type: 'REVIEW',
        title: '作品收到新评审',
        content: `您的作品《${analysis.title ?? '未命名作品'}》收到${body.reviewerType === 'ai' ? 'AI' : '人工'}评审`,
        level: 'INFO',
        linkUrl: `/analysis/${analysisId}`,
        metadata: {
          reviewId: record.id,
          analysisId,
          reviewerType: body.reviewerType,
        },
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(
          { err: msg, reviewId: record.id, analysisId, ownerId: analysis.userId },
          '[review] create notification failed (non-blocking)',
        );
      });

    return this.toSummary(record);
  }

  // ============================================================
  // 查询
  // ============================================================

  /**
   * 列出某分析的所有评审(租户内可见)
   */
  async listReviews(analysisId: string, tenantId: string): Promise<ReviewRecordSummary[]> {
    // 校验分析归属租户
    const analysis = await analysisRepository.findById(tenantId, analysisId);
    if (!analysis) {
      throw new BusinessError(ErrorCode.ANALYSIS_NOT_FOUND, '分析任务不存在', 404);
    }
    const records = await reviewRepository.findByAnalysis(analysisId);
    return Promise.all(records.map((r) => this.toSummary(r)));
  }

  /**
   * 查询评审详情
   */
  async getReview(
    analysisId: string,
    tenantId: string,
    reviewId: string,
  ): Promise<ReviewRecordSummary> {
    // 校验分析归属租户
    const analysis = await analysisRepository.findById(tenantId, analysisId);
    if (!analysis) {
      throw new BusinessError(ErrorCode.ANALYSIS_NOT_FOUND, '分析任务不存在', 404);
    }
    const record = await reviewRepository.findById(reviewId);
    if (!record || record.analysisId !== analysisId) {
      throw new BusinessError(ErrorCode.PHASE5_REVIEW_NOT_FOUND, '评审记录不存在', 404);
    }
    return this.toSummary(record);
  }

  // ============================================================
  // 争议检查(委托 arbitrationService)
  // ============================================================

  /**
   * 检查并触发争议仲裁
   * 委托 arbitrationService.checkDispute,service 层先校验分析归属
   */
  async checkDispute(analysisId: string, tenantId: string): Promise<DisputeCheckResponse> {
    // 校验分析归属租户
    const analysis = await analysisRepository.findById(tenantId, analysisId);
    if (!analysis) {
      throw new BusinessError(ErrorCode.ANALYSIS_NOT_FOUND, '分析任务不存在', 404);
    }
    return arbitrationService.checkDispute(analysisId, tenantId);
  }

  /**
   * 学生申请人工复核(委托 arbitrationService.requestDispute)
   * 归属/完成态/防重复校验均在 arbitration 层完成
   */
  async requestDispute(
    analysisId: string,
    tenantId: string,
    requesterId: string,
    role: UserRole,
    reason: string,
    reviewType: 'ai' | 'teacher' = 'teacher',
  ): Promise<RequestDisputeResponse> {
    return arbitrationService.requestDispute(analysisId, tenantId, requesterId, role, reason, reviewType);
  }

  // ============================================================
  // 私有工具方法
  // ============================================================

  /**
   * 校验评分合法性
   * - overallScore 0-100
   * - 各维度 score 0-100
   * - AI 评审必须提供 confidence(0-1)
   */
  private validateScores(scores: ReviewScoresPayload, reviewerType: ReviewerType, confidence?: number): void {
    if (!scores || typeof scores.overallScore !== 'number') {
      throw new BusinessError(ErrorCode.PARAM_INVALID, '评分缺少 overallScore', 400);
    }
    if (scores.overallScore < 0 || scores.overallScore > 100) {
      throw new BusinessError(ErrorCode.PARAM_INVALID, 'overallScore 必须在 0-100 之间', 400);
    }
    if (!scores.dimensions || Object.keys(scores.dimensions).length === 0) {
      throw new BusinessError(ErrorCode.PARAM_INVALID, '维度评分不能为空', 400);
    }
    for (const [key, dim] of Object.entries(scores.dimensions)) {
      if (typeof dim.score !== 'number' || dim.score < 0 || dim.score > 100) {
        throw new BusinessError(ErrorCode.PARAM_INVALID, `维度 "${key}" 分数必须在 0-100 之间`, 400);
      }
    }
    // AI 评审必须提供置信度
    if (reviewerType === 'ai') {
      if (typeof confidence !== 'number' || confidence < 0 || confidence > 1) {
        throw new BusinessError(ErrorCode.PARAM_INVALID, 'AI 评审必须提供 confidence(0-1)', 400);
      }
    }
  }

  /**
   * DB 模型 → API 契约
   * 评审人姓名通过 userRepository 查询(人工评审)
   */
  private async toSummary(r: ReviewRecord): Promise<ReviewRecordSummary> {
    let reviewerName: string | null = null;
    if (r.reviewerId) {
      const reviewer = await userRepository.findById(r.reviewerId);
      reviewerName = reviewer?.name ?? null;
    }
    return {
      id: r.id,
      reviewerId: r.reviewerId,
      reviewerName,
      reviewerType: r.reviewerType as ReviewerType,
      presetId: r.presetId,
      scores: r.scores as unknown as ReviewScoresPayload,
      confidence: r.confidence,
      comment: r.comment,
      status: r.status as ReviewRecordStatus,
      createdAt: r.createdAt.toISOString(),
    };
  }
}

export const reviewService = new ReviewServiceClass();
