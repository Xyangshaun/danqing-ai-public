// ============================================================
// Generation 路由 + Controller 集成测试(M2-T5)
// 对应源码:src/routes/generation.routes.ts + src/controllers/generation.controller.ts
// 对应契约:api-contract.ts §3.17(冻结)+ m2-generation-plan §4
//
// 测试范围(HTTP 接入层,严格按冻结契约):
//   1. 鉴权:无 Authorization → 401
//   2. 创建:POST /generation 合法 body → 201 + CreateGenerationResponse
//   3. 参数校验:非法 inputType / text 缺 prompt / sketch 缺 sketchImageUrl
//      / count 越界 / 非法 artType → 400
//   4. 查询:GET /generation/:id → 200 + GetGenerationResponse
//   5. 错误:GET 不存在任务(service 抛 BusinessError 6102)→ 404
//   6. CSRF:POST 携带 refresh_token Cookie 但 X-CSRF-Token 缺失/不匹配 → 403
//   7. M-4 style 模式(真源 §4.4/§4.5):styleImageUrl 双格式/6M 上限/条件
//      refine/6105 映射 + 五种合法形态透传(service mock)
//      (413 路由级 body limit 边界由 generation-m4-body-limit.test.ts
//       基于真实 createApp 独立覆盖)
//
// Mock 策略:
//   - mock auth/tenant/rate-limit 中间件(注入测试用户 + 放行限流)
//   - mock generation.service(避免真实 Redis/Prisma/生成 API)
//   - csrf 中间件保持真实(验证双提交 Cookie 校验)
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import { generationRouter } from '../src/routes/generation.routes.js';
import { errorHandler } from '../src/middlewares/error-handler.js';
import { BusinessError } from '../src/middlewares/error-handler.js';
import { ErrorCode } from '../src/types/api-contract.js';
import type { CreateGenerationResponse, GetGenerationResponse } from '../src/types/api-contract.js';

// ============================================================
// vi.hoisted:声明 mock 对象(mock 工厂被提升,需在 hoisted 中定义)
// ============================================================
const { mockAuth, mockTenant, mockRateLimit, mockGenerationService } = vi.hoisted(() => ({
  // 模拟 auth 中间件:无 Bearer → 401;否则注入测试用户(多租户强制 tenantId)
  mockAuth: vi.fn((req: any, res: any, next: () => void) => {
    const auth = req.header('Authorization') as string | undefined;
    if (!auth || !auth.startsWith('Bearer ')) {
      return res
        .status(401)
        .json({ code: ErrorCode.UNAUTHORIZED, message: '未授权,请先登录', data: null, traceId: 'test-trace' });
    }
    req.userId = 'u-gen-test';
    req.tenantId = 't-gen-test';
    req.role = 'teacher';
    req.feishuOpenId = 'open-gen-test';
    req.authType = 'feishu';
    req.jti = 'jti-gen-test';
    return next();
  }),
  // 模拟 tenant 中间件:直接放行(auth 已注入 tenantId)
  mockTenant: vi.fn((_req: any, _res: any, next: () => void) => next()),
  // 模拟限流中间件:apiRateLimiter() 返回放行中间件(避免依赖 Redis)
  mockRateLimit: vi.fn(() => vi.fn((_req: any, _res: any, next: () => void) => next())),
  // 模拟 generation.service:控制器透传目标
  mockGenerationService: {
    createGeneration: vi.fn(),
    getGeneration: vi.fn(),
  },
}));

vi.mock('../src/middlewares/auth.js', () => ({ authMiddleware: mockAuth }));
vi.mock('../src/middlewares/tenant.js', () => ({ tenantMiddleware: mockTenant }));
vi.mock('../src/middlewares/rate-limit.js', () => ({ apiRateLimiter: mockRateLimit }));
vi.mock('../src/services/generation.service.js', () => ({ generationService: mockGenerationService }));

