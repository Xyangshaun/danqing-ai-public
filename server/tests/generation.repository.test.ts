// ============================================================
// GenerationRepository 单元测试
// 对应源码:src/repositories/generation.repository.ts
// 对应文档:.trae/documents/m2-generation-plan-2026-08-07.md §3.2 / §3.4
// 对应契约:api-contract.ts §3.17(已冻结)
//
// 测试范围:
//   1. create:创建 pending 状态任务,强制 tenantId + userId 落库
//   2. findById:按 id + tenantId 查询;跨租户返回 null(不泄露存在性)
//   3. updateStatus:更新 status/images(含 DbNull 清空)/failureReason/usedFallback/provider/model
//      - 跨租户/不存在返回 null(不更新)
//      - images 为 null 时经 Prisma.DbNull 写入(清空)
//      - images 非空时写入数组
//   4. list:按 (tenantId, createdAt) 倒序分页,userId/status 筛选
//      - 强制 tenant_id 隔离(不同租户数据不串)
//   5. countMonthlyGenerateUsage:月度用量统计
//      - 按月边界(1 号 00:00 起,次月 1 号止)
//      - 仅统计 status != failed(success/processing/pending)
//
// Mock 策略:
//   - setup.ts 全局 mock Prisma,通过 prismaMock.__insertGenerationTask 预置数据
//   - 每个测试 beforeEach 清空 store,保证隔离
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { prismaMock } from './setup.js';
import { generationRepository } from '../src/repositories/generation.repository.js';
import type { GenerationTask, ArtType } from '@prisma/client';
import type { GeneratedImage } from '../src/types/api-contract.js';

// ============================================================
// 测试常量(跨租户隔离验证)
// ============================================================

const TENANT_A = 't-gen-a';
const TENANT_B = 't-gen-b';
const USER_A1 = 'u-gen-a1';
const USER_A2 = 'u-gen-a2';
const USER_B1 = 'u-gen-b1';

/** 构造 CreateGenerationData 默认值(text 模式) */
function buildCreateData(overrides?: Partial<Parameters<typeof generationRepository.create>[2]>): Parameters<typeof generationRepository.create>[2] {
  return {
    inputType: 'text',
    prompt: '一幅印象派风景油画',
    artType: 'painting' as ArtType,
    aspect: 'square',
    count: 1,
    ...overrides,
  };
}

/** 构造 GeneratedImage 数组(供 updateStatus 写入) */
function buildGeneratedImages(): GeneratedImage[] {
  return [
    { imageUrl: 'https://cdn.example.com/gen-a.png', reviewStatus: 'pending' },
    { imageUrl: 'https://cdn.example.com/gen-b.png', reviewStatus: 'approved' },
  ];
}

// ============================================================
// create
// ============================================================

describe('GenerationRepository.create(创建任务)', () => {
  beforeEach(() => prismaMock.__clear());

  it('创建 pending 状态任务,强制 tenantId + userId 落库', async () => {
    const task = await generationRepository.create(TENANT_A, USER_A1, buildCreateData());

    expect(task.tenantId).toBe(TENANT_A);
    expect(task.userId).toBe(USER_A1);
    expect(task.status).toBe('pending');
    expect(task.inputType).toBe('text');
    expect(task.prompt).toBe('一幅印象派风景油画');
    expect(task.artType).toBe('painting');
    expect(task.aspect).toBe('square');
    expect(task.count).toBe(1);
    expect(task.images).toBeNull();
    expect(task.failureReason).toBeNull();
    expect(task.usedFallback).toBe(false);
    expect(task.completedAt).toBeNull();
  });

  it('sketch 模式:写入 sketchImageUrl,prompt 为空', async () => {
    const task = await generationRepository.create(
      TENANT_A,
      USER_A1,
      buildCreateData({ inputType: 'sketch', prompt: undefined, sketchImageUrl: 'https://cdn.example.com/sketch.png' }),
    );

    expect(task.inputType).toBe('sketch');
    expect(task.sketchImageUrl).toBe('https://cdn.example.com/sketch.png');
    expect(task.prompt).toBeNull();
  });

  it('可选字段缺省时落 null(count 保留传入值)', async () => {
    const task = await generationRepository.create(
      TENANT_A,
      USER_A1,
      buildCreateData({ aspect: undefined, prompt: undefined, count: 3 }),
    );

    expect(task.aspect).toBeNull();
    expect(task.prompt).toBeNull();
    expect(task.count).toBe(3);
  });
});

// ============================================================
// findById
// ============================================================

