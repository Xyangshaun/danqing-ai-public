// ============================================================
// Redis Mock(内存 Map 模拟 ioredis)
// 对应源码:src/config/redis.ts(initRedis / redis / closeRedis)
// 对应文档:auth-design.md §1.2 步骤 3(state 缓存)+ §2.2(黑名单)+ §3.3(限流)
//
// 支持方法:get / set(EX 选项) / del / expire / exists / incr / quit
//          zadd / zremrangebyscore / zcard(滑动窗口限流)
//          eval / evalsha(Lua 原子脚本,通过 script cache + 模式分派)
// 支持 TTL 过期语义(惰性删除)
// 提供 __clear / __dump / __rawSet 供测试控制
// ============================================================

import crypto from 'node:crypto';

interface RedisEntry {
  value: string;
  expiresAt: number | null; // 绝对时间戳(ms),null 表示永不过期
}

interface SortedSetEntry {
  members: Array<{ score: number; member: string }>;
  expiresAt: number | null;
}

/**
 * Redis Mock 单例(共享状态)
 * 测试中通过 redisState 访问内部 store 进行断言或控制
 */
class RedisMock {
  private readonly store = new Map<string, RedisEntry>();
  private readonly sortedSets = new Map<string, SortedSetEntry>();
  /** List 结构(对应 Redis List,用于异步队列:lpush/brpop/rpop/llen) */
  private readonly lists = new Map<string, string[]>();
  /** Lua 脚本缓存:sha1 → 脚本源码(对应 Redis SCRIPT LOAD) */
  private readonly scriptCache = new Map<string, string>();

  /**
   * 惰性过期检查:访问时删除已过期 key(字符串 + 有序集)
   */
  private refresh(key: string): void {
    const entry = this.store.get(key);
    if (entry && entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.store.delete(key);
    }
    const zset = this.sortedSets.get(key);
    if (zset && zset.expiresAt !== null && zset.expiresAt <= Date.now()) {
      this.sortedSets.delete(key);
    }
  }

  async get(key: string): Promise<string | null> {
    this.refresh(key);
    const entry = this.store.get(key);
    return entry?.value ?? null;
  }

  /**
   * SET key value [EX seconds]
   * 支持 ioredis 的 set(key, value, 'EX', ttl) 调用形式
   */
  async set(
    key: string,
    value: string,
    modeOrExpiry?: string | number,
    ttl?: number,
  ): Promise<'OK'> {
    let expiresAt: number | null = null;
    // 形式:set(key, value, 'EX', seconds)
    if (modeOrExpiry === 'EX' && typeof ttl === 'number') {
      expiresAt = Date.now() + ttl * 1000;
    }
    // 形式:set(key, value, seconds)(部分调用)
    if (typeof modeOrExpiry === 'number') {
      expiresAt = Date.now() + modeOrExpiry * 1000;
    }
    this.store.set(key, { value, expiresAt });
    return 'OK';
  }

  async del(...keys: string[]): Promise<number> {
    let deleted = 0;
    for (const key of keys) {
      // Redis 中一个 key 只属于一种类型,del 对存在的 key 返回 1
      let removed = false;
      if (this.store.delete(key)) removed = true;
      if (this.sortedSets.delete(key)) removed = true;
      if (removed) deleted += 1;
    }
    return deleted;
  }

  async expire(key: string, seconds: number): Promise<number> {
    this.refresh(key);
    const entry = this.store.get(key);
    if (entry) {
      entry.expiresAt = Date.now() + seconds * 1000;
      return 1;
    }
    const zset = this.sortedSets.get(key);
    if (zset) {
      zset.expiresAt = Date.now() + seconds * 1000;
      return 1;
    }
    return 0;
  }

  async exists(...keys: string[]): Promise<number> {
    let count = 0;
    for (const key of keys) {
      this.refresh(key);
      if (this.store.has(key) || this.sortedSets.has(key)) count += 1;
    }
    return count;
  }

  /**
   * INCR:key 不存在时初始化为 0 再 +1
   * 用于限流计数(auth-design.md §3.3)
   */
  async incr(key: string): Promise<number> {
    this.refresh(key);
    const entry = this.store.get(key);
    const next = entry ? parseInt(entry.value, 10) + 1 : 1;
    this.store.set(key, {
      value: String(next),
      expiresAt: entry?.expiresAt ?? null,
    });
    return next;
  }

  // ============================================================
  // 有序集(Sorted Set)操作 —— 支持滑动窗口限流
  // ============================================================

