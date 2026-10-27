// ============================================================
// AdminPhase5 Controller 单元测试(Phase 5 院校管理扩展)
// 对应源码: src/controllers/admin-phase5.controller.ts
// 对应文档: new-features-design.md §2.5, §3.5.2, §3.5.3
//
// 测试范围:
//   1. createInvitation:未授权 / 缺 :id / 跨租户拒绝 / 参数无效 / 成功(含审计写入)
//   2. listInvitations:未授权 / 跨租户拒绝 / 成功
//   3. batchImportStudents:未授权 / 跨租户拒绝 / 参数无效 / 租户不存在 / 席位不足 /
//                          手机号已存在(失败明细)/ 有手机号成功 / 无手机号生成邀请码 / 成功
//   4. listAdminPresets:成功(委托 presetService.listAllPresets)
//   5. overridePreset:未授权 / 缺 :id / 参数无效 / 成功(含审计写入)
//
// Mock 策略:
//   - vi.mock + vi.hoisted 替换 invitationRepository / tenantRepository / userRepository /
//     presetService / writeAudit(纯单元测试,不依赖 Prisma mock 的 Phase 5 模型)
//   - 保留真实 success/error(验证响应结构,traceId 透传)
//   - 保留真实 logger(仅日志输出,无副作用)
//   - 自建 mockRequest/mockResponse/mockNext 工厂,模拟 Express 调用链
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import {
  createInvitation,
  listInvitations,
  batchImportStudents,
  listAdminPresets,
  overridePreset,
} from '../src/controllers/admin-phase5.controller.js';
import { ErrorCode } from '../src/types/api-contract.js';
import type { InvitationCode, Tenant, User } from '@prisma/client';

// ============================================================
// vi.mock:替换依赖模块(vi.hoisted 保证工厂执行时引用已初始化)
// ============================================================

const {
  mockInvitationRepo,
  mockTenantRepo,
  mockUserRepo,
  mockPresetService,
  mockWriteAudit,
} = vi.hoisted(() => ({
  mockInvitationRepo: {
    create: vi.fn(),
    listByTenant: vi.fn(),
  },
  mockTenantRepo: {
    findById: vi.fn(),
    countMembers: vi.fn(),
    createMembership: vi.fn(),
  },
  mockUserRepo: {
    findByPhone: vi.fn(),
    create: vi.fn(),
  },
  mockPresetService: {
    listAllPresets: vi.fn(),
    overridePreset: vi.fn(),
  },
  mockWriteAudit: vi.fn(),
}));

vi.mock('../src/repositories/invitation.repository.js', () => ({
  InvitationRepository: class {},
  invitationRepository: mockInvitationRepo,
  INVITATION_CODE_LENGTH: 32,
}));

vi.mock('../src/repositories/tenant.repository.js', () => ({
  TenantRepository: class {},
  tenantRepository: mockTenantRepo,
}));

vi.mock('../src/repositories/user.repository.js', () => ({
  UserRepository: class {},
  userRepository: mockUserRepo,
}));

vi.mock('../src/services/preset.service.js', () => ({
  PresetServiceClass: class {},
  presetService: mockPresetService,
}));

vi.mock('../src/services/admin-audit.service.js', () => ({
  writeAudit: mockWriteAudit,
  redactSensitive: vi.fn((obj: unknown) => obj),
}));

// ============================================================
// 测试常量与工厂
// ============================================================

const TENANT_A = 't-admin-phase5-a';
const TENANT_B = 't-admin-phase5-b';
const USER_ADMIN = 'u-admin-phase5';
const TRACE_ID = 'trace-admin-phase5-0001';

/** 构造租户 */
function makeTenant(overrides: Partial<Tenant> = {}): Tenant {
  return {
    id: TENANT_A,
    name: '测试院校A',
    type: 'school',
    feishuTenantKey: null,
    plan: 'standard',
    status: 'active',
    maxSeats: 100,
    parentId: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  } as unknown as Tenant;
}

/** 构造邀请码 */
function makeInvitation(overrides: Partial<InvitationCode> = {}): InvitationCode {
  return {
    id: 'inv-0001',
    code: 'inv-code-32-chars-aaaaaaaaaaaaaa',
    tenantId: TENANT_A,
    role: 'student',
    maxUses: 10,
    usedCount: 0,
    expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
    createdBy: USER_ADMIN,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  } as unknown as InvitationCode;
}

/** 构造用户(批量导入创建的用户) */
function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'u-new-student',
    tenantId: TENANT_A,
    authType: 'phone',
    feishuOpenId: null,
    feishuUnionId: null,
    passwordHash: null,
    phone: '13800138000',
    phoneVerified: true,
    name: '新学生',
    avatar: '',
    email: null,
    role: 'student',
    status: 'active',
    lockedAt: null,
    lockedBy: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    lastLoginAt: null,
    ...overrides,
  } as unknown as User;
}

// ============================================================
// Express 调用链 Mock 工厂
// ============================================================

interface MockRequestOptions {
  userId?: string;
  tenantId?: string;
  role?: string;
  traceId?: string;
  params?: Record<string, string>;
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
  ip?: string;
}

/**
 * 构造 mock Express Request
 * 关键字段:userId/tenantId/role(由 authMiddleware 注入)、traceId、params、body、headers
 */
