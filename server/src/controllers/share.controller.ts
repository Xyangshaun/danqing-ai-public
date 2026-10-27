// ============================================================
// 组织内分享 Controller(报告导出+组织分享特性)
// 对应 API:
//   POST   /analyses/:id/share           分享作品到组织
//   DELETE /analyses/:id/share           取消分享(本人)
//   GET    /org/feed                     组织动态流列表
//   DELETE /org/feed/:id                 删除分享(本人/share:manage)
//   POST   /org/feed/:id/pin             置顶(share:manage)
//   DELETE /org/feed/:id/pin             取消置顶(share:manage)
//   POST   /org/feed/:id/comments        发表评论
//   GET    /org/feed/:id/comments        评论列表
//   DELETE /org/feed/:id/comments/:cid   删除评论(本人/share:manage)
//
// 所有输入经 Zod 校验;tenantId/userId/role 从 JWT 注入
// ============================================================

import type { RequestHandler } from 'express';
import { z } from 'zod';
import { shareService } from '../services/share.service.js';
import { isCrossTenantRole } from '../utils/cross-tenant.js';
import { success, error } from '../utils/response.js';
import { ErrorCode } from '../types/api-contract.js';
import type { UserRole } from '../types/api-contract.js';

// ============================================================
// Zod Schemas
// ============================================================

const analysisIdParamSchema = z.object({
  id: z.string().min(1, '缺少必填参数:id'),
});

const sharedWorkIdParamSchema = z.object({
  id: z.string().min(1, '缺少必填参数:id'),
});

const commentIdParamSchema = z.object({
  id: z.string().min(1, '缺少必填参数:id'),
  cid: z.string().min(1, '缺少必填参数:cid'),
});

const shareAnalysisSchema = z.object({
  caption: z.string().max(200, '分享感言不能超过 200 字').optional(),
});

const listOrgFeedQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  workType: z.enum(['painting', 'design', 'product', 'sculpture']).optional(),
});

const createCommentSchema = z.object({
  content: z.string().min(1, '评论内容不能为空').max(500, '评论内容不能超过 500 字'),
});

/**
 * 从请求中提取已收窄的角色(authMiddleware 注入;缺失时按 student 最严口径)
 */
function resolveRole(req: Parameters<RequestHandler>[0]): UserRole {
  return req.role === 'admin' || req.role === 'owner' || req.role === 'teacher'
    ? req.role
    : 'student';
}

// ============================================================
// Handlers — 挂载于 /analyses/:id 下
// ============================================================

/** POST /analyses/:id/share — 分享作品到组织(share:create) */
export const shareAnalysis: RequestHandler = async (req, res, next) => {
  try {
    if (!req.userId || !req.tenantId) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }
    const params = analysisIdParamSchema.safeParse(req.params);
    if (!params.success) {
      return error(res, ErrorCode.PARAM_INVALID, params.error.issues[0]?.message ?? '参数错误', 400);
    }
    const body = shareAnalysisSchema.safeParse(req.body ?? {});
    if (!body.success) {
      return error(res, ErrorCode.PARAM_INVALID, body.error.issues[0]?.message ?? '参数错误', 400);
    }
    const shared = await shareService.shareAnalysis(
      params.data.id,
      req.tenantId,
      req.userId,
      body.data.caption,
    );
    return success(res, shared, '已分享到组织');
  } catch (err) {
    return next(err);
  }
};

/** DELETE /analyses/:id/share — 取消分享(本人,share:create) */
export const unshareAnalysis: RequestHandler = async (req, res, next) => {
  try {
    if (!req.userId || !req.tenantId) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }
    const params = analysisIdParamSchema.safeParse(req.params);
    if (!params.success) {
      return error(res, ErrorCode.PARAM_INVALID, params.error.issues[0]?.message ?? '参数错误', 400);
    }
    await shareService.unshareAnalysis(params.data.id, req.tenantId, req.userId);
    return success(res, null, '已取消分享');
  } catch (err) {
    return next(err);
  }
};

// ============================================================
// Handlers — 挂载于 /org/feed 下
// ============================================================

/** GET /org/feed — 组织动态流列表(所有角色) */
export const listOrgFeed: RequestHandler = async (req, res, next) => {
  try {
    if (!req.userId || !req.tenantId) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }
    const query = listOrgFeedQuerySchema.safeParse(req.query);
    if (!query.success) {
      return error(res, ErrorCode.PARAM_INVALID, query.error.issues[0]?.message ?? '参数错误', 400);
    }
    // 跨租户协作角色(teacher/admin/owner)不按当前租户过滤
    const tenantScope = isCrossTenantRole(req.role) ? undefined : req.tenantId;
    const feed = await shareService.listOrgFeed(
      tenantScope,
      query.data.page,
      query.data.pageSize,
      query.data.workType,
    );
    return success(res, feed, 'success');
  } catch (err) {
    return next(err);
  }
};

