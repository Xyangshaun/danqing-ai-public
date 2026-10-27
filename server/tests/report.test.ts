// ============================================================
// 投诉举报 路由 + Controller + Service + Repository 集成测试
// (公安备案合规)
// 对应源码:
//   src/routes/report.routes.ts + src/controllers/report.controller.ts
//   + src/services/report.service.ts + src/repositories/report.repository.ts
// 对应契约:src/types/api-contract.ts §3.23
//
// 测试范围(至少覆盖要求的核心五项):
//   1. 成功创建:POST /reports 合法 body → 201 + { id, status: 'pending', createdAt }
//      并校验落库上下文(tenantId/reporterId 由 JWT 注入,非请求体)
//   2. 重复举报被拒:同用户同目标 24h 内 → 409 + code=1005(DUPLICATE_RESOURCE)
//      且 24h 窗口外不误伤
//   3. 未登录:无 Authorization → 401 + code=2001,不落库
//   4. 参数非法:非法枚举/缺 targetId/detail 超 500 字 → 400 + code=1001
//   5. 管理员列表分页:GET /reports(admin)→ 分页结构 + 举报人脱敏
//      + status 过滤 + 多租户隔离 + teacher 403
//
// Mock 策略(对齐 tests 现有风格):
//   - mock auth/tenant/rate-limit 中间件(mock auth 按 token 注入测试身份)
//   - Redis/Prisma 由 tests/setup.ts 全局 mock(内存实现)
//   - validate / permission / controller / service / repository 保持真实
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { reportRouter } from '../src/routes/report.routes.js';
import { listReports } from '../src/controllers/report.controller.js';
import { requirePermission } from '../src/middlewares/permission.js';
import { errorHandler } from '../src/middlewares/error-handler.js';
import { ErrorCode } from '../src/types/api-contract.js';
import { prismaMock } from './mocks/prisma.mock.js';

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
      'Bearer admin-token': { userId: 'u-admin', tenantId: 't-a', role: 'admin' },
      'Bearer teacher-token': { userId: 'u-teacher', tenantId: 't-a', role: 'teacher' },
      'Bearer student-token': { userId: 'u-student', tenantId: 't-a', role: 'student' },
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
  // 模拟限流:apiRateLimiter()/reportRateLimiter() 返回放行中间件(避免依赖 Redis Lua)
  mockRateLimit: vi.fn(() => vi.fn((_req: any, _res: any, next: () => void) => next())),
}));

vi.mock('../src/middlewares/auth.js', () => ({ authMiddleware: mockAuth }));
vi.mock('../src/middlewares/tenant.js', () => ({ tenantMiddleware: mockTenant }));
vi.mock('../src/middlewares/rate-limit.js', () => ({
  apiRateLimiter: mockRateLimit,
  reportRateLimiter: mockRateLimit,
}));

// ============================================================
// 测试 App 组装(与真实 app.ts 行为一致:json parser + router + errorHandler)
// ============================================================

// 用户端:POST /reports(挂真实 reportRouter,validate 中间件保持真实)
const userApp = express();
userApp.use(express.json());
userApp.use(reportRouter);
userApp.use(errorHandler);

// 管理端:GET /reports(组装 admin.routes 中的同款链路:permission → handler)
const adminApp = express();
adminApp.use(express.json());
adminApp.use(mockAuth);
adminApp.get('/reports', requirePermission('admin:report:read'), listReports);
adminApp.use(errorHandler);

/** 有效身份头 */
const STUDENT_AUTH = 'Bearer student-token';
const ADMIN_AUTH = 'Bearer admin-token';
const TEACHER_AUTH = 'Bearer teacher-token';

/** 构造合法举报 body */
function makeBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    targetType: 'artwork',
    targetId: 'target-1',
    reason: 'porn',
    detail: '该作品包含不当内容',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.__insertTenant({ id: 't-a', name: '租户A' });
  prismaMock.__insertTenant({ id: 't-b', name: '租户B' });
  prismaMock.__insertUser({ id: 'u-student', tenantId: 't-a', feishuUnionId: 'un-student', name: '学生甲', email: 'zhangsan@example.com', phone: '13812341234' });
  prismaMock.__insertUser({ id: 'u-student-b', tenantId: 't-b', feishuUnionId: 'un-student-b', name: '学生乙' });
  prismaMock.__insertUser({ id: 'u-admin', tenantId: 't-a', feishuUnionId: 'un-admin', name: '管理员' });
});

