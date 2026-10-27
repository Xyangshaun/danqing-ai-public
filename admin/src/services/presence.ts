// ============================================================
// 用户在线状态 Presence API(M4-ADM-1)
// 对应后端:GET /api/admin/presence/users(权限 admin:user:read)
// 注意:单次 ids 上限 100,调用方需自行分批/截断
// ============================================================

import { get } from './request';
import type { PresenceBatchResponse } from './types';

/** presence/users 单次查询 ids 上限(与后端一致) */
export const PRESENCE_IDS_LIMIT = 100;

/**
 * GET /api/admin/presence/users?ids=a,b,c - 批量查询用户实时在线状态
 * 超出 100 个 ids 自动截断(列表单页 pageSize ≤ 100,正常不会触发)
 * 失败静默降级:携带 X-Silent 头(跳过全局错误 toast),并返回空 items,
 * 由调用方渲染占位;列表其余功能不受影响。
 */
export function getUsersPresence(ids: string[]): Promise<PresenceBatchResponse> {
  const uniqueIds = [...new Set(ids)].slice(0, PRESENCE_IDS_LIMIT);
  return get<PresenceBatchResponse>(
    '/api/admin/presence/users',
    { ids: uniqueIds.join(',') },
    { headers: { 'X-Silent': '1' } },
  ).catch(() => ({ items: [], asOf: new Date().toISOString() }));
}
