// ============================================================
// 教学画像 + 档案建议 API 测试(反馈闭环 Phase 5 批次③:风格沉淀)
// 对应源码:src/routes/grading-profile.routes.ts(insights/suggestion/adoptions)
//          src/services/grading-insights.service.ts
//          src/services/grading-suggestion-engine.ts
//          src/repositories/grading-insights.repository.ts
//
// 测试维度(11 组):
//   G1  : 教师画像聚合(批注 seed → 总数/密度/四动作占比/AI 一致率/最近活跃)
//   G2  : 教师画像空数据不炸(全 0 + null)
//   G3  : 档案级建议 R1+R2+R3 三规则同时触发 + stats 返回学生反馈计数
//   G4  : 样本不足(总量 < 20)建议为空
//   G5  : 已采纳防重复过滤(同 key+afterValue 不再弹)
//   G6  : 采纳落库(审计字段 + basisSnapshot 快照)
//   G7  : 采纳幂等(重复 POST 返回既有记录,store 不增)
//   G8  : 采纳参数不一致 400(伪造 afterValue / 过期建议)
//   G9  : 内置档案采纳 403(不可采纳,照 update 语义)
//   G10 : 跨租户越权 404(建议 + 采纳均按不存在处理)
//   G11 : 权限(学生 403 / 未认证 401,覆盖 GET 与 POST)
//
// 设计要点:
//   - 走真实 gradingProfileRouter(getTestApp),复用 fixtures 权限上下文
//   - 批注/反馈/采纳记录直插 store(画像与建议只读消费)
//   - 全局 beforeEach 清 store,每用例自建上下文自 seed
// ============================================================

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { getTestApp } from './helpers/test-app.js';
import { assertApiResponse, assertApiError } from './helpers/assertions.js';
import {
  createTestUser,
  createTestTenant,
  createTestTokenSet,
  buildAuthHeaders,
} from './helpers/fixtures.js';
import { prismaMock } from './mocks/prisma.mock.js';
import type {
  MockTeacherAnnotation,
  MockMarkerFeedback,
  MockGradingProfile,
  MockProfileSuggestionAdoption,
} from './mocks/prisma.mock.js';

// ============================================================
// 测试常量与辅助
// ============================================================

const TENANT_A = 't-gi-a-0001';
const TEACHER_A = 'u-gi-teacher-a';
const TEACHER_A2 = 'u-gi-teacher-a2'; // 同租户第二教师(租户聚合口径验证)
const STUDENT_A = 'u-gi-student-a';
const TENANT_B = 't-gi-b-0001';
const TEACHER_B = 'u-gi-teacher-b';

const PROFILE_A = 'gprofile-gi-a-1'; // 租户 A 档案(非内置)
const PROFILE_B = 'gprofile-gi-b-1'; // 租户 B 档案(非内置)
const PROFILE_BUILTIN = 'gprofile-gi-builtin'; // 内置档案(tenantId=null)

/** 有效档案配置(feedbackStyle 3/0.3/3,照 seed 联考模板裁剪) */
const TEST_CONFIG = {
  defaultFeedbackMode: 'diagnosis' as const,
  dimensionWeights: [
    { key: 'form_proportion', label: '造型与比例', weight: 50 },
    { key: 'structure', label: '结构理解', weight: 50 },
  ],
  thresholds: {
    basicsLine: 70,
    dimensionPass: { form_proportion: 60, structure: 60 },
  },
  tierMapping: [
    { key: 'A', label: '一档(90-100)', min: 90 },
    { key: 'B', label: '二档(80-89)', min: 80 },
    { key: 'E', label: '五档(<60)', min: 0 },
  ],
  feedbackStyle: { diagnosisIntensity: 3, positiveRatio: 0.3, toneStrictness: 3 },
};

