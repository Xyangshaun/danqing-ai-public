// ============================================================
// 丹青有AI - 教师端 API 封装
//
// 设计说明:
//   教师端复用业务命名空间 /api/v1(与 types/admin.ts 的 /api/admin 不同):
//     - GET  /tenants/:id/members          班级学生列表(user:read)
//     - GET  /analyses?userId=             学生作品列表(analysis:read:tenant)
//     - GET  /growth?userId=               学生成长曲线(teacher/admin/owner)
//     - POST /analyses/:id/reviews         提交评审(review:write)
//     - GET  /analyses/:id/reviews         已有评审(review:read)
//     - GET/POST/PATCH/DELETE /analyses/:id/annotations[/:aid]  标注级教师批注(批次③)
//   批量评分契约无独立端点,由 batchCreateReviews 在前端做并发受限编排。
//   相对路径由 api.ts buildUrl 自动拼接 BASE_URL(/api/v1)。
// ============================================================

import { get, post, patch, del } from './api';
import type {
  ListTenantMembersResponse,
  ListAnalysesQuery,
  ListAnalysesResponse,
  GrowthQuery,
  GrowthResponse,
  CreateReviewRequest,
  ReviewRecordSummary,
  BatchReviewSummary,
  DisputeListQuery,
  ListDisputesResponse,
  DisputeCaseDetail,
  ResolveDisputeRequest,
  ApplyDisputeResultResponse,
  RequestDisputeRequest,
  RequestDisputeResponse,
  CreateTeacherAnnotationRequest,
  UpdateTeacherAnnotationRequest,
  TeacherAnnotationRecord,
} from '../types/teacher';

/* ============================================================
 * 班级学生列表
 * ============================================================ */

/** GET /api/v1/tenants/:id/members - 班级成员列表(教师视图取 role=student) */
export function listClassMembers(tenantId: string): Promise<ListTenantMembersResponse> {
  return get<ListTenantMembersResponse>(`/tenants/${tenantId}/members`);
}

/* ============================================================
 * 学生作品与成长
 * ============================================================ */

/** GET /api/v1/analyses - 学生作品列表(userId 必填,教师查看指定学生) */
export function listStudentAnalyses(
  query: ListAnalysesQuery & { userId: string },
): Promise<ListAnalysesResponse> {
  return get<ListAnalysesResponse>('/analyses', { ...query });
}

/** GET /api/v1/growth - 学生成长曲线(userId 必填) */
export function getStudentGrowth(
  query: GrowthQuery & { userId: string },
): Promise<GrowthResponse> {
  return get<GrowthResponse>('/growth', { ...query });
}

/* ============================================================
 * 评审评分
 * ============================================================ */

/** POST /api/v1/analyses/:id/reviews - 提交评审(teacher/admin/owner) */
export function createReview(
  analysisId: string,
  body: CreateReviewRequest,
): Promise<ReviewRecordSummary> {
  return post<ReviewRecordSummary>(`/analyses/${analysisId}/reviews`, body);
}

/** GET /api/v1/analyses/:id/reviews - 某作品已有评审列表 */
export function listReviews(analysisId: string): Promise<ReviewRecordSummary[]> {
  return get<ReviewRecordSummary[]>(`/analyses/${analysisId}/reviews`, undefined, {
    silent: true,
  });
}

/* ============================================================
 * 批量评分(前端编排:并发受限 + 逐条收集结果)
 *
 * 说明:
 *   - 契约无批量评审端点,此处循环调用单评接口
 *   - 单条请求 silent:true 避免连续触发全局 Toast,错误汇总后统一反馈
 *   - 并发上限 3,避免瞬间打满 apiRateLimiter
 * ============================================================ */

const BATCH_REVIEW_CONCURRENCY = 3;

