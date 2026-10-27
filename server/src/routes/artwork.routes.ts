// ============================================================
// 艺术品知识库路由
// 对应 API:
//   GET /artworks/search              (需鉴权)
//   GET /artworks/style-categories    (需鉴权)
//   GET /artworks/category/:category  (需鉴权)
//   GET /artworks/:id                 (需鉴权)
// 路由顺序约束:静态路径(/search /style-categories /category/:category)
// 必须在动态路径(/:id)之前注册,避免 :id 误匹配
// ============================================================

import { Router } from 'express';
import {
  searchArtworks,
  getStyleCategories,
  getArtworksByCategory,
  getArtworkById,
} from '../controllers/artwork.controller.js';
import { authMiddleware } from '../middlewares/auth.js';
import { apiRateLimiter } from '../middlewares/rate-limit.js';

export const artworkRouter: Router = Router();

// 知识库为公开静态数据,仅需认证(无需租户隔离)
artworkRouter.use(authMiddleware);
artworkRouter.use(apiRateLimiter());

// 静态路径优先(避免被 /:id 捕获)
artworkRouter.get('/search', searchArtworks);
artworkRouter.get('/style-categories', getStyleCategories);
artworkRouter.get('/category/:category', getArtworksByCategory);

// 动态路径最后
artworkRouter.get('/:id', getArtworkById);
