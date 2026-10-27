// ============================================================
// M4-T9 风格迁移生图真实链路实测脚本(路径1:服务级直测)
//
// 用法(在 server/ 目录下执行):
//   npx tsx --env-file=.env scripts/m4-t9-style-e2e.ts              # 全部画种
//   npx tsx --env-file=.env scripts/m4-t9-style-e2e.ts --only painting  # 单画种
//
// 链路(每画种,对齐生产 M4-T4 编排两步串联):
//   1. 本地参考图读为 base64 dataURL(不走上传链路)
//   2. analyzeStyle(dataUrl, artType) → StyleAnalysis 七字段
//   3. buildStyleTransferPrompt(analysis, contentPrompt, artType) → 组合 prompt
//   4. generateImage({ inputType:'text', prompt, artType, aspect:'square', count:1 })
//   5. 生成图保存 .tmp-m4-t9/<画种>/generated.jpg(data: 解码 / http 下载)
//   6. 七字段 + 组合 prompt + 元信息写 .tmp-m4-t9/<画种>/analysis.md
//
// 说明:
//   - 仅 import 风格分析/生图两个服务,不触发 Prisma/Redis 连接
//     (两服务 import 链仅 axios/zod/env/logger,已核实)
//   - 凭据经 --env-file=.env 注入 env(),零硬编码
//   - 参考图取自本地素材库 dist/images/artworks-real/full/
//     (public/data/artworks.json 元数据:公有领域大师作品)
// ============================================================

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import axios from 'axios';
import type { ArtType, StyleAnalysis } from '../src/types/api-contract.js';
import {
  analyzeStyle,
  buildStyleTransferPrompt,
  STYLE_PROMPT_TEMPLATE_VERSION,
} from '../src/services/style-analysis.service.js';
import { generateImage } from '../src/services/image-generation.service.js';

// ---------------- 输出目录(项目根 .tmp-m4-t9) ----------------

const SERVER_DIR = path.resolve(import.meta.dirname, '..'); // server/
const PROJECT_ROOT = path.resolve(SERVER_DIR, '..'); // 项目根
const OUT_ROOT = path.join(PROJECT_ROOT, '.tmp-m4-t9');

// ---------------- 画种配置(参考图 + 有区分度的内容描述) ----------------

interface CaseConfig {
  artType: ArtType;
  /** 参考图本地绝对路径 */
  refImage: string;
  /** 参考图来源说明(写入报告) */
  refSource: string;
  /** 新画面内容描述 */
  contentPrompt: string;
}

const CASES: CaseConfig[] = [
  {
    artType: 'painting',
    refImage: path.join(PROJECT_ROOT, 'dist', 'images', 'artworks-real', 'full', 'wm-bee7e8fe41.jpg'),
    refSource:
      'Claude Monet - Waterloo Bridge (1903, Google Art Project; Wikimedia 公有领域) — 莫奈雾景系列,蓝紫色调朦胧笔触',
    contentPrompt: '画一条清晨薄雾中的江南水乡石桥，桥下有乌篷船缓缓划过',
  },
  {
    artType: 'sculpture',
    refImage: path.join(PROJECT_ROOT, 'dist', 'images', 'artworks-real', 'full', 'wm-564d800046.jpg'),
    refSource:
      'Auguste Rodin - Victor Hugo buste marbre (Musée Rodin S.00464; Wikimedia 公有领域) — 白色大理石胸像,皮肤柔和过渡',
    contentPrompt: '一位托腮沉思的少女半身像，衣褶自然垂坠',
  },
  {
    artType: 'design',
    refImage: path.join(PROJECT_ROOT, 'dist', 'images', 'artworks-real', 'full', 'wm-73f07c6cce.jpg'),
    refSource:
      'William Morris - Panel Entitled "Peacock and Dragon" (1878, Google Art Project; Wikimedia 公有领域) — 工艺美术运动平面壁布纹样',
    contentPrompt: '以向日葵与缠绕藤蔓为主角的平面装饰纹样，左右对称连续重复，适合织物印刷',
  },
];

// ---------------- 工具函数 ----------------

