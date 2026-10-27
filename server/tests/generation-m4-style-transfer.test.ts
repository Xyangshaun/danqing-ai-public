// ============================================================
// GenerationService M-4 编排层扩展测试(M4-T4,风格迁移生图专项)
// 对应源码:src/services/generation.service.ts(编排)/ generation-queue.service.ts(队列)
//           / generation.repository.ts(stalled 查询)/ config-feature.service.ts(开关)
// 对应文档:.trae/documents/m4-style-transfer-plan-2026-09-22.md
//   §2.6 决策 D-1:style 分支两步串联 + 两阶段落库(阶段 1 styleAnalysis 生图失败不丢)
//   §2.6 决策 D-2(v1.1.0 修订 R1):队列引用模式——载荷不含图片字段,Worker 从 DB 回读
//   §2.6 决策 D-3:生图以 inputType='text' 传入组合 prompt
//   §2.6 决策 D-4(v1.1.0 修订 R2):stalled 恢复扫描(超时标记 failed WORKER_INTERRUPTED)
//   §2.7 失败策略矩阵 / §2.8 styleTransfer 特性开关(fail-closed)
//
// 验收要点(对应计划 §9.1 M4-T4 行 / §十三 验收清单 5/6/8/17/18):
//   1. 两阶段落库集成测试:生图失败 + styleAnalysis 非空断言(failed 后拆解保留)
//   2. styleTransfer 开关关闭 → style 提交 403;开启 → 正常入队
//   3. 队列载荷断言:enqueue 后 job JSON 序列化不含 sketchImageUrl/styleImageUrl/
//      任何 base64 字样(sketch 与 style 两模式);旧格式残留载荷出队剔除(平滑过渡)
//   4. stalled 故障注入:超阈值 → failed WORKER_INTERRUPTED 且不重新入队;
//      未超阈值不处理;已 success 不被误标;竞态规避(仅更新仍为 processing 的行)
//   5. text/sketch 对外行为零变化(sketch 含引用模式回归:入队-出队-回读-生成全链路)
//   6. style 全流程 happy path:analyzeStyle 成功 → 阶段1落库 → 组合 prompt →
//      生图成功 → 阶段2落库 → getGeneration 含 styleAnalysis
//
// Mock 策略:
//   - setup.ts 全局 mock Prisma/Redis(prismaMock/redisMock,内存实现)
//   - vi.mock image-generation.service:控制 generateImage 返回(不触发真实生图 API)
//   - vi.mock style-analysis.service:仅替换 analyzeStyle(网络调用);
//     buildStyleTransferPrompt / StyleAnalysisError 保留真实实现(纯函数/错误类,
//     保真验证组合 prompt 构造与 failureReason 体系)
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prismaMock, redisMock } from './setup.js';
import { generationService } from '../src/services/generation.service.js';
import { generationRepository } from '../src/repositories/generation.repository.js';
import { generationQueueService, type GenerationJob } from '../src/services/generation-queue.service.js';
import { configFeatureService } from '../src/services/config-feature.service.js';
import {
  analyzeStyle,
  buildStyleTransferPrompt,
  StyleAnalysisError,
} from '../src/services/style-analysis.service.js';
import { generateImage, resolveImageAIConfig } from '../src/services/image-generation.service.js';
import type { ImageGenerationResult, ResolvedImageAIConfig } from '../src/services/image-generation.service.js';
import { BusinessError } from '../src/middlewares/error-handler.js';
import {
  ErrorCode,
  type ArtType,
  type CreateGenerationRequest,
  type GeneratedImage,
  type StyleAnalysis,
} from '../src/types/api-contract.js';

// ============================================================
// mock image-generation.service:控制 generateImage 返回
// ============================================================
vi.mock('../src/services/image-generation.service.js', () => ({
  generateImage: vi.fn(),
  resolveImageAIConfig: vi.fn(),
}));

// ============================================================
// mock style-analysis.service:仅替换 analyzeStyle(网络调用);
// buildStyleTransferPrompt / StyleAnalysisError 保留真实实现,
// 使组合 prompt 断言与 instanceof 失败分类检查保真
// ============================================================
vi.mock('../src/services/style-analysis.service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/style-analysis.service.js')>();
  return {
    ...actual,
    analyzeStyle: vi.fn(),
  };
});

const generateImageMock = vi.mocked(generateImage);
const resolveImageAIConfigMock = vi.mocked(resolveImageAIConfig);
const analyzeStyleMock = vi.mocked(analyzeStyle);

// ============================================================
// 测试常量
// ============================================================
const TENANT_A = 't-m4-a';
const TENANT_B = 't-m4-b';
const USER_1 = 'u-m4-student1';

