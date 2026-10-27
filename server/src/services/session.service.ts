// ============================================================
// 会话管理服务
// 对应文档:auth-design.md §2.2 refresh_token 设计
// - refresh_token 哈希存储(SHA-256,不存明文)
// - 滚动刷新:旧 refresh_token jti 加入 Redis 黑名单 TTL=剩余时间
// - 撤销:Session.revokedAt 置位 + Redis 黑名单
// ============================================================

import { sessionRepository } from '../repositories/session.repository.js';
import { redis } from '../config/redis.js';
import { sha256 } from '../utils/crypto.js';
import { logger } from '../utils/logger.js';
import { BusinessError } from '../middlewares/error-handler.js';
import { ErrorCode } from '../types/api-contract.js';
import type { Session } from '@prisma/client';

/**
 * 会话轮转 Lua 脚本(原子执行 G5)
 * 一次 RTT 完成三步:加黑名单 → 删旧 session → 写新 session
 *
 * KEYS[1] = blacklist:refresh:{oldJti}
 * KEYS[2] = session:{userId}:{oldJti}
 * KEYS[3] = session:{userId}:{newJti}
 * ARGV[1]  = blacklistValue('1')
 * ARGV[2]  = blacklistTtl(秒,<=0 时跳过 SET)
 * ARGV[3]  = newSessionValue(JSON)
 * ARGV[4]  = sessionTtl(秒)
 *
 * 返回:'OK'
 *
 * 安全说明:
 *   - 旧 jti 黑名单的写入与旧 session 删除在同一个 Lua 调用中,
 *     Redis 单线程语义保证二者原子完成,不会被其他客户端插入读取
 *   - 黑名单 TTL = 旧 refresh_token 剩余自然过期时间,避免黑名单无限增长
 *   - blacklistTtl<=0 表示旧 token 已过期,无需写入黑名单(自然过期即可)
 */
const SESSION_ROTATE_SCRIPT = `
local blacklistKey = KEYS[1]
local oldSessionKey = KEYS[2]
local newSessionKey = KEYS[3]
local blacklistValue = ARGV[1]
local blacklistTtl = tonumber(ARGV[2])
local sessionValue = ARGV[3]
local sessionTtl = tonumber(ARGV[4])
if blacklistTtl > 0 then
  redis.call('SET', blacklistKey, blacklistValue, 'EX', blacklistTtl)
end
redis.call('DEL', oldSessionKey)
redis.call('SET', newSessionKey, sessionValue, 'EX', sessionTtl)
return 'OK'
`;

class SessionServiceClass {
  /**
   * 创建会话(登录成功后调用)
   * 同时写入 DB(Session 表)与 Redis(快速校验路径)
   */
  async createSession(params: {
    userId: string;
    tenantId: string;
    refreshToken: string; // 明文,仅此处持有,不落库
    userAgent: string;
    ip: string;
    expiresAt: Date;
    refreshJti: string;
  }): Promise<Session> {
    const refreshTokenHash = sha256(params.refreshToken);

    // 写入 DB(refresh_token_hash)
    const session = await sessionRepository.create({
      user: { connect: { id: params.userId } },
      tenant: { connect: { id: params.tenantId } },
      refreshTokenHash,
      userAgent: params.userAgent,
      ip: params.ip,
      expiresAt: params.expiresAt,
    });

    // 写入 Redis(快速校验,不存明文 token)
    const redisKey = `session:${params.userId}:${params.refreshJti}`;
    const redisValue = JSON.stringify({
      sessionId: session.id,
      tenantId: params.tenantId,
      refreshTokenHash,
      ip: params.ip,
      userAgent: params.userAgent,
      createdAt: session.createdAt.toISOString(),
    });
    const ttlSec = Math.max(1, Math.floor((params.expiresAt.getTime() - Date.now()) / 1000));
    await redis().set(redisKey, redisValue, 'EX', ttlSec);

    logger.debug({ sessionId: session.id, userId: params.userId }, '[session] created');
    return session;
  }

