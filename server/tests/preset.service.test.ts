// ============================================================
// PresetService 评分预设服务单元测试(Phase 5)
// 对应源码: src/services/preset.service.ts
// 对应文档: new-features-design.md §1.5, §2.2, §3.1
//
// 测试范围:
//   1. listPresets:可见预设列表映射
//   2. getPreset:404 / 已禁用 / 成功
//   3. createPreset:维度校验(空/缺字段/权重越界/key 重复/权重和≠100)+ 成功
//   4. forkPreset:源不存在 / 覆盖维度 / 复制源维度
//   5. updatePreset:built-in 不可改 / 跨租户拒绝 / 非创建者拒绝 / 成功
//   6. deletePreset:built-in 不可删 / 成功
//   7. applyPreset:分析不存在 / 结果不可用 / 预设不存在 / 维度不匹配 / 成功(加权重算)
//   8. listAllPresets / overridePreset(管理后台)
//
// Mock 策略:
//   - vi.mock 替换 presetRepository / analysisRepository 模块(纯单元测试)
//   - 不依赖 prisma.mock 的 Phase 5 模型(隔离稳定)
//   - 与 arbitration.service.test.ts 同属纯函数/纯服务单元测试风格
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { presetService } from '../src/services/preset.service.js';
import { BusinessError } from '../src/middlewares/error-handler.js';
import { ErrorCode } from '../src/types/api-contract.js';
import type { EvaluationPreset } from '@prisma/client';

// ============================================================
// vi.mock:替换 Repository 模块(工厂惰性执行,导出可控 mock 函数)
// 使用 vi.hoisted 保证 mock 引用在 vi.mock 工厂执行前已初始化
// (vi.mock 会被提升到文件顶部,普通 const 此时还未初始化)
// ============================================================

const { mockPresetRepo, mockAnalysisRepo } = vi.hoisted(() => ({
  mockPresetRepo: {
    listVisible: vi.fn(),
    listAll: vi.fn(),
    findById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  mockAnalysisRepo: {
    findById: vi.fn(),
  },
}));

vi.mock('../src/repositories/preset.repository.js', () => ({
  PresetRepository: class {},
  presetRepository: mockPresetRepo,
}));

vi.mock('../src/repositories/analysis.repository.js', () => ({
  AnalysisRepository: class {},
  analysisRepository: mockAnalysisRepo,
}));

// ============================================================
// 测试常量与工厂
// ============================================================

const TENANT_A = 't-preset-a';
const USER_TEACHER = 'u-teacher-preset';

/** 构造内置预设(built-in,全局) */
function makeBuiltInPreset(overrides: Partial<EvaluationPreset> = {}): EvaluationPreset {
  return {
    id: 'preset-builtin-0001',
    name: '央美基础绘画预设',
    description: '央美基础部评分标准',
    styleType: 'academic',
    artType: 'painting',
    dimensions: [
      { key: 'composition', label: '构图', labelEn: 'Composition', weight: 40 },
      { key: 'color', label: '色彩', labelEn: 'Color', weight: 35 },
      { key: 'brushwork', label: '笔触技法', labelEn: 'Brushwork', weight: 25 },
    ],
    applicableStage: 'foundation',
    isBuiltIn: true,
    isPrivate: false,
    forkedFromId: null,
    creatorId: null,
    tenantId: null,
    enabled: true,
    sortOrder: 1,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  } as EvaluationPreset;
}

/** 构造用户预设(非 built-in,归属租户) */
function makeUserPreset(overrides: Partial<EvaluationPreset> = {}): EvaluationPreset {
  return makeBuiltInPreset({
    id: 'preset-user-0001',
    name: '我的自定义预设',
    styleType: 'custom',
    isBuiltIn: false,
    isPrivate: false,
    creatorId: USER_TEACHER,
    tenantId: TENANT_A,
    sortOrder: 10,
    ...overrides,
  });
}

/** 标准绘画维度(权重和=100) */
const VALID_DIMENSIONS = [
  { key: 'composition', label: '构图', labelEn: 'Composition', weight: 50 },
  { key: 'color', label: '色彩', labelEn: 'Color', weight: 50 },
];

// ============================================================
// 辅助:断言 BusinessError
// ============================================================

async function expectBusinessError(
  fn: () => Promise<unknown>,
  code: ErrorCode,
  httpStatus: number,
): Promise<void> {
  try {
    await fn();
    expect.fail(`expected BusinessError(code=${code}) but no error was thrown`);
  } catch (err) {
    expect(err).toBeInstanceOf(BusinessError);
    expect((err as BusinessError).code).toBe(code);
    expect((err as BusinessError).httpStatus).toBe(httpStatus);
  }
}

// ============================================================
// 测试组
// ============================================================

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PresetService.listPresets', () => {
  it('返回可见预设的 Summary 列表(内置 + 用户预设)', async () => {
    const builtIn = makeBuiltInPreset();
    const userPreset = makeUserPreset();
    mockPresetRepo.listVisible.mockResolvedValue([builtIn, userPreset]);

    const result = await presetService.listPresets(TENANT_A, USER_TEACHER);

    expect(mockPresetRepo.listVisible).toHaveBeenCalledWith(TENANT_A, USER_TEACHER);
    expect(result).toHaveLength(2);
    expect(result[0]!.id).toBe('preset-builtin-0001');
    expect(result[0]!.isBuiltIn).toBe(true);
    expect(result[0]).not.toHaveProperty('dimensions'); // Summary 不含 dimensions
    expect(result[1]!.creatorId).toBe(USER_TEACHER);
  });

  it('无可见预设时返回空数组', async () => {
    mockPresetRepo.listVisible.mockResolvedValue([]);
    const result = await presetService.listPresets(TENANT_A, USER_TEACHER);
    expect(result).toEqual([]);
  });
});