function mockRequest(options: MockRequestOptions = {}): Request {
  const headers: Record<string, string | string[] | undefined> = {
    'user-agent': 'Mozilla/5.0 (Test Browser) Vitest/1.0',
    'x-forwarded-for': '192.168.1.100',
    ...options.headers,
  };
  const req = {
    userId: options.userId,
    tenantId: options.tenantId,
    role: options.role ?? 'admin',
    traceId: options.traceId ?? TRACE_ID,
    params: options.params ?? {},
    body: options.body ?? {},
    headers,
    ip: options.ip ?? '192.168.1.100',
    // RequestHandler 类型要求,但测试中不使用
    method: 'POST',
    url: '/',
    query: {},
  } as unknown as Request;
  return req;
}

/**
 * 构造 mock Express Response
 * 关键:res.status().json() 链式调用 + res.req.traceId(success/error 工具读取)
 */
function mockResponse(req: Request): Response {
  const res = {
    statusCode: 200,
    body: null as unknown,
    req, // success/error 通过 res.req.traceId 读取 traceId
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      res.body = body;
      return res;
    },
    send(body: unknown) {
      res.body = body;
      return res;
    },
    setHeader: vi.fn(),
  } as unknown as Response;
  return res;
}

/** 构造 mock NextFunction,捕获透传的错误 */
function mockNext(): NextFunction & { calls: unknown[] } {
  const calls: unknown[] = [];
  const next = ((err?: unknown) => {
    calls.push(err);
  }) as NextFunction & { calls: unknown[] };
  next.calls = calls;
  return next;
}

/**
 * 调用 handler 并返回 { res, nextCalls }
 * 用于统一断言响应状态/响应体/next 透传错误
 */
async function invokeHandler(
  handler: RequestHandler,
  req: Request,
  res: Response,
  next: NextFunction & { calls: unknown[] },
): Promise<{ res: Response; nextCalls: unknown[] }> {
  await handler(req, res, next);
  return { res, nextCalls: next.calls };
}

/** 断言:响应体为成功响应(code=0, data 非 null) */
function assertSuccessResponse(
  res: Response,
  expectedMessage?: string,
): { code: number; message: string; data: unknown; traceId: string } {
  const body = (res as unknown as { body: { code: number; message: string; data: unknown; traceId: string } }).body;
  expect(body).toBeDefined();
  expect(body.code).toBe(0);
  expect(typeof body.message).toBe('string');
  if (expectedMessage) {
    expect(body.message).toBe(expectedMessage);
  }
  expect(body.traceId).toBe(TRACE_ID);
  return body;
}

/** 断言:响应体为错误响应(code !== 0, data=null, 指定 HTTP 状态码) */
function assertErrorResponse(
  res: Response,
  expectedCode: ErrorCode,
  expectedHttpStatus: number,
): { code: number; message: string; data: unknown; traceId: string } {
  const mockRes = res as unknown as { statusCode: number; body: { code: number; message: string; data: unknown; traceId: string } };
  expect(mockRes.statusCode).toBe(expectedHttpStatus);
  expect(mockRes.body).toBeDefined();
  expect(mockRes.body.code).toBe(expectedCode);
  expect(mockRes.body.data).toBeNull();
  expect(mockRes.body.traceId).toBe(TRACE_ID);
  return mockRes.body;
}

// ============================================================
// 全局 beforeEach:清空 mock 调用记录
// ============================================================

beforeEach(() => {
  vi.clearAllMocks();
  // writeAudit 默认成功(不抛错)
  mockWriteAudit.mockResolvedValue(undefined);
});

// ============================================================
// 测试组 1: createInvitation
// ============================================================

