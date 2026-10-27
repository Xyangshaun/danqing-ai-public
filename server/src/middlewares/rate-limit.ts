// ============================================================
// 限流中间件(基于 Redis Sorted Set + Lua 滑动窗口,原子计数)
// 对应文档:auth-design.md §3.3 Rate Limiting
// - /auth/feishu/authorize: 10 次/分钟/IP
// - /auth/feishu/callback: 5 次/分钟/IP
// - /auth/refresh: 20 次/分钟/IP
// - 其他 /api/*: 60 次/分钟/用户
// 命中后返回 429 + ErrorCode.RATE_LIMITED(9005)
//
// 实现要点(G3 安全修复):
//   - 滑动窗口:记录每个请求的到达时间戳(score),窗口外请求被 ZREMRANGEBYSCORE 清除
//   - 原子性:ZADD + ZREMRANGEBYSCORE + ZCARD + EXPIRE 通过 Lua 脚本单次 RTT 原子执行
//     避免并发下 incr+expire 拆分导致的计数偏差
//   - 容错:EVALSHA 命中 NOSCRIPT 时自动降级为 EVAL(对齐 ioredis 标准模式)
// ============================================================

import crypto from 'node:crypto';
import type { RequestHandler } from 'express';
import { ErrorCode } from '../types/api-contract.js';
import { error } from '../utils/response.js';
import { redis } from '../config/redis.js';
import { logger } from '../utils/logger.js';
import { env } from '../config/env.js';
import { getClientIp } from '../utils/ip.js';
import { redisMetrics } from '../services/redis-metrics.service.js';

/** 滑动窗口大小(毫秒),对应每分钟限流 */
const RATE_LIMIT_WINDOW_MS = 60_000;
/** 有序集 TTL(秒),保证 key 自动回收 */
const RATE_LIMIT_TTL_SEC = 60;

/**
 * 滑动窗口限流 Lua 脚本(原子)
 * KEYS[1] = 限流 key
 * ARGV[1]  = 当前时间戳(ms,作为 score)
 * ARGV[2]  = 唯一请求标识(作为 member,避免同毫秒请求被去重)
 * ARGV[3]  = 窗口大小(ms)
 * ARGV[4]  = TTL(秒)
 * 返回:当前窗口内请求数(ZCARD)
 */
const RATE_LIMIT_SCRIPT = `
local now = tonumber(ARGV[1])
local member = ARGV[2]
local windowMs = tonumber(ARGV[3])
local ttlSec = tonumber(ARGV[4])
redis.call('ZADD', KEYS[1], now, member)
redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, now - windowMs)
local current = redis.call('ZCARD', KEYS[1])
redis.call('EXPIRE', KEYS[1], ttlSec)
return current
`;

/** 脚本 sha1(惰性计算,EVALSHA 命中后复用) */
let cachedScriptSha: string | null = null;

function getScriptSha(): string {
  if (cachedScriptSha === null) {
    cachedScriptSha = crypto.createHash('sha1').update(RATE_LIMIT_SCRIPT).digest('hex');
  }
  return cachedScriptSha;
}

function isNoScriptError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  // ioredis 在 Redis 返回 NOSCRIPT 时抛出 code=NOSCRIPT 的错误
  const code = (err as { code?: string }).code;
  return code === 'NOSCRIPT' || /NOSCRIPT/i.test(err.message);
}

/**
 * 执行滑动窗口限流脚本,返回当前窗口内请求数
 * EVALSHA 优先,NOSCRIPT 时降级为 EVAL(脚本加载到 Redis 后续可复用)
 * 导出供 client-adapt.ts 的 clientRateLimiter 复用,保证原子语义一致
 *
 * 容错策略:
 *   - Redis 操作加硬超时(env.RATE_LIMIT_REDIS_TIMEOUT_MS,默认 200ms),超时返回 -1(fail open)
 *   - 避免因 Redis 重连/重试(maxRetriesPerRequest)累积导致请求阻塞 3-5 秒
 */
export async function checkSlidingWindowRateLimit(key: string): Promise<number> {
  const now = Date.now();
  const member = crypto.randomUUID();
  const args = [String(now), member, String(RATE_LIMIT_WINDOW_MS), String(RATE_LIMIT_TTL_SEC)];
  const timeoutMs = env().rateLimitRedisTimeoutMs;

  const exec = async (): Promise<number> => {
    const tStart = performance.now();
    try {
      const result = await redis().evalsha(getScriptSha(), 1, key, ...args);
      redisMetrics.recordCommand('evalsha', performance.now() - tStart);
      return Number(result);
    } catch (err) {
      if (!isNoScriptError(err)) {
        throw err;
      }
      // 脚本尚未在 Redis 缓存,降级 EVAL(会同时缓存,后续 EVALSHA 可用)
      const result = await redis().eval(RATE_LIMIT_SCRIPT, 1, key, ...args);
      redisMetrics.recordCommand('eval', performance.now() - tStart);
      return Number(result);
    }
  };

  // 硬超时保护:Redis 操作超时视为不可用,返回 -1 触发 fail open
  const timeout = new Promise<number>((resolve) => {
    setTimeout(() => resolve(-1), timeoutMs);
  });

  const result = await Promise.race([exec(), timeout]);
  if (result === -1) {
    redisMetrics.recordRateLimitTimeout();
  }
  return result;
}

