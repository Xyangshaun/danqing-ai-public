// ============================================================
// AnalysisRepository 深度字段持久化测试(阶段 G,Task 21.3)
// 对应源码: src/repositories/analysis.repository.ts
//   - create:写入 evaluationStage / heritageCategory(用户选择,创建时持久化)
//   - updateResult:写入 evaluationStage / scoreCriteria / issueMarkers(AI 增强后)
//   - findById:getAnalysis 完整返回深度分析字段
//
// 测试范围:
//   21.3a create 写入 evaluationStage / heritageCategory
//   21.3b create 缺省时 evaluationStage / heritageCategory 为 null
//   21.3c updateResult 写入 evaluationStage / scoreCriteria / issueMarkers
//   21.3d updateResult JSON 字段 null 归一化(DbNull → null)
//   21.3e findById 完整返回深度字段
//   21.3f updateResult 跨租户返回 null(归属校验)
//   21.3g updateResult 不传深度字段时不清空已有值(undefined 跳过)
//
// Mock 策略:
//   - setup.ts 全局 mock prisma(内存 Map 存储)
//   - 直接测试 AnalysisRepository 真实实现,通过 prismaMock.__insert* 预置数据
//   - 注意:MockAnalysis 接口未声明新字段,但 mock create/update 会原样存储 data 中的字段
//     (normalizeDataNulls 仅跳过 undefined,其余字段原样写入),故运行时字段存在
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { prismaMock } from './setup.js';
import { analysisRepository } from '../src/repositories/analysis.repository.js';

const TENANT_A = 't-repo-a';
const TENANT_B = 't-repo-b';
const USER_A = 'u-repo-a';

beforeEach(() => {
  // setup.ts 全局 beforeEach 已清空 mock;此处仅预置共享租户/用户
  prismaMock.__insertTenant({ id: TENANT_A, name: '学院A' });
  prismaMock.__insertTenant({ id: TENANT_B, name: '学院B' });
  prismaMock.__insertUser({
    id: USER_A,
    tenantId: TENANT_A,
    feishuUnionId: 'on-repo-a',
    name: '学生A',
  });
});

/** 构造 create 入参 */
function buildCreateInput(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: TENANT_A,
    userId: USER_A,
    workType: 'painting' as const,
    imageUrl: 'https://example.com/work.jpg',
    title: '静物练习',
    remark: '冷暖对比',
    ...overrides,
  };
}

