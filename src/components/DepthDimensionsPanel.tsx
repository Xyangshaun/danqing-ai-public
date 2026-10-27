// ============================================================
// 丹青有AI - 4 维度展示区组件(阶段 D,Task 12)
//
// 职责:
//   展示 AI 深度分析的 4 个专业维度评分:
//     原创性与风格 / 完整度与节奏 / 情感与意境 / 工艺水准
//   每维度含环形得分进度 + 分析说明 + 改进建议。
//
// 数据契约:src/types/index.ts DepthDimensionScore
// 配色:玉色系(与"AI 画面深度解析"区块 from-jade/5 一致)
// 降级:任一维度缺失显示"未评估"占位;全部缺失返回 null。
// ============================================================

import { Sparkles, Activity, Heart, Hammer, type LucideIcon } from 'lucide-react';
import type { DepthDimensionScore } from '../types';

interface DepthDimensionsPanelProps {
  /** 原创性与风格 */
  originalityAndStyle?: DepthDimensionScore;
  /** 完整度与节奏 */
  completenessAndRhythm?: DepthDimensionScore;
  /** 情感与意境 */
  emotionAndMood?: DepthDimensionScore;
  /** 工艺水准 */
  craftsmanship?: DepthDimensionScore;
}

/** 维度项定义(顺序即展示顺序) */
interface DimensionItem {
  label: string;
  icon: LucideIcon;
  data?: DepthDimensionScore;
}

/** 环形得分进度半径/周长常量(SVG viewBox 64x64) */
const RING_RADIUS = 26;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/** 环形得分进度 + 中心分数 */
function ScoreRing({ score, active }: { score: number; active: boolean }) {
  const pct = Math.max(0, Math.min(100, score));
  const offset = RING_CIRCUMFERENCE * (1 - pct / 100);
  const ringColor = active ? 'text-jade' : 'text-ink-200';
  const trackColor = active ? 'text-jade/15' : 'text-ink-100';

  return (
    <div className="relative w-16 h-16 flex-shrink-0">
      <svg width="64" height="64" viewBox="0 0 64 64" className="-rotate-90" aria-hidden="true">
        <circle
          cx="32"
          cy="32"
          r={RING_RADIUS}
          fill="none"
          stroke="currentColor"
          className={trackColor}
          strokeWidth="6"
        />
        <circle
          cx="32"
          cy="32"
          r={RING_RADIUS}
          fill="none"
          stroke="currentColor"
          className={ringColor}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={RING_CIRCUMFERENCE}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.6s ease-out' }}
        />
      </svg>
      <span
        className={`absolute inset-0 flex items-center justify-center font-serif font-bold text-lg tabular-nums ${
          active ? 'text-jade' : 'text-ink-300'
        }`}
      >
        {active ? Math.round(score) : '—'}
      </span>
    </div>
  );
}

/** 单维度卡片 */
function DimensionCard({ label, icon: Icon, data }: DimensionItem) {
  return (
    <div className="rounded-xl border border-jade/15 bg-white/60 p-4 flex flex-col">
      <div className="flex items-center gap-3 mb-3">
        <ScoreRing score={data?.score ?? 0} active={Boolean(data)} />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink-900 flex items-center gap-1.5">
            <Icon className="w-4 h-4 text-jade flex-shrink-0" />
            {label}
          </p>
          <p className={`text-2xs mt-0.5 ${data ? 'text-ink-500' : 'text-ink-400'}`}>
            {data ? '深度维度评分' : '未评估'}
          </p>
        </div>
      </div>
      {data ? (
        <div className="space-y-2 min-w-0">
          <p className="text-xs text-ink-700 leading-relaxed">{data.analysis}</p>
          <p className="text-xs text-jade leading-relaxed">
            <span className="font-semibold">建议:</span> {data.suggestion}
          </p>
        </div>
      ) : (
        <p className="text-xs text-ink-300 leading-relaxed">暂无该维度评估数据</p>
      )}
    </div>
  );
}

export default function DepthDimensionsPanel({
  originalityAndStyle,
  completenessAndRhythm,
  emotionAndMood,
  craftsmanship,
}: DepthDimensionsPanelProps) {
  const items: DimensionItem[] = [
    { label: '原创性与风格', icon: Sparkles, data: originalityAndStyle },
    { label: '完整度与节奏', icon: Activity, data: completenessAndRhythm },
    { label: '情感与意境', icon: Heart, data: emotionAndMood },
    { label: '工艺水准', icon: Hammer, data: craftsmanship },
  ];

  // 全部缺失时返回 null
  if (!items.some((i) => Boolean(i.data))) return null;

  return (
    <section
      aria-label="专业深度维度"
      className="bg-gradient-to-br from-jade/5 to-ink-50 rounded-2xl p-6 shadow-card border border-jade/20"
    >
      {/* 头部 */}
      <div className="flex items-center gap-3 mb-5">
        <div className="w-10 h-10 bg-jade/20 rounded-lg flex items-center justify-center flex-shrink-0">
          <Sparkles className="w-5 h-5 text-jade" />
        </div>
        <div className="min-w-0">
          <h3 className="font-serif text-lg font-bold text-ink-900">专业深度维度</h3>
          <p className="text-xs text-ink-500">原创性 · 完整度 · 情感意境 · 工艺水准</p>
        </div>
      </div>

      {/* 4 维度卡片网格:单列 / sm 双列 / lg 四列 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {items.map((item) => (
          <DimensionCard key={item.label} {...item} />
        ))}
      </div>
    </section>
  );
}
