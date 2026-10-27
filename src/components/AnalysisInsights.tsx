// ============================================================
// AnalysisInsights — 分析报告增强区块(Phase 3)
//
// 在分析结果页嵌入:
//   1. 维度雷达图(复用 ReportRadarChart)
//   2. 历史对比(本次 vs 上次 vs 平均,趋势徽章)
//   3. 成长趋势迷你图(近 5 次同类型得分折线)
//
// 数据来源: GET /analyses/:id/report-data(后端聚合)
//
// 降级策略:
//   - 本地分析结果(非 UUID id) → 不渲染
//   - 接口失败/无权限            → 静默不渲染(不阻塞主流程)
//   - 无历史数据                 → 仅渲染雷达图
// ============================================================

import { useEffect, useMemo, useState } from 'react';
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { TrendingUp, TrendingDown, Minus, Radar as RadarIcon, History, Loader2 } from 'lucide-react';
import { getReportData } from '../services/api';
import type { HistoryComparison, ReportDataResponse, RadarDataPoint } from '../types/api-contract';
import type { DepthDimensionScore } from '../types';
import ReportRadarChart from './report/ReportRadarChart';

/**
 * AI 深度分析 4 维度评分透传结构(由 AnalysisPage 从 result.aiVisionResult 传入)。
 * 雷达图在基础维度轴后追加这 4 轴,趋势曲线追加 4 条轨迹,仅在 aiEnhanced 时渲染。
 */
interface DepthDimensionsProp {
  originalityAndStyle?: DepthDimensionScore;
  completenessAndRhythm?: DepthDimensionScore;
  emotionAndMood?: DepthDimensionScore;
  craftsmanship?: DepthDimensionScore;
}

/** 4 维度 → 雷达图轴定义(label 中文简称,雷达图空间有限保持简洁) */
const DEPTH_RADAR_AXES: Array<{
  key: keyof DepthDimensionsProp;
  label: string;
}> = [
  { key: 'originalityAndStyle', label: '原创性' },
  { key: 'completenessAndRhythm', label: '完整度' },
  { key: 'emotionAndMood', label: '情感' },
  { key: 'craftsmanship', label: '工艺' },
];

/** 4 维度趋势轨迹配色(墨色体系:玉/金/石青/赭石,与综合 cinnabar 区分) */
const DEPTH_TRAJECTORY_COLORS: Array<{ key: string; label: string; stroke: string }> = [
  { key: 'dOrig', label: '原创性', stroke: '#5b8c5a' },
  { key: 'dComp', label: '完整度', stroke: '#d4af37' },
  { key: 'dEmo', label: '情感', stroke: '#2e5fa1' },
  { key: 'dCraft', label: '工艺', stroke: '#8b5a3c' },
];

/** 服务端分析 ID 为 UUID v4;本地分析结果为 `analysis-<timestamp>` */
const SERVER_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface AnalysisInsightsProps {
  /** 分析任务 ID(服务端 UUID;本地结果自动隐藏) */
  analysisId: string;
  /** AI 深度分析 4 维度评分(aiEnhanced 时传入,雷达图追加 4 轴 + 趋势曲线追加 4 维度轨迹) */
  depthDimensions?: DepthDimensionsProp;
  /** 是否经过 AI 深度增强(控制 4 维度轴/轨迹是否渲染,缺失按 false 处理) */
  aiEnhanced?: boolean;
}

/** 趋势徽章(与报告模板同款配色语义) */
function TrendBadge({ trend }: { trend: HistoryComparison['trend'] }) {
  if (trend === 'up') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-jade/10 text-jade rounded-full text-xs font-medium">
        <TrendingUp className="w-3 h-3" />
        较上次进步
      </span>
    );
  }
  if (trend === 'down') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-cinnabar/10 text-cinnabar rounded-full text-xs font-medium">
        <TrendingDown className="w-3 h-3" />
        较上次回落
      </span>
    );
  }
  if (trend === 'flat') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-ink-900/5 text-ink-600 rounded-full text-xs font-medium">
        <Minus className="w-3 h-3" />
        与上次持平
      </span>
    );
  }
  return null;
}