describe('PresetService.getPreset', () => {
  it('预设不存在 → PHASE5_PRESET_NOT_FOUND 404', async () => {
    mockPresetRepo.findById.mockResolvedValue(null);
    await expectBusinessError(
      () => presetService.getPreset('non-existent'),
      ErrorCode.PHASE5_PRESET_NOT_FOUND,
      404,
    );
  });

  it('预设已禁用 → PHASE5_PRESET_NOT_FOUND 404', async () => {
    mockPresetRepo.findById.mockResolvedValue(makeBuiltInPreset({ enabled: false }));
    await expectBusinessError(
      () => presetService.getPreset('preset-builtin-0001'),
      ErrorCode.PHASE5_PRESET_NOT_FOUND,
      404,
    );
  });

  it('成功返回预设详情(含 dimensions)', async () => {
    const preset = makeBuiltInPreset();
    mockPresetRepo.findById.mockResolvedValue(preset);

    const result = await presetService.getPreset('preset-builtin-0001');

    expect(result.id).toBe('preset-builtin-0001');
    expect(result.dimensions).toHaveLength(3);
    expect(result.dimensions[0]!.key).toBe('composition');
    expect(result.rationale).toBeNull();
    expect(typeof result.createdAt).toBe('string');
  });
});

describe('PresetService.createPreset', () => {
  it('维度列表为空 → PARAM_INVALID 400', async () => {
    await expectBusinessError(
      () =>
        presetService.createPreset(TENANT_A, USER_TEACHER, {
          name: '空预设',
          styleType: 'custom',
          artType: 'painting',
          dimensions: [],
          applicableStage: 'basic',
        }),
      ErrorCode.PARAM_INVALID,
      400,
    );
    expect(mockPresetRepo.create).not.toHaveBeenCalled();
  });

  it('维度缺少必填字段(label) → PARAM_INVALID 400', async () => {
    await expectBusinessError(
      () =>
        presetService.createPreset(TENANT_A, USER_TEACHER, {
          name: '缺字段',
          styleType: 'custom',
          artType: 'painting',
          dimensions: [{ key: 'composition', label: '', labelEn: 'Composition', weight: 100 }],
          applicableStage: 'basic',
        }),
      ErrorCode.PARAM_INVALID,
      400,
    );
  });

  it('维度权重越界(>100) → PARAM_INVALID 400', async () => {
    await expectBusinessError(
      () =>
        presetService.createPreset(TENANT_A, USER_TEACHER, {
          name: '权重越界',
          styleType: 'custom',
          artType: 'painting',
          dimensions: [{ key: 'composition', label: '构图', labelEn: 'Composition', weight: 150 }],
          applicableStage: 'basic',
        }),
      ErrorCode.PARAM_INVALID,
      400,
    );
  });

  it('维度 key 重复 → PARAM_INVALID 400', async () => {
    await expectBusinessError(
      () =>
        presetService.createPreset(TENANT_A, USER_TEACHER, {
          name: 'key 重复',
          styleType: 'custom',
          artType: 'painting',
          dimensions: [
            { key: 'composition', label: '构图', labelEn: 'Composition', weight: 50 },
            { key: 'composition', label: '构图2', labelEn: 'Composition2', weight: 50 },
          ],
          applicableStage: 'basic',
        }),
      ErrorCode.PARAM_INVALID,
      400,
    );
  });

  it('权重总和≠100 → PHASE5_PRESET_DIMENSION_MISMATCH 400', async () => {
    await expectBusinessError(
      () =>
        presetService.createPreset(TENANT_A, USER_TEACHER, {
          name: '权重不等100',
          styleType: 'custom',
          artType: 'painting',
          dimensions: [
            { key: 'composition', label: '构图', labelEn: 'Composition', weight: 40 },
            { key: 'color', label: '色彩', labelEn: 'Color', weight: 50 },
          ],
          applicableStage: 'basic',
        }),
      ErrorCode.PHASE5_PRESET_DIMENSION_MISMATCH,
      400,
    );
  });

  it('成功创建用户预设(isBuiltIn=false,creatorId=userId)', async () => {
    const created = makeUserPreset();
    mockPresetRepo.create.mockResolvedValue(created);

    const result = await presetService.createPreset(TENANT_A, USER_TEACHER, {
      name: '我的自定义预设',
      styleType: 'custom',
      artType: 'painting',
      dimensions: VALID_DIMENSIONS,
      applicableStage: 'foundation',
      isPrivate: false,
    });

    expect(mockPresetRepo.create).toHaveBeenCalledTimes(1);
    const callArg = mockPresetRepo.create.mock.calls[0]![0];
    expect(callArg.isBuiltIn).toBe(false);
    expect(callArg.creatorId).toBe(USER_TEACHER);
    expect(callArg.tenantId).toBe(TENANT_A);
    expect(callArg.forkedFromId).toBeNull();
    expect(result.id).toBe('preset-user-0001');
    expect(result.isBuiltIn).toBe(false);
  });

  it('权重和=100(浮点容忍 0.01)创建成功', async () => {
    const created = makeUserPreset();
    mockPresetRepo.create.mockResolvedValue(created);

    await presetService.createPreset(TENANT_A, USER_TEACHER, {
      name: '浮点权重',
      styleType: 'custom',
      artType: 'painting',
      dimensions: [
        { key: 'composition', label: '构图', labelEn: 'Composition', weight: 33.33 },
        { key: 'color', label: '色彩', labelEn: 'Color', weight: 33.33 },
        { key: 'brushwork', label: '笔触', labelEn: 'Brushwork', weight: 33.34 },
      ],
      applicableStage: 'foundation',
    });

    expect(mockPresetRepo.create).toHaveBeenCalledTimes(1);
  });
});

