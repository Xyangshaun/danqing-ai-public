// ============================================================
// 简洁摘要卡片 PNG 导出(原生 Canvas 2D,零第三方依赖)
// 与 SummaryTemplate 的 DOM 布局保持同构
// ============================================================

import type { ReportViewModel } from './reportTypes';
import { scoreColor } from './ScoreRing';

/* 设计常量(逻辑像素,实际渲染 ×2 保证清晰度) */
const W = 750;
const PAD = 40;
const SCALE = 2;

const C = {
  bg: '#f9f6f0',
  card: '#ffffff',
  ink: '#0f0f0f',
  inkMid: '#595959',
  inkLight: '#a3a3a3',
  line: '#e0d9c9',
  cinnabar: '#c41e3a',
  jade: '#5b8c5a',
  gold: '#d4af37',
  stone: '#2e5fa1',
};

const SERIF = '"Noto Serif SC","Songti SC","SimSun",serif';
const SANS = '"PingFang SC","Microsoft YaHei",sans-serif';

const PRIORITY_COLOR: Record<string, string> = {
  high: C.cinnabar,
  medium: C.gold,
  low: C.jade,
};

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** 圆角矩形路径 */
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** CJK 友好文本换行(逐字测量) */
function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const lines: string[] = [];
  let line = '';
  for (const ch of text) {
    if (ch === '\n' || ctx.measureText(line + ch).width > maxWidth) {
      lines.push(line);
      line = ch === '\n' ? '' : ch;
      if (lines.length >= maxLines) break;
    } else {
      line += ch;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  // 超出截断加省略号
  if (lines.length === maxLines && line && lines[maxLines - 1] !== line) {
    const last = lines[maxLines - 1]!;
    lines[maxLines - 1] = last.slice(0, Math.max(0, last.length - 1)) + '…';
  }
  return lines;
}

/** 总分环(批次⑤:score 为 null 时绘制空环 + "—",不以 0 分假显示) */
function drawScoreRing(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, r: number, score: number | null,
): void {
  const hasScore = score !== null;
  const clamped = hasScore ? Math.max(0, Math.min(100, score)) : 0;
  const lw = 12;
  // 底环
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = C.line;
  ctx.lineWidth = lw;
  ctx.stroke();
  // 分数环(未评分时不绘制)
  if (hasScore) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * clamped) / 100);
    ctx.strokeStyle = scoreColor(clamped);
    ctx.lineWidth = lw;
    ctx.lineCap = 'round';
    ctx.stroke();
  }
  // 中心文字
  ctx.fillStyle = C.ink;
  ctx.font = `700 ${Math.round(r * 0.62)}px ${SERIF}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(hasScore ? String(Math.round(clamped)) : '—', cx, cy - r * 0.08);
  ctx.fillStyle = C.inkLight;
  ctx.font = `${Math.round(r * 0.2)}px ${SANS}`;
  ctx.fillText(hasScore ? '总分' : '未评分', cx, cy + r * 0.42);
}

/** 迷你雷达图(n 边形,≥3 维) */
function drawRadar(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, r: number,
  points: { label: string; score: number }[],
): void {
  const n = points.length;
  if (n < 3) return;
  const angleAt = (i: number) => -Math.PI / 2 + (Math.PI * 2 * i) / n;
  const pt = (i: number, ratio: number): [number, number] => [
    cx + Math.cos(angleAt(i)) * r * ratio,
    cy + Math.sin(angleAt(i)) * r * ratio,
  ];

  // 同心环 25/50/75/100
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 1;
  for (const ratio of [0.25, 0.5, 0.75, 1]) {
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const [x, y] = pt(i % n, ratio);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // 轴线
  for (let i = 0; i < n; i++) {
    const [x, y] = pt(i, 1);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(x, y);
    ctx.stroke();
  }
  // 数据多边形
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const p = points[i % n]!;
    const [x, y] = pt(i % n, Math.max(0, Math.min(100, p.score)) / 100);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = 'rgba(196,30,58,0.22)';
  ctx.fill();
  ctx.strokeStyle = C.cinnabar;
  ctx.lineWidth = 2;
  ctx.stroke();
  // 顶点
  for (let i = 0; i < n; i++) {
    const p = points[i]!;
    const [x, y] = pt(i, Math.max(0, Math.min(100, p.score)) / 100);
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fillStyle = C.cinnabar;
    ctx.fill();
  }
  // 标签
  ctx.fillStyle = C.inkMid;
  ctx.font = `13px ${SANS}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < n; i++) {
    const [x, y] = pt(i, 1.22);
    ctx.fillText(points[i]!.label, x, y);
  }
}

