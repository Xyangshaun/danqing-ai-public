// ============================================================
// 会话 Repository
// 对应文档:auth-design.md §2.2(Session 表存 refresh_token_hash,不存明文)
// 多租户:Session 表带 tenant_id 字段,所有查询强制过滤
// ============================================================

import type { Prisma, Session } from '@prisma/client';
import { prisma } from '../config/prisma.js';

export class SessionRepository {
  /**
   * 按 refresh_token_hash 查询会话(刷新 token 时使用,无需 tenant_id 过滤)
   * @param refreshTokenHash SHA-256 哈希
   */
  async findByRefreshTokenHash(refreshTokenHash: string): Promise<Session | null> {
    return prisma().session.findUnique({
      where: { refreshTokenHash },
    });
  }

  /**
   * 创建会话(登录成功后)
   * @param data 含 userId / tenantId / refreshTokenHash / userAgent / ip / expiresAt
   */
  async create(data: Prisma.SessionCreateInput): Promise<Session> {
    return prisma().session.create({ data });
  }

  /**
   * 更新会话的 refresh_token_hash(滚动刷新)
   * 强制校验 session_id + tenant_id
   */
  async updateRefreshTokenHash(
    tenantId: string,
    sessionId: string,
    refreshTokenHash: string,
  ): Promise<Session | null> {
    // 显式校验 tenant_id
    const existing = await prisma().session.findFirst({
      where: { id: sessionId, tenantId },
    });
    if (!existing) return null;
    return prisma().session.update({
      where: { id: sessionId },
      data: { refreshTokenHash },
    });
  }

  /**
   * 原子更新会话的 refresh_token_hash(乐观锁,滚动刷新使用)
   * 仅当 DB 中当前 refreshTokenHash == oldHash 时才更新为 newHash
   * 通过 updateMany WHERE id+tenantId+refreshTokenHash 实现原子语义,
   * 避免并发刷新下 findFirst+update 拆分导致的 TOCTOU
   * @returns 是否更新成功(affectedRows > 0)
   */
  async updateRefreshTokenHashWithCheck(
    tenantId: string,
    sessionId: string,
    oldHash: string,
    newHash: string,
  ): Promise<boolean> {
    const result = await prisma().session.updateMany({
      where: { id: sessionId, tenantId, refreshTokenHash: oldHash },
      data: { refreshTokenHash: newHash },
    });
    return result.count > 0;
  }

  /**
   * 撤销会话(登出 / 强制下线)
   * @param sessionId 会话 ID
   * @param tenantId 当前租户(强制校验)
   */
  async revoke(tenantId: string, sessionId: string, revokedAt: Date = new Date()): Promise<void> {
    // 显式校验 tenant_id,防止跨租户撤销
    await prisma().session.updateMany({
      where: { id: sessionId, tenantId },
      data: { revokedAt },
    });
  }

  /**
   * 撤销某用户在某租户下的所有有效会话(强制下线 / 登出 all)
   * @param userId 用户 ID
   * @param tenantId 租户 ID(若为 undefined,撤销所有租户下的会话)
   */
  async revokeAllByUser(userId: string, tenantId?: string): Promise<number> {
    const where: Prisma.SessionWhereInput = {
      userId,
      revokedAt: null,
    };
    if (tenantId) {
      where.tenantId = tenantId;
    }
    const result = await prisma().session.updateMany({
      where,
      data: { revokedAt: new Date() },
    });
    return result.count;
  }

  /**
   * 撤销某 refresh_token_hash 对应的会话(登出当前设备)
   */
  async revokeByRefreshTokenHash(refreshTokenHash: string): Promise<boolean> {
    const result = await prisma().session.updateMany({
      where: { refreshTokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count > 0;
  }
}

export const sessionRepository = new SessionRepository();
