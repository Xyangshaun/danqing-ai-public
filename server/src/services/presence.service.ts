// ============================================================
// 用户在线状态 Presence 服务(M4-BE-1,P-09)
// 对应文档:api-contract.ts §3.12(契约已冻结,字段名/类型禁止改动)
//
// 三态判定语义(单一真相,全端统一,禁止自定义):
//   online  :Redis presence:user:{userId} 存在(近 5 分钟有心跳/请求)
//   idle    :presence 不存在,但 DB 有有效 Session(expiresAt > now && revokedAt IS NULL)
//   offline :无 presence 且无有效 Session
//
// Redis Key 规范(契约 §3.12,严格照此):
//   presence:user:{userId}  String(JSON {lastSeenAt, client, sessionId}) TTL=300s(滑动)
//   presence:online         ZSET(member=userId, score=lastSeenEpoch 毫秒)
//                           由 ZREMRANGEBYSCORE 清理超时 member 兜底
//
// 可靠性设计:
//   - 写路径(markOnline/markOffline/touch)失败仅 catch + log,绝不抛:
//     登录/登出/请求主流程不能因 presence 失败而挂
//   - 读路径(getBatch/getOnline)Redis 故障时降级为纯 DB Session 派生
//     (只能给出 idle/offline 二态,online 退化为 idle),绝不 5xx
//   - touch 60s 进程内节流,防写放大;Map 定期清理过期条目防内存泄漏
//
// 安全:日志仅记录 userId 与错误消息,不记录 token/session 内容
// ============================================================

import { redis } from '../config/redis.js';
import { prisma } from '../config/prisma.js';
import { logger } from '../utils/logger.js';
import type {
  PresenceState,
  PresenceClient,
  UserPresenceEntry,
  PresenceBatchResponse,
  PresenceOnlineResponse,
} from '../types/api-contract.js';

/** presence:user:{userId} TTL(秒):5 分钟滑动窗口 */
const PRESENCE_TTL_SECONDS = 300;

/** touch 节流窗口(毫秒):60s 内同一 userId 只写一次 Redis */
const TOUCH_THROTTLE_MS = 60_000;

/** 节流 Map 触发全量清理的容量阈值 */
const TOUCH_MAP_SWEEP_THRESHOLD = 1000;

/** 在线清单 ZSET key */
const ONLINE_ZSET_KEY = 'presence:online';

/** 单用户 presence key */
function userPresenceKey(userId: string): string {
  return `presence:user:${userId}`;
}

/** Redis 中存储的 presence JSON 载荷(契约 §3.12 Key 规范) */
interface PresencePayload {
  /** 最后活跃时间(ISO 8601) */
  lastSeenAt: string;
  /** 当前活跃客户端类型 */
  client: PresenceClient;
  /** 关联会话 ID(用于调试,不外泄) */
  sessionId: string;
}

/** DB 有效会话聚合结果(按 userId) */
interface SessionPresenceStats {
  /** 有效会话数 */
  activeSessions: number;
  /** 最近有效会话的 expiresAt(用于 idle 的 lastSeenAt) */
  latestExpiresAt: Date | null;
}

class PresenceServiceClass {
  /** touch 节流表:userId → 上次成功 touch 的 epoch 毫秒 */
  private readonly touchThrottle = new Map<string, number>();

  // ============================================================
  // 写路径(失败仅 log,不抛)
  // ============================================================

