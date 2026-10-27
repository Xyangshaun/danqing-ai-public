// ============================================================
// AI 图像生成服务 测试
// 对应源码:src/services/image-generation.service.ts
// 对应文档:.trae/documents/m2-generation-plan-2026-08-07.md §2.2 / §2.4
//
// 测试范围:
//   1. resolveImageAIConfig:双提供商降级逻辑
//      - 主=glm + key → glm, fallback=false
//      - 主=glm + 无 key → null
//      - 主=trae + key+url 完整 → trae, fallback=false
//      - 主=trae + key 缺失 → 降级 glm(复用诊断 GLM 凭据),fallback=true
//      - 主=trae + 双提供商均不可用 → null
//   2. isImageGenerationEnabled:启用判定
//   3. extractImageUrls:URL/base64 提取 + count 截断
//   4. generateImage:成功(URL/base64) / Key 缺失 / 超时 / 网络 / HTTP / 无图
//
// Mock 策略:
//   - vi.mock('axios'):拦截图像生成 API 调用,控制响应
//   - vi.mock('../src/config/env.js'):允许 per-test 配置 AI_IMAGE_* 字段
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ============================================================
// 1. vi.hoisted:声明 mock 状态(在 vi.mock 工厂之前 hoisted)
// ============================================================

const { imageEnvState } = vi.hoisted(() => ({
  // 图像生成环境变量覆盖(每个测试可修改)
  imageEnvState: {
    aiImageProvider: 'trae' as 'trae' | 'glm',
    aiImageApiKey: 'image-key-trae',
    aiImageApiUrl: 'https://test-image-api.example.com/v1/images/generations',
    aiImageApiModel: 'image-model-trae',
    aiImageTimeout: 30000,
    generationMaxCount: 4,
    // 降级备用(diagnostic GLM 凭据)
    aiApiKey: 'diag-glm-key',
    aiApiUrl: 'https://diag.example.com/v1/chat/completions',
    aiApiModel: 'glm-4v-flash',
  },
}));

// ============================================================
// 2. vi.mock:axios(拦截图像生成 API 调用)
// ============================================================

vi.mock('axios', () => ({
  default: {
    post: vi.fn(),
  },
}));