/** 风格参考图(http URL 形态,分析报告页"以此风格生成练习"带入) */
const STYLE_IMAGE_HTTP = 'https://cdn.example.com/masterpiece-vangogh.jpg';
/** 风格参考图(dataURL 形态,生成页本地上传经 canvas 压缩的产物;模拟 ~1KB) */
const STYLE_IMAGE_DATAURL = `data:image/png;base64,${'A'.repeat(1024)}`;
/** 草稿图(dataURL 形态;模拟大载荷,用于队列载荷断言) */
const SKETCH_IMAGE_DATAURL = `data:image/jpeg;base64,${'B'.repeat(2048)}`;
/** 草稿图(http URL 形态,引用模式回读断言) */
const SKETCH_IMAGE_HTTP = 'https://cdn.example.com/sketch-draft-1.png';

/** 构造 StyleAnalysis 七字段(M4-T3 Zod 校验合法形态) */
const FAKE_STYLE_ANALYSIS: StyleAnalysis = {
  medium: '布面油画,颜料厚堆有光泽',
  brushwork: '短促断续的厚涂笔触,笔触明显外露',
  colorSystem: '高饱和补色对比,明度对比强烈',
  composition: '三角形稳定构图,前景物体放大主导视线',
  technique: '湿画法晕染,刮刀堆叠肌理',
  expression: '后印象派主观化表现,情绪外化、形体夸张',
  styleSeed: '厚涂油画质感,短促有力的断续笔触,高饱和补色对比强烈',
};

/** stalled 判定阈值(env 默认 GENERATION_STALLED_TIMEOUT_MS=300000,与测试环境一致) */
const STALLED_TIMEOUT_MS = 300_000;

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

/** 预置一个 active/standard 租户(配额 200,足够测试用) */
function setupTenant(id: string): void {
  prismaMock.__insertTenant({
    id,
    name: 'M-4 测试租户',
    plan: 'standard',
    status: 'active',
  });
}

/** 构造 CreateGenerationRequest */
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

/** 构造 style 模式请求体(默认 http 风格参考图 + 内容描述) */
function buildStyleBody(overrides?: Partial<CreateGenerationRequest>): CreateGenerationRequest {
  return buildBody({
    inputType: 'style',
    prompt: '一位戴草帽的少女站在麦田边',
    styleImageUrl: STYLE_IMAGE_HTTP,
    ...overrides,
  });
}

/** 构造 GenerationJob(Worker 手动入队用,模拟队列载荷) */
function buildJob(overrides?: Partial<GenerationJob>): GenerationJob {
  return {
    id: 'gen-m4-job-1',
    tenantId: TENANT_A,
    userId: USER_1,
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
    imageUrls: ['https://cdn.example.com/gen-m4-a.png'],
    provider: 'glm',
    model: 'glm-4v',
    usedFallback: false,
    failureReason: null,
    durationMs: 120,
    ...overrides,
  };
}

beforeEach(async () => {
  generateImageMock.mockReset();
  resolveImageAIConfigMock.mockReset();
  resolveImageAIConfigMock.mockReturnValue({
    provider: 'glm',
    apiKey: 'test-key',
    apiUrl: 'https://open.bigmodel.cn/api/paas/v4/images/generations',
    model: 'glm-4v',
    fallback: false,
  } as ResolvedImageAIConfig);
  analyzeStyleMock.mockReset();
  vi.restoreAllMocks();

  // 双开关默认开启(generation + styleTransfer);开关关闭路径由专项组独立控制
  await configFeatureService.updateFeature('generation', { status: 'enabled' }, 'test');
  await configFeatureService.updateFeature('styleTransfer', { status: 'enabled' }, 'test');
});

// ============================================================
// 1. style 全流程 happy path(验收要点 6)
// ============================================================

