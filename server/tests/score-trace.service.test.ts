// ============================================================
// 评分链路透明化服务 单元测试(框架二 P1)
// 对应源码: src/services/score-trace.service.ts
//
// 测试范围:
//   1. toBand 四档边界(90/75/60)
//   2. buildScoreTracePayload:绘画类四维度 trace 生成
//   3. 阈值判定:>=/between 各一例(达标与不达标)
//   4. dotted 路径解析(composition.symmetry 取自 dimensions)
//   5. 纯语义项:入 rubricRefs(semanticOnly)但无 metricEvidence
//   6. rubricSummary 汇总(去重规范/达标统计)
//   7. 非绘画类返回 null(向后兼容)
//   8. AI 增强:semanticEvidence 映射 + adjustment 关键词匹配
// ============================================================

import { describe, it, expect } from 'vitest';
import { toBand, buildScoreTracePayload } from '../src/services/score-trace.service.js';
import type {
  AnalysisResult,
  PaintingAnalysis,
  DesignAnalysis,
  ProductAnalysis,
  SculptureAnalysis,
} from '../src/types/api-contract.js';
import type {
  JimpMetricsForPrompt,
  AIVisionResult,
} from '../src/types/ai-analysis.js';

// ---------- fixtures ----------

function buildPaintingResult(): AnalysisResult {
  const dimensions: PaintingAnalysis = {
    type: 'painting',
    composition: {
      score: 82,
      focusPoint: { x: 0.62, y: 0.38 },
      balance: 'balanced',
      guideline: 'good',
      whitespaceRatio: 0.5,
      symmetry: 0.82,
      suggestion: '构图建议',
      heatmapData: [[0.1]],
      goldenRatioScore: 72,
      ruleOfThirdsScore: 45,
      leadingLineDirection: 35,
      leadingLineStrength: 0.35,
    },
    color: {
      score: 76,
      warmRatio: 0.55,
      coolRatio: 0.45,
      contrast: 'medium',
      saturation: 'medium',
      richness: 'moderate',
      harmony: 'analogous',
      dominantColor: '暖灰',
      suggestion: '色彩建议',
      harmonyScore: 68,
      harmonyType: 'analogous',
    },
    brushwork: {
      score: 58,
      textureLevel: 'simple',
      strokeVariety: 30,
      wetDryBalance: '均衡',
      suggestion: '笔触建议',
      directionCoherence: 0.5,
      strokeEnergy: 0.4,
      dominantBrushDirection: 45,
    },
  };
  return {
    artType: 'painting',
    dimensions,
    originality: {
      score: 80,
      similarity: 0.2,
      creativityLevel: 'good',
      suggestion: '保持个人面貌',
    },
    overallScore: 73,
  };
}

function buildMetrics(): JimpMetricsForPrompt {
  return {
    focusX: 0.62,
    focusY: 0.38,
    whitespaceRatio: 0.5,
    warmRatio: 0.55,
    coolRatio: 0.45,
    dominantColor: '暖灰',
    avgLuminance: 130,
    avgSaturation: 50,
    contrast: 'medium',
    textureComplexity: 0.2,
    edgeDensity: 0.1,
    goldenRatioScore: 72,
    ruleOfThirdsScore: 45,
    leadingLineDirection: 35,
    leadingLineStrength: 0.35,
    harmonyScore: 68,
    harmonyType: 'analogous',
    directionCoherence: 0.5,
    strokeEnergy: 0.4,
    dominantDirection: 45,
  };
}

/** 设计类结果(P2) */
function buildDesignResult(): AnalysisResult {
  const dimensions: DesignAnalysis = {
    type: 'design',
    visualHierarchy: {
      score: 84,
      focusPoint: { x: 0.38, y: 0.62 },
      primarySecondaryClarity: 'clear',
      informationFlow: 'good',
      heatmapData: [[0.1]],
      suggestion: '层次建议',
      goldenRatioScore: 72,
      ruleOfThirdsScore: 68,
      leadingLineDirection: 35,
      leadingLineStrength: 0.35,
    },
    typography: {
      score: 79,
      alignmentQuality: 'good',
      rhythmConsistency: 'average',
      negativeSpaceUsage: 'good',
      gridAdherence: 0.88,
      suggestion: '排版建议',
      directionCoherence: 0.6,
    },
    colorApplication: {
      score: 74,
      contrast: 'medium',
      brandConsistency: 'moderate',
      colorPsychology: '冷静理性',
      paletteHarmony: 'analogous',
      suggestion: '色彩建议',
    },
  };
  return {
    artType: 'design',
    dimensions,
    originality: {
      score: 80,
      similarity: 0.2,
      creativityLevel: 'good',
      suggestion: '保持个人面貌',
    },
    overallScore: 78,
  };
}

