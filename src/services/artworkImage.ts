// ============================================================
// 丹青有AI - 艺术作品缩略图生成器
// ------------------------------------------------------------
// 目标:替代原文字占位图,为 9999+ 素材生成"看起来像作品"的
// 视觉化 SVG 缩略图。纯前端计算、零外部依赖、零服务器内存占用。
//
// 设计原则:
//   1. 确定性:相同 seed + category + style 始终生成同一图案
//   2. 按创作形式区分视觉语言(绘画/设计/产品/雕塑/书法/建筑)
//   3. SVG data URI 内联,无需网络请求,首屏即渲染
//   4. 体积小:单张 SVG 约 1-3KB,9999 张按需生成,不预生成文件
// ============================================================

export type ArtworkCategory =
  | 'painting'
  | 'design'
  | 'product'
  | 'sculpture'
  | 'calligraphy'
  | 'architecture'
  | 'heritage';

export type PlaceholderSize =
  | 'square'
  | 'square_hd'
  | 'portrait_4_3'
  | 'portrait_16_9'
  | 'landscape_4_3'
  | 'landscape_16_9';

interface ThumbnailOpts {
  size?: PlaceholderSize;
  title?: string;
  subtitle?: string;
  category?: ArtworkCategory;
  style?: string;
}

/** 主题色板(与 tailwind.config 对齐) */
const PALETTES: Record<ArtworkCategory, string[]> = {
  painting: ['#f5f2eb', '#1a1a1a', '#c41e3a', '#2e5fa1', '#5b8c5a', '#d4af37'],
  design: ['#f9f6f0', '#0f0f0f', '#c41e3a', '#2e5fa1', '#f5f2eb'],
  product: ['#f5f2eb', '#595959', '#8b5a2b', '#2e5fa1', '#5b8c5a'],
  sculpture: ['#e5e5e5', '#404040', '#8b5a2b', '#1a1a1a', '#a8862a'],
  calligraphy: ['#fdfcf9', '#0f0f0f', '#c41e3a', '#2d2d2d'],
  architecture: ['#f5f2eb', '#404040', '#2e5fa1', '#d4af37', '#1a1a1a'],
  heritage: ['#f5ede0', '#3d2b1f', '#c41e3a', '#d4af37', '#8b5a2b', '#2e5fa1'],
};

function sizeToDimensions(size: PlaceholderSize): [number, number] {
  switch (size) {
    case 'square': return [400, 400];
    case 'square_hd': return [400, 400];
    case 'portrait_4_3': return [400, 533];
    case 'portrait_16_9': return [360, 640];
    case 'landscape_4_3': return [533, 400];
    case 'landscape_16_9': return [640, 360];
    default: return [400, 400];
  }
}

/** djb2 hash */
function hashSeed(seed: string): number {
  let h = 5381;
  for (let i = 0; i < seed.length; i++) {
    h = ((h << 5) + h + seed.charCodeAt(i)) >>> 0;
  }
  return h;
}

/** 伪随机生成器(由 seed 决定) */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function truncateTitle(title: string, maxLen: number): string {
  const trimmed = title.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return trimmed.slice(0, maxLen - 1) + '…';
}

