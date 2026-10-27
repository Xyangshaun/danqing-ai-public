// ============================================================
// 争议仲裁 Controller(Phase 5)
// 对应 API:
//   GET  /disputes                 (分页列出争议,teacher/admin)
//   GET  /disputes/:id             (争议详情,租户内)
//   POST /disputes/:id/resolve     (裁定争议,admin/teacher)
//   GET  /disputes/:id/result      (获取最终裁定结果,租户内)
//   POST /disputes/:id/apply-result(回写裁定分到 Analysis,teacher/admin)
//
// 所有输入经 Zod 校验;tenantId/userId 从 JWT 注入
// ============================================================

import type { RequestHandler } from 'express';
import { z } from 'zod';
import { arbitrationService } from '../services/arbitration.service.js';
import { isCrossTenantRole } from '../utils/cross-tenant.js';
import { success, error, paginated } from '../utils/response.js';
import { ErrorCode } from '../types/api-contract.js';
import type { DisputeStatus, DisputeLevel } from '../types/arbitration.js';

// ============================================================
// Zod Schemas
// ============================================================

const disputeStatusSchema = z.enum(['open', 'reviewing', 'resolved', 'closed']) as z.ZodType<DisputeStatus>;
const disputeLevelSchema = z.enum(['consistent', 'general', 'high', 'veto']) as z.ZodType<DisputeLevel>;
const resolveRuleSchema = z.enum(['weighted', 'majority', 'unanimous']);

const resolveDisputeSchema = z.object({
  rule: resolveRuleSchema,
  overrideScore: z
    .object({
      overallScore: z.number().min(0).max(100),
      dimensions: z.record(z.string(), z.number().min(0).max(100)),
      note: z.string().min(1).max(1000),
    })
    .optional(),
});

/** 路径参数 :id 校验 schema(防止 req.params.id 为 undefined) */
const idParamSchema = z.object({
  id: z.string().min(1, '缺少必填参数:id'),
});

// ============================================================
// Handlers
// ============================================================

/** GET /disputes */
export const listDisputes: RequestHandler = async (req, res, next) => {
  try {
    if (!req.userId || !req.tenantId) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }
    // 解析分页参数(默认 page=1, pageSize=20)
    const page = Math.max(1, Number(req.query.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize ?? 20)));

    const status = typeof req.query.status === 'string' ? disputeStatusSchema.safeParse(req.query.status) : undefined;
    const level = typeof req.query.level === 'string' ? disputeLevelSchema.safeParse(req.query.level) : undefined;
    const analysisId = typeof req.query.analysisId === 'string' ? req.query.analysisId : undefined;

    // 跨租户协作角色(teacher/admin/owner)不按当前租户过滤
    const tenantScope = isCrossTenantRole(req.role) ? undefined : req.tenantId;

    const result = await arbitrationService.listDisputes(tenantScope, {
      status: status?.success ? status.data : undefined,
      level: level?.success ? level.data : undefined,
      analysisId,
      page,
      pageSize,
    });

    return paginated(res, {
      items: result.items,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      hasMore: result.page * result.pageSize < result.total,
    });
  } catch (err) {
    return next(err);
  }
};

/** GET /disputes/:id */
export const getDispute: RequestHandler = async (req, res, next) => {
  try {
    if (!req.userId || !req.tenantId) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }
    const params = idParamSchema.safeParse(req.params);
    if (!params.success) {
      return error(res, ErrorCode.PARAM_INVALID, params.error.issues[0]?.message ?? '参数错误', 400);
    }
    const tenantScope = isCrossTenantRole(req.role) ? undefined : req.tenantId;
    const dispute = await arbitrationService.getDispute(tenantScope, params.data.id);
    return success(res, dispute, 'success');
  } catch (err) {
    return next(err);
  }
};

/** POST /disputes/:id/resolve */
export const resolveDispute: RequestHandler = async (req, res, next) => {
  try {
    if (!req.userId || !req.tenantId) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }
    const params = idParamSchema.safeParse(req.params);
    if (!params.success) {
      return error(res, ErrorCode.PARAM_INVALID, params.error.issues[0]?.message ?? '参数错误', 400);
    }
    const parseResult = resolveDisputeSchema.safeParse(req.body);
    if (!parseResult.success) {
      return error(res, ErrorCode.PARAM_INVALID, parseResult.error.issues[0]?.message ?? '参数错误', 400);
    }
    const tenantScope = isCrossTenantRole(req.role) ? undefined : req.tenantId;
    const dispute = await arbitrationService.resolveDispute(
      params.data.id,
      tenantScope,
      req.userId,
      parseResult.data,
    );
    return success(res, dispute, '争议已裁定');
  } catch (err) {
    return next(err);
  }
};

/** GET /disputes/:id/result */
export const getDisputeResult: RequestHandler = async (req, res, next) => {
  try {
    if (!req.userId || !req.tenantId) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }
    const params = idParamSchema.safeParse(req.params);
    if (!params.success) {
      return error(res, ErrorCode.PARAM_INVALID, params.error.issues[0]?.message ?? '参数错误', 400);
    }
    const tenantScope = isCrossTenantRole(req.role) ? undefined : req.tenantId;
    const dispute = await arbitrationService.getDispute(tenantScope, params.data.id);
    return success(res, { finalScore: dispute.finalScore, status: dispute.status }, 'success');
  } catch (err) {
    return next(err);
  }
};

/** POST /disputes/:id/apply-result */
export const applyDisputeResult: RequestHandler = async (req, res, next) => {
  try {
    if (!req.userId || !req.tenantId) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }
    const params = idParamSchema.safeParse(req.params);
    if (!params.success) {
      return error(res, ErrorCode.PARAM_INVALID, params.error.issues[0]?.message ?? '参数错误', 400);
    }
    const tenantScope = isCrossTenantRole(req.role) ? undefined : req.tenantId;
    const result = await arbitrationService.applyResultToAnalysis(params.data.id, tenantScope);
    return success(res, result, '裁定结果已回写');
  } catch (err) {
    return next(err);
  }
};
