// ============================================================
// 管理后台 Controller(Phase 4)
// 对应 API:/api/admin/*(5 大模块:用户/内容/订阅/数据看板/系统)
//
// 职责:
//   1. 从 Request 提取鉴权上下文(userId/tenantId/role)
//   2. 调用对应 service 方法处理业务逻辑
//   3. 通过 success/error 工具返回统一响应格式
//   4. 写操作将 Request 透传给 service 以记录审计日志
//
// 安全约束:
//   - tenant_id 强制从 JWT 注入(req.tenantId),禁止从请求体读取
//   - 所有响应经 service 层脱敏(手机/邮箱)
//   - 错误统一走 errorHandler,controller 仅 next(err)
// ============================================================

import type { RequestHandler } from 'express';
import { adminUserService } from '../services/admin-user.service.js';
import { adminContentService } from '../services/admin-content.service.js';
import { adminSubscriptionService } from '../services/admin-subscription.service.js';
import { adminStatsService } from '../services/admin-stats.service.js';
import { adminSystemService } from '../services/admin-system.service.js';
import { getConsistencyStats } from '../services/score-audit.service.js';
import { success, error } from '../utils/response.js';
import { ErrorCode } from '../types/api-contract.js';

// ============================================================
// 鉴权上下文守卫
// ============================================================

/**
 * 校验已认证上下文是否存在(userId + tenantId)
 * authMiddleware + tenantMiddleware 已保证注入,此处为防御性校验
 * @returns 上下文对象;校验失败返回 null(已写入错误响应)
 */
function requireAuthCtx(
  req: Parameters<RequestHandler>[0],
  res: Parameters<RequestHandler>[1],
): { userId: string; tenantId: string; role?: string } | null {
  if (!req.userId || !req.tenantId) {
    error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    return null;
  }
  return { userId: req.userId, tenantId: req.tenantId, role: req.role };
}

// ============================================================
// 3.10.1 用户管理模块
// ============================================================

/** GET /api/admin/users - 分页查询用户列表(响应脱敏) */
export const listUsers: RequestHandler = async (req, res, next) => {
  try {
    const ctx = requireAuthCtx(req, res);
    if (!ctx) return;
    const result = await adminUserService.listUsers(
      req.query as unknown as Parameters<typeof adminUserService.listUsers>[0],
      { tenantId: ctx.tenantId, role: ctx.role },
    );
    return success(res, result, 'success');
  } catch (err) {
    return next(err);
  }
};

/** GET /api/admin/users/:id - 查询用户详情(响应脱敏) */
export const getUser: RequestHandler = async (req, res, next) => {
  try {
    const ctx = requireAuthCtx(req, res);
    if (!ctx) return;
    const userId = req.params['id'] as string;
    const result = await adminUserService.getUser(userId, { tenantId: ctx.tenantId });
    return success(res, result, 'success');
  } catch (err) {
    return next(err);
  }
};

/** PATCH /api/admin/users/:id - 更新用户(角色/状态/资料)+ 审计日志 */
export const updateUser: RequestHandler = async (req, res, next) => {
  try {
    const ctx = requireAuthCtx(req, res);
    if (!ctx) return;
    const userId = req.params['id'] as string;
    const result = await adminUserService.updateUser(userId, req.body, {
      req,
      tenantId: ctx.tenantId,
      operatorId: ctx.userId,
    });
    return success(res, result, '用户已更新');
  } catch (err) {
    return next(err);
  }
};

/** POST /api/admin/users/:id/lock - 锁定/解锁用户 + 审计日志 */
export const lockUser: RequestHandler = async (req, res, next) => {
  try {
    const ctx = requireAuthCtx(req, res);
    if (!ctx) return;
    const userId = req.params['id'] as string;
    const result = await adminUserService.lockUser(userId, req.body, {
      req,
      tenantId: ctx.tenantId,
      operatorId: ctx.userId,
    });
    return success(res, result, 'success');
  } catch (err) {
    return next(err);
  }
};

/** POST /api/admin/users/batch - 批量操作用户(更新角色/删除)+ 审计日志 */
export const batchUsers: RequestHandler = async (req, res, next) => {
  try {
    const ctx = requireAuthCtx(req, res);
    if (!ctx) return;
    const result = await adminUserService.batchUsers(req.body, {
      req,
      tenantId: ctx.tenantId,
      operatorId: ctx.userId,
    });
    return success(res, result, 'success');
  } catch (err) {
    return next(err);
  }
};

