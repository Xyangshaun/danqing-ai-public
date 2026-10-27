// ============================================================
// Presence 查询 Controller 契约测试(M4-BE-2,P-09)
// 对应源码:src/controllers/presence.controller.ts + src/routes/admin.routes.ts
// 对应契约:api-contract.ts §3.12(PresenceBatchResponse / PresenceOnlineResponse,已冻结)
//
// 测试范围(HTTP 接入层,严格按冻结契约):
//   1. 鉴权:无 Authorization → 401,service 不被调用
//   2. 权限码挂载:/presence/users → admin:user:read;/presence/online → admin:stats:read
//   3. 越权:权限中间件拒绝 → 403 + code 2004,service 不被调用
//   4. 正常返回:
//      - GET /presence/users?ids=a,b,c → 200 + PresenceBatchResponse(items/asOf)
//      - GET /presence/online → 200 + PresenceOnlineResponse(items/summary/asOf)
//      - 入参 ids 解析后原序透传给 service(trim 生效)
//   5. 参数错误 → 400 + code 1001(进入 service 前拦截):
//      ids 缺失 / 空串 / 空段(a,,b)/ 重复 key / 超 100 上限;边界 100 个 → 200
//   6. 兜底:service 抛未知异常 → 500 + code 9001,不暴露内部消息
//
// Mock 策略(与 metrics.controller.test.ts 一致):
//   - mock auth/tenant/rate-limit/permission 中间件(注入测试用户 + 放行限流;
//     权限中间件可通过 __permState.allow 切换放行/拒绝,并记录注册时权限码)
//   - mock presenceService(纯数据对象,不经过真实 Redis/Prisma)
//   - 测试 app 前置注入 req.traceId,验证响应包装携带 traceId
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { adminRouter } from '../src/routes/admin.routes.js';
import { errorHandler } from '../src/middlewares/error-handler.js';
import { ErrorCode } from '../src/types/api-contract.js';
import type {
  PresenceBatchResponse,
  PresenceOnlineResponse,
  UserPresenceEntry,
} from '../src/types/api-contract.js';

// ============================================================
// vi.hoisted:声明 mock 对象 + 可变测试状态
// ============================================================
const {
  mockAuth,
  mockTenant,
  mockRateLimit,
  mockPermission,
  mockPresenceService,
  __authState,
  __permState,
} = vi.hoisted(() => {
  const authState: { role: string; tenantId: string; userId: string } = {
    role: 'owner',
    tenantId: 't-owner',
    userId: 'u-owner',
  };
  // 权限放行开关:true=放行(模拟已授权 ADMIN/OWNER);false=拒绝(模拟越权 → 403/2004)
  const permState: { allow: boolean } = { allow: true };
  return {
    // 模拟 auth 中间件:无 Bearer → 401;否则按 authState 注入
    mockAuth: vi.fn((req: any, res: any, next: () => void) => {
      const auth = req.header('Authorization') as string | undefined;
      if (!auth || !auth.startsWith('Bearer ')) {
        return res
          .status(401)
          .json({ code: ErrorCode.UNAUTHORIZED, message: '未授权,请先登录', data: null, traceId: 'test-trace' });
      }
      req.userId = authState.userId;
      req.tenantId = authState.tenantId;
      req.role = authState.role;
      req.feishuOpenId = 'open-presence-test';
      req.authType = 'feishu';
      req.jti = 'jti-presence-test';
      return next();
    }),
    // 模拟 tenant 中间件:直接放行(auth 已注入 tenantId)
    mockTenant: vi.fn((_req: any, _res: any, next: () => void) => next()),
    // 模拟限流中间件:apiRateLimiter() 返回放行中间件
    mockRateLimit: vi.fn(() => vi.fn((_req: any, _res: any, next: () => void) => next())),
    // 模拟权限中间件:requirePermission(perm) 在路由注册时记录 perm(挂到返回中间件的 __perm 上),
    // 请求期按 permState.allow 放行或按真实 deny 语义拒绝(403 + FORBIDDEN)
    mockPermission: vi.fn((perm: string) => {
      const mw = vi.fn((req: any, res: any, next: () => void) => {
        if (!permState.allow) {
          return res.status(403).json({
            code: ErrorCode.FORBIDDEN,
            message: '权限不足',
            data: null,
            traceId: req.traceId ?? 'test-trace',
          });
        }
        return next();
      });
      (mw as any).__perm = perm;
      return mw;
    }),
    // 模拟 presenceService(返回纯数据对象,不含 ApiResponse 包装)
    mockPresenceService: {
      getBatch: vi.fn(),
      getOnline: vi.fn(),
    },
    __authState: authState,
    __permState: permState,
  };
});

