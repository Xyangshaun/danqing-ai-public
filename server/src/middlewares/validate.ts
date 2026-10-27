// ============================================================
// 请求参数校验中间件(Zod)
// 对应文档:auth-design.md §0 C11 + api-contract-v1.md §1.2
// 所有外部输入(query/params/body/headers)必须经 Zod 校验
// ============================================================

import type { RequestHandler } from 'express';
import type { ZodSchema, ZodTypeAny } from 'zod';

interface ValidationSchemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
  headers?: ZodTypeAny;
}

/**
 * 通用校验中间件工厂
 * @param schemas 各部分的 Zod schema
 * @throws ZodError(由 errorHandler 转换为 1001 PARAM_INVALID)
 */
export function validate(schemas: ValidationSchemas): RequestHandler {
  return (req, _res, next) => {
    try {
      if (schemas.body) {
        req.body = schemas.body.parse(req.body) as unknown;
      }
      if (schemas.query) {
        const parsed = schemas.query.parse(req.query) as unknown;
        // 覆盖 req.query(Express 中 query 是只读的,通过类型断言赋值)
        (req as unknown as { query: unknown }).query = parsed;
      }
      if (schemas.params) {
        const parsed = schemas.params.parse(req.params) as unknown;
        (req as unknown as { params: unknown }).params = parsed;
      }
      if (schemas.headers) {
        schemas.headers.parse(req.headers);
      }
      next();
    } catch (err) {
      next(err); // 交给 errorHandler 处理
    }
  };
}

/**
 * 校验 schema 是否符合类型(编译期类型推导辅助)
 * 用于确保 Zod schema 与 api-contract.ts 中的 TS 类型一致
 */
export function inferSchema<T>(schema: ZodSchema<T>): ZodSchema<T> {
  return schema;
}
