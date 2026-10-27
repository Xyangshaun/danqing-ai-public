// ============================================================
// 租户业务服务
// 对应 API:
//   GET  /tenants/current      获取当前租户(含配额)
//   POST /tenants/switch       切换激活租户(重签 access_token)
//   GET  /tenants              列出当前用户的所有租户成员关系
//   GET  /tenants/:id/members  列出租户成员(需 user:read)
//   POST /tenants/:id/members  邀请成员(需 user:invite)
//   DELETE /tenants/:id/members/:userId  移除成员(需 user:remove)
// ============================================================

import { tenantRepository } from '../repositories/tenant.repository.js';
import { userRepository } from '../repositories/user.repository.js';
import { jwtService } from './jwt.service.js';
import { BusinessError } from '../middlewares/error-handler.js';
import {
  ErrorCode,
  type TenantInfo,
  type SwitchTenantResponse,
  type UserRole,
  type TenantMembership,
  type ListUserTenantsResponse,
  type ListTenantMembersResponse,
  type InviteMemberResponse,
} from '../types/api-contract.js';
import { redis } from '../config/redis.js';
import { logger } from '../utils/logger.js';
import type { Tenant } from '@prisma/client';

/**
 * 订阅计划对应配额上限(对应 data-model-v1.md §3 TenantPlan)
 */
const PLAN_QUOTA: Record<Tenant['plan'], number> = {
  free: 50,
  standard: 2000,
  enterprise: -1, // 无限
};

class TenantServiceClass {
  /**
   * 获取当前租户信息(含当月配额使用情况)
   */
  async getCurrentTenant(tenantId: string): Promise<TenantInfo> {
    const tenant = await tenantRepository.findById(tenantId);
    if (!tenant) {
      throw new BusinessError(ErrorCode.TENANT_NOT_FOUND, '租户不存在', 404);
    }
    if (tenant.status === 'disabled') {
      throw new BusinessError(ErrorCode.TENANT_DISABLED, '租户已被禁用', 403);
    }

    // 当月已用分析次数(从 Redis 计数器读取;若无则查 DB)
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth() + 1;
    const monthKey = `${year}${String(month).padStart(2, '0')}`;
    const redisKey = `tenant:${tenantId}:quota:${monthKey}`;
    let usedQuota: number;
    try {
      const cached = await redis().get(redisKey);
      usedQuota = cached ? parseInt(cached, 10) : 0;
    } catch {
      // Redis 不可达时,降级到 DB 查询
      const { analysisRepository } = await import('../repositories/analysis.repository.js');
      usedQuota = await analysisRepository.countMonthlyUsage(tenantId, year, month);
    }

    return {
      id: tenant.id,
      name: tenant.name,
      type: tenant.type as TenantInfo['type'],
      feishuTenantKey: tenant.feishuTenantKey,
      plan: tenant.plan as TenantInfo['plan'],
      status: tenant.status as TenantInfo['status'],
      maxSeats: tenant.maxSeats,
      parentId: tenant.parentId,
      createdAt: tenant.createdAt.toISOString(),
      usedQuota,
      maxQuota: PLAN_QUOTA[tenant.plan],
    };
  }

  /**
   * 切换租户
   * 流程(对应 auth-design.md §2.4 多租户 JWT 处理):
   *   1. 校验目标租户存在且 active
   *   2. 校验用户是该租户成员(查 TenantMember)
   *   3. 获取用户在目标租户的 role
   *   4. 更新 User.tenant_id(当前激活租户)+ User.role(冗余同步)
   *   5. 签发新 access_token(payload 含新 tenant_id + role)
   *   6. refresh_token 不变(保持登录态,不重签)
   *   7. 返回 {accessToken, accessTokenExpiresAt, tenant, role}
   *
   * 错误码:
   *   - 3001 TENANT_NOT_FOUND:目标租户不存在
   *   - 3002 TENANT_DISABLED:目标租户已禁用
   *   - 2004 FORBIDDEN:用户不属于该租户
   */
  async switchTenant(params: {
    userId: string;
    targetTenantId: string;
    feishuOpenId: string;
    client: 'web' | 'admin' | 'mobile';
  }): Promise<SwitchTenantResponse> {
    // 1. 校验目标租户存在且 active
    const tenant = await tenantRepository.findById(params.targetTenantId);
    if (!tenant) {
      throw new BusinessError(ErrorCode.TENANT_NOT_FOUND, '租户不存在', 404);
    }
    if (tenant.status === 'disabled') {
      throw new BusinessError(ErrorCode.TENANT_DISABLED, '租户已被禁用', 403);
    }

    // 2. 校验用户属于该租户
    const membership = await tenantRepository.findMembership(params.userId, params.targetTenantId);
    if (!membership) {
      throw new BusinessError(ErrorCode.FORBIDDEN, '您不属于该租户', 403);
    }

    // 3. 更新 User.tenantId + role(冗余字段同步)
    await userRepository.switchTenant(params.userId, params.targetTenantId, membership.role as UserRole);

    // 4. 签发新 access_token(refresh_token 不变)
    const accessResult = jwtService.issueAccessToken({
      userId: params.userId,
      tenantId: tenant.id,
      role: membership.role as UserRole,
      feishuOpenId: params.feishuOpenId,
      client: params.client,
    });

    logger.info({ userId: params.userId, from: 'old', to: tenant.id }, '[tenant] switched');

    return {
      accessToken: accessResult.token,
      accessTokenExpiresAt: accessResult.expiresAt.toISOString(),
      tenant: this.toTenantInfo(tenant),
      role: membership.role as UserRole,
    };
  }