vi.mock('../src/middlewares/auth.js', () => ({ authMiddleware: mockAuth }));
vi.mock('../src/middlewares/tenant.js', () => ({ tenantMiddleware: mockTenant }));
vi.mock('../src/middlewares/rate-limit.js', () => ({ apiRateLimiter: mockRateLimit }));
vi.mock('../src/middlewares/permission.js', () => ({ requirePermission: mockPermission }));
vi.mock('../src/services/presence.service.js', () => ({
  presenceService: mockPresenceService,
}));

// ============================================================
// 用 express() 包裹 adminRouter + 挂载 errorHandler(与真实 app.ts 行为一致)
// 前置注入 req.traceId(真实环境由 trace 中间件注入)
// ============================================================
const TRACE_ID = 'test-trace-presence';
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.traceId = TRACE_ID;
  next();
});
app.use(adminRouter);
app.use(errorHandler);

/** 有效 Bearer 头 */
const AUTH = 'Bearer test-access-token';

/** 构造 UserPresenceEntry(冻结契约字段) */
function makeEntry(userId: string, overrides: Partial<UserPresenceEntry> = {}): UserPresenceEntry {
  return {
    userId,
    state: 'online',
    lastSeenAt: '2026-08-08T10:00:00.000Z',
    client: 'web',
    activeSessions: 1,
    ...overrides,
  };
}

/** 构造 PresenceBatchResponse(冻结契约字段) */
function makeBatchResponse(userIds: string[]): PresenceBatchResponse {
  return {
    items: userIds.map((id) => makeEntry(id)),
    asOf: '2026-08-08T10:00:01.000Z',
  };
}

/** 构造 PresenceOnlineResponse(冻结契约字段) */
function makeOnlineResponse(): PresenceOnlineResponse {
  return {
    items: [
      makeEntry('u-on-1'),
      makeEntry('u-idle-1', {
        state: 'idle',
        lastSeenAt: '2026-08-08T09:00:00.000Z',
        client: null,
        activeSessions: 2,
      }),
    ],
    summary: { online: 1, idle: 1, offline: 0 },
    asOf: '2026-08-08T10:00:01.000Z',
  };
}

/**
 * 从 adminRouter 栈中读取指定 GET 路由注册的权限码
 * (requirePermission mock 将权限码挂在返回中间件的 __perm 属性上)
 */
function findRoutePermission(path: string): string | undefined {
  const stack = (adminRouter as unknown as { stack: any[] }).stack;
  const layer = stack.find((l) => l?.route?.path === path && l?.route?.methods?.get === true);
  if (!layer) return undefined;
  const handles = (layer.route.stack ?? []) as any[];
  const permHandle = handles.find((h) => typeof h?.handle?.__perm === 'string');
  return permHandle?.handle?.__perm as string | undefined;
}

beforeEach(() => {
  vi.clearAllMocks();
  // 默认:平台 owner 身份 + 权限放行 + service 返回正常数据
  __authState.role = 'owner';
  __authState.tenantId = 't-owner';
  __authState.userId = 'u-owner';
  __permState.allow = true;
  mockPresenceService.getBatch.mockResolvedValue(makeBatchResponse(['u-a', 'u-b', 'u-c']));
  mockPresenceService.getOnline.mockResolvedValue(makeOnlineResponse());
});

// ------------------------------------------------------------
// 鉴权
// ------------------------------------------------------------

describe('presence 路由鉴权', () => {
  it('GET /presence/users 无 Authorization → 401,service 不被调用', async () => {
    const res = await request(app).get('/presence/users').query({ ids: 'u-a' });

    expect(res.status).toBe(401);
    expect(mockPresenceService.getBatch).not.toHaveBeenCalled();
  });

  it('GET /presence/online 无 Authorization → 401,service 不被调用', async () => {
    const res = await request(app).get('/presence/online');

    expect(res.status).toBe(401);
    expect(mockPresenceService.getOnline).not.toHaveBeenCalled();
  });
});