export default function AnalysisInsights({ analysisId, depthDimensions, aiEnhanced }: AnalysisInsightsProps) {
  const [data, setData] = useState<ReportDataResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const isServerId = SERVER_ID_RE.test(analysisId);

  /* Task 13.1:雷达图在基础维度轴后追加 4 维度轴(仅 aiEnhanced 且存在 4 维度数据时)。
   * useMemo 置于早返回之前以满足 hooks 调用顺序约束;data 为 null 时返回空数组兜底。 */
  const radarData = useMemo<RadarDataPoint[]>(() => {
    const base = data?.radarData ?? [];
    if (!aiEnhanced || !depthDimensions) return base;
    const depthAxes: RadarDataPoint[] = DEPTH_RADAR_AXES
      .filter((axis) => Boolean(depthDimensions[axis.key]))
      .map((axis) => ({
        dimension: axis.key,
        label: axis.label,
        score: Math.round(depthDimensions[axis.key]!.score),
        fullMark: 100,
      }));
    return depthAxes.length > 0 ? [...base, ...depthAxes] : base;
  }, [data, aiEnhanced, depthDimensions]);

  /* Task 13.3:成长趋势追加 4 维度轨迹。历史 growthMini 仅含综合 score,
   * 此处将最新点(本次分析)补上 4 维度值,其余点置 null,
   * recharts 绘制出从无到本次的轨迹终点,与雷达图同数据源。 */
  const growthWithDepth = useMemo(() => {
    const base = data?.growthMini ?? [];
    if (base.length < 2 || !aiEnhanced || !depthDimensions) return base;
    const lastIdx = base.length - 1;
    return base.map((p, i) => ({
      ...p,
      dOrig: i === lastIdx ? (depthDimensions.originalityAndStyle?.score ?? null) : null,
      dComp: i === lastIdx ? (depthDimensions.completenessAndRhythm?.score ?? null) : null,
      dEmo: i === lastIdx ? (depthDimensions.emotionAndMood?.score ?? null) : null,
      dCraft: i === lastIdx ? (depthDimensions.craftsmanship?.score ?? null) : null,
    }));
  }, [data, aiEnhanced, depthDimensions]);

  useEffect(() => {
    if (!isServerId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    getReportData(analysisId)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch(() => {
        /* 查询失败静默降级:不阻塞评分主流程 */
        if (!cancelled) setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [analysisId, isServerId]);

  /* 本地分析 / 加载失败:不渲染 */
  if (!isServerId) return null;
  if (!loading && !data) return null;

  const history = data?.historyComparison ?? null;
  const growthMini = data?.growthMini ?? [];
  const hasHistory = history !== null && (history.previous !== null || history.average !== null);
  const hasGrowth = growthMini.length >= 2;
  const currentScore = data?.analysis.result?.overallScore ?? null;

  /* 4 维度数据是否可用于追加(雷达图 4 轴 + 趋势曲线 4 轨迹) */
  const hasDepth =
    Boolean(aiEnhanced) &&
    Boolean(depthDimensions) &&
    DEPTH_RADAR_AXES.some((axis) => Boolean(depthDimensions && depthDimensions[axis.key]));

  return (
    <div className="bg-rice-50 rounded-2xl p-6 shadow-card">
      <div className="flex items-center gap-2 mb-4">
        <RadarIcon className="w-5 h-5 text-cinnabar" />
        <h3 className="font-serif text-lg font-semibold text-ink-900">维度洞察</h3>
        <span className="text-xs text-ink-500 ml-1">雷达图 · 历史对比 · 成长趋势</span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10 text-ink-400">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          <span className="text-sm">正在聚合历史数据…</span>
        </div>
      ) : data ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* 左:维度雷达图(hasDepth 时追加 4 深度维度轴) */}
          <div>
            <p className="text-xs font-medium text-ink-500 mb-2">
              维度雷达图{hasDepth ? <span className="text-gold-dark"> · 含 4 深度维度</span> : null}
            </p>
            <ReportRadarChart data={radarData} height={240} />
          </div>

          {/* 右:历史对比 + 成长趋势 */}
          <div className="space-y-4">
            {hasHistory && history && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <History className="w-4 h-4 text-ink-500" />
                  <p className="text-xs font-medium text-ink-500">历史对比(同类型)</p>
                  <TrendBadge trend={history.trend} />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="bg-white/60 rounded-lg p-3 border border-ink-100 text-center">
                    <div className="text-2xs text-ink-400 mb-1">本次</div>
                    <div className="font-serif text-xl font-bold text-cinnabar">
                      {currentScore ?? '—'}
                    </div>
                  </div>
                  <div className="bg-white/60 rounded-lg p-3 border border-ink-100 text-center">
                    <div className="text-2xs text-ink-400 mb-1">上次</div>
                    <div className="font-serif text-xl font-bold text-ink-700">
                      {history.previous ? history.previous.score : '—'}
                    </div>
                  </div>
                  <div className="bg-white/60 rounded-lg p-3 border border-ink-100 text-center">
                    <div className="text-2xs text-ink-400 mb-1">平均</div>
                    <div className="font-serif text-xl font-bold text-ink-700">
                      {history.average !== null ? history.average : '—'}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {hasGrowth && (
              <div>
                <p className="text-xs font-medium text-ink-500 mb-2">
                  成长趋势(近 {growthMini.length} 次){hasDepth ? <span className="text-gold-dark"> · 含 4 深度维度轨迹</span> : null}
                </p>
                <div style={{ width: '100%', height: 120 }} role="img" aria-label="成长趋势迷你图">
                  <ResponsiveContainer>
                    <LineChart data={growthWithDepth} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
                      <XAxis dataKey="date" hide />
                      <YAxis domain={[0, 100]} hide />
                      <Tooltip
                        formatter={(value, name) => [`${value} 分`, name as string]}
                        labelFormatter={(label) => String(label).slice(0, 10)}
                        contentStyle={{ fontSize: 12, borderRadius: 8 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="score"
                        name="综合"
                        stroke="#c41e3a"
                        strokeWidth={2}
                        dot={{ r: 3, fill: '#c41e3a' }}
                        isAnimationActive={false}
                      />
                      {hasDepth && DEPTH_TRAJECTORY_COLORS.map((c) => (
                        <Line
                          key={c.key}
                          type="monotone"
                          dataKey={c.key}
                          name={c.label}
                          stroke={c.stroke}
                          strokeWidth={1.5}
                          strokeDasharray="4 3"
                          dot={{ r: 2.5, fill: c.stroke }}
                          connectNulls
                          isAnimationActive={false}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                {hasDepth && (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5">
                    <span className="inline-flex items-center gap-1 text-2xs text-ink-500">
                      <span className="inline-block w-3 h-0.5 bg-cinnabar rounded-full" />
                      综合
                    </span>
                    {DEPTH_TRAJECTORY_COLORS.map((c) => (
                      <span key={c.key} className="inline-flex items-center gap-1 text-2xs text-ink-500">
                        <span className="inline-block w-3 h-0.5 rounded-full" style={{ backgroundColor: c.stroke }} />
                        {c.label}
                      </span>
                    ))}
                    <span className="text-2xs text-ink-400">虚线为本次深度维度轨迹终点</span>
                  </div>
                )}
              </div>
            )}

            {!hasHistory && !hasGrowth && (
              <p className="text-xs text-ink-400 leading-relaxed">
                完成更多同类型作品诊断后,这里将展示历史对比与成长趋势。
              </p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
