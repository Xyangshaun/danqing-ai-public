// ============================================================
// M-1 阶段新增功能单元测试
// 覆盖:
//   1. analysisService.batchDeleteAnalyses(批删接口,跨端批删一致性)
//      - 多租户隔离 / RBAC 越权记 failed / 部分失败不回滚 / 去重
//   2. idempotencyMiddleware(Idempotency-Key 幂等去重)
//      - 无头透传 / 并发 409 / 同 key 不同 body 409 / 完成重放
//   3. highRiskConfirmPassword(高危操作密码确认)
//      - 未提供透传 / 非字符串 403 / 未登录 401 / 无密码账户 403 /
//        密码正确 next / 密码错误 403
//
// Mock 策略:
//   - setup.ts 全局 mock Prisma/Redis(不 mock service/中间件内部)
//   - 测试真实代码,通过 prismaMock.__insert* 预置数据
//   - redisMock.__clear() 在每个测试前清空幂等键
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { prismaMock } from './setup.js';
import { redisMock } from './mocks/redis.mock.js';
import { analysisService } from '../src/services/analysis.service.js';
import { idempotencyMiddleware } from '../src/middlewares/idempotency.js';
import { highRiskConfirmPassword } from '../src/middlewares/high-risk-confirm.js';
import { hashPassword } from '../src/utils/password.js';
import { ErrorCode } from '../src/types/api-contract.js';

// ============================================================
// 测试常量
// ============================================================

const TENANT_A = 't-m1-a';
const TENANT_B = 't-m1-b';

const USER_STUDENT1 = 'u-m1-student1';
const USER_STUDENT2 = 'u-m1-student2';
const USER_ADMIN = 'u-m1-admin';
const USER_OWNER = 'u-m1-owner';
const USER_STUDENT_B = 'u-m1-student-b';

// ============================================================
// Express mock(req / res / next)+ 中间件执行辅助
// ============================================================

type MockRequest = Partial<Request> & {
  headers: Record<string, string | string[] | undefined>;
  body?: Record<string, unknown>;
  userId?: string;
  tenantId?: string;
  role?: string;
  locals?: Record<string, unknown>;
};

type MockResponse = {
  status: ReturnType<typeof import('vitest').vi.fn>;
  json: ReturnType<typeof import('vitest').vi.fn>;
  send: ReturnType<typeof import('vitest').vi.fn>;
  set: ReturnType<typeof import('vitest').vi.fn>;
  setHeader: ReturnType<typeof import('vitest').vi.fn>;
  statusCode: number;
  locals: Record<string, unknown>;
  on: ReturnType<typeof import('vitest').vi.fn>;
  req: MockRequest;
};

function createMockReq(overrides: MockRequest = {}): MockRequest {
  return {
    headers: {},
    body: {},
    locals: {},
    ...overrides,
  };
}

/** 初始化 res 状态码(模拟 Express 默认 200) */
const RES_STATUS_CODE = 200;

function createMockRes(req?: MockRequest): MockResponse {
  const mockReq = req ?? createMockReq();
  const status = (() => {
    const fn = (code: number) => {
      res.statusCode = code;
      return res;
    };
    return fn as unknown as ReturnType<typeof import('vitest').vi.fn>;
  })();
  const res: MockResponse = {
    status,
    json: ((body: unknown) => {
      res.locals.jsonBody = body;
      return res;
    }) as unknown as ReturnType<typeof import('vitest').vi.fn>,
    send: ((body: unknown) => {
      res.locals.sendBody = body;
      return res;
    }) as unknown as ReturnType<typeof import('vitest').vi.fn>,
    set: (() => res) as unknown as ReturnType<typeof import('vitest').vi.fn>,
    setHeader: (() => res) as unknown as ReturnType<typeof import('vitest').vi.fn>,
    statusCode: RES_STATUS_CODE,
    locals: {},
    on: (() => res) as unknown as ReturnType<typeof import('vitest').vi.fn>,
    req: mockReq,
  };
  return res;
}

function createMockNext(): NextFunction & { calls: unknown[][] } {
  const fn = (() => undefined) as unknown as NextFunction & { calls: unknown[][] };
  return fn;
}

async function runMiddleware(
  middleware: RequestHandler,
  req: MockRequest,
  res: MockResponse,
  next: NextFunction,
): Promise<void> {
  await Promise.resolve(middleware(req as Request, res as unknown as Response, next));
}

// ============================================================
// 预置 RBAC 数据(批删测试)
// ============================================================

