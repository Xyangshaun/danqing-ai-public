// ============================================================
// 通知 Controller(任务包 B:通知系统真实数据接入)
// 对应 API:
//   GET    /notifications                通知列表(游标分页)
//   GET    /notifications/unread-count   未读计数
//   PATCH  /notifications/:id/read       单条标记已读
//   POST   /notifications/read-all       全部标记已读
//
// 职责:
//   1. 从 req 上下文提取 userId / tenantId(auth + tenant 中间件已注入)
//   2. 用 Zod 校验所有外部输入(query / params),失败抛 ZodError → errorHandler 转 PARAM_INVALID
//   3. 调用 notificationService 执行业务逻辑
//   4. 通过 success() 统一封装响应(禁止裸 res.json)
//
// 安全约束:
//   - 通知是用户私有收件箱,tenantId/userId 均来自 JWT(不可被请求参数篡改)
//   - 通知 ID 路径参数经 Zod 校验(非空字符串,防注入)
//   - 错误统一走 errorHandler,不暴露内部堆栈
// ============================================================

import type { RequestHandler } from 'express';
import { z } from 'zod';
import { notificationService } from '../services/notification.service.js';
import { success, error } from '../utils/response.js';
import { ErrorCode } from '../types/api-contract.js';

/**
 * GET /notifications 查询参数 Zod 校验
 * - limit:可选,正整数(1-50,超出范围由 service 层规范化)
 * - cursor:可选,非空字符串(Base64URL 游标)
 * - onlyUnread:可选,布尔值('true'/'1' → true,其他 → false)
 *
 * 注:query 参数均为字符串,需在 Zod 中用 coerce 或 preprocess 转换
 */
const listQuerySchema = z.object({
  limit: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => (v === undefined ? undefined : Number(v)))
    .refine((v) => v === undefined || (Number.isFinite(v) && v >= 1 && v <= 50), {
      message: 'limit 必须为 1-50 之间的整数',
    }),
  cursor: z
    .string()
    .min(1, '游标不能为空字符串')
    .optional(),
  onlyUnread: z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((v) => {
      if (v === undefined) return false;
      if (typeof v === 'boolean') return v;
      return v === 'true' || v === '1';
    }),
});

/**
 * PATCH /notifications/:id/read 路径参数 Zod 校验
 * - id:非空字符串(UUID v4,但此处仅校验非空,格式由数据库约束)
 */
const notificationIdSchema = z.object({
  id: z.string().min(1, '通知 ID 不能为空').max(64, '通知 ID 格式非法'),
});

/**
 * GET /notifications - 通知列表(游标分页)
 */
export const listNotifications: RequestHandler = async (req, res, next) => {
  try {
    if (!req.userId || !req.tenantId) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }
    // Zod 校验 query(失败抛 ZodError → errorHandler 转 1001 PARAM_INVALID)
    const parsed = listQuerySchema.parse(req.query);
    const result = await notificationService.listNotifications(
      req.tenantId,
      req.userId,
      {
        limit: parsed.limit,
        cursor: parsed.cursor,
        onlyUnread: parsed.onlyUnread,
      },
    );
    return success(res, result, 'success');
  } catch (err) {
    return next(err);
  }
};

/**
 * GET /notifications/unread-count - 未读通知计数
 */
export const getUnreadCount: RequestHandler = async (req, res, next) => {
  try {
    if (!req.userId || !req.tenantId) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }
    const result = await notificationService.getUnreadCount(req.tenantId, req.userId);
    return success(res, result, 'success');
  } catch (err) {
    return next(err);
  }
};

/**
 * PATCH /notifications/:id/read - 单条通知标记已读
 */
export const markNotificationRead: RequestHandler = async (req, res, next) => {
  try {
    if (!req.userId || !req.tenantId) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }
    // Zod 校验路径参数(失败抛 ZodError → errorHandler 转 1001 PARAM_INVALID)
    const parsed = notificationIdSchema.parse(req.params);
    const result = await notificationService.markRead(
      req.tenantId,
      req.userId,
      parsed.id,
    );
    return success(res, result, '已标记为已读');
  } catch (err) {
    return next(err);
  }
};

/**
 * POST /notifications/read-all - 全部通知标记已读
 */
export const markAllNotificationsRead: RequestHandler = async (req, res, next) => {
  try {
    if (!req.userId || !req.tenantId) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }
    const result = await notificationService.markAllRead(req.tenantId, req.userId);
    return success(res, result, `${result.count} 条通知已标记为已读`);
  } catch (err) {
    return next(err);
  }
};
