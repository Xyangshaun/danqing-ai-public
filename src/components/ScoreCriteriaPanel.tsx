// ============================================================
// 丹青有AI - 评分标准面板(阶段 D,Task 10)
//
// 职责:
//   将后端 AI 按评价阶段参照系输出的 ScoreCriteria[] 渲染为可展开的
//   评分标准卡,展示各维度权重 / 等级 / 符合项 / 不符合项 / 评分证据,
//   回应对外评审"评分黑盒"质疑。与 ScoreTracePanel 证据链互补:
//     - ScoreTracePanel:维度级客观数值证据(Jimp 可复现)
//     - 本面板:维度级评分标准(AI 按评价阶段参照系输出)
//
// 数据契约:src/types/index.ts ScoreCriteria / EvaluationStage / DiagnosisMode
// 配色:金色系(与"问题分析"区块 from-gold/5 一致)
// 交互:维度默认收起,点击展开符合项/不符合项/证据详情
// ============================================================

import { useState } from 'react';
import { ChevronDown, ChevronUp, CheckCircle2, XCircle, Scale, Award } from 'lucide-react';
import type { ScoreCriteria, EvaluationStage, DiagnosisMode } from '../types';

/** 评级 → 中文 + 徽章样式(复用 ScoreTracePanel 四档配色语义) */
const LEVEL_META: Record<ScoreCriteria['level'], { label: string; badge: string }> = {
  excellent: { label: '优', badge: 'bg-jade/15 text-jade border-jade/30' },
  good: { label: '良', badge: 'bg-gold/15 text-gold-dark border-gold/30' },
  average: { label: '中', badge: 'bg-ink-400/10 text-ink-600 border-ink-400/25' },
  poor: { label: '差', badge: 'bg-cinnabar/10 text-cinnabar border-cinnabar/25' },
};

/**
 * 评价阶段 → 中文标签(根据 diagnosisMode + evaluationStage 映射)
 *   teaching: enthusiast 爱好者 / intermediate 进阶 / advanced 资深
 *   exam:    unified 联考级 / academy 美院级 / master 大师级
 */
const STAGE_LABEL: Record<EvaluationStage, string> = {
  enthusiast: '爱好者',
  intermediate: '进阶',
  advanced: '资深',
  unified: '联考级',
  academy: '美院级',
  master: '大师级',
};

interface ScoreCriteriaPanelProps {
  /** 各维度评分标准(AI 深度分析输出) */
  scoreCriteria: ScoreCriteria[];
  /** 评价阶段(顶部徽章;缺失则不显示徽章) */
  evaluationStage?: EvaluationStage;
  /** 诊断模式(决定徽章参照系描述;缺失按 teaching 处理) */
  diagnosisMode?: DiagnosisMode;
}

export default function ScoreCriteriaPanel({
  scoreCriteria,
  evaluationStage,
  diagnosisMode,
}: ScoreCriteriaPanelProps) {
  if (!scoreCriteria || scoreCriteria.length === 0) return null;

  const stageLabel = evaluationStage ? STAGE_LABEL[evaluationStage] : null;
  const stageDesc = evaluationStage
    ? diagnosisMode === 'exam'
      ? '按艺考参照系评定'
      : '按教学参照系评定'
    : null;

  return (
    <section
      aria-label="评分标准"
      className="bg-gradient-to-br from-gold/5 to-rice-50 rounded-2xl p-6 shadow-card border border-gold/25"
    >
      {/* 头部:标题 + 评价阶段徽章 */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <div className="w-10 h-10 bg-gold/15 rounded-lg flex items-center justify-center flex-shrink-0">
          <Scale className="w-5 h-5 text-gold-dark" />
        </div>
        <div className="min-w-0">
          <h3 className="font-serif text-lg font-bold text-ink-900">评分标准</h3>
          <p className="text-xs text-ink-500">各维度权重 · 等级 · 符合项 · 评分证据</p>
        </div>
        {stageLabel && (
          <span
            className="ml-auto inline-flex items-center gap-1.5 px-3 py-1 rounded-full border bg-gold/10 border-gold/40 text-gold-dark text-xs font-semibold"
            title={stageDesc ?? undefined}
          >
            <Award className="w-3.5 h-3.5" />
            {stageLabel}
          </span>
        )}
      </div>

      {/* 维度卡片网格:移动端单列,sm 起双列 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {scoreCriteria.map((crit, idx) => (
          <DimensionCard key={`${crit.dimension}-${idx}`} criteria={crit} />
        ))}
      </div>
    </section>
  );
}

/** 单维度评分标准卡(可展开详情) */
function DimensionCard({ criteria }: { criteria: ScoreCriteria }) {
  const [open, setOpen] = useState(false);
  const levelMeta = LEVEL_META[criteria.level] ?? LEVEL_META.average;
  const weightPct = Math.round(Math.max(0, Math.min(1, criteria.weight)) * 100);

  const hasDetail =
    criteria.metCriteria.length > 0 ||
    criteria.unmetCriteria.length > 0 ||
    Boolean(criteria.evidence);

  return (
    <div className="rounded-xl border border-gold/20 bg-white/60 overflow-hidden">
      {/* 摘要行(可点击展开) */}
      <button
        type="button"
        onClick={() => hasDetail && setOpen((v) => !v)}
        className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
          hasDetail ? 'hover:bg-white/90 cursor-pointer' : 'cursor-default'
        }`}
        aria-expanded={hasDetail ? open : undefined}
      >
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink-900 truncate">{criteria.dimension}</p>
          <p className="text-2xs text-ink-500 mt-0.5 flex items-center gap-1.5">
            <span>权重</span>
            <span className="font-mono tabular-nums text-gold-dark font-semibold">{weightPct}%</span>
            {criteria.maxScore != null && (
              <>
                <span className="text-ink-300">·</span>
                <span>满分</span>
                <span className="font-mono tabular-nums text-ink-700">{criteria.maxScore}</span>
              </>
            )}
          </p>
        </div>
        <span
          className={`px-2 py-0.5 rounded-full border text-xs font-semibold flex-shrink-0 ${levelMeta.badge}`}
        >
          {levelMeta.label}
        </span>
        {hasDetail &&
          (open ? (
            <ChevronUp className="w-4 h-4 text-ink-400 flex-shrink-0" />
          ) : (
            <ChevronDown className="w-4 h-4 text-ink-400 flex-shrink-0" />
          ))}
      </button>

      {/* 展开详情:符合项 / 不符合项 / 证据 */}
      {open && hasDetail && (
        <div className="px-4 pb-3 pt-1 border-t border-gold/15 space-y-2.5">
          {criteria.metCriteria.length > 0 && (
            <div>
              <p className="text-2xs font-semibold text-jade mb-1">符合项</p>
              <ul className="space-y-1">
                {criteria.metCriteria.map((item, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-1.5 text-xs text-ink-700 leading-relaxed"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 text-jade flex-shrink-0 mt-0.5" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {criteria.unmetCriteria.length > 0 && (
            <div>
              <p className="text-2xs font-semibold text-cinnabar mb-1">不符合项</p>
              <ul className="space-y-1">
                {criteria.unmetCriteria.map((item, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-1.5 text-xs text-ink-700 leading-relaxed"
                  >
                    <XCircle className="w-3.5 h-3.5 text-cinnabar/80 flex-shrink-0 mt-0.5" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {criteria.evidence && (
            <div>
              <p className="text-2xs font-semibold text-gold-dark mb-1">评分证据</p>
              <p className="text-xs text-ink-600 leading-relaxed">{criteria.evidence}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
