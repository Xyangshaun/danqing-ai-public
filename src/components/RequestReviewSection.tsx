import { useState, useEffect, useCallback } from 'react';
import { UserCheck, Loader2, ShieldCheck, Clock, X, Sparkles } from 'lucide-react';
import { listDisputes, requestDispute } from '../services/teacher-api';
import { ApiError } from '../services/api';
import type { DisputeCaseDetail } from '../types/teacher';
import { useAuth } from '../hooks/useAuth';
import { useToast } from './ToastProvider';

/**
 * 服务端分析 ID 为 UUID v4;本地分析结果为 `analysis-<timestamp>`。
 * 仅服务端落库的分析才支持申请人工复核(后端按 analysisId 建案)。
 */
const SERVER_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MIN_REASON = 10;
const MAX_REASON = 500;

/** 评审类型:AI 评审 / 老师评审 */
type ReviewType = 'ai' | 'teacher';

interface RequestReviewSectionProps {
  /** 分析任务 ID(服务端 UUID;本地结果自动隐藏) */
  analysisId: string;
}

/**
 * 学生端"申请复核"区块
 *
 * 支持两种评审模式:
 *   - AI 评审:学生请求 AI 重新评审(创建 DisputeCase,标记 reviewType=ai)
 *   - 老师评审:学生请求教师人工复核(创建 DisputeCase,标记 reviewType=teacher)
 *
 * 状态机(按该分析最新一条 DisputeCase):
 *   - 无案件 / 已归档(closed)      → 「申请复核」按钮
 *   - 进行中(open / reviewing)     → 状态横幅(禁用重复申请)
 *   - 已裁定(resolved)             → 展示最终裁定分 + 允许再次申请
 *
 * 数据安全:
 *   - 未登录 / 本地分析结果 → 组件不渲染
 *   - 查询失败(无权限/网络) → 静默降级为不渲染(不阻塞评分主流程)
 */
