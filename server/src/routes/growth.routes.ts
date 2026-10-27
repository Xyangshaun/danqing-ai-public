// ============================================================
// 成长曲线路由
// 对应 API:
//   GET /api/v1/growth  (获取成长曲线数据)
//
// 权限矩阵:
//   - 所有角色(student/teacher/admin/owner)拥有 analysis:read:own
//   - teacher/admin/owner 额外拥有 analysis:read:tenant
//   requireAnyPermission('analysis:read:own', 'analysis:read:tenant') 全角色可访问
//
// 数据范围过滤(service 层基于 role 实现):
//   - student:仅看自己的成长数据(忽略 query.userId 越权)
//   - teacher/admin/owner:可传 userId 查看指定学生;不传则聚合租户全量
// ============================================================

import { Router } from 'express';
import { authMiddleware } from '../middlewares/auth.js';
import { tenantMiddleware } from '../middlewares/tenant.js';
import { apiRateLimiter } from '../middlewares/rate-limit.js';
import { requireAnyPermission } from '../middlewares/permission.js';
import { getGrowthData } from '../controllers/growth.controller.js';

export const growthRouter: Router = Router();

// ---------- 全局中间件 ----------
growthRouter.use(authMiddleware);
growthRouter.use(tenantMiddleware);
growthRouter.use(apiRateLimiter());

// ---------- 业务路由 ----------
// GET /growth - 获取成长曲线数据
growthRouter.get(
  '/',
  requireAnyPermission('analysis:read:own', 'analysis:read:tenant'),
  getGrowthData,
);
