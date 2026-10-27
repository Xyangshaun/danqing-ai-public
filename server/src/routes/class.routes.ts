// ============================================================
// 班级管理路由(班级即租户 type='class')
// 对应 API(挂载 /api/v1/classes):
//   POST /classes                                               创建班级(review:write)
//   GET  /classes                                               我的班级列表(review:read)
//   GET  /classes/:id                                           班级详情+成员(review:read)
//   POST /classes/:id/invitations                               生成邀请码(review:write)
//   GET  /classes/:id/invitations                               邀请码列表(review:read)
//   GET  /classes/:id/students/:userId/works                    学生作品列表(review:read)
//   POST /classes/:id/students/:userId/works/:analysisId/review 教师打分(review:write)
//   GET  /classes/:id/messages                                  班级消息列表(review:read,含学生)
//   POST /classes/:id/messages                                  发送班级消息(review:read,含学生)
//   GET  /classes/:id/shared-analyses/:analysisId               查看分享报告(review:read,含学生)
//
// 中间件链路:authMiddleware → tenantMiddleware → apiRateLimiter → permission → handler
//   - tenantMiddleware 仅保证 JWT 含 tenantId(当前激活租户);
//     班级成员资格(:id 与用户的归属关系)由 service 层 assertMembership 强制校验
//
// 权限矩阵:
//   review:read  - teacher/admin/owner(查看班级/邀请码/学生作品)
//   review:write - teacher/admin/owner(创建班级/生成邀请码/打分)
// ============================================================

import { Router } from 'express';
import { authMiddleware } from '../middlewares/auth.js';
import { tenantMiddleware } from '../middlewares/tenant.js';
import { apiRateLimiter } from '../middlewares/rate-limit.js';
import { requirePermission } from '../middlewares/permission.js';
import * as classController from '../controllers/class.controller.js';

export const classRouter: Router = Router();

// ---------- 全局中间件 ----------
classRouter.use(authMiddleware);
classRouter.use(tenantMiddleware);
classRouter.use(apiRateLimiter());

// ---------- 班级管理 ----------

// POST / - 创建班级(teacher/admin/owner)
classRouter.post('/', requirePermission('review:write'), classController.createClass);

// GET / - 我的班级列表(含成员数)
classRouter.get('/', requirePermission('review:read'), classController.listMyClasses);

// GET /:id - 班级详情 + 成员列表
classRouter.get('/:id', requirePermission('review:read'), classController.getClassDetail);

// ---------- 班级邀请码 ----------

// POST /:id/invitations - 生成邀请码(role 固定 student)
classRouter.post('/:id/invitations', requirePermission('review:write'), classController.createClassInvitation);

// GET /:id/invitations - 邀请码列表
classRouter.get('/:id/invitations', requirePermission('review:read'), classController.listClassInvitations);

// ---------- 学生作品查看 + 打分 ----------

// GET /:id/students/:userId/works - 学生在班级中的作品/诊断列表(分页)
classRouter.get('/:id/students/:userId/works', requirePermission('review:read'), classController.getClassStudentWorks);

// POST /:id/students/:userId/works/:analysisId/review - 教师打分(reviewerType 固定 professor)
classRouter.post(
  '/:id/students/:userId/works/:analysisId/review',
  requirePermission('review:write'),
  classController.submitClassReview,
);

// ---------- 班级讨论(聊天框 + 分享诊断报告,班级成员含学生可用) ----------

// GET /:id/messages - 拉取班级消息(初始/增量/翻页三模式)
classRouter.get('/:id/messages', requirePermission('review:read'), classController.listMessages);

// POST /:id/messages - 发送班级消息(文本/分享诊断报告)
classRouter.post('/:id/messages', requirePermission('review:read'), classController.sendMessage);

// GET /:id/shared-analyses/:analysisId - 查看被分享到班级的诊断报告
classRouter.get(
  '/:id/shared-analyses/:analysisId',
  requirePermission('review:read'),
  classController.getSharedAnalysis,
);
