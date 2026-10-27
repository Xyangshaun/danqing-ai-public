// ============================================================
// 深度分析 Zod Schema 校验 + 旧数据降级测试(阶段 G,Task 21.1 / 21.4)
// 对应源码: src/services/ai-vision.service.ts
//   - depthDimensionScoreSchema / scoreCriteriaSchema / issueMarkerSchema
//   - aiVisionResultSchema(完整 AI 响应;新字段全部可选,缺失降级为 undefined)
//   - normalizeEvaluationStage / parseDepthDimensionScore / parseScoreCriteriaArray / parseIssueMarkersArray
//
// 测试范围:
//   21.1 Zod schema 校验(4 维度/ScoreCriteria/IssueMarker/EvaluationStage)
//     - AI 响应含新字段时正确解析(score/weight/坐标 clamp、枚举校验、上限裁剪)
//     - 枚举非法值降级(level→average / severity→medium / evaluationStage→undefined)
//   21.4 旧数据无新字段时默认值降级
//     - 旧 prompt 不返回新字段 → 字段为 undefined,不报错(向后兼容)
//     - 空 scoreCriteria/issueMarkers 数组 → 降级为 undefined
//
// Mock 策略(与 ai-vision.service.test.ts 一致):
//   - vi.mock('axios'):拦截 GLM-4V API 调用,控制响应 content
//   - vi.mock('../src/config/env.js'):允许 per-test 配置 AI_ENABLED / AI_API_KEY
//   - Jimp mock 由 setup.ts 全局注册
//   - Zod schema 未导出,通过 analyzeWithAI(成功路径)间接验证 schema 行为
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

// ============================================================
// 2. vi.mock:axios(拦截 GLM-4V API 调用)
// ============================================================
vi.mock('axios', () => ({
  default: {
    post: vi.fn(),
  },
}));

// ============================================================
// 3. vi.mock:env(与 ai-vision.service.test.ts 同款静态 + 动态合并)
// ============================================================
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
  return {
    env: () => buildEnv(),
    initEnv: () => buildEnv(),
    loadEnv: () => buildEnv(),
  };
});

// ============================================================
// 4. Imports(mock 声明后导入)
// ============================================================
import axios from 'axios';
import { analyzeWithAI } from '../src/services/ai-vision.service.js';
import type { AIVisionRequest } from '../src/types/ai-analysis.js';
import type { ArtType } from '../src/types/api-contract.js';

// ============================================================
// 5. 辅助函数:构造测试数据
// ============================================================

/** 构造最小有效 AI 响应(旧 prompt 格式,不含新字段) */
function buildLegacyContent(overrides?: Record<string, unknown>): string {
  return JSON.stringify({
    semantic_theme: '静物画传统构图,色彩温暖。',
    style_recognition: '古典写实',
    professional_suggestions: [],
    score_adjustments: { dimension_adjustments: [], overall_delta: 0, overall_reason: '' },
    reference_artworks: [],
    ...overrides,
  });
}

/** 将 content 包装为 GLM-4V API 响应格式 */
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

/** 构造基本 AIVisionRequest(URL 模式,避免文件系统访问) */
function buildAiRequest(overrides?: Partial<AIVisionRequest>): AIVisionRequest {
  return {
    imageSource: 'https://example.com/test-painting.jpg',
    artType: 'painting' as ArtType,
    jimpMetrics: {
      focusX: 0.5,
      focusY: 0.5,
      whitespaceRatio: 0.35,
      warmRatio: 0.6,
      coolRatio: 0.4,
      dominantColor: '暖红色',
      avgLuminance: 128,
      avgSaturation: 45,
      contrast: 'medium',
      textureComplexity: 0.5,
      edgeDensity: 0.12,
    },
    ...overrides,
  };
}

/** 构造完整深度维度对象(snake_case,模拟 AI 输出) */
function buildDepthDimension(score: number, analysis = '画面构图均衡,主体落于黄金分割点。', suggestion = '将主体向左偏移强化动势。') {
  return { score, analysis, suggestion };
}

