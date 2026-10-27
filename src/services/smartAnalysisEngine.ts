import type { AnalysisResult, ArtType, DimensionResult, ProfessionalSuggestion, PaintingAnalysis, DesignAnalysis, ProductAnalysis, SculptureAnalysis, DiagnosisMode, ExamSubject, ExamResult, EvaluationStage, ScoreCriteria, IssueMarker, HeritageCategory, DepthDimensionScore, ObjectiveChecks } from '../types';
import { analyzeImage, getBackendUrl } from './analysisService';
import { request } from './api';

/* ============================================================
 * 后端分析响应类型定义
 *
 * convertBackendResult 需兼容多种后端格式:
 *   - AnalysisRecord 包装格式(data.result 包含实际分析数据)
 *   - 新版结构化格式(data.dimensions.type 存在)
 *   - 旧版平铺格式(data.composition / data.color 直接平铺)
 * 以下接口用可选字段 + 局部类型叠加覆盖所有访问路径,
 * 替代原先的 `any`,在保留运行时行为的同时获得类型安全。
 * ============================================================ */

/** painting 类型 brushwork 可能携带的聚合字段及其来源字段 */
interface BackendBrushwork {
  structureTensor?: { coherence: number; energy: number; dominantDirection: number };
  directionCoherence?: number;
  strokeEnergy?: number;
  dominantBrushDirection?: number;
}

/** 后端 dimensions:在前端联合类型基础上叠加 brushwork 可选扩展 */
type BackendDimensions = DimensionResult & { brushwork?: BackendBrushwork };

/** 旧版平铺构图字段 */
interface BackendLegacyComposition {
  score?: number;
  focusPoint?: { x: number; y: number };
  balance?: string;
  guideline?: string;
  whitespaceRatio?: number;
  symmetry?: number;
  suggestion?: string;
  heatmapData?: number[][];
}

/** 旧版平铺色彩字段 */
interface BackendLegacyColor {
  score?: number;
  warmRatio?: number;
  coolRatio?: number;
  contrast?: string;
  saturation?: string;
  richness?: string;
  harmony?: string;
  dominantColor?: string;
  suggestion?: string;
}

/**
 * 后端分析响应(递归,兼容 AnalysisRecord 包装与平铺旧版格式)。
 * 所有字段可选,因不同版本后端返回结构差异较大。
 */
interface BackendAnalysisData {
  id?: string;
  result?: BackendAnalysisData;
  dimensions?: BackendDimensions;
  /* 批次⑤:后端基础检测不产分时显式发 null */
  overallScore?: number | null;
  imageUrl?: string;
  createdAt?: string;
  artType?: ArtType;
  workType?: ArtType;
  originality?: Partial<AnalysisResult['originality']>;
  professionalSuggestions?: ProfessionalSuggestion[];
  artworkCheck?: AnalysisResult['artworkCheck'];
  aiVisionResult?: {
    professionalSuggestions?: ProfessionalSuggestion[];
    artworkCheck?: AnalysisResult['artworkCheck'];
    visualDescription?: string;
    composition?: string;
    color?: string;
    technique?: string;
    semanticTheme?: string;
    styleRecognition?: string;
    examResult?: ExamResult;
    // ---- 深度分析扩展(阶段 D,对齐后端 AIVisionResult) ----
    evaluationStage?: EvaluationStage;
    scoreCriteria?: ScoreCriteria[];
    issueMarkers?: IssueMarker[];
    originalityAndStyle?: DepthDimensionScore;
    completenessAndRhythm?: DepthDimensionScore;
    emotionAndMood?: DepthDimensionScore;
    craftsmanship?: DepthDimensionScore;
  };
  /** 诊断模式(AnalysisDetail 顶层透传) */
  diagnosisMode?: DiagnosisMode;
  /** 艺考科目(AnalysisDetail 顶层透传,仅 exam 模式) */
  examSubject?: ExamSubject | null;
  aiEnhanced?: boolean;
  cacheHit?: boolean;
  jimpDurationMs?: number;
  aiDurationMs?: number;
  composition?: BackendLegacyComposition;
  color?: BackendLegacyColor;
  // ---- 深度分析扩展(阶段 D,对齐后端 HybridAnalysisResult 顶层透传) ----
  /** 评价阶段(可能在顶层或 aiVisionResult 中) */
  evaluationStage?: EvaluationStage;
  /** 评分标准(各维度权重/等级/符合项/证据) */
  scoreCriteria?: ScoreCriteria[];
  /** 问题标注(Canvas 叠层绘制) */
  issueMarkers?: IssueMarker[];
  /** 4 深度维度评分 */
  originalityAndStyle?: DepthDimensionScore;
  completenessAndRhythm?: DepthDimensionScore;
  emotionAndMood?: DepthDimensionScore;
  craftsmanship?: DepthDimensionScore;
  /** 非遗类目(仅 artType=heritage) */
  heritageCategory?: HeritageCategory;
  /** 客观画面检测(Phase 1B:后端 Jimp 引擎确定性测量,阶段1即返回) */
  objectiveChecks?: ObjectiveChecks;
  /** 档位估算(Phase 2 批次④;AI 深度分析产出,可能在 result 层或顶层) */
  tierEstimate?: AnalysisResult['tierEstimate'];
}

