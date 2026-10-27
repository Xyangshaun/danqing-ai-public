// ============================================================
// 丹青有AI - 画板图层引擎(P0 独立画板核心)
// ------------------------------------------------------------
// 职责:
//   - 图层模型管理(新建/删除/重命名/显隐/排序/不透明度)
//   - 每层一个 offscreen canvas 缓存,主 canvas 按层序 + globalAlpha 合成
//   - 撤销/重做按"当前活动图层"的笔画栈
//   - 4 种笔刷(铅笔/毛笔/水彩/马克笔) + 橡皮擦(destination-out)
//
// 设计决策:
//   - 与 EmotionBrushCanvas(页内简版)暂时并存,本引擎供 CanvasPage 使用;
//     后续 P1 迭代可让页内画板迁移到本引擎,避免两套绘画逻辑分叉
//   - 马克笔的随机抖动只在笔画提交时计算一次并固化到层缓存,
//     修复了页内画板每次重绘抖动导致的画面闪烁问题
//   - 橡皮擦实时预览为半透明灰线,提交时才以 destination-out 真正擦除本层
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';

export type BrushType = 'pencil' | 'brush' | 'watercolor' | 'marker';

export interface Point {
  x: number;
  y: number;
  pressure?: number;
}

export interface Stroke {
  points: Point[];
  color: string;
  width: number;
  type: BrushType;
  opacity: number;
  /** 橡皮擦笔画(destination-out 合成,只擦除所在图层) */
  isEraser?: boolean;
}

export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  /** 0-1,合成时作用于整层 */
  opacity: number;
  strokes: Stroke[];
}

export const BRUSH_CONFIG: Record<BrushType, { label: string; opacity: number }> = {
  pencil: { label: '铅笔', opacity: 0.9 },
  brush: { label: '毛笔', opacity: 0.85 },
  watercolor: { label: '水彩', opacity: 0.4 },
  marker: { label: '马克笔', opacity: 0.75 },
};

const PAPER_COLOR = '#fdfcf9';

let layerSeq = 0;
function createLayer(name?: string): Layer {
  layerSeq += 1;
  return {
    id: `layer-${Date.now()}-${layerSeq}`,
    name: name ?? `图层 ${layerSeq}`,
    visible: true,
    opacity: 1,
    strokes: [],
  };
}

export interface UseCanvasLayersOptions {
  width: number;
  height: number;
}