/** 生成绘画类水墨/抽象图案 */
function paintingPattern(rand: () => number, w: number, h: number, colors: string[]): string {
  const [bg, ink, accent, stone, jade, gold] = colors;
  let shapes = '';
  // 背景晕染
  for (let i = 0; i < 5; i++) {
    const cx = rand() * w;
    const cy = rand() * h;
    const r = 80 + rand() * 180;
    const col = [bg, ink, stone, jade, gold][Math.floor(rand() * 5)];
    shapes += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="${col}" opacity="${(0.08 + rand() * 0.12).toFixed(2)}"/>`;
  }
  // 山脉/笔触层
  for (let i = 0; i < 4; i++) {
    const yBase = h * (0.35 + i * 0.18);
    let d = `M 0 ${yBase.toFixed(1)}`;
    for (let x = 0; x <= w; x += 20) {
      const y = yBase - (rand() * 40 + Math.sin(x / 60 + i) * 30);
      d += ` L ${x} ${y.toFixed(1)}`;
    }
    d += ` L ${w} ${h} L 0 ${h} Z`;
    const fill = i % 2 === 0 ? ink : stone;
    shapes += `<path d="${d}" fill="${fill}" opacity="${(0.12 + i * 0.08).toFixed(2)}"/>`;
  }
  // 朱砂印章
  const sealR = 16 + rand() * 12;
  const sealX = w - sealR - 24;
  const sealY = h - sealR - 24;
  shapes += `<circle cx="${sealX.toFixed(1)}" cy="${sealY.toFixed(1)}" r="${sealR.toFixed(1)}" fill="${accent}" opacity="0.85"/>`;
  shapes += `<text x="${sealX.toFixed(1)}" y="${(sealY + 1).toFixed(1)}" font-family="Songti SC,serif" font-size="${(sealR * 0.9).toFixed(1)}" fill="${bg}" text-anchor="middle" dominant-baseline="middle">丹</text>`;
  return shapes;
}

/** 生成设计类几何图案 */
function designPattern(rand: () => number, w: number, h: number, colors: string[]): string {
  const [bg, ink, accent, stone] = colors;
  let shapes = `<rect width="${w}" height="${h}" fill="${bg}"/>`;
  // 网格
  const cols = 4 + Math.floor(rand() * 4);
  const cell = w / cols;
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < Math.ceil(h / cell); j++) {
      if (rand() > 0.55) {
        const fill = rand() > 0.6 ? accent : rand() > 0.5 ? stone : ink;
        shapes += `<rect x="${(i * cell + 2).toFixed(1)}" y="${(j * cell + 2).toFixed(1)}" width="${(cell - 4).toFixed(1)}" height="${(cell - 4).toFixed(1)}" fill="${fill}" opacity="${(0.7 + rand() * 0.25).toFixed(2)}"/>`;
      }
    }
  }
  return shapes;
}

/** 生成产品类器物轮廓 */
function productPattern(_rand: () => number, w: number, h: number, colors: string[]): string {
  const [, , accent, stone, jade] = colors;
  let shapes = '';
  shapes += `<ellipse cx="${(w * 0.5).toFixed(1)}" cy="${(h * 0.55).toFixed(1)}" rx="${(w * 0.28).toFixed(1)}" ry="${(h * 0.22).toFixed(1)}" fill="${jade}" opacity="0.85"/>`;
  shapes += `<ellipse cx="${(w * 0.42).toFixed(1)}" cy="${(h * 0.48).toFixed(1)}" rx="${(w * 0.12).toFixed(1)}" ry="${(h * 0.08).toFixed(1)}" fill="#ffffff" opacity="0.35"/>`;
  shapes += `<rect x="${(w * 0.35).toFixed(1)}" y="${(h * 0.78).toFixed(1)}" width="${(w * 0.3).toFixed(1)}" height="${(h * 0.04).toFixed(1)}" fill="${stone}" opacity="0.6" rx="2"/>`;
  shapes += `<circle cx="${(w * 0.5).toFixed(1)}" cy="${(h * 0.55).toFixed(1)}" r="${(Math.min(w, h) * 0.06).toFixed(1)}" fill="${accent}" opacity="0.5"/>`;
  return shapes;
}

/** 生成雕塑类有机体 */
function sculpturePattern(rand: () => number, w: number, h: number, colors: string[]): string {
  const [, ink, accent, , gold] = colors;
  let shapes = '';
  // 台座
  shapes += `<rect x="${(w * 0.25).toFixed(1)}" y="${(h * 0.78).toFixed(1)}" width="${(w * 0.5).toFixed(1)}" height="${(h * 0.08).toFixed(1)}" fill="${ink}" opacity="0.7"/>`;
  // 螺旋/层叠椭圆
  for (let i = 0; i < 30; i++) {
    const t = i / 30;
    const cx = w * 0.5 + Math.sin(t * 8) * (w * 0.12 * (1 - t));
    const cy = h * 0.78 - t * h * 0.5;
    const rx = w * 0.1 * (1 - t * 0.5);
    const ry = h * 0.06 * (1 - t * 0.5);
    const fill = i % 3 === 0 ? gold : ink;
    shapes += `<ellipse cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" rx="${rx.toFixed(1)}" ry="${ry.toFixed(1)}" fill="${fill}" opacity="${(0.5 + rand() * 0.3).toFixed(2)}"/>`;
  }
  shapes += `<circle cx="${(w * 0.75).toFixed(1)}" cy="${(h * 0.25).toFixed(1)}" r="${(Math.min(w, h) * 0.08).toFixed(1)}" fill="${accent}" opacity="0.2"/>`;
  return shapes;
}

