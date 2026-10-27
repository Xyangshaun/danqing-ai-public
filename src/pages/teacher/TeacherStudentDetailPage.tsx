// ============================================================
// 丹青有AI - 教师端 · 学生详情(作品列表 + 成长曲线 + 评分/批量评分)
// 数据:
//   GET /api/v1/growth?userId=&dimension=&timeRange=   成长曲线
//   GET /api/v1/analyses?userId=&page=                 作品列表(分页)
//   POST /api/v1/analyses/:id/reviews                  提交评审(单评/批量共用)
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import {
  ArrowLeft, TrendingUp, TrendingDown, Minus, RefreshCw,
  ClipboardCheck, CheckSquare, Square, Loader2, ScrollText,
} from 'lucide-react';
import {
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area,
} from 'recharts';
import {
  getStudentGrowth,
  listStudentAnalyses,
  createReview,
  batchCreateReviews,
  listReviews,
} from '../../services/teacher-api';
import type {
  GrowthResponse,
  GrowthDimension,
  GrowthTimeRange,
  AnalysisListItem,
  CreateReviewRequest,
  ReviewLevel,
  ReviewRecordSummary,
  ReviewerType,
} from '../../types/teacher';
import { useToast } from '../../components/ToastProvider';
import { AdminSection, SectionSkeleton, KpiCard } from '../../components/admin/AdminUI';

const DIMENSION_LABEL: Record<GrowthDimension, string> = {
  overall: '综合',
  composition: '构图',
  color: '色彩',
  originality: '创意',
};
const TIME_RANGE_LABEL: Record<GrowthTimeRange, string> = {
  '7d': '近7天',
  '30d': '近30天',
  '90d': '近90天',
  all: '全部',
};
const WORK_TYPE_LABEL: Record<string, string> = {
  painting: '绘画',
  design: '设计',
  product: '产品',
  sculpture: '雕塑',
};

/** 评审维度键(与契约 ReviewScoresPayload.dimensions 对齐,按四类作品通用维度) */
const REVIEW_DIMENSIONS = [
  { key: 'composition', label: '构图' },
  { key: 'color', label: '色彩' },
  { key: 'technique', label: '技法' },
  { key: 'originality', label: '创意' },
] as const;

function levelOf(score: number): ReviewLevel {
  if (score >= 90) return 'excellent';
  if (score >= 75) return 'good';
  if (score >= 60) return 'qualified';
  return 'needs_improvement';
}

