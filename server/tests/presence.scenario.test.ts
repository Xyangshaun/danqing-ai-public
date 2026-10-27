// ============================================================
// Presence 三态生命周期场景测试(M4-QA-1,B 块)
// 对应源码:src/services/presence.service.ts + auth.service.ts 埋点
// 对应契约:api-contract.ts §3.12(三态:online/idle/offline)
//
// 目的:以端到端生命周期视角验证三态语义的迁移正确性(本任务核心价值),
//       不依赖真实网络,复用项目测试基建(mock Redis/Prisma):
//   markOnline  = 登录成功埋点(auth.service.ts L148/L1232 调用)
//   markOffline = 登出埋点(auth.service.ts L325 调用)
//   touch       = 认证中间件被动心跳(auth.ts L144 fire-and-forget)
//   DEL presence key = 模拟静置超 5min TTL 到期
//
// 场景:
//   场景1 登录→online :markOnline 后 getBatch → online,client/activeSessions/lastSeenAt 正确
//   场景2 静置→idle   :presence 清除但有效会话仍在 → idle,activeSessions>0
//   场景2b 静置后 touch:被动认证中间件 touch → 恢复 online
//   场景3 登出→offline:撤销会话 + markOffline → offline,activeSessions=0
//   判定细节:revoked 会话不计入 activeSessions;idle.lastSeenAt 取 max(expiresAt)
//
// 注:每个用例使用独立 userId,规避 touch 节流 Map(进程内单例)串扰
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { redisMock, prismaMock } from './setup.js';
import { presenceService } from '../src/services/presence.service.js';
import type { UserPresenceEntry } from '../src/types/api-contract.js';

const ONLINE_ZSET_KEY = 'presence:online';

function presenceKey(userId: string): string {
  return `presence:user:${userId}`;
}

/** 预置一个有效会话(默认 7 天后过期,未撤销) */
function insertValidSession(userId: string, id: string, expiresAt?: Date): void {
  prismaMock.__insertSession({
    id,
    userId,
    tenantId: 't-presence',
    refreshTokenHash: `hash-${id}`,
    ...(expiresAt !== undefined ? { expiresAt } : {}),
  });
}

/** 模拟登出撤销指定会话(等价 auth logout 撤销 refresh_token 对应 Session) */
async function revokeSession(id: string): Promise<void> {
  await prismaMock.session.update({
    where: { id },
    data: { revokedAt: new Date() },
  });
}

function findEntry(items: UserPresenceEntry[], userId: string): UserPresenceEntry {
  const entry = items.find((i) => i.userId === userId);
  expect(entry).toBeDefined();
  return entry as UserPresenceEntry;
}

