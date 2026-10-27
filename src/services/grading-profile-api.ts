// ============================================================
// 丹青有AI - 评分档案 API 封装(双阶段反馈框架 Phase 2 批次⑤)
//
// 设计说明(照 class-api.ts 惯例):
//   复用业务命名空间 /api/v1,中间件链 auth → tenant → rate-limit
//   → permission(grading-profile:read / grading-profile:write,
//   教师/管理员/所有者可用,学生端不消费档案):
//     - GET    /grading-profiles               可见档案列表(系统内置+本校克隆)
//     - GET    /grading-profiles/:id           档案详情(含 config 全量)
//     - POST   /grading-profiles               创建租户档案
//     - POST   /grading-profiles/:id/fork      克隆档案(深拷贝 config 微调)
//     - PATCH  /grading-profiles/:id           更新档案(仅本人,非内置)
//     - DELETE /grading-profiles/:id           删除档案(仅本人,非内置)
//     - POST   /grading-profiles/:id/activate  设为租户默认(同租户同类目唯一)
//   相对路径由 api.ts buildUrl 自动拼接 BASE_URL(/api/v1)。
//   类型为前端本地镜像(types/grading-profile.ts),不改动只读契约副本。
// ============================================================

import { get, post, patch, del } from './api';
import type {
  GradingProfileSummary,
  GradingProfileDetail,
  CreateGradingProfileRequest,
  ForkGradingProfileRequest,
  UpdateGradingProfileRequest,
  GradingTeacherInsightsResponse,
  GradingProfileSuggestionsResponse,
  GradingMyAdoptionsResponse,
  CreateSuggestionAdoptionRequest,
  SuggestionAdoptionRecord,
} from '../types/grading-profile';

/* ============================================================
 * 查询
 * ============================================================ */

/** GET /grading-profiles - 可见档案列表(系统内置 + 本校克隆) */
export function listGradingProfiles(): Promise<GradingProfileSummary[]> {
  return get<GradingProfileSummary[]>('/grading-profiles');
}

/** GET /grading-profiles/:id - 档案详情 */
export function getGradingProfile(id: string): Promise<GradingProfileDetail> {
  return get<GradingProfileDetail>(`/grading-profiles/${id}`);
}

/* ============================================================
 * 创建 / 克隆
 * ============================================================ */

/** POST /grading-profiles - 创建租户档案 */
export function createGradingProfile(
  body: CreateGradingProfileRequest,
): Promise<GradingProfileDetail> {
  return post<GradingProfileDetail>('/grading-profiles', body);
}

/** POST /grading-profiles/:id/fork - 克隆档案(深拷贝 config) */
export function forkGradingProfile(
  id: string,
  body: ForkGradingProfileRequest,
): Promise<GradingProfileDetail> {
  return post<GradingProfileDetail>(`/grading-profiles/${id}/fork`, body);
}

/* ============================================================
 * 更新 / 删除 / 设默认
 * ============================================================ */

/** PATCH /grading-profiles/:id - 更新档案(仅本人,非内置) */
export function updateGradingProfile(
  id: string,
  body: UpdateGradingProfileRequest,
): Promise<GradingProfileDetail> {
  return patch<GradingProfileDetail>(`/grading-profiles/${id}`, body);
}

/** DELETE /grading-profiles/:id - 删除档案(仅本人,非内置) */
export function deleteGradingProfile(id: string): Promise<{ deleted: boolean; id: string }> {
  return del<{ deleted: boolean; id: string }>(`/grading-profiles/${id}`);
}

/** POST /grading-profiles/:id/activate - 设为租户默认档案 */
export function activateGradingProfile(id: string): Promise<GradingProfileDetail> {
  return post<GradingProfileDetail>(`/grading-profiles/${id}/activate`);
}

/* ============================================================
 * Phase 5 批次③:教学画像 + 档案建议 + 采纳记录
 * ============================================================ */

/** GET /grading-profiles/insights/teacher - 本人教学画像(只读展示) */
export function getTeacherInsights(): Promise<GradingTeacherInsightsResponse> {
  return get<GradingTeacherInsightsResponse>('/grading-profiles/insights/teacher');
}

/** GET /grading-profiles/insights/adoptions - 本人采纳历史(教师画像页;Phase 5 批次④) */
export function getMySuggestionAdoptions(): Promise<GradingMyAdoptionsResponse> {
  return get<GradingMyAdoptionsResponse>('/grading-profiles/insights/adoptions');
}

/** GET /grading-profiles/:id/insights/suggestion - 档案级建议(租户聚合推导) */
export function getProfileSuggestions(id: string): Promise<GradingProfileSuggestionsResponse> {
  return get<GradingProfileSuggestionsResponse>(`/grading-profiles/${id}/insights/suggestion`);
}

/** POST /grading-profiles/:id/suggestion-adoptions - 建议采纳记录(审计落库) */
export function recordSuggestionAdoption(
  id: string,
  body: CreateSuggestionAdoptionRequest,
): Promise<SuggestionAdoptionRecord> {
  return post<SuggestionAdoptionRecord>(`/grading-profiles/${id}/suggestion-adoptions`, body);
}
