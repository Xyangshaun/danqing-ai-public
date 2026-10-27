// ============================================================
// 丹青有AI - 教师端 · 我的教学画像页(反馈闭环 Phase 5 批次④)
// 数据: GET /api/v1/grading-profiles/insights/teacher       本人画像统计
//       GET /api/v1/grading-profiles/insights/adoptions      本人采纳历史
// 功能: 画像卡片(批注总数/评审作品/密度/四动作占比/AI 一致率/最近活跃)
//       + 历史采纳记录列表(档案名/建议键/前后值/时间)
// 布局: 照 TeacherGradingProfilesPage 模式(AdminSection + 卡片网格)
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { UserRound, ClipboardList, RefreshCw, History, Loader2 } from 'lucide-react';
import {
  getTeacherInsights,
  getMySuggestionAdoptions,
} from '../../services/grading-profile-api';
import type {
  GradingTeacherInsightsResponse,
  GradingMyAdoptionsResponse,
  AnnotationAction,
} from '../../types/grading-profile';
import {
  SUGGESTION_KEY_LABELS,
  type SuggestionKey,
} from '../../types/grading-profile';
import { formatStyleSuggestionValue } from '../../components/teacher/GradingProfileEditor';
import { AdminSection, SectionSkeleton } from '../../components/admin/AdminUI';

/** 四动作中文标签(画像分布展示;与后端 ANNOTATION_ACTIONS 对齐) */
const ACTION_LABELS: Record<AnnotationAction, string> = {
  supplement: '补充批注',
  correct: '纠正 AI',
  confirm: '确认 AI',
  reject: '驳回 AI',
};

/** 动作横条配色(与标注徽章色系呼应) */
const ACTION_BAR_COLORS: Record<AnnotationAction, string> = {
  supplement: 'bg-stone/60',
  correct: 'bg-gold/60',
  confirm: 'bg-jade/60',
  reject: 'bg-cinnabar/60',
};

/** KPI 卡片渲染项 */
interface KpiItem {
  label: string;
  value: string;
  hint?: string;
}

