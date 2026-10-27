// ============================================================
// 认证业务服务
// 对应文档:auth-design.md §1.2 完整 12 步流程
// 业务编排:state 生成 → 飞书 OAuth → User/Tenant 创建/更新 → JWT 签发 → Session 落库
// ============================================================

import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { redis } from '../config/redis.js';
import { feishuService } from './feishu.service.js';
import { jwtService } from './jwt.service.js';
import { sessionService } from './session.service.js';
import { tenantRepository } from '../repositories/tenant.repository.js';
import { userRepository } from '../repositories/user.repository.js';
import { phoneVerificationRepository, MAX_OTP_ATTEMPTS, OTP_TTL_SEC, OTP_RESEND_COOLDOWN_SEC, type PhoneOtpPurpose } from '../repositories/phone-verification.repository.js';
import { invitationRepository } from '../repositories/invitation.repository.js';
import { getSmsGateway } from './sms-gateway.service.js';
import { presenceService } from './presence.service.js';
import { generateState, isValidStateFormat, generateUuid, safeEqual } from '../utils/crypto.js';
import { hashPassword, verifyPassword, validatePasswordComplexity } from '../utils/password.js';
import { BusinessError } from '../middlewares/error-handler.js';
import { ErrorCode, type UserProfile, type TenantInfo, type TenantMembership, type FeishuAuthorizeResponse, type AuthRefreshResponse, type AuthLogoutResponse, type AuthMeResponse, type UserRole, type PhoneOtpResponse } from '../types/api-contract.js';
import type { AuthType } from '../types/arbitration.js';
import { logger } from '../utils/logger.js';
import type { Session, Tenant, User } from '@prisma/client';

/**
 * state 上下文(存 Redis)
 */
interface StateContext {
  clientIp: string;
  userAgent: string;
  deviceId: string;
  client: 'web' | 'admin' | 'mobile';
  createdAt: number;
}

/**
 * 飞书回调结果(用于 controller 转换为响应)
 */
export interface AuthLoginResult {
  accessToken: string;
  accessTokenExpiresAt: string;
  isFirstLogin: boolean;
  user: UserProfile;
  tenant: TenantInfo;
  refreshToken: string; // 明文,由 controller 写入 Cookie,不返回响应体
}

class AuthServiceClass {
  /**
   * 步骤 2-3:生成 authorize URL + state,存 Redis(TTL 300s)
   * 对应 auth-design.md §1.2 步骤 2-3
   */
  async authorize(params: {
    redirectUri?: string; // 客户端可覆盖,但必须在白名单内(Phase 1 简化:信任 env 默认)
    client: 'web' | 'admin' | 'mobile';
    clientIp: string;
    userAgent: string;
    deviceId: string;
  }): Promise<FeishuAuthorizeResponse> {
    const redirectUri = params.redirectUri ?? feishuService.pickRedirectUri(params.client);
    const state = generateState();
    const ctx: StateContext = {
      clientIp: params.clientIp,
      userAgent: params.userAgent,
      deviceId: params.deviceId,
      client: params.client,
      createdAt: Date.now(),
    };
    // Redis 存储,TTL 300s
    await redis().set(`oauth:state:${state}`, JSON.stringify(ctx), 'EX', 300);

    const authorizeUrl = feishuService.buildAuthorizeUrl(state, redirectUri);
    logger.debug({ state: state.slice(0, 8) + '...', client: params.client }, '[auth] state issued');

    return {
      authorizeUrl,
      state,
      redirectUri,
    };
  }

  /**
   * 步骤 6-10:OAuth 回调处理
   * 校验 state → 换 token → 获取用户 → 创建/更新 User+TenantMember → 签发 JWT → 落 Session
   * 对应 auth-design.md §1.2 步骤 6-10
   */
  async handleCallback(params: {
    code: string;
    state: string;
    clientIp: string;
    userAgent: string;
    deviceId: string;
    client: 'web' | 'admin' | 'mobile';
  }): Promise<AuthLoginResult> {
    // ===== 步骤 6:校验 state(三重比对 + 一次性消费) =====
    await this.validateAndConsumeState({
      state: params.state,
      clientIp: params.clientIp,
      userAgent: params.userAgent,
      deviceId: params.deviceId,
    });

    // ===== 步骤 7:用 code 换 token =====
    const tokenResult = await feishuService.exchangeCodeForToken(params.code);

    // ===== 步骤 7d:获取用户信息 =====
    const feishuUser = await feishuService.getUserInfo(tokenResult.accessToken);
    if (!feishuUser.unionId) {
      throw new BusinessError(ErrorCode.FEISHU_USER_INFO_FAILED, '飞书用户信息获取失败:union_id 缺失', 502);
    }

    // ===== 步骤 8:查询/创建 User + TenantMember(事务) =====
    const { user, tenant, isFirstLogin } = await this.upsertUserAndTenant({
      feishuUser,
    });

    // ===== 步骤 9:签发 JWT(access_token + refresh_token) =====
    const accessResult = jwtService.issueAccessToken({
      userId: user.id,
      tenantId: tenant.id,
      role: user.role,
      feishuOpenId: user.feishuOpenId ?? '',
      client: params.client,
      // Phase 5:飞书 OAuth 登录固定为 'feishu'
      authType: 'feishu',
    });
    const refreshResult = jwtService.issueRefreshToken({
      userId: user.id,
      client: params.client,
    });

    // ===== 步骤 9f:落 Session(DB + Redis 双写) =====
    const session = await sessionService.createSession({
      userId: user.id,
      tenantId: tenant.id,
      refreshToken: refreshResult.token,
      userAgent: params.userAgent,
      ip: params.clientIp,
      expiresAt: refreshResult.expiresAt,
      refreshJti: refreshResult.jti,
    });

    // M4-AUTH-1:登录成功埋点 — 标记用户在线(内部 catch 不抛,不影响登录主流程)
    // 防御性判空:session 缺失时跳过埋点,绝不允许 presence 影响登录
    if (session?.id) {
      await presenceService.markOnline(user.id, session.id, params.client);
    }

    logger.info({ userId: user.id, tenantId: tenant.id, isFirstLogin }, '[auth] login success');

    return {
      accessToken: accessResult.token,
      accessTokenExpiresAt: accessResult.expiresAt.toISOString(),
      isFirstLogin,
      user: this.toUserProfile(user),
      tenant: this.toTenantInfo(tenant),
      refreshToken: refreshResult.token,
    };
  }

