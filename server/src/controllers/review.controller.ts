// ============================================================
// 评委评审 Controller(Phase 5)
// 对应 API(嵌套在 /analyses/:id 下):
//   POST /analyses/:id/reviews           (提交评审,teacher/admin)
//   GET  /analyses/:id/reviews           (列出该作业所有评审,租户内)
//   GET  /analyses/:id/reviews/:rid      (评审详情,租户内)
//   POST /analyses/:id/disputes/check    (检查并触发争议仲裁,teacher/admin)
//
// 所有输入经 Zod 校验;tenantId/userId 从 JWT 注入
// ============================================================

import type { RequestHandler } from 'express';
import { z } from 'zod';
import { reviewService } from '../services/review.service.js';
import { success, error } from '../utils/response.js';
import { ErrorCode } from '../types/api-contract.js';
import type { UserRole } from '../types/api-contract.js';
import type { ReviewerType } from '../types/arbitration.js';

// ============================================================
// Zod Schemas
// ============================================================

const reviewerTypeSchema = z.enum(['professor', 'lecturer', 'ai']) as z.ZodType<ReviewerType>;

const reviewLevelSchema = z.enum(['excellent', 'good', 'qualified', 'needs_improvement']);

const dimensionScoreSchema = z.object({
  score: z.number().min(0).max(100),
  level: reviewLevelSchema,
  note: z.string().max(500).optional(),
});

const scoresSchema = z.object({
  dimensions: z.record(z.string(), dimensionScoreSchema),
  overallScore: z.number().min(0).max(100),
});

const createReviewSchema = z.object({
  reviewerType: reviewerTypeSchema,
  presetId: z.string().min(1).optional(),
  scores: scoresSchema,
  confidence: z.number().min(0).max(1).optional(),
  comment: z.string().max(2000).optional(),
  status: z.enum(['draft', 'submitted']).optional(),
});

/** 路径参数 :id / :rid 校验 schema(防止 req.params.* 为 undefined) */
const analysisIdParamSchema = z.object({
  id: z.string().min(1, '缺少必填参数:id'),
});
const reviewIdParamSchema = z.object({
  id: z.string().min(1, '缺少必填参数:id'),
  rid: z.string().min(1, '缺少必填参数:rid'),
});

/** 申请人工复核请求体校验 */
const requestDisputeSchema = z.object({
  reason: z.string().min(10, '申请理由至少 10 个字').max(500, '申请理由不能超过 500 字'),
  reviewType: z.enum(['ai', 'teacher']).optional(),
});

// ============================================================
// Handlers
// ============================================================

/** POST /analyses/:id/reviews */
export const createReview: RequestHandler = async (req, res, next) => {
  try {
    if (!req.userId || !req.tenantId) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }
    const params = analysisIdParamSchema.safeParse(req.params);
    if (!params.success) {
      return error(res, ErrorCode.PARAM_INVALID, params.error.issues[0]?.message ?? '参数错误', 400);
    }
    const parseResult = createReviewSchema.safeParse(req.body);
    if (!parseResult.success) {
      return error(res, ErrorCode.PARAM_INVALID, parseResult.error.issues[0]?.message ?? '参数错误', 400);
    }
    const review = await reviewService.createReview(
      params.data.id,
      req.tenantId,
      req.userId,
      parseResult.data,
    );
    return success(res, review, '评审已提交');
  } catch (err) {
    return next(err);
  }
};

/** GET /analyses/:id/reviews */
export const listReviews: RequestHandler = async (req, res, next) => {
  try {
    if (!req.userId || !req.tenantId) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }
    const params = analysisIdParamSchema.safeParse(req.params);
    if (!params.success) {
      return error(res, ErrorCode.PARAM_INVALID, params.error.issues[0]?.message ?? '参数错误', 400);
    }
    const reviews = await reviewService.listReviews(params.data.id, req.tenantId);
    return success(res, reviews, 'success');
  } catch (err) {
    return next(err);
  }
};

/** GET /analyses/:id/reviews/:rid */
export const getReview: RequestHandler = async (req, res, next) => {
  try {
    if (!req.userId || !req.tenantId) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }
    const params = reviewIdParamSchema.safeParse(req.params);
    if (!params.success) {
      return error(res, ErrorCode.PARAM_INVALID, params.error.issues[0]?.message ?? '参数错误', 400);
    }
    const review = await reviewService.getReview(params.data.id, req.tenantId, params.data.rid);
    return success(res, review, 'success');
  } catch (err) {
    return next(err);
  }
};

/** POST /analyses/:id/disputes/check */
export const checkDispute: RequestHandler = async (req, res, next) => {
  try {
    if (!req.userId || !req.tenantId) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }
    const params = analysisIdParamSchema.safeParse(req.params);
    if (!params.success) {
      return error(res, ErrorCode.PARAM_INVALID, params.error.issues[0]?.message ?? '参数错误', 400);
    }
    const result = await reviewService.checkDispute(params.data.id, req.tenantId);
    return success(res, result, 'success');
  } catch (err) {
    return next(err);
  }
};

/** POST /analyses/:id/disputes/request (学生申请人工复核,dispute:request) */
export const requestDispute: RequestHandler = async (req, res, next) => {
  try {
    if (!req.userId || !req.tenantId) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }
    const params = analysisIdParamSchema.safeParse(req.params);
    if (!params.success) {
      return error(res, ErrorCode.PARAM_INVALID, params.error.issues[0]?.message ?? '参数错误', 400);
    }
    const parseResult = requestDisputeSchema.safeParse(req.body);
    if (!parseResult.success) {
      return error(res, ErrorCode.PARAM_INVALID, parseResult.error.issues[0]?.message ?? '参数错误', 400);
    }
    // req.role 由 authMiddleware 注入;缺失时按 student 最严口径处理(触发归属校验)
    const role: UserRole = req.role === 'admin' || req.role === 'owner' || req.role === 'teacher'
      ? req.role
      : 'student';
    const result = await reviewService.requestDispute(
      params.data.id,
      req.tenantId,
      req.userId,
      role,
      parseResult.data.reason,
      parseResult.data.reviewType ?? 'teacher',
    );
    return success(res, result, '复核申请已提交,请等待教师评审');
  } catch (err) {
    return next(err);
  }
};