export default function TeacherStudentDetailPage() {
  const { studentId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const studentName = searchParams.get('name') ?? '学生';
  const toast = useToast();

  /* ---------- 成长曲线 ---------- */
  const [dimension, setDimension] = useState<GrowthDimension>('overall');
  const [timeRange, setTimeRange] = useState<GrowthTimeRange>('30d');
  const [growth, setGrowth] = useState<GrowthResponse | null>(null);
  const [growthLoading, setGrowthLoading] = useState(true);

  const loadGrowth = useCallback(async () => {
    if (!studentId) return;
    setGrowthLoading(true);
    try {
      const res = await getStudentGrowth({ userId: studentId, dimension, timeRange });
      setGrowth(res);
    } catch {
      // 统一 Toast
    } finally {
      setGrowthLoading(false);
    }
  }, [studentId, dimension, timeRange]);

  useEffect(() => {
    void loadGrowth();
  }, [loadGrowth]);

  /* ---------- 作品列表 ---------- */
  const [works, setWorks] = useState<AnalysisListItem[]>([]);
  const [worksTotal, setWorksTotal] = useState(0);
  const [worksLoading, setWorksLoading] = useState(true);
  const [page, setPage] = useState(1);
  const pageSize = 12;

  const loadWorks = useCallback(async () => {
    if (!studentId) return;
    setWorksLoading(true);
    try {
      const res = await listStudentAnalyses({ userId: studentId, page, pageSize });
      setWorks(res.items);
      setWorksTotal(res.total);
    } catch {
      // 统一 Toast
    } finally {
      setWorksLoading(false);
    }
  }, [studentId, page]);

  useEffect(() => {
    void loadWorks();
  }, [loadWorks]);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(worksTotal / pageSize)), [worksTotal]);

  /* ---------- 选择(批量评分) ---------- */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const allChecked = works.length > 0 && works.every((w) => selected.has(w.id));

  /* ---------- 评分弹窗(单个/批量共用) ---------- */
  const [reviewTarget, setReviewTarget] = useState<
    | { mode: 'single'; analysis: AnalysisListItem }
    | { mode: 'batch'; analysisIds: string[] }
    | null
  >(null);
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);

  /* ---------- 评审记录弹窗 ---------- */
  const [historyTarget, setHistoryTarget] = useState<AnalysisListItem | null>(null);

  const growthChartData = useMemo(
    () =>
      (growth?.dataPoints ?? []).map((p) => ({
        date: new Date(p.date).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }),
        score: p.score,
      })),
    [growth],
  );

  const summary = growth?.summary;

  return (
    <div className="max-w-6xl mx-auto px-4 md:px-6 py-6 space-y-5">
      {/* 顶部 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            to="/teacher"
            className="inline-flex items-center justify-center w-8 h-8 rounded-md border border-ink-900/15 text-ink-600 hover:bg-rice-100"
            title="返回学生列表"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <h1 className="text-xl font-semibold text-ink-900 font-serif">{studentName}</h1>
            <p className="text-xs text-ink-400 mt-0.5">作品 {worksTotal} 件 · 成长数据 {summary?.totalAnalyses ?? 0} 条</p>
          </div>
        </div>
        <button
          onClick={() => {
            void loadGrowth();
            void loadWorks();
          }}
          className="inline-flex items-center gap-1.5 px-3 h-9 rounded-md border border-ink-900/15 bg-rice-50 text-sm text-ink-700 hover:bg-rice-100"
        >
          <RefreshCw className={`w-4 h-4 ${growthLoading || worksLoading ? 'animate-spin' : ''}`} />
          刷新
        </button>
      </div>

      {/* 成长汇总 KPI */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="当前分数" value={summary?.current ?? '--'} sub={`${DIMENSION_LABEL[dimension]}维度`} />
        <KpiCard label="平均分" value={summary?.average ?? '--'} sub={TIME_RANGE_LABEL[timeRange]} />
        <KpiCard
          label="趋势"
          value={
            summary ? (
              <span className="inline-flex items-center gap-1">
                {summary.trend === 'up' ? (
                  <TrendingUp className="w-5 h-5" />
                ) : summary.trend === 'down' ? (
                  <TrendingDown className="w-5 h-5" />
                ) : (
                  <Minus className="w-5 h-5" />
                )}
                {summary.change > 0 ? `+${summary.change}` : summary.change}
              </span>
            ) : (
              '--'
            )
          }
          tone={summary?.trend === 'up' ? 'good' : summary?.trend === 'down' ? 'bad' : 'default'}
          sub="较首个数据点"
        />
        <KpiCard label="分析次数" value={summary?.totalAnalyses ?? '--'} sub="有效数据点" />
      </div>

      {/* 成长曲线 */}
      <AdminSection
        title="成长曲线"
        desc={
          <span className="inline-flex items-center gap-2">
            <select
              value={dimension}
              onChange={(e) => setDimension(e.target.value as GrowthDimension)}
              className="h-7 px-2 rounded border border-ink-900/15 bg-white text-xs text-ink-700"
            >
              {Object.entries(DIMENSION_LABEL).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <select
              value={timeRange}
              onChange={(e) => setTimeRange(e.target.value as GrowthTimeRange)}
              className="h-7 px-2 rounded border border-ink-900/15 bg-white text-xs text-ink-700"
            >
              {Object.entries(TIME_RANGE_LABEL).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </span>
        }
      >
        {growthLoading ? (
          <SectionSkeleton lines={4} />
        ) : growthChartData.length === 0 ? (
          <p className="text-sm text-ink-400 py-8 text-center">该时间范围内暂无成长数据</p>
        ) : (
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={growthChartData} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
                <defs>
                  <linearGradient id="teacherGrowthFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#B03A2E" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#B03A2E" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1c191722" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#78716c' }} tickLine={false} axisLine={false} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#78716c' }} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #1c191722' }}
                  formatter={(v) => [`${v} 分`, DIMENSION_LABEL[dimension]]}
                />
                <Area type="monotone" dataKey="score" stroke="#B03A2E" strokeWidth={2} fill="url(#teacherGrowthFill)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </AdminSection>

      {/* 作品列表 + 批量评分 */}
      <AdminSection
        title="作品列表"
        desc={
          selected.size > 0 ? (
            <button
              onClick={() => setReviewTarget({ mode: 'batch', analysisIds: [...selected] })}
              className="inline-flex items-center gap-1.5 px-3 h-8 rounded-md bg-cinnabar text-rice-50 text-xs hover:bg-cinnabar-dark"
            >
              <ClipboardCheck className="w-3.5 h-3.5" />
              批量评分(已选 {selected.size})
            </button>
          ) : (
            '勾选作品可批量评分'
          )
        }
      >
        {worksLoading && works.length === 0 ? (
          <SectionSkeleton lines={4} />
        ) : works.length === 0 ? (
          <p className="text-sm text-ink-400 py-8 text-center">暂无作品</p>
        ) : (
          <>
            {/* 全选行 */}
            <div className="flex items-center gap-2 pb-2 mb-2 border-b border-ink-900/8">
              <button
                onClick={() =>
                  setSelected(allChecked ? new Set() : new Set(works.map((w) => w.id)))
                }
                className="inline-flex items-center gap-1.5 text-xs text-ink-500 hover:text-ink-800"
              >
                {allChecked ? (
                  <CheckSquare className="w-4 h-4 text-cinnabar" />
                ) : (
                  <Square className="w-4 h-4" />
                )}
                全选本页
              </button>
              {selected.size > 0 && (
                <button
                  onClick={() => setSelected(new Set())}
                  className="text-xs text-ink-400 hover:text-ink-600"
                >
                  清空选择
                </button>
              )}
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {works.map((w) => {
                const checked = selected.has(w.id);
                return (
                  <div
                    key={w.id}
                    className={`relative bg-rice-50 border rounded-lg overflow-hidden transition-shadow ${
                      checked ? 'border-cinnabar shadow-card-hover' : 'border-ink-900/10 shadow-card'
                    }`}
                  >
                    {/* 勾选 */}
                    <button
                      onClick={() => toggleSelect(w.id)}
                      className="absolute top-2 left-2 z-10 w-6 h-6 rounded bg-rice-50/90 backdrop-blur flex items-center justify-center"
                      title={checked ? '取消选择' : '选择'}
                    >
                      {checked ? (
                        <CheckSquare className="w-4 h-4 text-cinnabar" />
                      ) : (
                        <Square className="w-4 h-4 text-ink-400" />
                      )}
                    </button>
                    <img
                      src={w.imageUrl}
                      alt={w.title ?? '作品'}
                      loading="lazy"
                      className="w-full aspect-square object-cover bg-rice-200"
                    />
                    <div className="p-2.5">
                      <p className="text-xs font-medium text-ink-800 truncate">
                        {w.title ?? '未命名作品'}
                      </p>
                      <p className="text-2xs text-ink-400 mt-0.5">
                        {WORK_TYPE_LABEL[w.workType] ?? w.workType} ·{' '}
                        {new Date(w.createdAt).toLocaleDateString()}
                      </p>
                      <div className="flex items-center justify-between mt-2">
                        <span
                          className={`text-sm font-semibold font-mono tabular-nums ${
                            w.overallScore == null
                              ? 'text-ink-300'
                              : w.overallScore >= 75
                                ? 'text-jade'
                                : w.overallScore >= 60
                                  ? 'text-gold-dark'
                                  : 'text-cinnabar'
                          }`}
                        >
                          {w.overallScore == null ? '未评分' : `${w.overallScore} 分`}
                        </span>
                        <div className="inline-flex items-center gap-1">
                          <button
                            onClick={() => setHistoryTarget(w)}
                            className="inline-flex items-center gap-1 px-2 h-6 rounded text-2xs bg-ink-900/5 text-ink-600 hover:bg-ink-900/10"
                            title="查看评审记录"
                          >
                            <ScrollText className="w-3 h-3" />
                            记录
                          </button>
                          <button
                            onClick={() => setReviewTarget({ mode: 'single', analysis: w })}
                            className="inline-flex items-center gap-1 px-2 h-6 rounded text-2xs bg-stone/10 text-stone hover:bg-stone/20"
                          >
                            <ClipboardCheck className="w-3 h-3" />
                            评分
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* 分页 */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-4 pt-3 border-t border-ink-900/5">
                <span className="text-xs text-ink-400">
                  第 {page} / {totalPages} 页
                </span>
                <div className="flex gap-2">
                  <button
                    disabled={page <= 1}
                    onClick={() => setPage((p) => p - 1)}
                    className="px-3 h-8 rounded-md border border-ink-900/15 text-xs disabled:opacity-40"
                  >
                    上一页
                  </button>
                  <button
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                    className="px-3 h-8 rounded-md border border-ink-900/15 text-xs disabled:opacity-40"
                  >
                    下一页
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </AdminSection>

      {/* 评分弹窗 */}
      {reviewTarget && (
        <ReviewModal
          title={
            reviewTarget.mode === 'single'
              ? `评分 · ${reviewTarget.analysis.title ?? '未命名作品'}`
              : `批量评分 · ${reviewTarget.analysisIds.length} 件作品`
          }
          progress={batchProgress}
          onCancel={() => !batchProgress && setReviewTarget(null)}
          onSubmit={async (payload) => {
            if (reviewTarget.mode === 'single') {
              await createReview(reviewTarget.analysis.id, payload);
              toast.success('评分已提交', reviewTarget.analysis.title ?? undefined);
            } else {
              setBatchProgress({ done: 0, total: reviewTarget.analysisIds.length });
              const res = await batchCreateReviews(reviewTarget.analysisIds, payload, (done, total) =>
                setBatchProgress({ done, total }),
              );
              setBatchProgress(null);
              if (res.failed === 0) {
                toast.success('批量评分完成', `成功 ${res.succeeded} 件`);
              } else {
                toast.error('批量评分部分失败', `成功 ${res.succeeded} / 失败 ${res.failed}`);
              }
              setSelected(new Set());
            }
            setReviewTarget(null);
            await loadWorks();
          }}
        />
      )}
      {/* 评审记录弹窗 */}
      {historyTarget && (
        <ReviewHistoryModal
          analysis={historyTarget}
          onClose={() => setHistoryTarget(null)}
        />
      )}
    </div>
  );
}

/* ============================================================
 * 评审记录弹窗(某作品的全部评审)
 * ============================================================ */

const REVIEWER_TYPE_LABEL: Record<ReviewerType, string> = {
  professor: '教授',
  lecturer: '讲师',
  ai: 'AI',
};
const REVIEW_LEVEL_LABEL: Record<ReviewLevel, string> = {
  excellent: '优秀',
  good: '良好',
  qualified: '合格',
  needs_improvement: '待提升',
};
const REVIEW_LEVEL_COLOR: Record<ReviewLevel, string> = {
  excellent: 'bg-jade/10 text-jade',
  good: 'bg-stone/10 text-stone',
  qualified: 'bg-gold/15 text-gold-dark',
  needs_improvement: 'bg-cinnabar/10 text-cinnabar',
};

function ReviewHistoryModal({
  analysis,
  onClose,
}: {
  analysis: AnalysisListItem;
  onClose: () => void;
}) {
  const [reviews, setReviews] = useState<ReviewRecordSummary[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    listReviews(analysis.id)
      .then((res) => {
        if (!cancelled) setReviews(res);
      })
      .catch(() => {
        if (!cancelled) setReviews([]);
      });
    return () => {
      cancelled = true;
    };
  }, [analysis.id]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-rice-50 rounded-xl shadow-modal p-6 w-full max-w-lg max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-ink-900 mb-4 font-serif">
          评审记录 · {analysis.title ?? '未命名作品'}
        </h3>

        {reviews === null ? (
          <SectionSkeleton lines={3} />
        ) : reviews.length === 0 ? (
          <p className="text-sm text-ink-400 py-6 text-center">暂无评审记录</p>
        ) : (
          <div className="space-y-3">
            {reviews.map((r) => (
              <div key={r.id} className="border border-ink-900/10 rounded-lg p-3.5 bg-white/50">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-ink-800">
                    {r.reviewerName ?? REVIEWER_TYPE_LABEL[r.reviewerType]}
                    <span className="ml-1.5 text-2xs text-ink-400">
                      {REVIEWER_TYPE_LABEL[r.reviewerType]}
                    </span>
                  </span>
                  <span className="text-lg font-semibold font-mono tabular-nums text-cinnabar">
                    {r.scores.overallScore}
                  </span>
                </div>
                {/* 维度分明细 */}
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {Object.entries(r.scores.dimensions).map(([dim, v]) => (
                    <span
                      key={dim}
                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-2xs ${REVIEW_LEVEL_COLOR[v.level]}`}
                    >
                      {dim} {v.score} · {REVIEW_LEVEL_LABEL[v.level]}
                    </span>
                  ))}
                </div>
                {r.comment && <p className="text-xs text-ink-600 mb-1.5">{r.comment}</p>}
                <p className="text-2xs text-ink-300">
                  {new Date(r.createdAt).toLocaleString('zh-CN')}
                  {r.status === 'draft' && ' · 草稿'}
                  {r.status === 'superseded' && ' · 已被取代'}
                </p>
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-end mt-5">
          <button
            onClick={onClose}
            className="px-4 h-9 rounded-md border border-ink-900/15 text-sm text-ink-700"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
 * 评分弹窗(单评/批量共用表单)
 * ============================================================ */
function ReviewModal({
  title,
  progress,
  onCancel,
  onSubmit,
}: {
  title: string;
  progress: { done: number; total: number } | null;
  onCancel: () => void;
  onSubmit: (payload: CreateReviewRequest) => Promise<void>;
}) {
  const [scores, setScores] = useState<Record<string, number>>(() =>
    Object.fromEntries(REVIEW_DIMENSIONS.map((d) => [d.key, 75])),
  );
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const overallScore = useMemo(() => {
    const vals = REVIEW_DIMENSIONS.map((d) => scores[d.key] ?? 0);
    return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  }, [scores]);

  const busy = submitting || progress !== null;

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await onSubmit({
        reviewerType: 'professor',
        scores: {
          dimensions: Object.fromEntries(
            REVIEW_DIMENSIONS.map((d) => [
              d.key,
              { score: scores[d.key], level: levelOf(scores[d.key]) },
            ]),
          ),
          overallScore,
        },
        comment: comment.trim() || undefined,
        status: 'submitted',
      });
    } catch {
      // 单评错误已由 api.ts 统一 Toast;批量错误在父组件汇总
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/40 backdrop-blur-sm"
      onClick={() => !busy && onCancel()}
    >
      <div
        className="bg-rice-50 rounded-xl shadow-modal p-6 w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-ink-900 mb-4 font-serif">{title}</h3>

        {/* 维度打分 */}
        <div className="space-y-3">
          {REVIEW_DIMENSIONS.map((d) => (
            <div key={d.key} className="flex items-center gap-3">
              <span className="w-10 text-sm text-ink-600">{d.label}</span>
              <input
                type="range"
                min={0}
                max={100}
                value={scores[d.key]}
                disabled={busy}
                onChange={(e) =>
                  setScores((prev) => ({ ...prev, [d.key]: Number(e.target.value) }))
                }
                className="flex-1 accent-cinnabar"
              />
              <span className="w-8 text-right text-sm font-mono tabular-nums text-ink-800">
                {scores[d.key]}
              </span>
            </div>
          ))}
        </div>

        {/* 综合分 */}
        <div className="flex items-center justify-between mt-4 py-2.5 px-3 rounded-lg bg-rice-100">
          <span className="text-sm text-ink-600">综合评分(维度均分)</span>
          <span className="text-lg font-semibold font-mono tabular-nums text-cinnabar">
            {overallScore}
          </span>
        </div>

        {/* 评语 */}
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          disabled={busy}
          rows={3}
          placeholder="评语(可选)"
          className="w-full mt-3 px-3 py-2 rounded-md border border-ink-900/15 bg-white text-sm text-ink-800 resize-none focus:outline-none focus:ring-2 focus:ring-stone/30"
        />

        {/* 批量进度 */}
        {progress && (
          <div className="mt-3">
            <div className="flex items-center gap-2 text-xs text-ink-500 mb-1.5">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              正在提交 {progress.done} / {progress.total}
            </div>
            <div className="h-1.5 rounded-full bg-rice-200 overflow-hidden">
              <div
                className="h-full bg-cinnabar transition-all"
                style={{ width: `${(progress.done / progress.total) * 100}%` }}
              />
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={onCancel}
            disabled={busy}
            className="px-4 h-9 rounded-md border border-ink-900/15 text-sm text-ink-700 disabled:opacity-50"
          >
            取消
          </button>
          <button
            onClick={() => void handleSubmit()}
            disabled={busy}
            className="px-4 h-9 rounded-md bg-cinnabar text-rice-50 text-sm hover:bg-cinnabar-dark disabled:opacity-50"
          >
            {submitting ? '提交中…' : '提交评分'}
          </button>
        </div>
      </div>
    </div>
  );
}