  /**
   * ZADD key score member [score member ...]
   * 仅支持 NX 默认语义(member 已存在则更新 score)
   */
  async zadd(key: string, ...scoreMemberPairs: (string | number)[]): Promise<number> {
    this.refresh(key);
    if (scoreMemberPairs.length % 2 !== 0) {
      throw new Error('ZADD requires pairs of score/member');
    }
    let zset = this.sortedSets.get(key);
    if (!zset) {
      zset = { members: [], expiresAt: null };
      this.sortedSets.set(key, zset);
    }
    let added = 0;
    for (let i = 0; i < scoreMemberPairs.length; i += 2) {
      const score = Number(scoreMemberPairs[i]);
      const member = String(scoreMemberPairs[i + 1]);
      const existing = zset.members.find((m) => m.member === member);
      if (existing) {
        existing.score = score;
      } else {
        zset.members.push({ score, member });
        added += 1;
      }
    }
    return added;
  }

  /**
   * ZREMRANGEBYSCORE key min max
   * 删除 score 在 [min, max] 范围内的 member
   * 支持负无穷/正无穷(-inf / +inf)
   */
  async zremrangebyscore(key: string, min: string | number, max: string | number): Promise<number> {
    this.refresh(key);
    const zset = this.sortedSets.get(key);
    if (!zset) return 0;
    const minScore = min === '-inf' ? -Infinity : Number(min);
    const maxScore = max === '+inf' ? Infinity : Number(max);
    const before = zset.members.length;
    zset.members = zset.members.filter((m) => !(m.score >= minScore && m.score <= maxScore));
    return before - zset.members.length;
  }

  /**
   * ZCARD key —— 返回有序集成员数
   */
  async zcard(key: string): Promise<number> {
    this.refresh(key);
    const zset = this.sortedSets.get(key);
    return zset?.members.length ?? 0;
  }

  // ============================================================
  // M4 Presence 支持:mget / zrange / zrem(presence.service.ts)
  // ============================================================

  /**
   * MGET key [key ...] —— 批量读取字符串值(不存在为 null)
   */
  async mget(...keys: string[]): Promise<(string | null)[]> {
    const out: (string | null)[] = [];
    for (const key of keys) {
      out.push(await this.get(key));
    }
    return out;
  }

  /**
   * ZRANGE key start stop —— 按 score 升序返回 member(支持负索引,-1 表末尾)
   */
  async zrange(key: string, start: number, stop: number): Promise<string[]> {
    this.refresh(key);
    const zset = this.sortedSets.get(key);
    if (!zset) return [];
    const sorted = [...zset.members].sort((a, b) => a.score - b.score);
    const len = sorted.length;
    const from = start < 0 ? Math.max(len + start, 0) : start;
    const to = stop < 0 ? len + stop : stop;
    if (from > to || from >= len) return [];
    return sorted.slice(from, to + 1).map((m) => m.member);
  }

  /**
   * ZREM key member [member ...] —— 删除有序集成员,返回删除数
   */
  async zrem(key: string, ...members: (string | number)[]): Promise<number> {
    this.refresh(key);
    const zset = this.sortedSets.get(key);
    if (!zset) return 0;
    const targets = new Set(members.map(String));
    const before = zset.members.length;
    zset.members = zset.members.filter((m) => !targets.has(m.member));
    return before - zset.members.length;
  }

  // ============================================================
  // Lua 脚本:EVAL / EVALSHA
  // ============================================================

  /**
   * EVAL script numkeys key [key ...] arg [arg ...]
   * 简化实现:缓存脚本 sha1,按脚本内容分派到内置 JS 处理函数
   */
  async eval(
    script: string,
    numkeys: number,
    ...rest: (string | number | Buffer)[]
  ): Promise<unknown> {
    const sha = crypto.createHash('sha1').update(script).digest('hex');
    this.scriptCache.set(sha, script);
    return this.runScript(script, numkeys, rest);
  }

  /**
   * EVALSHA sha1 numkeys key [key ...] arg [arg ...]
   * 脚本未缓存时抛 NOSCRIPT 错误(对齐 ioredis 真实行为)
   */
  async evalsha(
    sha1: string,
    numkeys: number,
    ...rest: (string | number | Buffer)[]
  ): Promise<unknown> {
    const script = this.scriptCache.get(sha1);
    if (!script) {
      const err = new Error('NOSCRIPT No matching script. Please use EVAL.');
      (err as Error & { code?: string }).code = 'NOSCRIPT';
      throw err;
    }
    return this.runScript(script, numkeys, rest);
  }

