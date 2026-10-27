// ============================================================
// 风格分析服务 测试(M-4 风格迁移专项 M4-T3)
// 对应源码:src/services/style-analysis.service.ts
// 对应文档:.trae/documents/m4-style-transfer-plan-2026-09-22.md §2.3 / §2.4 / §2.5
//
// 测试范围(M4-T3 验收要点):
//   1. analyzeStyle 七字段解析/校验:正常 JSON / markdown 包裹 JSON /
//      含前后解释文字 / 缺字段拒绝 / 空串拒绝 / styleSeed 超 200 字拒绝
//      (均 AI_PARSE_ERROR 且不重试)
//   2. 故障与重试策略:超时(重试一次后抛出) / 网络错误(重试后抛出) /
//      重试后成功 / HTTP 错误不重试 / 解析错误不重试 / Key 缺失
//   3. 双提供商降级:glm 直连 / trae 配置缺失降级 glm / 双缺失 AI_KEY_MISSING
//   4. 请求体结构:chat/completions + image_url 数组 + system prompt 注入 +
//      独立超时 aiStyleTimeout
//   5. buildStyleTransferPrompt:七字段注入 / artType 中文映射 / 硬性要求条款
//   6. 日志脱敏:输出不含 base64 / 完整 dataURL,仅含来源类型
//
// Mock 策略:
//   - vi.mock('axios'):拦截 GLM-4V chat/completions 调用,控制响应
//   - vi.mock('../src/config/env.js'):允许 per-test 配置 AI_* / AI_STYLE_TIMEOUT
//   - ai-vision.service 不 mock:resolveAIConfig / extractJsonFromContent
//     为纯函数,走真实实现验证复用集成
//   - 重试退避 1000ms:vi.useFakeTimers + advanceTimersByTimeAsync 推进,
//     避免真实等待拖慢测试
// ============================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ============================================================
// 1. vi.hoisted:声明 mock 状态(在 vi.mock 工厂之前 hoisted)
// ============================================================

const { styleEnvState } = vi.hoisted(() => ({
  // 风格分析环境变量覆盖(每个测试可修改)
  styleEnvState: {
    aiEnabled: true,
    aiProvider: 'glm' as 'glm' | 'trae',
    aiApiKey: 'glm-test-key',
    aiApiUrl: 'https://test-ai-api.example.com/v1/chat/completions',
    aiApiModel: 'glm-4v-flash-test',
    aiStyleTimeout: 20000,
    traeApiKey: '',
    traeApiUrl: '',
    traeApiModel: '',
  },
}));

// ============================================================
// 2. vi.mock:axios(拦截 GLM-4V chat/completions 调用)
// ============================================================

vi.mock('axios', () => ({
  default: {
    post: vi.fn(),
  },
}));

// ============================================================
// 3. vi.mock:env(允许 per-test 配置 AI_* 字段)
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

  // 每次调用 env() 时合并静态配置 + 当前风格分析覆盖值
  function buildEnv() {
    return {
      ...staticConfig,
      aiEnabled: styleEnvState.aiEnabled,
      aiProvider: styleEnvState.aiProvider,
      aiApiKey: styleEnvState.aiApiKey,
      aiApiUrl: styleEnvState.aiApiUrl,
      aiApiTimeout: 2500,
      aiApiModel: styleEnvState.aiApiModel,
      aiApiModels: [styleEnvState.aiApiModel],
      aiApiMaxTokens: 1024,
      aiQaTimeout: 60000,
      aiEnhanceTimeout: 15000,
      // M-4 新增:风格分析独立超时(真源 §2.8)
      aiStyleTimeout: styleEnvState.aiStyleTimeout,
      traeApiKey: styleEnvState.traeApiKey,
      traeApiUrl: styleEnvState.traeApiUrl,
      traeApiModel: styleEnvState.traeApiModel,
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
  analyzeStyle,
  buildStyleTransferPrompt,
  StyleAnalysisError,
  STYLE_PROMPT_TEMPLATE_VERSION,
} from '../src/services/style-analysis.service.js';
import type { StyleAnalysis, ArtType } from '../src/types/api-contract.js';
import { logger } from '../src/utils/logger.js';

/** 类型化 axios mock(便于 per-test 配置响应) */
const mockedAxiosPost = axios.post as unknown as ReturnType<typeof vi.fn>;

// ============================================================
// 5. 辅助函数:构造测试数据
// ============================================================

/** 测试用风格参考图(http URL 模式) */
const HTTP_IMAGE_URL = 'https://cdn.example.com/master-piece.jpg';

/** 测试用风格参考图(dataURL 模式,内容为伪造标记,验证日志不泄漏) */
const DATA_URL_IMAGE =
  'data:image/jpeg;base64,TEST_FAKE_IMAGE_DATA_SHOULD_NEVER_APPEAR_IN_LOGS';

/**
 * 构造有效的七字段风格分析 JSON(模拟 GLM-4V 返回,取值参照真源 §2.4 示例)
 */
function buildValidStyleJson(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    medium: '布面油画，颜料厚堆有光泽',
    brushwork: '短促断续的厚涂笔触，笔触明显外露',
    colorSystem: '高饱和补色对比，明度对比强烈',
    composition: '三角形稳定构图，前景物体放大主导视线',
    technique: '湿画法晕染，刮刀堆叠肌理',
    expression: '后印象派主观化表现，情绪外化、形体夸张',
    styleSeed: '厚涂油画质感，短促有力的断续笔触，高饱和补色对比的色彩关系',
    ...overrides,
  };
}

