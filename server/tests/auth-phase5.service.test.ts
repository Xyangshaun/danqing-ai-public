// ============================================================
// AuthService Phase 5 认证扩展单元测试
// 对应源码: src/services/auth.service.ts(Phase 5 扩展方法)
// 对应文档: new-features-design.md §1.3, §1.4, §2.1, §3.5
//
// 测试范围:
//   1. sendPhoneOtp:手机号格式 / register 已注册 / login 未注册 / 重发冷却 / 短信网关失败 / 成功
//   2. verifyPhoneOtp:验证码无效 / register 成功(无邀请码) / login 成功 / bind 成功
//   3. redeemInvitation:邀请码无效 / 租户席位已满 / 新用户兑换成功
//   4. registerAdmin:非 admin 邀请码 / 邮箱重复 / 密码弱 / 成功
//   5. loginAdmin:用户不存在 / authType 不符 / 账号锁定 / 密码错误 / 成功
//   6. bindPhone:手机号已被绑定 / 成功
//
// Mock 策略:
//   - vi.mock + vi.hoisted 替换 Phase 5 仓储 / 用户仓储 / 租户仓储 / 短信网关 / JWT / Session / 密码工具
//   - 保留真实 validatePasswordComplexity / safeEqual / generateUuid(纯函数,无副作用)
//   - env() 由 setup.ts 初始化(phoneRegex 默认 ^1[3-9]\d{9}$)
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { authService } from '../src/services/auth.service.js';
import { BusinessError } from '../src/middlewares/error-handler.js';
import { ErrorCode } from '../src/types/api-contract.js';
import type { PhoneVerification, InvitationCode, User, Tenant } from '@prisma/client';

// ============================================================
// vi.mock:替换依赖模块(vi.hoisted 保证工厂执行时引用已初始化)
// ============================================================

const {
  mockPhoneRepo,
  mockInvitationRepo,
  mockUserRepo,
  mockTenantRepo,
  mockSmsGateway,
  mockJwt,
  mockSession,
  mockPassword,
} = vi.hoisted(() => ({
  mockPhoneRepo: {
    create: vi.fn(),
    findLatestValid: vi.fn(),
    findLatest: vi.fn(),
    markConsumed: vi.fn(),
    incrementAttempts: vi.fn(),
  },
  mockInvitationRepo: {
    create: vi.fn(),
    findByCode: vi.fn(),
    findValidByCode: vi.fn(),
    incrementUsed: vi.fn(),
    listByTenant: vi.fn(),
  },
  mockUserRepo: {
    findById: vi.fn(),
    findByPhone: vi.fn(),
    findByEmail: vi.fn(),
    findByFeishuUnionId: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateLastLoginAt: vi.fn(),
    switchTenant: vi.fn(),
    findMemberships: vi.fn(),
  },
  mockTenantRepo: {
    findById: vi.fn(),
    findByFeishuTenantKey: vi.fn(),
    create: vi.fn(),
    countMembers: vi.fn(),
    findMembership: vi.fn(),
    createMembership: vi.fn(),
    withTransaction: vi.fn(),
  },
  mockSmsGateway: {
    sendOtp: vi.fn(),
  },
  mockJwt: {
    issueAccessToken: vi.fn(),
    issueRefreshToken: vi.fn(),
  },
  mockSession: {
    createSession: vi.fn(),
  },
  mockPassword: {
    validatePasswordComplexity: vi.fn(),
    hashPassword: vi.fn(),
    verifyPassword: vi.fn(),
  },
}));

// Phase 5 常量(与 phone-verification.repository.ts 保持一致)
vi.mock('../src/repositories/phone-verification.repository.js', () => ({
  PhoneVerificationRepository: class {},
  phoneVerificationRepository: mockPhoneRepo,
  MAX_OTP_ATTEMPTS: 5,
  OTP_TTL_SEC: 300,
  OTP_RESEND_COOLDOWN_SEC: 60,
}));

vi.mock('../src/repositories/invitation.repository.js', () => ({
  InvitationRepository: class {},
  invitationRepository: mockInvitationRepo,
  INVITATION_CODE_LENGTH: 32,
}));

vi.mock('../src/repositories/user.repository.js', () => ({
  UserRepository: class {},
  userRepository: mockUserRepo,
}));

vi.mock('../src/repositories/tenant.repository.js', () => ({
  TenantRepository: class {},
  tenantRepository: mockTenantRepo,
}));

vi.mock('../src/services/sms-gateway.service.js', () => ({
  MockSmsGateway: class {},
  AliyunSmsGateway: class {},
  TencentSmsGateway: class {},
  createSmsGateway: vi.fn(() => mockSmsGateway),
  getSmsGateway: vi.fn(() => mockSmsGateway),
  __resetSmsGateway: vi.fn(),
}));

vi.mock('../src/services/jwt.service.js', () => ({
  JwtServiceClass: class {},
  jwtService: mockJwt,
}));

