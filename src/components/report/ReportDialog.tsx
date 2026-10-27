// ============================================================
// ReportDialog — 举报/投诉弹窗(公安备案合规要求)
//
// 交互:
//   - 理由单选(6 个冻结契约枚举值 → 中文标签),未选择时禁止提交
//   - 补充说明 textarea(可选,≤500 字,右下角实时字数)
//   - 提交中整体禁用;成功后 Toast「举报已提交,我们将在 3 个工作日内处理」
//   - Esc / 点击遮罩关闭(提交中阻止,防误触丢状态)
//
// 视觉:与 ShareToOrgDialog 一致(宣纸底圆角卡 + 朱砂图标块 + 宋体标题)
// 错误处理:ApiError 已由 services/api 全局统一 Toast,此处仅兜底非预期异常
// ============================================================

import { useEffect, useRef, useState } from 'react';
import { X, Flag, Loader2 } from 'lucide-react';
import { createReport } from '../../services/report-api';
import { ApiError } from '../../services/api';
import type { ReportReason, ReportTargetType } from '../../types/api-contract';
import { useToast } from '../ToastProvider';

/** 补充说明最大字数(契约约定 ≤500 字) */
const MAX_DETAIL = 500;

/** 举报理由选项(value = 冻结契约枚举,label = 中文文案) */
const REASON_OPTIONS: ReadonlyArray<{ value: ReportReason; label: string }> = [
  { value: 'porn', label: '涉黄' },
  { value: 'violence', label: '暴力血腥' },
  { value: 'politics', label: '违法违规' },
  { value: 'copyright', label: '侵权' },
  { value: 'spam', label: '垃圾广告' },
  { value: 'other', label: '其他' },
];

export interface ReportDialogProps {
  /** 举报目标类型(作品/评论/用户),由调用方按挂载场景传入 */
  targetType: ReportTargetType;
  /** 举报目标 ID(作品 ID / 消息 ID / 用户 ID) */
  targetId: string;
  open: boolean;
  onClose: () => void;
}

export default function ReportDialog({ targetType, targetId, open, onClose }: ReportDialogProps) {
  const toast = useToast();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [detail, setDetail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  /* 打开时重置表单并聚焦补充说明框 */
  useEffect(() => {
    if (open) {
      setReason(null);
      setDetail('');
      setSubmitting(false);
      /* 等待过渡动画后聚焦 */
      const t = window.setTimeout(() => textareaRef.current?.focus(), 60);
      return () => window.clearTimeout(t);
    }
  }, [open]);

  /* Esc 关闭(提交中阻止) */
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, submitting, onClose]);

  if (!open) return null;

  const handleSubmit = async () => {
    if (!reason || submitting) return;
    setSubmitting(true);
    try {
      await createReport({
        targetType,
        targetId,
        reason,
        detail: detail.trim() || undefined,
      });
      toast.success('举报已提交', '我们将在 3 个工作日内处理');
      onClose();
    } catch (err) {
      /* ApiError 已由 services/api 全局统一 Toast(如 404/限流/未登录),
       * 此处仅兜底非预期异常,避免双重 Toast */
      if (!(err instanceof ApiError)) {
        toast.error('举报失败', '网络异常,请稍后重试');
      }
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-ink-900/40 backdrop-blur-sm px-4"
      onClick={() => !submitting && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label="举报"
    >
      <div
        className="w-full max-w-md bg-rice-50 rounded-2xl shadow-overlay overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-ink-900/8">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-cinnabar/10 flex items-center justify-center">
              <Flag className="w-4 h-4 text-cinnabar" />
            </div>
            <h3 className="font-serif text-base font-semibold text-ink-900">举报</h3>
          </div>
          <button
            onClick={onClose}
            disabled={submitting}
            aria-label="关闭"
            className="p-1.5 text-ink-400 hover:text-ink-700 rounded-lg transition-colors disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 内容 */}
        <div className="px-5 py-4 space-y-3">
          <p className="text-sm text-ink-600 leading-relaxed">
            请选择举报理由,我们核实后将尽快处理。恶意举报可能影响账号信用。
          </p>

          {/* 理由单选(6 项,3 列两行) */}
          <div role="radiogroup" aria-label="举报理由" className="grid grid-cols-3 gap-2">
            {REASON_OPTIONS.map((opt) => {
              const selected = reason === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setReason(opt.value)}
                  disabled={submitting}
                  className={`h-9 rounded-lg border text-sm transition-colors disabled:opacity-60 ${
                    selected
                      ? 'border-cinnabar bg-cinnabar/5 text-cinnabar font-medium ring-1 ring-cinnabar/25'
                      : 'border-ink-200 text-ink-600 hover:border-ink-900/30 hover:text-ink-900'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          {/* 补充说明(可选) */}
          <div>
            <textarea
              ref={textareaRef}
              value={detail}
              onChange={(e) => setDetail(e.target.value.slice(0, MAX_DETAIL))}
              placeholder="补充说明(可选):描述具体情况,便于核实处理…"
              rows={3}
              maxLength={MAX_DETAIL}
              disabled={submitting}
              className="w-full bg-white border border-ink-200 rounded-xl px-3 py-2.5 text-sm text-ink-800 placeholder:text-ink-300 focus:outline-none focus:border-stone resize-none disabled:opacity-60"
            />
            <p className="mt-1 text-right text-2xs text-ink-300 tabular-nums" aria-live="polite">
              {detail.length}/{MAX_DETAIL}
            </p>
          </div>
        </div>

        {/* 底部操作 */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-ink-900/8">
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-4 h-9 text-sm font-medium text-ink-600 hover:text-ink-900 hover:bg-ink-900/5 rounded-lg transition-colors disabled:opacity-50"
          >
            取消
          </button>
          <button
            onClick={() => void handleSubmit()}
            disabled={!reason || submitting}
            className="inline-flex items-center gap-2 px-4 h-9 bg-cinnabar hover:bg-cinnabar-dark text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Flag className="w-4 h-4" />}
            {submitting ? '提交中…' : '提交举报'}
          </button>
        </div>
      </div>
    </div>
  );
}
