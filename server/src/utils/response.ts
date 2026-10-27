// ============================================================
// 统一响应封装
// 对应文档:api-contract-v1.md §1.2 ApiResponse<T>
// 所有 controller 必须通过本工具返回响应,禁止裸 res.json
// ============================================================

import type { Response } from 'express';
import type { ApiResponse, ErrorCode } from '../types/api-contract.js';
import { ERROR_HTTP_STATUS } from '../types/api-contract.js';

/**
 * 成功响应
 * @param res Express Response
 * @param data 业务数据
 * @param message 人类可读的提示信息(中文)
 */
export function success<T>(res: Response, data: T, message = 'success'): void {
  const body: ApiResponse<T> = {
    code: 0,
    message,
    data,
    traceId: res.req.traceId,
  };
  res.status(200).json(body);
}

/**
 * 错误响应
 * @param res Express Response
 * @param code 业务错误码(见 ErrorCode 枚举)
 * @param message 人类可读的错误信息(中文,禁止包含敏感信息/堆栈)
 * @param httpStatus 可选覆盖 HTTP 状态码;不传则按错误码查表
 * @param data 可选附加错误元数据(如 failureReason/debugHint/阶段耗时);P0 深度诊断黑盒修复新增
 */
export function error(
  res: Response,
  code: ErrorCode,
  message: string,
  httpStatus?: number,
  data?: unknown,
): void {
  const status = httpStatus ?? ERROR_HTTP_STATUS[code] ?? 500;
  const body: ApiResponse<unknown> = {
    code,
    message,
    data: data ?? null,
    traceId: res.req.traceId,
  };
  res.status(status).json(body);
}

/**
 * 创建成功响应(HTTP 201)
 * 用于资源创建类接口(POST),如生成任务 POST /generation
 * 响应体格式与 success 完全一致,仅 HTTP 状态码为 201
 */
export function created<T>(res: Response, data: T, message = 'created'): void {
  const body: ApiResponse<T> = {
    code: 0,
    message,
    data,
    traceId: res.req.traceId,
  };
  res.status(201).json(body);
}

/**
 * 分页响应快捷方法
 */
export function paginated<T>(
  res: Response,
  data: {
    items: T[];
    total: number;
    page: number;
    pageSize: number;
    hasMore: boolean;
  },
  message = 'success',
): void {
  success(res, data, message);
}