  /**
   * 脚本分派:基于脚本内容识别已知 Lua 脚本
   * 当前支持:
   *   - rate-limit 滑动窗口脚本(ZADD + ZREMRANGEBYSCORE + ZCARD + EXPIRE)
   *   - session-rotate 会话轮转脚本(SET blacklist + DEL session + SET session)
   */
  private runScript(script: string, numkeys: number, rest: (string | number | Buffer)[]): unknown {
    const keys = rest.slice(0, numkeys).map((v) => v.toString());
    const args = rest.slice(numkeys).map((v) => v.toString());
    if (
      script.includes("'ZADD'") &&
      script.includes("'ZREMRANGEBYSCORE'") &&
      script.includes("'ZCARD'")
    ) {
      return this.runRateLimitScript(keys, args);
    }
    // 会话轮转脚本:KEYS = [blacklistKey, oldSessionKey, newSessionKey]
    // ARGV = [blacklistValue, blacklistTtl, sessionValue, sessionTtl]
    // 识别特征:同时含 'SET' + 'DEL' 且 KEYS 数为 3
    if (
      script.includes("'SET'") &&
      script.includes("'DEL'") &&
      numkeys === 3
    ) {
      return this.runSessionRotateScript(keys, args);
    }
    throw new Error(`mock: unsupported Lua script (len=${script.length})`);
  }

  /**
   * 会话轮转脚本 JS 实现(对应 src/services/session.service.ts rotateRefreshToken 中的 Lua 脚本)
   * 原子执行:1. SET blacklistKey blacklistValue EX blacklistTtl
   *          2. DEL oldSessionKey
   *          3. SET newSessionKey sessionValue EX sessionTtl
   * KEYS[1] = blacklist:refresh:{oldJti}
   * KEYS[2] = session:{userId}:{oldJti}
   * KEYS[3] = session:{userId}:{newJti}
   * ARGV[1]  = blacklistValue('1')
   * ARGV[2]  = blacklistTtl(秒)
   * ARGV[3]  = newSessionValue(JSON)
   * ARGV[4]  = sessionTtl(秒)
   * 返回:'OK'
   */
  private runSessionRotateScript(keys: string[], args: string[]): 'OK' {
    const [blacklistKey, oldSessionKey, newSessionKey] = keys;
    const blacklistValue = args[0] ?? '1';
    const blacklistTtl = Number(args[1] ?? 0);
    const sessionValue = args[2] ?? '';
    const sessionTtl = Number(args[3] ?? 0);
    if (blacklistTtl > 0) {
      this.store.set(blacklistKey, {
        value: blacklistValue,
        expiresAt: Date.now() + blacklistTtl * 1000,
      });
    }
    this.store.delete(oldSessionKey);
    if (sessionTtl > 0) {
      this.store.set(newSessionKey, {
        value: sessionValue,
        expiresAt: Date.now() + sessionTtl * 1000,
      });
    }
    return 'OK';
  }

  /**
   * 滑动窗口限流脚本 JS 实现(对应 src/middlewares/rate-limit.ts 中的 Lua 脚本)
   * ARGV:[now, member, windowMs, ttlSec]
   */
  private runRateLimitScript(keys: string[], args: string[]): number {
    const key = keys[0];
    const now = Number(args[0]);
    const member = args[1];
    const windowMs = Number(args[2]);
    const ttlSec = Number(args[3]);
    void this.zaddInternal(key, now, member);
    void this.zremrangebyscoreInternal(key, 0, now - windowMs);
    const count = this.zcardInternal(key);
    void this.expireInternal(key, ttlSec);
    return count;
  }

  private zaddInternal(key: string, score: number, member: string): number {
    let zset = this.sortedSets.get(key);
    if (!zset) {
      zset = { members: [], expiresAt: null };
      this.sortedSets.set(key, zset);
    }
    const existing = zset.members.find((m) => m.member === member);
    if (existing) {
      existing.score = score;
      return 0;
    }
    zset.members.push({ score, member });
    return 1;
  }

  private zremrangebyscoreInternal(key: string, min: number, max: number): number {
    const zset = this.sortedSets.get(key);
    if (!zset) return 0;
    const before = zset.members.length;
    zset.members = zset.members.filter((m) => !(m.score >= min && m.score <= max));
    return before - zset.members.length;
  }

  private zcardInternal(key: string): number {
    const zset = this.sortedSets.get(key);
    return zset?.members.length ?? 0;
  }

  private expireInternal(key: string, seconds: number): number {
    const entry = this.store.get(key);
    if (entry) {
      entry.expiresAt = Date.now() + seconds * 1000;
      return 1;
    }
    const zset = this.sortedSets.get(key);
    if (zset) {
      zset.expiresAt = Date.now() + seconds * 1000;
      return 1;
    }
    return 0;
  }

  async quit(): Promise<void> {
    // no-op
  }

  // ============================================================
  // List 操作(对应 Redis List,用于异步队列 LPUSH/BRPOP)
  // 支持 ioredis 调用形式:
  //   lpush(key, value) / brpop(...keys, timeout) / rpop(key) / llen(key)
  //   pipeline():链式 set + exec(用于 markSuccess 批量写状态+结果)
  //   ping():连通性检查
  // ============================================================

