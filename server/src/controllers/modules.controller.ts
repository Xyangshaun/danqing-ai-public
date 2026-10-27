// ============================================================
// 模块化功能扩展 Controller(Phase 5 预留接口)
//
// 对应 API:
//   GET    /modules                          已安装模块列表
//   POST   /modules/:moduleId/install        安装模块(管理员)
//   DELETE /modules/:moduleId                卸载模块(管理员)
//   GET    /modules/:moduleId/config         模块配置
//   PATCH  /modules/:moduleId/config         更新模块配置
//   POST   /modules/:moduleId/enable         启用模块
//   POST   /modules/:moduleId/disable        禁用模块
//   GET    /modules/registry                 可用模块注册表(市场)
//
// 当前状态:预留实现,统一返回 501 Not Implemented
// 未来方向:支持插件式模块加载,允许第三方扩展功能
//
// 预留接口规范:
//   - 路由已挂载,鉴权 + 权限校验完整
//   - 类型定义见 api-contract.ts §3.11.2
//   - v2.0 将实现完整业务逻辑
// ============================================================

import type { RequestHandler } from 'express';
import { error } from '../utils/response.js';
import { ErrorCode } from '../types/api-contract.js';

/**
 * 预留接口统一响应:返回 501 Not Implemented
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
 * GET /modules
 * 已安装模块列表
 * - 权限:modules:read(所有角色)
 */
export const listModules: RequestHandler = notImplemented;

/**
 * GET /modules/registry
 * 可用模块注册表(市场)
 * - 权限:modules:read
 * - 路由顺序:必须在 /:moduleId 系列路由前注册,避免 'registry' 被当作 :moduleId
 */
export const listModuleRegistry: RequestHandler = notImplemented;

/**
 * POST /modules/:moduleId/install
 * 安装模块
 * - 权限:modules:manage(仅 ADMIN/OWNER)
 * - 异步:大型模块下载/解压通过队列处理
 */
export const installModule: RequestHandler = notImplemented;

/**
 * DELETE /modules/:moduleId
 * 卸载模块
 * - 权限:modules:manage(仅 ADMIN/OWNER)
 */
export const uninstallModule: RequestHandler = notImplemented;

/**
 * GET /modules/:moduleId/config
 * 模块配置
 * - 权限:modules:read
 */
export const getModuleConfig: RequestHandler = notImplemented;

/**
 * PATCH /modules/:moduleId/config
 * 更新模块配置
 * - 权限:modules:manage(仅 ADMIN/OWNER)
 */
export const updateModuleConfig: RequestHandler = notImplemented;

/**
 * POST /modules/:moduleId/enable
 * 启用模块
 * - 权限:modules:manage(仅 ADMIN/OWNER)
 */
export const enableModule: RequestHandler = notImplemented;

/**
 * POST /modules/:moduleId/disable
 * 禁用模块
 * - 权限:modules:manage(仅 ADMIN/OWNER)
 */
export const disableModule: RequestHandler = notImplemented;