vi.mock('../src/services/session.service.js', () => ({
  SessionServiceClass: class {},
  sessionService: mockSession,
}));

vi.mock('../src/utils/password.js', () => ({
  BCRYPT_SALT_ROUNDS: 12,
  validatePasswordComplexity: mockPassword.validatePasswordComplexity,
  hashPassword: mockPassword.hashPassword,
  verifyPassword: mockPassword.verifyPassword,
}));

// ============================================================
// 测试常量与工厂
// ============================================================

const TENANT_A = 't-auth-phase5';
const USER_STUDENT = 'u-student-auth';
const USER_ADMIN = 'u-admin-auth';
const PHONE_VALID = '13800138000';
const PHONE_NEW = '13900139000';
const CLIENT_IP = '192.168.1.100';
const USER_AGENT = 'Mozilla/5.0 (Test)';
const DEVICE_ID = 'd-test-device';

/** 构造用户 */
function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: USER_STUDENT,
    tenantId: TENANT_A,
    feishuOpenId: 'ou_test',
    feishuUnionId: 'on_test',
    name: '测试学生',
    avatar: '',
    email: null,
    phone: null,
    role: 'student',
    status: 'active',
    authType: 'feishu',
    passwordHash: null,
    phoneVerified: false,
    lockedAt: null,
    lockedBy: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    lastLoginAt: null,
    ...overrides,
  } as unknown as User;
}

/** 构造租户 */
function makeTenant(overrides: Partial<Tenant> = {}): Tenant {
  return {
    id: TENANT_A,
    name: '测试院校',
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
    expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000), // 7 天后
    createdBy: USER_ADMIN,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  } as unknown as InvitationCode;
}

/** 构造验证码记录 */
function makeOtpRecord(overrides: Partial<PhoneVerification> = {}): PhoneVerification {
  return {
    id: 'otp-0001',
    phone: PHONE_VALID,
    code: '123456',
    purpose: 'login',
    expiresAt: new Date(Date.now() + 300 * 1000),
    ip: CLIENT_IP,
    tenantId: null,
    userId: null,
    attempts: 0,
    consumedAt: null,
    createdAt: new Date(),
    ...overrides,
  } as unknown as PhoneVerification;
}

/** 模拟 issueTokensAndSession 成功返回 */
function setupIssueTokensAndSession(user: User, tenant: Tenant): void {
  mockJwt.issueAccessToken.mockReturnValue({
    token: 'access-token-mock',
    expiresAt: new Date('2026-01-01T00:15:00Z'),
    jti: 'jti-access',
  });
  mockJwt.issueRefreshToken.mockReturnValue({
    token: 'refresh-token-mock',
    expiresAt: new Date('2026-01-08T00:00:00Z'),
    jti: 'jti-refresh',
  });
  mockSession.createSession.mockResolvedValue(undefined);
  // toUserProfile / toTenantInfo 从 user/tenant 读取,故 user/tenant 字段需完整
  void user;
  void tenant;
}

/** 辅助:断言 BusinessError */
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
  // 默认 mock:密码工具
  mockPassword.validatePasswordComplexity.mockImplementation(() => undefined);
  mockPassword.hashPassword.mockResolvedValue('hashed-password-mock');
  mockPassword.verifyPassword.mockResolvedValue(true);
});

// ============================================================
// 测试组 1: sendPhoneOtp
// ============================================================

