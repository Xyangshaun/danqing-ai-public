// ============================================================
// 雕塑类评分标准数据(12 条子指标)
// 逐条对应 .trae/documents/art-evaluation-standards.md §5.2 子指标表
//
// 维度结构(权重表 §5.1):
//   spatialComposition  空间构成(3条客观 + 1条语义)
//   bodyLanguage        形体语言(2条客观 + 1条语义)
//   materialLanguage    材料语言(1条客观 + 2条语义)
//   overall             整体与观念表达(吸收文档第四维"观念表达"15%,全语义)
//
// 说明:SculptureAnalysis 代码维度为 3 个,文档第四维"观念表达"(15%)
// 以 semanticOnly 条目并入 overall 维度,规范出处如实标注。
// ============================================================

import type { RubricCriterion } from './types.js';

const SRC_Cafa = '中央美术学院《基础部评分细则》';
const SRC_Gome = '中国美术学院《专业基础教学大纲》';

export const SCULPTURE_RUBRICS: RubricCriterion[] = [
  // ============ 维度一:空间构成(30%) ============

  {
    rubricId: 'SCULP-SP-GOLDEN',
    artType: 'sculpture',
    dimensionKey: 'spatialComposition',
    dimensionLabel: '空间构成',
    dimensionWeight: 0.3,
    subIndicator: '主体落点与体量布局',
    aiFeature: '主体几何中心在取景框中的落点',
    quantification: '黄金分割评分≥60',
    thresholds: [{ metricKey: 'goldenRatioScore', op: '>=', value: 60, label: '主体落点富于构图感(评分≥60)' }],
    semanticOnly: false,
    bandDescriptions: {
      优: '主体落点考究,体量布局富构图意识',
      良: '落点基本合理',
      中: '落点随意,布局平淡',
      差: '落点失衡,布局混乱',
    },
    referenceExample: '亨利·摩尔《斜倚的人体》体量布局',
    source: SRC_Cafa,
  },
  {
    rubricId: 'SCULP-SP-THIRDS',
    artType: 'sculpture',
    dimensionKey: 'spatialComposition',
    dimensionLabel: '空间构成',
    dimensionWeight: 0.3,
    subIndicator: '三维体量平衡',
    aiFeature: '多角度体块重心与空间占有(以主视面三分结构近似)',
    quantification: '三分法评分≥60(重心投影稳定)',
    thresholds: [{ metricKey: 'ruleOfThirdsScore', op: '>=', value: 60, label: '主视面重心稳定(三分法评分≥60)' }],
    semanticOnly: false,
    bandDescriptions: {
      优: '三维体量高度平衡,重心投影稳定',
      良: '体量基本平衡',
      中: '体量略有失衡',
      差: '体量严重失衡',
    },
    referenceExample: '贾科梅蒂《广场》的空间与体量',
    source: SRC_Cafa,
  },
  {
    rubricId: 'SCULP-SP-VOID',
    artType: 'sculpture',
    dimensionKey: 'spatialComposition',
    dimensionLabel: '空间构成',
    dimensionWeight: 0.3,
    subIndicator: '正负空间处理',
    aiFeature: '实体与虚空的比例、形态',
    quantification: '正负空间比 4:6~6:4 为佳(负空间占比 35%-60%)',
    thresholds: [{ metricKey: 'whitespaceRatio', op: 'between', value: [0.35, 0.6], label: '正负空间均衡(负空间 35%-60%)' }],
    semanticOnly: false,
    bandDescriptions: {
      优: '正负空间处理精到,孔洞与实体互为呼吸',
      良: '正负空间处理较好',
      中: '正负空间一般',
      差: '正负空间混乱',
    },
    referenceExample: '亨利·摩尔孔洞的负空间',
    source: SRC_Gome,
  },
  {
    rubricId: 'SCULP-SP-TENSION',
    artType: 'sculpture',
    dimensionKey: 'spatialComposition',
    dimensionLabel: '空间构成',
    dimensionWeight: 0.3,
    subIndicator: '空间张力',
    aiFeature: '形态对空间的挤压与延展、张力方向线',
    quantification: '张力方向线交汇清晰(语义判断)',
    thresholds: [],
    semanticOnly: true,
    bandDescriptions: {
      优: '空间张力饱满,形态挤压与延展有力',
      良: '空间张力尚可',
      中: '空间张力不足',
      差: '无空间张力',
    },
    referenceExample: '布朗库西《空间之鸟》的空间张力',
    source: SRC_Cafa,
  },

  // ============ 维度二:形体语言(30%) ============

  {
    rubricId: 'SCULP-BODY-DIR',
    artType: 'sculpture',
    dimensionKey: 'bodyLanguage',
    dimensionLabel: '形体语言',
    dimensionWeight: 0.3,
    subIndicator: '轮廓与形体组织',
    aiFeature: '形体方向一致性(剪影轮廓节奏)',
    quantification: '方向一致性 0.30-0.85 为宜(过低=散乱,过高=呆板)',
    thresholds: [{ metricKey: 'bodyLanguage.directionCoherence', op: 'between', value: [0.3, 0.85], label: '形体组织有序(一致性 0.30-0.85)' }],
    semanticOnly: false,
    bandDescriptions: {
      优: '轮廓富表现力,形体语言统一而有变化',
      良: '轮廓较好,形体基本有序',
      中: '轮廓平庸,形体松散',
      差: '轮廓混乱',
    },
    referenceExample: '贾科梅蒂《行走的人》的轮廓张力',
    source: SRC_Cafa,
  },
  {
    rubricId: 'SCULP-BODY-ENERGY',
    artType: 'sculpture',
    dimensionKey: 'bodyLanguage',
    dimensionLabel: '形体语言',
    dimensionWeight: 0.3,
    subIndicator: '动态与张力表达',
    aiFeature: '重心偏移、S 形曲线、形体能量',
    quantification: '形体能量≥0.30(动态线明确)',
    thresholds: [{ metricKey: 'bodyLanguage.strokeEnergy', op: '>=', value: 0.3, label: '动态张力明确(能量≥0.30)' }],
    semanticOnly: false,
    bandDescriptions: {
      优: '动态张力饱满,动态线明确有力',
      良: '动态尚可',
      中: '动态平淡',
      差: '无动态',
    },
    referenceExample: '米开朗基罗《大卫》的 S 形动态',
    source: SRC_Cafa,
  },
  {
    rubricId: 'SCULP-BODY-ACCURACY',
    artType: 'sculpture',
    dimensionKey: 'bodyLanguage',
    dimensionLabel: '形体语言',
    dimensionWeight: 0.3,
    subIndicator: '造型准确性',
    aiFeature: '比例结构、解剖关系',
    quantification: '比例符合解剖学或有意变形(语义判断)',
    thresholds: [],
    semanticOnly: true,
    bandDescriptions: {
      优: '造型准确(或有意变形语言统一),比例精当',
      良: '造型基本准确',
      中: '造型一般,比例欠妥',
      差: '造型失准,比例失调',
    },
    referenceExample: '罗丹《思想者》的解剖与造型',
    source: SRC_Cafa,
  },

  // ============ 维度三:材料语言(25%) ============

  {
    rubricId: 'SCULP-MAT-TEXTURE',
    artType: 'sculpture',
    dimensionKey: 'materialLanguage',
    dimensionLabel: '材料语言',
    dimensionWeight: 0.25,
    subIndicator: '肌理表现',
    aiFeature: '材料表面的肌理组织',
    quantification: '肌理层次 ≥3 层(纹理复杂度≥0.25)',
    thresholds: [{ metricKey: 'textureComplexity', op: '>=', value: 0.25, label: '肌理层次丰富(复杂度≥0.25)' }],
    semanticOnly: false,
    bandDescriptions: {
      优: '肌理层次丰富,材料特性充分发挥',
      良: '肌理较好',
      中: '肌理单一',
      差: '无肌理',
    },
    referenceExample: '野口勇石材肌理对话',
    source: SRC_Gome,
  },
  {
    rubricId: 'SCULP-MAT-CRAFT',
    artType: 'sculpture',
    dimensionKey: 'materialLanguage',
    dimensionLabel: '材料语言',
    dimensionWeight: 0.25,
    subIndicator: '工艺精良度',
    aiFeature: '表面处理/接缝/细节精度',
    quantification: '工艺完成度(语义判断)',
    thresholds: [],
    semanticOnly: true,
    bandDescriptions: {
      优: '工艺精良,细节完成度高',
      良: '工艺良好',
      中: '工艺粗糙',
      差: '工艺低劣',
    },
    referenceExample: '布朗库西《空间之鸟》的极致抛光',
    source: SRC_Cafa,
  },
  {
    rubricId: 'SCULP-MAT-FIT',
    artType: 'sculpture',
    dimensionKey: 'materialLanguage',
    dimensionLabel: '材料语言',
    dimensionWeight: 0.25,
    subIndicator: '材料-主题契合度',
    aiFeature: '材料语义与主题的呼应',
    quantification: '材料-主题语义一致(语义判断)',
    thresholds: [],
    semanticOnly: true,
    bandDescriptions: {
      优: '材料与主题高度契合,材料"说话"',
      良: '材料-主题契合尚可',
      中: '材料-主题契合弱',
      差: '材料-主题冲突',
    },
    referenceExample: '白南准《电视佛陀》的媒介语义',
    source: SRC_Gome,
  },

  // ============ 维度四:整体与观念表达(15%,吸收文档第四维) ============

  {
    rubricId: 'SCULP-WHOLE-CONCEPT',
    artType: 'sculpture',
    dimensionKey: 'overall',
    dimensionLabel: '整体与观念表达',
    dimensionWeight: 0.15,
    subIndicator: '概念深度与主题诠释',
    aiFeature: '主题思想的深度与视觉转化',
    quantification: '概念层次 ≥2 层,主题-形象对应清晰(语义判断)',
    thresholds: [],
    semanticOnly: true,
    bandDescriptions: {
      优: '概念深刻,主题诠释精准',
      良: '概念有一定深度,诠释尚可',
      中: '概念浅显,诠释生硬',
      差: '无概念或抄袭,主题缺失',
    },
    referenceExample: '白南准《电视佛陀》的观念层次',
    source: SRC_Gome,
  },
  {
    rubricId: 'SCULP-WHOLE-CONTEXT',
    artType: 'sculpture',
    dimensionKey: 'overall',
    dimensionLabel: '整体与观念表达',
    dimensionWeight: 0.15,
    subIndicator: '文化语境与时代性',
    aiFeature: '文化符号的恰当运用、当代议题回应',
    quantification: '符号原生语境尊重,时代议题回应度(语义判断)',
    thresholds: [],
    semanticOnly: true,
    bandDescriptions: {
      优: '文化语境恰当,时代性强',
      良: '文化语境较好,时代性一般',
      中: '文化符号堆砌,时代性弱',
      差: '文化误用,无时代性',
    },
    referenceExample: '徐震《没顶公司》的当代语境',
    source: SRC_Gome,
  },
];
