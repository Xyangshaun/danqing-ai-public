// ============================================================
// Rubric Registry 查询入口
// 按作品类型提供评分标准条目查询
// P1 接入绘画类;P2 补齐 design/product/sculpture 四类全覆盖
// ============================================================

import type { ArtType } from '../../types/api-contract.js';
import type { RubricCriterion } from './types.js';
import { PAINTING_RUBRICS } from './painting.js';
import { DESIGN_RUBRICS } from './design.js';
import { PRODUCT_RUBRICS } from './product.js';
import { SCULPTURE_RUBRICS } from './sculpture.js';

/** 各类型 rubric 注册表(四类全覆盖) */
const REGISTRY: Partial<Record<ArtType, RubricCriterion[]>> = {
  painting: PAINTING_RUBRICS,
  design: DESIGN_RUBRICS,
  product: PRODUCT_RUBRICS,
  sculpture: SCULPTURE_RUBRICS,
};

/**
 * 获取指定作品类型的全部评分标准条目
 * 未接入类型(如 P2 待补的设计类)返回空数组,调用方据此跳过透明化
 */
export function getRubrics(artType: ArtType): RubricCriterion[] {
  return REGISTRY[artType] ?? [];
}

/**
 * 获取指定类型 + 维度的评分标准条目
 */
export function getRubricsByDimension(artType: ArtType, dimensionKey: string): RubricCriterion[] {
  return getRubrics(artType).filter((r) => r.dimensionKey === dimensionKey);
}

export type { RubricCriterion, RubricBand, RubricThreshold } from './types.js';
