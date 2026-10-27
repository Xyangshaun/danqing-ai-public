export type ArtType = 'painting' | 'design' | 'product' | 'sculpture' | 'heritage';

// ============================================
// 专业建议类型(Phase B4:对齐后端 ai-analysis.ts)
// ============================================

/**
 * 建议优先级(ArtCoT证据锚定)
 * high   - 低分维度(<60分),必须改的基础问题
 * medium - 中等分数维度(60-80分),提升建议
 * low    - 高分维度(>80分),亮点肯定或风格探讨
 */
export type SuggestionPriority = 'high' | 'medium' | 'low';

/**
 * 建议等级(对应美院评分标准)
 */
export type SuggestionLevel = 'excellent' | 'good' | 'average' | 'poor';

/**
 * 专业改进建议(ArtCoT证据锚定格式,Phase B4)
 * 向后兼容:旧数据/Canvas模式可能只有 operation/suggestion 文本,
 * evidence/priority 等字段均为可选,缺失时组件按原有方式渲染。
 */
export interface ProfessionalSuggestion {
  /** 维度名(构图/色彩/笔触技法/视觉层次/排版/色彩应用 等) */
  dimension: string;
  /** 该维度的评级(可选) */
  level?: SuggestionLevel;
  /** 证据字段:引用具体数值证据(如'视觉重心(0.72,0.45)偏右,黄金分割评分仅42分'),可选 */
  evidence?: string;
  /** 具体操作建议(必填,兼容旧suggestion字段) */
  operation: string;
  /** 参考案例(美术史作品,可选) */
  reference?: string;
  /** 练习路径(针对性练习,可选) */
  practice?: string;
  /** 优先级:high必改/medium提升/low亮点,可选(缺失时按medium处理) */
  priority?: SuggestionPriority;
}

// ============================================
// 饱和度分布
// ============================================
export interface SaturationDistribution {
  low: number;
  mid: number;
  high: number;
}

// ============================================
// pHash最相似作品信息
// ============================================
export interface MostSimilarWork {
  title: string;
  artist: string;
  distance: number;
}

// ============================================
// 绘画分析维度
// ============================================
export interface PaintingAnalysis {
  type: 'painting';
  composition: {
    /** 维度评分(AI 绝对分覆盖时非空;本地引擎停分后为 null,测量与文案保留。批次③ 2026-09-05) */
    score: number | null;
    focusPoint: { x: number; y: number };
    balance: 'balanced' | 'left-heavy' | 'right-heavy' | 'top-heavy' | 'bottom-heavy';
    guideline: 'good' | 'average' | 'poor';
    whitespaceRatio: number;
    symmetry: number;
    suggestion: string;
    heatmapData: number[][];
    /** 黄金分割评分(0-100),Phase A新增 */
    goldenRatioScore?: number;
    /** 三分法评分(0-100),Phase A新增 */
    ruleOfThirdsScore?: number;
    /** 引导线方向(0-180度),Phase A新增 */
    leadingLineDirection?: number;
    /** 引导线强度(0-1),Phase A新增 */
    leadingLineStrength?: number;
  };
  color: {
    /** 维度评分(AI 绝对分覆盖时非空;本地引擎停分后为 null,测量与文案保留。批次③ 2026-09-05) */
    score: number | null;
    warmRatio: number;
    coolRatio: number;
    contrast: 'high' | 'medium' | 'low';
    saturation: 'high' | 'medium' | 'low';
    richness: 'rich' | 'moderate' | 'limited';
    harmony: string;
    dominantColor: string;
    suggestion: string;
    /** 色彩和谐度分数(0-100),Phase A新增 */
    harmonyScore?: number;
    /** 色彩和谐类型英文标识,Phase A新增 */
    harmonyType?: string;
    /** 饱和度三级分布,Phase A新增 */
    saturationDistribution?: SaturationDistribution;
  };
  brushwork: {
    /** 维度评分(AI 绝对分覆盖时非空;本地引擎停分后为 null,测量与文案保留。批次③ 2026-09-05) */
    score: number | null;
    textureLevel: 'rich' | 'moderate' | 'simple';
    strokeVariety: number;
    wetDryBalance: string;
    suggestion: string;
    /** 笔触方向一致性(0-1),Phase A新增 */
    directionCoherence?: number;
    /** 笔触能量/张力(0-1),Phase A新增 */
    strokeEnergy?: number;
    /** 主导笔触方向(0-180度),Phase A新增 */
    dominantBrushDirection?: number;
    /** 结构张量聚合指标(Phase F1新增,由 directionCoherence/strokeEnergy/dominantBrushDirection 聚合) */
    structureTensor?: {
      /** 方向一致性(0-1) */
      coherence: number;
      /** 能量/张力(0-1) */
      energy: number;
      /** 主导方向(0-180度) */
      dominantDirection: number;
    };
  };
}

