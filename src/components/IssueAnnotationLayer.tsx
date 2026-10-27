// ============================================================
// 丹青有AI - SVG 叠层标注组件(2026-09-03 Phase 1A 重构)
//
// 职责:
//   在作品预览图上叠加 SVG 绘制 AI 识别的问题区域标注,
//   锚定卡片式:维度色标 + 三级类型(critical/suggestion/highlight)
//   + 编号徽章 + 悬停气泡(why/how/hint)。
//
// 数据契约:src/types/index.ts IssueMarker(x,y,w,h 为 0-1 相对坐标)
// 配色:
//   - 维度色标:构图=石青 / 造型=赭橙 / 明暗=紫 / 色彩=朱砂 / 空间=青 / 技法=金
//     (dimension 缺失时按 severity 兜底:high=朱砂 / medium=金 / low=石青)
//   - highlight(做得好)固定玉色绿色柔和高亮,无编号徽章
// 响应式:ResizeObserver 跟随图片显示尺寸,SVG 以像素坐标重映射(0-1 → px),
//         矢量绘制缩放无损,徽章/文字不变形。
// 交互:
//   - 悬停区域:填充加深 + 气泡(label/维度·严重度/why/how/hint)
//   - 点击区域:onMarkerSelect(index) 回调(供侧栏卡片联动)
//   - activeIndex:联动高亮(描边加粗 + 徽章脉冲)
// 兼容:旧数据(无 type/dimension/why/how)按 severity 兜底映射渲染。
// 无障碍:SVG 加 role="img" aria-label;issueMarkers 为空时返回 null。
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { resolveMarkerType, type IssueMarker } from '../types';

interface IssueAnnotationLayerProps {
  /** 作品图片地址 */
  imageUrl: string;
  /** 问题标注列表(0-1 相对坐标);空或缺失时组件返回 null */
  issueMarkers: IssueMarker[];
  /** 容器附加类名 */
  className?: string;
  /** 内部 img 附加类名(约束显示尺寸,如 max-h-96 object-contain) */
  imgClassName?: string;
  /** 当前联动的标注索引(点击侧栏卡片时高亮图上区域;-1 无) */
  activeIndex?: number;
  /** 点击标注区域回调(供侧栏卡片定位联动) */
  onMarkerSelect?: (index: number) => void;
  /**
   * 编号映射(数组索引 → 徽章号;2026-09-22 标注精度优化)。
   * 调用方(AnnotationWorkspace)传全局编号——维度过滤/联动时编号与侧栏卡片一致;
   * 缺省时组件内部计算:highlight(✦)不占号,critical/suggestion 连续编号,修复编号断档。
   */
  badgeNumbers?: Map<number, number>;
}

/** 维度 → 色标(锚定卡片式标注;Grammarly 式维度分类色) */
const DIMENSION_COLORS: Record<string, string> = {
  构图: '#2e5fa1', // 石青
  造型: '#e07b39', // 赭橙
  明暗: '#7c5cbf', // 紫
  色彩: '#c41e3a', // 朱砂
  空间: '#2e9e9e', // 青
  技法: '#d4af37', // 金
};

/** severity 兜底色(旧数据无 dimension/type 时) */
const SEVERITY_FALLBACK: Record<IssueMarker['severity'], string> = {
  high: '#c41e3a',
  medium: '#d4af37',
  low: '#2e5fa1',
};

/** highlight(做得好)固定色 */
const HIGHLIGHT_COLOR = '#5b8c5a'; // 玉色

/** #rrggbb → rgba(r,g,b,a) */
function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** 标注主色:highlight 固定玉色;其余按维度色标,缺失按 severity 兜底 */
function markerColor(m: IssueMarker): string {
  if (resolveMarkerType(m) === 'highlight') return HIGHLIGHT_COLOR;
  if (m.dimension && DIMENSION_COLORS[m.dimension]) return DIMENSION_COLORS[m.dimension]!;
  return SEVERITY_FALLBACK[m.severity];
}

/** 类型中文标签 */
const TYPE_LABEL: Record<'critical' | 'suggestion' | 'highlight', string> = {
  critical: '关键问题',
  suggestion: '建议改进',
  highlight: '做得好',
};

