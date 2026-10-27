/**
 * 名画图片优化:把 public/images/gallery-*.jpg 转成同名的 .webp 版本。
 * - WebP 通常比 JPG 小 50%~70%,用于开屏动画与 Hero 主视觉,显著缓解首屏卡顿。
 * - 保留 .jpg 作为旧浏览器回退,前端用 <picture> 优先加载 webp。
 * - 转换是幂等的:已存在且较新的 webp 会跳过,重复运行安全。
 */
import { readdir, stat } from 'node:fs/promises';
import { join, parse } from 'node:path';
import sharp from 'sharp';

const IMG_DIR = join(process.cwd(), 'public', 'images');
const QUALITY = 80;

async function main() {
  const files = await readdir(IMG_DIR);
  const jpgs = files.filter((f) => /^gallery-.*\.jpg$/i.test(f));

  let done = 0;
  let skipped = 0;
  for (const jpg of jpgs) {
    const base = parse(jpg).name;
    const src = join(IMG_DIR, jpg);
    const out = join(IMG_DIR, `${base}.webp`);

    // 幂等:若 webp 已存在且比 jpg 新,跳过
    try {
      const [srcSt, outSt] = await Promise.all([stat(src), stat(out)]);
      if (outSt.mtimeMs >= srcSt.mtimeMs) {
        skipped += 1;
        continue;
      }
    } catch {
      /* webp 不存在,继续转换 */
    }

    await sharp(src).webp({ quality: QUALITY }).toFile(out);
    const outSt = await stat(out);
    const srcSt = await stat(src);
    console.log(
      `${base}: ${(srcSt.size / 1024).toFixed(1)}KB → ${(outSt.size / 1024).toFixed(1)}KB (${Math.round(
        (1 - outSt.size / srcSt.size) * 100
      )}%)`
    );
    done += 1;
  }

  console.log(`\n[optimize-paintings] 转换 ${done} 张,跳过 ${skipped} 张(已是最新)。`);
}

main().catch((err) => {
  console.error('[optimize-paintings] 失败:', err);
  process.exit(1);
});