// ============================================================
// 通知 Repository(任务包 B:通知系统真实数据接入)
// 对应文档:
//   - .trae/specs/interaction-skeleton-optimization/spec.md(通知系统设计)
//   - prisma/schema.prisma Notification 模型
//
// 多租户隔离(硬约束):
//   - 所有查询方法强制带 (tenantId, userId) 双重过滤
//   - 通知是用户私有收件箱,禁止跨租户/跨用户读取
//   - 即便传入他人 notificationId,双过滤也会返回 null(不泄露资源存在性)
//
// 3 秒 SLA(硬约束):
//   - 依赖 schema.prisma 中索引:
//     @@index([tenantId, userId, readAt])    → 未读计数 + 仅未读列表
//     @@index([tenantId, userId, createdAt]) → 游标分页(时间倒序)
//   - 未读计数走 count(readAt=null),索引覆盖,毫秒级返回
//
// 游标分页:
//   - 排序键:(createdAt DESC, id DESC) 复合排序保证稳定分页
//   - 游标编码:Base64(JSON.stringify({ c: createdAtISO, i: id }))
//   - 翻页 WHERE:(createdAt, id) < cursor(复合小于,字典序)
// ============================================================

import { Prisma } from '@prisma/client';
import type { Notification as PrismaNotification, NotificationType, NotificationLevel } from '@prisma/client';
import { prisma } from '../config/prisma.js';

/**
 * 游标分页查询参数
 */
export interface NotificationCursorQuery {
  /** 每页数量(已在 service 层校验范围 1-50) */
  limit: number;
  /** 游标(null 表示首页);由 service 层解码后传入 */
  cursor?: { createdAt: Date; id: string } | null;
  /** 仅未读 */
  onlyUnread?: boolean;
}

/**
 * 创建通知的入参(对应 CreateNotificationInput,Repository 层使用 Prisma 原生类型)
 */
export interface CreateNotificationParams {
  tenantId: string;
  userId: string;
  type: NotificationType;
  title: string;
  content: string;
  level?: NotificationLevel;
  linkUrl?: string;
  metadata?: Prisma.InputJsonValue;
}

export class NotificationRepository {
  /**
   * 游标分页查询通知列表(强制 tenantId + userId 过滤)
   *
   * 排序:(createdAt DESC, id DESC)
   * 翻页:复合游标 (createdAt, id) < cursor
   *
   * @param tenantId 租户 ID(多租户隔离)
   * @param userId 接收者用户 ID
   * @param query 分页参数(limit / cursor / onlyUnread)
   * @returns 通知记录数组(已按时间倒序,长度 ≤ limit)
   */
  async listByCursor(
    tenantId: string,
    userId: string,
    query: NotificationCursorQuery,
  ): Promise<PrismaNotification[]> {
    const { limit, cursor, onlyUnread } = query;

    // 构建多租户隔离 + 翻页游标 WHERE 条件
    const where: Prisma.NotificationWhereInput = {
      tenantId,
      userId,
    };

    // 仅未读过滤(走 (tenantId, userId, readAt) 索引)
    if (onlyUnread) {
      where.readAt = null;
    }

    // 游标翻页:复合排序键 (createdAt, id) 字典序小于 cursor
    // 条件:createdAt < cursor.createdAt OR (createdAt = cursor.createdAt AND id < cursor.id)
    if (cursor) {
      where.OR = [
        { createdAt: { lt: cursor.createdAt } },
        {
          AND: [
            { createdAt: { equals: cursor.createdAt } },
            { id: { lt: cursor.id } },
          ],
        },
      ];
    }

    return prisma().notification.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
    });
  }

  /**
   * 统计未读通知数量(强制 tenantId + userId 过滤)
   * 走 (tenantId, userId, readAt) 索引,count 毫秒级返回(3 秒 SLA)
   *
   * @param tenantId 租户 ID
   * @param userId 接收者用户 ID
   * @returns 未读数量
   */
  async countUnread(tenantId: string, userId: string): Promise<number> {
    return prisma().notification.count({
      where: {
        tenantId,
        userId,
        readAt: null,
      },
    });
  }

  /**
   * 按 ID 查询单条通知(强制 tenantId + userId 过滤)
   * 即便传入他人 notificationId,双过滤返回 null,不泄露资源存在性
   *
   * @param tenantId 租户 ID
   * @param userId 接收者用户 ID
   * @param notificationId 通知 ID
   * @returns 通知记录或 null
   */
  async findByIdAndOwner(
    tenantId: string,
    userId: string,
    notificationId: string,
  ): Promise<PrismaNotification | null> {
    return prisma().notification.findFirst({
      where: {
        id: notificationId,
        tenantId,
        userId,
      },
    });
  }

  /**
   * 标记单条通知为已读(强制 tenantId + userId 过滤)
   *
   * 幂等性:已读通知再次标记不会报错(readAt 保持原值)
   * 仅当 readAt 为 null 时更新(避免覆盖原始已读时间)
   *
   * @param tenantId 租户 ID
   * @param userId 接收者用户 ID
   * @param notificationId 通知 ID
   * @param readAt 已读时间
   * @returns 更新后的通知记录;若通知不存在或不属于该用户则返回 null
   */
  async markRead(
    tenantId: string,
    userId: string,
    notificationId: string,
    readAt: Date,
  ): Promise<PrismaNotification | null> {
    // 仅更新未读通知(readAt IS NULL),已读的保持原值(幂等)
    const result = await prisma().notification.updateMany({
      where: {
        id: notificationId,
        tenantId,
        userId,
        readAt: null,
      },
      data: { readAt },
    });

    // 没有匹配的未读通知:可能是通知不存在/不属于该用户/已经是已读
    // 统一返回查找不到,由 service 层判断是否为"已读幂等"还是"不存在"
    if (result.count === 0) {
      return this.findByIdAndOwner(tenantId, userId, notificationId);
    }

    // 更新成功,返回完整记录
    return this.findByIdAndOwner(tenantId, userId, notificationId);
  }

  /**
   * 标记该用户在该租户下的所有未读通知为已读(强制 tenantId + userId 过滤)
   *
   * @param tenantId 租户 ID
   * @param userId 接收者用户 ID
   * @param readAt 已读时间
   * @returns 本次标记已读的条数
   */
  async markAllRead(
    tenantId: string,
    userId: string,
    readAt: Date,
  ): Promise<number> {
    const result = await prisma().notification.updateMany({
      where: {
        tenantId,
        userId,
        readAt: null,
      },
      data: { readAt },
    });
    return result.count;
  }

  /**
   * 创建通知(内部触发,非公开 API)
   * 由其他 service(如 analysis-queue 完成回调、review 提交等)调用
   *
   * @param params 通知参数(含 tenantId / userId / type / title / content 等)
   * @returns 创建的通知记录
   */
  async create(params: CreateNotificationParams): Promise<PrismaNotification> {
    return prisma().notification.create({
      data: {
        tenantId: params.tenantId,
        userId: params.userId,
        type: params.type,
        title: params.title,
        content: params.content,
        level: params.level ?? 'INFO',
        linkUrl: params.linkUrl ?? null,
        metadata: params.metadata ?? Prisma.JsonNull,
      },
    });
  }
}

export const notificationRepository = new NotificationRepository();
