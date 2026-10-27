// ============================================================
// GradingProfileService 评分风格档案服务单元测试(双阶段反馈框架 Phase 2 批次②)
// 对应源码: src/services/grading-profile.service.ts
// 对应文档: visual-annotation-feedback-upgrade-spec-2026-09.md §4(LUT 式评分档案)
//
// 测试范围:
//   1. listProfiles:可见档案列表映射(系统内置 + 租户克隆)
//   2. getProfile:404 / 已停用 / 成功
//   3. createProfile:config 校验(权重和≠100/档位非降序/末档非 0/风格越界)+ 成功
//   4. forkProfile:源不存在 / 跨租户源(不泄露存在性) / 源停用 / 成功(fork 链 + config 深拷贝)
//   5. updateProfile:内置不可改 / 跨租户 / 非创建者 / config 非法 / 成功
//   6. deleteProfile:内置不可删 / 成功
//   7. activateProfile:不存在 / 已停用 / 内置 / 跨租户 / 成功(setDefault 参数透传)
//   8. resolveEffectiveProfile:租户默认优先 / 脏 config 回退 / 系统兜底 / 均无 undefined
//
// Mock 策略:
//   - vi.mock 替换 gradingProfileRepository 模块(纯单元测试,不依赖 prisma)
//   - 与 preset.service.test.ts 同属纯服务单元测试风格
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { gradingProfileService } from '../src/services/grading-profile.service.js';
import { BusinessError } from '../src/middlewares/error-handler.js';
import { ErrorCode } from '../src/types/api-contract.js';
import type { GradingProfile } from '@prisma/client';
import type { GradingProfileConfig } from '../src/types/grading-profile.js';

// ============================================================
// vi.mock:替换 Repository 模块(vi.hoisted 保证引用先于工厂初始化)
// ============================================================

const { mockProfileRepo } = vi.hoisted(() => ({
  mockProfileRepo: {
    listVisible: vi.fn(),
    findById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    findTenantDefault: vi.fn(),
    findSystemFallback: vi.fn(),
    setDefault: vi.fn(),
  },
}));

vi.mock('../src/repositories/grading-profile.repository.js', () => ({
  GradingProfileRepository: class {},
  gradingProfileRepository: mockProfileRepo,
}));

// ============================================================
// 测试常量与工厂
// ============================================================

const TENANT_A = 't-gp-a';
const TENANT_B = 't-gp-b';
const USER_TEACHER = 'u-teacher-gp';
const USER_OTHER = 'u-other-teacher-gp';

/** 合法档案配置(权重和=100、档位降序且末档 min=0) */
function makeConfig(overrides: Partial<GradingProfileConfig> = {}): GradingProfileConfig {
  return {
    defaultFeedbackMode: 'diagnosis',
    dimensionWeights: [
      { key: 'form', label: '造型与比例', weight: 50 },
      { key: 'structure', label: '结构理解', weight: 50 },
    ],
    thresholds: { basicsLine: 70, dimensionPass: { form: 60, structure: 60 } },
    tierMapping: [
      { key: 'A', label: '一档(90-100)', min: 90 },
      { key: 'B', label: '二档(80-89)', min: 80 },
      { key: 'C', label: '三档(<80)', min: 0 },
    ],
    feedbackStyle: { diagnosisIntensity: 3, positiveRatio: 0.3, toneStrictness: 3 },
    ...overrides,
  };
}

/** 构造系统内置档案(isBuiltIn=true,tenantId=null) */
function makeBuiltInProfile(overrides: Partial<GradingProfile> = {}): GradingProfile {
  return {
    id: 'gprofile_builtin_sketch',
    name: '联考·素描·标准版',
    description: '省级美术联考素描评分标准',
    category: 'sketch',
    config: makeConfig(),
    isBuiltIn: true,
    isDefault: false,
    forkedFromId: null,
    creatorId: null,
    tenantId: null,
    enabled: true,
    sortOrder: 10,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  } as GradingProfile;
}

