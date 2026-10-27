// ============================================================
// 反馈策略切换引擎单元测试(Phase 2 批次③)
// 对应源码:
//   - src/services/ai-analysis.service.ts(predictFeedbackMode/FEEDBACK_MARKER_BUDGETS/
//     weightedAverageByProfile/runAIEnhance 模式注入与加权综合分)
//   - src/services/ai-vision.service.ts(FEEDBACK_STRATEGY_REFERENCE prompt 注入/
//     buildUserPrompt 反馈模式上下文段/applyMarkerBudget 标注预算后处理)
// 对应文档:visual-annotation-feedback-upgrade-spec-2026-09.md §4.2
//
// 测试范围:
//   1. predictFeedbackMode:预判链(无档案 → 档案默认 → 历史均值 vs 达标线)
//   2. weightedAverageByProfile:加权 vs 等权 / label 匹配 / 全不匹配等权兜底
//   3. buildSystemPrompt:【反馈策略】段注入(teaching/exam × diagnosis/guidance/缺省)
//   4. buildUserPrompt:【反馈模式上下文】段注入(模式名 + 标注预算指令)
//   5. applyMarkerBudget:guidance 截 4 + critical 降级 / diagnosis 不动 / 缺省原样
//   6. runAIEnhance 集成:prompt 落地(axios 请求体断言)+ 加权综合分 + 预算后处理 + 无档案回归
//
// Mock 策略:照 ai-analysis-merge.test.ts(vi.mock axios + env,其余真实执行)
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ============================================================
// 1. vi.mock:axios + env(必须在 import 源码前声明)
// ============================================================

vi.mock('axios', () => ({ default: { post: vi.fn() } }));

const aiEnvState = {
  aiEnabled: false,
  aiProvider: 'glm',
  aiApiKey: '',
  aiApiUrl: 'https://test-ai-api.example.com/v1/chat/completions',
  aiApiTimeout: 2500,
  aiApiModel: 'glm-4v-flash-test',
  traeApiKey: '',
  traeApiUrl: '',
  traeApiModel: '',
};

vi.mock('../src/config/env.js', () => {
  const staticConfig = {
    nodeEnv: 'test' as const,
    port: 3000,
    logLevel: 'error' as const,
    databaseUrl: 'postgresql://test:test@localhost:5432/test',
    redisUrl: 'redis://localhost:6379',
    corsOrigins: ['http://localhost:5173'],
    uploadDir: 'test-uploads',
    uploadMaxSize: 10485760,
  };
  function buildEnv() {
    return {
      ...staticConfig,
      aiEnabled: aiEnvState.aiEnabled,
      aiProvider: aiEnvState.aiProvider,
      aiApiKey: aiEnvState.aiApiKey,
      aiApiUrl: aiEnvState.aiApiUrl,
      aiApiTimeout: aiEnvState.aiApiTimeout,
      aiApiModel: aiEnvState.aiApiModel,
      aiApiModels: [aiEnvState.aiApiModel],
      aiApiMaxTokens: 1024,
      traeApiKey: aiEnvState.traeApiKey,
      traeApiUrl: aiEnvState.traeApiUrl,
      traeApiModel: aiEnvState.traeApiModel,
    };
  }
  return { env: () => buildEnv(), initEnv: () => buildEnv(), loadEnv: () => buildEnv() };
});

import axios from 'axios';
import {
  predictFeedbackMode,
  weightedAverageByProfile,
  FEEDBACK_MARKER_BUDGETS,
  mapScoreToTier,
  runAIEnhance,
} from '../src/services/ai-analysis.service.js';
import {
  buildSystemPrompt,
  buildUserPrompt,
  applyMarkerBudget,
} from '../src/services/ai-vision.service.js';
import { generateFallbackAnalysis, rejudgeObjectiveChecks } from '../src/services/analysis-engine.service.js';
import type { AIVisionRequest, HybridAnalysisResult } from '../src/types/ai-analysis.js';
import type { ResolvedGradingProfile } from '../src/types/grading-profile.js';
import type { IssueMarker } from '../src/types/api-contract.js';

// ============================================================
// 2. 辅助:档案 fixture / AI 响应构造
// ============================================================

