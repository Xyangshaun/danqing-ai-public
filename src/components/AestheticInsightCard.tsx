// ============================================================
// 丹青有AI - 审美洞察卡片（A 模块·为什么层）
//
// 职责:
//   将 AI 深度分析输出的「美学原理 + 名作借鉴 + 审美提升」三层内容，
//   以折叠卡片的形式内嵌在诊断报告各节（composition/color/technique
//   以及每条 professionalSuggestion）之下。默认折叠，AI 深度未解锁时
//   按钮灰显并提示「点击 AI 深度分析解锁」。
//
// 设计理念（对应用户反馈核心诉求）:
//   > 每次练习都是审美判断的练习，不只是评价作品，
//     还要潜移默化培养使用者的审美能力。
//
// 视觉风格:
//   - 半透明宣纸底色 (bg-rice-50/80) + 淡金色边框 (border-gold/20)
//   - 与 ScoreCriteriaPanel / DepthDimensionsPanel 色系一致
//   - 标签配色: jade=美学原理, gold=名作借鉴, cinnabar=审美培养
//
// 降级:
//   - 三字段全空 → 返回 null（不渲染空壳）
//   - AI 未解锁 (aiEnhanced=false) → 灰显占位 + tooltip 引导
// ============================================================

import { useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Lightbulb,
  Palette,
  TrendingUp,
  Lock,
  Sparkles,
  BookOpen,
} from 'lucide-react';
import { useToast } from './ToastProvider';

/** 名作借鉴案例结构（与 ProfessionalSuggestion.masterReference 对齐） */
export interface MasterReference {
  /** 作品名 */
  title: string;
  /** 艺术家 / 朝代 / 流派 */
  artist: string;
  /** 为什么这幅名作在这一点上是典范 */
  whyItWorks: string;
}

interface AestheticInsightCardProps {
  /** 美学原理（如"视觉重心落在黄金分割 0.618 点时观者视觉动线最自然"） */
  aestheticPrinciple?: string;
  /** 名作借鉴案例（美术史经典或非遗传世名作） */
  masterReference?: MasterReference;
  /** 审美培养：改完后对审美的具体提升说明 */
  aestheticImpact?: string;
  /** 是否已解锁 AI 深度分析（未解锁显示锁定占位） */
  aiEnhanced?: boolean;
  /** 点击「解锁」按钮时的回调（不传则使用默认 toast 提示） */
  onUnlock?: () => void;
  /** 紧凑模式：用于嵌入专业建议卡片内部，去掉外层 padding 和放大标题 */
  compact?: boolean;
  /** 可选的自定义标题（缺省用「审美洞察」） */
  title?: string;
}

/** 标签配色映射 */
const TAG_META = {
  principle: {
    label: '美学原理',
    icon: Lightbulb,
    dotClass: 'bg-jade',
    badgeClass: 'bg-jade/10 text-jade border-jade/30',
  },
  master: {
    label: '名作借鉴',
    icon: BookOpen,
    dotClass: 'bg-gold-dark',
    badgeClass: 'bg-gold/15 text-gold-dark border-gold/40',
  },
  impact: {
    label: '审美培养',
    icon: TrendingUp,
    dotClass: 'bg-cinnabar',
    badgeClass: 'bg-cinnabar/10 text-cinnabar border-cinnabar/30',
  },
} as const;

/**
 * 空内容判断：三字段全空或全为空白字符串时视为无内容
 * （用于父组件提前 return null 或控制渲染）
 */
export function hasAestheticContent(props: AestheticInsightCardProps): boolean {
  return Boolean(
    (props.aestheticPrinciple && props.aestheticPrinciple.trim()) ||
      (props.masterReference?.title && props.masterReference.whyItWorks) ||
      (props.aestheticImpact && props.aestheticImpact.trim()),
  );
}

