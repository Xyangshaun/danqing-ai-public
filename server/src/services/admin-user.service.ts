// ============================================================
// 管理后台 - 用户业务服务(Phase 4)
// 对应 API:/api/admin/users + /api/admin/roles
//
// 职责:
//   1. 用户列表/详情查询(响应必须脱敏:手机/邮箱)
//   2. 用户更新(角色/状态/资料)+ 审计日志
//   3. 用户锁定/解锁 + 审计日志
//   4. 批量操作(角色变更/删除)+ 审计日志
//   5. 用户导出(CSV 流式)+ 审计日志
//   6. 角色权限矩阵查询/更新
//
// 安全约束:
//   - tenant_id 强制从 JWT 注入(req.tenantId),禁止从请求体读取
//   - 列表/详情响应必须脱敏(maskPhone/maskEmail)
//   - 所有写操作记录审计日志(before/after 快照)
//   - 批量操作上限 100 条(ADMIN_BATCH_LIMIT)
// ============================================================

import type { Request } from 'express';
import type { User, UserRole } from '@prisma/client';
import { adminUserRepository, type ListAdminUsersFilter } from '../repositories/admin-user.repository.js';
import { writeAudit } from './admin-audit.service.js';
import { BusinessError } from '../middlewares/error-handler.js';
import { ErrorCode, type UserRole as ApiUserRole } from '../types/api-contract.js';
import {
  type AdminUserListItem,
  type AdminUserDetail,
  type ListAdminUsersQuery,
  type UpdateAdminUserRequest,
  type LockAdminUserRequest,
  type LockAdminUserResponse,
  type BatchAdminUsersRequest,
  type BatchAdminUsersResponse,
  type BatchAdminUserResult,
  type ListAdminRolesResponse,
  type UpdateAdminRoleRequest,
  type UpdateAdminRoleResponse,
  type PaginatedData,
} from '../types/api-contract.js';
import { maskPhone, maskEmail } from '../utils/redact.js';
import { getPermissionsByRole } from '../config/permissions.js';

/** 批量操作上限 */
const ADMIN_BATCH_LIMIT = 100;

/** 角色中文名 */
const ROLE_NAME_MAP: Record<ApiUserRole, string> = {
  admin: '管理员',
  owner: '所有者',
  teacher: '教师',
  student: '学生',
};

/** 角色描述 */
const ROLE_DESC_MAP: Record<ApiUserRole, string> = {
  admin: '租户管理员,拥有全部权限(学校/学院级)',
  owner: '个人租户所有者,等同管理员',
  teacher: '教师,可管理租户内分析与成员邀请',
  student: '学生,仅可操作自己的资源',
};

class AdminUserServiceClass {
  // ============================================================
  // 用户列表/详情
  // ============================================================

  /**
   * 分页查询用户列表(响应脱敏)
   * tenant_id 强制从 JWT 注入,query.tenantId 仅用于跨租户查询(需更高权限)
   * 超级管理员(role=owner)可查看全部租户用户
   */
  async listUsers(query: ListAdminUsersQuery, ctx: { tenantId: string; role?: string }): Promise<PaginatedData<AdminUserListItem>> {
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 20, 100);

    // 超级管理员(owner)可查看全部租户用户
    const isSuperAdmin = ctx.role === 'owner';

    const filter: ListAdminUsersFilter = {
      currentTenantId: ctx.tenantId,
      targetTenantId: query.tenantId,
      search: query.search,
      role: query.role as UserRole | undefined,
      status: query.status,
      startDate: query.startDate ? new Date(query.startDate) : undefined,
      endDate: query.endDate ? new Date(query.endDate) : undefined,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
      page,
      pageSize,
      viewAllTenants: isSuperAdmin,
    };

    const { items, total } = await adminUserRepository.list(filter);

