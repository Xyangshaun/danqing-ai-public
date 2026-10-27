// ============================================================
// 生成中(loading)组件(M2-T7)
// ------------------------------------------------------------
// 提交后轮询期间展示:loading 动画 + 状态文本
//   - pending    排队中(任务已入队,等待 Worker 处理)
//   - processing 生成中(AI 正在绘制)
// 采用朱砂主色 spinner + 阶段性进度文本,视觉与 AI 诊断页的
// analyzing 态保持一致的墨色设计语言。
// ============================================================

import { Loader2 } from 'lucide-react';
import type { GenerationStatus } from '../../services/generationService';

interface GenerationLoadingProps {
  /** 当前任务状态(pending/processing) */
  status: GenerationStatus;
  /** 轮询已进行的次数(用于进度感知提示) */
  pollCount: number;
  /** 是否允许取消(回到表单重试) */
  onCancel?: () => void;
}

/** 状态 → 提示文案映射 */
const STATUS_TEXT: Record<string, { title: string; desc: string }> = {
  pending: {
    title: '任务已排队',
    desc: '正在等待 AI 处理，队列繁忙时可能需要稍候片刻',
  },
  processing: {
    title: '正在生成',
    desc: 'AI 正在依据你的描述绘制作品，通常需要数秒',
  },
};

/**
 * 生成中 loading 态
 * @param props 见 GenerationLoadingProps
 */
export default function GenerationLoading({ status, pollCount, onCancel }: GenerationLoadingProps) {
  const meta = STATUS_TEXT[status] ?? STATUS_TEXT.processing;

  return (
    <div className="bg-rice-50 border border-ink-900/8 rounded-lg shadow-subtle overflow-hidden">
      <div className="px-6 py-10 flex flex-col items-center text-center">
        {/* 旋转 spinner */}
        <div className="relative w-16 h-16 mb-5">
          <div className="absolute inset-0 rounded-full border-4 border-ink-900/8" />
          <div className="absolute inset-0 rounded-full border-4 border-cinnabar border-t-transparent animate-spin" />
          <Loader2 className="absolute inset-0 m-auto w-6 h-6 text-cinnabar animate-spin" aria-hidden="true" />
        </div>

        <h2 className="font-serif text-lg font-bold text-ink-900">{meta.title}</h2>
        <p className="text-sm text-ink-500 mt-1 max-w-sm">{meta.desc}</p>

        {/* 状态标签 */}
        <span className="mt-4 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-cinnabar/10 text-cinnabar text-xs font-medium">
          <span className="w-1.5 h-1.5 rounded-full bg-cinnabar animate-pulse" />
          {status === 'pending' ? '排队中' : '生成中'}
        </span>

        {/* 进度提示 */}
        <p className="mt-4 text-xs text-ink-400 font-mono">
          已等待 {pollCount * 2}s · 生成完成前请勿关闭页面
        </p>

        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="mt-6 px-4 h-9 rounded border border-ink-900/10 bg-rice-100 text-sm text-ink-600 hover:border-ink-900/20 transition-colors"
          >
            取消生成
          </button>
        )}
      </div>
    </div>
  );
}