/** 产品设计类结果(P2) */
function buildProductResult(): AnalysisResult {
  const dimensions: ProductAnalysis = {
    type: 'product',
    form: {
      score: 81,
      focusPoint: { x: 0.38, y: 0.5 },
      proportionBalance: 'good',
      lineFluidity: 'smooth',
      surfaceQuality: 'excellent',
      ergonomicsHint: 'strong',
      heatmapData: [[0.1]],
      suggestion: '形态建议',
      goldenRatioScore: 76,
      ruleOfThirdsScore: 70,
      leadingLineDirection: 35,
      leadingLineStrength: 0.35,
      directionCoherence: 0.62,
    },
    materialExpression: {
      score: 73,
      textureRealism: 'high',
      lightShadowPerformance: 'good',
      surfaceTreatment: 'moderate',
      suggestion: '材质建议',
    },
    functionExpression: {
      score: 76,
      structureClarity: 'clear',
      functionImplication: 'moderate',
      detailRefinement: 'good',
      suggestion: '功能建议',
    },
  };
  return {
    artType: 'product',
    dimensions,
    originality: {
      score: 80,
      similarity: 0.2,
      creativityLevel: 'good',
      suggestion: '保持个人面貌',
    },
    overallScore: 77,
  };
}

/** 雕塑类结果(P2) */
function buildSculptureResult(): AnalysisResult {
  const dimensions: SculptureAnalysis = {
    type: 'sculpture',
    spatialComposition: {
      score: 82,
      focusPoint: { x: 0.38, y: 0.38 },
      volumeSense: 'strong',
      spaceOccupation: 'moderate',
      voidSolidRelation: 'harmonious',
      heatmapData: [[0.1]],
      suggestion: '空间建议',
      goldenRatioScore: 74,
      ruleOfThirdsScore: 66,
      leadingLineDirection: 35,
      leadingLineStrength: 0.35,
    },
    bodyLanguage: {
      score: 75,
      dynamicSense: 'moderate',
      tensionExpression: 'medium',
      rhythmFlow: 'moderate',
      suggestion: '形体建议',
      directionCoherence: 0.55,
      strokeEnergy: 0.45,
    },
    materialLanguage: {
      score: 71,
      materialCharacter: 'moderate',
      textureExpression: 'rich',
      qualityLayering: 'moderate',
      suggestion: '材料建议',
    },
  };
  return {
    artType: 'sculpture',
    dimensions,
    originality: {
      score: 80,
      similarity: 0.2,
      creativityLevel: 'good',
      suggestion: '保持个人面貌',
    },
    overallScore: 76,
  };
}

function buildAIVision(): AIVisionResult {
  return {
    visualDescription: '画面整体描述文本',
    composition: '构图分析文本',
    color: '色彩分析文本',
    technique: '技法分析文本',
    semanticTheme: '主题理解',
    styleRecognition: '写实风格',
    professionalSuggestions: [],
    scoreAdjustments: {
      dimensionAdjustments: [
        { dimension: '构图与造型', delta: 3, reason: '结构线清晰,透视关系明确' },
      ],
      overallDelta: 2,
      overallReason: '整体完成度良好',
    },
    referenceArtworks: [],
  };
}

// ---------- tests ----------

describe('score-trace.service toBand', () => {
  it('四档边界:90/75/60', () => {
    expect(toBand(90)).toBe('优');
    expect(toBand(89)).toBe('良');
    expect(toBand(75)).toBe('良');
    expect(toBand(74)).toBe('中');
    expect(toBand(60)).toBe('中');
    expect(toBand(59)).toBe('差');
  });
});

