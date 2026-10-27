// ============================================================
// 学生成长版报告模板
// 重点:总分 + 雷达图 + 进步点高亮 + TOP3建议(鼓励语气) + 历史对比
// 对应规划:spec.md §3.1
// ============================================================

import { Area, AreaChart, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import { TrendingUp, TrendingDown, Minus, Star } from 'lucide-react';
import type { ReportViewModel } from './reportTypes';
import { ReportBrandHeader, ReportMetaRow, ReportFooter, PriorityChip } from './ReportChrome';
import ScoreRing from './ScoreRing';
import ReportRadarChart from './ReportRadarChart';

/** 趋势文案与图标 */
function TrendBadge({ trend }: { trend: 'up' | 'down' | 'flat' | null }) {
  if (trend === 'up') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-jade/10 text-jade text-xs font-medium">
        <TrendingUp className="w-3.5 h-3.5" /> 较上次进步
      </span>
    );
  }
  if (trend === 'down') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-cinnabar/10 text-cinnabar text-xs font-medium">
        <TrendingDown className="w-3.5 h-3.5" /> 较上次回落
      </span>
    );
  }
  if (trend === 'flat') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-ink-900/5 text-ink-500 text-xs font-medium">
        <Minus className="w-3.5 h-3.5" /> 与上次持平
      </span>
    );
  }
  return null;
}

export default function StudentTemplate({ vm }: { vm: ReportViewModel }) {
  const topSuggestions = vm.suggestions.slice(0, 3);
  // 优势维度(≥85 高亮为"进步点/亮点")
  const strengthDims = vm.dimensions.filter((d) => d.score >= 85);
  const growthData = vm.growthMini.map((p) => ({
    ...p,
    label: `${new Date(p.date).getMonth() + 1}/${new Date(p.date).getDate()}`,
  }));

  return (
    <div className="report-template bg-rice-50 text-ink-900 p-8 space-y-6">
      <ReportBrandHeader subtitle="学生成长版 · 创作诊断报告" />
      <ReportMetaRow vm={vm} />

      {/* 核心区:缩略图 + 总分 + 雷达图 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-center">
        <div className="flex justify-center">
          <img
            src={vm.imageUrl}
            alt={vm.title}
            className="max-h-44 max-w-full rounded-xl border border-ink-900/10 object-contain bg-white"
            crossOrigin="anonymous"
          />
        </div>
        <div className="flex flex-col items-center gap-2">
          <ScoreRing score={vm.overallScore} size={140} />
          <TrendBadge trend={vm.historyComparison.trend} />
        </div>
        <ReportRadarChart data={vm.radar} height={220} />
      </div>

      {/* 进步点高亮 */}
      {strengthDims.length > 0 && (
        <div className="bg-jade/5 border border-jade/20 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Star className="w-4 h-4 text-jade" />
            <h3 className="font-serif font-semibold text-ink-900">本次亮点</h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {strengthDims.map((d) => (
              <span
                key={d.key}
                className="px-2.5 py-1 bg-white rounded-lg border border-jade/30 text-sm text-ink-800"
              >
                {d.label} <span className="font-mono font-semibold text-jade">{d.score}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 维度明细 */}
      <section>
        <h3 className="font-serif font-semibold text-ink-900 mb-3">维度评分明细</h3>
        <div className="space-y-3">
          {vm.dimensions.map((d) => (
            <div key={d.key} className="bg-white rounded-xl border border-ink-900/8 p-4">
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-medium text-ink-900">{d.label}</span>
                <span className="font-mono font-semibold text-ink-900">{d.score}</span>
              </div>
              <div className="h-1.5 bg-rice-300 rounded-full overflow-hidden mb-2">
                <div
                  className="h-full rounded-full bg-cinnabar"
                  style={{ width: `${d.score}%` }}
                />
              </div>
              {d.comment && <p className="text-xs text-ink-500 leading-relaxed">{d.comment}</p>}
            </div>
          ))}
        </div>
      </section>

      {/* TOP3 建议(鼓励语气) */}
      {topSuggestions.length > 0 && (
        <section>
          <h3 className="font-serif font-semibold text-ink-900 mb-3">给你的成长建议</h3>
          <ol className="space-y-3">
            {topSuggestions.map((s, i) => (
              <li key={i} className="bg-white rounded-xl border border-ink-900/8 p-4 flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-cinnabar text-rice-50 text-xs font-bold flex items-center justify-center">
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <PriorityChip priority={s.priority} label={s.priorityLabel} />
                  </div>
                  <p className="text-sm text-ink-800 leading-relaxed">{s.content}</p>
                  {s.evidence && (
                    <p className="mt-1 text-2xs text-ink-400">依据:{s.evidence}</p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* 历史对比 + 成长趋势 */}
      {(vm.historyComparison.previous || growthData.length > 1) && (
        <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white rounded-xl border border-ink-900/8 p-4">
            <h4 className="text-sm font-medium text-ink-900 mb-3">历史对比</h4>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-ink-500">本次得分</span>
                {/* 批次⑤:基础检测未评分时显示"—",不以 0 分假显示 */}
                <span className="font-mono font-semibold text-cinnabar">
                  {vm.overallScore ?? '—'}
                </span>
              </div>
              {vm.historyComparison.previous && (
                <div className="flex justify-between">
                  <span className="text-ink-500">上次得分</span>
                  <span className="font-mono text-ink-800">
                    {vm.historyComparison.previous.score}
                  </span>
                </div>
              )}
              {vm.historyComparison.average !== null && (
                <div className="flex justify-between">
                  <span className="text-ink-500">历史平均</span>
                  <span className="font-mono text-ink-800">{vm.historyComparison.average}</span>
                </div>
              )}
            </div>
          </div>
          {growthData.length > 1 && (
            <div className="bg-white rounded-xl border border-ink-900/8 p-4">
              <h4 className="text-sm font-medium text-ink-900 mb-2">近期成长趋势</h4>
              <div style={{ width: '100%', height: 110 }}>
                <ResponsiveContainer>
                  <AreaChart data={growthData} margin={{ top: 5, right: 8, bottom: 0, left: -24 }}>
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#a3a3a3' }} axisLine={false} tickLine={false} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#a3a3a3' }} axisLine={false} tickLine={false} />
                    <Area type="monotone" dataKey="score" stroke="#c41e3a" fill="#c41e3a" fillOpacity={0.15} strokeWidth={2} isAnimationActive={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </section>
      )}

      <ReportFooter />
    </div>
  );
}