describe('AuthService.sendPhoneOtp', () => {
  it('手机号格式不合法 → PARAM_INVALID 400', async () => {
    await expectBusinessError(
      () =>
        authService.sendPhoneOtp({
          phone: '12345',
          purpose: 'register',
          clientIp: CLIENT_IP,
        }),
      ErrorCode.PARAM_INVALID,
      400,
    );
    expect(mockPhoneRepo.create).not.toHaveBeenCalled();
  });

  it('register 场景手机号已注册 → DUPLICATE_RESOURCE 409', async () => {
    mockUserRepo.findByPhone.mockResolvedValue(makeUser({ phone: PHONE_VALID }));
    mockPhoneRepo.findLatest.mockResolvedValue(null); // 无冷却记录

    await expectBusinessError(
      () =>
        authService.sendPhoneOtp({
          phone: PHONE_VALID,
          purpose: 'register',
          clientIp: CLIENT_IP,
        }),
      ErrorCode.DUPLICATE_RESOURCE,
      409,
    );
  });

  it('login 场景手机号未注册 → RESOURCE_NOT_FOUND 404', async () => {
    mockUserRepo.findByPhone.mockResolvedValue(null);
    mockPhoneRepo.findLatest.mockResolvedValue(null);

    await expectBusinessError(
      () =>
        authService.sendPhoneOtp({
          phone: PHONE_VALID,
          purpose: 'login',
          clientIp: CLIENT_IP,
        }),
      ErrorCode.RESOURCE_NOT_FOUND,
      404,
    );
  });

  it('重发冷却期内 → RATE_LIMITED 429', async () => {
    // 最近一条记录 30 秒前创建(< 60 秒冷却)
    mockPhoneRepo.findLatest.mockResolvedValue(
      makeOtpRecord({ createdAt: new Date(Date.now() - 30 * 1000) }),
    );

    await expectBusinessError(
      () =>
        authService.sendPhoneOtp({
          phone: PHONE_VALID,
          purpose: 'login',
          clientIp: CLIENT_IP,
        }),
      ErrorCode.RATE_LIMITED,
      429,
    );
  });

  it('短信网关发送失败 → UPSTREAM_UNAVAILABLE 502', async () => {
    mockUserRepo.findByPhone.mockResolvedValue(null); // login:未注册会先抛 404,改 register
    mockUserRepo.findByPhone.mockResolvedValueOnce(null); // register:未注册
    mockPhoneRepo.findLatest.mockResolvedValue(null);
    mockSmsGateway.sendOtp.mockRejectedValue(new Error('gateway down'));

    await expectBusinessError(
      () =>
        authService.sendPhoneOtp({
          phone: PHONE_VALID,
          purpose: 'register',
          clientIp: CLIENT_IP,
        }),
      ErrorCode.UPSTREAM_UNAVAILABLE,
      502,
    );
  });

  it('成功发送验证码(login 场景,手机号已注册)', async () => {
    mockUserRepo.findByPhone.mockResolvedValue(makeUser({ phone: PHONE_VALID }));
    mockPhoneRepo.findLatest.mockResolvedValue(null); // 无冷却
    mockPhoneRepo.create.mockResolvedValue(makeOtpRecord());
    mockSmsGateway.sendOtp.mockResolvedValue(undefined);

    const result = await authService.sendPhoneOtp({
      phone: PHONE_VALID,
      purpose: 'login',
      clientIp: CLIENT_IP,
    });

    expect(result.sent).toBe(true);
    expect(result.resendAfter).toBe(60); // OTP_RESEND_COOLDOWN_SEC
    expect(typeof result.expiresAt).toBe('string');
    expect(mockPhoneRepo.create).toHaveBeenCalledTimes(1);
    expect(mockSmsGateway.sendOtp).toHaveBeenCalledTimes(1);
    // 校验发送的 phone + purpose 透传
    const sendOtpArg = mockSmsGateway.sendOtp.mock.calls[0]![0];
    expect(sendOtpArg.phone).toBe(PHONE_VALID);
    expect(sendOtpArg.purpose).toBe('login');
  });

  it('bind 场景缺少 tenantId/userId → PARAM_MISSING 400', async () => {
    await expectBusinessError(
      () =>
        authService.sendPhoneOtp({
          phone: PHONE_VALID,
          purpose: 'bind',
          clientIp: CLIENT_IP,
          // 缺 tenantId / userId
        }),
      ErrorCode.PARAM_MISSING,
      400,
    );
  });
});

// ============================================================
// 测试组 2: verifyPhoneOtp
// ============================================================

