// ============================================================
// 班级管理 Controller(班级即租户 type='class')
// 对应 API(挂载 /api/v1/classes):
//   POST /classes                                               创建班级(review:write)
//   GET  /classes                                               我的班级列表(review:read)
//   GET  /classes/:id                                           班级详情+成员(review:read)
//   POST /classes/:id/invitations                               生成邀请码(review:write)
//   GET  /classes/:id/invitations                               邀请码列表(review:read)
//   GET  /classes/:id/students/:userId/works                    学生作品列表(review:read)
//   POST /classes/:id/students/:userId/works/:analysisId/review 教师打分(review:write)
//
// 安全约束:
//   - 所有输入经 Zod 校验;userId/tenantId 从 JWT 注入,禁止从请求体读取
//   - 班级成员资格在 service 层强制校验(TenantMember)
//   - 所有写操作记录审计日志(writeAudit,失败不阻塞主流程)
// ============================================================

import type { RequestHandler } from 'express';
import { z } from 'zod';
import { classService } from '../services/class.service.js';
import { writeAudit } from '../services/admin-audit.service.js';
import { success, error } from '../utils/response.js';
import { ErrorCode } from '../types/api-contract.js';

// ============================================================
// Zod Schemas
// ============================================================

/** POST /classes 请求体 */
const createClassSchema = z.object({
  name: z.string().min(1, '班级名称不能为空').max(64, '班级名称不能超过 64 字符'),
  description: z.string().max(500, '班级描述不能超过 500 字符').optional(),
});

/** POST /classes/:id/invitations 请求体(均可选,服务端给默认值) */
const createClassInvitationSchema = z.object({
  maxUses: z
    .number()
    .int('maxUses 必须为整数')
    .min(1, 'maxUses 最小为 1')
    .max(500, 'maxUses 最大为 500')
    .optional(),
  expiresHours: z
    .number()
    .int('expiresHours 必须为整数')
    .min(1, 'expiresHours 最小为 1')
    .max(720, 'expiresHours 最长为 720(30 天)')
    .optional(),
});

/** 路径参数 :id 校验 */
const classIdParamSchema = z.object({
  id: z.string().min(1, '缺少必填参数:id'),
});

/** 路径参数 :id + :userId 校验 */
const studentWorksParamSchema = z.object({
  id: z.string().min(1, '缺少必填参数:id'),
  userId: z.string().min(1, '缺少必填参数:userId'),
});

/** 学生作品列表查询参数(page/limit,与契约 §3.20 一致) */
const studentWorksQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/** 路径参数 :id + :userId + :analysisId 校验 */
const classReviewParamSchema = z.object({
  id: z.string().min(1, '缺少必填参数:id'),
  userId: z.string().min(1, '缺少必填参数:userId'),
  analysisId: z.string().min(1, '缺少必填参数:analysisId'),
});

// ---- 教师打分请求体(复用 review.controller.ts 的 scores 结构) ----
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

/** POST .../review 请求体(reviewerType 固定 professor,传入其他值拒绝) */
const submitClassReviewSchema = z.object({
  reviewerType: z.literal('professor').optional(),
  presetId: z.string().min(1).optional(),
  scores: scoresSchema,
  comment: z.string().max(2000).optional(),
  status: z.enum(['draft', 'submitted']).optional(),
});

// ---- 班级讨论(聊天框 + 分享诊断报告) ----

/** GET /classes/:id/messages 查询参数(after/before/limit) */
const listMessagesQuerySchema = z
  .object({
    after: z.string().min(1).optional(),
    before: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .refine((v) => !(v.after && v.before), {
    message: 'after 与 before 不可同时传入',
  });

/** POST /classes/:id/messages 请求体 */
const sendMessageSchema = z
  .object({
    type: z.enum(['text', 'analysis_share']),
    content: z.string().max(500, '消息内容不能超过 500 字符').optional(),
    analysisId: z.string().min(1).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.type === 'text') {
      if (!v.content || v.content.trim().length === 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: '文本消息内容不能为空' });
      }
    } else {
      if (!v.analysisId) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: '分享诊断报告时必须提供 analysisId' });
      }
    }
  });

/** 路径参数 :id + :analysisId 校验(查看分享报告) */
const sharedAnalysisParamSchema = z.object({
  id: z.string().min(1, '缺少必填参数:id'),
  analysisId: z.string().min(1, '缺少必填参数:analysisId'),
});

