// ============================================================
// 举报路由(投诉举报机制,公安备案合规)
// 对应 API(顶层 /reports):
//   POST /reports    提交举报(任意登录角色)
//
// 挂载位置(src/app.ts):
//   - /api/v1/reports(项目业务路由统一前缀)
//   - /api/reports(契约字面路径别名,与前端团队契约保持一致)
// 管理端列表 GET /api/admin/reports 挂载于 src/routes/admin.routes.ts
//
// 中间件链路:authMiddleware → tenantMiddleware → apiRateLimiter
//            → reportRateLimiter → validate → handler
// 限流矩阵:
//   通用 API:60 次/分钟(对齐 /api/* 全局限流)
//   举报专属:5 次/分钟(公安备案合规防刷,REPORT_RATE_LIMIT_PER_MIN)
// ============================================================

import { Router } from 'express';
import { authMiddleware } from '../middlewares/auth.js';
import { tenantMiddleware } from '../middlewares/tenant.js';
import { apiRateLimiter, reportRateLimiter } from '../middlewares/rate-limit.js';
import { validate } from '../middlewares/validate.js';
import { createReport, createReportSchema } from '../controllers/report.controller.js';

export const reportRouter: Router = Router();

// ---------- 全局中间件 ----------
reportRouter.use(authMiddleware);
reportRouter.use(tenantMiddleware);
reportRouter.use(apiRateLimiter());
reportRouter.use(reportRateLimiter());

// ---------- 业务路由 ----------

// POST /reports - 提交举报(任意登录角色,body 经 Zod 校验)
reportRouter.post('/', validate({ body: createReportSchema }), createReport);