describe('AuthService.verifyPhoneOtp', () => {
  it('验证码无效(无记录) → PHASE5_PHONE_VERIFICATION_FAILED 400', async () => {
    mockPhoneRepo.findLatestValid.mockResolvedValue(null);

    await expectBusinessError(
      () =>
        authService.verifyPhoneOtp({
          phone: PHONE_VALID,
          code: '000000',
          purpose: 'login',
          clientIp: CLIENT_IP,
          userAgent: USER_AGENT,
          deviceId: DEVICE_ID,
          client: 'web',
        }),
      ErrorCode.PHASE5_PHONE_VERIFICATION_FAILED,
      400,
    );
  });

  it('验证码尝试次数超限(attempts≥5) → PHASE5_PHONE_VERIFICATION_FAILED 400', async () => {
    mockPhoneRepo.findLatestValid.mockResolvedValue(makeOtpRecord({ attempts: 4 }));
    mockPhoneRepo.incrementAttempts.mockResolvedValue(makeOtpRecord({ attempts: 5 }));

    await expectBusinessError(
      () =>
        authService.verifyPhoneOtp({
          phone: PHONE_VALID,
          code: '123456',
          purpose: 'login',
          clientIp: CLIENT_IP,
          userAgent: USER_AGENT,
          deviceId: DEVICE_ID,
          client: 'web',
        }),
      ErrorCode.PHASE5_PHONE_VERIFICATION_FAILED,
      400,
    );
  });

  it('验证码错误(safeEqual 不匹配) → PHASE5_PHONE_VERIFICATION_FAILED 400', async () => {
    mockPhoneRepo.findLatestValid.mockResolvedValue(makeOtpRecord({ code: '123456', attempts: 0 }));
    mockPhoneRepo.incrementAttempts.mockResolvedValue(makeOtpRecord({ code: '123456', attempts: 1 }));

    await expectBusinessError(
      () =>
        authService.verifyPhoneOtp({
          phone: PHONE_VALID,
          code: '999999', // 错误的验证码
          purpose: 'login',
          clientIp: CLIENT_IP,
          userAgent: USER_AGENT,
          deviceId: DEVICE_ID,
          client: 'web',
        }),
      ErrorCode.PHASE5_PHONE_VERIFICATION_FAILED,
      400,
    );
    expect(mockPhoneRepo.markConsumed).not.toHaveBeenCalled();
  });

  it('register 成功(无邀请码,创建个人租户)', async () => {
    // register 场景:无邀请码
    mockPhoneRepo.findLatestValid.mockResolvedValue(makeOtpRecord({ code: '123456', purpose: 'register', attempts: 0 }));
    mockPhoneRepo.incrementAttempts.mockResolvedValue(makeOtpRecord({ code: '123456', attempts: 1 }));
    const newUser = makeUser({ id: 'u-new', phone: PHONE_NEW, authType: 'phone' });
    const newTenant = makeTenant({ id: 't-new', name: '新用户的个人空间', type: 'individual' });
    mockTenantRepo.create.mockResolvedValue(newTenant);
    mockUserRepo.create.mockResolvedValue(newUser);
    mockTenantRepo.createMembership.mockResolvedValue({});
    setupIssueTokensAndSession(newUser, newTenant);

    const result = await authService.verifyPhoneOtp({
      phone: PHONE_NEW,
      code: '123456',
      purpose: 'register',
      clientIp: CLIENT_IP,
      userAgent: USER_AGENT,
      deviceId: DEVICE_ID,
      client: 'web',
    });

    expect(mockPhoneRepo.markConsumed).toHaveBeenCalledTimes(1);
    expect(mockTenantRepo.create).toHaveBeenCalledTimes(1); // 创建个人租户
    expect(mockUserRepo.create).toHaveBeenCalledTimes(1);
    const userCreateArg = mockUserRepo.create.mock.calls[0]![0];
    expect(userCreateArg.authType).toBe('phone');
    expect(userCreateArg.phone).toBe(PHONE_NEW);
    expect(result.accessToken).toBe('access-token-mock');
    expect(result.isFirstLogin).toBe(true);
  });

  it('login 成功(手机号已注册)', async () => {
    const existingUser = makeUser({ phone: PHONE_VALID, authType: 'phone', status: 'active' });
    const existingTenant = makeTenant();
    mockPhoneRepo.findLatestValid.mockResolvedValue(makeOtpRecord({ code: '123456', purpose: 'login', attempts: 0 }));
    mockPhoneRepo.incrementAttempts.mockResolvedValue(makeOtpRecord({ code: '123456', attempts: 1 }));
    mockUserRepo.findByPhone.mockResolvedValue(existingUser);
    mockTenantRepo.findById.mockResolvedValue(existingTenant);
    mockUserRepo.updateLastLoginAt.mockResolvedValue(undefined);
    setupIssueTokensAndSession(existingUser, existingTenant);

    const result = await authService.verifyPhoneOtp({
      phone: PHONE_VALID,
      code: '123456',
      purpose: 'login',
      clientIp: CLIENT_IP,
      userAgent: USER_AGENT,
      deviceId: DEVICE_ID,
      client: 'web',
    });

    expect(result.accessToken).toBe('access-token-mock');
    expect(result.isFirstLogin).toBe(false);
    expect(mockUserRepo.updateLastLoginAt).toHaveBeenCalledWith(existingUser.id, expect.any(Date));
  });

  it('login 场景账号已锁定 → ADMIN_USER_ALREADY_LOCKED 403', async () => {
    mockUserRepo.findByPhone.mockResolvedValue(makeUser({ status: 'locked' }));

    await expectBusinessError(
      () =>
        authService.verifyPhoneOtp({
          phone: PHONE_VALID,
          code: '123456',
          purpose: 'login',
          clientIp: CLIENT_IP,
          userAgent: USER_AGENT,
          deviceId: DEVICE_ID,
          client: 'web',
        }),
      ErrorCode.ADMIN_USER_ALREADY_LOCKED,
      403,
    );
  });

  it('bind 成功(已登录用户绑定手机号)', async () => {
    const user = makeUser({ id: USER_STUDENT, phone: null });
    const updatedUser = makeUser({ id: USER_STUDENT, phone: PHONE_NEW, phoneVerified: true });
    const tenant = makeTenant();
    mockPhoneRepo.findLatestValid.mockResolvedValue(makeOtpRecord({ code: '123456', purpose: 'bind', attempts: 0, userId: USER_STUDENT }));
    mockPhoneRepo.incrementAttempts.mockResolvedValue(makeOtpRecord({ code: '123456', attempts: 1 }));
    mockUserRepo.findByPhone.mockResolvedValue(null); // 手机号未被占用
    mockUserRepo.update.mockResolvedValue(updatedUser);
    mockTenantRepo.findById.mockResolvedValue(tenant);
    setupIssueTokensAndSession(updatedUser, tenant);

    const result = await authService.verifyPhoneOtp({
      phone: PHONE_NEW,
      code: '123456',
      purpose: 'bind',
      clientIp: CLIENT_IP,
      userAgent: USER_AGENT,
      deviceId: DEVICE_ID,
      client: 'web',
      userId: USER_STUDENT,
      tenantId: TENANT_A,
    });

    expect(mockUserRepo.update).toHaveBeenCalledWith(TENANT_A, USER_STUDENT, {
      phone: PHONE_NEW,
      phoneVerified: true,
    });
    expect(result.accessToken).toBe('access-token-mock');
  });

  it('bind 场景手机号已被其他用户绑定 → DUPLICATE_RESOURCE 409', async () => {
    mockPhoneRepo.findLatestValid.mockResolvedValue(makeOtpRecord({ code: '123456', purpose: 'bind', attempts: 0 }));
    mockPhoneRepo.incrementAttempts.mockResolvedValue(makeOtpRecord({ code: '123456', attempts: 1 }));
    // 手机号已被其他用户(不同 id)绑定
    mockUserRepo.findByPhone.mockResolvedValue(makeUser({ id: 'u-other-user', phone: PHONE_NEW }));

    await expectBusinessError(
      () =>
        authService.verifyPhoneOtp({
          phone: PHONE_NEW,
          code: '123456',
          purpose: 'bind',
          clientIp: CLIENT_IP,
          userAgent: USER_AGENT,
          deviceId: DEVICE_ID,
          client: 'web',
          userId: USER_STUDENT,
          tenantId: TENANT_A,
        }),
      ErrorCode.DUPLICATE_RESOURCE,
      409,
    );
  });
});

