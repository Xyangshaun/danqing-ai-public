// ============================================================
// 用户在线状态 Presence 查询 Controller(M4-BE-2,P-09)
// 对应 API(契约 api-contract.ts §3.12,已冻结):
//   GET /api/admin/presence/users?ids=a,b,c   批量查询用户三态(单次上限 100)
//   GET /api/admin/presence/online            在线用户清单(含 online/idle/offline 汇总)
//
// 职责:
//   1. Zod 校验 query 参数(失败抛 ZodError → errorHandler 转 1001 PARAM_INVALID)
//      - ids 上限校验在进入 service 前完成(>100 → 1001)
//   2. 调用 presenceService 获取纯数据对象
//      (Redis 故障降级由 service 内部处理,读路径绝不 5xx;
//       controller 仅兜底 catch → next(err) → 9001,正常不应触发)
//   3. 返回统一成功响应(success 包装:{code:0,message,data,traceId})
//
// 权限(复用现有权限码,不新增):
//   - /presence/users  → admin:user:read(与用户列表同款)
//   - /presence/online → admin:stats:read(与数据看板同款)
//
// 安全:契约仅暴露 userId/三态/lastSeenAt/client/activeSessions,
//       禁止返回 ip/userAgent/sessionId 等敏感明细(service 载荷中的
//       sessionId 仅用于内部调试,不出现在 UserPresenceEntry)
// ============================================================

import type { RequestHandler } from 'express';
import { z } from 'zod';
import { success } from '../utils/response.js';
import { presenceService } from '../services/presence.service.js';

/** 批量查询 ids 上限(契约 §3.12:单次最多 100 个 userId) */
const PRESENCE_IDS_MAX = 100;

/**
 * GET /presence/users 查询参数 Zod 校验
 * - ids 必填字符串,逗号分隔 userId 列表(每段 trim 后必须非空)
 * - 解析后数组长度 ≤ 100,超限在进入 service 前拦截(→ 1001)
 *
 * 说明:ids=a&ids=b(重复 key)会被 Express 解析为 string[],
 * z.string() 直接拒绝 → 1001,语义正确(仅接受逗号分隔单值)
 */
const listPresenceUsersQuerySchema = z.object({
  ids: z
    .string({ required_error: 'ids 为必填参数', invalid_type_error: 'ids 必须为逗号分隔字符串' })
    .min(1, 'ids 不能为空')
    .transform((raw) => raw.split(',').map((part) => part.trim()))
    .pipe(
      z
        .array(z.string().min(1, 'ids 包含空 userId'))
        .max(PRESENCE_IDS_MAX, `ids 单次最多 ${PRESENCE_IDS_MAX} 个`),
    ),
});

/**
 * GET /api/admin/presence/users?ids=a,b,c - 批量查询用户三态
 * 权限:admin:user:read
 * 响应 data:PresenceBatchResponse = { items: UserPresenceEntry[], asOf: string }
 *   items 顺序与入参 ids 一致(由 service 保证)
 */
export const listPresenceUsers: RequestHandler = async (req, res, next) => {
  try {
    // Zod 校验 query(失败抛 ZodError → errorHandler 转 1001 PARAM_INVALID)
    const parsed = listPresenceUsersQuerySchema.parse(req.query);
    const data = await presenceService.getBatch(parsed.ids);
    return success(res, data, 'success');
  } catch (err) {
    return next(err);
  }
};

/**
 * GET /api/admin/presence/online - 在线用户清单(含三态汇总)
 * 权限:admin:stats:read
 * 响应 data:PresenceOnlineResponse = {
 *   items: UserPresenceEntry[],
 *   summary: { online, idle, offline },
 *   asOf: string,
 * }
 */
export const listPresenceOnline: RequestHandler = async (_req, res, next) => {
  try {
    const data = await presenceService.getOnline();
    return success(res, data, 'success');
  } catch (err) {
    return next(err);
  }
};
