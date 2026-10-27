// ============================================================
// 模块化功能扩展路由(Phase 5 预留接口)
// 对应 API:/api/v1/modules/*
//
// 中间件链路:authMiddleware → tenantMiddleware → apiRateLimiter → permission → handler
//
// 权限矩阵:
//   modules:read   所有角色(student/teacher/admin/owner)
//   modules:manage 仅 ADMIN/OWNER
//
// 路由顺序约束:
//   - /registry 必须在 /:moduleId 系列路由前注册,避免 'registry' 被当作 :moduleId
//   - 根级 GET / 必须在 /:moduleId/* 前注册
// ============================================================

import { Router } from 'express';
import { authMiddleware } from '../middlewares/auth.js';
import { tenantMiddleware } from '../middlewares/tenant.js';
import { apiRateLimiter } from '../middlewares/rate-limit.js';
import { requirePermission } from '../middlewares/permission.js';
import {
  listModules,
  listModuleRegistry,
  installModule,
  uninstallModule,
  getModuleConfig,
  updateModuleConfig,
  enableModule,
  disableModule,
} from '../controllers/modules.controller.js';

export const modulesRouter: Router = Router();

// ---------- 全局中间件 ----------
modulesRouter.use(authMiddleware);
modulesRouter.use(tenantMiddleware);
modulesRouter.use(apiRateLimiter());

// ---------- 静态路径优先(避免被 /:moduleId 捕获)----------

// GET /modules - 已安装模块列表
modulesRouter.get('/', requirePermission('modules:read'), listModules);

// GET /modules/registry - 可用模块注册表(市场)
// 注:必须在 /:moduleId 系列路由前注册
modulesRouter.get('/registry', requirePermission('modules:read'), listModuleRegistry);

// ---------- 动态路径最后注册 ----------

// POST /modules/:moduleId/install - 安装模块(仅 ADMIN/OWNER)
modulesRouter.post(
  '/:moduleId/install',
  requirePermission('modules:manage'),
  installModule,
);

// DELETE /modules/:moduleId - 卸载模块(仅 ADMIN/OWNER)
modulesRouter.delete('/:moduleId', requirePermission('modules:manage'), uninstallModule);

// GET /modules/:moduleId/config - 模块配置
modulesRouter.get('/:moduleId/config', requirePermission('modules:read'), getModuleConfig);

// PATCH /modules/:moduleId/config - 更新模块配置(仅 ADMIN/OWNER)
modulesRouter.patch(
  '/:moduleId/config',
  requirePermission('modules:manage'),
  updateModuleConfig,
);

// POST /modules/:moduleId/enable - 启用模块(仅 ADMIN/OWNER)
modulesRouter.post('/:moduleId/enable', requirePermission('modules:manage'), enableModule);

// POST /modules/:moduleId/disable - 禁用模块(仅 ADMIN/OWNER)
modulesRouter.post('/:moduleId/disable', requirePermission('modules:manage'), disableModule);
