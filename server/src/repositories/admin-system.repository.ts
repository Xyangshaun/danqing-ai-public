// ============================================================
// 管理后台 - 系统 Repository(Phase 4)
// 对应 API:/api/admin/system/*
//
// 职责:
//   1. 租户列表/详情/创建/更新
//   2. 审计日志列表查询(支持多维筛选)
//   3. 审计日志写入(供各 service 调用)
//   4. API 密钥 CRUD + 校验
//   5. 系统健康检查数据采集
//
// 安全约束:
//   - 租户管理为系统级操作,允许跨租户
//   - API 密钥仅存哈希,完整密钥仅创建时返回一次
//   - 审计日志写入不可变(只增不改不删)
// ============================================================

import crypto from 'node:crypto';
import { Prisma, type Tenant, type AuditLog, type ApiKey, type AuditAction, type TenantType, type TenantPlan, type TenantStatus, type ApiKeyStatus } from '@prisma/client';
import { prisma } from '../config/prisma.js';

export interface ListAdminTenantsFilter {
  search?: string;
  type?: TenantType;
  plan?: TenantPlan;
  status?: TenantStatus;
  page: number;
  pageSize: number;
}

export interface ListAuditLogsFilter {
  operatorId?: string;
  action?: AuditAction;
  resource?: string;
  resourceId?: string;
  targetTenantId?: string;
  startDate?: Date;
  endDate?: Date;
  page: number;
  pageSize: number;
}

export interface ListApiKeysFilter {
  status?: ApiKeyStatus;
  tenantId?: string;
  page: number;
  pageSize: number;
}

/** 审计日志写入参数 */
export interface WriteAuditLogParams {
  operatorId: string;
  operatorRole: string;
  operatorTenantId?: string | null;
  action: AuditAction;
  resource: string;
  resourceId?: string | null;
  targetTenantId?: string | null;
  beforeData?: Record<string, unknown> | null;
  afterData?: Record<string, unknown> | null;
  ip: string;
  userAgent: string;
  traceId?: string | null;
  note?: string | null;
}

export class AdminSystemRepository {
  // ============================================================
  // 租户管理
  // ============================================================

  /**
   * 分页查询租户列表
   */
  async listTenants(filter: ListAdminTenantsFilter): Promise<{ items: Tenant[]; total: number }> {
    const where: Prisma.TenantWhereInput = {};
    if (filter.search) {
      const search = filter.search.trim();
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (filter.type) where.type = filter.type;
    if (filter.plan) where.plan = filter.plan;
    if (filter.status) where.status = filter.status;

    const [items, total] = await Promise.all([
      prisma().tenant.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (filter.page - 1) * filter.pageSize,
        take: filter.pageSize,
      }),
      prisma().tenant.count({ where }),
    ]);

