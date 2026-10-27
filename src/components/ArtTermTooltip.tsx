// ============================================================
// 丹青有AI - 专业美术/非遗术语悬停气泡（B 模块）
//
// 功能 1 <ArtTermTooltip>: 对单个已知术语渲染悬停气泡
//   例:<ArtTermTooltip term="计白当黑">计白当黑</ArtTermTooltip>
//
// 功能 2 <AnnotatedArtText> (推荐):输入一段含专业名词的原始文本,
//   自动扫描词典(art-term-dictionary.ts),命中后自动加下划线 + 悬停气泡。
//   解决了"每出现一个专业名词都要手动包一层"的麻烦。
//
// 视觉风格（与系统色系一致）:
//   术语下划线: category = composition(indigo/15) / color(amber/15) /
//                           technique(emerald/15) / aesthetic(violet/15) /
//                           heritage(rose/15)
//   tooltip 卡片:bg-white/95 backdrop-blur shadow-2xl rounded-xl
// ============================================================

import React, { useMemo, useRef, useState } from 'react';
import { Info, X } from 'lucide-react';
import {
  ART_TERM_DICTIONARY,
  ArtTermCategory,
  ArtTermRecord,
  findArtTerm,
  scanTermsInText,
} from './art-term-dictionary';

// ---------- 类别 → 视觉样式映射（水墨色系,与 ScoreCriteriaPanel 统一） ----------
const CATEGORY_META: Record<
  ArtTermCategory,
  { label: string; underlineClass: string; badgeClass: string; dotClass: string }
> = {
  composition: {
    label: '构图',
    underlineClass: 'decoration-indigo-400/70 decoration-2 underline-offset-4 decoration-dotted hover:decoration-solid cursor-help',
    badgeClass: 'bg-indigo-50 text-indigo-700 border border-indigo-200',
    dotClass: 'bg-indigo-500',
  },
  color: {
    label: '色彩',
    underlineClass: 'decoration-amber-400/70 decoration-2 underline-offset-4 decoration-dotted hover:decoration-solid cursor-help',
    badgeClass: 'bg-amber-50 text-amber-700 border border-amber-200',
    dotClass: 'bg-amber-500',
  },
  technique: {
    label: '技法',
    underlineClass: 'decoration-emerald-500/70 decoration-2 underline-offset-4 decoration-dotted hover:decoration-solid cursor-help',
    badgeClass: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
    dotClass: 'bg-emerald-500',
  },
  aesthetic: {
    label: '美学',
    underlineClass: 'decoration-violet-400/70 decoration-2 underline-offset-4 decoration-dotted hover:decoration-solid cursor-help',
    badgeClass: 'bg-violet-50 text-violet-700 border border-violet-200',
    dotClass: 'bg-violet-500',
  },
  heritage: {
    label: '非遗',
    underlineClass: 'decoration-rose-500/70 decoration-2 underline-offset-4 decoration-dotted hover:decoration-solid cursor-help',
    badgeClass: 'bg-rose-50 text-rose-700 border border-rose-200',
    dotClass: 'bg-rose-500',
  },
};

export { CATEGORY_META, ART_TERM_DICTIONARY, findArtTerm, scanTermsInText };
export type { ArtTermRecord, ArtTermCategory };

// ==================== <ArtTermTooltip> 单个术语气泡 ====================
interface ArtTermTooltipProps {
  /** 要查询的术语名（若未提供 term,fallback 使用 children 作为术语查询） */
  term?: string;
  /** 显示在正文里的文字（可与 term 不同,如 term="计白当黑" children="留白布局"） */
  children: React.ReactNode;
  /** 强制展示的定义（不传则查词典） */
  definition?: string;
  /** 点击气泡 x 回调（用于外部关闭） */
  onDismiss?: () => void;
}

