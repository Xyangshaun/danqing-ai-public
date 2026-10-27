// ============================================================
// JWT 认证中间件
// 对应文档:auth-design.md §2.1 + api-contract-v1.md §1.3
// 从 Authorization: Bearer {access_token} 解析 JWT(RS256 校验)
// 失败返回:2001(未授权)/ 2002(过期)/ 2005(签名无效)
// ============================================================

import type { RequestHandler } from 'express';
import type { JwtPayload } from 'jsonwebtoken';
import type { ClientType, UserRole } from '../types/api-contract.js';
import { ErrorCode } from '../types/api-contract.js';
import type { AuthType } from '../types/arbitration.js';
import { error } from '../utils/response.js';
import { logger } from '../utils/logger.js';
import { jwtService } from '../services/jwt.service.js';
import { redis } from '../config/redis.js';
import { env } from '../config/env.js';

/**
 * 开发模式常量 - 当 DEV_SKIP_AUTH=true 时注入的虚拟用户
 * 对应前端 skipLogin() 中设置的 dev-user / dev-tenant
 */
const DEV_USER_ID = 'dev-user';
const DEV_TENANT_ID = 'dev-tenant';
const DEV_ROLE: UserRole = 'teacher';
const DEV_OPEN_ID = 'dev-open-id';

/**
 * 已认证的 Request 类型守卫
 * 在 controller 中使用 req.userId / req.tenantId 等(经 authMiddleware 注入)
 */
export interface AuthedRequest {
  userId: string;
  tenantId: string;
  role: UserRole;
  feishuOpenId: string;
  /** Phase 5:认证方式(feishu/phone/invitation/password),旧 token 缺省为 'feishu' */
  authType: AuthType;
  jti: string;
  client?: ClientType;
  deviceId?: string;
}

/**
 * 鉴权失败的业务错误(携带 ErrorCode / HTTP 状态),供 authMiddleware 与
 * optionalAuthMiddleware 区分处理。
 */
class AuthError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  constructor(code: ErrorCode, message: string, status: number) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
    this.status = status;
  }
}

/**
 * 解析请求身份:DEV_SKIP_AUTH 模式下注入 dev 用户,否则校验 JWT(RS256)后注入 req。
 * 抛 AuthError 表示鉴权失败;由调用方决定拒绝(401)或静默放行(optional)。
 */
async function resolveIdentity(req: Parameters<RequestHandler>[0]): Promise<void> {
  const authHeader = req.header('Authorization');

  // DEV_SKIP_AUTH:开发模式跳过认证,注入虚拟用户
  // 仅在 NODE_ENV=development 且 DEV_SKIP_AUTH=true 时生效
  if (env().devSkipAuth && (!authHeader || !authHeader.startsWith('Bearer '))) {
    req.userId = DEV_USER_ID;
    req.tenantId = DEV_TENANT_ID;
    req.role = DEV_ROLE;
    req.feishuOpenId = DEV_OPEN_ID;
    req.authType = 'feishu';
    req.jti = 'dev-jti';
    req.client = 'web';
    req.deviceId = req.header('X-Device-Id') ?? 'dev-device';
    // eslint-disable-next-line no-console
    console.warn('[auth] DEV_SKIP_AUTH enabled - injecting dev user:', DEV_USER_ID);
    return;
  }

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new AuthError(ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
  }
  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    throw new AuthError(ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
  }

  // JWT 校验(RS256 公钥)
  let payload: JwtPayload;
  try {
    payload = jwtService.verifyAccessToken(token);
  } catch (err) {
    const errName = (err as Error).name;
    if (errName === 'TokenExpiredError') {
      throw new AuthError(ErrorCode.TOKEN_EXPIRED, 'access_token 已过期,请刷新令牌', 401);
    }
    if (errName === 'JsonWebTokenError') {
      throw new AuthError(ErrorCode.TOKEN_SIGNATURE_INVALID, 'token 签名无效', 401);
    }
    logger.warn({ err: (err as Error).message }, '[auth] verify failed');
    throw new AuthError(ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
  }

  // jti 黑名单校验(对应 auth-design.md §0 C7)
  if (payload.jti) {
    const blacklisted = await redis().exists(`blacklist:access:${payload.jti}`);
    if (blacklisted === 1) {
      logger.warn({ sub: payload.sub, jti: payload.jti }, '[auth] token revoked');
      throw new AuthError(ErrorCode.UNAUTHORIZED, 'token 已被撤销,请重新登录', 401);
    }
  }

  // 注入到 req(由 express.d.ts 类型扩展支持)
  req.userId = payload.sub;
  req.tenantId = (payload as JwtPayload & { tenant_id?: string }).tenant_id;
  req.role = (payload as JwtPayload & { role?: UserRole }).role;
  req.feishuOpenId = (payload as JwtPayload & { feishu_open_id?: string }).feishu_open_id;
  // Phase 5:auth_type 可选注入,旧 token 缺省为 'feishu'(向后兼容)
  const rawAuthType = (payload as JwtPayload & { auth_type?: string }).auth_type;
  req.authType = (rawAuthType === 'feishu' || rawAuthType === 'phone' || rawAuthType === 'invitation' || rawAuthType === 'password')
    ? rawAuthType
    : 'feishu';
  req.jti = payload.jti;

  // Phase 3 多端适配:从 JWT aud 或 X-Client 头解析客户端类型
  // 优先级:JWT aud > X-Client 头 > 默认 'web'
  const aud = payload.aud;
  const xClient = req.header('X-Client');
  if (aud === 'danqing-ai-web' || xClient === 'web') {
    req.client = 'web';
  } else if (aud === 'danqing-ai-admin' || xClient === 'admin') {
    req.client = 'admin';
  } else if (aud === 'danqing-ai-mobile' || xClient === 'mobile') {
    req.client = 'mobile';
  } else {
    req.client = 'web'; // 默认 web
  }

  // 设备指纹(从 X-Device-Id 头解析,用于设备管理与安全审计)
  req.deviceId = req.header('X-Device-Id');
}

/**
 * JWT 认证中间件(强制)
 * 校验顺序:
 * 1. DEV_SKIP_AUTH 模式下无 token 时注入 dev 用户(仅开发环境)
 * 2. Authorization 头存在,且为 Bearer schema
 * 3. JWT 签名有效(RS256 公钥校验)
 * 4. JWT 未过期(exp)
 * 5. JWT iss / aud 匹配
 * 6. jti 不在 Redis 黑名单
 * 校验失败返回 401。
 */
export const authMiddleware: RequestHandler = async (req, res, next) => {
  try {
    await resolveIdentity(req);
    next();
  } catch (err) {
    if (err instanceof AuthError) {
      return error(res, err.code, err.message, err.status);
    }
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err: msg }, '[auth] unexpected error');
    return error(res, ErrorCode.INTERNAL_ERROR, '服务器内部错误', 500);
  }
};

/**
 * 可选鉴权中间件
 * 语义:token 有效则按 authMiddleware 同规则注入 req.userId 等身份;
 *      无 token / token 无效则静默放行(不注入、不返回 401)。
 * 用于"可登录可不登录"的接口:如手机号绑定(/phone/otp bind 场景)、
 * 邀请码兑换(/invitation/redeem 已登录账户直接关联)时注入 existingUserId。
 */
export const optionalAuthMiddleware: RequestHandler = async (req, _res, next) => {
  try {
    await resolveIdentity(req);
  } catch {
    // optional 语义:鉴权失败不阻断请求,静默放行(不注入身份)
  }
  next();
};
