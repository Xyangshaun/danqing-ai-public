// ============================================================
// 中间件测试
// 对应源码:src/middlewares/{auth,tenant,rate-limit,validate}.ts
// 测试策略:
//   - authMiddleware / tenantMiddleware:直接构造 Express req/res/next mock,单元测试
//   - createRateLimiter:直接调用中间件函数,验证 res 状态码 + next 调用
//   - validate:直接调用,Zod schema 验证 next 调用与 ZodError 透传
// 覆盖:正常路径 + 边界 + 异常分支
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { authMiddleware } from '../src/middlewares/auth.js';
import { tenantMiddleware } from '../src/middlewares/tenant.js';
import { createRateLimiter } from '../src/middlewares/rate-limit.js';
import { validate } from '../src/middlewares/validate.js';
import { jwtService } from '../src/services/jwt.service.js';
import { redisMock } from './mocks/redis.mock.js';
import { ErrorCode } from '../src/types/api-contract.js';
import { z } from 'zod';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { testJwtKeys } from './mocks/jwt-keys.mock.js';

// ============================================================
// Express mock 工厂:构造 req / res / next
// ============================================================

type MockRequest = Partial<Request> & {
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
  traceId?: string;
  /** Express req.header(name) 方法(大小写不敏感查找) */
  header?: (name: string) => string | undefined;
};

type MockResponse = {
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
  setHeader: ReturnType<typeof vi.fn>;
  headers: Record<string, unknown>;
  /** 回引 req,供 response.ts 中 res.req.traceId 访问 */
  req: MockRequest;
};

function createMockReq(overrides: MockRequest = {}): MockRequest {
  const req: MockRequest = {
    headers: {},
    ip: '127.0.0.1',
    traceId: 'test-trace-id',
    ...overrides,
  };
  // 实现 Express req.header(name):大小写不敏感查 headers
  req.header = (name: string): string | undefined => {
    const lower = name.toLowerCase();
    for (const [key, value] of Object.entries(req.headers)) {
      if (key.toLowerCase() === lower) {
        return Array.isArray(value) ? value[0] : value;
      }
    }
    return undefined;
  };
  return req;
}

function createMockRes(req?: MockRequest): MockResponse {
  const mockReq = req ?? createMockReq();
  const res: MockResponse = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn(),
    headers: {},
    req: mockReq,
  };
  return res;
}

function createMockNext(): NextFunction & { calls: unknown[][] } {
  const fn = vi.fn() as unknown as NextFunction & { calls: unknown[][] };
  return fn;
}

/**
 * 调用一个 RequestHandler 中间件并返回 Promise(便于异步中间件 await)
 */
async function runMiddleware(
  middleware: RequestHandler,
  req: MockRequest,
  res: MockResponse,
  next: NextFunction,
): Promise<void> {
  await Promise.resolve(middleware(req as Request, res as unknown as Response, next));
}

// ============================================================
// 测试常量
// ============================================================

const TEST_USER_ID = 'u-mw-test-0001';
const TEST_TENANT_ID = 't-mw-test-0001';
const TEST_FEISHU_OPEN_ID = 'ou_mw_test_open_id';
const TEST_ROLE = 'student';

