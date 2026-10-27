// ============================================================
// 租户路由
// 对应 API:
//   GET    /tenants/current                       (需鉴权 + tenant:read)
//   POST   /tenants/switch                        (需鉴权 + tenant:switch)
//   GET    /tenants                               (需鉴权 + tenant:read)
//   GET    /tenants/:id/members                   (需鉴权 + user:read)
//   POST   /tenants/:id/members                   (需鉴权 + user:invite)
//   DELETE /tenants/:id/members/:userId           (需鉴权 + user:remove)
// ============================================================

import { Router } from 'express';
import {
  getCurrentTenant,
  switchTenant,
  listUserTenants,
  listMembers,
  inviteMember,
  removeMember,
} from '../controllers/tenant.controller.js';
import { authMiddleware } from '../middlewares/auth.js';
import { tenantMiddleware } from '../middlewares/tenant.js';
import { apiRateLimiter } from '../middlewares/rate-limit.js';
import {
  requirePermission,
} from '../middlewares/permission.js';

export const tenantRouter: Router = Router();

// ---------- 全局中间件 ----------
tenantRouter.use(authMiddleware);
tenantRouter.use(tenantMiddleware);
tenantRouter.use(apiRateLimiter());

// ---------- 业务路由 ----------

// GET /tenants/current - 获取当前激活租户信息
tenantRouter.get('/current', requirePermission('tenant:read'), getCurrentTenant);

// POST /tenants/switch - 切换激活租户(重签 access_token)
tenantRouter.post('/switch', requirePermission('tenant:switch'), switchTenant);

// GET /tenants - 列出当前用户的所有租户成员关系
tenantRouter.get('/', requirePermission('tenant:read'), listUserTenants);

// GET /tenants/:id/members - 列出租户成员(需 user:read)
tenantRouter.get('/:id/members', requirePermission('user:read'), listMembers);

// POST /tenants/:id/members - 邀请成员(需 user:invite)
tenantRouter.post('/:id/members', requirePermission('user:invite'), inviteMember);

// DELETE /tenants/:id/members/:userId - 移除成员(需 user:remove)
tenantRouter.delete('/:id/members/:userId', requirePermission('user:remove'), removeMember);
