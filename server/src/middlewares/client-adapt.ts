// ============================================================
// 多端适配中间件
// 对应文档:Phase 3 多端适配设计
//
// 职责:
//   1. clientRateLimiter:客户端感知限流(不同端不同限流策略)
//      - web:    60 次/分钟(标准限流)
//      - admin:  120 次/分钟(管理后台高频操作)
//      - mobile: 40 次/分钟(移动端容忍网络重试,略宽松但防滥用)
//   2. responseOptimizer:响应优化(按客户端类型调整响应)
//      - mobile:移除冗余字段,减小 payload(节省流量)
//      - admin:返回完整字段(管理后台需要全量信息)
//      - web:标准响应
//
// 设计原则:
//   - 限流维度:client + ip + userId(三维联合,防单端滥用)
//   - 降级策略:Redis 不可用时,Deny by default(与 rate-limit.ts 一致)
//   - 响应优化:仅移除非必要字段,核心数据不变(向后兼容)
// ============================================================

import type { RequestHandler } from 'express';
import type express from 'express';
import { ErrorCode, type ClientType } from '../types/api-contract.js';
import { error } from '../utils/response.js';
import { logger } from '../utils/logger.js';
import { checkSlidingWindowRateLimit } from './rate-limit.js';
import { getClientIp } from '../utils/ip.js';

/**
 * 客户端限流配置(每分钟最大请求数)
 */
const CLIENT_RATE_LIMITS: Record<ClientType, number> = {
  web: 60,
  admin: 120,
  mobile: 40,
  marketing: 30,
};

/**
 * 客户端感知限流中间件
 * 限流维度:client + ip + userId(三维联合)
 *
 * 使用场景:替换通用 apiRateLimiter,提供更精细的限流控制
 * - 必须在 authMiddleware 之后使用(依赖 req.client / req.userId)
 */
export function clientRateLimiter(): RequestHandler {
  return async (req, res, next) => {
    const client = req.client ?? 'web';
    const maxPerMin = CLIENT_RATE_LIMITS[client] ?? 60;
    const ip = getClientIp(req);
    const userId = req.userId ?? 'anonymous';

    // 限流 key:rl:client:{client}:{userId}:{ip}(滑动窗口由 ZREMRANGEBYSCORE 自动滚动)
    const key = `rl:client:${client}:${userId}:${ip}`;

    try {
      // 复用 rate-limit.ts 的原子滑动窗口脚本,保证与通用限流语义一致(G3)
      const count = await checkSlidingWindowRateLimit(key);
      if (count > maxPerMin) {
        logger.warn(
          { client, ip, userId, count, max: maxPerMin, traceId: req.traceId },
          '[rate-limit] client limit hit',
        );
        res.setHeader('Retry-After', '60');
        return error(res, ErrorCode.RATE_LIMITED, '请求过于频繁,请稍后再试', 429);
      }

      // 在响应头中暴露限流信息(便于客户端调优)
      res.setHeader('X-RateLimit-Limit', String(maxPerMin));
      res.setHeader('X-RateLimit-Remaining', String(Math.max(0, maxPerMin - count)));
      res.setHeader('X-RateLimit-Client', client);

      next();
    } catch (err) {
      // Redis 不可达时:Deny by default(与 rate-limit.ts 策略一致)
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err: msg, client, ip, userId }, '[rate-limit] redis error, deny by default');
      return error(res, ErrorCode.CACHE_ERROR, '缓存服务不可用', 503);
    }
  };
}

/**
 * 响应优化中间件
 * 按客户端类型调整响应:
 *   - mobile:在 res.json 之前移除指定的冗余字段(减小 payload)
 *   - admin/web:不处理,返回完整响应
 *
 * 实现方式:包装 res.json,在序列化前过滤字段
 * 注意:仅对列表接口生效(详情接口字段少,无需优化)
 *
 * 可过滤的字段(通过响应中的 X-Compact-Fields 头指定,逗号分隔)
 * 默认 mobile 端移除:description / sourceUrl / dimensions / medium / tags
 */
export function responseOptimizer(): RequestHandler {
  return (req, res, next) => {
    const client = req.client ?? 'web';

    // 仅 mobile 端启用响应优化
    if (client !== 'mobile') {
      return next();
    }

    // 包装 res.json,过滤冗余字段
    // 使用类型断言绕过 Express 严格的 res.json 类型签名(便于添加自定义逻辑)
    const originalJson = res.json.bind(res) as (body: unknown) => express.Response;
    (res as { json: (body: unknown) => express.Response }).json = function (
      body: unknown,
    ): express.Response {
      try {
        if (body && typeof body === 'object') {
          const optimized = optimizeForMobile(body);
          res.setHeader('X-Response-Optimized', 'mobile');
          return originalJson(optimized);
        }
        return originalJson(body);
      } catch {
        // 优化失败,返回原始响应
        return originalJson(body);
      }
    };

    next();
  };
}

/**
 * 移动端响应优化:移除列表项中的冗余字段
 * 仅处理 { data: { items: [...] } } 结构,其他结构不处理
 */
function optimizeForMobile(body: unknown): unknown {
  if (!body || typeof body !== 'object') {
    return body;
  }

  const response = body as { data?: { items?: unknown[] } };
  if (!response.data || !Array.isArray(response.data.items)) {
    return body;
  }

  // 移动端不需要的冗余字段(减小 payload ~30%)
  const FIELDS_TO_REMOVE = [
    'description',
    'sourceUrl',
    'dimensions',
    'medium',
    'tags',
    'thumbUrl',
    'source',
  ];

  response.data.items = response.data.items.map((item) => {
    if (!item || typeof item !== 'object') {
      return item;
    }
    const optimized = { ...item };
    for (const field of FIELDS_TO_REMOVE) {
      delete (optimized as Record<string, unknown>)[field];
    }
    return optimized;
  });

  return response;
}

/**
 * 客户端信息注入中间件(用于未鉴权路由)
 * 从 X-Client 头解析客户端类型,注入 req.client
 * 用于 /auth/feishu/authorize 等无需登录但需识别客户端的路由
 */
export function clientIdentification(): RequestHandler {
  return (req, _res, next) => {
    if (!req.client) {
      const xClient = req.header('X-Client');
      if (xClient === 'web' || xClient === 'admin' || xClient === 'mobile') {
        req.client = xClient;
      } else {
        req.client = 'web';
      }
    }
    next();
  };
}