/**
 * 图片复杂度评估接口
 */
interface ImageComplexity {
  level: 'simple' | 'normal' | 'complex';
  score: number;
  factors: {
    fileSizeMB: number;
    pixelCount: number;
    estimatedColors: number;
    estimatedElements: number;
  };
}

/**
 * 分析模式决策接口
 */
interface AnalysisDecision {
  mode: 'client' | 'server';
  reason: string;
  estimatedTime: number;
  complexity: ImageComplexity;
}

/**
 * 评估图片复杂度
 * 基于文件大小、像素数量、预估色彩丰富度等
 */
function assessComplexity(file: File | null, imageUrl: string): ImageComplexity {
  const fileSizeMB = file ? file.size / (1024 * 1024) : 0;
  
  let pixelCount = 0;
  try {
    const img = new Image();
    img.src = imageUrl;
    pixelCount = img.width * img.height;
  } catch {
    pixelCount = 0;
  }
  
  const estimatedColors = Math.min(256, Math.max(16, Math.floor(pixelCount / 5000)));
  const estimatedElements = Math.min(50, Math.max(3, Math.floor(pixelCount / 20000)));
  
  let complexityScore = 0;
  
  complexityScore += Math.min(30, fileSizeMB * 6);
  
  const mp = pixelCount / 1000000;
  complexityScore += Math.min(25, mp * 8);
  
  complexityScore += Math.min(20, estimatedColors / 12);
  
  complexityScore += Math.min(15, estimatedElements / 3);
  
  if (fileSizeMB > 5) complexityScore += 10;
  if (pixelCount > 4000000) complexityScore += 10;
  
  let level: ImageComplexity['level'];
  if (complexityScore < 40) {
    level = 'simple';
  } else if (complexityScore < 75) {
    level = 'normal';
  } else {
    level = 'complex';
  }
  
  return {
    level,
    score: Math.round(complexityScore),
    factors: {
      fileSizeMB: Math.round(fileSizeMB * 100) / 100,
      pixelCount,
      estimatedColors,
      estimatedElements,
    },
  };
}

/**
 * 智能分析决策引擎
 * 根据图片复杂度、艺术类型、网络状态等自动选择分析模式
 */
export function decideAnalysisMode(
  file: File | null,
  imageUrl: string,
  artType: ArtType,
  serverAvailable: boolean = true
): AnalysisDecision {
  const complexity = assessComplexity(file, imageUrl);
  
  let mode: 'client' | 'server';
  let reason: string;
  let estimatedTime: number;
  
  const artTypeWeight: Record<ArtType, number> = {
    painting: 1.0,
    design: 1.2,
    product: 1.3,
    sculpture: 1.4,
    heritage: 1.3,
  };
  
  const weightedScore = complexity.score * artTypeWeight[artType];
  
  if (!serverAvailable) {
    mode = 'client';
    reason = '后端服务不可用，自动切换为本地分析';
    estimatedTime = weightedScore > 60 ? 5 : 3;
  } else if (complexity.level === 'simple') {
    mode = 'client';
    reason = `作品复杂度较低(${complexity.score}分)，本地快速分析即可满足需求`;
    estimatedTime = 2;
  } else if (complexity.level === 'normal') {
    if (artType === 'painting' || artType === 'design') {
      mode = 'client';
      reason = `作品复杂度适中(${complexity.score}分)，${artType === 'painting' ? '绘画' : '设计'}类作品本地分析效果良好`;
      estimatedTime = 3;
    } else {
      mode = 'server';
      reason = `作品复杂度适中(${complexity.score}分)，${artType === 'product' ? '产品' : '雕塑'}类作品需要更精确的后端分析`;
      estimatedTime = 4;
    }
  } else {
    mode = 'server';
    reason = `作品复杂度高(${complexity.score}分)，包含大量细节元素，启用后端深度学习分析以获得更精准结果`;
    estimatedTime = 5;
  }
  
  if (file && file.size > 8 * 1024 * 1024 && mode === 'client') {
    mode = 'server';
    reason = `文件较大(${(file.size / (1024 * 1024)).toFixed(1)}MB)，后端处理更高效`;
    estimatedTime = 5;
  }
  
  return {
    mode,
    reason,
    estimatedTime,
    complexity,
  };
}

