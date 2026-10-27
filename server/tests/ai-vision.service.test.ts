// ============================================================
// AI 视觉服务 + 混合分析编排器 测试
// 对应源码:
//   - src/services/ai-vision.service.ts (GLM-4V API 客户端)
//   - src/services/ai-analysis.service.ts (Jimp + AI 混合编排)
// 对应文档:.trae/documents/ai-integration-design.md §2-§3
//
// 测试范围:
//   1. buildSystemPrompt / buildUserPrompt:Prompt 工程正确性
//   2. extractJsonFromContent:JSON 提取容错(纯 JSON / markdown / 嵌入文字)
//   3. analyzeWithAI:成功 / 超时 / HTTP 错误 / 网络错误 / 解析错误 / Schema 错误 / Key 缺失
//   4. delta clamp ±5:防止 AI 输出异常值导致评分大幅偏差
//   5. level 归一化:中英文等级统一
//   6. isAIEnabled:env 配置联动
//   7. extractJimpMetricsFromResult:四类作品指标提取
//   8. runHybridAnalysis:AI 禁用 / AI 成功 / AI 失败 fallback
//   9. applyScoreAdjustments:维度匹配 + score clamp [0,100]
//  10. isAIEnhancedResult / getAIFailureReason:类型守卫
//
// Mock 策略:
//   - vi.mock('axios'):拦截 GLM-4V API 调用,控制响应
//   - vi.mock('../src/config/env.js'):允许 per-test 配置 AI_ENABLED / AI_API_KEY
//   - Jimp mock 由 setup.ts 全局注册,analyzeImage 使用 100x100 伪图像
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ============================================================
// 1. vi.hoisted:声明 mock 状态(在 vi.mock 工厂之前 hoisted)
// ============================================================