/**
 * 构造有效的七字段 StyleAnalysis 对象(直接作为 buildStyleTransferPrompt 入参)
 */
function buildValidStyleAnalysis(overrides?: Partial<StyleAnalysis>): StyleAnalysis {
  return {
    medium: '布面油画',
    brushwork: '厚涂断续笔触',
    colorSystem: '高饱和补色对比',
    composition: '三角形稳定构图',
    technique: '刮刀堆叠肌理',
    expression: '后印象派主观化表现',
    styleSeed: '厚涂油画质感与主观化色彩',
    ...overrides,
  };
}

/**
 * 将 content 包装为 GLM-4V chat/completions 响应格式
 */
function buildStyleResponse(
  content: string,
): { data: { choices: Array<{ message: { content: string } }> }; status: number } {
  return {
    data: {
      choices: [{ message: { content } }],
    },
    status: 200,
  };
}

/**
 * 构造 axios 错误对象(模拟超时/网络/HTTP 错误)
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

/** 重置 env 覆盖值到默认(glm 直连) */
function resetEnv(): void {
  styleEnvState.aiEnabled = true;
  styleEnvState.aiProvider = 'glm';
  styleEnvState.aiApiKey = 'glm-test-key';
  styleEnvState.aiApiUrl = 'https://test-ai-api.example.com/v1/chat/completions';
  styleEnvState.aiApiModel = 'glm-4v-flash-test';
  styleEnvState.aiStyleTimeout = 20000;
  styleEnvState.traeApiKey = '';
  styleEnvState.traeApiUrl = '';
  styleEnvState.traeApiModel = '';
}

/** 通用 beforeEach:重置 env 与 axios mock */
function resetAll(): void {
  resetEnv();
  mockedAxiosPost.mockReset();
}

// ============================================================
// 6. 测试用例:七字段解析与校验
// ============================================================

