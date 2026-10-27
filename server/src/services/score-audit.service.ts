// ============================================================
// 评分链路审计服务(框架二 P2 核心)
//
// 职责:
//   1. logScoreStage:评分链路关键节点统一埋点(winston 结构化日志,
//      [score-audit] 前缀 + stage 字段,便于日志检索与后续分析)
//   2. computeDiff:计算 AI 评分与人工评分差异(纯函数,可单测)
//   3. recordDiff:教师评审/仲裁裁定时落库 ScoreDiffRecord(差异快照)
//   4. computeConsistencyStats:一致性统计(样本数/MAE/RMSE/档位一致率/
//      偏差方向/维度级 MAE)——回应对外评审
//      "没有展示 AI 与专业教师的一致性指标"的质疑
//
// 设计原则:
//   - 埋点与落库均为 fire-and-forget 或轻量操作,绝不阻塞/影响主流程
//   - diff = human - ai(正值=AI 打分偏低,负值=AI 打分偏高)
//   - 档位判定复用 score-trace.service.toBand(优90+/良75+/中60+/差<60)
// ============================================================

import type { ScoreDiffRecord } from '@prisma/client';
import { logger } from '../utils/logger.js';
import { scoreDiffRepository } from '../repositories/score-diff.repository.js';
import { toBand } from './score-trace.service.js';

// ============================================================
// 1. 链路埋点(winston 结构化日志)
// ============================================================

/** 评分链路关键节点 */
export type ScoreAuditStage =
  | 'local_analysis'    // 阶段1:Jimp 本地分析完成
  | 'score_trace'       // 证据链生成完成
  | 'ai_enhance'        // 阶段2:AI 增强完成
  | 'score_adjustment'  // AI 校准应用(delta ±5)
  | 'review_submit'     // 人工评审提交(教师/教授)
  | 'dispute_resolve';  // 争议仲裁裁定

/**
 * 统一埋点:日志格式 `[score-audit] stage=<stage>`
 * payload 约定携带 analysisId(如有),便于全链路串联回放
 */
export function logScoreStage(stage: ScoreAuditStage, payload: Record<string, unknown>): void {
  logger.info(
    { stage, module: 'score-audit', ...payload },
    `[score-audit] stage=${stage}`,
  );
}

// ============================================================
// 2. 差异计算(纯函数,可单测)
// ============================================================

/** 评分快照(扁平维度分) */
export interface ScoreSnapshot {
  overallScore: number;
  /** {composition: 78, color: 82, ...} */
  dimensions: Record<string, number>;
}

/** 差异计算结果 */
export interface ScoreDiffResult {
  /** human - ai(正值=AI 偏低,负值=AI 偏高) */
  overallDiff: number;
  /** 维度级差异:{key: human - ai}(仅取两侧共有的维度键) */
  dimensionDiffs: Record<string, number>;
  aiBand: string;
  humanBand: string;
  bandAgreement: boolean;
}

/** 计算 AI 与人工评分差异(纯函数) */
export function computeDiff(ai: ScoreSnapshot, human: ScoreSnapshot): ScoreDiffResult {
  const overallDiff = Math.round((human.overallScore - ai.overallScore) * 10) / 10;

  const dimensionDiffs: Record<string, number> = {};
  for (const [key, humanDim] of Object.entries(human.dimensions)) {
    const aiDim = ai.dimensions[key];
    if (typeof aiDim === 'number' && typeof humanDim === 'number') {
      dimensionDiffs[key] = Math.round((humanDim - aiDim) * 10) / 10;
    }
  }

  const aiBand = toBand(ai.overallScore);
  const humanBand = toBand(human.overallScore);
  return {
    overallDiff,
    dimensionDiffs,
    aiBand,
    humanBand,
    bandAgreement: aiBand === humanBand,
  };
}

/**
 * 从 Analysis.result(HybridAnalysisResult)提取扁平评分快照
 * dimensions 为联合类型对象(PaintingAnalysis 等),每个维度子对象含 .score
 */
