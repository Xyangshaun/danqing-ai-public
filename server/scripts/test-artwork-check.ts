/**
 * 本地验证脚本:作品有效性校验(artwork_check)
 *
 * 用途:
 *   验证 AI 深度分析能否正确识别图片内容类型:
 *     A. 真实绘画作品 → 期望 artworkCheck.status = "match"
 *     B. 表情包/贴纸  → 期望 artworkCheck.status = "mismatch"
 *     C. 占位图       → 期望 artworkCheck.status = "mismatch"
 *
 * 运行方式(server 目录下):
 *   npx tsx scripts/test-artwork-check.ts
 *
 * 说明:
 *   - 手动加载 server/.env 到 process.env,并将 AI_API_TIMEOUT 提到 60s
 *     (本地 .env 为 15s,GLM-4.6V 深度分析实测常超过 15s)
 *   - 真实调用 GLM API,会消耗 token,请勿高频运行
 */

import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = resolve(__dirname, '..');
const PROJECT_ROOT = resolve(SERVER_ROOT, '..');

// ---------- 1. 加载 .env ----------
const envPath = resolve(SERVER_ROOT, '.env');
const envContent = readFileSync(envPath, 'utf-8');
for (const line of envContent.split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eqIdx = trimmed.indexOf('=');
  if (eqIdx <= 0) continue;
  const key = trimmed.slice(0, eqIdx).trim();
  let value = trimmed.slice(eqIdx + 1).trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    // 双引号值:展开转义序列(与 dotenv / Node --env-file 行为一致)
    value = value.slice(1, -1).replace(/\\n/g, '\n').replace(/\\r/g, '\r');
  } else if (value.startsWith("'") && value.endsWith("'")) {
    value = value.slice(1, -1);
  }
  if (!(key in process.env)) process.env[key] = value;
}

// 本地验证:GLM-4.6V 深度分析耗时长,提到 60s 与线上一致
process.env.AI_API_TIMEOUT = '60000';
// GLM-4.6V 是推理模型,reasoning 消耗大量 token,max_tokens=1024 会导致正文为空
process.env.AI_API_MAX_TOKENS = '4096';

// ---------- 2. 生成表情包测试图 ----------
async function createMemeImage(outPath: string): Promise<void> {
  const { default: Jimp } = await import('jimp');
  const W = 600;
  const H = 450;
  const img = new Jimp(W, H, 0xffd93bff); // 明黄色背景

  const fillCircle = (cx: number, cy: number, r: number, color: number) => {
    img.scan(cx - r, cy - r, r * 2, r * 2, function (px: number, py: number, idx: number) {
      const dx = px - cx;
      const dy = py - cy;
      if (dx * dx + dy * dy <= r * r) {
        img.bitmap.data[idx] = (color >> 24) & 0xff;
        img.bitmap.data[idx + 1] = (color >> 16) & 0xff;
        img.bitmap.data[idx + 2] = (color >> 8) & 0xff;
        img.bitmap.data[idx + 3] = color & 0xff;
      }
    });
  };

  // 圆脸
  fillCircle(300, 200, 130, 0xffffffff);
  // 眼睛
  fillCircle(250, 170, 20, 0x000000ff);
  fillCircle(350, 170, 20, 0x000000ff);
  // 嘴巴(半月牙,用下半圆环模拟)
  img.scan(220, 190, 160, 90, function (px: number, py: number, idx: number) {
    const dx = px - 300;
    const dy = py - 200;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist >= 55 && dist <= 70 && dy > 0) {
      img.bitmap.data[idx] = 0;
      img.bitmap.data[idx + 1] = 0;
      img.bitmap.data[idx + 2] = 0;
      img.bitmap.data[idx + 3] = 0xff;
    }
  });

  // 底部文字
  const font = await Jimp.loadFont(Jimp.FONT_SANS_64_BLACK);
  img.print(font, 0, 350, {
    text: 'HAHA HA!',
    alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER,
    alignmentY: Jimp.VERTICAL_ALIGN_MIDDLE,
  }, W, 90);

  await img.writeAsync(outPath);
}

// ---------- 3. 主流程 ----------
async function main() {
  const assetsDir = resolve(SERVER_ROOT, 'scripts', 'test-assets');
  if (!existsSync(assetsDir)) mkdirSync(assetsDir, { recursive: true });

  const memePath = resolve(assetsDir, 'meme-test.jpg');
  if (!existsSync(memePath)) {
    await createMemeImage(memePath);
    console.log('[setup] 表情包测试图已生成:', memePath);
  }

  // 动态导入,确保 env 已加载
  const { analyzeWithAI } = await import('../src/services/ai-vision.service.js');

  const cases: Array<{ name: string; imageSource: string; expect: string }> = [
    {
      name: 'A. 真实古典油画(met-437329)',
      imageSource: resolve(PROJECT_ROOT, 'public/images/artworks-real/full/met-437329.jpg'),
      expect: 'match',
    },
    {
      name: 'B. 表情包(笑脸+文字贴纸)',
      imageSource: memePath,
      expect: 'mismatch',
    },
    {
      name: 'C. 占位图(image is generating)',
      imageSource: resolve(PROJECT_ROOT, 'public/images/artworks-real/thumb/ai-向日葵.jpg'),
      expect: 'mismatch',
    },
  ];

  let pass = 0;
  let fail = 0;

  for (const c of cases) {
    console.log('\n========================================');
    console.log(`[case] ${c.name}`);
    console.log(`[case] 期望 artworkCheck.status = ${c.expect}`);
    const startMs = Date.now();
    try {
      const res = await analyzeWithAI({
        imageSource: c.imageSource,
        artType: 'painting',
        title: '本地验证用例',
      });
      const wallMs = Date.now() - startMs;
      if (!res.success || !res.result) {
        fail++;
        console.log(`[result] 调用失败 failureReason=${res.failureReason} durationMs=${res.durationMs} wallMs=${wallMs}`);
        continue;
      }
      const ac = res.result.artworkCheck;
      const status = ac?.status ?? '(缺失)';
      const hit = status === c.expect;
      if (hit) pass++;
      else fail++;
      console.log(`[result] ${hit ? 'PASS' : 'FAIL'} status=${status} durationMs=${res.durationMs} wallMs=${wallMs}`);
      console.log(`[artworkCheck] actualType=${ac?.actualType ?? ''}`);
      console.log(`[artworkCheck] reason=${ac?.reason ?? ''}`);
      console.log(`[visualDescription] ${(res.result.visualDescription ?? '').slice(0, 200)}`);
      console.log(`[suggestions] count=${res.result.professionalSuggestions.length}`);
      for (const s of res.result.professionalSuggestions.slice(0, 3)) {
        console.log(`  - [${s.priority ?? '?'}] ${s.dimension}: ${(s.operation ?? '').slice(0, 80)}`);
      }
      if (res.tokenUsage) {
        console.log(`[tokenUsage] total=${res.tokenUsage.totalTokens} (prompt=${res.tokenUsage.promptTokens}, completion=${res.tokenUsage.completionTokens})`);
      }
    } catch (err) {
      fail++;
      console.log(`[result] 异常:`, err instanceof Error ? err.message : err);
    }
  }

  console.log('\n========================================');
  console.log(`[summary] pass=${pass} fail=${fail}`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