/** GET /api/admin/users/export - 导出用户 CSV(脱敏后流式输出) */
export const exportUsers: RequestHandler = async (req, res, next) => {
  try {
    const ctx = requireAuthCtx(req, res);
    if (!ctx) return;
    const users = await adminUserService.listForExport(
      {
        search: req.query['search'] as string | undefined,
        tenantId: req.query['tenantId'] as string | undefined,
        role: req.query['role'] as Parameters<typeof adminUserService.listForExport>[0]['role'],
        status: req.query['status'] as Parameters<typeof adminUserService.listForExport>[0]['status'],
      },
      { tenantId: ctx.tenantId },
    );

    // 字段选择(默认全字段)
    const fieldsParam = (req.query['fields'] as string | undefined) ?? 'id,name,email,phone,role,status,createdAt';
    const fields = fieldsParam.split(',').map((f) => f.trim()).filter((f) => f.length > 0);

    // 转换为 CSV(表头 + 数据行)
    const csvLines: string[] = [fields.join(',')];
    for (const u of users) {
      const row = fields
        .map((f) => {
          const val = (u as unknown as Record<string, unknown>)[f];
          return csvEscape(val === null || val === undefined ? '' : String(val));
        })
        .join(',');
      csvLines.push(row);
    }
    const csv = csvLines.join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="users-${Date.now()}.csv"`);
    return res.status(200).send(csv);
  } catch (err) {
    return next(err);
  }
};

/** GET /api/admin/roles - 查询角色权限矩阵 */
export const listRoles: RequestHandler = async (_req, res, next) => {
  try {
    const result = adminUserService.listRoles();
    return success(res, result, 'success');
  } catch (err) {
    return next(err);
  }
};

/** PATCH /api/admin/roles/:role - 更新角色权限 + 审计日志 */
export const updateRole: RequestHandler = async (req, res, next) => {
  try {
    const ctx = requireAuthCtx(req, res);
    if (!ctx) return;
    const role = req.params['role'] as string;
    const result = await adminUserService.updateRole(
      role as Parameters<typeof adminUserService.updateRole>[0],
      req.body,
      { req, operatorId: ctx.userId },
    );
    return success(res, result, '角色权限已更新');
  } catch (err) {
    return next(err);
  }
};

// ============================================================
// 3.10.2 内容管理模块
// ============================================================

/** GET /api/admin/artworks - 分页查询作品列表 */
export const listArtworks: RequestHandler = async (req, res, next) => {
  try {
    const ctx = requireAuthCtx(req, res);
    if (!ctx) return;
    const result = await adminContentService.listArtworks(
      req.query as unknown as Parameters<typeof adminContentService.listArtworks>[0],
      { tenantId: ctx.tenantId },
    );
    return success(res, result, 'success');
  } catch (err) {
    return next(err);
  }
};

/** GET /api/admin/artworks/:id - 查询作品详情 */
export const getArtwork: RequestHandler = async (req, res, next) => {
  try {
    const ctx = requireAuthCtx(req, res);
    if (!ctx) return;
    const artworkId = req.params['id'] as string;
    const result = await adminContentService.getArtwork(artworkId, { tenantId: ctx.tenantId });
    return success(res, result, 'success');
  } catch (err) {
    return next(err);
  }
};

/** POST /api/admin/artworks/:id/review - 审核作品 + 审计日志 */
export const reviewArtwork: RequestHandler = async (req, res, next) => {
  try {
    const ctx = requireAuthCtx(req, res);
    if (!ctx) return;
    const artworkId = req.params['id'] as string;
    const result = await adminContentService.reviewArtwork(artworkId, req.body, {
      req,
      tenantId: ctx.tenantId,
      operatorId: ctx.userId,
    });
    return success(res, result, 'success');
  } catch (err) {
    return next(err);
  }
};

/** DELETE /api/admin/artworks/:id - 删除作品 + 审计日志 */
export const deleteArtwork: RequestHandler = async (req, res, next) => {
  try {
    const ctx = requireAuthCtx(req, res);
    if (!ctx) return;
    const artworkId = req.params['id'] as string;
    const result = await adminContentService.deleteArtwork(artworkId, {
      req,
      tenantId: ctx.tenantId,
    });
    return success(res, result, 'success');
  } catch (err) {
    return next(err);
  }
};

/** GET /api/admin/templates - 分页查询创意模板 */
export const listTemplates: RequestHandler = async (req, res, next) => {
  try {
    const ctx = requireAuthCtx(req, res);
    if (!ctx) return;
    const result = await adminContentService.listTemplates(
      req.query as unknown as Parameters<typeof adminContentService.listTemplates>[0],
    );
    return success(res, result, 'success');
  } catch (err) {
    return next(err);
  }
};

/** GET /api/admin/templates/:id - 查询模板详情 */
export const getTemplate: RequestHandler = async (req, res, next) => {
  try {
    const ctx = requireAuthCtx(req, res);
    if (!ctx) return;
    const templateId = req.params['id'] as string;
    const result = await adminContentService.getTemplate(templateId);
    return success(res, result, 'success');
  } catch (err) {
    return next(err);
  }
};

/** POST /api/admin/templates - 创建模板 + 审计日志 */
export const createTemplate: RequestHandler = async (req, res, next) => {
  try {
    const ctx = requireAuthCtx(req, res);
    if (!ctx) return;
    const result = await adminContentService.createTemplate(req.body, {
      req,
      operatorId: ctx.userId,
    });
    return success(res, result, '模板已创建');
  } catch (err) {
    return next(err);
  }
};

/** PATCH /api/admin/templates/:id - 更新模板 + 审计日志 */
export const updateTemplate: RequestHandler = async (req, res, next) => {
  try {
    const ctx = requireAuthCtx(req, res);
    if (!ctx) return;
    const templateId = req.params['id'] as string;
    const result = await adminContentService.updateTemplate(templateId, req.body, {
      req,
      operatorId: ctx.userId,
    });
    return success(res, result, '模板已更新');
  } catch (err) {
    return next(err);
  }
};

/** DELETE /api/admin/templates/:id - 删除模板 + 审计日志 */
export const deleteTemplate: RequestHandler = async (req, res, next) => {
  try {
    const ctx = requireAuthCtx(req, res);
    if (!ctx) return;
    const templateId = req.params['id'] as string;
    const result = await adminContentService.deleteTemplate(templateId, { req });
    return success(res, result, 'success');
  } catch (err) {
    return next(err);
  }
};

// ============================================================
// 3.10.3 订阅管理模块
// ============================================================

/** GET /api/admin/subscriptions - 分页查询订阅列表 */
export const listSubscriptions: RequestHandler = async (req, res, next) => {
  try {
    const ctx = requireAuthCtx(req, res);
    if (!ctx) return;
    const result = await adminSubscriptionService.listSubscriptions(
      req.query as unknown as Parameters<typeof adminSubscriptionService.listSubscriptions>[0],
      { tenantId: ctx.tenantId },
    );
    return success(res, result, 'success');
  } catch (err) {
    return next(err);
  }
};

/** GET /api/admin/subscriptions/:id - 查询订阅详情 */
export const getSubscription: RequestHandler = async (req, res, next) => {
  try {
    const ctx = requireAuthCtx(req, res);
    if (!ctx) return;
    const subscriptionId = req.params['id'] as string;
    const result = await adminSubscriptionService.getSubscription(subscriptionId, {
      tenantId: ctx.tenantId,
    });
    return success(res, result, 'success');
  } catch (err) {
    return next(err);
  }
};

/** POST /api/admin/subscriptions/:id/cancel - 管理员取消订阅 + 审计日志 */
export const cancelSubscription: RequestHandler = async (req, res, next) => {
  try {
    const ctx = requireAuthCtx(req, res);
    if (!ctx) return;
    const subscriptionId = req.params['id'] as string;
    const result = await adminSubscriptionService.cancelSubscription(subscriptionId, {
      req,
      tenantId: ctx.tenantId,
    });
    return success(res, result, 'success');
  } catch (err) {
    return next(err);
  }
};

/** POST /api/admin/subscriptions/:id/refund - 退款处理 + 审计日志 */
export const refundSubscription: RequestHandler = async (req, res, next) => {
  try {
    const ctx = requireAuthCtx(req, res);
    if (!ctx) return;
    const subscriptionId = req.params['id'] as string;
    const result = await adminSubscriptionService.refundSubscription(subscriptionId, req.body, {
      req,
      tenantId: ctx.tenantId,
    });
    return success(res, result, 'success');
  } catch (err) {
    return next(err);
  }
};

/** GET /api/admin/invoices - 分页查询发票列表 */
export const listInvoices: RequestHandler = async (req, res, next) => {
  try {
    const ctx = requireAuthCtx(req, res);
    if (!ctx) return;
    const result = await adminSubscriptionService.listInvoices(
      req.query as unknown as Parameters<typeof adminSubscriptionService.listInvoices>[0],
      { tenantId: ctx.tenantId },
    );
    return success(res, result, 'success');
  } catch (err) {
    return next(err);
  }
};

/** GET /api/admin/invoices/:id - 查询发票详情 */
export const getInvoice: RequestHandler = async (req, res, next) => {
  try {
    const ctx = requireAuthCtx(req, res);
    if (!ctx) return;
    const invoiceId = req.params['id'] as string;
    const result = await adminSubscriptionService.getInvoice(invoiceId, { tenantId: ctx.tenantId });
    return success(res, result, 'success');
  } catch (err) {
    return next(err);
  }
};

/** GET /api/admin/plans - 查询套餐列表 */
export const listPlans: RequestHandler = async (_req, res, next) => {
  try {
    const result = adminSubscriptionService.listPlans();
    return success(res, result, 'success');
  } catch (err) {
    return next(err);
  }
};

/** POST /api/admin/plans - 创建套餐 + 审计日志 */
export const createPlan: RequestHandler = async (req, res, next) => {
  try {
    const ctx = requireAuthCtx(req, res);
    if (!ctx) return;
    const result = await adminSubscriptionService.createPlan(req.body, { req });
    return success(res, result, '套餐已创建');
  } catch (err) {
    return next(err);
  }
};

/** PATCH /api/admin/plans/:id - 更新套餐 + 审计日志 */
export const updatePlan: RequestHandler = async (req, res, next) => {
  try {
    const ctx = requireAuthCtx(req, res);
    if (!ctx) return;
    const planId = req.params['id'] as string;
    const result = await adminSubscriptionService.updatePlan(planId, req.body, { req });
    return success(res, result, '套餐已更新');
  } catch (err) {
    return next(err);
  }
};

// ============================================================
// 3.10.4 数据看板模块
// ============================================================

/** GET /api/admin/stats/overview - 总览统计(Redis 缓存 1 分钟) */
export const getStatsOverview: RequestHandler = async (_req, res, next) => {
  try {
    const result = await adminStatsService.getOverview();
    return success(res, result, 'success');
  } catch (err) {
    return next(err);
  }
};

/** GET /api/admin/stats/growth - 成长趋势(Redis 缓存 5 分钟) */
export const getStatsGrowth: RequestHandler = async (req, res, next) => {
  try {
    const result = await adminStatsService.getGrowth(
      req.query as unknown as Parameters<typeof adminStatsService.getGrowth>[0],
    );
    return success(res, result, 'success');
  } catch (err) {
    return next(err);
  }
};

/** GET /api/admin/stats/retention - 留存分析(Redis 缓存 5 分钟) */
export const getStatsRetention: RequestHandler = async (req, res, next) => {
  try {
    const result = await adminStatsService.getRetention(
      req.query as unknown as Parameters<typeof adminStatsService.getRetention>[0],
    );
    return success(res, result, 'success');
  } catch (err) {
    return next(err);
  }
};

/** GET /api/admin/stats/ai-cost - AI 成本统计(Redis 缓存 5 分钟) */
export const getStatsAiCost: RequestHandler = async (req, res, next) => {
  try {
    const result = await adminStatsService.getAiCost(
      req.query as unknown as Parameters<typeof adminStatsService.getAiCost>[0],
    );
    return success(res, result, 'success');
  } catch (err) {
    return next(err);
  }
};

/** GET /api/admin/stats/realtime - 实时监控(不缓存) */
export const getStatsRealtime: RequestHandler = async (_req, res, next) => {
  try {
    const result = await adminStatsService.getRealtime();
    return success(res, result, 'success');
  } catch (err) {
    return next(err);
  }
};

/** GET /api/admin/stats/tenant/:id - 单租户统计 */
export const getTenantStats: RequestHandler = async (req, res, next) => {
  try {
    const tenantId = req.params['id'] as string;
    const result = await adminStatsService.getTenantStats(tenantId);
    return success(res, result, 'success');
  } catch (err) {
    return next(err);
  }
};

/**
 * GET /api/admin/stats/score-consistency - AI-教师评分一致性统计(框架二 P2)
 * query: tenantId?(省略跨租户聚合) / days?(默认90)
 * 数据源:score_diff_records(教师评审/仲裁裁定时的 AI-人工差异快照)
 */
export const getScoreConsistency: RequestHandler = async (req, res, next) => {
  try {
    const tenantId =
      typeof req.query['tenantId'] === 'string' && req.query['tenantId'].length > 0
        ? (req.query['tenantId'] as string)
        : undefined;
    const days =
      typeof req.query['days'] === 'string' && Number.isFinite(Number(req.query['days']))
        ? Math.max(1, Math.min(730, Number(req.query['days'])))
        : 90;
    const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const result = await getConsistencyStats(tenantId, { from });
    return success(res, result, 'success');
  } catch (err) {
    return next(err);
  }
};

// ============================================================
// 3.10.5 系统管理模块
// ============================================================

/** GET /api/admin/system/tenants - 分页查询租户列表 */
export const listTenants: RequestHandler = async (req, res, next) => {
  try {
    const result = await adminSystemService.listTenants(
      req.query as unknown as Parameters<typeof adminSystemService.listTenants>[0],
    );
    return success(res, result, 'success');
  } catch (err) {
    return next(err);
  }
};

/** GET /api/admin/system/tenants/:id - 查询租户详情 */
export const getTenant: RequestHandler = async (req, res, next) => {
  try {
    const tenantId = req.params['id'] as string;
    const result = await adminSystemService.getTenant(tenantId);
    return success(res, result, 'success');
  } catch (err) {
    return next(err);
  }
};

/** POST /api/admin/system/tenants - 创建租户 + 审计日志 */
export const createTenant: RequestHandler = async (req, res, next) => {
  try {
    const ctx = requireAuthCtx(req, res);
    if (!ctx) return;
    const result = await adminSystemService.createTenant(req.body, {
      req,
      operatorId: ctx.userId,
    });
    return success(res, result, '租户已创建');
  } catch (err) {
    return next(err);
  }
};

/** PATCH /api/admin/system/tenants/:id - 更新租户 + 审计日志 */
export const updateTenant: RequestHandler = async (req, res, next) => {
  try {
    const ctx = requireAuthCtx(req, res);
    if (!ctx) return;
    const tenantId = req.params['id'] as string;
    const result = await adminSystemService.updateTenant(tenantId, req.body, { req });
    return success(res, result, '租户已更新');
  } catch (err) {
    return next(err);
  }
};

/** GET /api/admin/system/audit-logs - 分页查询审计日志 */
export const listAuditLogs: RequestHandler = async (req, res, next) => {
  try {
    const result = await adminSystemService.listAuditLogs(
      req.query as unknown as Parameters<typeof adminSystemService.listAuditLogs>[0],
    );
    return success(res, result, 'success');
  } catch (err) {
    return next(err);
  }
};

/** GET /api/admin/system/api-keys - 分页查询 API 密钥列表 */
export const listApiKeys: RequestHandler = async (req, res, next) => {
  try {
    const result = await adminSystemService.listApiKeys(
      req.query as unknown as Parameters<typeof adminSystemService.listApiKeys>[0],
    );
    return success(res, result, 'success');
  } catch (err) {
    return next(err);
  }
};

/** POST /api/admin/system/api-keys - 创建 API 密钥 + 审计日志(完整密钥仅返回一次) */
export const createApiKey: RequestHandler = async (req, res, next) => {
  try {
    const ctx = requireAuthCtx(req, res);
    if (!ctx) return;
    const result = await adminSystemService.createApiKey(req.body, {
      req,
      operatorId: ctx.userId,
    });
    return success(res, result, 'API 密钥已创建');
  } catch (err) {
    return next(err);
  }
};

/** DELETE /api/admin/system/api-keys/:id - 吊销 API 密钥 + 审计日志 */
export const revokeApiKey: RequestHandler = async (req, res, next) => {
  try {
    const ctx = requireAuthCtx(req, res);
    if (!ctx) return;
    const apiKeyId = req.params['id'] as string;
    const result = await adminSystemService.revokeApiKey(apiKeyId, {
      req,
      operatorId: ctx.userId,
    });
    return success(res, result, 'success');
  } catch (err) {
    return next(err);
  }
};

/** GET /api/admin/system/health - 系统健康检查 */
export const getSystemHealth: RequestHandler = async (_req, res, next) => {
  try {
    const result = await adminSystemService.getHealth();
    return success(res, result, 'success');
  } catch (err) {
    return next(err);
  }
};

// ============================================================
// CSV 工具函数
// ============================================================

/**
 * CSV 字段转义:含逗号/引号/换行时用双引号包裹,内部引号双写
 * 对应 RFC 4180
 */
function csvEscape(value: string): string {
  if (value === '') return '';
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
