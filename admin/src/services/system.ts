// ============================================================
// 系统管理 API
// 对应后端:/api/admin/system/*
// ============================================================

import { get, post, patch, del, put } from './request';
import type {
  ListAdminTenantsQuery,
  ListAdminTenantsResponse,
  CreateAdminTenantRequest,
  CreateAdminTenantResponse,
  UpdateAdminTenantRequest,
  UpdateAdminTenantResponse,
  ListAuditLogsQuery,
  ListAuditLogsResponse,
  ListApiKeysQuery,
  ListApiKeysResponse,
  CreateApiKeyRequest,
  CreateApiKeyResponse,
  RevokeApiKeyResponse,
  AdminSystemHealth,
  AdminInvitationInfo,
  CreateAdminInvitationRequest,
  CreateAdminInvitationResponse,
  ListAdminInvitationsResponse,
  BatchImportStudentsRequest,
  BatchImportStudentsResponse,
  GetTenantArbitrationConfigResponse,
  UpdateTenantArbitrationConfigRequest,
} from './types';

/** 租户列表 */
export function listTenants(params: ListAdminTenantsQuery): Promise<ListAdminTenantsResponse> {
  return get<ListAdminTenantsResponse>('/api/admin/system/tenants', params);
}

/** 创建租户 */
export function createTenant(data: CreateAdminTenantRequest): Promise<CreateAdminTenantResponse> {
  return post<CreateAdminTenantResponse>('/api/admin/system/tenants', data);
}

/** 更新租户 */
export function updateTenant(
  id: string,
  data: UpdateAdminTenantRequest,
): Promise<UpdateAdminTenantResponse> {
  return patch<UpdateAdminTenantResponse>(`/api/admin/system/tenants/${id}`, data);
}

/** 审计日志列表 */
export function listAuditLogs(params: ListAuditLogsQuery): Promise<ListAuditLogsResponse> {
  return get<ListAuditLogsResponse>('/api/admin/system/audit-logs', params);
}

/** API 密钥列表 */
export function listApiKeys(params: ListApiKeysQuery): Promise<ListApiKeysResponse> {
  return get<ListApiKeysResponse>('/api/admin/system/api-keys', params);
}

/** 创建 API 密钥(完整密钥仅返回一次) */
export function createApiKey(data: CreateApiKeyRequest): Promise<CreateApiKeyResponse> {
  return post<CreateApiKeyResponse>('/api/admin/system/api-keys', data);
}

/** 吊销 API 密钥 */
export function revokeApiKey(id: string): Promise<RevokeApiKeyResponse> {
  return del<RevokeApiKeyResponse>(`/api/admin/system/api-keys/${id}`);
}

/** 系统健康检查 */
export function getSystemHealth(): Promise<AdminSystemHealth> {
  return get<AdminSystemHealth>('/api/admin/system/health');
}

// ============================================================
// 邀请码 / 批量导入(Phase 5)
// 对应后端:/api/admin/tenants/:id/invitations + /students/batch
// ============================================================

/** 列出租户邀请码 */
export function listInvitations(tenantId: string): Promise<ListAdminInvitationsResponse> {
  return get<ListAdminInvitationsResponse>(`/api/admin/tenants/${tenantId}/invitations`);
}

/** 创建邀请码 */
export function createInvitation(
  tenantId: string,
  data: CreateAdminInvitationRequest,
): Promise<CreateAdminInvitationResponse> {
  return post<CreateAdminInvitationResponse>(`/api/admin/tenants/${tenantId}/invitations`, data);
}

/** 批量导入学生(有手机号直接建号,无手机号生成邀请码) */
export function batchImportStudents(
  tenantId: string,
  data: BatchImportStudentsRequest,
): Promise<BatchImportStudentsResponse> {
  return post<BatchImportStudentsResponse>(`/api/admin/tenants/${tenantId}/students/batch`, data);
}

// ============================================================
// 租户仲裁配置覆盖(P-04 / M-1)
// 对应后端:/api/admin/tenants/:id/arbitration-config
// ============================================================

/** 获取租户仲裁配置(生效配置 + isDefault 状态) */
export function getTenantArbitrationConfig(
  tenantId: string,
): Promise<GetTenantArbitrationConfigResponse> {
  return get<GetTenantArbitrationConfigResponse>(
    `/api/admin/tenants/${tenantId}/arbitration-config`,
  );
}

/** 更新租户仲裁配置(部分覆盖,深合并;写操作由请求层自动携带 X-CSRF-Token) */
export function updateTenantArbitrationConfig(
  tenantId: string,
  data: UpdateTenantArbitrationConfigRequest,
): Promise<GetTenantArbitrationConfigResponse> {
  return put<GetTenantArbitrationConfigResponse>(
    `/api/admin/tenants/${tenantId}/arbitration-config`,
    data,
  );
}

export type {
  AdminInvitationInfo,
  CreateAdminInvitationRequest,
  CreateAdminInvitationResponse,
  ListAdminInvitationsResponse,
  BatchImportStudentsRequest,
  BatchImportStudentsResponse,
  GetTenantArbitrationConfigResponse,
  UpdateTenantArbitrationConfigRequest,
};
