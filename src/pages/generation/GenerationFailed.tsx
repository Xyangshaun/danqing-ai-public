// ============================================================
// 生成失败组件(M2-T7,M4-T6 扩展)
// ------------------------------------------------------------
// status=failed 时展示 failureReason + 重试按钮。
// 重试回到表单态,保留用户上次填写的参数(由页面层维护)。
//
// M4-T6:style 任务两阶段落库(真源 §2.6 决策 D-1)保证风格拆解
// 在生图失败时也已持久化——styleAnalysis 非空时并列保留展示
// 风格拆解卡(StyleAnalysisCard),附"可重试"提示条,教学价值兜底。
// ============================================================

import { AlertCircle, RefreshCw } from 'lucide-react';
import type { StyleAnalysis } from '../../services/generationService';
import StyleAnalysisCard from './StyleAnalysisCard';

interface GenerationFailedProps {
  /** 失败原因(后端透出,可为 null) */
  failureReason: string | null;
  /** 风格拆解(两阶段落库产物,生图失败也可能非空;M4-T6 保留展示) */
  styleAnalysis?: StyleAnalysis | null;
  /** 重试:回到表单 */
  onRetry: () => void;
}

/**
 * 生成失败态
 * @param props 见 GenerationFailedProps
 */
export default function GenerationFailed({ failureReason, styleAnalysis, onRetry }: GenerationFailedProps) {
  return (
    <div className="space-y-6">
      <div className="bg-rice-50 border border-ink-900/8 rounded-lg shadow-subtle overflow-hidden">
        <div className="px-6 py-10 flex flex-col items-center text-center">
          <div className="w-16 h-16 mb-5 flex items-center justify-center rounded-full bg-cinnabar/10">
            <AlertCircle className="w-8 h-8 text-cinnabar" />
          </div>

          <h2 className="font-serif text-lg font-bold text-ink-900">生成失败</h2>
          <p className="text-sm text-ink-500 mt-2 max-w-sm break-words">
            {failureReason || 'AI 服务暂时不可用，请稍后重试'}
          </p>

          <button
            type="button"
            onClick={onRetry}
            className="mt-6 inline-flex items-center justify-center gap-2 h-10 px-5 rounded bg-cinnabar text-white text-sm font-medium hover:bg-cinnabar-dark transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            重新生成
          </button>
        </div>
      </div>

      {/* 风格拆解保留展示(两阶段落库,生图失败不丢分析成果;真源 §2.7) */}
      {styleAnalysis && (
        <StyleAnalysisCard analysis={styleAnalysis} hint="风格拆解已完成，生图失败可重试" />
      )}
    </div>
  );
}
