// ============================================================
// 组织动态流路由(报告导出+组织分享特性)
// 对应 API(挂载 /api/v1/org/feed):
//   GET    /org/feed                     组织动态流列表(所有角色)
//   DELETE /org/feed/:id                 删除分享(本人/share:manage)
//   POST   /org/feed/:id/pin             置顶(share:manage)
//   DELETE /org/feed/:id/pin             取消置顶(share:manage)
//   POST   /org/feed/:id/comments        发表评论(share:create)
//   GET    /org/feed/:id/comments        评论列表(所有角色)
//   DELETE /org/feed/:id/comments/:cid   删除评论(本人/share:manage)
//
// 权限矩阵:
//   - 查看动态流/评论:租户内所有角色(student/teacher/admin/owner)
//   - 发表评论:share:create(所有角色)
//   - 删除自己分享/评论:share:create(service 层校验归属)
//   - 删除他人分享/评论 + 置顶:share:manage(teacher/admin/owner)
//
// 中间件链路:authMiddleware → tenantMiddleware → apiRateLimiter → permission → handler
// ============================================================

import { Router } from 'express';
import { authMiddleware } from '../middlewares/auth.js';
import { tenantMiddleware } from '../middlewares/tenant.js';
import { apiRateLimiter } from '../middlewares/rate-limit.js';
import { requirePermission } from '../middlewares/permission.js';
import {
  listOrgFeed,
  deleteSharedWork,
  pinSharedWork,
  unpinSharedWork,
  createShareComment,
  listShareComments,
  deleteShareComment,
} from '../controllers/share.controller.js';

export const shareRouter: Router = Router();

// ---------- 全局中间件 ----------
shareRouter.use(authMiddleware);
shareRouter.use(tenantMiddleware);
shareRouter.use(apiRateLimiter());

// ---------- 业务路由 ----------

// GET /org/feed - 组织动态流列表(租户内所有角色,复用 share:create 作为入口权限)
shareRouter.get('/', requirePermission('share:create'), listOrgFeed);

// DELETE /org/feed/:id - 删除分享(本人或 share:manage,service 层做归属校验)
// 入口权限 share:create(所有角色);删除他人时 service 层再校验 share:manage
shareRouter.delete('/:id', requirePermission('share:create'), deleteSharedWork);

// POST /org/feed/:id/pin - 置顶(share:manage,teacher/admin/owner)
shareRouter.post('/:id/pin', requirePermission('share:manage'), pinSharedWork);

// DELETE /org/feed/:id/pin - 取消置顶(share:manage)
shareRouter.delete('/:id/pin', requirePermission('share:manage'), unpinSharedWork);

// POST /org/feed/:id/comments - 发表评论(share:create,所有角色)
shareRouter.post('/:id/comments', requirePermission('share:create'), createShareComment);

// GET /org/feed/:id/comments - 评论列表(所有角色)
shareRouter.get('/:id/comments', requirePermission('share:create'), listShareComments);

// DELETE /org/feed/:id/comments/:cid - 删除评论(本人或 share:manage,service 层归属校验)
shareRouter.delete('/:id/comments/:cid', requirePermission('share:create'), deleteShareComment);
