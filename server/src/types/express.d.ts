// ============================================================
// Express Request 类型扩展
// 在 auth/tenant/trace 中间件中注入额外字段
// 对应文档:auth-design.md §2.4(中间件注入 tenant_id)
// ============================================================

import type { ClientType, UserRole } from './api-contract.js';
import type { AuthType } from './arbitration.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** traceId,由 trace 中间件生成或回显 X-Trace-Id 头 */
      traceId: string;
      /** 用户 ID,auth 中间件从 JWT sub 注入;未鉴权时为 undefined */
      userId?: string;
      /** 当前激活租户 ID,auth 中间件从 JWT payload 注入;未鉴权时为 undefined */
      tenantId?: string;
      /** 当前用户角色,auth 中间件从 JWT role 注入 */
      role?: UserRole;
      /** 飞书 open_id,仅作审计关联,不作信任依据 */
      feishuOpenId?: string;
      /** Phase 5:认证方式(feishu/phone/invitation/password),旧 token 缺省为 'feishu' */
      authType?: AuthType;
      /** JWT jti,用于 access_token 撤销查询 */
      jti?: string;
      /** 客户端类型(web/admin/mobile/marketing) */
      client?: ClientType;
      /** 设备指纹(从 X-Client-Context 头解析) */
      deviceId?: string;
    }
  }
}

export {};