  /**
   * 列出当前用户的所有租户成员关系
   * 用于 GET /tenants(用户可切换的租户列表)
   */
  async listUserTenants(userId: string): Promise<ListUserTenantsResponse> {
    const memberships = await userRepository.findMemberships(userId);
    return memberships.map((m) => ({
      tenantId: m.tenant.id,
      tenantName: m.tenant.name,
      tenantType: m.tenant.type as TenantMembership['tenantType'],
      role: m.role as UserRole,
      joinedAt: m.joinedAt.toISOString(),
    }));
  }

  /**
   * 列出租户全部成员(含用户基础信息)
   * 用于 GET /tenants/:id/members(需 user:read 权限)
   */
  async listMembers(tenantId: string): Promise<ListTenantMembersResponse> {
    // 校验租户存在
    const tenant = await tenantRepository.findById(tenantId);
    if (!tenant) {
      throw new BusinessError(ErrorCode.TENANT_NOT_FOUND, '租户不存在', 404);
    }

    const members = await tenantRepository.listMembers(tenantId);
    return members.map((m) => ({
      userId: m.userId,
      tenantId: m.tenantId,
      role: m.role as UserRole,
      joinedAt: m.joinedAt.toISOString(),
      user: {
        id: m.user.id,
        name: m.user.name,
        avatar: m.user.avatar,
        email: m.user.email,
        feishuOpenId: m.user.feishuOpenId,
      },
    }));
  }

  /**
   * 邀请用户加入租户
   * 用于 POST /tenants/:id/members(需 user:invite 权限)
   *
   * 校验:
   *   1. 目标租户存在且 active
   *   2. 被邀请用户存在(按 userId)
   *   3. 租户席位未满(memberCount < maxSeats)
   *   4. 用户尚未是该租户成员(避免重复添加)
   */
  async inviteMember(params: {
    tenantId: string;
    targetUserId: string;
    role: UserRole;
  }): Promise<InviteMemberResponse> {
    const { tenantId, targetUserId, role } = params;

    // 1. 校验租户
    const tenant = await tenantRepository.findById(tenantId);
    if (!tenant) {
      throw new BusinessError(ErrorCode.TENANT_NOT_FOUND, '租户不存在', 404);
    }
    if (tenant.status === 'disabled') {
      throw new BusinessError(ErrorCode.TENANT_DISABLED, '租户已被禁用', 403);
    }

    // 2. 校验被邀请用户存在
    const targetUser = await userRepository.findById(targetUserId);
    if (!targetUser) {
      throw new BusinessError(ErrorCode.RESOURCE_NOT_FOUND, '被邀请用户不存在', 404);
    }

    // 3. 校验席位
    const memberCount = await tenantRepository.countMembers(tenantId);
    if (memberCount >= tenant.maxSeats) {
      throw new BusinessError(ErrorCode.TENANT_SEATS_FULL, '租户席位已满', 403);
    }

    // 4. 校验尚未是成员
    const existing = await tenantRepository.findMembership(targetUserId, tenantId);
    if (existing) {
      throw new BusinessError(ErrorCode.DUPLICATE_RESOURCE, '该用户已是租户成员', 409);
    }

    // 5. 创建成员关系
    const membership = await tenantRepository.createMembership({
      userId: targetUserId,
      tenantId,
      role,
    });

    logger.info(
      { tenantId, targetUserId, role },
      '[tenant] member invited',
    );

    return {
      userId: membership.userId,
      tenantId: membership.tenantId,
      role: membership.role as UserRole,
      joinedAt: membership.joinedAt.toISOString(),
    };
  }

  /**
   * 移除租户成员
   * 用于 DELETE /tenants/:id/members/:userId(需 user:remove 权限)
   *
   * 校验:
   *   1. 目标租户存在
   *   2. 被移除用户是该租户成员
   *   3. 不可移除自己(防止误操作导致无主租户)
   */
  async removeMember(params: {
    tenantId: string;
    targetUserId: string;
    currentUserId: string;
  }): Promise<{ removed: boolean; userId: string }> {
    const { tenantId, targetUserId, currentUserId } = params;

    // 防止移除自己
    if (targetUserId === currentUserId) {
      throw new BusinessError(ErrorCode.PARAM_INVALID, '不可移除自己,如需退出请联系管理员', 400);
    }

    // 校验租户存在
    const tenant = await tenantRepository.findById(tenantId);
    if (!tenant) {
      throw new BusinessError(ErrorCode.TENANT_NOT_FOUND, '租户不存在', 404);
    }

    // 校验被移除用户是成员
    const existing = await tenantRepository.findMembership(targetUserId, tenantId);
    if (!existing) {
      throw new BusinessError(ErrorCode.RESOURCE_NOT_FOUND, '该用户不是租户成员', 404);
    }

    // 执行删除
    await tenantRepository.deleteMembership(targetUserId, tenantId);

    logger.info(
      { tenantId, targetUserId, removedBy: currentUserId },
      '[tenant] member removed',
    );

    return { removed: true, userId: targetUserId };
  }

  private toTenantInfo(tenant: Tenant): TenantInfo {
    return {
      id: tenant.id,
      name: tenant.name,
      type: tenant.type as TenantInfo['type'],
      feishuTenantKey: tenant.feishuTenantKey,
      plan: tenant.plan as TenantInfo['plan'],
      status: tenant.status as TenantInfo['status'],
      maxSeats: tenant.maxSeats,
      parentId: tenant.parentId,
      createdAt: tenant.createdAt.toISOString(),
    };
  }
}

export const tenantService = new TenantServiceClass();