/** 生成书法类流动线条 */
function calligraphyPattern(rand: () => number, w: number, h: number, colors: string[]): string {
  const [bg, ink, accent] = colors;
  let shapes = `<rect width="${w}" height="${h}" fill="${bg}"/>`;
  for (let i = 0; i < 7; i++) {
    let d = `M ${(rand() * w * 0.2).toFixed(1)} ${(h * (0.2 + i * 0.1)).toFixed(1)}`;
    for (let k = 1; k <= 6; k++) {
      d += ` Q ${(rand() * w).toFixed(1)} ${(rand() * h).toFixed(1)} ${(w * k / 6).toFixed(1)} ${(h * (0.2 + i * 0.1) + (rand() - 0.5) * 40).toFixed(1)}`;
    }
    shapes += `<path d="${d}" stroke="${i === 2 ? accent : ink}" stroke-width="${(4 + rand() * 6).toFixed(1)}" fill="none" opacity="${(0.7 + rand() * 0.25).toFixed(2)}" stroke-linecap="round"/>`;
  }
  return shapes;
}

/** 生成建筑类结构 */
function architecturePattern(rand: () => number, w: number, h: number, colors: string[]): string {
  const [bg, ink, stone, gold] = colors;
  let shapes = `<rect width="${w}" height="${h}" fill="${bg}"/>`;
  // 天空
  shapes += `<rect x="0" y="0" width="${w}" height="${(h * 0.45).toFixed(1)}" fill="${stone}" opacity="0.15"/>`;
  // 建筑主体
  const bw = w * (0.2 + rand() * 0.25);
  const bh = h * (0.35 + rand() * 0.25);
  const bx = (w - bw) / 2;
  const by = h - bh;
  shapes += `<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" fill="${ink}" opacity="0.8"/>`;
  // 窗户
  const rows = 3 + Math.floor(rand() * 3);
  const cols = 2 + Math.floor(rand() * 2);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const wx = bx + bw * (c + 0.5) / (cols + 1) - bw * 0.04;
      const wy = by + bh * (r + 0.5) / (rows + 1) - bh * 0.04;
      shapes += `<rect x="${wx.toFixed(1)}" y="${wy.toFixed(1)}" width="${(bw * 0.08).toFixed(1)}" height="${(bh * 0.08).toFixed(1)}" fill="${gold}" opacity="0.7"/>`;
    }
  }
  // 屋顶
  shapes += `<polygon points="${(bx - bw * 0.1).toFixed(1)},${by.toFixed(1)} ${(bx + bw / 2).toFixed(1)},${(by - h * 0.15).toFixed(1)} ${(bx + bw * 1.1).toFixed(1)},${by.toFixed(1)}" fill="${stone}" opacity="0.9"/>`;
  return shapes;
}

/** 生成非遗类传统纹样(回纹边框+团花+云纹+印章) */
function heritagePattern(rand: () => number, w: number, h: number, colors: string[]): string {
  const [bg, ink, cinnabar, gold, ochre] = colors;
  let shapes = `<rect width="${w}" height="${h}" fill="${bg}"/>`;
  // 回纹边框
  const bw = 8;
  shapes += `<rect x="${bw}" y="${bw}" width="${w - 2 * bw}" height="${h - 2 * bw}" fill="none" stroke="${gold}" stroke-width="1.5" opacity="0.5"/>`;
  shapes += `<rect x="${bw + 4}" y="${bw + 4}" width="${w - 2 * (bw + 4)}" height="${h - 2 * (bw + 4)}" fill="none" stroke="${ink}" stroke-width="0.8" opacity="0.3"/>`;
  // 团花(中心装饰)
  const fcx = w / 2;
  const fcy = h * 0.42;
  const fr = Math.min(w, h) * (0.12 + rand() * 0.06);
  const petals = 6 + Math.floor(rand() * 3);
  for (let i = 0; i < petals; i++) {
    const angle = (i / petals) * Math.PI * 2;
    const px = fcx + Math.cos(angle) * fr;
    const py = fcy + Math.sin(angle) * fr;
    shapes += `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${(fr * 0.4).toFixed(1)}" fill="${i % 2 === 0 ? cinnabar : gold}" opacity="${(0.5 + rand() * 0.3).toFixed(2)}"/>`;
  }
  shapes += `<circle cx="${fcx.toFixed(1)}" cy="${fcy.toFixed(1)}" r="${(fr * 0.3).toFixed(1)}" fill="${ink}" opacity="0.7"/>`;
  // 云纹(两侧装饰)
  for (let i = 0; i < 3; i++) {
    const cy = h * (0.2 + i * 0.2);
    const cx = i % 2 === 0 ? w * 0.15 : w * 0.85;
    let d = `M ${cx.toFixed(1)} ${cy.toFixed(1)}`;
    for (let k = 0; k < 3; k++) {
      const r = 8 + rand() * 12;
      d += ` a ${r.toFixed(1)} ${r.toFixed(1)} 0 1 ${k % 2} ${(r * 1.5).toFixed(1)} 0`;
    }
    shapes += `<path d="${d}" stroke="${ochre}" stroke-width="1.5" fill="none" opacity="${(0.3 + rand() * 0.3).toFixed(2)}"/>`;
  }
  // 印章(右下角红色方块)
  const sx = w - 50;
  const sy = h - 62;
  shapes += `<rect x="${sx}" y="${sy}" width="22" height="22" fill="${cinnabar}" opacity="0.85" rx="2"/>`;
  shapes += `<text x="${sx + 11}" y="${sy + 16}" font-family="serif" font-size="12" fill="#fdfcf9" text-anchor="middle" opacity="0.8">印</text>`;
  return shapes;
}

