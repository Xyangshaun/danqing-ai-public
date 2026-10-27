// ============================================================
// 标注反馈(数据飞轮)路由 + Controller + Service + Repository 集成测试
// (反馈闭环 Phase 4 批次②,spec §7.3 第 1 项)
// 对应源码:
//   src/routes/analysis.routes.ts(POST /analyses/:id/marker-feedback 挂载)
//   + src/controllers/marker-feedback.controller.ts
//   + src/services/marker-feedback.service.ts
//   + src/repositories/marker-feedback.repository.ts
//
// 测试范围(清单第三节核心四项 + 参数/鉴权兜底):
//   1. 成功创建:合法 body → 200 + data{markerIndex,markerId,action}
//      并校验落库上下文(tenantId/userId 来自 JWT;markerSnapshot 全特征固化;
//      workType/diagnosisMode 冗余落库供训练侧聚合)
//   2. marker 定位:markerId 优先(索引不一致以 ID 为准)/旧数据 markerIndex 兜底
//   3. upsert 语义:同用户同 marker 切换 up/down 仅一条记录(update 分支)
//   4. 归属校验:同租户他人/跨租户 → 统一 404 + 6004(不泄露存在性);
//      teacher(canReadTenantWide)可反馈租户内他人
//   5. 状态校验:status≠success → 400 + 6007(ANALYSIS_NOT_COMPLETED)
//   6. marker 校验:索引越界/markerId 无匹配/无标注数据 → 404 + 6008(MARKER_NOT_FOUND)
//   7. 参数校验:非法 action/负数索引/缺 markerIndex → 400 + 1001(validate 中间件)
//   8. 未登录:无 Authorization → 401 + 2001
//
// Mock 策略(对齐 tests/report.test.ts 风格):
//   - mock auth/tenant/rate-limit 中间件(mock auth 按 token 注入测试身份)
//   - Redis/Prisma 由 tests/setup.ts 全局 mock(内存实现)
//   - 挂真实 analysisRouter(覆盖路由注册顺序 + 权限 + validate 链路)
//   - validate / permission / controller / service / repository 保持真实
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { analysisRouter } from '../src/routes/analysis.routes.js';
import { errorHandler } from '../src/middlewares/error-handler.js';
import { ErrorCode } from '../src/types/api-contract.js';
import { prismaMock } from './mocks/prisma.mock.js';
import type { IssueMarker } from '../src/types/ai-analysis.js';

// ============================================================
// vi.hoisted:mock 中间件(mock 工厂被提升,需在 hoisted 中定义)
// ============================================================
const { mockAuth, mockTenant, mockRateLimit } = vi.hoisted(() => ({
  // 模拟 auth 中间件:按 token 分发测试身份;无/未知 token → 401
  mockAuth: vi.fn((req: any, res: any, next: () => void) => {
    const auth = req.header('Authorization') as string | undefined;
    if (!auth || !auth.startsWith('Bearer ')) {
      return res
        .status(401)
        .json({ code: ErrorCode.UNAUTHORIZED, message: '未授权,请先登录', data: null, traceId: 'test-trace' });
    }
    const identities: Record<string, { userId: string; tenantId: string; role: string }> = {
      'Bearer student-token': { userId: 'u-student', tenantId: 't-a', role: 'student' },
      'Bearer student2-token': { userId: 'u-student2', tenantId: 't-a', role: 'student' },
      'Bearer teacher-token': { userId: 'u-teacher', tenantId: 't-a', role: 'teacher' },
      'Bearer student-b-token': { userId: 'u-student-b', tenantId: 't-b', role: 'student' },
    };
    const identity = identities[auth];
    if (!identity) {
      return res
        .status(401)
        .json({ code: ErrorCode.UNAUTHORIZED, message: '未授权,请先登录', data: null, traceId: 'test-trace' });
    }
    req.userId = identity.userId;
    req.tenantId = identity.tenantId;
    req.role = identity.role;
    req.authType = 'feishu';
    req.jti = 'jti-test';
    return next();
  }),
  // 模拟 tenant 中间件:直接放行(auth 已注入 tenantId)
  mockTenant: vi.fn((_req: any, _res: any, next: () => void) => next()),
  // 模拟限流:apiRateLimiter()/markerFeedbackRateLimiter() 返回放行中间件(避免依赖 Redis Lua)
  mockRateLimit: vi.fn(() => vi.fn((_req: any, _res: any, next: () => void) => next())),
}));

