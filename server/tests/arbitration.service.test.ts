// ============================================================
// ArbitrationService 仲裁算法单元测试(Phase 5 核心)
// 对应源码: src/services/arbitration.service.ts
// 对应文档: new-features-design.md §3.3, §3.4
//          art-evaluation-research.md §3.1, §3.3, §3.5
//
// 测试范围(纯函数,无 DB 依赖):
//   1. determineLevel:争议级别判定(consistent/general/high/veto)
//   2. computeFinalScore:最终裁定计算(weighted/majority/unanimous)
//   3. 边界情况:AI 置信度降级、离群分折半、边界就低定档
//   4. 异常防护:空数组抛错
// ============================================================

import { describe, it, expect } from 'vitest';
import { arbitrationService } from '../src/services/arbitration.service.js';
import { DEFAULT_ARBITRATION_CONFIG } from '../src/config/arbitration-default.js';
import type {
  ReviewScores,
  ReviewerType,
  ArbitrationConfig,
} from '../src/types/arbitration.js';

// ============================================================
// 测试常量
// ============================================================

const CFG: ArbitrationConfig = DEFAULT_ARBITRATION_CONFIG;

// ============================================================
// 辅助函数:构造评审视图(匹配 service 内部 ReviewView 结构)
// ============================================================

interface ReviewViewLike {
  id: string;
  reviewerId: string | null;
  reviewerType: ReviewerType;
  scores: ReviewScores;
  confidence: number | null;
}

function makeScores(
  overallScore: number,
  dims: Record<string, number>,
): ReviewScores {
  const dimensions: ReviewScores['dimensions'] = {};
  for (const [key, score] of Object.entries(dims)) {
    dimensions[key] = { score, level: 'good' };
  }
  return { dimensions, overallScore };
}

function makeReview(
  id: string,
  reviewerType: ReviewerType,
  overallScore: number,
  dims: Record<string, number>,
  confidence: number | null = null,
  reviewerId: string | null = 'u-test',
): ReviewViewLike {
  return {
    id,
    reviewerId,
    reviewerType,
    scores: makeScores(overallScore, dims),
    confidence,
  };
}

// 绘画维度(构图/色彩/笔触技法),总分按各维度均分构造仅用于测试
const PAINTING_DIMS = ['composition', 'color', 'brushwork'] as const;

function makePaintingReview(
  id: string,
  reviewerType: ReviewerType,
  overall: number,
  confidence: number | null = null,
  reviewerId: string | null = 'u-test',
): ReviewViewLike {
  const dims: Record<string, number> = {};
  for (const k of PAINTING_DIMS) dims[k] = overall;
  return makeReview(id, reviewerType, overall, dims, confidence, reviewerId);
}

// ============================================================
// 测试组 1:determineLevel 争议级别判定
// ============================================================