// ============================================================
// 6. 全局 beforeEach:重置 mock 状态
// ============================================================
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
// Task 21.1:Zod schema 校验(4 维度 / ScoreCriteria / IssueMarker / EvaluationStage)
// ============================================================
describe('ai-vision depth schema (Task 21.1)', () => {
  describe('4 深度维度评分解析', () => {
    it('should_parse_four_depth_dimensions_when_all_present', async () => {
      aiEnvState.aiApiKey = 'test-key';
      const content = buildLegacyContent({
        originality_and_style: buildDepthDimension(82, '原创性分析', '建议 A'),
        completeness_and_rhythm: buildDepthDimension(76, '完整度分析', '建议 B'),
        emotion_and_mood: buildDepthDimension(70, '情感分析', '建议 C'),
        craftsmanship: buildDepthDimension(88, '工艺分析', '建议 D'),
      });
      vi.mocked(axios.post).mockResolvedValue(buildGlmResponse(content));

      const result = await analyzeWithAI(buildAiRequest());

      expect(result.success).toBe(true);
      expect(result.result?.originalityAndStyle).toMatchObject({
        score: 82,
        analysis: '原创性分析',
        suggestion: '建议 A',
      });
      expect(result.result?.completenessAndRhythm?.score).toBe(76);
      expect(result.result?.emotionAndMood?.score).toBe(70);
      expect(result.result?.craftsmanship?.score).toBe(88);
    });

    it('should_clamp_score_to_0_when_negative', async () => {
      aiEnvState.aiApiKey = 'test-key';
      const content = buildLegacyContent({
        originality_and_style: buildDepthDimension(-20),
      });
      vi.mocked(axios.post).mockResolvedValue(buildGlmResponse(content));

      const result = await analyzeWithAI(buildAiRequest());

      expect(result.success).toBe(true);
      expect(result.result?.originalityAndStyle?.score).toBe(0);
    });

    it('should_clamp_score_to_100_when_exceeds_max', async () => {
      aiEnvState.aiApiKey = 'test-key';
      const content = buildLegacyContent({
        originality_and_style: buildDepthDimension(150),
      });
      vi.mocked(axios.post).mockResolvedValue(buildGlmResponse(content));

      const result = await analyzeWithAI(buildAiRequest());

      expect(result.success).toBe(true);
      expect(result.result?.originalityAndStyle?.score).toBe(100);
    });

    it('should_default_score_to_0_when_non_numeric', async () => {
      aiEnvState.aiApiKey = 'test-key';
      const content = buildLegacyContent({
        originality_and_style: { score: '不是数字', analysis: '文本', suggestion: '建议' },
      });
      vi.mocked(axios.post).mockResolvedValue(buildGlmResponse(content));

      const result = await analyzeWithAI(buildAiRequest());

      expect(result.success).toBe(true);
      expect(result.result?.originalityAndStyle?.score).toBe(0);
      expect(result.result?.originalityAndStyle?.analysis).toBe('文本');
    });

    it('should_default_analysis_to_empty_string_when_missing', async () => {
      aiEnvState.aiApiKey = 'test-key';
      // analysis/suggestion 字段缺失 → 降级为空字符串(不报错)
      const content = buildLegacyContent({
        originality_and_style: { score: 80 },
      });
      vi.mocked(axios.post).mockResolvedValue(buildGlmResponse(content));

      const result = await analyzeWithAI(buildAiRequest());

      expect(result.success).toBe(true);
      expect(result.result?.originalityAndStyle?.score).toBe(80);
      expect(result.result?.originalityAndStyle?.analysis).toBe('');
      expect(result.result?.originalityAndStyle?.suggestion).toBe('');
    });
  });

  describe('ScoreCriteria 解析', () => {
    it('should_parse_score_criteria_with_weight_and_level', async () => {
      aiEnvState.aiApiKey = 'test-key';
      const content = buildLegacyContent({
        score_criteria: [
          {
            dimension: '构图与造型',
            weight: 0.3,
            max_score: 100,
            level: 'good',
            met_criteria: ['主体落于黄金分割点', '画面均衡'],
            unmet_criteria: ['视觉动势不足'],
            evidence: '重心 x=0.45 偏左,留白 0.35',
          },
        ],
      });
      vi.mocked(axios.post).mockResolvedValue(buildGlmResponse(content));

      const result = await analyzeWithAI(buildAiRequest());

      expect(result.success).toBe(true);
      const crit = result.result?.scoreCriteria;
      expect(crit).toHaveLength(1);
      expect(crit?.[0]).toMatchObject({
        dimension: '构图与造型',
        weight: 0.3,
        maxScore: 100,
        level: 'good',
        metCriteria: ['主体落于黄金分割点', '画面均衡'],
        unmetCriteria: ['视觉动势不足'],
        evidence: '重心 x=0.45 偏左,留白 0.35',
      });
    });

    it('should_clamp_weight_to_0_1_range', async () => {
      aiEnvState.aiApiKey = 'test-key';
      const content = buildLegacyContent({
        score_criteria: [
          { dimension: 'A', weight: 1.5, level: 'good', met_criteria: [], unmet_criteria: [], evidence: '' },
          { dimension: 'B', weight: -0.3, level: 'good', met_criteria: [], unmet_criteria: [], evidence: '' },
        ],
      });
      vi.mocked(axios.post).mockResolvedValue(buildGlmResponse(content));

      const result = await analyzeWithAI(buildAiRequest());

      expect(result.success).toBe(true);
      expect(result.result?.scoreCriteria?.[0]?.weight).toBe(1);
      expect(result.result?.scoreCriteria?.[1]?.weight).toBe(0);
    });

    it('should_default_maxScore_to_100_when_missing', async () => {
      aiEnvState.aiApiKey = 'test-key';
      const content = buildLegacyContent({
        score_criteria: [
          { dimension: 'A', weight: 0.5, level: 'good', met_criteria: [], unmet_criteria: [], evidence: '' },
        ],
      });
      vi.mocked(axios.post).mockResolvedValue(buildGlmResponse(content));

      const result = await analyzeWithAI(buildAiRequest());

      expect(result.success).toBe(true);
      expect(result.result?.scoreCriteria?.[0]?.maxScore).toBe(100);
    });

    it('should_downgrade_invalid_level_to_average', async () => {
      aiEnvState.aiApiKey = 'test-key';
      const content = buildLegacyContent({
        score_criteria: [
          { dimension: 'A', weight: 0.5, level: 'super', met_criteria: [], unmet_criteria: [], evidence: '' },
        ],
      });
      vi.mocked(axios.post).mockResolvedValue(buildGlmResponse(content));

      const result = await analyzeWithAI(buildAiRequest());

      expect(result.success).toBe(true);
      expect(result.result?.scoreCriteria?.[0]?.level).toBe('average');
    });

    it('should_filter_non_string_items_in_criteria_arrays', async () => {
      aiEnvState.aiApiKey = 'test-key';
      const content = buildLegacyContent({
        score_criteria: [
          {
            dimension: 'A',
            weight: 0.5,
            level: 'good',
            met_criteria: ['有效项', 123, null, '另一项'],
            unmet_criteria: [true, '扣分项'],
            evidence: '',
          },
        ],
      });
      vi.mocked(axios.post).mockResolvedValue(buildGlmResponse(content));

      const result = await analyzeWithAI(buildAiRequest());

      expect(result.success).toBe(true);
      expect(result.result?.scoreCriteria?.[0]?.metCriteria).toEqual(['有效项', '另一项']);
      expect(result.result?.scoreCriteria?.[0]?.unmetCriteria).toEqual(['扣分项']);
    });
  });

  describe('IssueMarker 解析', () => {
    it('should_parse_issue_markers_with_relative_coords', async () => {
      aiEnvState.aiApiKey = 'test-key';
      const content = buildLegacyContent({
        issue_markers: [
          {
            x: 0.1,
            y: 0.2,
            w: 0.3,
            h: 0.4,
            label: '构图偏移',
            severity: 'high',
            improvement_hint: '将主体向左下偏移 1/3',
          },
        ],
      });
      vi.mocked(axios.post).mockResolvedValue(buildGlmResponse(content));

      const result = await analyzeWithAI(buildAiRequest());

      expect(result.success).toBe(true);
      expect(result.result?.issueMarkers).toHaveLength(1);
      expect(result.result?.issueMarkers?.[0]).toMatchObject({
        x: 0.1,
        y: 0.2,
        w: 0.3,
        h: 0.4,
        label: '构图偏移',
        severity: 'high',
        improvementHint: '将主体向左下偏移 1/3',
      });
    });

    it('should_clamp_coords_to_0_1_range', async () => {
      aiEnvState.aiApiKey = 'test-key';
      const content = buildLegacyContent({
        issue_markers: [
          {
            x: -0.5,
            y: 1.5,
            w: 2,
            h: -1,
            label: 'L',
            severity: 'medium',
            improvement_hint: 'H',
          },
        ],
      });
      vi.mocked(axios.post).mockResolvedValue(buildGlmResponse(content));

      const result = await analyzeWithAI(buildAiRequest());

      expect(result.success).toBe(true);
      const m = result.result?.issueMarkers?.[0];
      expect(m?.x).toBe(0);
      expect(m?.y).toBe(1);
      expect(m?.w).toBe(1);
      expect(m?.h).toBe(0);
    });

    it('should_downgrade_invalid_severity_to_medium', async () => {
      aiEnvState.aiApiKey = 'test-key';
      const content = buildLegacyContent({
        issue_markers: [
          { x: 0, y: 0, w: 0.5, h: 0.5, label: 'L', severity: 'critical', improvement_hint: 'H' },
        ],
      });
      vi.mocked(axios.post).mockResolvedValue(buildGlmResponse(content));

      const result = await analyzeWithAI(buildAiRequest());

      expect(result.success).toBe(true);
      expect(result.result?.issueMarkers?.[0]?.severity).toBe('medium');
    });

    it('should_keep_five_issue_markers_under_new_cap_of_eight', async () => {
      aiEnvState.aiApiKey = 'test-key';
      // Phase 1A 契约:锚定卡片式标注上限 3 → 8,5 个(互不重叠)应全部保留
      const markers = Array.from({ length: 5 }, (_, i) => ({
        x: 0.15 * i,
        y: 0.15 * i,
        w: 0.2,
        h: 0.2,
        label: `问题${i + 1}`,
        severity: 'low',
        improvement_hint: `提示${i + 1}`,
      }));
      const content = buildLegacyContent({ issue_markers: markers });
      vi.mocked(axios.post).mockResolvedValue(buildGlmResponse(content));

      const result = await analyzeWithAI(buildAiRequest());

      expect(result.success).toBe(true);
      expect(result.result?.issueMarkers).toHaveLength(5);
    });

    it('should_cap_issue_markers_to_eight_and_prefer_critical_type', async () => {
      aiEnvState.aiApiKey = 'test-key';
      // Phase 1A 契约:上限 8;超量按 critical > suggestion > highlight 优先级截断
      // 前 2 个 severity=high(→critical),后 8 个 severity=low(→highlight) → 保留 2 critical + 6 highlight
      const markers = Array.from({ length: 10 }, (_, i) => ({
        x: 0.1 * i,
        y: 0.1 * i,
        w: 0.2,
        h: 0.2,
        label: `问题${i + 1}`,
        severity: i < 2 ? 'high' : 'low',
        improvement_hint: `提示${i + 1}`,
      }));
      const content = buildLegacyContent({ issue_markers: markers });
      vi.mocked(axios.post).mockResolvedValue(buildGlmResponse(content));

      const result = await analyzeWithAI(buildAiRequest());

      expect(result.success).toBe(true);
      const kept = result.result?.issueMarkers ?? [];
      expect(kept).toHaveLength(8);
      expect(kept.filter((m) => m.type === 'critical')).toHaveLength(2);
    });

    it('should_merge_overlapping_issue_markers_when_iou_at_least_0_45', async () => {
      aiEnvState.aiApiKey = 'test-key';
      // 2026-09-22 标注精度优化:重叠合并阈值由 0.8 收紧为 IoU ≥ 0.45,保留类型优先级更高者
      // m1(low→highlight):[0.1,0.1]-[0.4,0.4] 面积 0.09
      // m2(high→critical):[0.15,0.15]-[0.45,0.45] 面积 0.09
      // 交集 [0.15,0.4]² = 0.0625 / 并集 0.1175 → IoU≈0.532 ≥ 0.45 → 合并
      // 包含率 0.0625/0.09 ≈ 0.69 < 0.8 → 不触发包含合并,走 IoU 合并分支
      const content = buildLegacyContent({
        issue_markers: [
          {
            x: 0.1, y: 0.1, w: 0.3, h: 0.3,
            label: '低严重度标注', severity: 'low', improvement_hint: 'H1',
            why: 'loser 的原理说明',
            how: 'loser 的改法',
          },
          {
            x: 0.15, y: 0.15, w: 0.3, h: 0.3,
            label: '高严重度标注', severity: 'high', improvement_hint: 'H2',
          },
        ],
      });
      vi.mocked(axios.post).mockResolvedValue(buildGlmResponse(content));

      const result = await analyzeWithAI(buildAiRequest());

      expect(result.success).toBe(true);
      const markers = result.result?.issueMarkers ?? [];
      expect(markers).toHaveLength(1);
      // IoU 合并后保留类型优先级更高者(critical > highlight),并继承被合并方的 why/how
      expect(markers[0]).toMatchObject({ label: '高严重度标注', severity: 'high', type: 'critical' });
      expect(markers[0]?.why).toContain('loser 的原理说明');
      expect(markers[0]?.how).toBe('loser 的改法');
    });

    it('should_merge_by_containment_keeping_smaller_edge_fitted_box', async () => {
      aiEnvState.aiApiKey = 'test-key';
      // 2026-09-22 标注精度优化:包含合并(小框被大框覆盖 ≥80%)先于 IoU 合并执行,
      // 保留更贴边的小框(面积相等时保留先入者),而非旧语义的 severity 更高者
      // m1(low→highlight):[0.1,0.1]-[0.4,0.4] 面积 0.09(带 why/how)
      // m2(high→critical):[0.11,0.11]-[0.41,0.41] 面积 0.09
      // 交集 0.0841 / 较小框 0.09 → 包含率≈0.934 ≥ 0.8 → 包含合并
      // 面积相等 → keepSmaller 取先入的 m1,why/how 取非空值(m1 自带)
      const content = buildLegacyContent({
        issue_markers: [
          {
            x: 0.1, y: 0.1, w: 0.3, h: 0.3,
            label: '低严重度标注', severity: 'low', improvement_hint: 'H1',
            why: '小框的原理说明',
            how: '小框的改法',
          },
          {
            x: 0.11, y: 0.11, w: 0.3, h: 0.3,
            label: '高严重度标注', severity: 'high', improvement_hint: 'H2',
          },
        ],
      });
      vi.mocked(axios.post).mockResolvedValue(buildGlmResponse(content));

      const result = await analyzeWithAI(buildAiRequest());

      expect(result.success).toBe(true);
      const markers = result.result?.issueMarkers ?? [];
      expect(markers).toHaveLength(1);
      // 包含合并保留更贴边小框(面积相等时保留先入者),severity 不参与该分支的取舍
      expect(markers[0]).toMatchObject({ label: '低严重度标注', severity: 'low', type: 'highlight' });
      expect(markers[0]?.why).toBe('小框的原理说明');
      expect(markers[0]?.how).toBe('小框的改法');
    });

    it('should_keep_both_issue_markers_when_iou_below_0_45', async () => {
      aiEnvState.aiApiKey = 'test-key';
      // m1:[0.1,0.1]-[0.4,0.4];m2:[0.3,0.3]-[0.6,0.6]
      // 交集 0.01 / 并集 0.17 → IoU≈0.059 < 0.45 → 不合并
      const content = buildLegacyContent({
        issue_markers: [
          { x: 0.1, y: 0.1, w: 0.3, h: 0.3, label: '标注甲', severity: 'low', improvement_hint: 'H1' },
          { x: 0.3, y: 0.3, w: 0.3, h: 0.3, label: '标注乙', severity: 'high', improvement_hint: 'H2' },
        ],
      });
      vi.mocked(axios.post).mockResolvedValue(buildGlmResponse(content));

      const result = await analyzeWithAI(buildAiRequest());

      expect(result.success).toBe(true);
      expect(result.result?.issueMarkers).toHaveLength(2);
    });
  });

  describe('EvaluationStage 解析', () => {
    it('should_normalize_valid_evaluation_stage_case_insensitive', async () => {
      aiEnvState.aiApiKey = 'test-key';
      const content = buildLegacyContent({ evaluation_stage: 'MASTER' });
      vi.mocked(axios.post).mockResolvedValue(buildGlmResponse(content));

      const result = await analyzeWithAI(buildAiRequest());

      expect(result.success).toBe(true);
      expect(result.result?.evaluationStage).toBe('master');
    });

    it('should_return_all_six_valid_stages', async () => {
      aiEnvState.aiApiKey = 'test-key';
      const stages = ['enthusiast', 'intermediate', 'advanced', 'unified', 'academy', 'master'];
      for (const stage of stages) {
        vi.mocked(axios.post).mockResolvedValueOnce(
          buildGlmResponse(buildLegacyContent({ evaluation_stage: stage })),
        );
        const result = await analyzeWithAI(buildAiRequest());
        expect(result.success).toBe(true);
        expect(result.result?.evaluationStage).toBe(stage);
      }
    });

    it('should_downgrade_invalid_evaluation_stage_to_undefined', async () => {
      aiEnvState.aiApiKey = 'test-key';
      const content = buildLegacyContent({ evaluation_stage: 'unknown_stage' });
      vi.mocked(axios.post).mockResolvedValue(buildGlmResponse(content));

      const result = await analyzeWithAI(buildAiRequest());

      expect(result.success).toBe(true);
      expect(result.result?.evaluationStage).toBeUndefined();
    });
  });
});

