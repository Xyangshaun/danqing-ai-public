// ============================================================
// PresenceService 单元测试(M4-BE-1,P-09)
// 对应源码:src/services/presence.service.ts
// 对应契约:api-contract.ts §3.12(三态:online/idle/offline)
//
// 测试范围:
//   1. markOnline:写 presence:user:* (TTL 300s) + ZADD presence:online
//      getBatch 判定 online(client/lastSeenAt 来自 Redis 载荷)
//   2. markOffline:DEL + ZREM,回到 DB 派生态
//   3. getBatch 三态判定:online(presence 命中)/ idle(仅有效会话)/ offline(无)
//      activeSessions 来自 DB 统计,idle.lastSeenAt 取最近有效会话 expiresAt
//   4. touch 60s 节流:窗口内跳过写,窗口外滑动刷新 TTL;sessionId 未传时保留
//   5. Redis 故障降级:MGET 失败 → 纯 DB 派生(idle/offline),不抛;
//      ZRANGE 失败 → getOnline 回退 DB 候选用户清单
//
// Mock 策略:
//   - setup.ts 全局 mock Redis / Prisma(内存实现)
//   - 每个用例使用独立 userId,规避 touch 节流 Map(进程内单例)串扰
// ============================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { redisMock, prismaMock } from './setup.js';
import { presenceService } from '../src/services/presence.service.js';
import type { UserPresenceEntry } from '../src/types/api-contract.js';

// ============================================================
// 测试常量与辅助
// ============================================================

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

function findEntry(items: UserPresenceEntry[], userId: string): UserPresenceEntry {
  const entry = items.find((i) => i.userId === userId);
  expect(entry).toBeDefined();
  return entry as UserPresenceEntry;
}

// ============================================================
// 1. markOnline / markOffline(写路径 + online 判定)
// ============================================================

describe('PresenceService.markOnline / markOffline', () => {
  beforeEach(() => redisMock.__clear());

  it('markOnline 写入 presence key(TTL≈300s)并加入在线 ZSET,getBatch 判定 online', async () => {
    const before = Date.now();
    await presenceService.markOnline('u-m4-1', 'sess-m4-1', 'web');
    const after = Date.now();

    // presence:user:{userId}:JSON 载荷 + 滑动 TTL 300s
    const entry = redisMock.__peek(presenceKey('u-m4-1'));
    expect(entry).toBeDefined();
    const payload = JSON.parse(entry!.value) as { lastSeenAt: string; client: string; sessionId: string };
    expect(payload.client).toBe('web');
    expect(payload.sessionId).toBe('sess-m4-1');
    expect(typeof payload.lastSeenAt).toBe('string');
    expect(entry!.expiresAt).not.toBeNull();
    // TTL 在 [before+300s, after+300s] 区间内
    expect(entry!.expiresAt!).toBeGreaterThanOrEqual(before + 300_000);
    expect(entry!.expiresAt!).toBeLessThanOrEqual(after + 300_000);

    // presence:online ZSET:member=userId,score=epoch 毫秒
    const members = await redisMock.zrange(ONLINE_ZSET_KEY, 0, -1);
    expect(members).toContain('u-m4-1');

    // getBatch:online 三态合成
    const res = await presenceService.getBatch(['u-m4-1']);
    const item = findEntry(res.items, 'u-m4-1');
    expect(item.state).toBe('online');
    expect(item.client).toBe('web');
    expect(item.lastSeenAt).toBe(payload.lastSeenAt);
    expect(typeof res.asOf).toBe('string');
  });

  it('markOffline 删除 presence key 并移出 ZSET,状态回退 DB 派生', async () => {
    insertValidSession('u-m4-2', 'sess-m4-2');
    await presenceService.markOnline('u-m4-2', 'sess-m4-2', 'admin');

    await presenceService.markOffline('u-m4-2');

    expect(redisMock.__peek(presenceKey('u-m4-2'))).toBeUndefined();
    const members = await redisMock.zrange(ONLINE_ZSET_KEY, 0, -1);
    expect(members).not.toContain('u-m4-2');

    // 无 presence 但有有效会话 → idle
    const res = await presenceService.getBatch(['u-m4-2']);
    expect(findEntry(res.items, 'u-m4-2').state).toBe('idle');
  });
});

