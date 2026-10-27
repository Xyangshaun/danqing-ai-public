import { useEffect, useRef, useState } from 'react';

/** 色彩和谐度可视化数据(Phase F1 新增) */
export interface HarmonyData {
  /** 色彩和谐度分数(0-100) */
  harmonyScore?: number;
  /** 色彩和谐类型英文标识(complementary/analogous/triadic/split-complementary/monochromatic/achromatic/mixed) */
  harmonyType?: string;
  /** 主色调(HEX 或颜色描述) */
  dominantColor?: string;
}

interface HeatmapCanvasProps {
  /** 热力图数据;harmony-only 模式可传空数组 */
  heatmapData?: number[][];
  focusPoint?: { x: number; y: number };
  title?: string;
  colorScheme?: 'fire' | 'blue' | 'green' | 'purple';
  /** Phase F1:色彩和谐度数据,传入后可切换至环形可视化模式 */
  harmonyData?: HarmonyData;
}

type GridMode = 'none' | 'thirds' | 'golden';
type ViewMode = 'heatmap' | 'harmony';

interface HoverInfo {
  x: number; /* 鼠标相对 canvas 的显示坐标 */
  y: number;
  value: number;
}

/**
 * 和谐类型 → 色轮上应高亮的扇区角度列表(单位:度,0=红,120=绿,240=蓝)
 * 用于在色轮上可视化色彩和谐方案
 */
const HARMONY_ANGLES: Record<string, number[]> = {
  complementary: [0, 180],
  analogous: [0, 30, 330],
  triadic: [0, 120, 240],
  'split-complementary': [0, 150, 210],
  monochromatic: [0],
  achromatic: [],
  mixed: [0, 60, 120, 180, 240, 300],
};

/**
 * 和谐类型中文标签
 */
const HARMONY_LABELS: Record<string, string> = {
  complementary: '互补色',
  analogous: '邻近色',
  triadic: '三色配色',
  'split-complementary': '分裂互补',
  monochromatic: '单色',
  achromatic: '无彩色',
  mixed: '混合配色',
};

/**
 * Phase F1:绘制色彩和谐度环形可视化
 *
 * 可视化元素:
 *   1. 外环:360° HSL 色轮(12 段,每段 30°)
 *   2. 高亮扇区:根据 harmonyType 在色轮上高亮对应角度位置
 *   3. 中心圆:显示 harmonyScore 数值与和谐类型中文标签
 *
 * @param ctx canvas 2D 上下文
 * @param w canvas 宽度
 * @param h canvas 高度
 * @param data 色彩和谐度数据
 */
function drawHarmonyRing(ctx: CanvasRenderingContext2D, w: number, h: number, data?: HarmonyData) {
  ctx.clearRect(0, 0, w, h);

  // 背景
  ctx.fillStyle = '#fdfcf9';
  ctx.fillRect(0, 0, w, h);

  const cx = w / 2;
  const cy = h / 2;
  const outerRadius = Math.max(10, Math.min(w, h) / 2 - 20);
  const innerRadius = Math.max(5, outerRadius * 0.55);

  // 1. 绘制 360° 色轮(12 段,每段 30°)
  const segments = 12;
  for (let i = 0; i < segments; i++) {
    const startAngle = (i / segments) * Math.PI * 2 - Math.PI / 2;
    const endAngle = ((i + 1) / segments) * Math.PI * 2 - Math.PI / 2;
    const hue = (i / segments) * 360;
    ctx.fillStyle = `hsl(${hue}, 70%, 55%)`;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, outerRadius, startAngle, endAngle);
    ctx.closePath();
    ctx.fill();
  }

  // 2. 挖去中心圆(形成环形)
  ctx.fillStyle = '#fdfcf9';
  ctx.beginPath();
  ctx.arc(cx, cy, innerRadius, 0, Math.PI * 2);
  ctx.fill();

  // 3. 高亮和谐方案对应的角度位置
  const harmonyType = data?.harmonyType;
  const angles = harmonyType ? HARMONY_ANGLES[harmonyType] ?? [] : [];
  angles.forEach((angle) => {
    // angle: 0=红, 转换为 canvas 角度(0=右,顺时针), 这里 0° 对应顶部 -90°
    const rad = (angle - 90) * (Math.PI / 180);
    const hx = cx + Math.cos(rad) * ((outerRadius + innerRadius) / 2);
    const hy = cy + Math.sin(rad) * ((outerRadius + innerRadius) / 2);
    // 高亮标记:白色描边圆点
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#c41e3a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(hx, hy, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  });

  // 4. 外环描边
  ctx.strokeStyle = 'rgba(60,50,40,0.2)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, outerRadius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, innerRadius, 0, Math.PI * 2);
  ctx.stroke();

  // 5. 中心文字:和谐度分数 + 类型标签
  if (typeof data?.harmonyScore === 'number') {
    ctx.fillStyle = '#1a1a1a';
    ctx.font = 'bold 22px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${Math.round(data.harmonyScore)}`, cx, cy - 8);
    ctx.font = '10px sans-serif';
    ctx.fillStyle = '#888';
    ctx.fillText('和谐度', cx, cy + 10);
  }

  // 6. 底部标签:和谐类型中文
  if (harmonyType) {
    const label = HARMONY_LABELS[harmonyType] ?? harmonyType;
    ctx.fillStyle = '#c41e3a';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label, cx, h - 8);
  }
}