/**
 * 检查后端服务是否可用（v3.0.0：GET /health → {code, message, data: {status, ...}, traceId}）
 *
 * 2026-08-16 稳定性修复:超时 2s→4s + 失败重试一次,减少偶发慢响应导致的
 * 「server 不可用 → 强制 client 模式 → 落库成败决定 AI 深度分析按钮」的模式漂移。
 */
export async function checkServerHealth(): Promise<boolean> {
  const probe = async (): Promise<boolean> => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    try {
      const response = await fetch(`${getBackendUrl()}/health`, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      if (!response.ok) return false;
      const data = await response.json();
      return data.code === 0 && data.data?.status === 'up';
    } catch {
      clearTimeout(timeoutId);
      return false;
    }
  };

  if (await probe()) return true;
  // 首次失败(超时/网络抖动)重试一次
  return probe();
}

/**
 * 将后端返回的分析结果转换为前端AnalysisResult格式
 * 支持多种后端格式:
 *   - 最新版(API v1): data 为 AnalysisRecord { id, status, result: HybridAnalysisResult },实际数据在 data.result 中
 *   - 新版(Phase B+): data.dimensions 为结构化对象,可能包含 professionalSuggestions/aiVisionResult
 *   - 旧版(Legacy): data.composition/data.color 平铺结构
 */
