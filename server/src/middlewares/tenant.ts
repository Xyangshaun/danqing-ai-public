// ============================================================
// 多租户中间件
// 对应文档:data-model-v1.md §7.3 + auth-design.md §2.4
// 从 JWT payload(经 authMiddleware 注入到 req.tenantId)提取 tenant_id
// 后续 Repository 从 req.tenantId 取值,禁止从请求体/查询参数读取 tenant_id
// ============================================================

import type { RequestHandler } from 'express';
import { ErrorCode } from '../types/api-contract.js';
import { error } from '../utils/response.js';
import { logger } from '../utils/logger.js';

/**
 * 多租户校验中间件
 * 必须在 authMiddleware 之后注册
 * 校验:req.tenantId 存在(auth 中间件已注入)
 */
export const tenantMiddleware: RequestHandler = (req, res, next) => {
  if (!req.tenantId) {
    logger.warn({ userId: req.userId, url: req.url }, '[tenant] missing tenant_id in JWT');
    return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
  }
  next();
};
