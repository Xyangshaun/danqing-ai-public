import { useState } from 'react';
import { RotateCcw, Copy, Check } from 'lucide-react';
import { useToast } from '../ToastProvider';

interface EditablePaletteProps {
  /** 当前色板(可能已被用户编辑) */
  colors: string[];
  /** 原始色板(用于恢复默认) */
  originalColors: string[];
  onChange: (colors: string[]) => void;
}

/**
 * 可编辑色板
 * 点击色块打开取色器编辑;单击复制色值;支持一键恢复默认
 */
export default function EditablePalette({ colors, originalColors, onChange }: EditablePaletteProps) {
  const toast = useToast();
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const isModified = colors.some((c, i) => c !== originalColors[i]);

  const handleColorChange = (index: number, value: string) => {
    const next = [...colors];
    next[index] = value;
    onChange(next);
  };

  const handleCopy = (index: number) => {
    navigator.clipboard?.writeText(colors[index]).then(
      () => {
        setCopiedIndex(index);
        setTimeout(() => setCopiedIndex(null), 1200);
      },
      () => toast.error('复制失败', '请检查浏览器权限'),
    );
  };

  const handleReset = () => {
    onChange([...originalColors]);
    toast.success('已恢复默认色板');
  };

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-medium text-ink-700">
          色板
          <span className="text-xs font-normal text-ink-400 ml-2">双击编辑 · 单击复制</span>
        </p>
        {isModified && (
          <button
            onClick={handleReset}
            className="flex items-center gap-1 text-xs text-cinnabar hover:text-cinnabar/80 transition-all"
            aria-label="恢复默认色板"
          >
            <RotateCcw className="w-3 h-3" />
            恢复默认
          </button>
        )}
      </div>

      <div className="flex gap-1">
        {colors.map((color, i) => (
          <div key={i} className="relative flex-1 group">
            <div
              role="button"
              tabIndex={0}
              aria-label={`色块 ${color}`}
              className={`h-10 w-full shadow-sm cursor-pointer hover:scale-110 transition-transform first:rounded-l-lg last:rounded-r-lg ${
                editingIndex === i ? 'ring-2 ring-cinnabar scale-110 z-10' : ''
              }`}
              style={{ backgroundColor: color }}
              onClick={() => handleCopy(i)}
              onDoubleClick={() => setEditingIndex(editingIndex === i ? null : i)}
            >
              <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                {copiedIndex === i ? (
                  <Check className="w-3 h-3 text-white drop-shadow" />
                ) : (
                  <Copy className="w-3 h-3 text-white/80 drop-shadow" />
                )}
              </div>
            </div>

            {/* 编辑取色器 */}
            {editingIndex === i && (
              <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 z-30 bg-white rounded-xl shadow-overlay p-3 border border-ink-900/5">
                <input
                  type="color"
                  value={color}
                  onChange={(e) => handleColorChange(i, e.target.value)}
                  className="w-16 h-8 p-0 border-0 rounded cursor-pointer"
                  aria-label="编辑颜色"
                />
                <p className="text-xs text-ink-500 font-mono mt-1 text-center">{color}</p>
                <button
                  onClick={() => setEditingIndex(null)}
                  className="mt-2 w-full text-xs text-cinnabar hover:underline"
                >
                  完成
                </button>
              </div>
            )}

            {/* 修改标记 */}
            {isModified && color !== originalColors[i] && (
              <div className="absolute -top-1 -right-0.5 w-2 h-2 bg-cinnabar rounded-full shadow" />
            )}
          </div>
        ))}
      </div>
      <p className="text-xs text-ink-400 text-center mt-2">
        {isModified ? '色板已自定义' : '单击色块复制色值,双击编辑'}
      </p>
    </div>
  );
}
