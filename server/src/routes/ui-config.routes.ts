// ============================================================
// UI 配置与组件数据路由(Phase 5 预留接口)
// 对应 API:/api/v1/ui/*
//
// 中间件链路:authMiddleware → tenantMiddleware → apiRateLimiter → permission → handler
//
// 权限矩阵:
//   ui:config:read   所有角色(student/teacher/admin/owner)
//   ui:config:write  仅 ADMIN/OWNER
//
// 路由顺序约束:
//   - 静态路径(/theme /themes /layout)必须在 /components/:componentId
//     和 /dashboard/:userId 之前注册
//   - 避免静态路径段被当作动态参数
// ============================================================

import { Router } from 'express';
import { authMiddleware } from '../middlewares/auth.js';
import { tenantMiddleware } from '../middlewares/tenant.js';
import { apiRateLimiter } from '../middlewares/rate-limit.js';
import { requirePermission } from '../middlewares/permission.js';
import {
  getCurrentTheme,
  updateTheme,
  listThemes,
  getComponentData,
  updateComponentData,
  getLayout,
  updateLayout,
  getDashboard,
  updateDashboard,
} from '../controllers/ui-config.controller.js';

export const uiConfigRouter: Router = Router();

// ---------- 全局中间件 ----------
uiConfigRouter.use(authMiddleware);
uiConfigRouter.use(tenantMiddleware);
uiConfigRouter.use(apiRateLimiter());

// ---------- 主题相关(静态路径优先)----------

// GET /ui/theme - 当前主题配置
uiConfigRouter.get('/theme', requirePermission('ui:config:read'), getCurrentTheme);

// PATCH /ui/theme - 更新主题(仅 ADMIN/OWNER)
uiConfigRouter.patch('/theme', requirePermission('ui:config:write'), updateTheme);

// GET /ui/themes - 可用主题列表
// 注:必须在 /:param 系列前注册(虽然本路由组无根级 /:param,但保留以防误匹配)
uiConfigRouter.get('/themes', requirePermission('ui:config:read'), listThemes);

// ---------- 布局相关(静态路径优先)----------

// GET /ui/layout - 布局配置
uiConfigRouter.get('/layout', requirePermission('ui:config:read'), getLayout);

// PATCH /ui/layout - 更新布局配置(仅 ADMIN/OWNER)
uiConfigRouter.patch('/layout', requirePermission('ui:config:write'), updateLayout);

// ---------- 组件相关(动态路径)----------

// GET /ui/components/:componentId - 组件数据
uiConfigRouter.get(
  '/components/:componentId',
  requirePermission('ui:config:read'),
  getComponentData,
);

// PUT /ui/components/:componentId - 更新组件配置(仅 ADMIN/OWNER)
uiConfigRouter.put(
  '/components/:componentId',
  requirePermission('ui:config:write'),
  updateComponentData,
);

// ---------- 看板相关(动态路径)----------

// GET /ui/dashboard/:userId - 用户个性化看板
uiConfigRouter.get(
  '/dashboard/:userId',
  requirePermission('ui:config:read'),
  getDashboard,
);

// PATCH /ui/dashboard/:userId - 更新用户看板配置
uiConfigRouter.patch(
  '/dashboard/:userId',
  requirePermission('ui:config:write'),
  updateDashboard,
);
