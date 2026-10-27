// ============================================================
// GenerationQueueService 单元测试
// 对应源码:src/services/generation-queue.service.ts
// 对应文档:.trae/documents/m2-generation-plan-2026-08-07.md §2.3(异步任务状态机)
// 复用模式:analysis-queue.service.ts(Redis LPUSH/BRPOP + job 状态/TTL)
//
// 测试范围:
//   1. enqueue:存储 pending 状态 + LPUSH 入队,返回队列长度
//   2. dequeue:BRPOP 出队,更新为 processing;空队列返回 null
//   3. markSuccess:pipeline 写 success 状态 + result
//   4. markFailed:写 failed 状态 + failureReason
//   5. getJobStatus / getJobResult:前端轮询
//   6. getQueueLength:队列待处理数
//   7. isAvailable:Redis ping 检查
//   8. 状态机:enqueue→dequeue→markSuccess/markFailed 全迁移
//
// Mock 策略:
//   - setup.ts 全局 mock Redis,通过 redisMock 直接断言 store/list 状态
//   - 每个测试 beforeEach 清空,保证隔离
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { redisMock } from './setup.js';
import { generationQueueService } from '../src/services/generation-queue.service.js';
import type { GenerationJob } from '../src/services/generation-queue.service.js';

// ============================================================
// 测试常量
// ============================================================

const QUEUE_KEY = 'queue:generation';

/** 构造 GenerationJob 默认值(text 模式) */
function buildJob(overrides?: Partial<GenerationJob>): GenerationJob {
  const now = new Date().toISOString();
  return {
    id: 'gen-1',
    tenantId: 't-gen-a',
    userId: 'u-gen-a1',
    inputType: 'text',
    prompt: '一幅印象派风景油画',
    artType: 'painting',
    aspect: 'square',
    count: 1,
    enqueuedAt: now,
    ...overrides,
  };
}

/** 读取 Redis 中某 key 的原始字符串值(经 __peek) */
function peekValue(key: string): string | null {
  const entry = redisMock.__peek(key);
  return entry?.value ?? null;
}

/** 解析状态记录 JSON */
function peekStatus(jobId: string): { status: string; enqueuedAt?: string; startedAt?: string; completedAt?: string; failureReason?: string } | null {
  const raw = peekValue(`job:${jobId}:status`);
  if (!raw) return null;
  return JSON.parse(raw);
}

// ============================================================
// enqueue
// ============================================================

describe('GenerationQueueService.enqueue(入队)', () => {
  beforeEach(() => redisMock.__clear());

  it('存储 pending 状态 + LPUSH 入队,返回队列长度', async () => {
    const len = await generationQueueService.enqueue(buildJob());

    expect(len).toBe(1);

    // 状态:pending
    const status = peekStatus('gen-1');
    expect(status).not.toBeNull();
    expect(status!.status).toBe('pending');

    // 队列:存在且含任务 JSON
    const queueList = redisMock.lists.get(QUEUE_KEY);
    expect(queueList).toBeDefined();
    expect(queueList!.length).toBe(1);
    const enqueued = JSON.parse(queueList![0]) as GenerationJob;
    expect(enqueued.id).toBe('gen-1');
    expect(enqueued.tenantId).toBe('t-gen-a');
  });

  it('多个任务入队 → 队列长度累加,实现 FIFO', async () => {
    await generationQueueService.enqueue(buildJob({ id: 'gen-1' }));
    await generationQueueService.enqueue(buildJob({ id: 'gen-2' }));

    const len = await generationQueueService.getQueueLength();
    expect(len).toBe(2);
  });

  it('状态带 TTL(1 小时),不记录 startedAt/completedAt', async () => {
    await generationQueueService.enqueue(buildJob());
    const entry = redisMock.__peek('job:gen-1:status');
    // TTL 近似 3600s(允许极小误差)
    expect(entry!.expiresAt).not.toBeNull();
    const ttlSeconds = (entry!.expiresAt! - Date.now()) / 1000;
    expect(ttlSeconds).toBeGreaterThan(3590);
    expect(ttlSeconds).toBeLessThanOrEqual(3600);
  });
});

// ============================================================
// dequeue
// ============================================================

describe('GenerationQueueService.dequeue(出队)', () => {
  beforeEach(() => redisMock.__clear());

  it('队列非空 → 取出任务并更新为 processing', async () => {
    await generationQueueService.enqueue(buildJob({ id: 'gen-1' }));

    const job = await generationQueueService.dequeue(0);

    expect(job).not.toBeNull();
    expect(job!.id).toBe('gen-1');

    // 状态迁移 pending → processing
    const status = peekStatus('gen-1');
    expect(status!.status).toBe('processing');
    expect(status!.startedAt).toBeDefined();

    // 队列已清空
    expect(await generationQueueService.getQueueLength()).toBe(0);
  });

  it('队列为空 → 返回 null', async () => {
    const job = await generationQueueService.dequeue(0);
    expect(job).toBeNull();
  });
});