  /**
   * 校验 refresh_token(滚动刷新前置校验)
   * 1. JWT 签名 + 过期(由 jwtService.verifyRefreshToken 完成)
   * 2. jti 不在 Redis 黑名单
   * 3. Session 表存在且未撤销且未过期
   * 4. refresh_token_hash 一致
   * @returns { session, jti } 校验通过返回 session 与 jti
   */
  async validateRefreshToken(refreshToken: string): Promise<{ session: Session; jti: string }> {
    // 注:JWT 签名校验在调用方完成,这里只做 Session/黑名单校验
    const { jwtService } = await import('./jwt.service.js');
    const payload = jwtService.verifyRefreshToken(refreshToken);
    const jti = payload.jti;
    const userId = payload.sub;

    // 1. Redis 黑名单校验
    const blacklisted = await redis().exists(`blacklist:refresh:${jti}`);
    if (blacklisted === 1) {
      logger.warn({ userId, jti }, '[session] refresh token in blacklist');
      throw new Error('refresh_token in blacklist');
    }

    // 2. DB Session 校验
    const refreshTokenHash = sha256(refreshToken);
    const session = await sessionRepository.findByRefreshTokenHash(refreshTokenHash);
    if (!session) {
      logger.warn({ userId, jti }, '[session] refresh token hash not found');
      throw new Error('refresh_token not found');
    }
    if (session.revokedAt !== null) {
      logger.warn({ userId, jti, sessionId: session.id }, '[session] session revoked');
      throw new Error('session revoked');
    }
    if (session.expiresAt.getTime() < Date.now()) {
      logger.warn({ userId, jti, sessionId: session.id }, '[session] session expired');
      throw new Error('session expired');
    }
    if (session.userId !== userId) {
      logger.warn({ userId, jti, sessionId: session.id }, '[session] user mismatch');
      throw new Error('user mismatch');
    }

    return { session, jti };
  }