/** 三租户三用户上下文(teacherA/teacherB/student) */
function setupContexts(): {
  teacherA: Record<string, string>;
  teacherB: Record<string, string>;
  student: Record<string, string>;
} {
  createTestTenant({ id: TENANT_A, name: '画像租户A' });
  createTestUser({
    id: TEACHER_A,
    tenantId: TENANT_A,
    feishuOpenId: 'ou_gi_teacher_a',
    feishuUnionId: 'on_gi_teacher_a',
    name: '教师A',
    role: 'teacher',
  });
  createTestUser({
    id: STUDENT_A,
    tenantId: TENANT_A,
    feishuOpenId: 'ou_gi_student_a',
    feishuUnionId: 'on_gi_student_a',
    name: '学生A',
    role: 'student',
  });
  createTestTenant({ id: TENANT_B, name: '画像租户B' });
  createTestUser({
    id: TEACHER_B,
    tenantId: TENANT_B,
    feishuOpenId: 'ou_gi_teacher_b',
    feishuUnionId: 'on_gi_teacher_b',
    name: '教师B',
    role: 'teacher',
  });
  const teacherA = buildAuthHeaders(
    createTestTokenSet({
      userId: TEACHER_A,
      tenantId: TENANT_A,
      role: 'teacher',
      feishuOpenId: 'ou_gi_teacher_a',
      client: 'web',
    }).accessToken,
  );
  const teacherB = buildAuthHeaders(
    createTestTokenSet({
      userId: TEACHER_B,
      tenantId: TENANT_B,
      role: 'teacher',
      feishuOpenId: 'ou_gi_teacher_b',
      client: 'web',
    }).accessToken,
  );
  const student = buildAuthHeaders(
    createTestTokenSet({
      userId: STUDENT_A,
      tenantId: TENANT_A,
      role: 'student',
      feishuOpenId: 'ou_gi_student_a',
      client: 'web',
    }).accessToken,
  );
  return { teacherA, teacherB, student };
}

/** 直插租户档案 */
function seedProfile(overrides: Partial<MockGradingProfile> & { id: string }): MockGradingProfile {
  const record: MockGradingProfile = {
    id: overrides.id,
    name: '测试档案',
    description: null,
    category: 'sketch',
    config: TEST_CONFIG,
    isBuiltIn: false,
    isDefault: false,
    forkedFromId: null,
    creatorId: TEACHER_A,
    tenantId: TENANT_A,
    enabled: true,
    sortOrder: 100,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    updatedAt: new Date('2026-09-01T00:00:00Z'),
    ...overrides,
  };
  prismaMock.gradingProfileStore.set(record.id, record);
  return record;
}

/** 直插教师批注 */
function seedAnnotation(overrides: Partial<MockTeacherAnnotation>): void {
  const record: MockTeacherAnnotation = {
    id: `ta-${Math.random().toString(36).slice(2, 10)}`,
    tenantId: TENANT_A,
    analysisId: 'a-gi-0001',
    teacherId: TEACHER_A,
    markerId: 'mk_testhash01',
    markerIndex: 0,
    markerSnapshot: { label: '颧骨结构太平' },
    action: 'supplement',
    comment: '测试批注',
    createdAt: new Date('2026-09-01T10:00:00Z'),
    updatedAt: new Date('2026-09-01T10:00:00Z'),
    ...overrides,
  };
  prismaMock.teacherAnnotationStore.set(record.id, record);
}

/** 直插学生 marker 反馈 */
function seedStudentFeedback(overrides: Partial<MockMarkerFeedback>): void {
  const record: MockMarkerFeedback = {
    id: `mf-${Math.random().toString(36).slice(2, 10)}`,
    tenantId: TENANT_A,
    userId: STUDENT_A,
    analysisId: 'a-gi-0001',
    markerId: 'mk_testhash01',
    markerIndex: 0,
    action: 'up',
    markerSnapshot: { label: '颧骨结构太平', dimension: '造型' },
    workType: 'painting',
    diagnosisMode: 'teaching',
    createdAt: new Date('2026-09-01T10:00:00Z'),
    updatedAt: new Date('2026-09-01T10:00:00Z'),
    ...overrides,
  };
  prismaMock.markerFeedbackStore.set(record.id, record);
}