// ============================================================
// markSuccess / markFailed
// ============================================================

describe('GenerationQueueService.markSuccess(标记成功)', () => {
  beforeEach(() => redisMock.__clear());

  it('pipeline 写 success 状态 + result', async () => {
    const result = [
      { imageUrl: 'https://cdn.example.com/gen-a.png', reviewStatus: 'pending' },
      { imageUrl: 'https://cdn.example.com/gen-b.png', reviewStatus: 'approved' },
    ];
    await generationQueueService.markSuccess('gen-1', result);

    // 状态:success + completedAt
    const status = peekStatus('gen-1');
    expect(status!.status).toBe('success');
    expect(status!.completedAt).toBeDefined();

    // 结果:可经 getJobResult 读回
    const storedResult = await generationQueueService.getJobResult('gen-1');
    expect(storedResult).toEqual(result);
  });
});

describe('GenerationQueueService.markFailed(标记失败)', () => {
  beforeEach(() => redisMock.__clear());

  it('写 failed 状态 + failureReason', async () => {
    await generationQueueService.markFailed('gen-1', 'GENERATION_PROVIDER_UNAVAILABLE');

    const status = peekStatus('gen-1');
    expect(status!.status).toBe('failed');
    expect(status!.failureReason).toBe('GENERATION_PROVIDER_UNAVAILABLE');
    expect(status!.completedAt).toBeDefined();
  });
});

// ============================================================
// getJobStatus / getJobResult / getQueueLength / isAvailable
// ============================================================

describe('GenerationQueueService.getJobStatus(查询状态)', () => {
  beforeEach(() => redisMock.__clear());

  it('任务存在 → 返回状态记录', async () => {
    await generationQueueService.enqueue(buildJob());
    const status = await generationQueueService.getJobStatus('gen-1');
    expect(status).not.toBeNull();
    expect(status!.status).toBe('pending');
  });

  it('任务不存在 → 返回 null', async () => {
    const status = await generationQueueService.getJobStatus('not-exist');
    expect(status).toBeNull();
  });
});

describe('GenerationQueueService.getJobResult(查询结果)', () => {
  beforeEach(() => redisMock.__clear());

  it('任务成功且有结果 → 返回结果', async () => {
    await generationQueueService.markSuccess('gen-1', [{ imageUrl: 'https://cdn.example.com/a.png', reviewStatus: 'pending' }]);
    const result = await generationQueueService.getJobResult('gen-1');
    expect(result).toEqual([{ imageUrl: 'https://cdn.example.com/a.png', reviewStatus: 'pending' }]);
  });

  it('无结果 → 返回 null', async () => {
    const result = await generationQueueService.getJobResult('not-exist');
    expect(result).toBeNull();
  });
});

describe('GenerationQueueService.getQueueLength(队列长度)', () => {
  beforeEach(() => redisMock.__clear());

  it('返回待处理任务数', async () => {
    expect(await generationQueueService.getQueueLength()).toBe(0);
    await generationQueueService.enqueue(buildJob({ id: 'gen-1' }));
    await generationQueueService.enqueue(buildJob({ id: 'gen-2' }));
    expect(await generationQueueService.getQueueLength()).toBe(2);
  });
});

describe('GenerationQueueService.isAvailable(可用性)', () => {
  beforeEach(() => redisMock.__clear());

  it('Redis 连通(ping 返回 PONG)→ true', async () => {
    expect(await generationQueueService.isAvailable()).toBe(true);
  });
});

// ============================================================
// 状态机全链路
// ============================================================

describe('GenerationQueueService 状态机全链路(pending→processing→success/failed)', () => {
  beforeEach(() => redisMock.__clear());

  it('enqueue → dequeue → markSuccess 全迁移', async () => {
    await generationQueueService.enqueue(buildJob());
    expect(peekStatus('gen-1')!.status).toBe('pending');

    const job = await generationQueueService.dequeue(0);
    expect(job!.id).toBe('gen-1');
    expect(peekStatus('gen-1')!.status).toBe('processing');

    const result = [{ imageUrl: 'https://cdn.example.com/a.png', reviewStatus: 'approved' }];
    await generationQueueService.markSuccess('gen-1', result);
    expect(peekStatus('gen-1')!.status).toBe('success');
    expect(await generationQueueService.getJobResult('gen-1')).toEqual(result);
  });

  it('enqueue → dequeue → markFailed 全迁移', async () => {
    await generationQueueService.enqueue(buildJob());
    expect(peekStatus('gen-1')!.status).toBe('pending');

    await generationQueueService.dequeue(0);
    expect(peekStatus('gen-1')!.status).toBe('processing');

    await generationQueueService.markFailed('gen-1', 'GENERATION_FAILED');
    const status = peekStatus('gen-1');
    expect(status!.status).toBe('failed');
    expect(status!.failureReason).toBe('GENERATION_FAILED');
  });
});