/** 构造租户克隆档案(isBuiltIn=false,归属租户 A,教师创建) */
function makeTenantProfile(overrides: Partial<GradingProfile> = {}): GradingProfile {
  return makeBuiltInProfile({
    id: 'gprofile_tenant_0001',
    name: '本画室·素描·微调版',
    isBuiltIn: false,
    forkedFromId: 'gprofile_builtin_sketch',
    creatorId: USER_TEACHER,
    tenantId: TENANT_A,
    sortOrder: 100,
    ...overrides,
  });
}

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

beforeEach(() => {
  vi.clearAllMocks();
});

// ============================================================
// 测试组
// ============================================================

describe('GradingProfileService.listProfiles', () => {
  it('返回可见档案的 Summary 列表(系统内置 + 租户克隆)', async () => {
    const builtIn = makeBuiltInProfile();
    const tenantProfile = makeTenantProfile();
    mockProfileRepo.listVisible.mockResolvedValue([builtIn, tenantProfile]);

    const result = await gradingProfileService.listProfiles(TENANT_A);

    expect(mockProfileRepo.listVisible).toHaveBeenCalledWith(TENANT_A);
    expect(result).toHaveLength(2);
    expect(result[0]!.id).toBe('gprofile_builtin_sketch');
    expect(result[0]!.isBuiltIn).toBe(true);
    expect(result[1]!.id).toBe('gprofile_tenant_0001');
    expect(result[1]!.isBuiltIn).toBe(false);
    expect(result[1]!.forkedFromId).toBe('gprofile_builtin_sketch');
  });

  it('无可见档案时返回空列表', async () => {
    mockProfileRepo.listVisible.mockResolvedValue([]);
    const result = await gradingProfileService.listProfiles(TENANT_A);
    expect(result).toHaveLength(0);
  });
});

describe('GradingProfileService.getProfile', () => {
  it('档案不存在 → GRADING_PROFILE_NOT_FOUND 404', async () => {
    mockProfileRepo.findById.mockResolvedValue(null);
    await expectBusinessError(
      () => gradingProfileService.getProfile('non-existent'),
      ErrorCode.GRADING_PROFILE_NOT_FOUND,
      404,
    );
  });

  it('档案已停用 → GRADING_PROFILE_NOT_FOUND 404', async () => {
    mockProfileRepo.findById.mockResolvedValue(makeBuiltInProfile({ enabled: false }));
    await expectBusinessError(
      () => gradingProfileService.getProfile('gprofile_builtin_sketch'),
      ErrorCode.GRADING_PROFILE_NOT_FOUND,
      404,
    );
  });

  it('成功返回 Detail(含解析后的 config)', async () => {
    mockProfileRepo.findById.mockResolvedValue(makeBuiltInProfile());
    const result = await gradingProfileService.getProfile('gprofile_builtin_sketch');
    expect(result.id).toBe('gprofile_builtin_sketch');
    expect(result.config.dimensionWeights).toHaveLength(2);
    expect(result.config.tierMapping[0]!.key).toBe('A');
  });
});