  /**
   * 飞书扫码登录:用扫码确认返回的 code 换 token + 创建/更新用户 + 签发 JWT
   * 复用 handleCallback 的步骤 7-9(去掉 state 校验,扫码登录 state 仅用于 CSRF)
   */
  async feishuQrLogin(params: {
    code: string;
    clientIp: string;
    userAgent: string;
    deviceId: string;
    client: 'web' | 'admin' | 'mobile';
  }): Promise<AuthLoginResult> {
    // 1. 用 code 换 token
    const tokenResult = await feishuService.exchangeCodeForToken(params.code);

    // 2. 获取用户信息
    const feishuUser = await feishuService.getUserInfo(tokenResult.accessToken);
    if (!feishuUser.unionId) {
      throw new BusinessError(ErrorCode.FEISHU_USER_INFO_FAILED, '飞书用户信息获取失败:union_id 缺失', 502);
    }

    // 3. 查询/创建 User + TenantMember
    const { user, tenant, isFirstLogin } = await this.upsertUserAndTenant({ feishuUser });

    // 4. 签发 JWT + 落 Session
    const result = await this.issueTokensAndSession({
      user,
      tenant,
      client: params.client,
      clientIp: params.clientIp,
      userAgent: params.userAgent,
      isFirstLogin,
    });

    logger.info({ userId: user.id, tenantId: tenant.id }, '[auth] qr login success');

    return result;
  }

