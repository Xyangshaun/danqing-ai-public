// ============================================================
// 艺术品知识库 Controller
// 对应 API:
//   GET /artworks/search?q=&page=&page_size=
//   GET /artworks/style-categories
//   GET /artworks/category/:category?page=&page_size=
//   GET /artworks/:id
// 所有外部输入经 Zod 校验;统一响应格式 {code, message, data, traceId}
// ============================================================

import type { RequestHandler } from 'express';
import { z } from 'zod';
import { knowledgeBaseService } from '../services/knowledge-base.service.js';
import { success, error } from '../utils/response.js';
import {
  ErrorCode,
  type ArtworkCategory,
  type ArtType,
} from '../types/api-contract.js';

/** 合法艺术品分类(含书法/建筑,超出 ArtType) */
const VALID_CATEGORIES: readonly ArtworkCategory[] = [
  'painting',
  'design',
  'product',
  'sculpture',
  'calligraphy',
  'architecture',
];

/** 合法作品类型(四类,用于风格分类配置校验) */
const VALID_ART_TYPES: readonly ArtType[] = [
  'painting',
  'design',
  'product',
  'sculpture',
];

/** 搜索查询参数 schema */
const searchQuerySchema = z.object({
  q: z.string().trim().default(''),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
});

/** 分页查询参数 schema(无关键词) */
const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
});

/** 分类路径参数 schema */
const categoryParamSchema = z.object({
  category: z.string().min(1),
});

/** ID 路径参数 schema */
const idParamSchema = z.object({
  id: z.string().min(1),
});

/**
 * GET /artworks/search
 * 关键词搜索艺术品
 */
export const searchArtworks: RequestHandler = (req, res, next) => {
  try {
    const parsed = searchQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const msg = `参数错误:${first?.path.join('.') ?? 'unknown'} ${first?.message ?? 'invalid'}`;
      return error(res, ErrorCode.PARAM_INVALID, msg, 400);
    }
    const { q, page, page_size } = parsed.data;
    const result = knowledgeBaseService.searchArtworks(q, page, page_size);
    return success(res, result, 'ok');
  } catch (err) {
    return next(err);
  }
};

/**
 * GET /artworks/style-categories
 * 获取风格分类配置(四类作品的风格/时代/题材)
 */
export const getStyleCategories: RequestHandler = (_req, res, next) => {
  try {
    const result = knowledgeBaseService.getStyleCategories();
    return success(res, result, 'ok');
  } catch (err) {
    return next(err);
  }
};

/**
 * GET /artworks/category/:category
 * 按分类查询艺术品(分页)
 */
export const getArtworksByCategory: RequestHandler = (req, res, next) => {
  try {
    const paramParsed = categoryParamSchema.safeParse(req.params);
    if (!paramParsed.success) {
      return error(res, ErrorCode.PARAM_MISSING, '缺少必填参数:category', 400);
    }
    const { category } = paramParsed.data;
    if (!VALID_CATEGORIES.includes(category as ArtworkCategory)) {
      return error(
        res,
        ErrorCode.PARAM_TYPE_MISMATCH,
        `参数类型错误:category 必须为 ${VALID_CATEGORIES.join('/')}`,
        400,
      );
    }

    const queryParsed = paginationQuerySchema.safeParse(req.query);
    if (!queryParsed.success) {
      const first = queryParsed.error.issues[0];
      const msg = `参数错误:${first?.path.join('.') ?? 'unknown'} ${first?.message ?? 'invalid'}`;
      return error(res, ErrorCode.PARAM_INVALID, msg, 400);
    }
    const { page, page_size } = queryParsed.data;
    const result = knowledgeBaseService.getArtworksByCategory(
      category as ArtworkCategory,
      page,
      page_size,
    );
    return success(res, result, 'ok');
  } catch (err) {
    return next(err);
  }
};

/**
 * GET /artworks/:id
 * 查询单件艺术品详情
 * 注:此路由必须挂在 /search /style-categories /category/:category 之后,
 * 否则会被 :id 误匹配
 */
export const getArtworkById: RequestHandler = (req, res, next) => {
  try {
    const paramParsed = idParamSchema.safeParse(req.params);
    if (!paramParsed.success) {
      return error(res, ErrorCode.PARAM_MISSING, '缺少必填参数:id', 400);
    }
    const { id } = paramParsed.data;
    const artwork = knowledgeBaseService.getArtworkById(id);
    if (!artwork) {
      return error(res, ErrorCode.RESOURCE_NOT_FOUND, '艺术品不存在', 404);
    }
    return success(res, artwork, 'ok');
  } catch (err) {
    return next(err);
  }
};

/**
 * 导出 VALID_ART_TYPES 供 routes 层校验风格/时代筛选(预留扩展)
 */
export { VALID_ART_TYPES };
