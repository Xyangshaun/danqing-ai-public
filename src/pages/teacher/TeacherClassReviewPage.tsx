// ============================================================
// 丹青有AI - 教师端 · 班级学生作品打分页
// 数据:
//   GET  /api/v1/classes/:id/students/:userId/works            定位当前作品(分页扫描)
//   POST /api/v1/classes/:id/students/:userId/works/:analysisId/review  提交教师打分
//   GET  /api/v1/analyses/:id/annotations                       标注级批注列表(批次③)
//   POST /api/v1/analyses/:id/annotations                       创建批注(批次③)
//   PATCH/DELETE /api/v1/analyses/:id/annotations/:aid           更新/删除批注(批次③)
// 功能: 作品大图 + AI 分数 + 已有评审展示;总分 + 维度评分 + 评语表单;
//       Phase 4 批次③:标注非空时内嵌 AnnotationWorkspace,点标注卡弹批注表单
//       (action 四选 chips + comment ≤500 字;同教师同 marker 已有批注 → 更新/删除)
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ImageOff, Loader2, ClipboardCheck, Sparkles, X, Trash2, MessageSquareText } from 'lucide-react';
import { getStudentWorks, submitClassReview } from '../../services/class-api';
import type { StudentWork } from '../../services/class-api';
import {
  listAnnotations,
  createAnnotation,
  updateAnnotation,
  deleteAnnotation,
} from '../../services/teacher-api';
import type { TeacherAnnotationAction, TeacherAnnotationRecord } from '../../types/teacher';
import type { IssueMarker } from '../../types';
import { useAuth } from '../../hooks/useAuth';
import AnnotationWorkspace from '../../components/AnnotationWorkspace';
import { useToast } from '../../components/ToastProvider';
import { AdminSection, SectionSkeleton } from '../../components/admin/AdminUI';

/** 批注动作四选(与后端 schema 对齐) */
const ANNOTATION_ACTIONS: Array<{ value: TeacherAnnotationAction; label: string; desc: string }> = [
  { value: 'supplement', label: '补充', desc: '在 AI 建议外追加教学要点' },
  { value: 'correct', label: '纠正', desc: '修正 AI 判断偏差' },
  { value: 'confirm', label: '确认', desc: '认可 AI 分析,按建议执行' },
  { value: 'reject', label: '驳回', desc: 'AI 判断不成立,以画面为准' },
];

/** 从 work.result 提取 issueMarkers(顶层优先,aiVisionResult 兜底;与后端 extractMarkers 同序) */
function extractMarkersFromResult(result: unknown): IssueMarker[] {
  const stored = result as
    | { issueMarkers?: IssueMarker[]; aiVisionResult?: { issueMarkers?: IssueMarker[] } }
    | null;
  const markers = stored?.issueMarkers ?? stored?.aiVisionResult?.issueMarkers;
  return Array.isArray(markers) ? markers : [];
}

/** 评分维度(契约 dimensions 为开放 Record,此处为班级打分固定四维) */
const REVIEW_DIMENSIONS = [
  { key: 'composition', label: '构图' },
  { key: 'color', label: '色彩' },
  { key: 'technique', label: '技法' },
  { key: 'comprehensive', label: '综合' },
] as const;

type ReviewLevel = 'excellent' | 'good' | 'qualified' | 'needs_improvement';

/** 分数 → 等级映射(与教师工作台既有评审口径一致) */
function levelOf(score: number): ReviewLevel {
  if (score >= 90) return 'excellent';
  if (score >= 75) return 'good';
  if (score >= 60) return 'qualified';
  return 'needs_improvement';
}

const REVIEWER_TYPE_LABEL: Record<string, string> = {
  professor: '教授',
  lecturer: '讲师',
  ai: 'AI',
};