// ============================================================
// Task 21.4:旧数据无新字段时默认值降级
// ============================================================
describe('ai-vision depth downgrade for legacy data (Task 21.4)', () => {
  it('should_parse_successfully_when_no_new_fields_present', async () => {
    // 旧 prompt 格式:无 evaluation_stage/4维度/score_criteria/issue_markers
    aiEnvState.aiApiKey = 'test-key';
    vi.mocked(axios.post).mockResolvedValue(buildGlmResponse(buildLegacyContent()));

    const result = await analyzeWithAI(buildAiRequest());

    // 解析成功(向后兼容,不报错)
    expect(result.success).toBe(true);
    expect(result.result).not.toBeNull();
    expect(result.failureReason).toBeNull();
  });

  it('should_default_all_depth_fields_to_undefined_when_absent', async () => {
    aiEnvState.aiApiKey = 'test-key';
    vi.mocked(axios.post).mockResolvedValue(buildGlmResponse(buildLegacyContent()));

    const result = await analyzeWithAI(buildAiRequest());

    expect(result.success).toBe(true);
    const r = result.result;
    expect(r?.evaluationStage).toBeUndefined();
    expect(r?.originalityAndStyle).toBeUndefined();
    expect(r?.completenessAndRhythm).toBeUndefined();
    expect(r?.emotionAndMood).toBeUndefined();
    expect(r?.craftsmanship).toBeUndefined();
    expect(r?.scoreCriteria).toBeUndefined();
    expect(r?.issueMarkers).toBeUndefined();
  });

  it('should_downgrade_empty_score_criteria_array_to_undefined', async () => {
    // AI 返回空数组 → 视为"未返回有效标准",降级为 undefined(前端按"无评分标准"渲染)
    aiEnvState.aiApiKey = 'test-key';
    const content = buildLegacyContent({ score_criteria: [] });
    vi.mocked(axios.post).mockResolvedValue(buildGlmResponse(content));

    const result = await analyzeWithAI(buildAiRequest());

    expect(result.success).toBe(true);
    expect(result.result?.scoreCriteria).toBeUndefined();
  });

  it('should_downgrade_empty_issue_markers_array_to_undefined', async () => {
    aiEnvState.aiApiKey = 'test-key';
    const content = buildLegacyContent({ issue_markers: [] });
    vi.mocked(axios.post).mockResolvedValue(buildGlmResponse(content));

    const result = await analyzeWithAI(buildAiRequest());

    expect(result.success).toBe(true);
    expect(result.result?.issueMarkers).toBeUndefined();
  });

  it('should_downgrade_invalid_field_values_to_defaults_without_dropping_entry', async () => {
    // 单条目对象字段非法(dimension/weight/level) → transform 降级为默认值,条目保留不丢
    aiEnvState.aiApiKey = 'test-key';
    const content = buildLegacyContent({
      score_criteria: [{ dimension: 123, weight: 'bad', level: 'nope' }],
    });
    vi.mocked(axios.post).mockResolvedValue(buildGlmResponse(content));

    const result = await analyzeWithAI(buildAiRequest());

    expect(result.success).toBe(true);
    expect(result.result?.scoreCriteria).toBeDefined();
    expect(result.result?.scoreCriteria?.[0]?.dimension).toBe('未知维度');
    expect(result.result?.scoreCriteria?.[0]?.weight).toBe(0);
    expect(result.result?.scoreCriteria?.[0]?.level).toBe('average');
  });

  it('should_drop_non_object_entries_and_downgrade_to_undefined_when_all_invalid', async () => {
    // 数组元素非对象(null/字符串) → safeParse 失败被 flatMap 丢弃;全丢 → 降级 undefined
    aiEnvState.aiApiKey = 'test-key';
    const content = buildLegacyContent({
      score_criteria: [null, 'not-an-object', 42],
    });
    vi.mocked(axios.post).mockResolvedValue(buildGlmResponse(content));

    const result = await analyzeWithAI(buildAiRequest());

    expect(result.success).toBe(true);
    expect(result.result?.scoreCriteria).toBeUndefined();
  });
});