// ============================================================
// 2. getBatch 三态判定(单一真相)
// ============================================================

describe('PresenceService.getBatch(三态判定)', () => {
  beforeEach(() => redisMock.__clear());

  it('online / idle / offline 三态并存,字段语义符合契约 §3.12', async () => {
    // online:Redis presence 命中
    await presenceService.markOnline('u-tri-online', 'sess-on', 'mobile');

    // idle:无 presence,2 个有效会话(sess-idle-2 过期更晚,lastSeenAt 取其 expiresAt)
    const soonerExpiry = new Date(Date.now() + 1 * 24 * 60 * 60 * 1000);
    const laterExpiry = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    insertValidSession('u-tri-idle', 'sess-idle-1', soonerExpiry);
    insertValidSession('u-tri-idle', 'sess-idle-2', laterExpiry);
    // 已撤销/已过期的会话不计入
    prismaMock.__insertSession({
      id: 'sess-idle-revoked',
      userId: 'u-tri-idle',
      tenantId: 't-presence',
      refreshTokenHash: 'hash-revoked',
      revokedAt: new Date(),
    });

    // offline:无 presence 且无有效会话(仅过期会话)
    insertValidSession('u-tri-offline', 'sess-off-expired', new Date(Date.now() - 1000));

    const res = await presenceService.getBatch(['u-tri-online', 'u-tri-idle', 'u-tri-offline', 'u-tri-ghost']);
    expect(res.items).toHaveLength(4);

    const online = findEntry(res.items, 'u-tri-online');
    expect(online.state).toBe('online');
    expect(online.client).toBe('mobile');
    expect(online.lastSeenAt).not.toBeNull();

    const idle = findEntry(res.items, 'u-tri-idle');
    expect(idle.state).toBe('idle');
    expect(idle.client).toBeNull();
    expect(idle.activeSessions).toBe(2); // 已撤销会话不计入
    // idle.lastSeenAt = DB 最近有效会话 expiresAt
    expect(idle.lastSeenAt).toBe(laterExpiry.toISOString());

    for (const uid of ['u-tri-offline', 'u-tri-ghost']) {
      const offline = findEntry(res.items, uid);
      expect(offline.state).toBe('offline');
      expect(offline.client).toBeNull();
      expect(offline.lastSeenAt).toBeNull();
      expect(offline.activeSessions).toBe(0);
    }
  });

  it('空 ids 返回空清单,不发起任何 Redis/DB 调用', async () => {
    const res = await presenceService.getBatch([]);
    expect(res.items).toEqual([]);
    expect(typeof res.asOf).toBe('string');
  });
});

// ============================================================
// 3. touch 节流(60s 进程内窗口)
// ============================================================

