// ============================================================
// JWT 服务(RS256 非对称签名)
// 对应文档:auth-design.md §2.1 + §2.2
// - access_token:15 分钟,payload 含 sub/tenant_id/role/feishu_open_id/jti/iat/exp/iss/aud
// - refresh_token:7 天,payload 含 sub/jti/iat/exp/iss/aud/type
// 启动自检:私钥必须为 RSA 类型(在 env.ts loadEnv() 中完成)
// ============================================================

import jwt from 'jsonwebtoken';
import type { JwtPayload, SignOptions } from 'jsonwebtoken';
import { env } from '../config/env.js';
import { generateJti } from '../utils/crypto.js';
import type { UserRole } from '../types/api-contract.js';
import type { AuthType } from '../types/arbitration.js';

/**
 * access_token payload
 * Phase 5 起新增 auth_type 字段(可选,向后兼容旧 token)
 *   - feishu:飞书 OAuth 登录
 *   - phone:手机号 OTP 登录
 *   - invitation:邀请码兑换登录
 *   - password:邮箱+密码登录(院校管理员)
 */
export interface AccessTokenPayload extends JwtPayload {
  sub: string;          // user_id
  tenant_id: string;    // 当前激活租户
  role: UserRole;       // 当前租户内角色
  feishu_open_id: string; // 仅作审计关联(非飞书用户为空串)
  auth_type?: AuthType;   // 认证方式(Phase 5,旧 token 缺省视为 feishu)
  jti: string;          // 唯一 ID,用于 Redis 黑名单
  iss: string;          // 签发方
  aud: string;          // 受众(web/admin/mobile)
}

/**
 * refresh_token payload(最小化,不含业务信息)
 */
export interface RefreshTokenPayload extends JwtPayload {
  sub: string;
  jti: string;
  iss: string;
  aud: string;
  type: 'refresh';
}

/**
 * 签发结果
 */
export interface IssueResult {
  token: string;
  expiresAt: Date;
  expiresIn: number; // 秒
  jti: string;
}

/**
 * 解析过期时间字符串为秒数
 * "15m" → 900,"7d" → 604800
 */
function parseExpiry(exp: string): number {
  const m = exp.match(/^(\d+)([smhd])$/);
  if (!m) {
    throw new Error(`invalid expiry format: ${exp}`);
  }
  const num = parseInt(m[1]!, 10);
  const unit = m[2]!;
  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return num * multipliers[unit]!;
}

class JwtServiceClass {
  /**
   * 签发 access_token(RS256)
   * Phase 5:authType 可选,缺省时为 'feishu'(向后兼容旧调用方)
   */
  issueAccessToken(params: {
    userId: string;
    tenantId: string;
    role: UserRole;
    feishuOpenId: string;
    client: 'web' | 'admin' | 'mobile';
    authType?: AuthType;
  }): IssueResult {
    const cfg = env();
    const jti = generateJti();
    const expiresInSec = parseExpiry(cfg.jwtAccessExpires);
    const now = Math.floor(Date.now() / 1000);
    const payload: AccessTokenPayload = {
      sub: params.userId,
      tenant_id: params.tenantId,
      role: params.role,
      feishu_open_id: params.feishuOpenId,
      // Phase 5:写入 auth_type,旧 token 缺省时中间件视为 'feishu'
      auth_type: params.authType ?? 'feishu',
      jti,
      iss: cfg.jwtIssuer,
      aud:
        params.client === 'web'
          ? cfg.jwtAudienceWeb
          : params.client === 'admin'
            ? cfg.jwtAudienceAdmin
            : cfg.jwtAudienceMobile,
    };
    const options: SignOptions = {
      algorithm: 'RS256',
      expiresIn: expiresInSec,
      notBefore: 0,
      keyid: cfg.jwtKeyId,
    };
    const token = jwt.sign(payload as unknown as object, cfg.jwtPrivateKey, options);
    return {
      token,
      expiresAt: new Date((now + expiresInSec) * 1000),
      expiresIn: expiresInSec,
      jti,
    };
  }

  /**
   * 签发 refresh_token(RS256)
   */
  issueRefreshToken(params: {
    userId: string;
    client: 'web' | 'admin' | 'mobile';
  }): IssueResult {
    const cfg = env();
    const jti = generateJti();
    const expiresInSec = parseExpiry(cfg.jwtRefreshExpires);
    const now = Math.floor(Date.now() / 1000);
    const payload: RefreshTokenPayload = {
      sub: params.userId,
      jti,
      iss: cfg.jwtIssuer,
      aud: `${cfg.jwtIssuer}-refresh`,
      type: 'refresh',
    };
    const options: SignOptions = {
      algorithm: 'RS256',
      expiresIn: expiresInSec,
      notBefore: 0,
      keyid: cfg.jwtKeyId,
    };
    const token = jwt.sign(payload as unknown as object, cfg.jwtPrivateKey, options);
    return {
      token,
      expiresAt: new Date((now + expiresInSec) * 1000),
      expiresIn: expiresInSec,
      jti,
    };
  }

  /**
   * 验证 access_token(RS256 公钥校验)
   * audience 同时校验 web/admin/mobile 三端,任一匹配即通过
   * @throws jwt.TokenExpiredError / jwt.JsonWebTokenError
   */
  verifyAccessToken(token: string): AccessTokenPayload {
    const cfg = env();
    const decoded = jwt.verify(token, cfg.jwtPublicKey, {
      algorithms: ['RS256'],
      issuer: cfg.jwtIssuer,
      audience: [cfg.jwtAudienceWeb, cfg.jwtAudienceAdmin, cfg.jwtAudienceMobile],
      clockTolerance: 30,
    });
    if (typeof decoded === 'string') {
      throw new Error('unexpected string token');
    }
    return decoded as AccessTokenPayload;
  }

  /**
   * 验证 refresh_token(RS256 公钥校验)
   * @throws jwt.TokenExpiredError / jwt.JsonWebTokenError
   */
  verifyRefreshToken(token: string): RefreshTokenPayload {
    const cfg = env();
    const decoded = jwt.verify(token, cfg.jwtPublicKey, {
      algorithms: ['RS256'],
      issuer: cfg.jwtIssuer,
      audience: `${cfg.jwtIssuer}-refresh`,
      clockTolerance: 30,
    });
    if (typeof decoded === 'string') {
      throw new Error('unexpected string token');
    }
    const payload = decoded as RefreshTokenPayload;
    if (payload.type !== 'refresh') {
      throw new jwt.JsonWebTokenError('invalid token type');
    }
    return payload;
  }
}

export const jwtService = new JwtServiceClass();