/**
 * 热力图画布组件
 *
 * 新增交互能力（Phase E2）：
 * 1. 透明度滑块：内部 useState 管理，通过 alpha 通道应用到所有 fillStyle
 * 2. hover tooltip：mousemove 计算行列位置，显示该区域视觉权重值
 * 3. 重心点脉动动画：sin 函数控制半径周期变化 + 外圈呼吸效果，requestAnimationFrame 循环
 * 4. 三分线/黄金分割线切换：'none' | 'thirds' | 'golden'，半透明白色虚线绘制
 *
 * 不修改 props 接口，保持向后兼容；新增状态全部内部管理。
 */
export default function HeatmapCanvas({ heatmapData, focusPoint, title, colorScheme = 'fire', harmonyData }: HeatmapCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /* 透明度：0~1，默认 0.8，仅组件内部管理 */
  const [opacity, setOpacity] = useState(0.8);
  /* 辅助线模式：无 / 三分线 / 黄金分割 */
  const [showGrid, setShowGrid] = useState<GridMode>('none');
  /* hover 信息：null 时隐藏 tooltip */
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);
  /* Phase F1:视图模式 - 热力图 / 色彩和谐度环形,harmonyData 存在时才可切换 */
  const [viewMode, setViewMode] = useState<ViewMode>('heatmap');

  /* harmonyData 存在时,默认展示热力图,但允许用户切换至和谐度环形 */
  const canShowHarmony = !!harmonyData && (!!harmonyData.harmonyType || typeof harmonyData.harmonyScore === 'number');

  /* 无热力图数据但有和谐度数据时,自动切换至和谐度模式 */
  useEffect(() => {
    const hasHeatmap = heatmapData && heatmapData.length > 0 && (heatmapData[0]?.length ?? 0) > 0;
    if (!hasHeatmap && canShowHarmony && viewMode !== 'harmony') {
      setViewMode('harmony');
    }
  }, [heatmapData, canShowHarmony, viewMode]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    /* Phase F1:色彩和谐度环形可视化模式 */
    if (viewMode === 'harmony') {
      drawHarmonyRing(ctx, canvas.width, canvas.height, harmonyData);
      return;
    }

    const rows = heatmapData?.length ?? 0;
    const cols = heatmapData?.[0]?.length || 1;
    const cellW = canvas.width / cols;
    const cellH = canvas.height / Math.max(1, rows);

    /**
     * 绘制静态层：背景 + 热力图单元（应用透明度）+ 焦点十字线 + 网格 + 辅助线
     * 每帧都会被调用（有 focusPoint 时进入动画循环）
     */
    const drawStatic = () => {
      // Clear
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Draw grid background
      ctx.fillStyle = 'rgba(250, 248, 245, 0.5)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Draw heatmap cells with rounded corners and smooth gradients (opacity applied)
      for (let i = 0; i < rows; i++) {
        for (let j = 0; j < cols; j++) {
          const value = heatmapData?.[i]?.[j] ?? 0;
          if (value < 0.05) continue;

          const x = j * cellW;
          const y = i * cellH;

          // Create radial gradient for smooth heat spots
          const centerX = x + cellW / 2;
          const centerY = y + cellH / 2;
          const radius = Math.max(cellW, cellH) * 1.2;

          const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);

          /* 透明度通过 alpha 通道乘以 opacity 实现 */
          if (value > 0.7) {
            gradient.addColorStop(0, `rgba(220,50,30,${0.9 * opacity})`);
            gradient.addColorStop(0.5, `rgba(255,100,50,${0.5 * opacity})`);
            gradient.addColorStop(1, `rgba(255,200,150,${0.1 * opacity})`);
          } else if (value > 0.4) {
            gradient.addColorStop(0, `rgba(255,140,50,${0.7 * opacity})`);
            gradient.addColorStop(0.6, `rgba(255,200,120,${0.3 * opacity})`);
            gradient.addColorStop(1, `rgba(255,235,200,${0.05 * opacity})`);
          } else if (value > 0.2) {
            gradient.addColorStop(0, `rgba(255,200,120,${0.5 * opacity})`);
            gradient.addColorStop(1, `rgba(255,240,220,${0.05 * opacity})`);
          } else {
            gradient.addColorStop(0, `rgba(255,220,180,${0.3 * opacity})`);
            gradient.addColorStop(1, 'rgba(255,250,245,0)');
          }

          ctx.fillStyle = gradient;
          ctx.beginPath();
          ctx.roundRect(x - cellW * 0.3, y - cellH * 0.3, cellW * 1.6, cellH * 1.6, cellW * 0.5);
          ctx.fill();
        }
      }

      // Draw focus point crosshair (static dashed lines)
      if (focusPoint) {
        const fx = focusPoint.x * canvas.width;
        const fy = focusPoint.y * canvas.height;

        ctx.strokeStyle = '#c41e3a';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 3]);

        // Vertical line
        ctx.beginPath();
        ctx.moveTo(fx, 0);
        ctx.lineTo(fx, canvas.height);
        ctx.stroke();

        // Horizontal line
        ctx.beginPath();
        ctx.moveTo(0, fy);
        ctx.lineTo(canvas.width, fy);
        ctx.stroke();

        ctx.setLineDash([]);
      }

      // Draw subtle grid lines (always on, for cell reference)
      ctx.strokeStyle = 'rgba(200,195,185,0.3)';
      ctx.lineWidth = 0.5;
      for (let i = 1; i < rows; i++) {
        ctx.beginPath();
        ctx.moveTo(0, i * cellH);
        ctx.lineTo(canvas.width, i * cellH);
        ctx.stroke();
      }
      for (let j = 1; j < cols; j++) {
        ctx.beginPath();
        ctx.moveTo(j * cellW, 0);
        ctx.lineTo(j * cellW, canvas.height);
        ctx.stroke();
      }

      // Draw thirds / golden ratio guide lines (if enabled)
      if (showGrid !== 'none') {
        ctx.strokeStyle = 'rgba(255,255,255,0.6)';
        ctx.lineWidth = 1;
        ctx.setLineDash([6, 4]);

        /* 三分线: 1/3, 2/3; 黄金分割: 0.382, 0.618 */
        const positions = showGrid === 'thirds' ? [1 / 3, 2 / 3] : [0.382, 0.618];

        for (const p of positions) {
          // Vertical guide
          ctx.beginPath();
          ctx.moveTo(p * canvas.width, 0);
          ctx.lineTo(p * canvas.width, canvas.height);
          ctx.stroke();
          // Horizontal guide
          ctx.beginPath();
          ctx.moveTo(0, p * canvas.height);
          ctx.lineTo(canvas.width, p * canvas.height);
          ctx.stroke();
        }

        ctx.setLineDash([]);
      }
    };

    /**
     * 绘制重心点（脉动动画）：sin 函数控制半径周期变化，外圈做呼吸透明度变化
     * 仅在有 focusPoint 时调用，每帧重绘
     */
    const drawCenter = (timestamp: number) => {
      if (!focusPoint) return;
      const fx = focusPoint.x * canvas.width;
      const fy = focusPoint.y * canvas.height;

      /* pulse: 0~1 周期变化，周期约 2.5s (Math.PI * 2 / (2*PI/800) = 800ms... 实际 2*PI*400≈2513ms) */
      const pulse = (Math.sin(timestamp / 400) + 1) / 2;
      const innerRadius = 5 + pulse * 3;        /* 5~8 */
      const outerRadius = 11 + pulse * 4;       /* 11~15 */
      const outerAlpha = 0.3 + (1 - pulse) * 0.4; /* 0.3~0.7，与 pulse 反相呼吸 */

      // Center dot (pulsing)
      ctx.fillStyle = '#c41e3a';
      ctx.beginPath();
      ctx.arc(fx, fy, innerRadius, 0, Math.PI * 2);
      ctx.fill();

      // Outer ring (breathing)
      ctx.strokeStyle = `rgba(196,30,58,${outerAlpha})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(fx, fy, outerRadius, 0, Math.PI * 2);
      ctx.stroke();

      // Label
      ctx.fillStyle = '#1a1a1a';
      ctx.font = 'bold 11px sans-serif';
      ctx.fillText(`视觉重心 (${Math.round(focusPoint.x * 100)}%, ${Math.round(focusPoint.y * 100)}%)`, fx + 18, fy - 8);
    };

    let raf: number | null = null;

    if (focusPoint) {
      /* 有焦点时进入动画循环：每帧重绘静态层 + 脉动重心 */
      const animate = (timestamp: number) => {
        drawStatic();
        drawCenter(timestamp);
        raf = requestAnimationFrame(animate);
      };
      raf = requestAnimationFrame(animate);
    } else {
      /* 无焦点时只绘制一次 */
      drawStatic();
    }

    return () => {
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, [heatmapData, focusPoint, colorScheme, opacity, showGrid, viewMode, harmonyData]);

  /**
   * mousemove：计算鼠标在 canvas 中的行列位置，更新 hoverInfo 显示权重值
   * 坐标需按 canvas 内部分辨率与显示尺寸的比例缩放
   */
  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !heatmapData || heatmapData.length === 0) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    const rows = heatmapData.length;
    const cols = heatmapData[0]?.length || 1;
    const cellW = canvas.width / cols;
    const cellH = canvas.height / rows;

    const col = Math.floor(x / cellW);
    const row = Math.floor(y / cellH);

    if (row >= 0 && row < rows && col >= 0 && col < cols) {
      const value = heatmapData[row][col];
      setHoverInfo({ x: e.clientX - rect.left, y: e.clientY - rect.top, value });
    } else {
      setHoverInfo(null);
    }
  };

  const handleMouseLeave = () => setHoverInfo(null);

  return (
    <div className="relative">
      {title && (
        <p className="text-xs font-medium text-ink-500 mb-2 text-center">{title}</p>
      )}

      {/* Phase F1:视图模式切换 - 热力图 / 色彩和谐度环形 */}
      {canShowHarmony && (
        <div className="flex items-center justify-center gap-1 mb-2">
          <span className="text-[10px] text-ink-400 mr-1">视图</span>
          {(['heatmap', 'harmony'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setViewMode(m)}
              className={`px-2 py-0.5 text-[10px] rounded transition-colors ${
                viewMode === m
                  ? 'bg-[#5a8a7a] text-white'
                  : 'bg-rice-100 text-ink-500 hover:bg-rice-200'
              }`}
            >
              {m === 'heatmap' ? '热力图' : '色彩和谐'}
            </button>
          ))}
        </div>
      )}

      {/* 辅助线切换按钮组(仅热力图模式) */}
      {viewMode === 'heatmap' && (
        <div className="flex items-center justify-center gap-1 mb-2">
          <span className="text-[10px] text-ink-400 mr-1">辅助线</span>
          {(['none', 'thirds', 'golden'] as const).map((g) => (
            <button
              key={g}
              onClick={() => setShowGrid(g)}
              className={`px-2 py-0.5 text-[10px] rounded transition-colors ${
                showGrid === g
                  ? 'bg-cinnabar text-white'
                  : 'bg-rice-100 text-ink-500 hover:bg-rice-200'
              }`}
            >
              {g === 'none' ? '无' : g === 'thirds' ? '三分线' : '黄金分割'}
            </button>
          ))}
        </div>
      )}

      {/* canvas + tooltip 容器 */}
      <div className="relative">
        <canvas
          ref={canvasRef}
          width={320}
          height={240}
          className="w-full h-auto rounded-xl border border-ink-100 cursor-crosshair"
          style={{ background: '#fdfcf9' }}
          onMouseMove={viewMode === 'heatmap' ? handleMouseMove : undefined}
          onMouseLeave={viewMode === 'heatmap' ? handleMouseLeave : undefined}
        />
        {/* hover tooltip:仅热力图模式显示该区域视觉权重值 */}
        {viewMode === 'heatmap' && hoverInfo && (
          <div
            className="absolute pointer-events-none z-10 bg-ink-900/90 text-rice-100 text-xs px-2 py-1 rounded-md shadow-overlay whitespace-nowrap font-mono"
            style={{ left: hoverInfo.x + 12, top: hoverInfo.y + 12 }}
          >
            视觉权重: {hoverInfo.value.toFixed(2)}
          </div>
        )}
      </div>

      {/* 透明度滑块(仅热力图模式) */}
      {viewMode === 'heatmap' && (
      <div className="mt-3 flex items-center gap-2">
        <span className="text-[10px] text-ink-400 flex-shrink-0">透明度</span>
        <input
          type="range"
          min="0"
          max="100"
          value={opacity * 100}
          onChange={(e) => setOpacity(Number(e.target.value) / 100)}
          className="flex-1 h-1 bg-ink-900/10 rounded-full appearance-none cursor-pointer"
          style={{ accentColor: '#c41e3a' }}
        />
        <span className="text-[10px] text-ink-400 font-mono tabular-nums w-8 text-right">
          {Math.round(opacity * 100)}%
        </span>
      </div>
      )}

      {/* Legend(仅热力图模式) */}
      {viewMode === 'heatmap' && (
      <div className="flex items-center justify-center gap-2 mt-2">
        <span className="text-[10px] text-ink-400">低</span>
        <div className="flex gap-0.5">
          {['rgba(255,240,220,0.5)', 'rgba(255,200,120,0.6)', 'rgba(255,140,50,0.7)', 'rgba(255,80,30,0.85)', 'rgba(196,30,58,0.95)'].map((c, i) => (
            <div key={i} className="w-6 h-2 rounded-sm" style={{ background: c }} />
          ))}
        </div>
        <span className="text-[10px] text-ink-400">高</span>
      </div>
      )}
    </div>
  );
}
