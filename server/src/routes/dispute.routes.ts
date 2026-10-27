// ============================================================
// 争议仲裁路由(Phase 5)
// 对应 API(顶层 /disputes):
//   GET  /disputes                  (分页列出争议,dispute:read)
//   GET  /disputes/:id              (争议详情,dispute:read)
//   POST /disputes/:id/resolve      (裁定争议,dispute:resolve)
//   GET  /disputes/:id/result       (获取最终裁定结果,dispute:read)
//   POST /disputes/:id/apply-result (回写裁定分到 Analysis,dispute:resolve)
//
// 中间件链路:authMiddleware → tenantMiddleware → apiRateLimiter → permission → handler
// 权限矩阵:
//   读类(GET):dispute:read(租户内所有角色)
//   写类(POST):dispute:resolve(teacher/admin/owner)
// ============================================================

import { Router } from 'express';
import { authMiddleware } from '../middlewares/auth.js';
import { tenantMiddleware } from '../middlewares/tenant.js';
import { apiRateLimiter } from '../middlewares/rate-limit.js';
import { requirePermission } from '../middlewares/permission.js';
import {
  listDisputes,
  getDispute,
  resolveDispute,
  getDisputeResult,
  applyDisputeResult,
} from '../controllers/dispute.controller.js';

export const disputeRouter: Router = Router();

// ---------- 全局中间件 ----------
disputeRouter.use(authMiddleware);
disputeRouter.use(tenantMiddleware);
disputeRouter.use(apiRateLimiter());

// ---------- 业务路由 ----------

// GET /disputes - 分页列出争议(支持 status / level / analysisId 过滤)
disputeRouter.get('/', requirePermission('dispute:read'), listDisputes);

// GET /disputes/:id - 争议详情
disputeRouter.get('/:id', requirePermission('dispute:read'), getDispute);

// GET /disputes/:id/result - 获取最终裁定结果
// 注意:必须在 /:id/resolve 等动态子路径之前注册,但 /:id 已匹配固定路径
// /:id/result 不会被 /:id 截获,Express 按完整路径段匹配
disputeRouter.get('/:id/result', requirePermission('dispute:read'), getDisputeResult);

// POST /disputes/:id/resolve - 裁定争议(teacher/admin/owner)
disputeRouter.post('/:id/resolve', requirePermission('dispute:resolve'), resolveDispute);

// POST /disputes/:id/apply-result - 回写裁定结果到 Analysis(teacher/admin/owner)
disputeRouter.post('/:id/apply-result', requirePermission('dispute:resolve'), applyDisputeResult);