/**
 * 创建基于 Redis 的限流中间件
 * @param maxPerMin 每分钟最大请求数
 * @param scope 限流维度,如 'auth' / 'callback' / 'refresh' / 'api'
 */
export function createRateLimiter(maxPerMin: number, scope: string): RequestHandler {
  return async (req, res, next) => {
    const ip = getClientIp(req);
    // 限流 key 形如 rl:auth:1.2.3.4(滑动窗口由 ZREMRANGEBYSCORE 自动滚动)
    const key = `rl:${scope}:${ip}`;

    try {
      const count = await checkSlidingWindowRateLimit(key);
      // count === -1 表示 Redis 超时,fail open 放行(可用性优先于限流精度)
      if (count === -1) {
        redisMetrics.recordRateLimitFailOpen();
        logger.warn({ scope, ip, traceId: req.traceId }, '[rate-limit] redis timeout, fail open');
        return next();
      }
      if (count > maxPerMin) {
        redisMetrics.recordRateLimitHit();
        logger.warn({ ip, scope, count, max: maxPerMin, traceId: req.traceId }, '[rate-limit] hit');
        res.setHeader('Retry-After', '60');
        return error(res, ErrorCode.RATE_LIMITED, '请求过于频繁,请稍后再试', 429);
      }
      next();
    } catch (err) {
      // Redis 真正不可达(非超时):fail open 并告警,避免单点故障拖垮所有 API
      redisMetrics.recordRateLimitFailOpen();
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err: msg, scope, ip }, '[rate-limit] redis error, fail open');
      return next();
    }
  };
}

/**
 * 预设限流器工厂函数(按 auth-design.md §3.3 配置)
 *
 * 关键修复(Gx):惰性求值 — 模块加载时仅创建包装函数,首次请求时才读取 env(),
 * 避免 auth.routes.ts 顶层调用 authRateLimiter() 时 env() 尚未初始化的问题。
 * 缓存中间件实例,后续请求直接复用,无性能损失。
 */
function lazyRateLimiter(
  getLimit: () => number,
  scope: string,
): RequestHandler {
  let handler: RequestHandler | null = null;
  return (req, res, next) => {
    if (!handler) {
      handler = createRateLimiter(getLimit(), scope);
    }
    return handler(req, res, next);
  };
}

export const authRateLimiter = (): RequestHandler =>
  lazyRateLimiter(() => env().rateLimitAuthPerMin, 'auth');

export const callbackRateLimiter = (): RequestHandler =>
  lazyRateLimiter(() => env().rateLimitCallbackPerMin, 'callback');

export const refreshRateLimiter = (): RequestHandler =>
  lazyRateLimiter(() => env().rateLimitRefreshPerMin, 'refresh');

export const apiRateLimiter = (): RequestHandler =>
  lazyRateLimiter(() => env().rateLimitApiPerMin, 'api');

/**
 * 举报接口限流:5 次/分钟(公安备案合规,防刷举报)
 * 维度沿用项目限流惯例(按客户端 IP;登录后同 IP 多用户共享阈值,
 * 恶意刷量场景由业务层 24h 去重二次兜底)
 * 阈值为常量而非 env 配置项:举报属合规固有限额,避免环境误配放开
 */
const REPORT_RATE_LIMIT_PER_MIN = 5;

export const reportRateLimiter = (): RequestHandler =>
  lazyRateLimiter(() => REPORT_RATE_LIMIT_PER_MIN, 'report');

/**
 * 标注反馈接口限流:30 次/分钟(反馈闭环 Phase 4 批次②/数据飞轮)
 * 单分析常有 6-10 个 marker,用户浏览时切换 👍/👎 会连续触发多次请求,
 * 举报级 5/min 会误伤正常使用;30/min 兼顾防刷与体验(upsert 幂等,重复提交不产生脏数据)
 * 阈值为常量而非 env 配置项:采集属合规固有限额,避免环境误配放开
 */
const MARKER_FEEDBACK_RATE_LIMIT_PER_MIN = 30;

export const markerFeedbackRateLimiter = (): RequestHandler =>
  lazyRateLimiter(() => MARKER_FEEDBACK_RATE_LIMIT_PER_MIN, 'marker-feedback');