describe('Presence 三态生命周期场景(M4-QA-1)', () => {
  beforeEach(() => redisMock.__clear());

  // ============================================================
  // 场景1:登录 → online
  // ============================================================
  it('场景1 登录→online:markOnline(登录埋点) 后 getBatch 判定 online', async () => {
    const userId = 'scn-login';
    const sessionId = 'scn-sess-login';
    // 模拟登录:落有效会话(登录 createSession)+ 埋点 markOnline
    insertValidSession(userId, sessionId);
    await presenceService.markOnline(userId, sessionId, 'admin');

    const res = await presenceService.getBatch([userId]);
    const item = findEntry(res.items, userId);

    // 期望 → 实际断言
    expect(item.state).toBe('online'); // 三态:online
    expect(item.client).toBe('admin'); // 来自 Redis 载荷
    expect(item.activeSessions).toBe(1); // DB 有效会话聚合
    expect(item.lastSeenAt).toBeTypeOf('string'); // 最近活跃时间

    // presence 数据确实写入(供 getBatch online 判定)
    expect(redisMock.__peek(presenceKey(userId))).toBeDefined();
    const members = await redisMock.zrange(ONLINE_ZSET_KEY, 0, -1);
    expect(members).toContain(userId);
  });

  // ============================================================
  // 场景2:静置 → idle
  // ============================================================
  it('场景2 静置→idle:presence TTL 到期(清除 key),有效会话仍在 → idle', async () => {
    const userId = 'scn-idle';
    const sessionId = 'scn-sess-idle';
    insertValidSession(userId, sessionId);
    await presenceService.markOnline(userId, sessionId, 'web');

    // 静置:模拟 presence:user:{userId} TTL(300s)到期被清除
    await redisMock.del(presenceKey(userId));

    const res = await presenceService.getBatch([userId]);
    const item = findEntry(res.items, userId);

    // online 不应直接跳 offline:有效会话仍在 → idle
    expect(item.state).toBe('idle');
    expect(item.client).toBeNull(); // 非 online 时 client 为 null
    expect(item.activeSessions).toBe(1); // 有效会话仍计入
  });

  it('场景2b 静置后经 touch(被动认证中间件)恢复 online', async () => {
    const userId = 'scn-idle-touch';
    const sessionId = 'scn-sess-touch';
    insertValidSession(userId, sessionId);
    await presenceService.markOnline(userId, sessionId, 'mobile');

    // 静置:presence 到期
    await redisMock.del(presenceKey(userId));
    expect(findEntry((await presenceService.getBatch([userId])).items, userId).state).toBe('idle');

    // 认证中间件被动 touch(fire-and-forget,60s 节流外)→ 重写 presence → 恢复 online
    await presenceService.touch(userId, 'mobile');
    const item = findEntry((await presenceService.getBatch([userId])).items, userId);
    expect(item.state).toBe('online');
    expect(item.client).toBe('mobile');
  });

  // ============================================================
  // 场景3:登出 → offline
  // ============================================================
  it('场景3 登出→offline:撤销会话 + markOffline(登出埋点) → offline', async () => {
    const userId = 'scn-offline';
    const sessionId = 'scn-sess-off';
    insertValidSession(userId, sessionId);
    await presenceService.markOnline(userId, sessionId, 'mobile');

    // 登出:撤销 refresh_token 对应 Session + 埋点 markOffline
    await revokeSession(sessionId);
    await presenceService.markOffline(userId);

    const res = await presenceService.getBatch([userId]);
    const item = findEntry(res.items, userId);

    // 无 presence 且无有效会话 → offline
    expect(item.state).toBe('offline');
    expect(item.client).toBeNull();
    expect(item.activeSessions).toBe(0);
    expect(item.lastSeenAt).toBeNull();

    // presence 已清除 + ZSET 已移出
    expect(redisMock.__peek(presenceKey(userId))).toBeUndefined();
    const members = await redisMock.zrange(ONLINE_ZSET_KEY, 0, -1);
    expect(members).not.toContain(userId);
  });

  // ============================================================
  // 判定细节:revoked 会话不计入 activeSessions;idle.lastSeenAt 取 max(expiresAt)
  // ============================================================
  it('判定细节:已撤销会话不计入 activeSessions,idle.lastSeenAt 取最近有效会话 expiresAt', async () => {
    const userId = 'scn-verdict';
    const laterExpiry = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const earlierExpiry = new Date(Date.now() + 1 * 24 * 60 * 60 * 1000);
    insertValidSession(userId, 'scn-v-s1', laterExpiry); // 更晚过期
    insertValidSession(userId, 'scn-v-s2', earlierExpiry);
    // 模拟场景3里另一台设备已登出:该会话被撤销
    await revokeSession('scn-v-s2');

    // 无 presence(用户当前不活跃)→ idle
    const res = await presenceService.getBatch([userId]);
    const item = findEntry(res.items, userId);

    expect(item.state).toBe('idle');
    // revoked 会话不计入:仅剩 1 个有效会话
    expect(item.activeSessions).toBe(1);
    // idle.lastSeenAt = DB 最近有效会话 expiresAt(max)
    expect(item.lastSeenAt).toBe(laterExpiry.toISOString());
  });
});