// ============================================
// 设计分析维度
// ============================================
export interface DesignAnalysis {
  type: 'design';
  visualHierarchy: {
    /** 维度评分(AI 绝对分覆盖时非空;本地引擎停分后为 null,测量与文案保留。批次③ 2026-09-05) */
    score: number | null;
    focusPoint: { x: number; y: number };
    primarySecondaryClarity: 'clear' | 'moderate' | 'unclear';
    informationFlow: 'good' | 'average' | 'poor';
    heatmapData: number[][];
    suggestion: string;
    /** 黄金分割评分(0-100),Phase A新增 */
    goldenRatioScore?: number;
    /** 三分法评分(0-100),Phase A新增 */
    ruleOfThirdsScore?: number;
    /** 引导线方向(0-180度),Phase A新增 */
    leadingLineDirection?: number;
    /** 引导线强度(0-1),Phase A新增 */
    leadingLineStrength?: number;
  };
  typography: {
    /** 维度评分(AI 绝对分覆盖时非空;本地引擎停分后为 null,测量与文案保留。批次③ 2026-09-05) */
    score: number | null;
    alignmentQuality: 'good' | 'average' | 'poor';
    rhythmConsistency: 'good' | 'average' | 'poor';
    negativeSpaceUsage: 'good' | 'average' | 'poor';
    gridAdherence: number;
    suggestion: string;
    /** 排版方向对齐一致性(0-1),coherence>0.5表示对齐良好,Phase A新增 */
    directionCoherence?: number;
  };
  colorApplication: {
    /** 维度评分(AI 绝对分覆盖时非空;本地引擎停分后为 null,测量与文案保留。批次③ 2026-09-05) */
    score: number | null;
    contrast: 'high' | 'medium' | 'low';
    brandConsistency: 'strong' | 'moderate' | 'weak';
    colorPsychology: string;
    paletteHarmony: string;
    suggestion: string;
  };
}

// ============================================
// 产品设计分析维度
// ============================================
export interface ProductAnalysis {
  type: 'product';
  form: {
    /** 维度评分(AI 绝对分覆盖时非空;本地引擎停分后为 null,测量与文案保留。批次③ 2026-09-05) */
    score: number | null;
    focusPoint: { x: number; y: number };
    proportionBalance: 'good' | 'average' | 'poor';
    lineFluidity: 'smooth' | 'moderate' | 'stiff';
    surfaceQuality: 'excellent' | 'good' | 'average';
    ergonomicsHint: 'strong' | 'moderate' | 'weak';
    heatmapData: number[][];
    suggestion: string;
    /** 黄金分割评分(0-100),Phase A新增 */
    goldenRatioScore?: number;
    /** 三分法评分(0-100),Phase A新增 */
    ruleOfThirdsScore?: number;
    /** 引导线方向(0-180度),Phase A新增 */
    leadingLineDirection?: number;
    /** 引导线强度(0-1),Phase A新增 */
    leadingLineStrength?: number;
    /** 曲面/线条方向流畅度(0-1),Phase A新增 */
    directionCoherence?: number;
  };
  materialExpression: {
    /** 维度评分(AI 绝对分覆盖时非空;本地引擎停分后为 null,测量与文案保留。批次③ 2026-09-05) */
    score: number | null;
    textureRealism: 'high' | 'medium' | 'low';
    lightShadowPerformance: 'excellent' | 'good' | 'average';
    surfaceTreatment: 'refined' | 'moderate' | 'rough';
    suggestion: string;
  };
  functionExpression: {
    /** 维度评分(AI 绝对分覆盖时非空;本地引擎停分后为 null,测量与文案保留。批次③ 2026-09-05) */
    score: number | null;
    structureClarity: 'clear' | 'moderate' | 'unclear';
    functionImplication: 'strong' | 'moderate' | 'weak';
    detailRefinement: 'excellent' | 'good' | 'average';
    suggestion: string;
  };
}