describe('M4-T4 style 全流程 happy path(两步串联,验收 D-1/D-3)', () => {
  beforeEach(() => setupTenant(TENANT_A));

  it('analyzeStyle 成功 → 阶段1落库 styleAnalysis → 组合 prompt 生图 → 阶段2落库 → getGeneration 含 styleAnalysis', async () => {
    analyzeStyleMock.mockResolvedValue(FAKE_STYLE_ANALYSIS);
    generateImageMock.mockResolvedValue(successResult());

    // 提交:style 模式(http 风格参考图 + 新画面内容描述)
    const res = await generationService.createGeneration({
      tenantId: TENANT_A,
      userId: USER_1,
      body: buildStyleBody(),
    });
    expect(res.status).toBe('pending');
    expect(res.images).toBeNull();

    // DB 落库:inputType=style + styleImageUrl(D-2:DB 为图片真源)
    const created = prismaMock.generationTaskStore.get(res.taskId);
    expect(created?.inputType).toBe('style');
    expect(created?.styleImageUrl).toBe(STYLE_IMAGE_HTTP);
    expect(created?.prompt).toBe('一位戴草帽的少女站在麦田边');

    // Worker 处理(入队-出队-回读-生成全链路)
    expect(await generationService.processQueueOnce()).toBe(1);

    // Step1:analyzeStyle 收到 DB 回读的 styleImageUrl + artType(引用模式)
    expect(analyzeStyleMock).toHaveBeenCalledTimes(1);
    expect(analyzeStyleMock).toHaveBeenCalledWith(STYLE_IMAGE_HTTP, 'painting', undefined);

    // Step2:generateImage 以 inputType='text' 传入组合 prompt(决策 D-3)
    expect(generateImageMock).toHaveBeenCalledTimes(1);
    const genArg = generateImageMock.mock.calls[0]![0];
    expect(genArg.inputType).toBe('text');
    expect(genArg.sketchImageUrl).toBeUndefined();
    // 组合 prompt:七字段风格语言 + 用户新内容描述 + artType 中文名 + 版权硬约束
    expect(genArg.prompt).toContain(FAKE_STYLE_ANALYSIS.medium);
    expect(genArg.prompt).toContain(FAKE_STYLE_ANALYSIS.brushwork);
    expect(genArg.prompt).toContain(FAKE_STYLE_ANALYSIS.colorSystem);
    expect(genArg.prompt).toContain(FAKE_STYLE_ANALYSIS.composition);
    expect(genArg.prompt).toContain(FAKE_STYLE_ANALYSIS.technique);
    expect(genArg.prompt).toContain(FAKE_STYLE_ANALYSIS.expression);
    expect(genArg.prompt).toContain('一位戴草帽的少女站在麦田边');
    expect(genArg.prompt).toContain('绘画');
    expect(genArg.prompt).toContain('严禁复制');
    // 风格参考图 URL 不注入组合 prompt(纯文生图,风格已文字化)
    expect(genArg.prompt).not.toContain(STYLE_IMAGE_HTTP);

    // 阶段 2 落库:success + images + styleAnalysis + processingStartedAt(统一口径)
    const task = prismaMock.generationTaskStore.get(res.taskId);
    expect(task?.status).toBe('success');
    expect(task?.styleAnalysis).toEqual(FAKE_STYLE_ANALYSIS);
    expect((task?.images as GeneratedImage[]).length).toBe(1);
    expect((task?.images as GeneratedImage[])[0]!.reviewStatus).toBe('pending');
    expect(task?.processingStartedAt).toBeInstanceOf(Date);

    // getGeneration 透出 styleAnalysis(契约 GetGenerationResponse.styleAnalysis)
    const detail = await generationService.getGeneration({
      tenantId: TENANT_A,
      generationId: res.taskId,
      userId: USER_1,
      role: 'student',
    });
    expect(detail.status).toBe('success');
    expect(detail.styleAnalysis).toEqual(FAKE_STYLE_ANALYSIS);
    expect(detail.images?.[0]?.imageUrl).toBe('https://cdn.example.com/gen-m4-a.png');
  });

  it('dataURL 风格参考图全流程同样打通(生成页 canvas 压缩产物形态)', async () => {
    analyzeStyleMock.mockResolvedValue(FAKE_STYLE_ANALYSIS);
    generateImageMock.mockResolvedValue(successResult());

    const res = await generationService.createGeneration({
      tenantId: TENANT_A,
      userId: USER_1,
      body: buildStyleBody({ styleImageUrl: STYLE_IMAGE_DATAURL, artType: 'design' }),
    });
    expect(res.status).toBe('pending');
    expect(await generationService.processQueueOnce()).toBe(1);

    // analyzeStyle 收到 dataURL 原文(经 DB 回读)
    expect(analyzeStyleMock).toHaveBeenCalledWith(STYLE_IMAGE_DATAURL, 'design', undefined);
    const task = prismaMock.generationTaskStore.get(res.taskId);
    expect(task?.status).toBe('success');
    expect(task?.styleAnalysis).toEqual(FAKE_STYLE_ANALYSIS);
  });

  it('buildStyleTransferPrompt 组合产物即生图入参(阶段1落库与生图入参同源,真实纯函数)', () => {
    // 直接验证 service 内部使用的组合函数产物(保真:mock 仅替换 analyzeStyle 网络调用)
    const combined = buildStyleTransferPrompt(FAKE_STYLE_ANALYSIS, '一位戴草帽的少女站在麦田边', 'painting');
    expect(combined).toContain(FAKE_STYLE_ANALYSIS.medium);
    expect(combined).toContain(FAKE_STYLE_ANALYSIS.expression);
    expect(combined).toContain('创作一幅全新的绘画作品：一位戴草帽的少女站在麦田边。');
    expect(combined).toContain('整体风格高度统一，细节刻画符合绘画的媒介特性。');
  });
});

// ============================================================
// 2. 两阶段落库:生图失败 + styleAnalysis 保留(验收要点 1 / DoD D4)
// ============================================================

