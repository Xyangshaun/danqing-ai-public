// ============================================================
// 开发者视图 Controller(平台级诊断只读端点)
// 对应 API:
//   GET /api/admin/dev/accounts      账号清单(含在线状态 / 测试账号标记)
//   GET /api/admin/dev/deployments   部署历史(按时间倒序)
//
// 职责:
//   1. Zod 校验 query 参数(失败抛 ZodError → errorHandler 转参数错误)
//   2. 调用 adminDevService 获取聚合数据
//   3. 返回统一成功响应(success 包装)
//
// 权限:
//   - /dev/accounts    → admin:user:read(与用户列表同款)
//   - /dev/deployments → admin:stats:read(与数据看板同款)
// 错误处理:统一交给 error-handler 中间件
// ============================================================

import type { RequestHandler } from 'express';
import { z } from 'zod';
import { success } from '../utils/response.js';
import { adminDevService } from '../services/admin-dev.service.js';

/**
 * GET /dev/deployments 查询参数 Zod 校验
 * - limit 可选,默认 20,范围 1-100(字符串数字自动转换)
 */
const listDeploymentsQuerySchema = z.object({
  limit: z.coerce.number().int('limit 必须为整数').min(1, 'limit 最小为 1').max(100, 'limit 最大为 100').default(20),
});

/**
 * GET /api/admin/dev/accounts - 账号清单(开发者视图)
 * 平台级跨租户只读查询:全部用户 + 租户名称 + 会话在线状态
 */
export const listDevAccounts: RequestHandler = async (_req, res, next) => {
  try {
    const data = await adminDevService.getDevAccounts();
    return success(res, data, 'success');
  } catch (err) {
    return next(err);
  }
};

/**
 * GET /api/admin/dev/deployments - 部署历史(开发者视图)
 * 查 deployment_logs 系统级日志,按 timestamp 倒序
 */
export const listDevDeployments: RequestHandler = async (req, res, next) => {
  try {
    // Zod 校验 query(失败抛 ZodError → errorHandler 转 1001 PARAM_INVALID)
    const parsed = listDeploymentsQuerySchema.parse(req.query);
    const data = await adminDevService.getDevDeployments(parsed.limit);
    return success(res, data, 'success');
  } catch (err) {
    return next(err);
  }
};
