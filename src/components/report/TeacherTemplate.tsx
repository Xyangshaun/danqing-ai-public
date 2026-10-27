// ============================================================
// 教师教学版报告模板
// 重点:Rubric 评分表 + 班级百分位 + 完整改进建议(教学术语)
// 对应规划:spec.md §3.1
// ============================================================

import type { ReportViewModel } from './reportTypes';
import { ReportBrandHeader, ReportMetaRow, ReportFooter, PriorityChip } from './ReportChrome';
import ScoreRing, { scoreColor } from './ScoreRing';
import ReportRadarChart from './ReportRadarChart';

/** 分数 → 等级(教学 rubric) */
function scoreGrade(score: number): { label: string; color: string } {
  if (score >= 90) return { label: '优秀', color: '#5b8c5a' };
  if (score >= 80) return { label: '良好', color: '#2e5fa1' };
  if (score >= 70) return { label: '中等', color: '#d4af37' };
  if (score >= 60) return { label: '合格', color: '#a8862a' };
  return { label: '待提高', color: '#c41e3a' };
}

export default function TeacherTemplate({ vm }: { vm: ReportViewModel }) {
  // 批次⑤:基础检测未评分(null)不显示等级徽章
  const overallGrade = vm.overallScore === null ? null : scoreGrade(vm.overallScore);

  return (
    <div className="report-template bg-rice-50 text-ink-900 p-8 space-y-6">
      <ReportBrandHeader subtitle="教师教学版 · 课堂点评材料" />
      <ReportMetaRow vm={vm} />

      {/* 核心区:缩略图 + 总分/等级 + 雷达 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-center">
        <div className="flex justify-center">
          <img
            src={vm.imageUrl}
            alt={vm.title}
            className="max-h-44 max-w-full rounded-xl border border-ink-900/10 object-contain bg-white"
            crossOrigin="anonymous"
          />
        </div>
        <div className="flex flex-col items-center gap-2">
          <ScoreRing score={vm.overallScore} size={140} />
          {overallGrade ? (
            <span
              className="px-3 py-1 rounded-full text-sm font-semibold"
              style={{ color: overallGrade.color, backgroundColor: `${overallGrade.color}1a` }}
            >
              {overallGrade.label}
            </span>
          ) : (
            <span className="px-3 py-1 rounded-full text-xs bg-ink-900/5 text-ink-500">
              基础检测 · 评分需 AI 深度分析
            </span>
          )}
        </div>
        <ReportRadarChart data={vm.radar} height={220} />
      </div>

      {/* Rubric 评分表 */}
      <section>
        <h3 className="font-serif font-semibold text-ink-900 mb-3">评分细则(Rubric)</h3>
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-rice-200 text-ink-600">
              <th className="text-left px-3 py-2 rounded-l-lg font-medium">评价维度</th>
              <th className="text-center px-3 py-2 font-medium w-20">得分</th>
              <th className="text-center px-3 py-2 font-medium w-20">等级</th>
              <th className="text-left px-3 py-2 rounded-r-lg font-medium">评语</th>
            </tr>
          </thead>
          <tbody>
            {vm.dimensions.map((d) => {
              const g = scoreGrade(d.score);
              return (
                <tr key={d.key} className="border-b border-ink-900/6">
                  <td className="px-3 py-2.5 font-medium text-ink-900">{d.label}</td>
                  <td className="px-3 py-2.5 text-center font-mono font-semibold" style={{ color: scoreColor(d.score) }}>
                    {d.score}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <span
                      className="inline-block px-2 py-0.5 rounded text-2xs font-medium"
                      style={{ color: g.color, backgroundColor: `${g.color}1a` }}
                    >
                      {g.label}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-ink-500 leading-relaxed">{d.comment || '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {/* 班级位置(仅教师/管理员可见时非 null) */}
      {vm.classPercentile !== null && (
        <section className="bg-stone/5 border border-stone/20 rounded-xl p-4">
          <h4 className="text-sm font-medium text-ink-900 mb-1">班级位置参考</h4>
          <p className="text-sm text-ink-600">
            本作品得分超过班级内同类型{' '}
            <span className="font-mono font-semibold text-stone">{vm.classPercentile}%</span>{' '}
            的作品
          </p>
          <div className="mt-2 h-2 bg-rice-300 rounded-full overflow-hidden">
            <div
              className="h-full bg-stone rounded-full"
              style={{ width: `${vm.classPercentile}%` }}
            />
          </div>
        </section>
      )}

      {/* 完整改进建议(教学用) */}
      {vm.suggestions.length > 0 && (
        <section>
          <h3 className="font-serif font-semibold text-ink-900 mb-3">改进建议(按优先级)</h3>
          <div className="space-y-2.5">
            {vm.suggestions.map((s, i) => (
              <div key={i} className="bg-white rounded-xl border border-ink-900/8 p-4">
                <div className="flex items-center gap-2 mb-1.5">
                  <PriorityChip priority={s.priority} label={s.priorityLabel} />
                </div>
                <p className="text-sm text-ink-800 leading-relaxed">{s.content}</p>
                {s.evidence && (
                  <p className="mt-1.5 text-2xs text-ink-400 border-l-2 border-gold pl-2">
                    评分依据:{s.evidence}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <ReportFooter>
        <span>班级百分位基于本租户同类型作品统计 · 仅供教学参考</span>
      </ReportFooter>
    </div>
  );
}
