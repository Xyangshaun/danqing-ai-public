// ============================================================
// GenerationService 单元测试(M2-T4)
// 对应源码:src/services/generation.service.ts(业务编排层)
// 对应文档:.trae/documents/m2-generation-plan-2026-08-07.md
//   §3.5 任务生命周期 / §5 配额与计费 / §6 内容审核 / §7 教学闭环
//
// 测试范围:
//   1. 配额校验 checkGenerationQuota(TENANT_NOT_FOUND/TENANT_DISABLED/
//      GENERATION_QUOTA_EXCEEDED/enterprise 无限)
//   2. 限流 checkRateLimit(GENERATION_RATE_LIMITED)
//   3. 提交 createGeneration(输入校验/异步入队/同步降级)
//   4. 查询 getGeneration(RBAC 数据范围 + Redis 状态补充)
//   5. Worker 处理 processQueueOnce/processGenerationJob(成功/失败/用量/审核)
//   6. 用量日志 recordUsage(usageType=generate/generationId/成功与调用失败均记录)
//
// Mock 策略:
//   - setup.ts 全局 mock Prisma/Redis(prismaMock/redisMock)
//   - vi.mock image-generation.service:控制 generateImage 返回(不触发真实 API)
//   - 审核逻辑在 service 内部(黑名单),无需 mock review
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prismaMock, redisMock } from './setup.js';
import { generationService } from '../src/services/generation.service.js';
import { generationQueueService } from '../src/services/generation-queue.service.js';
import { configFeatureService } from '../src/services/config-feature.service.js';
import { analysisService } from '../src/services/analysis.service.js';
import type { GenerationJob } from '../src/services/generation-queue.service.js';
import { BusinessError } from '../src/middlewares/error-handler.js';
import { ErrorCode } from '../src/types/api-contract.js';
import type { CreateGenerationRequest } from '../src/types/api-contract.js';
import { generateImage, resolveImageAIConfig } from '../src/services/image-generation.service.js';
import type { ImageGenerationResult, ResolvedImageAIConfig } from '../src/services/image-generation.service.js';

// ============================================================
// mock image-generation.service:控制 generateImage 返回
// ============================================================
vi.mock('../src/services/image-generation.service.js', () => ({
  generateImage: vi.fn(),
  resolveImageAIConfig: vi.fn(),
}));

const generateImageMock = vi.mocked(generateImage);
const resolveImageAIConfigMock = vi.mocked(resolveImageAIConfig);

// ============================================================
// 测试常量
// ============================================================
const TENANT_A = 't-gen-a';
const TENANT_B = 't-gen-b';
const USER_OWNER = 'u-gen-owner';
const USER_STUDENT1 = 'u-gen-student1';
const USER_STUDENT2 = 'u-gen-student2';
const USER_TEACHER = 'u-gen-teacher';

// ============================================================
// 辅助函数
// ============================================================

