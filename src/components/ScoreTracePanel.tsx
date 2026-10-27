// ============================================================
// 评分证据链面板(框架二 P1 前端展示层)
//
// 职责:
//   将后端 score-trace.service 生成的 DimensionScoreTrace /
//   RubricSummary 渲染为可展开的证据链,回应对外评审
//   "评分黑盒/有效性来自自述"的质疑:
//     1. 每个分数可追溯到「规范条目 + 客观数值 + AI 判断 + 校准记录」
//     2. ScoreTraceToggle:维度卡片内嵌的展开/收起证据面板
//     3. RubricSummaryBar:综合评分下方的评分依据汇总条
//
// 数据契约:src/types/index.ts DimensionScoreTrace / RubricSummary
// ============================================================

import { useState } from 'react';
import { ChevronDown, ChevronUp, CheckCircle2, XCircle, MinusCircle, BookOpen, Scale, Sparkles } from 'lucide-react';
import type { DimensionScoreTrace, RubricSummary, ScoreBand } from '../types';

/** 四档徽章配色 */
const BAND_STYLES: Record<ScoreBand, string> = {
  '优': 'bg-jade/15 text-jade border-jade/30',
  '良': 'bg-gold/15 text-gold-dark border-gold/30',
  '中': 'bg-ink-400/10 text-ink-600 border-ink-400/25',
  '差': 'bg-cinnabar/10 text-cinnabar border-cinnabar/25',
};

/** 单维度证据链面板(展开态内容,由 ScoreTraceToggle 控制) */
export function ScoreTracePanel({ trace }: { trace: DimensionScoreTrace }) {
  return (
    <div className="mt-3 rounded-xl border border-ink-200/60 bg-white/70 overflow-hidden">
      {/* 达标概览 */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-ink-50/60 border-b border-ink-100">
        <span className="text-xs text-ink-500">
          客观指标达标 <span className="font-semibold text-ink-800 tabular-nums">{trace.passedCount} / {trace.totalCount}</span>
        </span>
        <span className={`px-2 py-0.5 rounded-full border text-xs font-semibold ${BAND_STYLES[trace.band]}`}>
          {trace.band} · {trace.score}分
        </span>
      </div>

      {/* 客观度量证据 */}
      {trace.metricEvidence.length > 0 && (
        <div className="px-4 py-3 border-b border-ink-100">
          <p className="text-xs font-semibold text-ink-700 mb-2">客观度量证据(Jimp 本地计算,可复现)</p>
          <ul className="space-y-1.5">
            {trace.metricEvidence.map((ev, i) => (
              <li key={`${ev.rubricId}-${ev.label}-${i}`} className="flex items-start gap-2 text-xs">
                {ev.passed ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-jade flex-shrink-0 mt-0.5" />
                ) : ev.displayValue === '数据缺失' ? (
                  <MinusCircle className="w-3.5 h-3.5 text-ink-400 flex-shrink-0 mt-0.5" />
                ) : (
                  <XCircle className="w-3.5 h-3.5 text-cinnabar/80 flex-shrink-0 mt-0.5" />
                )}
                <div className="min-w-0">
                  <span className="text-ink-800 font-medium">{ev.label}</span>
                  <span className="text-ink-500 mx-1.5">·</span>
                  <span className="font-mono tabular-nums text-ink-800">{ev.displayValue}</span>
                  <span className="text-ink-400 mx-1.5">→</span>
                  <span className={ev.passed ? 'text-ink-500' : 'text-cinnabar/90'}>{ev.thresholdLabel}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 命中的评分标准条目 */}
      {trace.rubricRefs.length > 0 && (
        <div className="px-4 py-3 border-b border-ink-100">
          <p className="text-xs font-semibold text-ink-700 mb-2 flex items-center gap-1.5">
            <BookOpen className="w-3.5 h-3.5 text-ink-500" />
            评分依据(规范条目)
          </p>
          <ul className="space-y-2">
            {trace.rubricRefs.map((ref) => (
              <li key={ref.rubricId} className="rounded-lg bg-rice-100/70 px-3 py-2">
                <div className="flex items-center justify-between gap-2 mb-0.5">
                  <span className="text-xs font-semibold text-ink-800">{ref.subIndicator}</span>
                  {ref.semanticOnly && (
                    <span className="px-1.5 py-px rounded text-[10px] bg-jade/10 text-jade border border-jade/25 flex-shrink-0">
                      AI语义判断
                    </span>
                  )}
                </div>
                <p className="text-xs text-ink-600 leading-relaxed">{ref.bandDescription}</p>
                <p className="text-[10px] text-ink-400 mt-1">
                  {ref.source}{ref.referenceExample ? ` · 参考: ${ref.referenceExample}` : ''}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* AI 校准记录 */}
      {trace.adjustment && (
        <div className="px-4 py-3 border-b border-ink-100">
          <p className="text-xs font-semibold text-ink-700 mb-1.5 flex items-center gap-1.5">
            <Scale className="w-3.5 h-3.5 text-gold-dark" />
            AI 校准记录
          </p>
          <p className="text-xs text-ink-600 leading-relaxed">
            <span className={`font-mono font-semibold ${trace.adjustment.delta >= 0 ? 'text-jade' : 'text-cinnabar'}`}>
              {trace.adjustment.delta >= 0 ? '+' : ''}{trace.adjustment.delta}
            </span>
            <span className="mx-1.5 text-ink-400">·</span>
            {trace.adjustment.reason}
          </p>
        </div>
      )}

      {/* AI 语义证据 */}
      {trace.semanticEvidence && (
        <div className="px-4 py-3">
          <p className="text-xs font-semibold text-ink-700 mb-1.5 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-jade" />
            AI 语义证据
          </p>
          <p className="text-xs text-ink-600 leading-relaxed">{trace.semanticEvidence}</p>
        </div>
      )}
    </div>
  );
}

/** 维度卡片内嵌的「评分依据」展开/收起开关 */
export function ScoreTraceToggle({ trace }: { trace: DimensionScoreTrace }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-ink-200/70 bg-white/50 py-1.5 text-xs font-medium text-ink-600 hover:bg-white hover:text-ink-900 transition-colors"
        aria-expanded={open}
      >
        {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        {open ? '收起评分依据' : '查看评分依据'}
        <span className="text-ink-400 tabular-nums">({trace.passedCount}/{trace.totalCount} 达标)</span>
      </button>
      {open && <ScoreTracePanel trace={trace} />}
    </div>
  );
}

/** 综合评分下方的评分依据汇总条 */
export function RubricSummaryBar({ summary }: { summary: RubricSummary }) {
  return (
    <div className="mt-3 mx-auto max-w-xl rounded-xl border border-jade/25 bg-jade/5 px-4 py-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <span className="text-xs text-ink-600">
          评分依据:客观指标达标
          <span className="font-semibold text-ink-900 tabular-nums"> {summary.passedCriteria} / {summary.totalCriteria} </span>
          项,另有 {summary.semanticOnlyCount} 项由 AI 语义判断
        </span>
        <span className="text-[10px] text-ink-400">各维度卡片内可查看完整证据链</span>
      </div>
      <p className="text-[10px] text-ink-500 mt-1.5 leading-relaxed">
        规范出处:{summary.standardNames.join(';')}
      </p>
    </div>
  );
}
