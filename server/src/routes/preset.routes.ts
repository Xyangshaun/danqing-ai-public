// ============================================================
// 评分预设路由(Phase 5)
// 对应 API:/api/v1/presets/*
//
// 中间件链路:authMiddleware → tenantMiddleware → apiRateLimiter → permission → handler
// 权限矩阵:
//   读类(GET):preset:read(所有角色)
//   写类(POST/PATCH/DELETE):preset:write(teacher/admin/owner)
// ============================================================

import { Router } from 'express';
import { authMiddleware } from '../middlewares/auth.js';
import { tenantMiddleware } from '../middlewares/tenant.js';
import { apiRateLimiter } from '../middlewares/rate-limit.js';
import { requirePermission } from '../middlewares/permission.js';
import {
  listPresets,
  getPreset,
  createPreset,
  forkPreset,
  updatePreset,
  deletePreset,
  applyPreset,
} from '../controllers/preset.controller.js';

export const presetRouter: Router = Router();

// ---------- 全局中间件 ----------
presetRouter.use(authMiddleware);
presetRouter.use(tenantMiddleware);
presetRouter.use(apiRateLimiter());

// ---------- 业务路由 ----------
// 注意:/apply 必须在 /:id 之前注册,避免 'apply' 被当作 :id 参数

// GET /presets - 列出可见预设
presetRouter.get('/', requirePermission('preset:read'), listPresets);

// POST /presets/apply - 应用预设重算加权分
presetRouter.post('/apply', requirePermission('preset:read'), applyPreset);

// POST /presets - 创建用户预设
presetRouter.post('/', requirePermission('preset:write'), createPreset);

// GET /presets/:id - 预设详情
presetRouter.get('/:id', requirePermission('preset:read'), getPreset);

// POST /presets/:id/fork - fork 派生预设
presetRouter.post('/:id/fork', requirePermission('preset:write'), forkPreset);

// PATCH /presets/:id - 更新预设(仅本人,非 built-in)
presetRouter.patch('/:id', requirePermission('preset:write'), updatePreset);

// DELETE /presets/:id - 删除预设(仅本人,非 built-in)
presetRouter.delete('/:id', requirePermission('preset:write'), deletePreset);