describe('middlewares', () => {
  beforeEach(() => {
    redisMock.__clear();
  });

  // ============================================================
  // authMiddleware
  // ============================================================
  describe('authMiddleware', () => {
    function issueValidToken(): string {
      return jwtService.issueAccessToken({
        userId: TEST_USER_ID,
        tenantId: TEST_TENANT_ID,
        role: TEST_ROLE,
        feishuOpenId: TEST_FEISHU_OPEN_ID,
        client: 'web',
      }).token;
    }

    it('should_inject_user_context_when_token_valid', async () => {
      const token = issueValidToken();
      const req = createMockReq({
        headers: { authorization: `Bearer ${token}` },
      });
      const res = createMockRes();
      const next = createMockNext();

      await runMiddleware(authMiddleware, req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith(); // 无错误
      expect(req.userId).toBe(TEST_USER_ID);
      expect(req.tenantId).toBe(TEST_TENANT_ID);
      expect(req.role).toBe(TEST_ROLE);
      expect(req.feishuOpenId).toBe(TEST_FEISHU_OPEN_ID);
      expect(req.jti).toBeDefined();
    });

    it('should_return_401_when_authorization_header_missing', async () => {
      const req = createMockReq({ headers: {} });
      const res = createMockRes();
      const next = createMockNext();

      await runMiddleware(authMiddleware, req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: ErrorCode.UNAUTHORIZED }),
      );
    });

    it('should_return_401_when_token_empty', async () => {
      const req = createMockReq({ headers: { authorization: 'Bearer ' } });
      const res = createMockRes();
      const next = createMockNext();

      await runMiddleware(authMiddleware, req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: ErrorCode.UNAUTHORIZED }),
      );
    });

    it('should_return_401_when_authorization_not_bearer_schema', async () => {
      const req = createMockReq({ headers: { authorization: 'Basic abc123' } });
      const res = createMockRes();
      const next = createMockNext();

      await runMiddleware(authMiddleware, req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('should_return_401_when_token_expired', async () => {
      // 用底层 jwt 签发已过期 token
      const payload = {
        sub: TEST_USER_ID,
        tenant_id: TEST_TENANT_ID,
        role: TEST_ROLE,
        feishu_open_id: TEST_FEISHU_OPEN_ID,
        jti: crypto.randomUUID(),
        iss: 'danqing-ai-auth',
        aud: 'danqing-ai-web',
      };
      const expiredToken = jwt.sign(payload, testJwtKeys.privateKey, {
        algorithm: 'RS256',
        expiresIn: -100, // 已过期 100 秒(超过 clockTolerance: 30)
        keyid: 'test-kid-2026',
      });
      const req = createMockReq({ headers: { authorization: `Bearer ${expiredToken}` } });
      const res = createMockRes();
      const next = createMockNext();

      await runMiddleware(authMiddleware, req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: ErrorCode.TOKEN_EXPIRED }),
      );
    });

    it('should_return_401_when_token_signature_invalid', async () => {
      const { privateKey: wrongKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
      const payload = {
        sub: TEST_USER_ID,
        tenant_id: TEST_TENANT_ID,
        role: TEST_ROLE,
        feishu_open_id: TEST_FEISHU_OPEN_ID,
        jti: crypto.randomUUID(),
        iss: 'danqing-ai-auth',
        aud: 'danqing-ai-web',
      };
      const badToken = jwt.sign(payload, wrongKey as string, {
        algorithm: 'RS256',
        expiresIn: '15m',
        keyid: 'test-kid-2026',
      });
      const req = createMockReq({ headers: { authorization: `Bearer ${badToken}` } });
      const res = createMockRes();
      const next = createMockNext();

      await runMiddleware(authMiddleware, req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: ErrorCode.TOKEN_SIGNATURE_INVALID }),
      );
    });

    it('should_return_401_when_token_blacklisted', async () => {
      const result = jwtService.issueAccessToken({
        userId: TEST_USER_ID,
        tenantId: TEST_TENANT_ID,
        role: TEST_ROLE,
        feishuOpenId: TEST_FEISHU_OPEN_ID,
        client: 'web',
      });
      // 写入黑名单
      redisMock.__rawSet(`blacklist:access:${result.jti}`, '1', 60);

      const req = createMockReq({ headers: { authorization: `Bearer ${result.token}` } });
      const res = createMockRes();
      const next = createMockNext();

      await runMiddleware(authMiddleware, req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: ErrorCode.UNAUTHORIZED }),
      );
    });

    it('should_reject_hs256_token', async () => {
      // HS256 token 攻击(RS256 公钥不应能验证 HS256)
      const payload = {
        sub: TEST_USER_ID,
        tenant_id: TEST_TENANT_ID,
        role: TEST_ROLE,
        feishu_open_id: TEST_FEISHU_OPEN_ID,
        jti: crypto.randomUUID(),
        iss: 'danqing-ai-auth',
        aud: 'danqing-ai-web',
      };
      const hs256Token = jwt.sign(payload, 'malicious-secret', {
        algorithm: 'HS256',
        expiresIn: '15m',
      });
      const req = createMockReq({ headers: { authorization: `Bearer ${hs256Token}` } });
      const res = createMockRes();
      const next = createMockNext();

      await runMiddleware(authMiddleware, req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
    });
  });

  // ============================================================
  // tenantMiddleware
  // ============================================================
  describe('tenantMiddleware', () => {
    it('should_pass_when_tenant_id_present', async () => {
      const req = createMockReq({ headers: {} });
      req.tenantId = TEST_TENANT_ID;
      const res = createMockRes();
      const next = createMockNext();

      await runMiddleware(tenantMiddleware, req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith();
    });

    it('should_return_401_when_tenant_id_missing', async () => {
      const req = createMockReq({ headers: {} });
      // tenantId 未注入
      const res = createMockRes();
      const next = createMockNext();

      await runMiddleware(tenantMiddleware, req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: ErrorCode.UNAUTHORIZED }),
      );
    });
  });

  // ============================================================
  // createRateLimiter
  // ============================================================
  describe('createRateLimiter', () => {
    it('should_pass_when_under_limit', async () => {
      const limiter = createRateLimiter(5, 'test-scope');
      const req = createMockReq({ headers: {}, ip: '1.1.1.1' });
      const res = createMockRes();
      const next = createMockNext();

      await runMiddleware(limiter, req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith();
    });

    it('should_return_429_when_over_limit', async () => {
      const limiter = createRateLimiter(2, 'test-scope-over');
      const ip = '2.2.2.2';

      // 第 1 次:通过
      await runMiddleware(limiter, createMockReq({ headers: {}, ip }), createMockRes(), createMockNext());
      // 第 2 次:通过
      await runMiddleware(limiter, createMockReq({ headers: {}, ip }), createMockRes(), createMockNext());
      // 第 3 次:触发限流
      const req3 = createMockReq({ headers: {}, ip });
      const res3 = createMockRes();
      const next3 = createMockNext();
      await runMiddleware(limiter, req3, res3, next3);

      expect(next3).not.toHaveBeenCalled();
      expect(res3.status).toHaveBeenCalledWith(429);
      expect(res3.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: ErrorCode.RATE_LIMITED }),
      );
    });

    it('should_set_retry_after_header_on_429', async () => {
      const limiter = createRateLimiter(1, 'test-scope-retry');
      const ip = '3.3.3.3';

      // 第 1 次:通过
      await runMiddleware(limiter, createMockReq({ headers: {}, ip }), createMockRes(), createMockNext());

      // 第 2 次:触发 429
      const res = createMockRes();
      await runMiddleware(limiter, createMockReq({ headers: {}, ip }), res, createMockNext());

      expect(res.setHeader).toHaveBeenCalledWith('Retry-After', '60');
    });

    it('should_separate_limits_by_ip', async () => {
      const limiter = createRateLimiter(1, 'test-scope-ip');
      // IP A 第 1 次通过
      await runMiddleware(limiter, createMockReq({ headers: {}, ip: '4.4.4.4' }), createMockRes(), createMockNext());
      // IP B 第 1 次也应通过(独立计数)
      const reqB = createMockReq({ headers: {}, ip: '5.5.5.5' });
      const resB = createMockRes();
      const nextB = createMockNext();
      await runMiddleware(limiter, reqB, resB, nextB);

      expect(nextB).toHaveBeenCalledTimes(1);
    });

    it('should_use_x_forwarded_for_first_segment', async () => {
      const limiter = createRateLimiter(1, 'test-scope-xff');
      // X-Forwarded-For 优先于 req.ip
      const req = createMockReq({
        headers: { 'x-forwarded-for': '6.6.6.6, 7.7.7.7' },
        ip: '8.8.8.8',
      });
      await runMiddleware(limiter, req, createMockRes(), createMockNext());

      // 第 2 次,IP 不同(req.ip=8.8.8.8)但 XFF 头相同(6.6.6.6)→ 应触发限流
      const req2 = createMockReq({
        headers: { 'x-forwarded-for': '6.6.6.6, 9.9.9.9' },
        ip: '8.8.8.8',
      });
      const res2 = createMockRes();
      const next2 = createMockNext();
      await runMiddleware(limiter, req2, res2, next2);

      expect(res2.status).toHaveBeenCalledWith(429);
    });
  });

  // ============================================================
  // validate
  // ============================================================
  describe('validate', () => {
    const bodySchema = z.object({
      name: z.string().min(1),
      age: z.number().int().min(0),
    });
    const querySchema = z.object({
      page: z.string().optional(),
    });

    it('should_parse_body_when_valid', async () => {
      const mw = validate({ body: bodySchema });
      const req = createMockReq({
        headers: { 'content-type': 'application/json' },
        body: { name: 'Alice', age: 20 },
      });
      const res = createMockRes();
      const next = createMockNext();

      await runMiddleware(mw, req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith();
      expect(req.body).toEqual({ name: 'Alice', age: 20 });
    });

    it('should_parse_query_when_valid', async () => {
      const mw = validate({ query: querySchema });
      const req = createMockReq({ headers: {}, query: { page: '1' } });
      const res = createMockRes();
      const next = createMockNext();

      await runMiddleware(mw, req, res, next);

      expect(next).toHaveBeenCalledWith();
      expect(req.query).toEqual({ page: '1' });
    });

    it('should_parse_params_when_valid', async () => {
      const paramsSchema = z.object({ id: z.string().uuid() });
      const mw = validate({ params: paramsSchema });
      const req = createMockReq({
        headers: {},
        params: { id: crypto.randomUUID() },
      });
      const res = createMockRes();
      const next = createMockNext();

      await runMiddleware(mw, req, res, next);

      expect(next).toHaveBeenCalledWith();
    });

    it('should_call_next_with_zod_error_when_invalid', async () => {
      const mw = validate({ body: bodySchema });
      const req = createMockReq({
        headers: {},
        body: { name: '', age: -1 }, // 违反 min(1) 和 min(0)
      });
      const res = createMockRes();
      const next = createMockNext();

      await runMiddleware(mw, req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      // ZodError 透传到 errorHandler
      const err = next.mock.calls[0]?.[0];
      expect(err).toBeDefined();
      expect(err?.name).toBe('ZodError');
    });

    it('should_skip_when_no_schema_provided', async () => {
      const mw = validate({});
      const req = createMockReq({ headers: {} });
      const res = createMockRes();
      const next = createMockNext();

      await runMiddleware(mw, req, res, next);

      expect(next).toHaveBeenCalledWith();
    });

    it('should_validate_headers_when_schema_provided', async () => {
      const headersSchema = z.object({
        'x-custom-header': z.string().min(1),
      });
      const mw = validate({ headers: headersSchema });
      const req = createMockReq({
        headers: { 'x-custom-header': 'value' },
      });
      const res = createMockRes();
      const next = createMockNext();

      await runMiddleware(mw, req, res, next);

      expect(next).toHaveBeenCalledWith();
    });

    it('should_call_next_with_zod_error_when_headers_invalid', async () => {
      const headersSchema = z.object({
        'x-required-header': z.string().min(1),
      });
      const mw = validate({ headers: headersSchema });
      const req = createMockReq({ headers: {} }); // 缺少必填头
      const res = createMockRes();
      const next = createMockNext();

      await runMiddleware(mw, req, res, next);

      const err = next.mock.calls[0]?.[0];
      expect(err?.name).toBe('ZodError');
    });
  });
});