export function extractScoreSnapshot(result: unknown): ScoreSnapshot | null {
  if (result === null || typeof result !== 'object') return null;
  const r = result as {
    overallScore?: unknown;
    dimensions?: Record<string, { score?: unknown }>;
    aiEnhanced?: boolean;
  };
  if (typeof r.overallScore !== 'number' || r.dimensions === null || typeof r.dimensions !== 'object') {
    return null;
  }
  const dimensions: Record<string, number> = {};
  for (const [key, dim] of Object.entries(r.dimensions)) {
    if (dim !== null && typeof dim === 'object' && typeof (dim as { score?: unknown }).score === 'number') {
      dimensions[key] = (dim as { score: number }).score;
    }
  }
  return { overallScore: r.overallScore, dimensions };
}

// ============================================================
// 3. 差异落库(教师评审/仲裁裁定时调用)
// ============================================================

export interface RecordDiffParams {
  analysisId: string;
  tenantId: string;
  /** teacher_review=教师评审 | dispute_final=仲裁裁定 */
  source: 'teacher_review' | 'dispute_final';
  reviewerId?: string | null;
  /** Analysis.result(AI 增强后的完整结果) */
  aiResult: unknown;
  /** 人工评分(教师评审 scores / 仲裁 finalScore) */
  humanScore: ScoreSnapshot;
  artType: string;
}

/**
 * 记录 AI-人工差异并落库(fire-and-forget,失败仅告警不抛出)
 * @returns 落库记录;AI 快照缺失(如分析无 result)时返回 null
 */
export async function recordDiff(params: RecordDiffParams): Promise<ScoreDiffRecord | null> {
  const ai = extractScoreSnapshot(params.aiResult);
  if (ai === null) {
    logScoreStage('review_submit', {
      analysisId: params.analysisId,
      note: 'ai score snapshot missing, diff skipped',
      source: params.source,
    });
    return null;
  }

  const diff = computeDiff(ai, params.humanScore);
  const aiEnhanced = Boolean(
    (params.aiResult as { aiEnhanced?: boolean } | null)?.aiEnhanced,
  );

  try {
    const record = await scoreDiffRepository.create({
      analysisId: params.analysisId,
      tenantId: params.tenantId,
      source: params.source,
      reviewerId: params.reviewerId ?? null,
      aiScore: { overallScore: ai.overallScore, dimensions: ai.dimensions, aiEnhanced } as unknown as Parameters<typeof scoreDiffRepository.create>[0]['aiScore'],
      aiBand: diff.aiBand,
      humanScore: {
        overallScore: params.humanScore.overallScore,
        dimensions: params.humanScore.dimensions,
      } as unknown as Parameters<typeof scoreDiffRepository.create>[0]['humanScore'],
      humanBand: diff.humanBand,
      overallDiff: diff.overallDiff,
      dimensionDiffs: diff.dimensionDiffs as unknown as Parameters<typeof scoreDiffRepository.create>[0]['dimensionDiffs'],
      bandAgreement: diff.bandAgreement,
      artType: params.artType,
    });

    logScoreStage(params.source === 'teacher_review' ? 'review_submit' : 'dispute_resolve', {
      analysisId: params.analysisId,
      diffRecordId: record.id,
      aiOverall: ai.overallScore,
      humanOverall: params.humanScore.overallScore,
      overallDiff: diff.overallDiff,
      aiBand: diff.aiBand,
      humanBand: diff.humanBand,
      bandAgreement: diff.bandAgreement,
      dimensionDiffs: diff.dimensionDiffs,
    });
    return record;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(
      { err: msg, analysisId: params.analysisId, source: params.source, module: 'score-audit' },
      '[score-audit] record diff failed (non-blocking)',
    );
    return null;
  }
}

// ============================================================
// 4. 一致性统计(回应对外评审"无一致性指标"质疑)
// ============================================================

