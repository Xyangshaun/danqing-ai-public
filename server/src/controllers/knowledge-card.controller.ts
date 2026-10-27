// ============================================================
// 知识点卡片 Controller(参考图混合方案 Phase 3 批次③)
// 对应 API:
//   GET /knowledge-cards        (列表,category 可选过滤)
//   GET /knowledge-cards/:id    (详情:分步图/讲解/练习/关联作品)
//
// 权限:knowledge-card:read(teacher/admin/owner;学生经分析结果间接消费,
//   不开放列表/详情直查——标注卡内的 reference 数据由后端注入,无需学生端检索)
// ============================================================

import type { RequestHandler } from 'express';
import { z } from 'zod';
import { knowledgeCardService } from '../services/knowledge-card.service.js';
import { success, error } from '../utils/response.js';
import { ErrorCode } from '../types/api-contract.js';

/** 列表查询参数(category 可选,枚举校验) */
const listQuerySchema = z.object({
  category: z
    .enum(['sketch', 'color', 'quickSketch', 'design', 'heritage'])
    .optional(),
});

/** 路径参数 :id 校验 */
const idParamSchema = z.object({
  id: z.string().min(1, '缺少必填参数:id'),
});

/** GET /knowledge-cards */
export const listKnowledgeCards: RequestHandler = async (req, res, next) => {
  try {
    if (!req.userId || !req.tenantId) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }
    const query = listQuerySchema.safeParse(req.query);
    if (!query.success) {
      return error(res, ErrorCode.PARAM_INVALID, query.error.issues[0]?.message ?? '参数错误', 400);
    }
    const cards = await knowledgeCardService.listCards(query.data.category);
    return success(res, cards, 'success');
  } catch (err) {
    return next(err);
  }
};

/** GET /knowledge-cards/:id */
export const getKnowledgeCard: RequestHandler = async (req, res, next) => {
  try {
    if (!req.userId || !req.tenantId) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }
    const params = idParamSchema.safeParse(req.params);
    if (!params.success) {
      return error(res, ErrorCode.PARAM_INVALID, params.error.issues[0]?.message ?? '参数错误', 400);
    }
    try {
      const card = await knowledgeCardService.getCard(params.data.id);
      return success(res, card, 'success');
    } catch (err) {
      if (err instanceof Error && err.message === 'KNOWLEDGE_CARD_NOT_FOUND') {
        return error(res, ErrorCode.RESOURCE_NOT_FOUND, '知识点卡片不存在', 404);
      }
      throw err;
    }
  } catch (err) {
    return next(err);
  }
};