describe('PresetService.forkPreset', () => {
  it('源预设不存在 → PHASE5_PRESET_NOT_FOUND 404', async () => {
    mockPresetRepo.findById.mockResolvedValue(null);
    await expectBusinessError(
      () =>
        presetService.forkPreset(TENANT_A, USER_TEACHER, 'non-existent', {
          name: '派生预设',
        }),
      ErrorCode.PHASE5_PRESET_NOT_FOUND,
      404,
    );
  });

  it('成功 fork:不传 dimensions 时复制源预设维度', async () => {
    const source = makeBuiltInPreset();
    mockPresetRepo.findById.mockResolvedValue(source);
    const forked = makeUserPreset({ forkedFromId: 'preset-builtin-0001' });
    mockPresetRepo.create.mockResolvedValue(forked);

    const result = await presetService.forkPreset(TENANT_A, USER_TEACHER, 'preset-builtin-0001', {
      name: '派生自央美预设',
    });

    expect(mockPresetRepo.create).toHaveBeenCalledTimes(1);
    const callArg = mockPresetRepo.create.mock.calls[0]![0];
    expect(callArg.forkedFromId).toBe('preset-builtin-0001');
    expect(callArg.styleType).toBe('academic'); // 继承源预设风格
    expect(callArg.applicableStage).toBe('foundation');
    expect(result.forkedFromId).toBe('preset-builtin-0001');
  });

  it('成功 fork:传入 dimensions 时覆盖源预设维度', async () => {
    const source = makeBuiltInPreset();
    mockPresetRepo.findById.mockResolvedValue(source);
    const forked = makeUserPreset({ forkedFromId: 'preset-builtin-0001' });
    mockPresetRepo.create.mockResolvedValue(forked);

    await presetService.forkPreset(TENANT_A, USER_TEACHER, 'preset-builtin-0001', {
      name: '覆盖维度',
      dimensions: VALID_DIMENSIONS,
    });

    const callArg = mockPresetRepo.create.mock.calls[0]![0];
    // 覆盖维度应为传入的 VALID_DIMENSIONS(2 项),非源预设的 3 项
    expect(callArg.dimensions).toEqual(VALID_DIMENSIONS);
  });

  it('fork 时覆盖维度权重和≠100 → PHASE5_PRESET_DIMENSION_MISMATCH', async () => {
    const source = makeBuiltInPreset();
    mockPresetRepo.findById.mockResolvedValue(source);

    await expectBusinessError(
      () =>
        presetService.forkPreset(TENANT_A, USER_TEACHER, 'preset-builtin-0001', {
          name: '错误权重',
          dimensions: [
            { key: 'composition', label: '构图', labelEn: 'Composition', weight: 30 },
            { key: 'color', label: '色彩', labelEn: 'Color', weight: 30 },
          ],
        }),
      ErrorCode.PHASE5_PRESET_DIMENSION_MISMATCH,
      400,
    );
  });
});