/** 统计 KPI 行 + 四动作分布 + 采纳历史 */
export default function TeacherInsightsPage() {
  const [insights, setInsights] = useState<GradingTeacherInsightsResponse | null>(null);
  const [adoptions, setAdoptions] = useState<GradingMyAdoptionsResponse['items']>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [insightsRes, adoptionsRes] = await Promise.all([
        getTeacherInsights(),
        getMySuggestionAdoptions(),
      ]);
      setInsights(insightsRes);
      setAdoptions(adoptionsRes.items);
    } catch {
      // 错误已由 api.ts 统一 Toast;保留空态
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = insights?.stats;
  const hasAnnotations = (stats?.annotationCount ?? 0) > 0;
  const isLoading = loading && insights === null;

  /** KPI 行:总数/作品/密度/AI 一致率/最近活跃 */
  const kpis: KpiItem[] = stats
    ? [
        { label: '批注总数', value: `${stats.annotationCount}`, hint: `${stats.reviewedWorks} 幅作品` },
        {
          label: '批注密度',
          value: stats.annotationDensity.toFixed(1),
          hint: '条/作品',
        },
        {
          label: 'AI 一致率',
          value: stats.aiAgreementRate === null ? '—' : `${Math.round(stats.aiAgreementRate * 100)}%`,
          hint: '确认 ÷ 显式裁决',
        },
        {
          label: '最近活跃',
          value: stats.lastActiveAt ? new Date(stats.lastActiveAt).toLocaleDateString('zh-CN') : '—',
        },
      ]
    : [];

  return (
    <div className="max-w-5xl mx-auto px-4 md:px-6 py-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink-900 font-serif flex items-center gap-2">
            <UserRound className="w-5 h-5 text-cinnabar" />
            我的教学画像
          </h1>
          <p className="text-xs text-ink-400 mt-1">
            本人对 AI 标注的批注行为聚合(只读);风格沉淀数据用于优化本校反馈风格
          </p>
        </div>
        <button
          onClick={() => void load()}
          className="inline-flex items-center gap-1.5 px-3 h-9 rounded-md border border-ink-900/15 bg-rice-50 text-sm text-ink-700 hover:bg-rice-100 transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          刷新
        </button>
      </div>

      {/* 画像统计 */}
      <AdminSection
        title="批注行为画像"
        desc="基于本人批注四动作(补充/纠正/确认/驳回)的行为统计,只读展示"
      >
        {isLoading ? (
          <SectionSkeleton lines={4} />
        ) : !hasAnnotations ? (
          <div className="py-10 text-center">
            <ClipboardList className="w-10 h-10 text-ink-200 mx-auto mb-3" />
            <p className="text-sm text-ink-500 mb-1">暂无批注数据</p>
            <p className="text-xs text-ink-400">
              在班级评审页对 AI 标注做批注(补充/纠正/确认/驳回)后,画像将自动生成
            </p>
          </div>
        ) : (
          <div className="space-y-4" data-testid="insights-stats">
            {/* KPI 行 */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {kpis.map((k) => (
                <div
                  key={k.label}
                  className="bg-rice-50 border border-ink-900/10 rounded-lg p-3"
                  data-testid={`kpi-${k.label}`}
                >
                  <p className="text-2xs text-ink-400">{k.label}</p>
                  <p className="text-lg font-semibold text-ink-900 font-mono mt-0.5">{k.value}</p>
                  {k.hint && <p className="text-2xs text-ink-400 mt-0.5">{k.hint}</p>}
                </div>
              ))}
            </div>

            {/* 四动作分布横条 */}
            <div className="space-y-2" data-testid="insights-actions">
              {(Object.keys(ACTION_LABELS) as AnnotationAction[]).map((action) => {
                const count = stats?.actionCounts[action] ?? 0;
                const ratio = stats?.actionRatios[action] ?? 0;
                return (
                  <div key={action} className="flex items-center gap-3">
                    <span className="text-2xs text-ink-500 w-16 flex-shrink-0">
                      {ACTION_LABELS[action]}
                    </span>
                    <div className="flex-1 h-2 bg-ink-900/5 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${ACTION_BAR_COLORS[action]}`}
                        style={{ width: `${Math.round(ratio * 100)}%` }}
                        data-testid={`action-bar-${action}`}
                      />
                    </div>
                    <span className="text-2xs text-ink-400 w-24 text-right flex-shrink-0 font-mono">
                      {count} 条 · {Math.round(ratio * 100)}%
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </AdminSection>

      {/* 采纳历史 */}
      <AdminSection
        title="风格建议采纳历史"
        desc="在评分档案编辑页一键采纳的调参记录(含依据快照,审计留痕)"
      >
        {isLoading ? (
          <SectionSkeleton lines={3} />
        ) : adoptions.length === 0 ? (
          <div className="py-10 text-center">
            <History className="w-10 h-10 text-ink-200 mx-auto mb-3" />
            <p className="text-sm text-ink-500 mb-1">暂无采纳记录</p>
            <p className="text-xs text-ink-400">
              <Link to="/teacher/grading-profiles" className="text-cinnabar hover:underline">
                前往评分档案
              </Link>
              ,基于本校批注行为数据生成的风格建议可一键采纳
            </p>
          </div>
        ) : (
          <ul className="space-y-2" data-testid="adoption-list">
            {adoptions.map((a) => (
              <li
                key={a.id}
                className="flex items-start justify-between gap-3 bg-rice-50 border border-ink-900/10 rounded-lg p-3"
                data-testid={`adoption-${a.id}`}
              >
                <div className="min-w-0">
                  <p className="text-sm text-ink-700">
                    <span className="font-medium">{a.profileName ?? '已删除档案'}</span>
                    <span className="text-ink-400 mx-1.5">·</span>
                    {SUGGESTION_KEY_LABELS[a.suggestionKey as SuggestionKey]}
                    <span className="font-mono text-ink-500 mx-1">
                      {formatStyleSuggestionValue(a.suggestionKey, a.beforeValue)}
                    </span>
                    <span className="text-ink-400 mx-0.5">→</span>
                    <span className="font-mono font-semibold text-jade ml-1">
                      {formatStyleSuggestionValue(a.suggestionKey, a.afterValue)}
                    </span>
                  </p>
                  <p className="text-2xs text-ink-400 mt-1">
                    {new Date(a.createdAt).toLocaleString('zh-CN')}
                    {a.profileName === null && ' · 档案已删除,仅存审计记录'}
                  </p>
                </div>
                <Link
                  to={a.profileName === null ? '/teacher/grading-profiles' : `/teacher/grading-profiles/${a.profileId}`}
                  className="flex-shrink-0 inline-flex items-center gap-1 px-2.5 h-7 rounded-md border border-ink-900/15 text-ink-600 text-2xs hover:bg-rice-100 transition-colors"
                >
                  {a.profileName === null ? '档案列表' : '查看档案'}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </AdminSection>

      {loading && insights !== null && (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="w-4 h-4 text-ink-400 animate-spin" />
          <span className="ml-2 text-xs text-ink-400">刷新中…</span>
        </div>
      )}
    </div>
  );
}
