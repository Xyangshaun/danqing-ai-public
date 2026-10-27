// ============================================================
// AI-教师评分一致性卡片 · 模拟数据预览页(框架二 P2)
// 路由: /preview/consistency(公开,绕过登录,仅本地预览用)
//
// 背景: 本机无 PostgreSQL/Docker,无法本地起后端;
// 本页在浏览器端复刻 seed-score-diff.ts 的数据生成逻辑 +
// score-audit.service.ts computeConsistencyStats 的统计算法,
// 并复用与 AdminDashboardPage 完全一致的卡片 JSX 验证展示效果。
// ============================================================

import { useMemo } from 'react';
import { Scale, Users, FlaskConical } from 'lucide-react';
import {
  AdminSection,
  DisabledPlaceholder,
  formatPct,
} from '../../components/admin/AdminUI';
import type { ScoreConsistencyStats } from '../../types/admin';

/* ---------- 四档分档(与 toBand 一致) ---------- */
function toBand(score: number): string {
  if (score >= 90) return '优';
  if (score >= 75) return '良';
  if (score >= 60) return '中';
  return '差';
}

/* ---------- 可复现伪随机(与 seed 脚本同 seed) ---------- */
function mulberry32(seed: number): () => number {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- 模拟差异记录(类型对齐 Prisma ScoreDiffRecord 关键字段) ---------- */
interface SimDiffRecord {
  overallDiff: number;
  bandAgreement: boolean;
  dimensionDiffs: Record<string, number>;
  source: string;
}

const DIMENSION_KEYS: Record<string, string[]> = {
  painting: ['composition', 'color', 'brushwork', 'overall'],
  design: ['visualHierarchy', 'typography', 'colorApplication', 'overall'],
  product: ['form', 'materialExpression', 'functionExpression', 'overall'],
  sculpture: ['spatialComposition', 'bodyLanguage', 'materialLanguage', 'overall'],
};

const COMPOSITION_LIKE = new Set([
  'composition', 'visualHierarchy', 'form', 'spatialComposition', 'overall',
]);

const ART_TYPE_PLAN = [
  ...Array(18).fill('painting'),
  ...Array(10).fill('design'),
  ...Array(7).fill('product'),
  ...Array(7).fill('sculpture'),
] as string[];

function buildSimRecords(): SimDiffRecord[] {
  const rand = mulberry32(20260816);
  const randInt = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;
  const records: SimDiffRecord[] = [];

  ART_TYPE_PLAN.forEach((artType, i) => {
    const dimKeys = DIMENSION_KEYS[artType]!;
    const mainKeys = dimKeys.filter((k) => k !== 'overall');

    const aiDims: Record<string, number> = {};
    for (const k of mainKeys) aiDims[k] = randInt(62, 88);
    const aiOverall = Math.round(mainKeys.reduce((s, k) => s + aiDims[k]!, 0) / mainKeys.length);

    const humanDims: Record<string, number> = {};
    const dimensionDiffs: Record<string, number> = {};
    for (const k of mainKeys) {
      const bump = COMPOSITION_LIKE.has(k) ? randInt(5, 11) : randInt(1, 6);
      const v = Math.min(96, aiDims[k]! + bump);
      humanDims[k] = v;
      dimensionDiffs[k] = Math.round((v - aiDims[k]!) * 10) / 10;
    }
    const humanOverall = Math.min(
      96,
      Math.round(mainKeys.reduce((s, k) => s + humanDims[k]!, 0) / mainKeys.length),
    );
    dimensionDiffs['overall'] = Math.round((humanOverall - aiOverall) * 10) / 10;

    records.push({
      overallDiff: dimensionDiffs['overall']!,
      bandAgreement: toBand(aiOverall) === toBand(humanOverall),
      dimensionDiffs,
      source: i % 4 === 3 ? 'dispute_resolve' : 'teacher_review',
    });
  });
  return records;
}

/* ---------- 统计算法(复刻 score-audit.service.ts computeConsistencyStats) ---------- */
function computeConsistencyStats(records: SimDiffRecord[]): ScoreConsistencyStats {
  const n = records.length;
  if (n === 0) {
    return {
      sampleCount: 0, mae: 0, rmse: 0, meanDiff: 0,
      aiUnderCount: 0, aiOverCount: 0, exactCount: 0,
      bandAgreementRate: 0, dimensionMae: {}, bySource: {},
    };
  }
  let absSum = 0, sqSum = 0, signedSum = 0, aiUnder = 0, aiOver = 0, exact = 0, bandAgree = 0;
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

    for (const [key, v] of Object.entries(r.dimensionDiffs ?? {})) {
      if (typeof v === 'number' && Number.isFinite(v)) {
        (dimAbs[key] ??= []).push(Math.abs(v));
      }
    }
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
  const bySource: ScoreConsistencyStats['bySource'] = {};
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

/* ---------- 维度/来源中文映射(与 AdminDashboardPage 一致) ---------- */
const DIMENSION_LABELS: Record<string, string> = {
  composition: '构图', color: '色彩', brushwork: '笔触',
  visualHierarchy: '视觉层次', typography: '排版', colorApplication: '色彩应用',
  form: '形态', materialExpression: '材料表现', functionExpression: '功能表达',
  spatialComposition: '空间构成', bodyLanguage: '形体语言', materialLanguage: '材料语言',
  overall: '总评',
};
const SOURCE_LABELS: Record<string, string> = {
  teacher_review: '教师评审',
  dispute_resolve: '仲裁裁定',
};

/* ---------- 预览数据开关:mock=false 展示空态占位 ---------- */
const USE_MOCK = true;

export default function ConsistencyPreviewPage() {
  const consistency = useMemo<ScoreConsistencyStats | null>(() => {
    if (!USE_MOCK) return null;
    return computeConsistencyStats(buildSimRecords());
  }, []);

  return (
    <div className="min-h-screen bg-rice-100">
      {/* 预览模式提示条 */}
      <div className="bg-ink-900 text-rice-50 px-4 py-2 text-xs flex items-center gap-2">
        <FlaskConical className="w-3.5 h-3.5 text-jade" />
        预览模式:浏览器端模拟数据(42 份样本,与 seed-score-diff.ts 同源同 seed),非后端实时数据
      </div>

      <div className="max-w-7xl mx-auto px-4 md:px-6 py-6 space-y-5">
        {/* 页头(模拟大屏标题栏) */}
        <div>
          <h1 className="text-xl font-semibold text-ink-900 font-serif flex items-center gap-2">
            <Scale className="w-5 h-5 text-cinnabar" />
            AI-教师评分一致性 · 卡片预览
          </h1>
          <p className="text-xs text-ink-400 mt-1">
            模拟场景:陌生作品 AI 系统性偏低 · 近 90 天 · 四类作品 × 两来源
          </p>
        </div>

        {/* 空态预览(注释 USE_MOCK=false 可切换) */}
        <AdminSection title="空态预览(无差异数据时)" desc="上线初期无评审数据时的展示">
          <DisabledPlaceholder
            text="暂无差异数据:教师评审或仲裁裁定作品评分后将自动记录"
            onRetry={() => undefined}
          />
        </AdminSection>

        {/* 正式卡片(JSX 与 AdminDashboardPage 完全一致) */}
        <AdminSection title="AI-教师评分一致性" desc="近 90 天 · 教师评审与仲裁裁定的差异快照">
          {consistency && consistency.sampleCount > 0 ? (
            <div className="space-y-3">
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-semibold font-mono text-ink-900">
                  {formatPct(consistency.bandAgreementRate)}
                </span>
                <span className="text-xs text-ink-400">四档档位一致率</span>
                <span className="ml-auto text-xs text-ink-400">样本 {consistency.sampleCount} 份</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <Row label="MAE" value={`${consistency.mae} 分`} />
                <Row label="RMSE" value={`${consistency.rmse} 分`} />
                <Row label="AI 偏低" value={String(consistency.aiUnderCount)} />
                <Row label="AI 偏高" value={String(consistency.aiOverCount)} />
              </div>
              {Object.keys(consistency.dimensionMae).length > 0 && (
                <div className="pt-2 border-t border-ink-900/5">
                  <div className="text-xs text-ink-400 mb-2 flex items-center gap-1.5">
                    <Scale className="w-3.5 h-3.5" />
                    维度级 MAE(分)
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(consistency.dimensionMae).map(([key, mae]) => (
                      <span
                        key={key}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rice-100 text-xs text-ink-700"
                      >
                        {DIMENSION_LABELS[key] ?? key}
                        <span className="font-mono">{mae}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {Object.keys(consistency.bySource).length > 0 && (
                <div className="pt-2 border-t border-ink-900/5 flex flex-wrap gap-x-6 gap-y-1 text-xs text-ink-500">
                  {Object.entries(consistency.bySource).map(([source, s]) => (
                    <span key={source}>
                      {SOURCE_LABELS[source] ?? source}:MAE {s.mae} 分 · 档位一致 {formatPct(s.bandAgreementRate)} · {s.sampleCount} 份
                    </span>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <DisabledPlaceholder
              text="暂无差异数据:教师评审或仲裁裁定作品评分后将自动记录"
              onRetry={() => undefined}
            />
          )}
        </AdminSection>
      </div>
    </div>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-ink-500 flex items-center gap-1.5">
        <Users className="w-3.5 h-3.5 text-ink-300" />
        {label}
      </span>
      <span className={`font-mono ${accent ? 'text-cinnabar font-medium' : 'text-ink-800'}`}>{value}</span>
    </div>
  );
}