describe('PresetService.updatePreset', () => {
  it('内置预设不可修改 → PHASE5_PRESET_BUILTIN_IMMUTABLE 403', async () => {
    mockPresetRepo.findById.mockResolvedValue(makeBuiltInPreset());

    await expectBusinessError(
      () =>
        presetService.updatePreset(TENANT_A, USER_TEACHER, 'preset-builtin-0001', {
          name: '修改内置',
        }),
      ErrorCode.PHASE5_PRESET_BUILTIN_IMMUTABLE,
      403,
    );
    expect(mockPresetRepo.update).not.toHaveBeenCalled();
  });

  it('跨租户预设拒绝修改 → TENANT_MISMATCH 403', async () => {
    mockPresetRepo.findById.mockResolvedValue(
      makeUserPreset({ tenantId: 't-other-tenant', creatorId: USER_TEACHER }),
    );

    await expectBusinessError(
      () =>
        presetService.updatePreset(TENANT_A, USER_TEACHER, 'preset-user-0001', {
          name: '跨租户修改',
        }),
      ErrorCode.TENANT_MISMATCH,
      403,
    );
  });

  it('非创建者拒绝修改 → FORBIDDEN 403', async () => {
    mockPresetRepo.findById.mockResolvedValue(
      makeUserPreset({ tenantId: TENANT_A, creatorId: 'u-other-teacher' }),
    );

    await expectBusinessError(
      () =>
        presetService.updatePreset(TENANT_A, USER_TEACHER, 'preset-user-0001', {
          name: '非创建者修改',
        }),
      ErrorCode.FORBIDDEN,
      403,
    );
  });

  it('预设不存在 → PHASE5_PRESET_NOT_FOUND 404', async () => {
    mockPresetRepo.findById.mockResolvedValue(null);

    await expectBusinessError(
      () =>
        presetService.updatePreset(TENANT_A, USER_TEACHER, 'non-existent', {
          name: '不存在',
        }),
      ErrorCode.PHASE5_PRESET_NOT_FOUND,
      404,
    );
  });

  it('成功更新预设(仅传 name)', async () => {
    mockPresetRepo.findById.mockResolvedValue(makeUserPreset());
    const updated = makeUserPreset({ name: '新名称' });
    mockPresetRepo.update.mockResolvedValue(updated);

    const result = await presetService.updatePreset(TENANT_A, USER_TEACHER, 'preset-user-0001', {
      name: '新名称',
    });

    expect(mockPresetRepo.update).toHaveBeenCalledWith('preset-user-0001', { name: '新名称' });
    expect(result.name).toBe('新名称');
  });

  it('更新维度时校验权重和=100', async () => {
    mockPresetRepo.findById.mockResolvedValue(makeUserPreset());

    await expectBusinessError(
      () =>
        presetService.updatePreset(TENANT_A, USER_TEACHER, 'preset-user-0001', {
          dimensions: [
            { key: 'composition', label: '构图', labelEn: 'Composition', weight: 30 },
            { key: 'color', label: '色彩', labelEn: 'Color', weight: 30 },
          ],
        }),
      ErrorCode.PHASE5_PRESET_DIMENSION_MISMATCH,
      400,
    );
  });
});