/** 构造已通过 Zod 校验语义的生效档案(basicsLine=70) */
function makeProfile(
  overrides: Partial<ResolvedGradingProfile> = {},
): ResolvedGradingProfile {
  return {
    id: 'gprofile_test_0001',
    name: '联考·素描·标准版(测试)',
    category: 'sketch',
    config: {
      defaultFeedbackMode: 'diagnosis',
      dimensionWeights: [
        { key: '造型与比例', label: '造型与比例', weight: 40 },
        { key: '构图与空间', label: '构图与空间', weight: 20 },
        { key: '明暗与体积', label: '明暗与体积', weight: 25 },
        { key: '表现手法', label: '表现手法', weight: 15 },
      ],
      thresholds: { basicsLine: 70, dimensionPass: { '造型与比例': 65 } },
      tierMapping: [
        { key: 'A', label: '一档(90-100)', min: 90 },
        { key: 'B', label: '二档(80-89)', min: 80 },
        { key: 'C', label: '三档(70-79)', min: 70 },
        { key: 'D', label: '四档(60-69)', min: 60 },
        { key: 'E', label: '五档(<60)', min: 0 },
      ],
      feedbackStyle: { diagnosisIntensity: 3, positiveRatio: 0.4, toneStrictness: 3 },
    },
    ...overrides,
  };
}

/** 构造 AI 响应 content(与 ai-analysis-merge.test.ts 同风格) */
function buildContent(opts: {
  overallScore?: number;
  dimensionScores?: Array<{ dimension: string; score: number }>;
  issueMarkers?: unknown[];
  gradeTierEstimate?: unknown;
}): string {
  return JSON.stringify({
    semantic_theme: '静物画构图均衡,色彩温暖。',
    style_recognition: '古典写实',
    professional_suggestions: [],
    score_adjustments: { dimension_adjustments: [], overall_delta: 0, overall_reason: '' },
    reference_artworks: [],
    ...(opts.overallScore !== undefined ? { overall_score: opts.overallScore } : {}),
    ...(opts.dimensionScores ? { dimension_scores: opts.dimensionScores } : {}),
    ...(opts.issueMarkers ? { issue_markers: opts.issueMarkers } : {}),
    ...(opts.gradeTierEstimate !== undefined
      ? { grade_tier_estimate: opts.gradeTierEstimate }
      : {}),
  });
}

function buildGlmResponse(content: string): {
  data: { choices: Array<{ message: { content: string } }>; usage?: unknown };
  status: number;
} {
  return {
    data: {
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 100, completion_tokens: 80, total_tokens: 180 },
    },
    status: 200,
  };
}

/** 构造阶段 1 落库的 storedResult(aiEnhanced=false) */
function buildStoredResult(): HybridAnalysisResult {
  const base = generateFallbackAnalysis('painting');
  return {
    ...base,
    aiEnhanced: false,
    aiVisionResult: null,
    aiMeta: {
      aiSuccess: false,
      aiDurationMs: 0,
      aiFailureReason: 'AI_DISABLED',
      aiModel: 'local-engine',
      aiInvokedAt: new Date().toISOString(),
    },
  };
}

/** 构造最小 AIVisionRequest(buildUserPrompt 断言用) */
function buildAiRequest(overrides: Partial<AIVisionRequest> = {}): AIVisionRequest {
  return {
    imageSource: 'https://example.com/test.jpg',
    artType: 'painting',
    ...overrides,
  };
}

/** 构造标注 marker(不重叠,w+h>0.02) */
function makeMarker(
  index: number,
  type: IssueMarker['type'],
  severity: IssueMarker['severity'] = 'high',
): IssueMarker {
  return {
    x: 0.05 * index,
    y: 0.1,
    w: 0.04,
    h: 0.05,
    label: `问题${index}`,
    severity,
    improvementHint: 'H',
    ...(type ? { type } : {}),
  };
}

beforeEach(() => {
  aiEnvState.aiEnabled = false;
  aiEnvState.aiProvider = 'glm';
  aiEnvState.aiApiKey = '';
  aiEnvState.aiApiUrl = 'https://test-ai-api.example.com/v1/chat/completions';
  aiEnvState.aiApiTimeout = 2500;
  aiEnvState.aiApiModel = 'glm-4v-flash-test';
  aiEnvState.traeApiKey = '';
  aiEnvState.traeApiUrl = '';
  aiEnvState.traeApiModel = '';
  vi.mocked(axios.post).mockReset();
});

// ============================================================
// 3. predictFeedbackMode:预判链
// ============================================================