describe('ArbitrationService.determineLevel', () => {
  it('consistent:总分极差<5 且维度差<8 → 一致', () => {
    const reviews = [
      makePaintingReview('r1', 'professor', 85),
      makePaintingReview('r2', 'lecturer', 87),
    ];
    const { level, reason } = arbitrationService.determineLevel(reviews, CFG);
    expect(level).toBe('consistent');
    expect(reason.totalRange).toBe(2);
    expect(reason.gradeCrossCount).toBe(0);
    expect(reason.vetoDetail).toBeUndefined();
  });

  it('consistent:总分极差=5(边界,≤5)仍为一致', () => {
    const reviews = [
      makePaintingReview('r1', 'professor', 80),
      makePaintingReview('r2', 'lecturer', 85),
    ];
    const { level } = arbitrationService.determineLevel(reviews, CFG);
    // 极差=5,维度差=5(<8),符合 consistent
    expect(level).toBe('consistent');
  });

  it('general:总分极差≥10 → 一般争议', () => {
    const reviews = [
      makePaintingReview('r1', 'professor', 80),
      makePaintingReview('r2', 'lecturer', 90),
    ];
    const { level, reason } = arbitrationService.determineLevel(reviews, CFG);
    expect(level).toBe('general');
    expect(reason.totalRange).toBe(10);
    expect(reason.gradeCrossCount).toBe(1); // B → A
  });

  it('general:维度差≥15 → 一般争议', () => {
    const reviews = [
      makeReview('r1', 'professor', 80, { composition: 70, color: 80, brushwork: 90 }),
      makeReview('r2', 'lecturer', 80, { composition: 90, color: 80, brushwork: 90 }),
    ];
    const { level, reason } = arbitrationService.determineLevel(reviews, CFG);
    // 总分极差=0,但 composition 维度差=20≥15 → general
    expect(level).toBe('general');
    expect(reason.dimDiffs.composition).toBe(20);
  });

  it('high:总分极差≥20 → 高争议', () => {
    const reviews = [
      makePaintingReview('r1', 'professor', 75), // C
      makePaintingReview('r2', 'lecturer', 85), // B
      makePaintingReview('r3', 'ai', 95, 0.8), // A
    ];
    const { level, reason } = arbitrationService.determineLevel(reviews, CFG);
    expect(level).toBe('high');
    expect(reason.totalRange).toBe(20);
    expect(reason.gradeCrossCount).toBe(2); // C → B → A 跨 3 档
  });

  it('high:≥2 维度差≥15 → 高争议', () => {
    const reviews = [
      makeReview('r1', 'professor', 80, { composition: 60, color: 60, brushwork: 90 }),
      makeReview('r2', 'lecturer', 80, { composition: 90, color: 90, brushwork: 90 }),
    ];
    const { level } = arbitrationService.determineLevel(reviews, CFG);
    // composition 差=30,color 差=30,共 2 维度≥15 → high
    expect(level).toBe('high');
  });

  it('high:跨档数≥2 → 高争议', () => {
    // 60(D) / 85(B) / 95(A) → 跨 3 档,gradeCrossCount=2
    const reviews = [
      makePaintingReview('r1', 'professor', 60),
      makePaintingReview('r2', 'lecturer', 85),
      makePaintingReview('r3', 'ai', 95, 0.8),
    ];
    const { level, reason } = arbitrationService.determineLevel(reviews, CFG);
    expect(level).toBe('high');
    expect(reason.gradeCrossCount).toBe(2);
  });

  it('veto:任一评委判 E(<60)且其余判 A(≥90) → 否决触发', () => {
    const reviews = [
      makePaintingReview('r1', 'professor', 55), // E
      makePaintingReview('r2', 'lecturer', 95), // A
    ];
    const { level, reason } = arbitrationService.determineLevel(reviews, CFG);
    expect(level).toBe('veto');
    expect(reason.vetoDetail).toBeDefined();
    expect(reason.vetoDetail?.lowGrade).toBe(55);
    expect(reason.vetoDetail?.highGrade).toBe(95);
  });

  it('veto 优先级高于 high(同时满足时取 veto)', () => {
    // 55(E) vs 95(A):极差=40≥20(high),但同时满足 veto
    const reviews = [
      makePaintingReview('r1', 'professor', 55),
      makePaintingReview('r2', 'lecturer', 95),
    ];
    const { level } = arbitrationService.determineLevel(reviews, CFG);
    expect(level).toBe('veto');
  });

  it('非 veto:E+D 组合不触发否决(E<60 但无 A≥90)', () => {
    const reviews = [
      makePaintingReview('r1', 'professor', 55), // E
      makePaintingReview('r2', 'lecturer', 65), // D
    ];
    const { level, reason } = arbitrationService.determineLevel(reviews, CFG);
    // 极差=10 → general(非 veto,因无 A)
    expect(level).not.toBe('veto');
    expect(reason.vetoDetail).toBeUndefined();
  });

  it('中间地带(极差 6-9,维度差 9-14)按 general 处理', () => {
    const reviews = [
      makePaintingReview('r1', 'professor', 80),
      makePaintingReview('r2', 'lecturer', 87),
    ];
    const { level } = arbitrationService.determineLevel(reviews, CFG);
    // 极差=7(>5 且 <10),维度差=7(<15)→ 不满足 consistent,中间地带 → general
    expect(level).toBe('general');
  });

  it('dimDiffs 计算正确:各维度极差记录', () => {
    const reviews = [
      makeReview('r1', 'professor', 80, { composition: 70, color: 85, brushwork: 80 }),
      makeReview('r2', 'lecturer', 85, { composition: 90, color: 75, brushwork: 80 }),
    ];
    const { reason } = arbitrationService.determineLevel(reviews, CFG);
    expect(reason.dimDiffs.composition).toBe(20);
    expect(reason.dimDiffs.color).toBe(10);
    expect(reason.dimDiffs.brushwork).toBe(0);
  });
});