/**
 * 渲染摘要卡片到 Canvas 并触发 PNG 下载
 * @returns 是否成功(图片加载失败不视为失败,缩略图区域留白)
 */
export async function exportSummaryImage(vm: ReportViewModel): Promise<boolean> {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;

  const thumb = vm.imageUrl ? await loadImage(vm.imageUrl) : null;

  /* 先按内容计算高度:头部 150 + 核心区 240 + 建议区动态 + 页脚 60 */
  const suggestions = vm.suggestions.slice(0, 3);
  const SUG_LINE_H = 20;
  const suggestionRows = suggestions.map((s) => {
    // 以 14px 字体测量换行(chip 宽 52 + 间距)
    const probe = document.createElement('canvas').getContext('2d');
    let lines = 1;
    if (probe) {
      probe.font = `14px ${SANS}`;
      lines = wrapText(probe, s.content, W - PAD * 2 - 90, 2).length;
    }
    return { item: s, lines };
  });
  const suggHeight =
    suggestions.length > 0
      ? 28 + suggestionRows.reduce((sum, r) => sum + 16 + r.lines * SUG_LINE_H + 14, 0)
      : 0;
  const H = 150 + 240 + suggHeight + 70;

  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  ctx.scale(SCALE, SCALE);

  /* 背景 + 卡片 */
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  // 顶部朱砂条
  ctx.fillStyle = C.cinnabar;
  ctx.fillRect(0, 0, W, 6);

  let y = 6 + 28;

  /* 品牌行 */
  // 朱砂方章
  roundRect(ctx, PAD, y, 44, 44, 10);
  ctx.fillStyle = C.cinnabar;
  ctx.fill();
  ctx.fillStyle = '#fdfcf9';
  ctx.font = `700 24px ${SERIF}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('丹', PAD + 22, y + 23);
  // 品牌名 + 日期
  ctx.textAlign = 'left';
  ctx.fillStyle = C.ink;
  ctx.font = `700 17px ${SERIF}`;
  ctx.fillText('丹青有AI · 创作诊断', PAD + 58, y + 16);
  ctx.fillStyle = C.inkLight;
  ctx.font = `12px ${SANS}`;
  ctx.fillText(vm.dateLabel, PAD + 58, y + 36);
  // 类型标签(右)
  ctx.font = `12px ${SANS}`;
  const typeW = ctx.measureText(vm.artTypeLabel).width + 24;
  roundRect(ctx, W - PAD - typeW, y + 8, typeW, 28, 14);
  ctx.fillStyle = 'rgba(15,15,15,0.05)';
  ctx.fill();
  ctx.fillStyle = C.inkMid;
  ctx.textAlign = 'center';
  ctx.fillText(vm.artTypeLabel, W - PAD - typeW / 2, y + 23);
  ctx.textAlign = 'left';

  y += 44 + 22;

  /* 作品标题 */
  ctx.fillStyle = C.ink;
  ctx.font = `700 26px ${SERIF}`;
  ctx.fillText(vm.title, PAD, y + 10);
  y += 26 + 20;

  /* 核心区:缩略图 | 总分环 | 迷你雷达(240 高) */
  const coreH = 200;
  const coreY = y + 8;
  // 缩略图(左 1/3,cover-fit 到 190×160)
  if (thumb) {
    const boxW = 200, boxH = 160;
    const scale = Math.max(boxW / thumb.width, boxH / thumb.height);
    const dw = thumb.width * scale;
    const dh = thumb.height * scale;
    ctx.save();
    roundRect(ctx, PAD, coreY + 10, boxW, boxH, 10);
    ctx.clip();
    ctx.fillStyle = C.card;
    ctx.fillRect(PAD, coreY + 10, boxW, boxH);
    ctx.drawImage(thumb, PAD + (boxW - dw) / 2, coreY + 10 + (boxH - dh) / 2, dw, dh);
    ctx.restore();
    ctx.strokeStyle = 'rgba(15,15,15,0.08)';
    ctx.lineWidth = 1;
    roundRect(ctx, PAD, coreY + 10, boxW, boxH, 10);
    ctx.stroke();
  }
  // 总分环(中)
  drawScoreRing(ctx, W / 2, coreY + coreH / 2, 62, vm.overallScore);
  // 雷达(右)
  const radarPoints = vm.radar.map((r) => ({ label: r.label, score: r.score }));
  drawRadar(ctx, W - PAD - 105, coreY + coreH / 2 - 4, 66, radarPoints);

  y = coreY + coreH + 16;

  /* TOP3 建议 */
  if (suggestions.length > 0) {
    ctx.fillStyle = C.inkLight;
    ctx.font = `12px ${SANS}`;
    ctx.fillText('核心建议', PAD, y);
    y += 20;
    for (const { item, lines } of suggestionRows) {
      const rowH = 16 + lines * SUG_LINE_H;
      // 行底卡
      roundRect(ctx, PAD, y, W - PAD * 2, rowH, 8);
      ctx.fillStyle = C.card;
      ctx.fill();
      ctx.strokeStyle = 'rgba(15,15,15,0.06)';
      ctx.stroke();
      // 优先级 chip
      const pc = PRIORITY_COLOR[item.priority] ?? C.gold;
      ctx.font = `11px ${SANS}`;
      const chipTextW = ctx.measureText(item.priorityLabel).width;
      roundRect(ctx, PAD + 10, y + 10, chipTextW + 14, 20, 10);
      ctx.fillStyle = `${pc}1f`;
      ctx.fill();
      ctx.fillStyle = pc;
      ctx.textAlign = 'center';
      ctx.fillText(item.priorityLabel, PAD + 10 + (chipTextW + 14) / 2, y + 20.5);
      ctx.textAlign = 'left';
      // 正文(换行)
      ctx.fillStyle = C.inkMid;
      ctx.font = `14px ${SANS}`;
      const textLines = wrapText(ctx, item.content, W - PAD * 2 - 90, 2);
      textLines.forEach((ln, li) => {
        ctx.fillText(ln, PAD + 10 + chipTextW + 32, y + 21 + li * SUG_LINE_H);
      });
      y += rowH + 14;
    }
  }

  /* 页脚 */
  y = H - 42;
  ctx.strokeStyle = 'rgba(15,15,15,0.08)';
  ctx.beginPath();
  ctx.moveTo(PAD, y);
  ctx.lineTo(W - PAD, y);
  ctx.stroke();
  ctx.fillStyle = C.inkLight;
  ctx.font = `12px ${SANS}`;
  ctx.fillText('丹青有AI · www.danqing.site', PAD, y + 24);
  ctx.textAlign = 'right';
  ctx.fillText('查看完整报告请登录平台', W - PAD, y + 24);

  /* 导出下载 */
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      if (!blob) return resolve(false);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `丹青有AI-诊断卡片-${vm.title.slice(0, 20)}-${Date.now()}.png`;
      a.click();
      URL.revokeObjectURL(url);
      resolve(true);
    }, 'image/png');
  });
}
