// ============================================================
// 仲裁配置常量
// - DEFAULT_ARBITRATION_CONFIG:系统默认仲裁配置(镜像后端 server/src/config/arbitration-default.ts)
//   作为表单初始值参考 / 从默认值加载的兜底
// - 字段元数据:用于租户仲裁配置抽屉的通用渲染(标签/范围/步长/精度)
// ============================================================

import type { ArbitrationConfig } from '@/types/api';

/** 系统默认仲裁配置(与后端 arbitration-default.ts 保持一致) */
export const DEFAULT_ARBITRATION_CONFIG: ArbitrationConfig = {
  triggers: {
    consistentTotalRange: 5,
    consistentDimDiff: 8,
    generalDisputeTotalRange: 10,
    generalDisputeDimDiff: 15,
    highDisputeTotalRange: 20,
    highDisputeDimCount: 2,
    gradeCrossTierHigh: 2,
    vetoLowGrade: 60,
    vetoHighGrade: 90,
  },
  judgeWeights: {
    regular: { professor: 0.5, lecturer: 0.3, ai: 0.2 },
    professorAi: { professor: 0.7, ai: 0.3 },
    committee: { professorEach: 0.3, ai: 0.1 },
  },
  rules: {
    final: 'weighted',
    boundaryTolerance: 1,
  },
  edgeCases: {
    outlierDiff: 25,
    outlierWeightFactor: 0.5,
    aiLowConfidence: 0.6,
    aiLowConfidenceWeight: 0.1,
    aiVeryLowConfidence: 0.4,
    aiHumanExtremeDiff: 20,
    maxMissingDimsToInvalidate: 2,
  },
};

/** 数字字段元数据(用于通用渲染) */
export interface NumberFieldMeta {
  /** 字段键(对应 ArbitrationConfig 内同名键) */
  key: string;
  /** 中文标签 */
  label: string;
  /** 提示文案(可选) */
  hint?: string;
  /** 最小值(可选) */
  min?: number;
  /** 最大值(可选) */
  max?: number;
  /** 步长(可选,默认 1) */
  step?: number;
  /** 小数精度(可选,默认 0) */
  precision?: number;
}

/** 触发阈值字段元数据 */
export const TRIGGER_FIELDS: NumberFieldMeta[] = [
  { key: 'consistentTotalRange', label: '一致总分极差阈值', hint: '总分极差低于此值且维度差小 → 一致', min: 0, max: 100 },
  { key: 'consistentDimDiff', label: '一致维度差阈值', hint: '维度差低于此值 → 一致', min: 0, max: 100 },
  { key: 'generalDisputeTotalRange', label: '一般争议总分极差阈值', min: 0, max: 100 },
  { key: 'generalDisputeDimDiff', label: '一般争议维度差阈值', min: 0, max: 100 },
  { key: 'highDisputeTotalRange', label: '高争议总分极差阈值', min: 0, max: 100 },
  { key: 'highDisputeDimCount', label: '高争议维度数阈值', min: 1, max: 20 },
  { key: 'gradeCrossTierHigh', label: '高争议跨档数阈值', min: 1, max: 4 },
  { key: 'vetoLowGrade', label: '否决低分阈值', hint: '任一评委判分低于此值 → 强制委员会复议', min: 0, max: 100 },
  { key: 'vetoHighGrade', label: '否决高分阈值', hint: '其余评委判分高于此值 → 强制委员会复议', min: 0, max: 100 },
];

/** 评委权重模式(每模式权重和须=1) */
export interface JudgeWeightModeMeta {
  /** 模式键 */
  key: keyof ArbitrationConfig['judgeWeights'];
  /** 模式中文名 */
  label: string;
  /** 该模式下的权重字段 */
  fields: NumberFieldMeta[];
}

/** 评委权重模式元数据 */
export const JUDGE_WEIGHT_MODES: JudgeWeightModeMeta[] = [
  {
    key: 'regular',
    label: '常规双评委',
    fields: [
      { key: 'professor', label: '教授', min: 0, max: 1, step: 0.05, precision: 2 },
      { key: 'lecturer', label: '讲师', min: 0, max: 1, step: 0.05, precision: 2 },
      { key: 'ai', label: 'AI', min: 0, max: 1, step: 0.05, precision: 2 },
    ],
  },
  {
    key: 'professorAi',
    label: '教授+AI',
    fields: [
      { key: 'professor', label: '教授', min: 0, max: 1, step: 0.05, precision: 2 },
      { key: 'ai', label: 'AI', min: 0, max: 1, step: 0.05, precision: 2 },
    ],
  },
  {
    key: 'committee',
    label: '委员会复议',
    fields: [
      { key: 'professorEach', label: '每位教授', min: 0, max: 1, step: 0.05, precision: 2 },
      { key: 'ai', label: 'AI', min: 0, max: 1, step: 0.05, precision: 2 },
    ],
  },
];

/** 边界情况字段元数据 */
export const EDGE_CASE_FIELDS: NumberFieldMeta[] = [
  { key: 'outlierDiff', label: '离群分差阈值', hint: '分差≥此值 → 权重折半', min: 0, max: 100 },
  { key: 'outlierWeightFactor', label: '离群权重折半系数', min: 0, max: 1, step: 0.05, precision: 2 },
  { key: 'aiLowConfidence', label: 'AI 低置信度阈值', hint: '置信度<此值 → AI 权重降至降级权重', min: 0, max: 1, step: 0.05, precision: 2 },
  { key: 'aiLowConfidenceWeight', label: 'AI 降级后权重', min: 0, max: 1, step: 0.05, precision: 2 },
  { key: 'aiVeryLowConfidence', label: 'AI 极低置信度阈值', hint: '置信度<此值 → AI 仅作参考不计入加权', min: 0, max: 1, step: 0.05, precision: 2 },
  { key: 'aiHumanExtremeDiff', label: 'AI 与人工极端分歧阈值', min: 0, max: 100 },
  { key: 'maxMissingDimsToInvalidate', label: '缺失维度作废阈值', min: 0, max: 20 },
];

/** 裁定规则选项 */
export const FINAL_RULE_OPTIONS = [
  { value: 'weighted' as const, label: '加权' },
  { value: 'majority' as const, label: '多数决' },
  { value: 'unanimous' as const, label: '一致' },
];

/** 权重归一化判定容差(浮点误差) */
export const WEIGHT_SUM_EPSILON = 1e-6;