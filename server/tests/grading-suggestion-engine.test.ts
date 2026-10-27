// ============================================================
// 建议引擎纯函数表驱动测试(反馈闭环 Phase 5 批次③)
// 对应源码: src/services/grading-suggestion-engine.ts
//
// 测试维度(表驱动 + 边界):
//   T1 computeBehaviorStats:四动作计数/密度/一致率裁决分母/最近活跃/零样本
//   T2 样本不足(<20)不出建议
//   T3 R1 语气放宽:confirm ≥60% 触发 / 低于不触发 / 已在 min=1 边界不输出
//   T4 R2 诊断升档:reject+correct ≥40% 触发 / max=5 边界不输出
//   T5 R3 正面微降:密度 ≥3 触发 / 0.05 步长浮点截断 / positiveRatio=0 边界
//   T6 建议值=当前值时过滤(无变化不弹)
//   T7 已采纳防重复过滤(key+afterValue 命中过滤/不命中保留)
//   T8 多规则并存(高 confirm + 高 override + 高密度 → 三条建议)
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  computeBehaviorStats,
  deriveStyleSuggestions,
  SUGGESTION_THRESHOLDS,
} from '../src/services/grading-suggestion-engine.js';
import type { GradingBehaviorStats } from '../src/types/grading-profile.js';

// ============================================================
// 测试数据工厂
// ============================================================

/** 构造行为统计(默认样本充足:30 批注) */
function makeStats(overrides: Partial<GradingBehaviorStats> = {}): GradingBehaviorStats {
  return {
    annotationCount: 30,
    reviewedWorks: 10,
    annotationDensity: 3.0,
    actionCounts: { supplement: 10, correct: 5, confirm: 10, reject: 5 },
    actionRatios: { supplement: 10 / 30, correct: 5 / 30, confirm: 10 / 30, reject: 5 / 30 },
    upCount: 0,
    downCount: 0,
    aiAgreementRate: 10 / 15,
    lastActiveAt: '2026-09-09T00:00:00.000Z',
    ...overrides,
  };
}

/** 默认档案风格(3/0.5/3,中间值,三规则均有移动空间) */
const BASE_STYLE = { diagnosisIntensity: 3, positiveRatio: 0.5, toneStrictness: 3 };

/** 便捷入口:stats + style + adopted → 建议 */
function derive(
  stats: GradingBehaviorStats,
  style = BASE_STYLE,
  adopted: Array<{ suggestionKey: string; afterValue: number }> = [],
) {
  return deriveStyleSuggestions({ stats, currentStyle: style, adoptedSuggestions: adopted });
}

/** 构造批注行(computeBehaviorStats 用) */
function ann(action: string, analysisId: string, createdAt: Date = new Date('2026-09-01T00:00:00Z')) {
  return { teacherId: 'u-t', analysisId, action, createdAt };
}

// ============================================================
// T1: computeBehaviorStats 聚合
// ============================================================