describe('PresetService.deletePreset', () => {
  it('内置预设不可删除 → PHASE5_PRESET_BUILTIN_IMMUTABLE 403', async () => {
    mockPresetRepo.findById.mockResolvedValue(makeBuiltInPreset());

    await expectBusinessError(
      () => presetService.deletePreset(TENANT_A, USER_TEACHER, 'preset-builtin-0001'),
      ErrorCode.PHASE5_PRESET_BUILTIN_IMMUTABLE,
      403,
    );
    expect(mockPresetRepo.delete).not.toHaveBeenCalled();
  });

  it('成功删除用户预设', async () => {
    mockPresetRepo.findById.mockResolvedValue(makeUserPreset());
    mockPresetRepo.delete.mockResolvedValue(undefined);

    await presetService.deletePreset(TENANT_A, USER_TEACHER, 'preset-user-0001');

    expect(mockPresetRepo.delete).toHaveBeenCalledWith('preset-user-0001');
  });
});

describe('PresetService.applyPreset', () => {
  it('分析任务不存在 → ANALYSIS_NOT_FOUND 404', async () => {
    mockAnalysisRepo.findById.mockResolvedValue(null);

    await expectBusinessError(
      () =>
        presetService.applyPreset(TENANT_A, {
          analysisId: 'a-non-existent',
          presetId: 'preset-builtin-0001',
        }),
      ErrorCode.ANALYSIS_NOT_FOUND,
      404,
    );
  });

  it('分析结果不可用(status≠success) → ANALYSIS_RESULT_FAILED 400', async () => {
    mockAnalysisRepo.findById.mockResolvedValue({
      id: 'a-0001',
      tenantId: TENANT_A,
      status: 'failed',
      result: null,
    });

    await expectBusinessError(
      () =>
        presetService.applyPreset(TENANT_A, {
          analysisId: 'a-0001',
          presetId: 'preset-builtin-0001',
        }),
      ErrorCode.ANALYSIS_RESULT_FAILED,
      400,
    );
  });

  it('分析结果缺少 dimensions 字段 → PHASE5_PRESET_DIMENSION_MISMATCH 400', async () => {
    mockAnalysisRepo.findById.mockResolvedValue({
      id: 'a-0001',
      tenantId: TENANT_A,
      status: 'success',
      result: { overallScore: 80 }, // 无 dimensions
    });
    mockPresetRepo.findById.mockResolvedValue(makeBuiltInPreset());

    await expectBusinessError(
      () =>
        presetService.applyPreset(TENANT_A, {
          analysisId: 'a-0001',
          presetId: 'preset-builtin-0001',
        }),
      ErrorCode.PHASE5_PRESET_DIMENSION_MISMATCH,
      400,
    );
  });

  it('预设不存在 → PHASE5_PRESET_NOT_FOUND 404', async () => {
    mockAnalysisRepo.findById.mockResolvedValue({
      id: 'a-0001',
      tenantId: TENANT_A,
      status: 'success',
      result: { dimensions: { composition: { score: 80 } } },
    });
    mockPresetRepo.findById.mockResolvedValue(null);

    await expectBusinessError(
      () =>
        presetService.applyPreset(TENANT_A, {
          analysisId: 'a-0001',
          presetId: 'non-existent',
        }),
      ErrorCode.PHASE5_PRESET_NOT_FOUND,
      404,
    );
  });

  it('预设维度在分析结果中不存在 → PHASE5_PRESET_DIMENSION_MISMATCH 400', async () => {
    mockAnalysisRepo.findById.mockResolvedValue({
      id: 'a-0001',
      tenantId: TENANT_A,
      status: 'success',
      result: {
        dimensions: {
          composition: { score: 80 },
          // 缺 color / brushwork
        },
      },
    });
    mockPresetRepo.findById.mockResolvedValue(makeBuiltInPreset()); // 3 维度

    await expectBusinessError(
      () =>
        presetService.applyPreset(TENANT_A, {
          analysisId: 'a-0001',
          presetId: 'preset-builtin-0001',
        }),
      ErrorCode.PHASE5_PRESET_DIMENSION_MISMATCH,
      400,
    );
  });

  it('成功应用预设:按权重重算加权总分', async () => {
    // 预设:composition 40 / color 35 / brushwork 25
    mockPresetRepo.findById.mockResolvedValue(makeBuiltInPreset());
    // 分析结果:composition=80, color=90, brushwork=60
    mockAnalysisRepo.findById.mockResolvedValue({
      id: 'a-0001',
      tenantId: TENANT_A,
      status: 'success',
      result: {
        dimensions: {
          composition: { score: 80 },
          color: { score: 90 },
          brushwork: { score: 60 },
        },
      },
    });

    const result = await presetService.applyPreset(TENANT_A, {
      analysisId: 'a-0001',
      presetId: 'preset-builtin-0001',
    });

    // 加权:80*0.4 + 90*0.35 + 60*0.25 = 32 + 31.5 + 15 = 78.5
    expect(result.weightedScore).toBe(78.5);
    expect(result.weightedDimensions).toHaveLength(3);
    expect(result.weightedDimensions[0]!.key).toBe('composition');
    expect(result.weightedDimensions[0]!.originalScore).toBe(80);
    expect(result.weightedDimensions[0]!.weight).toBe(40);
    expect(result.weightedDimensions[0]!.weightedContribution).toBe(32);
    expect(result.appliedPreset.id).toBe('preset-builtin-0001');
  });
});