async function expectBusinessError(
  fn: () => Promise<unknown>,
  code: ErrorCode,
  httpStatus: number,
): Promise<void> {
  try {
    await fn();
    expect.fail(`expected BusinessError(code=${code}) but no error thrown`);
  } catch (err) {
    if (!(err instanceof BusinessError)) {
      expect.fail(
        `expected BusinessError(code=${code}) but got: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    expect(err.code).toBe(code);
    expect(err.httpStatus).toBe(httpStatus);
  }
}

/** 构造 CreateGenerationRequest(text 模式默认) */
function buildBody(overrides?: Partial<CreateGenerationRequest>): CreateGenerationRequest {
  return {
    inputType: 'text',
    prompt: '一幅印象派风景油画',
    artType: 'painting',
    aspect: 'square',
    count: 1,
    ...overrides,
  };
}

/** 构造 GenerationJob(text 模式) */
function buildJob(overrides?: Partial<GenerationJob>): GenerationJob {
  return {
    id: 'gen-task-1',
    tenantId: TENANT_A,
    userId: USER_STUDENT1,
    inputType: 'text',
    prompt: '一幅印象派风景油画',
    artType: 'painting',
    aspect: 'square',
    count: 1,
    enqueuedAt: new Date().toISOString(),
    ...overrides,
  };
}

/** 成功生成结果 */
function successResult(overrides?: Partial<ImageGenerationResult>): ImageGenerationResult {
  return {
    success: true,
    imageUrls: ['https://cdn.example.com/gen-a.png'],
    provider: 'glm',
    model: 'glm-4v',
    usedFallback: false,
    failureReason: null,
    durationMs: 120,
    ...overrides,
  };
}

/** 预置一个租户 */
function setupTenant(id: string, overrides?: Partial<{ plan: string; status: string }>) {
  prismaMock.__insertTenant({
    id,
    name: '测试租户',
    plan: overrides?.plan ?? 'standard',
    status: overrides?.status ?? 'active',
  });
}

beforeEach(async () => {
  // 重置 generateImage 返回值与控制函数
  generateImageMock.mockReset();
  resolveImageAIConfigMock.mockReset();
  resolveImageAIConfigMock.mockReturnValue({
    provider: 'glm',
    apiKey: 'test-key',
    apiUrl: 'https://open.bigmodel.cn/api/paas/v4/images/generations',
    model: 'glm-4v',
    fallback: false,
  } as ResolvedImageAIConfig);
  // 默认队列可用(redis ping 返回 PONG)
  vi.restoreAllMocks();

  // M2-T6:生成功能默认关闭;本文件多数用例需通过"功能开关"测试提交路径,
  // 故 beforeEach 统一开启(功能关闭的校验路径由专项用例覆盖)
  await configFeatureService.updateFeature('generation', { status: 'enabled' }, 'test');
});

// ============================================================
// 1. 配额校验
// ============================================================

describe('GenerationService.checkGenerationQuota(配额校验)', () => {
  it('租户不存在 → TENANT_NOT_FOUND(404)', async () => {
    await expectBusinessError(
      () => generationService.createGeneration({ tenantId: 'not-exist', userId: USER_STUDENT1, body: buildBody() }),
      ErrorCode.TENANT_NOT_FOUND,
      404,
    );
  });

  it('租户被禁用 → TENANT_DISABLED(403)', async () => {
    setupTenant(TENANT_A, { status: 'disabled' });
    await expectBusinessError(
      () => generationService.createGeneration({ tenantId: TENANT_A, userId: USER_STUDENT1, body: buildBody() }),
      ErrorCode.TENANT_DISABLED,
      403,
    );
  });

  it('free 计划当月用量达上限 → GENERATION_QUOTA_EXCEEDED(6101,402)', async () => {
    setupTenant(TENANT_A, { plan: 'free' });
    // free 配额 10:预置 10 条 success 任务(计入当月用量)
    for (let i = 0; i < 10; i++) {
      prismaMock.__insertGenerationTask({
        id: `pre-gen-${i}`,
        tenantId: TENANT_A,
        userId: USER_STUDENT1,
        status: 'success',
        createdAt: new Date(),
      });
    }
    await expectBusinessError(
      () => generationService.createGeneration({ tenantId: TENANT_A, userId: USER_STUDENT1, body: buildBody() }),
      ErrorCode.GENERATION_QUOTA_EXCEEDED,
      402,
    );
  });

  it('free 计划用量未达上限 → 正常提交', async () => {
    setupTenant(TENANT_A, { plan: 'free' });
    // 预置 9 条(配额 10,未超)
    for (let i = 0; i < 9; i++) {
      prismaMock.__insertGenerationTask({
        id: `pre-gen-${i}`,
        tenantId: TENANT_A,
        userId: USER_STUDENT1,
        status: 'success',
        createdAt: new Date(),
      });
    }
    const resp = await generationService.createGeneration({ tenantId: TENANT_A, userId: USER_STUDENT1, body: buildBody() });
    expect(resp.status).toBe('pending');
  });

  it('enterprise 无限 → 即使用量巨大仍可通过', async () => {
    setupTenant(TENANT_A, { plan: 'enterprise' });
    for (let i = 0; i < 50; i++) {
      prismaMock.__insertGenerationTask({
        id: `pre-gen-${i}`,
        tenantId: TENANT_A,
        userId: USER_STUDENT1,
        status: 'success',
        createdAt: new Date(),
      });
    }
    const resp = await generationService.createGeneration({ tenantId: TENANT_A, userId: USER_STUDENT1, body: buildBody() });
    expect(resp.status).toBe('pending');
  });

  it('失败任务不计入配额(配额统计排除 failed)', async () => {
    setupTenant(TENANT_A, { plan: 'free' });
    // 预置 20 条 failed(failed 不计入配额,free=10 应仍可提交)
    for (let i = 0; i < 20; i++) {
      prismaMock.__insertGenerationTask({
        id: `fail-gen-${i}`,
        tenantId: TENANT_A,
        userId: USER_STUDENT1,
        status: 'failed',
        createdAt: new Date(),
      });
    }
    const resp = await generationService.createGeneration({ tenantId: TENANT_A, userId: USER_STUDENT1, body: buildBody() });
    expect(resp.status).toBe('pending');
  });
});

// ============================================================
// 2. 限流
// ============================================================

describe('GenerationService.checkRateLimit(限流)', () => {
  beforeEach(() => setupTenant(TENANT_A));

  it('窗口内未超限 → 正常通过', async () => {
    // 默认限流 5 次/分钟
    for (let i = 0; i < 5; i++) {
      await generationService.createGeneration({ tenantId: TENANT_A, userId: USER_STUDENT1, body: buildBody({ prompt: `图-${i}` }) });
    }
    // 第 6 次才超限,前面 5 次都通过
    expect(redisMock.__peek(`rl:gen:${TENANT_A}:${USER_STUDENT1}`)).not.toBeUndefined();
  });

  it('窗口内超限 → GENERATION_RATE_LIMITED(6106,429)', async () => {
    // 预置限流计数:直接写 redis 计数为 limit(5)
    redisMock.__rawSet(`rl:gen:${TENANT_A}:${USER_STUDENT1}`, '5');
    // 配额 free?此处租户为 standard(200),不触配额;第 6 次触发限流
    await expectBusinessError(
      () => generationService.createGeneration({ tenantId: TENANT_A, userId: USER_STUDENT1, body: buildBody() }),
      ErrorCode.GENERATION_RATE_LIMITED,
      429,
    );
  });

  it('不同用户各自独立限流', async () => {
    redisMock.__rawSet(`rl:gen:${TENANT_A}:${USER_STUDENT1}`, '5');
    // 另一个用户计数为 0,不受影响
    const resp = await generationService.createGeneration({ tenantId: TENANT_A, userId: USER_STUDENT2, body: buildBody() });
    expect(resp.status).toBe('pending');
  });
});

// ============================================================
// 3. 提交 createGeneration
// ============================================================

describe('GenerationService.createGeneration(提交)', () => {
  beforeEach(() => setupTenant(TENANT_A));

  it('text 模式缺 prompt → GENERATION_IMAGE_INVALID(6105,400)', async () => {
    await expectBusinessError(
      () => generationService.createGeneration({ tenantId: TENANT_A, userId: USER_STUDENT1, body: buildBody({ prompt: '   ' }) }),
      ErrorCode.GENERATION_IMAGE_INVALID,
      400,
    );
  });

  it('sketch 模式缺 sketchImageUrl → GENERATION_IMAGE_INVALID(6105,400)', async () => {
    await expectBusinessError(
      () => generationService.createGeneration({ tenantId: TENANT_A, userId: USER_STUDENT1, body: buildBody({ inputType: 'sketch', sketchImageUrl: '' }) }),
      ErrorCode.GENERATION_IMAGE_INVALID,
      400,
    );
  });

  it('异步模式(队列可用)→ 返回 pending + 任务落库 + 入队', async () => {
    const resp = await generationService.createGeneration({ tenantId: TENANT_A, userId: USER_STUDENT1, body: buildBody() });

    expect(resp.status).toBe('pending');
    expect(resp.images).toBeNull();
    expect(resp.taskId).toBeTruthy();

    // 任务落库(pending)
    const task = prismaMock.generationTaskStore.get(resp.taskId);
    expect(task).toBeDefined();
    expect(task!.status).toBe('pending');
    expect(task!.tenantId).toBe(TENANT_A);
    expect(task!.artType).toBe('painting');

    // 入队:队列非空
    expect(await generationQueueService.getQueueLength()).toBe(1);
  });

  it('同步降级模式(队列不可用)→ 直接生成并返回 success', async () => {
    // 队列不可用:isAvailable 返回 false
    vi.spyOn(generationQueueService, 'isAvailable').mockResolvedValue(false);
    generateImageMock.mockResolvedValue(successResult());

    const resp = await generationService.createGeneration({ tenantId: TENANT_A, userId: USER_STUDENT1, body: buildBody() });

    expect(resp.status).toBe('success');
    expect(resp.images).not.toBeNull();
    expect(resp.images![0].imageUrl).toBe('https://cdn.example.com/gen-a.png');
    // DB 已更新为 success
    expect(prismaMock.generationTaskStore.get(resp.taskId)!.status).toBe('success');
  });
});

// ============================================================
// 4. 查询 getGeneration
// ============================================================

describe('GenerationService.getGeneration(查询)', () => {
  beforeEach(() => setupTenant(TENANT_A));

  it('跨租户 → GENERATION_TASK_NOT_FOUND(6102,404)', async () => {
    prismaMock.__insertGenerationTask({ id: 'gen-1', tenantId: TENANT_A, userId: USER_STUDENT1, status: 'success' });
    await expectBusinessError(
      () => generationService.getGeneration({ tenantId: TENANT_B, generationId: 'gen-1', userId: USER_STUDENT1, role: 'student' }),
      ErrorCode.GENERATION_TASK_NOT_FOUND,
      404,
    );
  });

  it('student 查询他人记录 → 404(不泄露存在性)', async () => {
    prismaMock.__insertGenerationTask({ id: 'gen-1', tenantId: TENANT_A, userId: USER_STUDENT2, status: 'success' });
    await expectBusinessError(
      () => generationService.getGeneration({ tenantId: TENANT_A, generationId: 'gen-1', userId: USER_STUDENT1, role: 'student' }),
      ErrorCode.GENERATION_TASK_NOT_FOUND,
      404,
    );
  });

  it('student 查询自己记录 → 返回详情', async () => {
    prismaMock.__insertGenerationTask({
      id: 'gen-1',
      tenantId: TENANT_A,
      userId: USER_STUDENT1,
      status: 'success',
      images: [{ imageUrl: 'https://cdn.example.com/a.png', reviewStatus: 'pending' }],
      usedFallback: true,
      createdAt: new Date('2026-08-01T00:00:00Z'),
      completedAt: new Date('2026-08-01T00:00:05Z'),
    });
    const resp = await generationService.getGeneration({ tenantId: TENANT_A, generationId: 'gen-1', userId: USER_STUDENT1, role: 'student' });
    expect(resp.status).toBe('success');
    expect(resp.images![0].imageUrl).toBe('https://cdn.example.com/a.png');
    expect(resp.usedFallback).toBe(true);
    expect(resp.completedAt).toBeTruthy();
  });

  it('teacher/admin 可查租户内任意记录', async () => {
    prismaMock.__insertGenerationTask({ id: 'gen-1', tenantId: TENANT_A, userId: USER_STUDENT2, status: 'success' });
    const resp = await generationService.getGeneration({ tenantId: TENANT_A, generationId: 'gen-1', userId: USER_TEACHER, role: 'teacher' });
    expect(resp.status).toBe('success');
  });

  it('DB=pending 且 Redis 有 success 状态 → 补充为 success', async () => {
    prismaMock.__insertGenerationTask({ id: 'gen-1', tenantId: TENANT_A, userId: USER_STUDENT1, status: 'pending' });
    // Redis 预置 success 状态与结果
    await generationQueueService.markSuccess('gen-1', [{ imageUrl: 'https://cdn.example.com/redis.png', reviewStatus: 'pending' }]);
    const resp = await generationService.getGeneration({ tenantId: TENANT_A, generationId: 'gen-1', userId: USER_STUDENT1, role: 'student' });
    expect(resp.status).toBe('success');
    expect(resp.images![0].imageUrl).toBe('https://cdn.example.com/redis.png');
  });
});

// ============================================================
// 5. Worker 处理
// ============================================================

describe('GenerationService.processQueueOnce(worker 轮询)', () => {
  beforeEach(() => setupTenant(TENANT_A));

  it('队列为空 → 返回 0', async () => {
    expect(await generationService.processQueueOnce()).toBe(0);
  });

  it('成功路径:任务更新为 success + 审核 + 用量日志', async () => {
    generateImageMock.mockResolvedValue(successResult());
    // 预置任务 + 入队
    prismaMock.__insertGenerationTask({ id: 'gen-1', tenantId: TENANT_A, userId: USER_STUDENT1, status: 'pending' });
    await generationQueueService.enqueue(buildJob({ id: 'gen-1' }));

    const processed = await generationService.processQueueOnce();
    expect(processed).toBe(1);

    // DB:success + images + provider
    const task = prismaMock.generationTaskStore.get('gen-1');
    expect(task!.status).toBe('success');
    expect(task!.provider).toBe('glm');
    const images = task!.images as Array<{ reviewStatus: string }>;
    expect(images[0].reviewStatus).toBe('pending');

    // 用量日志:usageType=generate + generationId
    const usage = Array.from(prismaMock.aiUsageLogStore.values());
    expect(usage.length).toBe(1);
    expect(usage[0].usageType).toBe('generate');
    expect(usage[0].generationId).toBe('gen-1');
    expect(usage[0].success).toBe(true);
    expect(usage[0].provider).toBe('glm');
  });

  it('失败路径:generateImage 失败 → 任务 failed + 用量日志(success=false)', async () => {
    generateImageMock.mockResolvedValue(successResult({ success: false, imageUrls: null, failureReason: 'AI_TIMEOUT' }));
    prismaMock.__insertGenerationTask({ id: 'gen-1', tenantId: TENANT_A, userId: USER_STUDENT1, status: 'pending' });
    await generationQueueService.enqueue(buildJob({ id: 'gen-1' }));

    await generationService.processQueueOnce();

    const task = prismaMock.generationTaskStore.get('gen-1');
    expect(task!.status).toBe('failed');
    expect(task!.failureReason).toBe('AI_TIMEOUT');

    const usage = Array.from(prismaMock.aiUsageLogStore.values());
    expect(usage.length).toBe(1);
    expect(usage[0].success).toBe(false);
    expect(usage[0].failureReason).toBe('AI_TIMEOUT');
  });

  it('双提供商均不可用(provider=null)→ 任务 failed + 不记录用量', async () => {
    generateImageMock.mockResolvedValue(successResult({ success: false, imageUrls: null, provider: null, model: null, failureReason: 'AI_KEY_MISSING' }));
    prismaMock.__insertGenerationTask({ id: 'gen-1', tenantId: TENANT_A, userId: USER_STUDENT1, status: 'pending' });
    await generationQueueService.enqueue(buildJob({ id: 'gen-1' }));

    await generationService.processQueueOnce();

    const task = prismaMock.generationTaskStore.get('gen-1');
    expect(task!.status).toBe('failed');
    expect(task!.failureReason).toBe('AI_KEY_MISSING');
    // 未实际调用 generateImage → 不记录用量日志
    expect(prismaMock.aiUsageLogStore.size).toBe(0);
  });
});

// ============================================================
// 6. 内容审核
// ============================================================

describe('GenerationService 内容审核(handleReview)', () => {
  beforeEach(() => setupTenant(TENANT_A));

  it('提示词命中黑名单 → reviewStatus=flagged', async () => {
    generateImageMock.mockResolvedValue(successResult());
    prismaMock.__insertGenerationTask({ id: 'gen-1', tenantId: TENANT_A, userId: USER_STUDENT1, status: 'pending' });
    await generationQueueService.enqueue(buildJob({ id: 'gen-1', prompt: '一幅包含暴力的画' }));

    await generationService.processQueueOnce();

    const task = prismaMock.generationTaskStore.get('gen-1');
    const images = task!.images as Array<{ reviewStatus: string }>;
    expect(images[0].reviewStatus).toBe('flagged');
  });

  it('提示词正常 → reviewStatus=pending', async () => {
    generateImageMock.mockResolvedValue(successResult());
    prismaMock.__insertGenerationTask({ id: 'gen-1', tenantId: TENANT_A, userId: USER_STUDENT1, status: 'pending' });
    await generationQueueService.enqueue(buildJob({ id: 'gen-1', prompt: '宁静的湖泊与远山' }));

    await generationService.processQueueOnce();

    const task = prismaMock.generationTaskStore.get('gen-1');
    const images = task!.images as Array<{ reviewStatus: string }>;
    expect(images[0].reviewStatus).toBe('pending');
  });
});

// ============================================================
// 7. 教学闭环占位
// ============================================================

describe('GenerationService.submitForAnalysis(教学闭环占位)', () => {
  beforeEach(() => setupTenant(TENANT_A));

  it('任务不存在/越权 → GENERATION_TASK_NOT_FOUND(404)', async () => {
    await expectBusinessError(
      () => generationService.submitForAnalysis({ tenantId: TENANT_A, generationId: 'nope', userId: USER_STUDENT1, imageUrl: 'x' }),
      ErrorCode.GENERATION_TASK_NOT_FOUND,
      404,
    );
  });
});

// ============================================================
// 8. 功能开关(M2-T6)
// ============================================================

describe('GenerationService 生成功能开关(M2-T6)', () => {
  beforeEach(() => {
    setupTenant(TENANT_A);
    // 本组专项测试需独立控制开关状态,重置为默认(门禁 M2-4:默认关闭)
    return configFeatureService.resetToDefaults();
  });

  it('功能默认关闭 → createGeneration 返回 FORBIDDEN(2004,403) 且不入队', async () => {
    await expectBusinessError(
      () => generationService.createGeneration({ tenantId: TENANT_A, userId: USER_STUDENT1, body: buildBody() }),
      ErrorCode.FORBIDDEN,
      403,
    );
    expect(await generationQueueService.getQueueLength()).toBe(0);
  });

  it('开启后 → createGeneration 正常提交(pending)', async () => {
    await configFeatureService.updateFeature('generation', { status: 'enabled' }, 'test');
    const resp = await generationService.createGeneration({ tenantId: TENANT_A, userId: USER_STUDENT1, body: buildBody() });
    expect(resp.status).toBe('pending');
  });

  it('功能关闭时返回 FORBIDDEN(2004,403) 且不入队', async () => {
    await configFeatureService.updateFeature('generation', { status: 'disabled' }, 'test');
    await expectBusinessError(
      () => generationService.createGeneration({ tenantId: TENANT_A, userId: USER_STUDENT1, body: buildBody() }),
      ErrorCode.FORBIDDEN,
      403,
    );
    expect(await generationQueueService.getQueueLength()).toBe(0);
  });

  it('isGenerationEnabled():默认 false,开启后 true', async () => {
    expect(configFeatureService.isGenerationEnabled()).toBe(false);
    await configFeatureService.updateFeature('generation', { status: 'enabled' }, 'test');
    expect(configFeatureService.isGenerationEnabled()).toBe(true);
  });
});

// ============================================================
// 9. 教学闭环接线(M2-T6,submitForAnalysis → analysis.service)
// ============================================================

describe('GenerationService.submitForAnalysis(教学闭环接线,M2-T6)', () => {
  beforeEach(() => {
    setupTenant(TENANT_A);
    // spy analysis.service.createAnalysis,避免触发真实诊断
    vi.spyOn(analysisService, 'createAnalysis').mockResolvedValue({
      id: 'analysis-1',
      status: 'success',
      result: null,
      durationMs: 120,
    });
  });

  it('成功路径:调用 analysis.service.createAnalysis 并返回 {analysisId,status}', async () => {
    prismaMock.__insertGenerationTask({
      id: 'gen-1',
      tenantId: TENANT_A,
      userId: USER_STUDENT1,
      status: 'success',
      images: [
        { imageUrl: 'https://cdn.example.com/a.png', reviewStatus: 'approved' },
        { imageUrl: 'https://cdn.example.com/b.png', reviewStatus: 'pending' },
      ],
      artType: 'painting',
    });

    const resp = await generationService.submitForAnalysis({
      tenantId: TENANT_A,
      generationId: 'gen-1',
      userId: USER_STUDENT1,
      imageUrl: 'https://cdn.example.com/a.png',
    });

    expect(resp).toEqual({ analysisId: 'analysis-1', status: 'success' });
    expect(analysisService.createAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_A,
        userId: USER_STUDENT1,
        body: expect.objectContaining({
          artType: 'painting',
          imageUrl: 'https://cdn.example.com/a.png',
        }),
      }),
    );
  });

  it('跨租户/越权 → GENERATION_TASK_NOT_FOUND(404)', async () => {
    prismaMock.__insertGenerationTask({
      id: 'gen-1',
      tenantId: TENANT_A,
      userId: USER_STUDENT2,
      status: 'success',
      images: [{ imageUrl: 'https://cdn.example.com/a.png', reviewStatus: 'approved' }],
    });
    await expectBusinessError(
      () => generationService.submitForAnalysis({ tenantId: TENANT_A, generationId: 'gen-1', userId: USER_STUDENT1, imageUrl: 'https://cdn.example.com/a.png' }),
      ErrorCode.GENERATION_TASK_NOT_FOUND,
      404,
    );
  });

  it('任务未成功(status!==success)→ GENERATION_FAILED(6104,400)', async () => {
    prismaMock.__insertGenerationTask({
      id: 'gen-1',
      tenantId: TENANT_A,
      userId: USER_STUDENT1,
      status: 'pending',
    });
    await expectBusinessError(
      () => generationService.submitForAnalysis({ tenantId: TENANT_A, generationId: 'gen-1', userId: USER_STUDENT1, imageUrl: 'https://cdn.example.com/a.png' }),
      ErrorCode.GENERATION_FAILED,
      400,
    );
  });

  it('imageUrl 不在任务结果中 → GENERATION_FAILED(6104,400)', async () => {
    prismaMock.__insertGenerationTask({
      id: 'gen-1',
      tenantId: TENANT_A,
      userId: USER_STUDENT1,
      status: 'success',
      images: [{ imageUrl: 'https://cdn.example.com/a.png', reviewStatus: 'approved' }],
    });
    await expectBusinessError(
      () => generationService.submitForAnalysis({ tenantId: TENANT_A, generationId: 'gen-1', userId: USER_STUDENT1, imageUrl: 'https://cdn.example.com/other.png' }),
      ErrorCode.GENERATION_FAILED,
      400,
    );
  });

  it('生成图审核 flagged → FORBIDDEN(2004,403),不进入诊断', async () => {
    prismaMock.__insertGenerationTask({
      id: 'gen-1',
      tenantId: TENANT_A,
      userId: USER_STUDENT1,
      status: 'success',
      images: [{ imageUrl: 'https://cdn.example.com/a.png', reviewStatus: 'flagged' }],
    });
    await expectBusinessError(
      () => generationService.submitForAnalysis({ tenantId: TENANT_A, generationId: 'gen-1', userId: USER_STUDENT1, imageUrl: 'https://cdn.example.com/a.png' }),
      ErrorCode.FORBIDDEN,
      403,
    );
    expect(analysisService.createAnalysis).not.toHaveBeenCalled();
  });

  it('生成图审核 rejected → FORBIDDEN(2004,403)', async () => {
    prismaMock.__insertGenerationTask({
      id: 'gen-1',
      tenantId: TENANT_A,
      userId: USER_STUDENT1,
      status: 'success',
      images: [{ imageUrl: 'https://cdn.example.com/a.png', reviewStatus: 'rejected' }],
    });
    await expectBusinessError(
      () => generationService.submitForAnalysis({ tenantId: TENANT_A, generationId: 'gen-1', userId: USER_STUDENT1, imageUrl: 'https://cdn.example.com/a.png' }),
      ErrorCode.FORBIDDEN,
      403,
    );
  });
});

// ============================================================
// 10. M2-T11 生成专项补齐:standard 计划配额边界
// 对应计划 §5.2(GENERATION_PLAN_QUOTA: free=10/standard=200/enterprise=-1)
// ============================================================

describe('GenerationService 专项补齐:standard 计划配额边界(M2-T11)', () => {
  beforeEach(() => setupTenant(TENANT_A, { plan: 'standard' }));

  it('standard(200)用量达上限 → GENERATION_QUOTA_EXCEEDED(6101,402)', async () => {
    // 预置 200 条 success(配额 200,已达上限)
    for (let i = 0; i < 200; i += 1) {
      prismaMock.__insertGenerationTask({
        id: `std-gen-${i}`,
        tenantId: TENANT_A,
        userId: USER_STUDENT1,
        status: 'success',
        createdAt: new Date(),
      });
    }
    await expectBusinessError(
      () => generationService.createGeneration({ tenantId: TENANT_A, userId: USER_STUDENT1, body: buildBody() }),
      ErrorCode.GENERATION_QUOTA_EXCEEDED,
      402,
    );
  });

  it('standard(200)用量 199 → 未达上限可提交(pending)', async () => {
    for (let i = 0; i < 199; i += 1) {
      prismaMock.__insertGenerationTask({
        id: `std-gen-${i}`,
        tenantId: TENANT_A,
        userId: USER_STUDENT1,
        status: 'success',
        createdAt: new Date(),
      });
    }
    const resp = await generationService.createGeneration({ tenantId: TENANT_A, userId: USER_STUDENT1, body: buildBody() });
    expect(resp.status).toBe('pending');
  });
});

// ============================================================
// 11. M2-T11 生成专项补齐:限流 Redis 故障 fail-open
// 对应源码 checkRateLimit(Redis 异常时 fail-open,不阻断生成主流程)
// ============================================================

describe('GenerationService 专项补齐:限流 Redis 故障 fail-open(M2-T11)', () => {
  beforeEach(() => setupTenant(TENANT_A));

  it('Redis incr 抛异常 → fail-open 放行,不抛 6106,仍返回 pending', async () => {
    // 模拟 Redis 故障:限流计数命令失败
    vi.spyOn(redisMock, 'incr').mockRejectedValue(new Error('redis connection lost'));
    const resp = await generationService.createGeneration({ tenantId: TENANT_A, userId: USER_STUDENT1, body: buildBody() });
    // fail-open:未抛限流错误,仍进入异步入队
    expect(resp.status).toBe('pending');
    expect(resp.taskId).toBeTruthy();
  });

  it('Redis 持续故障时多次提交仍 fail-open(不误伤用户)', async () => {
    vi.spyOn(redisMock, 'incr').mockRejectedValue(new Error('redis down'));
    for (let i = 0; i < 6; i += 1) {
      const resp = await generationService.createGeneration({ tenantId: TENANT_A, userId: USER_STUDENT1, body: buildBody({ prompt: `p-${i}` }) });
      expect(resp.status).toBe('pending');
    }
  });
});

// ============================================================
// 12. M2-T11 生成专项补齐:body.sync 显式同步模式
// 对应源码 createGeneration 第 6 步(body.sync=true 直接同步生成,不入队)
// ============================================================

describe('GenerationService 专项补齐:body.sync 同步模式(M2-T11)', () => {
  beforeEach(() => setupTenant(TENANT_A));

  it('body.sync=true → 直接同步生成并返回 success,队列无任务', async () => {
    generateImageMock.mockResolvedValue(successResult());
    const resp = await generationService.createGeneration({
      tenantId: TENANT_A,
      userId: USER_STUDENT1,
      body: buildBody({ sync: true }),
    });
    expect(resp.status).toBe('success');
    expect(resp.images).not.toBeNull();
    // 同步模式不入队
    expect(await generationQueueService.getQueueLength()).toBe(0);
  });
});

// ============================================================
// 13. M2-T11 生成专项补齐:count 截断到 generationMaxCount
// 对应契约 §4.4(count 默认 1,>上限截断为 GENERATION_MAX_COUNT)
// ============================================================

describe('GenerationService 专项补齐:count 截断(M2-T11)', () => {
  beforeEach(() => setupTenant(TENANT_A));

  it('service 层 count 超上限(99)→ 截断为 generationMaxCount(4)落库', async () => {
    // controller 层已拦截 count>4(400);此处验证 service 层兜底截断(防御纵深)
    const resp = await generationService.createGeneration({ tenantId: TENANT_A, userId: USER_STUDENT1, body: buildBody({ count: 99 }) });
    const task = prismaMock.generationTaskStore.get(resp.taskId);
    expect(task!.count).toBe(4);
  });
});

// ============================================================
// 14. M2-T11 生成专项补齐:gradual 灰度按租户放量
// 对应源码 isGenerationEnabled(tenantId) + 门禁 M2-4(默认关闭,灰度开启)
// ============================================================

describe('GenerationService 专项补齐:gradual 灰度放量(M2-T11)', () => {
  beforeEach(() => setupTenant(TENANT_A));

  it('gradual value=100 → 按租户放行(createGeneration 返回 pending)', async () => {
    await configFeatureService.updateFeature('generation', { status: 'gradual', value: 100 }, 'test');
    const resp = await generationService.createGeneration({ tenantId: TENANT_A, userId: USER_STUDENT1, body: buildBody() });
    expect(resp.status).toBe('pending');
  });

  it('gradual value=0 → 按租户关闭(createGeneration → FORBIDDEN,403)', async () => {
    await configFeatureService.updateFeature('generation', { status: 'gradual', value: 0 }, 'test');
    await expectBusinessError(
      () => generationService.createGeneration({ tenantId: TENANT_A, userId: USER_STUDENT1, body: buildBody() }),
      ErrorCode.FORBIDDEN,
      403,
    );
  });
});