// ============================================
// 雕塑分析维度
// ============================================
export interface SculptureAnalysis {
  type: 'sculpture';
  spatialComposition: {
    /** 维度评分(AI 绝对分覆盖时非空;本地引擎停分后为 null,测量与文案保留。批次③ 2026-09-05) */
    score: number | null;
    focusPoint: { x: number; y: number };
    volumeSense: 'strong' | 'moderate' | 'weak';
    spaceOccupation: 'full' | 'moderate' | 'sparse';
    voidSolidRelation: 'harmonious' | 'moderate' | 'imbalanced';
    heatmapData: number[][];
    suggestion: string;
    /** 黄金分割评分(0-100),Phase A新增 */
    goldenRatioScore?: number;
    /** 三分法评分(0-100),Phase A新增 */
    ruleOfThirdsScore?: number;
    /** 引导线方向(0-180度),Phase A新增 */
    leadingLineDirection?: number;
    /** 引导线强度(0-1),Phase A新增 */
    leadingLineStrength?: number;
  };
  bodyLanguage: {
    /** 维度评分(AI 绝对分覆盖时非空;本地引擎停分后为 null,测量与文案保留。批次③ 2026-09-05) */
    score: number | null;
    dynamicSense: 'strong' | 'moderate' | 'static';
    tensionExpression: 'high' | 'medium' | 'low';
    rhythmFlow: 'fluent' | 'moderate' | 'stiff';
    suggestion: string;
    /** 形体方向一致性(0-1),形体张力辅助,Phase A新增 */
    directionCoherence?: number;
    /** 形体能量/张力(0-1),Phase A新增 */
    strokeEnergy?: number;
  };
  materialLanguage: {
    /** 维度评分(AI 绝对分覆盖时非空;本地引擎停分后为 null,测量与文案保留。批次③ 2026-09-05) */
    score: number | null;
    materialCharacter: 'distinct' | 'moderate' | 'obscure';
    textureExpression: 'rich' | 'moderate' | 'simple';
    qualityLayering: 'rich' | 'moderate' | 'simple';
    suggestion: string;
  };
}

// ============================================
// 通用分析结果
// ============================================
export type DimensionResult = PaintingAnalysis | DesignAnalysis | ProductAnalysis | SculptureAnalysis;

// ============================================
// 诊断模式 / 艺考诊断类型(2026-08-16 诊断理念重构,对齐后端 ai-analysis.ts)
// ============================================

/**
 * 诊断模式
 *   - teaching 教学诊断:面向艺术爱好者/零基础,1对1老师口吻,
 *     完整度先行→画面关系→顺着作者风格给建议,分数弱化
 *   - exam 艺考诊断:面向美术生,按联考/校考科目标准客观分档评分
 */
export type DiagnosisMode = 'teaching' | 'exam';

/** 艺考科目(仅 exam 模式):sketch 素描 / color 色彩 / quickSketch 速写 */
export type ExamSubject = 'sketch' | 'color' | 'quickSketch';

/** 艺考档位(联考五档制):A=一档(90-100) … E=五档(<60) */
export type ExamGradeBand = 'A' | 'B' | 'C' | 'D' | 'E';

/** 艺考科目维度评分(单维度) */
export interface ExamSubjectScore {
  /** 科目维度名(如"造型与比例") */
  dimension: string;
  /** 维度得分(0-100) */
  score: number;
  /** 该维度评语(扣分依据) */
  comment: string;
}

