// ============================================================
// 评分链路审计服务 单元测试(框架二 P2)
// 对应源码: src/services/score-audit.service.ts
//
// 测试范围:
//   1. computeDiff:总分差/维度差/四档一致性判定
//   2. extractScoreSnapshot:从 Analysis.result 提取扁平评分快照
//   3. computeConsistencyStats:MAE/RMSE/档位一致率/偏差方向/维度级MAE/bySource
//   4. recordDiff:AI 快照缺失跳过;正常路径落库(mock store 验证)
// ============================================================

import { describe, it, expect } from 'vitest';
import { prismaMock } from './setup.js';
import {
  computeDiff,
  extractScoreSnapshot,
  computeConsistencyStats,
  recordDiff,
  type ScoreSnapshot,
} from '../src/services/score-audit.service.js';

// ============================================================
// 构造器
// ============================================================

function snap(overallScore: number, dimensions: Record<string, number>): ScoreSnapshot {
  return { overallScore, dimensions };
}

/** 构造 HybridAnalysisResult 形状(嵌套维度对象含 score) */
function buildAiResult(overallScore: number, dims: Record<string, number>): unknown {
  return {
    overallScore,
    aiEnhanced: true,
    dimensions: Object.fromEntries(
      Object.entries(dims).map(([k, v]) => [k, { score: v }]),
    ),
  };
}

// ============================================================
// 1. computeDiff(纯函数)
// ============================================================

describe('score-audit computeDiff', () => {
  it('计算总分差与维度差(human - ai,正值=AI 偏低)', () => {
    const ai = snap(78, { composition: 80, color: 70, brushwork: 85 });
    const human = snap(85, { composition: 88, color: 75, brushwork: 90 });
    const diff = computeDiff(ai, human);
    expect(diff.overallDiff).toBe(7);
    expect(diff.dimensionDiffs).toEqual({ composition: 8, color: 5, brushwork: 5 });
  });

  it('档位一致时 bandAgreement=true', () => {
    // 82 vs 85 均为「良」档
    const diff = computeDiff(snap(82, {}), snap(85, {}));
    expect(diff.aiBand).toBe('良');
    expect(diff.humanBand).toBe('良');
    expect(diff.bandAgreement).toBe(true);
  });

  it('跨档位时 bandAgreement=false(74=中 vs 78=良)', () => {
    const diff = computeDiff(snap(74, {}), snap(78, {}));
    expect(diff.aiBand).toBe('中');
    expect(diff.humanBand).toBe('良');
    expect(diff.bandAgreement).toBe(false);
  });

  it('维度差仅取两侧共有键(AI 缺失维度跳过)', () => {
    const ai = snap(80, { composition: 80 });
    const human = snap(80, { composition: 80, color: 90 });
    const diff = computeDiff(ai, human);
    expect(diff.dimensionDiffs).toEqual({ composition: 0 });
  });

  it('差值保留一位小数', () => {
    const diff = computeDiff(snap(80, {}), snap(80.06, {}));
    expect(diff.overallDiff).toBe(0.1);
  });
});

// ============================================================
// 2. extractScoreSnapshot(纯函数)
// ============================================================

describe('score-audit extractScoreSnapshot', () => {
  it('从嵌套维度对象提取扁平分数快照', () => {
    const result = buildAiResult(82, { composition: 85, color: 78, brushwork: 80 });
    const s = extractScoreSnapshot(result);
    expect(s).toEqual({
      overallScore: 82,
      dimensions: { composition: 85, color: 78, brushwork: 80 },
    });
  });

  it('result 为 null / 缺 overallScore / 缺 dimensions 时返回 null', () => {
    expect(extractScoreSnapshot(null)).toBeNull();
    expect(extractScoreSnapshot({ dimensions: {} })).toBeNull();
    expect(extractScoreSnapshot({ overallScore: 80 })).toBeNull();
  });

  it('维度子对象缺 score 时跳过该维度', () => {
    const s = extractScoreSnapshot({
      overallScore: 80,
      dimensions: { composition: { score: 85 }, invalid: { note: 'x' } },
    });
    expect(s?.dimensions).toEqual({ composition: 85 });
  });
});

// ============================================================
// 3. computeConsistencyStats(纯函数)
// ============================================================

