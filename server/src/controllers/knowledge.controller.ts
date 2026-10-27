// ============================================================
// 知识库实时检索 Controller(v1.1 落地实现)
//
// 对应 API:
//   GET    /knowledge/search           知识库搜索(关键词/标签/分类)
//   GET    /knowledge/:id              知识条目详情
//   POST   /knowledge                  创建知识条目(管理员)
//   PATCH  /knowledge/:id              更新知识条目
//   DELETE /knowledge/:id              删除知识条目
//   POST   /knowledge/index/rebuild    重建索引(管理员)
//   GET    /knowledge/index/status     索引状态查询
//   POST   /knowledge/search/validate  搜索权限验证
//
// 实现说明:
//   - 检索引擎:中文二元分词 + 倒排索引 + 字段加权评分(见 knowledge.service.ts)
//   - 存储:进程内存 + 艺术教育种子数据(v2.0 可平移 Prisma/ES)
//   - 所有外部输入经 Zod 校验;统一响应 {code, message, data, traceId}
// ============================================================

import type { RequestHandler } from 'express';
import { z } from 'zod';
import { knowledgeService } from '../services/knowledge.service.js';
import { success, error } from '../utils/response.js';
import {
  ErrorCode,
  type ArtType,
  type KnowledgeSource,
  type KnowledgeStatus,
  type UserRole,
} from '../types/api-contract.js';

// ---------- Zod Schema ----------

const VALID_ART_TYPES: readonly ArtType[] = ['painting', 'design', 'product', 'sculpture'];
const VALID_STATUSES: readonly KnowledgeStatus[] = ['draft', 'published', 'archived'];
const VALID_SOURCES: readonly KnowledgeSource[] = ['manual', 'imported', 'ai-generated', 'external'];

/** GET /search 查询参数 */
const searchQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  tags: z.string().trim().max(200).optional(),
  category: z.string().trim().max(50).optional(),
  artType: z.enum(VALID_ART_TYPES as [ArtType, ...ArtType[]]).optional(),
  status: z.enum(VALID_STATUSES as [KnowledgeStatus, ...KnowledgeStatus[]]).optional(),
  semantic: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

/** POST / 创建请求体 */
const createBodySchema = z.object({
  title: z.string().trim().min(1, '标题不能为空').max(100),
  summary: z.string().trim().min(1, '摘要不能为空').max(500),
  content: z.string().trim().min(1, '正文不能为空').max(50000),
  artType: z.enum(VALID_ART_TYPES as [ArtType, ...ArtType[]]).nullish(),
  artworkId: z.string().trim().max(64).nullish(),
  tags: z.array(z.string().trim().min(1).max(30)).max(10).optional(),
  category: z.string().trim().min(1, '分类不能为空').max(50),
  source: z.enum(VALID_SOURCES as [KnowledgeSource, ...KnowledgeSource[]]).optional(),
  status: z.enum(VALID_STATUSES as [KnowledgeStatus, ...KnowledgeStatus[]]).optional(),
});

/** PATCH /:id 更新请求体 */
const updateBodySchema = createBodySchema.partial();

/** POST /search/validate 请求体(角色一律取 token,不接受客户端指定,防止越权预校验) */
const validateBodySchema = z.object({
  query: searchQuerySchema,
});

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
function requireAuth(req: Parameters<RequestHandler>[0]): { tenantId: string; userId: string; role: UserRole } {
  if (!req.tenantId || !req.userId || !req.role) {
    throw new Error('[knowledge] auth context missing');
  }
  return { tenantId: req.tenantId, userId: req.userId, role: req.role };
}

// ---------- Handlers ----------

/**
 * GET /knowledge/search
 * 知识库搜索(关键词全文检索 + 标签/分类/类型/状态筛选)
 * - 权限:knowledge:read(所有角色)
 */
export const searchKnowledge: RequestHandler = (req, res, next) => {
  try {
    const parsed = searchQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return error(res, ErrorCode.PARAM_INVALID, firstIssue(parsed), 400);
    }
    const { tenantId, role } = requireAuth(req);
    // 服务端强制角色策略:非 elevated 角色在 service 层被强制 status=published
    const result = knowledgeService.search(tenantId, role, parsed.data);
    return success(res, result, 'ok');
  } catch (err) {
    return next(err);
  }
};

