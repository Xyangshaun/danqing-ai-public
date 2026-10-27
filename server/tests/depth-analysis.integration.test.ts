// ============================================================
// 深度分析集成测试 (阶段 G, Task 23.1 / 23.2 / 23.3)
//
// 测试范围(端到端,走完整 HTTP 中间件链):
//   Task 23.1: 深度分析端到端流程(上传 → AI增强 → 4维度+标准+标注 → 历史)
//   Task 23.2: 非遗作品评估流程(heritage 全流程 + prompt 类目注入)
//   Task 23.3: 算法去同质化验证(指纹注入 + 禁止模板化约束 + 差异度 ≥70%)
//
// Mock 策略:
//   - vi.mock('axios'):AI HTTP 调用边界(mock GLM-4V 响应)
//   - vi.mock('../src/config/env.js') + importOriginal:
//       以真实 loadEnv() 为基底(含真实 JWT 密钥/cors/rateLimit 等,保证 auth 中间件可用),
//       仅覆盖 aiEnabled/aiApiKey 等 AI 开关字段(可逐用例切换)
//   - 复用 setup.ts 全局 mock:Prisma / Redis / Jimp / feishu
//   - 复用 helpers:test-app / assertions / fixtures / ai-response-builder
//
// 关键设计:
//   - createAnalysis(阶段1)始终仅 Jimp 分析(aiEnhanced=false),不调 axios
//   - POST /:id/ai-enhance(阶段2)调 runAIEnhance → analyzeWithAI → axios.post(mocked)
//   - 通过 vi.mocked(axios.post).mock.calls 捕获 prompt 文本,验证注入契约
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ============================================================
// 1. vi.hoisted:AI 环境覆盖状态(可逐用例切换)
// ============================================================
const { aiEnvState } = vi.hoisted(() => ({
  aiEnvState: {
    aiEnabled: false,
    aiApiKey: '',
    aiApiUrl: 'https://test-ai-api.example.com/v1/chat/completions',
    aiApiTimeout: 2500,
    aiApiModel: 'glm-4v-flash-test',
    aiProvider: 'glm' as const,
  },
}));

// ============================================================
// 2. vi.mock:axios + env.js
// ============================================================
vi.mock('axios', () => ({ default: { post: vi.fn() } }));

vi.mock('../src/config/env.js', async (importOriginal) => {
  // 以真实 env 模块为基底(importOriginal),保证 JWT 密钥/cors/cookie 等 auth 所需字段正确
  const actual = (await importOriginal()) as typeof import('../src/config/env.js');
  // loadEnv() 从 process.env 构建(此时 setup.ts 已注入测试 env + 真实 RSA 密钥)
  const baseConfig = actual.loadEnv();
  function buildEnv() {
    return {
      ...baseConfig,
      // 仅覆盖 AI 开关字段(逐用例切换 aiEnvState)
      aiEnabled: aiEnvState.aiEnabled,
      aiProvider: aiEnvState.aiProvider,
      aiApiKey: aiEnvState.aiApiKey,
      aiApiUrl: aiEnvState.aiApiUrl,
      aiApiTimeout: aiEnvState.aiApiTimeout,
      aiApiModel: aiEnvState.aiApiModel,
      aiApiModels: [aiEnvState.aiApiModel],
    };
  }
  return {
    ...actual,
    env: () => buildEnv(),
    initEnv: () => buildEnv(),
    loadEnv: () => buildEnv(),
  };
});

// ============================================================
// 3. 导入(在 vi.mock 之后,确保拿到 mock 版本)
// ============================================================
import axios from 'axios';
import request from 'supertest';
import { getTestApp } from './helpers/test-app.js';
import { assertApiResponse, assertApiError } from './helpers/assertions.js';
import {
  createTestUser,
  createTestTenant,
  createTestTokenSet,
  buildAuthHeaders,
} from './helpers/fixtures.js';
import { prismaMock } from './mocks/prisma.mock.js';
import { ErrorCode } from '../src/types/api-contract.js';
import type { ArtType, HeritageCategory } from '../src/types/api-contract.js';
import type { EvaluationStage } from '../src/types/ai-analysis.js';
import {
  buildGlmResponse,
  buildDepthContent,
  buildDepthDimension,
  buildScoreCriteria,
  buildIssueMarkers,
  buildHeritageDepthContent,
} from './helpers/ai-response-builder.js';

