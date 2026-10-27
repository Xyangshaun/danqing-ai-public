// ============================================================
// RBAC 权限检查中间件
// 对应文档:
//   - .trae/documents/auth-design.md §2.4(多租户 JWT 处理)
//   - .trae/documents/api-contract-v1.md §1.3(错误码 FORBIDDEN=2004)
//
// 职责:
//   1. 在 authMiddleware / tenantMiddleware 之后执行
//   2. 从 req.role 读取当前用户角色(由 authMiddleware 从 JWT 注入)
//   3. 查询 ROLE_PERMISSIONS 矩阵,判断是否拥有所需权限
//   4. 无权限返回 {code: 2004, message: '权限不足', traceId}(HTTP 403)
//
// 使用示例:
//   import { requirePermission, requireAnyPermission } from '../middlewares/permission.js';
//   router.post('/analyses', requirePermission('analysis:create'), analysisController.submit);
//   router.get('/analyses', requirePermission('analysis:read:own'), analysisController.list);
//   router.delete('/analyses/:id', requireAnyPermission('analysis:delete:own', 'analysis:delete:tenant'), ...);
//
// 安全策略:
//   - 必须在 authMiddleware 之后注册(依赖 req.role)
//   - 默认拒绝:角色缺失或未知 → 403
//   - 不暴露内部权限标识给客户端(错误消息仅"权限不足")
// ============================================================

import type { RequestHandler } from 'express';
import type { UserRole } from '../types/api-contract.js';
import { ErrorCode } from '../types/api-contract.js';
import { error } from '../utils/response.js';
import { logger } from '../utils/logger.js';
import {
  hasPermission,
  hasAnyPermission,
  hasAllPermissions,
  type Permission,
} from '../config/permissions.js';

/**
 * 校验当前请求用户角色是否存在(由 authMiddleware 注入)
 * 返回 null 表示校验通过,否则返回拒绝原因码
 */
function getRoleFromRequest(req: Parameters<RequestHandler>[0]): UserRole | null {
  const role = req.role;
  if (!role) {
    return null;
  }
  // 收窄类型:UserRole = 'admin' | 'teacher' | 'student' | 'owner'
  if (role !== 'admin' && role !== 'teacher' && role !== 'student' && role !== 'owner') {
    return null;
  }
  return role;
}

/**
 * 统一的拒绝响应(权限不足)
 * 错误码使用 ErrorCode.FORBIDDEN(2004),对应 HTTP 403
 * 不向客户端暴露具体缺失的权限标识(避免信息泄露)
 */
function deny(res: Parameters<RequestHandler>[1], req: Parameters<RequestHandler>[0], required: Permission | Permission[]): void {
  const role = req.role ?? 'unknown';
  const requiredStr = Array.isArray(required) ? required.join(',') : required;
  logger.warn(
    {
      traceId: req.traceId,
      userId: req.userId,
      tenantId: req.tenantId,
      role,
      required: requiredStr,
      url: req.url,
      method: req.method,
    },
    '[permission] access denied (forbidden)',
  );
  error(res, ErrorCode.FORBIDDEN, '权限不足', 403);
}

/**
 * 单权限检查中间件工厂
 * 要求当前用户角色拥有指定权限,否则返回 403
 *
 * @param permission 必须拥有的权限标识
 * @example
 *   router.post('/analyses', requirePermission('analysis:create'), handler);
 */
export function requirePermission(permission: Permission): RequestHandler {
  return (req, res, next) => {
    const role = getRoleFromRequest(req);
    if (!role) {
      // 角色缺失:可能是 authMiddleware 未执行或 JWT 异常
      // 出于安全,统一按 403 拒绝(不暴露 401 以免泄露"已认证但无角色"信息)
      deny(res, req, permission);
      return;
    }
    if (!hasPermission(role, permission)) {
      deny(res, req, permission);
      return;
    }
    next();
  };
}

/**
 * 多权限检查中间件工厂(OR 语义)
 * 要求当前用户角色拥有给定权限中的任意一个,否则返回 403
 * 适用场景:删除分析时,可拥有 analysis:delete:own 或 analysis:delete:tenant 任一
 *
 * @param permissions 权限列表(至少一个)
 * @example
 *   router.delete('/analyses/:id',
 *     requireAnyPermission('analysis:delete:own', 'analysis:delete:tenant'),
 *     handler,
 *   );
 */
export function requireAnyPermission(...permissions: Permission[]): RequestHandler {
  return (req, res, next) => {
    if (permissions.length === 0) {
      // 未指定权限要求:默认拒绝(安全优先)
      deny(res, req, permissions);
      return;
    }
    const role = getRoleFromRequest(req);
    if (!role) {
      deny(res, req, permissions);
      return;
    }
    if (!hasAnyPermission(role, permissions)) {
      deny(res, req, permissions);
      return;
    }
    next();
  };
}

/**
 * 多权限检查中间件工厂(AND 语义)
 * 要求当前用户角色拥有给定权限中的全部,否则返回 403
 * 适用场景:更新租户设置同时需要 tenant:update + user:update:tenant
 *
 * @param permissions 权限列表(至少一个)
 * @example
 *   router.patch('/tenants/:id',
 *     requireAllPermissions('tenant:update', 'user:update:tenant'),
 *     handler,
 *   );
 */
export function requireAllPermissions(...permissions: Permission[]): RequestHandler {
  return (req, res, next) => {
    if (permissions.length === 0) {
      deny(res, req, permissions);
      return;
    }
    const role = getRoleFromRequest(req);
    if (!role) {
      deny(res, req, permissions);
      return;
    }
    if (!hasAllPermissions(role, permissions)) {
      deny(res, req, permissions);
      return;
    }
    next();
  };
}

/**
 * 导出权限查询工具(便于 controller/service 内做数据范围过滤)
 */
export {
  hasPermission,
  hasAnyPermission,
  hasAllPermissions,
} from '../config/permissions.js';