/** 艺考诊断结果(仅 exam 模式,AI 输出 exam_result 时非空) */
export interface ExamResult {
  /** 档位(A-E) */
  gradeBand: ExamGradeBand;
  /** 档位中文标签(如"二档(80-89)") */
  gradeLabel: string;
  /** 档位评定理由 */
  gradeReason: string;
  /** 科目维度评分列表 */
  subjectScores: ExamSubjectScore[];
  /** 扣分点(具体到画面位置) */
  deductionPoints: string[];
  /** 提分策略(升档训练路径) */
  improvementStrategy: string;
}

export const EXAM_SUBJECT_LABEL: Record<ExamSubject, string> = {
  sketch: '素描',
  color: '色彩',
  quickSketch: '速写',
};

// ---- 评分链路透明化(框架二 P1,2026-08-16;与后端 api-contract 对齐) ----

/** 四档等级(与评分标准四档描述一致) */
export type ScoreBand = '优' | '良' | '中' | '差';

/** 单项客观度量证据(Jimp 本地确定性计算,可复现) */
export interface MetricEvidenceItem {
  /** 对应评分标准条目 ID(如 'PAINT-COMP-GOLDEN');指标缺失时为空串 */
  rubricId: string;
  /** 指标名(如"黄金分割评分") */
  label: string;
  /** 当前作品数值(如 "72 / 100" 或 "38%") */
  displayValue: string;
  /** 标准要求描述 */
  thresholdLabel: string;
  /** 是否达标 */
  passed: boolean;
}

/** 维度级评分证据链 */
export interface DimensionScoreTrace {
  /** 维度键(composition/color/brushwork/overall) */
  dimensionKey: string;
  /** 维度规范术语全称(如"构图与造型") */
  dimensionLabel: string;
  /** 维度得分(overall 维度取综合评分) */
  score: number;
  /** 四档等级 */
  band: ScoreBand;
  /** 命中的评分标准条目(含四档描述与规范出处) */
  rubricRefs: Array<{
    rubricId: string;
    subIndicator: string;
    /** 命中档位的评分描述 */
    bandDescription: string;
    /** 参考案例(美术史作品) */
    referenceExample?: string;
    /** 规范出处(如"中央美术学院《基础部评分细则》") */
    source: string;
    /** 纯语义项:此项由 AI 语义判断,量化标准见规范原文 */
    semanticOnly: boolean;
  }>;
  /** 客观度量证据(Jimp 本地计算) */
  metricEvidence: MetricEvidenceItem[];
  /** 客观指标达标数 */
  passedCount: number;
  /** 客观指标总数 */
  totalCount: number;
  /** AI 语义证据摘录(AI 增强后补充) */
  semanticEvidence?: string;
  /** AI 校准记录(delta ±5,含理由) */
  adjustment?: { delta: number; reason: string };
}

/** 评分依据汇总 */
export interface RubricSummary {
  /** 引用的规范清单(去重) */
  standardNames: string[];
  /** 客观指标总数 */
  totalCriteria: number;
  /** 客观指标达标数 */
  passedCriteria: number;
  /** 纯语义项数量(由 AI 判断) */
  semanticOnlyCount: number;
}

// ============================================
// 深度分析扩展类型(阶段 D,对齐后端 ai-analysis.ts)
// 阶段 A 后端已定义 EvaluationStage/IssueMarker/ScoreCriteria/HeritageCategory,
// 前端在此镜像,供评分标准面板/Canvas 叠层/4 维度展示区组件使用。
// ============================================

/**
 * 评价阶段(对齐后端 EvaluationStage)
 *   teaching 模式: enthusiast 爱好者 / intermediate 进阶 / advanced 资深
 *   exam 模式:    unified 联考级 / academy 美院级 / master 大师级
 * 决定 AI 评分参照系(联考标准/八大美院/美术史)与建议口吻。
 */
export type EvaluationStage =
  | 'enthusiast' | 'intermediate' | 'advanced'
  | 'unified' | 'academy' | 'master';

/**
 * 单维度评分标准(对齐后端 ScoreCriteria)
 * 由 AI 按评价阶段对应参照系输出,用于评分标准面板展示权重/等级/符合项/证据。
 */