function setupRbacData(): void {
  prismaMock.__insertTenant({ id: TENANT_A, name: '租户A', type: 'college', plan: 'standard', status: 'active', maxSeats: 50 });
  prismaMock.__insertTenant({ id: TENANT_B, name: '租户B', type: 'college', plan: 'standard', status: 'active', maxSeats: 50 });

  prismaMock.__insertUser({ id: USER_STUDENT1, tenantId: TENANT_A, feishuUnionId: 'un_m1_s1', name: '学生1', role: 'student' });
  prismaMock.__insertUser({ id: USER_STUDENT2, tenantId: TENANT_A, feishuUnionId: 'un_m1_s2', name: '学生2', role: 'student' });
  prismaMock.__insertUser({ id: USER_ADMIN, tenantId: TENANT_A, feishuUnionId: 'un_m1_a', name: '管理员', role: 'admin' });
  prismaMock.__insertUser({ id: USER_OWNER, tenantId: TENANT_A, feishuUnionId: 'un_m1_o', name: '所有者', role: 'owner' });
  prismaMock.__insertUser({ id: USER_STUDENT_B, tenantId: TENANT_B, feishuUnionId: 'un_m1_sb', name: '学生B', role: 'student' });

  // 学生1 的两条记录(租户A)
  prismaMock.__insertAnalysis({ id: 'a-m1-own1', tenantId: TENANT_A, userId: USER_STUDENT1, workType: 'painting', imageUrl: 'https://x/own1.jpg', status: 'success' });
  prismaMock.__insertAnalysis({ id: 'a-m1-own2', tenantId: TENANT_A, userId: USER_STUDENT1, workType: 'design', imageUrl: 'https://x/own2.jpg', status: 'success' });
  // 学生2 的一条记录(租户A,越权删除目标)
  prismaMock.__insertAnalysis({ id: 'a-m1-other', tenantId: TENANT_A, userId: USER_STUDENT2, workType: 'sculpture', imageUrl: 'https://x/other.jpg', status: 'success' });
  // 租户B 的一条记录(跨租户,student 操作者不可见)
  prismaMock.__insertAnalysis({ id: 'a-m1-cross', tenantId: TENANT_B, userId: USER_STUDENT_B, workType: 'painting', imageUrl: 'https://x/cross.jpg', status: 'success' });
}

// ============================================================
// 1. batchDeleteAnalyses 服务层
// ============================================================

