// ============================================================
// 知识点卡片匹配引擎单元测试(参考图混合方案 Phase 3 批次③)
// 对应源码:src/services/knowledge-card-match.service.ts
//   - resolveKnowledgeCardCategory:分析记录 → 卡片类目映射
//   - scoreCardAgainstProblem:problemPattern 关键词评分(纯函数)
//   - buildProblemText:标注问题语料拼接
//   - getWorkMetaById:作品元数据解析(artworks/heritage-works 双库)
//   - injectMarkerReferences:注入主入口(反馈模式路由/highlight 跳过/容错)
// 对应文档:visual-annotation-feedback-upgrade-spec-2026-09.md §5
//
// Mock 策略:vi.mock repository/knowledge-base/logger/env
//   (heritage-works.json 真实读取——路径解析在模块内锚定源码位置,与运行目录无关)
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';

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

vi.mock('../src/repositories/knowledge-card.repository.js', () => ({
  knowledgeCardRepository: { listEnabledByCategory: vi.fn() },
}));

vi.mock('../src/services/knowledge-base.service.js', () => ({
  knowledgeBaseService: { getArtworkById: vi.fn() },
}));

import { knowledgeCardRepository } from '../src/repositories/knowledge-card.repository.js';
import { knowledgeBaseService } from '../src/services/knowledge-base.service.js';
import type { KnowledgeCard } from '@prisma/client';
import type { IssueMarker } from '../src/types/ai-analysis.js';
import {
  resolveKnowledgeCardCategory,
  scoreCardAgainstProblem,
  buildProblemText,
  getWorkMetaById,
  injectMarkerReferences,
} from '../src/services/knowledge-card-match.service.js';

// ---------- fixture ----------

const mockListCards = vi.mocked(knowledgeCardRepository.listEnabledByCategory);
const mockGetArtworkById = vi.mocked(knowledgeBaseService.getArtworkById);