export interface ScoreCriteria {
  /** 维度名(如"构图与造型") */
  dimension: string;
  /** 权重(0-1) */
  weight: number;
  /** 该维度满分(可选,如 100) */
  maxScore?: number;
  /** 该维度评级 */
  level: 'excellent' | 'good' | 'average' | 'poor';
  /** 符合的评分项 */
  metCriteria: string[];
  /** 不符合的评分项 */
  unmetCriteria: string[];
  /** 评分证据(引用具体数值/位置/特征,避免模板化) */
  evidence: string;
}

/**
 * 标注参考引用(Phase 3 批次③:第④层"参考";对齐后端 IssueMarkerReference)
 * 后端匹配引擎注入;缺失=无参考(不渲染参考区块)
 */
export interface IssueMarkerReference {
  /** 参考类型:step-guide=分步教学图卡 / master-work=知识库作品对照 */
  kind: 'step-guide' | 'master-work';
  /** 知识点卡片 ID(kind=step-guide;GET /knowledge-cards/:id 拉详情) */
  cardId?: string;
  /** 知识库作品 ID(kind=master-work) */
  workId?: string;
  /** 一句话钩子(卡片上直接展示) */
  teaser: string;
}

/**
 * 问题标注(对齐后端 IssueMarker)
 * x,y,w,h 均为 0-1 相对坐标,前端按图片显示尺寸重映射为像素后绘制 SVG 叠层。
 *
 * 2026-09-03 Phase 1A 扩展(锚定卡片式标注):
 *   - 新增 type(三级严重度含正向 highlight)/dimension(维度归属)/why(原理)/how(改法),全部可选
 *   - 旧数据(无新字段)按 severity 兜底映射渲染
 *
 * 2026-09-06 Phase 3 批次③扩展:新增 reference(第④层"参考",可选)
 */
export interface IssueMarker {
  /** 标注稳定 ID(Phase 4 批次①:后端管线尾注入的确定性短 hash;旧数据缺失=无 ID) */
  id?: string;
  /** 区域左上角 x(0-1 相对值) */
  x: number;
  /** 区域左上角 y(0-1 相对值) */
  y: number;
  /** 区域宽(0-1 相对值) */
  w: number;
  /** 区域高(0-1 相对值) */
  h: number;
  /** 问题标签(框上方显示) */
  label: string;
  /** 严重程度:high 红虚线 / medium 黄实线 / low 蓝点线 */
  severity: 'high' | 'medium' | 'low';
  /** 改进提示(鼠标悬停展示) */
  improvementHint: string;
  /** 标注类型:critical=关键问题(编号徽章+实线框) / suggestion=建议改进(细边框+半透明填充) /
   *  highlight=做得好(绿色柔和高亮,无编号)。缺失时按 severity 兜底映射 */
  type?: 'critical' | 'suggestion' | 'highlight';
  /** 维度归属(如"构图""造型""明暗""色彩";非遗为工艺维度),用于维度色标与过滤 */
  dimension?: string;
  /** 原理解释(为什么这是问题,卡片展示) */
  why?: string;
  /** 改法(具体可操作步骤,卡片展示) */
  how?: string;
  /** 第④层"参考"(Phase 3):卡片/作品引用;缺失=无参考 */
  reference?: IssueMarkerReference;
}

/** IssueMarker.type 兜底映射:缺失时按 severity 推导(high→critical/low→highlight/medium→suggestion) */
export function resolveMarkerType(m: IssueMarker): NonNullable<IssueMarker['type']> {
  if (m.type === 'critical' || m.type === 'suggestion' || m.type === 'highlight') return m.type;
  return m.severity === 'high' ? 'critical' : m.severity === 'low' ? 'highlight' : 'suggestion';
}

// ============================================================
// 2026-09-03 Phase 1B:客观画面检测(本地框架重定位)
// 设计原则(docs/visual-annotation-feedback-upgrade-spec-2026-09.md §5b):
//   只输出纯客观可测量、有教学价值的基础检测,不冒充 AI 诊断。
//   每条检测必须附具体数值 + 可操作改法,做到"真实测量 + 真实可操作"。
// ============================================================