// ============================================================
// 测试组 2:computeFinalScore - weighted 加权裁定
// ============================================================

describe('ArbitrationService.computeFinalScore (weighted)', () => {
  it('教授+讲师+AI 常规加权:0.5/0.3/0.2', () => {
    const reviews = [
      makePaintingReview('r1', 'professor', 80, null, 'u-prof'),
      makePaintingReview('r2', 'lecturer', 90, null, 'u-lec'),
      makePaintingReview('r3', 'ai', 85, 0.8, null),
    ];
    const result = arbitrationService.computeFinalScore(reviews, 'weighted', CFG);
    expect(result.rule).toBe('weighted');
    // 80*0.5 + 90*0.3 + 85*0.2 = 40 + 27 + 17 = 84
    expect(result.overallScore).toBe(84);
    // 权重映射应包含 3 个评委(prof/lec 用 reviewerId,AI 用 ai_ 前缀)
    expect(Object.keys(result.weightsUsed).length).toBe(3);
  });

  it('AI 置信度<0.6 → AI 权重降至 0.1', () => {
    const reviews = [
      makePaintingReview('r1', 'professor', 80),
      makePaintingReview('r2', 'lecturer', 90),
      makePaintingReview('r3', 'ai', 85, 0.5), // 低置信度
    ];
    const result = arbitrationService.computeFinalScore(reviews, 'weighted', CFG);
    // raw weights: professor=0.5, lecturer=0.3, ai=0.1(降级)
    // total=0.9, normalized: 0.5/0.9, 0.3/0.9, 0.1/0.9
    // weighted = 80*(5/9) + 90*(3/9) + 85*(1/9) = 755/9 ≈ 83.89 → 83.9
    expect(result.rule).toBe('weighted');
    expect(result.overallScore).toBeCloseTo(83.9, 1);
  });

  it('离群分折半:与中位数差>25 的评委权重×0.5', () => {
    // 中位数=85,r1=50(差35>25)→权重折半
    const reviews = [
      makePaintingReview('r1', 'professor', 50),
      makePaintingReview('r2', 'professor', 85),
      makePaintingReview('r3', 'professor', 85),
    ];
    const result = arbitrationService.computeFinalScore(reviews, 'weighted', CFG);
    expect(result.rule).toBe('weighted');
    // r1 离群,权重被折半后再次归一化,最终分应更接近 85
    // 计算:finalWeights=[0.2,0.4,0.4],weighted=50*0.2+85*0.4+85*0.4=78
    expect(result.overallScore).toBe(78);
    expect(result.overallScore).toBeGreaterThan(75);
    expect(result.overallScore).toBeLessThan(85);
  });

  it('权重归一化:评委缺席时总和<1 仍正确归一', () => {
    // 仅教授+AI(无讲师),raw weights: 0.5 + 0.2 = 0.7
    const reviews = [
      makePaintingReview('r1', 'professor', 80),
      makePaintingReview('r2', 'ai', 90, 0.8),
    ];
    const result = arbitrationService.computeFinalScore(reviews, 'weighted', CFG);
    // normalized: 0.5/0.7, 0.2/0.7
    // weighted = 80*(5/7) + 90*(2/7) = 580/7 ≈ 82.86 → 82.9
    expect(result.overallScore).toBeCloseTo(82.9, 1);
  });

  it('AI 评审(reviewerId=null)的权重键使用 ai_ 前缀', () => {
    const reviews = [
      makePaintingReview('r1', 'professor', 80, null, 'u-prof'),
      makePaintingReview('r2', 'ai', 90, 0.8, null), // AI 无 reviewerId
    ];
    const result = arbitrationService.computeFinalScore(reviews, 'weighted', CFG);
    const keys = Object.keys(result.weightsUsed);
    expect(keys).toContain('u-prof');
    expect(keys.some((k) => k.startsWith('ai_'))).toBe(true);
  });

  it('维度级加权:各维度按相同权重独立计算', () => {
    const reviews = [
      makeReview('r1', 'professor', 80, { composition: 70, color: 90 }, null, 'u-prof'),
      makeReview('r2', 'lecturer', 80, { composition: 80, color: 80 }, null, 'u-lec'),
      makeReview('r3', 'ai', 80, { composition: 80, color: 80 }, 0.8, 'u-ai'),
    ];
    const result = arbitrationService.computeFinalScore(reviews, 'weighted', CFG);
    // composition: 70*0.5 + 80*0.3 + 80*0.2 = 35+24+16 = 75
    expect(result.dimensions.composition).toBe(75);
    // color: 90*0.5 + 80*0.3 + 80*0.2 = 45+24+16 = 85
    expect(result.dimensions.color).toBe(85);
  });
});

