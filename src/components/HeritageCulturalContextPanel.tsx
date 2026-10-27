// ============================================================
// 丹青有AI - 非遗文化解读三层面板（A 模块·文化层）
//
// 数据来源:HybridAnalysisResult.heritageCulturalContext
//   (仅 artType='heritage' 且 aiEnhanced=true 时非空)
//
// 三层结构:
//   层1 纹样寓意(patternSymbolism)   — 玉色 Jade 标签
//   层2 传统美学逻辑(traditionalAesthetic) — 金色 Gold 标签
//   层3 老师傅口传经验(masterWisdom)  — 朱砂 Cinnabar 标签
//
// 视觉:宣纸底(bg-rice-50) + 金线边(border-gold-300/40),
//      与 AestheticInsightCard / ScoreCriteriaPanel 色系一致
// 降级:
//   - artType≠heritage / heritageCulturalContext 为空 → null（不渲染）
//   - AI 未解锁(aiEnhanced=false) → 灰显锁定占位 + tooltip 引导
// ============================================================

import { useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  HeartHandshake,
  Flower2,
  Sparkles,
  BookOpen,
  Lock,
} from 'lucide-react';
import { AnnotatedArtText } from './ArtTermTooltip';
import { useToast } from './ToastProvider';

/** 与后端 HeritageCulturalContext 类型完全对齐（从 ai-analysis.ts 镜像） */
export interface HeritageCulturalContext {
  patternSymbolism: string;
  traditionalAesthetic: string;
  masterWisdom: string;
}

interface HeritageCulturalContextPanelProps {
  /** 非遗文化解读数据（从 HybridAnalysisResult.heritageCulturalContext 取） */
  context: HeritageCulturalContext | null | undefined;
  /** 是否已解锁 AI 深度分析（未解锁 → 锁定占位） */
  aiEnhanced?: boolean;
  /** 非遗类目（用于显示在标题里,可选） */
  heritageCategoryLabel?: string;
  /** 解锁按钮回调（不传则默认 toast 提示） */
  onUnlock?: () => void;
  /** 紧凑模式（嵌入详情卡片内部时,去掉外层 padding） */
  compact?: boolean;
}

/** 三层元数据:顺序 = 纹样寓意 → 传统美学 → 老师傅经验 */
const LAYER_META = [
  {
    key: 'patternSymbolism' as const,
    label: '纹样寓意',
    tagline: '那些花纹、图案、符号背后想说什么话',
    icon: HeartHandshake,
    badgeClass: 'bg-jade/10 text-jade border border-jade/30',
    dotClass: 'bg-jade',
    chipClass: 'bg-jade/5 text-jade border-jade/20',
  },
  {
    key: 'traditionalAesthetic' as const,
    label: '传统美学逻辑',
    tagline: '这门手艺的一整套审美体系,不只是技法步骤',
    icon: Flower2,
    badgeClass: 'bg-gold/15 text-gold-dark border border-gold/40',
    dotClass: 'bg-gold-dark',
    chipClass: 'bg-gold/10 text-gold-dark border-gold/30',
  },
  {
    key: 'masterWisdom' as const,
    label: '老师傅口传经验',
    tagline: '用一位从业 40 年的老艺人的口吻,给你最地道的判断',
    icon: Sparkles,
    badgeClass: 'bg-cinnabar/10 text-cinnabar border border-cinnabar/30',
    dotClass: 'bg-cinnabar',
    chipClass: 'bg-cinnabar/5 text-cinnabar border-cinnabar/20',
  },
] as const;

export function hasHeritageContent(
  ctx: HeritageCulturalContext | null | undefined,
): boolean {
  if (!ctx) return false;
  return Boolean(
    (ctx.patternSymbolism && ctx.patternSymbolism.trim()) ||
      (ctx.traditionalAesthetic && ctx.traditionalAesthetic.trim()) ||
      (ctx.masterWisdom && ctx.masterWisdom.trim()),
  );
}