export async function batchCreateReviews(
  analysisIds: string[],
  body: CreateReviewRequest,
  onProgress?: (done: number, total: number) => void,
): Promise<BatchReviewSummary> {
  const results: BatchReviewSummary['results'] = [];
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < analysisIds.length) {
      const index = cursor++;
      const analysisId = analysisIds[index];
      try {
        await post<ReviewRecordSummary>(`/analyses/${analysisId}/reviews`, body, {
          silent: true,
        });
        results.push({ analysisId, success: true });
      } catch (err) {
        results.push({
          analysisId,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        onProgress?.(results.length, analysisIds.length);
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(BATCH_REVIEW_CONCURRENCY, analysisIds.length) }, () =>
      worker(),
    ),
  );

  const succeeded = results.filter((r) => r.success).length;
  return {
    total: analysisIds.length,
    succeeded,
    failed: analysisIds.length - succeeded,
    results,
  };
}

/* ============================================================
 * 标注级教师批注(反馈闭环 Phase 4 批次③)
 *   读类 GET:review:read(租户内所有角色;student 仅自己作品)
 *   写类 POST/PATCH/DELETE:review:write(teacher/admin/owner,改删仅作者本人)
 * ============================================================ */

/** GET /api/v1/analyses/:id/annotations - 该分析的批注列表(silent 避免巡览噪声) */
export function listAnnotations(analysisId: string): Promise<TeacherAnnotationRecord[]> {
  return get<TeacherAnnotationRecord[]>(`/analyses/${analysisId}/annotations`, undefined, {
    silent: true,
  });
}

/** POST /api/v1/analyses/:id/annotations - 创建批注(重复同 marker 返回 409) */
export function createAnnotation(
  analysisId: string,
  body: CreateTeacherAnnotationRequest,
): Promise<TeacherAnnotationRecord> {
  return post<TeacherAnnotationRecord>(`/analyses/${analysisId}/annotations`, body);
}

/** PATCH /api/v1/analyses/:id/annotations/:aid - 更新批注(仅作者本人) */
export function updateAnnotation(
  analysisId: string,
  annotationId: string,
  body: UpdateTeacherAnnotationRequest,
): Promise<TeacherAnnotationRecord> {
  return patch<TeacherAnnotationRecord>(`/analyses/${analysisId}/annotations/${annotationId}`, body);
}

/** DELETE /api/v1/analyses/:id/annotations/:aid - 删除批注(仅作者本人) */
export function deleteAnnotation(analysisId: string, annotationId: string): Promise<void> {
  return del<void>(`/analyses/${analysisId}/annotations/${annotationId}`);
}

/* ============================================================
 * 争议仲裁(dispute:read 全员可读;resolve/apply 需 teacher 及以上;
 *           request 为学生端申请人工复核入口,需 dispute:request)
 * ============================================================ */

/** GET /api/v1/disputes - 争议分页列表(status/level 过滤) */
export function listDisputes(query?: DisputeListQuery): Promise<ListDisputesResponse> {
  return get<ListDisputesResponse>('/disputes', { ...query });
}

/** GET /api/v1/disputes/:id - 争议详情(含评审记录与裁定结果) */
export function getDispute(id: string): Promise<DisputeCaseDetail> {
  return get<DisputeCaseDetail>(`/disputes/${id}`);
}

/** POST /api/v1/analyses/:id/disputes/request - 学生申请人工复核(dispute:request) */
export function requestDispute(
  analysisId: string,
  body: RequestDisputeRequest,
): Promise<RequestDisputeResponse> {
  return post<RequestDisputeResponse>(`/analyses/${analysisId}/disputes/request`, body);
}

/** POST /api/v1/disputes/:id/resolve - 裁定争议(teacher/admin/owner) */
export function resolveDispute(
  id: string,
  body: ResolveDisputeRequest,
): Promise<DisputeCaseDetail> {
  return post<DisputeCaseDetail>(`/disputes/${id}/resolve`, body);
}

/** POST /api/v1/disputes/:id/apply-result - 回写裁定分到 Analysis(teacher/admin/owner) */
export function applyDisputeResult(id: string): Promise<ApplyDisputeResultResponse> {
  return post<ApplyDisputeResultResponse>(`/disputes/${id}/apply-result`);
}
