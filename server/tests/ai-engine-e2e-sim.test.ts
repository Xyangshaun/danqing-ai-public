// ============================================================
// 云端 AI 引擎调用链路 E2E 模拟测试
// 对应源码:
//   - src/routes/analysis.routes.ts (POST /api/v1/analyses)
//   - src/middlewares/auth.ts + tenant.ts + rate-limit.ts + permission.ts
//   - src/controllers/analysis.controller.ts
//   - src/services/analysis.service.ts (createAnalysis)
//   - src/services/ai-analysis.service.ts (runHybridAnalysis)
//   - src/services/ai-vision.service.ts (analyzeWithAI → axios.post GLM-4V)
//
// 测试目标:
//   模拟"前端触发 → 后端返回"的完整链路,验证:
//     1. 链路通畅:鉴权 → 租户 → 限流 → 权限 → controller → service → AI引擎 → 响应
//     2. 云端 AI 引擎被正确调用(axios.post 命中 GLM 端点)
//     3. 降级逻辑生效:AI 失败时 fallback 到 Jimp+模板,仍返回 success
//     4. 鉴权链路拦截:无 token / 无效 token 被 401 拦截
//
// Mock 策略:
//   - setup.ts 全局 mock: Prisma / Redis / Jimp / Feishu httpClient(内存实现)
//   - 本文件 vi.mock('axios'):拦截 GLM-4V API 调用,控制成功/失败响应
//   - env 单例 mutation:在 AI 启用场景临时翻转 env().aiEnabled + aiApiKey,afterEach 恢复
//     (env 单例由 setup.ts initEnv() 初始化,直接 mutate 对象属性即可影响 isAIEnabled())
//   - JWT:用 fixtures.createTestTokenSet 签发真实 RS256 token(测试密钥)
//
// 约束:
//   - 不破坏现有 898 测试(vi.mock('axios') 仅本文件生效;env mutation 在 afterEach 恢复)
//   - 全程内存运行,无外部网络/数据库依赖
// ============================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { getTestApp } from './helpers/test-app.js';
import { assertApiResponse, assertApiError } from './helpers/assertions.js';
import {
  createTestUser,
  createTestTenant,
  createTestTokenSet,
  buildAuthHeaders,
  TEST_TENANT_ID_A,
  TEST_USER_ID_A,
  TEST_DEVICE_ID,
  TEST_CLIENT_IP,
  TEST_USER_AGENT,
  TEST_FEISHU_OPEN_ID_A,
} from './helpers/fixtures.js';
import { prismaMock } from './mocks/prisma.mock.js';
import { env } from '../src/config/env.js';
import { ErrorCode } from '../src/types/api-contract.js';

// ============================================================
// vi.mock('axios'):拦截云端 GLM-4V API 调用
// ai-vision.service.ts 使用 `import axios from 'axios'; axios.post(...)`
// 故 mock 需提供 default.post
// ============================================================
vi.mock('axios', () => ({
  default: {
    post: vi.fn(),
  },
}));

// mock 声明后导入 axios(拿到 mock 版本)
import axios from 'axios';

// ============================================================
// 辅助:构造有效的 GLM-4V API 响应(模拟云端引擎返回)
// ============================================================

/**
 * 构造一份符合 AIVisionResult schema 的 AI 分析内容
 * 对应 ai-vision.service.test.ts buildValidAiContent
 */
function buildValidAiContent(): string {
  return JSON.stringify({
    semantic_theme: '作品展现了静物画的传统构图,色彩温暖,传达出宁静的氛围。',
    style_recognition: '古典写实明暗塑造',
    professional_suggestions: [
      {
        dimension: '构图与造型',
        level: '良',
        operation: '将主体从画面正中向左下偏移 1/3,使其落于黄金分割点',
        reference: '塞尚《静物》三角构图',
        practice: '对同一组静物做 4 种构图变体速写',
      },
      {
        dimension: '色彩表现',
        level: '中',
        operation: '提高暗部色彩饱和度 15%,增强冷暖对比',
        reference: '莫奈《睡莲》条件色处理',
        practice: '用纯色点彩法练习冷暖渐变',
      },
    ],
    // 批次④:AI 绝对评分(替代 delta 校准)
    overall_score: 88,
    dimension_scores: [
      { dimension: '构图', score: 80 },
      { dimension: '色彩', score: 76 },
      { dimension: '笔触', score: 72 },
    ],
    score_adjustments: {
      dimension_adjustments: [
        { dimension: '构图', delta: -3, reason: '主体居中,缺乏动态平衡' },
        { dimension: '色彩', delta: 2, reason: '色彩搭配和谐,但饱和度偏低' },
      ],
      overall_delta: -2,
      overall_reason: '整体构图偏静态,色彩表现良好',
    },
    reference_artworks: [
      { title: '静物', artist: '塞尚', reason: '三角构图的经典范例' },
      { title: '睡莲', artist: '莫奈', reason: '条件色处理的代表作品' },
    ],
  });
}

