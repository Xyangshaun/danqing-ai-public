// ============================================================
// 知识点卡片分步图生成服务测试(Phase 3 批次⑤修复:限流感知重试)
// 对应源码:src/services/knowledge-card-generation.service.ts
//   - shouldRetryStepFailure:失败是否值得重试(限流/瞬时 true,配置/协议 false)
//   - generateCardImages:单卡生成(限流退避重试/幂等跳过/不可重试快速失败)
//   - generateImage httpStatus 透传(image-generation.service 批次⑤修复)
//
// Mock 策略:vi.mock image-generation.service(generateImage)+ 内联 prisma mock;
//   重试等待注入空 sleepFn + 短退避序列(不真实 sleep,测试秒过)
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { KnowledgeCard, PrismaClient } from '@prisma/client';

vi.mock('../src/services/image-generation.service.js', () => ({
  generateImage: vi.fn(),
}));

import { generateImage } from '../src/services/image-generation.service.js';
import type { ImageGenerationResult } from '../src/services/image-generation.service.js';
import {
  shouldRetryStepFailure,
  generateCardImages,
  parseReferenceAssets,
} from '../src/services/knowledge-card-generation.service.js';

const mockGenerateImage = vi.mocked(generateImage);

// ---------- fixture ----------

/** 构造失败结果(httpStatus/failureReason 可控) */
function failResult(overrides: Partial<ImageGenerationResult> = {}): ImageGenerationResult {
  return {
    success: false,
    imageUrls: null,
    provider: 'glm',
    model: 'GLM-Image',
    usedFallback: false,
    failureReason: 'AI_HTTP_ERROR',
    httpStatus: 429,
    durationMs: 5,
    ...overrides,
  };
}

/** 构造成功结果 */
function okResult(): ImageGenerationResult {
  return {
    success: true,
    imageUrls: [`http://img/test-${mockGenerateImage.mock.calls.length}.png`],
    provider: 'glm',
    model: 'GLM-Image',
    usedFallback: false,
    failureReason: null,
    durationMs: 1000,
  };
}

