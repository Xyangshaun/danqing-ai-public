// ============================================================
// 错误处理中间件测试
// 对应源码:src/middlewares/error-handler.ts + src/utils/response.ts
// 测试策略:
//   - errorHandler:直接构造 Express req/res/next mock,验证各种错误类型的处理
//   - notFoundHandler:验证 404 兜底
//   - BusinessError:验证业务错误码透传
//   - ZodError:验证参数校验错误转换
//   - response utils:success/error/paginated 三种响应封装
// ============================================================

import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction, RequestHandler, ErrorRequestHandler } from 'express';
import { errorHandler, notFoundHandler, BusinessError } from '../src/middlewares/error-handler.js';
import { success, error, paginated } from '../src/utils/response.js';
import { ErrorCode } from '../src/types/api-contract.js';
import { ZodError, z } from 'zod';

// ============================================================
// Express mock 工厂
// ============================================================

type MockRequest = Partial<Request> & {
  headers: Record<string, string | string[] | undefined>;
  traceId?: string;
  header?: (name: string) => string | undefined;
};

type MockResponse = {
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
  setHeader: ReturnType<typeof vi.fn>;
  headers: Record<string, unknown>;
  req: MockRequest;
};

function createMockReq(overrides: MockRequest = {}): MockRequest {
  const req: MockRequest = {
    headers: {},
    traceId: 'test-trace-id-eh',
    ...overrides,
  };
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

async function runErrorHandler(
  handler: ErrorRequestHandler,
  err: unknown,
  req: MockRequest,
  res: MockResponse,
  next: NextFunction,
): Promise<void> {
  await Promise.resolve(handler(err, req as Request, res as unknown as Response, next));
}

async function runHandler(
  handler: RequestHandler,
  req: MockRequest,
  res: MockResponse,
  next: NextFunction,
): Promise<void> {
  await Promise.resolve(handler(req as Request, res as unknown as Response, next));
}

describe('error-handler (统一错误处理中间件)', () => {
  // ============================================================
  // errorHandler
  // ============================================================
  describe('errorHandler', () => {
    it('should_return_400_with_PARAM_INVALID_when_zod_error', async () => {
      const schema = z.object({ name: z.string().min(1) });
      let zodErr: ZodError | undefined;
      try {
        schema.parse({ name: '' });
      } catch (e) {
        zodErr = e as ZodError;
      }
      expect(zodErr).toBeDefined();

      const req = createMockReq();
      const res = createMockRes();
      const next = vi.fn();

      await runErrorHandler(errorHandler, zodErr, req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
      const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
      expect(body.code).toBe(ErrorCode.PARAM_INVALID);
      expect(body.message).toMatch(/参数错误/);
      expect(body.traceId).toBe('test-trace-id-eh');
    });

    it('should_pass_business_error_code_and_message', async () => {
      const bizErr = new BusinessError(ErrorCode.FORBIDDEN, '禁止访问', 403);
      const req = createMockReq();
      const res = createMockRes();
      const next = vi.fn();

      await runErrorHandler(errorHandler, bizErr, req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
      const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
      expect(body.code).toBe(ErrorCode.FORBIDDEN);
      expect(body.message).toBe('禁止访问');
      expect(body.data).toBeNull();
    });

    it('should_use_default_http_status_when_business_error_without_httpStatus', async () => {
      // BusinessError 不传 httpStatus,应由 error() 查表
      const bizErr = new BusinessError(ErrorCode.UNAUTHORIZED, '未授权');
      const req = createMockReq();
      const res = createMockRes();
      const next = vi.fn();

      await runErrorHandler(errorHandler, bizErr, req, res, next);

      // UNAUTHORIZED → 401(由 ERROR_HTTP_STATUS 表)
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('should_return_400_with_UUID_traceId_when_body_parse_failed', async () => {
      // P2-6 回归测试:body parser 失败时 traceId 应为 UUID 而非 'unknown'
      // 场景:express.json 解析畸形 JSON 抛 entity.parse.failed
      const parseErr = new SyntaxError('Unexpected token in JSON');
      (parseErr as { type?: string }).type = 'entity.parse.failed';
      const req = createMockReq({ traceId: undefined }); // 模拟 trace 中间件未跑
      const res = createMockRes(req);
      const next = vi.fn();

      await runErrorHandler(errorHandler, parseErr, req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
      expect(body.code).toBe(ErrorCode.PARAM_INVALID);
      expect(body.message).toBe('请求体 JSON 格式错误');
      // 关键断言:traceId 必须是 UUID,不能是 'unknown'
      expect(body.traceId).not.toBe('unknown');
      expect(body.traceId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });

    it('should_return_413_with_FILE_TOO_LARGE_when_body_too_large', async () => {
      // body parser 超限抛 entity.too.large
      const largeErr = new Error('request entity too large');
      (largeErr as { type?: string }).type = 'entity.too.large';
      const req = createMockReq();
      const res = createMockRes();
      const next = vi.fn();

      await runErrorHandler(errorHandler, largeErr, req, res, next);

      expect(res.status).toHaveBeenCalledWith(413);
      const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
      expect(body.code).toBe(ErrorCode.FILE_TOO_LARGE);
    });

    it('should_return_500_with_DATABASE_ERROR_when_prisma_error', async () => {
      // 模拟 Prisma 错误(类名以 PrismaClient 开头)
      const prismaErr = new Error('Unique constraint failed');
      prismaErr.name = 'PrismaClientKnownRequestError';
      const req = createMockReq();
      const res = createMockRes();
      const next = vi.fn();

      await runErrorHandler(errorHandler, prismaErr, req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
      const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
      expect(body.code).toBe(ErrorCode.DATABASE_ERROR);
      expect(body.message).toBe('数据库错误');
    });

    it('should_return_500_with_INTERNAL_ERROR_when_unknown_error', async () => {
      const unknownErr = new Error('Unexpected failure');
      const req = createMockReq();
      const res = createMockRes();
      const next = vi.fn();

      await runErrorHandler(errorHandler, unknownErr, req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
      const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
      expect(body.code).toBe(ErrorCode.INTERNAL_ERROR);
      // 不应暴露内部堆栈
      expect(body.message).toBe('服务器内部错误');
      expect(body.message).not.toContain('Unexpected failure');
    });

    it('should_handle_non_error_thrown_value', async () => {
      // 非 Error 实例(如字符串)
      const req = createMockReq();
      const res = createMockRes();
      const next = vi.fn();

      await runErrorHandler(errorHandler, 'string error', req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
      const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
      expect(body.code).toBe(ErrorCode.INTERNAL_ERROR);
    });

    it('should_generate_fallback_traceId_when_req_missing_traceId', async () => {
      const bizErr = new BusinessError(ErrorCode.FORBIDDEN, '禁止', 403);
      const req = createMockReq({ traceId: undefined });
      const res = createMockRes(req); // 必须传入 req 以保证 res.req === req
      const next = vi.fn();

      await runErrorHandler(errorHandler, bizErr, req, res, next);

      const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
      // P2-6 修复:trace 中间件提前后,errorHandler 兜底也现场生成 UUID,杜绝 'unknown'
      expect(body.traceId).not.toBe('unknown');
      expect(body.traceId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });

    it('should_extract_field_path_from_zod_error', async () => {
      const schema = z.object({
        email: z.string().email(),
      });
      let zodErr: ZodError | undefined;
      try {
        schema.parse({ email: 'not-an-email' });
      } catch (e) {
        zodErr = e as ZodError;
      }
      expect(zodErr).toBeDefined();

      const req = createMockReq();
      const res = createMockRes();
      const next = vi.fn();

      await runErrorHandler(errorHandler, zodErr, req, res, next);

      const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
      // 字段名应出现在错误信息中
      expect(body.message).toMatch(/email/);
    });
  });

  // ============================================================
  // notFoundHandler
  // ============================================================
  describe('notFoundHandler', () => {
    it('should_return_404_with_RESOURCE_NOT_FOUND', async () => {
      const req = createMockReq();
      const res = createMockRes();
      const next = vi.fn();

      await runHandler(notFoundHandler, req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(404);
      const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
      expect(body.code).toBe(ErrorCode.RESOURCE_NOT_FOUND);
      expect(body.message).toBe('资源不存在');
      expect(body.data).toBeNull();
    });

    it('should_generate_fallback_traceId_when_req_missing_traceId', async () => {
      const req = createMockReq({ traceId: undefined });
      const res = createMockRes(req); // 必须传入 req 以保证 res.req === req
      const next = vi.fn();

      await runHandler(notFoundHandler, req, res, next);

      const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
      // P2-6 修复:notFoundHandler 兜底也现场生成 UUID,杜绝 'unknown'
      expect(body.traceId).not.toBe('unknown');
      expect(body.traceId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });
  });

  // ============================================================
  // BusinessError 类
  // ============================================================
  describe('BusinessError', () => {
    it('should_construct_with_code_message_and_httpStatus', () => {
      const err = new BusinessError(ErrorCode.NOT_FOUND, '不存在', 404);
      expect(err.name).toBe('BusinessError');
      expect(err.code).toBe(ErrorCode.NOT_FOUND);
      expect(err.message).toBe('不存在');
      expect(err.httpStatus).toBe(404);
      expect(err instanceof Error).toBe(true);
    });

    it('should_construct_without_httpStatus', () => {
      const err = new BusinessError(ErrorCode.INTERNAL_ERROR, '内部错误');
      expect(err.code).toBe(ErrorCode.INTERNAL_ERROR);
      expect(err.httpStatus).toBeUndefined();
    });
  });
});

// ============================================================
// response utils 测试
// ============================================================

describe('utils/response (统一响应封装)', () => {
  describe('success', () => {
    it('should_return_200_with_code_zero_and_data', () => {
      const req = createMockReq();
      const res = createMockRes(req);
      success(res, { id: 1, name: 'test' });

      expect(res.status).toHaveBeenCalledWith(200);
      const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
      expect(body.code).toBe(0);
      expect(body.message).toBe('success');
      expect(body.data).toEqual({ id: 1, name: 'test' });
      expect(body.traceId).toBe('test-trace-id-eh');
    });

    it('should_use_custom_message_when_provided', () => {
      const req = createMockReq();
      const res = createMockRes(req);
      success(res, { ok: true }, '操作成功');

      const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
      expect(body.message).toBe('操作成功');
    });

    it('should_return_null_data_when_data_is_null', () => {
      const req = createMockReq();
      const res = createMockRes(req);
      success(res, null);

      const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
      expect(body.data).toBeNull();
    });
  });

  describe('error', () => {
    it('should_use_provided_http_status', () => {
      const req = createMockReq();
      const res = createMockRes(req);
      error(res, ErrorCode.FORBIDDEN, '禁止', 403);

      expect(res.status).toHaveBeenCalledWith(403);
      const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
      expect(body.code).toBe(ErrorCode.FORBIDDEN);
      expect(body.data).toBeNull();
    });

    it('should_lookup_http_status_from_error_code_table', () => {
      // 不传 httpStatus,从 ERROR_HTTP_STATUS 表查找
      const req = createMockReq();
      const res = createMockRes(req);
      error(res, ErrorCode.UNAUTHORIZED, '未授权');

      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('should_use_500_when_error_code_not_in_table', () => {
      // 使用一个不在表中的错误码(理论上不会发生,但兜底测试)
      const req = createMockReq();
      const res = createMockRes(req);
      // ErrorCode 9999 不在表中
      error(res, 9999 as ErrorCode, '未知错误');

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('paginated', () => {
    it('should_return_paginated_response_with_items_and_total', () => {
      const req = createMockReq();
      const res = createMockRes(req);
      paginated(res, {
        items: [{ id: 1 }, { id: 2 }],
        total: 2,
        page: 1,
        pageSize: 10,
        hasMore: false,
      });

      const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
      expect(body.code).toBe(0);
      expect(body.data.items).toHaveLength(2);
      expect(body.data.total).toBe(2);
      expect(body.data.hasMore).toBe(false);
    });

    it('should_use_custom_message', () => {
      const req = createMockReq();
      const res = createMockRes(req);
      paginated(
        res,
        { items: [], total: 0, page: 1, pageSize: 10, hasMore: false },
        '查询成功',
      );

      const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
      expect(body.message).toBe('查询成功');
    });
  });
});