// ============================================================
// 测试组 3: redeemInvitation
// ============================================================

describe('AuthService.redeemInvitation', () => {
  it('邀请码无效(未找到) → PHASE5_INVITATION_INVALID 400', async () => {
    mockInvitationRepo.findValidByCode.mockResolvedValue(null);

    await expectBusinessError(
      () =>
        authService.redeemInvitation({
          code: 'invalid-code',
          clientIp: CLIENT_IP,
          userAgent: USER_AGENT,
          deviceId: DEVICE_ID,
          client: 'web',
        }),
      ErrorCode.PHASE5_INVITATION_INVALID,
      400,
    );
  });

  it('租户已被禁用 → TENANT_DISABLED 403', async () => {
    mockInvitationRepo.findValidByCode.mockResolvedValue(makeInvitation());
    mockTenantRepo.findById.mockResolvedValue(makeTenant({ status: 'disabled' }));

    await expectBusinessError(
      () =>
        authService.redeemInvitation({
          code: 'inv-code-32-chars-aaaaaaaaaaaaaa',
          clientIp: CLIENT_IP,
          userAgent: USER_AGENT,
          deviceId: DEVICE_ID,
          client: 'web',
        }),
      ErrorCode.TENANT_DISABLED,
      403,
    );
  });

  it('租户席位已满 → TENANT_SEATS_FULL 403', async () => {
    mockInvitationRepo.findValidByCode.mockResolvedValue(makeInvitation());
    mockTenantRepo.findById.mockResolvedValue(makeTenant({ maxSeats: 50 }));
    mockTenantRepo.countMembers.mockResolvedValue(50); // 已满

    await expectBusinessError(
      () =>
        authService.redeemInvitation({
          code: 'inv-code-32-chars-aaaaaaaaaaaaaa',
          clientIp: CLIENT_IP,
          userAgent: USER_AGENT,
          deviceId: DEVICE_ID,
          client: 'web',
        }),
      ErrorCode.TENANT_SEATS_FULL,
      403,
    );
  });

  it('新用户兑换邀请码成功(authType=invitation)', async () => {
    const invitation = makeInvitation({ role: 'student' });
    mockInvitationRepo.findValidByCode.mockResolvedValue(invitation);
    mockTenantRepo.findById.mockResolvedValue(makeTenant({ maxSeats: 100 }));
    mockTenantRepo.countMembers.mockResolvedValue(10);
    const newUser = makeUser({ id: 'u-invited', authType: 'invitation', role: 'student' });
    mockUserRepo.create.mockResolvedValue(newUser);
    mockTenantRepo.findMembership.mockResolvedValue(null); // 未加入
    mockTenantRepo.createMembership.mockResolvedValue({});
    mockUserRepo.switchTenant.mockResolvedValue(newUser);
    mockInvitationRepo.incrementUsed.mockResolvedValue(invitation);
    setupIssueTokensAndSession(newUser, makeTenant());

    const result = await authService.redeemInvitation({
      code: 'inv-code-32-chars-aaaaaaaaaaaaaa',
      name: '新学生',
      clientIp: CLIENT_IP,
      userAgent: USER_AGENT,
      deviceId: DEVICE_ID,
      client: 'web',
    });

    expect(mockUserRepo.create).toHaveBeenCalledTimes(1);
    const createArg = mockUserRepo.create.mock.calls[0]![0];
    expect(createArg.authType).toBe('invitation');
    expect(createArg.role).toBe('student');
    expect(mockInvitationRepo.incrementUsed).toHaveBeenCalledTimes(1);
    expect(result.isFirstLogin).toBe(true);
    expect(result.accessToken).toBe('access-token-mock');
  });
});