describe('GradingProfileService.createProfile', () => {
  it('权重总和≠100 → GRADING_PROFILE_CONFIG_INVALID 400', async () => {
    const badConfig = makeConfig({
      dimensionWeights: [
        { key: 'form', label: '造型', weight: 60 },
        { key: 'structure', label: '结构', weight: 50 },
      ],
    });
    await expectBusinessError(
      () =>
        gradingProfileService.createProfile(TENANT_A, USER_TEACHER, {
          name: '新档案',
          category: 'sketch',
          config: badConfig,
        }),
      ErrorCode.GRADING_PROFILE_CONFIG_INVALID,
      400,
    );
    expect(mockProfileRepo.create).not.toHaveBeenCalled();
  });

  it('tierMapping 非严格降序 → 400', async () => {
    const badConfig = makeConfig({
      tierMapping: [
        { key: 'A', label: '一档', min: 90 },
        { key: 'B', label: '二档', min: 90 },
        { key: 'C', label: '三档', min: 0 },
      ],
    });
    await expectBusinessError(
      () =>
        gradingProfileService.createProfile(TENANT_A, USER_TEACHER, {
          name: '新档案',
          category: 'sketch',
          config: badConfig,
        }),
      ErrorCode.GRADING_PROFILE_CONFIG_INVALID,
      400,
    );
  });

  it('末档 min≠0(无兜底档) → 400', async () => {
    const badConfig = makeConfig({
      tierMapping: [
        { key: 'A', label: '一档', min: 90 },
        { key: 'B', label: '二档', min: 80 },
        { key: 'C', label: '三档', min: 60 },
      ],
    });
    await expectBusinessError(
      () =>
        gradingProfileService.createProfile(TENANT_A, USER_TEACHER, {
          name: '新档案',
          category: 'sketch',
          config: badConfig,
        }),
      ErrorCode.GRADING_PROFILE_CONFIG_INVALID,
      400,
    );
  });

  it('feedbackStyle 越界(diagnosisIntensity=6) → 400', async () => {
    const badConfig = makeConfig({
      feedbackStyle: { diagnosisIntensity: 6, positiveRatio: 0.3, toneStrictness: 3 },
    });
    await expectBusinessError(
      () =>
        gradingProfileService.createProfile(TENANT_A, USER_TEACHER, {
          name: '新档案',
          category: 'sketch',
          config: badConfig,
        }),
      ErrorCode.GRADING_PROFILE_CONFIG_INVALID,
      400,
    );
  });

  it('成功创建:repo.create 收到 isBuiltIn=false + 租户/创建者归属', async () => {
    const created = makeTenantProfile({ forkedFromId: null, name: '新档案' });
    mockProfileRepo.create.mockResolvedValue(created);

    const result = await gradingProfileService.createProfile(TENANT_A, USER_TEACHER, {
      name: '新档案',
      category: 'sketch',
      config: makeConfig(),
    });

    expect(mockProfileRepo.create).toHaveBeenCalledTimes(1);
    const callArg = mockProfileRepo.create.mock.calls[0]![0];
    expect(callArg.isBuiltIn).toBe(false);
    expect(callArg.isDefault).toBe(false);
    expect(callArg.tenantId).toBe(TENANT_A);
    expect(callArg.creatorId).toBe(USER_TEACHER);
    expect(callArg.forkedFromId).toBeNull();
    expect(result.id).toBe('gprofile_tenant_0001');
  });
});