describe('analyzeStyle 七字段解析与校验', () => {
  beforeEach(() => resetAll());

  it('正常纯 JSON → 返回七字段', async () => {
    mockedAxiosPost.mockResolvedValueOnce(
      buildStyleResponse(JSON.stringify(buildValidStyleJson())),
    );
    const result = await analyzeStyle(HTTP_IMAGE_URL, 'painting');
    expect(result).toEqual(buildValidStyleJson());
    expect(mockedAxiosPost).toHaveBeenCalledTimes(1);
  });

  it('markdown 代码块包裹 JSON → 解析成功', async () => {
    const wrapped = '```json\n' + JSON.stringify(buildValidStyleJson()) + '\n```';
    mockedAxiosPost.mockResolvedValueOnce(buildStyleResponse(wrapped));
    const result = await analyzeStyle(HTTP_IMAGE_URL, 'painting');
    expect(result.medium).toBe('布面油画，颜料厚堆有光泽');
    expect(result.styleSeed).toContain('厚涂油画质感');
  });

  it('含前后解释文字的 JSON → 解析成功', async () => {
    const noisy =
      '好的，以下是风格拆解结果：\n' +
      JSON.stringify(buildValidStyleJson()) +
      '\n以上供参考。';
    mockedAxiosPost.mockResolvedValueOnce(buildStyleResponse(noisy));
    const result = await analyzeStyle(HTTP_IMAGE_URL, 'design');
    expect(result.composition).toBe('三角形稳定构图，前景物体放大主导视线');
  });

  it('dataURL 输入 → 以 image_url 数组原样传入请求体', async () => {
    mockedAxiosPost.mockResolvedValueOnce(
      buildStyleResponse(JSON.stringify(buildValidStyleJson())),
    );
    await analyzeStyle(DATA_URL_IMAGE, 'painting');
    const [, body] = mockedAxiosPost.mock.calls[0] as unknown as [
      string,
      { messages: Array<{ role: string; content: unknown }> },
    ];
    const userContent = body.messages[1]!.content as Array<{ type: string; image_url?: { url: string } }>;
    expect(userContent[1]).toEqual({ type: 'image_url', image_url: { url: DATA_URL_IMAGE } });
  });

  it('缺失字段(无 medium) → AI_PARSE_ERROR 且不重试(单次调用)', async () => {
    const { medium: _medium, ...partial } = buildValidStyleJson();
    mockedAxiosPost.mockResolvedValueOnce(buildStyleResponse(JSON.stringify(partial)));
    await expect(analyzeStyle(HTTP_IMAGE_URL, 'painting')).rejects.toMatchObject({
      failureReason: 'AI_PARSE_ERROR',
    });
    expect(mockedAxiosPost).toHaveBeenCalledTimes(1);
  });

  it('字段为空串(brushwork="") → AI_PARSE_ERROR', async () => {
    mockedAxiosPost.mockResolvedValueOnce(
      buildStyleResponse(JSON.stringify(buildValidStyleJson({ brushwork: '' }))),
    );
    await expect(analyzeStyle(HTTP_IMAGE_URL, 'painting')).rejects.toMatchObject({
      failureReason: 'AI_PARSE_ERROR',
    });
    expect(mockedAxiosPost).toHaveBeenCalledTimes(1);
  });

  it('styleSeed 超过 200 字 → AI_PARSE_ERROR', async () => {
    mockedAxiosPost.mockResolvedValueOnce(
      buildStyleResponse(
        JSON.stringify(buildValidStyleJson({ styleSeed: '风'.repeat(201) })),
      ),
    );
    await expect(analyzeStyle(HTTP_IMAGE_URL, 'painting')).rejects.toMatchObject({
      failureReason: 'AI_PARSE_ERROR',
    });
    expect(mockedAxiosPost).toHaveBeenCalledTimes(1);
  });

  it('styleSeed 恰好 200 字 → 校验通过(边界)', async () => {
    mockedAxiosPost.mockResolvedValueOnce(
      buildStyleResponse(JSON.stringify(buildValidStyleJson({ styleSeed: '风'.repeat(200) }))),
    );
    const result = await analyzeStyle(HTTP_IMAGE_URL, 'painting');
    expect(result.styleSeed).toHaveLength(200);
  });

  it('响应缺少 content(choices 为空) → AI_PARSE_ERROR', async () => {
    mockedAxiosPost.mockResolvedValueOnce({ data: { choices: [] }, status: 200 });
    await expect(analyzeStyle(HTTP_IMAGE_URL, 'painting')).rejects.toMatchObject({
      failureReason: 'AI_PARSE_ERROR',
    });
    expect(mockedAxiosPost).toHaveBeenCalledTimes(1);
  });

  it('content 为非 JSON 纯文本 → AI_PARSE_ERROR 且不重试', async () => {
    mockedAxiosPost.mockResolvedValueOnce(buildStyleResponse('这幅作品很不错，风格强烈。'));
    await expect(analyzeStyle(HTTP_IMAGE_URL, 'painting')).rejects.toMatchObject({
      failureReason: 'AI_PARSE_ERROR',
    });
    expect(mockedAxiosPost).toHaveBeenCalledTimes(1);
  });

  it('七字段含数字类型字段(medium=123) → AI_PARSE_ERROR(Zod 类型拒绝)', async () => {
    mockedAxiosPost.mockResolvedValueOnce(
      buildStyleResponse(JSON.stringify(buildValidStyleJson({ medium: 123 }))),
    );
    await expect(analyzeStyle(HTTP_IMAGE_URL, 'painting')).rejects.toMatchObject({
      failureReason: 'AI_PARSE_ERROR',
    });
  });
});

