// ============================================================
// 内容管理 API
// 对应后端:/api/admin/artworks + /api/admin/templates
// ============================================================

import { get, post, patch, del } from './request';
import type {
  ListAdminArtworksQuery,
  ListAdminArtworksResponse,
  AdminArtworkDetail,
  ReviewArtworkRequest,
  ReviewArtworkResponse,
  DeleteAdminArtworkResponse,
  ListAdminTemplatesQuery,
  ListAdminTemplatesResponse,
  CreativeTemplateInfo,
  CreateTemplateRequest,
  CreateTemplateResponse,
  UpdateTemplateRequest,
  UpdateTemplateResponse,
  DeleteTemplateResponse,
} from './types';

/** 作品列表 */
export function listArtworks(params: ListAdminArtworksQuery): Promise<ListAdminArtworksResponse> {
  return get<ListAdminArtworksResponse>('/api/admin/artworks', params);
}

/** 作品详情 */
export function getArtwork(id: string): Promise<AdminArtworkDetail> {
  return get<AdminArtworkDetail>(`/api/admin/artworks/${id}`);
}

/** 审核作品(通过/拒绝/标记) */
export function reviewArtwork(id: string, data: ReviewArtworkRequest): Promise<ReviewArtworkResponse> {
  return post<ReviewArtworkResponse>(`/api/admin/artworks/${id}/review`, data);
}

/** 删除作品(物理删除,不可恢复) */
export function deleteArtwork(id: string): Promise<DeleteAdminArtworkResponse> {
  return del<DeleteAdminArtworkResponse>(`/api/admin/artworks/${id}`);
}

/** 模板列表 */
export function listTemplates(params: ListAdminTemplatesQuery): Promise<ListAdminTemplatesResponse> {
  return get<ListAdminTemplatesResponse>('/api/admin/templates', params);
}

/** 模板详情 */
export function getTemplate(id: string): Promise<CreativeTemplateInfo> {
  return get<CreativeTemplateInfo>(`/api/admin/templates/${id}`);
}

/** 创建模板 */
export function createTemplate(data: CreateTemplateRequest): Promise<CreateTemplateResponse> {
  return post<CreateTemplateResponse>('/api/admin/templates', data);
}

/** 更新模板 */
export function updateTemplate(
  id: string,
  data: UpdateTemplateRequest,
): Promise<UpdateTemplateResponse> {
  return patch<UpdateTemplateResponse>(`/api/admin/templates/${id}`, data);
}

/** 删除模板 */
export function deleteTemplate(id: string): Promise<DeleteTemplateResponse> {
  return del<DeleteTemplateResponse>(`/api/admin/templates/${id}`);
}
