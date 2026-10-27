// ============================================================
// AI 响应构造器(集成测试共享)
// 对应源码: src/services/ai-vision.service.ts (GLM-4V 响应解析)
//
// 职责:
//   1. buildGlmResponse: 包裹 content 为 GLM OpenAI 兼容响应结构
//   2. buildDepthContent: 构造含 4 维度/ScoreCriteria/IssueMarker/EvaluationStage 的 AI content
//   3. buildScoreCriteria / buildIssueMarkers: 样例数据工厂
//
// 设计要点:
//   - AI 返回 snake_case 键(如 originality_and_style),由 Zod schema 解析为 camelCase
//   - overallDelta=0 使 base overallScore = Jimp 原始分,便于断言加权逻辑
//   - 与 ai-analysis-merge.test.ts 的 buildContent 保持一致结构
// ============================================================

import type { EvaluationStage, HeritageCategory } from '../../src/types/ai-analysis.js';

// ============================================================
// 维度评分构造
// ============================================================

export interface DepthDimensionContent {
  score: number;
  analysis: string;
  suggestion: string;
}

/** 构造单维度评分内容 */
export function buildDepthDimension(
  score: number,
  analysis = '维度分析文本:画面构图均衡,主体落于黄金分割点。',
  suggestion = '维度改进建议:将主体向左偏移强化动势。',
): DepthDimensionContent {
  return { score, analysis, suggestion };
}

// ============================================================
// ScoreCriteria / IssueMarkers 样例数据
// ============================================================

/** 构造 scoreCriteria 数组(AI 返回 snake_case,由 schema 解析) */
export function buildScoreCriteria(opts: {
  dimension?: string;
  weight?: number;
  maxScore?: number;
  level?: string;
} = {}): unknown[] {
  return [
    {
      dimension: opts.dimension ?? '构图与造型',
      weight: opts.weight ?? 0.4,
      max_score: opts.maxScore ?? 100,
      level: opts.level ?? 'good',
      met_criteria: ['主体落于黄金分割点', '视觉重心稳定'],
      unmet_criteria: ['边角留白略多'],
      evidence: '视觉重心(0.50,0.50),留白 30%',
    },
    {
      dimension: '色彩与色调',
      weight: 0.3,
      max_score: 100,
      level: 'average',
      met_criteria: ['暖冷比均衡'],
      unmet_criteria: ['饱和度偏低'],
      evidence: '暖色 60% / 冷色 40%,饱和度 0.45',
    },
  ];
}

/** 构造 issueMarkers 数组(AI 返回 snake_case) */
export function buildIssueMarkers(): unknown[] {
  return [
    {
      x: 0.12,
      y: 0.20,
      w: 0.30,
      h: 0.25,
      label: '构图偏移',
      severity: 'high',
      improvement_hint: '将主体向左下偏移 0.1 以强化动势',
    },
    {
      x: 0.55,
      y: 0.60,
      w: 0.20,
      h: 0.15,
      label: '色彩断层',
      severity: 'medium',
      improvement_hint: '在冷暖交界处增加过渡色阶',
    },
  ];
}

// ============================================================
// AI 响应 content 构造
// ============================================================

export interface DepthContentOptions {
  /** 4 维度评分(任一缺省则该维度不返回) */
  deepDims?: {
    originality_and_style?: DepthDimensionContent;
    completeness_and_rhythm?: DepthDimensionContent;
    emotion_and_mood?: DepthDimensionContent;
    craftsmanship?: DepthDimensionContent;
  };
  /** AI 回显的评价阶段(优先于请求值) */
  evaluationStage?: EvaluationStage;
  /** 评分标准数组 */
  scoreCriteria?: unknown[];
  /** 问题标注数组 */
  issueMarkers?: unknown[];
  /** 总分增量(0 = 不调整,overallScore 取 Jimp 原始分) */
  overallDelta?: number;
  /** 语义主题 */
  semanticTheme?: string;
  /** 风格识别 */
  styleRecognition?: string;
  /** 专业建议 */
  professionalSuggestions?: unknown[];
}

/**
 * 构造 AI 响应 content(JSON 字符串)
 * 结构与 ai-vision.service.ts Zod schema 期望一致
 */
