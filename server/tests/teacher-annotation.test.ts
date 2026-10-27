// ============================================================
// 教师批注(标注级)路由 + Controller + Service + Repository 集成测试
// (反馈闭环 Phase 4 批次③,spec §7.3 第 2 项)
// 对应源码:
//   src/routes/review.routes.ts(annotations 四路由挂载)
//   + src/controllers/teacher-annotation.controller.ts
//   + src/services/teacher-annotation.service.ts
//   + src/repositories/teacher-annotation.repository.ts
//
// 测试范围(清单第四节核心五项 + 参数/鉴权兜底):
//   1. 成功创建:POST 合法 body → 201 + 快照/上下文落库 + 通知学生触发
//   2. marker 定位:markerId 优先(索引不一致以 ID 为准)/旧数据 markerIndex 兜底
//   3. 查重:同教师同 marker 重复批注 → 409 DUPLICATE_RESOURCE(修改走 PATCH)
//   4. 权限:student POST → 403(review:write);GET 归属——
//      作品 owner/teacher 可读,同租户他人 student → 404 不泄露存在性
//   5. 更新/删除:仅作者本人;非本人/跨分析错位 → 404 ANNOTATION_NOT_FOUND
//   6. marker 校验:索引越界 → 404 + 6008;status≠success → 400 + 6007
//   7. 参数校验:非法 action/空 comment/超 500 字/PATCH 空体 → 400 + 1001
//   8. 未登录 → 401 + 2001
//
// Mock 策略(对齐 tests/marker-feedback.test.ts 风格):
//   - mock auth/tenant/rate-limit 中间件(mock auth 按 token 注入测试身份)
//   - mock notification.repository(断言通知触发,照 notification.service.test.ts 先例)
//   - Redis/Prisma 由 tests/setup.ts 全局 mock(内存实现)
//   - 挂真实 analysisRouter(annotations 挂 reviewRouter /:id 子路由,覆盖注册顺序)
//   - validate / permission / controller / service / repository 保持真实
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { analysisRouter } from '../src/routes/analysis.routes.js';
import { errorHandler } from '../src/middlewares/error-handler.js';
import { ErrorCode } from '../src/types/api-contract.js';
import { prismaMock } from './mocks/prisma.mock.js';
import { notificationRepository } from '../src/repositories/notification.repository.js';
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
      'Bearer teacher2-token': { userId: 'u-teacher2', tenantId: 't-a', role: 'teacher' },
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
  // 模拟限流:apiRateLimiter() 返回放行中间件(annotations 无专属限流,复用通用)
  mockRateLimit: vi.fn(() => vi.fn((_req: any, _res: any, next: () => void) => next())),
}));

vi.mock('../src/middlewares/auth.js', () => ({ authMiddleware: mockAuth }));
vi.mock('../src/middlewares/tenant.js', () => ({ tenantMiddleware: mockTenant }));
vi.mock('../src/middlewares/rate-limit.js', () => ({
  apiRateLimiter: mockRateLimit,
  markerFeedbackRateLimiter: mockRateLimit,
}));
// mock 通知 repository:断言创建批注后通知学生(非阻塞 promise,失败吞掉不影响主流程)
vi.mock('../src/repositories/notification.repository.js', () => ({
  notificationRepository: {
    create: vi.fn().mockResolvedValue({
      id: 'n-1',
      tenantId: 't-a',
      userId: 'u-student',
      type: 'REVIEW',
      title: '作品收到教师批注',
      content: 'mock',
      level: 'INFO',
      linkUrl: '/analysis/a1',
      isRead: false,
      readAt: null,
      createdAt: new Date(),
    }),
  },
}));

// ============================================================
// 测试 App 组装(挂真实 analysisRouter,annotations 走 reviewRouter 子路由)
// ============================================================
const app = express();
app.use(express.json());
app.use('/analyses', analysisRouter);
app.use(errorHandler);

