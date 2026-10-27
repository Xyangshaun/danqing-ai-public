// ============================================================
// 教师批注 Controller(反馈闭环 Phase 4 批次③)
// 对应 API(嵌套在 /analyses/:id 下,挂 review.routes):
//   GET    /analyses/:id/annotations        列出批注(review:read)
//   POST   /analyses/:id/annotations        创建批注(review:write)
//   PATCH  /analyses/:id/annotations/:aid   更新批注(仅作者本人)
//   DELETE /analyses/:id/annotations/:aid   删除批注(仅作者本人)
//
// 所有输入经 Zod 校验;tenantId/userId/role 从 JWT 注入,禁止从请求体读取
// 响应统一走 utils/response.ts(success/created),禁止裸 res.json
// ============================================================

import type { RequestHandler } from 'express';
import { z } from 'zod';
import { teacherAnnotationService } from '../services/teacher-annotation.service.js';
import { error, success, created } from '../utils/response.js';
import { ErrorCode } from '../types/api-contract.js';

// ============================================================
// Zod Schemas
// ============================================================

/** 批注动作(与 schema TeacherAnnotation.action 对齐) */
const annotationActionSchema = z.enum(['supplement', 'correct', 'confirm', 'reject'], {
  errorMap: () => ({ message: 'action 必须为 supplement/correct/confirm/reject 之一' }),
});

/** POST /analyses/:id/annotations 请求体校验 */
export const createAnnotationSchema = z.object({
  // marker 稳定 ID(批次①后新数据;可选,旧数据由 markerIndex 兜底)
  markerId: z
    .string()
    .min(1, 'markerId 不能为空字符串')
    .max(32, 'markerId 长度超限')
    .optional(),
  // marker 在 issueMarkers 数组中的原始索引(唯一约束位)
  markerIndex: z
    .number({ required_error: '缺少必填参数:markerIndex' })
    .int('markerIndex 必须为整数')
    .min(0, 'markerIndex 不能为负'),
  action: annotationActionSchema,
  // 批注内容(必填,1-500 字——教师批注必须有教学内容)
  comment: z
    .string({ required_error: '缺少必填参数:comment' })
    .min(1, '批注内容不能为空')
    .max(500, '批注内容最长 500 字'),
});

/** PATCH /analyses/:id/annotations/:aid 请求体校验(至少提供一项) */
export const updateAnnotationSchema = z
  .object({
    action: annotationActionSchema.optional(),
    comment: z.string().min(1, '批注内容不能为空').max(500, '批注内容最长 500 字').optional(),
  })
  .refine((data) => data.action !== undefined || data.comment !== undefined, {
    message: '至少提供 action 或 comment 之一',
  });

/** 路径参数 :id / :aid 校验 schema */
const analysisIdParamSchema = z.object({
  id: z.string().min(1, '缺少必填参数:id').max(64, 'id 长度超限'),
});
const annotationIdParamSchema = z.object({
  id: z.string().min(1, '缺少必填参数:id').max(64, 'id 长度超限'),
  aid: z.string().min(1, '缺少必填参数:aid').max(64, 'aid 长度超限'),
});

// ============================================================
// Handlers
// ============================================================

/** GET /analyses/:id/annotations - 列出该分析的全部批注 */
export const listAnnotations: RequestHandler = async (req, res, next) => {
  try {
    if (!req.userId || !req.tenantId || !req.role) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }
    const params = analysisIdParamSchema.safeParse(req.params);
    if (!params.success) {
      return error(res, ErrorCode.PARAM_INVALID, params.error.issues[0]?.message ?? '参数错误', 400);
    }
    const annotations = await teacherAnnotationService.listAnnotations({
      tenantId: req.tenantId,
      userId: req.userId,
      role: req.role,
      analysisId: params.data.id,
    });
    return success(res, annotations, 'success');
  } catch (err) {
    return next(err);
  }
};

/** POST /analyses/:id/annotations - 创建批注(teacher/admin/owner) */
export const createAnnotation: RequestHandler = async (req, res, next) => {
  try {
    if (!req.userId || !req.tenantId) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }
    const params = analysisIdParamSchema.safeParse(req.params);
    if (!params.success) {
      return error(res, ErrorCode.PARAM_INVALID, params.error.issues[0]?.message ?? '参数错误', 400);
    }
    const parsed = createAnnotationSchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, ErrorCode.PARAM_INVALID, parsed.error.issues[0]?.message ?? '参数错误', 400);
    }
    const annotation = await teacherAnnotationService.createAnnotation({
      tenantId: req.tenantId,
      teacherId: req.userId,
      analysisId: params.data.id,
      input: parsed.data,
    });
    return created(res, annotation, '批注已提交');
  } catch (err) {
    return next(err);
  }
};

/** PATCH /analyses/:id/annotations/:aid - 更新批注(仅作者本人) */
export const updateAnnotation: RequestHandler = async (req, res, next) => {
  try {
    if (!req.userId || !req.tenantId) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }
    const params = annotationIdParamSchema.safeParse(req.params);
    if (!params.success) {
      return error(res, ErrorCode.PARAM_INVALID, params.error.issues[0]?.message ?? '参数错误', 400);
    }
    const parsed = updateAnnotationSchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, ErrorCode.PARAM_INVALID, parsed.error.issues[0]?.message ?? '参数错误', 400);
    }
    const annotation = await teacherAnnotationService.updateAnnotation({
      tenantId: req.tenantId,
      teacherId: req.userId,
      analysisId: params.data.id,
      annotationId: params.data.aid,
      input: parsed.data,
    });
    return success(res, annotation, '批注已更新');
  } catch (err) {
    return next(err);
  }
};

/** DELETE /analyses/:id/annotations/:aid - 删除批注(仅作者本人) */
export const deleteAnnotation: RequestHandler = async (req, res, next) => {
  try {
    if (!req.userId || !req.tenantId) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }
    const params = annotationIdParamSchema.safeParse(req.params);
    if (!params.success) {
      return error(res, ErrorCode.PARAM_INVALID, params.error.issues[0]?.message ?? '参数错误', 400);
    }
    await teacherAnnotationService.deleteAnnotation({
      tenantId: req.tenantId,
      teacherId: req.userId,
      analysisId: params.data.id,
      annotationId: params.data.aid,
    });
    return success(res, null, '批注已删除');
  } catch (err) {
    return next(err);
  }
};
