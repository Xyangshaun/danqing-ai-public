// ============================================================
// ai-analysis.service 合并 4 维度评分测试(阶段 G,Task 21.2)
// 对应源码: src/services/ai-analysis.service.ts
//   - mergeResults(合并 Jimp + AI → HybridAnalysisResult)
//   - applyDeepDimensionWeighting(4 维度参与 overallScore 加权,≥2 维度才加权)
//   - DEEP_DIMENSION_WEIGHT(按 evaluationStage 差异化权重)
//
// 测试范围:
//   21.2a 合并 4 维度评分到 HybridAnalysisResult 顶层
//   21.2b overallScore 加权(≥2 维度才加权,权重按 evaluationStage)
//   21.2c <2 维度时不加权(返回原 overallScore)
//   21.2d 权重按 evaluationStage 差异(enthusiast 0.15 < master 0.25)
//   21.2e scoreCriteria/issueMarkers/evaluationStage 透传到顶层
//   21.2f effectiveStage 优先 AI 回显值(> 请求值)
//
// Mock 策略(与 ai-vision.service.test.ts 一致):
//   - vi.mock('axios') + vi.mock('../src/config/env.js')
//   - runHybridAnalysis(AI enabled)→ mock axios 返回含深度字段的 content
//   - overall_delta=0,使 base overallScore = Jimp 原始分(便于加权公式验证)
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ============================================================
// 1. vi.hoisted:AI 环境变量覆盖状态
// ============================================================
const { aiEnvState } = vi.hoisted(() => ({
  aiEnvState: {
    aiEnabled: false,
    aiApiKey: '',
    aiApiUrl: 'https://test-ai-api.example.com/v1/chat/completions',
    aiApiTimeout: 2500,
    aiApiModel: 'glm-4v-flash-test',
    traeApiKey: '',
    traeApiUrl: '',
    traeApiModel: '',
    aiProvider: 'glm' as const,
  },
}));

vi.mock('axios', () => ({ default: { post: vi.fn() } }));