// ------------------------------------------------------------
// 1. 成功创建
// ------------------------------------------------------------

describe('POST /reports 成功创建', () => {
  it('合法 body → 201 + { id, status: "pending", createdAt },并落库鉴权上下文', async () => {
    const res = await request(userApp).post('/').set('Authorization', STUDENT_AUTH).send(makeBody());

    expect(res.status).toBe(201);
    expect(res.body.code).toBe(0);
    expect(res.body.message).toBe('举报已提交');
    expect(typeof res.body.data.id).toBe('string');
    expect(res.body.data.id.length).toBeGreaterThan(0);
    expect(res.body.data.status).toBe('pending');
    expect(typeof res.body.data.createdAt).toBe('string');
    expect(Number.isNaN(Date.parse(res.body.data.createdAt))).toBe(false);

    // 落库断言:tenantId/reporterId 来自 JWT 注入(多租户上下文),status 初始 pending
    expect(prismaMock.reportStore.size).toBe(1);
    const stored = Array.from(prismaMock.reportStore.values())[0]!;
    expect(stored.tenantId).toBe('t-a');
    expect(stored.reporterId).toBe('u-student');
    expect(stored.targetType).toBe('artwork');
    expect(stored.targetId).toBe('target-1');
    expect(stored.reason).toBe('porn');
    expect(stored.detail).toBe('该作品包含不当内容');
    expect(stored.status).toBe('pending');
  });

  it('detail 缺省(可选字段)→ 201 且落库 detail 为 null', async () => {
    const body = makeBody();
    delete (body as Record<string, unknown>).detail;

    const res = await request(userApp).post('/').set('Authorization', STUDENT_AUTH).send(body);

    expect(res.status).toBe(201);
    expect(res.body.code).toBe(0);
    const stored = Array.from(prismaMock.reportStore.values())[0]!;
    expect(stored.detail).toBeNull();
  });

  it('detail 满 500 字(边界)→ 201', async () => {
    const res = await request(userApp)
      .post('/')
      .set('Authorization', STUDENT_AUTH)
      .send(makeBody({ detail: 'x'.repeat(500) }));

    expect(res.status).toBe(201);
    expect(res.body.code).toBe(0);
  });

  it('任意角色均可举报(student/teacher/admin)→ 201', async () => {
    for (const auth of [STUDENT_AUTH, TEACHER_AUTH, ADMIN_AUTH]) {
      const res = await request(userApp)
        .post('/')
        .set('Authorization', auth)
        .send(makeBody({ targetId: `target-${auth}` }));
      expect(res.status).toBe(201);
    }
    expect(prismaMock.reportStore.size).toBe(3);
  });

  it('24h 窗口外的同用户同目标举报不受去重限制 → 201', async () => {
    // 预置 25 小时前的历史举报(同用户同目标)
    prismaMock.__insertReport({
      id: 'report-old',
      tenantId: 't-a',
      reporterId: 'u-student',
      targetType: 'artwork',
      targetId: 'target-1',
      reason: 'spam',
      createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
    });

    const res = await request(userApp).post('/').set('Authorization', STUDENT_AUTH).send(makeBody());

    expect(res.status).toBe(201);
    expect(res.body.code).toBe(0);
    expect(prismaMock.reportStore.size).toBe(2);
  });
});

// ------------------------------------------------------------
// 2. 重复举报被拒(24h 去重)
// ------------------------------------------------------------

describe('POST /reports 24h 去重', () => {
  it('同用户同目标 24h 内重复举报 → 409 + code=1005,不重复落库', async () => {
    const first = await request(userApp).post('/').set('Authorization', STUDENT_AUTH).send(makeBody());
    expect(first.status).toBe(201);

    const second = await request(userApp).post('/').set('Authorization', STUDENT_AUTH).send(makeBody());
    expect(second.status).toBe(409);
    expect(second.body.code).toBe(ErrorCode.DUPLICATE_RESOURCE);
    expect(second.body.message).toContain('24 小时内已举报过该内容');
    expect(prismaMock.reportStore.size).toBe(1);
  });

  it('同用户对不同目标可分别举报 → 均 201', async () => {
    const r1 = await request(userApp).post('/').set('Authorization', STUDENT_AUTH).send(makeBody({ targetId: 'a-1' }));
    const r2 = await request(userApp).post('/').set('Authorization', STUDENT_AUTH).send(makeBody({ targetId: 'a-2' }));

    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    expect(prismaMock.reportStore.size).toBe(2);
  });

  it('不同用户对同一目标 24h 内可各自举报 → 均 201', async () => {
    const r1 = await request(userApp).post('/').set('Authorization', STUDENT_AUTH).send(makeBody());
    const r2 = await request(userApp)
      .post('/')
      .set('Authorization', 'Bearer student-b-token')
      .send(makeBody());

    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    expect(prismaMock.reportStore.size).toBe(2);
  });
});

