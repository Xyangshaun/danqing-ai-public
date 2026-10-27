// ============================================================
// AI 指标 Controller 集成测试(M3-T8 收尾;对应 m3-observability-plan §3 契约)
// 对应源码:src/controllers/metrics.controller.ts + src/routes/admin.routes.ts
// 对应契约:api-contract.ts §3.18(AiMetricsResponse / SlaMetricsResponse,已冻结)
//
// 测试范围(HTTP 接入层,严格按冻结契约):
//   1. 鉴权:无 Authorization → 401
//   2. 特性开关:metrics 未启用(默认 disabled)→ 403 FORBIDDEN
//   3. 多租户隔离:
//      - 非 owner admin 传他人 tenantId(/metrics/sla)→ 403 FORBIDDEN
//      - owner 可查任意租户/全局
//   4. 正常返回:GET /metrics/ai → 200 + AiMetricsResponse(严格冻结字段)
//               GET /metrics/sla → 200 + SlaMetricsResponse
//   5. 指标数据暂不可用:service 抛 BusinessError(9201)→ 503 METRICS_DATA_UNAVAILABLE
//
// Mock 策略(与 generation.routes.test.ts / deployment.routes.test.ts 一致):
//   - mock auth/tenant/rate-limit/permission 中间件(注入测试用户 + 放行限流 + 放行权限)
//   - mock configFeatureService(控制 metrics 特性开关状态)
//   - mock metricsAggregationService(避免真实 Redis/Prisma)
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { adminRouter } from '../src/routes/admin.routes.js';
import { errorHandler, BusinessError } from '../src/middlewares/error-handler.js';
import { ErrorCode } from '../src/types/api-contract.js';
import type {
  AiMetricsResponse,
  SlaMetricsResponse,
} from '../src/types/api-contract.js';

// ============================================================
// vi.hoisted:声明 mock 对象 + 可变的测试用户状态
// ============================================================
const {
  mockAuth,
  mockTenant,
  mockRateLimit,
  mockPermission,
  mockConfigFeature,
  mockMetricsService,
  __authState,
} = vi.hoisted(() => {
    const authState: { role: string; tenantId: string; userId: string } = {
      role: 'owner',
      tenantId: 't-owner',
      userId: 'u-owner',
    };
    return {
      // 模拟 auth 中间件:无 Bearer → 401;否则按 authState 注入(多租户强制 tenantId)
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
        req.feishuOpenId = 'open-metrics-test';
        req.authType = 'feishu';
        req.jti = 'jti-metrics-test';
        return next();
      }),
      // 模拟 tenant 中间件:直接放行(auth 已注入 tenantId)
      mockTenant: vi.fn((_req: any, _res: any, next: () => void) => next()),
      // 模拟限流中间件:apiRateLimiter() 返回放行中间件
      mockRateLimit: vi.fn(() => vi.fn((_req: any, _res: any, next: () => void) => next())),
      // 模拟权限中间件:requirePermission() 返回放行中间件
      mockPermission: vi.fn(() => vi.fn((_req: any, _res: any, next: () => void) => next())),
      // 模拟 configFeatureService:仅暴露 controller 使用的 isMetricsEnabled
      mockConfigFeature: {
        isMetricsEnabled: vi.fn(() => true),
      },
      // 模拟 metricsAggregationService
      mockMetricsService: {
        getAiMetrics: vi.fn(),
        getSlaMetrics: vi.fn(),
      },
      __authState: authState,
    };
  });

vi.mock('../src/middlewares/auth.js', () => ({ authMiddleware: mockAuth }));
vi.mock('../src/middlewares/tenant.js', () => ({ tenantMiddleware: mockTenant }));
vi.mock('../src/middlewares/rate-limit.js', () => ({ apiRateLimiter: mockRateLimit }));
vi.mock('../src/middlewares/permission.js', () => ({ requirePermission: mockPermission }));
vi.mock('../src/services/config-feature.service.js', () => ({
  configFeatureService: mockConfigFeature,
}));
vi.mock('../src/services/metrics-aggregation.service.js', () => ({
  metricsAggregationService: mockMetricsService,
}));

// ============================================================
// 用 express() 包裹 adminRouter + 挂载 errorHandler(与真实 app.ts 行为一致)
// ============================================================
const app = express();
app.use(express.json());
app.use(adminRouter);
app.use(errorHandler);

/** 有效 Bearer 头 */
const AUTH = 'Bearer test-access-token';

