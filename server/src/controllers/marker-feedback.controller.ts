// ============================================================
// 标注反馈 Controller(反馈闭环 Phase 4 批次②/数据飞轮)
// 对应 API:POST /api/v1/analyses/:id/marker-feedback
//
// 用户对 AI issueMarker 的"有用/没用"反馈,积累供未来训练专属评审模型(spec §7.3 第 1 项)
// 所有输入经 Zod 校验;tenantId/userId/role 从 JWT 注入,禁止从请求体读取
// 响应统一走 utils/response.ts(success),禁止裸 res.json
// ============================================================

import type { RequestHandler } from 'express';
import { z } from 'zod';
import { markerFeedbackService } from '../services/marker-feedback.service.js';
import { error, success } from '../utils/response.js';
import { ErrorCode } from '../types/api-contract.js';

/** POST /analyses/:id/marker-feedback 请求体校验 */
export const createMarkerFeedbackSchema = z.object({
  // marker 稳定 ID(批次①后新数据;可选,旧数据由 markerIndex 兜底)
  markerId: z
    .string()
    .min(1, 'markerId 不能为空字符串')
    .max(32, 'markerId 长度超限')
    .optional(),
  // marker 在 issueMarkers 数组中的原始索引(必填,唯一约束位)
  markerIndex: z
    .number({ required_error: '缺少必填参数:markerIndex' })
    .int('markerIndex 必须为整数')
    .min(0, 'markerIndex 不能为负'),
  // 反馈动作:up=有用/认同,down=没用/不准确
  action: z.enum(['up', 'down'], {
    errorMap: () => ({ message: 'action 必须为 up/down 之一' }),
  }),
});

/** 路径参数校验(照 analysis.controller 先例:本地定义,req.params 经 Zod 收窄) */
const analysisIdParamSchema = z.object({
  id: z
    .string({ required_error: '缺少必填参数:id' })
    .min(1, '缺少必填参数:id')
    .max(64, 'id 长度超限'),
});

/** POST /analyses/:id/marker-feedback - 提交/更新标注反馈(upsert) */
export const createMarkerFeedback: RequestHandler = async (req, res, next) => {
  try {
    if (!req.userId || !req.tenantId || !req.role) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }
    // 防御性复验(路由层 validate 中间件已校验 body,此处兜底保证直接调用安全)
    const parsedParams = analysisIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return error(res, ErrorCode.PARAM_INVALID, parsedParams.error.issues[0]?.message ?? '参数错误', 400);
    }
    const parsed = createMarkerFeedbackSchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, ErrorCode.PARAM_INVALID, parsed.error.issues[0]?.message ?? '参数错误', 400);
    }

    const data = await markerFeedbackService.createMarkerFeedback({
      tenantId: req.tenantId,
      userId: req.userId,
      role: req.role,
      analysisId: parsedParams.data.id,
      input: parsed.data,
    });

    return success(res, data, '反馈已记录');
  } catch (err) {
    return next(err);
  }
};