/** 一致性统计结果 */
export interface ConsistencyStats {
  /** 差异样本总数 */
  sampleCount: number;
  /** 平均绝对误差(MAE,分) */
  mae: number;
  /** 均方根误差(RMSE,分) */
  rmse: number;
  /** 平均带符号偏差(正值=AI 系统性偏低,负值=AI 系统性偏高) */
  meanDiff: number;
  /** AI 偏低次数(human > ai) */
  aiUnderCount: number;
  /** AI 偏高次数(human < ai) */
  aiOverCount: number;
  /** 完全一致次数(零偏差) */
  exactCount: number;
  /** 四档档位一致率(0-1) */
  bandAgreementRate: number;
  /** 维度级 MAE:{dimensionKey: mae} */
  dimensionMae: Record<string, number>;
  /** 按来源细分统计 */
  bySource: Record<string, { sampleCount: number; mae: number; bandAgreementRate: number }>;
}

/** 基于差异记录列表计算一致性统计(纯函数,可单测) */
export function computeConsistencyStats(
  records: Array<Pick<ScoreDiffRecord, 'overallDiff' | 'bandAgreement' | 'dimensionDiffs' | 'source'>>,
): ConsistencyStats {
  const n = records.length;
  if (n === 0) {
    return {
      sampleCount: 0,
      mae: 0,
      rmse: 0,
      meanDiff: 0,
      aiUnderCount: 0,
      aiOverCount: 0,
      exactCount: 0,
      bandAgreementRate: 0,
      dimensionMae: {},
      bySource: {},
    };
  }

  let absSum = 0;
  let sqSum = 0;
  let signedSum = 0;
  let aiUnder = 0;
  let aiOver = 0;
  let exact = 0;
  let bandAgree = 0;
  const dimAbs: Record<string, number[]> = {};
  const bySourceAgg: Record<string, { absSum: number; count: number; bandAgree: number }> = {};

  for (const r of records) {
    const d = r.overallDiff;
    absSum += Math.abs(d);
    sqSum += d * d;
    signedSum += d;
    if (d > 0) aiUnder += 1;
    else if (d < 0) aiOver += 1;
    else exact += 1;
    if (r.bandAgreement) bandAgree += 1;

    // 维度级累计
    const dims = (r.dimensionDiffs ?? {}) as Record<string, number>;
    for (const [key, v] of Object.entries(dims)) {
      if (typeof v === 'number' && Number.isFinite(v)) {
        (dimAbs[key] ??= []).push(Math.abs(v));
      }
    }

    // 来源细分累计
    const agg = (bySourceAgg[r.source] ??= { absSum: 0, count: 0, bandAgree: 0 });
    agg.absSum += Math.abs(d);
    agg.count += 1;
    if (r.bandAgreement) agg.bandAgree += 1;
  }

  const round2 = (v: number) => Math.round(v * 100) / 100;
  const dimensionMae: Record<string, number> = {};
  for (const [key, arr] of Object.entries(dimAbs)) {
    dimensionMae[key] = round2(arr.reduce((s, v) => s + v, 0) / arr.length);
  }

  const bySource: ConsistencyStats['bySource'] = {};
  for (const [source, agg] of Object.entries(bySourceAgg)) {
    bySource[source] = {
      sampleCount: agg.count,
      mae: round2(agg.absSum / agg.count),
      bandAgreementRate: round2(agg.bandAgree / agg.count),
    };
  }

  return {
    sampleCount: n,
    mae: round2(absSum / n),
    rmse: round2(Math.sqrt(sqSum / n)),
    meanDiff: round2(signedSum / n),
    aiUnderCount: aiUnder,
    aiOverCount: aiOver,
    exactCount: exact,
    bandAgreementRate: round2(bandAgree / n),
    dimensionMae,
    bySource,
  };
}

/** 查询一致性统计(tenantId 省略时跨租户聚合,供管理后台;默认近 90 天) */
export async function getConsistencyStats(
  tenantId: string | undefined,
  range: { from?: Date; to?: Date } = {},
): Promise<ConsistencyStats> {
  const from = range.from ?? new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const records = tenantId
    ? await scoreDiffRepository.listByTenant(tenantId, { from, to: range.to })
    : await scoreDiffRepository.listAll({ from, to: range.to });
  return computeConsistencyStats(records);
}
