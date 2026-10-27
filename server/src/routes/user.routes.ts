// ============================================================
// 用户路由
// 对应 API:
//   GET   /users/profile  (需鉴权;查看自己的资料,所有角色可访问)
//   PATCH /users/profile  (需鉴权 + user:update:own)
//   PATCH /users/role     (需鉴权 + user:update:own;新手引导自选角色)
//
// 注:GET /users/profile 是自助接口(查看自己的资料),
//     不需要 user:read 权限(该权限用于查看租户内其他成员)。
//     若加 user:read 会导致 STUDENT 角色无法查看自己的资料(破坏现有测试)。
//
// PATCH /users/role 业务规则(由 user.service.setRole 强制):
//   - 仅允许当前 role='student'(首次登录默认)的用户自选一次
//   - 所有角色都拥有 user:update:own 权限,故权限校验放行;
//     "仅可自选一次" 的约束在 service 层基于 role 判定
// ============================================================

import { Router } from 'express';
import {
  getProfile,
  updateProfile,
  updateRole,
  updateLearnerProfile,
} from '../controllers/user.controller.js';
import { authMiddleware } from '../middlewares/auth.js';
import { tenantMiddleware } from '../middlewares/tenant.js';
import { apiRateLimiter } from '../middlewares/rate-limit.js';
import { requirePermission } from '../middlewares/permission.js';

export const userRouter: Router = Router();

// ---------- 全局中间件 ----------
userRouter.use(authMiddleware);
userRouter.use(tenantMiddleware);
userRouter.use(apiRateLimiter());

// ---------- 业务路由 ----------

// GET /users/profile - 查看自己的资料(所有已认证用户可访问)
userRouter.get('/profile', getProfile);

// PATCH /users/profile - 更新自己的资料(需 user:update:own,所有角色均拥有此权限)
userRouter.patch('/profile', requirePermission('user:update:own'), updateProfile);

// PATCH /users/role - 新手引导自选角色(需 user:update:own;仅 student 默认角色可自选)
userRouter.patch('/role', requirePermission('user:update:own'), updateRole);

// PATCH /users/learner-profile - 学习者画像(onboarding 二级选择 + 设置页修改;所有角色可用)
userRouter.patch(
  '/learner-profile',
  requirePermission('user:update:own'),
  updateLearnerProfile,
);
