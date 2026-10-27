// ============================================================
// 用户 Repository
// 对应文档:data-model-v1.md §7.2(强制 tenant_id 过滤)
// 注意:User 表的 tenant_id 表示"当前激活租户",可变;
// 首次登录/跨租户查询走 feishuUnionId(全局唯一),不在此处过滤 tenant_id
// 切换租户相关操作走 findById(全局)+ 显式更新 tenantId
// ============================================================

import type { Prisma, User, TenantMember } from '@prisma/client';
import { prisma } from '../config/prisma.js';

export class UserRepository {
  /**
   * 按飞书 union_id 查询用户(全局唯一,首次登录用,不带 tenant_id 过滤)
   * @param feishuUnionId 飞书 union_id
   */
  async findByFeishuUnionId(feishuUnionId: string): Promise<User | null> {
    return prisma().user.findUnique({
      where: { feishuUnionId },
      include: {
        memberships: {
          include: {
            tenant: true,
          },
        },
      },
    }) as Promise<User | null>;
  }

  /**
   * 按飞书 open_id 查询用户(全局唯一,首次登录兜底用,不带 tenant_id 过滤)
   * 兼容早期记录了 open_id 但 union_id 为空/不一致的用户,避免唯一约束冲突
   * @param feishuOpenId 飞书 open_id
   */
  async findByFeishuOpenId(feishuOpenId: string): Promise<User | null> {
    return prisma().user.findUnique({
      where: { feishuOpenId },
      include: {
        memberships: {
          include: {
            tenant: true,
          },
        },
      },
    }) as Promise<User | null>;
  }

  /**
   * 按 ID 查询用户(全局,登录后业务用)
   * 多租户校验由 service 层根据上下文决定(用户对象本身跨租户可见)
   */
  async findById(userId: string): Promise<User | null> {
    return prisma().user.findUnique({
      where: { id: userId },
    });
  }

  /**
   * 按手机号查询用户(Phase 5 手机认证)
   * 手机号全局唯一,无需 tenant_id 过滤
   */
  async findByPhone(phone: string): Promise<User | null> {
    return prisma().user.findUnique({
      where: { phone },
    });
  }

  /**
   * 按邮箱查询用户(Phase 5 院校管理员认证)
   * 邮箱全局唯一,无需 tenant_id 过滤
   */
  async findByEmail(email: string): Promise<User | null> {
    return prisma().user.findUnique({
      where: { email },
    });
  }

  /**
   * 按 ID 查询用户(强制带 tenant_id 校验)
   * 用于:验证当前用户属于某租户的场景
   */
  async findByIdAndTenant(userId: string, tenantId: string): Promise<User | null> {
    return prisma().user.findFirst({
      where: { id: userId, tenantId },
    });
  }

  /**
   * 创建用户(首次登录,feishu 信息已校验)
   * @param data 用户数据(含 tenantId 当前激活)
   */
  async create(data: Prisma.UserCreateInput): Promise<User> {
    return prisma().user.create({ data });
  }

  /**
   * 更新用户(强制 tenant_id 校验,防止跨租户修改)
   * @param tenantId 当前激活租户(用于多租户校验)
   * @param userId 用户 ID
   * @param data 待更新字段
   */
  async update(tenantId: string, userId: string, data: Prisma.UserUpdateInput): Promise<User> {
    // 显式校验:用户当前 tenant_id 必须匹配,防止越权跨租户修改
    // (Prisma update 不支持 where + 额外条件,先查再更新)
    const existing = await prisma().user.findFirst({
      where: { id: userId, tenantId },
      select: { id: true },
    });
    if (!existing) {
      throw new Error(
        `[userRepository] update denied: user ${userId} not in tenant ${tenantId}`,
      );
    }
    return prisma().user.update({
      where: { id: userId },
      data,
    });
  }

  /**
   * 更新用户最后登录时间(无需 tenant_id 过滤,登录链路特例)
   */
  async updateLastLoginAt(userId: string, lastLoginAt: Date): Promise<void> {
    await prisma().user.update({
      where: { id: userId },
      data: { lastLoginAt },
    });
  }

  /**
   * 设置用户角色(新手引导 onboarding 用)
   * 事务内同时更新 User.role(冗余字段)与 TenantMember.role(权威字段),
   * 保证两者一致性(对应 schema.prisma 中 User.role 注释"冗余,与 TenantMember.role 一致")。
   *
   * @param userId 用户 ID
   * @param tenantId 当前激活租户 ID(仅更新该租户的 TenantMember)
   * @param role 新角色(admin/teacher/student,不允许 owner)
   * @returns 更新后的 User
   */
  async setRole(
    userId: string,
    tenantId: string,
    role: 'admin' | 'teacher' | 'student',
  ): Promise<User> {
    return prisma().$transaction(async (tx) => {
      // 1. 更新 TenantMember(权威字段)
      await tx.tenantMember.update({
        where: { userId_tenantId: { userId, tenantId } },
        data: { role },
      });
      // 2. 同步更新 User.role(冗余字段,与 TenantMember.role 一致)
      const updated = await tx.user.update({
        where: { id: userId },
        data: { role },
      });
      return updated;
    });
  }

  /**
   * 切换用户激活租户(同时更新冗余 role 字段)
   * @param userId 用户 ID
   * @param tenantId 新激活租户 ID
   * @param role 新租户内的角色
   */
  async switchTenant(userId: string, tenantId: string, role: User['role']): Promise<User> {
    return prisma().user.update({
      where: { id: userId },
      data: { tenantId, role },
    });
  }

  /**
   * 列出租户内指定角色的用户(用于通知教师等场景)
   * 通过 TenantMember 关联表查询,确保多租户隔离
   * @param tenantId 租户 ID
   * @param roles 角色列表(如 ['teacher', 'admin', 'owner'])
   * @returns 用户列表(仅 id/role,最小化数据传输)
   */
  async listByTenantAndRoles(
    tenantId: string,
    roles: User['role'][],
  ): Promise<Array<{ id: string; role: string }>> {
    const memberships = await prisma().tenantMember.findMany({
      where: { tenantId, role: { in: roles } },
      select: { userId: true, role: true },
    });
    return memberships.map((m) => ({ id: m.userId, role: m.role }));
  }

  /**
   * 查询用户在所有租户中的成员关系(用于 /auth/me 接口返回 memberships)
   */
  async findMemberships(userId: string): Promise<Array<TenantMember & { tenant: { id: string; name: string; type: string } }>> {
    const memberships = await prisma().tenantMember.findMany({
      where: { userId },
      include: {
        tenant: {
          select: { id: true, name: true, type: true },
        },
      },
    });
    return memberships as unknown as Array<
      TenantMember & { tenant: { id: string; name: string; type: string } }
    >;
  }
}

export const userRepository = new UserRepository();
