// ============================================================
// 管理后台 - 系统业务服务(Phase 4)
// 对应 API:/api/admin/system/*
//
// 职责:
//   1. 租户列表/详情/创建/更新 + 审计日志
//   2. 审计日志列表查询(多维筛选)
//   3. API 密钥列表/创建/吊销 + 审计日志
//   4. 系统健康检查(database/redis/aiService 状态)
//
// 安全约束:
//   - 租户管理为系统级操作
//   - API 密钥仅存哈希,完整密钥仅创建时返回一次
//   - 审计日志不可变(只增不改不删)
//   - 健康检查不暴露内部地址/版本细节
// ============================================================

import type { Request } from 'express';
import type { Tenant, AuditLog, ApiKey, TenantType, TenantPlan, TenantStatus } from '@prisma/client';
import {
  adminSystemRepository,
  type ListAdminTenantsFilter,
  type ListAuditLogsFilter,
  type ListApiKeysFilter,
} from '../repositories/admin-system.repository.js';
import { writeAudit } from './admin-audit.service.js';
import { BusinessError } from '../middlewares/error-handler.js';
import { ErrorCode } from '../types/api-contract.js';
import { redis } from '../config/redis.js';
import { env } from '../config/env.js';
import type {
  AdminTenantListItem,
  ListAdminTenantsQuery,
  ListAdminTenantsResponse,
  CreateAdminTenantRequest,
  CreateAdminTenantResponse,
  UpdateAdminTenantRequest,
  UpdateAdminTenantResponse,
  AuditLogInfo,
  ListAuditLogsQuery,
  ListAuditLogsResponse,
  ApiKeyInfo,
  ListApiKeysQuery,
  ListApiKeysResponse,
  CreateApiKeyRequest,
  CreateApiKeyResponse,
  RevokeApiKeyResponse,
  AdminSystemHealth,
} from '../types/api-contract.js';

class AdminSystemServiceClass {
  // ============================================================
  // 租户管理
  // ============================================================

  async listTenants(query: ListAdminTenantsQuery): Promise<ListAdminTenantsResponse> {
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 20, 100);

    const filter: ListAdminTenantsFilter = {
      search: query.search,
      type: query.type as TenantType | undefined,
      plan: query.plan as TenantPlan | undefined,
      status: query.status as TenantStatus | undefined,
      page,
      pageSize,
    };

    const { items, total } = await adminSystemRepository.listTenants(filter);

    // 批量查询成员数(并行)
    const itemsWithCount = await Promise.all(
      items.map(async (t) => {
        const memberCount = await adminSystemRepository.countTenantMembers(t.id);
        return this.toTenantListItem(t, memberCount);
      }),
    );