export function convertBackendResult(data: BackendAnalysisData, artType: ArtType): AnalysisResult {
  /* 记录顶层id，用于兼容AnalysisRecord格式 */
  const recordId = data.id;

  /* 检测是否为 AnalysisRecord 包装格式: data.result 存在且包含分析结果字段 */
  const isRecordFormat = data.result && (data.result.dimensions || typeof data.result.overallScore === 'number');

  /* 解包:如果是AnalysisRecord格式,从result中提取实际分析数据。
   * isRecordFormat 为真时 data.result 必然存在,此处用 as 断言去除 undefined。 */
  const actualData = (isRecordFormat ? data.result : data) as BackendAnalysisData;

  /* 提取 professionalSuggestions: 优先取result层,其次顶层,再从aiVisionResult中取 */
  const professionalSuggestions =
    actualData.professionalSuggestions ||
    data.professionalSuggestions ||
    (actualData.aiVisionResult && actualData.aiVisionResult.professionalSuggestions) ||
    (data.aiVisionResult && data.aiVisionResult.professionalSuggestions) ||
    undefined;

  /* 提取 artworkCheck:作品有效性校验,与 professionalSuggestions 同优先级策略 */
  const artworkCheck =
    actualData.artworkCheck ||
    data.artworkCheck ||
    (actualData.aiVisionResult && actualData.aiVisionResult.artworkCheck) ||
    (data.aiVisionResult && data.aiVisionResult.artworkCheck) ||
    undefined;

  /* 检测是否为新版结构化格式(dimensions.type 存在) */
  const isNewFormat = actualData.dimensions && actualData.dimensions.type;

  /* Phase F1:提取可观测性元信息(可能在 AnalysisDetail 顶层或 result 层) */
  const metaInfo = {
    aiEnhanced: data.aiEnhanced ?? actualData.aiEnhanced,
    cacheHit: data.cacheHit ?? actualData.cacheHit,
    jimpDurationMs: data.jimpDurationMs ?? actualData.jimpDurationMs,
    aiDurationMs: data.aiDurationMs ?? actualData.aiDurationMs,
  };

  /* 诊断模式/艺考科目(AnalysisDetail 顶层透传;旧数据缺省 undefined,调用侧按 teaching 处理) */
  const diagnosisMode = data.diagnosisMode ?? actualData.diagnosisMode;
  const examSubject = data.examSubject ?? actualData.examSubject ?? undefined;

  /* AI 视觉分析结果透传(AI 深度分析详情展示;exam 模式含 examResult) */
  const rawVision = actualData.aiVisionResult || data.aiVisionResult;

  /* 深度分析扩展字段透传(阶段 D):evaluationStage/scoreCriteria/issueMarkers
   * 与 4 维度评分可能在顶层(HybridAnalysisResult)或 aiVisionResult(AIVisionResult)中,
   * 与 professionalSuggestions 同优先级策略:result 层 > 顶层 > vision 层。 */
  const evaluationStage = actualData.evaluationStage ?? data.evaluationStage ?? rawVision?.evaluationStage;
  const scoreCriteria = actualData.scoreCriteria ?? data.scoreCriteria ?? rawVision?.scoreCriteria;
  const issueMarkers = actualData.issueMarkers ?? data.issueMarkers ?? rawVision?.issueMarkers;
  const originalityAndStyle = actualData.originalityAndStyle ?? data.originalityAndStyle ?? rawVision?.originalityAndStyle;
  const completenessAndRhythm = actualData.completenessAndRhythm ?? data.completenessAndRhythm ?? rawVision?.completenessAndRhythm;
  const emotionAndMood = actualData.emotionAndMood ?? data.emotionAndMood ?? rawVision?.emotionAndMood;
  const craftsmanship = actualData.craftsmanship ?? data.craftsmanship ?? rawVision?.craftsmanship;
  /* heritageCategory 仅在请求/详情顶层出现(非 vision 字段) */
  const heritageCategory = actualData.heritageCategory ?? data.heritageCategory;

  /* 档位估算(Phase 2 批次④):result 层 > 顶层;旧数据无 → undefined(前端不渲染徽章) */
  const tierEstimate = actualData.tierEstimate ?? data.tierEstimate;

  const aiVisionResult: AnalysisResult['aiVisionResult'] | undefined = rawVision
    ? {
        visualDescription: rawVision.visualDescription,
        composition: rawVision.composition,
        color: rawVision.color,
        technique: rawVision.technique,
        semanticTheme: rawVision.semanticTheme,
        styleRecognition: rawVision.styleRecognition,
        examResult: rawVision.examResult,
        evaluationStage: rawVision.evaluationStage,
        scoreCriteria: rawVision.scoreCriteria,
        issueMarkers: rawVision.issueMarkers,
        originalityAndStyle: rawVision.originalityAndStyle,
        completenessAndRhythm: rawVision.completenessAndRhythm,
        emotionAndMood: rawVision.emotionAndMood,
        craftsmanship: rawVision.craftsmanship,
      }
    : undefined;

  if (isNewFormat) {
    /* 新版格式:直接透传 dimensions/originality,附加 professionalSuggestions */
    /* Phase F1:对 painting 类型,从已有 3 字段聚合 structureTensor */
    /* isNewFormat 为真保证 dimensions 存在,用 ! 断言去除 undefined */
    const dims = actualData.dimensions!;
    if (
      dims.type === 'painting' &&
      dims.brushwork &&
      !dims.brushwork.structureTensor
    ) {
      const bw = dims.brushwork;
      if (
        typeof bw.directionCoherence === 'number' ||
        typeof bw.strokeEnergy === 'number' ||
        typeof bw.dominantBrushDirection === 'number'
      ) {
        bw.structureTensor = {
          coherence: bw.directionCoherence ?? 0,
          energy: bw.strokeEnergy ?? 0,
          dominantDirection: bw.dominantBrushDirection ?? 0,
        };
      }
    }
    return {
      id: recordId || actualData.id || `analysis-${Date.now()}`,
      imageUrl: actualData.imageUrl || data.imageUrl || '',
      createdAt: actualData.createdAt || data.createdAt || new Date().toISOString(),
      artType: actualData.artType || data.artType || actualData.workType || data.workType || artType,
      dimensions: dims,
      /* 后端 originality 字段以 Partial 形式声明(各版本字段差异),
       * 透传时保留原 any 行为:truthy 即原样透传,falsy 用默认完整对象。
       * 用 as 断言为完整类型,与原先 any 透传语义一致。 */
      originality: (actualData.originality || {
        score: 80,
        similarity: 0.15,
        creativityLevel: 'good',
        suggestion: '原创性良好，继续保持个人风格。',
      }) as AnalysisResult['originality'],
      /* 批次②:删除"缺分兜底 75"假分数,无分透传 null(基础检测由 UI 显示占位) */
      overallScore: actualData.overallScore ?? null,
      professionalSuggestions,
      artworkCheck,
      aiVisionResult,
      diagnosisMode,
      examSubject,
      evaluationStage,
      scoreCriteria,
      issueMarkers,
      originalityAndStyle,
      completenessAndRhythm,
      emotionAndMood,
      craftsmanship,
      heritageCategory,
      tierEstimate,
      analysisSource: 'server',
      objectiveChecks: actualData.objectiveChecks ?? data.objectiveChecks,
      ...metaInfo,
    };
  }

  /* 旧版格式:转换平铺字段为结构化 dimensions */
  const composition = actualData.composition || data.composition || {};
  const color = actualData.color || data.color || {};
  const originality = actualData.originality || data.originality || {};

  /* 批次⑤:旧版路径停分对齐——缺分透传 null,不再以 || 75 假分填充 */
  const baseComposition = {
    score: composition.score ?? null,
    focusPoint: composition.focusPoint || { x: 0.5, y: 0.5 },
    balance: composition.balance || 'balanced',
    guideline: composition.guideline || 'average',
    whitespaceRatio: composition.whitespaceRatio ?? 0.5,
    symmetry: composition.symmetry ?? 0.5,
    suggestion: composition.suggestion || '构图建议',
    heatmapData: composition.heatmapData || [],
  };

  const baseColor = {
    score: color.score ?? null,
    warmRatio: color.warmRatio ?? 0.5,
    coolRatio: color.coolRatio ?? 0.5,
    contrast: color.contrast || 'medium',
    saturation: color.saturation || 'medium',
    richness: color.richness || 'moderate',
    harmony: color.harmony || 'neutral',
    dominantColor: color.dominantColor || '未知',
    suggestion: color.suggestion || '色彩建议',
  };

  /* 批次⑤:派生分仅在两维均有真实分时计算,否则 null */
  const avgScore = (a: number | null, b: number | null): number | null =>
    a != null && b != null ? Math.round((a + b) / 2) : null;
  const scaleScore = (a: number | null, k: number): number | null =>
    a != null ? Math.round(a * k) : null;

  let dimensions: AnalysisResult['dimensions'];

  if (artType === 'painting') {
    dimensions = {
      type: 'painting',
      composition: baseComposition,
      color: baseColor,
      brushwork: {
        score: avgScore(baseComposition.score, baseColor.score),
        textureLevel: 'moderate',
        strokeVariety: 50,
        wetDryBalance: '平衡',
        suggestion: '暂无笔触分析数据',
      },
    } as PaintingAnalysis;
  } else if (artType === 'design') {
    dimensions = {
      type: 'design',
      visualHierarchy: {
        score: baseComposition.score,
        focusPoint: baseComposition.focusPoint,
        primarySecondaryClarity: baseComposition.balance === 'balanced' ? 'clear' : 'moderate',
        informationFlow: baseComposition.guideline === 'good' ? 'good' : 'average',
        heatmapData: baseComposition.heatmapData,
        suggestion: baseComposition.suggestion,
      },
      typography: {
        score: scaleScore(baseComposition.score, 0.9),
        alignmentQuality: 'average',
        rhythmConsistency: 'average',
        negativeSpaceUsage: baseComposition.whitespaceRatio > 0.3 && baseComposition.whitespaceRatio < 0.7 ? 'good' : 'average',
        gridAdherence: 60,
        suggestion: '暂无排版分析数据',
      },
      colorApplication: {
        score: baseColor.score,
        contrast: baseColor.contrast,
        brandConsistency: 'moderate',
        colorPsychology: '中性',
        paletteHarmony: baseColor.harmony,
        suggestion: baseColor.suggestion,
      },
    } as DesignAnalysis;
  } else if (artType === 'product') {
    dimensions = {
      type: 'product',
      form: {
        score: baseComposition.score,
        /* 2026-08-18 修复:补 focusPoint(类型契约必填,此前遗漏导致 AnalysisPage
         * 读 form.focusPoint.x 渲染崩溃,产品设计页显示"模块暂时无法正常显示") */
        focusPoint: baseComposition.focusPoint,
        proportionBalance: baseComposition.balance === 'balanced' ? 'good' : 'average',
        lineFluidity: 'moderate',
        surfaceQuality: 'good',
        ergonomicsHint: 'moderate',
        heatmapData: baseComposition.heatmapData,
        suggestion: baseComposition.suggestion,
      },
      materialExpression: {
        score: baseColor.score,
        textureRealism: 'medium',
        lightShadowPerformance: baseColor.contrast === 'high' ? 'excellent' : 'good',
        surfaceTreatment: 'moderate',
        suggestion: baseColor.suggestion,
      },
      functionExpression: {
        score: avgScore(baseComposition.score, baseColor.score),
        structureClarity: 'moderate',
        functionImplication: 'moderate',
        detailRefinement: 'good',
        suggestion: '暂无功能表达分析数据',
      },
    } as ProductAnalysis;
  } else {
    dimensions = {
      type: 'sculpture',
      spatialComposition: {
        score: baseComposition.score,
        /* 2026-08-18 修复:补 focusPoint(同 product,遗漏导致雕塑页渲染崩溃) */
        focusPoint: baseComposition.focusPoint,
        volumeSense: 'moderate',
        spaceOccupation: 'moderate',
        voidSolidRelation: baseComposition.balance === 'balanced' ? 'harmonious' : 'moderate',
        heatmapData: baseComposition.heatmapData,
        suggestion: baseComposition.suggestion,
      },
      bodyLanguage: {
        score: scaleScore(baseComposition.score, 0.9),
        dynamicSense: 'moderate',
        tensionExpression: 'medium',
        rhythmFlow: 'moderate',
        suggestion: '暂无形体语言分析数据',
      },
      materialLanguage: {
        score: baseColor.score,
        materialCharacter: 'moderate',
        textureExpression: 'moderate',
        qualityLayering: 'moderate',
        suggestion: baseColor.suggestion,
      },
    } as SculptureAnalysis;
  }

  return {
    id: recordId || actualData.id || data.id || `analysis-${Date.now()}`,
    imageUrl: actualData.imageUrl || data.imageUrl || '',
    createdAt: actualData.createdAt || data.createdAt || new Date().toISOString(),
    artType: actualData.artType || data.artType || artType,
    dimensions,
    originality: {
      /* 批次⑤:停分透传,不再以 || 80 假分填充 */
      score: originality.score ?? null,
      similarity: originality.similarity ?? 0.15,
      suggestion: originality.suggestion || '暂无原创性数据',
      /* originality.similarity 可能为 undefined(旧版后端未返回该字段);
       * 原先 `any` 下 `undefined < 0.15` 即 false → 'average',此处用显式
       * undefined 判断保留相同行为,同时满足 strictNullChecks。 */
      creativityLevel: originality.similarity === undefined
        ? 'average'
        : originality.similarity < 0.15
          ? 'excellent'
          : originality.similarity < 0.25
            ? 'good'
            : 'average',
    },
    /* 批次②:删除"缺分兜底 75"假分数,无分透传 null */
    overallScore: actualData.overallScore ?? data.overallScore ?? null,
    professionalSuggestions,
    artworkCheck,
    aiVisionResult,
    diagnosisMode,
    examSubject,
    evaluationStage,
    scoreCriteria,
    issueMarkers,
    originalityAndStyle,
    completenessAndRhythm,
    emotionAndMood,
    craftsmanship,
    heritageCategory,
    tierEstimate,
    analysisSource: 'server',
    objectiveChecks: actualData.objectiveChecks ?? data.objectiveChecks,
    ...metaInfo,
  };
}

