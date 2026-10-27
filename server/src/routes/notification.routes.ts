// ============================================================
// 通知路由(任务包 B:通知系统真实数据接入)
// 对应 API(统一前缀 /api/v1/notifications):
//   GET    /                           通知列表(游标分页)
//   GET    /unread-count               未读计数
//   PATCH  /:id/read                   单条标记已读
//   POST   /read-all                   全部标记已读
//
// 中间件链路(与 user.routes.ts 保持一致):
//   authMiddleware    → JWT 校验,注入 userId/tenantId/role
//   tenantMiddleware  → 校验 req.tenantId 存在(多租户强制)
//   apiRateLimiter()  → 60 次/分钟/用户(滑动窗口)
//
// 权限说明:
//   - 通知是用户私有收件箱,所有已认证用户均可访问自己的通知
//   - 无需 requirePermission(类比 /users/profile 自助接口)
//   - 多租户 + 用户隔离在 Repository 层强制(tenantId + userId 双过滤)
//
// 路由顺序注意:
//   - /unread-count 与 /read-all 为静态路径,必须在 /:id/read 之前注册
//     (Express 按注册顺序匹配,/unread-count 不会被 /:id 误捕)
// ============================================================

import { Router } from 'express';
import {
  listNotifications,
  getUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
} from '../controllers/notification.controller.js';
import { authMiddleware } from '../middlewares/auth.js';
import { tenantMiddleware } from '../middlewares/tenant.js';
import { apiRateLimiter } from '../middlewares/rate-limit.js';

export const notificationRouter: Router = Router();

// ---------- 全局中间件(所有通知接口均需鉴权 + 租户 + 限流)----------
notificationRouter.use(authMiddleware);
notificationRouter.use(tenantMiddleware);
notificationRouter.use(apiRateLimiter());

// ---------- 业务路由(静态路径优先注册,避免被 /:id 捕获)----------

// GET /notifications - 通知列表(游标分页)
notificationRouter.get('/', listNotifications);

// GET /notifications/unread-count - 未读计数(轻量轮询端点)
notificationRouter.get('/unread-count', getUnreadCount);

// POST /notifications/read-all - 全部标记已读
notificationRouter.post('/read-all', markAllNotificationsRead);

// PATCH /notifications/:id/read - 单条标记已读(动态路径放最后)
notificationRouter.patch('/:id/read', markNotificationRead);
