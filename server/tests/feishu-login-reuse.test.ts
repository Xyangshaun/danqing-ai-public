// ============================================================
// 飞书登录 - open_id 兜底复用集成测试
// 对应源码: src/services/auth.service.ts (handleCallback → upsertUserAndTenant)
//
// 背景:Bug 修复前, upsertUserAndTenant 仅按 union_id 查找用户。
//   当库中已存在"相同 open_id 但 union_id 为空/不一致"的早期记录时,
//   会误判为首次登录去创建新用户, 触发 feishu_open_id 唯一约束冲突 → 登录 500。
// 修复: 查找改为 union_id 优先, open_id 兜底, 命中即复用现有用户。
//
// 测试范围(走完整 handleCallback 链路, mock 外部依赖):
//   1. open_id 兜底复用: union_id 查不到, 但 open_id 命中已有用户 → 复用, 不崩溃
//   2. union_id 命中复用: 原有正常路径不被破坏
//   3. 全新用户创建: 两者均未命中 → 正常创建(原有逻辑不受影响)
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { User, Tenant } from '@prisma/client';

// ============================================================
// mock 依赖(vi.hoisted 保证工厂执行时引用已初始化)
// ============================================================
const {
  mockRedisClient,
  mockFeishu,
  mockUserRepo,
  mockTenantRepo,
  mockJwt,
  mockSession,
  mockPresence,
} = vi.hoisted(() => {
  const mockRedis = {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
  };
  return {
    mockRedisClient: mockRedis,
    mockFeishu: {
      exchangeCodeForToken: vi.fn(),
      getUserInfo: vi.fn(),
    },
    mockUserRepo: {
      findById: vi.fn(),
      findByFeishuUnionId: vi.fn(),
      findByFeishuOpenId: vi.fn(),
      update: vi.fn(),
      updateLastLoginAt: vi.fn(),
      findMemberships: vi.fn(),
    },
    mockTenantRepo: {
      findById: vi.fn(),
      findByFeishuTenantKey: vi.fn(),
      create: vi.fn(),
      withTransaction: vi.fn(),
    },
    mockJwt: {
      issueAccessToken: vi.fn(),
      issueRefreshToken: vi.fn(),
    },
    mockSession: {
      createSession: vi.fn(),
    },
    mockPresence: {
      markOnline: vi.fn(),
    },
  };
});

vi.mock('../src/config/redis.js', () => ({
  redis: () => mockRedisClient,
}));

vi.mock('../src/services/feishu.service.js', () => ({
  FeishuServiceClass: class {},
  feishuService: mockFeishu,
}));

vi.mock('../src/repositories/user.repository.js', () => ({
  UserRepository: class {},
  userRepository: mockUserRepo,
}));

vi.mock('../src/repositories/tenant.repository.js', () => ({
  TenantRepository: class {},
  tenantRepository: mockTenantRepo,
}));

vi.mock('../src/services/jwt.service.js', () => ({
  JwtServiceClass: class {},
  jwtService: mockJwt,
}));

vi.mock('../src/services/session.service.js', () => ({
  SessionServiceClass: class {},
  sessionService: mockSession,
}));

vi.mock('../src/services/presence.service.js', () => ({
  PresenceServiceClass: class {},
  presenceService: mockPresence,
}));

// 被测对象(在 mock 之后 import,确保拿到替换后的依赖)
import { authService } from '../src/services/auth.service.js';

// ============================================================
// 测试数据构造
// ============================================================
const STATE = 'a'.repeat(64); // 合法 hex state
const CLIENT_IP = '127.0.0.1';
const USER_AGENT = 'vitest-user-agent';
const DEVICE_ID = 'device-vitest-001';

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'u-1',
    tenantId: 't-1',
    authType: 'feishu',
    feishuOpenId: 'ou_existing',
    feishuUnionId: 'on_old_union',
    passwordHash: null,
    phone: null,
    phoneVerified: false,
    name: '既有用户',
    avatar: '',
    email: null,
    role: 'student',
    status: 'active',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    lastLoginAt: null,
    lockedAt: null,
    lockedBy: null,
    ...overrides,
  } as User;
}

function makeTenant(overrides: Partial<Tenant> = {}): Tenant {
  return {
    id: 't-1',
    name: '测试租户',
    type: 'individual',
    description: null,
    feishuTenantKey: null,
    plan: 'free',
    status: 'active',
    maxSeats: 1,
    parentId: null,
    arbitrationConfig: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  } as Tenant;
}

function makeCtx() {
  return JSON.stringify({
    clientIp: CLIENT_IP,
    userAgent: USER_AGENT,
    deviceId: DEVICE_ID,
    client: 'web',
    createdAt: Date.now(),
  });
}

function baseHandleCallbackParams() {
  return {
    code: 'test-auth-code',
    state: STATE,
    clientIp: CLIENT_IP,
    userAgent: USER_AGENT,
    deviceId: DEVICE_ID,
    client: 'web' as const,
  };
}

/**
 * 组装 handleCallback 的成功依赖(feishu 用户、jwt、session、presence)
 */
