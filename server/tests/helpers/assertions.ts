// ============================================================
// 自定义断言辅助(Vitest expect 扩展 + 工具函数)
// 对应文档:auth-design.md §0 C12(日志脱敏)+ §2.2(refresh_token Cookie 属性)
//
// 提供:
//   1. assertApiResponse:校验统一响应结构 { code, message, data, traceId }
//   2. assertApiError:校验错误响应(code !== 0,data=null,traceId 存在)
//   3. assertRefreshTokenCookie:校验 refresh_token Cookie 安全属性
//   4. assertJwtPayload:校验 access_token payload 字段完整性
//   5. assertTraceIdHeader:校验 X-Trace-Id 响应头
//   6. assertNoSensitiveDataInBody:校验响应体不含敏感字段
// ============================================================

import type { Response as SupertestResponse } from 'supertest';
import { expect } from 'vitest';
import jwt from 'jsonwebtoken';

/**
 * 统一 API 响应结构类型(对应 src/types/api-contract.ts ApiResponse<T>)
 */
interface ApiResponseShape {
  code: number;
  message: string;
  data: unknown;
  traceId: string;
}

/**
 * 断言:响应符合统一 ApiResponse 结构
 */
export function assertApiResponse(res: SupertestResponse, expectedCode = 0): ApiResponseShape {
  expect(res.body).toBeDefined();
  const body = res.body as Partial<ApiResponseShape>;
  expect(body.code).toBe(expectedCode);
  expect(typeof body.message).toBe('string');
  expect(body.message.length).toBeGreaterThan(0);
  expect(typeof body.traceId).toBe('string');
  expect(body.traceId.length).toBeGreaterThan(0);
  return body as ApiResponseShape;
}

/**
 * 断言:响应为错误响应(code !== 0)
 * data 允许两种形态:null(默认)或调试元数据对象(P0 深度诊断透传 failureReason/debugHint/aiMeta)
 */
export function assertApiError(
  res: SupertestResponse,
  expectedCode: number,
  expectedHttpStatus?: number,
): ApiResponseShape {
  if (expectedHttpStatus !== undefined) {
    expect(res.status).toBe(expectedHttpStatus);
  }
  const body = res.body as Partial<ApiResponseShape>;
  expect(body.code).toBe(expectedCode);
  expect(body.data === null || typeof body.data === 'object').toBe(true);
  expect(typeof body.traceId).toBe('string');
  expect(body.traceId.length).toBeGreaterThan(0);
  return body as ApiResponseShape;
}

/**
 * 断言:refresh_token Cookie 安全属性
 * 对应 auth-design.md §2.2 + §3.6
 *   - HttpOnly:必填,防 XSS 读取
 *   - SameSite=Strict:必填,防 CSRF
 *   - Path=/auth:仅在 /auth/* 路径下发送
 *   - Max-Age:对应 7 天
 */
export function assertRefreshTokenCookie(
  res: SupertestResponse,
  options: { shouldExist: boolean; secure?: boolean } = { shouldExist: true },
): void {
  // supertest 通过 res.headers['set-cookie'] 获取,可能是数组
  const setCookie = res.headers['set-cookie'];
  if (!options.shouldExist) {
    // 期望 cookie 已被清除:不应存在「有效」的 refresh_token cookie
    // 注意:res.clearCookie 会写入 refresh_token=; Expires=Thu, 01 Jan 1970 ... 的清除头,
    // 因此判定有效 cookie 必须满足:值非空 + 未过期 + Max-Age 不为 0
    if (setCookie) {
      const all = Array.isArray(setCookie) ? setCookie : [setCookie];
      const hasValidRefresh = all.some((c) => {
        if (!c.startsWith('refresh_token=')) return false;
        // 取等号后到第一个分号之间的值
        const valuePart = c.slice('refresh_token='.length).split(';')[0];
        if (!valuePart) return false; // 空值,视为清除
        // 检查 Max-Age=0 或 Expires 在过去(1970 起算)
        if (/Max-Age=0/i.test(c)) return false;
        if (/Expires=Thu, 01 Jan 1970/i.test(c)) return false;
        return true;
      });
      expect(hasValidRefresh).toBe(false);
    }
    return;
  }

  expect(setCookie).toBeDefined();
  const all = Array.isArray(setCookie) ? setCookie : [setCookie];
  const refreshCookie = all.find((c) => c.startsWith('refresh_token='));
  expect(refreshCookie).toBeDefined();
  expect(refreshCookie).toContain('HttpOnly');
  expect(refreshCookie).toContain('SameSite=Strict');
  expect(refreshCookie).toContain('Path=/auth');
  if (options.secure === true) {
    expect(refreshCookie).toContain('Secure');
  }
  // Max-Age 应大于 0(7d = 604800s)
  const maxAgeMatch = refreshCookie!.match(/Max-Age=(\d+)/);
  expect(maxAgeMatch).not.toBeNull();
  const maxAge = parseInt(maxAgeMatch![1]!, 10);
  expect(maxAge).toBeGreaterThan(0);
}

