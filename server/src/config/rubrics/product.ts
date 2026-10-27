// ============================================================
// 产品设计类评分标准数据(12 条子指标)
// 逐条对应 .trae/documents/art-evaluation-standards.md §4.2 子指标表
//
// 维度结构(权重表 §4.1):
//   form                 形态语义(3条客观 + 1条语义)
//   materialExpression   材质表现(1条客观 + 2条语义)
//   functionExpression   功能表达(1条客观 + 2条语义)
//   overall              整体与人机工程(吸收文档第四维"人机工程"20%,全语义)
//
// 说明:ProductAnalysis 代码维度为 3 个,文档第四维"人机工程"(20%)
// 以 semanticOnly 条目并入 overall 维度,规范出处如实标注。
// ============================================================

import type { RubricCriterion } from './types.js';

const SRC_Thuaid = '清华美院《工业设计教学评估标准》';
const SRC_Cafa = '中央美术学院《基础部评分细则》';

export const PRODUCT_RUBRICS: RubricCriterion[] = [
  // ============ 维度一:形态语义(30%) ============

  {
    rubricId: 'PROD-FORM-GOLDEN',
    artType: 'product',
    dimensionKey: 'form',
    dimensionLabel: '形态语义',
    dimensionWeight: 0.3,
    subIndicator: '形态比例',
    aiFeature: '整体长宽高比、黄金比运用',
    quantification: '关键尺寸符合黄金比(黄金分割评分≥60)',
    thresholds: [{ metricKey: 'goldenRatioScore', op: '>=', value: 60, label: '形态比例合黄金比(评分≥60)' }],
    semanticOnly: false,
    bandDescriptions: {
      优: '形态比例合黄金比,体量关系精当',
      良: '比例基本合理',
      中: '比例一般,缺乏推敲',
      差: '比例失调',
    },
    referenceExample: '苹果产品设计的比例控制',
    source: SRC_Thuaid,
  },
  {
    rubricId: 'PROD-FORM-THIRDS',
    artType: 'product',
    dimensionKey: 'form',
    dimensionLabel: '形态语义',
    dimensionWeight: 0.3,
    subIndicator: '视觉重心',
    aiFeature: '产品主体在画面中的落点与稳定感',
    quantification: '三分法评分≥60(主体落于视觉稳定区)',
    thresholds: [{ metricKey: 'ruleOfThirdsScore', op: '>=', value: 60, label: '主体落点稳定(三分法评分≥60)' }],
    semanticOnly: false,
    bandDescriptions: {
      优: '视觉重心稳定,展示角度考究',
      良: '重心基本稳定',
      中: '重心略偏,展示角度随意',
      差: '重心失衡',
    },
    referenceExample: '博朗 T3 收音机的形态控制',
    source: SRC_Thuaid,
  },
  {
    rubricId: 'PROD-FORM-LINE',
    artType: 'product',
    dimensionKey: 'form',
    dimensionLabel: '形态语义',
    dimensionWeight: 0.3,
    subIndicator: '曲面连续性(G0/G1/G2)',
    aiFeature: '曲面过渡处的切率/曲率连续、线条方向流畅度',
    quantification: 'G2 曲率连续为最优(方向一致性≥0.50 为流畅)',
    thresholds: [{ metricKey: 'form.directionCoherence', op: '>=', value: 0.5, label: '曲率/线条过渡流畅(一致性≥0.50)' }],
    semanticOnly: false,
    bandDescriptions: {
      优: '曲面 G2 连续,线型流畅有张力',
      良: '曲面 G1 连续,过渡基本顺畅',
      中: '曲面 G0 连续或有折痕',
      差: '曲面断裂不连续',
    },
    referenceExample: '苹果产品设计 G2 曲面',
    source: SRC_Thuaid,
  },
  {
    rubricId: 'PROD-FORM-SEMANTIC',
    artType: 'product',
    dimensionKey: 'form',
    dimensionLabel: '形态语义',
    dimensionWeight: 0.3,
    subIndicator: '语义与功能一致性',
    aiFeature: '形态暗示的功能指向',
    quantification: '形态-功能对应清晰度(语义判断)',
    thresholds: [],
    semanticOnly: true,
    bandDescriptions: {
      优: '形态语义与功能高度一致,有原创语言',
      良: '语义与功能基本对应',
      中: '语义模糊',
      差: '语义错误',
    },
    referenceExample: '深泽直人±0 产品的形态语义',
    source: SRC_Thuaid,
  },

  // ============ 维度二:材质表现(25%) ============

  {
    rubricId: 'PROD-MAT-TEXTURE',
    artType: 'product',
    dimensionKey: 'materialExpression',
    dimensionLabel: '材质表现',
    dimensionWeight: 0.25,
    subIndicator: '材质质感真实度',
    aiFeature: '材质纹理、反射特性',
    quantification: '高光/反射/漫反射符合物理(纹理复杂度≥0.25)',
    thresholds: [{ metricKey: 'textureComplexity', op: '>=', value: 0.25, label: '质感表现充分(纹理复杂度≥0.25)' }],
    semanticOnly: false,
    bandDescriptions: {
      优: '材质质感高度真实,纹理细节充分',
      良: '质感较好',
      中: '质感一般,细节不足',
      差: '质感失真',
    },
    referenceExample: '迪特·拉姆斯博朗产品的材质表现',
    source: SRC_Thuaid,
  },
  {
    rubricId: 'PROD-MAT-LIGHT',
    artType: 'product',
    dimensionKey: 'materialExpression',
    dimensionLabel: '材质表现',
    dimensionWeight: 0.25,
    subIndicator: '光影反射准确度',
    aiFeature: '高光位置、反射环境',
    quantification: '高光符合光源方向(语义判断)',
    thresholds: [],
    semanticOnly: true,
    bandDescriptions: {
      优: '光影反射物理准确,环境映射真实',
      良: '反射基本正确',
      中: '反射有误',
      差: '反射错误,光影矛盾',
    },
    referenceExample: '工业设计渲染的光影规范',
    source: SRC_Thuaid,
  },
  {
    rubricId: 'PROD-MAT-CMF',
    artType: 'product',
    dimensionKey: 'materialExpression',
    dimensionLabel: '材质表现',
    dimensionWeight: 0.25,
    subIndicator: '材质搭配与 CMF',
    aiFeature: '多材质组合的协调性、表面处理工艺',
    quantification: '材质对比与统一平衡,CMF 符合工艺规范(语义判断)',
    thresholds: [],
    semanticOnly: true,
    bandDescriptions: {
      优: '材质搭配美学考究,CMF 处理精致',
      良: '材质搭配尚可,CMF 处理到位',
      中: '材质搭配平庸,CMF 处理粗糙',
      差: '材质搭配混乱,无 CMF 意识',
    },
    referenceExample: '博朗 CMF 设计体系',
    source: SRC_Thuaid,
  },

  // ============ 维度三:功能表达(25%) ============

  {
    rubricId: 'PROD-FUNC-STRUCT',
    artType: 'product',
    dimensionKey: 'functionExpression',
    dimensionLabel: '功能表达',
    dimensionWeight: 0.25,
    subIndicator: '结构清晰度',
    aiFeature: '结构线、分模线、装配关系',
    quantification: '结构逻辑可读(边缘密度≥0.06,结构线可辨)',
    thresholds: [{ metricKey: 'edgeDensity', op: '>=', value: 0.06, label: '结构线可读(边缘密度≥0.06)' }],
    semanticOnly: false,
    bandDescriptions: {
      优: '结构逻辑清晰可读,分模线考究',
      良: '结构基本清晰',
      中: '结构模糊',
      差: '结构无法解读',
    },
    referenceExample: '深泽直人±0 产品的结构表达',
    source: SRC_Thuaid,
  },
  {
    rubricId: 'PROD-FUNC-HINT',
    artType: 'product',
    dimensionKey: 'functionExpression',
    dimensionLabel: '功能表达',
    dimensionWeight: 0.25,
    subIndicator: '功能暗示',
    aiFeature: '形态对使用方式的暗示',
    quantification: '操作部位形态暗示(语义判断)',
    thresholds: [],
    semanticOnly: true,
    bandDescriptions: {
      优: '功能暗示明确,操作部位形态清晰',
      良: '功能暗示尚可',
      中: '功能暗示弱',
      差: '无功能暗示',
    },
    referenceExample: '人体工程学的形态暗示',
    source: SRC_Thuaid,
  },
  {
    rubricId: 'PROD-FUNC-READ',
    artType: 'product',
    dimensionKey: 'functionExpression',
    dimensionLabel: '功能表达',
    dimensionWeight: 0.25,
    subIndicator: '人机交互可读性',
    aiFeature: '界面/按钮/接口的识别度',
    quantification: '交互元素可识别(语义判断)',
    thresholds: [],
    semanticOnly: true,
    bandDescriptions: {
      优: '人机交互可识别度高,分区合理',
      良: '交互可识别,分区基本合理',
      中: '交互可识别度低,分区混乱',
      差: '交互不可识别,无分区',
    },
    referenceExample: '苹果人机界面设计指南',
    source: SRC_Thuaid,
  },

  // ============ 维度四:整体与人机工程(20%,吸收文档第四维) ============

  {
    rubricId: 'PROD-WHOLE-ERGO',
    artType: 'product',
    dimensionKey: 'overall',
    dimensionLabel: '整体与人机工程',
    dimensionWeight: 0.2,
    subIndicator: '握持比例与操作可达',
    aiFeature: '尺寸符合人体测量百分位、操作区域可达范围',
    quantification: '第 5~95 百分位覆盖,拇指可达区(语义判断)',
    thresholds: [],
    semanticOnly: true,
    bandDescriptions: {
      优: '握持比例符合人体测量百分位,操作完全可达',
      良: '握持比例基本合理,操作可达',
      中: '握持比例欠妥,操作部分不可达',
      差: '握持比例失调,操作不可达',
    },
    referenceExample: '人体测量学百分位数据应用',
    source: SRC_Thuaid,
  },
  {
    rubricId: 'PROD-WHOLE-UNITY',
    artType: 'product',
    dimensionKey: 'overall',
    dimensionLabel: '整体与人机工程',
    dimensionWeight: 0.2,
    subIndicator: '视觉引导与整体尺度',
    aiFeature: '视觉线索引导操作、整体尺度与人/环境关系',
    quantification: '操作引导清晰,尺度符合使用场景(语义判断)',
    thresholds: [],
    semanticOnly: true,
    bandDescriptions: {
      优: '视觉引导精准,尺度合理,整体语言统一',
      良: '引导较好,尺度尚可',
      中: '引导模糊,尺度偏颇',
      差: '无引导,尺度严重失当',
    },
    referenceExample: '博朗产品的人机尺度',
    source: SRC_Cafa,
  },
];