/**
 * 包装为 GLM-4V API 响应格式(choices[0].message.content)
 */
function buildGlmResponse(content: string): unknown {
  return {
    data: {
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 500, completion_tokens: 300, total_tokens: 800 },
    },
    status: 200,
  };
}

/**
 * 构造 axios 超时错误(模拟云端引擎超时,触发 3s SLA 降级)
 */
function buildAxiosTimeoutError(): Error & { code: string } {
  const err = new Error('timeout of 2500ms exceeded') as Error & { code: string };
  err.code = 'ECONNABORTED';
  err.name = 'AxiosError';
  return err;
}

// ============================================================
// 辅助:翻转 env 单例的 AI 开关(临时启用云端引擎)
// ============================================================

let originalAiEnabled: boolean;
let originalAiApiKey: string;

function enableAI(): void {
  const cfg = env();
  originalAiEnabled = cfg.aiEnabled;
  originalAiApiKey = cfg.aiApiKey;
  cfg.aiEnabled = true;
  cfg.aiApiKey = 'test-glm-api-key-for-e2e-sim';
}

function disableAI(): void {
  const cfg = env();
  cfg.aiEnabled = originalAiEnabled;
  cfg.aiApiKey = originalAiApiKey;
}

// ============================================================
// 测试常量
// ============================================================

const TENANT_NAME = '云端AI引擎测试租户';
const USER_NAME = 'AI引擎测试学生';
const ART_IMAGE_URL = 'https://example.com/ai-e2e-sim-painting.jpg';
const ART_IMAGE_URL_AI_SUCCESS = 'https://example.com/ai-e2e-sim-success.jpg';
const ART_IMAGE_URL_AI_FAIL = 'https://example.com/ai-e2e-sim-fail.jpg';

// ============================================================
// 测试主体
// ============================================================

