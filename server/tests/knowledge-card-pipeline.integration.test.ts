// ============================================================
// 知识点卡片全链路集成测试(参考图混合方案 Phase 3 批次⑤)
// 模拟教师视角分析 → 标注卡带参考 → 学生端弹层分步图展示的完整数据流:
//
//   教师视角分析管线(函数级串联):
//     predictFeedbackMode(档案, 近期综合分) → feedbackMode
//       → injectMarkerReferences(AI 标注, {category, feedbackMode})
//       → issueMarkers[i].reference(step-guide/master-work)
//   学生端弹层(卡片详情端点数据链路):
//     reference.cardId → controller.getKnowledgeCard(真实调用)
//       → res.data.referenceAssets(status ready/partial + imageUrls)
//
// Mock 策略(照 knowledge-card-match.test.ts):
//   - env/logger/knowledge-card.repository/knowledge-base.service 全 mock
//   - heritage-works.json 真实读取(getWorkMetaById 真实跨库链路,
//     路径解析在模块内锚定源码位置,与运行目录无关)
// 对应文档:visual-annotation-feedback-upgrade-spec-2026-09.md §5/§6 Phase 3
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Request } from 'express';

// ---------- vi.mock(必须在 import 源码前声明) ----------
vi.mock('../src/config/env.js', () => {
  const staticConfig = {
    nodeEnv: 'test' as const,
    port: 3000,
    logLevel: 'error' as const,
    databaseUrl: 'postgresql://test:test@localhost:5432/test',
    redisUrl: 'redis://localhost:6379',
    corsOrigins: ['http://localhost:5173'],
    uploadDir: 'test-uploads',
    uploadMaxSize: 10485760,
  };
  function buildEnv() {
    return { ...staticConfig };
  }
  return { env: () => buildEnv(), initEnv: () => buildEnv(), loadEnv: () => buildEnv() };
});

