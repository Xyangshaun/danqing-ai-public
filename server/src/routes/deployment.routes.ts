// ============================================================
// 部署日志路由(任务包 C:部署日志同步机制)
// 对应 API(统一前缀 /api/v1/deployments):
//   POST /log      接收部署完成/失败详情(写)
//   GET  /latest   查询最新部署状态(下游任务只读)
//
// 鉴权说明:
//   - 部署脚本在服务器本地运行,无法获取 JWT,故采用预共享密钥鉴权
//   - 客户端必须在请求头携带 X-Deploy-Secret,与 env.DEPLOY_SYNC_SECRET 一致
//   - 服务器未配置 DEPLOY_SYNC_SECRET 时,端点返回 503(同步功能未启用)
//   - 使用 crypto.timingSafeEqual 做常量时间比较,防止时序侧信道
//
// 中间件链路:
//   deploymentSecretMiddleware → validate(Zod) → controller
// ============================================================

import { Router, type RequestHandler } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';
import { error } from '../utils/response.js';
import { ErrorCode } from '../types/api-contract.js';
import { createDeploymentLog, getLatestDeployment } from '../controllers/deployment.controller.js';

export const deploymentRouter: Router = Router();

/**
 * 共享密钥鉴权中间件
 * - 未配置密钥 → 503(同步功能未启用)
 * - X-Deploy-Secret 缺失或不匹配 → 401
 * - 使用 timingSafeEqual 常量时间比较
 */
const deploymentSecretMiddleware: RequestHandler = (req, res, next) => {
  const secret = env().deploySyncSecret;
  if (!secret) {
    return error(res, ErrorCode.UPSTREAM_UNAVAILABLE, '部署日志同步未启用(未配置 DEPLOY_SYNC_SECRET)', 503);
  }
  const provided = req.headers['x-deploy-secret'];
  if (typeof provided !== 'string' || provided.length === 0) {
    return error(res, ErrorCode.UNAUTHORIZED, '缺少 X-Deploy-Secret 请求头', 401);
  }
  // 常量时间比较:先等长化再比较,避免长度/内容差异导致的时序侧信道
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  const equal = a.length === b.length && timingSafeEqual(a, b);
  if (!equal) {
    return error(res, ErrorCode.UNAUTHORIZED, 'X-Deploy-Secret 无效', 401);
  }
  return next();
};

// ---------- 全局中间件(所有部署端点均需共享密钥鉴权)----------
deploymentRouter.use(deploymentSecretMiddleware);

// POST /deployments/log - 记录部署结果(成功/失败)
deploymentRouter.post('/log', createDeploymentLog);

// GET /deployments/latest - 查询最新部署状态(供下游任务)
deploymentRouter.get('/latest', getLatestDeployment);