describe('GenerationRepository.findById(按 id 查询)', () => {
  beforeEach(() => prismaMock.__clear());

  it('命中同租户任务 → 返回记录', async () => {
    prismaMock.__insertGenerationTask({ id: 't1', tenantId: TENANT_A, userId: USER_A1, status: 'processing' });

    const task = await generationRepository.findById(TENANT_A, 't1');
    expect(task).not.toBeNull();
    expect(task!.id).toBe('t1');
    expect(task!.tenantId).toBe(TENANT_A);
  });

  it('跨租户查询 → 返回 null(不泄露存在性)', async () => {
    prismaMock.__insertGenerationTask({ id: 't1', tenantId: TENANT_A, userId: USER_A1 });

    const task = await generationRepository.findById(TENANT_B, 't1');
    expect(task).toBeNull();
  });

  it('任务不存在 → 返回 null', async () => {
    const task = await generationRepository.findById(TENANT_A, 'not-exist');
    expect(task).toBeNull();
  });
});

// ============================================================
// updateStatus
// ============================================================

describe('GenerationRepository.updateStatus(更新状态)', () => {
  beforeEach(() => prismaMock.__clear());

  it('更新成功:status/images/failureReason/usedFallback/provider/model/completedAt', async () => {
    prismaMock.__insertGenerationTask({ id: 't1', tenantId: TENANT_A, userId: USER_A1, status: 'processing' });

    const completed = new Date('2026-08-07T10:00:00.000Z');
    const updated = await generationRepository.updateStatus(TENANT_A, 't1', {
      status: 'success',
      images: buildGeneratedImages(),
      usedFallback: true,
      provider: 'glm',
      model: 'glm-4v-flash',
      completedAt: completed,
    });

    expect(updated).not.toBeNull();
    expect(updated!.status).toBe('success');
    expect(updated!.images).toEqual(buildGeneratedImages());
    expect(updated!.usedFallback).toBe(true);
    expect(updated!.provider).toBe('glm');
    expect(updated!.model).toBe('glm-4v-flash');
    expect(updated!.completedAt).toEqual(completed);

    // 验证 store 中的持久化值
    const stored = prismaMock.generationTaskStore.get('t1');
    expect(stored!.status).toBe('success');
    expect(stored!.images).toEqual(buildGeneratedImages());
  });

  it('images 传 null → 经 Prisma.DbNull 清空(不残留旧值)', async () => {
    prismaMock.__insertGenerationTask({
      id: 't1', tenantId: TENANT_A, userId: USER_A1, status: 'processing', images: buildGeneratedImages(),
    });

    const updated = await generationRepository.updateStatus(TENANT_A, 't1', {
      status: 'failed',
      failureReason: 'GENERATION_FAILED',
      images: null,
      completedAt: new Date(),
    });

    // mock 的 DbNull 展开为空字段,images 应为 null(清空)
    expect(updated).not.toBeNull();
    expect(updated!.images).toBeNull();
    expect(updated!.status).toBe('failed');
    expect(updated!.failureReason).toBe('GENERATION_FAILED');
  });

  it('images 未传(undefined)→ 不覆盖已有 images', async () => {
    prismaMock.__insertGenerationTask({
      id: 't1', tenantId: TENANT_A, userId: USER_A1, status: 'processing', images: buildGeneratedImages(),
    });

    const updated = await generationRepository.updateStatus(TENANT_A, 't1', { status: 'success' });
    expect(updated!.images).toEqual(buildGeneratedImages());
  });

  it('跨租户更新 → 返回 null(不更新)', async () => {
    prismaMock.__insertGenerationTask({ id: 't1', tenantId: TENANT_A, userId: USER_A1, status: 'processing' });

    const updated = await generationRepository.updateStatus(TENANT_B, 't1', { status: 'success' });
    expect(updated).toBeNull();

    // 原任务状态未被篡改
    const stored = prismaMock.generationTaskStore.get('t1');
    expect(stored!.status).toBe('processing');
  });

  it('任务不存在 → 返回 null', async () => {
    const updated = await generationRepository.updateStatus(TENANT_A, 'not-exist', { status: 'success' });
    expect(updated).toBeNull();
  });
});

// ============================================================
// list
// ============================================================

