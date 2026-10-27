// ============================================================
// 幂等中间件(M-1 DOC-2026-08-014)
// 高危写接口支持 Idempotency-Key 请求头做幂等去重
// (防重复扣款/重复删除/重复退款等)
//
// 行为:
//   - 无 Idempotency-Key 头 → 透传(不影响普通请求)
//   - 有 Idempotency-Key:
//       - 首次请求:写入 Redis pending 标记,处理完成后缓存响应(TTL)
//       - 并发重复:返回 409 ADMIN_RESOURCE_CONFLICT(处理中)
//       - 同 key+同 body 重放:回放缓存的原始响应(幂等)
//       - 同 key+不同 body:返回 409(幂等键冲突)
//       - 5xx 响应不缓存(可重试)
//
// 安全/健壮性:
//   - key 按 "userId:key" 隔离,防跨用户复用
//   - Redis 不可用/未初始化 → 降级为透传,不阻塞主流程
//   - 不记录请求/响应体到日志(避免敏感信息)
// ============================================================

import type { RequestHandler } from 'express';
import { createHash } from 'node:crypto';
import { redis } from '../config/redis.js';
import { error } from '../utils/response.js';
import { ErrorCode } from '../types/api-contract.js';
import { logger } from '../utils/logger.js';

/** 默认幂等 TTL(秒):1 小时 */
const DEFAULT_TTL_SECONDS = 3600;

/**
 * 幂等中间件工厂
 * @param ttlSeconds 幂等键缓存时长(默认 3600 秒)
 */
export function idempotencyMiddleware(ttlSeconds = DEFAULT_TTL_SECONDS): RequestHandler {
  return async (req, res, next) => {
    const rawKey = req.headers['idempotency-key'];
    // 无幂等头 → 透传
    if (!rawKey || Array.isArray(rawKey) || rawKey === '') {
      return next();
    }

    const userId = req.userId ?? 'anonymous';
    const redisKey = `idempotency:${userId}:${rawKey}`;
    // 请求体哈希(用于校验同 key 是否同一请求;空体哈希一致)
    const bodyHash = createHash('sha256')
      .update(JSON.stringify(req.body ?? {}))
      .digest('hex');

    let r;
    try {
      r = redis();
    } catch {
      // Redis 未初始化:降级透传,不阻塞主流程
      return next();
    }

    try {
      const existing = await r.get(redisKey);
      if (existing) {
        const cached = JSON.parse(existing) as {
          bodyHash: string;
          completed: boolean;
          status?: number;
          body?: unknown;
        };
        // 同 key 用于不同请求内容 → 幂等键冲突
        if (cached.bodyHash !== bodyHash) {
          return error(
            res,
            ErrorCode.ADMIN_RESOURCE_CONFLICT,
            '幂等键冲突:同一 Idempotency-Key 用于不同请求内容',
            409,
          );
        }
        // 已完成的请求:回放缓存的原始响应
        if (cached.completed && cached.status && cached.body !== undefined) {
          res.status(cached.status).set('Content-Type', 'application/json').send(cached.body);
          return;
        }
        // 仍在处理中(并发重复提交)
        return error(res, ErrorCode.ADMIN_RESOURCE_CONFLICT, '请求正在处理中,请勿重复提交', 409);
      }

      // 写入 pending 标记(SETNX 防并发竞态)
      const setResult = await r.set(
        redisKey,
        JSON.stringify({ bodyHash, completed: false }),
        'EX',
        ttlSeconds,
        'NX',
      );
      if (setResult !== 'OK') {
        // 并发竞争:另一请求已占用该 key
        return error(res, ErrorCode.ADMIN_RESOURCE_CONFLICT, '请求正在处理中,请勿重复提交', 409);
      }

      // 捕获响应体(res.json)以便完成后缓存
      const originalJson = res.json.bind(res) as unknown as (body: unknown) => Response;
      res.json = ((body: unknown) => {
        res.locals.idempotencyBody = body;
        return originalJson(body);
      }) as unknown as typeof res.json;

      // 处理完成后缓存响应(仅缓存 <500 状态,5xx 允许重试)
      res.on('finish', () => {
        if (res.statusCode < 500 && res.locals.idempotencyBody !== undefined) {
          r.set(
            redisKey,
            JSON.stringify({
              bodyHash,
              completed: true,
              status: res.statusCode,
              body: res.locals.idempotencyBody,
            }),
            'EX',
            ttlSeconds,
          ).catch(() => {
            // 缓存写入失败不影响主流程(仅记录,不抛)
          });
        }
      });

      return next();
    } catch (err) {
      // Redis 操作失败 → 降级透传,不阻塞主流程
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ err: msg, key: rawKey }, '[idempotency] redis operation failed, fallback to passthrough');
      return next();
    }
  };
}