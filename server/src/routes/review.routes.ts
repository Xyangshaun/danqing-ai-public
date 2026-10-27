// ============================================================
// 评委评审路由(Phase 5)
// 对应 API(嵌套在 /analyses/:id 下):
//   POST /analyses/:id/reviews           (提交评审,review:write)
//   GET  /analyses/:id/reviews           (列出该作业所有评审,review:read)
//   GET  /analyses/:id/reviews/:rid      (评审详情,review:read)
//   POST /analyses/:id/disputes/check    (检查并触发争议仲裁,review:write)
//   POST /analyses/:id/disputes/request  (学生申请人工复核,dispute:request)
//   GET    /analyses/:id/annotations     (列出标注级教师批注,review:read)
//   POST   /analyses/:id/annotations     (创建教师批注,review:write)
//   PATCH  /analyses/:id/annotations/:aid (更新批注,review:write,仅作者本人)
//   DELETE /analyses/:id/annotations/:aid (删除批注,review:write,仅作者本人)
//
// 挂载方式:在 analysis.routes.ts 中通过 analysisRouter.use('/:id', reviewRouter) 挂载
//   - 继承父级 authMiddleware → tenantMiddleware → apiRateLimiter
//   - :id 参数由父级路由解析,需显式启用 mergeParams:true 才能在子路由 handler 中访问
//
// 权限矩阵:
//   读类(GET):review:read(租户内所有角色)
//   写类(POST/PATCH/DELETE):review:write(teacher/admin/owner)
// ============================================================

import { Router } from 'express';
import { requirePermission } from '../middlewares/permission.js';
import {
  createReview,
  listReviews,
  getReview,
  checkDispute,
  requestDispute,
} from '../controllers/review.controller.js';
// 反馈闭环 Phase 4 批次③:标注级教师批注(复用 review 读写权限码)
import {
  listAnnotations,
  createAnnotation,
  updateAnnotation,
  deleteAnnotation,
} from '../controllers/teacher-annotation.controller.js';

// mergeParams:true 使子路由可访问父级 :id 参数(Express 4 默认 false)
export const reviewRouter: Router = Router({ mergeParams: true });

// ---------- 业务路由 ----------
// 注意:此处路径相对于父级 /analyses/:id,即:
//   reviewRouter.post('/reviews') → POST /analyses/:id/reviews

// POST /reviews - 提交评审(teacher/admin/owner)
reviewRouter.post('/reviews', requirePermission('review:write'), createReview);

// GET /reviews - 列出该作业的所有评审(租户内所有角色)
reviewRouter.get('/reviews', requirePermission('review:read'), listReviews);

// GET /reviews/:rid - 评审详情
// 注意:此路由必须在 /reviews 之外注册,Express 会按定义顺序匹配
// /reviews 已匹配固定路径,不会与 /reviews/:rid 冲突
reviewRouter.get('/reviews/:rid', requirePermission('review:read'), getReview);

// POST /disputes/check - 检查并触发争议仲裁(teacher/admin/owner)
// 路径 /disputes/check 与 /reviews/* 不冲突,Express 按段匹配
reviewRouter.post('/disputes/check', requirePermission('review:write'), checkDispute);

// POST /disputes/request - 学生申请人工复核(student,dispute:request)
// 与 /disputes/check 均为静态段,无冲突;权限独立于 review:write
reviewRouter.post('/disputes/request', requirePermission('dispute:request'), requestDispute);

// ---------- 反馈闭环 Phase 4 批次③:标注级教师批注 ----------
// GET /annotations - 列出该分析的全部批注(review:read;
//   service 层再做归属:student 仅可读自己作品的批注)
reviewRouter.get('/annotations', requirePermission('review:read'), listAnnotations);

// POST /annotations - 创建批注(teacher/admin/owner;service 层查重 409 + 通知学生)
reviewRouter.post('/annotations', requirePermission('review:write'), createAnnotation);

// PATCH /annotations/:aid - 更新批注(仅作者本人;service 层统一 404 不泄露原因)
reviewRouter.patch('/annotations/:aid', requirePermission('review:write'), updateAnnotation);

// DELETE /annotations/:aid - 删除批注(仅作者本人)
reviewRouter.delete('/annotations/:aid', requirePermission('review:write'), deleteAnnotation);