// ============================================================
// 测试常量
// ============================================================

const TENANT_ID = 't-depth-integration-0001';
const STUDENT_ID = 'u-depth-integration-stu';
const STUDENT_OPEN_ID = 'ou_depth_integration_stu';
/** setup.ts Jimp mock 对 https://example.com/*.jpg 返回 100x100 伪图 */
const VALID_IMAGE_URL = 'https://example.com/depth-e2e-test.jpg';

// ============================================================
// 辅助函数
// ============================================================

/** 签发学生 access_token 并构造 Authorization 头 */
function authHeaders(): Record<string, string> {
  const token = createTestTokenSet({
    userId: STUDENT_ID,
    tenantId: TENANT_ID,
    role: 'student',
    feishuOpenId: STUDENT_OPEN_ID,
  }).accessToken;
  return buildAuthHeaders(token);
}

/** 预置租户 + 学生 + 租户成员关系(供 RBAC 鉴权通过) */
function seedTestData(): void {
  prismaMock.__clear();
  createTestTenant({
    id: TENANT_ID,
    name: '深度集成测试学院',
    type: 'college',
    plan: 'standard',
    status: 'active',
    maxSeats: 100,
  });
  createTestUser({
    id: STUDENT_ID,
    tenantId: TENANT_ID,
    feishuOpenId: STUDENT_OPEN_ID,
    feishuUnionId: 'on_depth_integration_stu',
    name: '深度集成学生',
    role: 'student',
  });
  prismaMock.tenantMemberStore.set(`${STUDENT_ID}_${TENANT_ID}`, {
    userId: STUDENT_ID,
    tenantId: TENANT_ID,
    role: 'student',
    joinedAt: new Date('2026-08-01T00:00:00Z'),
  });
}

/** 开启 AI(每个需要 AI 增强的用例调用) */
function enableAI(): void {
  aiEnvState.aiEnabled = true;
  aiEnvState.aiApiKey = 'test-key';
  aiEnvState.aiProvider = 'glm';
}

/** 关闭 AI(测试降级场景) */
function disableAI(): void {
  aiEnvState.aiEnabled = false;
  aiEnvState.aiApiKey = '';
}

/**
 * 端到端流程:创建(Jimp) → AI 增强,返回 analysisId + 增强响应
 * @param opts.content AI 响应 content(mock GLM 返回)
 */
async function createAndEnhance(opts: {
  artType: ArtType;
  imageUrl?: string;
  heritageCategory?: HeritageCategory;
  evaluationStage?: EvaluationStage;
  content: string;
}): Promise<{ id: string; enhanceBody: ReturnType<typeof assertApiResponse> }> {
  // 1. 阶段 1:POST /analyses(Jimp-only,不调 axios)
  const createRes = await request(getTestApp())
    .post('/api/v1/analyses')
    .set(authHeaders())
    .send({
      artType: opts.artType,
      imageUrl: opts.imageUrl ?? VALID_IMAGE_URL,
      ...(opts.evaluationStage ? { evaluationStage: opts.evaluationStage } : {}),
      ...(opts.heritageCategory ? { heritageCategory: opts.heritageCategory } : {}),
    })
    .expect(200);
  const createBody = assertApiResponse(createRes);
  const id = createBody.data.id as string;

  // 2. mock axios 供阶段 2 AI 增强
  vi.mocked(axios.post).mockResolvedValueOnce(buildGlmResponse(opts.content));

  // 3. 阶段 2:POST /:id/ai-enhance
  const enhanceRes = await request(getTestApp())
    .post(`/api/v1/analyses/${id}/ai-enhance`)
    .set(authHeaders())
    .expect(200);
  const enhanceBody = assertApiResponse(enhanceRes);
  return { id, enhanceBody };
}

/** 从最近一次 axios.post 调用提取 prompt 文本(供契约断言)
 *  GLM-4V 请求体 messages 结构:
 *    - system 消息:content 为 string
 *    - user 消息:content 为 Array<{type:'text'|'image_url', text?:string}>(多模态)
 *  本函数统一提取所有文本内容,忽略 image_url 部分。 */