describe('predictFeedbackMode(批次③ 注入层预判)', () => {
  it('无档案 → undefined(现状行为,prompt 不注入策略段)', () => {
    expect(predictFeedbackMode(undefined, 50)).toBeUndefined();
    expect(predictFeedbackMode(undefined, undefined)).toBeUndefined();
  });

  it('有档案无历史 → 档案 defaultFeedbackMode(教师冷启动配置)', () => {
    const profile = makeProfile();
    expect(predictFeedbackMode(profile, undefined)).toBe('diagnosis');
    expect(predictFeedbackMode(profile, null)).toBe('diagnosis');
  });

  it('历史均值 < basicsLine → diagnosis(spec §4.2 主规则)', () => {
    const profile = makeProfile(); // basicsLine=70
    expect(predictFeedbackMode(profile, 69.9)).toBe('diagnosis');
    expect(predictFeedbackMode(profile, 40)).toBe('diagnosis');
  });

  it('历史均值 ≥ basicsLine → guidance(≥1 次历史即用,自然收敛)', () => {
    const profile = makeProfile(); // basicsLine=70
    expect(predictFeedbackMode(profile, 70)).toBe('guidance');
    expect(predictFeedbackMode(profile, 85)).toBe('guidance');
  });

  it('档案 defaultFeedbackMode=guidance 时不改变历史规则优先级', () => {
    // 教师配置 guidance 为冷启动默认,但历史均值低于达标线仍应回到 diagnosis(spec §4.2)
    const profile = makeProfile({
      config: { ...makeProfile().config, defaultFeedbackMode: 'guidance' },
    });
    expect(predictFeedbackMode(profile, undefined)).toBe('guidance');
    expect(predictFeedbackMode(profile, 55)).toBe('diagnosis');
  });
});

// ============================================================
// 4. weightedAverageByProfile:加权综合分
// ============================================================

describe('weightedAverageByProfile(批次③ 加权综合分)', () => {
  const scores = [
    { dimension: '造型与比例', score: 90 },
    { dimension: '构图与空间', score: 50 },
  ];

  it('无档案 → 等权平均(现状行为)', () => {
    expect(weightedAverageByProfile(scores, undefined)).toBe(70);
  });

  it('有档案 → 按维度权重加权(归一化到已匹配权重和)', () => {
    // 权重:造型40 / 构图20(仅这两维匹配) → (90*40+50*20)/60 = 76.67
    expect(weightedAverageByProfile(scores, makeProfile())).toBeCloseTo(76.6667, 3);
  });

  it('label 通道匹配(维度名与档案权重 label 一致时命中)', () => {
    const profile = makeProfile({
      config: {
        ...makeProfile().config,
        dimensionWeights: [
          { key: 'modeling', label: '造型与比例', weight: 75 },
          { key: 'composition', label: '构图与空间', weight: 25 },
        ],
      },
    });
    // (90*75+50*25)/100 = 80
    expect(weightedAverageByProfile(scores, profile)).toBe(80);
  });

  it('档案权重键与维度名全不匹配 → 等权兜底(行为与无档案一致)', () => {
    const profile = makeProfile({
      config: {
        ...makeProfile().config,
        dimensionWeights: [{ key: 'other', label: '其他维度', weight: 100 }],
      },
    });
    expect(weightedAverageByProfile(scores, profile)).toBe(70);
  });

  it('空分数列表 → null', () => {
    expect(weightedAverageByProfile([], makeProfile())).toBeNull();
    expect(weightedAverageByProfile([], undefined)).toBeNull();
  });
});

// ============================================================
// 5. buildSystemPrompt:【反馈策略】段注入
// ============================================================