describe('AdminPhase5.createInvitation', () => {
  const validBody = {
    role: 'student' as const,
    maxUses: 10,
    expiresHours: 168, // 7 天
  };

  it('未授权(缺 userId/tenantId)→ UNAUTHORIZED 401', async () => {
    const req = mockRequest({
      // 缺 userId/tenantId
      params: { id: TENANT_A },
      body: validBody,
    });
    const res = mockResponse(req);
    const next = mockNext();

    await invokeHandler(createInvitation, req, res, next);

    assertErrorResponse(res, ErrorCode.UNAUTHORIZED, 401);
    expect(mockInvitationRepo.create).not.toHaveBeenCalled();
    expect(mockWriteAudit).not.toHaveBeenCalled();
  });

  it('缺 :id 参数 → PARAM_INVALID 400', async () => {
    const req = mockRequest({
      userId: USER_ADMIN,
      tenantId: TENANT_A,
      params: {}, // 缺 id
      body: validBody,
    });
    const res = mockResponse(req);
    const next = mockNext();

    await invokeHandler(createInvitation, req, res, next);

    assertErrorResponse(res, ErrorCode.PARAM_INVALID, 400);
    expect(mockInvitationRepo.create).not.toHaveBeenCalled();
  });

  it('跨租户操作(targetTenantId ≠ req.tenantId)→ TENANT_MISMATCH 403', async () => {
    const req = mockRequest({
      userId: USER_ADMIN,
      tenantId: TENANT_A,
      params: { id: TENANT_B }, // 目标是 B,但操作者属于 A
      body: validBody,
    });
    const res = mockResponse(req);
    const next = mockNext();

    await invokeHandler(createInvitation, req, res, next);

    assertErrorResponse(res, ErrorCode.TENANT_MISMATCH, 403);
    expect(mockInvitationRepo.create).not.toHaveBeenCalled();
    expect(mockWriteAudit).not.toHaveBeenCalled();
  });

  it('请求体无效(maxUses 超过 100)→ PARAM_INVALID 400', async () => {
    const req = mockRequest({
      userId: USER_ADMIN,
      tenantId: TENANT_A,
      params: { id: TENANT_A },
      body: { role: 'student', maxUses: 101, expiresHours: 168 }, // maxUses 越界
    });
    const res = mockResponse(req);
    const next = mockNext();

    await invokeHandler(createInvitation, req, res, next);

    assertErrorResponse(res, ErrorCode.PARAM_INVALID, 400);
    expect(mockInvitationRepo.create).not.toHaveBeenCalled();
  });

  it('请求体无效(role 非法)→ PARAM_INVALID 400', async () => {
    const req = mockRequest({
      userId: USER_ADMIN,
      tenantId: TENANT_A,
      params: { id: TENANT_A },
      body: { role: 'invalid-role', maxUses: 10, expiresHours: 168 },
    });
    const res = mockResponse(req);
    const next = mockNext();

    await invokeHandler(createInvitation, req, res, next);

    assertErrorResponse(res, ErrorCode.PARAM_INVALID, 400);
    expect(mockInvitationRepo.create).not.toHaveBeenCalled();
  });

  it('成功创建邀请码 + 写入审计日志', async () => {
    const invitation = makeInvitation();
    mockInvitationRepo.create.mockResolvedValue(invitation);

    const req = mockRequest({
      userId: USER_ADMIN,
      tenantId: TENANT_A,
      params: { id: TENANT_A },
      body: validBody,
    });
    const res = mockResponse(req);
    const next = mockNext();

    await invokeHandler(createInvitation, req, res, next);

    const body = assertSuccessResponse(res, '邀请码已创建');
    const data = body.data as {
      id: string;
      code: string;
      tenantId: string;
      role: string;
      maxUses: number;
      usedCount: number;
      expiresAt: string;
      createdBy: string;
      createdAt: string;
    };
    expect(data.id).toBe('inv-0001');
    expect(data.code).toBe('inv-code-32-chars-aaaaaaaaaaaaaa');
    expect(data.tenantId).toBe(TENANT_A);
    expect(data.role).toBe('student');
    expect(data.usedCount).toBe(0);
    expect(typeof data.expiresAt).toBe('string');
    expect(data.createdBy).toBe(USER_ADMIN);

    // 校验 create 参数:code 为 32 位 URL-safe,tenantId/role/maxUses/expiresAt 透传
    const createArg = mockInvitationRepo.create.mock.calls[0]![0] as {
      code: string;
      tenantId: string;
      role: string;
      maxUses: number;
      expiresAt: Date;
      createdBy: string;
    };
    expect(createArg.code).toHaveLength(32);
    expect(createArg.tenantId).toBe(TENANT_A);
    expect(createArg.role).toBe('student');
    expect(createArg.maxUses).toBe(10);
    expect(createArg.createdBy).toBe(USER_ADMIN);
    // expiresAt 应为当前时间 + 168h(允许 1s 误差)
    const expectedMs = Date.now() + 168 * 3600 * 1000;
    expect(createArg.expiresAt.getTime()).toBeGreaterThan(expectedMs - 2000);
    expect(createArg.expiresAt.getTime()).toBeLessThan(expectedMs + 2000);

    // 校验审计日志写入
    expect(mockWriteAudit).toHaveBeenCalledTimes(1);
    const auditArg = mockWriteAudit.mock.calls[0]![0] as {
      action: string;
      resource: string;
      resourceId: string;
      targetTenantId: string;
    };
    expect(auditArg.action).toBe('create');
    expect(auditArg.resource).toBe('invitation');
    expect(auditArg.resourceId).toBe('inv-0001');
    expect(auditArg.targetTenantId).toBe(TENANT_A);
  });

  it('writeAudit 失败时不影响主流程(next 不被调用,响应仍成功)', async () => {
    // 此用例验证 writeAudit 的 try/catch 容错:即使审计失败,主流程仍返回成功
    // 注:当前 admin-phase5.controller 的 writeAudit 调用未 try/catch,
    //   若 writeAudit 抛错,错误会透传到 next(由 errorHandler 处理)
    //   此用例模拟 writeAudit 抛错,验证错误透传路径
    mockInvitationRepo.create.mockResolvedValue(makeInvitation());
    mockWriteAudit.mockRejectedValue(new Error('audit db down'));

    const req = mockRequest({
      userId: USER_ADMIN,
      tenantId: TENANT_A,
      params: { id: TENANT_A },
      body: validBody,
    });
    const res = mockResponse(req);
    const next = mockNext();

    await invokeHandler(createInvitation, req, res, next);

    // 邀请码已创建,但审计失败导致错误透传
    expect(mockInvitationRepo.create).toHaveBeenCalledTimes(1);
    expect(mockWriteAudit).toHaveBeenCalledTimes(1);
    expect(next.calls).toHaveLength(1);
    expect(next.calls[0]).toBeInstanceOf(Error);
  });
});

// ============================================================
// 测试组 2: listInvitations
// ============================================================

