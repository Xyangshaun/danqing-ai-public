#!/usr/bin/env node
/**
 * 扫描 /public/images/gallery-*.jpg 真实尺寸,生成 lib/painting-meta.json
 * 纯 Node.js,无外部依赖:解析 JPEG SOF0/SOF2 marker 读取 w/h。
 *
 * 用法: node scripts/scan-paintings.mjs
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const IMG_DIR = join(ROOT, 'public', 'images');
const OUT_FILE = join(ROOT, 'lib', 'painting-meta.json');

/**
 * 解析 JPEG 文件尺寸。返回 { w, h } 或 null。
 * 支持 SOF0/SOF2/SOF3/SOF5/SOF6/SOF7/SOF9/SOF10/SOF11,跳过 SOF4/SOF8/SOF12(DHT/JPG)。
 */
function readJpegSize(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) return null;
    // 跳过填充 0xff
    while (i < buf.length && buf[i] === 0xff) i++;
    if (i >= buf.length) return null;
    const marker = buf[i];
    i++;
    // SOF markers (excluding DHT=0xc4, JPG=0xc8, DAC=0xcc)
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      // SOF header: 2 bytes length, 1 byte precision, 2 bytes height, 2 bytes width
      const h = buf.readUInt16BE(i + 3);
      const w = buf.readUInt16BE(i + 5);
      return { w, h };
    }
    // 跳过此段
    if (i + 1 >= buf.length) return null;
    const segLen = buf.readUInt16BE(i);
    i += segLen;
  }
  return null;
}

function main() {
  const files = readdirSync(IMG_DIR)
    .filter((f) => /^gallery-.*\.(jpe?g)$/i.test(f))
    .sort();
  const meta = {};
  for (const f of files) {
    const buf = readFileSync(join(IMG_DIR, f));
    const size = readJpegSize(buf);
    if (!size) {
      console.warn(`[scan-paintings] 跳过(无法解析): ${f}`);
      continue;
    }
    meta[`/images/${f}`] = {
      w: size.w,
      h: size.h,
      ratio: +(size.w / size.h).toFixed(4),
    };
  }
  mkdirSync(dirname(OUT_FILE), { recursive: true });
  writeFileSync(OUT_FILE, JSON.stringify(meta, null, 2) + '\n', 'utf8');
  console.log(
    `[scan-paintings] 写入 ${Object.keys(meta).length} 条 → ${OUT_FILE.replace(ROOT + '\\', '')}`
  );
  for (const [src, m] of Object.entries(meta)) {
    console.log(`  ${src.padEnd(34)} ${m.w}×${m.h}  ratio=${m.ratio}`);
  }
}

main();