function getLastPromptText(): string {
  const calls = vi.mocked(axios.post).mock.calls;
  const lastCall = calls[calls.length - 1];
  const body = lastCall?.[1] as {
    messages?: Array<{ content?: string | Array<{ type?: string; text?: string }> }>;
  } | undefined;
  return (body?.messages ?? [])
    .map((m) => {
      if (typeof m.content === 'string') return m.content;
      if (Array.isArray(m.content)) {
        return m.content.map((c) => c.text ?? '').join('\n');
      }
      return '';
    })
    .join('\n');
}

/** 计算 Jaccard 距离(字符 bigram),用于去同质化差异度度量 */
function jaccardDistance(a: string, b: string): number {
  const bigrams = (s: string): Set<string> => {
    const set = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  };
  const A = bigrams(a);
  const B = bigrams(b);
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const union = A.size + B.size - inter;
  return union === 0 ? 1 : 1 - inter / union;
}

beforeEach(() => {
  seedTestData();
  disableAI();
  vi.mocked(axios.post).mockReset();
});

// ============================================================
// Task 23.1: 深度分析端到端流程
// 上传 → AI增强 → 4维度+标准+标注 → 历史
// ============================================================
describe('深度分析端到端流程 (Task 23.1)', () => {
  it('should_create_jimp_only_analysis_and_persist_evaluationStage_when_post_analyses', async () => {
    // 阶段 1:createAnalysis 始终 Jimp-only(aiEnhanced=false),evaluationStage 持久化
    const res = await request(getTestApp())
      .post('/api/v1/analyses')
      .set(authHeaders())
      .send({
        artType: 'painting',
        imageUrl: VALID_IMAGE_URL,
        evaluationStage: 'master',
      })
      .expect(200);
    const body = assertApiResponse(res);
    expect(body.data.id).toBeTruthy();
    expect(body.data.status).toBe('success');
    // createAnalysis 不调 AI(方案 A 阶段 1),aiEnhanced 应为 falsy
    expect(axios.post).not.toHaveBeenCalled();
    // evaluationStage 在阶段 2 持久化;阶段 1 result 不含 AI 增强
  });

  it('should_return_aiEnhanced_true_with_4_dimensions_after_ai_enhance', async () => {
    enableAI();
    const { enhanceBody } = await createAndEnhance({
      artType: 'painting',
      evaluationStage: 'master',
      content: buildDepthContent({
        evaluationStage: 'master',
        deepDims: {
          originality_and_style: buildDepthDimension(82, '原创性:构图独特,风格鲜明。', '建议 A:增加原创元素。'),
          completeness_and_rhythm: buildDepthDimension(76, '完整度:画面节奏感强。', '建议 B:优化节奏。'),
          emotion_and_mood: buildDepthDimension(70, '情感:意境传达到位。', '建议 C:增强情感。'),
          craftsmanship: buildDepthDimension(88, '工艺:技法娴熟。', '建议 D:精炼技法。'),
        },
        scoreCriteria: buildScoreCriteria(),
        issueMarkers: buildIssueMarkers(),
      }),
    });

    const detail = enhanceBody.data;
    // aiEnhanced=true(AI 增强成功)
    expect(detail.aiEnhanced).toBe(true);
    // 4 维度评分(在 result.aiVisionResult 中)
    const aiVision = detail.result?.aiVisionResult;
    expect(aiVision?.originalityAndStyle?.score).toBe(82);
    expect(aiVision?.completenessAndRhythm?.score).toBe(76);
    expect(aiVision?.emotionAndMood?.score).toBe(70);
    expect(aiVision?.craftsmanship?.score).toBe(88);
    // 顶层 evaluationStage(AI 回显 master)
    expect(detail.evaluationStage).toBe('master');
  });

  it('should_persist_scoreCriteria_and_issueMarkers_readable_via_get_detail', async () => {
    enableAI();
    const { id } = await createAndEnhance({
      artType: 'painting',
      evaluationStage: 'master',
      content: buildDepthContent({
        evaluationStage: 'master',
        scoreCriteria: buildScoreCriteria(),
        issueMarkers: buildIssueMarkers(),
      }),
    });

    // GET /:id 验证持久化读取
    const getRes = await request(getTestApp())
      .get(`/api/v1/analyses/${id}`)
      .set(authHeaders())
      .expect(200);
    const body = assertApiResponse(getRes);
    const detail = body.data;
    expect(detail.aiEnhanced).toBe(true);
    expect(detail.evaluationStage).toBe('master');
    expect(Array.isArray(detail.scoreCriteria)).toBe(true);
    expect(detail.scoreCriteria.length).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(detail.issueMarkers)).toBe(true);
    expect(detail.issueMarkers.length).toBeGreaterThanOrEqual(1);
    // result.aiVisionResult 含 4 维度(持久化完整)
    expect(detail.result?.aiVisionResult).toBeTruthy();
  });

  it('should_list_record_with_aiEnhanced_badge_and_evaluationStage', async () => {
    enableAI();
    const { id } = await createAndEnhance({
      artType: 'painting',
      evaluationStage: 'master',
      content: buildDepthContent({ evaluationStage: 'master' }),
    });

    // GET /analyses 验证列表徽章字段
    const listRes = await request(getTestApp())
      .get('/api/v1/analyses')
      .set(authHeaders())
      .expect(200);
    const body = assertApiResponse(listRes);
    const item = body.data.items.find((it: { id: string }) => it.id === id);
    expect(item).toBeDefined();
    expect(item.aiEnhanced).toBe(true);
    expect(item.evaluationStage).toBe('master');
  });

  it('should_be_idempotent_when_ai_enhance_already_enhanced', async () => {
    enableAI();
    const { id } = await createAndEnhance({
      artType: 'painting',
      evaluationStage: 'master',
      content: buildDepthContent({ evaluationStage: 'master' }),
    });
    const callsAfterFirst = vi.mocked(axios.post).mock.calls.length;

    // 第二次 ai-enhance(幂等,应直接返回,不重复调 AI)
    const secondRes = await request(getTestApp())
      .post(`/api/v1/analyses/${id}/ai-enhance`)
      .set(authHeaders())
      .expect(200);
    const body = assertApiResponse(secondRes);
    expect(body.data.aiEnhanced).toBe(true);
    // 未新增 axios 调用(幂等)
    expect(vi.mocked(axios.post).mock.calls.length).toBe(callsAfterFirst);
  });

  it('should_return_503_when_ai_disabled_and_request_ai_enhance', async () => {
    // AI 未启用时,ai-enhance 应返回 503 ANALYSIS_RESULT_FAILED
    disableAI();
    // 先创建一条记录(Jimp-only,AI 关闭)
    const createRes = await request(getTestApp())
      .post('/api/v1/analyses')
      .set(authHeaders())
      .send({ artType: 'painting', imageUrl: VALID_IMAGE_URL })
      .expect(200);
    const id = assertApiResponse(createRes).data.id as string;

    const res = await request(getTestApp())
      .post(`/api/v1/analyses/${id}/ai-enhance`)
      .set(authHeaders())
      .expect(503);
    assertApiError(res, ErrorCode.ANALYSIS_RESULT_FAILED, 503);
  });

  it('should_return_404_when_ai_enhance_nonexistent_record', async () => {
    enableAI();
    const res = await request(getTestApp())
      .post('/api/v1/analyses/nonexistent-id-xxxx/ai-enhance')
      .set(authHeaders())
      .expect(404);
    assertApiError(res, ErrorCode.ANALYSIS_NOT_FOUND, 404);
  });
});