describe('buildSystemPrompt 反馈策略段(批次③)', () => {
  it('teaching + diagnosis → 含【反馈策略】与诊断模式描述', () => {
    const prompt = buildSystemPrompt('painting', 'teaching', undefined, undefined, 'diagnosis');
    expect(prompt).toContain('【反馈策略(由评分档案驱动,必须遵守)】');
    expect(prompt).toContain('诊断模式:该学生处于基本功训练阶段');
  });

  it('teaching + guidance → 含引导模式描述', () => {
    const prompt = buildSystemPrompt('painting', 'teaching', undefined, undefined, 'guidance');
    expect(prompt).toContain('【反馈策略(由评分档案驱动,必须遵守)】');
    expect(prompt).toContain('引导模式:该学生基本功扎实');
  });

  it('teaching 缺省 feedbackMode → 不注入策略段(现状行为)', () => {
    const prompt = buildSystemPrompt('painting');
    expect(prompt).not.toContain('【反馈策略');
  });

  it('exam + guidance → 含策略段(阅卷口吻受约束)', () => {
    const prompt = buildSystemPrompt('painting', 'exam', 'sketch', undefined, 'guidance');
    expect(prompt).toContain('【反馈策略(由评分档案驱动,必须遵守)】');
    expect(prompt).toContain('引导模式:该学生基本功扎实');
  });

  it('exam 缺省 feedbackMode → 不注入策略段', () => {
    const prompt = buildSystemPrompt('painting', 'exam', 'sketch');
    expect(prompt).not.toContain('【反馈策略');
  });

  it('策略段与评价阶段参照系同时注入时互不覆盖', () => {
    const prompt = buildSystemPrompt(
      'painting',
      'teaching',
      undefined,
      'intermediate',
      'guidance',
    );
    expect(prompt).toContain('【本次评分参照系(评价阶段:intermediate)】');
    expect(prompt).toContain('【反馈策略(由评分档案驱动,必须遵守)】');
  });
});

// ============================================================
// 6. buildUserPrompt:【反馈模式上下文】段注入
// ============================================================

describe('buildUserPrompt 反馈模式上下文段(批次③)', () => {
  it('diagnosis + 预算 → 含模式名与 6-10 预算指令', () => {
    const prompt = buildUserPrompt(
      buildAiRequest({
        feedbackMode: 'diagnosis',
        markerBudget: FEEDBACK_MARKER_BUDGETS.diagnosis,
      }),
    );
    expect(prompt).toContain('【反馈模式上下文(由评分档案策略决定)】');
    expect(prompt).toContain('- 当前反馈模式:诊断模式');
    expect(prompt).toContain('6-10');
    expect(prompt).toContain('critical');
  });

  it('guidance + 预算 → 含 2-4 预算与 critical 至多 1 个约束', () => {
    const prompt = buildUserPrompt(
      buildAiRequest({
        feedbackMode: 'guidance',
        markerBudget: FEEDBACK_MARKER_BUDGETS.guidance,
      }),
    );
    expect(prompt).toContain('- 当前反馈模式:引导模式');
    expect(prompt).toContain('2-4');
    expect(prompt).toContain('type="critical" 至多 1 个');
  });

  it('缺省 feedbackMode → 不注入上下文段(现状行为)', () => {
    const prompt = buildUserPrompt(buildAiRequest());
    expect(prompt).not.toContain('【反馈模式上下文');
  });
});

// ============================================================
// 7. applyMarkerBudget:标注预算后处理
// ============================================================

describe('applyMarkerBudget(批次③ 标注预算后处理)', () => {
  const fiveMarkers: IssueMarker[] = [
    makeMarker(0, 'critical'),
    makeMarker(1, 'critical'),
    makeMarker(2, 'critical'),
    makeMarker(3, 'suggestion', 'medium'),
    makeMarker(4, 'highlight', 'low'),
  ];

  it('guidance:截至上限 4,第 2+ 个 critical 降级为 suggestion(severity 同步 medium)', () => {
    const result = applyMarkerBudget(fiveMarkers, 'guidance', FEEDBACK_MARKER_BUDGETS.guidance);
    expect(result).toHaveLength(4);
    const criticals = result.filter((m) => m.type === 'critical');
    expect(criticals).toHaveLength(1);
    // 第 2、3 个 critical → suggestion,且 severity high→medium 维持类型-严重度约定
    const downgraded = result.filter((m) => m.type === 'suggestion');
    expect(downgraded).toHaveLength(3);
    expect(downgraded.every((m) => m.severity !== 'high')).toBe(true);
  });

  it('guidance 无显式预算 → 默认 max=4 / criticalMax=1', () => {
    const result = applyMarkerBudget(fiveMarkers, 'guidance');
    expect(result).toHaveLength(4);
    expect(result.filter((m) => m.type === 'critical')).toHaveLength(1);
  });

  it('diagnosis:上限 10 不截断、critical 不降级', () => {
    const many: IssueMarker[] = Array.from({ length: 9 }, (_, i) =>
      makeMarker(i, i % 2 === 0 ? 'critical' : 'suggestion', 'high'),
    );
    const result = applyMarkerBudget(many, 'diagnosis', FEEDBACK_MARKER_BUDGETS.diagnosis);
    expect(result).toHaveLength(9);
    expect(result.filter((m) => m.type === 'critical')).toHaveLength(5);
  });

  it('缺省 feedbackMode → 原样返回(无档案现状行为)', () => {
    const result = applyMarkerBudget(fiveMarkers, undefined);
    expect(result).toBe(fiveMarkers);
  });
});

