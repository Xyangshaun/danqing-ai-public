// ============================================================
// 知识点卡片 Repository(参考图混合方案 Phase 3 批次③)
// 对应文档:visual-annotation-feedback-upgrade-spec-2026-09.md §5
// 分层:纯系统内置(isBuiltIn=true,tenantId 无,seed 注入)
// 匹配查询主路径:category+enabled 过滤(problemPattern 单列索引支撑)
// ============================================================

import type { Prisma, KnowledgeCard } from '@prisma/client';
import { prisma } from '../config/prisma.js';

export class KnowledgeCardRepository {
  /**
   * 按类目列出启用卡片(匹配引擎检索入口;problemPattern 评分在 service 内存做)
   */
  async listEnabledByCategory(category: string): Promise<KnowledgeCard[]> {
    return prisma().knowledgeCard.findMany({
      where: {
        enabled: true,
        category,
      },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
  }

  /**
   * 按类目列出全部卡片(含停用;教师端管理列表用)
   */
  async listByCategory(category?: string): Promise<KnowledgeCard[]> {
    return prisma().knowledgeCard.findMany({
      where: category ? { category } : undefined,
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
  }

  /**
   * 按 ID 查询卡片(详情端点;全局可见不做租户过滤)
   */
  async findById(id: string): Promise<KnowledgeCard | null> {
    return prisma().knowledgeCard.findUnique({
      where: { id },
    });
  }

  /**
   * 更新卡片(预生成管线写回 referenceAssets 用;本期无其他写路径)
   */
  async update(id: string, data: Prisma.KnowledgeCardUpdateInput): Promise<KnowledgeCard> {
    return prisma().knowledgeCard.update({
      where: { id },
      data,
    });
  }
}

export const knowledgeCardRepository = new KnowledgeCardRepository();