// ============================================================
// Phase 2 批次④:档位估算 grade_tier_estimate 解析(宽松校验 + 诚实性兜底)
// ============================================================
describe('grade_tier_estimate 解析(批次④)', () => {
  it('合法输入 → tierEstimate 完整解析(tier/note 原样,estimated 恒 true)', async () => {
    aiEnvState.aiApiKey = 'test-key';
    const content = buildLegacyContent({
      grade_tier_estimate: { tier: ' C+ ', note: ' 造型支撑三档上限,色彩偏弱,±1档 ' },
    });
    vi.mocked(axios.post).mockResolvedValue(buildGlmResponse(content));

    const result = await analyzeWithAI(buildAiRequest());

    expect(result.success).toBe(true);
    expect(result.result?.tierEstimate).toEqual({
      tier: 'C+',
      estimated: true,
      note: '造型支撑三档上限,色彩偏弱,±1档',
    });
  });

  it('note 缺失/空白 → 兜底 ±1档(spec §4.3 诚实性文案)', async () => {
    aiEnvState.aiApiKey = 'test-key';
    const content = buildLegacyContent({
      grade_tier_estimate: { tier: 'B-' },
    });
    vi.mocked(axios.post).mockResolvedValue(buildGlmResponse(content));

    const result = await analyzeWithAI(buildAiRequest());

    expect(result.success).toBe(true);
    expect(result.result?.tierEstimate).toEqual({
      tier: 'B-',
      estimated: true,
      note: '±1档',
    });
  });

  it('tier 空串/纯空白 → 解析降级 undefined(不产出空档位)', async () => {
    aiEnvState.aiApiKey = 'test-key';
    const content = buildLegacyContent({
      grade_tier_estimate: { tier: '   ', note: 'x' },
    });
    vi.mocked(axios.post).mockResolvedValue(buildGlmResponse(content));

    const result = await analyzeWithAI(buildAiRequest());

    expect(result.success).toBe(true);
    expect(result.result?.tierEstimate).toBeUndefined();
  });

  it('tier 超长(>8 字)/非字符串 → undefined(防模型吐长文本)', async () => {
    aiEnvState.aiApiKey = 'test-key';
    const content = buildLegacyContent({
      grade_tier_estimate: { tier: '这是一个特别长的档位描述文本', note: 'x' },
    });
    vi.mocked(axios.post).mockResolvedValue(buildGlmResponse(content));

    const result = await analyzeWithAI(buildAiRequest());

    expect(result.success).toBe(true);
    expect(result.result?.tierEstimate).toBeUndefined();
  });

  it('字段缺失/非对象 → undefined(旧 prompt 兼容,不阻断解析)', async () => {
    aiEnvState.aiApiKey = 'test-key';
    vi.mocked(axios.post).mockResolvedValue(
      buildGlmResponse(buildLegacyContent({ grade_tier_estimate: 'C+' })),
    );

    const result = await analyzeWithAI(buildAiRequest());

    expect(result.success).toBe(true);
    expect(result.result?.tierEstimate).toBeUndefined();
  });
});