const PATTERN_GENERATORS: Record<ArtworkCategory, (rand: () => number, w: number, h: number, colors: string[]) => string> = {
  painting: paintingPattern,
  design: designPattern,
  product: productPattern,
  sculpture: sculpturePattern,
  calligraphy: calligraphyPattern,
  architecture: architecturePattern,
  heritage: heritagePattern,
};

/**
 * 生成艺术作品缩略图 SVG data URI
 *
 * @param seed 确定性种子
 * @param opts.size 输出尺寸
 * @param opts.title 标题(显示在底部)
 * @param opts.subtitle 副标题
 * @param opts.category 创作形式,决定视觉语言
 * @param opts.style 风格流派,影响配色倾向
 */
export function artworkImage(
  seed: string,
  opts: ThumbnailOpts = {}
): string {
  const size = opts.size ?? 'landscape_4_3';
  const [w, h] = sizeToDimensions(size);
  const category: ArtworkCategory = opts.category ?? 'painting';
  const seedStr = `${seed}|${category}|${opts.style ?? ''}`;
  const hash = hashSeed(seedStr);
  const rand = rng(hash);
  const baseColors = PALETTES[category];
  // 按 style 微调色板顺序
  const styleHash = hashSeed(opts.style ?? '');
  const rotated = [...baseColors.slice(styleHash % baseColors.length), ...baseColors.slice(0, styleHash % baseColors.length)];

  const title = escapeXml(truncateTitle(opts.title ?? seed, 12));
  const subtitle = opts.subtitle ? escapeXml(truncateTitle(opts.subtitle, 22)) : '';

  const pattern = PATTERN_GENERATORS[category](rand, w, h, rotated);
  const overlayOpacity = 0.35;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="vignette" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#000" stop-opacity="0"/>
      <stop offset="70%" stop-color="#000" stop-opacity="0"/>
      <stop offset="100%" stop-color="#000" stop-opacity="${overlayOpacity}"/>
    </linearGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="${rotated[0]}"/>
  ${pattern}
  <rect width="${w}" height="${h}" fill="url(#vignette)"/>
  <rect x="0" y="${h - 48}" width="${w}" height="48" fill="#0f0f0f" opacity="0.45"/>
  <text x="${w / 2}" y="${h - 22}" font-family="Noto Serif SC,Songti SC,SimSun,serif" font-size="16" fill="#fdfcf9" text-anchor="middle" dominant-baseline="middle" font-weight="500">${title}</text>
  ${subtitle ? `<text x="${w / 2}" y="${h - 8}" font-family="PingFang SC,Microsoft YaHei,sans-serif" font-size="10" fill="#fdfcf9" opacity="0.75" text-anchor="middle" dominant-baseline="middle">${subtitle}</text>` : ''}
</svg>`;

  const encoded = svg
    .replace(/"/g, "'")
    .replace(/%/g, '%25')
    .replace(/#/g, '%23')
    .replace(/</g, '%3C')
    .replace(/>/g, '%3E')
    .replace(/&/g, '%26');
  return `data:image/svg+xml,${encoded}`;
}

export default artworkImage;