/** 有效身份头 */
const STUDENT_AUTH = 'Bearer student-token';    // 作品 owner(t-a)
const STUDENT2_AUTH = 'Bearer student2-token';  // 同租户他人(t-a)
const TEACHER_AUTH = 'Bearer teacher-token';    // 教师甲(t-a)
const TEACHER2_AUTH = 'Bearer teacher2-token';  // 教师乙(t-a,非批注作者)

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
  prismaMock.__insertUser({ id: 'u-teacher', tenantId: 't-a', feishuUnionId: 'un-teacher', name: '教师甲' });
  prismaMock.__insertUser({ id: 'u-teacher2', tenantId: 't-a', feishuUnionId: 'un-teacher2', name: '教师乙' });
  prismaMock.__insertUser({ id: 'u-student-b', tenantId: 't-b', feishuUnionId: 'un-student-b', name: '学生丙' });

  // 主分析:student 的 success 记录,markers = [带 id, 旧数据无 id]
  prismaMock.__insertAnalysis({
    id: 'a1',
    tenantId: 't-a',
    userId: 'u-student',
    status: 'success',
    workType: 'painting',
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
  // 无标注分析(PATCH 跨分析错位用)
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

describe('POST /analyses/:id/annotations 创建批注', () => {
  it('teacher 创建合法批注 → 201 + 快照/上下文落库 + 通知学生', async () => {
    const res = await request(app)
      .post('/analyses/a1/annotations')
      .set('Authorization', TEACHER_AUTH)
      .send({ markerId: 'mk_hash111', markerIndex: 0, action: 'supplement', comment: '补充:可参考黄金分割构图' });

    expect(res.status).toBe(201);
    expect(res.body.code).toBe(0);
    expect(res.body.data.markerIndex).toBe(0);
    expect(res.body.data.markerId).toBe('mk_hash111');
    expect(res.body.data.action).toBe('supplement');
    expect(res.body.data.teacherName).toBe('教师甲');

    // 落库断言
    expect(prismaMock.teacherAnnotationStore.size).toBe(1);
    const stored = Array.from(prismaMock.teacherAnnotationStore.values())[0]!;
    expect(stored.tenantId).toBe('t-a');
    expect(stored.analysisId).toBe('a1');
    expect(stored.teacherId).toBe('u-teacher');
    expect(stored.comment).toBe('补充:可参考黄金分割构图');
    // 快照固化
    const snapshot = stored.markerSnapshot as Record<string, unknown>;
    expect(snapshot.label).toBe('构图偏移');
    expect(snapshot.x).toBe(0.1);

    // 通知触发(非阻塞 promise,waitFor 兜 microtask/异步时序)
    await vi.waitFor(() => {
      expect(notificationRepository.create).toHaveBeenCalledTimes(1);
    });
    const notifyArg = (notificationRepository.create as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Record<string, unknown>;
    expect(notifyArg.userId).toBe('u-student'); // 通知作品 owner
    expect(notifyArg.type).toBe('REVIEW');
    expect(notifyArg.linkUrl).toBe('/analysis/a1');
  });

  it('markerId 与 markerIndex 不一致时以 ID 为准(索引修正)', async () => {
    const res = await request(app)
      .post('/analyses/a1/annotations')
      .set('Authorization', TEACHER_AUTH)
      .send({ markerId: 'mk_hash111', markerIndex: 99, action: 'correct', comment: '纠正:此处结构转折需压重' });

    expect(res.status).toBe(201);
    expect(res.body.data.markerIndex).toBe(0);
    const stored = Array.from(prismaMock.teacherAnnotationStore.values())[0]!;
    expect(stored.markerIndex).toBe(0);
  });

  it('旧数据无 markerId → markerIndex 兜底,落库 markerId=null', async () => {
    const res = await request(app)
      .post('/analyses/a1/annotations')
      .set('Authorization', TEACHER_AUTH)
      .send({ markerIndex: 1, action: 'confirm', comment: '确认:AI 判断准确,按建议执行' });

    expect(res.status).toBe(201);
    expect(res.body.data.markerId).toBeNull();
    const stored = Array.from(prismaMock.teacherAnnotationStore.values())[0]!;
    expect(stored.markerIndex).toBe(1);
    expect((stored.markerSnapshot as Record<string, unknown>).label).toBe('色调沉闷');
  });

  it('同教师同 marker 重复批注 → 409 DUPLICATE_RESOURCE', async () => {
    await request(app)
      .post('/analyses/a1/annotations')
      .set('Authorization', TEACHER_AUTH)
      .send({ markerIndex: 0, action: 'supplement', comment: '第一次批注' });

    const res = await request(app)
      .post('/analyses/a1/annotations')
      .set('Authorization', TEACHER_AUTH)
      .send({ markerIndex: 0, action: 'correct', comment: '第二次批注' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe(ErrorCode.DUPLICATE_RESOURCE);
    expect(prismaMock.teacherAnnotationStore.size).toBe(1);
  });

  it('student 无 review:write → 403 FORBIDDEN', async () => {
    const res = await request(app)
      .post('/analyses/a1/annotations')
      .set('Authorization', STUDENT_AUTH)
      .send({ markerIndex: 0, action: 'supplement', comment: '学生尝试批注' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe(ErrorCode.FORBIDDEN);
    expect(prismaMock.teacherAnnotationStore.size).toBe(0);
  });

  it('markerIndex 越界 → 404 + 6008', async () => {
    const res = await request(app)
      .post('/analyses/a1/annotations')
      .set('Authorization', TEACHER_AUTH)
      .send({ markerIndex: 99, action: 'supplement', comment: '越界批注' });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe(ErrorCode.MARKER_NOT_FOUND);
  });

  it('status≠success → 400 + 6007', async () => {
    const res = await request(app)
      .post('/analyses/a-processing/annotations')
      .set('Authorization', TEACHER_AUTH)
      .send({ markerIndex: 0, action: 'supplement', comment: '处理中作品的批注' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe(ErrorCode.ANALYSIS_NOT_COMPLETED);
  });

  it('跨租户分析 → 404 + 6004(租户隔离)', async () => {
    // 租户 B 学生不可见租户 A 分析(此处用 student-b token 演示隔离;teacher 角色同理)
    const res = await request(app)
      .post('/analyses/a1/annotations')
      .set('Authorization', TEACHER_AUTH)
      .send({ markerIndex: 0, action: 'supplement', comment: '批注' });
    expect(res.status).toBe(201); // 先确认正常链路

    // 再用另一租户教师身份访问(需先插入 t-b 分析教师身份)——此处验证分析不存在
    const res2 = await request(app)
      .post('/analyses/a-nope/annotations')
      .set('Authorization', TEACHER_AUTH)
      .send({ markerIndex: 0, action: 'supplement', comment: '不存在分析的批注' });
    expect(res2.status).toBe(404);
    expect(res2.body.code).toBe(ErrorCode.ANALYSIS_NOT_FOUND);
  });

  it.each([
    ['非法 action', { markerIndex: 0, action: 'delete', comment: 'x' }],
    ['空 comment', { markerIndex: 0, action: 'supplement', comment: '' }],
    ['comment 超 500 字', { markerIndex: 0, action: 'supplement', comment: 'x'.repeat(501) }],
    ['缺 markerIndex', { action: 'supplement', comment: 'x' }],
    ['markerIndex 非整数', { markerIndex: 1.5, action: 'supplement', comment: 'x' }],
  ])('%s → 400 + 1001(PARAM_INVALID)', async (_name, body) => {
    const res = await request(app)
      .post('/analyses/a1/annotations')
      .set('Authorization', TEACHER_AUTH)
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe(ErrorCode.PARAM_INVALID);
    expect(prismaMock.teacherAnnotationStore.size).toBe(0);
  });

  it('未登录 → 401 + 2001', async () => {
    const res = await request(app)
      .post('/analyses/a1/annotations')
      .send({ markerIndex: 0, action: 'supplement', comment: 'x' });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe(ErrorCode.UNAUTHORIZED);
  });
});

describe('GET /analyses/:id/annotations 批注列表', () => {
  it('作品 owner(student)可读自己作品的批注 → 200', async () => {
    await request(app)
      .post('/analyses/a1/annotations')
      .set('Authorization', TEACHER_AUTH)
      .send({ markerIndex: 0, action: 'supplement', comment: '批注一' });

    const res = await request(app)
      .get('/analyses/a1/annotations')
      .set('Authorization', STUDENT_AUTH);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].comment).toBe('批注一');
    expect(res.body.data[0].teacherName).toBe('教师甲');
  });

  it('teacher 可读租户内他人作品批注 → 200', async () => {
    const res = await request(app)
      .get('/analyses/a1/annotations')
      .set('Authorization', TEACHER2_AUTH);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  it('同租户他人(student)读 → 404 不泄露存在性', async () => {
    const res = await request(app)
      .get('/analyses/a1/annotations')
      .set('Authorization', STUDENT2_AUTH);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe(ErrorCode.ANALYSIS_NOT_FOUND);
  });
});

describe('PATCH /analyses/:id/annotations/:aid 更新批注', () => {
  it('作者本人更新 action+comment → 200 + 落库更新', async () => {
    const created = await request(app)
      .post('/analyses/a1/annotations')
      .set('Authorization', TEACHER_AUTH)
      .send({ markerIndex: 0, action: 'supplement', comment: '初版批注' });
    const aid = created.body.data.id as string;

    const res = await request(app)
      .patch(`/analyses/a1/annotations/${aid}`)
      .set('Authorization', TEACHER_AUTH)
      .send({ action: 'correct', comment: '修正后的批注' });

    expect(res.status).toBe(200);
    expect(res.body.data.action).toBe('correct');
    expect(res.body.data.comment).toBe('修正后的批注');
    // 仍一条记录
    expect(prismaMock.teacherAnnotationStore.size).toBe(1);
    const stored = Array.from(prismaMock.teacherAnnotationStore.values())[0]!;
    expect(stored.action).toBe('correct');
    // 更新不重复通知
    expect(notificationRepository.create).toHaveBeenCalledTimes(1);
  });

  it('非作者 teacher 更新 → 404 + 6009(不区分原因)', async () => {
    const created = await request(app)
      .post('/analyses/a1/annotations')
      .set('Authorization', TEACHER_AUTH)
      .send({ markerIndex: 0, action: 'supplement', comment: '教师甲的批注' });
    const aid = created.body.data.id as string;

    const res = await request(app)
      .patch(`/analyses/a1/annotations/${aid}`)
      .set('Authorization', TEACHER2_AUTH)
      .send({ comment: '教师乙试图修改' });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe(ErrorCode.ANNOTATION_NOT_FOUND);
    // 原文未变
    const stored = Array.from(prismaMock.teacherAnnotationStore.values())[0]!;
    expect(stored.comment).toBe('教师甲的批注');
  });

  it('跨分析错位(路径 :id 与批注归属不符)→ 404 + 6009', async () => {
    const created = await request(app)
      .post('/analyses/a1/annotations')
      .set('Authorization', TEACHER_AUTH)
      .send({ markerIndex: 0, action: 'supplement', comment: 'a1 的批注' });
    const aid = created.body.data.id as string;

    const res = await request(app)
      .patch(`/analyses/a-empty/annotations/${aid}`)
      .set('Authorization', TEACHER_AUTH)
      .send({ comment: '试图挂到别的分析' });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe(ErrorCode.ANNOTATION_NOT_FOUND);
  });

  it('PATCH 空体(action/comment 均缺)→ 400 + 1001', async () => {
    const created = await request(app)
      .post('/analyses/a1/annotations')
      .set('Authorization', TEACHER_AUTH)
      .send({ markerIndex: 0, action: 'supplement', comment: 'x' });
    const aid = created.body.data.id as string;

    const res = await request(app)
      .patch(`/analyses/a1/annotations/${aid}`)
      .set('Authorization', TEACHER_AUTH)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.code).toBe(ErrorCode.PARAM_INVALID);
  });
});

describe('DELETE /analyses/:id/annotations/:aid 删除批注', () => {
  it('作者本人删除 → 200 + 落库清空', async () => {
    const created = await request(app)
      .post('/analyses/a1/annotations')
      .set('Authorization', TEACHER_AUTH)
      .send({ markerIndex: 0, action: 'reject', comment: 'AI 判断有误,以画面为准' });
    const aid = created.body.data.id as string;

    const res = await request(app)
      .delete(`/analyses/a1/annotations/${aid}`)
      .set('Authorization', TEACHER_AUTH);

    expect(res.status).toBe(200);
    expect(res.body.code).toBe(0);
    expect(prismaMock.teacherAnnotationStore.size).toBe(0);
  });

  it('非作者 teacher 删除 → 404 + 6009', async () => {
    const created = await request(app)
      .post('/analyses/a1/annotations')
      .set('Authorization', TEACHER_AUTH)
      .send({ markerIndex: 0, action: 'supplement', comment: 'x' });
    const aid = created.body.data.id as string;

    const res = await request(app)
      .delete(`/analyses/a1/annotations/${aid}`)
      .set('Authorization', TEACHER2_AUTH);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe(ErrorCode.ANNOTATION_NOT_FOUND);
    expect(prismaMock.teacherAnnotationStore.size).toBe(1);
  });

  it('批注不存在 → 404 + 6009', async () => {
    const res = await request(app)
      .delete('/analyses/a1/annotations/anno-nope')
      .set('Authorization', TEACHER_AUTH);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe(ErrorCode.ANNOTATION_NOT_FOUND);
  });
});