  /**
   * 步骤 12:刷新 access_token(滚动刷新)
   * 对应 auth-design.md §1.2 步骤 12
   * @param client 客户端类型,由 controller 从 X-Client 头解析(默认 web)
   */
  async refresh(
    refreshToken: string,
    client: 'web' | 'admin' | 'mobile' = 'web',
  ): Promise<AuthRefreshResponse> {
    // ===== 性能埋点(临时,用于定位 5 秒延迟瓶颈)=====
    const t0 = performance.now();
    const stepTimings: Record<string, number> = {};

    // 1+2+3. JWT 校验 + 黑名单 + Session 表校验
    let session: Session;
    let oldJti: string;
    try {
      const t1 = performance.now();
      const r = await sessionService.validateRefreshToken(refreshToken);
      stepTimings.validateRefreshToken = Math.round((performance.now() - t1) * 100) / 100;
      session = r.session;
      oldJti = r.jti;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ err: msg }, '[auth] refresh validation failed');
      throw new BusinessError(ErrorCode.REFRESH_TOKEN_INVALID, 'refresh_token 无效,请重新登录', 401);
    }

    // 4. 读取用户最新信息(从 DB 重新读取权限,对应 auth-design.md §2.2)
    const tUser = performance.now();
    const user = await userRepository.findById(session.userId);
    stepTimings.userFindById = Math.round((performance.now() - tUser) * 100) / 100;
    if (!user) {
      throw new BusinessError(ErrorCode.REFRESH_TOKEN_INVALID, 'refresh_token 无效,请重新登录', 401);
    }

    const tTenant = performance.now();
    const tenant = await tenantRepository.findById(user.tenantId);
    stepTimings.tenantFindById = Math.round((performance.now() - tTenant) * 100) / 100;
    if (!tenant) {
      throw new BusinessError(ErrorCode.TENANT_NOT_FOUND, '租户不存在', 404);
    }
    if (tenant.status === 'disabled') {
      throw new BusinessError(ErrorCode.TENANT_DISABLED, '租户已被禁用', 403);
    }

    // 5. 签发新 access_token + 新 refresh_token(滚动)
    const tJwt = performance.now();
    const accessResult = jwtService.issueAccessToken({
      userId: user.id,
      tenantId: tenant.id,
      role: user.role,
      feishuOpenId: user.feishuOpenId ?? '',
      client,
      // Phase 5:刷新时保留用户原始 authType(DB 字段),旧用户缺省为 'feishu'
      authType: (user.authType as AuthType | undefined) ?? 'feishu',
    });
    const refreshResult = jwtService.issueRefreshToken({
      userId: user.id,
      client,
    });
    stepTimings.jwtIssue = Math.round((performance.now() - tJwt) * 100) / 100;

    // 6. 滚动:旧 jti 入黑名单 + 更新 Session.refreshTokenHash + 更新 Redis
    const tRotate = performance.now();
    await sessionService.rotateRefreshToken({
      oldRefreshToken: refreshToken,
      oldJti,
      newRefreshToken: refreshResult.token,
      newJti: refreshResult.jti,
      sessionId: session.id,
      tenantId: session.tenantId,
      expiresAt: refreshResult.expiresAt,
    });
    stepTimings.rotateRefreshToken = Math.round((performance.now() - tRotate) * 100) / 100;

    const totalMs = Math.round((performance.now() - t0) * 100) / 100;
    logger.info(
      {
        userId: user.id,
        totalMs,
        ...stepTimings,
      },
      '[auth] refresh success (perf trace)',
    );

    return {
      accessToken: accessResult.token,
      accessTokenExpiresAt: accessResult.expiresAt.toISOString(),
    };
  }

  /**
   * 登出:撤销 Session + 加入 access_token 黑名单 + 清 Cookie
   */
  async logout(params: {
    refreshToken: string | undefined;
    accessJti?: string;
    accessExpSec?: number;
    userId?: string;
    tenantId?: string;
    revokeAll?: boolean;
  }): Promise<AuthLogoutResponse> {
    let revokedSessions = 0;

    // 1. 撤销当前 refresh_token 对应的 Session
    if (params.refreshToken) {
      await sessionService.revokeByRefreshToken(params.refreshToken);
      revokedSessions += 1;
    }

    // 2. 撤销全部会话(可选)
    if (params.revokeAll && params.userId) {
      revokedSessions = await sessionService.revokeAllByUser(params.userId, params.tenantId);
    }

    // 3. 当前 access_token 加入黑名单(可选,加速失效)
    if (params.accessJti && params.accessExpSec) {
      await sessionService.revokeAccessTokenJti(params.accessJti, params.accessExpSec);
    }

    // 4. M4-AUTH-1:登出埋点 — 标记用户离线(内部 catch 不抛,不影响登出主流程)
    //    用户主动登出视为离线;若还有其他设备有效会话,下次请求经认证中间件 touch 时会重新上线
    if (params.userId) {
      await presenceService.markOffline(params.userId);
    }

    logger.info({ userId: params.userId, revokedSessions }, '[auth] logout');

    return { revokedSessions };
  }

  /**
   * GET /auth/me:获取当前用户信息(含 memberships)
   */
  async getCurrentUserInfo(userId: string): Promise<AuthMeResponse> {
    const user = await userRepository.findById(userId);
    if (!user) {
      throw new BusinessError(ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }
    const tenant = await tenantRepository.findById(user.tenantId);
    if (!tenant) {
      throw new BusinessError(ErrorCode.TENANT_NOT_FOUND, '租户不存在', 404);
    }
    const membershipsRaw = await userRepository.findMemberships(userId);
    const memberships: TenantMembership[] = membershipsRaw.map((m) => ({
      tenantId: m.tenantId,
      tenantName: m.tenant.name,
      tenantType: m.tenant.type as TenantMembership['tenantType'],
      role: m.role as UserRole,
      joinedAt: m.joinedAt.toISOString(),
    }));

    return {
      user: this.toUserProfile(user),
      tenant: this.toTenantInfo(tenant),
      memberships,
    };
  }

  // ============================================================
  // Phase 5:手机 OTP 认证扩展
  // ============================================================

  /**
   * POST /auth/phone/otp:发送手机验证码
   * 6 位数字,5 分钟过期,60 秒重发冷却,5 次尝试上限
   * @param phone 手机号(已由 Zod 校验格式)
   * @param purpose 用途:register/login/bind/reset
   * @param clientIp 客户端 IP(限流与审计)
   * @param tenantId bind 场景必传
   * @param userId bind 场景必传(当前登录用户)
   */
  async sendPhoneOtp(params: {
    phone: string;
    purpose: PhoneOtpPurpose;
    clientIp: string;
    tenantId?: string;
    userId?: string;
  }): Promise<PhoneOtpResponse> {
    // 1. 手机号正则校验(env 可配,默认中国大陆)
    const phoneRegex = new RegExp(env().phoneRegex);
    if (!phoneRegex.test(params.phone)) {
      throw new BusinessError(ErrorCode.PARAM_INVALID, '手机号格式不正确', 400);
    }

    // 2. bind 场景校验 tenantId + userId
    if (params.purpose === 'bind') {
      if (!params.tenantId || !params.userId) {
        throw new BusinessError(ErrorCode.PARAM_MISSING, 'bind 场景必须提供 tenantId 和 userId', 400);
      }
    }

    // 3. 重发冷却校验(限流优先):在用户存在性检查之前执行
    //    安全考量:不通过冷却校验时不应暴露手机号是否已注册(信息泄露防护)
    //    性能考量:避免对限流请求执行 DB 查询
    const latest = await phoneVerificationRepository.findLatest(params.phone, params.purpose);
    if (latest) {
      const elapsedSec = Math.floor((Date.now() - latest.createdAt.getTime()) / 1000);
      if (elapsedSec < OTP_RESEND_COOLDOWN_SEC) {
        throw new BusinessError(
          ErrorCode.RATE_LIMITED,
          `验证码已发送,请 ${OTP_RESEND_COOLDOWN_SEC - elapsedSec} 秒后重试`,
          429,
        );
      }
    }

    // 4. register 场景:手机号未注册才允许发送
    if (params.purpose === 'register') {
      const existing = await userRepository.findByPhone(params.phone);
      if (existing) {
        throw new BusinessError(ErrorCode.DUPLICATE_RESOURCE, '该手机号已注册', 409);
      }
    }

    // 5. login 场景:手机号必须已注册
    if (params.purpose === 'login') {
      const existing = await userRepository.findByPhone(params.phone);
      if (!existing) {
        throw new BusinessError(ErrorCode.RESOURCE_NOT_FOUND, '该手机号未注册', 404);
      }
    }

    // 6. 生成 6 位数字验证码
    const code = this.generateOtpCode();

    // 7. 落库(5 分钟过期)
    await phoneVerificationRepository.create({
      phone: params.phone,
      code,
      purpose: params.purpose,
      ip: params.clientIp,
      tenantId: params.tenantId,
      userId: params.userId,
    });

    // 8. 发送短信(通过 SmsGateway 抽象,默认 mock 日志输出)
    try {
      await getSmsGateway().sendOtp({
        phone: params.phone,
        code,
        purpose: params.purpose,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ msg, purpose: params.purpose }, '[auth] sms gateway failed');
      throw new BusinessError(ErrorCode.UPSTREAM_UNAVAILABLE, '短信发送失败,请稍后重试', 502);
    }

    const expiresAt = new Date(Date.now() + OTP_TTL_SEC * 1000);
    logger.info({ purpose: params.purpose, phone: params.phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2') }, '[auth] phone otp sent');

    return {
      sent: true,
      resendAfter: OTP_RESEND_COOLDOWN_SEC,
      expiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * POST /auth/phone/verify:验证码校验 + 登录/注册
   * register 场景:创建用户(可选带邀请码加入租户)
   * login 场景:直接登录
   * bind 场景:绑定手机号到已有用户(需已登录,service 内校验 userId)
   * reset 场景:仅校验验证码,返回手机号供后续重置流程
   */
  async verifyPhoneOtp(params: {
    phone: string;
    code: string;
    purpose: PhoneOtpPurpose;
    invitationCode?: string;
    name?: string;
    clientIp: string;
    userAgent: string;
    deviceId: string;
    client: 'web' | 'admin' | 'mobile';
    userId?: string; // bind 场景必传
    tenantId?: string; // bind 场景必传
  }): Promise<AuthLoginResult> {
    // 1. 校验验证码
    await this.consumeOtp(params.phone, params.code, params.purpose);

    // 2. 按用途分支处理
    if (params.purpose === 'register') {
      return this.handlePhoneRegister(params);
    }
    if (params.purpose === 'login') {
      return this.handlePhoneLogin(params);
    }
    if (params.purpose === 'bind') {
      return this.handlePhoneBind(params);
    }
    // reset:仅校验通过,返回简化响应(无 token,前端进入重置流程)
    // 复用 register 分支的结构,但不创建用户;返回 reset 临时凭据(Redis)
    return this.handlePhoneReset(params);
  }

  /**
   * POST /auth/invitation/redeem:邀请码兑换 + 加入租户
   * 流程:校验邀请码 → 创建/查找用户 → 加入租户成员 → 签发 JWT
   */
  async redeemInvitation(params: {
    code: string;
    name?: string;
    clientIp: string;
    userAgent: string;
    deviceId: string;
    client: 'web' | 'admin' | 'mobile';
    existingUserId?: string; // 已登录用户兑换邀请码加入新租户
  }): Promise<AuthLoginResult> {
    // 1. 校验邀请码
    const invitation = await invitationRepository.findValidByCode(params.code);
    if (!invitation) {
      throw new BusinessError(ErrorCode.PHASE5_INVITATION_INVALID, '邀请码无效或已过期', 400);
    }

    // 2. 校验租户状态
    const tenant = await tenantRepository.findById(invitation.tenantId);
    if (!tenant) {
      throw new BusinessError(ErrorCode.TENANT_NOT_FOUND, '租户不存在', 404);
    }
    if (tenant.status === 'disabled') {
      throw new BusinessError(ErrorCode.TENANT_DISABLED, '租户已被禁用', 403);
    }

    // 3. 校验席位上限
    const memberCount = await tenantRepository.countMembers(tenant.id);
    if (memberCount >= tenant.maxSeats) {
      throw new BusinessError(ErrorCode.TENANT_SEATS_FULL, '租户席位已满', 403);
    }

    // 4. 创建或复用用户
    let user: User;
    let isFirstLogin: boolean;
    if (params.existingUserId) {
      // 已登录用户加入新租户
      const existing = await userRepository.findById(params.existingUserId);
      if (!existing) {
        throw new BusinessError(ErrorCode.UNAUTHORIZED, '用户未登录', 401);
      }
      user = existing;
      isFirstLogin = false;
    } else {
      // 邀请码注册新用户(authType=invitation)
      const userName = params.name ?? `用户${params.code.slice(0, 6)}`;
      user = await userRepository.create({
        tenant: { connect: { id: tenant.id } },
        authType: 'invitation',
        feishuOpenId: null,
        feishuUnionId: null,
        name: userName,
        avatar: '',
        role: invitation.role,
        lastLoginAt: new Date(),
      });
      isFirstLogin = true;
    }

    // 5. 创建租户成员关系(若已存在则跳过)
    const existingMembership = await tenantRepository.findMembership(user.id, tenant.id);
    if (!existingMembership) {
      await tenantRepository.createMembership({
        userId: user.id,
        tenantId: tenant.id,
        role: invitation.role,
      });
    }

    // 6. 切换用户激活租户到邀请码所属租户
    if (user.tenantId !== tenant.id) {
      user = await userRepository.switchTenant(user.id, tenant.id, invitation.role);
    }

    // 7. 邀请码使用次数 +1(原子操作)
    await invitationRepository.incrementUsed(params.code);

    // 8. 签发 JWT + 落 Session
    const result = await this.issueTokensAndSession({
      user,
      tenant,
      client: params.client,
      clientIp: params.clientIp,
      userAgent: params.userAgent,
      isFirstLogin,
    });

    return result;
  }

  // ============================================================
  // Phase 5:院校管理员认证(邮箱+密码)
  // ============================================================

  /**
   * POST /auth/register/admin:院校管理员注册
   * 流程:校验邀请码(admin 角色)→ 校验密码复杂度 → 哈希密码 → 创建用户 → 签发 JWT
   */
  async registerAdmin(params: {
    email: string;
    password: string;
    name: string;
    invitationCode: string;
    tenantName?: string;
    clientIp: string;
    userAgent: string;
    deviceId: string;
    client: 'web' | 'admin' | 'mobile';
  }): Promise<AuthLoginResult> {
    // 1. 校验邀请码(必须是 admin 角色)
    const invitation = await invitationRepository.findValidByCode(params.invitationCode);
    if (!invitation) {
      throw new BusinessError(ErrorCode.PHASE5_INVITATION_INVALID, '邀请码无效或已过期', 400);
    }
    if (invitation.role !== 'admin' && invitation.role !== 'owner') {
      throw new BusinessError(ErrorCode.PHASE5_ADMIN_AUTH_FAILED, '邀请码无管理员注册权限', 403);
    }

    // 2. 校验邮箱未注册
    const existingByEmail = await userRepository.findByEmail(params.email);
    if (existingByEmail) {
      throw new BusinessError(ErrorCode.DUPLICATE_RESOURCE, '该邮箱已注册', 409);
    }

    // 3. 校验密码复杂度(≥8 位,含大小写+数字)
    try {
      validatePasswordComplexity(params.password);
    } catch (err) {
      throw new BusinessError(ErrorCode.PARAM_INVALID, (err as Error).message, 400);
    }

    // 4. 哈希密码(bcrypt, salt rounds = 12)
    const passwordHash = await hashPassword(params.password);

    // 5. 确定租户:使用邀请码所属租户,或创建新租户(tenantName 提供)
    let tenant: Tenant;
    if (params.tenantName) {
      // 创建新租户
      tenant = await tenantRepository.create({
        name: params.tenantName,
        type: 'school',
        plan: 'standard',
        status: 'active',
        maxSeats: 100,
      } as Parameters<typeof tenantRepository.create>[0]);
    } else {
      const existingTenant = await tenantRepository.findById(invitation.tenantId);
      if (!existingTenant) {
        throw new BusinessError(ErrorCode.TENANT_NOT_FOUND, '租户不存在', 404);
      }
      tenant = existingTenant;
    }

    // 6. 创建用户(authType=password)
    const user = await userRepository.create({
      tenant: { connect: { id: tenant.id } },
      authType: 'password',
      feishuOpenId: null,
      feishuUnionId: null,
      passwordHash,
      email: params.email,
      name: params.name,
      avatar: '',
      role: invitation.role,
      lastLoginAt: new Date(),
    });

    // 7. 创建租户成员关系
    await tenantRepository.createMembership({
      userId: user.id,
      tenantId: tenant.id,
      role: invitation.role,
    });

    // 8. 邀请码使用次数 +1
    await invitationRepository.incrementUsed(params.invitationCode);

    // 9. 签发 JWT + 落 Session
    const result = await this.issueTokensAndSession({
      user,
      tenant,
      client: params.client,
      clientIp: params.clientIp,
      userAgent: params.userAgent,
      isFirstLogin: true,
    });

    return result;
  }

  /**
   * POST /auth/login/admin:院校管理员登录(邮箱+密码)
   */
  async loginAdmin(params: {
    email: string;
    password: string;
    clientIp: string;
    userAgent: string;
    deviceId: string;
    client: 'web' | 'admin' | 'mobile';
  }): Promise<AuthLoginResult> {
    // 1. 查询用户(按邮箱)
    const user = await userRepository.findByEmail(params.email);
    if (!user) {
      throw new BusinessError(ErrorCode.PHASE5_ADMIN_AUTH_FAILED, '邮箱或密码错误', 401);
    }

    // 2. 校验认证方式必须为 password
    if (user.authType !== 'password' || !user.passwordHash) {
      throw new BusinessError(ErrorCode.PHASE5_ADMIN_AUTH_FAILED, '邮箱或密码错误', 401);
    }

    // 3. 校验用户状态(active 才允许登录)
    if (user.status === 'locked') {
      throw new BusinessError(ErrorCode.ADMIN_USER_ALREADY_LOCKED, '账号已锁定,请联系管理员', 403);
    }
    if (user.status === 'deleted') {
      throw new BusinessError(ErrorCode.ADMIN_USER_ALREADY_DELETED, '账号已删除', 403);
    }

    // 4. 校验密码(bcrypt 比对)
    const passwordValid = await verifyPassword(params.password, user.passwordHash);
    if (!passwordValid) {
      logger.warn({ userId: user.id, email: params.email.replace(/(.).*(.@.+)/, '$1***$2') }, '[auth] admin login failed');
      throw new BusinessError(ErrorCode.PHASE5_ADMIN_AUTH_FAILED, '邮箱或密码错误', 401);
    }

    // 5. 查询租户
    const tenant = await tenantRepository.findById(user.tenantId);
    if (!tenant) {
      throw new BusinessError(ErrorCode.TENANT_NOT_FOUND, '租户不存在', 404);
    }
    if (tenant.status === 'disabled') {
      throw new BusinessError(ErrorCode.TENANT_DISABLED, '租户已被禁用', 403);
    }

    // 6. 更新最后登录时间
    await userRepository.updateLastLoginAt(user.id, new Date());

    // 7. 签发 JWT + 落 Session
    const result = await this.issueTokensAndSession({
      user,
      tenant,
      client: params.client,
      clientIp: params.clientIp,
      userAgent: params.userAgent,
      isFirstLogin: false,
    });

    return result;
  }

  // ============================================================
  // 通用账号注册/登录(邮箱+密码,无需邀请码,UI 主要登录方式)
  // ============================================================

  /**
   * POST /auth/register:通用账号注册
   * 流程:校验邮箱未注册 → 校验密码复杂度 → 哈希密码 → 创建个人租户 + 用户 → 签发 JWT
   */
  async registerAccount(params: {
    email: string;
    password: string;
    name: string;
    clientIp: string;
    userAgent: string;
    deviceId: string;
    client: 'web' | 'admin' | 'mobile';
  }): Promise<AuthLoginResult> {
    // 1. 校验邮箱未注册
    const existingByEmail = await userRepository.findByEmail(params.email);
    if (existingByEmail) {
      throw new BusinessError(ErrorCode.DUPLICATE_RESOURCE, '该邮箱已注册', 409);
    }

    // 2. 校验密码复杂度(≥8 位,含大小写+数字)
    try {
      validatePasswordComplexity(params.password);
    } catch (err) {
      throw new BusinessError(ErrorCode.PARAM_INVALID, (err as Error).message, 400);
    }

    // 3. 哈希密码(bcrypt, salt rounds = 12)
    const passwordHash = await hashPassword(params.password);

    // 4. 创建个人租户
    const cfg = env();
    const tenant = await tenantRepository.create({
      name: `${params.name}的个人空间`,
      type: cfg.tenantDefaultType,
      plan: cfg.tenantDefaultPlan,
      status: 'active',
      maxSeats: 1,
    } as Parameters<typeof tenantRepository.create>[0]);

    // 5. 创建用户(authType=password)
    const user = await userRepository.create({
      tenant: { connect: { id: tenant.id } },
      authType: 'password',
      feishuOpenId: null,
      feishuUnionId: null,
      passwordHash,
      email: params.email,
      name: params.name,
      avatar: '',
      role: 'owner',
      lastLoginAt: new Date(),
    });

    // 6. 创建租户成员关系
    await tenantRepository.createMembership({
      userId: user.id,
      tenantId: tenant.id,
      role: 'owner',
    });

    // 7. 签发 JWT + 落 Session
    const result = await this.issueTokensAndSession({
      user,
      tenant,
      client: params.client,
      clientIp: params.clientIp,
      userAgent: params.userAgent,
      isFirstLogin: true,
    });

    return result;
  }

  /**
   * POST /auth/login:通用账号登录(邮箱+密码)
   */
  async loginAccount(params: {
    email: string;
    password: string;
    clientIp: string;
    userAgent: string;
    deviceId: string;
    client: 'web' | 'admin' | 'mobile';
  }): Promise<AuthLoginResult> {
    // 1. 查询用户(按邮箱)
    const user = await userRepository.findByEmail(params.email);
    if (!user) {
      throw new BusinessError(ErrorCode.PHASE5_ADMIN_AUTH_FAILED, '邮箱或密码错误', 401);
    }

    // 2. 校验认证方式必须为 password
    if (user.authType !== 'password' || !user.passwordHash) {
      throw new BusinessError(ErrorCode.PHASE5_ADMIN_AUTH_FAILED, '邮箱或密码错误', 401);
    }

    // 3. 校验用户状态
    if (user.status === 'locked') {
      throw new BusinessError(ErrorCode.ADMIN_USER_ALREADY_LOCKED, '账号已锁定,请联系管理员', 403);
    }
    if (user.status === 'deleted') {
      throw new BusinessError(ErrorCode.ADMIN_USER_ALREADY_DELETED, '账号已删除', 403);
    }

    // 4. 校验密码(bcrypt 比对)
    const passwordValid = await verifyPassword(params.password, user.passwordHash);
    if (!passwordValid) {
      logger.warn({ userId: user.id, email: params.email.replace(/(.).*(.@.+)/, '$1***$2') }, '[auth] account login failed');
      throw new BusinessError(ErrorCode.PHASE5_ADMIN_AUTH_FAILED, '邮箱或密码错误', 401);
    }

    // 5. 查询租户
    const tenant = await tenantRepository.findById(user.tenantId);
    if (!tenant) {
      throw new BusinessError(ErrorCode.TENANT_NOT_FOUND, '租户不存在', 404);
    }
    if (tenant.status === 'disabled') {
      throw new BusinessError(ErrorCode.TENANT_DISABLED, '租户已被禁用', 403);
    }

    // 6. 更新最后登录时间
    await userRepository.updateLastLoginAt(user.id, new Date());

    // 7. 签发 JWT + 落 Session
    const result = await this.issueTokensAndSession({
      user,
      tenant,
      client: params.client,
      clientIp: params.clientIp,
      userAgent: params.userAgent,
      isFirstLogin: false,
    });

    return result;
  }

  // ============================================================
  // Phase 5:手机号绑定(已登录用户)
  // ============================================================

  /**
   * POST /auth/phone/bind:已登录用户绑定手机号
   * @param userId 当前登录用户 ID(从 JWT)
   * @param tenantId 当前租户 ID(从 JWT)
   */
  async bindPhone(params: {
    userId: string;
    tenantId: string;
    phone: string;
    code: string;
    clientIp: string;
    userAgent: string;
    deviceId: string;
    client: 'web' | 'admin' | 'mobile';
  }): Promise<{ bound: boolean; user: UserProfile }> {
    // 1. 校验验证码(purpose=bind)
    await this.consumeOtp(params.phone, params.code, 'bind');

    // 2. 校验手机号未被其他用户绑定
    const existing = await userRepository.findByPhone(params.phone);
    if (existing && existing.id !== params.userId) {
      throw new BusinessError(ErrorCode.DUPLICATE_RESOURCE, '该手机号已被其他用户绑定', 409);
    }

    // 3. 更新用户手机号 + phoneVerified(强制 tenantId 校验)
    const updated = await userRepository.update(params.tenantId, params.userId, {
      phone: params.phone,
      phoneVerified: true,
    });

    logger.info({ userId: params.userId }, '[auth] phone bound');

    return {
      bound: true,
      user: this.toUserProfile(updated),
    };
  }

  // ============================================================
  // Phase 5 私有方法
  // ============================================================

  /**
   * 生成 6 位数字验证码
   * 使用 crypto.randomInt 避免弱随机(对应 auth-design.md §0 C5)
   */
  private generateOtpCode(): string {
    const num = crypto.randomInt(0, 1000000);
    return num.toString().padStart(6, '0');
  }

  /**
   * 消费验证码(校验 + 标记已使用 + 尝试次数累加)
   * @throws BusinessError 验证码无效/过期/尝试超限
   */
  private async consumeOtp(phone: string, code: string, purpose: PhoneOtpPurpose): Promise<void> {
    const record = await phoneVerificationRepository.findLatestValid(phone, purpose);
    if (!record) {
      throw new BusinessError(ErrorCode.PHASE5_PHONE_VERIFICATION_FAILED, '验证码无效或已过期', 400);
    }

    // 尝试次数 +1
    const updated = await phoneVerificationRepository.incrementAttempts(record.id);
    if (updated.attempts >= MAX_OTP_ATTEMPTS) {
      // 达到上限:标记当前验证码不可用(通过 attempts 字段已使其失效)
      throw new BusinessError(ErrorCode.PHASE5_PHONE_VERIFICATION_FAILED, '验证码尝试次数超限,请重新获取', 400);
    }

    // 校验码值(安全比较防时序攻击)
    if (!safeEqual(record.code, code)) {
      throw new BusinessError(ErrorCode.PHASE5_PHONE_VERIFICATION_FAILED, '验证码错误', 400);
    }

    // 标记已消费
    await phoneVerificationRepository.markConsumed(record.id);
  }

  /**
   * register 场景:创建用户 + 可选邀请码加入租户
   */
  private async handlePhoneRegister(params: {
    phone: string;
    invitationCode?: string;
    name?: string;
    clientIp: string;
    userAgent: string;
    deviceId: string;
    client: 'web' | 'admin' | 'mobile';
  }): Promise<AuthLoginResult> {
    // 1. 若带邀请码:校验并加入租户
    let tenant: Tenant;
    let role: UserRole = 'student';
    if (params.invitationCode) {
      const invitation = await invitationRepository.findValidByCode(params.invitationCode);
      if (!invitation) {
        throw new BusinessError(ErrorCode.PHASE5_INVITATION_INVALID, '邀请码无效或已过期', 400);
      }
      const invitationTenant = await tenantRepository.findById(invitation.tenantId);
      if (!invitationTenant) {
        throw new BusinessError(ErrorCode.TENANT_NOT_FOUND, '租户不存在', 404);
      }
      if (invitationTenant.status === 'disabled') {
        throw new BusinessError(ErrorCode.TENANT_DISABLED, '租户已被禁用', 403);
      }
      tenant = invitationTenant;
      role = invitation.role as UserRole;

      // 邀请码使用次数 +1
      await invitationRepository.incrementUsed(params.invitationCode);
    } else {
      // 无邀请码:创建个人租户
      const cfg = env();
      tenant = await tenantRepository.create({
        name: `${params.name ?? '新用户'}的个人空间`,
        type: cfg.tenantDefaultType,
        plan: cfg.tenantDefaultPlan,
        status: 'active',
        maxSeats: 1,
      } as Parameters<typeof tenantRepository.create>[0]);
    }

    // 2. 创建用户(authType=phone)
    const user = await userRepository.create({
      tenant: { connect: { id: tenant.id } },
      authType: 'phone',
      feishuOpenId: null,
      feishuUnionId: null,
      phone: params.phone,
      phoneVerified: true,
      name: params.name ?? `用户${params.phone.slice(-4)}`,
      avatar: '',
      role,
      lastLoginAt: new Date(),
    });

    // 3. 创建租户成员关系
    await tenantRepository.createMembership({
      userId: user.id,
      tenantId: tenant.id,
      role,
    });

    // 4. 签发 JWT + 落 Session
    const result = await this.issueTokensAndSession({
      user,
      tenant,
      client: params.client,
      clientIp: params.clientIp,
      userAgent: params.userAgent,
      isFirstLogin: true,
    });

    return result;
  }

  /**
   * login 场景:手机号已注册,直接登录
   */
  private async handlePhoneLogin(params: {
    phone: string;
    clientIp: string;
    userAgent: string;
    deviceId: string;
    client: 'web' | 'admin' | 'mobile';
  }): Promise<AuthLoginResult> {
    const user = await userRepository.findByPhone(params.phone);
    if (!user) {
      throw new BusinessError(ErrorCode.RESOURCE_NOT_FOUND, '该手机号未注册', 404);
    }

    // 校验用户状态
    if (user.status === 'locked') {
      throw new BusinessError(ErrorCode.ADMIN_USER_ALREADY_LOCKED, '账号已锁定', 403);
    }
    if (user.status === 'deleted') {
      throw new BusinessError(ErrorCode.ADMIN_USER_ALREADY_DELETED, '账号已删除', 403);
    }

    const tenant = await tenantRepository.findById(user.tenantId);
    if (!tenant) {
      throw new BusinessError(ErrorCode.TENANT_NOT_FOUND, '租户不存在', 404);
    }
    if (tenant.status === 'disabled') {
      throw new BusinessError(ErrorCode.TENANT_DISABLED, '租户已被禁用', 403);
    }

    // 更新最后登录时间
    await userRepository.updateLastLoginAt(user.id, new Date());

    const result = await this.issueTokensAndSession({
      user,
      tenant,
      client: params.client,
      clientIp: params.clientIp,
      userAgent: params.userAgent,
      isFirstLogin: false,
    });

    return result;
  }

  /**
   * bind 场景:已登录用户绑定手机号
   */
  private async handlePhoneBind(params: {
    phone: string;
    userId?: string;
    tenantId?: string;
    clientIp: string;
    userAgent: string;
    deviceId: string;
    client: 'web' | 'admin' | 'mobile';
  }): Promise<AuthLoginResult> {
    if (!params.userId || !params.tenantId) {
      throw new BusinessError(ErrorCode.UNAUTHORIZED, 'bind 场景必须已登录', 401);
    }

    // 校验手机号未被其他用户绑定
    const existing = await userRepository.findByPhone(params.phone);
    if (existing && existing.id !== params.userId) {
      throw new BusinessError(ErrorCode.DUPLICATE_RESOURCE, '该手机号已被其他用户绑定', 409);
    }

    // 更新用户手机号 + phoneVerified(强制 tenantId 校验)
    const updated = await userRepository.update(params.tenantId, params.userId, {
      phone: params.phone,
      phoneVerified: true,
    });

    const tenant = await tenantRepository.findById(updated.tenantId);
    if (!tenant) {
      throw new BusinessError(ErrorCode.TENANT_NOT_FOUND, '租户不存在', 404);
    }

    const result = await this.issueTokensAndSession({
      user: updated,
      tenant,
      client: params.client,
      clientIp: params.clientIp,
      userAgent: params.userAgent,
      isFirstLogin: false,
    });

    return result;
  }

  /**
   * reset 场景:仅校验验证码,生成临时重置凭据(存 Redis,5 分钟)
   */
  private async handlePhoneReset(params: {
    phone: string;
    clientIp: string;
    userAgent: string;
    deviceId: string;
    client: 'web' | 'admin' | 'mobile';
  }): Promise<AuthLoginResult> {
    // 生成临时重置 token(UUID)
    const resetToken = generateUuid();
    await redis().set(
      `reset:phone:${resetToken}`,
      JSON.stringify({ phone: params.phone, createdAt: Date.now() }),
      'EX',
      300, // 5 分钟有效
    );

    // reset 场景不返回 JWT,返回结构体需填充占位字段
    // 但 PhoneVerifyResponse 类型要求 user/tenant,这里构造一个临时响应
    // 实际重置流程由后续 /auth/reset-password 等接口完成
    const user = await userRepository.findByPhone(params.phone);
    if (!user) {
      throw new BusinessError(ErrorCode.RESOURCE_NOT_FOUND, '该手机号未注册', 404);
    }
    const tenant = await tenantRepository.findById(user.tenantId);
    if (!tenant) {
      throw new BusinessError(ErrorCode.TENANT_NOT_FOUND, '租户不存在', 404);
    }

    // 签发 JWT(用户可立即访问系统,reset 场景简化为直接登录)
    const result = await this.issueTokensAndSession({
      user,
      tenant,
      client: params.client,
      clientIp: params.clientIp,
      userAgent: params.userAgent,
      isFirstLogin: false,
    });

    logger.info({ userId: user.id, resetToken: resetToken.slice(0, 8) + '...' }, '[auth] phone reset verified');

    return result;
  }

  /**
   * 统一签发 JWT + 落 Session(Phase 5 复用)
   * 返回结构包含 refreshToken(controller 写 Cookie,不返回响应体)
   */
  private async issueTokensAndSession(params: {
    user: User;
    tenant: Tenant;
    client: 'web' | 'admin' | 'mobile';
    clientIp: string;
    userAgent: string;
    isFirstLogin: boolean;
  }): Promise<AuthLoginResult> {
    const { user, tenant } = params;

    // 签发 JWT
    const accessResult = jwtService.issueAccessToken({
      userId: user.id,
      tenantId: tenant.id,
      role: user.role as UserRole,
      feishuOpenId: user.feishuOpenId ?? '',
      client: params.client,
      // Phase 5:从用户记录读取 authType(phone/invitation/password/feishu)
      // 旧用户无 authType 字段时缺省为 'feishu'
      authType: (user.authType as AuthType | undefined) ?? 'feishu',
    });
    const refreshResult = jwtService.issueRefreshToken({
      userId: user.id,
      client: params.client,
    });

    // 落 Session
    const session = await sessionService.createSession({
      userId: user.id,
      tenantId: tenant.id,
      refreshToken: refreshResult.token,
      userAgent: params.userAgent,
      ip: params.clientIp,
      expiresAt: refreshResult.expiresAt,
      refreshJti: refreshResult.jti,
    });

    // M4-AUTH-1:登录成功埋点 — 标记用户在线(内部 catch 不抛,不影响登录主流程)
    // 防御性判空:session 缺失时跳过埋点,绝不允许 presence 影响登录
    if (session?.id) {
      await presenceService.markOnline(user.id, session.id, params.client);
    }

    logger.info({ userId: user.id, tenantId: tenant.id, authType: user.authType }, '[auth] phase5 login success');

    return {
      accessToken: accessResult.token,
      accessTokenExpiresAt: accessResult.expiresAt.toISOString(),
      refreshToken: refreshResult.token,
      isFirstLogin: params.isFirstLogin,
      user: this.toUserProfile(user),
      tenant: this.toTenantInfo(tenant),
    };
  }

  // ============================================================
  // 原有私有方法
  // ============================================================

  /**
   * 步骤 6:校验 state(IP+UA+device_id 三重比对 + 一次性消费)
   * 对应 auth-design.md §1.2 步骤 6 + §2.3
   */
  private async validateAndConsumeState(params: {
    state: string;
    clientIp: string;
    userAgent: string;
    deviceId: string;
  }): Promise<void> {
    // 1. state 格式校验
    if (!isValidStateFormat(params.state)) {
      logger.warn({ state: params.state.slice(0, 8) + '...' }, '[auth] state format invalid');
      throw new BusinessError(ErrorCode.FEISHU_AUTH_FAILED, '飞书授权失败:state 校验不通过', 400);
    }

    // 2. 从 Redis 取出
    const raw = await redis().get(`oauth:state:${params.state}`);
    if (!raw) {
      logger.warn({ state: params.state.slice(0, 8) + '...' }, '[auth] state not found in redis');
      throw new BusinessError(ErrorCode.FEISHU_AUTH_FAILED, '飞书授权失败:state 已过期或不存在', 400);
    }

    let ctx: StateContext;
    try {
      ctx = JSON.parse(raw) as StateContext;
    } catch {
      throw new BusinessError(ErrorCode.FEISHU_AUTH_FAILED, '飞书授权失败:state 解析失败', 400);
    }

    // 3. 三重比对(IP + UA + device_id)
    if (ctx.clientIp !== params.clientIp) {
      logger.warn(
        { expected: ctx.clientIp, actual: params.clientIp },
        '[auth] state client_ip mismatch',
      );
      throw new BusinessError(ErrorCode.FEISHU_AUTH_FAILED, '飞书授权失败:IP 不一致', 400);
    }
    if (ctx.userAgent !== params.userAgent) {
      logger.warn('[auth] state user_agent mismatch');
      throw new BusinessError(ErrorCode.FEISHU_AUTH_FAILED, '飞书授权失败:User-Agent 不一致', 400);
    }
    if (ctx.deviceId !== params.deviceId) {
      logger.warn('[auth] state device_id mismatch');
      throw new BusinessError(ErrorCode.FEISHU_AUTH_FAILED, '飞书授权失败:device_id 不一致', 400);
    }

    // 4. 一次性消费:立即 DEL(防重放)
    await redis().del(`oauth:state:${params.state}`);
  }

  /**
   * 步骤 8:upsert User + TenantMember(事务)
   * 对应 auth-design.md §1.2 步骤 8
   * - 首次登录:创建 Tenant(基于 feishu tenant_key) + User + TenantMember
   * - 已存在:更新 name/avatar/lastLoginAt
   */
  private async upsertUserAndTenant(params: {
    feishuUser: {
      openId: string;
      unionId: string;
      name: string;
      avatarUrl: string;
      email: string | null;
      mobile: string | null;
      tenantKey: string | null;
    };
  }): Promise<{ user: User; tenant: Tenant; isFirstLogin: boolean }> {
    const cfg = env();

    // 查找已有用户:优先按 union_id,再按 open_id 兜底
    // 兼容早期记录了 open_id 但 union_id 为空/一致的情况:若仅 open_id 命中,
    // 直接复用现有用户,避免创建新用户时触发 feishu_open_id 唯一约束冲突
    const existing =
      (await userRepository.findByFeishuUnionId(params.feishuUser.unionId)) ??
      (await userRepository.findByFeishuOpenId(params.feishuUser.openId));

    if (existing) {
      // 已存在:更新头像/姓名/最后登录时间
      await userRepository.updateLastLoginAt(existing.id, new Date());
      // 更新 name/avatar(可选)
      const updated = await userRepository.update(existing.tenantId, existing.id, {
        name: params.feishuUser.name,
        avatar: params.feishuUser.avatarUrl,
        email: params.feishuUser.email ?? null,
      });
      const tenant = await tenantRepository.findById(updated.tenantId);
      if (!tenant) {
        throw new BusinessError(ErrorCode.TENANT_NOT_FOUND, '租户不存在', 404);
      }
      return { user: updated, tenant, isFirstLogin: false };
    }

    // 首次登录:创建 Tenant(基于 feishu tenant_key,若不存在则创建个人租户)
    let tenant: Tenant | null = null;
    if (params.feishuUser.tenantKey) {
      tenant = await tenantRepository.findByFeishuTenantKey(params.feishuUser.tenantKey);
    }
    if (!tenant) {
      // 创建个人租户(默认)
      tenant = await tenantRepository.create({
        name: `${params.feishuUser.name}的个人空间`,
        type: cfg.tenantDefaultType,
        plan: cfg.tenantDefaultPlan,
        status: 'active',
        maxSeats: 1,
      });
    }

    // 创建 User + TenantMember(事务)
    const newUser = await tenantRepository.withTransaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          tenantId: tenant!.id,
          feishuOpenId: params.feishuUser.openId,
          feishuUnionId: params.feishuUser.unionId,
          name: params.feishuUser.name,
          avatar: params.feishuUser.avatarUrl,
          email: params.feishuUser.email,
          phone: params.feishuUser.mobile,
          role: 'student',
          lastLoginAt: new Date(),
        },
      });
      await tx.tenantMember.create({
        data: {
          userId: user.id,
          tenantId: tenant!.id,
          role: 'student',
        },
      });
      return user;
    });

    return { user: newUser, tenant, isFirstLogin: true };
  }

  /**
   * User DB 模型 → UserProfile(API 契约)
   */
  private toUserProfile(user: User): UserProfile {
    return {
      id: user.id,
      tenantId: user.tenantId,
      feishuOpenId: user.feishuOpenId,
      feishuUnionId: user.feishuUnionId,
      name: user.name,
      avatar: user.avatar,
      email: user.email,
      phone: user.phone,
      role: user.role as UserRole,
      learnerProfile: (user.learnerProfile as UserProfile['learnerProfile']) ?? null,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    };
  }

  /**
   * Tenant DB 模型 → TenantInfo(API 契约)
   */
  private toTenantInfo(tenant: Tenant): TenantInfo {
    return {
      id: tenant.id,
      name: tenant.name,
      type: tenant.type as TenantInfo['type'],
      feishuTenantKey: tenant.feishuTenantKey,
      plan: tenant.plan as TenantInfo['plan'],
      status: tenant.status as TenantInfo['status'],
      maxSeats: tenant.maxSeats,
      parentId: tenant.parentId,
      createdAt: tenant.createdAt.toISOString(),
    };
  }
}

export const authService = new AuthServiceClass();