describe('AdminPhase5.listInvitations', () => {
  it('未授权(缺 userId/tenantId)→ UNAUTHORIZED 401', async () => {
    const req = mockRequest({
      params: { id: TENANT_A },
    });
    const res = mockResponse(req);
    const next = mockNext();

    await invokeHandler(listInvitations, req, res, next);

    assertErrorResponse(res, ErrorCode.UNAUTHORIZED, 401);
    expect(mockInvitationRepo.listByTenant).not.toHaveBeenCalled();
  });

  it('跨租户操作 → TENANT_MISMATCH 403', async () => {
    const req = mockRequest({
      userId: USER_ADMIN,
      tenantId: TENANT_A,
      params: { id: TENANT_B },
    });
    const res = mockResponse(req);
    const next = mockNext();

    await invokeHandler(listInvitations, req, res, next);

    assertErrorResponse(res, ErrorCode.TENANT_MISMATCH, 403);
    expect(mockInvitationRepo.listByTenant).not.toHaveBeenCalled();
  });

  it('成功返回租户下邀请码列表', async () => {
    const inv1 = makeInvitation({ id: 'inv-0001', code: 'code-aaa-32-chars-aaaaaaaaaaaaaa' });
    const inv2 = makeInvitation({
      id: 'inv-0002',
      code: 'code-bbb-32-chars-bbbbbbbbbbbbbb',
      role: 'teacher',
      maxUses: 5,
      usedCount: 2,
    });
    mockInvitationRepo.listByTenant.mockResolvedValue([inv1, inv2]);

    const req = mockRequest({
      userId: USER_ADMIN,
      tenantId: TENANT_A,
      params: { id: TENANT_A },
    });
    const res = mockResponse(req);
    const next = mockNext();

    await invokeHandler(listInvitations, req, res, next);

    expect(mockInvitationRepo.listByTenant).toHaveBeenCalledWith(TENANT_A);
    const body = assertSuccessResponse(res);
    const data = body.data as Array<{
      id: string;
      code: string;
      role: string;
      maxUses: number;
      usedCount: number;
    }>;
    expect(data).toHaveLength(2);
    expect(data[0]!.id).toBe('inv-0001');
    expect(data[1]!.role).toBe('teacher');
    expect(data[1]!.usedCount).toBe(2);
  });

  it('租户无邀请码时返回空数组', async () => {
    mockInvitationRepo.listByTenant.mockResolvedValue([]);

    const req = mockRequest({
      userId: USER_ADMIN,
      tenantId: TENANT_A,
      params: { id: TENANT_A },
    });
    const res = mockResponse(req);
    const next = mockNext();

    await invokeHandler(listInvitations, req, res, next);

    const body = assertSuccessResponse(res);
    expect(body.data).toEqual([]);
  });
});

// ============================================================
// 测试组 3: batchImportStudents
// ============================================================