// ------------------------------------------------------------
// 3. 未登录
// ------------------------------------------------------------

describe('POST /reports 鉴权', () => {
  it('无 Authorization → 401 + code=2001,不落库', async () => {
    const res = await request(userApp).post('/').send(makeBody());

    expect(res.status).toBe(401);
    expect(res.body.code).toBe(ErrorCode.UNAUTHORIZED);
    expect(prismaMock.reportStore.size).toBe(0);
  });

  it('未知 token → 401,不落库', async () => {
    const res = await request(userApp).post('/').set('Authorization', 'Bearer invalid-token').send(makeBody());

    expect(res.status).toBe(401);
    expect(res.body.code).toBe(ErrorCode.UNAUTHORIZED);
    expect(prismaMock.reportStore.size).toBe(0);
  });
});

// ------------------------------------------------------------
// 4. 参数非法(Zod 校验)
// ------------------------------------------------------------

describe('POST /reports 参数校验', () => {
  it('非法 targetType → 400 + code=1001', async () => {
    const res = await request(userApp)
      .post('/')
      .set('Authorization', STUDENT_AUTH)
      .send(makeBody({ targetType: 'video' }));

    expect(res.status).toBe(400);
    expect(res.body.code).toBe(ErrorCode.PARAM_INVALID);
    expect(prismaMock.reportStore.size).toBe(0);
  });

  it('非法 reason → 400 + code=1001', async () => {
    const res = await request(userApp)
      .post('/')
      .set('Authorization', STUDENT_AUTH)
      .send(makeBody({ reason: 'abuse' }));

    expect(res.status).toBe(400);
    expect(res.body.code).toBe(ErrorCode.PARAM_INVALID);
    expect(prismaMock.reportStore.size).toBe(0);
  });

  it('缺失 targetId → 400 + code=1001', async () => {
    const body = makeBody();
    delete (body as Record<string, unknown>).targetId;

    const res = await request(userApp).post('/').set('Authorization', STUDENT_AUTH).send(body);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe(ErrorCode.PARAM_INVALID);
    expect(prismaMock.reportStore.size).toBe(0);
  });

  it('detail 超 500 字 → 400 + code=1001', async () => {
    const res = await request(userApp)
      .post('/')
      .set('Authorization', STUDENT_AUTH)
      .send(makeBody({ detail: 'x'.repeat(501) }));

    expect(res.status).toBe(400);
    expect(res.body.code).toBe(ErrorCode.PARAM_INVALID);
    expect(res.body.message).toContain('500');
    expect(prismaMock.reportStore.size).toBe(0);
  });
});

// ------------------------------------------------------------
// 5. 管理员列表分页(GET /reports,admin)
// ------------------------------------------------------------