// ============================================================
// 用 express() 包裹 Router + 挂载 errorHandler(与真实 app.ts 行为一致)
// ============================================================
const app = express();
// M-4:本地测试 app 对齐生产路由级 8mb(app.ts 仅对 /api/v1/generation 放宽;
// 此处 router 挂载在根路径,以全局 8mb 近似,使 >6M 字符用例能到达 Zod 层)
app.use(express.json({ limit: '8mb' }));
// cookie-parser:csrfMiddleware 需解析 refresh_token/csrf_token Cookie(与 app.ts 一致)
app.use(cookieParser());
app.use(generationRouter);
app.use(errorHandler);

/** 有效 Bearer 头 */
const AUTH = 'Bearer test-access-token';

/** 构造合法 CreateGenerationRequest(text 模式,默认) */
function makeBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    inputType: 'text',
    prompt: '一幅印象派风景油画',
    artType: 'painting',
    aspect: 'square',
    count: 1,
    ...overrides,
  };
}

/** 构造 CreateGenerationResponse */
function makeCreateResponse(overrides: Partial<CreateGenerationResponse> = {}): CreateGenerationResponse {
  return {
    taskId: 'gen-task-1',
    status: 'pending',
    images: null,
    ...overrides,
  };
}

/** 构造 GetGenerationResponse */
function makeGetResponse(overrides: Partial<GetGenerationResponse> = {}): GetGenerationResponse {
  return {
    taskId: 'gen-task-1',
    tenantId: 't-gen-test',
    status: 'success',
    images: [{ imageUrl: 'https://cdn.example.com/gen-a.png', reviewStatus: 'pending' }],
    failureReason: null,
    usedFallback: false,
    createdAt: '2026-08-07T10:00:00.000Z',
    completedAt: '2026-08-07T10:00:01.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ------------------------------------------------------------
// 鉴权
// ------------------------------------------------------------

describe('generation 路由鉴权', () => {
  it('POST /generation 无 Authorization → 401,service 不被调用', async () => {
    const res = await request(app).post('/').send(makeBody());

    expect(res.status).toBe(401);
    expect(mockGenerationService.createGeneration).not.toHaveBeenCalled();
  });

  it('GET /generation/:id 无 Authorization → 401,service 不被调用', async () => {
    const res = await request(app).get('/gen-task-1');

    expect(res.status).toBe(401);
    expect(mockGenerationService.getGeneration).not.toHaveBeenCalled();
  });
});

// ------------------------------------------------------------
// 创建(POST /generation)
// ------------------------------------------------------------

describe('POST /generation 创建生成任务', () => {
  it('合法 body(text 模式)→ 201 + CreateGenerationResponse(pending)', async () => {
    mockGenerationService.createGeneration.mockResolvedValue(makeCreateResponse());

    const res = await request(app).post('/').set('Authorization', AUTH).send(makeBody());

    expect(res.status).toBe(201);
    expect(res.body.code).toBe(0);
    expect(res.body.data.taskId).toBe('gen-task-1');
    expect(res.body.data.status).toBe('pending');
    expect(res.body.data.images).toBeNull();

    // service 被调用,并注入 tenantId/userId(多租户强制)
    expect(mockGenerationService.createGeneration).toHaveBeenCalledTimes(1);
    const [input] = mockGenerationService.createGeneration.mock.calls[0]!;
    expect(input.tenantId).toBe('t-gen-test');
    expect(input.userId).toBe('u-gen-test');
    expect(input.body.inputType).toBe('text');
    expect(input.body.prompt).toBe('一幅印象派风景油画');
  });

  it('合法 body(sketch 模式)→ 201,sketchImageUrl 透传', async () => {
    mockGenerationService.createGeneration.mockResolvedValue(makeCreateResponse());

    const res = await request(app)
      .post('/')
      .set('Authorization', AUTH)
      .send(makeBody({ inputType: 'sketch', prompt: undefined, sketchImageUrl: 'https://cdn.example.com/sketch.png' }));

    expect(res.status).toBe(201);
    const [input] = mockGenerationService.createGeneration.mock.calls[0]!;
    expect(input.body.inputType).toBe('sketch');
    expect(input.body.sketchImageUrl).toBe('https://cdn.example.com/sketch.png');
  });
});

// ------------------------------------------------------------
// 参数校验(Zod)
// ------------------------------------------------------------

describe('POST /generation 参数校验(Zod)', () => {
  it('非法 inputType → 400', async () => {
    const res = await request(app).post('/').set('Authorization', AUTH).send(makeBody({ inputType: 'video' }));

    expect(res.status).toBe(400);
    expect(mockGenerationService.createGeneration).not.toHaveBeenCalled();
  });

  it('text 模式缺 prompt → 400(条件校验)', async () => {
    const body = makeBody({ prompt: undefined });
    const res = await request(app).post('/').set('Authorization', AUTH).send(body);

    expect(res.status).toBe(400);
    expect(mockGenerationService.createGeneration).not.toHaveBeenCalled();
  });

  it('sketch 模式缺 sketchImageUrl → 400(条件校验)', async () => {
    const res = await request(app)
      .post('/')
      .set('Authorization', AUTH)
      .send(makeBody({ inputType: 'sketch', prompt: undefined }));

    expect(res.status).toBe(400);
    expect(mockGenerationService.createGeneration).not.toHaveBeenCalled();
  });

  it('非法 artType → 400', async () => {
    const res = await request(app).post('/').set('Authorization', AUTH).send(makeBody({ artType: 'calligraphy' }));

    expect(res.status).toBe(400);
    expect(mockGenerationService.createGeneration).not.toHaveBeenCalled();
  });

  it('count 越界(> generationMaxCount=4)→ 400', async () => {
    const res = await request(app).post('/').set('Authorization', AUTH).send(makeBody({ count: 10 }));

    expect(res.status).toBe(400);
    expect(mockGenerationService.createGeneration).not.toHaveBeenCalled();
  });

  it('sketchImageUrl 非法 URL → 400', async () => {
    const res = await request(app)
      .post('/')
      .set('Authorization', AUTH)
      .send(makeBody({ inputType: 'sketch', prompt: undefined, sketchImageUrl: 'not-a-url' }));

    expect(res.status).toBe(400);
    expect(mockGenerationService.createGeneration).not.toHaveBeenCalled();
  });
});

// ------------------------------------------------------------
// 查询(GET /generation/:id)
// ------------------------------------------------------------

describe('GET /generation/:id 查询生成任务', () => {
  it('任务存在 → 200 + GetGenerationResponse', async () => {
    mockGenerationService.getGeneration.mockResolvedValue(makeGetResponse());

    const res = await request(app).get('/gen-task-1').set('Authorization', AUTH);

    expect(res.status).toBe(200);
    expect(res.body.code).toBe(0);
    expect(res.body.data.taskId).toBe('gen-task-1');
    expect(res.body.data.status).toBe('success');
    expect(res.body.data.images).toHaveLength(1);

    const [input] = mockGenerationService.getGeneration.mock.calls[0]!;
    expect(input.generationId).toBe('gen-task-1');
    expect(input.tenantId).toBe('t-gen-test');
    expect(input.role).toBe('teacher');
  });

  it('任务不存在(service 抛 BusinessError 6102)→ 404', async () => {
    mockGenerationService.getGeneration.mockRejectedValue(
      new BusinessError(ErrorCode.GENERATION_TASK_NOT_FOUND, '生成任务不存在', 404),
    );

    const res = await request(app).get('/gen-task-404').set('Authorization', AUTH);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe(ErrorCode.GENERATION_TASK_NOT_FOUND);
    expect(res.body.data).toBeNull();
  });
});

// ------------------------------------------------------------
// CSRF(双提交 Cookie 校验)
// ------------------------------------------------------------

describe('POST /generation CSRF 校验', () => {
  it('携带 refresh_token Cookie 但 X-CSRF-Token 缺失 → 403', async () => {
    // 携带 refresh_token Cookie 才启用 CSRF 校验(与 csrf.ts 行为一致)
    const res = await request(app)
      .post('/')
      .set('Authorization', AUTH)
      .set('Cookie', 'refresh_token=some-refresh; csrf_token=cookie-token')
      .send(makeBody());

    expect(res.status).toBe(403);
    expect(res.body.code).toBe(ErrorCode.FORBIDDEN);
    expect(mockGenerationService.createGeneration).not.toHaveBeenCalled();
  });

  it('X-CSRF-Token 与 Cookie 不匹配 → 403', async () => {
    const res = await request(app)
      .post('/')
      .set('Authorization', AUTH)
      .set('Cookie', 'refresh_token=some-refresh; csrf_token=cookie-token')
      .set('X-CSRF-Token', 'wrong-header-token')
      .send(makeBody());

    expect(res.status).toBe(403);
    expect(mockGenerationService.createGeneration).not.toHaveBeenCalled();
  });

  it('Cookie 与 X-CSRF-Token 匹配 → 通过(201)', async () => {
    mockGenerationService.createGeneration.mockResolvedValue(makeCreateResponse());

    const res = await request(app)
      .post('/')
      .set('Authorization', AUTH)
      .set('Cookie', 'refresh_token=some-refresh; csrf_token=matching-token')
      .set('X-CSRF-Token', 'matching-token')
      .send(makeBody());

    expect(res.status).toBe(201);
    expect(mockGenerationService.createGeneration).toHaveBeenCalledTimes(1);
  });
});

// ------------------------------------------------------------
// M-4 style 模式校验(真源 §4.4 Zod 扩展 / §4.5 错误码映射)
// ------------------------------------------------------------

/** 构造 style 模式请求体(默认 http 风格参考图 + 新画面内容描述) */
function makeStyleBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return makeBody({
    inputType: 'style',
    prompt: '一位戴草帽的少女站在麦田边',
    styleImageUrl: 'https://cdn.example.com/masterpiece.jpg',
    ...overrides,
  });
}

describe('POST /generation style 模式校验(M-4)', () => {
  it.each([
    'ftp://example.com/img.png',  // 非 http(s)/dataURL 协议
    'not-a-url',                  // 裸字符串
    'data:image/gif;base64,AAAA', // dataURL 但不支持的 media type
    'data:video/mp4;base64,AAAA', // 非图片 dataURL
  ])('非法格式 styleImageUrl(%s)→ 400 + GENERATION_IMAGE_INVALID(6105),service 不被调用', async (url) => {
    const res = await request(app)
      .post('/')
      .set('Authorization', AUTH)
      .send(makeStyleBody({ styleImageUrl: url }));

    expect(res.status).toBe(400);
    expect(res.body.code).toBe(ErrorCode.GENERATION_IMAGE_INVALID);
    expect(res.body.message).toContain('styleImageUrl');
    expect(mockGenerationService.createGeneration).not.toHaveBeenCalled();
  });

  it('styleImageUrl 超 6M 字符(合法 http 前缀)→ 400 + 6105,提示压缩', async () => {
    // 构造 > 6_000_000 字符但格式合法的 URL,隔离验证 max 规则
    const oversized = `https://cdn.example.com/${'a'.repeat(6_000_000)}`;
    const res = await request(app)
      .post('/')
      .set('Authorization', AUTH)
      .send(makeStyleBody({ styleImageUrl: oversized }));

    expect(res.status).toBe(400);
    expect(res.body.code).toBe(ErrorCode.GENERATION_IMAGE_INVALID);
    expect(res.body.message).toContain('风格参考图数据过大');
    expect(mockGenerationService.createGeneration).not.toHaveBeenCalled();
  });

  it('styleImageUrl 空字符串 → 400 + 6105(min(1) 规则)', async () => {
    const res = await request(app)
      .post('/')
      .set('Authorization', AUTH)
      .send(makeStyleBody({ styleImageUrl: '' }));

    expect(res.status).toBe(400);
    expect(res.body.code).toBe(ErrorCode.GENERATION_IMAGE_INVALID);
    expect(mockGenerationService.createGeneration).not.toHaveBeenCalled();
  });

  it('style 缺 styleImageUrl → 400 + 6105(条件 refine)', async () => {
    const res = await request(app)
      .post('/')
      .set('Authorization', AUTH)
      .send(makeStyleBody({ styleImageUrl: undefined }));

    expect(res.status).toBe(400);
    expect(res.body.code).toBe(ErrorCode.GENERATION_IMAGE_INVALID);
    expect(res.body.message).toContain('风格迁移模式必须提供 styleImageUrl');
    expect(mockGenerationService.createGeneration).not.toHaveBeenCalled();
  });

  it('style 缺 prompt(新画面内容描述)→ 400 + 6105(条件 refine)', async () => {
    const res = await request(app)
      .post('/')
      .set('Authorization', AUTH)
      .send(makeStyleBody({ prompt: undefined }));

    expect(res.status).toBe(400);
    expect(res.body.code).toBe(ErrorCode.GENERATION_IMAGE_INVALID);
    expect(res.body.message).toContain('风格迁移模式必须提供 prompt');
    expect(mockGenerationService.createGeneration).not.toHaveBeenCalled();
  });

  it('text 模式误带非法 styleImageUrl → 400 + 6105(§4.5:styleImageUrl 格式非法不分模式)', async () => {
    const res = await request(app)
      .post('/')
      .set('Authorization', AUTH)
      .send(makeBody({ styleImageUrl: 'not-a-valid-style-url' }));

    expect(res.status).toBe(400);
    expect(res.body.code).toBe(ErrorCode.GENERATION_IMAGE_INVALID);
    expect(mockGenerationService.createGeneration).not.toHaveBeenCalled();
  });

  it('既有行为零变化:非法 inputType 仍 400 + PARAM_INVALID(1001)', async () => {
    const res = await request(app).post('/').set('Authorization', AUTH).send(makeBody({ inputType: 'video' }));

    expect(res.status).toBe(400);
    expect(res.body.code).toBe(ErrorCode.PARAM_INVALID);
    expect(mockGenerationService.createGeneration).not.toHaveBeenCalled();
  });

  it('既有行为零变化:sketch 缺 sketchImageUrl 仍 400 + PARAM_INVALID(1001)', async () => {
    const res = await request(app)
      .post('/')
      .set('Authorization', AUTH)
      .send(makeBody({ inputType: 'sketch', prompt: undefined }));

    expect(res.status).toBe(400);
    expect(res.body.code).toBe(ErrorCode.PARAM_INVALID);
    expect(mockGenerationService.createGeneration).not.toHaveBeenCalled();
  });
});

describe('POST /generation style 合法双格式透传(M-4 五种形态)', () => {
  it.each([
    'http://example.com/master.jpg',
    'https://cdn.example.com/master.png',
    'data:image/png;base64,AAAA',
    'data:image/jpeg;base64,BBBB',
    'data:image/webp;base64,CCCC',
  ])('合法 styleImageUrl(%s)→ 201 进入 service 且原样透传', async (url) => {
    mockGenerationService.createGeneration.mockResolvedValue(makeCreateResponse());

    const res = await request(app)
      .post('/')
      .set('Authorization', AUTH)
      .send(makeStyleBody({ styleImageUrl: url }));

    expect(res.status).toBe(201);
    expect(res.body.code).toBe(0);
    expect(mockGenerationService.createGeneration).toHaveBeenCalledTimes(1);
    const [input] = mockGenerationService.createGeneration.mock.calls[0]!;
    expect(input.tenantId).toBe('t-gen-test');
    expect(input.body.inputType).toBe('style');
    expect(input.body.styleImageUrl).toBe(url);
    expect(input.body.prompt).toBe('一位戴草帽的少女站在麦田边');
  });
});