/** 直插采纳记录(防重复过滤测试用) */
function seedAdoption(
  overrides: Partial<MockProfileSuggestionAdoption> & { profileId: string; suggestionKey: string; afterValue: number },
): MockProfileSuggestionAdoption {
  const record: MockProfileSuggestionAdoption = {
    id: `adopt-${Math.random().toString(36).slice(2, 10)}`,
    tenantId: TENANT_A,
    teacherId: TEACHER_A,
    profileId: overrides.profileId,
    suggestionKey: overrides.suggestionKey,
    beforeValue: 3,
    afterValue: overrides.afterValue,
    suggestionBasis: {},
    createdAt: new Date('2026-09-02T00:00:00Z'),
    ...overrides,
  };
  prismaMock.profileSuggestionAdoptionStore.set(record.id, record);
  return record;
}

/**
 * 种子:租户 A 全量行为数据(G3 口径,同时触发 R1/R2/R3)
 *   20 条批注 = 12 confirm + 4 reject + 4 correct(0 supplement)
 *   → confirm 占比 0.6(≥0.6 触发 R1)/override 占比 0.4(≥0.4 触发 R2)
 *   5 个作品(a-gi-0001..0005)→ 密度 4.0(≥3.0 触发 R3)
 *   5 条学生 up 反馈(邻接一致信号,进租户聚合不进教师本人画像)
 */
function seedTenantBehavior(): void {
  const actions: Array<'confirm' | 'reject' | 'correct'> = [
    ...Array<'confirm'>(12).fill('confirm'),
    ...Array<'reject'>(4).fill('reject'),
    ...Array<'correct'>(4).fill('correct'),
  ];
  actions.forEach((action, i) => {
    seedAnnotation({
      analysisId: `a-gi-${String((i % 5) + 1).padStart(4, '0')}`,
      action,
      createdAt: new Date(Date.parse('2026-09-01T10:00:00Z') + i * 60_000),
      updatedAt: new Date(Date.parse('2026-09-01T10:00:00Z') + i * 60_000),
    });
  });
  for (let i = 0; i < 5; i += 1) {
    seedStudentFeedback({ action: 'up', analysisId: `a-gi-${String((i % 5) + 1).padStart(4, '0')}` });
  }
}

// ============================================================
// 测试用例
// ============================================================