describe('GET /reports(管理端,仅 ADMIN/OWNER)', () => {
  /** 预置租户 A 的 3 条举报(不同时间/状态/目标)与租户 B 的 1 条(隔离验证) */
  function seedReports(): void {
    const base = Date.now();
    prismaMock.__insertReport({
      id: 'r-1',
      tenantId: 't-a',
      reporterId: 'u-student',
      targetType: 'artwork',
      targetId: 'art-1',
      reason: 'porn',
      detail: '涉黄内容',
      status: 'pending',
      createdAt: new Date(base - 1000),
    });
    prismaMock.__insertReport({
      id: 'r-2',
      tenantId: 't-a',
      reporterId: 'u-student',
      targetType: 'comment',
      targetId: 'comment-1',
      reason: 'spam',
      detail: null,
      status: 'resolved',
      createdAt: new Date(base - 2000),
    });
    prismaMock.__insertReport({
      id: 'r-3',
      tenantId: 't-a',
      reporterId: 'u-student',
      targetType: 'user',
      targetId: 'user-1',
      reason: 'other',
      detail: '其他违规',
      status: 'pending',
      createdAt: new Date(base - 3000),
    });
    // 租户 B 的举报(隔离:不应出现在租户 A 管理员视图中)
    prismaMock.__insertReport({
      id: 'r-b-1',
      tenantId: 't-b',
      reporterId: 'u-student-b',
      targetType: 'artwork',
      targetId: 'art-x',
      reason: 'copyright',
      status: 'pending',
      createdAt: new Date(base - 500),
    });
  }

  it('admin → 200 + 分页结构 + 举报人脱敏(name 保留/email/phone 掩码)', async () => {
    seedReports();

    const res = await request(adminApp).get('/reports').set('Authorization', ADMIN_AUTH);

    expect(res.status).toBe(200);
    expect(res.body.code).toBe(0);
    const data = res.body.data;
    expect(data.total).toBe(3);
    expect(data.page).toBe(1);
    expect(data.pageSize).toBe(20);
    expect(data.hasMore).toBe(false);
    expect(data.items).toHaveLength(3);

    // 排序:createdAt 倒序(最新优先)
    expect(data.items[0]!.id).toBe('r-1');
    expect(data.items[2]!.id).toBe('r-3');

    // 字段完整性:目标类型/ID/理由/详情/状态/时间
    const first = data.items[0]!;
    expect(first.tenantId).toBe('t-a');
    expect(first.targetType).toBe('artwork');
    expect(first.targetId).toBe('art-1');
    expect(first.reason).toBe('porn');
    expect(first.detail).toBe('涉黄内容');
    expect(first.status).toBe('pending');
    expect(typeof first.createdAt).toBe('string');

    // 举报人脱敏:email → z***@example.com;phone → 138****1234;不泄露完整值
    expect(first.reporter.id).toBe('u-student');
    expect(first.reporter.name).toBe('学生甲');
    expect(first.reporter.email).toBe('z***@example.com');
    expect(first.reporter.phone).toBe('138****1234');
    expect(first.reporter.email).not.toBe('zhangsan@example.com');
    expect(first.reporter.phone).not.toBe('13812341234');
  });

  it('status 过滤生效(pending)→ 仅返回待处理举报', async () => {
    seedReports();

    const res = await request(adminApp).get('/reports').query({ status: 'pending' }).set('Authorization', ADMIN_AUTH);

    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(2);
    expect(res.body.data.items.every((i: { status: string }) => i.status === 'pending')).toBe(true);
  });

  it('分页:pageSize=1 共 3 条 → items 长度 1/total 3/hasMore true,page=2 返回第二页', async () => {
    seedReports();

    const page1 = await request(adminApp)
      .get('/reports')
      .query({ page: 1, pageSize: 1 })
      .set('Authorization', ADMIN_AUTH);
    expect(page1.status).toBe(200);
    expect(page1.body.data.items).toHaveLength(1);
    expect(page1.body.data.total).toBe(3);
    expect(page1.body.data.page).toBe(1);
    expect(page1.body.data.pageSize).toBe(1);
    expect(page1.body.data.hasMore).toBe(true);
    expect(page1.body.data.items[0]!.id).toBe('r-1');

    const page2 = await request(adminApp)
      .get('/reports')
      .query({ page: 2, pageSize: 1 })
      .set('Authorization', ADMIN_AUTH);
    expect(page2.status).toBe(200);
    expect(page2.body.data.items[0]!.id).toBe('r-2');
    expect(page2.body.data.hasMore).toBe(true);
  });

  it('多租户隔离:仅返回当前租户(t-a)的举报', async () => {
    seedReports();

    const res = await request(adminApp).get('/reports').set('Authorization', ADMIN_AUTH);

    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(3);
    expect(res.body.data.items.every((i: { tenantId: string }) => i.tenantId === 't-a')).toBe(true);
    expect(res.body.data.items.some((i: { id: string }) => i.id === 'r-b-1')).toBe(false);
  });

  it('teacher 角色 → 403 + code=2004(admin:report:read 仅 ADMIN/OWNER)', async () => {
    seedReports();

    const res = await request(adminApp).get('/reports').set('Authorization', TEACHER_AUTH);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe(ErrorCode.FORBIDDEN);
  });

  it('未登录 → 401', async () => {
    const res = await request(adminApp).get('/reports');

    expect(res.status).toBe(401);
    expect(res.body.code).toBe(ErrorCode.UNAUTHORIZED);
  });
});