// ============================================================
// 测试组 4: registerAdmin
// ============================================================

describe('AuthService.registerAdmin', () => {
  const ADMIN_EMAIL = 'admin@school.edu.cn';
  const ADMIN_PASSWORD = 'StrongPass123';

  it('邀请码角色非 admin/owner → PHASE5_ADMIN_AUTH_FAILED 403', async () => {
    mockInvitationRepo.findValidByCode.mockResolvedValue(makeInvitation({ role: 'student' }));

    await expectBusinessError(
      () =>
        authService.registerAdmin({
          email: ADMIN_EMAIL,
          password: ADMIN_PASSWORD,
          name: '管理员',
          invitationCode: 'inv-code-32-chars-aaaaaaaaaaaaaa',
          clientIp: CLIENT_IP,
          userAgent: USER_AGENT,
          deviceId: DEVICE_ID,
          client: 'admin',
        }),
      ErrorCode.PHASE5_ADMIN_AUTH_FAILED,
      403,
    );
  });

  it('邀请码无效 → PHASE5_INVITATION_INVALID 400', async () => {
    mockInvitationRepo.findValidByCode.mockResolvedValue(null);

    await expectBusinessError(
      () =>
        authService.registerAdmin({
          email: ADMIN_EMAIL,
          password: ADMIN_PASSWORD,
          name: '管理员',
          invitationCode: 'invalid',
          clientIp: CLIENT_IP,
          userAgent: USER_AGENT,
          deviceId: DEVICE_ID,
          client: 'admin',
        }),
      ErrorCode.PHASE5_INVITATION_INVALID,
      400,
    );
  });

  it('邮箱已注册 → DUPLICATE_RESOURCE 409', async () => {
    mockInvitationRepo.findValidByCode.mockResolvedValue(makeInvitation({ role: 'admin' }));
    mockUserRepo.findByEmail.mockResolvedValue(makeUser({ email: ADMIN_EMAIL }));

    await expectBusinessError(
      () =>
        authService.registerAdmin({
          email: ADMIN_EMAIL,
          password: ADMIN_PASSWORD,
          name: '管理员',
          invitationCode: 'inv-code-32-chars-aaaaaaaaaaaaaa',
          clientIp: CLIENT_IP,
          userAgent: USER_AGENT,
          deviceId: DEVICE_ID,
          client: 'admin',
        }),
      ErrorCode.DUPLICATE_RESOURCE,
      409,
    );
  });

  it('密码复杂度不足 → PARAM_INVALID 400', async () => {
    mockInvitationRepo.findValidByCode.mockResolvedValue(makeInvitation({ role: 'admin' }));
    mockUserRepo.findByEmail.mockResolvedValue(null);
    mockPassword.validatePasswordComplexity.mockImplementation(() => {
      throw new Error('密码长度至少 8 位');
    });

    await expectBusinessError(
      () =>
        authService.registerAdmin({
          email: ADMIN_EMAIL,
          password: 'weak',
          name: '管理员',
          invitationCode: 'inv-code-32-chars-aaaaaaaaaaaaaa',
          clientIp: CLIENT_IP,
          userAgent: USER_AGENT,
          deviceId: DEVICE_ID,
          client: 'admin',
        }),
      ErrorCode.PARAM_INVALID,
      400,
    );
  });

  it('成功注册管理员(authType=password,使用邀请码所属租户)', async () => {
    const invitation = makeInvitation({ role: 'admin', tenantId: TENANT_A });
    mockInvitationRepo.findValidByCode.mockResolvedValue(invitation);
    mockUserRepo.findByEmail.mockResolvedValue(null);
    const newAdmin = makeUser({
      id: 'u-new-admin',
      email: ADMIN_EMAIL,
      authType: 'password',
      role: 'admin',
      passwordHash: 'hashed-password-mock',
    });
    mockTenantRepo.findById.mockResolvedValue(makeTenant());
    mockUserRepo.create.mockResolvedValue(newAdmin);
    mockTenantRepo.createMembership.mockResolvedValue({});
    mockInvitationRepo.incrementUsed.mockResolvedValue(invitation);
    setupIssueTokensAndSession(newAdmin, makeTenant());

    const result = await authService.registerAdmin({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      name: '新管理员',
      invitationCode: 'inv-code-32-chars-aaaaaaaaaaaaaa',
      clientIp: CLIENT_IP,
      userAgent: USER_AGENT,
      deviceId: DEVICE_ID,
      client: 'admin',
    });

    expect(mockPassword.hashPassword).toHaveBeenCalledWith(ADMIN_PASSWORD);
    const createArg = mockUserRepo.create.mock.calls[0]![0];
    expect(createArg.authType).toBe('password');
    expect(createArg.passwordHash).toBe('hashed-password-mock');
    expect(createArg.email).toBe(ADMIN_EMAIL);
    expect(createArg.role).toBe('admin');
    expect(result.isFirstLogin).toBe(true);
    expect(result.accessToken).toBe('access-token-mock');
  });

  it('成功注册管理员(创建新租户,提供 tenantName)', async () => {
    const invitation = makeInvitation({ role: 'owner' });
    mockInvitationRepo.findValidByCode.mockResolvedValue(invitation);
    mockUserRepo.findByEmail.mockResolvedValue(null);
    const newTenant = makeTenant({ id: 't-new-school', name: '新美术学院', type: 'school' });
    mockTenantRepo.create.mockResolvedValue(newTenant);
    const newOwner = makeUser({ id: 'u-owner', authType: 'password', role: 'owner' });
    mockUserRepo.create.mockResolvedValue(newOwner);
    mockTenantRepo.createMembership.mockResolvedValue({});
    mockInvitationRepo.incrementUsed.mockResolvedValue(invitation);
    setupIssueTokensAndSession(newOwner, newTenant);

    const result = await authService.registerAdmin({
      email: 'owner@newschool.edu.cn',
      password: ADMIN_PASSWORD,
      name: '校长',
      invitationCode: 'inv-code-32-chars-aaaaaaaaaaaaaa',
      tenantName: '新美术学院',
      clientIp: CLIENT_IP,
      userAgent: USER_AGENT,
      deviceId: DEVICE_ID,
      client: 'admin',
    });

    expect(mockTenantRepo.create).toHaveBeenCalledTimes(1);
    const tenantCreateArg = mockTenantRepo.create.mock.calls[0]![0];
    expect(tenantCreateArg.name).toBe('新美术学院');
    expect(tenantCreateArg.type).toBe('school');
    expect(result.isFirstLogin).toBe(true);
  });
});

