/**
 * 真实 AI 图像生成 loading 组件
 * 由于 GLM-Image 在服务器链路约 50-70s,需要给用户明确的时间预期和阶段反馈。
 */
import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

interface Stage {
  label: string;
  hint: string;
  at: number; // 进入该阶段的秒数
}

const STAGES: Stage[] = [
  { label: '正在解析创意意图', hint: 'AI 理解风格、元素与情感', at: 0 },
  { label: '正在构思画面构图', hint: '安排主体、留白与视觉节奏', at: 10 },
  { label: '正在绘制笔墨色彩', hint: '生成水墨/色彩/质感', at: 30 },
  { label: '正在润色最终细节', hint: '即将完成,请稍候', at: 50 },
];

interface GenerationLoadingProps {
  title?: string;
  subtitle?: string;
  color?: string;
  estimatedSeconds?: number;
  /** 已完成张数(与 totalCount 配合显示"已完成 X/N"逐张进度) */
  completedCount?: number;
  /** 总张数 */
  totalCount?: number;
}

export default function GenerationLoading({
  title = 'AI 正在创作',
  subtitle = '真实 AI 图像生成约需 1 分钟,请耐心等待',
  color = '#c41e3a',
  estimatedSeconds = 70,
  completedCount,
  totalCount,
}: GenerationLoadingProps) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setElapsed((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const currentStage = STAGES.slice().reverse().find((s) => elapsed >= s.at) || STAGES[0];
  const progress = Math.min((elapsed / estimatedSeconds) * 100, 95);

  return (
    <div className="bg-rice-50 rounded-2xl p-8 md:p-12 shadow-card text-center">
      {/* Spinner + progress ring */}
      <div className="relative w-24 h-24 mx-auto mb-6">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="45" fill="none" stroke="currentColor" strokeWidth="8" className="text-ink-200" />
          <circle
            cx="50"
            cy="50"
            r="45"
            fill="none"
            stroke={color}
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={2 * Math.PI * 45}
            strokeDashoffset={2 * Math.PI * 45 * (1 - progress / 100)}
            className="transition-all duration-700 ease-out"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="w-10 h-10 animate-spin" style={{ color }} />
        </div>
      </div>

      <h3 className="font-serif text-xl md:text-2xl font-semibold text-ink-900 mb-2">
        {title}
      </h3>
      <p className="text-ink-500 mb-6">{subtitle}</p>

      {/* Stage indicator */}
      <div className="max-w-md mx-auto mb-6">
        <div className="flex items-center justify-between text-xs text-ink-400 mb-2">
          <span>已开始 {elapsed}s</span>
          <span>预计约 {estimatedSeconds}s</span>
        </div>
        <div className="w-full h-2 bg-ink-200 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-700 ease-out"
            style={{ width: `${progress}%`, backgroundColor: color }}
          />
        </div>
      </div>

      <div
        className="inline-flex flex-col items-center gap-1 px-5 py-3 rounded-xl border"
        style={{ borderColor: `${color}30`, backgroundColor: `${color}08` }}
      >
        <span className="font-medium text-ink-800">{currentStage.label}</span>
        <span className="text-sm text-ink-500">{currentStage.hint}</span>
        {/* 逐张进度:多张并行生成时,每张完成即时上屏,此处同步计数 */}
        {typeof completedCount === 'number' && typeof totalCount === 'number' && totalCount > 1 && (
          <span
            className="mt-1 inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full"
            style={{ color, backgroundColor: `${color}14` }}
            aria-live="polite"
          >
            已完成 {completedCount}/{totalCount} 张,完成后即刻上屏
          </span>
        )}
      </div>

      <p className="text-xs text-ink-400 mt-6">
        生成过程中请勿刷新或关闭页面
      </p>
    </div>
  );
}
