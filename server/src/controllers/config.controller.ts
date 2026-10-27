// ============================================================
// 功能参数与流程控制 Controller(Phase 5 预留接口)
//
// 对应 API:
//   GET    /config/features                       功能开关列表(feature flags)
//   PATCH  /config/features/:featureId            更新功能开关(管理员)
//   GET    /config/params                         系统参数列表
//   PATCH  /config/params/:paramKey               更新系统参数
//   GET    /config/workflows                      工作流定义列表
//   POST   /config/workflows                      创建工作流
//   PATCH  /config/workflows/:id                  更新工作流
//   GET    /config/workflows/:id/executions       工作流执行历史
//   POST   /config/workflows/:id/execute          执行工作流
//
// 当前状态:预留实现,统一返回 501 Not Implemented
// 未来方向:支持 feature flag 灰度发布、系统参数热更新、工作流编排
//
// 预留接口规范:
//   - 路由已挂载,鉴权 + 权限校验完整
//   - 类型定义见 api-contract.ts §3.11.4
//   - v2.0 将实现完整业务逻辑
// ============================================================

import type { RequestHandler } from 'express';
import { z } from 'zod';
import { error, success } from '../utils/response.js';
import { ErrorCode } from '../types/api-contract.js';
import { configFeatureService } from '../services/config-feature.service.js';

/**
 * 预留接口统一响应:返回 501 Not Implemented
 * (系统参数/工作流子模块仍为预留,功能开关子模块已激活,M2-T6)
 */
const notImplemented: RequestHandler = (_req, res) => {
  return error(
    res,
    ErrorCode.NOT_IMPLEMENTED,
    '该接口为预留接口,尚未实现。请参考API文档了解未来扩展方向。',
    501,
  );
};

/**
 * GET /config/features 查询参数 schema(对齐契约 ListFeatureFlagsQuery)
 *   - status:按状态筛选
 *   - q:关键词搜索
 */
const listFeatureFlagsQuerySchema = z.object({
  status: z.enum(['enabled', 'disabled', 'gradual']).optional(),
  q: z.string().trim().max(100).optional(),
});

/**
 * PATCH /config/features/:featureId 路径参数 schema
 */
const featureIdParamSchema = z.object({
  featureId: z.string().trim().min(1, '缺少必填参数:featureId'),
});

/**
 * PATCH /config/features/:featureId 请求体 schema(对齐契约 UpdateFeatureFlagRequest)
 *   - status:enabled/disabled/gradual
 *   - value:boolean / number(0-100) / string[](租户列表)
 *   - targetUserIds / targetTenantIds:灰度目标列表
 */
const updateFeatureFlagBodySchema = z
  .object({
    status: z.enum(['enabled', 'disabled', 'gradual']).optional(),
    value: z.union([z.boolean(), z.number().int().min(0).max(100), z.array(z.string())]).optional(),
    targetUserIds: z.array(z.string()).optional(),
    targetTenantIds: z.array(z.string()).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: '至少需提供一项更新字段' });

/**
 * GET /config/features
 * 功能开关列表(feature flags)
 * - 权限:config:features:read(所有角色)
 * - 复用现有 config feature 机制(configFeatureService,内存默认 + Redis 覆盖)
 */
export const listFeatureFlags: RequestHandler = async (req, res, next) => {
  try {
    const parsed = listFeatureFlagsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const msg = `参数错误:${first?.path.join('.') ?? 'unknown'} ${first?.message ?? 'invalid'}`;
      return error(res, ErrorCode.PARAM_INVALID, msg, 400);
    }
    const features = await configFeatureService.listFeatures({
      status: parsed.data.status,
      q: parsed.data.q,
    });
    return success(res, features, 'success');
  } catch (err) {
    return next(err);
  }
};

/**
 * PATCH /config/features/:featureId
 * 更新功能开关
 * - 权限:config:features:write(仅 ADMIN/OWNER)
 * - 复用现有 config feature 机制,更新后立即生效(灰度发布)
 */
export const updateFeatureFlag: RequestHandler = async (req, res, next) => {
  try {
    const paramParsed = featureIdParamSchema.safeParse(req.params);
    if (!paramParsed.success) {
      const first = paramParsed.error.issues[0];
      const msg = `参数错误:${first?.path.join('.') ?? 'unknown'} ${first?.message ?? 'invalid'}`;
      return error(res, ErrorCode.PARAM_INVALID, msg, 400);
    }

    const bodyParsed = updateFeatureFlagBodySchema.safeParse(req.body);
    if (!bodyParsed.success) {
      const first = bodyParsed.error.issues[0];
      const msg = `参数错误:${first?.path.join('.') ?? 'unknown'} ${first?.message ?? 'invalid'}`;
      return error(res, ErrorCode.PARAM_INVALID, msg, 400);
    }

    const feature = await configFeatureService.updateFeature(
      paramParsed.data.featureId,
      bodyParsed.data,
      req.userId ?? 'system',
    );
    return success(res, feature, '功能开关已更新');
  } catch (err) {
    return next(err);
  }
};

/**
 * GET /config/params
 * 系统参数列表
 * - 权限:config:features:read(所有角色)
 * - 敏感参数默认不返回(需 includeSensitive=true 且管理员权限)
 */
export const listSystemParams: RequestHandler = notImplemented;

/**
 * PATCH /config/params/:paramKey
 * 更新系统参数
 * - 权限:config:features:write(仅 ADMIN/OWNER)
 * - 部分参数需重启生效(requireRestart=true)
 */
export const updateSystemParam: RequestHandler = notImplemented;

/**
 * GET /config/workflows
 * 工作流定义列表
 * - 权限:config:workflows:manage(仅 ADMIN/OWNER)
 */
export const listWorkflows: RequestHandler = notImplemented;

/**
 * POST /config/workflows
 * 创建工作流
 * - 权限:config:workflows:manage(仅 ADMIN/OWNER)
 */
export const createWorkflow: RequestHandler = notImplemented;

/**
 * PATCH /config/workflows/:id
 * 更新工作流
 * - 权限:config:workflows:manage(仅 ADMIN/OWNER)
 */
export const updateWorkflow: RequestHandler = notImplemented;

/**
 * GET /config/workflows/:id/executions
 * 工作流执行历史
 * - 权限:config:workflows:manage(仅 ADMIN/OWNER)
 * - 路由顺序:必须在 /:id/execute 之前注册,避免 'executions' 被误匹配
 */
export const listWorkflowExecutions: RequestHandler = notImplemented;

/**
 * POST /config/workflows/:id/execute
 * 执行工作流
 * - 权限:config:workflows:manage(仅 ADMIN/OWNER)
 * - 同步模式(短任务)直接返回结果,异步模式(长任务)返回 executionId
 * - 3 秒 SLA:超过 2.5s 自动切换为异步
 */
export const executeWorkflow: RequestHandler = notImplemented;
