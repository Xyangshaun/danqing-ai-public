// ============================================================
// 评分风格档案路由(双阶段反馈框架 Phase 2 批次②)
// 对应 API:/api/v1/grading-profiles/*
//
// 中间件链路:authMiddleware → tenantMiddleware → apiRateLimiter → permission → handler
// 权限矩阵:
//   读类(GET):grading-profile:read(teacher/admin/owner,学生端不消费档案)
//   写类(POST/PATCH/DELETE):grading-profile:write(teacher/admin/owner)
// ============================================================

import { Router } from 'express';
import { authMiddleware } from '../middlewares/auth.js';
import { tenantMiddleware } from '../middlewares/tenant.js';
import { apiRateLimiter } from '../middlewares/rate-limit.js';
import { requirePermission } from '../middlewares/permission.js';
import {
  listGradingProfiles,
  getGradingProfile,
  createGradingProfile,
  forkGradingProfile,
  updateGradingProfile,
  deleteGradingProfile,
  activateGradingProfile,
  getTeacherInsights,
  getMySuggestionAdoptions,
  getProfileSuggestions,
  recordSuggestionAdoption,
} from '../controllers/grading-profile.controller.js';

export const gradingProfileRouter: Router = Router();

// ---------- 全局中间件 ----------
gradingProfileRouter.use(authMiddleware);
gradingProfileRouter.use(tenantMiddleware);
gradingProfileRouter.use(apiRateLimiter());

// ---------- 业务路由 ----------
// 注意:/与 /:id/fork、/:id/activate 均在 /:id 之前注册,
// 避免 'fork'/'activate' 被当作 :id 参数(照 preset.routes L34 教训)

// GET /grading-profiles - 列出可见档案
gradingProfileRouter.get('/', requirePermission('grading-profile:read'), listGradingProfiles);

// GET /grading-profiles/insights/teacher - 本人教学画像(Phase 5 批次③,只读)
// 注意:两段路径不与单段 /:id 冲突,但照 fork/activate 教训仍先注册字面量路由
gradingProfileRouter.get(
  '/insights/teacher',
  requirePermission('grading-profile:read'),
  getTeacherInsights,
);

// GET /grading-profiles/insights/adoptions - 本人采纳历史(Phase 5 批次④,教师画像页)
gradingProfileRouter.get(
  '/insights/adoptions',
  requirePermission('grading-profile:read'),
  getMySuggestionAdoptions,
);

// GET /grading-profiles/:id - 档案详情
gradingProfileRouter.get('/:id', requirePermission('grading-profile:read'), getGradingProfile);

// GET /grading-profiles/:id/insights/suggestion - 档案级建议(Phase 5 批次③,租户聚合推导)
gradingProfileRouter.get(
  '/:id/insights/suggestion',
  requirePermission('grading-profile:read'),
  getProfileSuggestions,
);

// POST /grading-profiles/:id/suggestion-adoptions - 建议采纳记录(Phase 5 批次③,审计落库)
gradingProfileRouter.post(
  '/:id/suggestion-adoptions',
  requirePermission('grading-profile:write'),
  recordSuggestionAdoption,
);

// POST /grading-profiles - 创建租户档案
gradingProfileRouter.post('/', requirePermission('grading-profile:write'), createGradingProfile);

// POST /grading-profiles/:id/fork - fork 派生档案(深拷贝 config 微调)
gradingProfileRouter.post('/:id/fork', requirePermission('grading-profile:write'), forkGradingProfile);

// POST /grading-profiles/:id/activate - 设为租户默认(同租户同类目唯一)
gradingProfileRouter.post(
  '/:id/activate',
  requirePermission('grading-profile:write'),
  activateGradingProfile,
);

// PATCH /grading-profiles/:id - 更新档案(仅本人,非内置)
gradingProfileRouter.patch('/:id', requirePermission('grading-profile:write'), updateGradingProfile);

// DELETE /grading-profiles/:id - 删除档案(仅本人,非内置)
gradingProfileRouter.delete(
  '/:id',
  requirePermission('grading-profile:write'),
  deleteGradingProfile,
);
