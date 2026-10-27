// ============================================================
// 订阅路由
// 对应 API:
//   GET    /subscriptions/current      (需鉴权 + subscription:read)
//   GET    /subscriptions/plans        (需鉴权 + subscription:read)
//   GET    /subscriptions/usage        (需鉴权 + subscription:read)
//   POST   /subscriptions/upgrade      (需鉴权 + subscription:update,仅 admin/owner)
//   POST   /subscriptions/cancel       (需鉴权 + subscription:update,仅 admin/owner)
//   GET    /subscriptions/invoices     (需鉴权 + subscription:read)
//
// 权限矩阵:
//   - 所有角色(student/teacher/admin/owner)拥有 subscription:read
//   - 仅 admin/owner 拥有 subscription:update(升级/取消订阅)
// ============================================================

import { Router } from 'express';
import {
  getCurrentSubscription,
  listPlans,
  getUsage,
  upgradePlan,
  cancelSubscription,
  listInvoices,
} from '../controllers/subscription.controller.js';
import { authMiddleware } from '../middlewares/auth.js';
import { tenantMiddleware } from '../middlewares/tenant.js';
import { apiRateLimiter } from '../middlewares/rate-limit.js';
import {
  requirePermission,
} from '../middlewares/permission.js';

export const subscriptionRouter: Router = Router();

// ---------- 全局中间件 ----------
subscriptionRouter.use(authMiddleware);
subscriptionRouter.use(tenantMiddleware);
subscriptionRouter.use(apiRateLimiter());

// ---------- 业务路由 ----------

// GET /subscriptions/current - 获取当前订阅信息
subscriptionRouter.get('/current', requirePermission('subscription:read'), getCurrentSubscription);

// GET /subscriptions/plans - 列出可用计划
subscriptionRouter.get('/plans', requirePermission('subscription:read'), listPlans);

// GET /subscriptions/usage - 获取配额使用情况
subscriptionRouter.get('/usage', requirePermission('subscription:read'), getUsage);

// GET /subscriptions/invoices - 发票列表(分页)
subscriptionRouter.get('/invoices', requirePermission('subscription:read'), listInvoices);

// POST /subscriptions/upgrade - 升级/切换计划(仅 admin/owner)
subscriptionRouter.post('/upgrade', requirePermission('subscription:update'), upgradePlan);

// POST /subscriptions/cancel - 取消订阅(仅 admin/owner)
subscriptionRouter.post('/cancel', requirePermission('subscription:update'), cancelSubscription);
