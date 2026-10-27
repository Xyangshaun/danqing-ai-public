// ============================================================
// 知识点卡片 Service(参考图混合方案 Phase 3 批次③)
// 对应 API:GET /knowledge-cards(列表)/ GET /knowledge-cards/:id(详情)
//
// 薄壳:卡片为纯系统内置教学知识资产(无租户/无写路径——分步图写回走
// 预生成脚本,见批次②),此处仅做读查询与错误语义转换
// 匹配引擎在 knowledge-card-match.service(管线消费,独立于此)
// ============================================================

import type { KnowledgeCard } from '@prisma/client';
import { knowledgeCardRepository } from '../repositories/knowledge-card.repository.js';

export class KnowledgeCardService {
  /**
   * 列出卡片(可选类目过滤;教师端管理预览用,含停用)
   * @param category 类目过滤(sketch/color/quickSketch/design/heritage;缺省全部)
   */
  async listCards(category?: string): Promise<KnowledgeCard[]> {
    return knowledgeCardRepository.listByCategory(category);
  }

  /**
   * 卡片详情(前端标注卡"查看参考"弹层拉取:
   * referenceAssets 分步图 + explanation + practiceDrill + relatedWorks)
   * @throws Error 卡片不存在(由 controller 转 404 语义)
   */
  async getCard(id: string): Promise<KnowledgeCard> {
    const card = await knowledgeCardRepository.findById(id);
    if (!card) {
      throw new Error('KNOWLEDGE_CARD_NOT_FOUND');
    }
    return card;
  }
}

export const knowledgeCardService = new KnowledgeCardService();