// ============================================================
// 8. runAIEnhance 集成:prompt 落地 + 加权综合分 + 预算后处理
// ============================================================

describe('runAIEnhance 策略引擎集成(批次③)', () => {
  /** 开启 AI 并 mock 成功响应 */
  function enableAI(content: string) {
    aiEnvState.aiEnabled = true;
    aiEnvState.aiApiKey = 'test-key';
    vi.mocked(axios.post).mockResolvedValueOnce(buildGlmResponse(content));
  }

  /** 取 axios 请求体(单次调用) */
  function getRequestBody(): {
    system: string;
    user: string;
  } {
    const call = vi.mocked(axios.post).mock.calls[0]!;
    const body = call[1] as {
      messages: Array<{ role: string; content: unknown }>;
    };
    const system = body.messages[0]!.content as string;
    const userContent = body.messages[1]!.content as Array<{ type: string; text: string }>;
    const user = userContent.find((c) => c.type === 'text')!.text;
    return { system, user };
  }

  it('档案 + 低历史均值 → diagnosis 注入 prompt 与预算(axios 请求体断言)', async () => {
    enableAI(buildContent({ overallScore: 82 }));
    await runAIEnhance({
      analysisId: 'a-strategy-1',
      imageSource: 'https://example.com/test.jpg',
      artType: 'painting',
      storedResult: buildStoredResult(),
      jimpDurationMs: 100,
      gradingProfile: makeProfile(), // basicsLine=70
      recentOverallAvg: 55, // < 70 → diagnosis
    });
    const { system, user } = getRequestBody();
    expect(system).toContain('【反馈策略(由评分档案驱动,必须遵守)】');
    expect(system).toContain('诊断模式:该学生处于基本功训练阶段');
    expect(user).toContain('【反馈模式上下文(由评分档案策略决定)】');
    expect(user).toContain('- 当前反馈模式:诊断模式');
    expect(user).toContain('6-10');
  });

  it('档案 + 高历史均值 → guidance 注入 prompt 与预算', async () => {
    enableAI(buildContent({ overallScore: 82 }));
    await runAIEnhance({
      analysisId: 'a-strategy-2',
      imageSource: 'https://example.com/test.jpg',
      artType: 'painting',
      storedResult: buildStoredResult(),
      jimpDurationMs: 100,
      gradingProfile: makeProfile(),
      recentOverallAvg: 85, // ≥ 70 → guidance
    });
    const { system, user } = getRequestBody();
    expect(system).toContain('引导模式:该学生基本功扎实');
    expect(user).toContain('- 当前反馈模式:引导模式');
    expect(user).toContain('type="critical" 至多 1 个');
  });

  it('AI 未回 overall_score 时综合分兜底改档案加权(76.67 → 77)', async () => {
    enableAI(
      buildContent({
        dimensionScores: [
          { dimension: '造型与比例', score: 90 },
          { dimension: '构图与空间', score: 50 },
        ],
      }),
    );
    const result = await runAIEnhance({
      analysisId: 'a-strategy-3',
      imageSource: 'https://example.com/test.jpg',
      artType: 'painting',
      storedResult: buildStoredResult(),
      jimpDurationMs: 100,
      gradingProfile: makeProfile(),
      recentOverallAvg: 55,
    });
    // 加权:(90*40 + 50*20)/60 = 76.67 → clampScore 取整 77
    expect(result.aiEnhanced).toBe(true);
    expect(result.overallScore).toBe(77);
  });

  it('无档案时同一 AI 返回 → 等权兜底 70(现状行为回归)', async () => {
    enableAI(
      buildContent({
        dimensionScores: [
          { dimension: '造型与比例', score: 90 },
          { dimension: '构图与空间', score: 50 },
        ],
      }),
    );
    const result = await runAIEnhance({
      analysisId: 'a-strategy-4',
      imageSource: 'https://example.com/test.jpg',
      artType: 'painting',
      storedResult: buildStoredResult(),
      jimpDurationMs: 100,
    });
    // 等权:(90+50)/2 = 70
    expect(result.aiEnhanced).toBe(true);
    expect(result.overallScore).toBe(70);
    // prompt 不注入策略段(现状行为)
    const { system, user } = getRequestBody();
    expect(system).not.toContain('【反馈策略');
    expect(user).not.toContain('【反馈模式上下文');
  });

  it('guidance 模式下 AI 超预算标注 → 后处理截 4 且 critical 降级', async () => {
    enableAI(
      buildContent({
        overallScore: 82,
        issueMarkers: [
          { x: 0.0, y: 0.1, w: 0.04, h: 0.05, type: 'critical', label: 'A', severity: 'high', improvement_hint: 'H' },
          { x: 0.1, y: 0.1, w: 0.04, h: 0.05, type: 'critical', label: 'B', severity: 'high', improvement_hint: 'H' },
          { x: 0.2, y: 0.1, w: 0.04, h: 0.05, type: 'critical', label: 'C', severity: 'high', improvement_hint: 'H' },
          { x: 0.3, y: 0.1, w: 0.04, h: 0.05, type: 'suggestion', label: 'D', severity: 'medium', improvement_hint: 'H' },
          { x: 0.4, y: 0.1, w: 0.04, h: 0.05, type: 'highlight', label: 'E', severity: 'low', improvement_hint: 'H' },
        ],
      }),
    );
    const result = await runAIEnhance({
      analysisId: 'a-strategy-5',
      imageSource: 'https://example.com/test.jpg',
      artType: 'painting',
      storedResult: buildStoredResult(),
      jimpDurationMs: 100,
      gradingProfile: makeProfile(),
      recentOverallAvg: 85, // guidance
    });
    expect(result.issueMarkers).toHaveLength(4);
    expect(result.issueMarkers?.filter((m) => m.type === 'critical')).toHaveLength(1);
    // 降级的 critical 不再携带 high 严重度
    expect(result.issueMarkers?.every((m) => m.type !== 'critical' || m.severity === 'high')).toBe(
      true,
    );
  });

  it('无档案时 AI 返回标注 → 后处理不介入(现状 8 个基线)', async () => {
    const markers = Array.from({ length: 5 }, (_, i) => ({
      x: 0.1 * i,
      y: 0.1,
      w: 0.04,
      h: 0.05,
      type: 'critical',
      label: `M${i}`,
      severity: 'high',
      improvement_hint: 'H',
    }));
    enableAI(buildContent({ overallScore: 60, issueMarkers: markers }));
    const result = await runAIEnhance({
      analysisId: 'a-strategy-6',
      imageSource: 'https://example.com/test.jpg',
      artType: 'painting',
      storedResult: buildStoredResult(),
      jimpDurationMs: 100,
    });
    // 无 feedbackMode → applyMarkerBudget 原样返回,5 个 critical 全保留
    expect(result.issueMarkers).toHaveLength(5);
    expect(result.issueMarkers?.filter((m) => m.type === 'critical')).toHaveLength(5);
  });
});