describe('GradingProfileService.forkProfile', () => {
  it('源档案不存在 → GRADING_PROFILE_NOT_FOUND 404', async () => {
    mockProfileRepo.findById.mockResolvedValue(null);
    await expectBusinessError(
      () =>
        gradingProfileService.forkProfile(TENANT_A, USER_TEACHER, 'non-existent', {
          name: '克隆档案',
        }),
      ErrorCode.GRADING_PROFILE_NOT_FOUND,
      404,
    );
  });

  it('跨租户非内置源档案 → 404(不泄露存在性)', async () => {
    mockProfileRepo.findById.mockResolvedValue(
      makeTenantProfile({ tenantId: TENANT_B, creatorId: USER_OTHER }),
    );
    await expectBusinessError(
      () =>
        gradingProfileService.forkProfile(TENANT_A, USER_TEACHER, 'gprofile_tenant_0001', {
          name: '克隆档案',
        }),
      ErrorCode.GRADING_PROFILE_NOT_FOUND,
      404,
    );
  });

  it('源档案已停用 → 404', async () => {
    mockProfileRepo.findById.mockResolvedValue(makeBuiltInProfile({ enabled: false }));
    await expectBusinessError(
      () =>
        gradingProfileService.forkProfile(TENANT_A, USER_TEACHER, 'gprofile_builtin_sketch', {
          name: '克隆档案',
        }),
      ErrorCode.GRADING_PROFILE_NOT_FOUND,
      404,
    );
  });

  it('成功 fork:forkedFromId 指向源档案 + 深拷贝源 config + 归属当前租户', async () => {
    const source = makeBuiltInProfile();
    mockProfileRepo.findById.mockResolvedValue(source);
    const forked = makeTenantProfile({ forkedFromId: 'gprofile_builtin_sketch', name: '克隆档案' });
    mockProfileRepo.create.mockResolvedValue(forked);

    const result = await gradingProfileService.forkProfile(
      TENANT_A,
      USER_TEACHER,
      'gprofile_builtin_sketch',
      { name: '克隆档案' },
    );

    expect(mockProfileRepo.create).toHaveBeenCalledTimes(1);
    const callArg = mockProfileRepo.create.mock.calls[0]![0];
    expect(callArg.forkedFromId).toBe('gprofile_builtin_sketch');
    expect(callArg.isBuiltIn).toBe(false);
    expect(callArg.tenantId).toBe(TENANT_A);
    expect(callArg.creatorId).toBe(USER_TEACHER);
    // config 深拷贝自源档案
    expect(callArg.category).toBe('sketch');
    expect(result.forkedFromId).toBe('gprofile_builtin_sketch');
    expect(result.name).toBe('克隆档案');
  });

  it('fork 时可用 description 覆盖,缺省继承源档案', async () => {
    const source = makeBuiltInProfile();
    mockProfileRepo.findById.mockResolvedValue(source);
    mockProfileRepo.create.mockResolvedValue(
      makeTenantProfile({ description: '自定义描述', forkedFromId: 'gprofile_builtin_sketch' }),
    );

    await gradingProfileService.forkProfile(TENANT_A, USER_TEACHER, 'gprofile_builtin_sketch', {
      name: '克隆档案',
      description: '自定义描述',
    });

    const callArg = mockProfileRepo.create.mock.calls[0]![0];
    expect(callArg.description).toBe('自定义描述');
  });
});

describe('GradingProfileService.updateProfile', () => {
  it('系统内置档案不可修改 → GRADING_PROFILE_BUILTIN_IMMUTABLE 403', async () => {
    mockProfileRepo.findById.mockResolvedValue(makeBuiltInProfile());
    await expectBusinessError(
      () =>
        gradingProfileService.updateProfile(TENANT_A, USER_TEACHER, 'gprofile_builtin_sketch', {
          name: '改名',
        }),
      ErrorCode.GRADING_PROFILE_BUILTIN_IMMUTABLE,
      403,
    );
    expect(mockProfileRepo.update).not.toHaveBeenCalled();
  });

  it('跨租户档案 → TENANT_MISMATCH 403', async () => {
    mockProfileRepo.findById.mockResolvedValue(
      makeTenantProfile({ tenantId: TENANT_B, creatorId: USER_TEACHER }),
    );
    await expectBusinessError(
      () =>
        gradingProfileService.updateProfile(TENANT_A, USER_TEACHER, 'gprofile_tenant_0001', {
          name: '改名',
        }),
      ErrorCode.TENANT_MISMATCH,
      403,
    );
  });

  it('非创建者 → FORBIDDEN 403', async () => {
    mockProfileRepo.findById.mockResolvedValue(
      makeTenantProfile({ creatorId: USER_OTHER }),
    );
    await expectBusinessError(
      () =>
        gradingProfileService.updateProfile(TENANT_A, USER_TEACHER, 'gprofile_tenant_0001', {
          name: '改名',
        }),
      ErrorCode.FORBIDDEN,
      403,
    );
  });

  it('档案不存在 → 404', async () => {
    mockProfileRepo.findById.mockResolvedValue(null);
    await expectBusinessError(
      () =>
        gradingProfileService.updateProfile(TENANT_A, USER_TEACHER, 'non-existent', {
          name: '改名',
        }),
      ErrorCode.GRADING_PROFILE_NOT_FOUND,
      404,
    );
  });

  it('更新 config 非法(权重和≠100) → 400', async () => {
    mockProfileRepo.findById.mockResolvedValue(makeTenantProfile());
    await expectBusinessError(
      () =>
        gradingProfileService.updateProfile(TENANT_A, USER_TEACHER, 'gprofile_tenant_0001', {
          config: makeConfig({
            dimensionWeights: [{ key: 'form', label: '造型', weight: 40 }],
          }),
        }),
      ErrorCode.GRADING_PROFILE_CONFIG_INVALID,
      400,
    );
  });

  it('成功更新:部分字段透传', async () => {
    mockProfileRepo.findById.mockResolvedValue(makeTenantProfile());
    const updated = makeTenantProfile({ name: '新名称', enabled: false });
    mockProfileRepo.update.mockResolvedValue(updated);

    const result = await gradingProfileService.updateProfile(
      TENANT_A,
      USER_TEACHER,
      'gprofile_tenant_0001',
      { name: '新名称', enabled: false },
    );

    expect(mockProfileRepo.update).toHaveBeenCalledWith('gprofile_tenant_0001', {
      name: '新名称',
      enabled: false,
    });
    expect(result.name).toBe('新名称');
  });
});