function setupSuccessPath(feishuUser: { openId: string; unionId: string }) {
  mockRedisClient.get.mockResolvedValue(makeCtx());
  mockRedisClient.del.mockResolvedValue(1);

  mockFeishu.exchangeCodeForToken.mockResolvedValue({
    accessToken: 'feishu-at',
    refreshToken: 'feishu-rt',
    openId: feishuUser.openId,
    unionId: feishuUser.unionId,
    expiresIn: 7200,
  });
  mockFeishu.getUserInfo.mockResolvedValue({
    openId: feishuUser.openId,
    unionId: feishuUser.unionId,
    name: '飞书用户',
    avatarUrl: 'https://feishu.cn/avatar.jpg',
    email: null,
    mobile: null,
    tenantKey: null,
  });

  mockJwt.issueAccessToken.mockReturnValue({
    token: 'access-token',
    expiresAt: new Date(Date.now() + 900000),
  });
  mockJwt.issueRefreshToken.mockReturnValue({
    token: 'refresh-token',
    jti: 'jti-1',
    expiresAt: new Date(Date.now() + 7 * 86400000),
  });
  mockSession.createSession.mockResolvedValue({ id: 'session-1' });
  mockPresence.markOnline.mockResolvedValue(undefined);
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ============================================================
// 场景 1:open_id 兜底复用(本次修复的核心)
// ============================================================
describe('飞书登录 - open_id 兜底复用(union_id 查不到但 open_id 命中)', () => {
  it('不应创建新用户, 不应抛唯一约束错误, 应复用既有用户', async () => {
    const existingUser = makeUser({
      id: 'u-existing',
      tenantId: 't-1',
      feishuOpenId: 'ou_existing',
      feishuUnionId: null, // 早期记录 union_id 为空
    });
    const tenant = makeTenant({ id: 't-1' });

    // 关键 mock:union_id 查不到, open_id 命中已有用户
    mockUserRepo.findByFeishuUnionId.mockResolvedValue(null);
    mockUserRepo.findByFeishuOpenId.mockResolvedValue(existingUser);
    mockUserRepo.update.mockResolvedValue(existingUser);
    mockUserRepo.updateLastLoginAt.mockResolvedValue(undefined);
    mockTenantRepo.findById.mockResolvedValue(tenant);

    setupSuccessPath({ openId: 'ou_existing', unionId: 'on_new_union' });

    const result = await authService.handleCallback(baseHandleCallbackParams());

    // 复用既有用户,而非新建
    expect(result.user.id).toBe('u-existing');
    expect(result.isFirstLogin).toBe(false);

    // 创建路径不得被触发(不应进入 withTransaction / tenant.create)
    expect(mockTenantRepo.withTransaction).not.toHaveBeenCalled();
    expect(mockTenantRepo.create).not.toHaveBeenCalled();

    // 登录主链路正常
    expect(result.accessToken).toBe('access-token');
    expect(result.refreshToken).toBe('refresh-token');
    expect(mockSession.createSession).toHaveBeenCalledTimes(1);
    expect(mockPresence.markOnline).toHaveBeenCalledWith('u-existing', 'session-1', 'web');
  });
});

// ============================================================
// 场景 2:union_id 命中复用(原有正常路径)
// ============================================================
describe('飞书登录 - union_id 命中复用(原有路径不受影响)', () => {
  it('应按 union_id 命中并复用, 不触发 open_id 兜底', async () => {
    const existingUser = makeUser({
      id: 'u-union',
      tenantId: 't-1',
      feishuOpenId: 'ou_existing',
      feishuUnionId: 'on_matching_union',
    });
    const tenant = makeTenant({ id: 't-1' });

    mockUserRepo.findByFeishuUnionId.mockResolvedValue(existingUser);
    mockUserRepo.update.mockResolvedValue(existingUser);
    mockUserRepo.updateLastLoginAt.mockResolvedValue(undefined);
    mockTenantRepo.findById.mockResolvedValue(tenant);

    setupSuccessPath({ openId: 'ou_existing', unionId: 'on_matching_union' });

    const result = await authService.handleCallback(baseHandleCallbackParams());

    expect(result.user.id).toBe('u-union');
    expect(result.isFirstLogin).toBe(false);
    // 按 union_id 即命中, 不应再按 open_id 查询
    expect(mockUserRepo.findByFeishuOpenId).not.toHaveBeenCalled();
    expect(mockTenantRepo.withTransaction).not.toHaveBeenCalled();
  });
});

// ============================================================
// 场景 3:全新用户创建(原有创建逻辑不受影响)
// ============================================================
describe('飞书登录 - 全新用户创建', () => {
  it('union_id 与 open_id 均未命中时应创建新用户', async () => {
    const newUser = makeUser({
      id: 'u-new',
      tenantId: 't-new',
      feishuOpenId: 'ou_new',
      feishuUnionId: 'on_new',
    });
    const tenant = makeTenant({ id: 't-new', name: '新用户'.concat('的个人空间') });

    mockUserRepo.findByFeishuUnionId.mockResolvedValue(null);
    mockUserRepo.findByFeishuOpenId.mockResolvedValue(null);
    mockTenantRepo.findByFeishuTenantKey.mockResolvedValue(null);
    mockTenantRepo.create.mockResolvedValue(tenant);
    // withTransaction 执行回调, 传入 mock tx
    mockTenantRepo.withTransaction.mockImplementation(
      async (cb: (tx: unknown) => Promise<unknown>) => {
        return cb({
          user: { create: vi.fn().mockResolvedValue(newUser) },
          tenantMember: { create: vi.fn().mockResolvedValue({}) },
        });
      },
    );

    setupSuccessPath({ openId: 'ou_new', unionId: 'on_new' });

    const result = await authService.handleCallback(baseHandleCallbackParams());

    expect(result.user.id).toBe('u-new');
    expect(result.isFirstLogin).toBe(true);
    expect(mockTenantRepo.withTransaction).toHaveBeenCalledTimes(1);
    expect(mockTenantRepo.create).toHaveBeenCalledTimes(1);
  });
});