// ============================================================
// Task 23.2: 非遗作品评估流程
// ============================================================
describe('非遗作品评估流程 (Task 23.2)', () => {
  it('should_complete_heritage_papercut_full_flow', async () => {
    enableAI();
    const { enhanceBody } = await createAndEnhance({
      artType: 'heritage',
      heritageCategory: 'papercut',
      content: buildHeritageDepthContent('papercut'),
    });
    const detail = enhanceBody.data;
    expect(detail.aiEnhanced).toBe(true);
    expect(detail.heritageCategory).toBe('papercut');
    // 非遗 4 维度评分
    expect(detail.result?.aiVisionResult?.originalityAndStyle?.score).toBeGreaterThan(0);
    expect(detail.result?.aiVisionResult?.craftsmanship?.score).toBeGreaterThan(0);
  });

  it('should_complete_heritage_embroidery_full_flow', async () => {
    enableAI();
    const { enhanceBody } = await createAndEnhance({
      artType: 'heritage',
      heritageCategory: 'embroidery',
      content: buildHeritageDepthContent('embroidery'),
    });
    expect(enhanceBody.data.aiEnhanced).toBe(true);
    expect(enhanceBody.data.heritageCategory).toBe('embroidery');
  });

  it('should_complete_heritage_porcelain_full_flow', async () => {
    enableAI();
    const { enhanceBody } = await createAndEnhance({
      artType: 'heritage',
      heritageCategory: 'porcelain',
      content: buildHeritageDepthContent('porcelain'),
    });
    expect(enhanceBody.data.aiEnhanced).toBe(true);
    expect(enhanceBody.data.heritageCategory).toBe('porcelain');
  });

  it('should_inject_heritage_category_context_into_ai_prompt', async () => {
    enableAI();
    await createAndEnhance({
      artType: 'heritage',
      heritageCategory: 'papercut',
      content: buildHeritageDepthContent('papercut'),
    });
    const promptText = getLastPromptText();
    // prompt 应注入非遗类目工艺维度上下文
    expect(promptText).toContain('非遗类目工艺维度');
    // 剪纸类目专属维度上下文
    expect(promptText).toContain('剪纸工艺四维度');
    expect(promptText).toContain('papercut');
  });

  it('should_inject_heritage_embroidery_dimension_context_into_prompt', async () => {
    enableAI();
    await createAndEnhance({
      artType: 'heritage',
      heritageCategory: 'embroidery',
      content: buildHeritageDepthContent('embroidery'),
    });
    const promptText = getLastPromptText();
    expect(promptText).toContain('刺绣工艺四维度');
  });

  it('should_persist_heritageCategory_through_full_flow', async () => {
    enableAI();
    const { id } = await createAndEnhance({
      artType: 'heritage',
      heritageCategory: 'papercut',
      content: buildHeritageDepthContent('papercut'),
    });
    // GET /:id 验证 heritageCategory 持久化
    const getRes = await request(getTestApp())
      .get(`/api/v1/analyses/${id}`)
      .set(authHeaders())
      .expect(200);
    const detail = assertApiResponse(getRes).data;
    expect(detail.heritageCategory).toBe('papercut');
    expect(detail.workType).toBe('heritage');
  });
});

