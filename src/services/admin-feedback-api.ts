// ============================================================
// 丹青有AI - 管理后台 · 标注反馈统计 API 封装
// 对应文档: docs/phase5-flywheel-profile-checklist.md 批次①/②
//
// 设计说明(照 admin-api.ts 管理后台统计先例):
//   - 挂载在 /api/admin 命名空间,api.ts 的 buildUrl 对 /api/ 前缀原样透传,
//     复用同一套鉴权 / 401 刷新 / 错误处理逻辑。
//   - 只读轮询接口统一 silent:true(避免高频请求触发全局 Toast 噪声)。
//   - 训练数据导出为 NDJSON 流(非 JSON),绕过 api.ts 的 JSON 解包,
//     用原生 fetch + blob 下载(照 admin-api.ts exportAdminUsers 先例)。
// ============================================================

import { get } from './api';
import type {
  AdminFeedbackStatsQuery,
  AdminFeedbackOverviewResponse,
  AdminFeedbackByDimensionResponse,
  AdminFeedbackByWorkTypeResponse,
  AdminFeedbackTrendResponse,
  AdminFeedbackExportQuery,
} from '../types/admin';

const ADMIN = '/api/admin';

/* ============================================================
 * 标注反馈统计(Phase 5 批次①:数据飞轮备料;Redis 5min)
 * ============================================================ */

/** GET /api/admin/stats/feedback/overview - 反馈总览 */
export function getFeedbackOverview(query?: AdminFeedbackStatsQuery): Promise<AdminFeedbackOverviewResponse> {
  return get<AdminFeedbackOverviewResponse>(`${ADMIN}/stats/feedback/overview`, { ...query }, { silent: true });
}

/** GET /api/admin/stats/feedback/by-dimension - 按维度分组(定位最常被点没用的维度) */
export function getFeedbackByDimension(query?: AdminFeedbackStatsQuery): Promise<AdminFeedbackByDimensionResponse> {
  return get<AdminFeedbackByDimensionResponse>(`${ADMIN}/stats/feedback/by-dimension`, { ...query }, { silent: true });
}

/** GET /api/admin/stats/feedback/by-worktype - 按作品类型分组(分类型训练集规模盘点) */
export function getFeedbackByWorkType(query?: AdminFeedbackStatsQuery): Promise<AdminFeedbackByWorkTypeResponse> {
  return get<AdminFeedbackByWorkTypeResponse>(`${ADMIN}/stats/feedback/by-worktype`, { ...query }, { silent: true });
}

/** GET /api/admin/stats/feedback/trend - 按日趋势(最近 N 天,默认 7) */
export function getFeedbackTrend(query?: AdminFeedbackStatsQuery): Promise<AdminFeedbackTrendResponse> {
  return get<AdminFeedbackTrendResponse>(`${ADMIN}/stats/feedback/trend`, { ...query }, { silent: true });
}

/* ============================================================
 * 训练数据导出(Phase 5 批次②:数据飞轮备料)
 * ============================================================ */

/**
 * GET /api/admin/stats/feedback/export - 导出训练数据(NDJSON 触发浏览器下载)
 *
 * 数据主权(后端强制,前端仅透传):
 *   - tenantId=all / 缺省:平台 owner 导全局;租户 admin 强制本租户
 *   - tenantId=具体租户:仅平台 owner 可传他人租户(否则 403)
 *
 * 后端返回 application/x-ndjson(逐行 JSON,marker 快照平铺 + 元数据),
 * 需绕过 api.ts 的 JSON 解包,用原生 fetch + blob 下载。
 *
 * @returns 导出行数(读响应头 X-Row-Count;后端未返回时按 0 处理)
 */
export async function exportFeedbackTrainingData(query?: AdminFeedbackExportQuery): Promise<number> {
  const { getAccessToken, getDeviceId } = await import('./token-store');
  const params = new URLSearchParams();
  Object.entries(query ?? {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') params.append(k, String(v));
  });
  const qs = params.toString();
  const url = `${ADMIN}/stats/feedback/export${qs ? `?${qs}` : ''}`;

  const token = getAccessToken();
  const resp = await fetch(url, {
    method: 'GET',
    credentials: 'include',
    headers: {
      Accept: 'application/x-ndjson',
      'X-Client': 'web',
      'X-Client-Context': JSON.stringify({ device_id: getDeviceId(), client: 'web' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!resp.ok) {
    throw new Error(`导出失败(HTTP ${resp.status})`);
  }

  const rowCount = parseInt(resp.headers.get('X-Row-Count') ?? '0', 10) || 0;
  const blob = await resp.blob();
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `marker-feedback-training-${new Date().toISOString().slice(0, 10)}.jsonl`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
  return rowCount;
}