describe('M4-T4 两阶段落库(生图失败拆解保留,验收 D-1)', () => {
  beforeEach(() => setupTenant(TENANT_A));

  it('风格分析成功、生图失败 → 任务 failed 但 styleAnalysis 非空(failed 结果页仍可展示拆解卡)', async () => {
    analyzeStyleMock.mockResolvedValue(FAKE_STYLE_ANALYSIS);
    generateImageMock.mockResolvedValue(
      successResult({ success: false, imageUrls: null, failureReason: 'AI_TIMEOUT' }),
    );

    const res = await generationService.createGeneration({
      tenantId: TENANT_A,
      userId: USER_1,
      body: buildStyleBody(),
    });
    expect(await generationService.processQueueOnce()).toBe(1);

    const task = prismaMock.generationTaskStore.get(res.taskId);
    expect(task?.status).toBe('failed');
    expect(task?.failureReason).toBe('AI_TIMEOUT');
    // 关键断言:阶段 1 已落库的 styleAnalysis 不因生图失败而丢失
    expect(task?.styleAnalysis).toEqual(FAKE_STYLE_ANALYSIS);
    expect(task?.images).toBeNull();
    expect(task?.completedAt).toBeInstanceOf(Date);

    // getGeneration(failed)同样透出拆解(前端 failed 视图展示拆解卡)
    const detail = await generationService.getGeneration({
      tenantId: TENANT_A,
      generationId: res.taskId,
      userId: USER_1,
      role: 'student',
    });
    expect(detail.status).toBe('failed');
    expect(detail.failureReason).toBe('AI_TIMEOUT');
    expect(detail.styleAnalysis).toEqual(FAKE_STYLE_ANALYSIS);
  });

  it('analyzeStyle 失败(StyleAnalysisError)→ 任务 failed + failureReason 透出,绝不静默降级为纯文生图', async () => {
    // 重试后仍失败的超时(真源 §2.7 失败矩阵:AI_TIMEOUT,不降级)
    analyzeStyleMock.mockRejectedValue(
      new StyleAnalysisError('AI_TIMEOUT', '风格分析调用超时', 40_200, true),
    );

    const res = await generationService.createGeneration({
      tenantId: TENANT_A,
      userId: USER_1,
      body: buildStyleBody(),
    });
    expect(await generationService.processQueueOnce()).toBe(1);

    const task = prismaMock.generationTaskStore.get(res.taskId);
    expect(task?.status).toBe('failed');
    expect(task?.failureReason).toBe('AI_TIMEOUT');
    expect(task?.styleAnalysis).toBeNull();
    // 关键断言:分析失败即终止,不产出无风格生成图(绝不降级为纯文生图)
    expect(generateImageMock).not.toHaveBeenCalled();
  });

  it('analyzeStyle 抛非 StyleAnalysisError 异常 → 防御性兜底 AI_UNKNOWN_ERROR,同样不降级', async () => {
    analyzeStyleMock.mockRejectedValue(new Error('unexpected'));

    const res = await generationService.createGeneration({
      tenantId: TENANT_A,
      userId: USER_1,
      body: buildStyleBody(),
    });
    expect(await generationService.processQueueOnce()).toBe(1);

    const task = prismaMock.generationTaskStore.get(res.taskId);
    expect(task?.status).toBe('failed');
    expect(task?.failureReason).toBe('AI_UNKNOWN_ERROR');
    expect(generateImageMock).not.toHaveBeenCalled();
  });
});

// ============================================================
// 3. styleTransfer 特性开关(验收要点 2 / DoD D8)
// ============================================================

describe('M4-T4 styleTransfer 特性开关(fail-closed,真源 §2.8)', () => {
  beforeEach(async () => {
    setupTenant(TENANT_A);
    // 重置双开关为默认(generation=disabled,styleTransfer=disabled),本组独立控制
    await configFeatureService.resetToDefaults();
    // 仅开启 generation(text/sketch 可用),styleTransfer 保持关闭
    await configFeatureService.updateFeature('generation', { status: 'enabled' }, 'test');
  });

  it('styleTransfer 关闭(generation 开启)→ style 提交 FORBIDDEN(2004,403) 且不入队不落库', async () => {
    await expectBusinessError(
      () =>
        generationService.createGeneration({
          tenantId: TENANT_A,
          userId: USER_1,
          body: buildStyleBody(),
        }),
      ErrorCode.FORBIDDEN,
      403,
    );
    // 不入队
    expect(await generationQueueService.getQueueLength()).toBe(0);
    // 不落库(开关校验先于落库)
    expect(prismaMock.generationTaskStore.size).toBe(0);
  });

  it('styleTransfer 开启 → style 正常提交入队(pending)', async () => {
    await configFeatureService.updateFeature('styleTransfer', { status: 'enabled' }, 'test');

    const res = await generationService.createGeneration({
      tenantId: TENANT_A,
      userId: USER_1,
      body: buildStyleBody(),
    });
    expect(res.status).toBe('pending');
    expect(await generationQueueService.getQueueLength()).toBe(1);
  });

  it('开关独立性:styleTransfer 关闭不影响 text 模式(熔断 style 不伤 text/sketch 主链路)', async () => {
    const res = await generationService.createGeneration({
      tenantId: TENANT_A,
      userId: USER_1,
      body: buildBody(), // text 模式
    });
    expect(res.status).toBe('pending');
    expect(await generationQueueService.getQueueLength()).toBe(1);
  });

  it('generation 关闭时 styleTransfer 开启也无效(总开关在前)', async () => {
    await configFeatureService.updateFeature('styleTransfer', { status: 'enabled' }, 'test');
    await configFeatureService.updateFeature('generation', { status: 'disabled' }, 'test');

    await expectBusinessError(
      () =>
        generationService.createGeneration({
          tenantId: TENANT_A,
          userId: USER_1,
          body: buildStyleBody(),
        }),
      ErrorCode.FORBIDDEN,
      403,
    );
  });
});