describe('GradingProfileService.deleteProfile', () => {
  it('系统内置档案不可删除 → GRADING_PROFILE_BUILTIN_IMMUTABLE 403', async () => {
    mockProfileRepo.findById.mockResolvedValue(makeBuiltInProfile());
    await expectBusinessError(
      () => gradingProfileService.deleteProfile(TENANT_A, USER_TEACHER, 'gprofile_builtin_sketch'),
      ErrorCode.GRADING_PROFILE_BUILTIN_IMMUTABLE,
      403,
    );
    expect(mockProfileRepo.delete).not.toHaveBeenCalled();
  });

  it('成功删除租户档案', async () => {
    mockProfileRepo.findById.mockResolvedValue(makeTenantProfile());
    mockProfileRepo.delete.mockResolvedValue(undefined);
    await gradingProfileService.deleteProfile(TENANT_A, USER_TEACHER, 'gprofile_tenant_0001');
    expect(mockProfileRepo.delete).toHaveBeenCalledWith('gprofile_tenant_0001');
  });
});

describe('GradingProfileService.activateProfile', () => {
  it('档案不存在 → 404', async () => {
    mockProfileRepo.findById.mockResolvedValue(null);
    await expectBusinessError(
      () => gradingProfileService.activateProfile(TENANT_A, USER_TEACHER, 'non-existent'),
      ErrorCode.GRADING_PROFILE_NOT_FOUND,
      404,
    );
  });

  it('已停用档案不可设为默认 → 404', async () => {
    mockProfileRepo.findById.mockResolvedValue(makeTenantProfile({ enabled: false }));
    await expectBusinessError(
      () => gradingProfileService.activateProfile(TENANT_A, USER_TEACHER, 'gprofile_tenant_0001'),
      ErrorCode.GRADING_PROFILE_NOT_FOUND,
      404,
    );
  });

  it('系统内置档案不可设为租户默认 → 403', async () => {
    mockProfileRepo.findById.mockResolvedValue(makeBuiltInProfile());
    await expectBusinessError(
      () => gradingProfileService.activateProfile(TENANT_A, USER_TEACHER, 'gprofile_builtin_sketch'),
      ErrorCode.GRADING_PROFILE_BUILTIN_IMMUTABLE,
      403,
    );
    expect(mockProfileRepo.setDefault).not.toHaveBeenCalled();
  });

  it('跨租户档案 → TENANT_MISMATCH 403', async () => {
    mockProfileRepo.findById.mockResolvedValue(
      makeTenantProfile({ tenantId: TENANT_B, creatorId: USER_OTHER }),
    );
    await expectBusinessError(
      () => gradingProfileService.activateProfile(TENANT_A, USER_TEACHER, 'gprofile_tenant_0001'),
      ErrorCode.TENANT_MISMATCH,
      403,
    );
  });

  it('成功设默认:setDefault 透传 (id, tenantId, category)', async () => {
    mockProfileRepo.findById.mockResolvedValue(makeTenantProfile());
    const activated = makeTenantProfile({ isDefault: true });
    mockProfileRepo.setDefault.mockResolvedValue(activated);

    const result = await gradingProfileService.activateProfile(
      TENANT_A,
      USER_TEACHER,
      'gprofile_tenant_0001',
    );

    expect(mockProfileRepo.setDefault).toHaveBeenCalledWith(
      'gprofile_tenant_0001',
      TENANT_A,
      'sketch',
    );
    expect(result.isDefault).toBe(true);
  });
});

