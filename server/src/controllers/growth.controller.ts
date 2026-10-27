// ============================================================
// 成长曲线 Controller
// 对应 API:GET /api/v1/growth
//
// 输入校验:Zod schema,所有外部输入经校验后进入 service
// 响应格式:{code, message, data, traceId}
//
// 数据范围过滤(由 service 层基于 role 实现):
//   - student:仅自己的成长数据(忽略 query.userId 越权)
//   - teacher / admin / owner:可传 userId 查看指定学生;不传则聚合租户全量
// ============================================================

import type { RequestHandler } from 'express';
import { z } from 'zod';
import { growthService } from '../services/growth.service.js';
import { success, error } from '../utils/response.js';
import { ErrorCode } from '../types/api-contract.js';

/** GET /growth 查询参数 schema */
const growthQuerySchema = z.object({
  dimension: z
    .enum(['composition', 'color', 'originality', 'overall'])
    .default('overall'),
  timeRange: z
    .enum(['7d', '30d', '90d', 'all'])
    .default('30d'),
  artType: z
    .enum(['painting', 'design', 'product', 'sculpture'])
    .optional(),
  userId: z
    .string()
    .min(1, 'userId 不能为空字符串')
    .optional(),
});

/**
 * GET /growth
 * 获取成长曲线数据
 *
 * 权限:requireAnyPermission('analysis:read:own', 'analysis:read:tenant')
 *   - student 拥有 analysis:read:own(仅看自己)
 *   - teacher / admin / owner 拥有两者(可看租户全量 / 指定学生)
 */
export const getGrowthData: RequestHandler = async (req, res, next) => {
  try {
    if (!req.userId || !req.tenantId || !req.role) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }

    const parsed = growthQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const msg = `参数错误:${first?.path.join('.') ?? 'unknown'} ${first?.message ?? 'invalid'}`;
      return error(res, ErrorCode.PARAM_INVALID, msg, 400);
    }

    const result = await growthService.getGrowthData({
      tenantId: req.tenantId,
      userId: req.userId,
      role: req.role,
      dimension: parsed.data.dimension,
      timeRange: parsed.data.timeRange,
      artType: parsed.data.artType,
      targetUserId: parsed.data.userId,
    });

    return success(res, result, 'success');
  } catch (err) {
    return next(err);
  }
};