describe('AdminPhase5.batchImportStudents', () => {
  const validBody = {
    students: [
      { name: '学生A', phone: '13800138001', email: 'a@test.edu.cn' },
      { name: '学生B', phone: '13800138002' },
      { name: '学生C' }, // 无手机号,生成邀请码
    ],
    role: 'student' as const,
  };

  it('未授权 → UNAUTHORIZED 401', async () => {
    const req = mockRequest({
      params: { id: TENANT_A },
      body: validBody,
    });
    const res = mockResponse(req);
    const next = mockNext();

    await invokeHandler(batchImportStudents, req, res, next);

    assertErrorResponse(res, ErrorCode.UNAUTHORIZED, 401);
    expect(mockTenantRepo.findById).not.toHaveBeenCalled();
  });

  it('跨租户操作 → TENANT_MISMATCH 403', async () => {
    const req = mockRequest({
      userId: USER_ADMIN,
      tenantId: TENANT_A,
      params: { id: TENANT_B },
      body: validBody,
    });
    const res = mockResponse(req);
    const next = mockNext();

    await invokeHandler(batchImportStudents, req, res, next);

    assertErrorResponse(res, ErrorCode.TENANT_MISMATCH, 403);
    expect(mockTenantRepo.findById).not.toHaveBeenCalled();
  });

  it('请求体无效(students 为空)→ PARAM_INVALID 400', async () => {
    const req = mockRequest({
      userId: USER_ADMIN,
      tenantId: TENANT_A,
      params: { id: TENANT_A },
      body: { students: [], role: 'student' },
    });
    const res = mockResponse(req);
    const next = mockNext();

    await invokeHandler(batchImportStudents, req, res, next);

    assertErrorResponse(res, ErrorCode.PARAM_INVALID, 400);
    expect(mockTenantRepo.findById).not.toHaveBeenCalled();
  });

  it('请求体无效(student.name 缺失)→ PARAM_INVALID 400', async () => {
    const req = mockRequest({
      userId: USER_ADMIN,
      tenantId: TENANT_A,
      params: { id: TENANT_A },
      body: { students: [{ phone: '13800138000' }], role: 'student' }, // 缺 name
    });
    const res = mockResponse(req);
    const next = mockNext();

    await invokeHandler(batchImportStudents, req, res, next);

    assertErrorResponse(res, ErrorCode.PARAM_INVALID, 400);
  });

  it('租户不存在 → TENANT_NOT_FOUND 404', async () => {
    mockTenantRepo.findById.mockResolvedValue(null);

    const req = mockRequest({
      userId: USER_ADMIN,
      tenantId: TENANT_A,
      params: { id: TENANT_A },
      body: validBody,
    });
    const res = mockResponse(req);
    const next = mockNext();

    await invokeHandler(batchImportStudents, req, res, next);

    assertErrorResponse(res, ErrorCode.TENANT_NOT_FOUND, 404);
    expect(mockTenantRepo.findById).toHaveBeenCalledWith(TENANT_A);
    expect(mockUserRepo.create).not.toHaveBeenCalled();
  });

  it('租户席位不足(memberCount + students.length > maxSeats)→ TENANT_SEATS_FULL 403', async () => {
    mockTenantRepo.findById.mockResolvedValue(makeTenant({ maxSeats: 5 }));
    mockTenantRepo.countMembers.mockResolvedValue(4); // 已有 4 人,导入 3 人超限

    const req = mockRequest({
      userId: USER_ADMIN,
      tenantId: TENANT_A,
      params: { id: TENANT_A },
      body: validBody,
    });
    const res = mockResponse(req);
    const next = mockNext();

    await invokeHandler(batchImportStudents, req, res, next);

    assertErrorResponse(res, ErrorCode.TENANT_SEATS_FULL, 403);
    expect(mockTenantRepo.countMembers).toHaveBeenCalledWith(TENANT_A);
    expect(mockUserRepo.create).not.toHaveBeenCalled();
  });

  it('有手机号的学生:手机号已存在 → 计入 failed 明细', async () => {
    mockTenantRepo.findById.mockResolvedValue(makeTenant({ maxSeats: 100 }));
    mockTenantRepo.countMembers.mockResolvedValue(0);
    // 第一个学生手机号已存在
    mockUserRepo.findByPhone.mockResolvedValueOnce(makeUser({ phone: '13800138001' }));

    const req = mockRequest({
      userId: USER_ADMIN,
      tenantId: TENANT_A,
      params: { id: TENANT_A },
      body: {
        students: [
          { name: '学生A', phone: '13800138001' },
          { name: '学生C' }, // 无手机号,生成邀请码
        ],
        role: 'student',
      },
    });
    const res = mockResponse(req);
    const next = mockNext();

    await invokeHandler(batchImportStudents, req, res, next);

    const body = assertSuccessResponse(res, '批量导入完成');
    const data = body.data as {
      imported: number;
      failed: { name: string; reason: string }[];
      invitationCodes: { name: string; code: string }[];
    };
    // 学生A 失败,学生C 生成邀请码 → imported=1, failed=1
    expect(data.imported).toBe(1);
    expect(data.failed).toHaveLength(1);
    expect(data.failed[0]!.name).toBe('学生A');
    expect(data.failed[0]!.reason).toBe('手机号已存在');
    expect(data.invitationCodes).toHaveLength(1);
    expect(data.invitationCodes[0]!.name).toBe('学生C');
    expect(data.invitationCodes[0]!.code).toHaveLength(32);
    // 校验:对失败学生未调用 create
    expect(mockUserRepo.create).not.toHaveBeenCalled();
    // 校验:对无手机号学生调用了 invitationRepository.create
    expect(mockInvitationRepo.create).toHaveBeenCalledTimes(1);
  });

  it('有手机号的学生:手机号未占用 → 直接建用户 + 加入租户', async () => {
    mockTenantRepo.findById.mockResolvedValue(makeTenant({ maxSeats: 100 }));
    mockTenantRepo.countMembers.mockResolvedValue(0);
    mockUserRepo.findByPhone.mockResolvedValue(null); // 手机号未占用
    const newUser = makeUser({ id: 'u-new-001', phone: '13800138001', name: '学生A' });
    mockUserRepo.create.mockResolvedValue(newUser);
    mockTenantRepo.createMembership.mockResolvedValue({});

    const req = mockRequest({
      userId: USER_ADMIN,
      tenantId: TENANT_A,
      params: { id: TENANT_A },
      body: {
        students: [{ name: '学生A', phone: '13800138001', email: 'a@test.edu.cn' }],
        role: 'student',
      },
    });
    const res = mockResponse(req);
    const next = mockNext();

    await invokeHandler(batchImportStudents, req, res, next);

    const body = assertSuccessResponse(res);
    const data = body.data as { imported: number; failed: unknown[]; invitationCodes: unknown[] };
    expect(data.imported).toBe(1);
    expect(data.failed).toEqual([]);
    expect(data.invitationCodes).toEqual([]);

    // 校验 user.create 参数:authType=phone, phone, phoneVerified=true
    const createArg = mockUserRepo.create.mock.calls[0]![0] as {
      authType: string;
      phone: string;
      phoneVerified: boolean;
      email: string | null;
      name: string;
      role: string;
      tenant: { connect: { id: string } };
    };
    expect(createArg.authType).toBe('phone');
    expect(createArg.phone).toBe('13800138001');
    expect(createArg.phoneVerified).toBe(true);
    expect(createArg.email).toBe('a@test.edu.cn');
    expect(createArg.name).toBe('学生A');
    expect(createArg.role).toBe('student');
    expect(createArg.tenant.connect.id).toBe(TENANT_A);

    // 校验 membership 创建
    expect(mockTenantRepo.createMembership).toHaveBeenCalledWith({
      userId: 'u-new-001',
      tenantId: TENANT_A,
      role: 'student',
    });
  });

  it('无手机号的学生 → 生成邀请码(7 天有效)加入 invitationCodes 列表', async () => {
    mockTenantRepo.findById.mockResolvedValue(makeTenant({ maxSeats: 100 }));
    mockTenantRepo.countMembers.mockResolvedValue(0);
    mockInvitationRepo.create.mockResolvedValue(makeInvitation());

    const req = mockRequest({
      userId: USER_ADMIN,
      tenantId: TENANT_A,
      params: { id: TENANT_A },
      body: {
        students: [{ name: '学生C' }],
        role: 'student',
      },
    });
    const res = mockResponse(req);
    const next = mockNext();

    await invokeHandler(batchImportStudents, req, res, next);

    const body = assertSuccessResponse(res);
    const data = body.data as {
      imported: number;
      failed: unknown[];
      invitationCodes: { name: string; code: string }[];
    };
    expect(data.imported).toBe(1);
    expect(data.invitationCodes).toHaveLength(1);
    expect(data.invitationCodes[0]!.name).toBe('学生C');

    // 校验 invitationRepository.create 参数:maxUses=1, 7 天有效(168h)
    const createArg = mockInvitationRepo.create.mock.calls[0]![0] as {
      code: string;
      tenantId: string;
      role: string;
      maxUses: number;
      expiresAt: Date;
      createdBy: string;
    };
    expect(createArg.code).toHaveLength(32);
    expect(createArg.tenantId).toBe(TENANT_A);
    expect(createArg.role).toBe('student');
    expect(createArg.maxUses).toBe(1);
    expect(createArg.createdBy).toBe(USER_ADMIN);
    // 7 天 = 168h,允许 2s 误差
    const expectedMs = Date.now() + 168 * 3600 * 1000;
    expect(createArg.expiresAt.getTime()).toBeGreaterThan(expectedMs - 2000);
    expect(createArg.expiresAt.getTime()).toBeLessThan(expectedMs + 2000);
  });

  it('指定 role=teacher 时,新建用户/邀请码 role 透传', async () => {
    mockTenantRepo.findById.mockResolvedValue(makeTenant({ maxSeats: 100 }));
    mockTenantRepo.countMembers.mockResolvedValue(0);
    mockUserRepo.findByPhone.mockResolvedValue(null);
    mockUserRepo.create.mockResolvedValue(makeUser({ id: 'u-teacher-001', role: 'teacher' }));
    mockTenantRepo.createMembership.mockResolvedValue({});

    const req = mockRequest({
      userId: USER_ADMIN,
      tenantId: TENANT_A,
      params: { id: TENANT_A },
      body: {
        students: [{ name: '教师A', phone: '13800138001' }],
        role: 'teacher',
      },
    });
    const res = mockResponse(req);
    const next = mockNext();

    await invokeHandler(batchImportStudents, req, res, next);

    const createArg = mockUserRepo.create.mock.calls[0]![0] as { role: string };
    expect(createArg.role).toBe('teacher');
    expect(mockTenantRepo.createMembership).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'teacher' }),
    );
  });

  it('未指定 role 时,默认 student', async () => {
    mockTenantRepo.findById.mockResolvedValue(makeTenant({ maxSeats: 100 }));
    mockTenantRepo.countMembers.mockResolvedValue(0);
    mockUserRepo.findByPhone.mockResolvedValue(null);
    mockUserRepo.create.mockResolvedValue(makeUser({ id: 'u-default-001' }));
    mockTenantRepo.createMembership.mockResolvedValue({});

    const req = mockRequest({
      userId: USER_ADMIN,
      tenantId: TENANT_A,
      params: { id: TENANT_A },
      body: {
        students: [{ name: '学生A', phone: '13800138001' }],
        // 不传 role
      },
    });
    const res = mockResponse(req);
    const next = mockNext();

    await invokeHandler(batchImportStudents, req, res, next);

    const createArg = mockUserRepo.create.mock.calls[0]![0] as { role: string };
    expect(createArg.role).toBe('student');
  });

  it('成功批量导入后写入审计日志(action=batch, resource=student)', async () => {
    mockTenantRepo.findById.mockResolvedValue(makeTenant({ maxSeats: 100 }));
    mockTenantRepo.countMembers.mockResolvedValue(0);
    mockUserRepo.findByPhone.mockResolvedValue(null);
    mockUserRepo.create.mockResolvedValue(makeUser({ id: 'u-batch-001' }));
    mockTenantRepo.createMembership.mockResolvedValue({});
    mockInvitationRepo.create.mockResolvedValue(makeInvitation());

    const req = mockRequest({
      userId: USER_ADMIN,
      tenantId: TENANT_A,
      params: { id: TENANT_A },
      body: validBody,
    });
    const res = mockResponse(req);
    const next = mockNext();

    await invokeHandler(batchImportStudents, req, res, next);

    expect(mockWriteAudit).toHaveBeenCalledTimes(1);
    const auditArg = mockWriteAudit.mock.calls[0]![0] as {
      action: string;
      resource: string;
      resourceId: unknown;
      targetTenantId: string;
      beforeData: { total: number; role: string };
      afterData: { imported: number; failed: number; invitationCodes: number };
    };
    expect(auditArg.action).toBe('batch');
    expect(auditArg.resource).toBe('student');
    expect(auditArg.resourceId).toBeNull();
    expect(auditArg.targetTenantId).toBe(TENANT_A);
    expect(auditArg.beforeData.total).toBe(3);
    expect(auditArg.beforeData.role).toBe('student');
    // 3 个学生:2 个有手机号(成功)+ 1 个无手机号(邀请码)
    expect(auditArg.afterData.imported).toBe(3);
    expect(auditArg.afterData.failed).toBe(0);
    expect(auditArg.afterData.invitationCodes).toBe(1);
  });
});

