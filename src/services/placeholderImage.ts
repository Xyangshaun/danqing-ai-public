// ============================================================
// 丹青有AI - 占位图工具
// ------------------------------------------------------------
// 设计目标:替换原 `trae-api-cn.mchost.guru` IDE 内部图片 API,
// 该 URL 在生产部署后无法访问(仅在 Trae IDE 沙箱内可用)。
// 改为本地生成内联 SVG data URI,零外部依赖,任意网络可正常显示。
//
// 视觉风格:水印朱印 + 水墨晕染感,贴合项目"水墨色系"主题。
// 同一 seed 始终生成同一图(确定性),用作缓存键。
// ============================================================

/** 占位图支持的尺寸 */
export type PlaceholderSize =
  | 'square'
  | 'square_hd'
  | 'portrait_4_3'
  | 'portrait_16_9'
  | 'landscape_4_3'
  | 'landscape_16_9';

/** 项目主题色板(对齐 tailwind.config 的 ink/cinnabar/jade/qinglv) */
const PALETTE = [
  { bg: '#f5f2eb', ink: '#1a1a1a', accent: '#c41e3a' }, // 默认宣纸 + 朱砂
  { bg: '#ede8db', ink: '#1a1a1a', accent: '#2e5fa1' }, // 青绿
  { bg: '#f0ebe0', ink: '#1a1a1a', accent: '#5b8c5a' }, // 翡翠
  { bg: '#ede4d3', ink: '#1a1a1a', accent: '#d4af37' }, // 金碧
  { bg: '#f2e8e8', ink: '#1a1a1a', accent: '#6b3fa0' }, // 紫禁
  { bg: '#efe9e0', ink: '#1a1a1a', accent: '#8b5a2b' }, // 赭石
];

/** 简单字符串 hash(djb2),返回 32 位无符号整数 */
function hashSeed(seed: string): number {
  let h = 5381;
  for (let i = 0; i < seed.length; i++) {
    h = ((h << 5) + h + seed.charCodeAt(i)) >>> 0;
  }
  return h;
}

/** 根据 size 名称返回 [width, height] */
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

/** 将标题截断到适合显示的长度(SVG 文本换行不易,简单截断) */
function truncateTitle(title: string, maxLen: number): string {
  const trimmed = title.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return trimmed.slice(0, maxLen - 1) + '…';
}

/** XML 实体转义 */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * 生成内联 SVG data URI 占位图
 *
 * @param seed 确定性种子(如作品标题 / prompt 文本)
 * @param opts.size 输出尺寸,默认 landscape_4_3
 * @param opts.title 显示在图中央的标题(可选,默认用 seed)
 * @param opts.subtitle 副标题(可选)
 */
export function placeholderImage(
  seed: string,
  opts: { size?: PlaceholderSize; title?: string; subtitle?: string } = {}
): string {
  const size = opts.size ?? 'landscape_4_3';
  const [w, h] = sizeToDimensions(size);
  const hash = hashSeed(seed || 'default');
  const palette = PALETTE[hash % PALETTE.length];
  const accent = palette.accent;
  const bg = palette.bg;

  // 基于种子派生装饰元素参数(确定性)
  const dotR = 12 + (hash % 24); // 主朱印半径
  const dotX = w - dotR - 18;
  const dotY = dotR + 18;
  const blob1X = (hash % 100) / 100 * w;
  const blob1Y = (hash % 73) / 73 * h;
  const blob2X = ((hash >> 8) % 100) / 100 * w;
  const blob2Y = ((hash >> 8) % 71) / 71 * h;

  const title = escapeXml(truncateTitle(opts.title ?? seed, 14));
  const subtitle = opts.subtitle ? escapeXml(truncateTitle(opts.subtitle, 24)) : '';

  // 文本字号根据画布宽度自适应
  const titleFontSize = Math.min(28, Math.max(18, Math.floor(w / 18)));
  const subFontSize = Math.max(11, Math.floor(titleFontSize * 0.55));

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${bg}"/>
      <stop offset="100%" stop-color="${bg}" stop-opacity="0.85"/>
    </linearGradient>
    <radialGradient id="blob1" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${accent}" stop-opacity="0.16"/>
      <stop offset="100%" stop-color="${accent}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="blob2" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#1a1a1a" stop-opacity="0.08"/>
      <stop offset="100%" stop-color="#1a1a1a" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#bg)"/>
  <circle cx="${blob1X}" cy="${blob1Y}" r="${Math.floor(Math.max(w, h) * 0.4)}" fill="url(#blob1)"/>
  <circle cx="${blob2X}" cy="${blob2Y}" r="${Math.floor(Math.max(w, h) * 0.35)}" fill="url(#blob2)"/>
  <g opacity="0.95">
    <circle cx="${dotX}" cy="${dotY}" r="${dotR}" fill="${accent}" opacity="0.92"/>
    <text x="${dotX}" y="${dotY + 1}" font-family="Songti SC,SimSun,serif" font-size="${Math.floor(dotR * 0.95)}" fill="${bg}" text-anchor="middle" dominant-baseline="middle" font-weight="600">丹</text>
  </g>
  <text x="${w / 2}" y="${h / 2}" font-family="Songti SC,SimSun,STSong,serif" font-size="${titleFontSize}" fill="#1a1a1a" text-anchor="middle" dominant-baseline="middle" font-weight="500">${title}</text>
  ${subtitle ? `<text x="${w / 2}" y="${h / 2 + titleFontSize * 0.95}" font-family="-apple-system,BlinkMacSystemFont,PingFang SC,Microsoft YaHei,sans-serif" font-size="${subFontSize}" fill="#1a1a1a" opacity="0.55" text-anchor="middle" dominant-baseline="middle">${subtitle}</text>` : ''}
  <rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" fill="none" stroke="#1a1a1a" stroke-opacity="0.06" stroke-width="1"/>
</svg>`;

  // URI encode for data: scheme (use # for # char to avoid escape)
  // 注意: encodeURIComponent 会把 <> 都转义,体积膨胀 3x;改用 # 安全子集
  const encoded = svg
    .replace(/"/g, "'")
    .replace(/%/g, '%25')
    .replace(/#/g, '%23')
    .replace(/</g, '%3C')
    .replace(/>/g, '%3E')
    .replace(/&/g, '%26'); // & 必须最后替换,避免重复转义
  return `data:image/svg+xml,${encoded}`;
}

export default placeholderImage;