describe('GenerationRepository.list(分页查询)', () => {
  beforeEach(() => prismaMock.__clear());

  it('按 (tenantId, createdAt) 倒序分页返回,且强制租户隔离', async () => {
    // 租户 A 两条 + 租户 B 一条
    prismaMock.__insertGenerationTask({ id: 'a1', tenantId: TENANT_A, userId: USER_A1, createdAt: new Date('2026-08-01T00:00:00Z') });
    prismaMock.__insertGenerationTask({ id: 'a2', tenantId: TENANT_A, userId: USER_A1, createdAt: new Date('2026-08-02T00:00:00Z') });
    prismaMock.__insertGenerationTask({ id: 'b1', tenantId: TENANT_B, userId: USER_B1, createdAt: new Date('2026-08-03T00:00:00Z') });

    const { items, total } = await generationRepository.list(TENANT_A, { page: 1, pageSize: 10 });

    expect(total).toBe(2); // 仅租户 A 的 2 条,租户 B 数据不串入
    expect(items.map((i) => i.id)).toEqual(['a2', 'a1']); // 倒序
    expect(items.every((i) => i.tenantId === TENANT_A)).toBe(true);
  });

  it('userId 筛选:仅返回指定用户的记录', async () => {
    prismaMock.__insertGenerationTask({ id: 'a1', tenantId: TENANT_A, userId: USER_A1 });
    prismaMock.__insertGenerationTask({ id: 'a2', tenantId: TENANT_A, userId: USER_A2 });

    const { items, total } = await generationRepository.list(TENANT_A, { page: 1, pageSize: 10, userId: USER_A1 });
    expect(total).toBe(1);
    expect(items[0].id).toBe('a1');
  });

  it('status 筛选:仅返回指定状态的记录', async () => {
    prismaMock.__insertGenerationTask({ id: 'a1', tenantId: TENANT_A, userId: USER_A1, status: 'success' });
    prismaMock.__insertGenerationTask({ id: 'a2', tenantId: TENANT_A, userId: USER_A1, status: 'failed' });

    const { items, total } = await generationRepository.list(TENANT_A, { page: 1, pageSize: 10, status: 'success' as GenerationTask['status'] });
    expect(total).toBe(1);
    expect(items[0].id).toBe('a1');
  });

  it('分页:page/pageSize 正确截断', async () => {
    for (let i = 1; i <= 5; i += 1) {
      prismaMock.__insertGenerationTask({ id: `a${i}`, tenantId: TENANT_A, userId: USER_A1 });
    }

    const page1 = await generationRepository.list(TENANT_A, { page: 1, pageSize: 2 });
    expect(page1.items.length).toBe(2);
    expect(page1.total).toBe(5);

    const page3 = await generationRepository.list(TENANT_A, { page: 3, pageSize: 2 });
    expect(page3.items.length).toBe(1); // 第 5 条
    expect(page3.total).toBe(5);
  });
});

// ============================================================
// countMonthlyGenerateUsage
// ============================================================

describe('GenerationRepository.countMonthlyGenerateUsage(月度用量)', () => {
  beforeEach(() => prismaMock.__clear());

  it('统计当月非 failed 任务,跨租户隔离', async () => {
    // 租户 A:当月 3 条(success/processing/pending),failed 1 条
    prismaMock.__insertGenerationTask({
      id: 'a1', tenantId: TENANT_A, userId: USER_A1, status: 'success',
      createdAt: new Date('2026-08-05T00:00:00Z'),
    });
    prismaMock.__insertGenerationTask({
      id: 'a2', tenantId: TENANT_A, userId: USER_A1, status: 'failed',
      createdAt: new Date('2026-08-06T00:00:00Z'),
    });
    prismaMock.__insertGenerationTask({
      id: 'a3', tenantId: TENANT_A, userId: USER_A1, status: 'processing',
      createdAt: new Date('2026-08-07T00:00:00Z'),
    });
    prismaMock.__insertGenerationTask({
      id: 'a4', tenantId: TENANT_A, userId: USER_A1, status: 'pending',
      createdAt: new Date('2026-08-07T12:00:00Z'),
    });
    // 租户 B:当月 1 条(不应计入 A)
    prismaMock.__insertGenerationTask({
      id: 'b1', tenantId: TENANT_B, userId: USER_B1, status: 'success',
      createdAt: new Date('2026-08-07T00:00:00Z'),
    });

    const count = await generationRepository.countMonthlyGenerateUsage(TENANT_A, 2026, 8);
    expect(count).toBe(3); // success + processing + pending,failed 不计
  });

  it('按月边界统计:仅计当月,不计上月/次月', async () => {
    prismaMock.__insertGenerationTask({
      id: 'a1', tenantId: TENANT_A, userId: USER_A1, status: 'success',
      createdAt: new Date('2026-07-31T23:59:59Z'),
    });
    prismaMock.__insertGenerationTask({
      id: 'a2', tenantId: TENANT_A, userId: USER_A1, status: 'success',
      createdAt: new Date('2026-08-01T00:00:00Z'),
    });
    prismaMock.__insertGenerationTask({
      id: 'a3', tenantId: TENANT_A, userId: USER_A1, status: 'success',
      createdAt: new Date('2026-08-31T23:59:59Z'),
    });
    prismaMock.__insertGenerationTask({
      id: 'a4', tenantId: TENANT_A, userId: USER_A1, status: 'success',
      createdAt: new Date('2026-09-01T00:00:00Z'),
    });

    const count = await generationRepository.countMonthlyGenerateUsage(TENANT_A, 2026, 8);
    expect(count).toBe(2); // a2 + a3,边界精确
  });

  it('无记录 → 返回 0', async () => {
    const count = await generationRepository.countMonthlyGenerateUsage(TENANT_A, 2026, 8);
    expect(count).toBe(0);
  });
});