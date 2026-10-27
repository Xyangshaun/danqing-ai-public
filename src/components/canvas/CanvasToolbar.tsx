// ============================================================
// 丹青有AI - 独立画板工具栏(P0)
// 纯受控 UI 组件:笔刷/颜色/大小/橡皮/吸管/缩放/历史/导出
// ============================================================

import {
  Pencil,
  Brush,
  Droplets,
  Circle,
  Eraser,
  Pipette,
  Minus,
  Plus,
  Undo2,
  Redo2,
  Trash2,
  Download,
  ZoomIn,
  ZoomOut,
  Maximize,
  Palette,
  ImagePlus,
} from 'lucide-react';
import type { BrushType } from './useCanvasLayers';
import { BRUSH_CONFIG } from './useCanvasLayers';

const BRUSH_ICONS: Record<BrushType, typeof Pencil> = {
  pencil: Pencil,
  brush: Brush,
  watercolor: Droplets,
  marker: Circle,
};

export interface CanvasToolbarProps {
  brushType: BrushType;
  brushColor: string;
  brushSize: number;
  isEraser: boolean;
  isPipette: boolean;
  zoom: number;
  colorPalette: string[];
  canUndo: boolean;
  canRedo: boolean;
  hasContent: boolean;
  onBrushTypeChange: (t: BrushType) => void;
  onColorChange: (c: string) => void;
  onSizeChange: (s: number) => void;
  onToggleEraser: () => void;
  onTogglePipette: () => void;
  onZoomChange: (z: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  onExport: () => void;
  onSendAsReference: () => void;
}

const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3];