vi.mock('../src/middlewares/auth.js', () => ({ authMiddleware: mockAuth }));
vi.mock('../src/middlewares/tenant.js', () => ({ tenantMiddleware: mockTenant }));
vi.mock('../src/middlewares/rate-limit.js', () => ({
  apiRateLimiter: mockRateLimit,
  markerFeedbackRateLimiter: mockRateLimit,
}));

// ============================================================
// 测试 App 组装(挂真实 analysisRouter,与 app.ts 的 /analyses 前缀一致)
// ============================================================
const app = express();
app.use(express.json());
app.use('/analyses', analysisRouter);
app.use(errorHandler);

/** 有效身份头 */
const STUDENT_AUTH = 'Bearer student-token';
const STUDENT2_AUTH = 'Bearer student2-token';
const TEACHER_AUTH = 'Bearer teacher-token';
const STUDENT_B_AUTH = 'Bearer student-b-token';

/** 新数据 marker(批次①后管线注入确定性短 hash id) */
const markerWithId: IssueMarker = {
  id: 'mk_hash111',
  x: 0.1, y: 0.2, w: 0.3, h: 0.2,
  label: '构图偏移',
  severity: 'high',
  improvementHint: '视觉重心向左下偏移',
  type: 'critical',
  dimension: '构图',
  why: '主体紧贴画面右缘,视觉失衡',
  how: '将主体移入黄金分割点附近',
};

/** 旧数据 marker(无 id,由 markerIndex 兜底) */
const legacyMarker: IssueMarker = {
  x: 0.5, y: 0.5, w: 0.2, h: 0.2,
  label: '色调沉闷',
  severity: 'medium',
  improvementHint: '拉开明度对比',
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.__insertTenant({ id: 't-a', name: '租户A' });
  prismaMock.__insertTenant({ id: 't-b', name: '租户B' });
  prismaMock.__insertUser({ id: 'u-student', tenantId: 't-a', feishuUnionId: 'un-student', name: '学生甲' });
  prismaMock.__insertUser({ id: 'u-student2', tenantId: 't-a', feishuUnionId: 'un-student2', name: '学生乙' });
  prismaMock.__insertUser({ id: 'u-teacher', tenantId: 't-a', feishuUnionId: 'un-teacher', name: '教师' });
  prismaMock.__insertUser({ id: 'u-student-b', tenantId: 't-b', feishuUnionId: 'un-student-b', name: '学生丙' });

  // 主分析:student 的 success 记录,markers = [带 id, 旧数据无 id]
  prismaMock.__insertAnalysis({
    id: 'a1',
    tenantId: 't-a',
    userId: 'u-student',
    status: 'success',
    workType: 'painting',
    diagnosisMode: 'teaching',
    result: { issueMarkers: [markerWithId, legacyMarker] },
  });
  // 处理中分析(状态校验用)
  prismaMock.__insertAnalysis({
    id: 'a-processing',
    tenantId: 't-a',
    userId: 'u-student',
    status: 'processing',
    result: null,
  });
  // 无标注数据分析(成功但 result 无 issueMarkers)
  prismaMock.__insertAnalysis({
    id: 'a-empty',
    tenantId: 't-a',
    userId: 'u-student',
    status: 'success',
    result: { overallComment: '整体尚可' },
  });
});

// ============================================================
// 测试用例
// ============================================================