/** 构造 AiMetricsResponse(冻结契约字段) */
function makeAiMetricsResponse(overrides: Partial<AiMetricsResponse> = {}): AiMetricsResponse {
  return {
    startDate: '2026-07-31T00:00:00.000Z',
    endDate: '2026-08-07T00:00:00.000Z',
    slaComplianceRate: 0.997,
    aiFallbackRate: 0.02,
    providerAvailability: {
      glm: { successRate: 0.99, switchCount: 1 },
      trae: { successRate: 0.97, switchCount: 2 },
    },
    analysis: { total: 120, successRate: 0.98, avgDurationMs: 1800 },
    costByDay: [{ date: '2026-08-07T00:00:00.000Z', costYuan: 1.23 }],
    timestamp: '2026-08-07T12:00:00.000Z',
    ...overrides,
  };
}

/** 构造 SlaMetricsResponse(冻结契约字段) */
function makeSlaMetricsResponse(overrides: Partial<SlaMetricsResponse> = {}): SlaMetricsResponse {
  return {
    days: 7,
    dailySla: [{ date: '2026-08-07T00:00:00.000Z', complianceRate: 0.997, total: 120 }],
    avgComplianceRate: 0.997,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // 默认:平台 owner 身份 + metrics 特性开关开启 + service 返回正常数据
  __authState.role = 'owner';
  __authState.tenantId = 't-owner';
  __authState.userId = 'u-owner';
  mockConfigFeature.isMetricsEnabled.mockReturnValue(true);
  mockMetricsService.getAiMetrics.mockResolvedValue(makeAiMetricsResponse());
  mockMetricsService.getSlaMetrics.mockResolvedValue(makeSlaMetricsResponse());
});

// ------------------------------------------------------------
// 鉴权
// ------------------------------------------------------------

describe('metrics 路由鉴权', () => {
  it('GET /metrics/ai 无 Authorization → 401,service 不被调用', async () => {
    const res = await request(app).get('/metrics/ai');

    expect(res.status).toBe(401);
    expect(mockMetricsService.getAiMetrics).not.toHaveBeenCalled();
  });

  it('GET /metrics/sla 无 Authorization → 401,service 不被调用', async () => {
    const res = await request(app).get('/metrics/sla');

    expect(res.status).toBe(401);
    expect(mockMetricsService.getSlaMetrics).not.toHaveBeenCalled();
  });
});

// ------------------------------------------------------------
// 特性开关(fail-closed)
// ------------------------------------------------------------

describe('metrics 特性开关(fail-closed)', () => {
  it('metrics 未启用 → GET /metrics/ai 返回 403,service 不被调用', async () => {
    mockConfigFeature.isMetricsEnabled.mockReturnValue(false);

    const res = await request(app).get('/metrics/ai').set('Authorization', AUTH);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe(ErrorCode.FORBIDDEN);
    expect(mockMetricsService.getAiMetrics).not.toHaveBeenCalled();
  });

  it('metrics 未启用 → GET /metrics/sla 返回 403,service 不被调用', async () => {
    mockConfigFeature.isMetricsEnabled.mockReturnValue(false);

    const res = await request(app).get('/metrics/sla').set('Authorization', AUTH);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe(ErrorCode.FORBIDDEN);
    expect(mockMetricsService.getSlaMetrics).not.toHaveBeenCalled();
  });
});

// ------------------------------------------------------------
// 多租户隔离(门禁 M3-3)
// ------------------------------------------------------------