// ============================================================
// 测试组 3:computeFinalScore - majority 多数决
// ============================================================

describe('ArbitrationService.computeFinalScore (majority)', () => {
  it('多数决:取中位数(奇数个评委)', () => {
    const reviews = [
      makePaintingReview('r1', 'professor', 70),
      makePaintingReview('r2', 'lecturer', 85),
      makePaintingReview('r3', 'ai', 90, 0.8),
    ];
    const result = arbitrationService.computeFinalScore(reviews, 'majority', CFG);
    expect(result.rule).toBe('majority');
    // 中位数 [70,85,90] = 85
    expect(result.overallScore).toBe(85);
  });

  it('多数决:取中位数(偶数个评委,取中间两数均值)', () => {
    const reviews = [
      makePaintingReview('r1', 'professor', 70),
      makePaintingReview('r2', 'lecturer', 80),
      makePaintingReview('r3', 'ai', 85, 0.8),
      makePaintingReview('r4', 'ai', 90, 0.8),
    ];
    const result = arbitrationService.computeFinalScore(reviews, 'majority', CFG);
    // 中位数 [70,80,85,90] = (80+85)/2 = 82.5
    expect(result.rule).toBe('majority');
    expect(result.overallScore).toBe(82.5);
  });

  it('多数决:权重均分(1/n)', () => {
    const reviews = [
      makePaintingReview('r1', 'professor', 80, null, 'u1'),
      makePaintingReview('r2', 'lecturer', 85, null, 'u2'),
    ];
    const result = arbitrationService.computeFinalScore(reviews, 'majority', CFG);
    // majority 规则使用评审记录 id 作为权重键
    expect(result.weightsUsed.r1).toBe(0.5);
    expect(result.weightsUsed.r2).toBe(0.5);
  });

  it('多数决:维度也取中位数', () => {
    const reviews = [
      makeReview('r1', 'professor', 80, { composition: 70 }, null, 'u1'),
      makeReview('r2', 'lecturer', 80, { composition: 80 }, null, 'u2'),
      makeReview('r3', 'ai', 80, { composition: 80 }, 0.8, 'u3'),
    ];
    const result = arbitrationService.computeFinalScore(reviews, 'majority', CFG);
    // composition 中位数 [70,80,80] = 80
    expect(result.dimensions.composition).toBe(80);
  });
});

// ============================================================
// 测试组 4:computeFinalScore - unanimous 一致同意
// ============================================================