// ============================================================
// 9. 批次④:档位估算(mapScoreToTier 边界 + merge 透传 + prompt 模板)
// ============================================================

describe('mapScoreToTier(批次④ 档位映射,降序区间查找)', () => {
  // 与 makeProfile.tierMapping 同构(A:90/B:80/C:70/D:60/E:0)
  const mapping = [
    { key: 'A', min: 90 },
    { key: 'B', min: 80 },
    { key: 'C', min: 70 },
    { key: 'D', min: 60 },
    { key: 'E', min: 0 },
  ];

  it('档位线边界:90→A、89.9→B(线含左值)', () => {
    expect(mapScoreToTier(90, mapping)).toBe('A');
    expect(mapScoreToTier(89.9, mapping)).toBe('B');
  });

  it('区间中段:85→B、84.9→B(checklist 边界用例)', () => {
    expect(mapScoreToTier(85, mapping)).toBe('B');
    expect(mapScoreToTier(84.9, mapping)).toBe('B');
  });

  it('各档下界命中:80→B、70→C、60→D、0→E', () => {
    expect(mapScoreToTier(80, mapping)).toBe('B');
    expect(mapScoreToTier(70, mapping)).toBe('C');
    expect(mapScoreToTier(60, mapping)).toBe('D');
    expect(mapScoreToTier(0, mapping)).toBe('E');
  });

  it('低于末档线(数据异常防御)→ 末档 key 兜底', () => {
    // 末档 min=0 时不可达;构造无 0 兜底档的异常 mapping 验证防御分支
    const abnormal = [
      { key: 'A', min: 90 },
      { key: 'B', min: 80 },
    ];
    expect(mapScoreToTier(50, abnormal)).toBe('B');
  });

  it('空 mapping / NaN → undefined', () => {
    expect(mapScoreToTier(85, [])).toBeUndefined();
    expect(mapScoreToTier(Number.NaN, mapping)).toBeUndefined();
  });

  it('四档租户映射(A:85/B:75/C:65/D:55,spec §4.1)→ 85→A、84.9→B', () => {
    const tenantMapping = [
      { key: 'A', min: 85 },
      { key: 'B', min: 75 },
      { key: 'C', min: 65 },
      { key: 'D', min: 55 },
    ];
    expect(mapScoreToTier(85, tenantMapping)).toBe('A');
    expect(mapScoreToTier(84.9, tenantMapping)).toBe('B');
    expect(mapScoreToTier(74.9, tenantMapping)).toBe('C');
  });
});