export default function HeritageCulturalContextPanel(
  props: HeritageCulturalContextPanelProps,
) {
  const {
    context,
    aiEnhanced = false,
    heritageCategoryLabel,
    onUnlock,
    compact = false,
  } = props;
  const toast = useToast();
  const [openLayer, setOpenLayer] = useState<number | null>(0); // 默认展开第 1 层

  // 空内容 + 未解锁都空 → 返回 null
  if (!hasHeritageContent(context) && aiEnhanced) return null;

  const titleParts = ['非遗文化解读'];
  if (heritageCategoryLabel) titleParts.push(heritageCategoryLabel);

  // AI 未解锁且有内容 → 锁定占位
  if (!aiEnhanced && hasHeritageContent(context)) {
    return (
      <LockedCulturalPanel
        title={titleParts.join(' · ')}
        onUnlock={() => {
          if (onUnlock) onUnlock();
          else {
            toast?.toast?.({
              title: '点击「AI 深度分析」解锁',
              desc: '非遗文化解读含纹样寓意/传统美学逻辑/老师傅经验三层,只在深度分析后展示。',
              type: 'info',
            });
          }
        }}
        compact={compact}
      />
    );
  }

  // 正常渲染:有内容 + 已解锁
  const layers = LAYER_META.filter(
    (m) => context && (context[m.key] ?? '').trim().length > 0,
  );

  return (
    <section
      className={
        compact
          ? 'w-full rounded-2xl border border-gold-300/40 bg-rice-50/80 overflow-hidden'
          : 'w-full rounded-2xl border border-gold-300/40 bg-rice-50/80 p-5 overflow-hidden shadow-[0_4px_30px_-12px_rgba(180,140,60,0.15)]'
      }
      aria-label="非遗文化解读三层面板"
    >
      {/* 头部标题 */}
      <header className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-gold/20 to-rose-ink-500/10 flex items-center justify-center shrink-0 border border-gold-300/30">
            <BookOpen size={18} className="text-gold-dark" />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-slate-900 truncate">
              {titleParts.join(' · ')}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              不只是学技法,更理解纹样背后的文化与一整套传统审美逻辑
            </p>
          </div>
        </div>
        <span className="shrink-0 text-[11px] font-medium px-2.5 py-1 rounded-full bg-gold/10 text-gold-dark border border-gold/30">
          AI 深度 · 非遗层
        </span>
      </header>

      {/* 三层折叠面板 */}
      <div className="flex flex-col gap-2">
        {layers.map((m, idx) => {
          const isOpen = openLayer === idx;
          const content = context?.[m.key] ?? '';
          return (
            <article
              key={m.key}
              className={`rounded-xl border overflow-hidden transition-colors
                ${isOpen ? `border-current/20 bg-white/60` : 'border-slate-200/70 bg-white/30 hover:bg-white/60'}`}
              style={{
                // 通过 meta.chipClass 已定义颜色,这里直接用 className
              }}
            >
              <button
                type="button"
                className="w-full flex items-center justify-between gap-3 text-left px-4 py-3"
                onClick={() => setOpenLayer(isOpen ? null : idx)}
                aria-expanded={isOpen}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${m.chipClass}`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${m.dotClass}`} />
                    <m.icon size={13} />
                    {m.label}
                  </span>
                  <span className="text-xs text-slate-500 hidden sm:inline truncate">
                    {m.tagline}
                  </span>
                </div>
                <span className="shrink-0 text-slate-400">
                  {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </span>
              </button>
              {isOpen && (
                <div className="px-4 pb-4 pt-1">
                  <AnnotatedArtText
                    as="div"
                    text={content}
                    className="text-[14px] leading-7 text-slate-700 whitespace-pre-wrap"
                  />
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

// ============================================================
// 锁定占位（AI 深度未解锁时）
// ============================================================
function LockedCulturalPanel({
  title,
  onUnlock,
  compact,
}: {
  title: string;
  onUnlock: () => void;
  compact: boolean;
}) {
  return (
    <section
      className={
        compact
          ? 'w-full rounded-2xl border border-slate-200 bg-slate-50/60 overflow-hidden'
          : 'w-full rounded-2xl border border-slate-200 bg-slate-50/60 p-5 overflow-hidden opacity-90'
      }
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center shrink-0 border border-slate-200">
            <Lock size={16} className="text-slate-400" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-medium text-slate-600 truncate">{title}</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              纹样寓意 / 传统美学 / 老师傅经验 — 深度分析解锁
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onUnlock}
          className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                     bg-slate-900 text-white hover:bg-slate-700 transition"
        >
          <Sparkles size={13} />
          AI 深度解锁
        </button>
      </div>
    </section>
  );
}