describe('score-trace.service buildScoreTracePayload', () => {
  it('绘画类生成四维度 trace,分数与档位正确', () => {
    const payload = buildScoreTracePayload(buildPaintingResult(), buildMetrics());
    expect(payload).not.toBeNull();

    const keys = payload!.scoreTrace.map((t) => t.dimensionKey);
    expect(keys).toEqual(['composition', 'color', 'brushwork', 'overall']);

    const comp = payload!.scoreTrace[0];
    expect(comp.dimensionLabel).toBe('构图与造型');
    expect(comp.score).toBe(82);
    expect(comp.band).toBe('良');

    const whole = payload!.scoreTrace[3];
    expect(whole.dimensionLabel).toBe('整体与完整');
    expect(whole.score).toBe(73); // overall 维度取综合评分
  });

  it('阈值判定:达标与不达标(黄金分割 pass / 留白 fail)', () => {
    const payload = buildScoreTracePayload(buildPaintingResult(), buildMetrics())!;
    const comp = payload.scoreTrace[0];

    const golden = comp.metricEvidence.find((e) => e.rubricId === 'PAINT-COMP-GOLDEN');
    expect(golden?.passed).toBe(true);
    expect(golden?.displayValue).toBe('72 / 100');

    const whitespace = comp.metricEvidence.find((e) => e.rubricId === 'PAINT-COMP-WHITESPACE');
    expect(whitespace?.passed).toBe(false);
    expect(whitespace?.displayValue).toBe('50%');
  });

  it('dotted 路径:画面对称度取自 dimensions.composition.symmetry', () => {
    const payload = buildScoreTracePayload(buildPaintingResult(), buildMetrics())!;
    const balance = payload.scoreTrace[0].metricEvidence.find(
      (e) => e.rubricId === 'PAINT-COMP-BALANCE',
    );
    expect(balance?.displayValue).toBe('82%');
    expect(balance?.passed).toBe(true);
  });

  it('纯语义项:进入 rubricRefs 且标注 semanticOnly,不产生 metricEvidence', () => {
    const payload = buildScoreTracePayload(buildPaintingResult(), buildMetrics())!;
    const comp = payload.scoreTrace[0];

    const persp = comp.rubricRefs.find((r) => r.rubricId === 'PAINT-COMP-PERSP');
    expect(persp?.semanticOnly).toBe(true);
    expect(persp?.source).toContain('中央美术学院');
    expect(persp?.bandDescription).toBe('透视基本正确偶有局部小瑕疵'); // 良档描述

    // composition 维度:5 客观条目 → metricEvidence 恰好 5 条(语义项不产生)
    expect(comp.metricEvidence).toHaveLength(5);
  });

  it('rubricSummary 汇总:13 客观指标 + 5 语义项 + 规范去重', () => {
    const payload = buildScoreTracePayload(buildPaintingResult(), buildMetrics())!;
    const summary = payload.rubricSummary;

    expect(summary.totalCriteria).toBe(13);
    expect(summary.semanticOnlyCount).toBe(5);
    // fixture 中不达标:三分法(45<60) + 留白(50%>40%) + 纹理(0.20<0.25) = 3 项
    expect(summary.passedCriteria).toBe(10);
    // 规范去重(央美/国美/清华参照)
    expect(summary.standardNames.length).toBeGreaterThanOrEqual(2);
    expect(summary.standardNames.length).toBeLessThanOrEqual(3);
  });

  it('artType 与 dimensions.type 不一致时返回 null(数据异常防御)', () => {
    const mismatched = {
      ...buildPaintingResult(),
      artType: 'design' as const,
    };
    // dimensions.type 仍为 painting,与 artType 不一致 → 维度分数提取失败 → null
    const payload = buildScoreTracePayload(mismatched, buildMetrics());
    expect(payload).toBeNull();
  });

  // ---------- P2:三类新增作品类型 ----------

  it('设计类:生成四维度 trace,dotted 指标(网格遵循度)解析正确', () => {
    const payload = buildScoreTracePayload(buildDesignResult(), buildMetrics())!;
    const keys = payload.scoreTrace.map((t) => t.dimensionKey);
    expect(keys).toEqual(['visualHierarchy', 'typography', 'colorApplication', 'overall']);

    const typo = payload.scoreTrace[1];
    expect(typo.dimensionLabel).toBe('排版与构成');

    const grid = typo.metricEvidence.find((e) => e.rubricId === 'DESIGN-TYPO-GRID');
    expect(grid?.displayValue).toBe('88%');
    expect(grid?.passed).toBe(true); // 0.88 >= 0.85

    const hier = payload.scoreTrace[0];
    expect(hier.dimensionLabel).toBe('视觉层次');
    expect(hier.score).toBe(84);
  });

  it('产品设计类:生成四维度 trace,曲面流畅度(form.directionCoherence)解析正确', () => {
    const payload = buildScoreTracePayload(buildProductResult(), buildMetrics())!;
    const keys = payload.scoreTrace.map((t) => t.dimensionKey);
    expect(keys).toEqual(['form', 'materialExpression', 'functionExpression', 'overall']);

    const form = payload.scoreTrace[0];
    expect(form.dimensionLabel).toBe('形态语义');

    const line = form.metricEvidence.find((e) => e.rubricId === 'PROD-FORM-LINE');
    expect(line?.displayValue).toBe('62%');
    expect(line?.passed).toBe(true); // 0.62 >= 0.50
  });

  it('雕塑类:生成四维度 trace,形体张力能量(bodyLanguage.strokeEnergy)解析正确', () => {
    const payload = buildScoreTracePayload(buildSculptureResult(), buildMetrics())!;
    const keys = payload.scoreTrace.map((t) => t.dimensionKey);
    expect(keys).toEqual(['spatialComposition', 'bodyLanguage', 'materialLanguage', 'overall']);

    const body = payload.scoreTrace[1];
    expect(body.dimensionLabel).toBe('形体语言');

    const energy = body.metricEvidence.find((e) => e.rubricId === 'SCULP-BODY-ENERGY');
    expect(energy?.displayValue).toBe('45%');
    expect(energy?.passed).toBe(true); // 0.45 >= 0.30

    // 正负空间:whitespaceRatio 0.5 ∈ [0.35,0.60] → 达标
    const voidEvidence = payload.scoreTrace[0].metricEvidence.find(
      (e) => e.rubricId === 'SCULP-SP-VOID',
    );
    expect(voidEvidence?.passed).toBe(true);
  });

  it('设计类 AI 校准:维度关键词匹配(排版/网格 → typography)', () => {
    const aiVision: AIVisionResult = {
      ...buildAIVision(),
      scoreAdjustments: {
        dimensionAdjustments: [
          { dimension: '排版与构成', delta: -2, reason: '网格遵循不足' },
        ],
        overallDelta: 0,
        overallReason: '',
      },
    };
    const payload = buildScoreTracePayload(buildDesignResult(), buildMetrics(), aiVision)!;
    expect(payload.scoreTrace[1].adjustment).toEqual({
      delta: -2,
      reason: '网格遵循不足',
    });
  });

  it('AI 增强:补充语义证据与校准记录', () => {
    const payload = buildScoreTracePayload(
      buildPaintingResult(),
      buildMetrics(),
      buildAIVision(),
    )!;

    // 语义证据字段映射
    expect(payload.scoreTrace[0].semanticEvidence).toBe('构图分析文本');
    expect(payload.scoreTrace[1].semanticEvidence).toBe('色彩分析文本');
    expect(payload.scoreTrace[2].semanticEvidence).toBe('技法分析文本');
    expect(payload.scoreTrace[3].semanticEvidence).toBe('画面整体描述文本');

    // 校准记录:composition 匹配"构图/造型"关键词;overall 取 overallDelta
    expect(payload.scoreTrace[0].adjustment).toEqual({
      delta: 3,
      reason: '结构线清晰,透视关系明确',
    });
    expect(payload.scoreTrace[3].adjustment).toEqual({
      delta: 2,
      reason: '整体完成度良好',
    });
    // color/brushwork 无匹配调整 → 无 adjustment 字段
    expect(payload.scoreTrace[1].adjustment).toBeUndefined();
    expect(payload.scoreTrace[2].adjustment).toBeUndefined();
  });

  it('同一输入产出一致结果(确定性,可复现)', () => {
    const a = buildScoreTracePayload(buildPaintingResult(), buildMetrics());
    const b = buildScoreTracePayload(buildPaintingResult(), buildMetrics());
    expect(a).toEqual(b);
  });
});
