// ============================================================
// 用户管理 API
// 对应后端:/api/admin/users + /api/admin/roles
// ============================================================

import { get, post, patch } from './request';
import { rawRequest } from './request';
import type {
  ListAdminUsersQuery,
  ListAdminUsersResponse,
  AdminUserDetail,
  UpdateAdminUserRequest,
  LockAdminUserRequest,
  LockAdminUserResponse,
  BatchAdminUsersRequest,
  BatchAdminUsersResponse,
  ListAdminRolesResponse,
  UpdateAdminRoleRequest,
  UpdateAdminRoleResponse,
  ExportAdminUsersQueryLike,
} from './types';

/** GET /api/admin/users - 分页查询用户列表 */
export function listUsers(params: ListAdminUsersQuery): Promise<ListAdminUsersResponse> {
  return get<ListAdminUsersResponse>('/api/admin/users', params);
}

/** GET /api/admin/users/:id - 用户详情 */
export function getUser(id: string): Promise<AdminUserDetail> {
  return get<AdminUserDetail>(`/api/admin/users/${id}`);
}

/** PATCH /api/admin/users/:id - 更新用户(角色/状态/资料) */
export function updateUser(id: string, data: UpdateAdminUserRequest): Promise<AdminUserDetail> {
  return patch<AdminUserDetail>(`/api/admin/users/${id}`, data);
}

/** POST /api/admin/users/:id/lock - 锁定/解锁 */
export function lockUser(id: string, data: LockAdminUserRequest): Promise<LockAdminUserResponse> {
  return post<LockAdminUserResponse>(`/api/admin/users/${id}/lock`, data);
}

/** POST /api/admin/users/batch - 批量操作 */
export function batchUsers(data: BatchAdminUsersRequest): Promise<BatchAdminUsersResponse> {
  return post<BatchAdminUsersResponse>('/api/admin/users/batch', data);
}

/** GET /api/admin/users/export - 导出 CSV(流式下载,后端已脱敏) */
export async function exportUsersCsv(params: ExportAdminUsersQueryLike): Promise<Blob> {
  const res = await rawRequest({
    method: 'GET',
    url: '/api/admin/users/export',
    params,
    responseType: 'blob',
    headers: { Accept: 'text/csv' },
  });
  return res.data as Blob;
}

/** GET /api/admin/roles - 角色权限矩阵 */
export function listRoles(): Promise<ListAdminRolesResponse> {
  return get<ListAdminRolesResponse>('/api/admin/roles');
}

/** PATCH /api/admin/roles/:role - 更新角色权限 */
export function updateRole(
  role: string,
  data: UpdateAdminRoleRequest,
): Promise<UpdateAdminRoleResponse> {
  return patch<UpdateAdminRoleResponse>(`/api/admin/roles/${role}`, data);
}