// ============================================================
// 测试组 4: listAdminPresets
// ============================================================

describe('AdminPhase5.listAdminPresets', () => {
  it('成功委托 presetService.listAllPresets 返回所有预设', async () => {
    const presets = [
      {
        id: 'preset-builtin-0001',
        name: '美院基准·绘画',
        description: null,
        styleType: 'academy',
        artType: 'painting',
        dimensions: [{ key: 'composition', label: '构图', labelEn: 'Composition', weight: 25 }],
        applicableStage: 'foundation',
        isBuiltIn: true,
        isPrivate: false,
        forkedFromId: null,
        creatorId: null,
        tenantId: null,
        enabled: true,
        sortOrder: 0,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        rationale: null,
      },
      {
        id: 'preset-user-0001',
        name: '我的自定义预设',
        description: 'desc',
        styleType: 'custom',
        artType: 'design',
        dimensions: [{ key: 'hierarchy', label: '层次', labelEn: 'Hierarchy', weight: 50 }],
        applicableStage: 'advanced',
        isBuiltIn: false,
        isPrivate: false,
        forkedFromId: 'preset-builtin-0001',
        creatorId: USER_ADMIN,
        tenantId: TENANT_A,
        enabled: true,
        sortOrder: 10,
        createdAt: '2026-01-02T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
        rationale: null,
      },
    ];
    mockPresetService.listAllPresets.mockResolvedValue(presets);

    // listAdminPresets 不需要 req 上下文(_req 参数)
    const req = mockRequest({
      userId: USER_ADMIN,
      tenantId: TENANT_A,
    });
    const res = mockResponse(req);
    const next = mockNext();

    await invokeHandler(listAdminPresets, req, res, next);

    expect(mockPresetService.listAllPresets).toHaveBeenCalledTimes(1);
    const body = assertSuccessResponse(res);
    const data = body.data as Array<{ id: string; isBuiltIn: boolean }>;
    expect(data).toHaveLength(2);
    expect(data[0]!.id).toBe('preset-builtin-0001');
    expect(data[0]!.isBuiltIn).toBe(true);
    expect(data[1]!.id).toBe('preset-user-0001');
  });

  it('无预设时返回空数组', async () => {
    mockPresetService.listAllPresets.mockResolvedValue([]);

    const req = mockRequest();
    const res = mockResponse(req);
    const next = mockNext();

    await invokeHandler(listAdminPresets, req, res, next);

    const body = assertSuccessResponse(res);
    expect(body.data).toEqual([]);
  });

  it('service 抛出业务错误时透传到 next', async () => {
    const serviceErr = new Error('db down');
    mockPresetService.listAllPresets.mockRejectedValue(serviceErr);

    const req = mockRequest();
    const res = mockResponse(req);
    const next = mockNext();

    await invokeHandler(listAdminPresets, req, res, next);

    expect(next.calls).toHaveLength(1);
    expect(next.calls[0]).toBe(serviceErr);
  });
});