    return { items, total };
  }

  /**
   * 按 ID 查询租户
   */
  async findTenantById(tenantId: string): Promise<Tenant | null> {
    return prisma().tenant.findUnique({ where: { id: tenantId } });
  }

  /**
   * 创建租户
   */
  async createTenant(data: Prisma.TenantCreateInput): Promise<Tenant> {
    return prisma().tenant.create({ data });
  }

  /**
   * 更新租户
   */
  async updateTenant(tenantId: string, data: Prisma.TenantUpdateInput): Promise<Tenant> {
    return prisma().tenant.update({ where: { id: tenantId }, data });
  }

  /**
   * 统计租户内成员数
   */
  async countTenantMembers(tenantId: string): Promise<number> {
    return prisma().tenantMember.count({ where: { tenantId } });
  }

  /**
   * 统计总租户数
   */
  async countTotalTenants(): Promise<number> {
    return prisma().tenant.count();
  }

  // ============================================================
  // 审计日志
  // ============================================================

  /**
   * 写入审计日志(不可变,只增)
   */
  async writeAuditLog(params: WriteAuditLogParams): Promise<AuditLog> {
    return prisma().auditLog.create({
      data: {
        operatorId: params.operatorId,
        operatorRole: params.operatorRole,
        operatorTenantId: params.operatorTenantId ?? null,
        action: params.action,
        resource: params.resource,
        resourceId: params.resourceId ?? null,
        targetTenantId: params.targetTenantId ?? null,
        beforeData: params.beforeData
          ? (params.beforeData as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        afterData: params.afterData
          ? (params.afterData as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        ip: params.ip,
        userAgent: params.userAgent,
        traceId: params.traceId ?? null,
        note: params.note ?? null,
      },
    });
  }

  /**
   * 分页查询审计日志
   */
  async listAuditLogs(filter: ListAuditLogsFilter): Promise<{ items: AuditLog[]; total: number }> {
    const where: Prisma.AuditLogWhereInput = {};
    if (filter.operatorId) where.operatorId = filter.operatorId;
    if (filter.action) where.action = filter.action;
    if (filter.resource) where.resource = filter.resource;
    if (filter.resourceId) where.resourceId = filter.resourceId;
    if (filter.targetTenantId) where.targetTenantId = filter.targetTenantId;
    if (filter.startDate || filter.endDate) {
      where.createdAt = {};
      if (filter.startDate) where.createdAt.gte = filter.startDate;
      if (filter.endDate) where.createdAt.lte = filter.endDate;
    }

    const [items, total] = await Promise.all([
      prisma().auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (filter.page - 1) * filter.pageSize,
        take: filter.pageSize,
      }),
      prisma().auditLog.count({ where }),
    ]);

    return { items, total };
  }

  // ============================================================
  // API 密钥
  // ============================================================

  /**
   * 分页查询 API 密钥列表
   */
  async listApiKeys(filter: ListApiKeysFilter): Promise<{ items: ApiKey[]; total: number }> {
    const where: Prisma.ApiKeyWhereInput = {};
    if (filter.status) where.status = filter.status;
    if (filter.tenantId) where.tenantId = filter.tenantId;

    const [items, total] = await Promise.all([
      prisma().apiKey.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (filter.page - 1) * filter.pageSize,
        take: filter.pageSize,
      }),
      prisma().apiKey.count({ where }),
    ]);

    return { items, total };
  }

  /**
   * 创建 API 密钥
   * 生成完整密钥 dk_<32位随机串>,仅返回一次
   * @returns { record: ApiKey, plainKey: string }
   */
  async createApiKey(params: {
    name: string;
    scopes: string[];
    tenantId?: string | null;
    createdById: string;
    expiresAfterDays?: number | null;
  }): Promise<{ record: ApiKey; plainKey: string }> {
    // 1. 生成完整密钥 dk_<32位随机串>
    const randomPart = crypto.randomBytes(24).toString('hex');
    const plainKey = `dk_${randomPart}`;
    const keyPrefix = plainKey.slice(0, 10); // dk_ + 8 位
    const keyHash = crypto.createHash('sha256').update(plainKey).digest('hex');

    // 2. 计算过期时间
    const expiresAt = params.expiresAfterDays
      ? new Date(Date.now() + params.expiresAfterDays * 24 * 60 * 60 * 1000)
      : null;

    // 3. 写入数据库(仅存哈希与前缀)
    const record = await prisma().apiKey.create({
      data: {
        name: params.name,
        keyPrefix,
        keyHash,
        tenantId: params.tenantId ?? null,
        scopes: params.scopes as Prisma.InputJsonValue,
        status: 'active' as ApiKeyStatus,
        createdById: params.createdById,
        expiresAt,
      },
    });

    return { record, plainKey };
  }

  /**
   * 按 ID 查询 API 密钥
   */
  async findApiKeyById(id: string): Promise<ApiKey | null> {
    return prisma().apiKey.findUnique({ where: { id } });
  }

  /**
   * 吊销 API 密钥
   */
  async revokeApiKey(id: string, revokedBy: string): Promise<ApiKey> {
    return prisma().apiKey.update({
      where: { id },
      data: {
        status: 'revoked' as ApiKeyStatus,
        revokedAt: new Date(),
        revokedBy,
      },
    });
  }
}

export const adminSystemRepository = new AdminSystemRepository();