describe('computeBehaviorStats 聚合(教师画像口径)', () => {
  it('四动作计数 + 密度 + 裁决一致率 + 最近活跃', () => {
    const stats = computeBehaviorStats([
      ann('supplement', 'a1', new Date('2026-09-01T00:00:00Z')),
      ann('confirm', 'a1', new Date('2026-09-03T00:00:00Z')),
      ann('reject', 'a2', new Date('2026-09-02T00:00:00Z')),
      ann('confirm', 'a3', new Date('2026-09-05T00:00:00Z')),
      ann('correct', 'a2', new Date('2026-09-04T00:00:00Z')),
      ann('unknown-action', 'a1'), // 容错:未知 action 不计数
    ]);

    expect(stats.annotationCount).toBe(6); // 行数全计(计数只认四动作)
    expect(stats.reviewedWorks).toBe(3);
    expect(stats.annotationDensity).toBe(2);
    expect(stats.actionCounts).toEqual({ supplement: 1, correct: 1, confirm: 2, reject: 1 });
    expect(stats.actionRatios.confirm).toBeCloseTo(2 / 6, 10);
    // 一致率 = confirm / (confirm + reject) = 2/3,中性 supplement/correct 不进分母
    expect(stats.aiAgreementRate).toBeCloseTo(2 / 3, 10);
    expect(stats.lastActiveAt).toBe('2026-09-05T00:00:00.000Z');
  });

  it('零批注:全 0 + 一致率 null + 最近活跃 null', () => {
    const stats = computeBehaviorStats([]);
    expect(stats.annotationCount).toBe(0);
    expect(stats.annotationDensity).toBe(0);
    expect(stats.actionRatios).toEqual({ supplement: 0, correct: 0, confirm: 0, reject: 0 });
    expect(stats.aiAgreementRate).toBeNull();
    expect(stats.lastActiveAt).toBeNull();
  });

  it('学生反馈邻接信号:up/down 计数,不参与教师侧一致率', () => {
    const stats = computeBehaviorStats([ann('confirm', 'a1'), ann('reject', 'a1')], [
      { action: 'up' },
      { action: 'up' },
      { action: 'down' },
      { action: 'other' }, // 容错
    ]);
    expect(stats.upCount).toBe(2);
    expect(stats.downCount).toBe(1);
    // 教师侧一致率仅由 confirm/reject 决定(邻接信号在租户建议的样本量门槛消费)
    expect(stats.aiAgreementRate).toBeCloseTo(1 / 2, 10);
  });
});

// ============================================================
// T2: 样本不足
// ============================================================

describe('样本门槛', () => {
  it(`批注+反馈总量 < ${SUGGESTION_THRESHOLDS.MIN_TOTAL_SAMPLES} 不出建议`, () => {
    const low = derive(makeStats({ annotationCount: 10, upCount: 5, downCount: 4 })); // 19 < 20
    expect(low).toEqual([]);
  });

  it(`纯学生反馈可凑满样本门槛(教师无批注但反馈量足)`, () => {
    const stats = makeStats({
      annotationCount: 0,
      reviewedWorks: 0,
      annotationDensity: 0,
      actionCounts: { supplement: 0, correct: 0, confirm: 0, reject: 0 },
      actionRatios: { supplement: 0, correct: 0, confirm: 0, reject: 0 },
      aiAgreementRate: null,
      upCount: 25,
      downCount: 0,
      lastActiveAt: null,
    });
    // 无批注 → 三规则均不触发,但门槛已过(返回空数组而非门槛拦截的语义区分:均空)
    expect(derive(stats)).toEqual([]);
  });

  it('恰好等于门槛(20)不拦截', () => {
    // confirm 15/20 = 75% ≥ 60% → R1 应触发
    const stats = makeStats({
      annotationCount: 20,
      reviewedWorks: 10,
      annotationDensity: 2,
      actionCounts: { supplement: 5, correct: 0, confirm: 15, reject: 0 },
      actionRatios: { supplement: 0.25, correct: 0, confirm: 0.75, reject: 0 },
      aiAgreementRate: 1,
    });
    const suggestions = derive(stats);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]!.suggestionKey).toBe('toneStrictness');
  });
});

// ============================================================
// T3-T5: 三规则触发/不触发/边界(表驱动)
// ============================================================

describe('R1 语气放宽(confirm 占比)', () => {
  it.each([
    ['触发:confirm=60% 恰好达阈值', 0.6, true],
    ['不触发:confirm=59.9%', 0.599, false],
    ['不触发:confirm=50%', 0.5, false],
  ])('%s', (_name, confirmRatio, shouldTrigger) => {
    const stats = makeStats({
      annotationCount: 30,
      actionCounts: {
        supplement: 30 - Math.round(confirmRatio * 30),
        correct: 0,
        confirm: Math.round(confirmRatio * 30),
        reject: 0,
      },
      actionRatios: {
        supplement: 1 - confirmRatio,
        correct: 0,
        confirm: confirmRatio,
        reject: 0,
      },
      annotationDensity: 1, // 关闭 R3
    });
    const suggestions = derive(stats);
    const tone = suggestions.find((s) => s.suggestionKey === 'toneStrictness');
    expect(!!tone).toBe(shouldTrigger);
    if (shouldTrigger && tone) {
      expect(tone.currentValue).toBe(3);
      expect(tone.suggestedValue).toBe(2);
      expect(tone.basis).toContain('60%');
    }
  });

  it('边界:toneStrictness 已在 min=1 → clamp 后=当前值,不输出', () => {
    const stats = makeStats({
      actionRatios: { supplement: 0.2, correct: 0, confirm: 0.8, reject: 0 },
      annotationDensity: 1,
    });
    const suggestions = derive(
      stats,
      { ...BASE_STYLE, toneStrictness: 1 },
    );
    expect(suggestions.find((s) => s.suggestionKey === 'toneStrictness')).toBeUndefined();
  });
});