/**
 * 智能分析入口
 * 自动判断分析模式并执行分析
 *
 * @param options.diagnosisMode 诊断模式(2026-08-16 诊断理念重构):teaching 教学诊断 / exam 艺考诊断
 * @param options.examSubject   艺考科目(仅 diagnosisMode='exam' 时提交)
 * @param options.onRecordId    后台落库回调:client 模式非阻塞落库成功后,将本地临时
 *                              `analysis-*` ID 替换为后端真实记录 ID(AI 深度分析/分享等
 *                              依赖记录的功能随后可用);落库失败不回调,本地展示不受影响
 * @param options.onSyncStatus  落库状态回调(2026-08-16 体验修复):'syncing' 开始 /
 *                              'synced' 成功(带 recordId)/ 'failed' 失败,供结果页
 *                              显示同步占位态与失败重试入口
 */
export async function smartAnalyze(
  file: File | null,
  imageUrl: string,
  artType: ArtType,
  onDecision?: (decision: AnalysisDecision) => void,
  options?: {
    diagnosisMode?: DiagnosisMode;
    examSubject?: ExamSubject;
    /** 非遗类目(仅 artType='heritage' 时有效,透传后端切换评估维度上下文) */
    heritageCategory?: HeritageCategory;
    onRecordId?: (recordId: string) => void;
    onSyncStatus?: (status: 'syncing' | 'synced' | 'failed', recordId?: string) => void;
  }
): Promise<AnalysisResult> {
  const serverAvailable = await checkServerHealth();
  const decision = decideAnalysisMode(file, imageUrl, artType, serverAvailable);

  if (onDecision) {
    onDecision(decision);
  }

  /* 诊断参数注入:exam 模式必须带科目(后端缺省 sketch,此处显式传避免歧义) */
  const diagnosisMode = options?.diagnosisMode;
  const examSubject = diagnosisMode === 'exam' ? (options?.examSubject ?? 'sketch') : undefined;
  /* 非遗类目(仅 artType='heritage' 时有效,透传后端切换剪纸/刺绣/瓷器评估维度上下文) */
  const heritageCategory = options?.heritageCategory;
  const appendDiagnosis = (formData: FormData) => {
    if (diagnosisMode) formData.append('diagnosisMode', diagnosisMode);
    if (examSubject) formData.append('examSubject', examSubject);
    if (heritageCategory && artType === 'heritage') formData.append('heritageCategory', heritageCategory);
  };

  if (decision.mode === 'server' && file) {
    const formData = new FormData();
    formData.append('image', file);
    formData.append('artType', artType);
    appendDiagnosis(formData);

    // 统一走 request:自动携带 Authorization Bearer + CSRF + 401 自动刷新,
    // 修复此前裸 fetch 不带 token 导致的 401「未授权,请先登录」
    const data = await request<any>('/analyses/upload', {
      method: 'POST',
      body: formData,
    });
    if (data) {
      const converted = convertBackendResult(data, artType);
      /* 后端以请求为准落库,此处兜底保证 UI 立即可按所选模式渲染 */
      converted.diagnosisMode = converted.diagnosisMode ?? diagnosisMode;
      converted.examSubject = converted.examSubject ?? examSubject ?? null;
      return converted;
    }
    throw new Error('服务器分析失败，请稍后重试');
  }

  // 本地快速分析(client 模式):返回临时 `analysis-*` ID 的本地结果
  const localResult = await analyzeImage(imageUrl, artType);
  /* 本地结果同样携带诊断模式,保证结果页立即可按所选模式渲染 */
  localResult.diagnosisMode = diagnosisMode;
  localResult.examSubject = examSubject ?? null;

  // 方案 B(非阻塞落库,3 秒 SLA):本地结果立即返回,上传落库后台进行,
  // 成功后经 onRecordId 回调将临时 ID 替换为后端真实记录 ID —— AI 深度
  // 分析、报告导出/分享、成长曲线等依赖后端记录的功能随后可用(此前方案 A
  // 串行 await 落库,本地展示被后端 Jimp 分析拖慢导致总耗时超 3 秒)。
  // 2026-08-18 体验修复:
  //  1) 落库失败不再静默,经 onSyncStatus 通知 UI 显示重试入口;
  //  2) 增加前端 30s 独立超时兜底:后端 /analyses/upload 若被大图片/DB 连接池卡住无限 pending,
  //     syncStatus 不能永远停在 'syncing'("一直在同步服务器"的真根因),到点切换为
  //     'failed' 让用户看到重试按钮。
  if (file) {
    void (async () => {
      let bailoutTimer: number | undefined;
      let settled = false;
      const bailoutMs = 30_000;
      try {
        options?.onSyncStatus?.('syncing');
        const persistPromise = persistLocalAnalysis(file, artType, { diagnosisMode, examSubject });
        const timeoutPromise = new Promise<never>((_, reject) => {
          bailoutTimer = window.setTimeout(() => {
            reject(new Error(`落库超时(超过 ${Math.round(bailoutMs / 1000)} 秒,服务器响应缓慢)`));
          }, bailoutMs);
        });
        const recordId = await Promise.race([persistPromise, timeoutPromise]);
        if (settled) return;
        settled = true;
        options?.onRecordId?.(recordId);
        options?.onSyncStatus?.('synced', recordId);
      } catch (err) {
        if (settled) return;
        settled = true;
        console.warn('本地分析结果后端落库失败,保留本地临时 ID:', err);
        options?.onSyncStatus?.('failed');
      } finally {
        if (typeof bailoutTimer === 'number') window.clearTimeout(bailoutTimer);
      }
    })();
  }

  return localResult;
}

