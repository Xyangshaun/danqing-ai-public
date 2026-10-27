// ============================================================
// 知识点卡片路由(参考图混合方案 Phase 3 批次③;批次④调整详情端点权限)
// 对应 API:/api/v1/knowledge-cards/*
//
// 中间件链路:authMiddleware → tenantMiddleware → apiRateLimiter → (permission) → handler
// 权限矩阵:
//   - GET /(列表):knowledge-card:read(teacher/admin/owner;教师端管理预览)
//   - GET /:id(详情):仅需登录——学生端标注卡"查看参考"弹层拉取分步图
//     (批次④调整:卡片为纯系统内置教学知识,无租户数据,详情放开给学生;
//      列表仍限教师,学生经分析结果间接消费不检索全库)
// ============================================================

import { Router } from 'express';
import { authMiddleware } from '../middlewares/auth.js';
import { tenantMiddleware } from '../middlewares/tenant.js';
import { apiRateLimiter } from '../middlewares/rate-limit.js';
import { requirePermission } from '../middlewares/permission.js';
import {
  listKnowledgeCards,
  getKnowledgeCard,
} from '../controllers/knowledge-card.controller.js';

export const knowledgeCardRouter: Router = Router();

// ---------- 全局中间件 ----------
knowledgeCardRouter.use(authMiddleware);
knowledgeCardRouter.use(tenantMiddleware);
knowledgeCardRouter.use(apiRateLimiter());

// ---------- 业务路由(纯读端点,无写路径——分步图写回走批次②预生成脚本) ----------

// GET /knowledge-cards - 列表(category 过滤;教师端管理预览用)
knowledgeCardRouter.get('/', requirePermission('knowledge-card:read'), listKnowledgeCards);

// GET /knowledge-cards/:id - 详情(标注卡"查看参考"弹层拉取;登录即可)
knowledgeCardRouter.get('/:id', getKnowledgeCard);