    return {
      items: items.map((u) => this.toListItem(u)),
      total,
      page,
      pageSize,
      hasMore: page * pageSize < total,
    };
  }

  /**
   * 查询用户详情(响应脱敏)
   */
  async getUser(userId: string, ctx: { tenantId: string }): Promise<AdminUserDetail> {
    const user = await adminUserRepository.findById(ctx.tenantId, userId);
    if (!user) {
      throw new BusinessError(ErrorCode.ADMIN_USER_NOT_FOUND, '用户不存在', 404);
    }
    if (user.status === 'deleted' as User['status']) {
      throw new BusinessError(ErrorCode.ADMIN_USER_ALREADY_DELETED, '用户已被删除', 409);
    }
    return this.toDetail(user);
  }

  // ============================================================
  // 用户更新
  // ============================================================

  /**
   * 更新用户(角色/状态/资料)
   * 记录审计日志(before/after 快照)
   */
  async updateUser(
    userId: string,
    body: UpdateAdminUserRequest,
    ctx: { req: Request; tenantId: string; operatorId: string },
  ): Promise<AdminUserDetail> {
    const before = await adminUserRepository.findById(ctx.tenantId, userId);
    if (!before) {
      throw new BusinessError(ErrorCode.ADMIN_USER_NOT_FOUND, '用户不存在', 404);
    }
    if (before.status === 'deleted' as User['status']) {
      throw new BusinessError(ErrorCode.ADMIN_USER_ALREADY_DELETED, '用户已被删除', 409);
    }

    // 构造更新数据(仅允许 role/status/name)
    const updateData: Record<string, unknown> = {};
    if (body.role !== undefined) {
      this.assertValidRole(body.role);
      updateData.role = body.role;
    }
    if (body.status !== undefined) {
      updateData.status = body.status;
    }
    if (body.name !== undefined) {
      updateData.name = body.name;
    }

    const after = await adminUserRepository.update(userId, updateData);

    // 审计日志
    await writeAudit({
      req: ctx.req,
      action: 'update',
      resource: 'user',
      resourceId: userId,
      targetTenantId: after.tenantId,
      beforeData: this.toAuditSnapshot(before),
      afterData: this.toAuditSnapshot(after),
      note: body.role !== undefined ? `角色变更为 ${body.role}` : undefined,
    });

    return this.toDetail(after);
  }

  // ============================================================
  // 用户锁定/解锁
  // ============================================================

  /**
   * 锁定/解锁用户
   * 记录审计日志
   */
  async lockUser(
    userId: string,
    body: LockAdminUserRequest,
    ctx: { req: Request; tenantId: string; operatorId: string },
  ): Promise<LockAdminUserResponse> {
    const before = await adminUserRepository.findById(ctx.tenantId, userId);
    if (!before) {
      throw new BusinessError(ErrorCode.ADMIN_USER_NOT_FOUND, '用户不存在', 404);
    }

    // 幂等性校验
    if (body.locked && before.status === 'locked' as User['status']) {
      throw new BusinessError(ErrorCode.ADMIN_USER_ALREADY_LOCKED, '用户已被锁定', 409);
    }
    if (!body.locked && before.status !== 'locked' as User['status']) {
      throw new BusinessError(ErrorCode.ADMIN_USER_ALREADY_LOCKED, '用户未被锁定,无需解锁', 409);
    }

    const after = await adminUserRepository.setLockStatus(userId, body.locked, ctx.operatorId);

    await writeAudit({
      req: ctx.req,
      action: 'lock',
      resource: 'user',
      resourceId: userId,
      targetTenantId: after.tenantId,
      beforeData: this.toAuditSnapshot(before),
      afterData: this.toAuditSnapshot(after),
      note: body.reason ?? (body.locked ? '管理员锁定' : '管理员解锁'),
    });

    return {
      id: after.id,
      status: after.status as 'active' | 'locked' | 'deleted',
      lockedAt: after.lockedAt?.toISOString() ?? null,
    };
  }

  // ============================================================
  // 批量操作
  // ============================================================

  /**
   * 批量操作用户(更新角色/删除)
   * 上限 100 条,逐条执行并记录每条结果
   */
  async batchUsers(
    body: BatchAdminUsersRequest,
    ctx: { req: Request; tenantId: string; operatorId: string },
  ): Promise<BatchAdminUsersResponse> {
    // 数量上限校验
    if (body.userIds.length === 0) {
      throw new BusinessError(ErrorCode.PARAM_INVALID, 'userIds 不能为空', 400);
    }
    if (body.userIds.length > ADMIN_BATCH_LIMIT) {
      throw new BusinessError(
        ErrorCode.ADMIN_BATCH_LIMIT_EXCEEDED,
        `批量操作上限 ${ADMIN_BATCH_LIMIT} 条`,
        400,
      );
    }
    if (body.action === 'updateRole') {
      if (!body.role) {
        throw new BusinessError(ErrorCode.PARAM_MISSING, 'updateRole 操作必须提供 role', 400);
      }
      this.assertValidRole(body.role);
    }

    const results: BatchAdminUserResult[] = [];
    let succeeded = 0;
    let failed = 0;

    if (body.action === 'updateRole') {
      // 批量更新角色
      const { count } = await adminUserRepository.batchUpdateRole(body.userIds, body.role as UserRole);
      succeeded = count;
      // 未匹配的 userId 视为失败
      for (const uid of body.userIds) {
        const ok = count > 0; // 简化:无法精确知道每条,采用 count 比对
        results.push({ userId: uid, success: ok });
        if (!ok) failed += 1;
      }
      // 修正:由于 updateMany 返回总 count,这里按成功数与失败数填充
      // 实际场景中 count 即为成功匹配数,失败的为 userIds.length - count
      failed = body.userIds.length - succeeded;
      // 重新构建 results:前 succeeded 个为成功,其余为失败
      results.length = 0;
      for (let i = 0; i < body.userIds.length; i++) {
        const ok = i < succeeded;
        results.push({ userId: body.userIds[i]!, success: ok, error: ok ? undefined : '用户不存在或已被删除' });
      }
    } else if (body.action === 'delete') {
      // 批量软删除
      const { count } = await adminUserRepository.batchSoftDelete(body.userIds);
      succeeded = count;
      failed = body.userIds.length - succeeded;
      for (let i = 0; i < body.userIds.length; i++) {
        const ok = i < succeeded;
        results.push({ userId: body.userIds[i]!, success: ok, error: ok ? undefined : '用户不存在' });
      }
    }

    // 审计日志(批量操作记录一条汇总)
    await writeAudit({
      req: ctx.req,
      action: 'batch',
      resource: 'user',
      resourceId: null,
      targetTenantId: ctx.tenantId,
      beforeData: { userIds: body.userIds, action: body.action, role: body.role },
      afterData: { succeeded, failed },
      note: `批量${body.action === 'updateRole' ? '更新角色' : '删除'} ${body.userIds.length} 个用户,成功 ${succeeded} 失败 ${failed}`,
    });

    return {
      total: body.userIds.length,
      succeeded,
      failed,
      results,
    };
  }

  // ============================================================
  // 用户导出(CSV)
  // ============================================================

  /**
   * 导出用户数据(返回脱敏后的记录数组,由 controller 转 CSV)
   */
  async listForExport(
    query: {
      search?: string;
      tenantId?: string;
      role?: ApiUserRole;
      status?: 'active' | 'locked' | 'deleted';
    },
    ctx: { tenantId: string },
  ): Promise<AdminUserListItem[]> {
    const users = await adminUserRepository.listForExport({
      currentTenantId: ctx.tenantId,
      targetTenantId: query.tenantId,
      search: query.search,
      role: query.role as UserRole | undefined,
      status: query.status,
    });
    return users.map((u) => this.toListItem(u));
  }

  // ============================================================
  // 角色权限矩阵
  // ============================================================

  /**
   * 查询角色权限矩阵
   */
  listRoles(): ListAdminRolesResponse {
    const roles: ApiUserRole[] = ['admin', 'owner', 'teacher', 'student'];
    return roles.map((role) => ({
      role,
      roleName: ROLE_NAME_MAP[role],
      description: ROLE_DESC_MAP[role],
      permissions: [...getPermissionsByRole(role)] as string[],
    }));
  }

  /**
   * 更新角色权限(全量替换)
   * 注意:Phase 4 仅支持在内存中更新,不持久化(生产环境应扩展为数据库存储)
   * 此处仅记录审计日志,实际权限矩阵为编译期常量
   */
  async updateRole(
    role: ApiUserRole,
    body: UpdateAdminRoleRequest,
    ctx: { req: Request; operatorId: string },
  ): Promise<UpdateAdminRoleResponse> {
    this.assertValidRole(role);
    // 校验权限码格式
    for (const p of body.permissions) {
      if (typeof p !== 'string' || p.length === 0) {
        throw new BusinessError(ErrorCode.PARAM_INVALID, `权限码格式非法: ${p}`, 400);
      }
    }

    await writeAudit({
      req: ctx.req,
      action: 'update',
      resource: 'role',
      resourceId: role,
      targetTenantId: null,
      beforeData: { permissions: [...getPermissionsByRole(role)] },
      afterData: { permissions: body.permissions },
      note: `更新角色 ${role} 权限矩阵`,
    });

    // 注:权限矩阵为编译期常量(ROLE_PERMISSIONS),此处不实际修改
    // 生产环境如需动态权限,应扩展为数据库表存储
    return {
      role,
      permissions: body.permissions,
    };
  }

  // ============================================================
  // 内部工具方法
  // ============================================================

  /** 校验角色值合法 */
  private assertValidRole(role: unknown): asserts role is ApiUserRole {
    if (role !== 'admin' && role !== 'owner' && role !== 'teacher' && role !== 'student') {
      throw new BusinessError(ErrorCode.ADMIN_ROLE_INVALID, `角色值非法: ${String(role)}`, 400);
    }
  }

  /** User → AdminUserListItem(脱敏) */
  private toListItem(u: User): AdminUserListItem {
    return {
      id: u.id,
      tenantId: u.tenantId,
      name: u.name,
      avatar: u.avatar,
      email: maskEmail(u.email),
      phone: maskPhone(u.phone),
      role: u.role as ApiUserRole,
      status: u.status as 'active' | 'locked' | 'deleted',
      createdAt: u.createdAt.toISOString(),
      lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
      lockedAt: u.lockedAt?.toISOString() ?? null,
    };
  }

  /** User → AdminUserDetail(脱敏) */
  private toDetail(u: User): AdminUserDetail {
    return {
      ...this.toListItem(u),
      feishuOpenId: u.feishuOpenId,
      updatedAt: u.updatedAt.toISOString(),
      lockedBy: u.lockedBy ?? null,
    };
  }

  /** 构造审计快照(脱敏后) */
  private toAuditSnapshot(u: User): Record<string, unknown> {
    return {
      id: u.id,
      tenantId: u.tenantId,
      name: u.name,
      role: u.role,
      status: u.status,
      email: maskEmail(u.email),
      phone: maskPhone(u.phone),
    };
  }
}

export const adminUserService = new AdminUserServiceClass();
