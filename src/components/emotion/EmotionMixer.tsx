import { X } from 'lucide-react';
import type { EmotionEntry } from '../../services/emotionLibrary';

interface EmotionMixerProps {
  primary: EmotionEntry;
  secondary: EmotionEntry | null;
  /** 主情绪占比 0-1 */
  ratio: number;
  onRatioChange: (ratio: number) => void;
  onClearSecondary: () => void;
}

/**
 * 双情绪比例滑杆
 * 拖动调节主/次情绪配比,实时预览色板混合与比例标签
 */
export default function EmotionMixer({
  primary,
  secondary,
  ratio,
  onRatioChange,
  onClearSecondary,
}: EmotionMixerProps) {
  if (!secondary) return null;

  const pct = Math.round(ratio * 100);

  return (
    <div className="mt-4 pt-4 border-t border-ink-900/5">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-medium text-ink-700">
          配比调节
          <span className="text-xs font-normal text-ink-400 ml-2">拖动滑杆调整两种情绪的比重</span>
        </p>
        <button
          onClick={onClearSecondary}
          aria-label="移除叠加情绪"
          className="flex items-center gap-1 text-xs text-ink-400 hover:text-cinnabar transition-all"
        >
          <X className="w-3.5 h-3.5" />
          移除叠加
        </button>
      </div>

      {/* 比例标签 */}
      <div className="flex justify-between mb-2 text-sm">
        <span className="font-medium" style={{ color: primary.colorPalette[1] }}>
          {primary.name} {pct}%
        </span>
        <span className="font-medium" style={{ color: secondary.colorPalette[1] }}>
          {secondary.name} {100 - pct}%
        </span>
      </div>

      {/* 滑杆 */}
      <input
        type="range"
        min="10"
        max="90"
        step="5"
        value={pct}
        onChange={(e) => onRatioChange(parseInt(e.target.value, 10) / 100)}
        aria-label="情绪配比"
        className="w-full h-2 rounded-full appearance-none cursor-pointer"
        style={{
          background: `linear-gradient(to right, ${primary.colorPalette[1]} 0%, ${primary.colorPalette[3]} ${pct}%, ${secondary.colorPalette[3]} ${pct}%, ${secondary.colorPalette[1]} 100%)`,
        }}
      />

      {/* 快捷档位 */}
      <div className="flex justify-between mt-2">
        {[
          { v: 0.8, label: '主调突出' },
          { v: 0.65, label: '主调为主' },
          { v: 0.5, label: '均衡交融' },
          { v: 0.35, label: '次调为主' },
        ].map((preset) => (
          <button
            key={preset.v}
            onClick={() => onRatioChange(preset.v)}
            className={`text-xs px-2 py-1 rounded-md transition-all ${
              Math.abs(ratio - preset.v) < 0.05
                ? 'bg-cinnabar/10 text-cinnabar font-medium'
                : 'text-ink-400 hover:text-ink-600 hover:bg-ink-50'
            }`}
          >
            {preset.label}
          </button>
        ))}
      </div>
    </div>
  );
}
