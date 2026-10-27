// ============================================================
// 实时图片搜索 Controller(P0 落地实现)
//
// 对应 API:
//   GET    /images/search           图片搜索(关键词/标签/分类)
//   GET    /images/suggest          关键词联想补全(前缀匹配)
//   GET    /images/:id              图片条目详情
//   POST   /images                  创建图片条目(ADMIN/OWNER)
//   PATCH  /images/:id              更新图片条目(ADMIN/OWNER)
//   DELETE /images/:id              删除图片条目(ADMIN/OWNER)
//
// 实现说明:
//   - 检索引擎:中文二元分词 + 倒排索引 + 字段加权(见 image-search.service.ts)
//   - 存储:进程内存 + 艺术作品种子数据(v2.0 可平移 Prisma/ES)
//   - 所有外部输入经 Zod 校验;统一响应 {code, message, data, traceId}
//   - 服务端强制角色策略:student 仅可见 published(防止越权)
// ============================================================

import type { RequestHandler } from 'express';
import { z } from 'zod';
import { imageSearchService } from '../services/image-search.service.js';
import { success, error } from '../utils/response.js';
import { logger } from '../utils/logger.js';
import {
  ErrorCode,
  type ArtType,
  type ImageStatus,
  type UserRole,
} from '../types/api-contract.js';

// ---------- Zod Schema ----------

const VALID_ART_TYPES: readonly ArtType[] = ['painting', 'design', 'product', 'sculpture'];
const VALID_STATUSES: readonly ImageStatus[] = ['draft', 'published', 'archived'];

/** GET /search 查询参数 */
const searchQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  tags: z.string().trim().max(200).optional(),
  category: z.string().trim().max(50).optional(),
  artType: z.enum(VALID_ART_TYPES as [ArtType, ...ArtType[]]).optional(),
  status: z.enum(VALID_STATUSES as [ImageStatus, ...ImageStatus[]]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

/** GET /suggest 查询参数 */
const suggestQuerySchema = z.object({
  q: z.string().trim().min(1, '关键词不能为空').max(100),
  limit: z.coerce.number().int().min(1).max(20).default(8),
});

/** POST / 创建请求体 */
const createBodySchema = z.object({
  title: z.string().trim().min(1, '标题不能为空').max(100),
  tags: z.array(z.string().trim().min(1).max(30)).max(10).optional(),
  category: z.string().trim().min(1, '分类不能为空').max(50),
  artType: z.enum(VALID_ART_TYPES as [ArtType, ...ArtType[]]).nullish(),
  status: z.enum(VALID_STATUSES as [ImageStatus, ...ImageStatus[]]).optional(),
  thumbUrl: z.string().trim().min(1, '缩略图 URL 不能为空').max(500),
  fullUrl: z.string().trim().min(1, '原图 URL 不能为空').max(500),
  meta: z
    .object({
      width: z.number().int().min(0),
      height: z.number().int().min(0),
      size: z.number().int().min(0),
    })
    .optional(),
});

/** PATCH /:id 更新请求体 */
const updateBodySchema = createBodySchema.partial();

/** :id 路径参数 */
const idParamSchema = z.object({ id: z.string().min(1).max(64) });

/** 提取首个 zod 错误信息 */
function firstIssue(parsed: { success: false; error: z.ZodError }): string {
  const first = parsed.error.issues[0];
  return `参数错误:${first?.path.join('.') ?? 'unknown'} ${first?.message ?? 'invalid'}`;
}

/**
 * 认证上下文守卫
 * authMiddleware 已保证注入,此处仅做类型收窄(防御性)
 */
function requireAuth(
  req: Parameters<RequestHandler>[0],
): { tenantId: string; userId: string; role: UserRole } {
  if (!req.tenantId || !req.userId || !req.role) {
    throw new Error('[image-search] auth context missing');
  }
  return { tenantId: req.tenantId, userId: req.userId, role: req.role };
}

// ---------- Handlers ----------

/**
 * GET /images/search
 * 图片搜索(关键词全文检索 + 标签/分类/类型/状态筛选)
 * - 权限:image:read(所有角色)
 * - 安全:服务端强制 student 仅可见 published(service 层强制)
 */
export const searchImages: RequestHandler = (req, res, next) => {
  try {
    const parsed = searchQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return error(res, ErrorCode.PARAM_INVALID, firstIssue(parsed), 400);
    }
    const { tenantId, role } = requireAuth(req);
    const startedAt = performance.now();
    const result = imageSearchService.search(tenantId, role, parsed.data);
    const durationMs = Math.round((performance.now() - startedAt) * 100) / 100;
    logger.info(
      {
        durationMs,
        tenantId,
        role,
        q: parsed.data.q,
        category: parsed.data.category,
        artType: parsed.data.artType,
        page: parsed.data.page,
        pageSize: parsed.data.pageSize,
        total: result.total,
        returned: result.items.length,
        hasMore: result.hasMore,
      },
      '[image-search] search',
    );
    return success(res, result, 'ok');
  } catch (err) {
    return next(err);
  }
};