// ============================================================
// 测试组 5: loginAdmin
// ============================================================

describe('AuthService.loginAdmin', () => {
  const ADMIN_EMAIL = 'admin@school.edu.cn';
  const ADMIN_PASSWORD = 'StrongPass123';

  it('用户不存在(邮箱未注册) → PHASE5_ADMIN_AUTH_FAILED 401', async () => {
    mockUserRepo.findByEmail.mockResolvedValue(null);

    await expectBusinessError(
      () =>
        authService.loginAdmin({
          email: ADMIN_EMAIL,
          password: ADMIN_PASSWORD,
          clientIp: CLIENT_IP,
          userAgent: USER_AGENT,
          deviceId: DEVICE_ID,
          client: 'admin',
        }),
      ErrorCode.PHASE5_ADMIN_AUTH_FAILED,
      401,
    );
  });

  it('authType 非 password → PHASE5_ADMIN_AUTH_FAILED 401', async () => {
    mockUserRepo.findByEmail.mockResolvedValue(makeUser({ authType: 'feishu' }));

    await expectBusinessError(
      () =>
        authService.loginAdmin({
          email: ADMIN_EMAIL,
          password: ADMIN_PASSWORD,
          clientIp: CLIENT_IP,
          userAgent: USER_AGENT,
          deviceId: DEVICE_ID,
          client: 'admin',
        }),
      ErrorCode.PHASE5_ADMIN_AUTH_FAILED,
      401,
    );
  });

  it('账号已锁定 → ADMIN_USER_ALREADY_LOCKED 403', async () => {
    mockUserRepo.findByEmail.mockResolvedValue(
      makeUser({ authType: 'password', status: 'locked', passwordHash: 'hash' }),
    );

    await expectBusinessError(
      () =>
        authService.loginAdmin({
          email: ADMIN_EMAIL,
          password: ADMIN_PASSWORD,
          clientIp: CLIENT_IP,
          userAgent: USER_AGENT,
          deviceId: DEVICE_ID,
          client: 'admin',
        }),
      ErrorCode.ADMIN_USER_ALREADY_LOCKED,
      403,
    );
  });

  it('密码错误(verifyPassword 返回 false) → PHASE5_ADMIN_AUTH_FAILED 401', async () => {
    mockUserRepo.findByEmail.mockResolvedValue(
      makeUser({ authType: 'password', status: 'active', passwordHash: 'hash' }),
    );
    mockPassword.verifyPassword.mockResolvedValue(false);

    await expectBusinessError(
      () =>
        authService.loginAdmin({
          email: ADMIN_EMAIL,
          password: 'WrongPassword123',
          clientIp: CLIENT_IP,
          userAgent: USER_AGENT,
          deviceId: DEVICE_ID,
          client: 'admin',
        }),
      ErrorCode.PHASE5_ADMIN_AUTH_FAILED,
      401,
    );
  });

  it('租户已被禁用 → TENANT_DISABLED 403', async () => {
    mockUserRepo.findByEmail.mockResolvedValue(
      makeUser({ authType: 'password', status: 'active', passwordHash: 'hash' }),
    );
    mockTenantRepo.findById.mockResolvedValue(makeTenant({ status: 'disabled' }));

    await expectBusinessError(
      () =>
        authService.loginAdmin({
          email: ADMIN_EMAIL,
          password: ADMIN_PASSWORD,
          clientIp: CLIENT_IP,
          userAgent: USER_AGENT,
          deviceId: DEVICE_ID,
          client: 'admin',
        }),
      ErrorCode.TENANT_DISABLED,
      403,
    );
  });

  it('成功登录管理员', async () => {
    const admin = makeUser({
      id: USER_ADMIN,
      email: ADMIN_EMAIL,
      authType: 'password',
      status: 'active',
      passwordHash: 'hashed-password-mock',
      role: 'admin',
    });
    const tenant = makeTenant();
    mockUserRepo.findByEmail.mockResolvedValue(admin);
    mockPassword.verifyPassword.mockResolvedValue(true);
    mockTenantRepo.findById.mockResolvedValue(tenant);
    mockUserRepo.updateLastLoginAt.mockResolvedValue(undefined);
    setupIssueTokensAndSession(admin, tenant);

    const result = await authService.loginAdmin({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      clientIp: CLIENT_IP,
      userAgent: USER_AGENT,
      deviceId: DEVICE_ID,
      client: 'admin',
    });

    expect(mockPassword.verifyPassword).toHaveBeenCalledWith(ADMIN_PASSWORD, 'hashed-password-mock');
    expect(mockUserRepo.updateLastLoginAt).toHaveBeenCalledWith(USER_ADMIN, expect.any(Date));
    expect(result.isFirstLogin).toBe(false);
    expect(result.accessToken).toBe('access-token-mock');
    expect(result.user.id).toBe(USER_ADMIN);
  });
});