describe('AnalysisRepository 深度字段持久化 (Task 21.3)', () => {
  describe('create 写入深度字段', () => {
    it('should_persist_evaluationStage_and_heritageCategory_on_create', async () => {
      const created = await analysisRepository.create(
        buildCreateInput({
          evaluationStage: 'master',
          heritageCategory: 'papercut',
        }),
      );

      expect(created.evaluationStage).toBe('master');
      expect(created.heritageCategory).toBe('papercut');
      // 底层 store 同样存储
      const stored = prismaMock.analysisStore.get(created.id);
      expect(stored).toBeDefined();
      expect((stored as Record<string, unknown>).evaluationStage).toBe('master');
      expect((stored as Record<string, unknown>).heritageCategory).toBe('papercut');
    });

    it('should_default_evaluationStage_and_heritageCategory_to_null_when_not_provided', async () => {
      // 旧流程/普通作品不传深度字段 → 缺省 null(对齐 schema 可空列)
      const created = await analysisRepository.create(buildCreateInput());

      expect(created.evaluationStage).toBeNull();
      expect(created.heritageCategory).toBeNull();
    });

    it('should_default_diagnosisMode_to_teaching_when_not_provided', async () => {
      const created = await analysisRepository.create(buildCreateInput());
      expect(created.diagnosisMode).toBe('teaching');
    });

    it('should_set_status_pending_on_create', async () => {
      const created = await analysisRepository.create(buildCreateInput());
      expect(created.status).toBe('pending');
    });
  });

  describe('updateResult 写入深度字段', () => {
    it('should_persist_evaluationStage_scoreCriteria_issueMarkers_on_update', async () => {
      const created = await analysisRepository.create(buildCreateInput());
      const scoreCriteria = [{ dimension: '构图', weight: 0.5, level: 'good' }];
      const issueMarkers = [{ x: 0.1, y: 0.2, w: 0.3, h: 0.4, label: 'L', severity: 'high' }];

      const updated = await analysisRepository.updateResult(TENANT_A, created.id, {
        status: 'success',
        overallScore: 82,
        evaluationStage: 'academy',
        scoreCriteria,
        issueMarkers,
        result: { overallScore: 82 },
        completedAt: new Date(),
      });

      expect(updated).not.toBeNull();
      expect(updated!.evaluationStage).toBe('academy');
      // JSON 字段以对象形式持久化(mock 原样存储 InputJsonValue)
      expect(updated!.scoreCriteria).toEqual(scoreCriteria);
      expect(updated!.issueMarkers).toEqual(issueMarkers);
    });

    it('should_normalize_json_null_to_null_on_update', async () => {
      // Prisma JSON 字段:null 需通过 DbNull 表达;mock 归一化为 null
      const created = await analysisRepository.create(buildCreateInput());
      // 先写入有值
      await analysisRepository.updateResult(TENANT_A, created.id, {
        scoreCriteria: [{ dimension: 'x', weight: 1 }],
        issueMarkers: [{ x: 0, y: 0, w: 0.1, h: 0.1, label: 'L', severity: 'low' }],
      });
      // 再置空(null → DbNull → mock 归一化为 null)
      const updated = await analysisRepository.updateResult(TENANT_A, created.id, {
        scoreCriteria: null,
        issueMarkers: null,
      });

      expect(updated).not.toBeNull();
      expect(updated!.scoreCriteria).toBeNull();
      expect(updated!.issueMarkers).toBeNull();
    });

    it('should_skip_deep_fields_when_undefined_on_update', async () => {
      // undefined 字段不清空已有值(对齐 Prisma 语义:未提供 = 不更新)
      const created = await analysisRepository.create(
        buildCreateInput({ evaluationStage: 'unified' }),
      );
      // update 不传 evaluationStage → 保留 unified
      const updated = await analysisRepository.updateResult(TENANT_A, created.id, {
        status: 'success',
        overallScore: 70,
      });

      expect(updated).not.toBeNull();
      expect(updated!.evaluationStage).toBe('unified');
    });

    it('should_return_null_when_record_not_in_tenant_cross_tenant_guard', async () => {
      const created = await analysisRepository.create(buildCreateInput());
      // 用租户 B 更新租户 A 的记录 → 归属校验失败,返回 null
      const updated = await analysisRepository.updateResult(TENANT_B, created.id, {
        status: 'success',
        overallScore: 90,
      });

      expect(updated).toBeNull();
      // 原记录未被修改
      const stored = prismaMock.analysisStore.get(created.id);
      expect((stored as Record<string, unknown>).status).toBe('pending');
    });

    it('should_update_evaluationStage_when_explicitly_null', async () => {
      // 显式传 null → 清空列(AI 未回显评价阶段时同步为 null)
      const created = await analysisRepository.create(
        buildCreateInput({ evaluationStage: 'master' }),
      );
      const updated = await analysisRepository.updateResult(TENANT_A, created.id, {
        evaluationStage: null,
      });

      expect(updated).not.toBeNull();
      expect(updated!.evaluationStage).toBeNull();
    });
  });

  describe('findById 完整返回深度字段', () => {
    it('should_return_complete_record_with_deep_fields', async () => {
      const created = await analysisRepository.create(
        buildCreateInput({ evaluationStage: 'academy', heritageCategory: 'porcelain' }),
      );
      await analysisRepository.updateResult(TENANT_A, created.id, {
        status: 'success',
        overallScore: 88,
        scoreCriteria: [{ dimension: '釉色', weight: 0.5, level: 'excellent' }],
        issueMarkers: [{ x: 0.5, y: 0.5, w: 0.2, h: 0.2, label: 'L', severity: 'medium' }],
      });

      const record = await analysisRepository.findById(TENANT_A, created.id);

      expect(record).not.toBeNull();
      expect(record!.id).toBe(created.id);
      expect(record!.evaluationStage).toBe('academy');
      expect(record!.heritageCategory).toBe('porcelain');
      expect(record!.scoreCriteria).toEqual([
        { dimension: '釉色', weight: 0.5, level: 'excellent' },
      ]);
      expect(record!.issueMarkers).toHaveLength(1);
      expect(record!.overallScore).toBe(88);
      expect(record!.status).toBe('success');
    });

    it('should_return_null_when_id_not_in_tenant', async () => {
      const created = await analysisRepository.create(buildCreateInput());
      // 跨租户查询 → null(不泄露存在性)
      const record = await analysisRepository.findById(TENANT_B, created.id);
      expect(record).toBeNull();
    });

    it('should_return_null_when_id_not_exists', async () => {
      const record = await analysisRepository.findById(TENANT_A, 'non-existent-id');
      expect(record).toBeNull();
    });
  });

  describe('旧数据无新字段时降级(Task 21.4 持久化层)', () => {
    it('should_return_null_deep_fields_for_legacy_record_without_new_columns', async () => {
      // 模拟迁移后的旧数据:新列存在但为 NULL(对齐 prisma migrate deploy 后旧行)
      // 注:mock __insertAnalysis 未声明新列,此处显式置 null 以忠实模拟迁移后旧行
      prismaMock.__insertAnalysis({
        id: 'legacy-rec-1',
        tenantId: TENANT_A,
        userId: USER_A,
        workType: 'painting',
        status: 'success',
        overallScore: 75,
        // 迁移后新列默认 NULL(模拟真实 DB 行为)
        ...({
          evaluationStage: null,
          heritageCategory: null,
          scoreCriteria: null,
          issueMarkers: null,
        } as Record<string, unknown>),
      } as Parameters<typeof prismaMock.__insertAnalysis>[0]);

      const record = await analysisRepository.findById(TENANT_A, 'legacy-rec-1');
      expect(record).not.toBeNull();
      // 旧数据新列为 NULL → 默认渲染逻辑:null(前端按"无深度分析"渲染)
      expect(record!.evaluationStage).toBeNull();
      expect(record!.heritageCategory).toBeNull();
      expect(record!.scoreCriteria).toBeNull();
      expect(record!.issueMarkers).toBeNull();
    });
  });
});
