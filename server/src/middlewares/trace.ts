// ============================================================
// trace 中间件:traceId 生成与注入
// 对应文档:api-contract-v1.md §1.4 X-Trace-Id 头
// 优先回显客户端传入的 X-Trace-Id;未传则后端生成 UUID v4
// ============================================================

import type { RequestHandler } from 'express';
import { generateUuid } from '../utils/crypto.js';
import { logger } from '../utils/logger.js';

/**
 * trace 中间件
 * 必须在所有路由前注册
 */
export const traceMiddleware: RequestHandler = (req, _res, next) => {
  const incoming = req.header('X-Trace-Id');
  // 简单校验:UUID v4 格式(避免恶意超长 header)
  if (incoming && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(incoming)) {
    req.traceId = incoming;
  } else {
    req.traceId = generateUuid();
  }
  // 注入 X-Trace-Id 响应头,客户端可用于关联日志
  _res.setHeader('X-Trace-Id', req.traceId);
  logger.debug({ traceId: req.traceId, method: req.method, url: req.url }, '[trace] request');
  next();
};
