// ============================================================
// 通知业务服务(任务包 B:通知系统真实数据接入)
// 对应 API:
//   GET    /notifications                通知列表(游标分页)
//   GET    /notifications/unread-count   未读计数
//   PATCH  /notifications/:id/read       单条标记已读
//   POST   /notifications/read-all       全部标记已读
//
// 职责:
//   1. 游标分页:编码/解码 nextCursor(Base64),limit 范围校验(1-50)
//   2. 多租户隔离:所有方法从 req 上下文取 tenantId + userId,不下发到客户端
//   3. 幂等标记已读:已读通知再次标记返回当前状态(不报错)
//   4. 审计日志:写操作(markRead / markAllRead)记录结构化日志(Winston)
//   5. 实体 → API 契约映射:Prisma Notification → Notification(API 契约)
//
// 安全约束:
//   - 禁止日志输出敏感信息(通知内容本身非敏感,但仍遵循脱敏中间件规则)
//   - 跨租户/跨用户查询在 Repository 层被 (tenantId, userId) 双过滤拦截
//   - 不存在/不属于当前用户的通知统一返回 RESOURCE_NOT_FOUND(不泄露存在性)
// ============================================================

import { notificationRepository } from '../repositories/notification.repository.js';
import { BusinessError } from '../middlewares/error-handler.js';
import { logger } from '../utils/logger.js';
import {
  ErrorCode,
  type Notification,
  type NotificationListResponse,
  type UnreadCountResponse,
  type MarkAllNotificationsReadResponse,
  type CreateNotificationInput,
  type ListNotificationsQuery,
  type NotificationLevel,
} from '../types/api-contract.js';
import type { Notification as PrismaNotification } from '@prisma/client';

// ============================================================
// 游标编码/解码
// 游标结构:{ c: createdAtISO, i: id }
// 编码:Base64(JSON.stringify(cursor))
// 用 Base64URL 避免 +/= 在 query string 中需 URL 编码
// ============================================================

interface DecodedCursor {
  c: string; // createdAt ISO 字符串
  i: string; // notification id
}

/**
 * 编码游标(createdAt + id → Base64URL 字符串)
 * @param createdAt 通知创建时间
 * @param id 通知 ID
 * @returns Base64URL 编码的游标字符串
 */
