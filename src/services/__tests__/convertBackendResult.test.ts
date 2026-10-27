// ============================================================
// convertBackendResult 透传测试 (Task 22.4)
// 对应源码: src/services/smartAnalysisEngine.ts → convertBackendResult
//
// 测试范围:
//   1. 顶层深度字段透传(evaluationStage/scoreCriteria/issueMarkers/4 维度/heritageCategory)
//   2. aiVisionResult 层回退(depth 字段在 aiVisionResult 中时也能提取)
//   3. AnalysisRecord 包装格式(data.result 内嵌)
//   4. 可观测性元信息(aiEnhanced/cacheHit/jimpDurationMs/aiDurationMs)
//   5. 诊断模式透传(diagnosisMode/examSubject)
//   6. 全部深度字段缺省时不崩溃(返回 undefined)
//
// 测试策略:
//   - 直接调用 convertBackendResult(已导出)
//   - 构造 BackendAnalysisData 输入(新版结构化格式)
//   - 断言 AnalysisResult 各深度字段值与输入一致
// ============================================================

import { describe, it, expect } from 'vitest';
import { convertBackendResult } from '../smartAnalysisEngine';
import type {
  ArtType,
  EvaluationStage,
  ScoreCriteria,
  IssueMarker,
  HeritageCategory,
  DiagnosisMode,
  ExamSubject,
  DepthDimensionScore,
  PaintingAnalysis,
} from '../../types';

// ============================================================
// 类型别名(对齐 smartAnalysisEngine 内部 BackendAnalysisData)
// convertBackendResult 接受 BackendAnalysisData(内部接口,此处用结构化对象模拟)
// ============================================================

type BackendData = Parameters<typeof convertBackendResult>[0];

// ============================================================
// 测试数据工厂
// ============================================================

/** 构造完整的 painting dimensions(新版结构化格式) */
function buildPaintingDimensions(): PaintingAnalysis {
  return {
    type: 'painting',
    composition: {
      score: 80, focusPoint: { x: 0.5, y: 0.5 }, balance: 'balanced',
      guideline: 'good', whitespaceRatio: 0.3, symmetry: 0.7,
      suggestion: '构图建议', heatmapData: [],
    },
    color: {
      score: 78, warmRatio: 0.6, coolRatio: 0.4, contrast: 'medium',
      saturation: 'medium', richness: 'moderate', harmony: '互补色',
      dominantColor: '#c41e3a', suggestion: '色彩建议',
    },
    brushwork: {
      score: 82, textureLevel: 'moderate', strokeVariety: 0.5,
      wetDryBalance: '均衡', suggestion: '笔触建议',
    },
  };
}

/** 构造基础 BackendAnalysisData(新版格式,dimensions.type 存在) */
function buildBackendData(overrides: Record<string, unknown> = {}): BackendData {
  return {
    id: 'test-id-001',
    imageUrl: 'https://example.com/work.png',
    createdAt: '2026-08-01T00:00:00.000Z',
    artType: 'painting' as ArtType,
    dimensions: buildPaintingDimensions(),
    overallScore: 80,
    originality: { score: 78, similarity: 0.3, creativityLevel: 'good', suggestion: '原创性建议' },
    ...overrides,
  } as BackendData;
}

function buildScoreCriteria(): ScoreCriteria[] {
  return [
    {
      dimension: '构图与造型', weight: 0.3, maxScore: 100, level: 'good',
      metCriteria: ['重心居中'], unmetCriteria: ['留白不足'], evidence: '重心(0.5,0.5)',
    },
  ];
}

function buildIssueMarkers(): IssueMarker[] {
  return [
    { x: 0.1, y: 0.2, w: 0.3, h: 0.4, label: '构图偏移', severity: 'high', improvementHint: '调整重心' },
  ];
}

function buildDepthScore(score: number): DepthDimensionScore {
  return { score, analysis: `分析${score}`, suggestion: `建议${score}` };
}

// ============================================================
// 测试用例
// ============================================================