/**
 * 断言:X-Trace-Id 响应头存在且为 UUID v4 格式
 */
export function assertTraceIdHeader(res: SupertestResponse): string {
  const traceId = res.headers['x-trace-id'] as string | undefined;
  expect(traceId).toBeDefined();
  expect(traceId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  );
  return traceId as string;
}

/**
 * 断言:JWT access_token payload 字段完整性
 * 对应 auth-design.md §2.1 access_token payload
 */
export function assertAccessTokenPayload(
  token: string,
  expected: { userId: string; tenantId: string; role: string },
): void {
  const decoded = jwt.decode(token, { complete: true });
  expect(decoded).not.toBeNull();
  expect(decoded?.header.alg).toBe('RS256');

  const payload = decoded!.payload as jwt.JwtPayload;
  expect(payload.sub).toBe(expected.userId);
  expect(payload['tenant_id']).toBe(expected.tenantId);
  expect(payload['role']).toBe(expected.role);
  expect(payload.jti).toBeDefined();
  expect(payload.iss).toBe('danqing-ai-auth');
  expect(payload.aud).toMatch(/danqing-ai-(web|admin|mobile)/);
  expect(payload.exp).toBeGreaterThan(payload.iat ?? 0);
}

/**
 * 断言:响应体中不包含敏感字段(脱敏检查)
 * 对应 auth-design.md §0 C12
 */
export function assertNoSensitiveDataInBody(res: SupertestResponse): void {
  const bodyStr = JSON.stringify(res.body);
  // 不应出现明文 refresh_token / app_secret / private_key
  expect(bodyStr).not.toMatch(/refresh_token=([a-zA-Z0-9._-]+)/);
  expect(bodyStr).not.toContain('app_secret');
  expect(bodyStr).not.toContain('private_key');
  expect(bodyStr).not.toContain('BEGIN RSA PRIVATE KEY');
  expect(bodyStr).not.toContain('BEGIN PRIVATE KEY');
}

/**
 * 断言:URL 符合飞书 authorize 端点格式
 */
export function assertFeishuAuthorizeUrl(
  url: string,
  expected: { appId: string; redirectUri: string; state: string },
): void {
  expect(url).toMatch(/^https:\/\/open\.feishu\.cn\/open-apis\/authen\/v1\/authorize\?/);
  const parsed = new URL(url);
  expect(parsed.searchParams.get('app_id')).toBe(expected.appId);
  expect(parsed.searchParams.get('redirect_uri')).toBe(expected.redirectUri);
  expect(parsed.searchParams.get('response_type')).toBe('code');
  expect(parsed.searchParams.get('state')).toBe(expected.state);
}

/**
 * 断言:Redis 中存在指定 state 键且 TTL 在合理范围
 */
export function assertStateInRedis(
  redisMock: { __peek: (key: string) => { value: string; expiresAt: number | null } | undefined },
  state: string,
  expectedTtlRange: { min: number; max: number } = { min: 290, max: 301 },
): void {
  const entry = redisMock.__peek(`oauth:state:${state}`);
  expect(entry).toBeDefined();
  expect(entry!.expiresAt).not.toBeNull();
  const ttlSec = Math.floor(((entry!.expiresAt as number) - Date.now()) / 1000);
  expect(ttlSec).toBeGreaterThanOrEqual(expectedTtlRange.min);
  expect(ttlSec).toBeLessThanOrEqual(expectedTtlRange.max);
}

/**
 * 断言:Redis 中 state 已被消费(一次性)
 */
export function assertStateConsumed(
  redisMock: { __peek: (key: string) => unknown | undefined },
  state: string,
): void {
  const entry = redisMock.__peek(`oauth:state:${state}`);
  expect(entry).toBeUndefined();
}
