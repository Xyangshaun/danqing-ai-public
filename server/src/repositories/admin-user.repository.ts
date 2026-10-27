// ============================================================
// 管理后台 - 用户 Repository(Phase 4)
// 对应 API:/api/admin/users + /api/admin/roles
//
// 职责:
//   1. 用户列表/详情查询(支持跨租户/筛选/排序/分页)
//   2. 用户更新(角色/状态/资料)
//   3. 用户软删除(status=deleted)
//   4. 用户锁定/解锁
//   5. 批量操作(角色变更/删除)
//
// 安全约束:
//   - 管理后台查询默认按 tenantId 过滤(可选参数,允许跨租户)
//   - 删除采用软删除(status=deleted),保留审计数据
//   - 锁定记录操作者 lockedBy 与时间 lockedAt
// ============================================================

import type { Prisma} from '@prisma/client';
import { type User, type UserRole } from '@prisma/client';
import { prisma } from '../config/prisma.js';

/** 用户状态(从 Prisma 生成) */
type UserStatus = 'active' | 'locked' | 'deleted';

/** 用户列表查询过滤条件 */
export interface ListAdminUsersFilter {
  /** 当前管理员所属租户(默认过滤) */
  currentTenantId: string;
  /** 显式指定目标租户(跨租户查询时传入) */
  targetTenantId?: string;
  /** 模糊搜索(name/email) */
  search?: string;
  /** 角色筛选 */
  role?: UserRole;
  /** 状态筛选 */
  status?: UserStatus;
  /** 起始时间 */
  startDate?: Date;
  /** 结束时间 */
  endDate?: Date;
  /** 排序字段 */
  sortBy?: 'createdAt' | 'lastLoginAt' | 'name';
  /** 排序方向 */
  sortOrder?: 'asc' | 'desc';
  /** 页码(从 1 开始) */
  page: number;
  /** 每页条数 */
  pageSize: number;
  /** 超级管理员查看全部租户用户(为 true 时忽略 tenantId 过滤) */
  viewAllTenants?: boolean;
}