export default function IssueAnnotationLayer({
  imageUrl,
  issueMarkers,
  className,
  imgClassName,
  activeIndex = -1,
  onMarkerSelect,
  badgeNumbers,
}: IssueAnnotationLayerProps) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  /** 图片显示尺寸(ResizeObserver 跟随,SVG 以像素坐标绘制避免 preserveAspectRatio 拉伸变形) */
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [hoveredIdx, setHoveredIdx] = useState<number>(-1);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // 跟随图片显示尺寸更新 SVG 画布(矢量重映射,缩放无损)
  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    const update = () => setSize({ w: img.clientWidth, h: img.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(img);
    return () => ro.disconnect();
  }, []);

  /** 鼠标移动:计算悬停在哪个 marker 上(0-1 命中测试,按面积小者优先) */
  const handleMouseMove = useCallback(
    (e: ReactMouseEvent<SVGSVGElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const mx = (e.clientX - rect.left) / rect.width;
      const my = (e.clientY - rect.top) / rect.height;

      let hovered = -1;
      let minArea = Infinity;
      for (let i = 0; i < issueMarkers.length; i++) {
        const m = issueMarkers[i]!;
        if (mx >= m.x && mx <= m.x + m.w && my >= m.y && my <= m.y + m.h) {
          const area = m.w * m.h;
          if (area < minArea) {
            minArea = area;
            hovered = i;
          }
        }
      }
      setHoveredIdx(hovered);
      if (hovered >= 0) {
        setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      }
    },
    [issueMarkers],
  );

  const handleMouseLeave = useCallback(() => setHoveredIdx(-1), []);

  // 编号映射:调用方未传时内部计算——highlight(✦)不占号,critical/suggestion 连续编号
  // (2026-09-22 修复:旧版按数组索引编号,highlight 占索引导致图上编号出现 1,2,4 断档)
  const numbers = useMemo(() => {
    if (badgeNumbers) return badgeNumbers;
    const map = new Map<number, number>();
    let n = 0;
    (issueMarkers ?? []).forEach((m, i) => {
      if (resolveMarkerType(m) !== 'highlight') map.set(i, ++n);
    });
    return map;
  }, [badgeNumbers, issueMarkers]);

  // 空或缺失时不渲染(放在所有 hooks 之后,避免条件 hook 调用)
  if (!issueMarkers || issueMarkers.length === 0) return null;
  const { w, h } = size;

  const hoveredMarker = hoveredIdx >= 0 ? issueMarkers[hoveredIdx] : null;
  const ariaLabel = `作品问题标注图,共 ${issueMarkers.length} 处标注区域`;

  return (
    <div className={`relative inline-block max-w-full ${className ?? ''}`}>
      <img
        ref={imgRef}
        src={imageUrl}
        alt="待标注的作品"
        className={`block max-w-full h-auto select-none ${imgClassName ?? ''}`}
        draggable={false}
      />
      <svg
        width={w}
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        className="absolute inset-0"
        role="img"
        aria-label={ariaLabel}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        {w > 0 &&
          h > 0 &&
          issueMarkers.map((m, i) => {
            const color = markerColor(m);
            const type = resolveMarkerType(m);
            const isActive = i === activeIndex;
            const isHovered = i === hoveredIdx;
            const px = m.x * w;
            const py = m.y * h;
            const pw = m.w * w;
            const ph = m.h * h;
            // 聚焦淡化(2026-09-22):默认描边淡显(透明度 0.6)+无填充,悬停/选中全亮,
            // 有焦点时其余标注压得更淡——视线聚焦当前问题,不被满屏框干扰
            const anyFocus = activeIndex >= 0 || hoveredIdx >= 0;
            const isFocus = isActive || isHovered;
            const strokeAlpha = isFocus ? 1 : anyFocus ? 0.22 : 0.6;
            const fillAlpha = isFocus ? 0.16 : 0.03;
            const anchorOpacity = isFocus ? 1 : anyFocus ? 0.45 : 0.9;
            // 编号徽章锚定框左上角(圆心压在角点上,半外置;Frame.io 式定位锚)
            const showBadge = type !== 'highlight';
            const badgeR = 11;
            const badgeX = Math.min(Math.max(px, badgeR + 1), w - badgeR - 1);
            const badgeY = Math.min(Math.max(py, badgeR + 1), h - badgeR - 1);
            const strokeW = type === 'critical' ? 2.5 : type === 'suggestion' ? 1.5 : 1.5;
            const badgeNum = numbers.get(i);

            return (
              <g
                key={i}
                className="cursor-pointer transition-opacity duration-200"
                onClick={() => onMarkerSelect?.(i)}
              >
                <rect
                  x={px}
                  y={py}
                  width={pw}
                  height={ph}
                  rx={6}
                  fill={hexToRgba(color, fillAlpha)}
                  stroke={hexToRgba(color, strokeAlpha)}
                  strokeWidth={isActive ? strokeW + 1.5 : strokeW}
                  strokeDasharray={type === 'suggestion' ? '8 4' : undefined}
                />
                {showBadge && (
                  <g className={isActive ? 'animate-pulse' : undefined} opacity={anchorOpacity}>
                    {/* 触控热区:透明圆扩大点击范围至直径 44px(移动端可用性,spec §3.3),不改变视觉尺寸 */}
                    <circle cx={badgeX} cy={badgeY} r={22} fill="transparent" pointerEvents="all" />
                    <circle cx={badgeX} cy={badgeY} r={badgeR} fill={color} />
                    <text
                      x={badgeX}
                      y={badgeY}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fill="#ffffff"
                      fontSize={13}
                      fontWeight={600}
                      fontFamily='-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif'
                    >
                      {badgeNum ?? ''}
                    </text>
                  </g>
                )}
                {type === 'highlight' && (
                  <text
                    x={px + pw - 8}
                    y={py + 14}
                    textAnchor="end"
                    fill={HIGHLIGHT_COLOR}
                    fontSize={16}
                    fontWeight={700}
                    opacity={anchorOpacity}
                  >
                    ✦
                  </text>
                )}
              </g>
            );
          })}
      </svg>
      {hoveredMarker && (
        <div
          role="tooltip"
          className="absolute z-10 pointer-events-none max-w-[18rem] rounded-lg bg-ink-900/92 text-white text-xs px-3 py-2 shadow-overlay"
          style={{
            left: `${tooltipPos.x}px`,
            top: `${tooltipPos.y}px`,
            transform: 'translate(14px, calc(-100% - 6px))',
          }}
        >
          <p className="font-semibold mb-0.5 flex items-center gap-1.5">
            <span
              className="inline-block w-2 h-2 rounded-full flex-shrink-0"
              style={{ backgroundColor: markerColor(hoveredMarker) }}
            />
            {hoveredMarker.label}
            <span className="text-white/60 font-normal">
              · {hoveredMarker.dimension || ''}
              {hoveredMarker.dimension ? ' · ' : ''}
              {TYPE_LABEL[resolveMarkerType(hoveredMarker)]}
            </span>
          </p>
          {hoveredMarker.why && (
            <p className="leading-relaxed text-white/85 mb-1">
              <span className="text-gold-light">原理</span> {hoveredMarker.why}
            </p>
          )}
          {hoveredMarker.how && (
            <p className="leading-relaxed text-white/85">
              <span className="text-jade">改法</span> {hoveredMarker.how}
            </p>
          )}
          {!hoveredMarker.why && !hoveredMarker.how && (
            <p className="leading-relaxed text-white/85">{hoveredMarker.improvementHint}</p>
          )}
          {/* Phase 3 批次④:第④层"参考"提示行(reference 缺失不渲染)。
              气泡 pointer-events-none,点击穿透至标注区域 → 触发既有
              onMarkerSelect 联动(侧栏卡片展开显示完整参考区块与入口) */}
          {hoveredMarker.reference && (
            <p className="leading-relaxed text-jade pt-1 mt-1 border-t border-white/15">
              <span aria-hidden>✦ </span>参考 · {hoveredMarker.reference.teaser}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export { DIMENSION_COLORS, HIGHLIGHT_COLOR, TYPE_LABEL, markerColor };