// ============================================================
// Handlers
// ============================================================

/** POST /classes - 创建班级(创建者自动成为 teacher) */
export const createClass: RequestHandler = async (req, res, next) => {
  try {
    if (!req.userId || !req.tenantId) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }
    const parseResult = createClassSchema.safeParse(req.body);
    if (!parseResult.success) {
      return error(res, ErrorCode.PARAM_INVALID, parseResult.error.issues[0]?.message ?? '参数错误', 400);
    }

    const created = await classService.createClass(req.userId, parseResult.data);

    await writeAudit({
      req,
      action: 'create',
      resource: 'class',
      resourceId: created.id,
      targetTenantId: created.id,
      beforeData: null,
      afterData: { name: created.name, description: created.description, maxSeats: created.maxSeats },
      note: `创建班级(name=${created.name})`,
    });

    return success(res, created, '班级已创建');
  } catch (err) {
    return next(err);
  }
};

/** GET /classes - 列出当前用户作为成员的所有班级(含成员数) */
export const listMyClasses: RequestHandler = async (req, res, next) => {
  try {
    if (!req.userId || !req.tenantId) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }
    const classes = await classService.listMyClasses(req.userId);
    return success(res, classes, 'success');
  } catch (err) {
    return next(err);
  }
};

/** GET /classes/:id - 班级详情 + 成员列表 */
export const getClassDetail: RequestHandler = async (req, res, next) => {
  try {
    if (!req.userId || !req.tenantId) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }
    const params = classIdParamSchema.safeParse(req.params);
    if (!params.success) {
      return error(res, ErrorCode.PARAM_INVALID, params.error.issues[0]?.message ?? '参数错误', 400);
    }
    const detail = await classService.getClassDetail(params.data.id, req.userId);
    return success(res, detail, 'success');
  } catch (err) {
    return next(err);
  }
};

/** POST /classes/:id/invitations - 为班级生成邀请码(role 固定 student) */
export const createClassInvitation: RequestHandler = async (req, res, next) => {
  try {
    if (!req.userId || !req.tenantId) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }
    const params = classIdParamSchema.safeParse(req.params);
    if (!params.success) {
      return error(res, ErrorCode.PARAM_INVALID, params.error.issues[0]?.message ?? '参数错误', 400);
    }
    const parseResult = createClassInvitationSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      return error(res, ErrorCode.PARAM_INVALID, parseResult.error.issues[0]?.message ?? '参数错误', 400);
    }

    const invitation = await classService.createClassInvitation(
      params.data.id,
      req.userId,
      parseResult.data,
    );

    await writeAudit({
      req,
      action: 'create',
      resource: 'class_invitation',
      resourceId: invitation.id,
      targetTenantId: params.data.id,
      beforeData: null,
      afterData: {
        code: invitation.code,
        role: invitation.role,
        maxUses: invitation.maxUses,
        expiresAt: invitation.expiresAt,
      },
      note: '创建班级邀请码(role=student)',
    });

    return success(res, invitation, '邀请码已创建');
  } catch (err) {
    return next(err);
  }
};

/** GET /classes/:id/invitations - 列出班级的所有邀请码 */
export const listClassInvitations: RequestHandler = async (req, res, next) => {
  try {
    if (!req.userId || !req.tenantId) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }
    const params = classIdParamSchema.safeParse(req.params);
    if (!params.success) {
      return error(res, ErrorCode.PARAM_INVALID, params.error.issues[0]?.message ?? '参数错误', 400);
    }
    const invitations = await classService.listClassInvitations(params.data.id, req.userId);
    return success(res, invitations, 'success');
  } catch (err) {
    return next(err);
  }
};

/** GET /classes/:id/students/:userId/works - 查看指定学生在班级中的作品列表(分页) */
export const getClassStudentWorks: RequestHandler = async (req, res, next) => {
  try {
    if (!req.userId || !req.tenantId) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }
    const params = studentWorksParamSchema.safeParse(req.params);
    if (!params.success) {
      return error(res, ErrorCode.PARAM_INVALID, params.error.issues[0]?.message ?? '参数错误', 400);
    }
    const query = studentWorksQuerySchema.safeParse(req.query);
    if (!query.success) {
      return error(res, ErrorCode.PARAM_INVALID, query.error.issues[0]?.message ?? '参数错误', 400);
    }

    const works = await classService.listStudentWorks(
      params.data.id,
      params.data.userId,
      req.userId,
      query.data,
    );
    return success(res, works, 'success');
  } catch (err) {
    return next(err);
  }
};