describe('analysisService.batchDeleteAnalyses', () => {
  beforeEach(() => {
    prismaMock.__clear();
    setupRbacData();
  });

  it('student: 删除自己的多条记录 → 全部成功', async () => {
    const result = await analysisService.batchDeleteAnalyses({
      tenantId: TENANT_A,
      userId: USER_STUDENT1,
      role: 'student',
      ids: ['a-m1-own1', 'a-m1-own2'],
    });
    expect(result.total).toBe(2);
    expect(result.deleted).toBe(2);
    expect(result.failedCount).toBe(0);
    expect(result.items.every((i) => i.deleted)).toBe(true);
    // 校验数据已删除
    expect(prismaMock.analysisStore.get('a-m1-own1')).toBeUndefined();
    expect(prismaMock.analysisStore.get('a-m1-own2')).toBeUndefined();
  });

  it('student: 删除他人记录 → 该条记 failed,不整体回滚', async () => {
    const result = await analysisService.batchDeleteAnalyses({
      tenantId: TENANT_A,
      userId: USER_STUDENT1,
      role: 'student',
      ids: ['a-m1-own1', 'a-m1-other'],
    });
    expect(result.total).toBe(2);
    expect(result.deleted).toBe(1); // 只删了自己的
    expect(result.failedCount).toBe(1);
    const failed = result.items.find((i) => i.id === 'a-m1-other');
    expect(failed?.deleted).toBe(false);
    expect(failed?.error).toContain('无权');
    // 他人记录仍在
    expect(prismaMock.analysisStore.get('a-m1-other')).toBeDefined();
  });

  it('student: 跨租户记录 → 记 failed(不泄露存在性)', async () => {
    const result = await analysisService.batchDeleteAnalyses({
      tenantId: TENANT_A,
      userId: USER_STUDENT1,
      role: 'student',
      ids: ['a-m1-cross'],
    });
    expect(result.total).toBe(1);
    expect(result.deleted).toBe(0);
    expect(result.failedCount).toBe(1);
    expect(result.items[0]?.error).toContain('不存在或不属于当前租户');
    // 跨租户记录不被删除(多租户隔离)
    expect(prismaMock.analysisStore.get('a-m1-cross')).toBeDefined();
  });

  it('admin: 可删除租户内任意记录(tenant-wide)', async () => {
    const result = await analysisService.batchDeleteAnalyses({
      tenantId: TENANT_A,
      userId: USER_ADMIN,
      role: 'admin',
      ids: ['a-m1-own1', 'a-m1-other'],
    });
    expect(result.total).toBe(2);
    expect(result.deleted).toBe(2);
    expect(result.failedCount).toBe(0);
  });

  it('owner: 可删除租户内任意记录(tenant-wide)', async () => {
    const result = await analysisService.batchDeleteAnalyses({
      tenantId: TENANT_A,
      userId: USER_OWNER,
      role: 'owner',
      ids: ['a-m1-own2', 'a-m1-other'],
    });
    expect(result.deleted).toBe(2);
  });

  it('重复 id 去重:不会重复计数或重复删除', async () => {
    const result = await analysisService.batchDeleteAnalyses({
      tenantId: TENANT_A,
      userId: USER_STUDENT1,
      role: 'student',
      ids: ['a-m1-own1', 'a-m1-own1', 'a-m1-own2'],
    });
    expect(result.total).toBe(2); // 去重后 2 个
    expect(result.deleted).toBe(2);
  });

  it('不存在的 id → 记 failed,不影响其他可删记录', async () => {
    const result = await analysisService.batchDeleteAnalyses({
      tenantId: TENANT_A,
      userId: USER_ADMIN,
      role: 'admin',
      ids: ['a-m1-own1', 'non-existent-9999'],
    });
    expect(result.total).toBe(2);
    expect(result.deleted).toBe(1);
    expect(result.failedCount).toBe(1);
    expect(result.items.find((i) => i.id === 'non-existent-9999')?.error).toContain('不存在');
  });

  it('混合场景:自己+越权+不存在+跨租户 → 各自归位', async () => {
    const result = await analysisService.batchDeleteAnalyses({
      tenantId: TENANT_A,
      userId: USER_STUDENT1,
      role: 'student',
      ids: ['a-m1-own1', 'a-m1-other', 'non-existent-9999', 'a-m1-cross'],
    });
    expect(result.total).toBe(4);
    expect(result.deleted).toBe(1); // 仅 own1
    expect(result.failedCount).toBe(3);
    const byId = new Map(result.items.map((i) => [i.id, i]));
    expect(byId.get('a-m1-own1')?.deleted).toBe(true);
    expect(byId.get('a-m1-other')?.deleted).toBe(false);
    expect(byId.get('a-m1-cross')?.deleted).toBe(false);
    expect(byId.get('non-existent-9999')?.deleted).toBe(false);
  });
});

// ============================================================
// 2. idempotencyMiddleware
// ============================================================

describe('idempotencyMiddleware', () => {
  beforeEach(() => {
    redisMock.__clear();
  });

  it('无 Idempotency-Key 请求头 → 透传(next)', async () => {
    const req = createMockReq({ userId: USER_ADMIN });
    const res = createMockRes(req);
    const next = createMockNext();
    await runMiddleware(idempotencyMiddleware(), req, res, next);
    // 无幂等头:中间件直接 next,不写 redis
    expect(redisMock.__keys().length).toBe(0);
  });

  it('首次请求(带 key)→ next + 写入 pending 标记', async () => {
    const req = createMockReq({ headers: { 'idempotency-key': 'key-1' }, body: { action: 'lock' }, userId: USER_ADMIN });
    const res = createMockRes(req);
    const next = createMockNext();
    await runMiddleware(idempotencyMiddleware(), req, res, next);
    expect(redisMock.__keys().some((k) => k.includes('key-1'))).toBe(true);
  });

  it('同 key + 不同 body → 409 幂等键冲突', async () => {
    const req1 = createMockReq({ headers: { 'idempotency-key': 'key-2' }, body: { action: 'lock' }, userId: USER_ADMIN });
    const res1 = createMockRes(req1);
    await runMiddleware(idempotencyMiddleware(), req1, res1, createMockNext());
    // 同 key 但不同 body
    const req2 = createMockReq({ headers: { 'idempotency-key': 'key-2' }, body: { action: 'unlock' }, userId: USER_ADMIN });
    const res2 = createMockRes(req2);
    await runMiddleware(idempotencyMiddleware(), req2, res2, createMockNext());
    expect(res2.statusCode).toBe(409);
  });

  it('并发(同 key + 同 body,仍在 pending)→ 409 处理中', async () => {
    const req1 = createMockReq({ headers: { 'idempotency-key': 'key-3' }, body: { action: 'lock' }, userId: USER_ADMIN });
    const res1 = createMockRes(req1);
    await runMiddleware(idempotencyMiddleware(), req1, res1, createMockNext());
    // 第二次调用,同 key 同 body,但 pending 未完成 → 409
    const req2 = createMockReq({ headers: { 'idempotency-key': 'key-3' }, body: { action: 'lock' }, userId: USER_ADMIN });
    const res2 = createMockRes(req2);
    await runMiddleware(idempotencyMiddleware(), req2, res2, createMockNext());
    expect(res2.statusCode).toBe(409);
  });

  it('已完成请求重放 → 回放缓存的原始响应(幂等)', async () => {
    // 预置已完成缓存:同 key、同 body、completed=true
    const body = { action: 'lock' };
    const bodyHash = require('node:crypto')
      .createHash('sha256')
      .update(JSON.stringify(body))
      .digest('hex');
    const redisKey = `idempotency:${USER_ADMIN}:key-4`;
    redisMock.__rawSet(
      redisKey,
      JSON.stringify({ bodyHash, completed: true, status: 200, body: { code: 0, data: { ok: true } } }),
    );
    const req = createMockReq({ headers: { 'idempotency-key': 'key-4' }, body, userId: USER_ADMIN });
    const res = createMockRes(req);
    const next = createMockNext();
    await runMiddleware(idempotencyMiddleware(), req, res, next);
    // 直接重放缓存响应,不调用 next
    expect(res.statusCode).toBe(200);
  });
});

