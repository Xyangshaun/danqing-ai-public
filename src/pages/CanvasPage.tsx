// ============================================================
// 丹青有AI - 独立画板页(P0)
// 路由:/canvas (HashRouter → /app/#/canvas)
//
// 功能:
//   - 基础图层(新建/删除/重命名/显隐/排序/不透明度)
//   - 4 笔刷 + 橡皮擦 + 吸管 + 缩放
//   - 从情绪画布携色板跳转(sessionStorage 'danqing-canvas-palette')
//   - 「作为参考图」→ sessionStorage 'danqing-canvas-reference',
//     灵感嫁接页读取后自动填入作品1
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Brush } from 'lucide-react';
import CanvasToolbar from '../components/canvas/CanvasToolbar';
import LayerPanel from '../components/canvas/LayerPanel';
import { useCanvasLayers, type BrushType, type Point } from '../components/canvas/useCanvasLayers';
import { useToast } from '../components/ToastProvider';

/** 画布内部分辨率(CSS 缩放自适应,坐标换算不受影响) */
const CANVAS_WIDTH = 1280;
const CANVAS_HEIGHT = 800;

const PALETTE_STORAGE_KEY = 'danqing-canvas-palette';
const REFERENCE_STORAGE_KEY = 'danqing-canvas-reference';

/** 默认色板(无情绪上下文时的兜底,取自「朱砂」系) */
const DEFAULT_PALETTE = ['#1a1a1a', '#4a5568', '#c41e3a', '#d4af37', '#2e5fa1', '#3d8b7b'];

interface PalettePayload {
  emotion: string;
  colorPalette: string[];
}

function readPaletteFromSession(): PalettePayload {
  try {
    const raw = sessionStorage.getItem(PALETTE_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PalettePayload;
      if (Array.isArray(parsed.colorPalette) && parsed.colorPalette.length > 0) {
        return parsed;
      }
    }
  } catch {
    /* 解析失败走默认 */
  }
  return { emotion: '自由创作', colorPalette: DEFAULT_PALETTE };
}