describe('buildSystemPrompt 档位估算模板(批次④)', () => {
  it('teaching 深度 JSON 模板含 grade_tier_estimate 字段与诚实性要求', () => {
    const system = buildSystemPrompt('painting');
    expect(system).toContain('"grade_tier_estimate"');
    expect(system).toContain('诚实性要求:这是估算而非评级');
  });

  it('exam 深度 JSON 模板同样注入(阅卷口吻下仍为估算语义)', () => {
    const system = buildSystemPrompt('painting', 'exam', 'sketch');
    expect(system).toContain('"grade_tier_estimate"');
  });
});

describe('runAIEnhance 档位估算输出层(批次④)', () => {
  /** 开启 AI 并 mock 成功响应 */
  function enableAI(content: string) {
    aiEnvState.aiEnabled = true;
    aiEnvState.aiApiKey = 'test-key';
    vi.mocked(axios.post).mockResolvedValueOnce(buildGlmResponse(content));
  }

  it('AI 返回 grade_tier_estimate → tierEstimate 直采(± 细分 tier 原样保留)', async () => {
    enableAI(
      buildContent({
        overallScore: 76,
        gradeTierEstimate: { tier: 'C+', note: '造型支撑三档上限,色彩偏弱,±1档' },
      }),
    );
    const result = await runAIEnhance({
      analysisId: 'a-tier-1',
      imageSource: 'https://example.com/test.jpg',
      artType: 'painting',
      storedResult: buildStoredResult(),
      jimpDurationMs: 100,
      gradingProfile: makeProfile(),
    });
    expect(result.tierEstimate).toEqual({
      tier: 'C+',
      estimated: true,
      note: '造型支撑三档上限,色彩偏弱,±1档',
    });
  });

  it('AI 未返回 + 档案 → 按综合分换算(82→B,note 带换算来源与 ±1 档)', async () => {
    enableAI(buildContent({ overallScore: 82 }));
    const result = await runAIEnhance({
      analysisId: 'a-tier-2',
      imageSource: 'https://example.com/test.jpg',
      artType: 'painting',
      storedResult: buildStoredResult(),
      jimpDurationMs: 100,
      gradingProfile: makeProfile(),
    });
    expect(result.tierEstimate).toEqual({
      tier: 'B',
      estimated: true,
      note: '按档案档位线换算,±1档',
    });
  });

  it('AI 返回非法 grade_tier_estimate(tier 空串)→ 解析降级后走档案换算兜底', async () => {
    enableAI(
      buildContent({
        overallScore: 65,
        gradeTierEstimate: { tier: '  ', note: 'x' },
      }),
    );
    const result = await runAIEnhance({
      analysisId: 'a-tier-3',
      imageSource: 'https://example.com/test.jpg',
      artType: 'painting',
      storedResult: buildStoredResult(),
      jimpDurationMs: 100,
      gradingProfile: makeProfile(),
    });
    // 65 → D 档(60-69)
    expect(result.tierEstimate).toEqual({
      tier: 'D',
      estimated: true,
      note: '按档案档位线换算,±1档',
    });
  });

  it('AI 未返回 + 无档案 → tierEstimate undefined(前端不渲染,现状行为)', async () => {
    enableAI(buildContent({ overallScore: 82 }));
    const result = await runAIEnhance({
      analysisId: 'a-tier-4',
      imageSource: 'https://example.com/test.jpg',
      artType: 'painting',
      storedResult: buildStoredResult(),
      jimpDurationMs: 100,
    });
    expect(result.tierEstimate).toBeUndefined();
  });

  it('AI 返回估算但无综合分时仍直采(AI 判断不依赖换算层)', async () => {
    enableAI(
      buildContent({
        gradeTierEstimate: { tier: 'B-' },
      }),
    );
    const result = await runAIEnhance({
      analysisId: 'a-tier-5',
      imageSource: 'https://example.com/test.jpg',
      artType: 'painting',
      storedResult: buildStoredResult(),
      jimpDurationMs: 100,
      gradingProfile: makeProfile(),
    });
    // note 缺失 → schema 层 '±1档' 兜底
    expect(result.tierEstimate).toEqual({
      tier: 'B-',
      estimated: true,
      note: '±1档',
    });
  });
});