/** POST /classes/:id/students/:userId/works/:analysisId/review - 教师给学生作品打分 */
export const submitClassReview: RequestHandler = async (req, res, next) => {
  try {
    if (!req.userId || !req.tenantId) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }
    const params = classReviewParamSchema.safeParse(req.params);
    if (!params.success) {
      return error(res, ErrorCode.PARAM_INVALID, params.error.issues[0]?.message ?? '参数错误', 400);
    }
    const parseResult = submitClassReviewSchema.safeParse(req.body);
    if (!parseResult.success) {
      return error(res, ErrorCode.PARAM_INVALID, parseResult.error.issues[0]?.message ?? '参数错误', 400);
    }

    const review = await classService.submitClassReview(
      params.data.id,
      params.data.userId,
      params.data.analysisId,
      req.userId,
      parseResult.data,
    );

    await writeAudit({
      req,
      action: 'review',
      resource: 'class_review',
      resourceId: review.id,
      targetTenantId: params.data.id,
      beforeData: null,
      afterData: {
        analysisId: params.data.analysisId,
        studentId: params.data.userId,
        overallScore: review.scores.overallScore,
        status: review.status,
      },
      note: `班级作品打分(analysisId=${params.data.analysisId})`,
    });

    return success(res, review, '评审已提交');
  } catch (err) {
    return next(err);
  }
};

// ============================================================
// 班级讨论(聊天框 + 分享诊断报告)
// ============================================================

/** GET /classes/:id/messages - 拉取班级消息(初始/增量/翻页三模式) */
export const listMessages: RequestHandler = async (req, res, next) => {
  try {
    if (!req.userId || !req.tenantId) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }
    const params = classIdParamSchema.safeParse(req.params);
    if (!params.success) {
      return error(res, ErrorCode.PARAM_INVALID, params.error.issues[0]?.message ?? '参数错误', 400);
    }
    const query = listMessagesQuerySchema.safeParse(req.query);
    if (!query.success) {
      return error(res, ErrorCode.PARAM_INVALID, query.error.issues[0]?.message ?? '参数错误', 400);
    }

    const messages = await classService.listMessages(params.data.id, req.userId, query.data);
    return success(res, messages, 'success');
  } catch (err) {
    return next(err);
  }
};

/** POST /classes/:id/messages - 发送班级消息(文本/分享诊断报告) */
export const sendMessage: RequestHandler = async (req, res, next) => {
  try {
    if (!req.userId || !req.tenantId) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }
    const params = classIdParamSchema.safeParse(req.params);
    if (!params.success) {
      return error(res, ErrorCode.PARAM_INVALID, params.error.issues[0]?.message ?? '参数错误', 400);
    }
    const parseResult = sendMessageSchema.safeParse(req.body);
    if (!parseResult.success) {
      return error(res, ErrorCode.PARAM_INVALID, parseResult.error.issues[0]?.message ?? '参数错误', 400);
    }

    const message = await classService.sendMessage(params.data.id, req.userId, parseResult.data);

    await writeAudit({
      req,
      action: 'create',
      resource: 'class_message',
      resourceId: message.id,
      targetTenantId: params.data.id,
      beforeData: null,
      afterData: { type: message.type, analysisId: message.analysisId },
      note: `发送班级消息(type=${message.type})`,
    });

    return success(res, message, '消息已发送');
  } catch (err) {
    return next(err);
  }
};

/** GET /classes/:id/shared-analyses/:analysisId - 查看被分享到班级的诊断报告 */
export const getSharedAnalysis: RequestHandler = async (req, res, next) => {
  try {
    if (!req.userId || !req.tenantId) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }
    const params = sharedAnalysisParamSchema.safeParse(req.params);
    if (!params.success) {
      return error(res, ErrorCode.PARAM_INVALID, params.error.issues[0]?.message ?? '参数错误', 400);
    }

    const analysis = await classService.getSharedAnalysis(
      params.data.id,
      params.data.analysisId,
      req.userId,
    );
    return success(res, analysis, 'success');
  } catch (err) {
    return next(err);
  }
};
