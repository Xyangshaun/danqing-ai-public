// ============================================================
// 统一错误处理中间件
// 对应文档:auth-design.md §0 C11(默认拒绝)+ §0 C12(日志脱敏)
// 所有未捕获异常在此处理,禁止向客户端暴露内部堆栈
// ============================================================

import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ErrorCode } from '../types/api-contract.js';
import { error } from '../utils/response.js';
import { logger } from '../utils/logger.js';
import { generateUuid } from '../utils/crypto.js';
import { ZodError } from 'zod';

/**
 * 业务错误类
 * 用于 service/controller 抛出携带错误码的业务异常
 */
export class BusinessError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus?: number;
  /** 可选附加业务元数据,P0 深度诊断黑盒修复新增:用于透传 failureReason/debugHint/aiMeta */
  readonly data?: Record<string, unknown>;
  constructor(
    code: ErrorCode,
    message: string,
    httpStatus?: number,
    data?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'BusinessError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.data = data;
  }
}

/**
 * 统一错误处理中间件(必须放在所有路由之后)
 * 4 个参数签名是 Express 识别错误中间件的硬性要求
 */
export const errorHandler: ErrorRequestHandler = (
  err: unknown,
  req,
  res,
  _next,
) => {
  // 确保 traceId 已注入(trace 中间件若未跑过则现场生成 UUID,避免 'unknown' 断链)
  if (!req.traceId) {
    req.traceId = generateUuid();
    logger.warn({ traceId: req.traceId }, '[error] trace middleware skipped, generated fallback traceId');
  }

  // 1. Zod 校验错误 → 1001 PARAM_INVALID
  if (err instanceof ZodError) {
    const first = err.issues[0];
    const field = first?.path.join('.') ?? 'unknown';
    const msg = `参数错误:${field} ${first?.message ?? 'invalid'}`;
    logger.warn({ traceId: req.traceId, err: msg, issues: err.issues }, '[error] zod validation');
    return error(res, ErrorCode.PARAM_INVALID, msg, 400);
  }

  // 2. 业务错误(显式抛出 BusinessError)
  if (err instanceof BusinessError) {
    logger.warn(
      { traceId: req.traceId, code: err.code, msg: err.message, data: err.data },
      '[error] business error',
    );
    return error(res, err.code, err.message, err.httpStatus, err.data);
  }

  // 2b. body-parser 错误(express.json/urlencoded 解析层)
  // - entity.parse.failed:请求体 JSON 语法错误 → 400(否则会被兜底为 500,语义错误)
  // - entity.too.large:请求体超过 express.json limit → 413
  const errType = (err as { type?: string } | null)?.type;
  if (errType === 'entity.parse.failed') {
    logger.warn({ traceId: req.traceId }, '[error] body parse failed');
    return error(res, ErrorCode.PARAM_INVALID, '请求体 JSON 格式错误', 400);
  }
  if (errType === 'entity.too.large') {
    logger.warn({ traceId: req.traceId }, '[error] body too large');
    return error(res, ErrorCode.FILE_TOO_LARGE, '请求体过大', 413);
  }

  // 3. Prisma 错误(简化处理,生产环境应细分 P2002 唯一约束冲突等)
  if (err instanceof Error && err.name.startsWith('PrismaClient')) {
    logger.error({ traceId: req.traceId, err: err.message, name: err.name }, '[error] prisma');
    return error(res, ErrorCode.DATABASE_ERROR, '数据库错误', 500);
  }

  // 4. 其他未知错误 → 9001 INTERNAL_ERROR(不暴露堆栈)
  const msg = err instanceof Error ? err.message : String(err);
  logger.error(
    { traceId: req.traceId, err: msg, stack: err instanceof Error ? err.stack : undefined },
    '[error] internal',
  );
  return error(res, ErrorCode.INTERNAL_ERROR, '服务器内部错误', 500);
};

/**
 * 404 兜底处理(无匹配路由)
 */
export const notFoundHandler: RequestHandler = (req, res) => {
  if (!req.traceId) {
    req.traceId = generateUuid();
  }
  return error(res, ErrorCode.RESOURCE_NOT_FOUND, '资源不存在', 404);
};