// ============================================================
// 4. 队列引用模式载荷断言(验收要点 3 / DoD D11,决策 D-2)
// ============================================================

describe('M4-T4 队列引用模式载荷断言(GenerationJob 不含图片字段,验收 D-2)', () => {
  beforeEach(() => setupTenant(TENANT_A));

  it('sketch 模式:enqueue 后载荷 JSON 不含 sketchImageUrl/styleImageUrl/任何 base64 字样', async () => {
    const res = await generationService.createGeneration({
      tenantId: TENANT_A,
      userId: USER_1,
      body: buildBody({
        inputType: 'sketch',
        sketchImageUrl: SKETCH_IMAGE_DATAURL,
        prompt: undefined,
      }),
    });
    expect(res.status).toBe('pending');

    // 直接读取 Redis List 原始载荷(不修改队列状态)
    const payloads = redisMock.__peekList('queue:generation');
    expect(payloads.length).toBe(1);
    const raw = payloads[0]!;
    expect(raw).not.toContain('sketchImageUrl');
    expect(raw).not.toContain('styleImageUrl');
    expect(raw).not.toContain('base64');
    expect(raw).not.toContain('data:image');

    // 载荷保留任务引用小字段(引用模式核心)
    const job = JSON.parse(raw) as GenerationJob;
    expect(job.id).toBe(res.taskId);
    expect(job.tenantId).toBe(TENANT_A);
    expect(job.userId).toBe(USER_1);
    expect(job.inputType).toBe('sketch');
    expect(job.artType).toBe('painting');
    // 载荷恒定小体积(数 KB 级;dataURL 可达数百 KB~6M 不再入队)
    expect(raw.length).toBeLessThan(2048);

    // 图片落在 DB(真源)
    expect(prismaMock.generationTaskStore.get(res.taskId)?.sketchImageUrl).toBe(SKETCH_IMAGE_DATAURL);
  });

  it('style 模式:enqueue 后载荷 JSON 不含 styleImageUrl/sketchImageUrl/任何 base64 字样', async () => {
    const res = await generationService.createGeneration({
      tenantId: TENANT_A,
      userId: USER_1,
      body: buildStyleBody({ styleImageUrl: STYLE_IMAGE_DATAURL }),
    });
    expect(res.status).toBe('pending');

    const payloads = redisMock.__peekList('queue:generation');
    expect(payloads.length).toBe(1);
    const raw = payloads[0]!;
    expect(raw).not.toContain('styleImageUrl');
    expect(raw).not.toContain('sketchImageUrl');
    expect(raw).not.toContain('base64');
    expect(raw).not.toContain('data:image');
    expect(raw.length).toBeLessThan(2048);

    const job = JSON.parse(raw) as GenerationJob;
    expect(job.id).toBe(res.taskId);
    expect(job.inputType).toBe('style');
    expect(job.prompt).toBe('一位戴草帽的少女站在麦田边');

    // 图片落在 DB(真源)
    expect(prismaMock.generationTaskStore.get(res.taskId)?.styleImageUrl).toBe(STYLE_IMAGE_DATAURL);
  });

  it('平滑过渡:旧格式残留载荷(含图片字段)出队时被剔除,Worker 以 DB 回读为准', async () => {
    // 模拟上线瞬间 Redis 残留的旧格式 job(M-2 时代含 sketchImageUrl 的载荷)
    const legacyJob = {
      id: 'gen-m4-legacy',
      tenantId: TENANT_A,
      userId: USER_1,
      inputType: 'sketch',
      prompt: '一幅水彩小稿',
      sketchImageUrl: SKETCH_IMAGE_DATAURL,
      styleImageUrl: STYLE_IMAGE_DATAURL,
      artType: 'painting',
      aspect: 'square',
      count: 1,
      enqueuedAt: new Date().toISOString(),
    };
    await redisMock.lpush('queue:generation', JSON.stringify(legacyJob));

    const job = await generationQueueService.dequeue(0);
    expect(job).not.toBeNull();
    expect(job!.id).toBe('gen-m4-legacy');
    // 残留图片字段已剔除(出队侧防御)
    expect(job).not.toHaveProperty('sketchImageUrl');
    expect(job).not.toHaveProperty('styleImageUrl');
  });
});