function encodeCursor(createdAt: Date, id: string): string {
  const payload: DecodedCursor = { c: createdAt.toISOString(), i: id };
  const json = JSON.stringify(payload);
  // Base64URL 编码:替换 +/ 为 -_ ,去除 = 填充
  return Buffer.from(json, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * 解码游标(Base64URL 字符串 → { createdAt, id })
 * @param cursor 游标字符串
 * @returns 解码后的游标对象;格式非法时抛 BusinessError(PARAM_INVALID)
 */
function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  let json: string;
  try {
    // 还原 Base64URL → 标准 Base64
    const std = cursor.replace(/-/g, '+').replace(/_/g, '/');
    const padded = std + '='.repeat((4 - (std.length % 4)) % 4);
    json = Buffer.from(padded, 'base64').toString('utf8');
  } catch {
    throw new BusinessError(ErrorCode.PARAM_INVALID, '游标格式非法', 400);
  }

  let parsed: DecodedCursor;
  try {
    parsed = JSON.parse(json) as DecodedCursor;
  } catch {
    throw new BusinessError(ErrorCode.PARAM_INVALID, '游标内容无法解析', 400);
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof parsed.c !== 'string' ||
    typeof parsed.i !== 'string' ||
    parsed.i.length === 0
  ) {
    throw new BusinessError(ErrorCode.PARAM_INVALID, '游标字段缺失', 400);
  }

  const createdAt = new Date(parsed.c);
  if (Number.isNaN(createdAt.getTime())) {
    throw new BusinessError(ErrorCode.PARAM_INVALID, '游标时间格式非法', 400);
  }

  return { createdAt, id: parsed.i };
}

// ============================================================
// 分页参数约束
// ============================================================

/** 默认每页数量 */
const DEFAULT_LIMIT = 20;
/** 最大每页数量 */
const MAX_LIMIT = 50;
/** 最小每页数量 */
const MIN_LIMIT = 1;

/**
 * 规范化 limit 参数(默认 20,范围 1-50)
 * @param raw 原始 limit(可能为 undefined / NaN / 超范围)
 * @returns 规范化后的 limit
 */
function normalizeLimit(raw: number | undefined | null): number {
  if (raw === undefined || raw === null) return DEFAULT_LIMIT;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return DEFAULT_LIMIT;
  return Math.max(MIN_LIMIT, Math.min(MAX_LIMIT, n));
}

// ============================================================
// 通知服务
// ============================================================

class NotificationServiceClass {
  /**
   * 通知列表(游标分页)
   *
   * @param tenantId 租户 ID(多租户隔离)
   * @param userId 接收者用户 ID
   * @param query 查询参数(limit / cursor / onlyUnread)
   * @returns 分页响应(items + nextCursor)
   */
  async listNotifications(
    tenantId: string,
    userId: string,
    query: ListNotificationsQuery,
  ): Promise<NotificationListResponse> {
    const limit = normalizeLimit(query.limit);
    const onlyUnread = query.onlyUnread === true;

    // 解码游标(非法游标抛 PARAM_INVALID)
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;

    // 查询时多取 1 条用于判断是否有下一页(take = limit + 1 策略)
    const records = await notificationRepository.listByCursor(tenantId, userId, {
      limit: limit + 1,
      cursor,
      onlyUnread,
    });

    // 有下一页:截取前 limit 条,nextCursor 用第 limit 条(最后一条)编码
    let nextCursor: string | null = null;
    let items: PrismaNotification[];
    if (records.length > limit) {
      items = records.slice(0, limit);
      const last = items[items.length - 1];
      if (last) {
        nextCursor = encodeCursor(last.createdAt, last.id);
      }
    } else {
      items = records;
    }

    return {
      items: items.map((r) => this.toNotification(r)),
      nextCursor,
    };
  }

  /**
   * 未读通知计数
   * 轻量端点,供前端轮询(Badge 数字),走索引覆盖毫秒级返回
   *
   * @param tenantId 租户 ID
   * @param userId 接收者用户 ID
   * @returns { count: number }
   */
  async getUnreadCount(
    tenantId: string,
    userId: string,
  ): Promise<UnreadCountResponse> {
    const count = await notificationRepository.countUnread(tenantId, userId);
    return { count };
  }

  /**
   * 标记单条通知为已读
   *
   * 幂等性:已读通知再次标记返回当前通知状态(不报错,不更新 readAt,跳过写操作)
   * 不存在/不属于当前用户:返回 RESOURCE_NOT_FOUND(不泄露存在性)
   *
   * 实现说明:
   *   - 先查 existing.readAt 直接判断 wasAlreadyRead(语义清晰)
   *   - 已读时直接返回 existing,跳过 repository.markRead 的 updateMany(减少一次写)
   *   - 替代原方案:markRead 后通过 updated.readAt !== readAt 时间戳比较推断 wasAlreadyRead
   *
   * @param tenantId 租户 ID
   * @param userId 接收者用户 ID
   * @param notificationId 通知 ID
   * @returns 更新后的通知(API 契约类型)
   */
  async markRead(
    tenantId: string,
    userId: string,
    notificationId: string,
  ): Promise<Notification> {
    if (!notificationId || notificationId.trim().length === 0) {
      throw new BusinessError(ErrorCode.PARAM_MISSING, '通知 ID 不能为空', 400);
    }

    // 先查询现有通知:判断是否存在 + 是否已读(双过滤拦截跨租户/跨用户访问)
    const existing = await notificationRepository.findByIdAndOwner(
      tenantId,
      userId,
      notificationId,
    );

    if (!existing) {
      // 通知不存在或不属于当前用户
      throw new BusinessError(
        ErrorCode.RESOURCE_NOT_FOUND,
        '通知不存在',
        404,
      );
    }

    // 已读:幂等返回当前状态,跳过 updateMany(减少一次写操作)
    if (existing.readAt !== null) {
      logger.info(
        {
          action: 'notification.markRead',
          tenantId,
          userId,
          notificationId,
          readAt: existing.readAt.toISOString(),
          wasAlreadyRead: true,
        },
        '[notification] mark single read (idempotent)',
      );
      return this.toNotification(existing);
    }

    // 未读:执行更新
    const readAt = new Date();
    const updated = await notificationRepository.markRead(
      tenantId,
      userId,
      notificationId,
      readAt,
    );

    if (!updated) {
      // 极端情况:existing 查到但 markRead 返回 null(并发删除等)
      throw new BusinessError(
        ErrorCode.RESOURCE_NOT_FOUND,
        '通知不存在',
        404,
      );
    }

    // 审计日志:wasAlreadyRead=false 由 existing.readAt === null 语义直接得出
    logger.info(
      {
        action: 'notification.markRead',
        tenantId,
        userId,
        notificationId,
        readAt: updated.readAt?.toISOString() ?? null,
        wasAlreadyRead: false,
      },
      '[notification] mark single read',
    );

    return this.toNotification(updated);
  }

  /**
   * 标记当前用户在该租户下的所有未读通知为已读
   *
   * @param tenantId 租户 ID
   * @param userId 接收者用户 ID
   * @returns { count: 本次标记已读的条数 }
   */
  async markAllRead(
    tenantId: string,
    userId: string,
  ): Promise<MarkAllNotificationsReadResponse> {
    const readAt = new Date();
    const count = await notificationRepository.markAllRead(
      tenantId,
      userId,
      readAt,
    );

    // 审计日志:批量写操作记录
    logger.info(
      {
        action: 'notification.markAllRead',
        tenantId,
        userId,
        markedCount: count,
        readAt: readAt.toISOString(),
      },
      '[notification] mark all read',
    );

    return { count };
  }

  /**
   * 创建通知(内部触发,非公开 API)
   * 供其他 service 调用(如分析完成回调、评审提交、订阅变更等)
   *
   * @param input 创建参数(含 tenantId / userId / type / title / content)
   * @returns 创建后的通知(API 契约类型)
   */
  async createNotification(input: CreateNotificationInput): Promise<Notification> {
    // 业务校验:必填字段
    if (!input.tenantId || !input.userId) {
      throw new BusinessError(ErrorCode.PARAM_MISSING, '租户 ID 与用户 ID 不能为空', 400);
    }
    if (!input.title || input.title.trim().length === 0) {
      throw new BusinessError(ErrorCode.PARAM_MISSING, '通知标题不能为空', 400);
    }
    if (!input.content || input.content.trim().length === 0) {
      throw new BusinessError(ErrorCode.PARAM_MISSING, '通知内容不能为空', 400);
    }
    // 标题长度校验(对应 schema.prisma title @db.VarChar(128))
    if (input.title.length > 128) {
      throw new BusinessError(ErrorCode.PARAM_INVALID, '通知标题不能超过 128 字符', 400);
    }

    const created = await notificationRepository.create({
      tenantId: input.tenantId,
      userId: input.userId,
      type: input.type,
      title: input.title,
      content: input.content,
      // 业务默认值在 Service 层应用(分层架构:业务逻辑归 Service,Repository 仅持久化)
      // Repository 层保留 `?? 'INFO'` 作为防御性兜底
      level: input.level ?? 'INFO',
      linkUrl: input.linkUrl,
      metadata: input.metadata as never,
    });

    return this.toNotification(created);
  }

  // ============================================================
  // 实体映射:Prisma Notification → API 契约 Notification
  // 一一对应(对应硬约束:Prisma schema 与 API 接口类型一一对应)
  // ============================================================

  /**
   * Prisma Notification 实体 → API 契约 Notification
   * 字段映射保持一一对应(tenantId / userId / type / level 等枚举值与 Prisma 枚举一致)
   */
  private toNotification(n: PrismaNotification): Notification {
    return {
      id: n.id,
      tenantId: n.tenantId,
      userId: n.userId,
      type: n.type as Notification['type'],
      title: n.title,
      content: n.content,
      level: n.level as NotificationLevel,
      linkUrl: n.linkUrl,
      metadata: (n.metadata as Record<string, unknown> | null) ?? null,
      readAt: n.readAt?.toISOString() ?? null,
      createdAt: n.createdAt.toISOString(),
    };
  }
}

export const notificationService = new NotificationServiceClass();
