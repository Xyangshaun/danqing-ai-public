// ============================================================
// AI 图像生成路由(M2-T5)
// 对应 API(冻结契约 api-contract.ts §3.17):
//   POST /generation    (创建生成任务,需鉴权 + CSRF + Zod body 校验)
//   GET  /generation/:id(查询生成任务,需鉴权)
//
// 对应文档:.trae/documents/m2-generation-plan-2026-08-07.md §4
//
// 中间件组合顺序(auth → tenant → rateLimiter → [csrf] → controller):
//   1. authMiddleware:JWT 鉴权,注入 req.userId/req.tenantId/req.role(多租户)
//   2. tenantMiddleware:校验 tenantId 存在(强制多租户隔离)
//   3. apiRateLimiter:全局限流(默认 60 次/分钟/用户)
//   4. csrfMiddleware(POST 写操作):双提交 Cookie 校验,仅当请求携带
//      refresh_token Cookie 时启用;纯 Bearer token 调用不适用 CSRF
//   5. 参数校验在 controller 层(Zod),结构校验失败 → PARAM_INVALID(1001)
//
// 权限说明:permissions.ts 无 generation 专用权限定义,按任务指令
// "若无专门权限则用通用认证",此处不挂 requirePermission,仅通用鉴权;
// 生成配额/单用户限流(6106)由 service 层 checkRateLimit 独立护栏兜底
// ============================================================

import { Router } from 'express';
import {
  createGeneration,
  getGeneration,
} from '../controllers/generation.controller.js';
import { authMiddleware } from '../middlewares/auth.js';
import { tenantMiddleware } from '../middlewares/tenant.js';
import { apiRateLimiter } from '../middlewares/rate-limit.js';
import { csrfMiddleware } from '../middlewares/csrf.js';

export const generationRouter: Router = Router();

// ---------- 全局中间件(与 analysis.routes 同源组合)----------
generationRouter.use(authMiddleware);
generationRouter.use(tenantMiddleware);
generationRouter.use(apiRateLimiter());

// ---------- 业务路由 ----------

// POST /generation - 创建生成任务(鉴权 + CSRF + controller Zod 校验)
// 返回 201 + CreateGenerationResponse(pending 或降级同步最终状态)
generationRouter.post('/', csrfMiddleware, createGeneration);

// GET /generation/:id - 查询生成任务详情(鉴权)
// 数据范围过滤由 service 层基于 req.role 实现(跨租户/越权 → 404)
generationRouter.get('/:id', getGeneration);