/**
 * 将本地分析结果落库为后端诊断记录(方案 B 非阻塞落库的可复用封装)
 *
 * 抽取目的:client 模式落库失败后,结果页可调用本函数「重试保存」,
 * 成功后替换临时 `analysis-*` ID,恢复 AI 深度分析/分享/报告导出等依赖记录的功能。
 *
 * @param file 原始图片文件
 * @param artType 作品类型
 * @param options.diagnosisMode / examSubject 诊断参数(与 smartAnalyze 一致)
 * @returns 后端真实记录 ID(UUID)
 * @throws Error 网络/HTTP/业务错误(未返回 id 时)
 */
export async function persistLocalAnalysis(
  file: File,
  artType: ArtType,
  options?: { diagnosisMode?: DiagnosisMode; examSubject?: ExamSubject }
): Promise<string> {
  const diagnosisMode = options?.diagnosisMode;
  const examSubject = diagnosisMode === 'exam' ? (options?.examSubject ?? 'sketch') : undefined;
  const formData = new FormData();
  formData.append('image', file);
  formData.append('artType', artType);
  if (diagnosisMode) formData.append('diagnosisMode', diagnosisMode);
  if (examSubject) formData.append('examSubject', examSubject);

  // silent:true:错误提示由调用方统一处理
  const data = await request<any>('/analyses/upload', {
    method: 'POST',
    body: formData,
    silent: true,
  });
  if (data?.id) return data.id;
  throw new Error('保存失败：后端未返回记录 ID');
}

