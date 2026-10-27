// ============================================================
// 丹青有AI - 教师端 · 争议仲裁
// 数据:
//   GET  /api/v1/disputes?status=&level=&page=       争议分页列表
//   POST /api/v1/disputes/:id/resolve                裁定(weighted/majority/unanimous,可覆盖分)
//   POST /api/v1/disputes/:id/apply-result           回写裁定分到作品
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Scale, RefreshCw, AlertTriangle, Gavel, CheckCircle2, UserCheck } from 'lucide-react';
import {
  listDisputes,
  resolveDispute,
  applyDisputeResult,
} from '../../services/teacher-api';
import type {
  DisputeCaseDetail,
  DisputeLevel,
  DisputeStatus,
  ResolveDisputeRequest,
} from '../../types/teacher';
import { useToast } from '../../components/ToastProvider';
import { AdminSection, SectionSkeleton } from '../../components/admin/AdminUI';

const LEVEL_LABEL: Record<DisputeLevel, string> = {
  consistent: '一致',
  general: '一般争议',
  high: '高争议',
  veto: '否决争议',
};
const LEVEL_COLOR: Record<DisputeLevel, string> = {
  consistent: 'bg-jade/10 text-jade',
  general: 'bg-gold/15 text-gold-dark',
  high: 'bg-cinnabar/10 text-cinnabar',
  veto: 'bg-cinnabar text-rice-50',
};
const STATUS_LABEL: Record<DisputeStatus, string> = {
  open: '待处理',
  reviewing: '复核中',
  resolved: '已裁定',
  closed: '已关闭',
};
const RULE_LABEL: Record<ResolveDisputeRequest['rule'], string> = {
  weighted: '加权平均',
  majority: '多数决',
  unanimous: '一致裁定',
};
const REVIEWER_LABEL: Record<string, string> = { professor: '教授', lecturer: '讲师', ai: 'AI' };

/** 判断是否为学生申请人工复核案件 */
function isManualReview(d: { triggerReason: { requestType?: string } }): boolean {
  return d.triggerReason.requestType === 'manual_review';
}

/** 截取申请理由摘要(列表用,最多 40 字) */
function truncateReason(reason: string, max = 40): string {
  return reason.length > max ? reason.slice(0, max) + '…' : reason;
}