  /**
   * 标记用户在线(登录成功后调用)
   * SETEX presence:user:{userId} 300 JSON + ZADD presence:online {nowMs} {userId}
   */
  async markOnline(userId: string, sessionId: string, client: PresenceClient): Promise<void> {
    try {
      const now = new Date();
      const payload: PresencePayload = {
        lastSeenAt: now.toISOString(),
        client,
        sessionId,
      };
      await redis().set(userPresenceKey(userId), JSON.stringify(payload), 'EX', PRESENCE_TTL_SECONDS);
      await redis().zadd(ONLINE_ZSET_KEY, now.getTime(), userId);
    } catch (err) {
      // 登录主流程不能因 presence 失败而挂:仅告警
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), userId },
        '[presence] markOnline failed (non-fatal)',
      );
    }
  }

  /**
   * 标记用户离线(登出/会话全部撤销时调用)
   * DEL presence:user:{userId} + ZREM presence:online {userId}
   */
  async markOffline(userId: string): Promise<void> {
    try {
      await redis().del(userPresenceKey(userId));
      await redis().zrem(ONLINE_ZSET_KEY, userId);
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), userId },
        '[presence] markOffline failed (non-fatal)',
      );
    }
  }

  /**
   * 心跳/请求活跃刷新(认证中间件调用)
   * - 60s 进程内节流:命中节流直接 return,防写放大
   * - 未命中:重写 presence:user:{userId}(滑动刷新 300s TTL)+ ZADD 更新 score
   * - sessionId 未传时保留既有值(避免把 markOnline 写入的会话关联抹掉)
   */
  async touch(userId: string, client: PresenceClient, sessionId?: string): Promise<void> {
    const nowMs = Date.now();
    const lastTouch = this.touchThrottle.get(userId);
    if (lastTouch !== undefined && nowMs - lastTouch < TOUCH_THROTTLE_MS) {
      return;
    }
    // 顺带清理过期节流条目,防内存泄漏(容量超阈值时全量扫描一次)
    if (this.touchThrottle.size >= TOUCH_MAP_SWEEP_THRESHOLD) {
      this.sweepTouchThrottle(nowMs);
    }

    try {
      let sessionIdFinal = sessionId;
      if (sessionIdFinal === undefined) {
        const existing = await redis().get(userPresenceKey(userId));
        if (existing !== null) {
          const parsed = this.parsePayload(existing);
          if (parsed !== null) {
            sessionIdFinal = parsed.sessionId;
          }
        }
      }
      const payload: PresencePayload = {
        lastSeenAt: new Date(nowMs).toISOString(),
        client,
        sessionId: sessionIdFinal ?? '',
      };
      await redis().set(userPresenceKey(userId), JSON.stringify(payload), 'EX', PRESENCE_TTL_SECONDS);
      await redis().zadd(ONLINE_ZSET_KEY, nowMs, userId);
      // 仅写成功才记录节流时间点(失败则下次 touch 立即重试)
      this.touchThrottle.set(userId, nowMs);
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), userId },
        '[presence] touch failed (non-fatal)',
      );
    }
  }

  // ============================================================
  // 读路径(Redis 故障降级为纯 DB 派生,绝不 5xx)
  // ============================================================

  /**
   * 批量查询用户三态
   * GET /api/admin/presence/users?ids=a,b,c 的 data 载荷(不含 ApiResponse 包装)
   *
   * 判定流程:
   *   1. 批量 MGET presence:user:*(一次 RTT)
   *   2. 单次 DB 查询聚合所有 userId 的有效会话(count + 最近 expiresAt,无 N+1)
   *   3. 按三态语义合成条目,顺序与入参 ids 一致
   */
  async getBatch(userIds: string[]): Promise<PresenceBatchResponse> {
    const asOf = new Date().toISOString();
    if (userIds.length === 0) {
      return { items: [], asOf };
    }

    const [presenceMap, sessionStats] = await Promise.all([
      this.readPresenceMap(userIds),
      this.readSessionStats(userIds),
    ]);

    const items: UserPresenceEntry[] = userIds.map((userId) =>
      this.buildEntry(userId, presenceMap.get(userId) ?? null, sessionStats.get(userId) ?? null),
    );
    return { items, asOf };
  }

  /**
   * 在线用户清单(ZSET 派生)
   * GET /api/admin/presence/online 的 data 载荷(不含 ApiResponse 包装)
   *
   * 流程:
   *   1. ZREMRANGEBYSCORE 清理超时 member(score ≤ nowMs - 300s,兜底 TTL)
   *   2. ZRANGE 0 -1 取候选 userId,复用 getBatch 判定逻辑合成三态
   *   3. 汇总 online/idle/offline 计数
   * Redis 故障时降级:从 DB 有效会话取候选用户(只能给出 idle/offline 二态)
   */
  async getOnline(): Promise<PresenceOnlineResponse> {
    const nowMs = Date.now();
    let userIds: string[] = [];
    try {
      await redis().zremrangebyscore(ONLINE_ZSET_KEY, '-inf', nowMs - PRESENCE_TTL_SECONDS * 1000);
      userIds = await redis().zrange(ONLINE_ZSET_KEY, 0, -1);
    } catch (err) {
      // Redis 故障降级:候选用户改由 DB 有效会话派生(上限 1000 防内存膨胀)
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        '[presence] getOnline redis read failed, fallback to DB-only derivation',
      );
      userIds = await this.listUserIdsWithValidSessions();
    }

    const { items, asOf } = await this.getBatch(userIds);
    const summary = { online: 0, idle: 0, offline: 0 };
    for (const item of items) {
      summary[item.state] += 1;
    }
    return { items, summary, asOf };
  }

  // ============================================================
  // 内部辅助
  // ============================================================

  /**
   * 批量读取 presence 载荷(MGET,一次 RTT)
   * Redis 故障或 JSON 损坏均按"无 presence"处理(降级,不抛)
   */
  private async readPresenceMap(userIds: string[]): Promise<Map<string, PresencePayload>> {
    const map = new Map<string, PresencePayload>();
    try {
      const raws = await redis().mget(...userIds.map(userPresenceKey));
      for (let i = 0; i < userIds.length; i += 1) {
        const userId = userIds[i];
        const raw = raws[i];
        if (userId === undefined || raw === null || raw === undefined) continue;
        const parsed = this.parsePayload(raw);
        if (parsed !== null) {
          map.set(userId, parsed);
        }
      }
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        '[presence] batch MGET failed, fallback to DB-only derivation',
      );
    }
    return map;
  }

  /**
   * 单次 DB 查询聚合有效会话统计(无 N+1)
   * 有效会话:expiresAt > now AND revokedAt IS NULL(与 dev-view.repository.ts 判定一致)
   *
   * 实现说明:契约建议 groupBy;此处用单次 findMany(where userId IN) 在 JS 侧聚合,
   * 同样一次 SQL 往返,且可同时取 count 与 max(expiresAt),与既有 prisma mock 兼容。
   * DB 故障时降级为空统计(状态退化为仅 presence 派生),不抛。
   */
  private async readSessionStats(userIds: string[]): Promise<Map<string, SessionPresenceStats>> {
    const stats = new Map<string, SessionPresenceStats>();
    try {
      const now = new Date();
      const rows = await prisma().session.findMany({
        where: {
          userId: { in: userIds },
          expiresAt: { gt: now },
          revokedAt: null,
        },
        select: { userId: true, expiresAt: true },
      });
      for (const row of rows) {
        const existing = stats.get(row.userId);
        if (existing) {
          existing.activeSessions += 1;
          if (existing.latestExpiresAt === null || row.expiresAt > existing.latestExpiresAt) {
            existing.latestExpiresAt = row.expiresAt;
          }
        } else {
          stats.set(row.userId, { activeSessions: 1, latestExpiresAt: row.expiresAt });
        }
      }
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        '[presence] session stats query failed, degrade to presence-only derivation',
      );
    }
    return stats;
  }

  /**
   * Redis 完全不可用时,从 DB 有效会话取候选用户清单(getOnline 降级路径)
   * 上限 1000 条防内存膨胀;超出部分忽略(降级场景可接受)
   */
  private async listUserIdsWithValidSessions(): Promise<string[]> {
    try {
      const rows = await prisma().session.findMany({
        where: { expiresAt: { gt: new Date() }, revokedAt: null },
        select: { userId: true },
        take: 1000,
      });
      return Array.from(new Set(rows.map((r) => r.userId)));
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        '[presence] fallback session user list query failed',
      );
      return [];
    }
  }

  /**
   * 按三态语义合成单用户条目(单一真相,禁止自定义第四态)
   */
  private buildEntry(
    userId: string,
    presence: PresencePayload | null,
    stats: SessionPresenceStats | null,
  ): UserPresenceEntry {
    const activeSessions = stats?.activeSessions ?? 0;
    if (presence !== null) {
      return {
        userId,
        state: 'online' satisfies PresenceState,
        lastSeenAt: presence.lastSeenAt,
        client: presence.client,
        activeSessions,
      };
    }
    if (activeSessions > 0) {
      return {
        userId,
        state: 'idle' satisfies PresenceState,
        lastSeenAt: stats?.latestExpiresAt?.toISOString() ?? null,
        client: null,
        activeSessions,
      };
    }
    return {
      userId,
      state: 'offline' satisfies PresenceState,
      lastSeenAt: null,
      client: null,
      activeSessions: 0,
    };
  }

  /**
   * 解析 presence JSON 载荷;损坏数据按无 presence 处理(返回 null)
   */
  private parsePayload(raw: string): PresencePayload | null {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        typeof (parsed as PresencePayload).lastSeenAt === 'string' &&
        typeof (parsed as PresencePayload).sessionId === 'string' &&
        ((parsed as PresencePayload).client === 'web' ||
          (parsed as PresencePayload).client === 'admin' ||
          (parsed as PresencePayload).client === 'mobile')
      ) {
        return parsed as PresencePayload;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * 清理节流表中已过期的条目(距上次 touch 超过节流窗口)
   * 仅在容量超阈值时由 touch 顺带触发,摊销清理成本
   */
  private sweepTouchThrottle(nowMs: number): void {
    for (const [userId, lastTouch] of this.touchThrottle) {
      if (nowMs - lastTouch >= TOUCH_THROTTLE_MS) {
        this.touchThrottle.delete(userId);
      }
    }
  }
}

export const presenceService = new PresenceServiceClass();