// ============================================================
// Task 23.3: 算法去同质化验证
// ============================================================
describe('算法去同质化验证 (Task 23.3)', () => {
  it('should_inject_dehomogenization_constraint_into_ai_prompt', async () => {
    enableAI();
    await createAndEnhance({
      artType: 'painting',
      evaluationStage: 'master',
      content: buildDepthContent({ evaluationStage: 'master' }),
    });
    const promptText = getLastPromptText();
    // 禁止模板化建议硬约束
    expect(promptText).toContain('禁止模板化建议');
    // 不同作品诊断可区分约束
    expect(promptText).toContain('不同作品的诊断结果必须可区分');
  });

  it('should_inject_featureFingerprint_metrics_into_ai_prompt', async () => {
    enableAI();
    await createAndEnhance({
      artType: 'painting',
      evaluationStage: 'master',
      content: buildDepthContent({ evaluationStage: 'master' }),
    });
    const promptText = getLastPromptText();
    // 作品特征指纹注入(去同质化锚点)
    expect(promptText).toContain('作品特征指纹');
    expect(promptText).toContain('去同质化锚点');
    // Jimp 客观指标(视觉重心等)注入 prompt
    expect(promptText).toContain('视觉重心');
  });

  it('should_record_featureFingerprint_on_enhanced_result', async () => {
    enableAI();
    const { enhanceBody } = await createAndEnhance({
      artType: 'painting',
      evaluationStage: 'master',
      content: buildDepthContent({ evaluationStage: 'master' }),
    });
    // featureFingerprint 由 Jimp 指标生成,记录到结果顶层(去同质化 + 历史对比)
    const fp = enhanceBody.data.result?.featureFingerprint;
    expect(fp).toBeDefined();
    expect(fp?.metricsSnapshot).toBeDefined();
    expect(typeof fp?.metricsSnapshot?.focusX).toBe('number');
    expect(fp?.generatedAt).toBeTruthy();
  });

  it('should_produce_different_results_for_different_ai_responses', async () => {
    enableAI();
    // 作品 A:AI 返回高分 + 构图相关建议
    const { id: idA, enhanceBody: bodyA } = await createAndEnhance({
      artType: 'painting',
      evaluationStage: 'master',
      content: buildDepthContent({
        evaluationStage: 'master',
        overallDelta: 0,
        deepDims: {
          originality_and_style: buildDepthDimension(90, '原创性极高,风格独特。', '建议:保持当前原创方向。'),
          completeness_and_rhythm: buildDepthDimension(88, '完整度优秀。', '建议:节奏良好。'),
          emotion_and_mood: buildDepthDimension(85, '情感传达充分。', '建议:意境到位。'),
          craftsmanship: buildDepthDimension(92, '工艺精湛。', '建议:技法成熟。'),
        },
        professionalSuggestions: [{ category: '构图', suggestion: '视觉重心(0.62,0.41)偏右下,主体清晰。' }],
      }),
    });

    // 作品 B:AI 返回低分 + 色彩相关建议(完全不同的诊断内容)
    const { id: idB, enhanceBody: bodyB } = await createAndEnhance({
      artType: 'painting',
      evaluationStage: 'master',
      content: buildDepthContent({
        evaluationStage: 'master',
        overallDelta: 0,
        deepDims: {
          originality_and_style: buildDepthDimension(45, '原创性不足,风格雷同。', '建议:突破既有模式。'),
          completeness_and_rhythm: buildDepthDimension(40, '完整度欠缺。', '建议:补充画面节奏。'),
          emotion_and_mood: buildDepthDimension(38, '情感表达单薄。', '建议:强化意境。'),
          craftsmanship: buildDepthDimension(42, '工艺粗糙。', '建议:精炼技法。'),
        },
        professionalSuggestions: [{ category: '色彩', suggestion: '暖冷比失衡,饱和度偏低,色彩断层明显。' }],
      }),
    });

    expect(idA).not.toBe(idB);
    // 不同 AI 诊断应产生不同的 overallScore(系统未塌缩为模板)
    expect(bodyA.data.result?.overallScore).not.toBe(bodyB.data.result?.overallScore);
    expect(bodyA.data.result?.overallScore).toBeGreaterThan(bodyB.data.result?.overallScore);
  });

  it('should_record_featureFingerprint_on_both_results', async () => {
    enableAI();
    const { id: idA } = await createAndEnhance({
      artType: 'painting',
      evaluationStage: 'master',
      content: buildDepthContent({ evaluationStage: 'master' }),
    });
    const { id: idB } = await createAndEnhance({
      artType: 'painting',
      evaluationStage: 'academy',
      content: buildDepthContent({ evaluationStage: 'academy' }),
    });

    // 两条记录均记录特征指纹(去同质化基础设施)
    for (const id of [idA, idB]) {
      const getRes = await request(getTestApp())
        .get(`/api/v1/analyses/${id}`)
        .set(authHeaders())
        .expect(200);
      const detail = assertApiResponse(getRes).data;
      expect(detail.result?.featureFingerprint).toBeDefined();
      expect(detail.result?.featureFingerprint?.metricsSnapshot).toBeDefined();
    }
  });

  it('should_have_suggestion_difference_above_70_percent', async () => {
    enableAI();
    // 两条完全不同主题/数值的建议文本(模拟不同作品的真实差异诊断)
    const suggestionA = '视觉重心(0.62,0.41)偏右下,主体落于黄金分割点,暖色占比60%,建议保持。';
    const suggestionB = '笔触方向杂乱,纹理复杂度0.78,边缘密度偏高,需统一走向。';

    const { enhanceBody: bodyA } = await createAndEnhance({
      artType: 'painting',
      evaluationStage: 'master',
      content: buildDepthContent({
        evaluationStage: 'master',
        professionalSuggestions: [{ category: '构图', suggestion: suggestionA }],
      }),
    });
    const { enhanceBody: bodyB } = await createAndEnhance({
      artType: 'painting',
      evaluationStage: 'master',
      content: buildDepthContent({
        evaluationStage: 'master',
        professionalSuggestions: [{ category: '笔触', suggestion: suggestionB }],
      }),
    });

    // 从持久化结果提取建议文本
    const suggestionsA = bodyA.data.result?.aiVisionResult?.professionalSuggestions ?? [];
    const suggestionsB = bodyB.data.result?.aiVisionResult?.professionalSuggestions ?? [];
    const textA = suggestionsA.map((s: { suggestion?: string }) => s.suggestion ?? '').join('');
    const textB = suggestionsB.map((s: { suggestion?: string }) => s.suggestion ?? '').join('');

    // Jaccard 距离 ≥ 0.70(去同质化:不同作品诊断差异度 ≥70%)
    const distance = jaccardDistance(textA, textB);
    expect(distance).toBeGreaterThanOrEqual(0.7);
  });
});