export default function TeacherDisputesPage() {
  const toast = useToast();
  const [items, setItems] = useState<DisputeCaseDetail[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);
  const [status, setStatus] = useState('');
  const [level, setLevel] = useState('');

  /* 详情弹窗 */
  const [detail, setDetail] = useState<DisputeCaseDetail | null>(null);
  /* 裁定弹窗 */
  const [resolving, setResolving] = useState<DisputeCaseDetail | null>(null);
  /* 操作进行中 */
  const [actingId, setActingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listDisputes({
        page,
        pageSize,
        status: (status || undefined) as DisputeStatus | undefined,
        level: (level || undefined) as DisputeLevel | undefined,
      });
      setItems(res.items);
      setTotal(res.total);
    } catch {
      // 统一 Toast
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, status, level]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [total, pageSize]);

  /* ---------- 回写裁定分 ---------- */
  const onApply = async (d: DisputeCaseDetail) => {
    setActingId(d.id);
    try {
      const res = await applyDisputeResult(d.id);
      if (res.applied) {
        toast.success('裁定分已回写', `作品得分 ${res.appliedScore}`);
      } else {
        toast.error('回写未完成', '请检查作品状态后重试');
      }
      await load();
      setDetail(null);
    } catch {
      // 统一 Toast
    } finally {
      setActingId(null);
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 md:px-6 py-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink-900 font-serif flex items-center gap-2">
            <Scale className="w-5 h-5 text-cinnabar" />
            争议仲裁
          </h1>
          <p className="text-xs text-ink-400 mt-1">争议仲裁与学生复核申请,共 {total} 件</p>
        </div>
        <button
          onClick={() => void load()}
          className="inline-flex items-center gap-1.5 px-3 h-9 rounded-md border border-ink-900/15 bg-rice-50 text-sm text-ink-700 hover:bg-rice-100"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          刷新
        </button>
      </div>

      {/* 筛选栏 */}
      <div className="bg-rice-50 border border-ink-900/10 rounded-xl shadow-card p-4 flex flex-wrap items-center gap-3">
        <select
          value={status}
          onChange={(e) => {
            setPage(1);
            setStatus(e.target.value);
          }}
          className="h-9 px-3 rounded-md border border-ink-900/15 bg-white text-sm text-ink-800"
        >
          <option value="">全部状态</option>
          <option value="open">待处理</option>
          <option value="reviewing">复核中</option>
          <option value="resolved">已裁定</option>
          <option value="closed">已关闭</option>
        </select>
        <select
          value={level}
          onChange={(e) => {
            setPage(1);
            setLevel(e.target.value);
          }}
          className="h-9 px-3 rounded-md border border-ink-900/15 bg-white text-sm text-ink-800"
        >
          <option value="">全部级别</option>
          <option value="general">一般争议</option>
          <option value="high">高争议</option>
          <option value="veto">否决争议</option>
        </select>
      </div>

      {/* 争议列表 */}
      <AdminSection title="争议案件" desc="点击案件查看详情并裁定,含学生申请复核与评委分歧触发">
        {loading && items.length === 0 ? (
          <SectionSkeleton lines={5} />
        ) : items.length === 0 ? (
          <div className="py-10 text-center">
            <CheckCircle2 className="w-8 h-8 text-jade/50 mx-auto mb-2" />
            <p className="text-sm text-ink-400">暂无争议案件</p>
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((d) => (
              <button
                key={d.id}
                onClick={() => setDetail(d)}
                className="w-full flex items-center gap-3 p-3.5 rounded-lg border border-ink-900/10 bg-white/50 hover:bg-rice-100/70 transition-colors text-left"
              >
                <span
                  className={`inline-flex px-2 py-0.5 rounded-full text-2xs flex-shrink-0 ${LEVEL_COLOR[d.triggerLevel]}`}
                >
                  {LEVEL_LABEL[d.triggerLevel]}
                </span>
                {isManualReview(d) && (
                  <span className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-2xs flex-shrink-0 ${
                    d.triggerReason.reviewType === 'ai' ? 'bg-cinnabar/10 text-cinnabar' : 'bg-stone/10 text-stone'
                  }`}>
                    <UserCheck className="w-3 h-3" />
                    学生申请 · {d.triggerReason.reviewType === 'ai' ? 'AI评审' : '老师评审'}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  {isManualReview(d) ? (
                    <p className="text-sm text-ink-800 truncate">
                      <span className="text-ink-500">申请理由:</span>
                      {truncateReason(d.triggerReason.requestReason ?? '(未填写)')}
                    </p>
                  ) : (
                    <p className="text-sm text-ink-800">
                      总分极差 <span className="font-mono font-semibold">{d.triggerReason.totalRange}</span>
                      {' · '}跨档 {d.triggerReason.gradeCrossCount} 处
                      {' · '}{d.reviews.length} 份评审
                    </p>
                  )}
                  <p className="text-2xs text-ink-400 mt-0.5">
                    案件 {d.id.slice(0, 8)}… · {isManualReview(d) ? '申请于' : '触发于'} {new Date(d.createdAt).toLocaleString('zh-CN')}
                  </p>
                </div>
                <span
                  className={`inline-flex px-2 py-0.5 rounded-full text-2xs flex-shrink-0 ${
                    d.status === 'resolved' || d.status === 'closed'
                      ? 'bg-jade/10 text-jade'
                      : 'bg-gold/15 text-gold-dark'
                  }`}
                >
                  {STATUS_LABEL[d.status]}
                </span>
              </button>
            ))}
          </div>
        )}

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
      </AdminSection>

      {/* 详情弹窗 */}
      {detail && !resolving && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/40 backdrop-blur-sm"
          onClick={() => setDetail(null)}
        >
          <div
            className="bg-rice-50 rounded-xl shadow-modal p-6 w-full max-w-xl max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 mb-4">
              <span className={`inline-flex px-2 py-0.5 rounded-full text-2xs ${LEVEL_COLOR[detail.triggerLevel]}`}>
                {LEVEL_LABEL[detail.triggerLevel]}
              </span>
              <h3 className="text-base font-semibold text-ink-900 font-serif">争议详情</h3>
            </div>

            {/* 触发原因 */}
            <div className={`rounded-lg border p-3.5 mb-4 ${isManualReview(detail) ? 'bg-stone/5 border-stone/30' : 'bg-gold/10 border-gold/30'}`}>
              <p className={`text-xs font-medium flex items-center gap-1.5 mb-1.5 ${isManualReview(detail) ? 'text-stone' : 'text-gold-dark'}`}>
                {isManualReview(detail) ? <UserCheck className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
                {isManualReview(detail)
                  ? `学生申请复核 · ${detail.triggerReason.reviewType === 'ai' ? 'AI评审' : '老师评审'}`
                  : '触发原因'}
              </p>
              {isManualReview(detail) ? (
                <>
                  <p className="text-xs text-ink-400 mb-1.5">学生申请理由</p>
                  <p className="text-sm text-ink-700 leading-relaxed whitespace-pre-wrap">
                    {detail.triggerReason.requestReason ?? '(未填写理由)'}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-xs text-ink-600">
                    总分极差 {detail.triggerReason.totalRange} 分 · 跨档 {detail.triggerReason.gradeCrossCount} 处
                  </p>
                  {Object.keys(detail.triggerReason.dimDiffs).length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {Object.entries(detail.triggerReason.dimDiffs).map(([dim, diff]) => (
                        <span key={dim} className="px-1.5 py-0.5 rounded bg-rice-50 text-2xs text-ink-500">
                          {dim} 差 {diff}
                        </span>
                      ))}
                    </div>
                  )}
                  {detail.triggerReason.vetoDetail && (
                    <p className="text-2xs text-cinnabar mt-1.5">
                      否决:最低 {detail.triggerReason.vetoDetail.lowGrade} / 最高{' '}
                      {detail.triggerReason.vetoDetail.highGrade}
                    </p>
                  )}
                </>
              )}
            </div>

            {/* 评审对比 */}
            <p className="text-xs font-medium text-ink-500 mb-2">评审对比({detail.reviews.length})</p>
            <div className="space-y-2 mb-4">
              {detail.reviews.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center gap-3 p-2.5 rounded-lg border border-ink-900/10 bg-white/50"
                >
                  <span className="text-xs text-ink-600 w-14 flex-shrink-0">
                    {REVIEWER_LABEL[r.reviewerType] ?? r.reviewerType}
                  </span>
                  <div className="flex flex-wrap gap-1 flex-1">
                    {Object.entries(r.scores.dimensions).map(([dim, v]) => (
                      <span key={dim} className="text-2xs text-ink-400">
                        {dim} <span className="font-mono">{v.score}</span>
                      </span>
                    ))}
                  </div>
                  <span className="text-base font-semibold font-mono tabular-nums text-ink-900">
                    {r.scores.overallScore}
                  </span>
                </div>
              ))}
            </div>

            {/* 裁定结果 */}
            {detail.finalScore && (
              <div className="rounded-lg bg-jade/10 border border-jade/30 p-3.5 mb-4">
                <p className="text-xs font-medium text-jade mb-1">
                  裁定结果 · {RULE_LABEL[detail.finalScore.rule]}
                </p>
                <p className="text-sm text-ink-800">
                  最终总分{' '}
                  <span className="font-mono font-semibold text-lg">{detail.finalScore.overallScore}</span>
                  {detail.resolvedAt && (
                    <span className="ml-2 text-2xs text-ink-400">
                      {new Date(detail.resolvedAt).toLocaleString('zh-CN')}
                    </span>
                  )}
                </p>
              </div>
            )}

            {/* 操作 */}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDetail(null)}
                className="px-4 h-9 rounded-md border border-ink-900/15 text-sm text-ink-700"
              >
                关闭
              </button>
              {(detail.status === 'open' || detail.status === 'reviewing') && (
                <button
                  onClick={() => setResolving(detail)}
                  className="inline-flex items-center gap-1.5 px-4 h-9 rounded-md bg-cinnabar text-rice-50 text-sm hover:bg-cinnabar-dark"
                >
                  <Gavel className="w-4 h-4" />
                  裁定
                </button>
              )}
              {detail.status === 'resolved' && detail.finalScore && (
                <button
                  onClick={() => void onApply(detail)}
                  disabled={actingId === detail.id}
                  className="inline-flex items-center gap-1.5 px-4 h-9 rounded-md bg-jade text-rice-50 text-sm hover:opacity-90 disabled:opacity-50"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  {actingId === detail.id ? '回写中…' : '回写裁定分到作品'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 裁定弹窗 */}
      {resolving && (
        <ResolveModal
          dispute={resolving}
          onCancel={() => setResolving(null)}
          onDone={async () => {
            setResolving(null);
            setDetail(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

/* ============================================================
 * 裁定弹窗(规则选择 + 可选覆盖分)
 * ============================================================ */
function ResolveModal({
  dispute,
  onCancel,
  onDone,
}: {
  dispute: DisputeCaseDetail;
  onCancel: () => void;
  onDone: () => Promise<void>;
}) {
  const toast = useToast();
  const [rule, setRule] = useState<ResolveDisputeRequest['rule']>(
    dispute.arbitrationConfig.rules.final,
  );
  const [useOverride, setUseOverride] = useState(false);
  const [overrideScore, setOverrideScore] = useState(75);
  const [overrideNote, setOverrideNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const body: ResolveDisputeRequest = { rule };
      if (useOverride) {
        body.overrideScore = {
          overallScore: overrideScore,
          dimensions: Object.fromEntries(
            Object.keys(dispute.finalScore?.dimensions ?? dispute.reviews[0]?.scores.dimensions ?? {}).map(
              (k) => [k, overrideScore],
            ),
          ),
          note: overrideNote.trim() || '教师手动覆盖裁定分',
        };
      }
      const res = await resolveDispute(dispute.id, body);
      toast.success('裁定完成', `最终总分 ${res.finalScore?.overallScore ?? '-'}`);
      await onDone();
    } catch {
      // 统一 Toast
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/40 backdrop-blur-sm"
      onClick={() => !submitting && onCancel()}
    >
      <div
        className="bg-rice-50 rounded-xl shadow-modal p-6 w-full max-w-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-ink-900 mb-4 font-serif flex items-center gap-2">
          <Gavel className="w-4 h-4 text-cinnabar" />
          裁定争议
        </h3>

        {/* 裁定规则 */}
        <p className="text-xs font-medium text-ink-500 mb-2">裁定规则</p>
        <div className="space-y-1.5 mb-4">
          {(Object.keys(RULE_LABEL) as ResolveDisputeRequest['rule'][]).map((r) => (
            <label
              key={r}
              className={`flex items-center gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                rule === r ? 'border-cinnabar bg-cinnabar/5' : 'border-ink-900/10 hover:bg-rice-100/60'
              }`}
            >
              <input
                type="radio"
                name="rule"
                checked={rule === r}
                onChange={() => setRule(r)}
                className="accent-cinnabar"
              />
              <span className="text-sm text-ink-800">{RULE_LABEL[r]}</span>
            </label>
          ))}
        </div>

        {/* 覆盖分 */}
        <label className="flex items-center gap-2 mb-3 cursor-pointer">
          <input
            type="checkbox"
            checked={useOverride}
            onChange={(e) => setUseOverride(e.target.checked)}
            className="accent-cinnabar"
          />
          <span className="text-sm text-ink-700">手动覆盖最终分</span>
        </label>
        {useOverride && (
          <div className="space-y-2.5 mb-2 pl-1">
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={0}
                max={100}
                value={overrideScore}
                onChange={(e) => setOverrideScore(Number(e.target.value))}
                className="flex-1 accent-cinnabar"
              />
              <span className="w-10 text-right text-base font-semibold font-mono tabular-nums text-cinnabar">
                {overrideScore}
              </span>
            </div>
            <input
              value={overrideNote}
              onChange={(e) => setOverrideNote(e.target.value)}
              placeholder="覆盖原因(可选)"
              className="w-full h-9 px-3 rounded-md border border-ink-900/15 bg-white text-sm text-ink-800 focus:outline-none focus:ring-2 focus:ring-stone/30"
            />
          </div>
        )}

        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={onCancel}
            disabled={submitting}
            className="px-4 h-9 rounded-md border border-ink-900/15 text-sm text-ink-700 disabled:opacity-50"
          >
            取消
          </button>
          <button
            onClick={() => void handleSubmit()}
            disabled={submitting}
            className="px-4 h-9 rounded-md bg-cinnabar text-rice-50 text-sm hover:bg-cinnabar-dark disabled:opacity-50"
          >
            {submitting ? '裁定中…' : '确认裁定'}
          </button>
        </div>
      </div>
    </div>
  );
}