// ============================================================
// 3. vi.mock:env(允许 per-test 配置 AI_IMAGE_* 字段)
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

  // 每次调用 env() 时合并静态配置 + 当前图像生成覆盖值
  function buildEnv() {
    return {
      ...staticConfig,
      aiImageProvider: imageEnvState.aiImageProvider,
      aiImageApiKey: imageEnvState.aiImageApiKey,
      aiImageApiUrl: imageEnvState.aiImageApiUrl,
      aiImageApiModel: imageEnvState.aiImageApiModel,
      aiImageTimeout: imageEnvState.aiImageTimeout,
      generationMaxCount: imageEnvState.generationMaxCount,
      // 降级备用(diagnostic GLM)
      aiApiKey: imageEnvState.aiApiKey,
      aiApiUrl: imageEnvState.aiApiUrl,
      aiApiModel: imageEnvState.aiApiModel,
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
  resolveImageAIConfig,
  isImageGenerationEnabled,
  generateImage,
  extractImageUrls,
  type ImageGenerationRequest,
} from '../src/services/image-generation.service.js';

/** 类型化 axios mock(便于 per-test 配置响应) */
const mockedAxiosPost = axios.post as unknown as ReturnType<typeof vi.fn>;

// ============================================================
// 5. 辅助函数:构造测试数据
// ============================================================

/**
 * 构造有效的图像生成请求(text 模式)
 */
function buildTextRequest(overrides?: Partial<ImageGenerationRequest>): ImageGenerationRequest {
  return {
    inputType: 'text',
    prompt: '一幅印象派风格的风景油画',
    artType: 'painting',
    aspect: 'square',
    count: 1,
    ...overrides,
  };
}

/**
 * 构造图像生成 API 响应(URL 模式)
 */
function buildUrlResponse(urls: string[]): { data: { data: Array<{ url: string }> }; status: number } {
  return {
    data: { data: urls.map((url) => ({ url })) },
    status: 200,
  };
}

/**
 * 构造图像生成 API 响应(base64 模式)
 */
function buildB64Response(b64s: string[]): { data: { data: Array<{ b64_json: string }> }; status: number } {
  return {
    data: { data: b64s.map((b64) => ({ b64_json: b64 })) },
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

// 重置 env 覆盖值到默认(主=trae 完整配置)
function resetEnv(): void {
  imageEnvState.aiImageProvider = 'trae';
  imageEnvState.aiImageApiKey = 'image-key-trae';
  imageEnvState.aiImageApiUrl = 'https://test-image-api.example.com/v1/images/generations';
  imageEnvState.aiImageApiModel = 'image-model-trae';
  imageEnvState.aiImageTimeout = 30000;
  imageEnvState.generationMaxCount = 4;
  imageEnvState.aiApiKey = 'diag-glm-key';
  imageEnvState.aiApiUrl = 'https://diag.example.com/v1/chat/completions';
  imageEnvState.aiApiModel = 'glm-4v-flash';
}

// ============================================================
// 6. 测试用例
// ============================================================

describe('resolveImageAIConfig(双提供商降级)', () => {
  beforeEach(() => resetEnv());

  it('主=glm 且 aiImageApiKey 存在 → 使用 glm,fallback=false', () => {
    imageEnvState.aiImageProvider = 'glm';
    const resolved = resolveImageAIConfig();
    expect(resolved).not.toBeNull();
    expect(resolved!.provider).toBe('glm');
    expect(resolved!.apiKey).toBe('image-key-trae'); // 此时 aiImageApiKey 即 glm 图像 key
    expect(resolved!.fallback).toBe(false);
  });

  it('主=glm 但 aiImageApiKey 为空 → 返回 null', () => {
    imageEnvState.aiImageProvider = 'glm';
    imageEnvState.aiImageApiKey = '';
    expect(resolveImageAIConfig()).toBeNull();
  });

  it('主=trae 且 key+url 完整 → 使用 trae,fallback=false', () => {
    const resolved = resolveImageAIConfig();
    expect(resolved).not.toBeNull();
    expect(resolved!.provider).toBe('trae');
    expect(resolved!.apiKey).toBe('image-key-trae');
    expect(resolved!.apiUrl).toBe('https://test-image-api.example.com/v1/images/generations');
    expect(resolved!.model).toBe('image-model-trae');
    expect(resolved!.fallback).toBe(false);
  });

  it('主=trae 但 key 缺失 → 降级 glm(复用诊断 GLM),fallback=true', () => {
    imageEnvState.aiImageApiKey = '';
    const resolved = resolveImageAIConfig();
    expect(resolved).not.toBeNull();
    expect(resolved!.provider).toBe('glm');
    expect(resolved!.apiKey).toBe('diag-glm-key');
    expect(resolved!.fallback).toBe(true);
  });

  it('主=trae 但 url 缺失 → 降级 glm,fallback=true', () => {
    imageEnvState.aiImageApiUrl = '';
    const resolved = resolveImageAIConfig();
    expect(resolved).not.toBeNull();
    expect(resolved!.provider).toBe('glm');
    expect(resolved!.fallback).toBe(true);
  });

  it('主=trae 且 key 缺失 + 诊断 GLM key 也可用(应降级) 属正常路径', () => {
    imageEnvState.aiImageApiKey = '';
    imageEnvState.aiApiKey = 'diag-glm-key';
    const resolved = resolveImageAIConfig();
    expect(resolved).not.toBeNull();
    expect(resolved!.provider).toBe('glm');
    expect(resolved!.fallback).toBe(true);
  });

  it('双提供商均不可用 → 返回 null', () => {
    imageEnvState.aiImageProvider = 'trae';
    imageEnvState.aiImageApiKey = '';
    imageEnvState.aiImageApiUrl = '';
    imageEnvState.aiApiKey = '';
    expect(resolveImageAIConfig()).toBeNull();
  });
});

describe('isImageGenerationEnabled(启用判定)', () => {
  beforeEach(() => resetEnv());

  it('存在任一可用提供商 → true', () => {
    expect(isImageGenerationEnabled()).toBe(true);
  });

  it('双提供商均不可用 → false', () => {
    imageEnvState.aiImageProvider = 'trae';
    imageEnvState.aiImageApiKey = '';
    imageEnvState.aiImageApiUrl = '';
    imageEnvState.aiApiKey = '';
    expect(isImageGenerationEnabled()).toBe(false);
  });
});

describe('extractImageUrls(URL/base64 提取)', () => {
  it('data[].url 模式 → 提取 URL 列表', () => {
    const urls = extractImageUrls(
      { data: [{ url: 'https://cdn.example.com/a.png' }, { url: 'https://cdn.example.com/b.png' }] },
      4,
    );
    expect(urls).toEqual([
      'https://cdn.example.com/a.png',
      'https://cdn.example.com/b.png',
    ]);
  });

  it('data[].b64_json 模式 → 转为 data URL', () => {
    const urls = extractImageUrls({ data: [{ b64_json: 'AAAA' }] }, 4);
    expect(urls).toEqual(['data:image/png;base64,AAAA']);
  });

  it('混合模式 → 同时提取 url 与 b64_json', () => {
    const urls = extractImageUrls(
      { data: [{ url: 'https://cdn.example.com/a.png' }, { b64_json: 'BBBB' }] },
      4,
    );
    expect(urls).toEqual(['https://cdn.example.com/a.png', 'data:image/png;base64,BBBB']);
  });

  it('count 截断 → 只提取到指定张数', () => {
    const urls = extractImageUrls(
      { data: [{ url: 'a' }, { url: 'b' }, { url: 'c' }] },
      2,
    );
    expect(urls).toEqual(['a', 'b']);
  });

  it('响应含无用项 → 跳过空 url/b64', () => {
    const urls = extractImageUrls(
      { data: [{ url: 'a' }, { url: '' }, { b64_json: '' }, { url: 'b' }] },
      4,
    );
    expect(urls).toEqual(['a', 'b']);
  });

  it('非法响应(data 非数组/缺失) → 空数组', () => {
    expect(extractImageUrls(null, 4)).toEqual([]);
    expect(extractImageUrls({}, 4)).toEqual([]);
    expect(extractImageUrls({ data: 'not-array' }, 4)).toEqual([]);
  });
});

describe('generateImage(生成调用)', () => {
  beforeEach(() => {
    resetEnv();
    mockedAxiosPost.mockReset();
  });

  it('成功(URL 模式) → success=true,透出 provider/model/usedFallback/durationMs', async () => {
    mockedAxiosPost.mockResolvedValueOnce(buildUrlResponse(['https://cdn.example.com/gen.png']));
    const result = await generateImage(buildTextRequest());
    expect(result.success).toBe(true);
    expect(result.imageUrls).toEqual(['https://cdn.example.com/gen.png']);
    expect(result.provider).toBe('trae');
    expect(result.model).toBe('image-model-trae');
    expect(result.usedFallback).toBe(false);
    expect(result.failureReason).toBeNull();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('成功(base64 模式) → 转为 data URL', async () => {
    mockedAxiosPost.mockResolvedValueOnce(buildB64Response(['QUJDRA==']));
    const result = await generateImage(buildTextRequest());
    expect(result.success).toBe(true);
    expect(result.imageUrls).toEqual(['data:image/png;base64,QUJDRA==']);
  });

  it('降级路径成功 → usedFallback=true,provider=glm', async () => {
    // 主=trae 配置缺失 → 降级 glm
    imageEnvState.aiImageApiKey = '';
    mockedAxiosPost.mockResolvedValueOnce(buildUrlResponse(['https://cdn.example.com/d.png']));
    const result = await generateImage(buildTextRequest());
    expect(result.success).toBe(true);
    expect(result.provider).toBe('glm');
    expect(result.usedFallback).toBe(true);
  });

  it('双提供商均不可用 → AI_KEY_MISSING', async () => {
    imageEnvState.aiImageProvider = 'trae';
    imageEnvState.aiImageApiKey = '';
    imageEnvState.aiImageApiUrl = '';
    imageEnvState.aiApiKey = '';
    const result = await generateImage(buildTextRequest());
    expect(result.success).toBe(false);
    expect(result.failureReason).toBe('AI_KEY_MISSING');
    expect(result.provider).toBeNull();
    expect(mockedAxiosPost).not.toHaveBeenCalled();
  });

  it('超时 → AI_TIMEOUT', async () => {
    mockedAxiosPost.mockRejectedValueOnce(buildAxiosError('ECONNABORTED', 'timeout of 30000ms exceeded'));
    const result = await generateImage(buildTextRequest());
    expect(result.success).toBe(false);
    expect(result.failureReason).toBe('AI_TIMEOUT');
  });

  it('网络错误 → AI_NETWORK_ERROR', async () => {
    mockedAxiosPost.mockRejectedValueOnce(buildAxiosError('ECONNREFUSED', 'connect ECONNREFUSED'));
    const result = await generateImage(buildTextRequest());
    expect(result.success).toBe(false);
    expect(result.failureReason).toBe('AI_NETWORK_ERROR');
  });

  it('HTTP 错误 → AI_HTTP_ERROR', async () => {
    mockedAxiosPost.mockRejectedValueOnce(buildAxiosError('ERR_BAD_REQUEST', 'Request failed', 400));
    const result = await generateImage(buildTextRequest());
    expect(result.success).toBe(false);
    expect(result.failureReason).toBe('AI_HTTP_ERROR');
  });

  it('响应无图片 → AI_PARSE_ERROR', async () => {
    mockedAxiosPost.mockResolvedValueOnce({ data: { data: [] }, status: 200 });
    const result = await generateImage(buildTextRequest());
    expect(result.success).toBe(false);
    expect(result.failureReason).toBe('AI_PARSE_ERROR');
  });

  it('sketch 模式 → 请求体透传草稿图 URL 引用', async () => {
    mockedAxiosPost.mockResolvedValueOnce(buildUrlResponse(['https://cdn.example.com/s.png']));
    await generateImage(
      buildTextRequest({ inputType: 'sketch', sketchImageUrl: 'https://cdn.example.com/draft.jpg' }),
    );
    const [url, body] = mockedAxiosPost.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(url).toBe('https://test-image-api.example.com/v1/images/generations');
    expect(String(body.prompt)).toContain('https://cdn.example.com/draft.jpg');
  });
});

// ============================================================
// M2-T11 专项补齐:错误分类未知分支 + count 请求体截断
// ============================================================

describe('generateImage M2-T11 专项补齐(错误分类/请求体截断)', () => {
  beforeEach(() => {
    resetEnv();
    mockedAxiosPost.mockReset();
  });

  it('无法识别的错误(无 code/无 response)→ AI_UNKNOWN_ERROR', async () => {
    // 仅 message,不匹配超时/网络/HTTP 任一分类 → 归为未知错误
    mockedAxiosPost.mockRejectedValueOnce(buildAxiosError('', 'some weird failure'));
    const result = await generateImage(buildTextRequest());
    expect(result.success).toBe(false);
    expect(result.failureReason).toBe('AI_UNKNOWN_ERROR');
  });

  it('CanceledError(主动取消)→ AI_TIMEOUT(超时信号分类)', async () => {
    const err = new Error('canceled') as Error & { code: string };
    err.code = 'ERR_CANCELED';
    mockedAxiosPost.mockRejectedValueOnce(err);
    const result = await generateImage(buildTextRequest());
    expect(result.success).toBe(false);
    expect(result.failureReason).toBe('AI_TIMEOUT');
  });

  it('count 超上限 → 请求体 n 截断为 generationMaxCount(4)', async () => {
    mockedAxiosPost.mockResolvedValueOnce(buildUrlResponse([
      'https://cdn.example.com/1.png',
      'https://cdn.example.com/2.png',
      'https://cdn.example.com/3.png',
      'https://cdn.example.com/4.png',
    ]));
    // 请求 count=10,请求体 n 应被截断为 4(契约 §4.4 上限)
    await generateImage(buildTextRequest({ count: 10 }));
    const [_url, body] = mockedAxiosPost.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(body.n).toBe(4);
  });

  it('extractImageUrls:count 边界(1 张结果)→ 只返回 1 张', () => {
    // 契约 count 最小为 1;验证 1 张结果时正常提取(不越界)
    const urls = extractImageUrls({ data: [{ url: 'a' }] }, 1);
    expect(urls).toEqual(['a']);
  });
});