describe('POST /analyses/:id/marker-feedback 数据飞轮采集', () => {
  // ------------------------------------------------------------
  // 1. 成功创建 + 快照固化
  // ------------------------------------------------------------
  it('新数据 markerId 定位 → 200 + 关键位返回,快照/上下文全量落库', async () => {
    const res = await request(app)
      .post('/analyses/a1/marker-feedback')
      .set('Authorization', STUDENT_AUTH)
      .send({ markerId: 'mk_hash111', markerIndex: 0, action: 'up' });

    expect(res.status).toBe(200);
    expect(res.body.code).toBe(0);
    expect(res.body.data).toEqual({ markerIndex: 0, markerId: 'mk_hash111', action: 'up' });

    // 落库断言:鉴权上下文 + 快照全特征 + 训练侧聚合冗余位
    expect(prismaMock.markerFeedbackStore.size).toBe(1);
    const stored = Array.from(prismaMock.markerFeedbackStore.values())[0]!;
    expect(stored.tenantId).toBe('t-a');
    expect(stored.userId).toBe('u-student');
    expect(stored.analysisId).toBe('a1');
    expect(stored.markerId).toBe('mk_hash111');
    expect(stored.markerIndex).toBe(0);
    expect(stored.action).toBe('up');
    expect(stored.workType).toBe('painting');
    expect(stored.diagnosisMode).toBe('teaching');
    // 快照固化(label/severity/type/dimension/why/how/坐标)
    const snapshot = stored.markerSnapshot as Record<string, unknown>;
    expect(snapshot.label).toBe('构图偏移');
    expect(snapshot.severity).toBe('high');
    expect(snapshot.type).toBe('critical');
    expect(snapshot.dimension).toBe('构图');
    expect(snapshot.why).toBe('主体紧贴画面右缘,视觉失衡');
    expect(snapshot.how).toBe('将主体移入黄金分割点附近');
    expect(snapshot.x).toBe(0.1);
    expect(snapshot.y).toBe(0.2);
    expect(snapshot.w).toBe(0.3);
    expect(snapshot.h).toBe(0.2);
  });

  it('markerId 与 markerIndex 不一致时以 ID 为准(索引修正)', async () => {
    const res = await request(app)
      .post('/analyses/a1/marker-feedback')
      .set('Authorization', STUDENT_AUTH)
      .send({ markerId: 'mk_hash111', markerIndex: 99, action: 'up' });

    expect(res.status).toBe(200);
    // 响应与落库均为 ID 定位出的真实索引 0
    expect(res.body.data.markerIndex).toBe(0);
    const stored = Array.from(prismaMock.markerFeedbackStore.values())[0]!;
    expect(stored.markerIndex).toBe(0);
  });

  it('旧数据无 markerId → markerIndex 兜底,落库 markerId=null', async () => {
    const res = await request(app)
      .post('/analyses/a1/marker-feedback')
      .set('Authorization', STUDENT_AUTH)
      .send({ markerIndex: 1, action: 'down' });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ markerIndex: 1, markerId: null, action: 'down' });
    const stored = Array.from(prismaMock.markerFeedbackStore.values())[0]!;
    expect(stored.markerId).toBeNull();
    expect(stored.markerIndex).toBe(1);
    // 旧数据快照同样固化
    expect((stored.markerSnapshot as Record<string, unknown>).label).toBe('色调沉闷');
  });

  // ------------------------------------------------------------
  // 2. upsert 语义(切换动作仅一条记录)
  // ------------------------------------------------------------
  it('同用户同 marker 切换 up → down → 仍一条记录,action 走 update', async () => {
    await request(app)
      .post('/analyses/a1/marker-feedback')
      .set('Authorization', STUDENT_AUTH)
      .send({ markerIndex: 0, action: 'up' });
    const res = await request(app)
      .post('/analyses/a1/marker-feedback')
      .set('Authorization', STUDENT_AUTH)
      .send({ markerIndex: 0, action: 'down' });

    expect(res.status).toBe(200);
    expect(res.body.data.action).toBe('down');
    expect(prismaMock.markerFeedbackStore.size).toBe(1);
    const stored = Array.from(prismaMock.markerFeedbackStore.values())[0]!;
    expect(stored.action).toBe('down');
  });

  it('不同用户对同一 marker 反馈 → 各自一条记录(互不覆盖)', async () => {
    await request(app)
      .post('/analyses/a1/marker-feedback')
      .set('Authorization', STUDENT_AUTH)
      .send({ markerIndex: 0, action: 'up' });
    // teacher 可读租户内他人分析(canReadTenantWide)
    const res = await request(app)
      .post('/analyses/a1/marker-feedback')
      .set('Authorization', TEACHER_AUTH)
      .send({ markerIndex: 0, action: 'down' });

    expect(res.status).toBe(200);
    expect(prismaMock.markerFeedbackStore.size).toBe(2);
  });

  // ------------------------------------------------------------
  // 3. 归属校验(统一 404 不泄露存在性)
  // ------------------------------------------------------------
  it('student 反馈同租户他人分析 → 404 + 6004(不泄露存在性)', async () => {
    const res = await request(app)
      .post('/analyses/a1/marker-feedback')
      .set('Authorization', STUDENT2_AUTH)
      .send({ markerIndex: 0, action: 'up' });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe(ErrorCode.ANALYSIS_NOT_FOUND);
    expect(prismaMock.markerFeedbackStore.size).toBe(0);
  });

  it('跨租户 student 反馈 → 404 + 6004(租户隔离)', async () => {
    const res = await request(app)
      .post('/analyses/a1/marker-feedback')
      .set('Authorization', STUDENT_B_AUTH)
      .send({ markerIndex: 0, action: 'up' });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe(ErrorCode.ANALYSIS_NOT_FOUND);
    expect(prismaMock.markerFeedbackStore.size).toBe(0);
  });

  it('分析不存在 → 404 + 6004', async () => {
    const res = await request(app)
      .post('/analyses/a-nope/marker-feedback')
      .set('Authorization', STUDENT_AUTH)
      .send({ markerIndex: 0, action: 'up' });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe(ErrorCode.ANALYSIS_NOT_FOUND);
  });

  // ------------------------------------------------------------
  // 4. 状态校验
  // ------------------------------------------------------------
  it('status≠success → 400 + 6007(ANALYSIS_NOT_COMPLETED)', async () => {
    const res = await request(app)
      .post('/analyses/a-processing/marker-feedback')
      .set('Authorization', STUDENT_AUTH)
      .send({ markerIndex: 0, action: 'up' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe(ErrorCode.ANALYSIS_NOT_COMPLETED);
    expect(prismaMock.markerFeedbackStore.size).toBe(0);
  });

  // ------------------------------------------------------------
  // 5. marker 校验
  // ------------------------------------------------------------
  it('markerIndex 越界且无 markerId → 404 + 6008(MARKER_NOT_FOUND)', async () => {
    const res = await request(app)
      .post('/analyses/a1/marker-feedback')
      .set('Authorization', STUDENT_AUTH)
      .send({ markerIndex: 99, action: 'up' });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe(ErrorCode.MARKER_NOT_FOUND);
    expect(prismaMock.markerFeedbackStore.size).toBe(0);
  });

  it('markerId 无匹配且索引越界 → 404 + 6008(防反馈悬挂)', async () => {
    const res = await request(app)
      .post('/analyses/a1/marker-feedback')
      .set('Authorization', STUDENT_AUTH)
      .send({ markerId: 'mk_ghost', markerIndex: 99, action: 'up' });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe(ErrorCode.MARKER_NOT_FOUND);
  });

  it('分析成功但无标注数据 → 404 + 6008', async () => {
    const res = await request(app)
      .post('/analyses/a-empty/marker-feedback')
      .set('Authorization', STUDENT_AUTH)
      .send({ markerIndex: 0, action: 'up' });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe(ErrorCode.MARKER_NOT_FOUND);
  });

  // ------------------------------------------------------------
  // 6. 参数校验(validate 中间件,Zod)
  // ------------------------------------------------------------
  it.each([
    ['非法 action', { markerIndex: 0, action: 'meh' }],
    ['负数 markerIndex', { markerIndex: -1, action: 'up' }],
    ['缺 markerIndex', { action: 'up' }],
    ['markerIndex 非整数', { markerIndex: 1.5, action: 'up' }],
    ['markerId 空串', { markerId: '', markerIndex: 0, action: 'up' }],
  ])('%s → 400 + 1001(PARAM_INVALID)', async (_name, body) => {
    const res = await request(app)
      .post('/analyses/a1/marker-feedback')
      .set('Authorization', STUDENT_AUTH)
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe(ErrorCode.PARAM_INVALID);
    expect(prismaMock.markerFeedbackStore.size).toBe(0);
  });

  // ------------------------------------------------------------
  // 7. 鉴权
  // ------------------------------------------------------------
  it('未登录 → 401 + 2001,不落库', async () => {
    const res = await request(app)
      .post('/analyses/a1/marker-feedback')
      .send({ markerIndex: 0, action: 'up' });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe(ErrorCode.UNAUTHORIZED);
    expect(prismaMock.markerFeedbackStore.size).toBe(0);
  });
});