/** 定位当前作品:按页扫描学生作品列表(每页 50 条,最多 5 页) */
async function findWork(classId: string, studentId: string, analysisId: string): Promise<StudentWork | null> {
  for (let page = 1; page <= 5; page += 1) {
    const res = await getStudentWorks(classId, studentId, { page, limit: 50 });
    const hit = res.items.find((w) => w.id === analysisId);
    if (hit) return hit;
    if (res.items.length < 50) break;
  }
  return null;
}

export default function TeacherClassReviewPage() {
  const { classId = '', studentId = '', analysisId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const studentName = searchParams.get('name') ?? '学生';
  const navigate = useNavigate();
  const toast = useToast();

  const worksListPath = `/teacher/classes/${classId}/students/${studentId}/works?name=${encodeURIComponent(studentName)}`;

  /* ---------- 作品加载 ---------- */
  const [work, setWork] = useState<StudentWork | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!classId || !studentId || !analysisId) return;
    setLoading(true);
    try {
      const found = await findWork(classId, studentId, analysisId);
      setWork(found);
    } catch {
      // 错误已由 api.ts 统一 Toast
    } finally {
      setLoading(false);
    }
  }, [classId, studentId, analysisId]);

  useEffect(() => {
    void load();
  }, [load]);

  /* ---------- Phase 4 批次③:标注级教师批注 ---------- */
  const { user } = useAuth();
  const currentUserId = user?.id;

  /** 该作品的全部批注(silent 加载,失败不打扰打分主流程) */
  const [annotations, setAnnotations] = useState<TeacherAnnotationRecord[]>([]);
  /** 批注表单弹窗定位(null 关闭) */
  const [annotationModal, setAnnotationModal] = useState<
    { markerId?: string; markerIndex: number } | null
  >(null);
  const [formAction, setFormAction] = useState<TeacherAnnotationAction>('supplement');
  const [formComment, setFormComment] = useState('');
  const [saving, setSaving] = useState(false);

  /** 标注提取(work.result 透传;空数组回退原图展示) */
  const markers = useMemo(() => (work ? extractMarkersFromResult(work.result) : []), [work]);

  useEffect(() => {
    if (!analysisId) return;
    let cancelled = false;
    listAnnotations(analysisId)
      .then((items) => {
        if (!cancelled) setAnnotations(items);
      })
      .catch(() => {
        /* silent:旧数据/网络抖动不打扰打分主流程 */
      });
    return () => {
      cancelled = true;
    };
  }, [analysisId]);

  /** 当前教师对某 marker 的已有批注(定位键同后端唯一约束) */
  const findOwnAnnotation = useCallback(
    (markerIndex: number): TeacherAnnotationRecord | undefined =>
      annotations.find((a) => a.markerIndex === markerIndex && a.teacherId === currentUserId),
    [annotations, currentUserId],
  );

  /** 点标注卡 → 打开批注表单(已有批注则回填) */
  const openAnnotationForm = (markerId: string | undefined, markerIndex: number) => {
    const existing = findOwnAnnotation(markerIndex);
    setFormAction(existing?.action ?? 'supplement');
    setFormComment(existing?.comment ?? '');
    setAnnotationModal({ markerId, markerIndex });
  };

  /** 提交批注(已有 → PATCH;无 → POST) */
  const handleAnnotationSubmit = async () => {
    if (!annotationModal || !formComment.trim()) return;
    setSaving(true);
    try {
      const existing = findOwnAnnotation(annotationModal.markerIndex);
      const saved = existing
        ? await updateAnnotation(analysisId, existing.id, {
            action: formAction,
            comment: formComment.trim(),
          })
        : await createAnnotation(analysisId, {
            markerId: annotationModal.markerId,
            markerIndex: annotationModal.markerIndex,
            action: formAction,
            comment: formComment.trim(),
          });
      // 本地更新(替换同键记录,保持列表新鲜)
      setAnnotations((prev) => [
        ...prev.filter(
          (a) => !(a.markerIndex === annotationModal.markerIndex && a.teacherId === currentUserId),
        ),
        saved,
      ]);
      toast.success(existing ? '批注已更新' : '批注已提交', '学生将在作品分析页看到该批注');
      setAnnotationModal(null);
    } catch {
      // 错误已由 api.ts 统一 Toast(409 重复等业务错误)
    } finally {
      setSaving(false);
    }
  };

  /** 删除本人批注 */
  const handleAnnotationDelete = async () => {
    const existing = annotationModal ? findOwnAnnotation(annotationModal.markerIndex) : undefined;
    if (!existing) return;
    setSaving(true);
    try {
      await deleteAnnotation(analysisId, existing.id);
      setAnnotations((prev) => prev.filter((a) => a.id !== existing.id));
      toast.success('批注已删除');
      setAnnotationModal(null);
    } catch {
      // 错误已由 api.ts 统一 Toast
    } finally {
      setSaving(false);
    }
  };

  /* ---------- 评分表单 ---------- */
  const [scores, setScores] = useState<Record<string, number>>(() =>
    Object.fromEntries(REVIEW_DIMENSIONS.map((d) => [d.key, 75])),
  );
  const [overall, setOverall] = useState(75);
  const [overallTouched, setOverallTouched] = useState(false);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  /* 维度均分:教师未手动修改总分时自动联动 */
  const autoOverall = useMemo(() => {
    const vals = REVIEW_DIMENSIONS.map((d) => scores[d.key] ?? 0);
    return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  }, [scores]);

  useEffect(() => {
    if (!overallTouched) setOverall(autoOverall);
  }, [autoOverall, overallTouched]);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await submitClassReview(classId, studentId, analysisId, {
        reviewerType: 'professor',
        scores: {
          dimensions: Object.fromEntries(
            REVIEW_DIMENSIONS.map((d) => [
              d.key,
              { score: scores[d.key], level: levelOf(scores[d.key]) },
            ]),
          ),
          overallScore: overall,
        },
        comment: comment.trim() || undefined,
      });
      toast.success('评分已提交', work?.title ?? undefined);
      navigate(worksListPath);
    } catch {
      // 错误已由 api.ts 统一 Toast
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 md:px-6 py-6 space-y-5">
      {/* 顶部 */}
      <div className="flex items-center gap-3">
        <Link
          to={worksListPath}
          className="inline-flex items-center justify-center w-8 h-8 rounded-md border border-ink-900/15 text-ink-600 hover:bg-rice-100"
          title="返回作品列表"
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div>
          <h1 className="text-xl font-semibold text-ink-900 font-serif flex items-center gap-2">
            <ClipboardCheck className="w-5 h-5 text-cinnabar" />
            教师打分
          </h1>
          <p className="text-xs text-ink-400 mt-0.5">
            {studentName} · {work?.title ?? '未命名作品'}
          </p>
        </div>
      </div>

      {loading ? (
        <AdminSection title="作品信息">
          <SectionSkeleton lines={4} />
        </AdminSection>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
          {/* 左列:作品 + AI 结果 + 已有评审 */}
          <div className="space-y-5">
            <AdminSection
              title="学生作品"
              desc={
                work
                  ? `提交于 ${new Date(work.createdAt).toLocaleString('zh-CN')}${
                      markers.length > 0 ? ` · 标注 ${markers.length} 处,点击标注卡批注` : ''
                    }`
                  : undefined
              }
            >
              {work && markers.length > 0 && work.imageUrl ? (
                <>
                  {/* Phase 4 批次③:标注工作台内嵌(图 + SVG 标注 + 侧栏卡片一体;
                      教师端不传 onMarkerFeedback——不采集学生反馈,只开批注入口) */}
                  <div className="rounded-lg border border-ink-900/10 bg-rice-50 overflow-hidden">
                    <AnnotationWorkspace
                      imageUrl={work.imageUrl}
                      issueMarkers={markers}
                      imgClassName="w-full max-h-[420px] min-h-[200px] object-contain"
                      onCardClick={openAnnotationForm}
                    />
                  </div>
                  {annotations.length > 0 && (
                    <p className="text-xs text-ink-400 mt-2 flex items-center gap-1">
                      <MessageSquareText className="w-3.5 h-3.5" />
                      已有教师批注 {annotations.length} 条(学生端与评分独立展示)
                    </p>
                  )}
                </>
              ) : work?.imageUrl ? (
                <img
                  src={work.imageUrl}
                  alt={work.title ?? '作品'}
                  className="w-full rounded-lg border border-ink-900/10 bg-rice-200 object-contain max-h-[420px]"
                />
              ) : (
                <div className="w-full h-48 rounded-lg bg-rice-200 flex items-center justify-center">
                  <ImageOff className="w-8 h-8 text-ink-300" />
                </div>
              )}
              {!work && (
                <p className="text-xs text-gold-dark mt-3">
                  未能在作品列表中定位该记录,仅展示打分表单
                </p>
              )}
            </AdminSection>

            <AdminSection title="AI 分析结果">
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-cinnabar/10">
                  <Sparkles className="w-5 h-5 text-cinnabar" />
                </span>
                <div>
                  <p className="text-2xl font-semibold font-mono tabular-nums text-ink-900">
                    {work?.overallScore == null ? '--' : work.overallScore}
                    <span className="text-sm text-ink-400 ml-1">分</span>
                  </p>
                  <p className="text-2xs text-ink-400">AI 综合评分</p>
                </div>
              </div>
            </AdminSection>

            {work && work.reviews.length > 0 && (
              <AdminSection title={`已有评审 (${work.reviews.length})`}>
                <div className="space-y-2.5">
                  {work.reviews.map((r) => (
                    <div key={r.id} className="border border-ink-900/10 rounded-lg p-3 bg-white/50">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium text-ink-700">
                          {REVIEWER_TYPE_LABEL[r.reviewerType] ?? r.reviewerType}
                        </span>
                        <span className="text-base font-semibold font-mono tabular-nums text-cinnabar">
                          {r.scores.overallScore}
                        </span>
                      </div>
                      {r.comment && <p className="text-xs text-ink-600 mb-1">{r.comment}</p>}
                      <p className="text-2xs text-ink-300">
                        {new Date(r.createdAt).toLocaleString('zh-CN')}
                      </p>
                    </div>
                  ))}
                </div>
              </AdminSection>
            )}
          </div>

          {/* 右列:打分表单 */}
          <AdminSection title="评分表单" desc="拖动滑杆调整维度分,总分可手动覆盖">
            <div className="space-y-3">
              {REVIEW_DIMENSIONS.map((d) => (
                <div key={d.key} className="flex items-center gap-3">
                  <span className="w-10 text-sm text-ink-600">{d.label}</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={scores[d.key]}
                    disabled={submitting}
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

            {/* 总分(0-100,可手动覆盖) */}
            <div className="flex items-center justify-between mt-4 py-2.5 px-3 rounded-lg bg-rice-100">
              <span className="text-sm text-ink-600">
                总分(0-100)
                {!overallTouched && <span className="ml-1 text-2xs text-ink-400">维度均分</span>}
              </span>
              <input
                type="number"
                min={0}
                max={100}
                value={overall}
                disabled={submitting}
                onChange={(e) => {
                  setOverallTouched(true);
                  const v = Math.max(0, Math.min(100, Number(e.target.value) || 0));
                  setOverall(v);
                }}
                className="w-20 h-8 px-2 rounded-md border border-ink-900/15 bg-white text-right text-lg font-semibold font-mono tabular-nums text-cinnabar focus:outline-none focus:ring-2 focus:ring-stone/30"
              />
            </div>

            {/* 评语 */}
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              disabled={submitting}
              rows={4}
              maxLength={500}
              placeholder="评语(可选):构图、色彩、技法等方面的具体建议"
              className="w-full mt-3 px-3 py-2 rounded-md border border-ink-900/15 bg-white text-sm text-ink-800 resize-none focus:outline-none focus:ring-2 focus:ring-stone/30"
            />

            <div className="flex justify-end gap-2 mt-4">
              <Link
                to={worksListPath}
                className="inline-flex items-center px-4 h-9 rounded-md border border-ink-900/15 text-sm text-ink-700 hover:bg-rice-100"
              >
                取消
              </Link>
              <button
                onClick={() => void handleSubmit()}
                disabled={submitting}
                className="inline-flex items-center gap-1.5 px-4 h-9 rounded-md bg-cinnabar text-rice-50 text-sm hover:bg-cinnabar-dark disabled:opacity-50"
              >
                {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {submitting ? '提交中…' : '提交评分'}
              </button>
            </div>
          </AdminSection>
        </div>
      )}

      {/* Phase 4 批次③:标注级教师批注表单弹层(点标注卡打开;已有批注 → 更新/删除) */}
      {annotationModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/50 backdrop-blur-sm p-4"
          onClick={() => {
            if (!saving) setAnnotationModal(null);
          }}
        >
          <div
            className="bg-rice-50 rounded-2xl shadow-overlay max-w-md w-full p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-serif font-semibold text-ink-900">
                {findOwnAnnotation(annotationModal.markerIndex) ? '编辑教师批注' : '添加教师批注'}
                <span className="ml-2 text-xs text-ink-400 font-sans font-normal">
                  标注 #{annotationModal.markerIndex + 1}
                </span>
              </h3>
              <button
                type="button"
                onClick={() => setAnnotationModal(null)}
                disabled={saving}
                className="inline-flex items-center justify-center w-7 h-7 rounded-md border border-ink-900/15 text-ink-500 hover:bg-rice-100 disabled:opacity-50"
                aria-label="关闭批注表单"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* 动作四选 chips */}
            <div className="grid grid-cols-4 gap-1.5 mb-1.5">
              {ANNOTATION_ACTIONS.map((a) => (
                <button
                  key={a.value}
                  type="button"
                  disabled={saving}
                  title={a.desc}
                  onClick={() => setFormAction(a.value)}
                  className={`px-2 h-8 rounded-md text-xs font-medium border transition-colors disabled:opacity-50 ${
                    formAction === a.value
                      ? 'bg-cinnabar text-rice-50 border-transparent'
                      : 'bg-white text-ink-600 border-ink-900/15 hover:border-ink-900/40'
                  }`}
                >
                  {a.label}
                </button>
              ))}
            </div>
            <p className="text-2xs text-ink-400 mb-3">
              {ANNOTATION_ACTIONS.find((a) => a.value === formAction)?.desc}
            </p>

            <textarea
              value={formComment}
              onChange={(e) => setFormComment(e.target.value)}
              disabled={saving}
              rows={4}
              maxLength={500}
              placeholder="批注内容(1-500 字):针对该标注的教学指导"
              className="w-full px-3 py-2 rounded-md border border-ink-900/15 bg-white text-sm text-ink-800 resize-none focus:outline-none focus:ring-2 focus:ring-stone/30"
            />
            <p className="text-right text-2xs text-ink-300 mt-1">{formComment.length}/500</p>

            <div className="flex items-center justify-between mt-3">
              {findOwnAnnotation(annotationModal.markerIndex) ? (
                <button
                  type="button"
                  onClick={() => void handleAnnotationDelete()}
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 px-3 h-9 rounded-md border border-cinnabar/30 text-cinnabar text-sm hover:bg-cinnabar/5 disabled:opacity-50"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  删除批注
                </button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setAnnotationModal(null)}
                  disabled={saving}
                  className="px-4 h-9 rounded-md border border-ink-900/15 text-sm text-ink-700 hover:bg-rice-100 disabled:opacity-50"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={() => void handleAnnotationSubmit()}
                  disabled={saving || !formComment.trim()}
                  className="inline-flex items-center gap-1.5 px-4 h-9 rounded-md bg-cinnabar text-rice-50 text-sm hover:bg-cinnabar-dark disabled:opacity-50"
                >
                  {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {findOwnAnnotation(annotationModal.markerIndex) ? '保存修改' : '提交批注'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