describe('score-audit computeConsistencyStats', () => {
  it('空列表返回全零统计', () => {
    const stats = computeConsistencyStats([]);
    expect(stats.sampleCount).toBe(0);
    expect(stats.mae).toBe(0);
    expect(stats.bandAgreementRate).toBe(0);
    expect(stats.dimensionMae).toEqual({});
    expect(stats.bySource).toEqual({});
  });

  it('计算 MAE / RMSE / 偏差方向 / 档位一致率', () => {
    const records = [
      { overallDiff: 5, bandAgreement: true, dimensionDiffs: { composition: 5, color: 3 }, source: 'teacher_review' },
      { overallDiff: -3, bandAgreement: true, dimensionDiffs: { composition: -3, color: 1 }, source: 'teacher_review' },
      { overallDiff: 10, bandAgreement: false, dimensionDiffs: { composition: 10, color: -2 }, source: 'dispute_final' },
    ];
    const stats = computeConsistencyStats(records);

    expect(stats.sampleCount).toBe(3);
    // MAE = (5+3+10)/3 = 6
    expect(stats.mae).toBe(6);
    // RMSE = sqrt((25+9+100)/3) = sqrt(44.67) ≈ 6.68
    expect(stats.rmse).toBeCloseTo(6.68, 1);
    // meanDiff = (5-3+10)/3 = 4(AI 系统性偏低)
    expect(stats.meanDiff).toBe(4);
    expect(stats.aiUnderCount).toBe(2); // +5, +10
    expect(stats.aiOverCount).toBe(1); // -3
    expect(stats.bandAgreementRate).toBeCloseTo(0.67, 2);

    // 维度级 MAE:composition=(5+3+10)/3=6, color=(3+1+2)/3=2
    expect(stats.dimensionMae).toEqual({ composition: 6, color: 2 });

    // 来源细分:teacher_review 2 条 MAE=(5+3)/2=4;dispute_final 1 条 MAE=10 一致率0
    expect(stats.bySource['teacher_review']?.sampleCount).toBe(2);
    expect(stats.bySource['teacher_review']?.mae).toBe(4);
    expect(stats.bySource['dispute_final']?.mae).toBe(10);
    expect(stats.bySource['dispute_final']?.bandAgreementRate).toBe(0);
  });

  it('完全一致记录计入 exactCount', () => {
    const stats = computeConsistencyStats([
      { overallDiff: 0, bandAgreement: true, dimensionDiffs: {}, source: 'teacher_review' },
    ]);
    expect(stats.exactCount).toBe(1);
    expect(stats.mae).toBe(0);
    expect(stats.bandAgreementRate).toBe(1);
  });
});

// ============================================================
// 4. recordDiff(集成,mock prisma store)
// ============================================================

describe('score-audit recordDiff', () => {
  it('AI 快照缺失(analysis.result=null)返回 null 且不落库', async () => {
    const record = await recordDiff({
      analysisId: 'a-1',
      tenantId: 't-1',
      source: 'teacher_review',
      reviewerId: 'u-1',
      aiResult: null,
      humanScore: snap(85, { composition: 85 }),
      artType: 'painting',
    });
    expect(record).toBeNull();
    expect(prismaMock.scoreDiffRecordStore.size).toBe(0);
  });

  it('正常路径落库:快照/档位/差异字段完整', async () => {
    const record = await recordDiff({
      analysisId: 'a-2',
      tenantId: 't-1',
      source: 'dispute_final',
      reviewerId: 'u-2',
      aiResult: buildAiResult(72, { composition: 74, color: 66 }),
      humanScore: snap(85, { composition: 88, color: 75 }),
      artType: 'painting',
    });

    expect(record).not.toBeNull();
    expect(prismaMock.scoreDiffRecordStore.size).toBe(1);

    const stored = Array.from(prismaMock.scoreDiffRecordStore.values())[0];
    expect(stored.analysisId).toBe('a-2');
    expect(stored.source).toBe('dispute_final');
    expect(stored.overallDiff).toBe(13);
    expect(stored.dimensionDiffs).toEqual({ composition: 14, color: 9 });
    expect(stored.aiBand).toBe('中'); // 72
    expect(stored.humanBand).toBe('良'); // 85
    expect(stored.bandAgreement).toBe(false);
    expect(stored.artType).toBe('painting');
    // AI 快照含 aiEnhanced 标志
    expect((stored.aiScore as { aiEnhanced?: boolean }).aiEnhanced).toBe(true);
  });
});
