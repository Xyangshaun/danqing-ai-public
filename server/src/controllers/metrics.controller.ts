// ============================================================
// AI 指标 Controller(M3 可观测性;对应 m3-observability-plan §3 契约)
// 对应 API(冻结契约 api-contract.ts §3.18):
//   GET /api/admin/metrics/ai   → AiMetricsResponse
//   GET /api/admin/metrics/sla  → SlaMetricsQuery / SlaMetricsResponse
//
// 职责:
//   - controller 不写业务逻辑,仅做参数解析 + 多租户隔离 + 响应序列化
//   - 特性开关:metrics 默认 disabled,关闭时返回 FORBIDDEN(2004,403)(门禁 M3-4/D7)
//   - 多租户隔离(门禁 M3-3):
//       * 非平台 owner 传他人 tenantId → FORBIDDEN(2004,403)
//       * admin 仅可查自己租户(req.tenantId)
//       * 平台 owner 可查任意租户或全局(tenantId=all/global)
//   - 契约铁律:api-contract.ts 已冻结,严格按冻结类型返回,禁止新增字段
//
// 权限:admin:stats:read(由路由层 requirePermission 强制)
// 错误处理:统一交给 error-handler 中间件,不暴露堆栈
// ============================================================

import type { Request, RequestHandler } from 'express';
import { success, error } from '../utils/response.js';
import { ErrorCode } from '../types/api-contract.js';
import { configFeatureService } from '../services/config-feature.service.js';
import { metricsAggregationService } from '../services/metrics-aggregation.service.js';
import type { SlaMetricsQuery } from '../types/api-contract.js';

/**
 * 校验并解析 metrics/ai query 参数(startDate/endDate,YYYY-MM-DD)
 * 非法日期忽略,由 service 默认补全
 */
function parseAiMetricsQuery(req: Request): { startDate?: string; endDate?: string } {
  const q = req.query;
  const result: { startDate?: string; endDate?: string } = {};
  if (typeof q.startDate === 'string' && q.startDate.length > 0) result.startDate = q.startDate;
  if (typeof q.endDate === 'string' && q.endDate.length > 0) result.endDate = q.endDate;
  return result;
}

/**
 * 解析 metrics/sla query(days 1-90 默认 7;tenantId 可选)
 */
function parseSlaMetricsQuery(req: Request): SlaMetricsQuery {
  const q = req.query;
  const result: SlaMetricsQuery = {};
  if (typeof q.days === 'string') {
    const n = parseInt(q.days, 10);
    if (!Number.isNaN(n)) result.days = n;
  }
  if (typeof q.tenantId === 'string' && q.tenantId.length > 0) result.tenantId = q.tenantId;
  return result;
}

/**
 * 多租户隔离解析(门禁 M3-3)
 * @returns 查询租户范围;{ forbidden: true } 表示越权
 *   规则:
 *     - 未传 tenantId:平台 owner → 全局(undefined);其他 → 本人租户 req.tenantId
 *     - 传 tenantId=all/global:仅平台 owner 可查全局,否则 FORBIDDEN
 *     - 传具体 tenantId:平台 owner 可查任意;其他角色必须等于 req.tenantId,否则 FORBIDDEN
 */
function resolveMetricsTenant(
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

  // 未指定租户:owner 查全局,其他角色仅查本人租户
  return isPlatformOwner ? { tenantId: undefined } : { tenantId: req.tenantId };
}

// ============================================================
// 1. GET /api/admin/metrics/ai
// ============================================================
export const getMetricsAi: RequestHandler = async (req, res, next) => {
  try {
    if (!req.userId || !req.tenantId || !req.role) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }
    // 特性开关灰度(默认关闭)
    if (!configFeatureService.isMetricsEnabled(req.tenantId)) {
      return error(res, ErrorCode.FORBIDDEN, '可观测性指标功能暂未开放', 403);
    }

    const scope = resolveMetricsTenant(req);
    if ('forbidden' in scope) {
      return error(res, ErrorCode.FORBIDDEN, '无权访问其他租户的指标数据', 403);
    }

    const parsed = parseAiMetricsQuery(req);
    const data = await metricsAggregationService.getAiMetrics({
      startDate: parsed.startDate,
      endDate: parsed.endDate,
      tenantId: scope.tenantId,
    });

    return success(res, data, 'success');
  } catch (err) {
    return next(err);
  }
};

// ============================================================
// 2. GET /api/admin/metrics/sla
// ============================================================
export const getMetricsSla: RequestHandler = async (req, res, next) => {
  try {
    if (!req.userId || !req.tenantId || !req.role) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }
    // 特性开关灰度(默认关闭)
    if (!configFeatureService.isMetricsEnabled(req.tenantId)) {
      return error(res, ErrorCode.FORBIDDEN, '可观测性指标功能暂未开放', 403);
    }

    const query = parseSlaMetricsQuery(req);
    const scope = resolveMetricsTenant(req, query.tenantId);
    if ('forbidden' in scope) {
      return error(res, ErrorCode.FORBIDDEN, '无权访问其他租户的指标数据', 403);
    }

    const data = await metricsAggregationService.getSlaMetrics(query, scope.tenantId);
    return success(res, data, 'success');
  } catch (err) {
    return next(err);
  }
};