export default function AestheticInsightCard(props: AestheticInsightCardProps) {
  const {
    aestheticPrinciple,
    masterReference,
    aestheticImpact,
    aiEnhanced = false,
    onUnlock,
    compact = false,
    title = '审美洞察',
  } = props;

  const toast = useToast();
  const [open, setOpen] = useState(false);

  // 三字段全空 → 返回 null
  if (!hasAestheticContent(props)) return null;

  const hasAny = hasAestheticContent(props);

  // AI 未解锁 → 锁定占位（灰显 + 点击引导）
  if (!aiEnhanced) {
    return (
      <LockedCard
        title={title}
        compact={compact}
        onClick={() => {
          if (onUnlock) onUnlock();
          else {
            toast.info(
              '审美洞察需 AI 深度分析',
              '点击「AI 深度分析」按钮，解锁美学原理、名作借鉴与审美培养三层解读',
            );
          }
        }}
      />
    );
  }

  // 已解锁 → 正常折叠卡片
  const wrapperClass = compact
    ? 'mt-2 rounded-lg border border-gold/15 overflow-hidden'
    : 'rounded-xl border border-gold/20 bg-rice-50/80 overflow-hidden';
  const headerPad = compact ? 'px-3 py-2' : 'px-4 py-3';
  const bodyPad = compact ? 'px-3 pb-3 pt-1' : 'px-5 pb-5 pt-2';

  return (
    <div className={wrapperClass}>
      {/* 可点击的摘要行 */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`w-full flex items-center gap-3 text-left transition-colors hover:bg-gold/5 ${headerPad}`}
        aria-expanded={open}
      >
        <div
          className={`flex items-center justify-center rounded-md flex-shrink-0 ${
            compact ? 'w-7 h-7 bg-gold/15' : 'w-9 h-9 bg-gold/15'
          }`}
        >
          <Sparkles
            className={`${compact ? 'w-3.5 h-3.5' : 'w-4.5 h-4.5'} text-gold-dark`}
          />
        </div>
        <div className="min-w-0 flex-1">
          <p
            className={`font-semibold text-ink-800 truncate ${
              compact ? 'text-xs' : 'text-sm'
            }`}
          >
            {title}
          </p>
          <p className={`text-ink-400 mt-0.5 ${compact ? 'text-[10px]' : 'text-2xs'}`}>
            美学原理 · 名作借鉴 · 审美培养
          </p>
        </div>
        {open ? (
          <ChevronUp className="w-4 h-4 text-ink-400 flex-shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-ink-400 flex-shrink-0" />
        )}
      </button>

      {/* 展开内容体：三栏标签 */}
      {open && hasAny && (
        <div className={`border-t border-gold/15 space-y-3 ${bodyPad}`}>
          {/* ① 美学原理 */}
          {aestheticPrinciple?.trim() && (
            <InsightItem tag="principle" content={aestheticPrinciple} compact={compact} />
          )}

          {/* ② 名作借鉴 */}
          {masterReference?.title && masterReference.whyItWorks && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-semibold ${TAG_META.master.badgeClass}`}
                >
                  <BookOpen className="w-3 h-3" />
                  {TAG_META.master.label}
                </span>
              </div>
              <div
                className={`rounded-md bg-gold/5 border border-gold/15 p-2.5 ${
                  compact ? 'text-xs' : 'text-sm'
                }`}
              >
                <p className="font-semibold text-ink-800 mb-1 flex items-center gap-1.5">
                  <Palette className="w-3.5 h-3.5 text-gold-dark flex-shrink-0" />
                  {masterReference.title}
                  {masterReference.artist && (
                    <span className="text-ink-400 font-normal text-2xs">
                      · {masterReference.artist}
                    </span>
                  )}
                </p>
                <p className="text-ink-700 leading-relaxed">{masterReference.whyItWorks}</p>
              </div>
            </div>
          )}

          {/* ③ 审美培养 */}
          {aestheticImpact?.trim() && (
            <InsightItem tag="impact" content={aestheticImpact} compact={compact} />
          )}
        </div>
      )}
    </div>
  );
}

// ============ 子组件：单条洞察项（美学原理 / 审美培养复用）============

function InsightItem({
  tag,
  content,
  compact,
}: {
  tag: 'principle' | 'impact';
  content: string;
  compact: boolean;
}) {
  const meta = TAG_META[tag];
  const Icon = meta.icon;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <span
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-semibold ${meta.badgeClass}`}
        >
          <Icon className="w-3 h-3" />
          {meta.label}
        </span>
      </div>
      <p
        className={`leading-relaxed text-ink-700 pl-3.5 border-l-2 ${
          tag === 'principle' ? 'border-jade/40' : 'border-cinnabar/40'
        } ${compact ? 'text-xs' : 'text-sm'}`}
      >
        {content}
      </p>
    </div>
  );
}

// ============ 子组件：AI 未解锁时的锁定占位卡 ============

function LockedCard({
  title,
  compact,
  onClick,
}: {
  title: string;
  compact: boolean;
  onClick: () => void;
}) {
  const wrapperClass = compact
    ? 'mt-2 rounded-lg border border-ink-200/60 overflow-hidden bg-ink-50/50'
    : 'rounded-xl border border-ink-200/60 overflow-hidden bg-ink-50/50';
  const innerPad = compact ? 'px-3 py-2' : 'px-4 py-3';

  return (
    <button
      type="button"
      onClick={onClick}
      className={`${wrapperClass} w-full text-left transition-all hover:bg-gold/5 hover:border-gold/30 group cursor-pointer`}
      aria-label={`解锁${title}`}
    >
      <div className={`flex items-center gap-3 ${innerPad}`}>
        <div
          className={`flex items-center justify-center rounded-md bg-ink-200/60 flex-shrink-0 ${
            compact ? 'w-7 h-7' : 'w-9 h-9'
          }`}
        >
          <Lock
            className={`${compact ? 'w-3.5 h-3.5' : 'w-4.5 h-4.5'} text-ink-500 group-hover:text-gold-dark transition-colors`}
          />
        </div>
        <div className="min-w-0 flex-1">
          <p
            className={`font-semibold text-ink-500 truncate group-hover:text-gold-dark transition-colors ${
              compact ? 'text-xs' : 'text-sm'
            }`}
          >
            {title}
          </p>
          <p
            className={`text-ink-400 mt-0.5 group-hover:text-gold/80 transition-colors ${
              compact ? 'text-[10px]' : 'text-2xs'
            }`}
          >
            点击「AI 深度分析」解锁美学原理与名作借鉴三层解读
          </p>
        </div>
        <ChevronDown className="w-4 h-4 text-ink-300 group-hover:text-gold-dark transition-colors flex-shrink-0" />
      </div>
    </button>
  );
}
