import { Square, RectangleHorizontal, RectangleVertical, LayoutGrid, Brush, CircleDashed } from 'lucide-react';
import type { GenerationParams } from '../../services/emotionLibrary';

interface GenerationParamsPanelProps {
  params: GenerationParams;
  onChange: (params: GenerationParams) => void;
  accentColor?: string;
}

const ASPECTS = [
  { value: 'square', label: '斗方', desc: '1:1', icon: Square },
  { value: 'landscape', label: '横卷', desc: '4:3', icon: RectangleHorizontal },
  { value: 'portrait', label: '立轴', desc: '3:4', icon: RectangleVertical },
] as const;

interface SliderConfig {
  key: 'density' | 'brushwork' | 'negativeSpace';
  label: string;
  icon: typeof LayoutGrid;
  low: string;
  high: string;
}

const SLIDERS: SliderConfig[] = [
  { key: 'density', label: '构图密度', icon: LayoutGrid, low: '极简', high: '繁复' },
  { key: 'brushwork', label: '笔触力度', icon: Brush, low: '细腻', high: '豪放' },
  { key: 'negativeSpace', label: '留白程度', icon: CircleDashed, low: '饱满', high: '空灵' },
];

/**
 * 生成参数面板
 * 画幅选择 + 构图密度/笔触力度/留白程度滑杆,
 * 参数最终映射到 prompt 构建(buildEmotionPrompt)
 */
export default function GenerationParamsPanel({
  params,
  onChange,
  accentColor = '#c53030',
}: GenerationParamsPanelProps) {
  const setParam = <K extends keyof GenerationParams>(key: K, value: GenerationParams[K]) => {
    onChange({ ...params, [key]: value });
  };

  return (
    <div className="space-y-6">
      {/* 画幅选择 */}
      <div>
        <p className="text-sm font-medium text-ink-700 mb-3">画幅形制</p>
        <div className="grid grid-cols-3 gap-2">
          {ASPECTS.map((aspect) => {
            const Icon = aspect.icon;
            const isActive = params.aspect === aspect.value;
            return (
              <button
                key={aspect.value}
                onClick={() => setParam('aspect', aspect.value)}
                aria-label={aspect.label}
                className={`p-3 rounded-xl border-2 transition-all text-center ${
                  isActive
                    ? 'border-cinnabar bg-cinnabar/5'
                    : 'border-transparent bg-rice-100 hover:bg-rice-200'
                }`}
              >
                <Icon className={`w-5 h-5 mx-auto mb-1 ${isActive ? 'text-cinnabar' : 'text-ink-400'}`} />
                <p className={`text-sm font-medium ${isActive ? 'text-cinnabar' : 'text-ink-700'}`}>
                  {aspect.label}
                </p>
                <p className="text-xs text-ink-400">{aspect.desc}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* 参数滑杆 */}
      {SLIDERS.map((slider) => {
        const Icon = slider.icon;
        const value = params[slider.key];
        return (
          <div key={slider.key}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-ink-700 flex items-center gap-1.5">
                <Icon className="w-4 h-4 text-ink-400" />
                {slider.label}
              </p>
              <span className="text-xs text-ink-500 font-mono">{Math.round(value * 100)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={value}
              onChange={(e) => setParam(slider.key, parseFloat(e.target.value))}
              aria-label={slider.label}
              className="w-full h-2 rounded-full appearance-none cursor-pointer bg-ink-100"
              style={{
                background: `linear-gradient(to right, ${accentColor} 0%, ${accentColor} ${value * 100}%, #e8e3dd ${value * 100}%, #e8e3dd 100%)`,
              }}
            />
            <div className="flex justify-between mt-1">
              <span className="text-xs text-ink-400">{slider.low}</span>
              <span className="text-xs text-ink-400">{slider.high}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