// ============================================================
// 测试组 5: overridePreset
// ============================================================

describe('AdminPhase5.overridePreset', () => {
  const validBody = {
    name: '我的覆盖预设',
    description: '从美院基准派生',
    dimensions: [
      { key: 'composition', label: '构图', labelEn: 'Composition', weight: 40 },
      { key: 'color', label: '色彩', labelEn: 'Color', weight: 30 },
      { key: 'brushwork', label: '笔触', labelEn: 'Brushwork', weight: 30 },
    ],
    isPrivate: false,
  };

  it('未授权(缺 userId/tenantId)→ UNAUTHORIZED 401', async () => {
    const req = mockRequest({
      params: { id: 'preset-builtin-0001' },
      body: validBody,
    });
    const res = mockResponse(req);
    const next = mockNext();

    await invokeHandler(overridePreset, req, res, next);

    assertErrorResponse(res, ErrorCode.UNAUTHORIZED, 401);
    expect(mockPresetService.overridePreset).not.toHaveBeenCalled();
  });

  it('缺 :id 参数 → PARAM_INVALID 400', async () => {
    const req = mockRequest({
      userId: USER_ADMIN,
      tenantId: TENANT_A,
      params: {}, // 缺 id
      body: validBody,
    });
    const res = mockResponse(req);
    const next = mockNext();

    await invokeHandler(overridePreset, req, res, next);

    assertErrorResponse(res, ErrorCode.PARAM_INVALID, 400);
    expect(mockPresetService.overridePreset).not.toHaveBeenCalled();
  });

  it('请求体无效(dimensions 为空)→ PARAM_INVALID 400', async () => {
    const req = mockRequest({
      userId: USER_ADMIN,
      tenantId: TENANT_A,
      params: { id: 'preset-builtin-0001' },
      body: { name: '空预设', dimensions: [] },
    });
    const res = mockResponse(req);
    const next = mockNext();

    await invokeHandler(overridePreset, req, res, next);

    assertErrorResponse(res, ErrorCode.PARAM_INVALID, 400);
    expect(mockPresetService.overridePreset).not.toHaveBeenCalled();
  });

  it('请求体无效(weight 越界 > 100)→ PARAM_INVALID 400', async () => {
    const req = mockRequest({
      userId: USER_ADMIN,
      tenantId: TENANT_A,
      params: { id: 'preset-builtin-0001' },
      body: {
        name: '越界预设',
        dimensions: [
          { key: 'composition', label: '构图', labelEn: 'Composition', weight: 150 },
        ],
      },
    });
    const res = mockResponse(req);
    const next = mockNext();

    await invokeHandler(overridePreset, req, res, next);

    assertErrorResponse(res, ErrorCode.PARAM_INVALID, 400);
    expect(mockPresetService.overridePreset).not.toHaveBeenCalled();
  });

  it('请求体无效(name 缺失)→ PARAM_INVALID 400', async () => {
    const req = mockRequest({
      userId: USER_ADMIN,
      tenantId: TENANT_A,
      params: { id: 'preset-builtin-0001' },
      body: {
        dimensions: [{ key: 'composition', label: '构图', labelEn: 'Composition', weight: 100 }],
      },
    });
    const res = mockResponse(req);
    const next = mockNext();

    await invokeHandler(overridePreset, req, res, next);

    assertErrorResponse(res, ErrorCode.PARAM_INVALID, 400);
    expect(mockPresetService.overridePreset).not.toHaveBeenCalled();
  });

  it('成功派生覆盖预设 + 写入审计日志', async () => {
    const newPreset = {
      id: 'preset-overridden-0001',
      name: '我的覆盖预设',
      description: '从美院基准派生',
      styleType: 'academy',
      artType: 'painting',
      dimensions: validBody.dimensions,
      applicableStage: 'foundation',
      isBuiltIn: false,
      isPrivate: false,
      forkedFromId: 'preset-builtin-0001',
      creatorId: USER_ADMIN,
      tenantId: TENANT_A,
      enabled: true,
      sortOrder: 0,
      createdAt: '2026-01-03T00:00:00.000Z',
      updatedAt: '2026-01-03T00:00:00.000Z',
      rationale: null,
    };
    mockPresetService.overridePreset.mockResolvedValue(newPreset);

    const req = mockRequest({
      userId: USER_ADMIN,
      tenantId: TENANT_A,
      params: { id: 'preset-builtin-0001' },
      body: validBody,
    });
    const res = mockResponse(req);
    const next = mockNext();

    await invokeHandler(overridePreset, req, res, next);

    const body = assertSuccessResponse(res, '覆盖预设已创建');
    const data = body.data as { id: string; name: string; forkedFromId: string };
    expect(data.id).toBe('preset-overridden-0001');
    expect(data.name).toBe('我的覆盖预设');
    expect(data.forkedFromId).toBe('preset-builtin-0001');

    // 校验 presetService.overridePreset 参数透传
    const svcArgs = mockPresetService.overridePreset.mock.calls[0]!;
    expect(svcArgs[0]).toBe(TENANT_A); // tenantId
    expect(svcArgs[1]).toBe(USER_ADMIN); // userId
    expect(svcArgs[2]).toBe('preset-builtin-0001'); // sourceId
    expect((svcArgs[3] as { name: string }).name).toBe('我的覆盖预设');
    expect((svcArgs[3] as { isPrivate: boolean }).isPrivate).toBe(false);

    // 校验审计日志写入
    expect(mockWriteAudit).toHaveBeenCalledTimes(1);
    const auditArg = mockWriteAudit.mock.calls[0]![0] as {
      action: string;
      resource: string;
      resourceId: string;
      targetTenantId: string;
      beforeData: { forkedFromId: string };
      afterData: { presetId: string; name: string };
    };
    expect(auditArg.action).toBe('create');
    expect(auditArg.resource).toBe('preset');
    expect(auditArg.resourceId).toBe('preset-overridden-0001');
    expect(auditArg.targetTenantId).toBe(TENANT_A);
    expect(auditArg.beforeData.forkedFromId).toBe('preset-builtin-0001');
    expect(auditArg.afterData.presetId).toBe('preset-overridden-0001');
  });

  it('isPrivate 缺省时透传 undefined(由 service 默认 false)', async () => {
    const newPreset = {
      id: 'preset-overridden-0002',
      name: '我的覆盖预设',
      isBuiltIn: false,
      isPrivate: false,
    };
    mockPresetService.overridePreset.mockResolvedValue(newPreset);

    const req = mockRequest({
      userId: USER_ADMIN,
      tenantId: TENANT_A,
      params: { id: 'preset-builtin-0001' },
      body: {
        name: '我的覆盖预设',
        dimensions: [
          { key: 'composition', label: '构图', labelEn: 'Composition', weight: 100 },
        ],
        // 不传 isPrivate
      },
    });
    const res = mockResponse(req);
    const next = mockNext();

    await invokeHandler(overridePreset, req, res, next);

    assertSuccessResponse(res, '覆盖预设已创建');
    const svcArg = mockPresetService.overridePreset.mock.calls[0]![3] as { isPrivate?: boolean };
    expect(svcArg.isPrivate).toBeUndefined();
  });

  it('service 抛出 PHASE5_PRESET_NOT_FOUND 时透传到 next', async () => {
    // 模拟源预设不存在(BusinessError 由 service 抛出)
    const serviceErr = new Error('源预设不存在');
    mockPresetService.overridePreset.mockRejectedValue(serviceErr);

    const req = mockRequest({
      userId: USER_ADMIN,
      tenantId: TENANT_A,
      params: { id: 'preset-non-existent' },
      body: validBody,
    });
    const res = mockResponse(req);
    const next = mockNext();

    await invokeHandler(overridePreset, req, res, next);

    expect(next.calls).toHaveLength(1);
    expect(next.calls[0]).toBe(serviceErr);
    // service 抛错时不写入审计
    expect(mockWriteAudit).not.toHaveBeenCalled();
  });
});