// ============================================================
// 6. 批次⑥:客观检测阈值并入档案(阶段 2 重判定 → prompt/落库联动)
// ============================================================

describe('批次⑥:档案客观检测阈值重判定注入', () => {
  /** 开启 AI 并 mock 成功响应(照批次③ describe 内同名局部函数) */
  function enableAI(content: string) {
    aiEnvState.aiEnabled = true;
    aiEnvState.aiApiKey = 'test-key';
    vi.mocked(axios.post).mockResolvedValueOnce(buildGlmResponse(content));
  }

  /** 取 axios 请求体(单次调用,照批次③ describe 内同名局部函数) */
  function getRequestBody(): {
    system: string;
    user: string;
  } {
    const call = vi.mocked(axios.post).mock.calls[0]!;
    const body = call[1] as {
      messages: Array<{ role: string; content: unknown }>;
    };
    const system = body.messages[0]!.content as string;
    const userContent = body.messages[1]!.content as Array<{ type: string; text: string }>;
    const user = userContent.find((c) => c.type === 'text')!.text;
    return { system, user };
  }

  /** 构造带 objectiveChecks 的阶段 1 结果(grayness warn:利用率 35%) */
  function buildStoredWithChecks(): HybridAnalysisResult {
    const base = buildStoredResult();
    return {
      ...base,
      objectiveChecks: {
        luminanceScale: {
          histogram: new Array<number>(16).fill(1 / 16),
          min: 85,
          max: 175,
          utilization: 0.35,
        },
        checks: [
          {
            id: 'grayness',
            label: '画面灰检测',
            status: 'warn',
            value: '明度范围 85-175,标尺利用率 35%(理论 0-255)',
            detail: 'd',
            suggestion: 's',
          },
          {
            id: 'contrast',
            label: '对比度检测',
            status: 'pass',
            value: 'Michelson 对比度 0.4',
            detail: 'd',
            suggestion: 's',
          },
          {
            id: 'saturation',
            label: '饱和度检测',
            status: 'pass',
            value: '72% 像素处于低饱和区',
            detail: 'd',
            suggestion: 's',
          },
          {
            id: 'focus',
            label: '构图重心检测',
            status: 'pass',
            value: '视觉重心 (58%, 50%)',
            detail: 'd',
            suggestion: 's',
          },
        ],
      },
    };
  }

  it('重判定版随 runAIEnhance 流入 prompt OBJECTIVE_DATA 与落库结果(全链路联动)', async () => {
    enableAI(buildContent({ overallScore: 80 }));
    // 模拟 analysis.service.applyProfileObjectiveThresholds 的产出
    // (档案 graynessUtil=0.3:35% 利用率 ≥ 30% → pass,阶段 1 默认 0.5 判 warn)
    const stored = buildStoredWithChecks();
    const effective: HybridAnalysisResult = {
      ...stored,
      objectiveChecks: rejudgeObjectiveChecks(stored.objectiveChecks!, {
        graynessUtil: 0.3,
        contrastMichelson: 0.35,
        saturationLow: 0.75,
        focusOffset: 0.18,
      }),
    };
    const result = await runAIEnhance({
      analysisId: 'a-objthresh-1',
      imageSource: 'https://example.com/test.jpg',
      artType: 'painting',
      storedResult: effective,
      jimpDurationMs: 100,
    });
    // prompt 联动:OBJECTIVE_DATA 段引用重判定后的「通过」结论(原为 warn)
    const { user } = getRequestBody();
    expect(user).toContain('画面灰检测:明度范围 85-175,标尺利用率 35% → 判定:通过');
    // 落库联动:merged.objectiveChecks 即重判定版(带按本校标准标记)
    expect(result.objectiveChecks?.checks[0]!.status).toBe('pass');
    expect(result.objectiveChecks?.profileThresholdsApplied).toBe(true);
    expect(result.aiEnhanced).toBe(true);
  });
});