describe('R2 诊断升档(reject+correct 占比)', () => {
  it.each([
    ['触发:reject20% + correct20% = 40% 恰达阈值', 0.2, 0.2, true],
    ['触发:reject40% 单项', 0.4, 0, true],
    ['不触发:合计 39%', 0.2, 0.19, false],
    ['不触发:合计 30%', 0.2, 0.1, false],
  ])('%s', (_name, rejectRatio, correctRatio, shouldTrigger) => {
    const stats = makeStats({
      annotationCount: 30,
      actionCounts: {
        supplement: 30 - Math.round((rejectRatio + correctRatio) * 30),
        correct: Math.round(correctRatio * 30),
        confirm: 0,
        reject: Math.round(rejectRatio * 30),
      },
      actionRatios: {
        supplement: 1 - rejectRatio - correctRatio,
        correct: correctRatio,
        confirm: 0,
        reject: rejectRatio,
      },
      annotationDensity: 1, // 关闭 R3
    });
    const suggestions = derive(stats);
    const intensity = suggestions.find((s) => s.suggestionKey === 'diagnosisIntensity');
    expect(!!intensity).toBe(shouldTrigger);
    if (shouldTrigger && intensity) {
      expect(intensity.currentValue).toBe(3);
      expect(intensity.suggestedValue).toBe(4);
    }
  });

  it('边界:diagnosisIntensity 已在 max=5 → 不输出', () => {
    const stats = makeStats({
      actionRatios: { supplement: 0.6, correct: 0, confirm: 0, reject: 0.4 },
      annotationDensity: 1,
    });
    const suggestions = derive(stats, { ...BASE_STYLE, diagnosisIntensity: 5 });
    expect(suggestions.find((s) => s.suggestionKey === 'diagnosisIntensity')).toBeUndefined();
  });
});

describe('R3 正面微降(批注密度)', () => {
  it.each([
    ['触发:密度 3.0 恰达阈值', 3.0, true],
    ['触发:密度 5.2', 5.2, true],
    ['不触发:密度 2.9', 2.9, false],
  ])('%s', (_name, density, shouldTrigger) => {
    const stats = makeStats({
      annotationCount: 30,
      reviewedWorks: Math.round(30 / density),
      annotationDensity: density,
      actionRatios: { supplement: 1, correct: 0, confirm: 0, reject: 0 }, // 关闭 R1/R2
    });
    const suggestions = derive(stats);
    const positive = suggestions.find((s) => s.suggestionKey === 'positiveRatio');
    expect(!!positive).toBe(shouldTrigger);
    if (shouldTrigger && positive) {
      expect(positive.currentValue).toBe(0.5);
      expect(positive.suggestedValue).toBe(0.45); // 0.5 - 0.05,两位截断无尾差
    }
  });

  it('浮点截断:0.45 - 0.05 = 0.4(非 0.4000000000000001)', () => {
    const stats = makeStats({
      actionRatios: { supplement: 1, correct: 0, confirm: 0, reject: 0 },
    });
    const suggestions = derive(stats, { ...BASE_STYLE, positiveRatio: 0.45 });
    expect(suggestions[0]!.suggestedValue).toBe(0.4);
  });

  it('边界:positiveRatio 已在 min=0 → 不输出', () => {
    const stats = makeStats({
      actionRatios: { supplement: 1, correct: 0, confirm: 0, reject: 0 },
    });
    const suggestions = derive(stats, { ...BASE_STYLE, positiveRatio: 0 });
    expect(suggestions.find((s) => s.suggestionKey === 'positiveRatio')).toBeUndefined();
  });
});