describe('metrics 多租户隔离(门禁 M3-3)', () => {
  it('非平台 owner admin 传他人 tenantId(/metrics/sla)→ 403,service 不被调用', async () => {
    // 普通 admin(非 owner),归属 t-admin 租户
    __authState.role = 'admin';
    __authState.tenantId = 't-admin';

    const res = await request(app)
      .get('/metrics/sla')
      .set('Authorization', AUTH)
      .query({ tenantId: 't-other' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe(ErrorCode.FORBIDDEN);
    expect(mockMetricsService.getSlaMetrics).not.toHaveBeenCalled();
  });

  it('平台 owner 可查任意租户(/metrics/sla)→ 200,透传指定 tenantId', async () => {
    const res = await request(app)
      .get('/metrics/sla')
      .set('Authorization', AUTH)
      .query({ tenantId: 't-other' });

    expect(res.status).toBe(200);
    expect(res.body.code).toBe(0);
    expect(mockMetricsService.getSlaMetrics).toHaveBeenCalledTimes(1);
    const [query, tenantId] = mockMetricsService.getSlaMetrics.mock.calls[0]!;
    expect(query.tenantId).toBe('t-other');
    expect(tenantId).toBe('t-other');
  });

  it('平台 owner 未传 tenantId(/metrics/sla)→ 全局查询(tenantId=undefined)', async () => {
    const res = await request(app).get('/metrics/sla').set('Authorization', AUTH);

    expect(res.status).toBe(200);
    const [query, tenantId] = mockMetricsService.getSlaMetrics.mock.calls[0]!;
    expect(query.tenantId).toBeUndefined();
    expect(tenantId).toBeUndefined();
  });
});

// ------------------------------------------------------------
// 正常返回(冻结契约)
// ------------------------------------------------------------

describe('GET /metrics/ai 正常返回(冻结契约)', () => {
  it('特性开关开启 + owner → 200 + AiMetricsResponse', async () => {
    const res = await request(app).get('/metrics/ai').set('Authorization', AUTH);

    expect(res.status).toBe(200);
    expect(res.body.code).toBe(0);
    expect(res.body.data.startDate).toBeDefined();
    expect(res.body.data.endDate).toBeDefined();
    expect(res.body.data.slaComplianceRate).toBe(0.997);
    expect(res.body.data.aiFallbackRate).toBe(0.02);
    expect(res.body.data.providerAvailability.glm.switchCount).toBe(1);
    expect(res.body.data.providerAvailability.trae.switchCount).toBe(2);
    expect(res.body.data.analysis.total).toBe(120);
    expect(res.body.data.costByDay).toHaveLength(1);
    expect(res.body.data.timestamp).toBeDefined();
  });

  it('非 owner admin 未指定租户 → 仅查询本人租户 req.tenantId', async () => {
    __authState.role = 'admin';
    __authState.tenantId = 't-admin';

    const res = await request(app).get('/metrics/ai').set('Authorization', AUTH);

    expect(res.status).toBe(200);
    expect(mockMetricsService.getAiMetrics).toHaveBeenCalledTimes(1);
    const input = mockMetricsService.getAiMetrics.mock.calls[0]![0];
    expect(input.tenantId).toBe('t-admin');
  });

  it('startDate/endDate 透传给 service', async () => {
    const res = await request(app)
      .get('/metrics/ai')
      .set('Authorization', AUTH)
      .query({ startDate: '2026-08-01', endDate: '2026-08-07' });

    expect(res.status).toBe(200);
    const input = mockMetricsService.getAiMetrics.mock.calls[0]![0];
    expect(input.startDate).toBe('2026-08-01');
    expect(input.endDate).toBe('2026-08-07');
  });
});

describe('GET /metrics/sla 正常返回(冻结契约)', () => {
  it('owner → 200 + SlaMetricsResponse', async () => {
    const res = await request(app).get('/metrics/sla').set('Authorization', AUTH);

    expect(res.status).toBe(200);
    expect(res.body.code).toBe(0);
    expect(res.body.data.days).toBe(7);
    expect(res.body.data.dailySla).toHaveLength(1);
    expect(res.body.data.avgComplianceRate).toBe(0.997);
  });
});

// ------------------------------------------------------------
// 指标数据暂不可用(METRICS_DATA_UNAVAILABLE 9201 → 503)
// ------------------------------------------------------------

describe('METRICS_DATA_UNAVAILABLE(9201) 错误', () => {
  it('service 抛 BusinessError(9201)→ GET /metrics/ai 返回 503', async () => {
    mockMetricsService.getAiMetrics.mockRejectedValue(
      new BusinessError(ErrorCode.METRICS_DATA_UNAVAILABLE, '指标数据暂不可用,请稍后再试', 503),
    );

    const res = await request(app).get('/metrics/ai').set('Authorization', AUTH);

    expect(res.status).toBe(503);
    expect(res.body.code).toBe(ErrorCode.METRICS_DATA_UNAVAILABLE);
    expect(res.body.data).toBeNull();
    // 不暴露内部堆栈
    expect(res.body.message).not.toContain('Error');
  });

  it('service 抛 BusinessError(9201)→ GET /metrics/sla 返回 503', async () => {
    mockMetricsService.getSlaMetrics.mockRejectedValue(
      new BusinessError(ErrorCode.METRICS_DATA_UNAVAILABLE, '指标数据暂不可用,请稍后再试', 503),
    );

    const res = await request(app).get('/metrics/sla').set('Authorization', AUTH);

    expect(res.status).toBe(503);
    expect(res.body.code).toBe(ErrorCode.METRICS_DATA_UNAVAILABLE);
  });
});
