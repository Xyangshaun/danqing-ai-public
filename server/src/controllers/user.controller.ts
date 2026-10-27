// ============================================================
// 用户 Controller
// 对应 API:
//   GET   /users/profile
//   PATCH /users/profile
//   PATCH /users/role     (新手引导 onboarding 自选角色)
// ============================================================

import type { RequestHandler } from 'express';
import { z } from 'zod';
import { userService } from '../services/user.service.js';
import { success } from '../utils/response.js';
import { ErrorCode } from '../types/api-contract.js';
import { error } from '../utils/response.js';

/**
 * PATCH /users/role 请求体 Zod 校验
 * - role 必须为 admin/teacher/student 之一(禁止 owner,owner 由系统赋值)
 */
const updateRoleSchema = z.object({
  role: z.enum(['admin', 'teacher', 'student']),
});

/**
 * PATCH /users/learner-profile 请求体 Zod 校验
 * - learnerProfile 必须为 hobbyist/beginner/artStudent 之一
 */
const updateLearnerProfileSchema = z.object({
  learnerProfile: z.enum(['hobbyist', 'beginner', 'artStudent']),
});

/**
 * GET /users/profile
 */
export const getProfile: RequestHandler = async (req, res, next) => {
  try {
    if (!req.userId) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }
    const profile = await userService.getProfile(req.userId);
    return success(res, profile, 'success');
  } catch (err) {
    return next(err);
  }
};

/**
 * PATCH /users/profile
 */
export const updateProfile: RequestHandler = async (req, res, next) => {
  try {
    if (!req.userId || !req.tenantId) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }
    const profile = await userService.updateProfile(req.userId, req.tenantId, req.body);
    return success(res, profile, '资料已更新');
  } catch (err) {
    return next(err);
  }
};

/**
 * PATCH /users/role
 * 首次登录新手引导(onboarding)选择职业身份。
 * 业务规则由 user.service.setRole 强制:
 *   - 仅允许当前 role='student'(默认角色)的用户自选一次
 */
export const updateRole: RequestHandler = async (req, res, next) => {
  try {
    if (!req.userId || !req.tenantId) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }
    // Zod 校验 role 字段(失败抛 ZodError,由 errorHandler 转 1001 PARAM_INVALID)
    const parsed = updateRoleSchema.parse(req.body);
    const profile = await userService.setRole(req.userId, req.tenantId, parsed);
    return success(res, profile, '职业身份已设置');
  } catch (err) {
    return next(err);
  }
};

/**
 * PATCH /users/learner-profile
 * onboarding 二级选择 + 设置页修改学习者画像。
 * 所有已认证用户均可设置/修改(非一次性,区别于 role)。
 */
export const updateLearnerProfile: RequestHandler = async (req, res, next) => {
  try {
    if (!req.userId || !req.tenantId) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }
    const parsed = updateLearnerProfileSchema.parse(req.body);
    const profile = await userService.setLearnerProfile(req.userId, req.tenantId, parsed);
    return success(res, profile, '学习者画像已设置');
  } catch (err) {
    return next(err);
  }
};