export class AdminUserRepository {
  /**
   * 分页查询用户列表(支持搜索/筛选/排序)
   * 默认仅查询 currentTenantId 内用户,targetTenantId 显式指定时跨租户
   */
  async list(filter: ListAdminUsersFilter): Promise<{ items: User[]; total: number }> {
    const where: Prisma.UserWhereInput = {};

    // 租户过滤:超级管理员(viewAllTenants=true)跳过租户隔离,查看全平台用户
    if (!filter.viewAllTenants) {
      where.tenantId = filter.targetTenantId ?? filter.currentTenantId;
    }

    // 模糊搜索:name 或 email(Prisma 不支持 OR + contains 索引,但管理后台量小可接受)
    if (filter.search) {
      const search = filter.search.trim();
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (filter.role) where.role = filter.role;
    if (filter.status) where.status = filter.status;

    if (filter.startDate || filter.endDate) {
      where.createdAt = {};
      if (filter.startDate) where.createdAt.gte = filter.startDate;
      if (filter.endDate) where.createdAt.lte = filter.endDate;
    }

    // 排序
    const sortBy = filter.sortBy ?? 'createdAt';
    const sortOrder = filter.sortOrder ?? 'desc';
    const orderBy: Prisma.UserOrderByWithRelationInput = { [sortBy]: sortOrder };

    const [items, total] = await Promise.all([
      prisma().user.findMany({
        where,
        orderBy,
        skip: (filter.page - 1) * filter.pageSize,
        take: filter.pageSize,
      }),
      prisma().user.count({ where }),
    ]);

    return { items, total };
  }

  /**
   * 按 ID 查询用户详情(支持跨租户)
   * @param currentTenantId 当前管理员所属租户
   * @param userId 目标用户 ID
   * @param allowCrossTenant 是否允许跨租户(默认 false)
   */
  async findById(
    currentTenantId: string,
    userId: string,
    allowCrossTenant = false,
  ): Promise<User | null> {
    const where: Prisma.UserWhereInput = { id: userId };
    if (!allowCrossTenant) {
      where.tenantId = currentTenantId;
    }
    return prisma().user.findFirst({ where });
  }

  /**
   * 更新用户(角色/状态/资料)
   * 跨租户更新时需显式校验目标用户存在
   */
  async update(
    userId: string,
    data: Prisma.UserUpdateInput,
  ): Promise<User> {
    return prisma().user.update({
      where: { id: userId },
      data,
    });
  }

  /**
   * 软删除用户(status=deleted)
   * 不实际删除记录,保留审计数据
   */
  async softDelete(userId: string): Promise<User> {
    return prisma().user.update({
      where: { id: userId },
      data: { status: 'deleted' as UserStatus },
    });
  }

  /**
   * 锁定/解锁用户
   * @param userId 目标用户 ID
   * @param locked true=锁定,false=解锁
   * @param operatorId 操作者 ID
   */
  async setLockStatus(
    userId: string,
    locked: boolean,
    operatorId: string,
  ): Promise<User> {
    const now = new Date();
    return prisma().user.update({
      where: { id: userId },
      data: {
        status: locked ? ('locked' as UserStatus) : ('active' as UserStatus),
        lockedAt: locked ? now : null,
        lockedBy: locked ? operatorId : null,
      },
    });
  }

  /**
   * 批量更新用户角色
   * 事务保证原子性,失败回滚
   */
  async batchUpdateRole(
    userIds: string[],
    role: UserRole,
  ): Promise<{ count: number }> {
    return prisma().user.updateMany({
      where: { id: { in: userIds } },
      data: { role },
    });
  }

  /**
   * 批量软删除用户
   */
  async batchSoftDelete(userIds: string[]): Promise<{ count: number }> {
    return prisma().user.updateMany({
      where: { id: { in: userIds } },
      data: { status: 'deleted' as UserStatus },
    });
  }

  /**
   * 统计租户内用户数(用于 tenant stats)
   */
  async countByTenant(tenantId: string): Promise<number> {
    return prisma().user.count({
      where: { tenantId, status: { not: 'deleted' as UserStatus } },
    });
  }

  /**
   * 统计当日新增用户数(用于 overview)
   */
  async countTodayNew(): Promise<number> {
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    return prisma().user.count({
      where: { createdAt: { gte: startOfDay } },
    });
  }

  /**
   * 统计总用户数(用于 overview)
   */
  async countTotal(): Promise<number> {
    return prisma().user.count({
      where: { status: { not: 'deleted' as UserStatus } },
    });
  }

  /**
   * 统计日活用户数(当日 lastLoginAt)
   */
  async countDAU(): Promise<number> {
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    return prisma().user.count({
      where: {
        lastLoginAt: { gte: startOfDay },
        status: { not: 'deleted' as UserStatus },
      },
    });
  }

  /**
   * 统计月活用户数(30 日内 lastLoginAt)
   */
  async countMAU(): Promise<number> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    return prisma().user.count({
      where: {
        lastLoginAt: { gte: thirtyDaysAgo },
        status: { not: 'deleted' as UserStatus },
      },
    });
  }

  /**
   * 导出用户数据(无分页,用于 CSV 流式导出)
   * 注意:大数据量场景应改用游标或流式查询
   */
  async listForExport(filter: {
    currentTenantId: string;
    targetTenantId?: string;
    search?: string;
    role?: UserRole;
    status?: UserStatus;
  }): Promise<User[]> {
    const where: Prisma.UserWhereInput = {};
    where.tenantId = filter.targetTenantId ?? filter.currentTenantId;
    if (filter.search) {
      const search = filter.search.trim();
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (filter.role) where.role = filter.role;
    if (filter.status) where.status = filter.status;
    return prisma().user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }
}

export const adminUserRepository = new AdminUserRepository();