/** 2 步素描卡(pending) */
function makeCard(overrides: Partial<KnowledgeCard> = {}): KnowledgeCard {
  return {
    id: 'kcard_sketch_value_gray_004',
    category: 'sketch',
    topic: '明度/画面灰',
    problemPattern: '灰 明度 层次',
    difficulty: 'basic',
    explanation: '画面灰的本质是明度范围压缩。',
    practiceDrill: '明度两端练习。',
    referenceAssets: { status: 'pending', steps: 2, imageUrls: [], caption: '画面灰修正' },
    relatedWorks: [],
    isBuiltIn: true,
    enabled: true,
    sortOrder: 13,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as KnowledgeCard;
}

/** prisma mock(只需 knowledgeCard.update) */
function makePrisma(): { prisma: PrismaClient; updateMock: ReturnType<typeof vi.fn> } {
  const updateMock = vi.fn().mockResolvedValue({});
  const prisma = { knowledgeCard: { update: updateMock } } as unknown as PrismaClient;
  return { prisma, updateMock };
}

/** 测试用重试选项:无等待 + 2 次重试 */
const FAST_RETRY = { retryBackoffMs: [1, 1], sleepFn: async () => {} };

beforeEach(() => {
  vi.clearAllMocks();
});

// ============================================================
// shouldRetryStepFailure(纯函数)
// ============================================================

describe('shouldRetryStepFailure', () => {
  it('429 限流 → 重试', () => {
    expect(shouldRetryStepFailure(failResult({ httpStatus: 429 }))).toBe(true);
  });

  it('5xx 服务端瞬时故障 → 重试', () => {
    expect(shouldRetryStepFailure(failResult({ httpStatus: 503, failureReason: 'AI_HTTP_ERROR' }))).toBe(true);
    expect(shouldRetryStepFailure(failResult({ httpStatus: 500 }))).toBe(true);
  });

  it('AI_TIMEOUT / AI_NETWORK_ERROR(无 HTTP 响应)→ 重试', () => {
    expect(shouldRetryStepFailure(failResult({ failureReason: 'AI_TIMEOUT', httpStatus: undefined }))).toBe(true);
    expect(shouldRetryStepFailure(failResult({ failureReason: 'AI_NETWORK_ERROR', httpStatus: undefined }))).toBe(true);
  });

  it('4xx 非 429 → 不重试', () => {
    expect(shouldRetryStepFailure(failResult({ httpStatus: 400 }))).toBe(false);
    expect(shouldRetryStepFailure(failResult({ httpStatus: 401 }))).toBe(false);
  });

  it('AI_KEY_MISSING / AI_PARSE_ERROR → 不重试', () => {
    expect(shouldRetryStepFailure(failResult({ failureReason: 'AI_KEY_MISSING', httpStatus: undefined }))).toBe(false);
    // 解析错误是 2xx 响应内容异常,无失败 HTTP 状态码
    expect(shouldRetryStepFailure(failResult({ failureReason: 'AI_PARSE_ERROR', httpStatus: undefined }))).toBe(false);
  });

  it('成功结果 → 不重试', () => {
    expect(shouldRetryStepFailure(okResult())).toBe(false);
  });
});

// ============================================================
// generateCardImages(重试路径集成)
// ============================================================

describe('generateCardImages(限流感知重试)', () => {
  it('限流 429 后重试成功 → outcome=ready,退避等待按序列触发', async () => {
    const { prisma, updateMock } = makePrisma();
    const waits: number[] = [];
    const card = makeCard();

    // 2 步卡:每步第 1 次 429 失败、第 2 次成功 → 每步 2 次调用
    mockGenerateImage.mockImplementation(async () => {
      const calls = mockGenerateImage.mock.calls.length;
      return calls % 2 === 1 ? failResult({ httpStatus: 429 }) : okResult();
    });

    const outcome = await generateCardImages(prisma, card, {
      retryBackoffMs: [50, 100],
      sleepFn: async (ms) => {
        waits.push(ms);
      },
    });

    expect(outcome.outcome).toBe('ready');
    expect(outcome.generatedSteps).toBe(2);
    expect(mockGenerateImage).toHaveBeenCalledTimes(4); // 2 步 × (1 失败 + 1 成功)
    expect(waits).toEqual([50, 50]); // 每步各等 1 次(第 1 档退避)
    expect(updateMock).toHaveBeenCalledTimes(1);
    const written = updateMock.mock.calls[0]![0] as { data: { referenceAssets: { status: string; imageUrls: string[] } } };
    expect(written.data.referenceAssets.status).toBe('ready');
    expect(written.data.referenceAssets.imageUrls).toHaveLength(2);
    expect(written.data.referenceAssets.imageUrls.every((u) => u !== '')).toBe(true);
  });

  it('不可重试错误(AI_KEY_MISSING)→ 快速失败,无重试无等待', async () => {
    const { prisma } = makePrisma();
    const sleepFn = vi.fn().mockResolvedValue(undefined);
    mockGenerateImage.mockResolvedValue(
      failResult({ failureReason: 'AI_KEY_MISSING', httpStatus: undefined }),
    );

    const outcome = await generateCardImages(prisma, makeCard(), {
      retryBackoffMs: [1, 1],
      sleepFn: sleepFn as never,
    });

    expect(outcome.outcome).toBe('failed');
    expect(outcome.generatedSteps).toBe(0);
    expect(mockGenerateImage).toHaveBeenCalledTimes(2); // 仅每步首次尝试
    expect(sleepFn).not.toHaveBeenCalled();
  });

  it('重试全部耗尽仍 429 → partial/failed,每步尝试 1+backoffs 次', async () => {
    const { prisma } = makePrisma();
    mockGenerateImage.mockResolvedValue(failResult({ httpStatus: 429 }));

    const outcome = await generateCardImages(prisma, makeCard(), FAST_RETRY);

    expect(outcome.outcome).toBe('failed');
    expect(outcome.failureReason).toBe('AI_HTTP_ERROR');
    expect(mockGenerateImage).toHaveBeenCalledTimes(6); // 2 步 × (1 + 2 重试)
  });

  it('ready 卡幂等跳过,零 API 调用', async () => {
    const { prisma } = makePrisma();
    const card = makeCard({
      referenceAssets: {
        status: 'ready',
        steps: 2,
        imageUrls: ['http://img/a.png', 'http://img/b.png'],
        caption: '画面灰修正',
      },
    });

    const outcome = await generateCardImages(prisma, card, FAST_RETRY);

    expect(outcome.outcome).toBe('skipped');
    expect(mockGenerateImage).not.toHaveBeenCalled();
  });

  it('混合失败:第 1 步 429 重试成功、第 2 步 400 快速失败 → partial', async () => {
    const { prisma } = makePrisma();
    mockGenerateImage
      .mockResolvedValueOnce(failResult({ httpStatus: 429 })) // 步1 尝试1
      .mockResolvedValueOnce(okResult()) // 步1 重试成功
      .mockResolvedValue(failResult({ httpStatus: 400 })); // 步2 快速失败

    const outcome = await generateCardImages(prisma, makeCard(), FAST_RETRY);

    expect(outcome.outcome).toBe('partial');
    expect(outcome.generatedSteps).toBe(1);
    expect(mockGenerateImage).toHaveBeenCalledTimes(3);
  });
});

// ============================================================
// parseReferenceAssets(既有行为回归)
// ============================================================

describe('parseReferenceAssets(回归)', () => {
  it('NULL/异常资产回退 pending 骨架(3 步)', () => {
    const assets = parseReferenceAssets(makeCard({ referenceAssets: null }));
    expect(assets.status).toBe('pending');
    expect(assets.steps).toBe(3);
    expect(assets.imageUrls).toEqual([]);
  });

  it('合法 partial 资产原样解析(保留已生成 URL)', () => {
    const assets = parseReferenceAssets(
      makeCard({
        referenceAssets: {
          status: 'partial',
          steps: 3,
          imageUrls: ['http://img/1.png', '', 'http://img/3.png'],
          caption: 'x',
          failureReason: 'AI_HTTP_ERROR',
        },
      }),
    );
    expect(assets.status).toBe('partial');
    expect(assets.steps).toBe(3);
    expect(assets.imageUrls).toHaveLength(3);
  });
});
