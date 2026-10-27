// ============================================================
// 订阅 Controller
// 对应 API:
//   GET    /subscriptions/current      获取当前订阅(需 subscription:read)
//   GET    /subscriptions/plans        列出可用计划(需 subscription:read)
//   GET    /subscriptions/usage        获取配额使用情况(需 subscription:read)
//   POST   /subscriptions/upgrade      升级/切换计划(需 subscription:update)
//   POST   /subscriptions/cancel       取消订阅(需 subscription:update)
//   GET    /subscriptions/invoices     发票列表(需 subscription:read)
//
// 输入校验:Zod schema,所有外部输入经校验后进入 service
// 响应格式:{code, message, data, traceId}
// ============================================================

import type { RequestHandler } from 'express';
import { z } from 'zod';
import { subscriptionService } from '../services/subscription.service.js';
import { success, error } from '../utils/response.js';
import { ErrorCode, type TenantPlan } from '../types/api-contract.js';

/**
 * POST /subscriptions/upgrade 请求体 schema
 */
const upgradePlanBodySchema = z.object({
  plan: z.enum(['free', 'standard', 'enterprise'], {
    message: 'plan 必须为 free/standard/enterprise 之一',
  }),
  paymentProvider: z
    .enum(['stripe', 'alipay', 'wechat', 'manual'], {
      message: 'paymentProvider 必须为 stripe/alipay/wechat/manual 之一',
    })
    .optional(),
  paymentToken: z.string().max(128).optional(),
});

/**
 * GET /subscriptions/invoices 查询参数 schema
 */
const listInvoicesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z
    .enum(['pending', 'paid', 'failed', 'refunded'], {
      message: 'status 必须为 pending/paid/failed/refunded 之一',
    })
    .optional(),
});

/**
 * GET /subscriptions/current
 * 获取当前租户的订阅信息(含配额使用情况)
 */
export const getCurrentSubscription: RequestHandler = async (req, res, next) => {
  try {
    if (!req.tenantId) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }
    const sub = await subscriptionService.getCurrentSubscription(req.tenantId);
    return success(res, sub, 'success');
  } catch (err) {
    return next(err);
  }
};

/**
 * GET /subscriptions/plans
 * 列出所有可用订阅计划(静态配置,无需租户校验)
 */
export const listPlans: RequestHandler = async (_req, res, next) => {
  try {
    const plans = subscriptionService.listPlans();
    return success(res, plans, 'success');
  } catch (err) {
    return next(err);
  }
};

/**
 * GET /subscriptions/usage
 * 获取当前租户的配额使用情况
 */
export const getUsage: RequestHandler = async (req, res, next) => {
  try {
    if (!req.tenantId) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }
    const usage = await subscriptionService.getUsage(req.tenantId);
    return success(res, usage, 'success');
  } catch (err) {
    return next(err);
  }
};

/**
 * POST /subscriptions/upgrade
 * 升级/切换订阅计划(需 subscription:update 权限,仅 admin/owner)
 */
export const upgradePlan: RequestHandler = async (req, res, next) => {
  try {
    if (!req.tenantId) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }

    const parsed = upgradePlanBodySchema.safeParse(req.body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const msg = `参数错误:${first?.path.join('.') ?? 'unknown'} ${first?.message ?? 'invalid'}`;
      return error(res, ErrorCode.PARAM_INVALID, msg, 400);
    }

    const result = await subscriptionService.upgradePlan({
      tenantId: req.tenantId,
      body: {
        plan: parsed.data.plan as TenantPlan,
        paymentProvider: parsed.data.paymentProvider,
        paymentToken: parsed.data.paymentToken,
      },
    });

    return success(res, result, '订阅升级成功');
  } catch (err) {
    return next(err);
  }
};

/**
 * POST /subscriptions/cancel
 * 取消订阅(周期结束自动失效,需 subscription:update 权限)
 */
export const cancelSubscription: RequestHandler = async (req, res, next) => {
  try {
    if (!req.tenantId) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }
    const result = await subscriptionService.cancelSubscription(req.tenantId);
    return success(res, result, '订阅已取消,将在周期结束后失效');
  } catch (err) {
    return next(err);
  }
};

/**
 * GET /subscriptions/invoices
 * 查询发票列表(分页,支持 status 筛选)
 */
export const listInvoices: RequestHandler = async (req, res, next) => {
  try {
    if (!req.tenantId) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }

    const parsed = listInvoicesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const msg = `参数错误:${first?.path.join('.') ?? 'unknown'} ${first?.message ?? 'invalid'}`;
      return error(res, ErrorCode.PARAM_INVALID, msg, 400);
    }

    const result = await subscriptionService.listInvoices({
      tenantId: req.tenantId,
      page: parsed.data.page,
      pageSize: parsed.data.pageSize,
      status: parsed.data.status,
    });

    return success(res, result, 'success');
  } catch (err) {
    return next(err);
  }
};