/** DELETE /org/feed/:id — 删除分享(本人或 share:manage) */
export const deleteSharedWork: RequestHandler = async (req, res, next) => {
  try {
    if (!req.userId || !req.tenantId) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }
    const params = sharedWorkIdParamSchema.safeParse(req.params);
    if (!params.success) {
      return error(res, ErrorCode.PARAM_INVALID, params.error.issues[0]?.message ?? '参数错误', 400);
    }
    const tenantScope = isCrossTenantRole(req.role) ? undefined : req.tenantId;
    await shareService.deleteSharedWork(tenantScope, params.data.id, req.userId, resolveRole(req));
    return success(res, null, '已删除分享');
  } catch (err) {
    return next(err);
  }
};

/** POST /org/feed/:id/pin — 置顶(share:manage) */
export const pinSharedWork: RequestHandler = async (req, res, next) => {
  try {
    if (!req.userId || !req.tenantId) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }
    const params = sharedWorkIdParamSchema.safeParse(req.params);
    if (!params.success) {
      return error(res, ErrorCode.PARAM_INVALID, params.error.issues[0]?.message ?? '参数错误', 400);
    }
    const tenantScope = isCrossTenantRole(req.role) ? undefined : req.tenantId;
    const result = await shareService.setPinned(tenantScope, params.data.id, true);
    return success(res, result, '已置顶');
  } catch (err) {
    return next(err);
  }
};

/** DELETE /org/feed/:id/pin — 取消置顶(share:manage) */
export const unpinSharedWork: RequestHandler = async (req, res, next) => {
  try {
    if (!req.userId || !req.tenantId) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }
    const params = sharedWorkIdParamSchema.safeParse(req.params);
    if (!params.success) {
      return error(res, ErrorCode.PARAM_INVALID, params.error.issues[0]?.message ?? '参数错误', 400);
    }
    const tenantScope = isCrossTenantRole(req.role) ? undefined : req.tenantId;
    const result = await shareService.setPinned(tenantScope, params.data.id, false);
    return success(res, result, '已取消置顶');
  } catch (err) {
    return next(err);
  }
};

/** POST /org/feed/:id/comments — 发表评论(share:create) */
export const createShareComment: RequestHandler = async (req, res, next) => {
  try {
    if (!req.userId || !req.tenantId) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }
    const params = sharedWorkIdParamSchema.safeParse(req.params);
    if (!params.success) {
      return error(res, ErrorCode.PARAM_INVALID, params.error.issues[0]?.message ?? '参数错误', 400);
    }
    const body = createCommentSchema.safeParse(req.body);
    if (!body.success) {
      return error(res, ErrorCode.PARAM_INVALID, body.error.issues[0]?.message ?? '参数错误', 400);
    }
    const tenantScope = isCrossTenantRole(req.role) ? undefined : req.tenantId;
    const comment = await shareService.createComment(
      tenantScope,
      params.data.id,
      req.userId,
      body.data.content,
    );
    return success(res, comment, '评论已发表');
  } catch (err) {
    return next(err);
  }
};

/** GET /org/feed/:id/comments — 评论列表(所有角色) */
export const listShareComments: RequestHandler = async (req, res, next) => {
  try {
    if (!req.userId || !req.tenantId) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }
    const params = sharedWorkIdParamSchema.safeParse(req.params);
    if (!params.success) {
      return error(res, ErrorCode.PARAM_INVALID, params.error.issues[0]?.message ?? '参数错误', 400);
    }
    const tenantScope = isCrossTenantRole(req.role) ? undefined : req.tenantId;
    const comments = await shareService.listComments(tenantScope, params.data.id);
    return success(res, comments, 'success');
  } catch (err) {
    return next(err);
  }
};

/** DELETE /org/feed/:id/comments/:cid — 删除评论(本人或 share:manage) */
export const deleteShareComment: RequestHandler = async (req, res, next) => {
  try {
    if (!req.userId || !req.tenantId) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }
    const params = commentIdParamSchema.safeParse(req.params);
    if (!params.success) {
      return error(res, ErrorCode.PARAM_INVALID, params.error.issues[0]?.message ?? '参数错误', 400);
    }
    const tenantScope = isCrossTenantRole(req.role) ? undefined : req.tenantId;
    await shareService.deleteComment(
      tenantScope,
      params.data.id,
      params.data.cid,
      req.userId,
      resolveRole(req),
    );
    return success(res, null, '评论已删除');
  } catch (err) {
    return next(err);
  }
};