// ============================================================
// 5. stalled 恢复扫描(验收要点 4 / DoD D12,决策 D-4)
// ============================================================

describe('M4-T4 stalled 恢复扫描(D-4,故障注入)', () => {
  beforeEach(() => {
    setupTenant(TENANT_A);
    setupTenant(TENANT_B);
  });

  it('任务置 processing 且 processingStartedAt 超阈值 → 扫描标记 failed WORKER_INTERRUPTED 且不重新入队', async () => {
    // 故障注入:模拟 Worker 中断(任务卡 processing 超过 5 分钟阈值)
    prismaMock.__insertGenerationTask({
      id: 'gen-stalled-1',
      tenantId: TENANT_A,
      userId: USER_1,
      inputType: 'text',
      status: 'processing',
      processingStartedAt: new Date(Date.now() - STALLED_TIMEOUT_MS - 60_000),
    });

    const marked = await generationService.scanStalledTasksOnce();
    expect(marked).toBe(1);

    const task = prismaMock.generationTaskStore.get('gen-stalled-1');
    expect(task?.status).toBe('failed');
    expect(task?.failureReason).toBe('WORKER_INTERRUPTED');
    expect(task?.completedAt).toBeInstanceOf(Date);

    // 不自动重新入队(防重复生图与配额争议;用户可手动重新提交)
    expect(await generationQueueService.getQueueLength()).toBe(0);
  });

  it('未超阈值(processing 刚开始)→ 扫描不处理,任务保持 processing', async () => {
    prismaMock.__insertGenerationTask({
      id: 'gen-active-1',
      tenantId: TENANT_A,
      userId: USER_1,
      inputType: 'text',
      status: 'processing',
      processingStartedAt: new Date(), // 刚写入(正常处理中的任务)
    });

    const marked = await generationService.scanStalledTasksOnce();
    expect(marked).toBe(0);
    expect(prismaMock.generationTaskStore.get('gen-active-1')?.status).toBe('processing');
  });

  it('已 success 的任务 → 不被误标(即使 processingStartedAt 早于阈值)', async () => {
    prismaMock.__insertGenerationTask({
      id: 'gen-done-1',
      tenantId: TENANT_A,
      userId: USER_1,
      inputType: 'text',
      status: 'success',
      processingStartedAt: new Date(Date.now() - STALLED_TIMEOUT_MS - 120_000),
      completedAt: new Date(),
    });

    const marked = await generationService.scanStalledTasksOnce();
    expect(marked).toBe(0);
    const task = prismaMock.generationTaskStore.get('gen-done-1');
    expect(task?.status).toBe('success');
    expect(task?.failureReason).toBeNull();
  });

  it('processing 但 processingStartedAt=NULL(历史任务)→ 不被误判(lt 比较不满足)', async () => {
    prismaMock.__insertGenerationTask({
      id: 'gen-legacy-null',
      tenantId: TENANT_A,
      userId: USER_1,
      inputType: 'text',
      status: 'processing',
      processingStartedAt: null,
    });

    const marked = await generationService.scanStalledTasksOnce();
    expect(marked).toBe(0);
    expect(prismaMock.generationTaskStore.get('gen-legacy-null')?.status).toBe('processing');
  });

  it('跨租户聚合:两租户各有超时任务 → 均被标记(以租户为隔离单元聚合扫描)', async () => {
    prismaMock.__insertGenerationTask({
      id: 'gen-stalled-a',
      tenantId: TENANT_A,
      userId: USER_1,
      inputType: 'style',
      status: 'processing',
      processingStartedAt: new Date(Date.now() - STALLED_TIMEOUT_MS - 60_000),
    });
    prismaMock.__insertGenerationTask({
      id: 'gen-stalled-b',
      tenantId: TENANT_B,
      userId: USER_1,
      inputType: 'text',
      status: 'processing',
      processingStartedAt: new Date(Date.now() - STALLED_TIMEOUT_MS - 90_000),
    });

    const marked = await generationService.scanStalledTasksOnce();
    expect(marked).toBe(2);
    expect(prismaMock.generationTaskStore.get('gen-stalled-a')?.failureReason).toBe('WORKER_INTERRUPTED');
    expect(prismaMock.generationTaskStore.get('gen-stalled-b')?.failureReason).toBe('WORKER_INTERRUPTED');
  });

  it('竞态规避:任务已被并发推进终态 → markStalledProcessingFailed 影响 0 行,不覆盖 Worker 终态', async () => {
    // 场景:findStalledProcessing 读取后、原子更新前,任务恰好被 Worker 标记 success
    prismaMock.__insertGenerationTask({
      id: 'gen-race-1',
      tenantId: TENANT_A,
      userId: USER_1,
      inputType: 'text',
      status: 'success', // 已被 Worker 推进终态
      processingStartedAt: new Date(Date.now() - STALLED_TIMEOUT_MS - 60_000),
      completedAt: new Date(),
    });

    const marked = await generationRepository.markStalledProcessingFailed(
      TENANT_A,
      'gen-race-1',
      new Date(Date.now() - STALLED_TIMEOUT_MS),
      { failureReason: 'WORKER_INTERRUPTED', completedAt: new Date() },
    );
    expect(marked).toBe(0);
    // Worker 写入的终态不被覆盖
    const task = prismaMock.generationTaskStore.get('gen-race-1');
    expect(task?.status).toBe('success');
    expect(task?.failureReason).toBeNull();
  });

  it('扫描器生命周期:startStalledScanner 启动后可 stop 清理定时器(幂等)', async () => {
    // 极短间隔启动(仅验证生命周期 API,不等待定时触发)
    generationService.startStalledScanner(60_000);
    generationService.stopStalledScanner();
    // 重复 stop 幂等
    generationService.stopStalledScanner();
    // 再次启动不受影响
    generationService.startStalledScanner(60_000);
    generationService.stopStalledScanner();
  });
});

