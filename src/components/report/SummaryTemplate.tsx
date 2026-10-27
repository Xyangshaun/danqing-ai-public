// ============================================================
// 简洁摘要版报告模板(图片卡片)
// 重点:卡片式紧凑布局,适合导出 PNG 分享
// 对应规划:spec.md §3.1
// ============================================================

import type { ReportViewModel } from './reportTypes';
import { PriorityChip } from './ReportChrome';
import ScoreRing from './ScoreRing';
import ReportRadarChart from './ReportRadarChart';

/**
 * 简洁摘要卡片
 * - 固定 max-w-[750px],与 Canvas 图片导出渲染保持同构
 * - 屏幕展示用 DOM;导出 PNG 由 exportSummaryImage.ts 用原生 Canvas 重绘
 */
export default function SummaryTemplate({ vm }: { vm: ReportViewModel }) {
  const top3 = vm.suggestions.slice(0, 3);

  return (
    <div className="report-template report-summary-card mx-auto w-full max-w-[750px] bg-rice-100 text-ink-900 rounded-2xl border border-ink-900/10 shadow-card overflow-hidden">
      {/* 顶部朱砂条 */}
      <div className="h-1.5 bg-cinnabar" />

      <div className="p-6 space-y-5">
        {/* 品牌头 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 bg-cinnabar text-rice-50 flex items-center justify-center rounded-lg font-serif font-bold">
              丹
            </div>
            <div>
              <div className="font-serif font-bold text-ink-900">丹青有AI · 创作诊断</div>
              <div className="text-2xs text-ink-400">{vm.dateLabel}</div>
            </div>
          </div>
          <span className="text-2xs px-2 py-1 rounded bg-ink-900/5 text-ink-500">
            {vm.artTypeLabel}
          </span>
        </div>

        {/* 作品名 */}
        <h2 className="font-serif text-xl font-bold text-ink-900 leading-snug">{vm.title}</h2>

        {/* 核心:缩略图 + 总分环 + 迷你雷达 */}
        <div className="grid grid-cols-3 gap-4 items-center">
          <div className="flex justify-center">
            <img
              src={vm.imageUrl}
              alt={vm.title}
              className="h-32 w-auto max-w-full rounded-lg border border-ink-900/10 object-contain bg-white"
              crossOrigin="anonymous"
            />
          </div>
          <div className="flex justify-center">
            <ScoreRing score={vm.overallScore} size={110} />
          </div>
          <ReportRadarChart data={vm.radar} height={140} />
        </div>

        {/* TOP3 建议 */}
        {top3.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-xs font-medium text-ink-400 tracking-wider">核心建议</h3>
            {top3.map((s, i) => (
              <div
                key={i}
                className="flex items-start gap-2 bg-white rounded-lg border border-ink-900/8 px-3 py-2"
              >
                <PriorityChip priority={s.priority} label={s.priorityLabel} />
                <p className="flex-1 text-xs text-ink-700 leading-relaxed line-clamp-2">
                  {s.content}
                </p>
              </div>
            ))}
          </div>
        )}

        {/* 页脚 */}
        <div className="pt-3 border-t border-ink-900/8 flex items-center justify-between text-2xs text-ink-400">
          <span>丹青有AI · www.danqing.site</span>
          <span>查看完整报告请登录平台</span>
        </div>
      </div>
    </div>
  );
}