/**
 * AI 深度增强分析(阶段 2)
 *
 * 对已存在的分析记录调用后端 AI 视觉模型增强,返回带 aiEnhanced=true 的新结果。
 * 后端幂等:若记录已 aiEnhanced=true,直接返回当前结果不重复计费。
 *
 * 鉴权同 GET /analyses/:id(analysis:read:own/tenant),沿用本文件 smartAnalyze 的
 * 裸 fetch 模式(同源请求携带 Cookie,与 /analyses/upload 一致)。
 *
 * @param analysisId 阶段 1 返回的 AnalysisResult.id
 * @param artType    当前艺术类型(convertBackendResult fallback 用,后端响应含 artType 时以响应为准)
 * @throws Error 网络/HTTP/业务错误(message 可直接 toast)
 */
export async function aiEnhanceAnalysis(
  analysisId: string,
  artType: ArtType,
  opts?: { timeoutMs?: number }
): Promise<AnalysisResult> {
  // 统一走 request:自动携带 Authorization Bearer + CSRF + 401 自动刷新,
  // 修复此前裸 fetch 不带 token 导致的 401「未授权,请先登录」
  // silent:true:错误提示由调用方(handleAiEnhance)统一处理,避免全局 Toast 重复弹出
  // 2026-08-18 超时修复:默认 180s(后端 AI_ENHANCE_TIMEOUT 已调 150s,前端留余量;
  //  非遗深度分析输出量大,glm-4.5v 生成大量 tokens 耗时可达 60-150s)
  const data = await request<any>(`/analyses/${analysisId}/ai-enhance`, {
    method: 'POST',
    silent: true,
    timeoutMs: opts?.timeoutMs ?? 180000,
  });
  if (data) {
    return convertBackendResult(data, artType);
  }
  throw new Error('AI 深度分析失败，请稍后重试');
}

