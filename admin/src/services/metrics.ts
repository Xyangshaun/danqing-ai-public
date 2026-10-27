// ============================================================
// 可观测性 API
// 对应后端:/api/admin/metrics/*
// ============================================================

import { get } from './request';
import type { AiMetricsResponse, SlaMetricsResponse } from './types';

/** AI 生成可观测性指标(每 60s 轮询) */
export function getMetricsAi(): Promise<AiMetricsResponse> {
  return get<AiMetricsResponse>('/api/admin/metrics/ai');
}

/** SLA 达标率(按日,默认近 7 天) */
export function getMetricsSla(days = 7): Promise<SlaMetricsResponse> {
  return get<SlaMetricsResponse>('/api/admin/metrics/sla', { days });
}