export function buildDepthContent(opts: DepthContentOptions = {}): string {
  const d = opts.deepDims ?? {};
  return JSON.stringify({
    semantic_theme: opts.semanticTheme ?? '静物画构图均衡,色彩温暖,主体清晰。',
    style_recognition: opts.styleRecognition ?? '古典写实风格',
    professional_suggestions: opts.professionalSuggestions ?? [],
    score_adjustments: {
      dimension_adjustments: [],
      overall_delta: opts.overallDelta ?? 0,
      overall_reason: '',
    },
    reference_artworks: [],
    ...(d.originality_and_style
      ? { originality_and_style: d.originality_and_style }
      : {}),
    ...(d.completeness_and_rhythm
      ? { completeness_and_rhythm: d.completeness_and_rhythm }
      : {}),
    ...(d.emotion_and_mood ? { emotion_and_mood: d.emotion_and_mood } : {}),
    ...(d.craftsmanship ? { craftsmanship: d.craftsmanship } : {}),
    ...(opts.evaluationStage ? { evaluation_stage: opts.evaluationStage } : {}),
    ...(opts.scoreCriteria ? { score_criteria: opts.scoreCriteria } : {}),
    ...(opts.issueMarkers ? { issue_markers: opts.issueMarkers } : {}),
  });
}

// ============================================================
// GLM 响应包裹
// ============================================================

/**
 * 包裹 content 为 GLM-4V OpenAI 兼容响应结构
 * analyzeWithAI 读取 data.choices[0].message.content
 */
export function buildGlmResponse(content: string): {
  data: {
    choices: Array<{ message: { content: string } }>;
    usage?: unknown;
  };
  status: number;
} {
  return {
    data: {
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 120, completion_tokens: 90, total_tokens: 210 },
    },
    status: 200,
  };
}

// ============================================================
// 非遗专用内容构造
// ============================================================

/**
 * 构造非遗类目专属 AI 响应 content
 * 4 维度评分文本含类目工艺术语,模拟真实非遗评估
 */
export function buildHeritageDepthContent(category: HeritageCategory): string {
  const categoryText: Record<HeritageCategory, {
    theme: string;
    style: string;
    originality: DepthDimensionContent;
    craftsmanship: DepthDimensionContent;
  }> = {
    papercut: {
      theme: '剪纸作品阴阳虚实处理得当,刀工流畅。',
      style: '传统民间剪纸风格',
      originality: buildDepthDimension(78, '原创性:纹样布局对称,连而不断,锯齿纹工整。', '建议在转折处增加月牙纹丰富层次。'),
      craftsmanship: buildDepthDimension(85, '工艺:刀工流畅,阳刻阴刻结合,线条连贯。', '建议加强转折处毛刺处理。'),
    },
    embroidery: {
      theme: '刺绣作品针法细腻,色彩过渡自然。',
      style: '苏绣传统风格',
      originality: buildDepthDimension(80, '原创性:图案精度高,针法运用多样。', '建议增加材质表现层次。'),
      craftsmanship: buildDepthDimension(82, '工艺:针法运用娴熟,色彩过渡自然。', '建议在图案精度上加强细节。'),
    },
    porcelain: {
      theme: '瓷器造型规整,釉色质感温润。',
      style: '青瓷传统风格',
      originality: buildDepthDimension(76, '原创性:造型规整,釉色质感良好。', '建议在装饰工艺上增加变化。'),
      craftsmanship: buildDepthDimension(84, '工艺:烧制完整度高,釉色质感温润。', '建议加强装饰工艺细节。'),
    },
  };
  const c = categoryText[category];
  return buildDepthContent({
    semanticTheme: c.theme,
    styleRecognition: c.style,
    evaluationStage: 'master',
    deepDims: {
      originality_and_style: c.originality,
      completeness_and_rhythm: buildDepthDimension(74, '完整度:画面节奏感强,主次分明。', '建议优化构图均衡度。'),
      emotion_and_mood: buildDepthDimension(72, '情感:意境传达到位,传统韵味浓厚。', '建议增强意境表达。'),
      craftsmanship: c.craftsmanship,
    },
    scoreCriteria: buildScoreCriteria({ dimension: category === 'papercut' ? '刀工流畅度' : category === 'embroidery' ? '针法运用' : '造型规整' }),
    issueMarkers: buildIssueMarkers(),
  });
}