/** 单项客观检测结果 */
export interface ObjectiveCheck {
  /** 检测项 id */
  id: 'grayness' | 'contrast' | 'saturation' | 'focus';
  /** 检测项名称(如"画面灰检测") */
  label: string;
  /** 检测结论:pass=通过 / warn=警示 */
  status: 'pass' | 'warn';
  /** 数值描述(如"明度范围 85-175,标尺利用率 35%") */
  value: string;
  /** 原理解释(为什么这是问题) */
  detail: string;
  /** 可操作改法(具体步骤) */
  suggestion: string;
}

/** 客观画面检测结果集(明度标尺数据 + 各项检测) */
export interface ObjectiveChecks {
  /** 明度标尺可视化数据(直方图 16 桶 + 实际使用范围) */
  luminanceScale?: {
    /** 16 桶明度直方图(每桶占比 0-1) */
    histogram: number[];
    /** 实际使用的明度下限(5 百分位,0-255) */
    min: number;
    /** 实际使用的明度上限(95 百分位,0-255) */
    max: number;
    /** 标尺利用率(范围/255,0-1) */
    utilization: number;
  };
  /** 检测项列表 */
  checks: ObjectiveCheck[];
  /** Phase 2 批次⑥:判定结论按本校评分档案阈值重算(后端阶段 2 AI 增强时覆盖;
   *  引擎默认判定/旧数据/本地检测无此字段,前端展示「按本校标准」提示) */
  profileThresholdsApplied?: boolean;
}

/** 非遗类目(对齐后端 HeritageCategory,扩展至 10 类:原 7 类 + 泥塑/漆器/唐卡,仅 artType=heritage 时有效) */
export type HeritageCategory =
  | 'papercut'
  | 'embroidery'
  | 'porcelain'
  | 'nianhua'
  | 'shadowpuppet'
  | 'weaving'
  | 'woodcarving'
  | 'clay'
  | 'lacquer'
  | 'thangka';

/**
 * 深度维度评分(4 维度通用结构,对齐后端 AIVisionResult 的
 * originalityAndStyle/completenessAndRhythm/emotionAndMood/craftsmanship)
 */
export interface DepthDimensionScore {
  /** 得分(0-100) */
  score: number;
  /** 分析说明(≤100 字) */
  analysis: string;
  /** 改进建议 */
  suggestion: string;
}