// ============================================================
// 7. 测试用例:故障与重试策略(真源 §2.3:单次重试,退避 1000ms)
// ============================================================

describe('analyzeStyle 故障与重试策略', () => {
  beforeEach(() => {
    resetAll();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('超时 → 重试一次后仍超时 → 抛 AI_TIMEOUT,共 2 次调用,retried=true', async () => {
    mockedAxiosPost
      .mockRejectedValueOnce(buildAxiosError('ECONNABORTED', 'timeout of 20000ms exceeded'))
      .mockRejectedValueOnce(buildAxiosError('ECONNABORTED', 'timeout of 20000ms exceeded'));
    // 先同步挂接断言(避免 promise 在时钟推进期间 reject 触发 unhandledRejection)
    const assertion = expect(analyzeStyle(HTTP_IMAGE_URL, 'painting', 'trace-retry-1')).rejects.toMatchObject({
      failureReason: 'AI_TIMEOUT',
      retried: true,
    });
    // 推进退避 1000ms 触发第二次尝试
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    expect(mockedAxiosPost).toHaveBeenCalledTimes(2);
  });

  it('首次超时、重试成功 → 返回七字段结果(不抛出)', async () => {
    mockedAxiosPost
      .mockRejectedValueOnce(buildAxiosError('ETIMEDOUT', 'connection timed out'))
      .mockResolvedValueOnce(buildStyleResponse(JSON.stringify(buildValidStyleJson())));
    const promise = analyzeStyle(HTTP_IMAGE_URL, 'painting');
    await vi.advanceTimersByTimeAsync(1000);
    const result = await promise;
    expect(result.medium).toBe('布面油画，颜料厚堆有光泽');
    expect(mockedAxiosPost).toHaveBeenCalledTimes(2);
  });

  it('网络错误 → 重试一次后抛 AI_NETWORK_ERROR,共 2 次调用', async () => {
    mockedAxiosPost
      .mockRejectedValueOnce(buildAxiosError('ECONNREFUSED', 'connect ECONNREFUSED'))
      .mockRejectedValueOnce(buildAxiosError('ECONNRESET', 'socket hang up'));
    const assertion = expect(analyzeStyle(HTTP_IMAGE_URL, 'painting')).rejects.toMatchObject({
      failureReason: 'AI_NETWORK_ERROR',
      retried: true,
    });
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    expect(mockedAxiosPost).toHaveBeenCalledTimes(2);
  });

  it('AbortController 主动取消(ERR_CANCELED) → 归类 AI_TIMEOUT 并重试', async () => {
    const canceledErr = new Error('canceled') as Error & { code: string };
    canceledErr.code = 'ERR_CANCELED';
    mockedAxiosPost
      .mockRejectedValueOnce(canceledErr)
      .mockResolvedValueOnce(buildStyleResponse(JSON.stringify(buildValidStyleJson())));
    const promise = analyzeStyle(HTTP_IMAGE_URL, 'painting');
    await vi.advanceTimersByTimeAsync(1000);
    const result = await promise;
    expect(result.styleSeed).toContain('厚涂油画质感');
    expect(mockedAxiosPost).toHaveBeenCalledTimes(2);
  });

  it('HTTP 400 错误 → 不重试(单次调用),抛 AI_HTTP_ERROR', async () => {
    mockedAxiosPost.mockRejectedValueOnce(
      buildAxiosError('ERR_BAD_REQUEST', 'Request failed with status code 400', 400),
    );
    await expect(analyzeStyle(HTTP_IMAGE_URL, 'painting')).rejects.toMatchObject({
      failureReason: 'AI_HTTP_ERROR',
      retried: false,
    });
    expect(mockedAxiosPost).toHaveBeenCalledTimes(1);
  });

  it('解析错误 → 不重试(单次调用),抛 AI_PARSE_ERROR', async () => {
    mockedAxiosPost.mockResolvedValueOnce(buildStyleResponse('无法解析的响应'));
    await expect(analyzeStyle(HTTP_IMAGE_URL, 'painting')).rejects.toMatchObject({
      failureReason: 'AI_PARSE_ERROR',
      retried: false,
    });
    expect(mockedAxiosPost).toHaveBeenCalledTimes(1);
  });

  it('无法识别的错误(无 code/无 response) → AI_UNKNOWN_ERROR 且不重试', async () => {
    mockedAxiosPost.mockRejectedValueOnce(new Error('some weird failure'));
    await expect(analyzeStyle(HTTP_IMAGE_URL, 'painting')).rejects.toMatchObject({
      failureReason: 'AI_UNKNOWN_ERROR',
    });
    expect(mockedAxiosPost).toHaveBeenCalledTimes(1);
  });
});

// ============================================================
// 8. 测试用例:双提供商降级与请求体结构
// ============================================================

describe('analyzeStyle 双提供商降级与请求体结构', () => {
  beforeEach(() => resetAll());

  it('aiProvider=glm + key 存在 → 请求走 glm 端点,Bearer 凭据 + system prompt + image_url 数组注入', async () => {
    mockedAxiosPost.mockResolvedValueOnce(
      buildStyleResponse(JSON.stringify(buildValidStyleJson())),
    );
    await analyzeStyle(HTTP_IMAGE_URL, 'sculpture');

    expect(mockedAxiosPost).toHaveBeenCalledTimes(1);
    const [url, body, config] = mockedAxiosPost.mock.calls[0] as unknown as [
      string,
      {
        model: string;
        temperature: number;
        max_tokens: number;
        stream: boolean;
        response_format?: { type: string };
        messages: Array<{ role: string; content: unknown }>;
      },
      { timeout: number; headers: Record<string, string> },
    ];

    // 端点与凭据(resolveAIConfig glm 直连)
    expect(url).toBe('https://test-ai-api.example.com/v1/chat/completions');
    expect(config.headers.Authorization).toBe('Bearer glm-test-key');

    // 请求体:chat/completions 标准结构
    expect(body.model).toBe('glm-4v-flash-test');
    expect(body.temperature).toBe(0.3);
    expect(body.stream).toBe(false);
    expect(body.response_format).toEqual({ type: 'json_object' });

    // system prompt 注入(真源 §2.3 原文关键句)
    expect(body.messages[0]!.role).toBe('system');
    const systemContent = body.messages[0]!.content as string;
    expect(systemContent).toContain('风格分析专家');
    expect(systemContent).toContain('styleSeed');
    expect(systemContent).toContain('{"medium":"..."');

    // user 消息:text(artType 侧重) + image_url 数组
    expect(body.messages[1]!.role).toBe('user');
    const userContent = body.messages[1]!.content as Array<
      { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }
    >;
    expect(userContent[0]!.type).toBe('text');
    expect(userContent[0]!.text).toContain('雕塑');
    expect(userContent[1]).toEqual({ type: 'image_url', image_url: { url: HTTP_IMAGE_URL } });
  });

  it('aiProvider=trae 配置缺失 → 降级 glm(复用诊断 GLM 凭据),请求走 glm 端点', async () => {
    styleEnvState.aiProvider = 'trae';
    styleEnvState.traeApiKey = ''; // TRAE key 缺失 → 降级
    mockedAxiosPost.mockResolvedValueOnce(
      buildStyleResponse(JSON.stringify(buildValidStyleJson())),
    );
    await analyzeStyle(HTTP_IMAGE_URL, 'painting');

    const [url, , config] = mockedAxiosPost.mock.calls[0] as unknown as [
      string,
      unknown,
      { headers: Record<string, string> },
    ];
    expect(url).toBe('https://test-ai-api.example.com/v1/chat/completions');
    expect(config.headers.Authorization).toBe('Bearer glm-test-key');
  });

  it('双提供商凭据均缺失 → AI_KEY_MISSING,axios 未被调用', async () => {
    styleEnvState.aiProvider = 'glm';
    styleEnvState.aiApiKey = '';
    await expect(analyzeStyle(HTTP_IMAGE_URL, 'painting')).rejects.toMatchObject({
      failureReason: 'AI_KEY_MISSING',
    });
    expect(mockedAxiosPost).not.toHaveBeenCalled();
  });

  it('超时参数使用独立 aiStyleTimeout(非诊断 aiApiTimeout)', async () => {
    styleEnvState.aiStyleTimeout = 5000;
    mockedAxiosPost.mockResolvedValueOnce(
      buildStyleResponse(JSON.stringify(buildValidStyleJson())),
    );
    await analyzeStyle(HTTP_IMAGE_URL, 'painting');
    const [, , config] = mockedAxiosPost.mock.calls[0] as unknown as [
      string,
      unknown,
      { timeout: number },
    ];
    expect(config.timeout).toBe(5000);
  });
});

// ============================================================
// 9. 测试用例:buildStyleTransferPrompt(真源 §2.5 模板)
// ============================================================

describe('buildStyleTransferPrompt(组合生图 prompt)', () => {
  it('七字段 + 内容描述注入正确', () => {
    const analysis = buildValidStyleAnalysis();
    const prompt = buildStyleTransferPrompt(analysis, '一位戴草帽的少女站在麦田边', 'painting');
    expect(prompt).toContain('以布面油画的媒介质感');
    expect(prompt).toContain('运用厚涂断续笔触的笔触');
    expect(prompt).toContain('采用高饱和补色对比的色彩关系与三角形稳定构图的构图法则');
    expect(prompt).toContain('借助刮刀堆叠肌理等技法');
    expect(prompt).toContain('呈现后印象派主观化表现的表现倾向');
    expect(prompt).toContain('创作一幅全新的绘画作品：一位戴草帽的少女站在麦田边');
  });

  it('artType 中文映射正确(四类画种)', () => {
    const analysis = buildValidStyleAnalysis();
    const cases: Array<[ArtType, string]> = [
      ['painting', '绘画'],
      ['design', '设计'],
      ['product', '产品设计'],
      ['sculpture', '雕塑'],
    ];
    for (const [artType, label] of cases) {
      const prompt = buildStyleTransferPrompt(analysis, '测试内容', artType);
      expect(prompt).toContain(`创作一幅全新的${label}作品`);
      expect(prompt).toContain(`细节刻画符合${label}的媒介特性`);
    }
  });

  it('heritage 类型 → 兜底映射"非遗"(类型完备,不产生 undefined)', () => {
    const prompt = buildStyleTransferPrompt(buildValidStyleAnalysis(), '测试内容', 'heritage');
    expect(prompt).toContain('创作一幅全新的非遗作品');
    expect(prompt).not.toContain('undefined');
  });

  it('版权硬性要求条款原文存在(§6.2 版权合规内置)', () => {
    const prompt = buildStyleTransferPrompt(buildValidStyleAnalysis(), '测试内容', 'painting');
    expect(prompt).toContain('硬性要求：仅学习上述风格语言与表现手法');
    expect(prompt).toContain('严禁复制任何参考作品中的具体物象、人物形象与标志性构图符号');
    expect(prompt).toContain('画面内容完全服从上述新描述');
    expect(prompt).toContain('整体风格高度统一，细节刻画符合绘画的媒介特性。');
  });

  it('STYLE_PROMPT_TEMPLATE_VERSION 为 v2(版本化,§2.5;v1→v2 句读规整迭代)', () => {
    expect(STYLE_PROMPT_TEMPLATE_VERSION).toBe('v2');
  });

  it('字段值为完整句子(含句号)时句读规整,消除"X。的Y"病句(v2 迭代)', () => {
    // M4-T9 实测复现:GLM-4V 返回的 brushwork 常为完整句子,尾部句号直接嵌入
    // "运用X的笔触"后产生"…书写性。的笔触"病句(v1)
    const analysis = buildValidStyleAnalysis({
      brushwork: '短促、破碎且富有节奏感的笔触，笔触方向随光影流动，具有明显的肌理感与书写性。',
      composition: '采用水平分层式构图。前景、中景、远景通过冷暖虚实推移营造层次。',
    });
    const prompt = buildStyleTransferPrompt(analysis, '测试内容', 'painting');
    // 尾部句号去除:不再出现"。的笔触"
    expect(prompt).not.toContain('。的笔触');
    expect(prompt).not.toContain('。的构图法则');
    // 内部句号转逗号:语义链连贯
    expect(prompt).toContain('采用水平分层式构图，前景、中景、远景通过冷暖虚实推移营造层次的构图法则');
    // 无标点短语字段不受影响(v1 行为保持)
    expect(prompt).toContain('以布面油画的媒介质感');
  });
});

// ============================================================
// 10. 测试用例:日志脱敏(不记录 base64 / 完整 dataURL)
// ============================================================

describe('analyzeStyle 日志脱敏(§2.3 日志规则)', () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetAll();
    infoSpy = vi.spyOn(logger, 'info');
    warnSpy = vi.spyOn(logger, 'warn');
  });
  afterEach(() => {
    infoSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('dataURL 输入成功 → 日志不含 base64 / 完整 dataURL,仅含来源类型 dataURL', async () => {
    mockedAxiosPost.mockResolvedValueOnce(
      buildStyleResponse(JSON.stringify(buildValidStyleJson())),
    );
    await analyzeStyle(DATA_URL_IMAGE, 'painting', 'trace-log-1');

    const allLogged = JSON.stringify([...infoSpy.mock.calls, ...warnSpy.mock.calls]);
    // 严禁出现图片数据(base64 字样 / dataURL 前缀 / 伪造数据本体)
    expect(allLogged).not.toContain('base64');
    expect(allLogged).not.toContain('data:image');
    expect(allLogged).not.toContain('TEST_FAKE_IMAGE_DATA');
    // 仅记录来源类型与必要元信息
    expect(allLogged).toContain('dataURL');
    expect(allLogged).toContain('painting');
    expect(allLogged).toContain('glm');
    expect(allLogged).toContain('trace-log-1');
  });

  it('http URL 输入成功 → 日志记录来源类型 http,不含完整 URL', async () => {
    mockedAxiosPost.mockResolvedValueOnce(
      buildStyleResponse(JSON.stringify(buildValidStyleJson())),
    );
    await analyzeStyle(HTTP_IMAGE_URL, 'design');

    const allLogged = JSON.stringify([...infoSpy.mock.calls, ...warnSpy.mock.calls]);
    expect(allLogged).not.toContain(HTTP_IMAGE_URL);
    expect(allLogged).toContain('"http"');
  });

  it('失败日志同样脱敏(超时重试终态,不含图片数据)', async () => {
    vi.useFakeTimers();
    try {
      mockedAxiosPost
        .mockRejectedValueOnce(buildAxiosError('ECONNABORTED', 'timeout of 20000ms exceeded'))
        .mockRejectedValueOnce(buildAxiosError('ECONNABORTED', 'timeout of 20000ms exceeded'));
      const assertion = expect(
        analyzeStyle(DATA_URL_IMAGE, 'painting'),
      ).rejects.toBeInstanceOf(StyleAnalysisError);
      await vi.advanceTimersByTimeAsync(1000);
      await assertion;
      const allLogged = JSON.stringify([...infoSpy.mock.calls, ...warnSpy.mock.calls]);
      expect(allLogged).not.toContain('base64');
      expect(allLogged).not.toContain('TEST_FAKE_IMAGE_DATA');
    } finally {
      vi.useRealTimers();
    }
  });

  it('traceId 透传到成功日志', async () => {
    mockedAxiosPost.mockResolvedValueOnce(
      buildStyleResponse(JSON.stringify(buildValidStyleJson())),
    );
    await analyzeStyle(HTTP_IMAGE_URL, 'painting', 'trace-abc-123');
    const infoLogged = JSON.stringify(infoSpy.mock.calls);
    expect(infoLogged).toContain('trace-abc-123');
  });
});