vi.mock('../src/config/env.js', () => {
  const staticConfig = {
    feishuAppId: 'cli_test_app_id',
    feishuAppSecret: 'test_app_secret_value',
    feishuRedirectUriWeb: 'http://localhost:5173/auth/feishu/callback',
    feishuRedirectUriAdmin: 'http://localhost:3001/auth/feishu/callback',
    feishuRedirectUriMobile: 'http://localhost:8081/auth/feishu/callback',
    feishuAuthzEndpoint: 'https://open.feishu.cn/open-apis/authen/v1/authorize',
    feishuTokenEndpoint: 'https://open.feishu.cn/open-apis/authen/v1/oidc/access_token',
    feishuUserinfoEndpoint: 'https://open.feishu.cn/open-apis/authen/v1/user_info',
    jwtPrivateKey: 'test-private-key',
    jwtPublicKey: 'test-public-key',
    jwtKeyId: 'test-kid-2026',
    jwtIssuer: 'danqing-ai-auth',
    jwtAudienceWeb: 'danqing-ai-web',
    jwtAudienceAdmin: 'danqing-ai-admin',
    jwtAudienceMobile: 'danqing-ai-mobile',
    jwtAccessExpires: '15m',
    jwtRefreshExpires: '7d',
    cookieSecure: false,
    cookieDomain: '',
    cookieSameSite: 'strict' as const,
    cookiePath: '/auth',
    cookieMaxAge: 604800,
    databaseUrl: 'postgresql://test:test@localhost:5432/test',
    redisUrl: 'redis://localhost:6379',
    corsOrigins: ['http://localhost:5173', 'http://localhost:3001'],
    rateLimitAuthPerMin: 10,
    rateLimitCallbackPerMin: 5,
    rateLimitRefreshPerMin: 20,
    rateLimitApiPerMin: 60,
    tenantDefaultPlan: 'free' as const,
    tenantDefaultType: 'individual' as const,
    enableHsts: false,
    logLevel: 'error' as const,
    nodeEnv: 'test' as const,
    port: 3000,
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
import { runHybridAnalysis } from '../src/services/ai-analysis.service.js';
import type { EvaluationStage } from '../src/types/ai-analysis.js';

// ============================================================
// 辅助:构造 AI 响应 content(overall_delta=0,深度字段可选注入)
// ============================================================

/** 构造 AI 响应 content;deepDims 控制是否注入 4 维度;overallScore/dimensionScores 为批次④绝对分 */
function buildContent(opts: {
  deepDims?: { originality?: number; completeness?: number; emotion?: number; craftsmanship?: number };
  evaluationStage?: EvaluationStage;
  scoreCriteria?: unknown[];
  issueMarkers?: unknown[];
  overallDelta?: number;
  /** 批次④:AI 绝对综合分(注入 overall_score) */
  overallScore?: number;
  /** 批次④:AI 各标准维度绝对分(注入 dimension_scores) */
  dimensionScores?: Array<{ dimension: string; score: number }>;
}): string {
  const d = opts.deepDims ?? {};
  return JSON.stringify({
    semantic_theme: '静物画构图均衡,色彩温暖。',
    style_recognition: '古典写实',
    professional_suggestions: [],
    score_adjustments: {
      dimension_adjustments: [],
      overall_delta: opts.overallDelta ?? 0,
      overall_reason: '',
    },
    reference_artworks: [],
    // 批次④:AI 绝对评分(merge 直采;缺失时深度维度均值兜底)
    ...(opts.overallScore !== undefined ? { overall_score: opts.overallScore } : {}),
    ...(opts.dimensionScores ? { dimension_scores: opts.dimensionScores } : {}),
    ...(d.originality !== undefined
      ? { originality_and_style: { score: d.originality, analysis: '原创性', suggestion: '建议' } }
      : {}),
    ...(d.completeness !== undefined
      ? { completeness_and_rhythm: { score: d.completeness, analysis: '完整度', suggestion: '建议' } }
      : {}),
    ...(d.emotion !== undefined
      ? { emotion_and_mood: { score: d.emotion, analysis: '情感', suggestion: '建议' } }
      : {}),
    ...(d.craftsmanship !== undefined
      ? { craftsmanship: { score: d.craftsmanship, analysis: '工艺', suggestion: '建议' } }
      : {}),
    ...(opts.evaluationStage ? { evaluation_stage: opts.evaluationStage } : {}),
    ...(opts.scoreCriteria ? { score_criteria: opts.scoreCriteria } : {}),
    ...(opts.issueMarkers ? { issue_markers: opts.issueMarkers } : {}),
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

describe('ai-analysis mergeResults 4 维度合并 (Task 21.2)', () => {
  describe('4 维度评分合并到顶层', () => {
    it('should_merge_four_dimensions_to_hybrid_result_top_level', async () => {
      aiEnvState.aiEnabled = true;
      aiEnvState.aiApiKey = 'test-key';
      vi.mocked(axios.post).mockResolvedValue(
        buildGlmResponse(
          buildContent({
            deepDims: { originality: 82, completeness: 76, emotion: 70, craftsmanship: 88 },
          }),
        ),
      );

      const result = await runHybridAnalysis({
        imageSource: 'https://example.com/test.jpg',
        artType: 'painting',
      });

      expect(result.aiEnhanced).toBe(true);
      // 4 维度评分透传到 HybridAnalysisResult 顶层(冗余自 aiVisionResult)
      expect(result.aiVisionResult?.originalityAndStyle?.score).toBe(82);
      expect(result.aiVisionResult?.completenessAndRhythm?.score).toBe(76);
      expect(result.aiVisionResult?.emotionAndMood?.score).toBe(70);
      expect(result.aiVisionResult?.craftsmanship?.score).toBe(88);
    });

    it('should_passthrough_score_criteria_and_issue_markers_and_stage_to_top_level', async () => {
      aiEnvState.aiEnabled = true;
      aiEnvState.aiApiKey = 'test-key';
      vi.mocked(axios.post).mockResolvedValue(
        buildGlmResponse(
          buildContent({
            evaluationStage: 'academy',
            scoreCriteria: [
              {
                dimension: '构图',
                weight: 0.5,
                level: 'good',
                met_criteria: ['均衡'],
                unmet_criteria: [],
                evidence: '重心 x=0.45',
              },
            ],
            issueMarkers: [
              { x: 0.1, y: 0.2, w: 0.3, h: 0.4, label: 'L', severity: 'high', improvement_hint: 'H' },
            ],
          }),
        ),
      );

      const result = await runHybridAnalysis({
        imageSource: 'https://example.com/test.jpg',
        artType: 'painting',
      });

      // 顶层冗余拷贝,便于前端直接读取
      expect(result.evaluationStage).toBe('academy');
      expect(result.scoreCriteria).toHaveLength(1);
      expect(result.scoreCriteria?.[0]?.dimension).toBe('构图');
      expect(result.issueMarkers).toHaveLength(1);
      expect(result.issueMarkers?.[0]?.label).toBe('L');
    });
  });

  describe('overallScore 绝对分直采与兜底(批次④:替代假分底+delta+加权)', () => {
    /**
       * 批次④新语义:综合分优先级 = AI 绝对分 > 4 深度维度均值(≥2 个) > 标准维度绝对分均值(≥2 个) > null
       * Jimp 基分不再参与 AI 增强结果的综合分
       */
    it('should_use_ai_absolute_overall_score_when_provided', async () => {
      aiEnvState.aiEnabled = true;
      aiEnvState.aiApiKey = 'test-key';

      // AI 输出 overall_score=88 + 4 个低分深度维度 → 绝对分优先,深度维度不参与
      vi.mocked(axios.post).mockResolvedValueOnce(
        buildGlmResponse(
          buildContent({
            overallScore: 88,
            deepDims: { originality: 20, completeness: 20, emotion: 20, craftsmanship: 20 },
          }),
        ),
      );
      const result = await runHybridAnalysis({
        imageSource: 'https://example.com/test.jpg',
        artType: 'painting',
      });

      expect(result.overallScore).toBe(88);
    });

    it('should_fallback_to_deep_dimension_avg_when_overall_score_missing', async () => {
      aiEnvState.aiEnabled = true;
      aiEnvState.aiApiKey = 'test-key';

      // 无 overall_score,4 个深度维度全 20 → 均值兜底 = 20
      vi.mocked(axios.post).mockResolvedValueOnce(
        buildGlmResponse(
          buildContent({ deepDims: { originality: 20, completeness: 20, emotion: 20, craftsmanship: 20 } }),
        ),
      );
      const result = await runHybridAnalysis({
        imageSource: 'https://example.com/test.jpg',
        artType: 'painting',
      });

      expect(result.overallScore).toBe(20);
    });

    it('should_return_null_when_no_absolute_and_fewer_than_two_deep_dims', async () => {
      aiEnvState.aiEnabled = true;
      aiEnvState.aiApiKey = 'test-key';

      // 无绝对分 + 仅 1 个深度维度(<2 不兜底)→ 无可评分来源 → null(诚实无分,不造假)
      vi.mocked(axios.post).mockResolvedValueOnce(
        buildGlmResponse(buildContent({ deepDims: { originality: 10 } })),
      );
      const result = await runHybridAnalysis({
        imageSource: 'https://example.com/test.jpg',
        artType: 'painting',
      });

      expect(result.overallScore).toBeNull();
    });

    it('should_fallback_to_dimension_scores_avg_when_only_dimension_scores', async () => {
      aiEnvState.aiEnabled = true;
      aiEnvState.aiApiKey = 'test-key';

      // 无 overall_score/深度维度,但有 3 个标准维度绝对分 → 均值兜底 (80+70+60)/3 = 70
      vi.mocked(axios.post).mockResolvedValueOnce(
        buildGlmResponse(
          buildContent({
            dimensionScores: [
              { dimension: '构图', score: 80 },
              { dimension: '色彩', score: 70 },
              { dimension: '笔触', score: 60 },
            ],
          }),
        ),
      );
      const result = await runHybridAnalysis({
        imageSource: 'https://example.com/test.jpg',
        artType: 'painting',
      });

      expect(result.overallScore).toBe(70);
    });
  });

  describe('evaluationStage 不再影响综合分(批次④:删除深度加权)', () => {
    /**
       * 批次④:AI 绝对分直采后,evaluationStage 仅作为评分参照系注入 prompt,
       * 不再参与综合分计算——相同 AI 输出在不同 stage 下综合分一致
       */
    it('should_keep_same_overall_score_across_stages_for_identical_ai_output', async () => {
      aiEnvState.aiEnabled = true;
      aiEnvState.aiApiKey = 'test-key';

      // 相同 AI 输出(overall_score=90),仅请求 evaluationStage 不同
      vi.mocked(axios.post).mockResolvedValue(
        buildGlmResponse(buildContent({ overallScore: 90 })),
      );
      const enthusiast = await runHybridAnalysis({
        imageSource: 'https://example.com/test.jpg',
        artType: 'painting',
        evaluationStage: 'enthusiast',
      });

      vi.mocked(axios.post).mockResolvedValue(
        buildGlmResponse(buildContent({ overallScore: 90 })),
      );
      const master = await runHybridAnalysis({
        imageSource: 'https://example.com/test.jpg',
        artType: 'painting',
        evaluationStage: 'master',
      });

      expect(enthusiast.overallScore).toBe(90);
      expect(master.overallScore).toBe(90);
    });
  });

  describe('effectiveStage 优先级(AI 回显 > 请求值)', () => {
    it('should_prefer_ai_echoed_evaluation_stage_over_request_param', async () => {
      aiEnvState.aiEnabled = true;
      aiEnvState.aiApiKey = 'test-key';
      // 请求 evaluationStage=enthusiast,AI 回显 evaluation_stage=master
      vi.mocked(axios.post).mockResolvedValue(
        buildGlmResponse(
          buildContent({
            evaluationStage: 'master',
            deepDims: { originality: 50, completeness: 50 },
          }),
        ),
      );

      const result = await runHybridAnalysis({
        imageSource: 'https://example.com/test.jpg',
        artType: 'painting',
        evaluationStage: 'enthusiast',
      });

      // effectiveStage = aiVision.evaluationStage ?? evaluationStage → master
      expect(result.evaluationStage).toBe('master');
      expect(result.aiVisionResult?.evaluationStage).toBe('master');
    });

    it('should_fallback_to_request_stage_when_ai_does_not_echo', async () => {
      aiEnvState.aiEnabled = true;
      aiEnvState.aiApiKey = 'test-key';
      // AI 不回显 evaluation_stage → 回退请求值 unified
      vi.mocked(axios.post).mockResolvedValue(
        buildGlmResponse(buildContent({ deepDims: { originality: 50, completeness: 50 } })),
      );

      const result = await runHybridAnalysis({
        imageSource: 'https://example.com/test.jpg',
        artType: 'painting',
        evaluationStage: 'unified',
      });

      expect(result.evaluationStage).toBe('unified');
    });

    it('should_default_to_undefined_when_neither_ai_nor_request_provides_stage', async () => {
      aiEnvState.aiEnabled = true;
      aiEnvState.aiApiKey = 'test-key';
      vi.mocked(axios.post).mockResolvedValue(
        buildGlmResponse(buildContent({ deepDims: { originality: 50, completeness: 50 } })),
      );

      const result = await runHybridAnalysis({
        imageSource: 'https://example.com/test.jpg',
        artType: 'painting',
      });

      expect(result.evaluationStage).toBeUndefined();
    });
  });

  describe('featureFingerprint 生成(Task 6.3)', () => {
    it('should_attach_feature_fingerprint_to_merged_result', async () => {
      aiEnvState.aiEnabled = true;
      aiEnvState.aiApiKey = 'test-key';
      vi.mocked(axios.post).mockResolvedValue(
        buildGlmResponse(buildContent({ deepDims: { originality: 50, completeness: 50 } })),
      );

      const result = await runHybridAnalysis({
        imageSource: 'https://example.com/test.jpg',
        artType: 'painting',
      });

      // 特征指纹由 Jimp 客观指标生成(AI 不参与),供去同质化与历史对比
      expect(result.featureFingerprint).toBeDefined();
      expect(result.featureFingerprint?.metricsSnapshot).toBeDefined();
      expect(typeof result.featureFingerprint?.metricsSnapshot.focusX).toBe('number');
      expect(result.featureFingerprint?.generatedAt).toBeDefined();
    });
  });
});
