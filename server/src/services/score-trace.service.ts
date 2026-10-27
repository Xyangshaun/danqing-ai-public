// ============================================================
// 评分链路透明化服务(框架二核心)
//
// 职责:
//   将 Jimp 客观指标与 Rubric Registry 阈值比对,生成每个维度的
//   评分证据链(scoreTrace)+ 汇总(rubricSummary),让每个分数
//   可追溯到「规范条目 + 客观数值 + AI 判断 + 校准记录」。
//
// 特性:
//   1. 纯本地确定性计算(无 IO/无 AI 调用,耗时 <1ms,不影响 3s SLA)
//   2. 同一输入永远产出同一证据(可复现,破"黑盒"质疑)
//   3. AI 增强后重建:刷新调整后分数 + 补充语义证据与校准记录
//   4. 未接入 rubric 的作品类型返回 null,调用方跳过(向后兼容)
//
// 数据来源:
//   rubric:.trae/documents/art-evaluation-standards.md 数据化(config/rubrics/)
//   metrics:extractJimpMetricsFromResult(Jimp 像素分析产物)
// ============================================================

import type {
  AnalysisResult,
  DimensionScoreTrace,
  MetricEvidenceItem,
  RubricSummary,
  ScoreBand,
} from '../types/api-contract.js';
import type { AIVisionResult, JimpMetricsForPrompt } from '../types/ai-analysis.js';
import { getRubrics, type RubricCriterion, type RubricThreshold } from '../config/rubrics/index.js';

// ============================================================
// 1. 档位判定与格式化
// ============================================================

/** 四档判定(与标准文档四档评分描述表一致:优90+/良75+/中60+/差<60) */
export function toBand(score: number): ScoreBand {
  if (score >= 90) return '优';
  if (score >= 75) return '良';
  if (score >= 60) return '中';
  return '差';
}

/** 按指标键推断展示格式 */
function formatValue(metricKey: string, value: number): string {
  if (metricKey.endsWith('Score')) return `${Math.round(value)} / 100`;
  if (/Ratio$|symmetry|Strength$|Coherence$|Complexity$|Energy$|Density$|pHashSimilarity|gridAdherence$/.test(metricKey)) {
    return `${Math.round(value * 100)}%`;
  }
  if (metricKey.endsWith('Direction')) return `${Math.round(value)}°`;
  return `${Math.round(value * 10) / 10}`;
}

/** 指标中文名(与标准子指标对应) */
const METRIC_LABELS: Record<string, string> = {
  goldenRatioScore: '黄金分割评分',
  ruleOfThirdsScore: '三分法评分',
  'composition.symmetry': '画面对称度',
  whitespaceRatio: '留白占比',
  leadingLineStrength: '引导线强度',
  harmonyScore: '色彩和谐度',
  warmRatio: '暖色占比',
  avgSaturation: '平均饱和度',
  avgLuminance: '平均亮度',
  textureComplexity: '纹理复杂度',
  strokeEnergy: '笔触能量',
  directionCoherence: '方向一致性',
  edgeDensity: '边缘密度',
  // 设计类
  'typography.gridAdherence': '网格遵循度',
  'typography.directionCoherence': '对齐一致性',
  // 产品设计类
  'form.directionCoherence': '曲面流畅度',
  // 雕塑类
  'bodyLanguage.directionCoherence': '形体组织一致性',
  'bodyLanguage.strokeEnergy': '形体张力能量',
};

// ============================================================
// 2. 指标解析与阈值判定
// ============================================================

/**
 * 解析指标值:优先取 JimpMetricsForPrompt flat 键,
 * 失败则按 dotted 路径(如 'composition.symmetry')取自 dimensions
 */
function resolveMetric(
  metricKey: string,
  metrics: JimpMetricsForPrompt,
  dimensions: AnalysisResult['dimensions'],
): number | undefined {
  const flat = (metrics as unknown as Record<string, unknown>)[metricKey];
  if (typeof flat === 'number' && Number.isFinite(flat)) return flat;

  if (metricKey.includes('.')) {
    const [dim, field] = metricKey.split('.');
    if (dim && field) {
      const dimObj = (dimensions as unknown as Record<string, Record<string, unknown>>)[dim];
      const val = dimObj?.[field];
      if (typeof val === 'number' && Number.isFinite(val)) return val;
    }
  }
  return undefined;
}

