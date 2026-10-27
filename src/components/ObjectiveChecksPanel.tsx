import { AlertTriangle, CheckCircle2, Gauge, Info } from 'lucide-react';
import type { ObjectiveCheck, ObjectiveChecks } from '../types';

interface ObjectiveChecksPanelProps {
  /** 客观检测结果(本地快速分析产出) */
  checks: ObjectiveChecks;
  /** 降级明示:本地模式下提示这是像素级客观检测而非 AI 完整诊断 */
  showLocalBanner?: boolean;
}

/* 明度标尺可视化:16 桶直方图 + 黑白渐变底条 + min/max 标记 */
function LuminanceScale({ histogram, min, max, utilization }: NonNullable<ObjectiveChecks['luminanceScale']>) {
  const W = 320;
  const H = 64;
  const BAR_W = W / 16;
  const peak = Math.max(...histogram, 0.0001);
  const barH = (v: number) => Math.max(2, (v / peak) * (H - 12));
  const minPos = (min / 255) * W;
  const maxPos = (max / 255) * W;
  const utilPercent = Math.round(utilization * 100);

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between text-xs text-ink-500 mb-1.5">
        <span className="font-medium text-ink-700">明度标尺分布(黑 ← 0-255 → 白)</span>
        <span className="font-mono tabular-nums">利用率 {utilPercent}%</span>
      </div>
      <div className="relative rounded-lg overflow-hidden border border-ink-900/10 bg-white">
        <svg
          width="100%"
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="block"
          role="img"
          aria-label={`明度直方图,明度范围 ${min} 到 ${max},标尺利用率 ${utilPercent}%`}
        >
          <defs>
            <linearGradient id="luminance-ramp" x1="0" y1="0" x2="1" y2="0">
              {Array.from({ length: 16 }, (_, i) => (
                <stop key={i} offset={i / 15} stopColor={`rgb(${Math.round((i / 15) * 244 + 6)},${Math.round((i / 15) * 244 + 6)},${Math.round((i / 15) * 244 + 6)})`} />
              ))}
            </linearGradient>
          </defs>
          {/* 黑→白渐变底条 */}
          <rect x="0" y="0" width={W} height={H} fill="url(#luminance-ramp)" />
          {/* 直方图柱(半透明墨色,高度按峰值归一) */}
          {histogram.map((v, i) => (
            <rect
              key={i}
              x={i * BAR_W + 1}
              y={H - barH(v)}
              width={BAR_W - 2}
              height={barH(v)}
              fill="rgba(28,28,28,0.55)"
            />
          ))}
          {/* 5%/95% 分位标记线 */}
          <line x1={minPos} y1="0" x2={minPos} y2={H} stroke="#c41e3a" strokeWidth="1.5" strokeDasharray="3 2" />
          <line x1={maxPos} y1="0" x2={maxPos} y2={H} stroke="#c41e3a" strokeWidth="1.5" strokeDasharray="3 2" />
        </svg>
        {/* 标记线数值标签 */}
        <span
          className="absolute top-0.5 -translate-x-1/2 text-[10px] font-mono tabular-nums text-cinnabar bg-white/85 px-1 rounded"
          style={{ left: `${(min / 255) * 100}%` }}
        >
          {min}
        </span>
        <span
          className="absolute top-0.5 -translate-x-1/2 text-[10px] font-mono tabular-nums text-cinnabar bg-white/85 px-1 rounded"
          style={{ left: `${(max / 255) * 100}%` }}
        >
          {max}
        </span>
      </div>
      <p className="text-[11px] text-ink-500 mt-1">
        红色虚线为实际使用的明度区间(5%-95% 分位)——区间越窄说明画面越"灰",黑白两端未拉开。
      </p>
    </div>
  );
}

/* 单条检测项:状态图标 + 标签/数值 + 原理说明 + 改法 */
function CheckRow({ check }: { check: ObjectiveCheck }) {
  const warn = check.status === 'warn';
  return (
    <div className={`rounded-xl border p-3.5 ${warn ? 'border-gold/35 bg-gold/5' : 'border-jade/25 bg-jade/5'}`}>
      <div className="flex items-start gap-2.5">
        {warn ? (
          <AlertTriangle className="w-[18px] h-[18px] text-gold-dark flex-shrink-0 mt-0.5" />
        ) : (
          <CheckCircle2 className="w-[18px] h-[18px] text-jade flex-shrink-0 mt-0.5" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-sm font-semibold text-ink-900">{check.label}</span>
            <span className={`text-xs font-medium ${warn ? 'text-gold-dark' : 'text-jade'}`}>
              {warn ? '待改进' : '通过'}
            </span>
          </div>
          <p className="text-xs text-ink-600 mt-1 font-mono tabular-nums">{check.value}</p>
          <p className="text-xs text-ink-500 leading-relaxed mt-1.5">{check.detail}</p>
          <p className="text-xs text-ink-700 leading-relaxed mt-1">
            <span className="font-medium text-ink-900">怎么改:</span>
            {check.suggestion}
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * 客观画面检测面板(Phase 1B:本地快速分析的可信输出)。
 *
 * 定位:本地分析不再输出"编造型"维度分数,而是输出可复现的像素级客观指标
 * (画面灰/对比度/饱和度/构图重心)+ 明度标尺可视化;AI 深度分析仍负责
 * 完整诊断。降级明示横幅让用户清楚当前处于本地快速模式。
 */
export default function ObjectiveChecksPanel({ checks, showLocalBanner = false }: ObjectiveChecksPanelProps) {
  const warnCount = checks.checks.filter((c) => c.status === 'warn').length;

  return (
    <section className="bg-rice-50 rounded-2xl p-5 shadow-card" aria-label="客观画面检测">
      {/* 面板标题 */}
      <div className="flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-xl bg-ink-900 flex items-center justify-center flex-shrink-0">
          <Gauge className="w-5 h-5 text-rice-100" />
        </div>
        <div>
          <div className="flex items-center gap-1.5">
            <h3 className="font-serif text-base font-semibold text-ink-900">客观画面检测</h3>
            {/* Phase 2 批次⑥:判定线来自本校评分档案(教师可调),非引擎默认 */}
            {checks.profileThresholdsApplied && (
              <span className="text-[10px] leading-none px-1.5 py-0.5 rounded bg-cinnabar/10 text-cinnabar border border-cinnabar/20">
                按本校标准
              </span>
            )}
          </div>
          <p className="text-xs text-ink-500">
            像素级可复现指标 · {checks.checks.length} 项
            {warnCount > 0 ? ` · ${warnCount} 项待改进` : ' · 全部通过'}
          </p>
        </div>
      </div>

      {/* 降级明示横幅:本地快速模式说明 */}
      {showLocalBanner && (
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-ink-900/5 border border-ink-900/10 px-3 py-2">
          <Info className="w-4 h-4 text-ink-500 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-ink-600 leading-relaxed">
            当前为<b className="text-ink-800">本地快速检测</b>:以下指标由浏览器像素级计算得出,
            反映画面客观物理状态(不涉及审美判断)。点击下方「AI 深度分析」可获取构图、造型、
            色彩等维度的完整专业诊断。
          </p>
        </div>
      )}

      {/* 明度标尺可视化 */}
      {checks.luminanceScale && <LuminanceScale {...checks.luminanceScale} />}

      {/* 检测项列表 */}
      <div className="mt-3 flex flex-col gap-2.5">
        {checks.checks.map((c) => (
          <CheckRow key={c.id} check={c} />
        ))}
      </div>
    </section>
  );
}