const { aiEnvState } = vi.hoisted(() => ({
  // AI 环境变量覆盖(每个测试可修改)
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
// 3. vi.mock:env(允许 per-test 配置 AI 字段)
//    其他字段使用测试固定值,保证 logger 等模块正常工作
// ============================================================

vi.mock('../src/config/env.js', () => {
  // 静态 env 字段(与 setup.ts 测试值一致)
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

  // 每次调用 env() 时合并静态配置 + 当前 AI 覆盖值
  function buildEnv() {
    return {
      ...staticConfig,
      aiEnabled: aiEnvState.aiEnabled,
      aiProvider: aiEnvState.aiProvider,
      aiApiKey: aiEnvState.aiApiKey,
      aiApiUrl: aiEnvState.aiApiUrl,
      aiApiTimeout: aiEnvState.aiApiTimeout,
      aiApiModel: aiEnvState.aiApiModel,
      // 多模型数组(env.ts aiApiModels),单模型测试场景派生自 aiApiModel
      aiApiModels: [aiEnvState.aiApiModel],
      // max_tokens 上限(env.ts aiApiMaxTokens,默认 1024)
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
import {
  analyzeWithAI,
  buildSystemPrompt,
  buildUserPrompt,
  extractJsonFromContent,
  isAIEnabled,
  extractJimpMetricsFromResult,
} from '../src/services/ai-vision.service.js';
import {
  runHybridAnalysis,
  applyDimensionAbsoluteScores,
  isAIEnhancedResult,
  getAIFailureReason,
} from '../src/services/ai-analysis.service.js';
import type {
  AIVisionRequest,
  AIVisionResult,
} from '../src/types/ai-analysis.js';
import type { AnalysisResult, ArtType } from '../src/types/api-contract.js';

// ============================================================
// 5. 辅助函数:构造测试数据
// ============================================================

/**
 * 构造有效的 AI 分析 JSON 内容(模拟 GLM-4V 返回)
 */
function buildValidAiContent(overrides?: Record<string, unknown>): string {
  return JSON.stringify({
    semantic_theme: '作品展现了静物画的传统构图,色彩温暖,传达出宁静的氛围。',
    style_recognition: '古典写实明暗塑造',
    professional_suggestions: [
      {
        dimension: '构图与造型',
        level: '良',
        operation: '将主体从画面正中向左下偏移 1/3,使其落于黄金分割点',
        reference: '塞尚《静物》三角构图',
        practice: '对同一组静物做 4 种构图变体速写',
      },
      {
        dimension: '色彩表现',
        level: '中',
        operation: '提高暗部色彩饱和度 15%,增强冷暖对比',
        reference: '莫奈《睡莲》条件色处理',
        practice: '用纯色点彩法练习冷暖渐变',
      },
    ],
    score_adjustments: {
      dimension_adjustments: [
        { dimension: '构图', delta: -3, reason: '主体居中,缺乏动态平衡' },
        { dimension: '色彩', delta: 2, reason: '色彩搭配和谐,但饱和度偏低' },
      ],
      overall_delta: -2,
      overall_reason: '整体构图偏静态,色彩表现良好',
    },
    reference_artworks: [
      { title: '静物', artist: '塞尚', reason: '三角构图的经典范例' },
      { title: '睡莲', artist: '莫奈', reason: '条件色处理的代表作品' },
    ],
    ...overrides,
  });
}

/**
 * 将 content 包装为 GLM-4V API 响应格式
 */
function buildGlmResponse(
  content: string,
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number },
): { data: { choices: Array<{ message: { content: string } }>; usage?: unknown }; status: number } {
  return {
    data: {
      choices: [{ message: { content } }],
      usage: usage ?? { prompt_tokens: 500, completion_tokens: 300, total_tokens: 800 },
    },
    status: 200,
  };
}

/**
 * 构造 axios 错误对象(模拟超时/网络错误/HTTP 错误)
 */
function buildAxiosError(
  code: string,
  message: string,
  status?: number,
): Error & { code: string; response?: { status: number; data: unknown } } {
  const err = new Error(message) as Error & { code: string; response?: { status: number; data: unknown } };
  err.code = code;
  if (status !== undefined) {
    err.response = { status, data: { error: 'server error' } };
  }
  return err;
}

/**
 * 构造基本 AIVisionRequest(URL 模式,避免文件系统访问)
 */
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
    title: '静物练习',
    remark: '课堂作业:冷暖色调对比练习',
    ...overrides,
  };
}

/**
 * 构造 painting AnalysisResult(固定值,便于断言)
 */
function buildPaintingResult(): AnalysisResult {
  return {
    artType: 'painting',
    dimensions: {
      type: 'painting',
      composition: {
        score: 75,
        focusPoint: { x: 0.45, y: 0.5 },
        balance: 'balanced',
        guideline: 'good',
        whitespaceRatio: 0.35,
        symmetry: 0.6,
        suggestion: '构图均衡',
        heatmapData: [[0.5]],
      },
      color: {
        score: 80,
        warmRatio: 0.6,
        coolRatio: 0.4,
        contrast: 'medium',
        saturation: 'high',
        richness: 'moderate',
        harmony: '和谐',
        dominantColor: '暖红色',
        suggestion: '色彩表现良好',
      },
      brushwork: {
        score: 70,
        textureLevel: 'rich',
        strokeVariety: 45,
        wetDryBalance: '适中',
        suggestion: '笔触技法尚可',
      },
    },
    originality: {
      score: 78,
      similarity: 0.2,
      creativityLevel: 'good',
      suggestion: '建议增加个人风格',
    },
    overallScore: 76,
  };
}

/**
 * 构造 design AnalysisResult
 */
function buildDesignResult(): AnalysisResult {
  return {
    artType: 'design',
    dimensions: {
      type: 'design',
      visualHierarchy: {
        score: 82,
        focusPoint: { x: 0.4, y: 0.35 },
        primarySecondaryClarity: 'clear',
        informationFlow: 'good',
        heatmapData: [[0.6]],
        suggestion: '视觉层次清晰',
      },
      typography: {
        score: 75,
        alignmentQuality: 'good',
        rhythmConsistency: 'good',
        negativeSpaceUsage: 'good',
        gridAdherence: 80,
        suggestion: '排版规范',
      },
      colorApplication: {
        score: 78,
        contrast: 'high',
        brandConsistency: 'moderate',
        colorPsychology: '专业',
        paletteHarmony: '和谐',
        suggestion: '色彩应用合理',
      },
    },
    originality: {
      score: 80,
      similarity: 0.15,
      creativityLevel: 'good',
      suggestion: '创意表达良好',
    },
    overallScore: 79,
  };
}

/**
 * 构造 product AnalysisResult
 */
function buildProductResult(): AnalysisResult {
  return {
    artType: 'product',
    dimensions: {
      type: 'product',
      form: {
        score: 76,
        focusPoint: { x: 0.5, y: 0.45 },
        proportionBalance: 'good',
        lineFluidity: 'smooth',
        surfaceQuality: 'excellent',
        ergonomicsHint: 'strong',
        heatmapData: [[0.5]],
        suggestion: '形态设计良好',
      },
      materialExpression: {
        score: 72,
        textureRealism: 'high',
        lightShadowPerformance: 'good',
        surfaceTreatment: 'refined',
        suggestion: '材质表现到位',
      },
      functionExpression: {
        score: 78,
        structureClarity: 'clear',
        functionImplication: 'strong',
        detailRefinement: 'good',
        suggestion: '功能表达清晰',
      },
    },
    originality: {
      score: 75,
      similarity: 0.25,
      creativityLevel: 'good',
      suggestion: '建议增强创新性',
    },
    overallScore: 75,
  };
}

/**
 * 构造 sculpture AnalysisResult
 */
function buildSculptureResult(): AnalysisResult {
  return {
    artType: 'sculpture',
    dimensions: {
      type: 'sculpture',
      spatialComposition: {
        score: 73,
        focusPoint: { x: 0.5, y: 0.5 },
        volumeSense: 'strong',
        spaceOccupation: 'moderate',
        voidSolidRelation: 'harmonious',
        heatmapData: [[0.5]],
        suggestion: '空间构成合理',
      },
      bodyLanguage: {
        score: 70,
        dynamicSense: 'moderate',
        tensionExpression: 'medium',
        rhythmFlow: 'moderate',
        suggestion: '形体语言尚可',
      },
      materialLanguage: {
        score: 75,
        materialCharacter: 'distinct',
        textureExpression: 'rich',
        qualityLayering: 'moderate',
        suggestion: '材料语言表现良好',
      },
    },
    originality: {
      score: 77,
      similarity: 0.2,
      creativityLevel: 'good',
      suggestion: '建议增强观念表达',
    },
    overallScore: 74,
  };
}

// ============================================================
// 6. 全局 beforeEach:重置 mock 状态
// ============================================================

beforeEach(() => {
  // 重置 AI env 覆盖为默认值
  aiEnvState.aiEnabled = false;
  aiEnvState.aiProvider = 'glm';
  aiEnvState.aiApiKey = '';
  aiEnvState.aiApiUrl = 'https://test-ai-api.example.com/v1/chat/completions';
  aiEnvState.aiApiTimeout = 2500;
  aiEnvState.aiApiModel = 'glm-4v-flash-test';
  aiEnvState.traeApiKey = '';
  aiEnvState.traeApiUrl = '';
  aiEnvState.traeApiModel = '';

  // 重置 axios.post mock
  vi.mocked(axios.post).mockReset();
});

// ============================================================
// 测试套件 1:buildSystemPrompt(Prompt 工程)
// ============================================================

describe('ai-vision.service', () => {
  describe('buildSystemPrompt', () => {
    it('should_include_professor_role_for_painting', () => {
      // 2026-08-16 诊断理念重构:教学诊断角色为"画架旁 1对1 的艺术教育老师"
      const prompt = buildSystemPrompt('painting');
      expect(prompt).toContain('艺术教育老师');
      expect(prompt).toContain('1 对 1');
      expect(prompt).toContain('绘画');
    });

    it('should_include_art_type_label_for_each_type', () => {
      const types: ArtType[] = ['painting', 'design', 'product', 'sculpture'];
      const labels = ['绘画', '设计', '产品设计', '雕塑'];
      types.forEach((t, i) => {
        const prompt = buildSystemPrompt(t);
        expect(prompt).toContain(labels[i]!);
      });
    });

    it('should_include_json_output_structure_requirement', () => {
      // 2026-08-16 重构:输出结构为 artwork_check / visual_description / style_recognition 等
      const prompt = buildSystemPrompt('painting');
      expect(prompt).toContain('artwork_check');
      expect(prompt).toContain('visual_description');
      expect(prompt).toContain('style_recognition');
      expect(prompt).toContain('professional_suggestions');
      // 批次④:AI 绝对评分替代 delta 校准(score_adjustments 已从 prompt 移除)
      expect(prompt).toContain('overall_score');
      expect(prompt).toContain('dimension_scores');
      expect(prompt).not.toContain('score_adjustments');
      expect(prompt).toContain('reference_artworks');
      // 2026-08-16 新增:非作品图片的 来源识别/来历分析/二创判断 字段
      expect(prompt).toContain('source_identification');
      expect(prompt).toContain('provenance_analysis');
      expect(prompt).toContain('derivative_judgment');
      expect(prompt).toContain('derivative_note');
    });

    it('should_include_mismatch_derivative_chain_in_both_modes', () => {
      // 教学模式:四步链路(来源→来历→二创判断→分支处理)
      const teaching = buildSystemPrompt('painting');
      expect(teaching).toContain('来源识别');
      expect(teaching).toContain('来历分析');
      expect(teaching).toContain('二创判断');
      expect(teaching).toContain('derivative');
      expect(teaching).toContain('transfer');
      // 艺考模式:三步识别 + 档位处理分支
      const exam = buildSystemPrompt('painting', 'exam', 'sketch');
      expect(exam).toContain('source_identification');
      expect(exam).toContain('provenance_analysis');
      expect(exam).toContain('derivative_judgment');
    });

    it('should_include_teaching_principles', () => {
      // 2026-08-16 重构:教学诊断核心原则——完整度先行、画面关系、顺着作者方向、证据+优先级
      const prompt = buildSystemPrompt('design');
      expect(prompt).toContain('完整度');
      expect(prompt).toContain('画面关系');
      expect(prompt).toContain('教学理念');
      expect(prompt).toContain('"evidence"');
      expect(prompt).toContain('"priority"');
    });

    it('should_include_delta_range_constraint', () => {
      const prompt = buildSystemPrompt('painting');
      // 2026-08-18:delta 由 "-5~+5" 改为合法 JSON 数字约束(模型曾输出 +2 导致 JSON 解析失败)
      expect(prompt).toContain('不带 + 号');
      expect(prompt).toContain('所有数值必须为合法JSON数字');
    });
  });

  // ============================================================
  // 测试套件 2:buildUserPrompt
  // ============================================================

  describe('buildUserPrompt', () => {
    it('should_include_dimension_context_for_painting', () => {
      const prompt = buildUserPrompt(buildAiRequest({ artType: 'painting' }));
      expect(prompt).toContain('构图与造型');
      expect(prompt).toContain('色彩表现');
      expect(prompt).toContain('笔触与技法');
    });

    it('should_include_dimension_context_for_design', () => {
      const prompt = buildUserPrompt(buildAiRequest({ artType: 'design' }));
      expect(prompt).toContain('视觉层次');
      expect(prompt).toContain('排版与构成');
      expect(prompt).toContain('色彩应用');
    });

    it('should_include_dimension_context_for_product', () => {
      const prompt = buildUserPrompt(buildAiRequest({ artType: 'product' }));
      expect(prompt).toContain('形态语义');
      expect(prompt).toContain('材质表现');
      expect(prompt).toContain('功能表达');
    });

    it('should_include_dimension_context_for_sculpture', () => {
      const prompt = buildUserPrompt(buildAiRequest({ artType: 'sculpture' }));
      expect(prompt).toContain('空间构成');
      expect(prompt).toContain('形体语言');
      expect(prompt).toContain('材料语言');
    });

    it('should_include_jimp_metrics_when_provided', () => {
      const prompt = buildUserPrompt(buildAiRequest());
      expect(prompt).toContain('视觉重心');
      expect(prompt).toContain('留白');
      expect(prompt).toContain('暖冷比');
      expect(prompt).toContain('主色调');
      expect(prompt).toContain('亮度');
    });

    it('should_omit_jimp_metrics_section_when_not_provided', () => {
      const req = buildAiRequest();
      delete req.jimpMetrics;
      const prompt = buildUserPrompt(req);
      expect(prompt).not.toContain('已知客观像素数据');
    });

    it('should_include_title_when_provided', () => {
      const prompt = buildUserPrompt(buildAiRequest({ title: '我的静物作业' }));
      expect(prompt).toContain('作品标题:我的静物作业');
    });

    it('should_omit_title_section_when_not_provided', () => {
      const req = buildAiRequest();
      delete req.title;
      const prompt = buildUserPrompt(req);
      expect(prompt).not.toContain('作品标题');
    });

    it('should_include_remark_when_provided', () => {
      const prompt = buildUserPrompt(buildAiRequest({ remark: '要求:完成一幅冷暖对比静物' }));
      expect(prompt).toContain('作业要求');
      expect(prompt).toContain('要求:完成一幅冷暖对比静物');
    });
  });

  // ============================================================
  // 测试套件 3:extractJsonFromContent
  // ============================================================

  describe('extractJsonFromContent', () => {
    it('should_parse_pure_json', () => {
      const content = '{"semantic_theme":"测试","style_recognition":"印象派"}';
      const result = extractJsonFromContent(content);
      expect(result).toEqual({ semantic_theme: '测试', style_recognition: '印象派' });
    });

    it('should_parse_json_wrapped_in_markdown_code_block', () => {
      const content = '```json\n{"semantic_theme":"测试"}\n```';
      const result = extractJsonFromContent(content);
      expect(result).toEqual({ semantic_theme: '测试' });
    });

    it('should_parse_json_wrapped_in_plain_code_block', () => {
      const content = '```\n{"key":"value"}\n```';
      const result = extractJsonFromContent(content);
      expect(result).toEqual({ key: 'value' });
    });

    it('should_extract_json_embedded_in_text', () => {
      const content = '好的,以下是分析结果:\n{"semantic_theme":"静物"}\n希望对你有帮助。';
      const result = extractJsonFromContent(content);
      expect(result).toEqual({ semantic_theme: '静物' });
    });

    it('should_return_null_when_no_braces_found', () => {
      const result = extractJsonFromContent('这是一段纯文本,没有 JSON。');
      expect(result).toBeNull();
    });

    it('should_return_null_when_json_invalid', () => {
      const result = extractJsonFromContent('{invalid json content}');
      expect(result).toBeNull();
    });

    it('should_return_null_for_empty_string', () => {
      expect(extractJsonFromContent('')).toBeNull();
    });

    it('should_return_null_for_non_string_input', () => {
      expect(extractJsonFromContent(null as unknown as string)).toBeNull();
    });

    it('should_handle_nested_json_objects', () => {
      const content = '{"outer":{"inner":"value"},"arr":[1,2,3]}';
      const result = extractJsonFromContent(content);
      expect(result).toEqual({ outer: { inner: 'value' }, arr: [1, 2, 3] });
    });

    // 2026-08-16:截断 JSON 修复(修复 max_tokens 截断导致的 AI_PARSE_ERROR)
    it('should_repair_truncated_object_json', () => {
      const content = '{"semantic_theme":"静物","style_recognition":"印象派"';
      const result = extractJsonFromContent(content);
      expect(result).toEqual({ semantic_theme: '静物', style_recognition: '印象派' });
    });

    it('should_repair_truncated_nested_json', () => {
      const content = '{"outer":{"inner":"value"},"arr":[1,2,3]';
      const result = extractJsonFromContent(content);
      expect(result).toEqual({ outer: { inner: 'value' }, arr: [1, 2, 3] });
    });

    it('should_repair_truncated_string_value', () => {
      const content = '{"key":"value';
      const result = extractJsonFromContent(content);
      expect(result).toEqual({ key: 'value' });
    });

    it('should_repair_truncated_json_with_unclosed_array', () => {
      const content = '{"items":["a","b","c"';
      const result = extractJsonFromContent(content);
      expect(result).toEqual({ items: ['a', 'b', 'c'] });
    });
  });

  // ============================================================
  // 测试套件 4:isAIEnabled
  // ============================================================

  describe('isAIEnabled', () => {
    it('should_return_false_when_ai_disabled', () => {
      aiEnvState.aiEnabled = false;
      aiEnvState.aiApiKey = 'test-key';
      expect(isAIEnabled()).toBe(false);
    });

    it('should_return_false_when_api_key_empty', () => {
      aiEnvState.aiEnabled = true;
      aiEnvState.aiApiKey = '';
      expect(isAIEnabled()).toBe(false);
    });

    it('should_return_true_when_enabled_and_key_present', () => {
      aiEnvState.aiEnabled = true;
      aiEnvState.aiApiKey = 'test-key-123';
      expect(isAIEnabled()).toBe(true);
    });

    it('should_return_false_when_both_disabled_and_no_key', () => {
      aiEnvState.aiEnabled = false;
      aiEnvState.aiApiKey = '';
      expect(isAIEnabled()).toBe(false);
    });
  });

  // ============================================================
  // 测试套件 5:analyzeWithAI(核心:成功 + 各种失败路径)
  // ============================================================

  describe('analyzeWithAI', () => {
    // ---- 成功路径 ----

    describe('success path', () => {
      it('should_return_success_with_parsed_result_on_valid_response', async () => {
        aiEnvState.aiApiKey = 'test-key';
        const content = buildValidAiContent();
        vi.mocked(axios.post).mockResolvedValue(buildGlmResponse(content));

        const result = await analyzeWithAI(buildAiRequest());

        expect(result.success).toBe(true);
        expect(result.result).not.toBeNull();
        expect(result.failureReason).toBeNull();
        expect(result.durationMs).toBeGreaterThanOrEqual(0);
        expect(result.tokenUsage).toBeDefined();
        expect(result.tokenUsage?.totalTokens).toBe(800);
      });

      it('should_parse_artwork_check_derivative_fields_on_mismatch', async () => {
        // 2026-08-16 新增:mismatch 时解析 来源识别/来历分析/二创判断/二创说明
        aiEnvState.aiApiKey = 'test-key';
        const content = buildValidAiContent({
          artwork_check: {
            status: 'mismatch',
            actual_type: '网络表情包',
            reason: '画面为流行梗图,非绘画作品',
            source_identification: '网络流传的表情包',
            provenance_analysis: '经典猫猫头梗图,画风与线条特征与原梗一致',
            derivative_judgment: 'derivative',
            derivative_note: '在原梗图上叠加了手绘帽子与文字气泡',
          },
        });
        vi.mocked(axios.post).mockResolvedValue(buildGlmResponse(content));

        const result = await analyzeWithAI(buildAiRequest());

        expect(result.success).toBe(true);
        expect(result.result?.artworkCheck).toMatchObject({
          status: 'mismatch',
          actualType: '网络表情包',
          sourceIdentification: '网络流传的表情包',
          provenanceAnalysis: '经典猫猫头梗图,画风与线条特征与原梗一致',
          derivativeJudgment: 'derivative',
          derivativeNote: '在原梗图上叠加了手绘帽子与文字气泡',
        });
      });

      it('should_default_artwork_check_derivative_fields_to_undefined_when_absent', async () => {
        // 旧模型响应无新字段 → 可选字段保持 undefined(向后兼容)
        aiEnvState.aiApiKey = 'test-key';
        const content = buildValidAiContent({
          artwork_check: { status: 'uncertain', actual_type: '图片', reason: '无法确定' },
        });
        vi.mocked(axios.post).mockResolvedValue(buildGlmResponse(content));

        const result = await analyzeWithAI(buildAiRequest());

        expect(result.success).toBe(true);
        expect(result.result?.artworkCheck?.status).toBe('uncertain');
        expect(result.result?.artworkCheck?.sourceIdentification).toBeUndefined();
        expect(result.result?.artworkCheck?.provenanceAnalysis).toBeUndefined();
        expect(result.result?.artworkCheck?.derivativeJudgment).toBeUndefined();
        expect(result.result?.artworkCheck?.derivativeNote).toBeUndefined();
      });

      it('should_parse_semantic_theme_correctly', async () => {
        aiEnvState.aiApiKey = 'test-key';
        vi.mocked(axios.post).mockResolvedValue(buildGlmResponse(buildValidAiContent()));

        const result = await analyzeWithAI(buildAiRequest());

        expect(result.result?.semanticTheme).toContain('静物画');
      });

      it('should_parse_style_recognition_correctly', async () => {
        aiEnvState.aiApiKey = 'test-key';
        vi.mocked(axios.post).mockResolvedValue(buildGlmResponse(buildValidAiContent()));

        const result = await analyzeWithAI(buildAiRequest());

        expect(result.result?.styleRecognition).toBe('古典写实明暗塑造');
      });

      it('should_parse_professional_suggestions_with_all_fields', async () => {
        aiEnvState.aiApiKey = 'test-key';
        vi.mocked(axios.post).mockResolvedValue(buildGlmResponse(buildValidAiContent()));

        const result = await analyzeWithAI(buildAiRequest());

        expect(result.result?.professionalSuggestions).toHaveLength(2);
        const suggestion = result.result?.professionalSuggestions[0];
        expect(suggestion?.dimension).toBe('构图与造型');
        expect(suggestion?.level).toBe('good'); // '良' → 'good'
        expect(suggestion?.operation).toContain('黄金分割点');
        expect(suggestion?.reference).toContain('塞尚');
        expect(suggestion?.practice).toContain('构图变体');
      });

      it('should_parse_score_adjustments_correctly', async () => {
        aiEnvState.aiApiKey = 'test-key';
        vi.mocked(axios.post).mockResolvedValue(buildGlmResponse(buildValidAiContent()));

        const result = await analyzeWithAI(buildAiRequest());

        expect(result.result?.scoreAdjustments.overallDelta).toBe(-2);
        expect(result.result?.scoreAdjustments.overallReason).toContain('构图偏静态');
        expect(result.result?.scoreAdjustments.dimensionAdjustments).toHaveLength(2);
      });

      it('should_parse_reference_artworks_correctly', async () => {
        aiEnvState.aiApiKey = 'test-key';
        vi.mocked(axios.post).mockResolvedValue(buildGlmResponse(buildValidAiContent()));

        const result = await analyzeWithAI(buildAiRequest());

        expect(result.result?.referenceArtworks).toHaveLength(2);
        expect(result.result?.referenceArtworks[0]?.title).toBe('静物');
        expect(result.result?.referenceArtworks[0]?.artist).toBe('塞尚');
      });

      it('should_send_correct_request_to_glm_api', async () => {
        aiEnvState.aiApiKey = 'my-api-key-456';
        aiEnvState.aiApiUrl = 'https://custom-ai-api.test/v1/chat';
        aiEnvState.aiApiModel = 'glm-4v-plus';
        vi.mocked(axios.post).mockResolvedValue(buildGlmResponse(buildValidAiContent()));

        await analyzeWithAI(buildAiRequest());

        expect(axios.post).toHaveBeenCalledTimes(1);
        const callArgs = vi.mocked(axios.post).mock.calls[0]!;
        expect(callArgs[0]).toBe('https://custom-ai-api.test/v1/chat');

        const body = callArgs[1] as { model: string; messages: unknown[]; temperature: number; max_tokens: number };
        expect(body.model).toBe('glm-4v-plus');
        expect(body.messages).toHaveLength(2);
        expect(body.temperature).toBe(0.3);
        expect(body.max_tokens).toBe(1024);

        const config = callArgs[2] as { headers: Record<string, string>; timeout: number };
        expect(config.headers['Authorization']).toBe('Bearer my-api-key-456');
        expect(config.timeout).toBe(2500);
      });

      it('should_include_image_url_in_request_body', async () => {
        aiEnvState.aiApiKey = 'test-key';
        vi.mocked(axios.post).mockResolvedValue(buildGlmResponse(buildValidAiContent()));

        await analyzeWithAI(buildAiRequest({ imageSource: 'https://cdn.example.com/art.jpg' }));

        const body = vi.mocked(axios.post).mock.calls[0]![1] as { messages: Array<{ content: unknown }> };
        const userMessage = body.messages[1]!;
        const contentArr = userMessage.content as Array<{ type: string; image_url?: { url: string } }>;
        const imagePart = contentArr.find((p) => p.type === 'image_url');
        expect(imagePart?.image_url?.url).toBe('https://cdn.example.com/art.jpg');
      });
    });

    // ---- delta clamp ±5 ----

    describe('delta clamping', () => {
      it('should_clamp_dimension_delta_to_max_5', async () => {
        aiEnvState.aiApiKey = 'test-key';
        const content = buildValidAiContent({
          score_adjustments: {
            dimension_adjustments: [
              { dimension: '构图', delta: 15, reason: '测试超大值' },
            ],
            overall_delta: 0,
            overall_reason: '',
          },
        });
        vi.mocked(axios.post).mockResolvedValue(buildGlmResponse(content));

        const result = await analyzeWithAI(buildAiRequest());

        expect(result.result?.scoreAdjustments.dimensionAdjustments[0]?.delta).toBe(5);
      });

      it('should_clamp_dimension_delta_to_min_negative_5', async () => {
        aiEnvState.aiApiKey = 'test-key';
        const content = buildValidAiContent({
          score_adjustments: {
            dimension_adjustments: [
              { dimension: '构图', delta: -20, reason: '测试超小值' },
            ],
            overall_delta: 0,
            overall_reason: '',
          },
        });
        vi.mocked(axios.post).mockResolvedValue(buildGlmResponse(content));

        const result = await analyzeWithAI(buildAiRequest());

        expect(result.result?.scoreAdjustments.dimensionAdjustments[0]?.delta).toBe(-5);
      });

      it('should_clamp_overall_delta_to_range', async () => {
        aiEnvState.aiApiKey = 'test-key';
        const content = buildValidAiContent({
          score_adjustments: {
            dimension_adjustments: [],
            overall_delta: 100,
            overall_reason: '测试超大整体调整',
          },
        });
        vi.mocked(axios.post).mockResolvedValue(buildGlmResponse(content));

        const result = await analyzeWithAI(buildAiRequest());

        expect(result.result?.scoreAdjustments.overallDelta).toBe(5);
      });

      it('should_clamp_non_integer_delta', async () => {
        aiEnvState.aiApiKey = 'test-key';
        const content = buildValidAiContent({
          score_adjustments: {
            dimension_adjustments: [
              { dimension: '色彩', delta: 3.7, reason: '浮点数' },
            ],
            overall_delta: -2.3,
            overall_reason: '浮点数',
          },
        });
        vi.mocked(axios.post).mockResolvedValue(buildGlmResponse(content));

        const result = await analyzeWithAI(buildAiRequest());

        expect(result.result?.scoreAdjustments.dimensionAdjustments[0]?.delta).toBe(4);
        expect(result.result?.scoreAdjustments.overallDelta).toBe(-2);
      });

      it('should_default_delta_to_0_when_not_a_number', async () => {
        aiEnvState.aiApiKey = 'test-key';
        const content = buildValidAiContent({
          score_adjustments: {
            dimension_adjustments: [
              { dimension: '构图', delta: 'invalid', reason: '非数字' },
            ],
            overall_delta: null,
            overall_reason: '',
          },
        });
        vi.mocked(axios.post).mockResolvedValue(buildGlmResponse(content));

        const result = await analyzeWithAI(buildAiRequest());

        expect(result.result?.scoreAdjustments.dimensionAdjustments[0]?.delta).toBe(0);
        expect(result.result?.scoreAdjustments.overallDelta).toBe(0);
      });
    });

    // ---- level 归一化 ----

    describe('level normalization', () => {
      it('should_normalize_chinese_levels', async () => {
        aiEnvState.aiApiKey = 'test-key';
        const content = buildValidAiContent({
          professional_suggestions: [
            { dimension: '构图', level: '优', operation: 'op', reference: 'ref', practice: 'p' },
            { dimension: '色彩', level: '良', operation: 'op', reference: 'ref', practice: 'p' },
            { dimension: '笔触', level: '中', operation: 'op', reference: 'ref', practice: 'p' },
            { dimension: '整体', level: '差', operation: 'op', reference: 'ref', practice: 'p' },
          ],
        });
        vi.mocked(axios.post).mockResolvedValue(buildGlmResponse(content));

        const result = await analyzeWithAI(buildAiRequest());

        const levels = result.result?.professionalSuggestions.map((s) => s.level);
        expect(levels).toEqual(['excellent', 'good', 'average', 'poor']);
      });

      it('should_normalize_english_levels_case_insensitive', async () => {
        aiEnvState.aiApiKey = 'test-key';
        const content = buildValidAiContent({
          professional_suggestions: [
            { dimension: 'd1', level: 'EXCELLENT', operation: 'op', reference: 'ref', practice: 'p' },
            { dimension: 'd2', level: 'Good', operation: 'op', reference: 'ref', practice: 'p' },
            { dimension: 'd3', level: 'AVERAGE', operation: 'op', reference: 'ref', practice: 'p' },
            { dimension: 'd4', level: 'Poor', operation: 'op', reference: 'ref', practice: 'p' },
          ],
        });
        vi.mocked(axios.post).mockResolvedValue(buildGlmResponse(content));

        const result = await analyzeWithAI(buildAiRequest());

        const levels = result.result?.professionalSuggestions.map((s) => s.level);
        expect(levels).toEqual(['excellent', 'good', 'average', 'poor']);
      });

      it('should_default_unknown_level_to_average', async () => {
        aiEnvState.aiApiKey = 'test-key';
        const content = buildValidAiContent({
          professional_suggestions: [
            { dimension: 'd1', level: '未知等级', operation: 'op', reference: 'ref', practice: 'p' },
            { dimension: 'd2', level: 42, operation: 'op', reference: 'ref', practice: 'p' },
          ],
        });
        vi.mocked(axios.post).mockResolvedValue(buildGlmResponse(content));

        const result = await analyzeWithAI(buildAiRequest());

        expect(result.result?.professionalSuggestions[0]?.level).toBe('average');
        expect(result.result?.professionalSuggestions[1]?.level).toBe('average');
      });
    });

    // ---- 缺失字段默认值填充 ----

    describe('missing field defaults', () => {
      it('should_use_empty_string_for_missing_semantic_theme', async () => {
        aiEnvState.aiApiKey = 'test-key';
        const content = JSON.stringify({ style_recognition: '测试' });
        vi.mocked(axios.post).mockResolvedValue(buildGlmResponse(content));

        const result = await analyzeWithAI(buildAiRequest());

        expect(result.success).toBe(true);
        expect(result.result?.semanticTheme).toBe('');
      });

      it('should_use_empty_array_for_missing_suggestions', async () => {
        aiEnvState.aiApiKey = 'test-key';
        const content = JSON.stringify({ semantic_theme: '测试', style_recognition: 's' });
        vi.mocked(axios.post).mockResolvedValue(buildGlmResponse(content));

        const result = await analyzeWithAI(buildAiRequest());

        expect(result.result?.professionalSuggestions).toEqual([]);
        expect(result.result?.referenceArtworks).toEqual([]);
      });

      it('should_use_zero_delta_for_missing_score_adjustments', async () => {
        aiEnvState.aiApiKey = 'test-key';
        const content = JSON.stringify({ semantic_theme: '测试', style_recognition: 's' });
        vi.mocked(axios.post).mockResolvedValue(buildGlmResponse(content));

        const result = await analyzeWithAI(buildAiRequest());

        expect(result.result?.scoreAdjustments.overallDelta).toBe(0);
        expect(result.result?.scoreAdjustments.dimensionAdjustments).toEqual([]);
      });

      it('should_filter_out_invalid_suggestion_entries', async () => {
        aiEnvState.aiApiKey = 'test-key';
        const content = buildValidAiContent({
          professional_suggestions: [
            { dimension: '有效', level: '良', operation: 'op', reference: 'ref', practice: 'p' },
            null,
            'invalid string',
            { dimension: '也有效', level: '中', operation: 'op', reference: 'ref', practice: 'p' },
          ],
        });
        vi.mocked(axios.post).mockResolvedValue(buildGlmResponse(content));

        const result = await analyzeWithAI(buildAiRequest());

        expect(result.result?.professionalSuggestions).toHaveLength(2);
      });
    });

    // ---- 失败路径 ----

    describe('failure paths', () => {
      it('should_return_key_missing_when_api_key_empty', async () => {
        aiEnvState.aiApiKey = '';
        vi.mocked(axios.post).mockResolvedValue(buildGlmResponse(buildValidAiContent()));

        const result = await analyzeWithAI(buildAiRequest());

        expect(result.success).toBe(false);
        expect(result.failureReason).toBe('AI_KEY_MISSING');
        expect(result.result).toBeNull();
        expect(axios.post).not.toHaveBeenCalled();
      });

      it('should_return_timeout_on_econnaborted', async () => {
        aiEnvState.aiApiKey = 'test-key';
        vi.mocked(axios.post).mockRejectedValue(buildAxiosError('ECONNABORTED', 'timeout of 2500ms exceeded'));

        const result = await analyzeWithAI(buildAiRequest());

        expect(result.success).toBe(false);
        expect(result.failureReason).toBe('AI_TIMEOUT');
      });

      it('should_return_timeout_on_etimedout', async () => {
        aiEnvState.aiApiKey = 'test-key';
        vi.mocked(axios.post).mockRejectedValue(buildAxiosError('ETIMEDOUT', 'connection timed out'));

        const result = await analyzeWithAI(buildAiRequest());

        expect(result.success).toBe(false);
        expect(result.failureReason).toBe('AI_TIMEOUT');
      });

      it('should_return_timeout_on_abort_controller_cancel', async () => {
        // P3-2.2: AbortController wall-clock deadline 触发时,axios 抛 ERR_CANCELED / CanceledError
        aiEnvState.aiApiKey = 'test-key';
        const abortErr = new Error('canceled') as Error & { code: string; name: string };
        abortErr.code = 'ERR_CANCELED';
        abortErr.name = 'CanceledError';
        vi.mocked(axios.post).mockRejectedValue(abortErr);

        const result = await analyzeWithAI(buildAiRequest());

        expect(result.success).toBe(false);
        expect(result.failureReason).toBe('AI_TIMEOUT');
      });

      it('should_return_network_error_on_econnrefused', async () => {
        aiEnvState.aiApiKey = 'test-key';
        vi.mocked(axios.post).mockRejectedValue(buildAxiosError('ECONNREFUSED', 'connect ECONNREFUSED'));

        const result = await analyzeWithAI(buildAiRequest());

        expect(result.success).toBe(false);
        expect(result.failureReason).toBe('AI_NETWORK_ERROR');
      });

      it('should_return_network_error_on_enotfound', async () => {
        aiEnvState.aiApiKey = 'test-key';
        vi.mocked(axios.post).mockRejectedValue(buildAxiosError('ENOTFOUND', 'getaddrinfo ENOTFOUND'));

        const result = await analyzeWithAI(buildAiRequest());

        expect(result.failureReason).toBe('AI_NETWORK_ERROR');
      });

      it('should_return_http_error_on_4xx_response', async () => {
        aiEnvState.aiApiKey = 'test-key';
        vi.mocked(axios.post).mockRejectedValue(buildAxiosError('ERR_BAD_REQUEST', 'Request failed', 401));

        const result = await analyzeWithAI(buildAiRequest());

        expect(result.failureReason).toBe('AI_HTTP_ERROR');
      });

      it('should_return_http_error_on_5xx_response', async () => {
        aiEnvState.aiApiKey = 'test-key';
        vi.mocked(axios.post).mockRejectedValue(buildAxiosError('ERR_BAD_RESPONSE', 'Server error', 500));

        const result = await analyzeWithAI(buildAiRequest());

        expect(result.failureReason).toBe('AI_HTTP_ERROR');
      });

      it('should_return_parse_error_when_content_is_not_json', async () => {
        aiEnvState.aiApiKey = 'test-key';
        vi.mocked(axios.post).mockResolvedValue(buildGlmResponse('这不是 JSON,是一段纯文本描述。'));

        const result = await analyzeWithAI(buildAiRequest());

        expect(result.failureReason).toBe('AI_PARSE_ERROR');
      });

      it('should_return_parse_error_when_content_is_empty', async () => {
        aiEnvState.aiApiKey = 'test-key';
        vi.mocked(axios.post).mockResolvedValue({
          data: { choices: [{ message: { content: '' } }] },
          status: 200,
        });

        const result = await analyzeWithAI(buildAiRequest());

        expect(result.failureReason).toBe('AI_PARSE_ERROR');
      });

      it('should_return_parse_error_when_choices_missing', async () => {
        aiEnvState.aiApiKey = 'test-key';
        vi.mocked(axios.post).mockResolvedValue({
          data: { usage: { total_tokens: 10 } },
          status: 200,
        });

        const result = await analyzeWithAI(buildAiRequest());

        expect(result.failureReason).toBe('AI_PARSE_ERROR');
      });

      it('should_return_unknown_error_for_unclassified_error', async () => {
        aiEnvState.aiApiKey = 'test-key';
        vi.mocked(axios.post).mockRejectedValue(new Error('something weird happened'));

        const result = await analyzeWithAI(buildAiRequest());

        expect(result.failureReason).toBe('AI_UNKNOWN_ERROR');
      });

      it('should_always_return_duration_ms', async () => {
        aiEnvState.aiApiKey = 'test-key';
        vi.mocked(axios.post).mockRejectedValue(buildAxiosError('ECONNABORTED', 'timeout'));

        const result = await analyzeWithAI(buildAiRequest());

        expect(result.durationMs).toBeGreaterThanOrEqual(0);
        expect(result.durationMs).toBeLessThan(5000);
      });
    });
  });

  // ============================================================
  // 测试套件 6:extractJimpMetricsFromResult
  // ============================================================

  describe('extractJimpMetricsFromResult', () => {
    it('should_extract_painting_metrics_correctly', () => {
      const result = buildPaintingResult();
      const metrics = extractJimpMetricsFromResult(result);

      expect(metrics.focusX).toBe(0.45);
      expect(metrics.focusY).toBe(0.5);
      expect(metrics.whitespaceRatio).toBe(0.35);
      expect(metrics.warmRatio).toBe(0.6);
      expect(metrics.coolRatio).toBe(0.4);
      expect(metrics.dominantColor).toBe('暖红色');
      expect(metrics.contrast).toBe('medium');
    });

    it('should_estimate_saturation_from_painting_level', () => {
      const result = buildPaintingResult();
      // painting color.saturation = 'high' → avgSaturation ≈ 70
      const metrics = extractJimpMetricsFromResult(result);
      expect(metrics.avgSaturation).toBe(70);
    });

    it('should_extract_design_metrics_correctly', () => {
      const result = buildDesignResult();
      const metrics = extractJimpMetricsFromResult(result);

      expect(metrics.focusX).toBe(0.4);
      expect(metrics.focusY).toBe(0.35);
      expect(metrics.contrast).toBe('high');
      // design typography.negativeSpaceUsage = 'good' → whitespaceRatio ≈ 0.4
      expect(metrics.whitespaceRatio).toBe(0.4);
    });

    it('should_extract_product_metrics_correctly', () => {
      const result = buildProductResult();
      const metrics = extractJimpMetricsFromResult(result);

      expect(metrics.focusX).toBe(0.5);
      expect(metrics.focusY).toBe(0.45);
      expect(metrics.dominantColor).toBe('产品材质色');
    });

    it('should_extract_sculpture_metrics_correctly', () => {
      const result = buildSculptureResult();
      const metrics = extractJimpMetricsFromResult(result);

      expect(metrics.focusX).toBe(0.5);
      expect(metrics.focusY).toBe(0.5);
      expect(metrics.dominantColor).toBe('雕塑材料色');
      // sculpture spatialComposition.spaceOccupation = 'moderate' → whitespaceRatio ≈ 0.35
      expect(metrics.whitespaceRatio).toBe(0.35);
    });

    it('should_always_return_valid_metrics_object', () => {
      const types = ['painting', 'design', 'product', 'sculpture'] as const;
      const results = [buildPaintingResult(), buildDesignResult(), buildProductResult(), buildSculptureResult()];

      results.forEach((result) => {
        const metrics = extractJimpMetricsFromResult(result);
        expect(metrics).toBeDefined();
        expect(typeof metrics.focusX).toBe('number');
        expect(typeof metrics.focusY).toBe('number');
        expect(typeof metrics.whitespaceRatio).toBe('number');
        expect(typeof metrics.avgLuminance).toBe('number');
        expect(typeof metrics.textureComplexity).toBe('number');
        expect(['high', 'medium', 'low']).toContain(metrics.contrast);
      });
    });
  });
});

// ============================================================
// 测试套件 7:ai-analysis.service(混合分析编排器)
// ============================================================

describe('ai-analysis.service (hybrid orchestration)', () => {
  // ============================================================
  // 测试套件 8:runHybridAnalysis
  // ============================================================

  describe('runHybridAnalysis', () => {
    // ---- AI 禁用场景 ----

    it('should_run_jimp_only_when_ai_disabled', async () => {
      aiEnvState.aiEnabled = false;
      aiEnvState.aiApiKey = '';

      const result = await runHybridAnalysis({
        imageSource: 'https://example.com/test.jpg',
        artType: 'painting',
      });

      expect(result.aiEnhanced).toBe(false);
      // Phase B5: AI 禁用时 aiVisionResult 不再为 null(批次③:降级说明保留,模板建议已下线)
      expect(result.aiVisionResult).not.toBeNull();
      expect(result.aiVisionResult!.professionalSuggestions).toEqual([]);
      expect(result.aiMeta.aiSuccess).toBe(false);
      expect(result.aiMeta.aiFailureReason).toBe('AI_DISABLED');
      expect(result.aiMeta.aiDurationMs).toBe(0);
      // Jimp 分析结果应该存在(批次③:本地引擎停分,overallScore 为 null,维度结构保留)
      expect(result.overallScore).toBeNull();
      expect(result.dimensions.type).toBe('painting');
    });

    it('should_run_jimp_only_when_key_missing_but_enabled', async () => {
      aiEnvState.aiEnabled = true;
      aiEnvState.aiApiKey = '';

      const result = await runHybridAnalysis({
        imageSource: 'https://example.com/test.jpg',
        artType: 'painting',
      });

      // isAIEnabled() returns false when key is empty
      expect(result.aiEnhanced).toBe(false);
      expect(result.aiMeta.aiFailureReason).toBe('AI_DISABLED');
    });

    // ---- AI 成功场景 ----

    it('should_merge_results_when_ai_succeeds', async () => {
      aiEnvState.aiEnabled = true;
      aiEnvState.aiApiKey = 'test-key';
      vi.mocked(axios.post).mockResolvedValue(buildGlmResponse(buildValidAiContent()));

      const result = await runHybridAnalysis({
        imageSource: 'https://example.com/test.jpg',
        artType: 'painting',
        title: '静物练习',
      });

      expect(result.aiEnhanced).toBe(true);
      expect(result.aiVisionResult).not.toBeNull();
      expect(result.aiMeta.aiSuccess).toBe(true);
      expect(result.aiMeta.aiFailureReason).toBeNull();
      expect(result.aiMeta.aiDurationMs).toBeGreaterThanOrEqual(0);
      expect(result.aiMeta.aiModel).toBe('glm-4v-flash-test');
      expect(result.aiMeta.aiTokenUsage).toBeDefined();
    });

    it('should_use_ai_absolute_overall_score_when_ai_succeeds', async () => {
      aiEnvState.aiEnabled = true;
      aiEnvState.aiApiKey = 'test-key';
      // 批次④:AI 绝对分直采(overall_score=86),不再依赖 Jimp 假分底 + overall_delta
      vi.mocked(axios.post).mockResolvedValue(
        buildGlmResponse(buildValidAiContent({ overall_score: 86 })),
      );

      const result = await runHybridAnalysis({
        imageSource: 'https://example.com/test.jpg',
        artType: 'painting',
      });

      // overallScore 即 AI 绝对分
      expect(result.overallScore).toBe(86);
    });

    it('should_clamp_ai_absolute_scores_at_parse_level', async () => {
      aiEnvState.aiEnabled = true;
      aiEnvState.aiApiKey = 'test-key';
      // 批次④:解析层 clamp——overall_score=150 → 100;dimension_scores score=-5 → 0
      vi.mocked(axios.post).mockResolvedValue(
        buildGlmResponse(
          buildValidAiContent({
            overall_score: 150,
            dimension_scores: [{ dimension: '构图', score: -5 }],
          }),
        ),
      );

      const result = await runHybridAnalysis({
        imageSource: 'https://example.com/test.jpg',
        artType: 'painting',
      });

      expect(result.overallScore).toBe(100);
      expect(result.dimensions.type === 'painting' && result.dimensions.composition.score).toBe(0);
    });

    it('should_inject_jimp_metrics_into_ai_request', async () => {
      aiEnvState.aiEnabled = true;
      aiEnvState.aiApiKey = 'test-key';
      vi.mocked(axios.post).mockResolvedValue(buildGlmResponse(buildValidAiContent()));

      await runHybridAnalysis({
        imageSource: 'https://example.com/test.jpg',
        artType: 'painting',
      });

      // 验证 AI 请求中包含 Jimp 指标(prompt 中应出现"视觉重心"等)
      const body = vi.mocked(axios.post).mock.calls[0]![1] as { messages: Array<{ content: unknown }> };
      const userMessage = body.messages[1]!;
      const contentArr = userMessage.content as Array<{ type: string; text?: string }>;
      const textPart = contentArr.find((p) => p.type === 'text');
      expect(textPart?.text).toContain('视觉重心');
      expect(textPart?.text).toContain('留白');
    });

    // ---- AI 失败 fallback ----

    it('should_fallback_to_jimp_when_ai_times_out', async () => {
      aiEnvState.aiEnabled = true;
      aiEnvState.aiApiKey = 'test-key';
      vi.mocked(axios.post).mockRejectedValue(buildAxiosError('ECONNABORTED', 'timeout'));

      const result = await runHybridAnalysis({
        imageSource: 'https://example.com/test.jpg',
        artType: 'painting',
      });

      expect(result.aiEnhanced).toBe(false);
      // Phase B5: AI 超时时 aiVisionResult 不再为 null(批次③:降级说明保留,模板建议已下线)
      expect(result.aiVisionResult).not.toBeNull();
      expect(result.aiVisionResult!.professionalSuggestions).toEqual([]);
      expect(result.aiMeta.aiSuccess).toBe(false);
      expect(result.aiMeta.aiFailureReason).toBe('AI_TIMEOUT');
      // Jimp 结果仍然存在(批次③:本地引擎停分,overallScore 为 null)
      expect(result.overallScore).toBeNull();
      expect(result.dimensions.type).toBe('painting');
    });

    it('should_fallback_to_jimp_when_ai_returns_parse_error', async () => {
      aiEnvState.aiEnabled = true;
      aiEnvState.aiApiKey = 'test-key';
      vi.mocked(axios.post).mockResolvedValue(buildGlmResponse('not json'));

      const result = await runHybridAnalysis({
        imageSource: 'https://example.com/test.jpg',
        artType: 'design',
      });

      expect(result.aiEnhanced).toBe(false);
      expect(result.aiMeta.aiFailureReason).toBe('AI_PARSE_ERROR');
      expect(result.dimensions.type).toBe('design');
    });

    it('should_fallback_to_jimp_when_ai_returns_http_error', async () => {
      aiEnvState.aiEnabled = true;
      aiEnvState.aiApiKey = 'test-key';
      vi.mocked(axios.post).mockRejectedValue(buildAxiosError('ERR_BAD_REQUEST', 'Bad Request', 400));

      const result = await runHybridAnalysis({
        imageSource: 'https://example.com/test.jpg',
        artType: 'sculpture',
      });

      expect(result.aiEnhanced).toBe(false);
      expect(result.aiMeta.aiFailureReason).toBe('AI_HTTP_ERROR');
      expect(result.dimensions.type).toBe('sculpture');
    });

    it('should_fallback_to_jimp_when_ai_returns_network_error', async () => {
      aiEnvState.aiEnabled = true;
      aiEnvState.aiApiKey = 'test-key';
      vi.mocked(axios.post).mockRejectedValue(buildAxiosError('ECONNREFUSED', 'Connection refused'));

      const result = await runHybridAnalysis({
        imageSource: 'https://example.com/test.jpg',
        artType: 'product',
      });

      expect(result.aiEnhanced).toBe(false);
      expect(result.aiMeta.aiFailureReason).toBe('AI_NETWORK_ERROR');
      expect(result.dimensions.type).toBe('product');
    });

    it('should_support_all_art_types_in_hybrid_analysis', async () => {
      aiEnvState.aiEnabled = true;
      aiEnvState.aiApiKey = 'test-key';
      vi.mocked(axios.post).mockResolvedValue(buildGlmResponse(buildValidAiContent()));

      const types: ArtType[] = ['painting', 'design', 'product', 'sculpture'];

      for (const artType of types) {
        vi.mocked(axios.post).mockClear();
        const result = await runHybridAnalysis({
          imageSource: 'https://example.com/test.jpg',
          artType,
        });
        expect(result.aiEnhanced).toBe(true);
        expect(result.dimensions.type).toBe(artType);
        expect(result.aiMeta.aiSuccess).toBe(true);
      }
    });
  });

  // ============================================================
  // 测试套件 9:applyDimensionAbsoluteScores(批次④:AI 维度绝对分覆盖,替代 delta 校准)
  // ============================================================

  describe('applyDimensionAbsoluteScores', () => {
    it('should_override_painting_dimension_scores_and_keep_unmatched', () => {
      const jimpResult = buildPaintingResult();
      const originalBrushScore = jimpResult.dimensions.type === 'painting'
        ? jimpResult.dimensions.brushwork.score
        : 0;

      const adjusted = applyDimensionAbsoluteScores(jimpResult.dimensions, [
        { dimension: '构图', score: 68 },
        { dimension: '色彩', score: 82 },
      ]);

      if (adjusted.type === 'painting') {
        expect(adjusted.composition.score).toBe(68);
        expect(adjusted.color.score).toBe(82);
        // 未匹配的维度保留原值(批次③引擎停分后原值为 null)
        expect(adjusted.brushwork.score).toBe(originalBrushScore);
      }
    });

    it('should_override_design_dimension_scores', () => {
      const jimpResult = buildDesignResult();

      const adjusted = applyDimensionAbsoluteScores(jimpResult.dimensions, [
        { dimension: '视觉层次', score: 74 },
        { dimension: '排版', score: 66 },
      ]);

      if (adjusted.type === 'design') {
        expect(adjusted.visualHierarchy.score).toBe(74);
        expect(adjusted.typography.score).toBe(66);
      }
    });

    it('should_override_product_dimension_scores', () => {
      const jimpResult = buildProductResult();

      const adjusted = applyDimensionAbsoluteScores(jimpResult.dimensions, [
        { dimension: '形态', score: 71 },
        { dimension: '材质', score: 79 },
      ]);

      if (adjusted.type === 'product') {
        expect(adjusted.form.score).toBe(71);
        expect(adjusted.materialExpression.score).toBe(79);
      }
    });

    it('should_override_sculpture_dimension_scores', () => {
      const jimpResult = buildSculptureResult();

      const adjusted = applyDimensionAbsoluteScores(jimpResult.dimensions, [
        { dimension: '空间构成', score: 77 },
        { dimension: '形体语言', score: 63 },
      ]);

      if (adjusted.type === 'sculpture') {
        expect(adjusted.spatialComposition.score).toBe(77);
        expect(adjusted.bodyLanguage.score).toBe(63);
      }
    });

    it('should_support_english_dimension_keywords', () => {
      const jimpResult = buildPaintingResult();

      const adjusted = applyDimensionAbsoluteScores(jimpResult.dimensions, [
        { dimension: 'composition', score: 55 },
      ]);

      if (adjusted.type === 'painting') {
        expect(adjusted.composition.score).toBe(55);
      }
    });

    it('should_use_first_match_when_multiple_entries_match_same_dimension', () => {
      const jimpResult = buildPaintingResult();

      // 两条均含"构图"关键词:按顺序取第一条(绝对分覆盖,不再累加 delta)
      const adjusted = applyDimensionAbsoluteScores(jimpResult.dimensions, [
        { dimension: '构图与造型', score: 60 },
        { dimension: '构图', score: 90 },
      ]);

      if (adjusted.type === 'painting') {
        expect(adjusted.composition.score).toBe(60);
      }
    });

    it('should_keep_original_scores_when_no_dimension_matched', () => {
      const jimpResult = buildPaintingResult();
      const originalCompScore = jimpResult.dimensions.type === 'painting'
        ? jimpResult.dimensions.composition.score
        : 0;

      // "原创性"不属于任何标准维度关键词 → 全部保留原值
      const adjusted = applyDimensionAbsoluteScores(jimpResult.dimensions, [
        { dimension: '原创性', score: 99 },
      ]);

      if (adjusted.type === 'painting') {
        expect(adjusted.composition.score).toBe(originalCompScore);
      }
    });

    it('should_return_same_dimensions_reference_when_scores_empty', () => {
      const jimpResult = buildPaintingResult();

      // 空数组短路返回原对象(零开销)
      const adjusted = applyDimensionAbsoluteScores(jimpResult.dimensions, []);

      expect(adjusted).toBe(jimpResult.dimensions);
    });
  });

  // ============================================================
  // 测试套件 10:isAIEnhancedResult / getAIFailureReason
  // ============================================================

  describe('isAIEnhancedResult', () => {
    it('should_return_true_for_ai_enhanced_result', async () => {
      aiEnvState.aiEnabled = true;
      aiEnvState.aiApiKey = 'test-key';
      vi.mocked(axios.post).mockResolvedValue(buildGlmResponse(buildValidAiContent()));

      const result = await runHybridAnalysis({
        imageSource: 'https://example.com/test.jpg',
        artType: 'painting',
      });

      expect(isAIEnhancedResult(result)).toBe(true);
    });

    it('should_return_false_for_jimp_only_result', async () => {
      aiEnvState.aiEnabled = false;
      aiEnvState.aiApiKey = '';

      const result = await runHybridAnalysis({
        imageSource: 'https://example.com/test.jpg',
        artType: 'painting',
      });

      expect(isAIEnhancedResult(result)).toBe(false);
    });

    it('should_return_false_for_plain_analysis_result', () => {
      const plainResult: AnalysisResult = buildPaintingResult();
      expect(isAIEnhancedResult(plainResult)).toBe(false);
    });

    it('should_return_false_for_null', () => {
      expect(isAIEnhancedResult(null)).toBe(false);
    });

    it('should_return_false_for_undefined', () => {
      expect(isAIEnhancedResult(undefined)).toBe(false);
    });

    it('should_return_false_for_non_object', () => {
      expect(isAIEnhancedResult('string')).toBe(false);
      expect(isAIEnhancedResult(42)).toBe(false);
    });
  });

  describe('getAIFailureReason', () => {
    it('should_return_failure_reason_when_ai_failed', async () => {
      aiEnvState.aiEnabled = true;
      aiEnvState.aiApiKey = 'test-key';
      vi.mocked(axios.post).mockRejectedValue(buildAxiosError('ECONNABORTED', 'timeout'));

      const result = await runHybridAnalysis({
        imageSource: 'https://example.com/test.jpg',
        artType: 'painting',
      });

      expect(getAIFailureReason(result)).toBe('AI_TIMEOUT');
    });

    it('should_return_null_when_ai_succeeded', async () => {
      aiEnvState.aiEnabled = true;
      aiEnvState.aiApiKey = 'test-key';
      vi.mocked(axios.post).mockResolvedValue(buildGlmResponse(buildValidAiContent()));

      const result = await runHybridAnalysis({
        imageSource: 'https://example.com/test.jpg',
        artType: 'painting',
      });

      expect(getAIFailureReason(result)).toBeNull();
    });

    it('should_return_disabled_reason_when_ai_disabled', async () => {
      aiEnvState.aiEnabled = false;
      aiEnvState.aiApiKey = '';

      const result = await runHybridAnalysis({
        imageSource: 'https://example.com/test.jpg',
        artType: 'painting',
      });

      expect(getAIFailureReason(result)).toBe('AI_DISABLED');
    });

    it('should_return_null_for_plain_analysis_result', () => {
      const plainResult: AnalysisResult = buildPaintingResult();
      expect(getAIFailureReason(plainResult)).toBeNull();
    });

    it('should_return_null_for_null_input', () => {
      expect(getAIFailureReason(null)).toBeNull();
    });
  });
});

// ============================================================
// 测试套件 11:AI 启用验证工作流(P3-2.4)
// 模拟生产环境逐步启用 AI 的完整流程:
//   禁用 → 启用但无 Key → 填入 GLM Key → 切换 TRAE(不完整)→ TRAE 完整
// 验证每一步 isAIEnabled() + analyzeWithAI() 的行为符合预期
// ============================================================

describe('AI enablement workflow (P3-2.4)', () => {
  // ---- 步骤 1:AI 完全禁用 ----

  it('step1_disabled_state_returns_disabled_in_hybrid', async () => {
    aiEnvState.aiEnabled = false;
    aiEnvState.aiApiKey = '';
    aiEnvState.aiProvider = 'glm';

    expect(isAIEnabled()).toBe(false);

    const result = await runHybridAnalysis({
      imageSource: 'https://example.com/test.jpg',
      artType: 'painting',
    });

    expect(result.aiEnhanced).toBe(false);
    expect(result.aiMeta.aiFailureReason).toBe('AI_DISABLED');
  });

  // ---- 步骤 2:启用 AI_ENABLED=true 但未填 Key ----

  it('step2_enabled_but_no_key_still_disabled', async () => {
    aiEnvState.aiEnabled = true;
    aiEnvState.aiApiKey = '';
    aiEnvState.aiProvider = 'glm';

    expect(isAIEnabled()).toBe(false);

    const result = await analyzeWithAI(buildAiRequest());
    expect(result.success).toBe(false);
    expect(result.failureReason).toBe('AI_KEY_MISSING');
  });

  // ---- 步骤 3:填入 GLM Key,AI 正式启用 ----

  it('step3_glm_key_present_enables_ai_and_succeeds', async () => {
    aiEnvState.aiEnabled = true;
    aiEnvState.aiApiKey = 'glm-key-step3';
    aiEnvState.aiProvider = 'glm';

    expect(isAIEnabled()).toBe(true);

    vi.mocked(axios.post).mockResolvedValue(buildGlmResponse(buildValidAiContent()));
    const result = await analyzeWithAI(buildAiRequest());

    expect(result.success).toBe(true);
    // 验证请求发往 GLM 端点
    const callUrl = vi.mocked(axios.post).mock.calls[0]![0];
    expect(callUrl).toBe(aiEnvState.aiApiUrl);
  });

  // ---- 步骤 4:切换 TRAE provider 但 TRAE 凭证不完整 → 自动降级到 GLM ----

  it('step4_trae_provider_incomplete_falls_back_to_glm', async () => {
    aiEnvState.aiEnabled = true;
    aiEnvState.aiProvider = 'trae';
    aiEnvState.aiApiKey = 'glm-fallback-key';
    aiEnvState.traeApiKey = ''; // TRAE key 缺失
    aiEnvState.traeApiUrl = '';
    aiEnvState.traeApiModel = '';

    expect(isAIEnabled()).toBe(true); // GLM key 仍可用

    vi.mocked(axios.post).mockResolvedValue(buildGlmResponse(buildValidAiContent()));
    const result = await analyzeWithAI(buildAiRequest());

    expect(result.success).toBe(true);
    // 验证请求发往 GLM 端点(降级),而非 TRAE
    const callUrl = vi.mocked(axios.post).mock.calls[0]![0];
    expect(callUrl).toBe(aiEnvState.aiApiUrl);
  });

  // ---- 步骤 5:TRAE 凭证完整 → 使用 TRAE ----

  it('step5_trae_fully_configured_uses_trae', async () => {
    aiEnvState.aiEnabled = true;
    aiEnvState.aiProvider = 'trae';
    aiEnvState.aiApiKey = 'glm-backup-key';
    aiEnvState.traeApiKey = 'trae-key-step5';
    aiEnvState.traeApiUrl = 'https://trae-api.example.com/v1/chat/completions';
    aiEnvState.traeApiModel = 'trae-vision-v1';

    expect(isAIEnabled()).toBe(true);

    vi.mocked(axios.post).mockResolvedValue(buildGlmResponse(buildValidAiContent()));
    const result = await analyzeWithAI(buildAiRequest());

    expect(result.success).toBe(true);
    // 验证请求发往 TRAE 端点,而非 GLM
    const callUrl = vi.mocked(axios.post).mock.calls[0]![0];
    expect(callUrl).toBe('https://trae-api.example.com/v1/chat/completions');
    const body = vi.mocked(axios.post).mock.calls[0]![1] as { model: string };
    expect(body.model).toBe('trae-vision-v1');
  });

  // ---- isAIEnabled 的 TRAE 组合覆盖 ----

  it('isAIEnabled_true_when_trae_key_and_url_both_present', () => {
    aiEnvState.aiEnabled = true;
    aiEnvState.aiApiKey = ''; // GLM key 缺失
    aiEnvState.aiProvider = 'trae';
    aiEnvState.traeApiKey = 'trae-key';
    aiEnvState.traeApiUrl = 'https://trae.example.com';
    expect(isAIEnabled()).toBe(true);
  });

  it('isAIEnabled_false_when_trae_key_present_but_url_missing', () => {
    aiEnvState.aiEnabled = true;
    aiEnvState.aiApiKey = '';
    aiEnvState.aiProvider = 'trae';
    aiEnvState.traeApiKey = 'trae-key';
    aiEnvState.traeApiUrl = ''; // URL 缺失
    expect(isAIEnabled()).toBe(false);
  });

  // ---- 启用后超时仍走 fallback(3 秒 SLA 保障) ----

  it('enabled_ai_timeout_falls_back_to_jimp_template_suggestions', async () => {
    aiEnvState.aiEnabled = true;
    aiEnvState.aiApiKey = 'test-key';
    aiEnvState.aiProvider = 'glm';

    vi.mocked(axios.post).mockRejectedValue(buildAxiosError('ECONNABORTED', 'timeout of 2500ms exceeded'));

    const result = await runHybridAnalysis({
      imageSource: 'https://example.com/test.jpg',
      artType: 'painting',
    });

    expect(result.aiEnhanced).toBe(false);
    expect(result.aiMeta.aiFailureReason).toBe('AI_TIMEOUT');
    // Phase B5: 超时后 aiVisionResult 不为 null(批次③:降级说明保留,模板建议已下线)
    expect(result.aiVisionResult).not.toBeNull();
    expect(result.aiVisionResult!.professionalSuggestions).toEqual([]);
    // Jimp 分析结果仍可用(批次③:本地引擎停分,overallScore 为 null)
    expect(result.overallScore).toBeNull();
  });
});