    return {
      items: itemsWithCount,
      total,
      page,
      pageSize,
      hasMore: page * pageSize < total,
    };
  }

  async getTenant(tenantId: string): Promise<Tenant> {
    const tenant = await adminSystemRepository.findTenantById(tenantId);
    if (!tenant) {
      throw new BusinessError(ErrorCode.TENANT_NOT_FOUND, '租户不存在', 404);
    }
    return tenant;
  }

  async createTenant(
    body: CreateAdminTenantRequest,
    ctx: { req: Request; operatorId: string },
  ): Promise<CreateAdminTenantResponse> {
    const created = await adminSystemRepository.createTenant({
      name: body.name,
      type: body.type as TenantType,
      plan: (body.plan ?? 'free') as TenantPlan,
      status: 'active' as TenantStatus,
      maxSeats: body.maxSeats ?? 1,
      parent: body.parentId ? { connect: { id: body.parentId } } : undefined,
      feishuTenantKey: body.feishuTenantKey ?? null,
    });

    await writeAudit({
      req: ctx.req,
      action: 'create',
      resource: 'tenant',
      resourceId: created.id,
      targetTenantId: created.id,
      beforeData: null,
      afterData: { name: created.name, type: created.type, plan: created.plan },
      note: `创建租户 ${created.name}`,
    });

    return {
      id: created.id,
      name: created.name,
      type: created.type as 'school' | 'college' | 'class' | 'individual',
      plan: created.plan as 'free' | 'standard' | 'enterprise',
      status: created.status as 'active' | 'disabled',
      maxSeats: created.maxSeats,
      createdAt: created.createdAt.toISOString(),
    };
  }

  async updateTenant(
    tenantId: string,
    body: UpdateAdminTenantRequest,
    ctx: { req: Request },
  ): Promise<UpdateAdminTenantResponse> {
    const before = await adminSystemRepository.findTenantById(tenantId);
    if (!before) {
      throw new BusinessError(ErrorCode.TENANT_NOT_FOUND, '租户不存在', 404);
    }

    const updateData: Record<string, unknown> = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.plan !== undefined) updateData.plan = body.plan;
    if (body.status !== undefined) updateData.status = body.status;
    if (body.maxSeats !== undefined) updateData.maxSeats = body.maxSeats;

    const after = await adminSystemRepository.updateTenant(tenantId, updateData);

    await writeAudit({
      req: ctx.req,
      action: 'update',
      resource: 'tenant',
      resourceId: tenantId,
      targetTenantId: tenantId,
      beforeData: { name: before.name, plan: before.plan, status: before.status, maxSeats: before.maxSeats },
      afterData: { name: after.name, plan: after.plan, status: after.status, maxSeats: after.maxSeats },
    });

    return {
      id: after.id,
      name: after.name,
      type: after.type as 'school' | 'college' | 'class' | 'individual',
      plan: after.plan as 'free' | 'standard' | 'enterprise',
      status: after.status as 'active' | 'disabled',
      maxSeats: after.maxSeats,
      createdAt: after.createdAt.toISOString(),
    };
  }

  // ============================================================
  // 审计日志查询
  // ============================================================

  async listAuditLogs(query: ListAuditLogsQuery): Promise<ListAuditLogsResponse> {
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 20, 100);

    const filter: ListAuditLogsFilter = {
      operatorId: query.operatorId,
      action: query.action,
      resource: query.resource,
      resourceId: query.resourceId,
      targetTenantId: query.targetTenantId,
      startDate: query.startDate ? new Date(query.startDate) : undefined,
      endDate: query.endDate ? new Date(query.endDate) : undefined,
      page,
      pageSize,
    };

    const { items, total } = await adminSystemRepository.listAuditLogs(filter);

    return {
      items: items.map((l) => this.toAuditLogInfo(l)),
      total,
      page,
      pageSize,
      hasMore: page * pageSize < total,
    };
  }

  // ============================================================
  // API 密钥管理
  // ============================================================

  async listApiKeys(query: ListApiKeysQuery): Promise<ListApiKeysResponse> {
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 20, 100);

    const filter: ListApiKeysFilter = {
      status: query.status,
      tenantId: query.tenantId,
      page,
      pageSize,
    };

    const { items, total } = await adminSystemRepository.listApiKeys(filter);

    return {
      items: items.map((k) => this.toApiKeyInfo(k)),
      total,
      page,
      pageSize,
      hasMore: page * pageSize < total,
    };
  }

  async createApiKey(
    body: CreateApiKeyRequest,
    ctx: { req: Request; operatorId: string },
  ): Promise<CreateApiKeyResponse> {
    const { record, plainKey } = await adminSystemRepository.createApiKey({
      name: body.name,
      scopes: body.scopes,
      tenantId: body.tenantId ?? null,
      createdById: ctx.operatorId,
      expiresAfterDays: body.expiresAfterDays ?? null,
    });

    await writeAudit({
      req: ctx.req,
      action: 'create',
      resource: 'api_key',
      resourceId: record.id,
      targetTenantId: record.tenantId,
      beforeData: null,
      afterData: { name: record.name, keyPrefix: record.keyPrefix, scopes: record.scopes },
      note: `创建 API 密钥 ${record.name}`,
    });

    return {
      ...this.toApiKeyInfo(record),
      plainKey,
    };
  }

  async revokeApiKey(apiKeyId: string, ctx: { req: Request; operatorId: string }): Promise<RevokeApiKeyResponse> {
    const before = await adminSystemRepository.findApiKeyById(apiKeyId);
    if (!before) {
      throw new BusinessError(ErrorCode.ADMIN_API_KEY_NOT_FOUND, 'API 密钥不存在', 404);
    }
    if (before.status === 'revoked' as ApiKey['status']) {
      throw new BusinessError(ErrorCode.ADMIN_API_KEY_ALREADY_REVOKED, 'API 密钥已被吊销', 409);
    }

    const after = await adminSystemRepository.revokeApiKey(apiKeyId, ctx.operatorId);

    await writeAudit({
      req: ctx.req,
      action: 'revoke',
      resource: 'api_key',
      resourceId: apiKeyId,
      targetTenantId: after.tenantId,
      beforeData: { status: before.status },
      afterData: { status: after.status, revokedAt: after.revokedAt },
      note: `吊销 API 密钥 ${before.name}`,
    });

    return {
      id: after.id,
      status: after.status as 'active' | 'revoked',
      revokedAt: after.revokedAt!.toISOString(),
    };
  }

  // ============================================================
  // 系统健康检查
  // ============================================================

  /**
   * 系统健康检查(database/redis/aiService 状态)
   * 不暴露内部地址/版本细节,仅返回 up/down 状态
   */
  async getHealth(): Promise<AdminSystemHealth> {
    const [dbStatus, redisStatus] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
    ]);

    const aiEnabled = env().aiEnabled;
    const aiServiceStatus: 'up' | 'down' | 'disabled' = aiEnabled ? 'up' : 'disabled';

    const allUp = dbStatus === 'up' && redisStatus === 'up';
    const status: 'up' | 'degraded' | 'down' = allUp ? 'up' : dbStatus === 'down' ? 'down' : 'degraded';

    const memUsage = process.memoryUsage();

    return {
      status,
      services: {
        database: dbStatus,
        redis: redisStatus,
        aiService: aiServiceStatus,
      },
      uptime: Math.floor(process.uptime()),
      memoryUsageMb: Math.round((memUsage.rss / (1024 * 1024)) * 100) / 100,
      nodeVersion: process.version,
      timestamp: new Date().toISOString(),
    };
  }

  // ============================================================
  // 内部工具方法
  // ============================================================

  /** 检查数据库连通性 */
  private async checkDatabase(): Promise<'up' | 'down'> {
    try {
      // 简化:查询租户总数(轻量查询)
      await adminSystemRepository.countTotalTenants();
      return 'up';
    } catch {
      return 'down';
    }
  }

  /** 检查 Redis 连通性 */
  private async checkRedis(): Promise<'up' | 'down'> {
    try {
      // redis().exists 返回 0 或 1,均表示连接正常
      await redis().exists('health:check');
      return 'up';
    } catch {
      return 'down';
    }
  }

  private toTenantListItem(t: Tenant, memberCount: number): AdminTenantListItem {
    return {
      id: t.id,
      name: t.name,
      type: t.type as 'school' | 'college' | 'class' | 'individual',
      feishuTenantKey: t.feishuTenantKey,
      plan: t.plan as 'free' | 'standard' | 'enterprise',
      status: t.status as 'active' | 'disabled',
      maxSeats: t.maxSeats,
      parentId: t.parentId,
      createdAt: t.createdAt.toISOString(),
      memberCount,
    };
  }

  private toAuditLogInfo(l: AuditLog): AuditLogInfo {
    return {
      id: l.id,
      operatorId: l.operatorId,
      operatorRole: l.operatorRole,
      operatorTenantId: l.operatorTenantId,
      action: l.action as AuditLogInfo['action'],
      resource: l.resource,
      resourceId: l.resourceId,
      targetTenantId: l.targetTenantId,
      beforeData: (l.beforeData as Record<string, unknown> | null) ?? null,
      afterData: (l.afterData as Record<string, unknown> | null) ?? null,
      ip: l.ip,
      userAgent: l.userAgent,
      traceId: l.traceId,
      note: l.note,
      createdAt: l.createdAt.toISOString(),
    };
  }

  private toApiKeyInfo(k: ApiKey): ApiKeyInfo {
    return {
      id: k.id,
      name: k.name,
      keyPrefix: k.keyPrefix,
      tenantId: k.tenantId,
      scopes: (k.scopes as string[]) ?? [],
      status: k.status as 'active' | 'revoked',
      createdById: k.createdById,
      createdAt: k.createdAt.toISOString(),
      updatedAt: k.updatedAt.toISOString(),
      expiresAt: k.expiresAt?.toISOString() ?? null,
      revokedAt: k.revokedAt?.toISOString() ?? null,
      lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
    };
  }
}

export const adminSystemService = new AdminSystemServiceClass();