/**
 * 问题分析结果(阶段 3:AI 深度分析后的用户追问)
 */
export interface AnalysisQAResult {
  question: string;
  /** 面向问题的自然语言回答(教师口吻,围绕画面具体证据展开) */
  answer: string;
  /** 问题聚焦的维度(如"构图与造型";可为空) */
  focusDimension?: string;
  /** 可执行建议(0-3 条) */
  suggestions: string[];
}

/**
 * 阶段 3:问题分析 —— 就诊断结果向 AI 提问,获取定向解答。
 * 前置条件:该记录已完成 AI 深度分析(aiEnhanced=true),否则后端返回 409。
 */
export async function askAnalysisQuestion(
  analysisId: string,
  question: string
): Promise<AnalysisQAResult> {
  // silent:true:错误提示由调用方统一处理;request 自动携带 Authorization + CSRF
  const data = await request<any>(`/analyses/${analysisId}/ask-question`, {
    method: 'POST',
    body: { question },
    silent: true,
  });
  if (data && typeof data.answer === 'string' && data.answer) {
    return {
      question: typeof data.question === 'string' ? data.question : question,
      answer: data.answer,
      focusDimension: typeof data.focusDimension === 'string' ? data.focusDimension : undefined,
      suggestions: Array.isArray(data.suggestions)
        ? data.suggestions.filter((s: unknown): s is string => typeof s === 'string')
        : [],
    };
  }
  throw new Error('问题分析失败，请稍后重试');
}

/**
 * 获取复杂度标签文本
 */
export function getComplexityLabel(level: ImageComplexity['level']): string {
  const labels: Record<string, string> = {
    simple: '简单',
    normal: '中等',
    complex: '复杂',
  };
  return labels[level] || level;
}

/**
 * 获取复杂度颜色
 */
export function getComplexityColor(level: ImageComplexity['level']): string {
  const colors: Record<string, string> = {
    simple: 'text-jade',
    normal: 'text-gold',
    complex: 'text-cinnabar',
  };
  return colors[level] || 'text-ink-500';
}

export type { AnalysisDecision };