// ============================================================
// 6. text/sketch 对外行为零变化(验收要点 5,sketch 引用模式回归)
// ============================================================

describe('M4-T4 text/sketch 对外行为零变化(sketch 含引用模式回归)', () => {
  beforeEach(() => setupTenant(TENANT_A));

  it('text 模式回归:提交 → pending → 处理 → success(对外行为与 M-2 一致)', async () => {
    generateImageMock.mockResolvedValue(successResult());

    const res = await generationService.createGeneration({
      tenantId: TENANT_A,
      userId: USER_1,
      body: buildBody({ prompt: '宁静的湖泊与远山' }),
    });
    expect(res.status).toBe('pending');
    expect(await generationService.processQueueOnce()).toBe(1);

    const task = prismaMock.generationTaskStore.get(res.taskId);
    expect(task?.status).toBe('success');
    expect(task?.inputType).toBe('text');
    expect(task?.processingStartedAt).toBeInstanceOf(Date);
    // style 分支不触发(text 不调 analyzeStyle)
    expect(analyzeStyleMock).not.toHaveBeenCalled();
    // generateImage 收到原始 prompt(无组合改写)
    const genArg = generateImageMock.mock.calls[0]![0];
    expect(genArg.inputType).toBe('text');
    expect(genArg.prompt).toBe('宁静的湖泊与远山');
  });

  it('sketch 引用模式全链路:入队 → 出队 → DB 回读 sketchImageUrl → 生图 success', async () => {
    generateImageMock.mockResolvedValue(successResult());

    const res = await generationService.createGeneration({
      tenantId: TENANT_A,
      userId: USER_1,
      body: buildBody({
        inputType: 'sketch',
        sketchImageUrl: SKETCH_IMAGE_HTTP,
        prompt: undefined,
      }),
    });
    expect(res.status).toBe('pending');
    expect(await generationService.processQueueOnce()).toBe(1);

    // 关键断言:generateImage 收到的 sketchImageUrl 来自 DB 回读(引用模式),
    // 而非队列载荷(载荷已不含图片字段)
    expect(generateImageMock).toHaveBeenCalledTimes(1);
    const genArg = generateImageMock.mock.calls[0]![0];
    expect(genArg.inputType).toBe('sketch');
    expect(genArg.sketchImageUrl).toBe(SKETCH_IMAGE_HTTP);

    const task = prismaMock.generationTaskStore.get(res.taskId);
    expect(task?.status).toBe('success');
    expect((task?.images as GeneratedImage[]).length).toBe(1);
    // 非 style 模式不触发风格分析
    expect(analyzeStyleMock).not.toHaveBeenCalled();
    expect(task?.styleAnalysis).toBeNull();
  });

  it('sketch 降级同步模式(队列不可用)同样经 DB 回读图片(引用模式双路径一致)', async () => {
    generateImageMock.mockResolvedValue(successResult());
    // 模拟 Redis 队列不可用(ping 失败 → 降级同步,复用 M-2 降级路径)
    vi.spyOn(generationQueueService, 'isAvailable').mockResolvedValue(false);

    const res = await generationService.createGeneration({
      tenantId: TENANT_A,
      userId: USER_1,
      body: buildBody({
        inputType: 'sketch',
        sketchImageUrl: SKETCH_IMAGE_HTTP,
        prompt: undefined,
      }),
    });
    // 同步模式直接返回终态
    expect(res.status).toBe('success');

    const genArg = generateImageMock.mock.calls[0]![0];
    expect(genArg.inputType).toBe('sketch');
    expect(genArg.sketchImageUrl).toBe(SKETCH_IMAGE_HTTP);

    const task = prismaMock.generationTaskStore.get(res.taskId);
    expect(task?.status).toBe('success');
    // 同步模式同样写入 processingStartedAt(口径统一,受 stalled 扫描覆盖)
    expect(task?.processingStartedAt).toBeInstanceOf(Date);
  });

  it('sketch 引用模式兜底:DB 缺 sketchImageUrl(数据异常)→ failed 不阻断 Worker', async () => {
    // 手动构造任务(sketchImageUrl=NULL,模拟引用模式数据异常)+ 手动入队
    prismaMock.__insertGenerationTask({
      id: 'gen-noref-1',
      tenantId: TENANT_A,
      userId: USER_1,
      inputType: 'sketch',
      status: 'pending',
      sketchImageUrl: null,
    });
    await generationQueueService.enqueue(
      buildJob({ id: 'gen-noref-1', inputType: 'sketch', prompt: undefined }),
    );

    expect(await generationService.processQueueOnce()).toBe(1);

    const task = prismaMock.generationTaskStore.get('gen-noref-1');
    expect(task?.status).toBe('failed');
    expect(task?.failureReason).toBe('GENERATION_FAILED');
    // 缺图兜底:不调生图
    expect(generateImageMock).not.toHaveBeenCalled();
  });
});

