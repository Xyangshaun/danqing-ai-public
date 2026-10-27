// ============================================================
// 丹青有AI - 标注反馈 API(反馈闭环 Phase 4 批次②/数据飞轮)
// ------------------------------------------------------------
// 契约:POST /api/v1/analyses/:id/marker-feedback
//   Body: { markerId?, markerIndex, action: 'up' | 'down' }
//   成功:统一 envelope,data: { markerIndex, markerId, action }
//   语义:upsert——同用户同 marker 仅一条,切换 up/down 走 update
// 用途:积累用户对 AI issueMarker 的"有用/没用"反馈,供未来训练
//       专属评审模型(spec §7.3 第 1 项)
// 鉴权:已登录;api.ts 的 buildHeaders 自动注入
//   Authorization Bearer + X-CSRF-Token(双提交 Cookie 模式)
// 错误:业务错误由 api.ts 全局 Toast(ANALYSIS_NOT_FOUND/
//   ANALYSIS_NOT_COMPLETED/MARKER_NOT_FOUND/RATE_LIMITED 等)
// ============================================================

import { post } from './api';

/** 标注反馈请求体(对齐后端 createMarkerFeedbackSchema) */
export interface CreateMarkerFeedbackPayload {
  /** marker 稳定 ID(批次①后新数据携带;旧数据由 markerIndex 兜底) */
  markerId?: string;
  /** marker 在 issueMarkers 数组中的原始索引(唯一约束位) */
  markerIndex: number;
  /** 反馈动作:up=有用/认同,down=没用/不准确 */
  action: 'up' | 'down';
}

/** 标注反馈响应体(后端 service 返回的关键位,不含快照) */
export interface CreateMarkerFeedbackResponse {
  markerIndex: number;
  markerId: string | null;
  action: 'up' | 'down';
}

/**
 * 提交/更新一条标注反馈(upsert)
 *
 * @param analysisId 分析记录 ID(须为后端真实 ID;本地临时 analysis-* 前缀 ID
 *                   无后端记录,调用方应守卫不传)
 * @param payload marker 定位(markerId 优先/markerIndex 兜底)+ 反馈动作
 * @returns 落库后的关键位(markerIndex/markerId/action)
 * @throws ApiError 业务错误由 api.ts 全局 Toast 提示
 */
export function createMarkerFeedback(
  analysisId: string,
  payload: CreateMarkerFeedbackPayload,
): Promise<CreateMarkerFeedbackResponse> {
  return post<CreateMarkerFeedbackResponse>(
    `/analyses/${encodeURIComponent(analysisId)}/marker-feedback`,
    payload,
  );
}
