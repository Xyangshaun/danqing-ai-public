import { useRef, useState, useCallback, useEffect } from 'react';
import {
  Pencil,
  Brush,
  Droplets,
  Undo2,
  Redo2,
  Trash2,
  Download,
  Minus,
  Plus,
  Circle,
  Palette,
} from 'lucide-react';

export interface BrushCanvasProps {
  /** 情绪色板，用于预设画笔颜色 */
  colorPalette: string[];
  /** 当前情绪名称 */
  emotionName: string;
  /** 画布宽度 */
  width?: number;
  /** 画布高度 */
  height?: number;
}

type BrushType = 'pencil' | 'brush' | 'watercolor' | 'marker';

interface Point {
  x: number;
  y: number;
  pressure?: number;
}

interface Stroke {
  points: Point[];
  color: string;
  width: number;
  type: BrushType;
  opacity: number;
}

const BRUSH_CONFIG: Record<BrushType, { label: string; icon: typeof Pencil; opacity: number }> = {
  pencil: { label: '铅笔', icon: Pencil, opacity: 0.9 },
  brush: { label: '毛笔', icon: Brush, opacity: 0.85 },
  watercolor: { label: '水彩', icon: Droplets, opacity: 0.4 },
  marker: { label: '马克笔', icon: Circle, opacity: 0.75 },
};

/* 根据当前主题返回画布背景色 */
function getCanvasBackground(): string {
  if (typeof document === 'undefined') return '#fdfcf9';
  return document.documentElement.getAttribute('data-theme') === 'dark'
    ? '#0d0d0d'
    : '#fdfcf9';
}