export interface AnalysisResult {
  id: string;
  imageUrl: string;
  createdAt: string;
  artType: ArtType;
  dimensions: DimensionResult;
  originality: {
    /** 原创性评分(AI 深度分析时非空;本地引擎停分后为 null——pHash 相似度等测量保留。批次③ 2026-09-05) */
    score: number | null;
    similarity: number;
    creativityLevel: 'excellent' | 'good' | 'average' | 'needsWork';
    suggestion: string;
    /** pHash感知哈希相似度(0-1),Phase A新增 */
    pHashSimilarity?: number;
    /** 最相似的名作信息(Phase A新增) */
    mostSimilarWork?: MostSimilarWork | null;
    /** 疑似来源于网络作品(与名作库高度匹配时为true),前端渲染醒目提醒 */
    suspectedInternetSource?: boolean;
  };
  /** 综合评分(AI 深度分析时非空;本地快速/基础检测结果为 null,评分 UI 条件渲染。2026-09-04 批次②) */
  overallScore: number | null;
  /** 专业改进建议列表(AI增强模式/Phase B4新增,可选;旧数据/Canvas模式可能无此字段) */
  professionalSuggestions?: ProfessionalSuggestion[];
  /** AI 视觉分析详细结果(深度分析模式) */
  aiVisionResult?: {
    /** 画面整体描述 */
    visualDescription?: string;
    /** 构图分析 */
    composition?: string;
    /** 色彩分析 */
    color?: string;
    /** 技法分析 */
    technique?: string;
    /** 主题与意境理解 */
    semanticTheme?: string;
    /** 风格识别 */
    styleRecognition?: string;
    /** 艺考诊断结果(仅 exam 模式且 AI 输出 exam_result 时非空) */
    examResult?: ExamResult;
    // ---- 深度分析扩展(阶段 D,对齐后端 AIVisionResult) ----
    /** 评价阶段(AI 评分参照系) */
    evaluationStage?: EvaluationStage;
    /** 评分标准(各维度权重/等级/符合项/证据) */
    scoreCriteria?: ScoreCriteria[];
    /** 问题标注(Canvas 叠层绘制) */
    issueMarkers?: IssueMarker[];
    /** 4 深度维度评分(原创性与风格/完整度与节奏/情感与意境/工艺水准) */
    originalityAndStyle?: DepthDimensionScore;
    completenessAndRhythm?: DepthDimensionScore;
    emotionAndMood?: DepthDimensionScore;
    craftsmanship?: DepthDimensionScore;
  };
  /** 诊断模式(2026-08-16 起由后端 AnalysisDetail 透传;旧数据缺省 teaching) */
  diagnosisMode?: DiagnosisMode;
  /** 艺考科目(仅 exam 模式) */
  examSubject?: ExamSubject | null;
  // ---- Phase F1 可观测性元信息(可选,由后端 AnalysisDetail 透传) ----
  /** 是否经过 AI 增强 */
  aiEnhanced?: boolean;
  /** 作品有效性校验(AI 识别画面实际内容;mismatch 表示图片非有效作品,如表情包/照片/网图) */
  artworkCheck?: {
    status: 'match' | 'mismatch' | 'uncertain';
    actualType: string;
    reason: string;
    /** 图片来源识别(如"网络表情包""随手拍摄""影视截图""AI生成图");2026-08-16 新增,旧数据无 */
    sourceIdentification?: string;
    /** 作品来历分析:原图可能出处与画面线索;2026-08-16 新增 */
    provenanceAnalysis?: string;
    /** 二创判断:derivative=他人原图上有再创作 / transfer=原样搬运 / uncertain=无法判断 */
    derivativeJudgment?: 'derivative' | 'transfer' | 'uncertain';
    /** 二创判断说明:再创作部分与程度,或搬运依据 */
    derivativeNote?: string;
  };
  /** 是否命中分析缓存 */
  cacheHit?: boolean;
  /** 2026-09-03 Phase 1B:客观画面检测结果(本地分析产出;每条含数值+可操作改法) */
  objectiveChecks?: ObjectiveChecks;
  /** 2026-09-03 Phase 1B:分析来源 local=本地基础检测(非 AI 诊断,前端明示横幅) / server=后端分析 */
  analysisSource?: 'local' | 'server';
  /** Jimp 本地算法耗时(毫秒) */
  jimpDurationMs?: number;
  /** AI 调用耗时(毫秒) */
  aiDurationMs?: number;
  // ---- 评分链路透明化(框架二 P1,2026-08-16) ----
  /** 维度级评分证据链(已接入 rubric 的作品类型才有;如绘画 4 维度) */
  scoreTrace?: DimensionScoreTrace[];
  /** 评分依据汇总(引用规范清单 + 客观指标达标统计) */
  rubricSummary?: RubricSummary;
  // ---- 深度分析扩展(阶段 D,对齐后端 HybridAnalysisResult 透传) ----
  /** 评价阶段(教学/艺考参照系);顶层透传,组件可直接取用 */
  evaluationStage?: EvaluationStage;
  /** 评分标准(各维度权重/等级/符合项/证据) */
  scoreCriteria?: ScoreCriteria[];
  /** 问题标注(Canvas 叠层绘制;x,y,w,h 为 0-1 相对坐标) */
  issueMarkers?: IssueMarker[];
  /** 原创性与风格(深度维度) */
  originalityAndStyle?: DepthDimensionScore;
  /** 完整度与节奏(深度维度) */
  completenessAndRhythm?: DepthDimensionScore;
  /** 情感与意境(深度维度) */
  emotionAndMood?: DepthDimensionScore;
  /** 工艺水准(深度维度) */
  craftsmanship?: DepthDimensionScore;
  /** 非遗类目(仅 artType=heritage 时有效) */
  heritageCategory?: HeritageCategory;
  /** 档位估算(Phase 2 批次④;AI 深度分析产出,按档案 tierMapping 或 AI 自主估算;
   *  诚实性设计:estimated 恒 true,展示必须带"预估…档(±1档)"与"估算值仅供参考") */
  tierEstimate?: {
    tier: string;
    estimated: true;
    note: string;
  };
  /** 反馈模式(Phase 3 批次④;后端 predictFeedbackMode 产物落库透传——
   *  guidance=引导模式(反馈区尾部渲染"跨域启发"灵感嫁接协同区块)/
   *  diagnosis=诊断模式(不渲染);缺失=无档案旧数据,按 diagnosis 语义) */
  feedbackMode?: 'diagnosis' | 'guidance';
}

