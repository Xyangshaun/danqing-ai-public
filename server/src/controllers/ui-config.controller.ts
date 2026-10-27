// ============================================================
// UI 配置与组件数据 Controller(Phase 5 预留接口)
//
// 对应 API:
//   GET    /ui/theme                       当前主题配置
//   PATCH  /ui/theme                       更新主题(管理员)
//   GET    /ui/themes                      可用主题列表
//   GET    /ui/components/:componentId     组件数据
//   PUT    /ui/components/:componentId     更新组件配置
//   GET    /ui/layout                      布局配置
//   PATCH  /ui/layout                      更新布局配置
//   GET    /ui/dashboard/:userId           用户个性化看板
//   PATCH  /ui/dashboard/:userId           更新用户看板配置
//
// 当前状态:预留实现,统一返回 501 Not Implemented
// 未来方向:支持主题切换、布局自定义、看板组件化配置
//
// 预留接口规范:
//   - 路由已挂载,鉴权 + 权限校验完整
//   - 类型定义见 api-contract.ts §3.11.3
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
 * GET /ui/theme
 * 当前主题配置
 * - 权限:ui:config:read(所有角色)
 */
export const getCurrentTheme: RequestHandler = notImplemented;

/**
 * PATCH /ui/theme
 * 更新主题
 * - 权限:ui:config:write(仅 ADMIN/OWNER)
 */
export const updateTheme: RequestHandler = notImplemented;

/**
 * GET /ui/themes
 * 可用主题列表
 * - 权限:ui:config:read
 */
export const listThemes: RequestHandler = notImplemented;

/**
 * GET /ui/components/:componentId
 * 组件数据
 * - 权限:ui:config:read
 */
export const getComponentData: RequestHandler = notImplemented;

/**
 * PUT /ui/components/:componentId
 * 更新组件配置
 * - 权限:ui:config:write(仅 ADMIN/OWNER)
 */
export const updateComponentData: RequestHandler = notImplemented;

/**
 * GET /ui/layout
 * 布局配置
 * - 权限:ui:config:read
 */
export const getLayout: RequestHandler = notImplemented;

/**
 * PATCH /ui/layout
 * 更新布局配置
 * - 权限:ui:config:write(仅 ADMIN/OWNER)
 */
export const updateLayout: RequestHandler = notImplemented;

/**
 * GET /ui/dashboard/:userId
 * 用户个性化看板
 * - 权限:ui:config:read
 * - 数据范围:学生只能查看自己的看板,教师/管理员可查看租户内任意用户
 */
export const getDashboard: RequestHandler = notImplemented;

/**
 * PATCH /ui/dashboard/:userId
 * 更新用户看板配置
 * - 权限:ui:config:write(仅 ADMIN/OWNER) 或 自己更新自己(STUDENT/TEACHER)
 */
export const updateDashboard: RequestHandler = notImplemented;