// ============================================================
// 测试组 6: bindPhone
// ============================================================

describe('AuthService.bindPhone', () => {
  it('验证码无效 → PHASE5_PHONE_VERIFICATION_FAILED 400', async () => {
    mockPhoneRepo.findLatestValid.mockResolvedValue(null);

    await expectBusinessError(
      () =>
        authService.bindPhone({
          userId: USER_STUDENT,
          tenantId: TENANT_A,
          phone: PHONE_NEW,
          code: '000000',
          clientIp: CLIENT_IP,
          userAgent: USER_AGENT,
          deviceId: DEVICE_ID,
          client: 'web',
        }),
      ErrorCode.PHASE5_PHONE_VERIFICATION_FAILED,
      400,
    );
  });

  it('手机号已被其他用户绑定 → DUPLICATE_RESOURCE 409', async () => {
    mockPhoneRepo.findLatestValid.mockResolvedValue(makeOtpRecord({ code: '123456', purpose: 'bind', attempts: 0 }));
    mockPhoneRepo.incrementAttempts.mockResolvedValue(makeOtpRecord({ code: '123456', attempts: 1 }));
    // 手机号已被其他用户绑定
    mockUserRepo.findByPhone.mockResolvedValue(makeUser({ id: 'u-other', phone: PHONE_NEW }));

    await expectBusinessError(
      () =>
        authService.bindPhone({
          userId: USER_STUDENT,
          tenantId: TENANT_A,
          phone: PHONE_NEW,
          code: '123456',
          clientIp: CLIENT_IP,
          userAgent: USER_AGENT,
          deviceId: DEVICE_ID,
          client: 'web',
        }),
      ErrorCode.DUPLICATE_RESOURCE,
      409,
    );
  });

  it('成功绑定手机号(强制 tenantId 校验)', async () => {
    mockPhoneRepo.findLatestValid.mockResolvedValue(makeOtpRecord({ code: '123456', purpose: 'bind', attempts: 0 }));
    mockPhoneRepo.incrementAttempts.mockResolvedValue(makeOtpRecord({ code: '123456', attempts: 1 }));
    mockUserRepo.findByPhone.mockResolvedValue(null); // 未被占用
    const updatedUser = makeUser({ id: USER_STUDENT, phone: PHONE_NEW, phoneVerified: true });
    mockUserRepo.update.mockResolvedValue(updatedUser);

    const result = await authService.bindPhone({
      userId: USER_STUDENT,
      tenantId: TENANT_A,
      phone: PHONE_NEW,
      code: '123456',
      clientIp: CLIENT_IP,
      userAgent: USER_AGENT,
      deviceId: DEVICE_ID,
      client: 'web',
    });

    expect(mockUserRepo.update).toHaveBeenCalledWith(TENANT_A, USER_STUDENT, {
      phone: PHONE_NEW,
      phoneVerified: true,
    });
    expect(result.bound).toBe(true);
    expect(result.user.phone).toBe(PHONE_NEW);
  });
});