export default function EmotionBrushCanvas({
  colorPalette,
  emotionName,
  width = 800,
  height = 500,
}: BrushCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [brushType, setBrushType] = useState<BrushType>('brush');
  const [brushColor, setBrushColor] = useState<string>(colorPalette[2] ?? '#c41e3a');
  const [brushSize, setBrushSize] = useState<number>(8);
  const [isDrawing, setIsDrawing] = useState(false);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [redoStack, setRedoStack] = useState<Stroke[]>([]);
  const [currentStroke, setCurrentStroke] = useState<Stroke | null>(null);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [canvasBg, setCanvasBg] = useState<string>(getCanvasBackground);
  const lastPointRef = useRef<Point | null>(null);

  /* 监听主题属性变化,同步画布背景色 */
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setCanvasBg(getCanvasBackground());
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => observer.disconnect();
  }, []);

  /* 色板更新时同步当前画笔颜色 */
  useEffect(() => {
    if (colorPalette.length > 0 && !colorPalette.includes(brushColor)) {
      setBrushColor(colorPalette[2] ?? colorPalette[0]);
    }
  }, [colorPalette, brushColor]);

  /* 将坐标归一化到 canvas 内部 */
  const getCanvasPoint = useCallback(
    (e: React.MouseEvent | React.Touch): Point => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY,
        // @ts-expect-error 部分设备支持 pressure
        pressure: e.pressure ?? 0.5,
      };
    },
    [],
  );

  /* 画笔渲染逻辑 */
  const drawStroke = useCallback(
    (ctx: CanvasRenderingContext2D, stroke: Stroke) => {
      if (stroke.points.length < 2) return;
      const cfg = BRUSH_CONFIG[stroke.type];
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      if (stroke.type === 'watercolor') {
        /* 水彩: 带透明度的多层叠绘 */
        ctx.globalCompositeOperation = 'multiply';
        ctx.globalAlpha = cfg.opacity;
        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = stroke.width * 2;
        ctx.beginPath();
        ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
        for (let i = 1; i < stroke.points.length; i++) {
          const p = stroke.points[i];
          ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
        /* 第二层更细的描边增加层次 */
        ctx.globalAlpha = cfg.opacity * 0.5;
        ctx.lineWidth = stroke.width;
        ctx.beginPath();
        ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
        for (let i = 1; i < stroke.points.length; i++) {
          const p = stroke.points[i];
          ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
      } else if (stroke.type === 'brush') {
        /* 毛笔: 压感粗细变化 */
        for (let i = 1; i < stroke.points.length; i++) {
          const prev = stroke.points[i - 1];
          const curr = stroke.points[i];
          const pressure = curr.pressure ?? 0.5;
          ctx.globalAlpha = cfg.opacity;
          ctx.strokeStyle = stroke.color;
          ctx.lineWidth = stroke.width * (0.5 + pressure);
          ctx.beginPath();
          ctx.moveTo(prev.x, prev.y);
          ctx.lineTo(curr.x, curr.y);
          ctx.stroke();
        }
      } else if (stroke.type === 'marker') {
        /* 马克笔: 方形笔头 + 轻微抖动 */
        ctx.globalAlpha = cfg.opacity;
        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = stroke.width;
        ctx.lineCap = 'butt';
        ctx.beginPath();
        ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
        for (let i = 1; i < stroke.points.length; i++) {
          const p = stroke.points[i];
          /* 模拟马克笔的方形边缘 */
          const jitterX = (Math.random() - 0.5) * 0.5;
          const jitterY = (Math.random() - 0.5) * 0.5;
          ctx.lineTo(p.x + jitterX, p.y + jitterY);
        }
        ctx.stroke();
      } else {
        /* 铅笔: 细线 + 轻微透明 */
        ctx.globalAlpha = cfg.opacity;
        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = stroke.width * 0.5;
        ctx.beginPath();
        ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
        for (let i = 1; i < stroke.points.length; i++) {
          const p = stroke.points[i];
          ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
      }

      ctx.restore();
    },
    [],
  );

  /* 重绘所有笔画 */
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    /* 背景纸纹:跟随主题切换 */
    ctx.fillStyle = canvasBg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (const stroke of strokes) {
      drawStroke(ctx, stroke);
    }
    if (currentStroke) {
      drawStroke(ctx, currentStroke);
    }
  }, [strokes, currentStroke, drawStroke, canvasBg]);

  useEffect(() => {
    redraw();
  }, [redraw]);

  /* 鼠标事件 */
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (e.button !== 0) return;
      const point = getCanvasPoint(e);
      setIsDrawing(true);
      lastPointRef.current = point;
      const newStroke: Stroke = {
        points: [point],
        color: brushColor,
        width: brushSize,
        type: brushType,
        opacity: BRUSH_CONFIG[brushType].opacity,
      };
      setCurrentStroke(newStroke);
    },
    [getCanvasPoint, brushColor, brushSize, brushType],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!isDrawing || !currentStroke) return;
      const point = getCanvasPoint(e);
      /* 距离过滤:避免过于密集的点 */
      const last = lastPointRef.current;
      if (last) {
        const dx = point.x - last.x;
        const dy = point.y - last.y;
        if (dx * dx + dy * dy < 2) return;
      }
      lastPointRef.current = point;
      setCurrentStroke((prev) =>
        prev ? { ...prev, points: [...prev.points, point] } : null,
      );
    },
    [isDrawing, currentStroke, getCanvasPoint],
  );

  const handleMouseUp = useCallback(() => {
    if (!isDrawing || !currentStroke) return;
    setStrokes((prev) => [...prev, currentStroke]);
    setRedoStack([]); /* 新笔画清空重做栈 */
    setCurrentStroke(null);
    setIsDrawing(false);
    lastPointRef.current = null;
  }, [isDrawing, currentStroke]);

  /* 触控事件(支持多点触控中的单点绘画) */
  const handleTouchStart = useCallback(
    (e: React.TouchEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      const touch = e.touches[0];
      if (!touch) return;
      const point = getCanvasPoint(touch);
      setIsDrawing(true);
      lastPointRef.current = point;
      const newStroke: Stroke = {
        points: [point],
        color: brushColor,
        width: brushSize,
        type: brushType,
        opacity: BRUSH_CONFIG[brushType].opacity,
      };
      setCurrentStroke(newStroke);
    },
    [getCanvasPoint, brushColor, brushSize, brushType],
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      if (!isDrawing || !currentStroke) return;
      const touch = e.touches[0];
      if (!touch) return;
      const point = getCanvasPoint(touch);
      const last = lastPointRef.current;
      if (last) {
        const dx = point.x - last.x;
        const dy = point.y - last.y;
        if (dx * dx + dy * dy < 2) return;
      }
      lastPointRef.current = point;
      setCurrentStroke((prev) =>
        prev ? { ...prev, points: [...prev.points, point] } : null,
      );
    },
    [isDrawing, currentStroke, getCanvasPoint],
  );

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      handleMouseUp();
    },
    [handleMouseUp],
  );

  /* 撤销 */
  const handleUndo = useCallback(() => {
    if (strokes.length === 0) return;
    const last = strokes[strokes.length - 1];
    setStrokes((prev) => prev.slice(0, -1));
    setRedoStack((prev) => [...prev, last]);
  }, [strokes]);

  /* 重做 */
  const handleRedo = useCallback(() => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setRedoStack((prev) => prev.slice(0, -1));
    setStrokes((prev) => [...prev, next]);
  }, [redoStack]);

  /* 清空 */
  const handleClear = useCallback(() => {
    setRedoStack([]);
    setStrokes([]);
    setCurrentStroke(null);
  }, []);

  /* 导出 PNG */
  const handleExport = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `情绪手绘-${emotionName}-${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [emotionName]);

  /* 笔刷大小限制 */
  const adjustSize = (delta: number) => {
    setBrushSize((prev) => Math.max(1, Math.min(50, prev + delta)));
  };

  return (
    <div className="bg-rice-50 rounded-2xl shadow-card overflow-hidden" ref={containerRef}>
      {/* 工具栏 */}
      <div className="border-b border-ink-900/5 p-3 flex flex-wrap items-center gap-3">
        {/* 笔刷类型 */}
        <div className="flex items-center gap-1 bg-rice-50 rounded-lg p-1 border border-ink-900/5">
          {(Object.keys(BRUSH_CONFIG) as BrushType[]).map((type) => {
            const cfg = BRUSH_CONFIG[type];
            const Icon = cfg.icon;
            const isActive = brushType === type;
            return (
              <button
                key={type}
                onClick={() => setBrushType(type)}
                title={cfg.label}
                className={`relative p-2 rounded-md transition-all ${
                  isActive
                    ? 'bg-cinnabar text-white shadow-sm'
                    : 'text-ink-500 hover:bg-ink-50 hover:text-ink-700'
                }`}
              >
                <Icon className="w-4 h-4" />
                {isActive && (
                  <span className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-[10px] text-ink-500 whitespace-nowrap">
                    {cfg.label}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* 颜色选择 */}
        <div className="relative">
          <button
            onClick={() => setShowColorPicker((v) => !v)}
            className="flex items-center gap-2 px-3 py-2 bg-rice-50 rounded-lg border border-ink-900/5 hover:border-ink-200 transition-all"
            title="选择颜色"
          >
            <div
              className="w-5 h-5 rounded-full border border-ink-200 shadow-sm"
              style={{ backgroundColor: brushColor }}
            />
            <Palette className="w-4 h-4 text-ink-400" />
          </button>
          {showColorPicker && (
            <div className="absolute top-full left-0 mt-2 z-20 bg-rice-50 rounded-xl shadow-overlay p-3 border border-ink-900/5">
              <p className="text-xs text-ink-500 mb-2">情绪色板</p>
              <div className="flex gap-2 mb-3">
                {colorPalette.map((c) => (
                  <button
                    key={c}
                    onClick={() => {
                      setBrushColor(c);
                      setShowColorPicker(false);
                    }}
                    className={`w-8 h-8 rounded-lg border-2 transition-all hover:scale-110 ${
                      brushColor === c ? 'border-cinnabar shadow-sm' : 'border-transparent'
                    }`}
                    style={{ backgroundColor: c }}
                    title={c}
                  />
                ))}
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={brushColor}
                  onChange={(e) => setBrushColor(e.target.value)}
                  className="w-8 h-8 p-0 border-0 rounded cursor-pointer"
                />
                <span className="text-xs text-ink-500 font-mono">{brushColor}</span>
              </div>
            </div>
          )}
        </div>

        {/* 笔刷大小 */}
        <div className="flex items-center gap-2 bg-rice-50 rounded-lg px-2 py-1 border border-ink-900/5">
          <button onClick={() => adjustSize(-2)} className="p-1 text-ink-400 hover:text-ink-700">
            <Minus className="w-3.5 h-3.5" />
          </button>
          <div className="flex items-center gap-1.5">
            <div
              className="rounded-full bg-ink-700"
              style={{ width: Math.max(4, brushSize * 0.6), height: Math.max(4, brushSize * 0.6) }}
            />
            <span className="text-xs text-ink-500 font-mono w-5 text-center">{brushSize}</span>
          </div>
          <button onClick={() => adjustSize(2)} className="p-1 text-ink-400 hover:text-ink-700">
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex-1" />

        {/* 操作按钮 */}
        <div className="flex items-center gap-1">
          <button
            onClick={handleUndo}
            disabled={strokes.length === 0}
            className="p-2 rounded-lg text-ink-500 hover:bg-ink-50 hover:text-ink-700 disabled:opacity-30 transition-all"
            title="撤销 (Ctrl+Z)"
          >
            <Undo2 className="w-4 h-4" />
          </button>
          <button
            onClick={handleRedo}
            disabled={redoStack.length === 0}
            className="p-2 rounded-lg text-ink-500 hover:bg-ink-50 hover:text-ink-700 disabled:opacity-30 transition-all"
            title="重做"
          >
            <Redo2 className="w-4 h-4" />
          </button>
          <button
            onClick={handleClear}
            disabled={strokes.length === 0}
            className="p-2 rounded-lg text-ink-500 hover:bg-cinnabar/10 hover:text-cinnabar disabled:opacity-30 transition-all"
            title="清空"
          >
            <Trash2 className="w-4 h-4" />
          </button>
          <button
            onClick={handleExport}
            disabled={strokes.length === 0}
            className="p-2 rounded-lg text-ink-500 hover:bg-jade/10 hover:text-jade disabled:opacity-30 transition-all"
            title="导出 PNG"
          >
            <Download className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 画布区域 */}
      <div className="relative w-full overflow-auto" style={{ maxHeight: '60vh' }}>
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          className="w-full h-auto block cursor-crosshair touch-none select-none"
          style={{ background: canvasBg }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchEnd}
        />
      </div>

      {/* 底部提示 */}
      <div className="px-4 py-2 border-t border-ink-900/5 flex items-center justify-between">
        <p className="text-xs text-ink-400">
          支持鼠标绘画 · 触控板/平板触控 · 压感笔
        </p>
        <p className="text-xs text-ink-400">
          笔画: {strokes.length}
        </p>
      </div>
    </div>
  );
}