  async lpush(key: string, ...values: (string | number)[]): Promise<number> {
    this.refresh(key);
    const list = this.lists.get(key) ?? [];
    // LPUSH 依次将值插入头部(后插入者更靠前,与 Redis 语义一致)
    for (const v of values) {
      list.unshift(String(v));
    }
    this.lists.set(key, list);
    return list.length;
  }

  async rpop(key: string): Promise<string | null> {
    this.refresh(key);
    const list = this.lists.get(key);
    if (!list || list.length === 0) return null;
    return list.pop() ?? null;
  }

  async llen(key: string): Promise<number> {
    this.refresh(key);
    return this.lists.get(key)?.length ?? 0;
  }

  /**
   * BRPOP key [key ...] timeout
   * 从多个 key 的尾部弹出(FIFO);最后一个参数为阻塞超时(秒)
   * mock 不真实阻塞:优先返回第一个非空 key 的尾部元素,全部为空时返回 null
   * @returns [key, value] 或 null
   */
  async brpop(...args: (string | number)[]): Promise<[string, string] | null> {
    if (args.length < 2) return null;
    const keys = args.slice(0, -1).map(String);
    // const timeout = args[args.length - 1]; // 阻塞超时,mock 忽略
    for (const key of keys) {
      this.refresh(key);
      const list = this.lists.get(key);
      if (list && list.length > 0) {
        const value = list.pop() ?? null;
        if (value !== null) return [key, value];
      }
    }
    return null;
  }

  async ping(): Promise<string> {
    return 'PONG';
  }

  /**
   * pipeline:支持链式 set + exec(对应 ioredis pipeline)
   * 当前仅实现 set(缓存/限流/队列完成写入场景),返回链式对象
   */
  pipeline(): {
    set: (key: string, value: string, mode?: string, ttl?: number) => unknown;
    exec: () => Promise<Array<[Error | null, string | undefined]>>;
  } {
    const redis = this;
    const commands: Array<() => Promise<string>> = [];
    const pipelineObj = {
      set(key: string, value: string, mode?: string, ttl?: number): unknown {
        commands.push(() => redis.set(key, value, mode, ttl));
        return pipelineObj;
      },
      exec: async () => {
        const results: Array<[Error | null, string | undefined]> = [];
        for (const cmd of commands) {
          try {
            await cmd();
            results.push([null, 'OK']);
          } catch (err) {
            results.push([err as Error, undefined]);
          }
        }
        commands.length = 0;
        return results;
      },
    };
    return pipelineObj;
  }

  // ============================================================
  // 测试辅助方法(仅供测试调用,不对应 Redis 真实命令)
  // ============================================================

  /** 清空所有 key(每个测试 beforeEach 调用) */
  __clear(): void {
    this.store.clear();
    this.sortedSets.clear();
    this.lists.clear();
    this.scriptCache.clear();
  }

  /**
   * 直接读取 key 的原始 entry(含 TTL 信息),不做过期删除
   * 用于断言 state payload 内容与 TTL
   */
  __peek(key: string): RedisEntry | undefined {
    return this.store.get(key);
  }

  /** 返回当前所有 key(用于断言黑名单写入) */
  __keys(): string[] {
    return [
      ...Array.from(this.store.keys()),
      ...Array.from(this.sortedSets.keys()),
      ...Array.from(this.lists.keys()),
    ];
  }

  /**
   * 直接读取 List 的原始字符串载荷快照(M-4 队列引用模式断言用)
   * 用于断言入队 payload 序列化 JSON 不含图片字段/dataURL(不修改队列状态)
   */
  __peekList(key: string): string[] {
    return [...(this.lists.get(key) ?? [])];
  }

  /** 直接设置 key(带可选 TTL),用于预置测试数据 */
  __rawSet(key: string, value: string, ttlSeconds?: number): void {
    const expiresAt = ttlSeconds !== undefined ? Date.now() + ttlSeconds * 1000 : null;
    this.store.set(key, { value, expiresAt });
  }
}

/**
 * 全局 Redis Mock 单例
 * setup.ts 中 vi.mock 工厂返回的 redis() 即返回此实例
 * 测试文件可直接 import { redisMock, redisState } 进行控制与断言
 */
export const redisMock: RedisMock = new RedisMock();

/**
 * 兼容别名:部分测试通过 redisState 访问
 */
export const redisState: RedisMock = redisMock;

/**
 * 创建匹配 src/config/redis.ts 导出的模块对象
 * setup.ts 的 vi.mock 工厂调用此函数
 */
export function createRedisModule(): {
  initRedis: () => RedisMock;
  redis: () => RedisMock;
  closeRedis: () => Promise<void>;
} {
  return {
    initRedis: () => redisMock,
    redis: () => redisMock,
    closeRedis: async () => {
      redisMock.__clear();
    },
  };
}
