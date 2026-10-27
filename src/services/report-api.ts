// ============================================================
// 丹青有AI - 举报/投诉 API(公安备案合规要求)
// ------------------------------------------------------------
// 契约:POST /api/reports(冻结契约,前端先行实现)
//   Body: { targetType, targetId, reason, detail? }
//   成功:统一 envelope,data: { id, status:'pending', createdAt }
//   错误:复用 services/api 的 ApiError(业务错误统一 Toast)
// 鉴权:已登录;api.ts 的 buildHeaders 自动注入
//   Authorization Bearer + X-CSRF-Token(双提交 Cookie 模式)
// ============================================================

import { post } from './api';
import type { CreateReportPayload, ReportRecord } from '../types/api-contract';

/**
 * 提交举报
 *
 * 路径说明:冻结契约为 /api/reports(独立于 /api/v1 命名空间)。
 * api.ts 的 buildUrl 对以 /api/ 开头的路径按完整 API 路径透传,
 * 不再拼接 BASE_URL(默认 /api/v1),与契约路径精确一致。
 *
 * 后端未上线期间该请求将 404,由 services/api 统一 Toast 提示,
 * 不影响应用其他功能(前端按冻结契约先行开发)。
 *
 * @param payload 举报目标(类型 + ID)+ 理由 + 可选补充说明(≤500 字)
 * @returns 举报记录(id + status:'pending' + createdAt)
 * @throws ApiError 业务错误(PARAM_INVALID / UNAUTHORIZED / RATE_LIMITED 等)
 */
export function createReport(payload: CreateReportPayload): Promise<ReportRecord> {
  return post<ReportRecord>('/api/reports', payload);
}