export interface HistoryRecord {
  id: string;
  imageUrl: string;
  createdAt: string;
  artType: ArtType;
  /** 综合评分(历史记录可无分:基础检测结果为 null,UI 显示"—"。2026-09-04 批次②) */
  overallScore: number | null;
  dimension1Score: number;
  dimension2Score: number;
  dimension3Score: number;
}

export interface GrowthData {
  date: string;
  dimension1: number;
  dimension2: number;
  dimension3: number;
  overall: number;
}

// ============================================
// 分析维度配置（前端展示用）
// ============================================
export const ART_TYPE_CONFIG: Record<ArtType, {
  label: string;
  icon: string;
  dimensions: {
    key: string;
    label: string;
    icon: string;
    color: string;
    description: string;
  }[];
}> = {
  painting: {
    label: '绘画',
    icon: 'Brush',
    dimensions: [
      { key: 'composition', label: '构图', icon: 'Eye', color: '#c41e3a', description: '视觉重心、画面均衡、引导线、留白' },
      { key: 'color', label: '色彩', icon: 'Palette', color: '#2e5fa1', description: '冷暖对比、饱和度、色彩和谐度' },
      { key: 'brushwork', label: '笔触技法', icon: 'PenTool', color: '#d4af37', description: '笔触力度、肌理感、干湿变化' },
    ],
  },
  design: {
    label: '设计',
    icon: 'Layers',
    dimensions: [
      { key: 'visualHierarchy', label: '视觉层次', icon: 'Eye', color: '#c41e3a', description: '信息层级、主次关系、视觉引导' },
      { key: 'typography', label: '排版', icon: 'Type', color: '#2e5fa1', description: '对齐精度、网格运用、节奏感' },
      { key: 'colorApplication', label: '色彩应用', icon: 'Palette', color: '#d4af37', description: '品牌一致性、对比度、色彩心理学' },
    ],
  },
  product: {
    label: '产品设计',
    icon: 'Box',
    dimensions: [
      { key: 'form', label: '形态', icon: 'Box', color: '#c41e3a', description: '比例协调、线条流畅、人机工学' },
      { key: 'materialExpression', label: '材质表现', icon: 'Gem', color: '#2e5fa1', description: '质感还原、光影表现、表面处理' },
      { key: 'functionExpression', label: '功能表达', icon: 'Settings', color: '#d4af37', description: '结构清晰度、功能暗示、细节处理' },
    ],
  },
  sculpture: {
    label: '雕塑',
    icon: 'Box',
    dimensions: [
      { key: 'spatialComposition', label: '空间构成', icon: 'Box', color: '#c41e3a', description: '体积感、空间占有、虚实关系' },
      { key: 'bodyLanguage', label: '形体语言', icon: 'Move', color: '#2e5fa1', description: '动态感、张力、节奏韵律' },
      { key: 'materialLanguage', label: '材料语言', icon: 'Gem', color: '#d4af37', description: '材质特性、肌理表现、质感层次' },
    ],
  },
  heritage: {
    label: '非遗',
    icon: 'Scroll',
    dimensions: [
      { key: 'craftsmanship', label: '工艺技法', icon: 'Hammer', color: '#c41e3a', description: '刀工/针法/釉色等核心工艺水准' },
      { key: 'formPattern', label: '造型纹样', icon: 'Shapes', color: '#2e5fa1', description: '造型规整度与传统纹样传承' },
      { key: 'material', label: '材质表现', icon: 'Gem', color: '#d4af37', description: '材质特性与质感层次表现' },
    ],
  },
};
