// ============================================================
// 评分标准条目类型(Rubric Registry 数据层)
// 框架二「评分链路透明化」核心数据结构
//
// 数据来源:.trae/documents/art-evaluation-standards.md
//   - 权重表(2.1) → dimensionLabel / dimensionWeight
//   - 子指标表(2.2) → subIndicator / aiFeature / quantification / thresholds
//   - 四档评分描述表(2.3) → bandDescriptions
//   - 改进建议规范(2.4) → referenceExample
//
// 设计原则:
//   1. 每个分数都必须能追溯到具体 rubric 条目与规范出处
//   2. thresholds 为空(semanticOnly=true)的条目诚实标注"AI语义判断",
//      不伪造客观性(能力边界声明)
//   3. metricKey 与 JimpMetricsForPrompt 字段对齐(或 dimensions 内点路径)
// ============================================================

/** 四档等级(与标准文档四档评分描述表一致) */
export type RubricBand = '优' | '良' | '中' | '差';

/** 客观阈值判定 */
export interface RubricThreshold {
  /** Jimp 指标键(flat: 'goldenRatioScore' 或 dotted: 'composition.symmetry') */
  metricKey: string;
  /** 比较运算 */
  op: '>=' | '<=' | 'between' | 'approx';
  /** 阈值:between 为 [min,max];approx 为 [目标值, 容差] */
  value: number | [number, number];
  /** 人类可读标准描述(如"落点接近黄金分割点(0.382/0.618)") */
  label: string;
}

/** 单条评分标准条目 */
export interface RubricCriterion {
  /** 条目唯一标识(如 'PAINT-COMP-GOLDEN') */
  rubricId: string;
  /** 作品类型 */
  artType: 'painting' | 'design' | 'product' | 'sculpture';
  /** 维度键(与各 Analysis 类型字段对齐;第4维用 'overall') */
  dimensionKey: string;
  /** 维度规范术语全称(如"构图与造型") */
  dimensionLabel: string;
  /** 维度权重(0-1,来自标准文档权重表) */
  dimensionWeight: number;
  /** 子指标名(如"主体位置") */
  subIndicator: string;
  /** AI 识别特征描述 */
  aiFeature: string;
  /** 量化方式描述 */
  quantification: string;
  /** 客观判定阈值(空数组 = 纯语义项) */
  thresholds: RubricThreshold[];
  /** 纯语义项:无法本地量化,证据来自 AI 判断 */
  semanticOnly: boolean;
  /** 四档评分描述 */
  bandDescriptions: Record<RubricBand, string>;
  /** 参考案例(美术史作品) */
  referenceExample?: string;
  /** 规范出处(如"中央美术学院《基础部评分细则》") */
  source: string;
}

/** 值格式化方式(用于 displayValue) */
export type MetricFormat = 'ratio' | 'score100' | 'degree' | 'raw';