/** 本地图片读为 base64 dataURL */
async function toDataUrl(absPath: string): Promise<string> {
  const buf = await readFile(absPath);
  const ext = path.extname(absPath).toLowerCase().replace('.', '');
  const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

/** 保存生成图: data: 前缀解码 / http URL 下载; 返回保存路径与来源说明 */
async function saveGeneratedImage(
  url: string,
  outDir: string,
  index: number,
): Promise<{ savedPath: string; source: string }> {
  const savedPath = path.join(outDir, `generated-${index}.jpg`);
  if (url.startsWith('data:')) {
    const b64 = url.slice(url.indexOf(',') + 1);
    await writeFile(savedPath, Buffer.from(b64, 'base64'));
    return { savedPath, source: 'b64 dataURL 解码' };
  }
  const resp = await axios.get(url, { responseType: 'arraybuffer', timeout: 60000 });
  await writeFile(savedPath, Buffer.from(resp.data));
  return { savedPath, source: 'http URL 下载' };
}

/** 生成 analysis.md 报告 */
function buildReportMarkdown(cfg: CaseConfig, analysis: StyleAnalysis, prompt: string, extra: string): string {
  const field = (label: string, value: string) => `**${label}**：${value}\n\n`;
  return [
    `# M4-T9 风格拆解与组合 Prompt(${cfg.artType})`,
    '',
    `- 参考图：\`${path.basename(cfg.refImage)}\`(${cfg.refSource})`,
    `- 新内容描述：「${cfg.contentPrompt}」`,
    `- 模板版本：STYLE_PROMPT_TEMPLATE_VERSION = ${STYLE_PROMPT_TEMPLATE_VERSION}`,
    '',
    '## StyleAnalysis 七字段',
    '',
    field('medium(媒介材料)', analysis.medium),
    field('brushwork(笔触)', analysis.brushwork),
    field('colorSystem(色彩体系)', analysis.colorSystem),
    field('composition(构图法则)', analysis.composition),
    field('technique(技法)', analysis.technique),
    field('expression(表现倾向)', analysis.expression),
    field('styleSeed(风格种子)', analysis.styleSeed),
    '## 组合生图 Prompt 全文',
    '',
    '```text',
    prompt,
    '```',
    '',
    '## 生成结果',
    '',
    extra,
    '',
  ].join('\n');
}

// ---------------- 主流程 ----------------

async function runCase(cfg: CaseConfig): Promise<void> {
  const outDir = path.join(OUT_ROOT, cfg.artType);
  await mkdir(outDir, { recursive: true });
  const startedAt = Date.now();

  console.log(`\n========== [${cfg.artType}] ==========`);
  console.log(`参考图: ${cfg.refImage}`);

  // Step 1: 参考图 → dataURL
  const dataUrl = await toDataUrl(cfg.refImage);
  console.log(`参考图已读为 dataURL (${Math.round(dataUrl.length / 1024)} KB)`);

  // Step 2: 风格拆解
  const t1 = Date.now();
  const analysis = await analyzeStyle(dataUrl, cfg.artType, `m4-t9-${cfg.artType}`);
  console.log(`analyzeStyle 完成 (${Date.now() - t1} ms), styleSeed 前 60 字: ${analysis.styleSeed.slice(0, 60)}...`);

  // Step 3: 组合 prompt
  const prompt = buildStyleTransferPrompt(analysis, cfg.contentPrompt, cfg.artType);
  console.log(`组合 prompt 构建完成 (${prompt.length} 字)`);

  // Step 4: 生图
  const t2 = Date.now();
  const gen = await generateImage({
    inputType: 'text',
    prompt,
    artType: cfg.artType,
    aspect: 'square',
    count: 1,
  });
  console.log(
    `generateImage 完成 (${Date.now() - t2} ms): success=${gen.success}, provider=${gen.provider}, model=${gen.model}`,
  );
  if (!gen.success || !gen.imageUrls || gen.imageUrls.length === 0) {
    const extra = `生成失败: failureReason=${gen.failureReason}, httpStatus=${gen.httpStatus ?? 'N/A'}`;
    await writeFile(
      path.join(outDir, 'analysis.md'),
      buildReportMarkdown(cfg, analysis, prompt, extra),
      'utf-8',
    );
    throw new Error(`[${cfg.artType}] 生图失败: ${gen.failureReason}`);
  }

  // Step 5: 保存生成图
  const savedList: string[] = [];
  for (let i = 0; i < gen.imageUrls.length; i++) {
    const { savedPath, source } = await saveGeneratedImage(gen.imageUrls[i]!, outDir, i + 1);
    savedList.push(`${savedPath}(${source})`);
    console.log(`生成图已保存: ${savedPath}`);
  }

  // Step 6: 写 analysis.md
  const extra = [
    `- 生成耗时: ${Date.now() - t2} ms; 全链路耗时: ${Date.now() - startedAt} ms`,
    `- 生效 provider: ${gen.provider}; 模型: ${gen.model}; 降级: ${gen.usedFallback}`,
    `- 生成图本地路径:`,
    ...savedList.map((s) => `  - ${s}`),
  ].join('\n');
  await writeFile(path.join(outDir, 'analysis.md'), buildReportMarkdown(cfg, analysis, prompt, extra), 'utf-8');
  console.log(`报告已写入: ${path.join(outDir, 'analysis.md')}`);
}

async function main(): Promise<void> {
  const onlyIdx = process.argv.indexOf('--only');
  const only = onlyIdx >= 0 ? process.argv[onlyIdx + 1] : undefined;
  const cases = only ? CASES.filter((c) => c.artType === only) : CASES;
  if (cases.length === 0) {
    console.error(`未知画种: ${only}(可选: ${CASES.map((c) => c.artType).join(' / ')})`);
    process.exit(2);
  }
  console.log(`M4-T9 风格迁移实测 | 模板版本 ${STYLE_PROMPT_TEMPLATE_VERSION} | 画种: ${cases.map((c) => c.artType).join(', ')}`);

  const failures: string[] = [];
  for (const cfg of cases) {
    try {
      await runCase(cfg);
    } catch (err) {
      failures.push(`${cfg.artType}: ${err instanceof Error ? err.message : String(err)}`);
      console.error(`[${cfg.artType}] 失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log('\n========== 汇总 ==========');
  if (failures.length > 0) {
    console.log(`失败 ${failures.length}/${cases.length}:`);
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exit(1);
  }
  console.log(`全部 ${cases.length} 个画种链路成功`);
  process.exit(0);
}

void main();