export function useCanvasLayers({ width, height }: UseCanvasLayersOptions) {
  /* ------------------------------------------------------------
   * 状态 + ref 双写:canvas 绘制是同步命令式操作,不能等 React 渲染,
   * 因此所有操作同时更新 ref(供绘制读取)和 state(供 UI 渲染)
   * ------------------------------------------------------------ */
  const initialLayerRef = useRef<Layer | null>(null);
  if (!initialLayerRef.current) {
    initialLayerRef.current = createLayer('背景层');
  }

  const layersRef = useRef<Layer[]>([initialLayerRef.current]);
  const [layers, setLayersState] = useState<Layer[]>(layersRef.current);

  const activeLayerIdRef = useRef<string>(initialLayerRef.current.id);
  const [activeLayerId, setActiveLayerIdState] = useState<string>(activeLayerIdRef.current);

  /* 重做栈按图层分组 */
  const redoRef = useRef<Record<string, Stroke[]>>({});
  /* 仅作为 canRedo 变化时的重渲染触发器 */
  const [redoVersion, setRedoVersion] = useState(0);

  /* 主画布 + 各图层 offscreen 缓存 */
  const displayCanvasRef = useRef<HTMLCanvasElement>(null);
  const layerCanvasesRef = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const currentStrokeRef = useRef<Stroke | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const lastPointRef = useRef<Point | null>(null);

  const commitLayers = useCallback((next: Layer[]) => {
    layersRef.current = next;
    setLayersState(next);
  }, []);

  const setActiveLayer = useCallback((id: string) => {
    activeLayerIdRef.current = id;
    setActiveLayerIdState(id);
  }, []);

  /* ------------------------------------------------------------
   * 笔画渲染(与页内画板算法一致,新增橡皮擦分支)
   * ------------------------------------------------------------ */
  const renderStroke = useCallback((ctx: CanvasRenderingContext2D, stroke: Stroke) => {
    if (stroke.points.length < 2) return;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (stroke.isEraser) {
      /* 橡皮擦:只擦除当前图层内容 */
      ctx.globalCompositeOperation = 'destination-out';
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#000';
      ctx.lineWidth = stroke.width * 2;
      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (let i = 1; i < stroke.points.length; i++) {
        ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
      }
      ctx.stroke();
      ctx.restore();
      return;
    }

    const cfg = BRUSH_CONFIG[stroke.type];

    if (stroke.type === 'watercolor') {
      /* 水彩:multiply 多层叠绘 */
      ctx.globalCompositeOperation = 'multiply';
      ctx.globalAlpha = cfg.opacity;
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.width * 2;
      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (let i = 1; i < stroke.points.length; i++) {
        ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
      }
      ctx.stroke();
      ctx.globalAlpha = cfg.opacity * 0.5;
      ctx.lineWidth = stroke.width;
      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (let i = 1; i < stroke.points.length; i++) {
        ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
      }
      ctx.stroke();
    } else if (stroke.type === 'brush') {
      /* 毛笔:压感粗细变化 */
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
      /* 马克笔:方形笔头 + 轻微抖动(提交时固化,不再每次重绘闪烁) */
      ctx.globalAlpha = cfg.opacity;
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.width;
      ctx.lineCap = 'butt';
      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (let i = 1; i < stroke.points.length; i++) {
        const p = stroke.points[i];
        const jitterX = (Math.random() - 0.5) * 0.5;
        const jitterY = (Math.random() - 0.5) * 0.5;
        ctx.lineTo(p.x + jitterX, p.y + jitterY);
      }
      ctx.stroke();
    } else {
      /* 铅笔:细线 */
      ctx.globalAlpha = cfg.opacity;
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.width * 0.5;
      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (let i = 1; i < stroke.points.length; i++) {
        ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
      }
      ctx.stroke();
    }

    ctx.restore();
  }, []);

  /* ------------------------------------------------------------
   * 图层缓存与合成
   * ------------------------------------------------------------ */
  const ensureLayerCanvas = useCallback(
    (layerId: string): HTMLCanvasElement => {
      let c = layerCanvasesRef.current.get(layerId);
      if (!c) {
        c = document.createElement('canvas');
        c.width = width;
        c.height = height;
        layerCanvasesRef.current.set(layerId, c);
      }
      return c;
    },
    [width, height],
  );

  /** 全量重建某层缓存(undo/redo/clear/结构变化时调用) */
  const rebuildLayerCache = useCallback(
    (layerId: string, strokes: Stroke[]) => {
      const c = ensureLayerCanvas(layerId);
      const ctx = c.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, width, height);
      for (const s of strokes) {
        renderStroke(ctx, s);
      }
    },
    [ensureLayerCanvas, renderStroke, width, height],
  );

  /** 主画布合成:纸底 → 各层(显隐+不透明度) → 实时笔画 overlay */
  const composite = useCallback(() => {
    const display = displayCanvasRef.current;
    if (!display) return;
    const ctx = display.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = PAPER_COLOR;
    ctx.fillRect(0, 0, width, height);

    for (const layer of layersRef.current) {
      if (!layer.visible) continue;
      const c = ensureLayerCanvas(layer.id);
      ctx.save();
      ctx.globalAlpha = layer.opacity;
      ctx.drawImage(c, 0, 0);
      ctx.restore();
    }

    /* 实时笔画:普通笔刷直接绘制;橡皮擦画半透明灰线作为预览 */
    const cur = currentStrokeRef.current;
    if (cur && cur.points.length >= 2) {
      if (cur.isEraser) {
        ctx.save();
        ctx.globalAlpha = 0.4;
        ctx.strokeStyle = '#9ca3af';
        ctx.lineWidth = cur.width * 2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(cur.points[0].x, cur.points[0].y);
        for (let i = 1; i < cur.points.length; i++) {
          ctx.lineTo(cur.points[i].x, cur.points[i].y);
        }
        ctx.stroke();
        ctx.restore();
      } else {
        renderStroke(ctx, cur);
      }
    }
  }, [ensureLayerCanvas, renderStroke, width, height]);

  /* state 变化后重新合成(显隐/不透明度/排序等) */
  useEffect(() => {
    composite();
  }, [layers, composite]);

  /* ------------------------------------------------------------
   * 绘画事件(供画布组件绑定鼠标/触控)
   * ------------------------------------------------------------ */
  const startStroke = useCallback(
    (point: Point, config: { color: string; width: number; type: BrushType; isEraser?: boolean }) => {
      setIsDrawing(true);
      lastPointRef.current = point;
      currentStrokeRef.current = {
        points: [point],
        color: config.color,
        width: config.width,
        type: config.type,
        opacity: BRUSH_CONFIG[config.type].opacity,
        isEraser: config.isEraser,
      };
      composite();
    },
    [composite],
  );

  const extendStroke = useCallback(
    (point: Point) => {
      const cur = currentStrokeRef.current;
      if (!cur) return;
      const last = lastPointRef.current;
      if (last) {
        const dx = point.x - last.x;
        const dy = point.y - last.y;
        if (dx * dx + dy * dy < 2) return; /* 距离过滤 */
      }
      lastPointRef.current = point;
      cur.points.push(point);
      composite();
    },
    [composite],
  );

  const endStroke = useCallback(() => {
    const cur = currentStrokeRef.current;
    if (!cur) {
      setIsDrawing(false);
      return;
    }
    const activeId = activeLayerIdRef.current;

    /* 单点笔画(未移动)不记入 */
    if (cur.points.length >= 2) {
      /* 增量绘制到活动层缓存(橡皮擦在此真正生效) */
      const c = ensureLayerCanvas(activeId);
      const ctx = c.getContext('2d');
      if (ctx) renderStroke(ctx, cur);

      commitLayers(
        layersRef.current.map((l) =>
          l.id === activeId ? { ...l, strokes: [...l.strokes, cur] } : l,
        ),
      );
      /* 新笔画清空该层重做栈 */
      redoRef.current[activeId] = [];
      setRedoVersion((v) => v + 1);
    }

    currentStrokeRef.current = null;
    setIsDrawing(false);
    lastPointRef.current = null;
    composite();
  }, [commitLayers, ensureLayerCanvas, renderStroke, composite]);

  /* ------------------------------------------------------------
   * 图层操作
   * ------------------------------------------------------------ */
  const addLayer = useCallback(() => {
    const layer = createLayer();
    commitLayers([...layersRef.current, layer]);
    ensureLayerCanvas(layer.id);
    setActiveLayer(layer.id);
  }, [commitLayers, ensureLayerCanvas, setActiveLayer]);

  const removeLayer = useCallback(
    (layerId: string) => {
      if (layersRef.current.length <= 1) return; /* 至少保留一层 */
      const next = layersRef.current.filter((l) => l.id !== layerId);
      layerCanvasesRef.current.delete(layerId);
      delete redoRef.current[layerId];
      commitLayers(next);
      if (activeLayerIdRef.current === layerId) {
        setActiveLayer(next[next.length - 1].id);
      }
    },
    [commitLayers, setActiveLayer],
  );

  const renameLayer = useCallback(
    (layerId: string, name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      commitLayers(
        layersRef.current.map((l) => (l.id === layerId ? { ...l, name: trimmed } : l)),
      );
    },
    [commitLayers],
  );

  const toggleLayerVisible = useCallback(
    (layerId: string) => {
      commitLayers(
        layersRef.current.map((l) => (l.id === layerId ? { ...l, visible: !l.visible } : l)),
      );
    },
    [commitLayers],
  );

  const setLayerOpacity = useCallback(
    (layerId: string, opacity: number) => {
      commitLayers(
        layersRef.current.map((l) =>
          l.id === layerId ? { ...l, opacity: Math.max(0.05, Math.min(1, opacity)) } : l,
        ),
      );
    },
    [commitLayers],
  );

  /** dir=1 上移(数组末尾为最顶层),dir=-1 下移 */
  const moveLayer = useCallback(
    (layerId: string, dir: 1 | -1) => {
      const arr = [...layersRef.current];
      const idx = arr.findIndex((l) => l.id === layerId);
      const target = idx + dir;
      if (idx < 0 || target < 0 || target >= arr.length) return;
      [arr[idx], arr[target]] = [arr[target], arr[idx]];
      commitLayers(arr);
    },
    [commitLayers],
  );

  /* ------------------------------------------------------------
   * 历史(按活动图层)
   * ------------------------------------------------------------ */
  const undo = useCallback(() => {
    const activeId = activeLayerIdRef.current;
    const layer = layersRef.current.find((l) => l.id === activeId);
    if (!layer || layer.strokes.length === 0) return;

    const last = layer.strokes[layer.strokes.length - 1];
    const nextStrokes = layer.strokes.slice(0, -1);
    commitLayers(
      layersRef.current.map((l) => (l.id === activeId ? { ...l, strokes: nextStrokes } : l)),
    );
    redoRef.current[activeId] = [...(redoRef.current[activeId] ?? []), last];
    setRedoVersion((v) => v + 1);
    rebuildLayerCache(activeId, nextStrokes);
    composite();
  }, [commitLayers, rebuildLayerCache, composite]);

  const redo = useCallback(() => {
    const activeId = activeLayerIdRef.current;
    const stack = redoRef.current[activeId] ?? [];
    if (stack.length === 0) return;

    const next = stack[stack.length - 1];
    redoRef.current[activeId] = stack.slice(0, -1);
    setRedoVersion((v) => v + 1);

    const layer = layersRef.current.find((l) => l.id === activeId);
    const nextStrokes = [...(layer?.strokes ?? []), next];
    commitLayers(
      layersRef.current.map((l) => (l.id === activeId ? { ...l, strokes: nextStrokes } : l)),
    );

    /* 增量补画该笔画 */
    const c = ensureLayerCanvas(activeId);
    const ctx = c.getContext('2d');
    if (ctx) renderStroke(ctx, next);
    composite();
  }, [commitLayers, ensureLayerCanvas, renderStroke, composite]);

  const clearActiveLayer = useCallback(() => {
    const activeId = activeLayerIdRef.current;
    commitLayers(
      layersRef.current.map((l) => (l.id === activeId ? { ...l, strokes: [] } : l)),
    );
    redoRef.current[activeId] = [];
    setRedoVersion((v) => v + 1);
    rebuildLayerCache(activeId, []);
    composite();
  }, [commitLayers, rebuildLayerCache, composite]);

  /* ------------------------------------------------------------
   * 导出与吸管
   * ------------------------------------------------------------ */
  /** 合成当前画面为 PNG dataURL(含纸底) */
  const exportDataURL = useCallback((): string | null => {
    const display = displayCanvasRef.current;
    if (!display) return null;
    /* 先清掉实时笔画再导出,避免把未提交的笔画/橡皮预览带进产物 */
    const backup = currentStrokeRef.current;
    currentStrokeRef.current = null;
    composite();
    const url = display.toDataURL('image/png');
    currentStrokeRef.current = backup;
    composite();
    return url;
  }, [composite]);

  /** 吸管:读取合成像素颜色(基于主画布显示结果) */
  const pickColor = useCallback(
    (point: Point): string | null => {
      const display = displayCanvasRef.current;
      if (!display) return null;
      const ctx = display.getContext('2d');
      if (!ctx) return null;
      const x = Math.max(0, Math.min(width - 1, Math.round(point.x)));
      const y = Math.max(0, Math.min(height - 1, Math.round(point.y)));
      const d = ctx.getImageData(x, y, 1, 1).data;
      return `#${[d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
    },
    [width, height],
  );

  /* ------------------------------------------------------------
   * 派生状态
   * ------------------------------------------------------------ */
  const activeLayer = layers.find((l) => l.id === activeLayerId) ?? layers[0];
  const canUndo = (activeLayer?.strokes.length ?? 0) > 0;
  /* redoVersion 仅用于触发重渲染 */
  void redoVersion;
  const canRedo = (redoRef.current[activeLayerId]?.length ?? 0) > 0;
  const totalStrokes = layers.reduce((sum, l) => sum + l.strokes.length, 0);

  return {
    /* 画布 */
    displayCanvasRef,
    isDrawing,
    /* 数据 */
    layers,
    activeLayerId,
    activeLayer,
    totalStrokes,
    /* 绘画 */
    startStroke,
    extendStroke,
    endStroke,
    /* 图层 */
    addLayer,
    removeLayer,
    renameLayer,
    toggleLayerVisible,
    setLayerOpacity,
    moveLayer,
    setActiveLayer,
    /* 历史 */
    undo,
    redo,
    clearActiveLayer,
    canUndo,
    canRedo,
    /* 工具 */
    exportDataURL,
    pickColor,
  };
}
