// ============================================================
// ShareToOrgDialog — 分享作品到组织动态流
//
// 交互:
//   - 输入分享感言(可选,≤200 字,实时字数统计)
//   - 确认后调用 POST /analyses/:id/share
//   - 409 幂等冲突:提示"已分享过",视为成功态关闭
//   - 成功后 toast + onShared 回调(父级可跳转到动态流)
// ============================================================

import { useEffect, useRef, useState } from 'react';
import { X, Share2, Loader2, Users } from 'lucide-react';
import { shareAnalysis, ApiError } from '../../services/api';
import { ErrorCode, type SharedWorkItem } from '../../types/api-contract';
import { useToast } from '../ToastProvider';

const MAX_CAPTION = 200;

export interface ShareToOrgDialogProps {
  /** 服务器端分析记录 ID(UUID);本地结果不应触发此弹窗 */
  analysisId: string;
  open: boolean;
  onClose: () => void;
  /** 分享成功回调(含 409 已分享的幂等场景) */
  onShared?: (item: SharedWorkItem | null) => void;
}

export default function ShareToOrgDialog({ analysisId, open, onClose, onShared }: ShareToOrgDialogProps) {
  const toast = useToast();
  const [caption, setCaption] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  /* 打开时重置并聚焦输入框 */
  useEffect(() => {
    if (open) {
      setCaption('');
      setSubmitting(false);
      /* 等待过渡动画后聚焦 */
      const t = window.setTimeout(() => inputRef.current?.focus(), 60);
      return () => window.clearTimeout(t);
    }
  }, [open]);

  /* Esc 关闭 */
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
    if (submitting) return;
    setSubmitting(true);
    try {
      const item = await shareAnalysis(analysisId, {
        caption: caption.trim() || undefined,
      });
      toast.success('已分享到组织', '同学和老师可以在组织动态中看到了');
      onShared?.(item);
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.code === ErrorCode.DUPLICATE_RESOURCE) {
        /* 409 幂等:同一作品已分享过,视为成功 */
        toast.success('已在组织动态中', '该作品之前已分享过,可直接前往查看');
        onShared?.(null);
        onClose();
        return;
      }
      toast.error('分享失败', err instanceof ApiError ? err.message : '网络异常,请稍后重试');
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-ink-900/40 backdrop-blur-sm px-4"
      onClick={() => !submitting && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label="分享到组织"
    >
      <div
        className="w-full max-w-md bg-rice-50 rounded-2xl shadow-overlay overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-ink-900/8">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-cinnabar/10 flex items-center justify-center">
              <Users className="w-4 h-4 text-cinnabar" />
            </div>
            <h3 className="font-serif text-base font-semibold text-ink-900">分享到组织</h3>
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
            分享后,本组织的老师和同学可以在「组织动态」中看到这份作品与诊断报告,并互相点评交流。
          </p>
          <div>
            <textarea
              ref={inputRef}
              value={caption}
              onChange={(e) => setCaption(e.target.value.slice(0, MAX_CAPTION))}
              placeholder="写一句分享感言吧(可选)…"
              rows={3}
              maxLength={MAX_CAPTION}
              disabled={submitting}
              className="w-full bg-white border border-ink-200 rounded-xl px-3 py-2.5 text-sm text-ink-800 placeholder:text-ink-300 focus:outline-none focus:border-stone resize-none disabled:opacity-60"
            />
            <p className="mt-1 text-right text-2xs text-ink-300 tabular-nums">
              {caption.length}/{MAX_CAPTION}
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
            disabled={submitting}
            className="inline-flex items-center gap-2 px-4 h-9 bg-cinnabar hover:bg-cinnabar-dark text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-60"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Share2 className="w-4 h-4" />}
            {submitting ? '分享中…' : '确认分享'}
          </button>
        </div>
      </div>
    </div>
  );
}
