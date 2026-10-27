// ============================================================
// 认证路由
// 对应 API:
//   GET  /auth/feishu/authorize     (无需鉴权,限流 10/min)
//   GET  /auth/feishu/callback      (无需鉴权,限流 5/min)
//   POST /auth/refresh              (无需鉴权,限流 20/min)
//   POST /auth/logout               (需鉴权)
//   GET  /auth/me                   (需鉴权)
//
// Phase 5 扩展:
//   POST /auth/phone/otp            (无需鉴权,限流 3/min/IP)
//   POST /auth/phone/verify         (无需鉴权,限流 5/min)
//   POST /auth/invitation/redeem    (无需鉴权,限流 5/min)
//   POST /auth/register/admin       (无需鉴权,限流 2/min/IP)
//   POST /auth/login/admin          (无需鉴权,限流 5/min)
//   POST /auth/phone/bind           (需鉴权,限流 3/min)
// ============================================================

import { Router } from 'express';
import {
  feishuAuthorize,
  feishuCallback,
  authRefresh,
  authLogout,
  authMe,
  phoneOtp,
  phoneVerify,
  invitationRedeem,
  adminRegister,
  adminLogin,
  phoneBind,
  accountRegister,
  accountLogin,
  feishuQrCreate,
  feishuQrStatus,
} from '../controllers/auth.controller.js';
import { authMiddleware, optionalAuthMiddleware } from '../middlewares/auth.js';
import {
  authRateLimiter,
  callbackRateLimiter,
  refreshRateLimiter,
  createRateLimiter,
} from '../middlewares/rate-limit.js';
import { csrfMiddleware } from '../middlewares/csrf.js';

export const authRouter: Router = Router();

// ---------- Phase 1:飞书 OAuth + JWT 刷新 + 登出 + 当前用户 ----------

// 飞书 OAuth 授权 URL
authRouter.get(
  '/feishu/authorize',
  authRateLimiter(),
  feishuAuthorize,
);

// 飞书 OAuth 回调
authRouter.get(
  '/feishu/callback',
  callbackRateLimiter(),
  feishuCallback,
);

// 刷新 access_token(从 Cookie 读 refresh_token)
// CSRF 双提交 Cookie 模式校验:Cookie 鉴权场景必校验 X-CSRF-Token 头
authRouter.post(
  '/refresh',
  refreshRateLimiter(),
  csrfMiddleware,
  authRefresh,
);

// 登出(需鉴权)
// CSRF 校验在 auth 之前:Cookie 鉴权场景必校验 X-CSRF-Token 头
authRouter.post(
  '/logout',
  csrfMiddleware,
  authMiddleware,
  authLogout,
);

// 获取当前用户信息(需鉴权)
authRouter.get(
  '/me',
  authMiddleware,
  authMe,
);

// ---------- Phase 5:手机 OTP / 邀请码 / 院校管理员认证 ----------

// POST /auth/phone/otp - 发送手机验证码(bind 场景可选鉴权注入 userId,限流 3/min/IP)
authRouter.post(
  '/phone/otp',
  createRateLimiter(3, 'phone-otp'),
  optionalAuthMiddleware,
  phoneOtp,
);

// POST /auth/phone/verify - 验证码校验 + 登录/注册(无需鉴权,限流 5/min)
// 路径 /phone/verify 与 /phone/otp / /phone/bind 不冲突(Express 按段匹配)
authRouter.post(
  '/phone/verify',
  createRateLimiter(5, 'phone-verify'),
  phoneVerify,
);

// POST /auth/phone/bind - 已登录用户绑定手机号(需鉴权,限流 3/min)
// 必须在 /phone/verify 之后注册:/phone/bind 路径段独立,不会被 /phone/:xxx 截获
authRouter.post(
  '/phone/bind',
  createRateLimiter(3, 'phone-bind'),
  authMiddleware,
  phoneBind,
);

// POST /auth/invitation/redeem - 邀请码兑换 + 加入租户(可选鉴权,限流 5/min)
// optionalAuthMiddleware:已登录用户(如学生加入班级)注入 req.userId → 直接为现有账户
// 添加班级成员关系;未登录用户走邀请码注册新用户分支(authType=invitation)。
authRouter.post(
  '/invitation/redeem',
  createRateLimiter(5, 'invitation-redeem'),
  optionalAuthMiddleware,
  invitationRedeem,
);

// POST /auth/register/admin - 院校管理员注册(邮箱+密码,需邀请码,限流 2/min/IP)
authRouter.post(
  '/register/admin',
  createRateLimiter(2, 'admin-register'),
  adminRegister,
);

// POST /auth/login/admin - 院校管理员登录(邮箱+密码,限流 5/min)
authRouter.post(
  '/login/admin',
  createRateLimiter(5, 'admin-login'),
  adminLogin,
);

// ---------- 通用账号注册/登录 + 飞书扫码登录(UI 主要登录方式) ----------

// POST /auth/register - 通用账号注册(邮箱+密码,无需邀请码,限流 3/min/IP)
authRouter.post(
  '/register',
  createRateLimiter(3, 'account-register'),
  accountRegister,
);

// POST /auth/login - 通用账号登录(邮箱+密码,限流 5/min)
authRouter.post(
  '/login',
  createRateLimiter(5, 'account-login'),
  accountLogin,
);

// POST /auth/feishu/qrcode - 创建飞书扫码登录二维码(限流 5/min)
authRouter.post(
  '/feishu/qrcode',
  createRateLimiter(5, 'feishu-qrcode'),
  feishuQrCreate,
);

// POST /auth/feishu/qrcode/status - 查询飞书扫码状态(限流 30/min,前端轮询)
authRouter.post(
  '/feishu/qrcode/status',
  createRateLimiter(30, 'feishu-qrcode-status'),
  feishuQrStatus,
);