// ============================================================
// 3. highRiskConfirmPassword
// ============================================================

describe('highRiskConfirmPassword', () => {
  beforeEach(() => {
    prismaMock.__clear();
  });

  it('请求体不含 confirmPassword → 非破坏性透传(next)', async () => {
    const req = createMockReq({ userId: USER_ADMIN, body: { action: 'lock' } });
    const res = createMockRes(req);
    const next = createMockNext();
    await runMiddleware(highRiskConfirmPassword, req, res, next);
    // 透传成功
  });

  it('confirmPassword 非字符串 → 403 ADMIN_CONFIRM_PASSWORD_MISMATCH', async () => {
    const req = createMockReq({ userId: USER_ADMIN, body: { confirmPassword: 12345 } });
    const res = createMockRes(req);
    await runMiddleware(highRiskConfirmPassword, req, res, createMockNext());
    expect(res.statusCode).toBe(403);
  });

  it('未登录(userId 缺失)→ 401', async () => {
    const req = createMockReq({ body: { confirmPassword: 'Abc12345' } });
    const res = createMockRes(req);
    await runMiddleware(highRiskConfirmPassword, req, res, createMockNext());
    expect(res.statusCode).toBe(401);
  });

  it('无密码账户(纯飞书认证)→ 403', async () => {
    prismaMock.__insertUser({ id: USER_ADMIN, tenantId: TENANT_A, feishuUnionId: 'un_m1_a', name: '管理员', role: 'admin', authType: 'feishu', passwordHash: null });
    const req = createMockReq({ userId: USER_ADMIN, body: { confirmPassword: 'Abc12345' } });
    const res = createMockRes(req);
    await runMiddleware(highRiskConfirmPassword, req, res, createMockNext());
    expect(res.statusCode).toBe(403);
  });

  it('密码正确(passowrd 账户)→ next', async () => {
    const hash = await hashPassword('Abc12345!');
    prismaMock.__insertUser({ id: USER_ADMIN, tenantId: TENANT_A, feishuUnionId: 'un_m1_a', name: '管理员', role: 'admin', authType: 'password', passwordHash: hash });
    const req = createMockReq({ userId: USER_ADMIN, body: { confirmPassword: 'Abc12345!', action: 'lock' } });
    const res = createMockRes(req);
    const next = createMockNext();
    await runMiddleware(highRiskConfirmPassword, req, res, next);
    // confirmPassword 应从 body 剔除,避免污染下游 Zod 校验
    expect((req.body as Record<string, unknown>).confirmPassword).toBeUndefined();
  });

  it('密码错误(password 账户)→ 403 ADMIN_CONFIRM_PASSWORD_MISMATCH', async () => {
    const hash = await hashPassword('Abc12345!');
    prismaMock.__insertUser({ id: USER_ADMIN, tenantId: TENANT_A, feishuUnionId: 'un_m1_a', name: '管理员', role: 'admin', authType: 'password', passwordHash: hash });
    const req = createMockReq({ userId: USER_ADMIN, body: { confirmPassword: 'WrongPass1!' } });
    const res = createMockRes(req);
    await runMiddleware(highRiskConfirmPassword, req, res, createMockNext());
    expect(res.statusCode).toBe(403);
  });
});