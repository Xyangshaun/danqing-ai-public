// ============================================================
// 部署日志 Controller(任务包 C:部署日志同步机制)
// 对应 API:
//   POST /deployments/log   接收部署完成/失败详情(写)
//   GET  /deployments/latest 查询最新部署状态(下游任务只读)
//
// 职责:
//   1. 用 Zod 校验所有外部输入(body / query),失败抛 ZodError → errorHandler 转 PARAM_INVALID
//   2. 调用 deploymentService 落库 / 查询
//   3. 通过 success() 统一封装响应(禁止裸 res.json)
//
// 安全约束:
//   - 端点鉴权由路由层 deploymentSecretMiddleware 校验 X-Deploy-Secret 共享密钥完成
//     (部署脚本无法获取 JWT,故采用预共享密钥;密钥未配置时端点返回 503)
//   - 落库失败(数据库不可用)时返回 500 + 明确"同步失败"指示,便于部署脚本感知
//   - 错误统一走 errorHandler,不暴露内部堆栈
// ============================================================

import type { RequestHandler } from 'express';
import { z } from 'zod';
import { deploymentService } from '../services/deployment.service.js';
import { success, error } from '../utils/response.js';
import { ErrorCode } from '../types/api-contract.js';
import { getClientIp } from '../utils/ip.js';

/** 部署状态枚举(与 api-contract DeploymentStatus 对齐) */
const deploymentStatusSchema = z.enum(['success', 'failed']).describe('部署状态:success/failed');

/**
 * POST /deployments/log 请求体 Zod 校验
 * - version / serverId / status 必填
 * - timestamp 可选,须为合法 ISO 8601(否则字段非法)
 * - details 可选,任意 JSON 对象
 */
const createLogBodySchema = z.object({
  timestamp: z
    .string()
    .datetime({ offset: true, message: 'timestamp 必须为合法 ISO 8601' })
    .optional(),
  version: z.string().min(1, 'version 不能为空').max(64, 'version 过长(≤64)'),
  serverId: z.string().min(1, 'serverId 不能为空').max(64, 'serverId 过长(≤64)'),
  status: deploymentStatusSchema,
  deployer: z.string().min(1).max(64).optional(),
  branch: z.string().min(1).max(64).optional(),
  commitSha: z.string().min(1).max(64).optional(),
  details: z.record(z.string(), z.unknown()).optional(),
  errorMessage: z.string().max(2000).optional(),
});

/**
 * GET /deployments/latest 查询参数 Zod 校验
 * - serverId 可选,按服务器过滤
 */
const latestQuerySchema = z.object({
  serverId: z.string().min(1).max(64).optional(),
});

/**
 * POST /deployments/log - 记录一次部署结果
 */
export const createDeploymentLog: RequestHandler = async (req, res, next) => {
  try {
    // Zod 校验 body(失败抛 ZodError → errorHandler 转 1001 PARAM_INVALID)
    const parsed = createLogBodySchema.parse(req.body);
    const sourceIp = getClientIp(req);
    const entry = await deploymentService.recordDeployment(parsed, sourceIp);
    return success(res, {
      id: entry.id,
      received: true,
      synced: true,
    }, '部署日志已同步');
  } catch (err) {
    return next(err);
  }
};

/**
 * GET /deployments/latest - 查询最新部署状态(供下游任务)
 * 无记录时返回 404 + 明确指示,避免下游误判
 */
export const getLatestDeployment: RequestHandler = async (req, res, next) => {
  try {
    const parsed = latestQuerySchema.parse(req.query);
    const latest = await deploymentService.getLatestDeployment(parsed.serverId);
    if (!latest) {
      return error(res, ErrorCode.RESOURCE_NOT_FOUND, '暂无部署记录', 404);
    }
    return success(res, latest, 'success');
  } catch (err) {
    return next(err);
  }
};