export default function CanvasToolbar(props: CanvasToolbarProps) {
  const {
    brushType, brushColor, brushSize, isEraser, isPipette, zoom,
    colorPalette, canUndo, canRedo, hasContent,
    onBrushTypeChange, onColorChange, onSizeChange,
    onToggleEraser, onTogglePipette, onZoomChange,
    onUndo, onRedo, onClear, onExport, onSendAsReference,
  } = props;

  const zoomIn = () => {
    const next = ZOOM_STEPS.find((z) => z > zoom + 0.001);
    onZoomChange(next ?? ZOOM_STEPS[ZOOM_STEPS.length - 1]);
  };
  const zoomOut = () => {
    const prev = [...ZOOM_STEPS].reverse().find((z) => z < zoom - 0.001);
    onZoomChange(prev ?? ZOOM_STEPS[0]);
  };

  const toolBtn = (active: boolean) =>
    `p-2 rounded-lg transition-all ${
      active
        ? 'bg-cinnabar text-white shadow-sm'
        : 'text-ink-500 hover:bg-ink-50 hover:text-ink-700'
    }`;

  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 bg-rice-50 border-b border-ink-900/5">
      {/* 笔刷类型 */}
      <div className="flex items-center gap-0.5 bg-white rounded-lg p-1 border border-ink-900/5">
        {(Object.keys(BRUSH_CONFIG) as BrushType[]).map((type) => {
          const Icon = BRUSH_ICONS[type];
          return (
            <button
              key={type}
              onClick={() => onBrushTypeChange(type)}
              title={BRUSH_CONFIG[type].label}
              aria-label={BRUSH_CONFIG[type].label}
              className={toolBtn(brushType === type && !isEraser)}
            >
              <Icon className="w-4 h-4" />
            </button>
          );
        })}
        {/* 橡皮擦 */}
        <button
          onClick={onToggleEraser}
          title="橡皮擦"
          aria-label="橡皮擦"
          className={toolBtn(isEraser)}
        >
          <Eraser className="w-4 h-4" />
        </button>
        {/* 吸管 */}
        <button
          onClick={onTogglePipette}
          title="吸管取色"
          aria-label="吸管取色"
          className={toolBtn(isPipette)}
        >
          <Pipette className="w-4 h-4" />
        </button>
      </div>

      {/* 颜色 */}
      <div className="flex items-center gap-1.5 bg-white rounded-lg px-2 py-1.5 border border-ink-900/5">
        <div className="flex items-center gap-1">
          {colorPalette.slice(0, 6).map((c) => (
            <button
              key={c}
              onClick={() => onColorChange(c)}
              className={`w-5 h-5 rounded-md border-2 transition-all hover:scale-110 ${
                brushColor === c ? 'border-cinnabar shadow-sm' : 'border-transparent'
              }`}
              style={{ backgroundColor: c }}
              title={c}
              aria-label={`颜色 ${c}`}
            />
          ))}
        </div>
        <div className="w-px h-5 bg-ink-900/10" />
        <label className="relative cursor-pointer" title="自定义颜色">
          <div
            className="w-6 h-6 rounded-md border border-ink-200 shadow-sm flex items-center justify-center"
            style={{ backgroundColor: brushColor }}
          >
            <Palette className="w-3 h-3 text-white drop-shadow" />
          </div>
          <input
            type="color"
            value={brushColor}
            onChange={(e) => onColorChange(e.target.value)}
            className="absolute inset-0 opacity-0 cursor-pointer"
            aria-label="自定义颜色"
          />
        </label>
      </div>

      {/* 笔刷大小 */}
      <div className="flex items-center gap-1.5 bg-white rounded-lg px-2 py-1 border border-ink-900/5">
        <button
          onClick={() => onSizeChange(Math.max(1, brushSize - 2))}
          className="p-1 text-ink-400 hover:text-ink-700"
          aria-label="减小笔刷"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
        <div className="flex items-center gap-1.5">
          <div
            className="rounded-full bg-ink-700"
            style={{ width: Math.max(4, brushSize * 0.6), height: Math.max(4, brushSize * 0.6) }}
          />
          <span className="text-xs text-ink-500 font-mono w-6 text-center">{brushSize}</span>
        </div>
        <button
          onClick={() => onSizeChange(Math.min(50, brushSize + 2))}
          className="p-1 text-ink-400 hover:text-ink-700"
          aria-label="增大笔刷"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* 缩放 */}
      <div className="flex items-center gap-1 bg-white rounded-lg px-1 py-1 border border-ink-900/5">
        <button onClick={zoomOut} className="p-1.5 text-ink-400 hover:text-ink-700" title="缩小" aria-label="缩小">
          <ZoomOut className="w-4 h-4" />
        </button>
        <span className="text-xs text-ink-500 font-mono w-10 text-center">{Math.round(zoom * 100)}%</span>
        <button onClick={zoomIn} className="p-1.5 text-ink-400 hover:text-ink-700" title="放大" aria-label="放大">
          <ZoomIn className="w-4 h-4" />
        </button>
        <button
          onClick={() => onZoomChange(1)}
          className="p-1.5 text-ink-400 hover:text-ink-700"
          title="重置缩放"
          aria-label="重置缩放"
        >
          <Maximize className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1" />

      {/* 历史与操作 */}
      <div className="flex items-center gap-0.5">
        <button
          onClick={onUndo}
          disabled={!canUndo}
          className="p-2 rounded-lg text-ink-500 hover:bg-ink-50 hover:text-ink-700 disabled:opacity-30 transition-all"
          title="撤销"
          aria-label="撤销"
        >
          <Undo2 className="w-4 h-4" />
        </button>
        <button
          onClick={onRedo}
          disabled={!canRedo}
          className="p-2 rounded-lg text-ink-500 hover:bg-ink-50 hover:text-ink-700 disabled:opacity-30 transition-all"
          title="重做"
          aria-label="重做"
        >
          <Redo2 className="w-4 h-4" />
        </button>
        <button
          onClick={onClear}
          disabled={!hasContent}
          className="p-2 rounded-lg text-ink-500 hover:bg-cinnabar/10 hover:text-cinnabar disabled:opacity-30 transition-all"
          title="清空当前图层"
          aria-label="清空当前图层"
        >
          <Trash2 className="w-4 h-4" />
        </button>
        <div className="w-px h-5 bg-ink-900/10 mx-1" />
        <button
          onClick={onSendAsReference}
          disabled={!hasContent}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-jade hover:bg-jade/10 disabled:opacity-30 transition-all text-sm"
          title="将当前画面作为 AI 生成参考图"
          aria-label="作为参考图"
        >
          <ImagePlus className="w-4 h-4" />
          <span className="hidden sm:inline">作为参考图</span>
        </button>
        <button
          onClick={onExport}
          disabled={!hasContent}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-ink-600 hover:bg-ink-50 disabled:opacity-30 transition-all text-sm"
          title="导出 PNG"
          aria-label="导出 PNG"
        >
          <Download className="w-4 h-4" />
          <span className="hidden sm:inline">导出</span>
        </button>
      </div>
    </div>
  );
}