  /**
   * 滚动刷新:旧 refresh_token jti 加入黑名单,签发新 token
   * 同时更新 Session.refreshTokenHash
   *
   * G5 安全修复(原子轮转):
   *   - DB 侧:用 updateMany WHERE refreshTokenHash=oldHash 乐观锁,避免 findFirst+update 拆分
   *            的 TOCTOU(并发刷新下两请求都读到同一 oldHash 后都更新成功)
   *   - Redis 侧:用 Lua 脚本原子执行 SET blacklist + DEL oldSession + SET newSession,
   *              避免 3 步拆分中间被打断导致黑名单已写但 session 仍可访问
   *   - 失败语义:DB 更新失败 → 抛 REFRESH_TOKEN_INVALID,Redis 不执行(避免无效写入)
   */
  async rotateRefreshToken(params: {
    oldRefreshToken: string;
    oldJti: string;
    newRefreshToken: string;
    newJti: string;
    sessionId: string;
    tenantId: string;
    expiresAt: Date;
  }): Promise<void> {
    // 1. 计算新旧 hash + 旧 token 剩余 TTL(用于黑名单)
    const oldPayload = (await import('./jwt.service.js')).jwtService.verifyRefreshToken(params.oldRefreshToken);
    const nowSec = Math.floor(Date.now() / 1000);
    const remainingTtl = (oldPayload.exp ?? nowSec) - nowSec;
    const oldHash = sha256(params.oldRefreshToken);
    const newHash = sha256(params.newRefreshToken);

    // 2. DB 乐观锁更新(WHERE refreshTokenHash=oldHash)
    //    并发刷新时只有一个请求 count>0,其余抛 REFRESH_TOKEN_INVALID
    const updated = await sessionRepository.updateRefreshTokenHashWithCheck(
      params.tenantId,
      params.sessionId,
      oldHash,
      newHash,
    );
    if (!updated) {
      // hash 不匹配:token 已被其他并发请求轮转,或已被撤销,或 session 不属于该租户
      logger.warn(
        { sessionId: params.sessionId, tenantId: params.tenantId, jti: params.oldJti },
        '[session] rotate failed: refresh token hash mismatch (concurrent rotate or revoked)',
      );
      throw new BusinessError(
        ErrorCode.REFRESH_TOKEN_INVALID,
        'refresh token 已失效,请重新登录',
        401,
      );
    }

    // 3. Redis 原子轮转:Lua 脚本一次 RTT 完成 SET blacklist + DEL oldSession + SET newSession
    const userId = oldPayload.sub;
    const blacklistKey = `blacklist:refresh:${params.oldJti}`;
    const oldSessionKey = `session:${userId}:${params.oldJti}`;
    const newSessionKey = `session:${userId}:${params.newJti}`;
    const newSessionValue = JSON.stringify({
      sessionId: params.sessionId,
      tenantId: params.tenantId,
      refreshTokenHash: newHash,
      createdAt: new Date().toISOString(),
    });
    const sessionTtlSec = Math.max(1, Math.floor((params.expiresAt.getTime() - Date.now()) / 1000));
    // remainingTtl<=0 时传 0,Redis mock 与真实 Redis 都会跳过 SET blacklist
    const blacklistTtl = remainingTtl > 0 ? remainingTtl : 0;
    try {
      await redis().eval(
        SESSION_ROTATE_SCRIPT,
        3,
        blacklistKey,
        oldSessionKey,
        newSessionKey,
        '1',
        String(blacklistTtl),
        newSessionValue,
        String(sessionTtlSec),
      );
    } catch (err) {
      // Redis 不可达时:DB 已更新为新 hash,旧 token 在 DB 层已失效(因 hash 不匹配)
      // 但 Redis 旧 session key 仍可能存活至 TTL 过期,黑名单也缺失 → 拒绝本次响应,要求重新登录
      logger.error(
        { err: err instanceof Error ? err.message : String(err), sessionId: params.sessionId },
        '[session] redis eval failed during rotate; DB updated but redis inconsistent',
      );
      throw new BusinessError(
        ErrorCode.CACHE_ERROR,
        '会话状态暂时不可用,请稍后重试',
        503,
      );
    }

    logger.debug({ sessionId: params.sessionId, userId }, '[session] rotated');
  }

  /**
   * 撤销会话(登出)
   * @returns 是否撤销成功
   */
  async revokeByRefreshToken(refreshToken: string): Promise<boolean> {
    try {
      const payload = (await import('./jwt.service.js')).jwtService.verifyRefreshToken(refreshToken);
      // 加入黑名单
      const nowSec = Math.floor(Date.now() / 1000);
      const remainingTtl = (payload.exp ?? nowSec) - nowSec;
      if (remainingTtl > 0) {
        await redis().set(`blacklist:refresh:${payload.jti}`, '1', 'EX', remainingTtl);
      }
      // 删除 Redis session
      await redis().del(`session:${payload.sub}:${payload.jti}`);
    } catch {
      // token 已过期或非法,继续走 DB 撤销流程
    }

    const hash = sha256(refreshToken);
    return sessionRepository.revokeByRefreshTokenHash(hash);
  }

  /**
   * 撤销某用户所有有效会话(全端登出)
   * @returns 撤销的会话数
   */
  async revokeAllByUser(userId: string, tenantId?: string): Promise<number> {
    const count = await sessionRepository.revokeAllByUser(userId, tenantId);
    logger.info({ userId, tenantId, count }, '[session] revoked all');
    return count;
  }

  /**
   * 撤销 access_token(登出时同时将 access_token jti 加入黑名单)
   */
  async revokeAccessTokenJti(jti: string, expSec: number): Promise<void> {
    const nowSec = Math.floor(Date.now() / 1000);
    const remainingTtl = expSec - nowSec;
    if (remainingTtl > 0) {
      await redis().set(`blacklist:access:${jti}`, '1', 'EX', remainingTtl);
    }
  }
}

export const sessionService = new SessionServiceClass();
