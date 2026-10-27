// ============================================================
// AI 用量统计 Controller(用量统计模块)
// 对应 API:
//   GET /api/admin/stats/ai-usage/overview
//   GET /api/admin/stats/ai-usage/by-provider
//   GET /api/admin/stats/ai-usage/by-user
//   GET /api/admin/stats/ai-usage/trend
//
// 职责:
//   1. 解析 query 参数(startDate / endDate / days / limit)
//   2. 调用 adminAiUsageService 获取聚合数据
//   3. 返回统一成功响应(success 包装)
//
// 权限:admin:stats:read(由路由层 requirePermission 强制)
// 错误处理:统一交给 error-handler 中间件
// ============================================================

import type { RequestHandler } from 'express';
import { success } from '../utils/response.js';
import { adminAiUsageService } from '../services/admin-ai-usage.service.js';
import type { AdminAiUsageQuery } from '../types/api-contract.js';

/**
 * 校验并解析 startDate / endDate query 参数
 * 接受 YYYY-MM-DD 格式;非法日期直接忽略(由 service 默认补全)
 */
function parseQuery(query: Record<string, unknown>): AdminAiUsageQuery {
  const result: AdminAiUsageQuery = {};
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
  if (typeof query.limit === 'string') {
    const n = parseInt(query.limit, 10);
    if (!isNaN(n)) result.limit = n;
  } else if (typeof query.limit === 'number') {
    result.limit = query.limit;
  }
  return result;
}

// ============================================================
// 1. GET /api/admin/stats/ai-usage/overview - 总览统计
// ============================================================
export const getAiUsageOverview: RequestHandler = async (req, res, next) => {
  try {
    const query = parseQuery(req.query);
    const data = await adminAiUsageService.getOverview(query);
    return success(res, data, 'success');
  } catch (err) {
    return next(err);
  }
};

// ============================================================
// 2. GET /api/admin/stats/ai-usage/by-provider - 按 Provider 分组
// ============================================================
export const getAiUsageByProvider: RequestHandler = async (req, res, next) => {
  try {
    const query = parseQuery(req.query);
    const data = await adminAiUsageService.getByProvider(query);
    return success(res, data, 'success');
  } catch (err) {
    return next(err);
  }
};

// ============================================================
// 3. GET /api/admin/stats/ai-usage/by-user - 按用户分组(Top N)
// ============================================================
export const getAiUsageByUser: RequestHandler = async (req, res, next) => {
  try {
    const query = parseQuery(req.query);
    const data = await adminAiUsageService.getByUser(query);
    return success(res, data, 'success');
  } catch (err) {
    return next(err);
  }
};

// ============================================================
// 4. GET /api/admin/stats/ai-usage/trend - 按日期趋势
// ============================================================
export const getAiUsageTrend: RequestHandler = async (req, res, next) => {
  try {
    const query = parseQuery(req.query);
    const data = await adminAiUsageService.getTrend(query);
    return success(res, data, 'success');
  } catch (err) {
    return next(err);
  }
};
