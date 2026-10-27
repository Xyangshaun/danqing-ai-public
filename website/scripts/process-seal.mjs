// 一次性脚本:将 seal-carved-v1.jpg 白底去除并裁剪,输出多尺寸透明 PNG
// 运行:cd website && node scripts/process-seal.mjs
// 用法说明:洪泛填充(从四边向内)只清除与边缘连通的白色背景,
//          印章内部的白色"丹青"字样不受影响;边缘做半透明抗锯齿。
import sharp from 'sharp';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = join(ROOT, '决赛材料', 'logo', 'seal-carved-v1.jpg');
const OUT = {
  appAsset: join(ROOT, 'src', 'assets', 'logo-seal.png'),
  webPublic: join(ROOT, 'website', 'public', 'images', 'logo-seal.png'),
  appPublic: join(ROOT, 'public', 'images', 'logo-seal.png'),
  favicon48: join(ROOT, 'public', 'favicon.png'),
  favicon32: join(ROOT, 'public', 'favicon-32.png'),
};

const { data, info } = await sharp(SRC).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: W, height: H } = info;
const px = (x, y) => (y * W + x) * 3;
const minCh = (i) => Math.min(data[i], data[i + 1], data[i + 2]);

// 1) 洪泛填充:从边界出发,把连通的近白区域标记为背景
const NEAR_WHITE = 232; // min(r,g,b) >= 232 视为纸面白
const isBg = new Uint8Array(W * H);
const stack = [];
for (let x = 0; x < W; x++) { stack.push(x, 0, x, H - 1); }
for (let y = 0; y < H; y++) { stack.push(0, y, W - 1, y); }
while (stack.length) {
  const y = stack.pop(); const x = stack.pop();
  if (x < 0 || x >= W || y < 0 || y >= H) continue;
  const p = y * W + x;
  if (isBg[p]) continue;
  if (minCh(px(x, y)) < NEAR_WHITE) continue;
  isBg[p] = 1;
  stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
}

// 2) 生成 alpha:背景=0;与背景相邻的边缘像素按白度做半透明;内部不透明
const alpha = new Uint8Array(W * H);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const p = y * W + x;
    if (isBg[p]) { alpha[p] = 0; continue; }
    const nearBg =
      (x > 0 && isBg[p - 1]) || (x < W - 1 && isBg[p + 1]) ||
      (y > 0 && isBg[p - W]) || (y < H - 1 && isBg[p + W]);
    if (nearBg) {
      // 白度越高越透明:245→alpha0, 205→alpha255
      const a = Math.round((245 - minCh(px(x, y))) * (255 / 40));
      alpha[p] = Math.max(0, Math.min(255, a));
    } else {
      alpha[p] = 255;
    }
  }
}

// 3) 非透明像素包围盒
let minX = W, minY = H, maxX = 0, maxY = 0;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    if (alpha[y * W + x] > 8) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
}
const bw = maxX - minX + 1, bh = maxY - minY + 1;

// 4) 四周留 4% 呼吸边距,画布取正方形并居中
const pad = Math.round(Math.max(bw, bh) * 0.04);
const side = Math.max(bw, bh) + pad * 2;
const rgba = Buffer.alloc(side * side * 4, 0);
const offX = Math.floor((side - bw) / 2), offY = Math.floor((side - bh) / 2);
for (let y = 0; y < bh; y++) {
  for (let x = 0; x < bw; x++) {
    const sp = (y + minY) * W + (x + minX);
    const dp = ((y + offY) * side + (x + offX)) * 4;
    rgba[dp] = data[px(x + minX, y + minY)];
    rgba[dp + 1] = data[px(x + minX, y + minY) + 1];
    rgba[dp + 2] = data[px(x + minX, y + minY) + 2];
    rgba[dp + 3] = alpha[sp];
  }
}
const base = sharp(rgba, { raw: { width: side, height: side, channels: 4 } });

// 5) 输出
mkdirSync(join(ROOT, 'src', 'assets'), { recursive: true });
mkdirSync(join(ROOT, 'public', 'images'), { recursive: true });
mkdirSync(join(ROOT, 'website', 'public', 'images'), { recursive: true });
await base.clone().resize(512, 512).png().toFile(OUT.appAsset);
await base.clone().resize(512, 512).png().toFile(OUT.webPublic);
await base.clone().resize(512, 512).png().toFile(OUT.appPublic);
await base.clone().resize(48, 48).png().toFile(OUT.favicon48);
await base.clone().resize(32, 32).png().toFile(OUT.favicon32);
console.log(`done: bbox ${bw}x${bh}, canvas ${side}x${side}, outputs ->`, Object.values(OUT).join(' | '));
