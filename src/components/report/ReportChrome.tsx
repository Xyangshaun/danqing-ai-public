// ============================================================
// 报告公共骨架:品牌头 / 元信息行 / 页脚 / 优先级徽章
// ============================================================

import type { ReactNode } from 'react';
import type { ReportViewModel } from './reportTypes';

/** 优先级徽章颜色(高=朱砂/中=金/低=玉) */
const PRIORITY_STYLE: Record<string, string> = {
  high: 'bg-cinnabar/10 text-cinnabar border-cinnabar/30',
  medium: 'bg-gold/10 text-gold-dark border-gold/30',
  low: 'bg-jade/10 text-jade border-jade/30',
};

export function PriorityChip({ priority, label }: { priority: string; label: string }) {
  return (
    <span
      className={`inline-block px-1.5 py-0.5 text-2xs font-medium rounded border ${
        PRIORITY_STYLE[priority] ?? PRIORITY_STYLE.medium
      }`}
    >
      {label}
    </span>
  );
}

/** 报告品牌头 */
export function ReportBrandHeader({ subtitle }: { subtitle: string }) {
  return (
    <div className="flex items-center justify-between border-b-2 border-ink-900 pb-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-cinnabar text-rice-50 flex items-center justify-center rounded-lg font-serif font-bold text-lg">
          丹
        </div>
        <div>
          <div className="font-serif text-xl font-bold text-ink-900 tracking-wide">丹青有AI</div>
          <div className="text-xs text-ink-400">{subtitle}</div>
        </div>
      </div>
      <div className="text-right text-2xs text-ink-400 leading-relaxed">
        <div>AI 艺术创作诊断系统</div>
        <div>www.danqing.site</div>
      </div>
    </div>
  );
}

/** 元信息行(作品标题/类型/日期/AI增强标记) */
export function ReportMetaRow({ vm }: { vm: ReportViewModel }) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-ink-600">
      <span>
        <span className="text-ink-400 mr-1">作品</span>
        <span className="font-medium text-ink-900">{vm.title}</span>
      </span>
      <span>
        <span className="text-ink-400 mr-1">类型</span>
        {vm.artTypeLabel}
      </span>
      <span>
        <span className="text-ink-400 mr-1">日期</span>
        {vm.dateLabel}
      </span>
      {vm.aiEnhanced && (
        <span className="px-1.5 py-0.5 text-2xs rounded bg-jade/10 text-jade border border-jade/30">
          AI 增强
        </span>
      )}
    </div>
  );
}

/** 报告页脚 */
export function ReportFooter({ children }: { children?: ReactNode }) {
  return (
    <div className="mt-8 pt-4 border-t border-ink-900/10 flex items-center justify-between text-2xs text-ink-400">
      <span>丹青有AI · 让每一次创作都被专业看见</span>
      {children ?? <span>本报告由 AI 辅助生成,仅供学习参考</span>}
    </div>
  );
}
