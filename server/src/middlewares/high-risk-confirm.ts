// ============================================================
// 高危操作密码确认中间件(M-1 DOC-2026-08-014)
// 对应高危写接口:
//   POST   /api/admin/users/:id/lock
//   POST   /api/admin/users/batch
//   POST   /api/admin/subscriptions/:id/refund
//   DELETE /api/admin/system/api-keys/:id
//   POST   /api/admin/artworks/:id/review
//
// 三级确认(contract HighRiskConfirmPayload):
//   - confirmPassword 为可选字段(非破坏性,旧客户端不受影响)
//   - 请求体含 confirmPassword:校验"当前操作者本人"密码,失败返回
//     ADMIN_CONFIRM_PASSWORD_MISMATCH(8015)
//   - 请求体不含 confirmPassword:透传(向后兼容)
//
// 安全约束:
//   - 仅校验 req.userId 本人的密码(防他人冒用他人密码确认)
//   - 无密码账户(如纯飞书认证)且仍提供 confirmPassword → 拒绝(8015)
//   - 读取后立即从 req.body 剔除 confirmPassword,避免污染下游 Zod 校验
//   - 禁止日志输出明文密码
// ============================================================

import type { RequestHandler } from 'express';
import { userRepository } from '../repositories/user.repository.js';
import { verifyPassword } from '../utils/password.js';
import { error } from '../utils/response.js';
import { ErrorCode } from '../types/api-contract.js';

/**
 * 高危操作密码确认中间件
 * 挂在高危写接口的 handler 之前(在 requirePermission 之后)
 */
export const highRiskConfirmPassword: RequestHandler = async (req, res, next) => {
  const body = req.body as Record<string, unknown> | undefined;
  const confirmPassword = body?.confirmPassword;

  // 未提供密码 → 非破坏性透传(向后兼容)
  if (confirmPassword === undefined || confirmPassword === null) {
    return next();
  }

  // 提供密码后,先从请求体剔除,避免污染下游 Zod 校验(保持 service 契约不变)
  if (body) {
    delete body.confirmPassword;
  }

  // confirmPassword 必须为字符串
  if (typeof confirmPassword !== 'string' || confirmPassword === '') {
    return error(
      res,
      ErrorCode.ADMIN_CONFIRM_PASSWORD_MISMATCH,
      'confirmPassword 必须为非空字符串',
      403,
    );
  }

  if (!req.userId) {
    return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
  }

  try {
    const operator = await userRepository.findById(req.userId);
    // 无密码账户(AuthType != 'password' 或无 passwordHash)无法完成密码确认
    if (!operator || operator.authType !== 'password' || !operator.passwordHash) {
      return error(
        res,
        ErrorCode.ADMIN_CONFIRM_PASSWORD_MISMATCH,
        '当前账户未设置密码,无法完成高危操作确认',
        403,
      );
    }

    const ok = await verifyPassword(confirmPassword, operator.passwordHash);
    if (!ok) {
      return error(res, ErrorCode.ADMIN_CONFIRM_PASSWORD_MISMATCH, '密码校验失败', 403);
    }

    return next();
  } catch (err) {
    return next(err);
  }
};