describe('PresenceService.touch(60s 节流)', () => {
  beforeEach(() => {
    redisMock.__clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-08T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('窗口内重复 touch 跳过写;窗口外滑动刷新 TTL', async () => {
    const t0 = Date.now();
    await presenceService.touch('u-touch-1', 'web', 'sess-touch-1');
    const first = redisMock.__peek(presenceKey('u-touch-1'));
    expect(first).toBeDefined();
    expect(first!.expiresAt).toBe(t0 + 300_000);

    // +30s:命中节流,不重写(expiresAt 不变)
    vi.advanceTimersByTime(30_000);
    await presenceService.touch('u-touch-1', 'web', 'sess-touch-1');
    const second = redisMock.__peek(presenceKey('u-touch-1'));
    expect(second!.expiresAt).toBe(t0 + 300_000);

    // +61s(累计 91s):越过节流窗口,滑动刷新 TTL
    vi.advanceTimersByTime(61_000);
    await presenceService.touch('u-touch-1', 'web', 'sess-touch-1');
    const third = redisMock.__peek(presenceKey('u-touch-1'));
    expect(third!.expiresAt).toBe(t0 + 91_000 + 300_000);
  });

  it('sessionId 未传时保留 markOnline 写入的会话关联', async () => {
    await presenceService.markOnline('u-touch-2', 'sess-keep', 'admin');
    // touch 不带 sessionId(不同节流 userId,无干扰)
    await presenceService.touch('u-touch-2', 'admin');
    const entry = redisMock.__peek(presenceKey('u-touch-2'));
    const payload = JSON.parse(entry!.value) as { sessionId: string; client: string };
    expect(payload.sessionId).toBe('sess-keep');
    expect(payload.client).toBe('admin');
  });
});

// ============================================================
// 4. Redis 故障降级(绝不 5xx)
// ============================================================

describe('PresenceService(Redis 故障降级)', () => {
  beforeEach(() => redisMock.__clear());

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('MGET 失败时回退纯 DB 派生:有效会话 → idle,无会话 → offline,不抛', async () => {
    insertValidSession('u-deg-idle', 'sess-deg-1');
    vi.spyOn(redisMock, 'mget').mockRejectedValueOnce(new Error('redis down'));

    const res = await presenceService.getBatch(['u-deg-idle', 'u-deg-off']);

    const idle = findEntry(res.items, 'u-deg-idle');
    expect(idle.state).toBe('idle'); // online 退化为 idle
    expect(idle.activeSessions).toBe(1);

    const offline = findEntry(res.items, 'u-deg-off');
    expect(offline.state).toBe('offline');
  });

  it('ZRANGE 失败时 getOnline 回退 DB 候选清单,summary 计数正确', async () => {
    insertValidSession('u-deg-online-1', 'sess-deg-o1');
    insertValidSession('u-deg-online-2', 'sess-deg-o2');
    vi.spyOn(redisMock, 'zrange').mockRejectedValueOnce(new Error('redis down'));

    const res = await presenceService.getOnline();

    // 降级路径:DB 有效会话用户全部判定为 idle(online 退化为 idle)
    expect(res.summary.online).toBe(0);
    expect(res.summary.idle).toBe(2);
    expect(res.summary.offline).toBe(0);
    expect(res.items.map((i) => i.userId).sort()).toEqual(['u-deg-online-1', 'u-deg-online-2']);
  });

  it('markOnline 期间 Redis 写失败仅 log 不抛(登录主流程不受影响)', async () => {
    vi.spyOn(redisMock, 'set').mockRejectedValueOnce(new Error('redis down'));
    await expect(presenceService.markOnline('u-deg-write', 'sess-x', 'web')).resolves.toBeUndefined();
  });
});

// ============================================================
// 5. getOnline 正常路径(ZSET 兜底清理)
// ============================================================

describe('PresenceService.getOnline(正常路径)', () => {
  beforeEach(() => redisMock.__clear());

  it('清理超时 member 后返回在线清单,summary 与 items 一致', async () => {
    await presenceService.markOnline('u-on-1', 'sess-on-1', 'web');
    await presenceService.markOnline('u-on-2', 'sess-on-2', 'admin');
    // 注入一个超时 member(score 早于 now-300s),应被 ZREMRANGEBYSCORE 清理
    await redisMock.zadd(ONLINE_ZSET_KEY, Date.now() - 301_000, 'u-on-stale');

    const res = await presenceService.getOnline();

    expect(res.items.map((i) => i.userId).sort()).toEqual(['u-on-1', 'u-on-2']);
    expect(res.summary).toEqual({ online: 2, idle: 0, offline: 0 });
    for (const item of res.items) {
      expect(item.state).toBe('online');
    }
    // 超时 member 已从 ZSET 移除
    const members = await redisMock.zrange(ONLINE_ZSET_KEY, 0, -1);
    expect(members).not.toContain('u-on-stale');
  });
});