/** 单条阈值判定(缺失指标视为不达标并在证据中标注) */
function evaluateThreshold(
  t: RubricThreshold,
  metrics: JimpMetricsForPrompt,
  dimensions: AnalysisResult['dimensions'],
): { item: MetricEvidenceItem; passed: boolean } {
  const label = METRIC_LABELS[t.metricKey] ?? t.metricKey;
  const value = resolveMetric(t.metricKey, metrics, dimensions);

  // 指标缺失(如旧数据/降级路径)→ 无法判定,诚实标注
  if (value === undefined) {
    return {
      item: {
        rubricId: '',
        label,
        displayValue: '数据缺失',
        thresholdLabel: t.label,
        passed: false,
      },
      passed: false,
    };
  }

  let passed = false;
  switch (t.op) {
    case '>=':
      passed = value >= (t.value as number);
      break;
    case '<=':
      passed = value <= (t.value as number);
      break;
    case 'between':
      passed = value >= (t.value as [number, number])[0] && value <= (t.value as [number, number])[1];
      break;
    case 'approx':
      passed = Math.abs(value - (t.value as [number, number])[0]) <= (t.value as [number, number])[1];
      break;
  }

  return {
    item: {
      rubricId: '',
      label,
      displayValue: formatValue(t.metricKey, value),
      thresholdLabel: t.label,
      passed,
    },
    passed,
  };
}

// ============================================================
// 3. 维度分数提取(四类作品)
// ============================================================

/** 维度分数条目(score 为 null 时无条目——本地引擎停分后维度无评分,证据链条件包含。批次③ 2026-09-05) */
function dimEntry(key: string, score: number | null): Array<{ key: string; score: number }> {
  return score != null ? [{ key, score }] : [];
}

/** 绘画类四维度分数(第4维"整体与完整"由综合评分体现) */
function getPaintingDimensionScores(result: AnalysisResult): Array<{ key: string; score: number }> {
  if (result.dimensions.type !== 'painting') return [];
  return [
    ...dimEntry('composition', result.dimensions.composition.score),
    ...dimEntry('color', result.dimensions.color.score),
    ...dimEntry('brushwork', result.dimensions.brushwork.score),
    // 批次②:无评分(基础检测)时不输出 overall 维度条目,下游 find+continue 优雅跳过
    ...dimEntry('overall', result.overallScore),
  ];
}

/** 设计类四维度分数(第4维"整体与创意表达"由综合评分体现) */
function getDesignDimensionScores(result: AnalysisResult): Array<{ key: string; score: number }> {
  if (result.dimensions.type !== 'design') return [];
  return [
    ...dimEntry('visualHierarchy', result.dimensions.visualHierarchy.score),
    ...dimEntry('typography', result.dimensions.typography.score),
    ...dimEntry('colorApplication', result.dimensions.colorApplication.score),
    ...dimEntry('overall', result.overallScore),
  ];
}

/** 产品设计类四维度分数(第4维"整体与人机工程"由综合评分体现) */
function getProductDimensionScores(result: AnalysisResult): Array<{ key: string; score: number }> {
  if (result.dimensions.type !== 'product') return [];
  return [
    ...dimEntry('form', result.dimensions.form.score),
    ...dimEntry('materialExpression', result.dimensions.materialExpression.score),
    ...dimEntry('functionExpression', result.dimensions.functionExpression.score),
    ...dimEntry('overall', result.overallScore),
  ];
}

/** 雕塑类四维度分数(第4维"整体与观念表达"由综合评分体现) */
function getSculptureDimensionScores(result: AnalysisResult): Array<{ key: string; score: number }> {
  if (result.dimensions.type !== 'sculpture') return [];
  return [
    ...dimEntry('spatialComposition', result.dimensions.spatialComposition.score),
    ...dimEntry('bodyLanguage', result.dimensions.bodyLanguage.score),
    ...dimEntry('materialLanguage', result.dimensions.materialLanguage.score),
    ...dimEntry('overall', result.overallScore),
  ];
}

