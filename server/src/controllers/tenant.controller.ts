// ============================================================
// 租户 Controller
// 对应 API:
//   GET    /tenants/current                       获取当前租户
//   POST   /tenants/switch                        切换激活租户
//   GET    /tenants                               列出用户所有租户
//   GET    /tenants/:id/members                   列出租户成员
//   POST   /tenants/:id/members                   邀请成员
//   DELETE /tenants/:id/members/:userId           移除成员
//
// 输入校验:Zod schema,所有外部输入经校验后进入 service
// 响应格式:{code, message, data, traceId}
// ============================================================

import type { RequestHandler } from 'express';
import { z } from 'zod';
import { tenantService } from '../services/tenant.service.js';
import { success, error } from '../utils/response.js';
import { ErrorCode, type UserRole } from '../types/api-contract.js';

/**
 * POST /tenants/switch 请求体 schema
 */
const switchTenantBodySchema = z.object({
  tenantId: z.string().min(1, '缺少必填参数:tenantId'),
});

/**
 * POST /tenants/:id/members 请求体 schema
 */
const inviteMemberBodySchema = z.object({
  userId: z.string().min(1, '缺少必填参数:userId'),
  role: z.enum(['admin', 'teacher', 'student', 'owner'], {
    message: 'role 必须为 admin/teacher/student/owner 之一',
  }),
});

/**
 * GET /tenants/:id/members / DELETE /tenants/:id/members/:userId 路径参数 schema
 */
const tenantIdParamSchema = z.object({
  id: z.string().min(1, '缺少必填参数:id'),
});

const removeMemberParamSchema = z.object({
  id: z.string().min(1, '缺少必填参数:id'),
  userId: z.string().min(1, '缺少必填参数:userId'),
});

/**
 * GET /tenants/current
 */
export const getCurrentTenant: RequestHandler = async (req, res, next) => {
  try {
    if (!req.tenantId) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }
    const tenant = await tenantService.getCurrentTenant(req.tenantId);
    return success(res, tenant, 'success');
  } catch (err) {
    return next(err);
  }
};

/**
 * POST /tenants/switch
 * 切换激活租户,返回新的 access_token(含新 tenant_id + role)
 */
export const switchTenant: RequestHandler = async (req, res, next) => {
  try {
    // 仅要求已认证(userId);feishuOpenId 对密码/邀请码/手机账号为空字符串,
    // 属于合法登录态,不得作为 401 判定依据(否则非飞书账号无法切换租户/加入班级)
    if (!req.userId) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }

    const parsed = switchTenantBodySchema.safeParse(req.body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const msg = `参数错误:${first?.path.join('.') ?? 'unknown'} ${first?.message ?? 'invalid'}`;
      return error(res, ErrorCode.PARAM_INVALID, msg, 400);
    }

    // client 收窄:'marketing' 不支持签发 token,默认 fallback 'web'
    const client: 'web' | 'admin' | 'mobile' =
      req.client === 'admin' || req.client === 'mobile' ? req.client : 'web';

    const result = await tenantService.switchTenant({
      userId: req.userId,
      targetTenantId: parsed.data.tenantId,
      feishuOpenId: req.feishuOpenId ?? '',
      client,
    });

    return success(res, result, '租户切换成功');
  } catch (err) {
    return next(err);
  }
};

/**
 * GET /tenants
 * 列出当前用户的所有租户成员关系(可切换的租户列表)
 */
export const listUserTenants: RequestHandler = async (req, res, next) => {
  try {
    if (!req.userId) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }
    const tenants = await tenantService.listUserTenants(req.userId);
    return success(res, tenants, 'success');
  } catch (err) {
    return next(err);
  }
};

/**
 * GET /tenants/:id/members
 * 列出租户全部成员(需 user:read 权限,由路由层中间件校验)
 */
export const listMembers: RequestHandler = async (req, res, next) => {
  try {
    const parsed = tenantIdParamSchema.safeParse(req.params);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const msg = `参数错误:${first?.path.join('.') ?? 'unknown'} ${first?.message ?? 'invalid'}`;
      return error(res, ErrorCode.PARAM_INVALID, msg, 400);
    }

    const members = await tenantService.listMembers(parsed.data.id);
    return success(res, members, 'success');
  } catch (err) {
    return next(err);
  }
};

/**
 * POST /tenants/:id/members
 * 邀请用户加入租户(需 user:invite 权限,由路由层中间件校验)
 */
export const inviteMember: RequestHandler = async (req, res, next) => {
  try {
    if (!req.userId) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }

    const paramParsed = tenantIdParamSchema.safeParse(req.params);
    if (!paramParsed.success) {
      const first = paramParsed.error.issues[0];
      const msg = `参数错误:${first?.path.join('.') ?? 'unknown'} ${first?.message ?? 'invalid'}`;
      return error(res, ErrorCode.PARAM_INVALID, msg, 400);
    }

    const bodyParsed = inviteMemberBodySchema.safeParse(req.body);
    if (!bodyParsed.success) {
      const first = bodyParsed.error.issues[0];
      const msg = `参数错误:${first?.path.join('.') ?? 'unknown'} ${first?.message ?? 'invalid'}`;
      return error(res, ErrorCode.PARAM_INVALID, msg, 400);
    }

    const result = await tenantService.inviteMember({
      tenantId: paramParsed.data.id,
      targetUserId: bodyParsed.data.userId,
      role: bodyParsed.data.role as UserRole,
    });

    return success(res, result, '成员邀请成功');
  } catch (err) {
    return next(err);
  }
};

/**
 * DELETE /tenants/:id/members/:userId
 * 移除租户成员(需 user:remove 权限,由路由层中间件校验)
 */
export const removeMember: RequestHandler = async (req, res, next) => {
  try {
    if (!req.userId) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }

    const parsed = removeMemberParamSchema.safeParse(req.params);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const msg = `参数错误:${first?.path.join('.') ?? 'unknown'} ${first?.message ?? 'invalid'}`;
      return error(res, ErrorCode.PARAM_INVALID, msg, 400);
    }

    const result = await tenantService.removeMember({
      tenantId: parsed.data.id,
      targetUserId: parsed.data.userId,
      currentUserId: req.userId,
    });

    return success(res, result, '成员已移除');
  } catch (err) {
    return next(err);
  }
};
