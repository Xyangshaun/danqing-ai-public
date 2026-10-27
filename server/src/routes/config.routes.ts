// ============================================================
// 功能参数与流程控制路由(Phase 5 预留接口)
// 对应 API:/api/v1/config/*
//
// 中间件链路:authMiddleware → tenantMiddleware → apiRateLimiter → permission → handler
//
// 权限矩阵:
//   config:features:read      所有角色(student/teacher/admin/owner)
//   config:features:write     仅 ADMIN/OWNER
//   config:workflows:manage   仅 ADMIN/OWNER
//
// 路由顺序约束:
//   - 静态子路径(/features /features/:featureId /params /params/:paramKey
//     /workflows)在 /workflows/:id 之前注册
//   - /workflows/:id/executions 必须在 /workflows/:id/execute 前注册(均为 POST/GET
//     且方法不同,实际无冲突,保留顺序以保证可读性)
// ============================================================

import { Router } from 'express';
import { authMiddleware } from '../middlewares/auth.js';
import { tenantMiddleware } from '../middlewares/tenant.js';
import { apiRateLimiter } from '../middlewares/rate-limit.js';
import { requirePermission } from '../middlewares/permission.js';
import {
  listFeatureFlags,
  updateFeatureFlag,
  listSystemParams,
  updateSystemParam,
  listWorkflows,
  createWorkflow,
  updateWorkflow,
  listWorkflowExecutions,
  executeWorkflow,
} from '../controllers/config.controller.js';

export const configRouter: Router = Router();

// ---------- 全局中间件 ----------
configRouter.use(authMiddleware);
configRouter.use(tenantMiddleware);
configRouter.use(apiRateLimiter());

// ============================================================
// 功能开关(feature flags)子模块
// ============================================================

// GET /config/features - 功能开关列表
configRouter.get(
  '/features',
  requirePermission('config:features:read'),
  listFeatureFlags,
);

// PATCH /config/features/:featureId - 更新功能开关(仅 ADMIN/OWNER)
configRouter.patch(
  '/features/:featureId',
  requirePermission('config:features:write'),
  updateFeatureFlag,
);

// ============================================================
// 系统参数子模块
// ============================================================

// GET /config/params - 系统参数列表
configRouter.get('/params', requirePermission('config:features:read'), listSystemParams);

// PATCH /config/params/:paramKey - 更新系统参数(仅 ADMIN/OWNER)
configRouter.patch(
  '/params/:paramKey',
  requirePermission('config:features:write'),
  updateSystemParam,
);

// ============================================================
// 工作流子模块
// ============================================================

// GET /config/workflows - 工作流定义列表(仅 ADMIN/OWNER)
configRouter.get(
  '/workflows',
  requirePermission('config:workflows:manage'),
  listWorkflows,
);

// POST /config/workflows - 创建工作流(仅 ADMIN/OWNER)
configRouter.post(
  '/workflows',
  requirePermission('config:workflows:manage'),
  createWorkflow,
);

// GET /config/workflows/:id/executions - 工作流执行历史
// 注:必须在与 PATCH /:id 之前或之后均无影响(方法不同),保留顺序可读性
configRouter.get(
  '/workflows/:id/executions',
  requirePermission('config:workflows:manage'),
  listWorkflowExecutions,
);

// POST /config/workflows/:id/execute - 执行工作流
configRouter.post(
  '/workflows/:id/execute',
  requirePermission('config:workflows:manage'),
  executeWorkflow,
);

// PATCH /config/workflows/:id - 更新工作流(仅 ADMIN/OWNER)
// 注:动态路径段 :id 单独注册,因 /workflows/:id/executions 与 /workflows/:id/execute
//     已是更具体的子路径,Express 优先匹配更具体路径
configRouter.patch(
  '/workflows/:id',
  requirePermission('config:workflows:manage'),
  updateWorkflow,
);