/**
 * GET /images/suggest
 * 关键词联想补全(前缀匹配,默认 8 条)
 * - 权限:image:read(所有角色)
 * - 角色:学生仅返回 published 图片命中的 token
 */
export const suggestImages: RequestHandler = (req, res, next) => {
  try {
    const parsed = suggestQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return error(res, ErrorCode.PARAM_INVALID, firstIssue(parsed), 400);
    }
    const { tenantId, role } = requireAuth(req);
    const startedAt = performance.now();
    const result = imageSearchService.suggest(tenantId, role, parsed.data);
    const durationMs = Math.round((performance.now() - startedAt) * 100) / 100;
    logger.info(
      {
        durationMs,
        tenantId,
        role,
        q: parsed.data.q,
        limit: parsed.data.limit,
        count: result.suggestions.length,
      },
      '[image-search] suggest',
    );
    return success(res, result, 'ok');
  } catch (err) {
    return next(err);
  }
};

/**
 * GET /images/:id
 * 图片条目详情(租户隔离 + 角色权限,跨租户/越权返回 404)
 */
export const getImageById: RequestHandler = (req, res, next) => {
  try {
    const parsed = idParamSchema.safeParse(req.params);
    if (!parsed.success) {
      return error(res, ErrorCode.PARAM_INVALID, firstIssue(parsed), 400);
    }
    const { tenantId, role } = requireAuth(req);
    const startedAt = performance.now();
    const image = imageSearchService.getById(tenantId, role, parsed.data.id);
    const durationMs = Math.round((performance.now() - startedAt) * 100) / 100;
    logger.info(
      { durationMs, tenantId, role, id: parsed.data.id, found: !!image },
      '[image-search] getById',
    );
    if (!image) {
      return error(res, ErrorCode.IMAGE_NOT_FOUND, '图片条目不存在', 404);
    }
    return success(res, image, 'ok');
  } catch (err) {
    return next(err);
  }
};

/**
 * POST /images
 * 创建图片条目(仅 ADMIN/OWNER,路由层 requirePermission 校验)
 */
export const createImage: RequestHandler = (req, res, next) => {
  try {
    const parsed = createBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, ErrorCode.PARAM_INVALID, firstIssue(parsed), 400);
    }
    const { tenantId, userId } = requireAuth(req);
    const image = imageSearchService.create(tenantId, userId, parsed.data);
    return success(res, image, '创建成功');
  } catch (err) {
    return next(err);
  }
};

/**
 * PATCH /images/:id
 * 更新图片条目(部分更新,仅 ADMIN/OWNER)
 */
export const updateImage: RequestHandler = (req, res, next) => {
  try {
    const idParsed = idParamSchema.safeParse(req.params);
    if (!idParsed.success) {
      return error(res, ErrorCode.PARAM_INVALID, firstIssue(idParsed), 400);
    }
    const bodyParsed = updateBodySchema.safeParse(req.body);
    if (!bodyParsed.success) {
      return error(res, ErrorCode.PARAM_INVALID, firstIssue(bodyParsed), 400);
    }
    const { tenantId, userId } = requireAuth(req);
    const updated = imageSearchService.update(
      tenantId,
      idParsed.data.id,
      userId,
      bodyParsed.data,
    );
    if (!updated) {
      return error(res, ErrorCode.IMAGE_NOT_FOUND, '图片条目不存在', 404);
    }
    return success(res, updated, '更新成功');
  } catch (err) {
    return next(err);
  }
};

/**
 * DELETE /images/:id
 * 删除图片条目(仅 ADMIN/OWNER)
 */
export const deleteImage: RequestHandler = (req, res, next) => {
  try {
    const parsed = idParamSchema.safeParse(req.params);
    if (!parsed.success) {
      return error(res, ErrorCode.PARAM_INVALID, firstIssue(parsed), 400);
    }
    const { tenantId } = requireAuth(req);
    const deleted = imageSearchService.remove(tenantId, parsed.data.id);
    if (!deleted) {
      return error(res, ErrorCode.IMAGE_NOT_FOUND, '图片条目不存在', 404);
    }
    return success(res, { id: parsed.data.id, deleted: true }, '删除成功');
  } catch (err) {
    return next(err);
  }
};