describe('ArbitrationService.computeFinalScore (unanimous)', () => {
  it('一致同意:所有评分相同 → 取该分', () => {
    const reviews = [
      makePaintingReview('r1', 'professor', 85),
      makePaintingReview('r2', 'lecturer', 85),
    ];
    const result = arbitrationService.computeFinalScore(reviews, 'unanimous', CFG);
    expect(result.rule).toBe('unanimous');
    expect(result.overallScore).toBe(85);
    expect(result.weightsUsed).toEqual({});
  });

  it('一致同意:评分不一致 → 降级取中位数', () => {
    const reviews = [
      makePaintingReview('r1', 'professor', 80),
      makePaintingReview('r2', 'lecturer', 85),
      makePaintingReview('r3', 'ai', 90, 0.8),
    ];
    const result = arbitrationService.computeFinalScore(reviews, 'unanimous', CFG);
    expect(result.rule).toBe('unanimous');
    // 中位数 [80,85,90] = 85
    expect(result.overallScore).toBe(85);
  });

  it('一致同意:维度一致 → 取该维度分', () => {
    const reviews = [
      makeReview('r1', 'professor', 85, { composition: 80 }),
      makeReview('r2', 'lecturer', 85, { composition: 80 }),
    ];
    const result = arbitrationService.computeFinalScore(reviews, 'unanimous', CFG);
    expect(result.dimensions.composition).toBe(80);
  });

  it('一致同意:维度不一致 → 取维度中位数(overall 不一致时触发)', () => {
    const reviews = [
      makeReview('r1', 'professor', 80, { composition: 70 }, null, 'u1'),
      makeReview('r2', 'lecturer', 85, { composition: 80 }, null, 'u2'),
      makeReview('r3', 'ai', 90, { composition: 80 }, 0.8, 'u3'),
    ];
    const result = arbitrationService.computeFinalScore(reviews, 'unanimous', CFG);
    // overall 不一致(80/85/90)→ allSame=false → 维度取中位数
    // composition 中位数 [70,80,80] = 80
    expect(result.dimensions.composition).toBe(80);
  });
});

// ============================================================
// 测试组 5:边界就低定档(applyBoundaryTolerance)
// ============================================================

describe('ArbitrationService.computeFinalScore (boundary tolerance)', () => {
  it('加权分落在 90 边界±1 内 → 就低取 89', () => {
    // 构造中位数 = 90.0(80+100 均分)
    const reviews = [
      makePaintingReview('r1', 'professor', 80),
      makePaintingReview('r2', 'professor', 100),
    ];
    const result = arbitrationService.computeFinalScore(reviews, 'majority', CFG);
    // 中位数 (80+100)/2 = 90,落在 90 边界±1 内 → 就低 89
    expect(result.overallScore).toBe(89);
  });

  it('加权分远离边界 → 保留一位小数', () => {
    const reviews = [
      makePaintingReview('r1', 'professor', 75),
      makePaintingReview('r2', 'professor', 76),
    ];
    const result = arbitrationService.computeFinalScore(reviews, 'majority', CFG);
    // 中位数 (75+76)/2 = 75.5,远离 90/80/70/60 边界
    expect(result.overallScore).toBe(75.5);
  });

  it('加权分落在 80 边界±1 内(80.5)→ 就低取 79', () => {
    const reviews = [
      makePaintingReview('r1', 'professor', 80),
      makePaintingReview('r2', 'professor', 81),
    ];
    const result = arbitrationService.computeFinalScore(reviews, 'majority', CFG);
    // 中位数 (80+81)/2 = 80.5,落在 80 边界±1 内且 ≥80 → 就低 79
    expect(result.overallScore).toBe(79);
  });
});

// ============================================================
// 测试组 6:异常防护
// ============================================================

describe('ArbitrationService.computeFinalScore (error guards)', () => {
  it('空数组 weighted 规则抛错', () => {
    expect(() => arbitrationService.computeFinalScore([], 'weighted', CFG)).toThrow(
      /至少需要 1 条评审记录/,
    );
  });

  it('空数组 majority 规则抛错', () => {
    expect(() => arbitrationService.computeFinalScore([], 'majority', CFG)).toThrow(
      /至少需要 1 条评审记录/,
    );
  });

  it('空数组 unanimous 规则抛错', () => {
    expect(() => arbitrationService.computeFinalScore([], 'unanimous', CFG)).toThrow(
      /至少需要 1 条评审记录/,
    );
  });
});