// ------------------------------------------------------------
// 权限码挂载(复用现有权限码,不新增)
// ------------------------------------------------------------

describe('presence 路由权限码挂载', () => {
  it('GET /presence/users 注册权限码为 admin:user:read', () => {
    expect(findRoutePermission('/presence/users')).toBe('admin:user:read');
  });

  it('GET /presence/online 注册权限码为 admin:stats:read', () => {
    expect(findRoutePermission('/presence/online')).toBe('admin:stats:read');
  });
});

// ------------------------------------------------------------
// 越权(权限中间件拒绝 → 403 + 2004)
// ------------------------------------------------------------

describe('presence 越权拒绝', () => {
  it('GET /presence/users 无权限 → 403 + code 2004 + data null,service 不被调用', async () => {
    __permState.allow = false;

    const res = await request(app).get('/presence/users').set('Authorization', AUTH).query({ ids: 'u-a' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe(ErrorCode.FORBIDDEN);
    expect(res.body.data).toBeNull();
    expect(res.body.traceId).toBe(TRACE_ID);
    expect(mockPresenceService.getBatch).not.toHaveBeenCalled();
  });

  it('GET /presence/online 无权限 → 403 + code 2004 + data null,service 不被调用', async () => {
    __permState.allow = false;

    const res = await request(app).get('/presence/online').set('Authorization', AUTH);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe(ErrorCode.FORBIDDEN);
    expect(res.body.data).toBeNull();
    expect(mockPresenceService.getOnline).not.toHaveBeenCalled();
  });
});

// ------------------------------------------------------------
// GET /presence/users 正常返回(冻结契约)
// ------------------------------------------------------------

describe('GET /presence/users 正常返回(冻结契约)', () => {
  it('ids=a,b,c → 200 + {code:0,data:{items,asOf},traceId}', async () => {
    const res = await request(app)
      .get('/presence/users')
      .set('Authorization', AUTH)
      .query({ ids: 'u-a,u-b,u-c' });

    expect(res.status).toBe(200);
    expect(res.body.code).toBe(0);
    expect(res.body.message).toBe('success');
    expect(res.body.traceId).toBe(TRACE_ID);
    // 冻结契约结构:items + asOf
    expect(res.body.data.asOf).toBe('2026-08-08T10:00:01.000Z');
    expect(res.body.data.items).toHaveLength(3);
    const [first] = res.body.data.items as UserPresenceEntry[];
    // 契约字段:userId/state/lastSeenAt/client/activeSessions(无 ip/userAgent/sessionId)
    expect(first).toEqual({
      userId: 'u-a',
      state: 'online',
      lastSeenAt: '2026-08-08T10:00:00.000Z',
      client: 'web',
      activeSessions: 1,
    });
    expect(first).not.toHaveProperty('sessionId');
    expect(first).not.toHaveProperty('ip');
    expect(first).not.toHaveProperty('userAgent');
  });

  it('ids 解析后原序透传 service(含 trim)', async () => {
    const res = await request(app)
      .get('/presence/users')
      .set('Authorization', AUTH)
      .query({ ids: ' u-a , u-b ,u-c' });

    expect(res.status).toBe(200);
    expect(mockPresenceService.getBatch).toHaveBeenCalledTimes(1);
    expect(mockPresenceService.getBatch).toHaveBeenCalledWith(['u-a', 'u-b', 'u-c']);
  });

  it('边界:恰好 100 个 ids → 200', async () => {
    const ids = Array.from({ length: 100 }, (_, i) => `u-${i}`);
    mockPresenceService.getBatch.mockResolvedValue(makeBatchResponse(ids));

    const res = await request(app)
      .get('/presence/users')
      .set('Authorization', AUTH)
      .query({ ids: ids.join(',') });

    expect(res.status).toBe(200);
    expect(res.body.code).toBe(0);
    expect(mockPresenceService.getBatch).toHaveBeenCalledWith(ids);
  });
});

// ------------------------------------------------------------
// GET /presence/users 参数错误(1001,进入 service 前拦截)
// ------------------------------------------------------------

describe('GET /presence/users 参数校验(1001)', () => {
  it('ids 缺失 → 400 + code 1001 + data null,service 不被调用', async () => {
    const res = await request(app).get('/presence/users').set('Authorization', AUTH);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe(ErrorCode.PARAM_INVALID);
    expect(res.body.data).toBeNull();
    expect(res.body.traceId).toBe(TRACE_ID);
    expect(mockPresenceService.getBatch).not.toHaveBeenCalled();
  });

  it('ids 为空串 → 400 + code 1001', async () => {
    const res = await request(app).get('/presence/users').set('Authorization', AUTH).query({ ids: '' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe(ErrorCode.PARAM_INVALID);
    expect(mockPresenceService.getBatch).not.toHaveBeenCalled();
  });

  it('ids 含空段(a,,b)→ 400 + code 1001', async () => {
    const res = await request(app).get('/presence/users').set('Authorization', AUTH).query({ ids: 'a,,b' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe(ErrorCode.PARAM_INVALID);
    expect(mockPresenceService.getBatch).not.toHaveBeenCalled();
  });

  it('ids 重复 key(ids=a&ids=b 解析为数组)→ 400 + code 1001', async () => {
    const res = await request(app).get('/presence/users').set('Authorization', AUTH).query('ids=a&ids=b');

    expect(res.status).toBe(400);
    expect(res.body.code).toBe(ErrorCode.PARAM_INVALID);
    expect(mockPresenceService.getBatch).not.toHaveBeenCalled();
  });

  it('ids 超上限(101 个)→ 400 + code 1001,进入 service 前拦截', async () => {
    const ids = Array.from({ length: 101 }, (_, i) => `u-${i}`);

    const res = await request(app)
      .get('/presence/users')
      .set('Authorization', AUTH)
      .query({ ids: ids.join(',') });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe(ErrorCode.PARAM_INVALID);
    expect(res.body.data).toBeNull();
    expect(mockPresenceService.getBatch).not.toHaveBeenCalled();
  });
});

// ------------------------------------------------------------
// GET /presence/online 正常返回(冻结契约)
// ------------------------------------------------------------

describe('GET /presence/online 正常返回(冻结契约)', () => {
  it('→ 200 + {code:0,data:{items,summary:{online,idle,offline},asOf},traceId}', async () => {
    const res = await request(app).get('/presence/online').set('Authorization', AUTH);

    expect(res.status).toBe(200);
    expect(res.body.code).toBe(0);
    expect(res.body.message).toBe('success');
    expect(res.body.traceId).toBe(TRACE_ID);
    // 冻结契约结构:items + summary + asOf
    expect(res.body.data.asOf).toBe('2026-08-08T10:00:01.000Z');
    expect(res.body.data.summary).toEqual({ online: 1, idle: 1, offline: 0 });
    expect(res.body.data.items).toHaveLength(2);
    expect(mockPresenceService.getOnline).toHaveBeenCalledTimes(1);
  });
});

// ------------------------------------------------------------
// 兜底:service 未知异常 → 500 + 9001(正常不应触发:service 读路径内部已降级)
// ------------------------------------------------------------

describe('presence 兜底异常(9001)', () => {
  it('getBatch 抛未知异常 → 500 + code 9001,不暴露内部消息', async () => {
    mockPresenceService.getBatch.mockRejectedValue(new Error('boom-internal-detail'));

    const res = await request(app).get('/presence/users').set('Authorization', AUTH).query({ ids: 'u-a' });

    expect(res.status).toBe(500);
    expect(res.body.code).toBe(ErrorCode.INTERNAL_ERROR);
    expect(res.body.data).toBeNull();
    expect(res.body.message).not.toContain('boom-internal-detail');
  });

  it('getOnline 抛未知异常 → 500 + code 9001,不暴露内部消息', async () => {
    mockPresenceService.getOnline.mockRejectedValue(new Error('boom-internal-detail'));

    const res = await request(app).get('/presence/online').set('Authorization', AUTH);

    expect(res.status).toBe(500);
    expect(res.body.code).toBe(ErrorCode.INTERNAL_ERROR);
    expect(res.body.data).toBeNull();
    expect(res.body.message).not.toContain('boom-internal-detail');
  });
});