describe('GradingProfile API - 教学画像与建议引擎(Phase 5 批次③)', () => {
  const app = getTestApp();

  // ---------------- 教师本人画像 ----------------

  it('G1: 教师画像聚合(总数/密度/四动作占比/AI 一致率/最近活跃;学生反馈不计入)', async () => {
    const { teacherA } = setupContexts();
    // 教师A:12 confirm + 4 supplement + 2 correct + 2 reject = 20 条,5 作品
    const plan: Array<'confirm' | 'supplement' | 'correct' | 'reject'> = [
      ...Array<'confirm'>(12).fill('confirm'),
      ...Array<'supplement'>(4).fill('supplement'),
      ...Array<'correct'>(2).fill('correct'),
      ...Array<'reject'>(2).fill('reject'),
    ];
    let latestAt = new Date('2026-09-01T10:00:00Z');
    plan.forEach((action, i) => {
      const at = new Date(Date.parse('2026-09-01T10:00:00Z') + i * 60_000);
      if (at > latestAt) latestAt = at;
      seedAnnotation({
        analysisId: `a-gi-${String((i % 5) + 1).padStart(4, '0')}`,
        action,
        createdAt: at,
        updatedAt: at,
      });
    });
    // 同租户其他教师的批注:教师本人画像必须排除(teacherId 过滤)
    seedAnnotation({ teacherId: TEACHER_A2, action: 'confirm' });
    // 学生反馈:教师画像不统计(恒 0)
    seedStudentFeedback({ action: 'up' });

    const res = await request(app).get('/api/v1/grading-profiles/insights/teacher').set(teacherA);
    assertApiResponse(res);
    expect(res.body.data.teacherId).toBe(TEACHER_A);
    const stats = res.body.data.stats;
    expect(stats.annotationCount).toBe(20);
    expect(stats.reviewedWorks).toBe(5);
    expect(stats.annotationDensity).toBe(4);
    expect(stats.actionCounts).toEqual({
      supplement: 4,
      correct: 2,
      confirm: 12,
      reject: 2,
    });
    expect(stats.actionRatios.confirm).toBe(0.6);
    expect(stats.actionRatios.supplement).toBe(0.2);
    expect(stats.actionRatios.correct).toBe(0.1);
    expect(stats.actionRatios.reject).toBe(0.1);
    expect(stats.upCount).toBe(0);
    expect(stats.downCount).toBe(0);
    // AI 一致率 = confirm / (confirm + reject) = 12/14
    expect(stats.aiAgreementRate).toBeCloseTo(12 / 14, 10);
    expect(stats.lastActiveAt).toBe(latestAt.toISOString());
  });

  it('G2: 教师画像空数据不炸(全 0 + aiAgreementRate/lastActiveAt 为 null)', async () => {
    const { teacherA } = setupContexts();
    const res = await request(app).get('/api/v1/grading-profiles/insights/teacher').set(teacherA);
    assertApiResponse(res);
    expect(res.body.data.teacherId).toBe(TEACHER_A);
    const stats = res.body.data.stats;
    expect(stats.annotationCount).toBe(0);
    expect(stats.reviewedWorks).toBe(0);
    expect(stats.annotationDensity).toBe(0);
    expect(stats.actionCounts).toEqual({ supplement: 0, correct: 0, confirm: 0, reject: 0 });
    expect(stats.actionRatios).toEqual({ supplement: 0, correct: 0, confirm: 0, reject: 0 });
    expect(stats.upCount).toBe(0);
    expect(stats.downCount).toBe(0);
    expect(stats.aiAgreementRate).toBeNull();
    expect(stats.lastActiveAt).toBeNull();
  });

  // ---------------- 档案级建议 ----------------

  it('G3: 档案建议 R1+R2+R3 同时触发(toneStrictness/diagnosisIntensity/positiveRatio)+ stats 含学生反馈', async () => {
    const { teacherA } = setupContexts();
    seedProfile({ id: PROFILE_A });
    seedTenantBehavior();

    const res = await request(app)
      .get(`/api/v1/grading-profiles/${PROFILE_A}/insights/suggestion`)
      .set(teacherA);
    assertApiResponse(res);
    expect(res.body.data.profileId).toBe(PROFILE_A);
    // 租户聚合口径:学生 up 计入(upCount=5)
    expect(res.body.data.stats.annotationCount).toBe(20);
    expect(res.body.data.stats.upCount).toBe(5);

    const suggestions = res.body.data.suggestions;
    expect(suggestions).toHaveLength(3);
    const byKey = Object.fromEntries(suggestions.map((s: { suggestionKey: string }) => [s.suggestionKey, s]));

    // R1:confirm 占比 60% ≥ 60% → toneStrictness 3→2
    expect(byKey.toneStrictness).toMatchObject({
      currentValue: 3,
      suggestedValue: 2,
    });
    expect(byKey.toneStrictness.basis).toContain('60%');
    // R2:override 占比 40% ≥ 40% → diagnosisIntensity 3→4
    expect(byKey.diagnosisIntensity).toMatchObject({
      currentValue: 3,
      suggestedValue: 4,
    });
    // R3:密度 4.0 ≥ 3.0 → positiveRatio 0.3→0.25
    expect(byKey.positiveRatio).toMatchObject({
      currentValue: 0.3,
      suggestedValue: 0.25,
    });
    // 每条建议携带人类可读依据与统计快照
    for (const s of suggestions) {
      expect(typeof s.basis).toBe('string');
      expect(s.basis.length).toBeGreaterThan(0);
      expect(typeof s.basisSnapshot).toBe('object');
    }
  });

  it('G4: 样本不足(批注+反馈总量 < 20)建议为空', async () => {
    const { teacherB } = setupContexts();
    seedProfile({ id: PROFILE_B, tenantId: TENANT_B, creatorId: TEACHER_B });
    // 租户 B:10 条 confirm(占比 100%,规则本会触发)但总量不足
    for (let i = 0; i < 10; i += 1) {
      seedAnnotation({
        tenantId: TENANT_B,
        teacherId: TEACHER_B,
        action: 'confirm',
        analysisId: `a-gi-b-${i % 3}`,
      });
    }

    const res = await request(app)
      .get(`/api/v1/grading-profiles/${PROFILE_B}/insights/suggestion`)
      .set(teacherB);
    assertApiResponse(res);
    expect(res.body.data.stats.annotationCount).toBe(10);
    expect(res.body.data.suggestions).toEqual([]);
  });

  it('G5: 已采纳建议防重复过滤(同 key+afterValue 不再弹,其余建议保留)', async () => {
    const { teacherA } = setupContexts();
    seedProfile({ id: PROFILE_A });
    seedTenantBehavior();
    // 已采纳 toneStrictness→2:该建议不再弹出
    seedAdoption({ profileId: PROFILE_A, suggestionKey: 'toneStrictness', beforeValue: 3, afterValue: 2 });

    const res = await request(app)
      .get(`/api/v1/grading-profiles/${PROFILE_A}/insights/suggestion`)
      .set(teacherA);
    assertApiResponse(res);
    const keys = res.body.data.suggestions.map((s: { suggestionKey: string }) => s.suggestionKey);
    expect(keys).not.toContain('toneStrictness');
    expect(keys).toContain('diagnosisIntensity');
    expect(keys).toContain('positiveRatio');
  });

  // ---------------- 建议采纳链路 ----------------

  it('G6: 采纳落库(审计字段 + basisSnapshot 快照 + store 断言)', async () => {
    const { teacherA } = setupContexts();
    seedProfile({ id: PROFILE_A });
    seedTenantBehavior();

    const res = await request(app)
      .post(`/api/v1/grading-profiles/${PROFILE_A}/suggestion-adoptions`)
      .set(teacherA)
      .send({ suggestionKey: 'diagnosisIntensity', beforeValue: 3, afterValue: 4 });
    assertApiResponse(res);
    expect(res.body.message).toBe('建议采纳已记录');

    const record = res.body.data;
    expect(record.tenantId).toBe(TENANT_A);
    expect(record.teacherId).toBe(TEACHER_A);
    expect(record.profileId).toBe(PROFILE_A);
    expect(record.suggestionKey).toBe('diagnosisIntensity');
    expect(record.beforeValue).toBe(3);
    expect(record.afterValue).toBe(4);
    // basisSnapshot = 引擎 R2 规则统计快照
    expect(record.suggestionBasis).toEqual({
      overrideRatio: 0.4,
      rejectRatio: 0.2,
      correctRatio: 0.2,
      annotationCount: 20,
    });
    expect(typeof record.createdAt).toBe('string');

    // store 落库断言
    expect(prismaMock.profileSuggestionAdoptionStore.size).toBe(1);
  });

  it('G7: 采纳幂等(重复 POST 返回既有记录,store 不增)', async () => {
    const { teacherA } = setupContexts();
    seedProfile({ id: PROFILE_A });
    seedTenantBehavior();
    const body = { suggestionKey: 'diagnosisIntensity', beforeValue: 3, afterValue: 4 };

    const first = await request(app)
      .post(`/api/v1/grading-profiles/${PROFILE_A}/suggestion-adoptions`)
      .set(teacherA)
      .send(body);
    assertApiResponse(first);
    const firstId = first.body.data.id;

    const second = await request(app)
      .post(`/api/v1/grading-profiles/${PROFILE_A}/suggestion-adoptions`)
      .set(teacherA)
      .send(body);
    assertApiResponse(second);
    expect(second.body.message).toBe('该建议已采纳过,幂等返回');
    expect(second.body.data.id).toBe(firstId);
    expect(prismaMock.profileSuggestionAdoptionStore.size).toBe(1);
  });

  it('G8: 采纳参数与当前建议不一致 400(伪造 afterValue / 伪造 beforeValue)', async () => {
    const { teacherA } = setupContexts();
    seedProfile({ id: PROFILE_A });
    seedTenantBehavior();

    // 伪造 afterValue:toneStrictness 实际建议 3→2,body 提交 3→1
    const forgedAfter = await request(app)
      .post(`/api/v1/grading-profiles/${PROFILE_A}/suggestion-adoptions`)
      .set(teacherA)
      .send({ suggestionKey: 'toneStrictness', beforeValue: 3, afterValue: 1 });
    assertApiError(forgedAfter, 9304, 400);

    // 伪造 beforeValue:diagnosisIntensity 实际建议 3→4,body 提交 2→4
    const forgedBefore = await request(app)
      .post(`/api/v1/grading-profiles/${PROFILE_A}/suggestion-adoptions`)
      .set(teacherA)
      .send({ suggestionKey: 'diagnosisIntensity', beforeValue: 2, afterValue: 4 });
    assertApiError(forgedBefore, 9304, 400);
    expect(prismaMock.profileSuggestionAdoptionStore.size).toBe(0);
  });

  it('G9: 内置档案采纳 403(不可采纳,照 update 语义)', async () => {
    const { teacherA } = setupContexts();
    seedProfile({
      id: PROFILE_BUILTIN,
      isBuiltIn: true,
      tenantId: null,
      creatorId: null,
      name: '内置·素描·标准版',
    });
    seedTenantBehavior();

    const res = await request(app)
      .post(`/api/v1/grading-profiles/${PROFILE_BUILTIN}/suggestion-adoptions`)
      .set(teacherA)
      .send({ suggestionKey: 'diagnosisIntensity', beforeValue: 3, afterValue: 4 });
    assertApiError(res, 9302, 403);
    expect(prismaMock.profileSuggestionAdoptionStore.size).toBe(0);
  });

  it('G10: 跨租户越权 404(建议 + 采纳均按不存在处理,不泄露存在性)', async () => {
    const { teacherB } = setupContexts();
    seedProfile({ id: PROFILE_A }); // 租户 A 档案
    seedTenantBehavior();

    const suggestionRes = await request(app)
      .get(`/api/v1/grading-profiles/${PROFILE_A}/insights/suggestion`)
      .set(teacherB);
    assertApiError(suggestionRes, 9301, 404);

    const adoptionRes = await request(app)
      .post(`/api/v1/grading-profiles/${PROFILE_A}/suggestion-adoptions`)
      .set(teacherB)
      .send({ suggestionKey: 'diagnosisIntensity', beforeValue: 3, afterValue: 4 });
    assertApiError(adoptionRes, 9301, 404);
  });

  it('G11: 权限控制(学生 403 / 未认证 401,覆盖画像/建议/采纳三端点)', async () => {
    const { student } = setupContexts();
    seedProfile({ id: PROFILE_A });

    // 学生无 grading-profile:read/write 权限
    const insights403 = await request(app)
      .get('/api/v1/grading-profiles/insights/teacher')
      .set(student);
    assertApiError(insights403, 2004, 403);

    const suggestion403 = await request(app)
      .get(`/api/v1/grading-profiles/${PROFILE_A}/insights/suggestion`)
      .set(student);
    assertApiError(suggestion403, 2004, 403);

    const adoption403 = await request(app)
      .post(`/api/v1/grading-profiles/${PROFILE_A}/suggestion-adoptions`)
      .set(student)
      .send({ suggestionKey: 'diagnosisIntensity', beforeValue: 3, afterValue: 4 });
    assertApiError(adoption403, 2004, 403);

    // 未认证
    const insights401 = await request(app).get('/api/v1/grading-profiles/insights/teacher');
    assertApiError(insights401, 2001, 401);

    const adoption401 = await request(app)
      .post(`/api/v1/grading-profiles/${PROFILE_A}/suggestion-adoptions`)
      .send({ suggestionKey: 'diagnosisIntensity', beforeValue: 3, afterValue: 4 });
    assertApiError(adoption401, 2001, 401);
  });

  // ---------------- 本人采纳历史(Phase 5 批次④) ----------------

  it('G12: 本人采纳历史(时间倒序 + profileName 解析;已删档案 → null)', async () => {
    const { teacherA } = setupContexts();
    seedProfile({ id: PROFILE_A });
    // 已删除档案的采纳记录(不在 listVisible 返回中 → profileName=null)
    seedAdoption({
      profileId: 'gprofile-gi-deleted',
      suggestionKey: 'toneStrictness',
      beforeValue: 3,
      afterValue: 2,
      createdAt: new Date('2026-09-05T00:00:00Z'),
    });
    seedAdoption({
      profileId: PROFILE_A,
      suggestionKey: 'diagnosisIntensity',
      beforeValue: 3,
      afterValue: 4,
      createdAt: new Date('2026-09-08T00:00:00Z'),
    });

    const res = await request(app)
      .get('/api/v1/grading-profiles/insights/adoptions')
      .set(teacherA);
    assertApiResponse(res);

    const items = res.body.data.items;
    expect(items).toHaveLength(2);
    // 时间倒序:09-08 在前
    expect(items[0].profileId).toBe(PROFILE_A);
    expect(items[0].profileName).toBe('测试档案');
    expect(items[0].suggestionKey).toBe('diagnosisIntensity');
    expect(items[0].beforeValue).toBe(3);
    expect(items[0].afterValue).toBe(4);
    expect(items[0].createdAt).toBe('2026-09-08T00:00:00.000Z');
    // 已删档案:profileName=null
    expect(items[1].profileId).toBe('gprofile-gi-deleted');
    expect(items[1].profileName).toBeNull();
  });

  it('G13: 采纳历史租户隔离(仅本人记录;他人/他租户记录不可见)', async () => {
    const { teacherA, teacherB } = setupContexts();
    seedProfile({ id: PROFILE_A });
    seedProfile({ id: PROFILE_B, tenantId: TENANT_B, creatorId: TEACHER_B });
    // 本人记录
    seedAdoption({
      profileId: PROFILE_A,
      suggestionKey: 'diagnosisIntensity',
      beforeValue: 3,
      afterValue: 4,
      teacherId: TEACHER_A,
      tenantId: TENANT_A,
    });
    // 同租户其他教师的记录(teacherId 过滤)
    seedAdoption({
      profileId: PROFILE_A,
      suggestionKey: 'toneStrictness',
      beforeValue: 3,
      afterValue: 2,
      teacherId: TEACHER_A2,
      tenantId: TENANT_A,
    });
    // 他租户教师的记录(tenantId 过滤)
    seedAdoption({
      profileId: PROFILE_B,
      suggestionKey: 'positiveRatio',
      beforeValue: 0.3,
      afterValue: 0.25,
      teacherId: TEACHER_B,
      tenantId: TENANT_B,
    });

    const res = await request(app)
      .get('/api/v1/grading-profiles/insights/adoptions')
      .set(teacherA);
    assertApiResponse(res);
    const items = res.body.data.items;
    expect(items).toHaveLength(1);
    expect(items[0].teacherId).toBe(TEACHER_A);
    expect(items[0].suggestionKey).toBe('diagnosisIntensity');

    // 教师 B 视角:仅看到本人租户 B 记录
    const resB = await request(app)
      .get('/api/v1/grading-profiles/insights/adoptions')
      .set(teacherB);
    assertApiResponse(resB);
    expect(resB.body.data.items).toHaveLength(1);
    expect(resB.body.data.items[0].suggestionKey).toBe('positiveRatio');
  });

  it('G14: 采纳历史空数据不炸(items 空数组)', async () => {
    const { teacherA } = setupContexts();
    const res = await request(app)
      .get('/api/v1/grading-profiles/insights/adoptions')
      .set(teacherA);
    assertApiResponse(res);
    expect(res.body.data.items).toEqual([]);
  });
});