vi.mock('../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// repository 是 controller(service)与匹配引擎的共同依赖,一并 mock
vi.mock('../src/repositories/knowledge-card.repository.js', () => ({
  knowledgeCardRepository: {
    listEnabledByCategory: vi.fn(),
    listByCategory: vi.fn(),
    findById: vi.fn(),
  },
}));

vi.mock('../src/services/knowledge-base.service.js', () => ({
  knowledgeBaseService: { getArtworkById: vi.fn() },
}));

import { knowledgeCardRepository } from '../src/repositories/knowledge-card.repository.js';
import type { KnowledgeCard } from '@prisma/client';
import type { IssueMarker } from '../src/types/ai-analysis.js';
import { predictFeedbackMode } from '../src/services/ai-analysis.service.js';
import { injectMarkerReferences } from '../src/services/knowledge-card-match.service.js';
import { getKnowledgeCard } from '../src/controllers/knowledge-card.controller.js';

// ---------- fixture ----------

const mockListCards = vi.mocked(knowledgeCardRepository.listEnabledByCategory);
const mockFindById = vi.mocked(knowledgeCardRepository.findById);

/** ready 状态卡片(分步图 3 步齐全——批次②预生成产物形态) */
function makeReadyCard(overrides: Partial<KnowledgeCard> = {}): KnowledgeCard {
  return {
    id: 'kcard_sketch_value_gray_004',
    category: 'sketch',
    topic: '明度/画面灰',
    problemPattern: '灰 明度 层次 拉开',
    difficulty: 'basic',
    explanation: '画面灰的本质是明度范围压缩。',
    practiceDrill: '明度两端练习。',
    referenceAssets: {
      status: 'ready',
      steps: 3,
      imageUrls: ['http://img/step-1.png', 'http://img/step-2.png', 'http://img/step-3.png'],
      caption: '画面灰修正',
      generatedAt: '2026-09-06T12:00:00Z',
    },
    relatedWorks: ['heritage-001'],
    isBuiltIn: true,
    enabled: true,
    sortOrder: 13,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeMarker(overrides: Partial<IssueMarker> = {}): IssueMarker {
  return {
    x: 0.1,
    y: 0.1,
    w: 0.3,
    h: 0.3,
    label: '画面偏灰',
    severity: 'medium',
    improvementHint: '拉开明度两端。',
    type: 'critical',
    dimension: '明暗',
    why: '明度范围压缩,黑白灰层次不清。',
    how: '最重处压黑,最亮处留白。',
    ...overrides,
  };
}

/** 联考素描标准档案(Phase 2 GradingProfile 解析产物形态) */
function makeGradingProfile(basicsLine = 70) {
  return {
    id: 'gprofile_builtin_sketch',
    config: {
      defaultFeedbackMode: 'diagnosis' as const,
      dimensionWeights: [
        { key: 'form_proportion', label: '造型与比例', weight: 20 },
      ],
      thresholds: { basicsLine, dimensionPass: {} },
      tierMapping: [{ key: 'A', label: '一档', min: 90 }],
      feedbackStyle: { diagnosisIntensity: 3, positiveRatio: 0.3, toneStrictness: 3 },
    },
  };
}

// Express mock 工厂(照 utils-and-controllers.test.ts 先例,直接调用 controller)
type MockReq = Partial<Request> & {
  userId?: string;
  tenantId?: string;
  params?: Record<string, string>;
  traceId?: string;
};
type MockRes = {
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
  req: MockReq;
};
function createMockRes(req: MockReq): MockRes {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    req,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ============================================================
// 场景 A:诊断模式全链路(综合分 55 < 达标线 70,教师视角分析)
// ============================================================

describe('全链路:诊断模式(综合分低于达标线)', () => {
  it('综合分低于达标线 → diagnosis → critical 标注注入 step-guide 参考 → 弹层拉到 ready 分步图', async () => {
    // 1. 管线:反馈模式判定(预测层)
    const feedbackMode = predictFeedbackMode(makeGradingProfile(70), 55);
    expect(feedbackMode).toBe('diagnosis');

    // 2. 管线:AI 标注 → 参考注入(mock 卡片库返回 ready 卡)
    const card = makeReadyCard();
    mockListCards.mockResolvedValue([card]);

    const markers = [makeMarker()];
    const injected = await injectMarkerReferences(markers, {
      category: 'sketch',
      feedbackMode,
    });

    // 3. 断言:标注带 step-guide 参考(诊断模式卡片优先)
    expect(injected).toHaveLength(1);
    const reference = injected[0]!.reference;
    expect(reference).toBeDefined();
    expect(reference!.kind).toBe('step-guide');
    expect(reference!.cardId).toBe('kcard_sketch_value_gray_004');
    expect(reference!.teaser).toContain('分步参考图');

    // 4. 弹层数据链路:学生端用 cardId 拉卡片详情(controller 真实调用)
    mockFindById.mockResolvedValue(card);
    const req = { userId: 'student-001', tenantId: 'tenant-001', params: { id: reference!.cardId! } } as MockReq;
    const res = createMockRes(req);
    await getKnowledgeCard(req as never, res as never, vi.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0]![0] as { data: KnowledgeCard };
    expect(payload.data.referenceAssets).toMatchObject({
      status: 'ready',
      steps: 3,
    });
    expect((payload.data.referenceAssets as { imageUrls: string[] }).imageUrls).toHaveLength(3);
    expect(payload.data.explanation).toBeTruthy();
    expect(payload.data.practiceDrill).toBeTruthy();
  });

  it('highlight 正向标注不注入参考;无命中卡片宁缺勿滥', async () => {
    // highlight + 无关键词命中的 critical 混合标注
    mockListCards.mockResolvedValue([makeReadyCard()]); // problemPattern 与下方 critical 标注不匹配
    const markers = [
      makeMarker({ type: 'highlight', label: '构图稳定', why: '构图重心处理得好。' }),
      makeMarker({ label: '衬布褶皱琐碎', why: '衬布褶皱处理琐碎,缺乏整体概括。', dimension: '刻画' }),
    ];
    const injected = await injectMarkerReferences(markers, {
      category: 'sketch',
      feedbackMode: 'diagnosis',
    });

    // highlight 永不注入
    expect(injected[0]!.reference).toBeUndefined();
    // 零分命中不推荐(宁缺勿滥,无参考好过错参考)
    expect(injected[1]!.reference).toBeUndefined();
  });
});

// ============================================================
// 场景 B:引导模式全链路(综合分 85 ≥ 达标线 70)
// ============================================================

describe('全链路:引导模式(综合分达到达标线)', () => {
  it('综合分达到达标线 → guidance → master-work 参考(真实 heritage-works.json 解析)', async () => {
    // 1. 管线:反馈模式判定
    const feedbackMode = predictFeedbackMode(makeGradingProfile(70), 85);
    expect(feedbackMode).toBe('guidance');

    // 2. 管线:卡片命中且 relatedWorks 指向非遗库真实作品 heritage-001
    mockListCards.mockResolvedValue([makeReadyCard()]);

    const injected = await injectMarkerReferences([makeMarker()], {
      category: 'sketch',
      feedbackMode,
    });

    // 3. 断言:master-work 参考,workId 为真实存在的 heritage-001,
    //    teaser 由真实 heritage-works.json 元数据构造(跨库真实读取链路)
    const reference = injected[0]!.reference!;
    expect(reference.kind).toBe('master-work');
    expect(reference.workId).toBe('heritage-001');
    expect(reference.teaser).toContain('《');
  });

  it('引导模式但作品库无该 ID → 诚实退回 step-guide 卡片', async () => {
    mockListCards.mockResolvedValue([
      makeReadyCard({ id: 'kcard_sketch_comp_focus_009', relatedWorks: ['heritage-nonexistent'] }),
    ]);
    const injected = await injectMarkerReferences([makeMarker()], {
      category: 'sketch',
      feedbackMode: 'guidance',
    });
    expect(injected[0]!.reference!.kind).toBe('step-guide');
  });
});

// ============================================================
// 场景 C:诚实降级(partial 卡)与 404
// ============================================================

describe('全链路:弹层诚实降级', () => {
  it('partial 卡(分步图有空位)原样透传 status=partial,前端据此显示生成中', async () => {
    const partialCard = makeReadyCard({
      referenceAssets: {
        status: 'partial',
        steps: 3,
        imageUrls: ['http://img/step-1.png'],
        caption: '画面灰修正',
        failureReason: '第2/3步生成失败,可重跑补齐',
      },
    });
    mockFindById.mockResolvedValue(partialCard);

    const req = { userId: 'student-001', tenantId: 'tenant-001', params: { id: partialCard.id } } as MockReq;
    const res = createMockRes(req);
    await getKnowledgeCard(req as never, res as never, vi.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0]![0] as { data: KnowledgeCard };
    expect(payload.data.referenceAssets).toMatchObject({ status: 'partial' });
  });

  it('卡片不存在 → 404 RESOURCE_NOT_FOUND', async () => {
    mockFindById.mockResolvedValue(null);
    const req = { userId: 'student-001', tenantId: 'tenant-001', params: { id: 'kcard_not_exist' } } as MockReq;
    const res = createMockRes(req);
    await getKnowledgeCard(req as never, res as never, vi.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    const payload = res.json.mock.calls[0]![0] as { code: number };
    expect(payload.code).toBe(1003); // ErrorCode.RESOURCE_NOT_FOUND(数字枚举)
  });

  it('未登录(userId 缺失)→ 401', async () => {
    const req = { tenantId: 'tenant-001', params: { id: 'kcard_x' } } as MockReq;
    const res = createMockRes(req);
    await getKnowledgeCard(req as never, res as never, vi.fn());
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
