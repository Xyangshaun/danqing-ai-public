// ============================================================
// 知识库实时检索路由(Phase 5 预留接口)
// 对应 API:/api/v1/knowledge/*
//
// 中间件链路:authMiddleware → tenantMiddleware → apiRateLimiter → permission → handler
//
// 权限矩阵:
//   knowledge:read          所有角色(student/teacher/admin/owner)
//   knowledge:write         仅 ADMIN/OWNER
//   knowledge:index:manage  仅 ADMIN/OWNER(ALL_PERMISSIONS 自动覆盖)
//
// 路由顺序约束:
//   - 静态路径(/search /index/* /search/validate)必须在 /:id 之前注册
//   - 否则会被 :id 误匹配(如 'search' 'index' 被当作 id)
// ============================================================

import { Router } from 'express';
import { authMiddleware } from '../middlewares/auth.js';
import { tenantMiddleware } from '../middlewares/tenant.js';
import { apiRateLimiter } from '../middlewares/rate-limit.js';
import { requirePermission } from '../middlewares/permission.js';
import {
  searchKnowledge,
  getKnowledgeById,
  createKnowledge,
  updateKnowledge,
  deleteKnowledge,
  rebuildKnowledgeIndex,
  getKnowledgeIndexStatus,
  validateKnowledgeSearch,
} from '../controllers/knowledge.controller.js';

export const knowledgeRouter: Router = Router();

// ---------- 全局中间件(所有 /api/v1/knowledge/* 路由必须经过鉴权 + 租户校验 + 限流)----------
knowledgeRouter.use(authMiddleware);
knowledgeRouter.use(tenantMiddleware);
knowledgeRouter.use(apiRateLimiter());

// ---------- 静态路径优先注册(避免被 /:id 捕获)----------

// GET /knowledge/search - 知识库搜索(关键词/标签/分类)
knowledgeRouter.get('/search', requirePermission('knowledge:read'), searchKnowledge);

// POST /knowledge/search/validate - 搜索权限验证
knowledgeRouter.post('/search/validate', requirePermission('knowledge:read'), validateKnowledgeSearch);

// POST /knowledge/index/rebuild - 重建索引(仅 ADMIN)
knowledgeRouter.post(
  '/index/rebuild',
  requirePermission('knowledge:index:manage'),
  rebuildKnowledgeIndex,
);

// GET /knowledge/index/status - 索引状态查询
knowledgeRouter.get('/index/status', requirePermission('knowledge:read'), getKnowledgeIndexStatus);

// ---------- 集合级路由 ----------

// POST /knowledge - 创建知识条目(仅 ADMIN/OWNER)
knowledgeRouter.post('/', requirePermission('knowledge:write'), createKnowledge);

// ---------- 动态路径最后注册 ----------

// GET /knowledge/:id - 知识条目详情
knowledgeRouter.get('/:id', requirePermission('knowledge:read'), getKnowledgeById);

// PATCH /knowledge/:id - 更新知识条目(仅 ADMIN/OWNER)
knowledgeRouter.patch('/:id', requirePermission('knowledge:write'), updateKnowledge);

// DELETE /knowledge/:id - 删除知识条目(仅 ADMIN/OWNER)
knowledgeRouter.delete('/:id', requirePermission('knowledge:write'), deleteKnowledge);