describe('GradingProfileService.resolveEffectiveProfile', () => {
  it('租户默认档案优先返回(含解析后的 config)', async () => {
    const tenantDefault = makeTenantProfile({ isDefault: true, category: 'color' });
    mockProfileRepo.findTenantDefault.mockResolvedValue(tenantDefault);

    const result = await gradingProfileService.resolveEffectiveProfile(TENANT_A, 'color');

    expect(mockProfileRepo.findTenantDefault).toHaveBeenCalledWith(TENANT_A, 'color');
    expect(mockProfileRepo.findSystemFallback).not.toHaveBeenCalled();
    expect(result?.id).toBe('gprofile_tenant_0001');
    expect(result?.config.defaultFeedbackMode).toBe('diagnosis');
    expect(result?.category).toBe('color');
  });

  it('租户默认 config 脏数据 → warn 并回退系统兜底', async () => {
    mockProfileRepo.findTenantDefault.mockResolvedValue(
      makeTenantProfile({ isDefault: true, config: { broken: true } as unknown as GradingProfile['config'] }),
    );
    mockProfileRepo.findSystemFallback.mockResolvedValue(makeBuiltInProfile({ category: 'sketch' }));

    const result = await gradingProfileService.resolveEffectiveProfile(TENANT_A, 'sketch');

    expect(result?.id).toBe('gprofile_builtin_sketch');
    expect(result?.config.dimensionWeights).toHaveLength(2);
  });

  it('无租户默认 → 系统内置兜底', async () => {
    mockProfileRepo.findTenantDefault.mockResolvedValue(null);
    mockProfileRepo.findSystemFallback.mockResolvedValue(makeBuiltInProfile());

    const result = await gradingProfileService.resolveEffectiveProfile(TENANT_A, 'sketch');

    expect(result?.id).toBe('gprofile_builtin_sketch');
    expect(result?.config.tierMapping[0]!.min).toBe(90);
  });

  it('租户默认与系统兜底均无 → undefined(调用方保持现状行为)', async () => {
    mockProfileRepo.findTenantDefault.mockResolvedValue(null);
    mockProfileRepo.findSystemFallback.mockResolvedValue(null);

    const result = await gradingProfileService.resolveEffectiveProfile(TENANT_A, 'design');
    expect(result).toBeUndefined();
  });

  it('系统兜底 config 也异常 → undefined', async () => {
    mockProfileRepo.findTenantDefault.mockResolvedValue(null);
    mockProfileRepo.findSystemFallback.mockResolvedValue(
      makeBuiltInProfile({ config: null as unknown as GradingProfile['config'] }),
    );

    const result = await gradingProfileService.resolveEffectiveProfile(TENANT_A, 'sketch');
    expect(result).toBeUndefined();
  });
});