// ============================================================
// T7: 已采纳防重复过滤
// ============================================================

describe('已采纳防重复过滤', () => {
  /** 高 confirm(75%)+密度 3 → R1(tone 3→2)+R3(positive 0.5→0.45)两条 */
  function twoRuleStats(): GradingBehaviorStats {
    return makeStats({
      annotationCount: 30,
      actionCounts: { supplement: 5, correct: 0, confirm: 24, reject: 1 },
      actionRatios: {
        supplement: 5 / 30,
        correct: 0,
        confirm: 24 / 30, // 80% ≥ 60%
        reject: 1 / 30,
      },
      annotationDensity: 3.0,
    });
  }

  it('key+afterValue 命中已采纳 → 过滤;未命中保留', () => {
    const suggestions = derive(twoRuleStats(), BASE_STYLE, [
      { suggestionKey: 'toneStrictness', afterValue: 2 }, // 命中 R1 建议值
    ]);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]!.suggestionKey).toBe('positiveRatio');
  });

  it('同 key 不同 afterValue(建议值已变)→ 保留', () => {
    const suggestions = derive(twoRuleStats(), BASE_STYLE, [
      { suggestionKey: 'toneStrictness', afterValue: 1 }, // 旧建议值≠当前建议值 2
    ]);
    expect(suggestions.find((s) => s.suggestionKey === 'toneStrictness')).toBeDefined();
  });

  it('空采纳列表不过滤', () => {
    expect(derive(twoRuleStats())).toHaveLength(2);
  });
});

// ============================================================
// T8: 多规则并存
// ============================================================

describe('多规则并存', () => {
  it('R1 与 R2 互斥(占比和>100% 不可能同时触发),各可与 R3 并存', () => {
    // R1 + R3:confirm 18/30=60% ≥ 阈值;密度 3.0 ≥ 阈值;override=0
    const r1r3Stats = makeStats({
      annotationCount: 30,
      actionCounts: { supplement: 12, correct: 0, confirm: 18, reject: 0 },
      actionRatios: {
        supplement: 0.4,
        correct: 0,
        confirm: 0.6,
        reject: 0,
      },
      annotationDensity: 3.0,
    });
    const r1r3 = derive(r1r3Stats);
    expect(r1r3.filter((s) => ['toneStrictness', 'positiveRatio'].includes(s.suggestionKey))).toHaveLength(2);
    expect(r1r3.find((s) => s.suggestionKey === 'diagnosisIntensity')).toBeUndefined();

    // R2 + R3:reject+correct = 20/30 = 66.7% ≥ 阈值;密度 3.0;confirm=0
    const r2r3Stats = makeStats({
      annotationCount: 30,
      actionCounts: { supplement: 10, correct: 8, confirm: 0, reject: 12 },
      actionRatios: {
        supplement: 10 / 30,
        correct: 8 / 30,
        confirm: 0,
        reject: 12 / 30,
      },
      annotationDensity: 3.0,
    });
    const r2r3 = derive(r2r3Stats);
    expect(r2r3.filter((s) => ['diagnosisIntensity', 'positiveRatio'].includes(s.suggestionKey))).toHaveLength(2);
    expect(r2r3.find((s) => s.suggestionKey === 'toneStrictness')).toBeUndefined();
  });

  it('每条建议含完整结构(键/前后值/依据文案/快照)', () => {
    const suggestions = derive(
      makeStats({
        actionRatios: { supplement: 0.4, correct: 0, confirm: 0.6, reject: 0 },
        annotationDensity: 1,
      }),
    );
    const s = suggestions[0]!;
    expect(s.suggestionKey).toBe('toneStrictness');
    expect(s.currentValue).toBe(3);
    expect(s.suggestedValue).toBe(2);
    expect(s.basis.length).toBeGreaterThan(10);
    expect(s.basisSnapshot.confirmRatio).toBe(0.6);
    expect(s.basisSnapshot.annotationCount).toBe(30);
  });
});