/**
 * GET /knowledge/:id
 * 知识条目详情(租户隔离,跨租户返回 404)
 */
export const getKnowledgeById: RequestHandler = (req, res, next) => {
  try {
    const parsed = idParamSchema.safeParse(req.params);
    if (!parsed.success) {
      return error(res, ErrorCode.PARAM_INVALID, firstIssue(parsed), 400);
    }
    const { tenantId } = requireAuth(req);
    const entry = knowledgeService.getById(tenantId, parsed.data.id);
    if (!entry) {
      return error(res, ErrorCode.KNOWLEDGE_NOT_FOUND, '知识条目不存在', 404);
    }
    return success(res, entry, 'ok');
  } catch (err) {
    return next(err);
  }
};

/**
 * POST /knowledge
 * 创建知识条目(仅 ADMIN/OWNER)
 */
export const createKnowledge: RequestHandler = (req, res, next) => {
  try {
    const parsed = createBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, ErrorCode.PARAM_INVALID, firstIssue(parsed), 400);
    }
    const { tenantId, userId } = requireAuth(req);
    const entry = knowledgeService.create(tenantId, userId, parsed.data);
    return success(res, entry, '创建成功');
  } catch (err) {
    return next(err);
  }
};

/**
 * PATCH /knowledge/:id
 * 更新知识条目(部分更新,仅 ADMIN/OWNER)
 */
export const updateKnowledge: RequestHandler = (req, res, next) => {
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
    const updated = knowledgeService.update(tenantId, idParsed.data.id, userId, bodyParsed.data);
    if (!updated) {
      return error(res, ErrorCode.KNOWLEDGE_NOT_FOUND, '知识条目不存在', 404);
    }
    return success(res, updated, '更新成功');
  } catch (err) {
    return next(err);
  }
};

/**
 * DELETE /knowledge/:id
 * 删除知识条目(仅 ADMIN/OWNER)
 */
export const deleteKnowledge: RequestHandler = (req, res, next) => {
  try {
    const parsed = idParamSchema.safeParse(req.params);
    if (!parsed.success) {
      return error(res, ErrorCode.PARAM_INVALID, firstIssue(parsed), 400);
    }
    const { tenantId } = requireAuth(req);
    const deleted = knowledgeService.remove(tenantId, parsed.data.id);
    if (!deleted) {
      return error(res, ErrorCode.KNOWLEDGE_NOT_FOUND, '知识条目不存在', 404);
    }
    return success(res, { id: parsed.data.id, deleted: true }, '删除成功');
  } catch (err) {
    return next(err);
  }
};

/**
 * POST /knowledge/index/rebuild
 * 重建索引(仅 ADMIN;当前为同步实现,返回 completed)
 */
export const rebuildKnowledgeIndex: RequestHandler = (req, res, next) => {
  try {
    const { tenantId } = requireAuth(req);
    const result = knowledgeService.rebuildIndex(tenantId);
    return success(res, result, '索引重建完成');
  } catch (err) {
    return next(err);
  }
};

/**
 * GET /knowledge/index/status
 * 索引状态查询
 */
export const getKnowledgeIndexStatus: RequestHandler = (req, res, next) => {
  try {
    const { tenantId } = requireAuth(req);
    const status = knowledgeService.getIndexStatus(tenantId);
    return success(res, status, 'ok');
  } catch (err) {
    return next(err);
  }
};

/**
 * POST /knowledge/search/validate
 * 搜索权限预校验(前端执行搜索前调用)
 * - role 缺省时使用 token 中的角色
 */
export const validateKnowledgeSearch: RequestHandler = (req, res, next) => {
  try {
    const parsed = validateBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, ErrorCode.PARAM_INVALID, firstIssue(parsed), 400);
    }
    const { role } = requireAuth(req);
    // 角色强制取 token,忽略请求体中的任何 role 字段(安全:防止伪造角色通过预校验)
    const result = knowledgeService.validateSearch(role, parsed.data.query);
    return success(res, result, 'ok');
  } catch (err) {
    return next(err);
  }
};
