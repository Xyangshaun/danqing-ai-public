// ============================================================
// 丹青有AI - 知识点卡片前端类型镜像(参考图混合方案 Phase 3 批次④)
//
// 对应后端:server/prisma/schema.prisma KnowledgeCard 模型
// (GET /knowledge-cards/:id 详情响应;本地镜像不引后端代码)
//
// 消费方:KnowledgeCardModal(标注卡"查看参考"弹层拉取分步图/讲解/练习)
// ============================================================

/** 知识卡片类目(与批次① seed 一致;比评分档案类目多 heritage) */
export type KnowledgeCardCategory =
  | 'sketch'
  | 'color'
  | 'quickSketch'
  | 'design'
  | 'heritage';

/** 分步参考资产生成状态(批次②预生成管线写回) */
export type ReferenceAssetStatus = 'pending' | 'ready' | 'partial';

/**
 * 分步参考图资产(后端 Json 列;批次②离线脚本生成写回)
 * - ready:全部步骤生成完成
 * - partial:部分步骤成功(失败步骤 imageUrls 对应位为空串,可重跑补齐)
 * - pending:尚未生成(弹层诚实降级"参考图生成中")
 */
export interface KnowledgeCardReferenceAssets {
  status: ReferenceAssetStatus;
  /** 步骤数(2-5) */
  steps: number;
  /** 各步骤图片 URL(与步骤序号一一对应;partial 时空串占位) */
  imageUrls: string[];
  /** 步骤图总说明(如"画面灰修正") */
  caption: string;
  /** 最近一次生成时间(ISO 8601) */
  generatedAt?: string;
  /** 最近一次失败原因(partial/pending 时可能有) */
  failureReason?: string;
}

/**
 * 知识点卡片(纯系统内置教学知识资产;reference 注入见 types/index.ts IssueMarkerReference)
 */
export interface KnowledgeCard {
  /** 固定 ID(seed 幂等 upsert 锚点,如 kcard_sketch_value_gray_004) */
  id: string;
  /** 类目 */
  category: KnowledgeCardCategory;
  /** 知识主题(如"明度/画面灰") */
  topic: string;
  /** 问题模式关键词串(匹配引擎消费,前端仅展示) */
  problemPattern: string;
  /** 难度:basic=基础 / advanced=进阶 */
  difficulty: 'basic' | 'advanced';
  /** 原理讲解 */
  explanation: string;
  /** 针对性练习 */
  practiceDrill: string;
  /** 分步参考图资产(pending=未生成;弹层降级文案) */
  referenceAssets: KnowledgeCardReferenceAssets | null;
  /** 关联作品 ID 列表(artworks.json / heritage-works.json 引用) */
  relatedWorks: string[] | null;
  /** 系统内置(当前版本恒 true) */
  isBuiltIn: boolean;
  /** 启用状态 */
  enabled: boolean;
  /** 排序权重 */
  sortOrder: number;
  /** 创建时间(ISO 8601) */
  createdAt: string;
  /** 更新时间(ISO 8601) */
  updatedAt: string;
}