export default function RequestReviewSection({ analysisId }: RequestReviewSectionProps) {
  const { user } = useAuth();
  const toast = useToast();
  const [dispute, setDispute] = useState<DisputeCaseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [reviewType, setReviewType] = useState<ReviewType>('teacher');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const isServerId = SERVER_ID_RE.test(analysisId);

  const load = useCallback(async () => {
    try {
      const resp = await listDisputes({ analysisId, page: 1, pageSize: 1 });
      setDispute(resp.items[0] ?? null);
    } catch {
      /* 查询失败静默降级:学生可能无 dispute:read 之外的接口可达性,不展示入口 */
      setDispute(null);
    } finally {
      setLoading(false);
    }
  }, [analysisId]);

  useEffect(() => {
    if (!user || !isServerId) {
      setLoading(false);
      return;
    }
    void load();
  }, [user, isServerId, load]);

  /* 未登录 / 本地分析 / 状态加载中:不渲染(页面不出现闪烁入口) */
  if (!user || !isServerId || loading) return null;

  const isActive = dispute !== null && (dispute.status === 'open' || dispute.status === 'reviewing');
  const isResolved = dispute !== null && dispute.status === 'resolved';
  const reasonLen = reason.trim().length;
  const reasonValid = reasonLen >= MIN_REASON && reasonLen <= MAX_REASON;

  const handleSubmit = async () => {
    if (!reasonValid || submitting) return;
    setSubmitting(true);
    try {
      await requestDispute(analysisId, { reason: reason.trim(), reviewType });
      const typeLabel = reviewType === 'ai' ? 'AI 评审' : '人工复核';
      toast.success(`${typeLabel}申请已提交`, reviewType === 'ai'
        ? '系统将安排 AI 重新评审您的作品'
        : '教师将在争议中心查看并评审您的作品');
      setModalOpen(false);
      setReason('');
      setReviewType('teacher');
      await load();
    } catch (err) {
      if (err instanceof ApiError && err.httpStatus === 409) {
        toast.warning('请勿重复申请', '该作品已在复核流程中');
        setModalOpen(false);
        await load();
      } else if (err instanceof ApiError) {
        toast.error('申请失败', err.message);
      } else {
        toast.error('申请失败', '网络异常,请稍后重试');
      }
    } finally {
      setSubmitting(false);
    }
  };

  /* 当前进行中的评审类型(从 dispute 记录读取) */
  const activeReviewType = dispute?.triggerReason?.reviewType ?? 'teacher';

  return (
    <>
      <div className="bg-rice-50 rounded-2xl p-6 shadow-card">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 bg-stone/10 rounded-lg flex items-center justify-center">
            <UserCheck className="w-5 h-5 text-stone" />
          </div>
          <div>
            <h3 className="font-serif text-lg font-bold text-ink-900">作品评审</h3>
            <p className="text-xs text-ink-500">对 AI 评分有异议?可申请 AI 复评或教师人工复核</p>
          </div>
        </div>

        {/* 进行中:状态横幅 */}
        {isActive && (
          <div className="flex items-center gap-2 bg-gold/5 border border-gold/20 rounded-xl px-4 py-3">
            <Clock className="w-4 h-4 text-gold flex-shrink-0" />
            <p className="text-sm text-ink-700">
              {dispute.status === 'open'
                ? `${activeReviewType === 'ai' ? 'AI 评审' : '复核'}申请已提交,等待处理`
                : '评审中,请耐心等待'}
            </p>
          </div>
        )}

        {/* 已裁定:展示最终裁定分 + 允许再次申请 */}
        {isResolved && (
          <div className="bg-jade/5 border border-jade/20 rounded-xl px-4 py-3 mb-3">
            <div className="flex items-center gap-2 mb-1">
              <ShieldCheck className="w-4 h-4 text-jade flex-shrink-0" />
              <p className="text-sm font-medium text-ink-900">复核已完成</p>
            </div>
            {dispute.finalScore && (
              <p className="text-sm text-ink-600">
                最终裁定分:
                <span className="font-serif font-bold text-jade text-base ml-1">
                  {dispute.finalScore.overallScore}
                </span>
              </p>
            )}
          </div>
        )}

        {/* 可申请:无案件 / 已裁定 / 已归档 */}
        {!isActive && (
          <button
            onClick={() => setModalOpen(true)}
            className="inline-flex items-center gap-2 px-5 py-2.5 border-2 border-stone text-stone rounded-lg hover:bg-stone hover:text-rice-100 transition-all duration-300"
          >
            <UserCheck className="w-4 h-4" />
            <span className="font-medium text-sm">
              {isResolved ? '再次申请复核' : '申请复核'}
            </span>
          </button>
        )}
      </div>

      {/* 评审类型选择 + 申请理由弹窗 */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 bg-ink-900/50 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => !submitting && setModalOpen(false)}
        >
          <div
            className="bg-rice-50 rounded-2xl shadow-card w-full max-w-md p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-serif text-lg font-bold text-ink-900">申请复核</h3>
              <button
                onClick={() => !submitting && setModalOpen(false)}
                aria-label="关闭"
                className="text-ink-400 hover:text-ink-700 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* 评审类型选择 */}
            <p className="text-xs font-medium text-ink-600 mb-2">选择评审方式</p>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <button
                type="button"
                onClick={() => setReviewType('teacher')}
                className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all duration-200 ${
                  reviewType === 'teacher'
                    ? 'border-stone bg-stone/8 text-stone'
                    : 'border-ink-900/10 bg-white text-ink-500 hover:border-stone/40'
                }`}
              >
                <UserCheck className={`w-6 h-6 ${reviewType === 'teacher' ? 'text-stone' : 'text-ink-400'}`} />
                <span className="text-sm font-medium">老师评审</span>
                <span className="text-2xs text-ink-400 text-center">教师人工复核评分</span>
              </button>
              <button
                type="button"
                onClick={() => setReviewType('ai')}
                className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all duration-200 ${
                  reviewType === 'ai'
                    ? 'border-cinnabar bg-cinnabar/8 text-cinnabar'
                    : 'border-ink-900/10 bg-white text-ink-500 hover:border-cinnabar/40'
                }`}
              >
                <Sparkles className={`w-6 h-6 ${reviewType === 'ai' ? 'text-cinnabar' : 'text-ink-400'}`} />
                <span className="text-sm font-medium">AI 评审</span>
                <span className="text-2xs text-ink-400 text-center">AI 智能复评诊断</span>
              </button>
            </div>

            <p className="text-xs text-ink-500 mb-3">
              请说明您对本次评分的异议{reviewType === 'teacher' ? ',教师将结合您的理由进行人工评审' : ',AI 将基于您的反馈重新诊断'}
              ({MIN_REASON}-{MAX_REASON} 字)
            </p>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={4}
              maxLength={MAX_REASON}
              placeholder="例如:我认为构图分数偏低,本作品采用非对称构图是有意的视觉设计…"
              className="w-full bg-white border border-ink-200 rounded-xl p-3 text-sm text-ink-800 placeholder:text-ink-300 focus:outline-none focus:border-stone resize-none"
            />
            <div className="flex items-center justify-between mt-2 mb-4">
              <span className={`text-xs ${reasonValid || reasonLen === 0 ? 'text-ink-400' : 'text-cinnabar'}`}>
                {reasonLen > 0 && reasonLen < MIN_REASON ? `至少还需 ${MIN_REASON - reasonLen} 字` : ''}
              </span>
              <span className="text-xs text-ink-400 font-mono tabular-nums">
                {reasonLen}/{MAX_REASON}
              </span>
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setModalOpen(false)}
                disabled={submitting}
                className="px-4 py-2 text-sm text-ink-600 hover:text-ink-900 transition-colors disabled:opacity-50"
              >
                取消
              </button>
              <button
                onClick={() => void handleSubmit()}
                disabled={!reasonValid || submitting}
                className="inline-flex items-center gap-2 px-5 py-2 bg-stone text-rice-100 rounded-lg text-sm font-medium hover:bg-ink-900 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>{submitting ? '提交中…' : '提交申请'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
