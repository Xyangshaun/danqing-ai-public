// ============================================================
// 管理后台 - 租户仲裁配置 Controller(M-1 DOC-2026-08-003/004/005)
// 对应 API:
//   GET /api/admin/tenants/:id/arbitration-config
//   PUT /api/admin/tenants/:id/arbitration-config
//
// 输入校验:Zod 全量校验 + 权重归一化校验(由 service 层完成)
// 权限:admin:tenant:read(get) / admin:tenant:write(put)(路由层)
// 响应格式:{code, message, data, traceId}
// ============================================================

import type { RequestHandler } from 'express';
import { z } from 'zod';
import { tenantArbitrationService } from '../services/tenant-arbitration.service.js';
import { success, error } from '../utils/response.js';
import { ErrorCode } from '../types/api-contract.js';

/** 路径参数 schema(:id) */
const tenantIdParamSchema = z.object({
  id: z.string().min(1, '缺少必填参数:id'),
});

/** 权重字段(0-1) */
const weight = z.number().min(0).max(1).optional();

/**
 * PUT /api/admin/tenants/:id/arbitration-config 请求体 schema
 * 契约:UpdateTenantArbitrationConfigRequest(部分覆盖,深合并)
 * 服务层对"合并后生效配置"做全量校验 + 权重归一化校验
 */
const updateArbitrationConfigBodySchema = z.object({
  triggers: z
    .object({
      consistentTotalRange: z.number().positive().optional(),
      consistentDimDiff: z.number().positive().optional(),
      generalDisputeTotalRange: z.number().positive().optional(),
      generalDisputeDimDiff: z.number().positive().optional(),
      highDisputeTotalRange: z.number().positive().optional(),
      highDisputeDimCount: z.number().positive().optional(),
      gradeCrossTierHigh: z.number().positive().optional(),
      vetoLowGrade: z.number().positive().optional(),
      vetoHighGrade: z.number().positive().optional(),
    })
    .optional(),
  judgeWeights: z
    .object({
      regular: z.object({ professor: weight, lecturer: weight, ai: weight }).optional(),
      professorAi: z.object({ professor: weight, ai: weight }).optional(),
      committee: z.object({ professorEach: weight, ai: weight }).optional(),
    })
    .optional(),
  rules: z
    .object({
      final: z.enum(['weighted', 'majority', 'unanimous']).optional(),
      boundaryTolerance: z.number().nonnegative().optional(),
    })
    .optional(),
  edgeCases: z
    .object({
      outlierDiff: z.number().positive().optional(),
      outlierWeightFactor: weight,
      aiLowConfidence: weight,
      aiLowConfidenceWeight: weight,
      aiVeryLowConfidence: weight,
      aiHumanExtremeDiff: z.number().positive().optional(),
      maxMissingDimsToInvalidate: z.number().positive().optional(),
    })
    .optional(),
});

/**
 * GET /api/admin/tenants/:id/arbitration-config
 * 查询租户仲裁配置详情(未配置回退系统默认)
 * 权限:admin:tenant:read(路由层)
 */
export const getTenantArbitrationConfig: RequestHandler = async (req, res, next) => {
  try {
    const parsed = tenantIdParamSchema.safeParse(req.params);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const msg = `参数错误:${first?.path.join('.') ?? 'unknown'} ${first?.message ?? 'invalid'}`;
      return error(res, ErrorCode.PARAM_INVALID, msg, 400);
    }
    const result = await tenantArbitrationService.getConfigForAdmin(parsed.data.id);
    return success(res, result, 'success');
  } catch (err) {
    return next(err);
  }
};

/**
 * PUT /api/admin/tenants/:id/arbitration-config
 * 更新租户仲裁配置(深合并 + Zod 全量校验 + 权重归一化校验 + 审计日志)
 * 权限:admin:tenant:write(路由层)
 */
export const updateTenantArbitrationConfig: RequestHandler = async (req, res, next) => {
  try {
    if (!req.userId) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }
    const parsed = tenantIdParamSchema.safeParse(req.params);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const msg = `参数错误:${first?.path.join('.') ?? 'unknown'} ${first?.message ?? 'invalid'}`;
      return error(res, ErrorCode.PARAM_INVALID, msg, 400);
    }

    const bodyParsed = updateArbitrationConfigBodySchema.safeParse(req.body);
    if (!bodyParsed.success) {
      const first = bodyParsed.error.issues[0];
      const msg = `参数错误:${first?.path.join('.') ?? 'unknown'} ${first?.message ?? 'invalid'}`;
      return error(res, ErrorCode.PARAM_INVALID, msg, 400);
    }

    const result = await tenantArbitrationService.updateConfig(
      parsed.data.id,
      // Zod 已全量校验结构/取值;契约类型为 Partial 嵌套,此处显式收窄
      bodyParsed.data as unknown as Parameters<
        typeof tenantArbitrationService.updateConfig
      >[1],
      req.userId,
      req,
    );
    return success(res, result, '仲裁配置已更新');
  } catch (err) {
    return next(err);
  }
};