function makeCard(overrides: Partial<KnowledgeCard> = {}): KnowledgeCard {
  return {
    id: 'kcard_sketch_value_gray_004',
    category: 'sketch',
    topic: '明度/画面灰',
    problemPattern: '灰 明度 层次 拉开',
    difficulty: 'basic',
    explanation: '画面灰的本质是明度范围压缩。',
    practiceDrill: '明度两端练习。',
    referenceAssets: { status: 'pending', steps: 3, imageUrls: [], caption: '画面灰修正' },
    relatedWorks: ['eu-portrait-001'],
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

beforeEach(() => {
  vi.clearAllMocks();
  // mockReset 清除 mockResolvedValueOnce/mockReturnValueOnce 队列:
  // clearAllMocks 只清调用记录,Once 队列会跨测试残留导致数据错位
  // (如 highlight 测试跳过 repo 调用,其 Once 泄漏给下一个测试)
  mockListCards.mockReset();
  mockGetArtworkById.mockReset();
  mockListCards.mockResolvedValue([]);
  mockGetArtworkById.mockReturnValue(null);
});

// ============================================================
// 1. resolveKnowledgeCardCategory
// ============================================================

describe('resolveKnowledgeCardCategory', () => {
  it('exam 模式:科目直配(sketch/color/quickSketch)', () => {
    expect(
      resolveKnowledgeCardCategory({ diagnosisMode: 'exam', examSubject: 'sketch', workType: 'painting' }),
    ).toBe('sketch');
    expect(
      resolveKnowledgeCardCategory({ diagnosisMode: 'exam', examSubject: 'color', workType: 'painting' }),
    ).toBe('color');
    expect(
      resolveKnowledgeCardCategory({ diagnosisMode: 'exam', examSubject: 'quickSketch', workType: 'painting' }),
    ).toBe('quickSketch');
  });

  it('exam 模式:科目缺失兜底 sketch', () => {
    expect(
      resolveKnowledgeCardCategory({ diagnosisMode: 'exam', examSubject: null, workType: 'painting' }),
    ).toBe('sketch');
  });

  it('teaching 模式:design/heritage 直配,painting→sketch(素描基础通用)', () => {
    expect(
      resolveKnowledgeCardCategory({ diagnosisMode: 'teaching', examSubject: null, workType: 'design' }),
    ).toBe('design');
    expect(
      resolveKnowledgeCardCategory({ diagnosisMode: 'teaching', examSubject: null, workType: 'heritage' }),
    ).toBe('heritage');
    expect(
      resolveKnowledgeCardCategory({ diagnosisMode: 'teaching', examSubject: null, workType: 'painting' }),
    ).toBe('sketch');
  });

  it('product/sculpture 无对应卡片库 → undefined(宁缺勿滥)', () => {
    expect(
      resolveKnowledgeCardCategory({ diagnosisMode: 'teaching', examSubject: null, workType: 'product' }),
    ).toBeUndefined();
    expect(
      resolveKnowledgeCardCategory({ diagnosisMode: 'teaching', examSubject: null, workType: 'sculpture' }),
    ).toBeUndefined();
  });
});

// ============================================================
// 2. scoreCardAgainstProblem(纯函数)
// ============================================================

describe('scoreCardAgainstProblem', () => {
  const card = makeCard({ problemPattern: '灰 明度 层次' });

  it('label 命中关键词双倍计分', () => {
    // label"画面偏灰"命中"灰"(2 分);文本无额外命中
    expect(scoreCardAgainstProblem(card, '对比不足', '画面偏灰')).toBe(2);
  });

  it('正文命中单倍计分,label 与正文叠加', () => {
    // label 命中"灰"(2) + 正文命中"明度""层次"(1+1)
    expect(scoreCardAgainstProblem(card, '明度层次不清', '画面偏灰')).toBe(4);
  });

  it('全部未命中返回 0(不推荐)', () => {
    expect(scoreCardAgainstProblem(card, '构图重心偏移', '主体过小')).toBe(0);
  });

  it('problemPattern 为空串返回 0(防御)', () => {
    expect(scoreCardAgainstProblem(makeCard({ problemPattern: '' }), '任意', '任意')).toBe(0);
  });
});

// ============================================================
// 3. buildProblemText
// ============================================================

describe('buildProblemText', () => {
  it('拼接 label/dimension/why/how 并转小写', () => {
    const text = buildProblemText(
      makeMarker({ label: '画面灰', dimension: '明暗', why: '层次压缩', how: '拉开两端' }),
    );
    expect(text).toBe('画面灰 明暗 层次压缩 拉开两端');
  });

  it('可选字段缺失时跳过不产生连续空格堆积(语义不受影响)', () => {
    const text = buildProblemText(makeMarker({ dimension: undefined, why: undefined, how: undefined }));
    expect(text.trim()).toBe('画面偏灰');
  });
});

// ============================================================
// 4. getWorkMetaById(双作品库解析)
// ============================================================

describe('getWorkMetaById', () => {
  it('heritage- 前缀走 heritage-works.json(真实文件)', () => {
    const meta = getWorkMetaById('heritage-001');
    expect(meta).not.toBeNull();
    expect(meta!.title).toBe('凤翔团花剪纸');
    expect(typeof meta!.attribution).toBe('string');
  });

  it('非 heritage 前缀走后端知识库(getArtworkById)', () => {
    mockGetArtworkById.mockReturnValueOnce({
      id: 'eu-portrait-001',
      title: '戴珍珠耳环的少女',
      artist: '维米尔',
    } as never);
    const meta = getWorkMetaById('eu-portrait-001');
    expect(meta).toEqual({ title: '戴珍珠耳环的少女', attribution: '维米尔' });
  });

  it('不存在的 ID 返回 null', () => {
    expect(getWorkMetaById('eu-nonexistent-999')).toBeNull();
    expect(getWorkMetaById('heritage-99999')).toBeNull();
  });
});

// ============================================================
// 5. injectMarkerReferences(注入主入口)
// ============================================================

describe('injectMarkerReferences', () => {
  it('category=undefined 时原样返回(无卡片库类目)', async () => {
    const markers = [makeMarker()];
    const result = await injectMarkerReferences(markers, { category: undefined, feedbackMode: 'diagnosis' });
    expect(result).toBe(markers);
    expect(mockListCards).not.toHaveBeenCalled();
  });

  it('highlight 标注跳过注入(做得好无需参考)', async () => {
    mockListCards.mockResolvedValueOnce([makeCard()]);
    const result = await injectMarkerReferences([makeMarker({ type: 'highlight' })], {
      category: 'sketch',
      feedbackMode: 'diagnosis',
    });
    expect(result[0]!.reference).toBeUndefined();
  });

  it('diagnosis 模式:卡片命中注入 step-guide(teaser 含主题)', async () => {
    mockListCards.mockResolvedValueOnce([makeCard()]);
    const result = await injectMarkerReferences([makeMarker()], {
      category: 'sketch',
      feedbackMode: 'diagnosis',
    });
    expect(result[0]!.reference).toEqual({
      kind: 'step-guide',
      cardId: 'kcard_sketch_value_gray_004',
      teaser: '明度/画面灰·分步参考图',
    });
  });

  it('guidance 模式:有关联作品注入 master-work(teaser 含作品名)', async () => {
    mockListCards.mockResolvedValueOnce([makeCard()]);
    mockGetArtworkById.mockReturnValueOnce({
      id: 'eu-portrait-001',
      title: '戴珍珠耳环的少女',
      artist: '维米尔',
    } as never);
    const result = await injectMarkerReferences([makeMarker()], {
      category: 'sketch',
      feedbackMode: 'guidance',
    });
    expect(result[0]!.reference).toEqual({
      kind: 'master-work',
      workId: 'eu-portrait-001',
      teaser: '《戴珍珠耳环的少女》·维米尔',
    });
  });

  it('guidance 模式:关联作品库中不存在时兜底 step-guide 卡片', async () => {
    mockListCards.mockResolvedValueOnce([makeCard({ relatedWorks: ['eu-gone-999'] })]);
    const result = await injectMarkerReferences([makeMarker()], {
      category: 'sketch',
      feedbackMode: 'guidance',
    });
    expect(result[0]!.reference!.kind).toBe('step-guide');
  });

  it('guidance 模式:relatedWorks 空数组兜底 step-guide', async () => {
    mockListCards.mockResolvedValueOnce([makeCard({ relatedWorks: [] })]);
    const result = await injectMarkerReferences([makeMarker()], {
      category: 'sketch',
      feedbackMode: 'guidance',
    });
    expect(result[0]!.reference!.kind).toBe('step-guide');
  });

  it('无档案 + heritage 类目:天然 guidance 倾向(作品优先)', async () => {
    mockListCards.mockResolvedValueOnce([
      makeCard({ category: 'heritage', relatedWorks: ['heritage-001'] }),
    ]);
    const result = await injectMarkerReferences([makeMarker()], {
      category: 'heritage',
      feedbackMode: undefined,
    });
    expect(result[0]!.reference!.kind).toBe('master-work');
    expect(result[0]!.reference!.workId).toBe('heritage-001');
  });

  it('多张卡片取评分最高者', async () => {
    mockListCards.mockResolvedValueOnce([
      makeCard({ id: 'kcard_weak', problemPattern: '对比 平', sortOrder: 1 }), // 仅正文命中"对比"…0 分(label"画面偏灰"不含)
      makeCard({ id: 'kcard_strong', problemPattern: '灰 明度', sortOrder: 2 }), // label 命中"灰" 2 分
    ]);
    const result = await injectMarkerReferences([makeMarker()], {
      category: 'sketch',
      feedbackMode: 'diagnosis',
    });
    expect(result[0]!.reference!.cardId).toBe('kcard_strong');
  });

  it('无命中卡片时原样返回(宁缺勿滥)', async () => {
    mockListCards.mockResolvedValueOnce([
      makeCard({ problemPattern: '构图 重心' }), // 与"画面偏灰"不相关 0 分
    ]);
    const result = await injectMarkerReferences([makeMarker()], {
      category: 'sketch',
      feedbackMode: 'diagnosis',
    });
    expect(result[0]!.reference).toBeUndefined();
  });

  it('repository 抛异常时容错:返回原标注数组(参考是增强不是依赖)', async () => {
    mockListCards.mockRejectedValueOnce(new Error('DB down'));
    const markers = [makeMarker()];
    const result = await injectMarkerReferences(markers, {
      category: 'sketch',
      feedbackMode: 'diagnosis',
    });
    expect(result).toBe(markers);
  });

  it('空标注数组直接返回', async () => {
    const result = await injectMarkerReferences([], { category: 'sketch', feedbackMode: 'diagnosis' });
    expect(result).toEqual([]);
  });

  it('契约兼容:老标注(无新字段)注入后既有字段不变(纯增量)', async () => {
    mockListCards.mockResolvedValueOnce([makeCard()]);
    const marker = makeMarker({ dimension: undefined, why: undefined, how: undefined, type: undefined });
    const result = await injectMarkerReferences([marker], {
      category: 'sketch',
      feedbackMode: 'diagnosis',
    });
    expect(result[0]!.label).toBe(marker.label);
    expect(result[0]!.severity).toBe(marker.severity);
    expect(result[0]!.improvementHint).toBe(marker.improvementHint);
    expect(result[0]!.reference).toBeDefined();
  });
});