describe('PresetService.listAllPresets (admin)', () => {
  it('返回所有预设的 Detail 列表', async () => {
    const presets = [makeBuiltInPreset(), makeUserPreset()];
    mockPresetRepo.listAll.mockResolvedValue(presets);

    const result = await presetService.listAllPresets();

    expect(mockPresetRepo.listAll).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(2);
    expect(result[0]!.dimensions).toHaveLength(3); // Detail 含 dimensions
  });
});

describe('PresetService.overridePreset (admin)', () => {
  it('源预设不存在 → PHASE5_PRESET_NOT_FOUND 404', async () => {
    mockPresetRepo.findById.mockResolvedValue(null);

    await expectBusinessError(
      () =>
        presetService.overridePreset(TENANT_A, USER_TEACHER, 'non-existent', {
          name: '覆盖预设',
          dimensions: VALID_DIMENSIONS,
        }),
      ErrorCode.PHASE5_PRESET_NOT_FOUND,
      404,
    );
  });

  it('成功从内置预设派生覆盖预设', async () => {
    const source = makeBuiltInPreset();
    mockPresetRepo.findById.mockResolvedValue(source);
    const overridden = makeUserPreset({ forkedFromId: 'preset-builtin-0001', name: '覆盖预设' });
    mockPresetRepo.create.mockResolvedValue(overridden);

    const result = await presetService.overridePreset(
      TENANT_A,
      USER_TEACHER,
      'preset-builtin-0001',
      {
        name: '覆盖预设',
        description: '自定义描述',
        dimensions: VALID_DIMENSIONS,
        isPrivate: true,
      },
    );

    const callArg = mockPresetRepo.create.mock.calls[0]![0];
    expect(callArg.forkedFromId).toBe('preset-builtin-0001');
    expect(callArg.isBuiltIn).toBe(false);
    expect(callArg.isPrivate).toBe(true);
    expect(callArg.styleType).toBe('academic'); // 继承源预设风格
    expect(result.forkedFromId).toBe('preset-builtin-0001');
  });

  it('覆盖维度权重和≠100 → PHASE5_PRESET_DIMENSION_MISMATCH', async () => {
    mockPresetRepo.findById.mockResolvedValue(makeBuiltInPreset());

    await expectBusinessError(
      () =>
        presetService.overridePreset(TENANT_A, USER_TEACHER, 'preset-builtin-0001', {
          name: '错误权重',
          dimensions: [
            { key: 'composition', label: '构图', labelEn: 'Composition', weight: 40 },
          ],
        }),
      ErrorCode.PHASE5_PRESET_DIMENSION_MISMATCH,
      400,
    );
  });
});
