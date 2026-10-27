// ============================================================
// 标注反馈统计 Controller(反馈闭环 Phase 5 批次①:数据飞轮备料)
// 对应 API:
//   GET /api/admin/stats/feedback/overview
//   GET /api/admin/stats/feedback/by-dimension
//   GET /api/admin/stats/feedback/by-worktype
//   GET /api/admin/stats/feedback/trend
//
// 职责:
//   1. 解析 query 参数(startDate / endDate / days)
//   2. 调用 adminFeedbackStatsService 获取聚合数据
//   3. 返回统一成功响应(success 包装)
//
// 权限:admin:stats:read(由路由层 requirePermission 强制)
// 错误处理:统一交给 error-handler 中间件
// ============================================================

import type { Request, RequestHandler } from 'express';
import { success, error } from '../utils/response.js';
import { ErrorCode } from '../types/api-contract.js';
import { adminFeedbackStatsService } from '../services/admin-feedback-stats.service.js';
import type { AdminFeedbackStatsQuery, AdminFeedbackExportQuery } from '../types/api-contract.js';

/**
 * 校验并解析 startDate / endDate / days query 参数
 * 接受 YYYY-MM-DD 格式;非法日期直接忽略(由 service 默认补全)
 */
function parseQuery(query: Record<string, unknown>): AdminFeedbackStatsQuery {
  const result: AdminFeedbackStatsQuery = {};
  if (typeof query.startDate === 'string' && query.startDate.length > 0) {
    result.startDate = query.startDate;
  }
  if (typeof query.endDate === 'string' && query.endDate.length > 0) {
    result.endDate = query.endDate;
  }
  if (typeof query.days === 'string') {
    const n = parseInt(query.days, 10);
    if (!isNaN(n)) result.days = n;
  } else if (typeof query.days === 'number') {
    result.days = query.days;
  }
  return result;
}

/**
 * 解析导出 query(tenantId / startDate / endDate)
 * (Phase 5 批次②;tenantId 语义见 resolveExportTenant)
 */
function parseExportQuery(query: Record<string, unknown>): AdminFeedbackExportQuery {
  const result: AdminFeedbackExportQuery = {};
  if (typeof query.tenantId === 'string' && query.tenantId.length > 0) {
    result.tenantId = query.tenantId;
  }
  if (typeof query.startDate === 'string' && query.startDate.length > 0) {
    result.startDate = query.startDate;
  }
  if (typeof query.endDate === 'string' && query.endDate.length > 0) {
    result.endDate = query.endDate;
  }
  return result;
}

/**
 * 导出租户数据主权解析(照 metrics.controller resolveMetricsTenant 先例)
 * 规则:
 *   - 未传 tenantId:平台 owner → 全局(undefined);其他角色 → 强制本租户
 *   - 传 tenantId=all/global:仅平台 owner 可全局,否则 FORBIDDEN
 *   - 传具体 tenantId:平台 owner 可任意;其他角色必须等于本租户,否则 FORBIDDEN
 * @returns { tenantId } 查询范围;{ forbidden: true } 越权
 */
function resolveExportTenant(
  req: Request,
  requestedTenantId?: string,
): { tenantId?: string } | { forbidden: true } {
  const isPlatformOwner = req.role === 'owner';

  if (requestedTenantId) {
    if (requestedTenantId === 'all' || requestedTenantId === 'global') {
      if (!isPlatformOwner) return { forbidden: true };
      return { tenantId: undefined }; // 全局
    }
    if (!isPlatformOwner && requestedTenantId !== req.tenantId) {
      return { forbidden: true };
    }
    return { tenantId: requestedTenantId };
  }

  // 未指定租户:owner 导全局,其他角色强制本租户(数据主权:租户数据不出租户)
  return isPlatformOwner ? { tenantId: undefined } : { tenantId: req.tenantId };
}

// ============================================================
// 1. GET /api/admin/stats/feedback/overview - 总览统计
// ============================================================
export const getFeedbackOverview: RequestHandler = async (req, res, next) => {
  try {
    const query = parseQuery(req.query as Record<string, unknown>);
    const data = await adminFeedbackStatsService.getOverview(query);
    return success(res, data, 'success');
  } catch (err) {
    return next(err);
  }
};

// ============================================================
// 2. GET /api/admin/stats/feedback/by-dimension - 按维度分组
// ============================================================
export const getFeedbackByDimension: RequestHandler = async (req, res, next) => {
  try {
    const query = parseQuery(req.query as Record<string, unknown>);
    const data = await adminFeedbackStatsService.getByDimension(query);
    return success(res, data, 'success');
  } catch (err) {
    return next(err);
  }
};

// ============================================================
// 3. GET /api/admin/stats/feedback/by-worktype - 按作品类型分组
// ============================================================
export const getFeedbackByWorkType: RequestHandler = async (req, res, next) => {
  try {
    const query = parseQuery(req.query as Record<string, unknown>);
    const data = await adminFeedbackStatsService.getByWorkType(query);
    return success(res, data, 'success');
  } catch (err) {
    return next(err);
  }
};

// ============================================================
// 4. GET /api/admin/stats/feedback/trend - 按日趋势
// ============================================================
export const getFeedbackTrend: RequestHandler = async (req, res, next) => {
  try {
    const query = parseQuery(req.query as Record<string, unknown>);
    const data = await adminFeedbackStatsService.getTrend(query);
    return success(res, data, 'success');
  } catch (err) {
    return next(err);
  }
};

// ============================================================
// 5. GET /api/admin/stats/feedback/export - 训练数据导出(NDJSON 流式)
//
// 数据主权(照 metrics 先例):
//   - 平台 owner:可导全局(tenantId=all/缺省)或指定任意租户
//   - 租户 admin:强制本租户;传他人 tenantId / all → 403
// 响应:Content-Type application/x-ndjson,逐行 JSON(快照平铺行)
//   文件名 marker-feedback-training-<租户|all>-<YYYYMMDD-HHmmss>.jsonl
// ============================================================
export const exportFeedbackData: RequestHandler = async (req, res, next) => {
  try {
    if (!req.userId || !req.tenantId || !req.role) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }

    const query = parseExportQuery(req.query as Record<string, unknown>);
    const scope = resolveExportTenant(req, query.tenantId);
    if ('forbidden' in scope) {
      return error(res, ErrorCode.FORBIDDEN, '无权导出其他租户的反馈数据', 403);
    }

    const rows = await adminFeedbackStatsService.exportRows(query, scope.tenantId);

    // NDJSON 头 + 附件下载(浏览器保存为 .jsonl)
    const scopeLabel = scope.tenantId ?? 'all';
    const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15); // YYYYMMDD-HHmmss
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="marker-feedback-training-${scopeLabel}-${ts}.jsonl"`);
    res.setHeader('X-Row-Count', String(rows.length));

    for (const row of rows) {
      res.write(`${JSON.stringify(row)}\n`);
    }
    res.end();
    return;
  } catch (err) {
    return next(err);
  }
};