export default function CanvasPage() {
  const navigate = useNavigate();
  const toast = useToast();

  const [palettePayload] = useState<PalettePayload>(readPaletteFromSession);
  const [brushType, setBrushType] = useState<BrushType>('brush');
  const [brushColor, setBrushColor] = useState<string>(
    palettePayload.colorPalette[2] ?? palettePayload.colorPalette[0],
  );
  const [brushSize, setBrushSize] = useState(8);
  const [isEraser, setIsEraser] = useState(false);
  const [isPipette, setIsPipette] = useState(false);
  const [zoom, setZoom] = useState(1);

  const engine = useCanvasLayers({ width: CANVAS_WIDTH, height: CANVAS_HEIGHT });
  const { displayCanvasRef } = engine;

  /* ------------------------------------------------------------
   * 坐标换算:canvas 内部分辨率固定,CSS 可能缩放
   * ------------------------------------------------------------ */
  const getCanvasPoint = useCallback((e: { clientX: number; clientY: number }): Point => {
    const canvas = displayCanvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  }, [displayCanvasRef]);

  /* ------------------------------------------------------------
   * 绘画事件(吸管模式下点击 = 取色)
   * ------------------------------------------------------------ */
  const handlePointerDown = useCallback(
    (point: Point) => {
      if (isPipette) {
        const color = engine.pickColor(point);
        if (color) {
          setBrushColor(color);
          toast.info('已取色', color);
        }
        setIsPipette(false);
        return;
      }
      engine.startStroke(point, {
        color: brushColor,
        width: brushSize,
        type: brushType,
        isEraser,
      });
    },
    [isPipette, engine, brushColor, brushSize, brushType, isEraser, toast],
  );

  const onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    handlePointerDown(getCanvasPoint(e));
  };
  const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (engine.isDrawing) engine.extendStroke(getCanvasPoint(e));
  };
  const onMouseUp = () => engine.endStroke();

  const onTouchStart = (e: React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const t = e.touches[0];
    if (t) handlePointerDown(getCanvasPoint(t));
  };
  const onTouchMove = (e: React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const t = e.touches[0];
    if (t && engine.isDrawing) engine.extendStroke(getCanvasPoint(t));
  };
  const onTouchEnd = (e: React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    engine.endStroke();
  };

  /* ------------------------------------------------------------
   * 快捷键:Ctrl+Z 撤销 / Ctrl+Shift+Z 重做 / B 笔刷 / E 橡皮
   * ------------------------------------------------------------ */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) engine.redo();
        else engine.undo();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === 'e' || e.key === 'E') setIsEraser((v) => !v);
      if (e.key === 'b' || e.key === 'B') setIsEraser(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [engine]);

  /* ------------------------------------------------------------
   * 导出与参考图
   * ------------------------------------------------------------ */
  const handleExport = () => {
    const url = engine.exportDataURL();
    if (!url) return;
    const link = document.createElement('a');
    link.download = `画板创作-${palettePayload.emotion}-${Date.now()}.png`;
    link.href = url;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success('已导出 PNG');
  };

  const handleSendAsReference = () => {
    const url = engine.exportDataURL();
    if (!url) return;
    try {
      sessionStorage.setItem(REFERENCE_STORAGE_KEY, url);
      toast.success('已保存为参考图', '前往灵感嫁接页将自动填入作品1');
    } catch {
      toast.error('保存失败', '图片过大,请简化画面后重试');
    }
  };

  return (
    <div className="min-h-screen bg-rice-200 ink-texture pt-20 flex flex-col">
      {/* 页头 */}
      <div className="max-w-full mx-auto w-full px-4 sm:px-6 lg:px-8 pt-4 pb-3 flex items-center gap-3">
        <button
          onClick={() => navigate(-1)}
          className="p-2 rounded-lg text-ink-500 hover:bg-rice-50 hover:text-ink-700 transition-all"
          title="返回"
          aria-label="返回"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <Brush className="w-5 h-5 text-cinnabar" />
        <h1 className="font-serif text-xl font-bold text-ink-900">完整画板</h1>
        {palettePayload.emotion !== '自由创作' && (
          <span className="text-xs px-2 py-1 bg-cinnabar/10 text-cinnabar rounded-full">
            来自情绪「{palettePayload.emotion}」
          </span>
        )}
        <span className="text-xs text-ink-400 ml-auto">
          共 {engine.totalStrokes} 笔 · 快捷键 B 笔刷 / E 橡皮 / Ctrl+Z 撤销
        </span>
      </div>

      {/* 工具栏 */}
      <CanvasToolbar
        brushType={brushType}
        brushColor={brushColor}
        brushSize={brushSize}
        isEraser={isEraser}
        isPipette={isPipette}
        zoom={zoom}
        colorPalette={palettePayload.colorPalette}
        canUndo={engine.canUndo}
        canRedo={engine.canRedo}
        hasContent={engine.totalStrokes > 0}
        onBrushTypeChange={(t) => {
          setBrushType(t);
          setIsEraser(false);
        }}
        onColorChange={(c) => {
          setBrushColor(c);
          setIsEraser(false);
        }}
        onSizeChange={setBrushSize}
        onToggleEraser={() => setIsEraser((v) => !v)}
        onTogglePipette={() => setIsPipette((v) => !v)}
        onZoomChange={setZoom}
        onUndo={engine.undo}
        onRedo={engine.redo}
        onClear={engine.clearActiveLayer}
        onExport={handleExport}
        onSendAsReference={handleSendAsReference}
      />

      {/* 主区:画布 + 图层面板 */}
      <div className="flex-1 flex min-h-0">
        {/* 画布滚动容器:mx-auto 实现安全居中——画布超宽时左对齐且可横向滚动到达全部内容,
            避免 justify-center 导致的左侧溢出被固定侧栏永久遮挡 */}
        <div className="flex-1 overflow-auto p-6 flex items-start">
          <div
            className="shadow-card rounded-lg overflow-hidden flex-shrink-0 mx-auto"
            style={{
              width: CANVAS_WIDTH * zoom,
              height: CANVAS_HEIGHT * zoom,
            }}
          >
            <canvas
              ref={displayCanvasRef}
              width={CANVAS_WIDTH}
              height={CANVAS_HEIGHT}
              className={`block touch-none select-none ${
                isPipette ? 'cursor-cell' : 'cursor-crosshair'
              }`}
              style={{ width: '100%', height: '100%', background: '#fdfcf9' }}
              onMouseDown={onMouseDown}
              onMouseMove={onMouseMove}
              onMouseUp={onMouseUp}
              onMouseLeave={onMouseUp}
              onTouchStart={onTouchStart}
              onTouchMove={onTouchMove}
              onTouchEnd={onTouchEnd}
              onTouchCancel={onTouchEnd}
            />
          </div>
        </div>

        {/* 图层面板 */}
        <LayerPanel
          layers={engine.layers}
          activeLayerId={engine.activeLayerId}
          onSelect={engine.setActiveLayer}
          onAdd={engine.addLayer}
          onRemove={engine.removeLayer}
          onRename={engine.renameLayer}
          onToggleVisible={engine.toggleLayerVisible}
          onOpacityChange={engine.setLayerOpacity}
          onMove={engine.moveLayer}
        />
      </div>
    </div>
  );
}