describe('ai-engine-e2e-sim (云端 AI 引擎调用链路模拟)', () => {
  let accessToken: string;

  beforeEach(() => {
    // setup.ts 全局 beforeEach 已清空 mock store

    // 预置租户 + 用户(standard plan,active)
    createTestTenant({
      id: TEST_TENANT_ID_A,
      name: TENANT_NAME,
      type: 'college',
      plan: 'standard',
      status: 'active',
      maxSeats: 50,
    });
    createTestUser({
      id: TEST_USER_ID_A,
      tenantId: TEST_TENANT_ID_A,
      feishuOpenId: TEST_FEISHU_OPEN_ID_A,
      feishuUnionId: 'on_ai_e2e_sim',
      name: USER_NAME,
      role: 'student',
    });

    // 签发真实 RS256 access_token(测试密钥,authMiddleware 可校验通过)
    const tokens = createTestTokenSet({
      userId: TEST_USER_ID_A,
      tenantId: TEST_TENANT_ID_A,
      role: 'student',
      client: 'web',
    });
    accessToken = tokens.accessToken;

    // 重置 axios.post mock(每个用例独立配置)
    vi.mocked(axios.post).mockReset();
  });

  afterEach(() => {
    // 恢复 env 单例(若本用例启用了 AI,必须还原,避免污染后续测试)
    if (originalAiEnabled !== undefined) {
      disableAI();
      originalAiEnabled = undefined as unknown as boolean;
      originalAiApiKey = undefined as unknown as string;
    }
    vi.mocked(axios.post).mockReset();
  });

  // ============================================================
  // 1. 链路通畅验证(AI 禁用,Jimp-only 模式)
  //    验证:auth → tenant → rateLimiter → permission → controller → service → Jimp → 响应
  // ============================================================
  describe('1. 链路通畅验证(AI 禁用)', () => {
    it('完整链路:有效 JWT + 合法请求 → 200 + 分析结果(Jimp-only)', async () => {
      const res = await request(getTestApp())
        .post('/api/v1/analyses')
        .set(buildAuthHeaders(accessToken))
        .set('X-Client-Context', JSON.stringify({ device_id: TEST_DEVICE_ID, client: 'web' }))
        .set('User-Agent', TEST_USER_AGENT)
        .set('X-Forwarded-For', TEST_CLIENT_IP)
        .send({
          artType: 'painting',
          imageUrl: ART_IMAGE_URL,
          title: 'AI链路测试作品',
          remark: '验证完整链路',
        })
        .expect(200);

      const body = assertApiResponse(res);
      const data = body.data as {
        id: string;
        status: string;
        result?: {
          cacheHit?: boolean;
          aiEnhanced?: boolean;
          aiDurationMs?: number;
          jimpDurationMs?: number;
          result?: { overallScore?: number };
        };
      };

      // 链路通畅的核心断言:成功返回 + 有分析记录 ID
      expect(data.status).toBe('success');
      expect(data.id).toBeTruthy();

      // AI 禁用模式:不应调用云端引擎(axios.post 未被触发)
      expect(axios.post).not.toHaveBeenCalled();

      // 结果应为 Jimp-only(aiEnhanced=false, aiDurationMs=0)
      // 结构:data.result 为 AnalysisDetail(含 aiEnhanced/aiDurationMs),
      //       data.result.result 为 AnalysisResult(含 overallScore)
      expect(data.result).toBeDefined();
      expect(data.result!.aiEnhanced).toBe(false);
      expect(data.result!.aiDurationMs).toBe(0);
      expect(data.result!.result).toBeDefined();
      // 批次③:本地引擎停分,阶段1(Jimp-only)结果 overallScore 为 null
      expect(data.result!.result!.overallScore).toBeNull();

      // DB 中记录已落库 + 租户/用户归属正确
      const dbRecord = prismaMock.analysisStore.get(data.id);
      expect(dbRecord).toBeDefined();
      expect(dbRecord!.tenantId).toBe(TEST_TENANT_ID_A);
      expect(dbRecord!.userId).toBe(TEST_USER_ID_A);
      expect(dbRecord!.status).toBe('success');
    });
  });

  // ============================================================
  // 2. 云端 AI 引擎调用(AI 启用 + 成功)
  //    验证:axios.post 命中 GLM 端点 + 结果被增强(aiEnhanced=true)
  // ============================================================
  describe('2. 云端 AI 引擎调用(AI 启用 + 成功)', () => {
    it('AI 启用时:阶段2 ai-enhance 触发 axios.post + aiEnhanced=true + aiDurationMs>0', async () => {
      // 1. 翻转 env 启用 AI(临时,供阶段2 isAIEnabled() 校验通过)
      enableAI();

      // 2. 配置 axios mock:返回有效 GLM-4V 响应(将在阶段2被命中)
      //    注:加入 ≥2ms 人工延迟,保证 Date.now() 差值非 0,消除 aiDurationMs>0 断言的时序偶发失败
      vi.mocked(axios.post).mockImplementationOnce(async () => {
        await new Promise((r) => setTimeout(r, 2));
        return buildGlmResponse(buildValidAiContent()) as never;
      });

      // 3. 阶段1:上传 → 仅 Jimp 分析(方案A 下阶段1不调 AI),拿到 analysisId
      const res1 = await request(getTestApp())
        .post('/api/v1/analyses')
        .set(buildAuthHeaders(accessToken))
        .set('X-Client-Context', JSON.stringify({ device_id: TEST_DEVICE_ID, client: 'web' }))
        .set('User-Agent', TEST_USER_AGENT)
        .set('X-Forwarded-For', TEST_CLIENT_IP)
        .send({
          artType: 'painting',
          imageUrl: ART_IMAGE_URL_AI_SUCCESS,
          title: 'AI成功路径作品',
        })
        .expect(200);

      const body1 = assertApiResponse(res1);
      const data1 = body1.data as { id: string; status: string };
      const analysisId = data1.id;

      // 阶段1不应调用云端 AI(axios.post 未被触发)
      expect(data1.status).toBe('success');
      expect(analysisId).toBeTruthy();
      expect(axios.post).not.toHaveBeenCalled();

      // 4. 阶段2:POST /:id/ai-enhance → 触发云端 AI 引擎
      const res2 = await request(getTestApp())
        .post(`/api/v1/analyses/${analysisId}/ai-enhance`)
        .set(buildAuthHeaders(accessToken))
        .set('X-Client-Context', JSON.stringify({ device_id: TEST_DEVICE_ID, client: 'web' }))
        .set('User-Agent', TEST_USER_AGENT)
        .set('X-Forwarded-For', TEST_CLIENT_IP)
        .expect(200);

      const body2 = assertApiResponse(res2);
      // 阶段2响应 data 即 AnalysisDetail(直接含 aiEnhanced/aiDurationMs/result)
      const data2 = body2.data as {
        id: string;
        aiEnhanced?: boolean;
        aiDurationMs?: number;
        jimpDurationMs?: number;
        result?: {
          overallScore?: number;
          aiMeta?: { aiSuccess?: boolean; aiModel?: string; aiFailureReason?: string };
        };
      };

      // 5. 核心断言:阶段2触发了云端 AI 引擎(axios.post 调用1次)
      expect(axios.post).toHaveBeenCalledTimes(1);

      // 调用目标应为 GLM API 端点(env.aiApiUrl)
      const [calledUrl] = vi.mocked(axios.post).mock.calls[0]!;
      expect(calledUrl).toContain('chat/completions');

      // 调用请求头应携带 Bearer API Key
      const callArgs = vi.mocked(axios.post).mock.calls[0]!;
      const opts = callArgs[2] as { headers?: { Authorization?: string } };
      expect(opts.headers?.Authorization).toMatch(/^Bearer test-glm-api-key-for-e2e-sim/);

      // 6. 阶段2结果被 AI 增强
      expect(data2.id).toBe(analysisId);
      expect(data2.aiEnhanced).toBe(true);
      expect(data2.aiDurationMs).toBeGreaterThan(0);
      expect(data2.result).toBeDefined();
      // 批次④:AI 绝对分直采(mock overall_score=88,不再依赖 Jimp 假分底+delta)
      expect(data2.result!.overallScore).toBe(88);
      expect(data2.result!.aiMeta?.aiSuccess).toBe(true);

      // 7. DB 记录已更新为 AI 增强结果
      const dbRecord = prismaMock.analysisStore.get(analysisId);
      expect(dbRecord).toBeDefined();
      expect(dbRecord!.status).toBe('success');
    });
  });

  // ============================================================
  // 3. AI 引擎失败降级(AI 启用 + 超时/失败 → fallback Jimp)
  //    验证:AI 失败时自动降级到 Jimp+模板,仍返回 success
  // ============================================================
  describe('3. AI 引擎失败降级(AI 启用 + 超时 → Jimp fallback)', () => {
    it('AI 超时:阶段2 ai-enhance 抛 6002/408,本地阶段1结果保留(aiEnhanced=false)', async () => {
      // 1. 启用 AI
      enableAI();

      // 2. 配置 axios mock:模拟云端引擎超时(将在阶段2触发)
      vi.mocked(axios.post).mockRejectedValueOnce(buildAxiosTimeoutError() as never);

      // 3. 阶段1:上传 → 仅 Jimp 分析,拿到 analysisId
      const res1 = await request(getTestApp())
        .post('/api/v1/analyses')
        .set(buildAuthHeaders(accessToken))
        .set('X-Client-Context', JSON.stringify({ device_id: TEST_DEVICE_ID, client: 'web' }))
        .set('User-Agent', TEST_USER_AGENT)
        .set('X-Forwarded-For', TEST_CLIENT_IP)
        .send({
          artType: 'painting',
          imageUrl: ART_IMAGE_URL_AI_FAIL,
          title: 'AI失败降级作品',
        })
        .expect(200);

      const body1 = assertApiResponse(res1);
      const data1 = body1.data as { id: string; status: string };
      const analysisId = data1.id;

      // 阶段1不应调用 AI
      expect(data1.status).toBe('success');
      expect(analysisId).toBeTruthy();
      expect(axios.post).not.toHaveBeenCalled();

      // 4. 阶段2:POST /:id/ai-enhance → AI 超时 → 抛 6002/HTTP 408(本地结果保留,不覆盖)
      const res2 = await request(getTestApp())
        .post(`/api/v1/analyses/${analysisId}/ai-enhance`)
        .set(buildAuthHeaders(accessToken))
        .set('X-Client-Context', JSON.stringify({ device_id: TEST_DEVICE_ID, client: 'web' }))
        .set('User-Agent', TEST_USER_AGENT)
        .set('X-Forwarded-For', TEST_CLIENT_IP)
        .expect(408);

      // 5. 错误响应:code=ANALYSIS_TIMEOUT(6002),HTTP 408
      assertApiError(res2, ErrorCode.ANALYSIS_TIMEOUT, 408);

      // 6. AI 确实被调用了(尝试调用云端引擎但超时)
      expect(axios.post).toHaveBeenCalledTimes(1);

      // 7. 本地结果保留:DB 中阶段1记录未被覆盖(result.aiEnhanced 仍为 false)
      const dbRecord = prismaMock.analysisStore.get(analysisId);
      expect(dbRecord).toBeDefined();
      expect(dbRecord!.status).toBe('success');
      const stored = dbRecord!.result as { aiEnhanced?: boolean } | null;
      expect(stored?.aiEnhanced).toBe(false);
    });

    it('AI 返回内容无法解析(AI_PARSE_ERROR):阶段2 → 502/ANALYSIS_RESULT_FAILED,本地结果保留', async () => {
      // 1. 启用 AI
      enableAI();

      // 2. mock:GLM 返回 200 但 content 为纯文本(无 JSON 大括号)→ 触发 AI_PARSE_ERROR
      vi.mocked(axios.post).mockResolvedValueOnce(
        buildGlmResponse('抱歉,我无法分析这幅画作的内容。') as never,
      );

      // 3. 阶段1:上传 → 仅 Jimp,拿 analysisId
      const res1 = await request(getTestApp())
        .post('/api/v1/analyses')
        .set(buildAuthHeaders(accessToken))
        .set('X-Client-Context', JSON.stringify({ device_id: TEST_DEVICE_ID, client: 'web' }))
        .set('User-Agent', TEST_USER_AGENT)
        .set('X-Forwarded-For', TEST_CLIENT_IP)
        .send({
          artType: 'painting',
          imageUrl: 'https://example.com/ai-e2e-sim-parse-fail.jpg',
          title: 'AI解析失败作品',
        })
        .expect(200);

      const body1 = assertApiResponse(res1);
      const data1 = body1.data as { id: string; status: string };
      const analysisId = data1.id;
      expect(data1.status).toBe('success');
      expect(analysisId).toBeTruthy();
      expect(axios.post).not.toHaveBeenCalled();

      // 4. 阶段2:AI 返回内容无法解析 → 502 + ANALYSIS_RESULT_FAILED(6003)
      const res2 = await request(getTestApp())
        .post(`/api/v1/analyses/${analysisId}/ai-enhance`)
        .set(buildAuthHeaders(accessToken))
        .set('X-Client-Context', JSON.stringify({ device_id: TEST_DEVICE_ID, client: 'web' }))
        .set('User-Agent', TEST_USER_AGENT)
        .set('X-Forwarded-For', TEST_CLIENT_IP)
        .expect(502);

      assertApiError(res2, ErrorCode.ANALYSIS_RESULT_FAILED, 502);

      // 5. 错误文案应为用户友好的中文(非英文枚举值 AI_PARSE_ERROR)
      const errBody = res2.body as { message?: string };
      expect(errBody.message).toBeTruthy();
      expect(errBody.message).not.toContain('AI_PARSE_ERROR');
      expect(errBody.message).toMatch(/异常|失败/);

      // 6. AI 确实被调用了(尝试调用云端引擎但返回内容无法解析)
      expect(axios.post).toHaveBeenCalledTimes(1);

      // 7. 本地结果保留:DB 中阶段1记录未被覆盖(aiEnhanced 仍为 false)
      const dbRecord = prismaMock.analysisStore.get(analysisId);
      expect(dbRecord).toBeDefined();
      expect(dbRecord!.status).toBe('success');
      const stored = dbRecord!.result as { aiEnhanced?: boolean } | null;
      expect(stored?.aiEnhanced).toBe(false);
    });
  });

  // ============================================================
  // 4. 鉴权链路拦截验证
  //    验证:无 token / 无效签名 token 被 authMiddleware 401 拦截
  // ============================================================
  describe('4. 鉴权链路拦截', () => {
    it('无 Authorization 头 → 401 UNAUTHORIZED(链路在 auth 节点被拦截)', async () => {
      const res = await request(getTestApp())
        .post('/api/v1/analyses')
        .set('User-Agent', TEST_USER_AGENT)
        .send({
          artType: 'painting',
          imageUrl: ART_IMAGE_URL,
        })
        .expect(401);

      assertApiError(res, ErrorCode.UNAUTHORIZED, 401);

      // 链路未到达 service:无 DB 记录、无 AI 调用
      expect(axios.post).not.toHaveBeenCalled();
      expect(prismaMock.analysisStore.size).toBe(0);
    });

    it('无效签名 token → 401 TOKEN_SIGNATURE_INVALID(authMiddleware RS256 校验拦截)', async () => {
      const res = await request(getTestApp())
        .post('/api/v1/analyses')
        .set('Authorization', 'Bearer invalid.signature.token')
        .set('User-Agent', TEST_USER_AGENT)
        .send({
          artType: 'painting',
          imageUrl: ART_IMAGE_URL,
        })
        .expect(401);

      assertApiError(res, ErrorCode.TOKEN_SIGNATURE_INVALID, 401);
      expect(axios.post).not.toHaveBeenCalled();
      expect(prismaMock.analysisStore.size).toBe(0);
    });
  });

  // ============================================================
  // 4.5 诊断模式参数校验边界(2026-08-16 双模式诊断)
  //     验证:非法 diagnosisMode/examSubject 枚举 → 400 PARAM_INVALID,链路不落库
  // ============================================================
  describe('4.5 诊断模式参数校验(diagnosisMode/examSubject 边界)', () => {
    it('非法 diagnosisMode → 400 PARAM_INVALID(控制器 Zod 拦截,不落库)', async () => {
      const res = await request(getTestApp())
        .post('/api/v1/analyses')
        .set(buildAuthHeaders(accessToken))
        .set('X-Client-Context', JSON.stringify({ device_id: TEST_DEVICE_ID, client: 'web' }))
        .set('User-Agent', TEST_USER_AGENT)
        .send({
          artType: 'painting',
          imageUrl: ART_IMAGE_URL,
          diagnosisMode: 'casual',
        })
        .expect(400);

      assertApiError(res, ErrorCode.PARAM_INVALID, 400);
      expect(axios.post).not.toHaveBeenCalled();
    });

    it('非法 examSubject → 400 PARAM_INVALID(控制器 Zod 拦截,不落库)', async () => {
      const res = await request(getTestApp())
        .post('/api/v1/analyses')
        .set(buildAuthHeaders(accessToken))
        .set('X-Client-Context', JSON.stringify({ device_id: TEST_DEVICE_ID, client: 'web' }))
        .set('User-Agent', TEST_USER_AGENT)
        .send({
          artType: 'painting',
          imageUrl: ART_IMAGE_URL,
          diagnosisMode: 'exam',
          examSubject: 'oil-painting',
        })
        .expect(400);

      assertApiError(res, ErrorCode.PARAM_INVALID, 400);
      expect(axios.post).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // 5. 链路节点完整性汇总(单测覆盖全链路节点)
  // ============================================================
  describe('5. 链路节点完整性', () => {
    it('各中间件节点均被穿透:auth → tenant → permission → controller → service', async () => {
      // 此用例复用「链路通畅」路径,额外断言中间件注入字段正确
      const res = await request(getTestApp())
        .post('/api/v1/analyses')
        .set(buildAuthHeaders(accessToken))
        .set('X-Client-Context', JSON.stringify({ device_id: TEST_DEVICE_ID, client: 'web' }))
        .set('User-Agent', TEST_USER_AGENT)
        .set('X-Forwarded-For', TEST_CLIENT_IP)
        .send({
          artType: 'design',
          imageUrl: 'https://example.com/link-integrity-design.jpg',
        })
        .expect(200);

      const body = assertApiResponse(res);
      const data = body.data as { id: string; status: string };

      // auth 节点:JWT 校验通过(否则 401,无法到此处)
      // tenant 节点:tenantMiddleware 校验 JWT.tenant_id 对应租户存在且 active(否则 403/404)
      // permission 节点:requirePermission('analysis:create') 校验 student 角色拥有该权限(否则 403)
      // controller → service:成功创建分析记录
      expect(data.status).toBe('success');

      // 验证 service 正确使用了 auth 注入的 tenantId/userId(非请求体注入)
      const dbRecord = prismaMock.analysisStore.get(data.id);
      expect(dbRecord).toBeDefined();
      expect(dbRecord!.tenantId).toBe(TEST_TENANT_ID_A); // 来自 JWT,非 body
      expect(dbRecord!.userId).toBe(TEST_USER_ID_A); // 来自 JWT,非 body
      expect(dbRecord!.workType).toBe('design');

      // 验证 traceId 链路追踪头存在(全链路可观测性)
      expect(body.traceId).toBeTruthy();
      expect(res.headers['x-trace-id']).toBeTruthy();
    });
  });
});
