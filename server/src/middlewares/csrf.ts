// ============================================================
// CSRF 防护中间件(双提交 Cookie 模式)
// 对应文档:安全设计 §CSRF 防护
//
// 工作原理:
//   1. 登录(feishuCallback)时下发 csrf_token Cookie:
//        - 非 HttpOnly(前端 JS 可读)
//        - SameSite=Lax(允许跨站 GET 跳转携带,但拦截跨站 POST)
//        - Secure 跟随 cookieSecure 配置
//        - Path=/(前端任意路径可读)
//        - value=crypto.randomBytes(32).hex
//   2. 前端 JS 读 Cookie,以 X-CSRF-Token 头回传
//   3. 中间件比对 Cookie 值与头值,不等则拒绝(403 FORBIDDEN)
//
// 仅挂载在以 Cookie 鉴权(读 refresh_token)的状态变更路由:
//   - POST /auth/refresh
//   - POST /auth/logout
// /auth/feishu/* 不挂载(OAuth state 已防 CSRF)
//
// Deny-by-default:Cookie 或头任一缺失/不等 → 403 FORBIDDEN
// 时序安全:长度相等后用 crypto.timingSafeEqual 比较
// ============================================================

import type { RequestHandler } from 'express';
import crypto from 'node:crypto';
import type { Response } from 'express';
import { env } from '../config/env.js';
import { BusinessError } from './error-handler.js';
import { ErrorCode } from '../types/api-contract.js';

/** CSRF Token Cookie 名 */
export const CSRF_TOKEN_COOKIE = 'csrf_token';
/** CSRF Token 请求头名 */
export const CSRF_TOKEN_HEADER = 'X-CSRF-Token';
/** 状态变更方法(需 CSRF 校验) */
const MUTATING_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/**
 * 生成随机 CSRF token(32 字节 hex = 64 字符)
 */
export function generateCsrfToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * 下发 csrf_token Cookie(非 HttpOnly,前端可读)
 * 在 setRefreshTokenCookie 旁调用(登录/会话刷新时)
 */
export function setCsrfTokenCookie(res: Response): string {
  const cfg = env();
  const token = generateCsrfToken();
  res.cookie(CSRF_TOKEN_COOKIE, token, {
    httpOnly: false, // 前端 JS 必须可读
    secure: cfg.cookieSecure,
    sameSite: 'lax', // 允许跨站 GET 跳转携带,但拦截跨站 POST
    domain: cfg.cookieDomain || undefined,
    path: '/', // 前端任意路径可读
    maxAge: cfg.cookieMaxAge * 1000, // 与 refresh_token 同周期
  });
  return token;
}

/**
 * 清除 csrf_token Cookie
 */
export function clearCsrfTokenCookie(res: Response): void {
  const cfg = env();
  res.clearCookie(CSRF_TOKEN_COOKIE, {
    httpOnly: false,
    secure: cfg.cookieSecure,
    sameSite: 'lax',
    domain: cfg.cookieDomain || undefined,
    path: '/',
  });
}

/**
 * 常量时间字符串比较(防时序攻击)
 * 长度不等时返回 false(不泄露长度信息)
 */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * CSRF 校验中间件(双提交 Cookie 模式)
 *
 * 行为:
 *   - 仅状态变更方法(POST/PATCH/PUT/DELETE)需要校验,GET/HEAD/OPTIONS 直接放行
 *   - 仅当请求携带 refresh_token Cookie 时启用校验(Cookie 鉴权场景)
 *     无 refresh_token Cookie 的请求(如纯 Bearer token 调用)不适用 CSRF 防护
 *   - Deny-by-default:Cookie 与头任一缺失或不一致 → 403 FORBIDDEN
 *
 * 抛出 BusinessError 后由 errorHandler 统一处理(同步 throw,Express 4 自动捕获)
 */
export const csrfMiddleware: RequestHandler = (req, _res, next) => {
  // 仅状态变更方法需要校验
  if (!MUTATING_METHODS.has(req.method.toUpperCase())) {
    return next();
  }

  // 仅当存在 refresh_token Cookie 时启用(Cookie 鉴权场景)
  const refreshToken = req.cookies?.refresh_token as string | undefined;
  if (!refreshToken) {
    // 无 Cookie 鉴权:不适用 CSRF 防护(可能是纯 Bearer token 调用)
    return next();
  }

  const cookieToken = req.cookies?.[CSRF_TOKEN_COOKIE] as string | undefined;
  const headerToken = req.header(CSRF_TOKEN_HEADER);

  // Deny-by-default:两者都必须存在且相等
  if (!cookieToken || !headerToken || !safeEqual(cookieToken, headerToken)) {
    throw new BusinessError(ErrorCode.FORBIDDEN, 'CSRF token 校验失败', 403);
  }

  next();
};