/** 各类型维度键顺序(与标准文档权重表维度顺序一致) */
const DIMENSION_ORDERS: Record<string, string[]> = {
  painting: ['composition', 'color', 'brushwork', 'overall'],
  design: ['visualHierarchy', 'typography', 'colorApplication', 'overall'],
  product: ['form', 'materialExpression', 'functionExpression', 'overall'],
  sculpture: ['spatialComposition', 'bodyLanguage', 'materialLanguage', 'overall'],
};

/** AI 语义证据字段映射(维度 → AIVisionResult 对应分析文本) */
function getSemanticEvidence(
  dimensionKey: string,
  aiVision: AIVisionResult,
): string | undefined {
  switch (dimensionKey) {
    // 绘画类
    case 'composition':
      return aiVision.composition;
    case 'color':
    case 'colorApplication': // 设计类"色彩应用"复用色彩分析
      return aiVision.color;
    case 'brushwork':
      return aiVision.technique;
    case 'overall':
      return aiVision.visualDescription;
    // 设计类
    case 'visualHierarchy':
      return aiVision.composition; // 视觉层次复用构图/构成分析
    case 'typography':
      return aiVision.technique; // 排版构成复用技法分析
    // 产品设计类
    case 'form':
      return aiVision.composition; // 形态复用构成分析
    case 'materialExpression':
    // 雕塑类
    case 'materialLanguage':
      return aiVision.technique; // 材质/材料复用技法分析
    case 'functionExpression':
      return aiVision.visualDescription; // 功能表达复用整体描述
    // 雕塑类
    case 'spatialComposition':
      return aiVision.composition; // 空间构成复用构图分析
    case 'bodyLanguage':
      return aiVision.technique; // 形体语言复用技法分析
    default:
      return undefined;
  }
}

/** AI 校准记录映射(按维度关键词匹配 dimensionAdjustments) */
function getAdjustment(
  dimensionKey: string,
  aiVision: AIVisionResult,
): { delta: number; reason: string } | undefined {
  const { dimensionAdjustments, overallDelta, overallReason } = aiVision.scoreAdjustments;
  if (dimensionKey === 'overall') {
    if (overallDelta === 0) return undefined;
    return { delta: overallDelta, reason: overallReason };
  }
  const keywordMap: Record<string, string[]> = {
    // 绘画类
    composition: ['构图', 'composition', '造型'],
    color: ['色彩', 'color', '颜色'],
    brushwork: ['笔触', 'brushwork', '技法', '笔法'],
    // 设计类
    visualHierarchy: ['视觉层次', '层次', 'hierarchy', '视觉焦点', '构图', 'composition'],
    typography: ['排版', '网格', 'typography', '对齐', '构成'],
    colorApplication: ['色彩', 'color', '颜色', '配色'],
    // 产品设计类
    form: ['形态', 'form', '曲面', '造型', '比例'],
    materialExpression: ['材质', 'material', '质感', '材料', 'cmf'],
    functionExpression: ['功能', 'function', '结构', '交互'],
    // 雕塑类
    spatialComposition: ['空间', 'spatial', '体量', '构图', 'composition'],
    bodyLanguage: ['形体', 'body', '动态', '造型', '轮廓'],
    materialLanguage: ['材料', '材质', '肌理', 'material', '工艺'],
  };
  const keywords = keywordMap[dimensionKey];
  if (!keywords) return undefined;
  const matched = dimensionAdjustments.filter((a) =>
    keywords.some((kw) => a.dimension.toLowerCase().includes(kw.toLowerCase())),
  );
  if (matched.length === 0) return undefined;
  const delta = Math.max(-5, Math.min(5, matched.reduce((s, a) => s + a.delta, 0)));
  if (delta === 0) return undefined;
  return { delta, reason: matched.map((a) => a.reason).join(';') };
}

