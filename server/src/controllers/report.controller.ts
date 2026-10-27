// ============================================================
// 举报 Controller(投诉举报机制,公安备案合规)
// 对应 API:
//   POST /api/v1/reports       提交举报(任意登录角色)
//   GET  /api/admin/reports    举报分页列表(仅 ADMIN/OWNER,admin.routes 挂载)
//
// 所有输入经 Zod 校验;tenantId/userId 从 JWT 注入,禁止从请求体读取
// 响应统一走 utils/response.ts(success/created/paginated),禁止裸 res.json
// ============================================================

import type { RequestHandler } from 'express';
import { z } from 'zod';
import { reportService } from '../services/report.service.js';
import { error, created, paginated } from '../utils/response.js';
import { ErrorCode } from '../types/api-contract.js';
import type { ReportStatus } from '../types/api-contract.js';

// ============================================================
// Zod Schemas
// ============================================================

/** POST /api/v1/reports 请求体校验 */
export const createReportSchema = z.object({
  targetType: z.enum(['artwork', 'comment', 'user'], {
    errorMap: () => ({ message: 'targetType 必须为 artwork/comment/user 之一' }),
  }),
  targetId: z
    .string({ required_error: '缺少必填参数:targetId' })
    .min(1, '缺少必填参数:targetId')
    .max(64, 'targetId 长度超限'),
  reason: z.enum(['porn', 'violence', 'politics', 'copyright', 'spam', 'other'], {
    errorMap: () => ({ message: 'reason 必须为 porn/violence/politics/copyright/spam/other 之一' }),
  }),
  detail: z
    .string()
    .max(500, '举报说明最长 500 字')
    .optional(),
});

/** GET /api/admin/reports 查询参数校验(分页默认 page=1, pageSize=20) */
const listReportsQuerySchema = z.object({
  status: z.enum(['pending', 'resolved', 'dismissed']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

// ============================================================
// Handlers
// ============================================================

/** POST /api/v1/reports - 提交举报(任意登录角色) */
export const createReport: RequestHandler = async (req, res, next) => {
  try {
    if (!req.userId || !req.tenantId) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }
    // 防御性复验(路由层 validate 中间件已校验,此处兜底保证直接调用安全)
    const parsed = createReportSchema.safeParse(req.body);
    if (!parsed.success) {
      return error(res, ErrorCode.PARAM_INVALID, parsed.error.issues[0]?.message ?? '参数错误', 400);
    }
    const data = await reportService.createReport({
      tenantId: req.tenantId,
      reporterId: req.userId,
      targetType: parsed.data.targetType,
      targetId: parsed.data.targetId,
      reason: parsed.data.reason,
      detail: parsed.data.detail,
    });
    return created(res, data, '举报已提交');
  } catch (err) {
    return next(err);
  }
};

/** GET /api/admin/reports - 举报分页列表(仅 ADMIN/OWNER) */
export const listReports: RequestHandler = async (req, res, next) => {
  try {
    if (!req.userId || !req.tenantId) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }
    const parsed = listReportsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return error(res, ErrorCode.PARAM_INVALID, parsed.error.issues[0]?.message ?? '参数错误', 400);
    }
    const { status, page, pageSize } = parsed.data;

    // 多租户强制:仅返回当前租户举报(req.tenantId 来自 JWT)
    const result = await reportService.listForAdmin({
      tenantId: req.tenantId,
      status: status as ReportStatus | undefined,
      page,
      pageSize,
    });

    return paginated(res, {
      items: result.items,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      hasMore: result.page * result.pageSize < result.total,
    });
  } catch (err) {
    return next(err);
  }
};