export function ArtTermTooltip({
  term,
  children,
  definition,
  onDismiss,
}: ArtTermTooltipProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLSpanElement>(null);

  // 查词典（优先 props.term,其次用 children 字符串）
  const record: ArtTermRecord | null = useMemo(() => {
    if (definition) return null; // 自定义 definition 时不查词典
    const q = term ?? (typeof children === 'string' ? children : undefined);
    if (!q) return null;
    return findArtTerm(q);
  }, [term, children, definition]);

  // 最终展示的定义
  const finalDefinition = definition ?? record?.definition;
  const category: ArtTermCategory | undefined = record?.category;
  const meta = category ? CATEGORY_META[category] : CATEGORY_META.aesthetic;

  if (!finalDefinition) {
    // 词典里没命中 + 也没传 definition → 直接渲染 children,不产生气泡
    return <>{children}</>;
  }

  return (
    <span
      ref={wrapperRef}
      className="relative inline-block align-baseline"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <span
        className={`inline underline ${meta.underlineClass} font-medium text-slate-900`}
        role="button"
        tabIndex={0}
        aria-label={`术语解释:${term ?? children}`}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
      >
        {children}
      </span>
      {/* 气泡:显示在术语上方,宽度 280-360px */}
      {open && (
        <span
          role="tooltip"
          className="pointer-events-auto absolute z-40 left-1/2 -translate-x-1/2 bottom-full mb-2 w-[320px] max-w-[80vw]
                     bg-white/95 backdrop-blur rounded-2xl shadow-2xl border border-slate-200/70
                     p-4 text-left text-slate-700 text-sm leading-relaxed
                     animate-[fadeIn_0.15s_ease-out]"
          style={{ transformOrigin: 'bottom center' }}
        >
          {/* 小三角 */}
          <span
            className="absolute left-1/2 -translate-x-1/2 -bottom-2
                       w-4 h-4 bg-white/95 rotate-45 border-b border-r border-slate-200/70"
            aria-hidden
          />
          <div className="flex items-start gap-3">
            <Info size={18} className="mt-0.5 shrink-0 text-slate-400" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-slate-900">
                    {record?.term ?? term ?? (typeof children === 'string' ? children : '术语')}
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${meta.badgeClass}`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${meta.dotClass}`} />
                    {meta.label}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpen(false);
                    onDismiss?.();
                  }}
                  className="shrink-0 -mr-1 -mt-1 p-1 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                  aria-label="关闭术语解释"
                >
                  <X size={14} />
                </button>
              </div>
              <p className="text-slate-700">{finalDefinition}</p>
              {record?.elaboration && (
                <p className="mt-2 text-slate-500 text-[13px] leading-relaxed">
                  {record.elaboration}
                </p>
              )}
              {record?.aliases && record.aliases.length > 0 && (
                <p className="mt-2 text-[12px] text-slate-400">
                  别名: {record.aliases.join(' / ')}
                </p>
              )}
            </div>
          </div>
        </span>
      )}
    </span>
  );
}

// ==================== <AnnotatedArtText> 文本自动扫描+气泡 ====================
interface AnnotatedArtTextProps {
  /** 含专业术语的原始文本（来自 AI 诊断报告 composition/color/technique/professionalSuggestions 等） */
  text: string;
  /** className 透传 */
  className?: string;
  /** HTML 标签（默认 p;也可 div/span） */
  as?: keyof JSX.IntrinsicElements;
}

/**
 * 推荐做法：直接把 AI 输出的一整段文本扔进来,
 * 组件内部调用 scanTermsInText 扫描术语词典,命中后自动
 * 包一层 <ArtTermTooltip>,零手动维护成本。
 */
export function AnnotatedArtText({
  text,
  className = '',
  as = 'p',
}: AnnotatedArtTextProps) {
  const segments = useMemo(() => {
    if (!text) return [{ type: 'text' as const, value: '' }];
    const hits = scanTermsInText(text);
    if (hits.length === 0) return [{ type: 'text' as const, value: text }];
    const out: Array<
      | { type: 'text'; value: string }
      | { type: 'term'; value: string; record: ArtTermRecord }
    > = [];
    let cursor = 0;
    for (const h of hits) {
      if (h.offset > cursor) {
        out.push({ type: 'text', value: text.slice(cursor, h.offset) });
      }
      out.push({ type: 'term', value: h.term, record: h.record });
      cursor = h.offset + h.term.length;
    }
    if (cursor < text.length) out.push({ type: 'text', value: text.slice(cursor) });
    return out;
  }, [text]);

  const Tag = as as keyof JSX.IntrinsicElements;
  const content = segments.map((seg, idx) =>
    seg.type === 'text' ? (
      <React.Fragment key={idx}>{seg.value}</React.Fragment>
    ) : (
      <ArtTermTooltip key={idx} term={seg.record.term}>
        {seg.value}
      </ArtTermTooltip>
    ),
  );

  // 用 createElement 兼容任意 as 标签
  return React.createElement(Tag as string, { className }, content);
}

export default ArtTermTooltip;