// ============================================================
// 4. 主入口
// ============================================================

/**
 * 构建评分证据链
 *
 * @param result 分析结果(阶段1:Jimp 原始;阶段2:AI 校准后的 merged)
 * @param metrics Jimp 客观指标
 * @param aiVision AI 视觉结果(阶段2传入:补充语义证据与校准记录)
 * @returns scoreTrace + rubricSummary;未接入 rubric 的类型返回 null
 */
export function buildScoreTracePayload(
  result: AnalysisResult,
  metrics: JimpMetricsForPrompt,
  aiVision?: AIVisionResult,
): { scoreTrace: DimensionScoreTrace[]; rubricSummary: RubricSummary } | null {
  const rubrics = getRubrics(result.artType);
  if (rubrics.length === 0) return null;

  // 按作品类型分发维度分数提取(P2 起四类全覆盖)
  const dims = result.dimensions;
  // 数据异常防御:artType 与 dimensions.type 不一致时跳过透明化,
  // 避免 rubric(按 artType)与维度分数(按 dimensions.type)混用产生错误证据链
  if (dims.type !== result.artType) return null;
  const dimensionScores =
    dims.type === 'painting'
      ? getPaintingDimensionScores(result)
      : dims.type === 'design'
        ? getDesignDimensionScores(result)
        : dims.type === 'product'
          ? getProductDimensionScores(result)
          : getSculptureDimensionScores(result);
  if (dimensionScores.length === 0) return null;

  // 按维度键分组 rubric(保持标准文档维度顺序)
  const dimensionOrder = DIMENSION_ORDERS[result.artType] ?? [];
  const scoreTrace: DimensionScoreTrace[] = [];
  let totalCriteria = 0;
  let passedCriteria = 0;
  let semanticOnlyCount = 0;
  const standardSet = new Set<string>();

  for (const dimKey of dimensionOrder) {
    const dimRubrics = rubrics.filter((r) => r.dimensionKey === dimKey);
    if (dimRubrics.length === 0) continue;

    const dimScore = dimensionScores.find((d) => d.key === dimKey);
    if (!dimScore) continue;

    const band = toBand(dimScore.score);

    // rubric 引用(四档描述按当前档位取)
    const rubricRefs = dimRubrics.map((r: RubricCriterion) => {
      standardSet.add(r.source);
      if (r.semanticOnly) semanticOnlyCount += 1;
      return {
        rubricId: r.rubricId,
        subIndicator: r.subIndicator,
        bandDescription: r.bandDescriptions[band],
        referenceExample: r.referenceExample,
        source: r.source,
        semanticOnly: r.semanticOnly,
      };
    });

    // 客观度量证据
    const metricEvidence: MetricEvidenceItem[] = [];
    let passedCount = 0;
    let totalCount = 0;
    for (const r of dimRubrics) {
      for (const t of r.thresholds) {
        const { item, passed } = evaluateThreshold(t, metrics, result.dimensions);
        metricEvidence.push({ ...item, rubricId: r.rubricId });
        totalCount += 1;
        if (passed) passedCount += 1;
      }
    }
    totalCriteria += totalCount;
    passedCriteria += passedCount;

    const trace: DimensionScoreTrace = {
      dimensionKey: dimKey,
      dimensionLabel: dimRubrics[0]?.dimensionLabel ?? dimKey,
      score: dimScore.score,
      band,
      rubricRefs,
      metricEvidence,
      passedCount,
      totalCount,
    };

    // AI 增强:补充语义证据与校准记录
    if (aiVision) {
      const semantic = getSemanticEvidence(dimKey, aiVision);
      if (semantic) trace.semanticEvidence = semantic;
      const adjustment = getAdjustment(dimKey, aiVision);
      if (adjustment) trace.adjustment = adjustment;
    }

    scoreTrace.push(trace);
  }

  return {
    scoreTrace,
    rubricSummary: {
      standardNames: [...standardSet],
      totalCriteria,
      passedCriteria,
      semanticOnlyCount,
    },
  };
}
