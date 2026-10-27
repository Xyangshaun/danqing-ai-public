// ============================================================
// 租户 Repository
// 对应文档:data-model-v1.md §7.2(强制 tenant_id 过滤)
// Tenant 表本身不含 tenant_id(自身即租户),但所有查询仍需校验
// ============================================================

import type { Prisma, Tenant, TenantMember, User } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import type { ArbitrationConfig, DeepPartial } from '../types/arbitration.js';

/**
 * 角色类型(从 Prisma 生成)
 */
type TenantMemberRole = 'admin' | 'teacher' | 'student' | 'owner';

/**
 * 租户仲裁配置持久化记录(存入 Tenant.arbitration_config JSONB)
 * - config:租户级覆盖片段(部分覆盖,未覆盖字段继承系统默认)
 * - updatedBy:上次更新人(用于 GET 响应 updatedBy 字段)
 * - updatedAt:上次更新时间(ISO 字符串,用于 GET 响应 updatedAt 字段)
 */
export interface TenantArbitrationRecord {
  config: DeepPartial<ArbitrationConfig>;
  updatedBy: string;
  updatedAt: string;
}

/**
 * 成员列表项(含用户基础信息)
 */
export interface TenantMemberWithUser {
  userId: string;
  tenantId: string;
  role: TenantMemberRole;
  joinedAt: Date;
  user: Pick<User, 'id' | 'name' | 'avatar' | 'email' | 'feishuOpenId'>;
}

export class TenantRepository {
  /**
   * 按 ID 查询租户
   */
  async findById(tenantId: string): Promise<Tenant | null> {
    return prisma().tenant.findUnique({
      where: { id: tenantId },
    });
  }

  /**
   * 按飞书 tenant_key 查询租户(首次登录自动归属)
   */
  async findByFeishuTenantKey(feishuTenantKey: string): Promise<Tenant | null> {
    return prisma().tenant.findUnique({
      where: { feishuTenantKey },
    });
  }

  /**
   * 创建租户
   */
  async create(data: Prisma.TenantCreateInput): Promise<Tenant> {
    return prisma().tenant.create({ data });
  }

  /**
   * 更新租户(显式校验 tenant_id 即主键)
   */
  async update(tenantId: string, data: Prisma.TenantUpdateInput): Promise<Tenant> {
    return prisma().tenant.update({
      where: { id: tenantId },
      data,
    });
  }

  /**
   * 查询租户成员数(用于校验 max_seats)
   */
  async countMembers(tenantId: string): Promise<number> {
    return prisma().tenantMember.count({
      where: { tenantId },
    });
  }

  /**
   * 查询某用户在某租户的成员关系
   */
  async findMembership(userId: string, tenantId: string): Promise<TenantMember | null> {
    return prisma().tenantMember.findUnique({
      where: {
        userId_tenantId: { userId, tenantId },
      },
    });
  }

  /**
   * 创建租户成员关系(用户加入租户)
   * 注意:显式传入 joinedAt(对应 schema.prisma 的 @default(now())),
   * 既保证真实 Prisma 行为一致,也保证 mock 环境下字段非空(避免 toISOString 抛错)
   */
  async createMembership(data: { userId: string; tenantId: string; role: TenantMemberRole }): Promise<TenantMember> {
    return prisma().tenantMember.create({
      data: {
        userId: data.userId,
        tenantId: data.tenantId,
        role: data.role,
        joinedAt: new Date(),
      },
    });
  }

  /**
   * 删除租户成员关系(移除成员)
   * 显式带 tenantId 过滤,防止跨租户删除
   */
  async deleteMembership(userId: string, tenantId: string): Promise<void> {
    await prisma().tenantMember.delete({
      where: {
        userId_tenantId: { userId, tenantId },
      },
    });
  }

  /**
   * 列出租户全部成员(含用户基础信息)
   * 强制 tenantId 过滤,防止跨租户查询
   */
  async listMembers(tenantId: string): Promise<TenantMemberWithUser[]> {
    const members = await prisma().tenantMember.findMany({
      where: { tenantId },
      include: {
        user: {
          select: { id: true, name: true, avatar: true, email: true, feishuOpenId: true },
        },
      },
      orderBy: { joinedAt: 'asc' },
    });
    return members as unknown as TenantMemberWithUser[];
  }

  /**
   * 事务包装(用于跨表操作,如首次登录创建 User+TenantMember)
   */
  async withTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return prisma().$transaction(fn);
  }

  /**
   * 读取租户仲裁配置持久化记录(未配置为 null)
   * 对应 M-1 DOC-2026-08-003/005:DB 为唯一持久化真源
   */
  async getArbitrationRecord(tenantId: string): Promise<TenantArbitrationRecord | null> {
    const tenant = await prisma().tenant.findUnique({
      where: { id: tenantId },
      select: { arbitrationConfig: true },
    });
    if (!tenant || tenant.arbitrationConfig == null) return null;
    return tenant.arbitrationConfig as unknown as TenantArbitrationRecord;
  }

  /**
   * 写入租户仲裁配置持久化记录(整体覆盖)
   * 幂等:调用方先构造完整 TenantArbitrationRecord 再整体写入
   */
  async setArbitrationRecord(
    tenantId: string,
    record: TenantArbitrationRecord,
  ): Promise<void> {
    await prisma().tenant.update({
      where: { id: tenantId },
      data: {
        arbitrationConfig: record as unknown as Prisma.InputJsonValue,
      },
    });
  }
}

export const tenantRepository = new TenantRepository();