describe('convertBackendResult 深度字段透传 (Task 22.4)', () => {
  // ----------------------------------------------------------
  // 1. 顶层深度字段透传
  // ----------------------------------------------------------
  describe('顶层深度字段透传', () => {
    it('should_passthrough_evaluationStage_from_top_level', () => {
      const data = buildBackendData({ evaluationStage: 'master' as EvaluationStage });
      const result = convertBackendResult(data, 'painting');
      expect(result.evaluationStage).toBe('master');
    });

    it('should_passthrough_scoreCriteria_from_top_level', () => {
      const criteria = buildScoreCriteria();
      const data = buildBackendData({ scoreCriteria: criteria });
      const result = convertBackendResult(data, 'painting');
      expect(result.scoreCriteria).toEqual(criteria);
      expect(result.scoreCriteria).toHaveLength(1);
      expect(result.scoreCriteria![0].dimension).toBe('构图与造型');
    });

    it('should_passthrough_issueMarkers_from_top_level', () => {
      const markers = buildIssueMarkers();
      const data = buildBackendData({ issueMarkers: markers });
      const result = convertBackendResult(data, 'painting');
      expect(result.issueMarkers).toEqual(markers);
      expect(result.issueMarkers![0].label).toBe('构图偏移');
    });

    it('should_passthrough_originalityAndStyle_from_top_level', () => {
      const dim = buildDepthScore(82);
      const data = buildBackendData({ originalityAndStyle: dim });
      const result = convertBackendResult(data, 'painting');
      expect(result.originalityAndStyle).toEqual(dim);
      expect(result.originalityAndStyle!.score).toBe(82);
    });

    it('should_passthrough_completenessAndRhythm_from_top_level', () => {
      const dim = buildDepthScore(76);
      const data = buildBackendData({ completenessAndRhythm: dim });
      const result = convertBackendResult(data, 'painting');
      expect(result.completenessAndRhythm).toEqual(dim);
    });

    it('should_passthrough_emotionAndMood_from_top_level', () => {
      const dim = buildDepthScore(70);
      const data = buildBackendData({ emotionAndMood: dim });
      const result = convertBackendResult(data, 'painting');
      expect(result.emotionAndMood).toEqual(dim);
    });

    it('should_passthrough_craftsmanship_from_top_level', () => {
      const dim = buildDepthScore(88);
      const data = buildBackendData({ craftsmanship: dim });
      const result = convertBackendResult(data, 'painting');
      expect(result.craftsmanship).toEqual(dim);
    });

    it('should_passthrough_heritageCategory_from_top_level', () => {
      const data = buildBackendData({ heritageCategory: 'papercut' as HeritageCategory });
      const result = convertBackendResult(data, 'painting');
      expect(result.heritageCategory).toBe('papercut');
    });

    // Phase 2 批次④:档位估算透传
    it('should_passthrough_tierEstimate_from_top_level (批次④)', () => {
      const tierEstimate = { tier: 'C+', estimated: true as const, note: '造型支撑三档上限,±1档' };
      const data = buildBackendData({ tierEstimate });
      const result = convertBackendResult(data, 'painting');
      expect(result.tierEstimate).toEqual(tierEstimate);
    });

    it('should_not_render_tierEstimate_when_absent (批次④ AI 未返回)', () => {
      // AI 未返回 tierEstimate → undefined(AnalysisPage 徽章条件渲染的数据基础)
      const data = buildBackendData();
      const result = convertBackendResult(data, 'painting');
      expect(result.tierEstimate).toBeUndefined();
    });

    it('should_passthrough_all_depth_fields_simultaneously', () => {
      const data = buildBackendData({
        evaluationStage: 'academy' as EvaluationStage,
        scoreCriteria: buildScoreCriteria(),
        issueMarkers: buildIssueMarkers(),
        originalityAndStyle: buildDepthScore(82),
        completenessAndRhythm: buildDepthScore(76),
        emotionAndMood: buildDepthScore(70),
        craftsmanship: buildDepthScore(88),
        heritageCategory: 'embroidery' as HeritageCategory,
      });
      const result = convertBackendResult(data, 'painting');
      expect(result.evaluationStage).toBe('academy');
      expect(result.scoreCriteria).toHaveLength(1);
      expect(result.issueMarkers).toHaveLength(1);
      expect(result.originalityAndStyle!.score).toBe(82);
      expect(result.completenessAndRhythm!.score).toBe(76);
      expect(result.emotionAndMood!.score).toBe(70);
      expect(result.craftsmanship!.score).toBe(88);
      expect(result.heritageCategory).toBe('embroidery');
    });
  });

  // ----------------------------------------------------------
  // 2. aiVisionResult 层回退
  // ----------------------------------------------------------
  describe('aiVisionResult 层回退', () => {
    it('should_fallback_to_aiVisionResult_evaluationStage_when_top_level_absent', () => {
      const data = buildBackendData({
        aiVisionResult: { evaluationStage: 'unified' as EvaluationStage },
      });
      const result = convertBackendResult(data, 'painting');
      expect(result.evaluationStage).toBe('unified');
      // aiVisionResult 也应包含 evaluationStage
      expect(result.aiVisionResult?.evaluationStage).toBe('unified');
    });

    it('should_fallback_to_aiVisionResult_scoreCriteria_when_top_level_absent', () => {
      const criteria = buildScoreCriteria();
      const data = buildBackendData({
        aiVisionResult: { scoreCriteria: criteria },
      });
      const result = convertBackendResult(data, 'painting');
      expect(result.scoreCriteria).toEqual(criteria);
    });

    it('should_fallback_to_aiVisionResult_issueMarkers_when_top_level_absent', () => {
      const markers = buildIssueMarkers();
      const data = buildBackendData({
        aiVisionResult: { issueMarkers: markers },
      });
      const result = convertBackendResult(data, 'painting');
      expect(result.issueMarkers).toEqual(markers);
    });

    it('should_prefer_top_level_over_aiVisionResult_for_evaluationStage', () => {
      // 顶层 evaluationStage='master',aiVisionResult.evaluationStage='unified' → 取顶层
      const data = buildBackendData({
        evaluationStage: 'master' as EvaluationStage,
        aiVisionResult: { evaluationStage: 'unified' as EvaluationStage },
      });
      const result = convertBackendResult(data, 'painting');
      expect(result.evaluationStage).toBe('master');
    });

    it('should_prefer_top_level_over_aiVisionResult_for_depth_dimensions', () => {
      const topLevel = buildDepthScore(82);
      const visionLevel = buildDepthScore(70);
      const data = buildBackendData({
        originalityAndStyle: topLevel,
        aiVisionResult: { originalityAndStyle: visionLevel },
      });
      const result = convertBackendResult(data, 'painting');
      expect(result.originalityAndStyle).toEqual(topLevel);
      expect(result.originalityAndStyle!.score).toBe(82);
    });

    it('should_passthrough_aiVisionResult_depth_fields_to_result_aiVisionResult', () => {
      const dim = buildDepthScore(85);
      const data = buildBackendData({
        aiVisionResult: {
          originalityAndStyle: dim,
          completenessAndRhythm: dim,
        },
      });
      const result = convertBackendResult(data, 'painting');
      // aiVisionResult 对象也应包含深度字段
      expect(result.aiVisionResult?.originalityAndStyle).toEqual(dim);
      expect(result.aiVisionResult?.completenessAndRhythm).toEqual(dim);
    });
  });

  // ----------------------------------------------------------
  // 3. AnalysisRecord 包装格式(data.result 内嵌)
  // ----------------------------------------------------------
  describe('AnalysisRecord 包装格式', () => {
    it('should_extract_depth_fields_from_result_layer', () => {
      // data.result 内嵌实际数据
      const innerData = buildBackendData({
        evaluationStage: 'master' as EvaluationStage,
        scoreCriteria: buildScoreCriteria(),
        issueMarkers: buildIssueMarkers(),
        aiEnhanced: true,
      });
      const wrappedData = {
        id: 'rec-001',
        result: innerData,
      } as BackendData;
      const result = convertBackendResult(wrappedData, 'painting');
      expect(result.evaluationStage).toBe('master');
      expect(result.scoreCriteria).toHaveLength(1);
      expect(result.issueMarkers).toHaveLength(1);
      expect(result.aiEnhanced).toBe(true);
    });

    it('should_extract_tierEstimate_from_result_layer (批次④)', () => {
      // AnalysisRecord 包装:result 层 tierEstimate(HybridAnalysisResult 顶层冗余)
      const tierEstimate = { tier: 'B', estimated: true as const, note: '按档案档位线换算,±1档' };
      const innerData = buildBackendData({ tierEstimate, aiEnhanced: true });
      const wrappedData = {
        id: 'rec-tier-001',
        result: innerData,
      } as BackendData;
      const result = convertBackendResult(wrappedData, 'painting');
      expect(result.tierEstimate).toEqual(tierEstimate);
    });

    it('should_extract_heritageCategory_from_result_layer', () => {
      const innerData = buildBackendData({
        heritageCategory: 'porcelain' as HeritageCategory,
      });
      const wrappedData = { id: 'rec-002', result: innerData } as BackendData;
      const result = convertBackendResult(wrappedData, 'heritage');
      expect(result.heritageCategory).toBe('porcelain');
    });
  });

  // ----------------------------------------------------------
  // 4. 可观测性元信息透传
  // ----------------------------------------------------------
  describe('可观测性元信息透传', () => {
    it('should_passthrough_aiEnhanced_from_top_level', () => {
      const data = buildBackendData({ aiEnhanced: true });
      const result = convertBackendResult(data, 'painting');
      expect(result.aiEnhanced).toBe(true);
    });

    it('should_passthrough_aiEnhanced_from_result_layer', () => {
      const innerData = buildBackendData({ aiEnhanced: true });
      const wrappedData = { id: 'rec-003', result: innerData } as BackendData;
      const result = convertBackendResult(wrappedData, 'painting');
      expect(result.aiEnhanced).toBe(true);
    });

    it('should_passthrough_cacheHit_and_durations', () => {
      const data = buildBackendData({
        cacheHit: true,
        jimpDurationMs: 520,
        aiDurationMs: 1850,
      });
      const result = convertBackendResult(data, 'painting');
      expect(result.cacheHit).toBe(true);
      expect(result.jimpDurationMs).toBe(520);
      expect(result.aiDurationMs).toBe(1850);
    });
  });

  // ----------------------------------------------------------
  // 5. 诊断模式透传
  // ----------------------------------------------------------
  describe('诊断模式透传', () => {
    it('should_passthrough_diagnosisMode_from_top_level', () => {
      const data = buildBackendData({ diagnosisMode: 'exam' as DiagnosisMode });
      const result = convertBackendResult(data, 'painting');
      expect(result.diagnosisMode).toBe('exam');
    });

    it('should_passthrough_examSubject_from_top_level', () => {
      const data = buildBackendData({
        diagnosisMode: 'exam' as DiagnosisMode,
        examSubject: 'sketch' as ExamSubject,
      });
      const result = convertBackendResult(data, 'painting');
      expect(result.examSubject).toBe('sketch');
    });

    it('should_passthrough_diagnosisMode_from_result_layer', () => {
      const innerData = buildBackendData({ diagnosisMode: 'teaching' as DiagnosisMode });
      const wrappedData = { id: 'rec-004', result: innerData } as BackendData;
      const result = convertBackendResult(wrappedData, 'painting');
      expect(result.diagnosisMode).toBe('teaching');
    });
  });

  // ----------------------------------------------------------
  // 6. 全部深度字段缺省时不崩溃
  // ----------------------------------------------------------
  describe('缺省降级', () => {
    it('should_return_undefined_for_all_depth_fields_when_absent', () => {
      const data = buildBackendData();
      const result = convertBackendResult(data, 'painting');
      expect(result.evaluationStage).toBeUndefined();
      expect(result.scoreCriteria).toBeUndefined();
      expect(result.issueMarkers).toBeUndefined();
      expect(result.originalityAndStyle).toBeUndefined();
      expect(result.completenessAndRhythm).toBeUndefined();
      expect(result.emotionAndMood).toBeUndefined();
      expect(result.craftsmanship).toBeUndefined();
      expect(result.heritageCategory).toBeUndefined();
      expect(result.aiEnhanced).toBeUndefined();
    });

    it('should_not_crash_when_aiVisionResult_absent', () => {
      const data = buildBackendData({ aiVisionResult: undefined });
      const result = convertBackendResult(data, 'painting');
      expect(result.aiVisionResult).toBeUndefined();
      expect(result.evaluationStage).toBeUndefined();
    });

    it('should_return_valid_result_with_required_fields_when_only_basic_data', () => {
      const data = buildBackendData();
      const result = convertBackendResult(data, 'painting');
      // 必填字段仍存在
      expect(result.id).toBe('test-id-001');
      expect(result.imageUrl).toBe('https://example.com/work.png');
      expect(result.artType).toBe('painting');
      expect(result.overallScore).toBe(80);
      expect(result.dimensions.type).toBe('painting');
    });
  });
});
