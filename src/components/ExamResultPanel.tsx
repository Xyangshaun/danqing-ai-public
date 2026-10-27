// ============================================================
// 丹青有AI - 艺考诊断结果面板
// 对应诊断理念重构(2026-08-16):exam 模式 AI 深度分析结果渲染
//
// 数据来源:AnalysisResult.aiVisionResult.examResult(后端 GLM-4V 按联考
// 阅卷标准输出的 exam_result,经 Zod 校验后透传)
//
// 渲染内容:
//   1. 档位大字卡片(A-E 五档制 + 档位标签 + 评定理由)
//   2. 科目维度评分条(维度名 + 分数 + 评语)
//   3. 扣分点清单(具体到画面位置)
//   4. 提分策略(升档训练路径)
//
// 使用约束:
//   - 仅在 diagnosisMode === 'exam' 且 examResult 非空时渲染
//   - examResult 由 AI 深度分析(阶段 2)产生;阶段 1(Jimp)无此数据,
//     调用侧应引导用户点击「AI 深度分析」获取档位评定
// ============================================================

import { Award, AlertTriangle, TrendingUp, ClipboardList } from 'lucide-react';
import type { ExamResult, ExamSubject, ExamGradeBand } from '../types';
import { EXAM_SUBJECT_LABEL } from '../types';

/** 档位 → 主题色映射(联考五档:A 最优 → E 待提升) */
const GRADE_BAND_STYLE: Record<ExamGradeBand, { text: string; bg: string; border: string }> = {
  A: { text: 'text-jade', bg: 'bg-jade/10', border: 'border-jade/40' },
  B: { text: 'text-gold-dark', bg: 'bg-gold/10', border: 'border-gold/40' },
  C: { text: 'text-ink-700', bg: 'bg-ink-900/5', border: 'border-ink-900/20' },
  D: { text: 'text-cinnabar', bg: 'bg-cinnabar/5', border: 'border-cinnabar/30' },
  E: { text: 'text-cinnabar', bg: 'bg-cinnabar/10', border: 'border-cinnabar/40' },
};

interface ExamResultPanelProps {
  examResult: ExamResult;
  /** 艺考科目(用于标题展示,如「素描」) */
  examSubject?: ExamSubject | null;
}

export default function ExamResultPanel({ examResult, examSubject }: ExamResultPanelProps) {
  const bandStyle = GRADE_BAND_STYLE[examResult.gradeBand] ?? GRADE_BAND_STYLE.C;
  const subjectLabel = examSubject ? EXAM_SUBJECT_LABEL[examSubject] : null;

  return (
    <section
      aria-label="艺考诊断结果"
      className="bg-rice-50 rounded-2xl shadow-card overflow-hidden"
    >
      {/* 头部:科目 + 档位标语 */}
      <div className="px-6 pt-6 pb-4 border-b border-ink-900/8 flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-cinnabar/10 flex items-center justify-center flex-shrink-0">
          <Award className="w-5 h-5 text-cinnabar" />
        </div>
        <div>
          <h3 className="font-serif text-lg font-bold text-ink-900">
            艺考诊断{subjectLabel ? ` · ${subjectLabel}` : ''}
          </h3>
          <p className="text-2xs text-ink-500 mt-0.5">
            按联考阅卷标准客观评定,供阶段性定位参考
          </p>
        </div>
      </div>

      <div className="p-6 space-y-6">
        {/* 档位卡片 */}
        <div className={`flex items-start gap-4 p-4 rounded-xl border ${bandStyle.bg} ${bandStyle.border}`}>
          <div className={`font-serif text-4xl font-bold leading-none ${bandStyle.text}`}>
            {examResult.gradeBand}
          </div>
          <div className="min-w-0">
            <p className={`text-sm font-semibold ${bandStyle.text}`}>
              {examResult.gradeLabel}
            </p>
            <p className="text-xs text-ink-700 leading-relaxed mt-1">
              {examResult.gradeReason}
            </p>
          </div>
        </div>

        {/* 科目维度评分 */}
        {examResult.subjectScores.length > 0 && (
          <div>
            <h4 className="flex items-center gap-2 text-sm font-semibold text-ink-900 mb-3">
              <ClipboardList className="w-4 h-4 text-ink-500" />
              科目维度评分
            </h4>
            <ul className="space-y-3">
              {examResult.subjectScores.map((item, idx) => (
                <li key={`${item.dimension}-${idx}`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-ink-800">{item.dimension}</span>
                    <span className="text-xs font-mono tabular-nums text-ink-600">
                      {item.score}
                    </span>
                  </div>
                  <div
                    className="h-1.5 bg-ink-900/8 rounded-full overflow-hidden"
                    role="progressbar"
                    aria-valuenow={item.score}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${item.dimension}得分`}
                  >
                    <div
                      className="h-full bg-cinnabar/80 rounded-full transition-all duration-500"
                      style={{ width: `${Math.max(0, Math.min(100, item.score))}%` }}
                    />
                  </div>
                  {item.comment && (
                    <p className="text-2xs text-ink-500 leading-relaxed mt-1">{item.comment}</p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* 扣分点 */}
        {examResult.deductionPoints.length > 0 && (
          <div>
            <h4 className="flex items-center gap-2 text-sm font-semibold text-ink-900 mb-3">
              <AlertTriangle className="w-4 h-4 text-gold-dark" />
              主要扣分点
            </h4>
            <ul className="space-y-2">
              {examResult.deductionPoints.map((point, idx) => (
                <li
                  key={idx}
                  className="flex items-start gap-2 text-xs text-ink-700 leading-relaxed"
                >
                  <span className="flex-shrink-0 w-4 h-4 mt-0.5 rounded-full bg-gold/15 text-gold-dark text-2xs font-mono flex items-center justify-center">
                    {idx + 1}
                  </span>
                  {point}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* 提分策略 */}
        {examResult.improvementStrategy && (
          <div className="p-4 rounded-xl bg-jade/5 border border-jade/25">
            <h4 className="flex items-center gap-2 text-sm font-semibold text-jade mb-2">
              <TrendingUp className="w-4 h-4" />
              升档提分策略
            </h4>
            <p className="text-xs text-ink-700 leading-relaxed">
              {examResult.improvementStrategy}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
