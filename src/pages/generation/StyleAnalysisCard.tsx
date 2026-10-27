// ============================================================
// 风格拆解卡组件(M4-T6)
// ------------------------------------------------------------
// style 模式两步法 Step1(GLM-4V 风格分析)产物 StyleAnalysis
// 七字段的展示卡片:
//   - styleSeed(风格种子)作首行摘要块(注入组合生图 prompt 的核心)
//   - 其余六字段(媒介/笔触/色彩/构图/技法/表现)标签+文案纵向列表
//   - 生图失败但拆解已两阶段落库时,经 hint 附"可重试"提示条
//
// 渲染位置:
//   - GenerationResult(success,与生成图网格并列展示)
//   - GenerationFailed(failed 且 styleAnalysis 非空时保留展示)
// ============================================================

import { Palette, Sparkles, Info } from 'lucide-react';
import type { StyleAnalysis } from '../../services/generationService';

/** 六字段展示顺序与中文标签(styleSeed 单独作首行摘要,不入列表) */
const FIELD_META: { key: keyof StyleAnalysis; label: string }[] = [
  { key: 'medium', label: '媒介材料' },
  { key: 'brushwork', label: '笔触特征' },
  { key: 'colorSystem', label: '色彩体系' },
  { key: 'composition', label: '构图法则' },
  { key: 'technique', label: '技法手法' },
  { key: 'expression', label: '表现倾向' },
];

interface StyleAnalysisCardProps {
  /** 风格拆解结果(七字段) */
  analysis: StyleAnalysis;
  /** 附加提示条文案(生图失败场景:"风格拆解已完成，生图失败可重试") */
  hint?: string;
}

/**
 * 风格拆解卡
 * @param props 见 StyleAnalysisCardProps
 */
export default function StyleAnalysisCard({ analysis, hint }: StyleAnalysisCardProps) {
  return (
    <div className="bg-rice-50 border border-ink-900/8 rounded-lg shadow-subtle overflow-hidden">
      {/* 卡片标题 */}
      <div className="px-6 pt-6 pb-4 border-b border-ink-900/8">
        <h3 className="font-serif text-lg font-bold text-ink-900 flex items-center gap-2">
          <Palette className="w-4 h-4 text-jade" />
          风格拆解
        </h3>
        <p className="text-sm text-ink-500 mt-1">AI 从参考作品中提炼的风格语言</p>
      </div>

      {/* 附加提示条(如生图失败但拆解已完成) */}
      {hint && (
        <div className="px-6 py-2.5 bg-jade/10 border-b border-jade/20 flex items-center gap-2">
          <Info className="w-4 h-4 text-jade flex-shrink-0" />
          <p className="text-xs text-ink-600">{hint}</p>
        </div>
      )}

      <div className="p-6 space-y-5">
        {/* 风格种子摘要(首行,组合生图 prompt 的核心) */}
        <div className="p-4 rounded-md bg-jade/10 border border-jade/20">
          <p className="text-2xs font-semibold text-jade uppercase tracking-wider flex items-center gap-1.5">
            <Sparkles className="w-3 h-3" />
            风格种子
          </p>
          <p className="text-sm text-ink-900 leading-relaxed mt-2 break-words">
            {analysis.styleSeed}
          </p>
        </div>

        {/* 六字段标签+文案纵向列表 */}
        <dl className="space-y-3">
          {FIELD_META.map(({ key, label }) => (
            <div key={key} className="flex items-start gap-3">
              <dt className="w-20 flex-shrink-0 pt-0.5 text-2xs font-semibold text-ink-400">
                {label}
              </dt>
              <dd className="text-sm text-ink-700 leading-relaxed break-words">
                {analysis[key]}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