// ============================================================
// 7. validateInput style 分支校验(6105,真源 §4.4/§2.7)
// ============================================================

describe('M4-T4 validateInput style 分支(GENERATION_IMAGE_INVALID 6105)', () => {
  beforeEach(() => setupTenant(TENANT_A));

  it('style 缺 prompt(新画面内容描述)→ 6105(400)', async () => {
    await expectBusinessError(
      () =>
        generationService.createGeneration({
          tenantId: TENANT_A,
          userId: USER_1,
          body: buildStyleBody({ prompt: undefined }),
        }),
      ErrorCode.GENERATION_IMAGE_INVALID,
      400,
    );
  });

  it('style 缺 styleImageUrl → 6105(400)', async () => {
    await expectBusinessError(
      () =>
        generationService.createGeneration({
          tenantId: TENANT_A,
          userId: USER_1,
          body: buildStyleBody({ styleImageUrl: undefined }),
        }),
      ErrorCode.GENERATION_IMAGE_INVALID,
      400,
    );
  });

  it('style styleImageUrl 非法格式(非 http/dataURL)→ 6105(400)', async () => {
    await expectBusinessError(
      () =>
        generationService.createGeneration({
          tenantId: TENANT_A,
          userId: USER_1,
          body: buildStyleBody({ styleImageUrl: 'ftp://example.com/img.png' }),
        }),
      ErrorCode.GENERATION_IMAGE_INVALID,
      400,
    );
  });

  it('style styleImageUrl 非法 dataURL 媒体类型 → 6105(400)', async () => {
    await expectBusinessError(
      () =>
        generationService.createGeneration({
          tenantId: TENANT_A,
          userId: USER_1,
          body: buildStyleBody({ styleImageUrl: 'data:image/gif;base64,AAAA' }),
        }),
      ErrorCode.GENERATION_IMAGE_INVALID,
      400,
    );
  });

  it('style styleImageUrl 合法 http/https/dataURL(png/jpeg/webp)→ 校验通过正常入队', async () => {
    const legalUrls = [
      'http://example.com/master.jpg',
      'https://cdn.example.com/master.png',
      'data:image/png;base64,AAAA',
      'data:image/jpeg;base64,BBBB',
      'data:image/webp;base64,CCCC',
    ];
    for (const url of legalUrls) {
      const res = await generationService.createGeneration({
        tenantId: TENANT_A,
        userId: USER_1,
        body: buildStyleBody({ styleImageUrl: url }),
      });
      expect(res.status).toBe('pending');
    }
    // 全部入队成功(5 次提交恰好在限流窗口内,artType 默认 painting)
    expect(await generationQueueService.getQueueLength()).toBe(5);
  });
});

// ============================================================
// 8. artType 透传(组合 prompt 按画种适配,真源 §2.5)
// ============================================================

describe('M4-T4 artType 透传与组合 prompt 画种适配', () => {
  beforeEach(() => setupTenant(TENANT_A));

  it.each<[ArtType, string]>([
    ['painting', '绘画'],
    ['design', '设计'],
    ['product', '产品设计'],
    ['sculpture', '雕塑'],
  ])('artType=%s → 组合 prompt 含中文名"%s"', async (artType, label) => {
    analyzeStyleMock.mockResolvedValue(FAKE_STYLE_ANALYSIS);
    generateImageMock.mockResolvedValue(successResult());

    const res = await generationService.createGeneration({
      tenantId: TENANT_A,
      userId: USER_1,
      body: buildStyleBody({ artType }),
    });
    expect(res.status).toBe('pending');
    expect(await generationService.processQueueOnce()).toBe(1);

    const genArg = generateImageMock.mock.calls[generateImageMock.mock.calls.length - 1]![0];
    expect(genArg.prompt).toContain(`创作一幅全新的${label}作品`);
    expect(genArg.prompt).toContain(`符合${label}的媒介特性`);
  });
});
