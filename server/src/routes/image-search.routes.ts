// ============================================================
// 实时图片搜索路由(P0 落地实现)
// 对应 API:/api/v1/images/*
//
// 中间件链路:authMiddleware → tenantMiddleware → apiRateLimiter → permission → handler
//
// 权限矩阵:
//   image:read    所有角色(student/teacher/admin/owner)——服务端强制 student 仅 published
//   image:create  仅 ADMIN/OWNER
//   image:update  仅 ADMIN/OWNER
//   image:delete  仅 ADMIN/OWNER
//
// 路由顺序约束:
//   - 静态路径(/search /suggest)必须在 /:id 之前注册
//   - 否则会被 :id 误匹配(如 'search' 'suggest' 被当作 id)
// ============================================================

import { Router } from 'express';
import { authMiddleware } from '../middlewares/auth.js';
import { tenantMiddleware } from '../middlewares/tenant.js';
import { apiRateLimiter } from '../middlewares/rate-limit.js';
import { requirePermission } from '../middlewares/permission.js';
import {
  searchImages,
  suggestImages,
  getImageById,
  createImage,
  updateImage,
  deleteImage,
} from '../controllers/image-search.controller.js';

export const imageSearchRouter: Router = Router();

// ---------- 全局中间件(所有 /api/v1/images/* 路由必须经过鉴权 + 租户校验 + 限流)----------
imageSearchRouter.use(authMiddleware);
imageSearchRouter.use(tenantMiddleware);
imageSearchRouter.use(apiRateLimiter());

// ---------- 静态路径优先注册(避免被 /:id 捕获)----------

// GET /images/search - 图片搜索(关键词/标签/分类/类型/状态筛选)
imageSearchRouter.get('/search', requirePermission('image:read'), searchImages);

// GET /images/suggest - 关键词联想补全(前缀匹配)
imageSearchRouter.get('/suggest', requirePermission('image:read'), suggestImages);

// ---------- 集合级路由 ----------

// POST /images - 创建图片条目(仅 ADMIN/OWNER)
imageSearchRouter.post('/', requirePermission('image:create'), createImage);

// ---------- 动态路径最后注册 ----------

// GET /images/:id - 图片条目详情
imageSearchRouter.get('/:id', requirePermission('image:read'), getImageById);

// PATCH /images/:id - 更新图片条目(仅 ADMIN/OWNER)
imageSearchRouter.patch('/:id', requirePermission('image:update'), updateImage);

// DELETE /images/:id - 删除图片条目(仅 ADMIN/OWNER)
imageSearchRouter.delete('/:id', requirePermission('image:delete'), deleteImage);
