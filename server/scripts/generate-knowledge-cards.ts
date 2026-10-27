// ============================================================
// 丹青有AI - 知识点卡片分步教学图离线预生成 CLI(参考图混合方案 Phase 3 批次②)
// 对应文档:visual-annotation-feedback-upgrade-spec-2026-09.md §5/§6 Phase 3
//
// 用法(cwd=server):
//   npx tsx scripts/generate-knowledge-cards.ts --dry-run          # 预览全量计划(不调 AI 不写 DB)
//   npx tsx scripts/generate-knowledge-cards.ts --category=sketch # 只生成素描类
//   npx tsx scripts/generate-knowledge-cards.ts --limit=5        # 只处理前 5 张待生成卡
//   npx tsx scripts/generate-knowledge-cards.ts                   # 全量真实生成
//
// 设计:
//   - 幂等:status=ready 的卡片自动跳过;partial/失败卡重跑补齐
//   - 单卡串行(28 卡 × 3 步 × ~30s/步 ≈ 40 分钟,离线脚本不追求并发,
//     避免 provider 限流);Ctrl+C 可中断,已生成卡的结果已实时写 DB
//   - 真实生成前置检查:resolveImageAIConfig() 无有效配置时立即报错退出
//     (dry-run 无此要求,无 key 也能预览 prompt 计划)
//   - tsx 不自动加载 .env:脚本开头手写轻量加载器(仅 KEY=VALUE 行,无新依赖)
// ============================================================

import fs from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { resolveImageAIConfig } from '../src/services/image-generation.service.js';
import {
  buildCardPlan,
  generateCardImages,
} from '../src/services/knowledge-card-generation.service.js';

// ------------------------------------------------------------
// 0. 轻量 .env 加载(无 dotenv 依赖;已存在的环境变量不覆盖)
//    路径锚定脚本自身位置(server/scripts → server/.env),不依赖 cwd
// ------------------------------------------------------------
function loadDotEnv(url: string): void {
  const path = url.replace('file:///', '').replace(/^([A-Za-z]:)/, (m) => m);
  if (!fs.existsSync(path)) return;
  const lines = fs.readFileSync(path, 'utf-8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadDotEnv(new URL('../.env', import.meta.url).toString());

// ------------------------------------------------------------
// 1. CLI 参数解析(--category= / --limit= / --dry-run / --help)
// ------------------------------------------------------------
function parseArgs(): { category?: string; limit?: number; dryRun: boolean; help: boolean } {
  const args = process.argv.slice(2);
  const result: { category?: string; limit?: number; dryRun: boolean; help: boolean } = {
    dryRun: false,
    help: false,
  };
  for (const arg of args) {
    if (arg === '--dry-run') {
      result.dryRun = true;
    } else if (arg === '--help' || arg === '-h') {
      result.help = true;
    } else if (arg.startsWith('--category=')) {
      result.category = arg.slice('--category='.length);
    } else if (arg.startsWith('--limit=')) {
      const n = Number.parseInt(arg.slice('--limit='.length), 10);
      if (Number.isInteger(n) && n > 0) result.limit = n;
    }
  }
  return result;
}

const VALID_CATEGORIES = ['sketch', 'color', 'quickSketch', 'design', 'heritage'];

function printHelp(): void {
  console.log(`
知识点卡片分步教学图离线预生成 CLI(Phase 3 批次②)

用法:npx tsx scripts/generate-knowledge-cards.ts [选项]

选项:
  --dry-run          只打印生成计划(每步完整 prompt),不调 AI 不写 DB
  --category=<类目>   过滤类目:sketch | color | quickSketch | design | heritage
  --limit=<N>        只处理前 N 张待生成卡片(抽样验证用)
  --help, -h         显示本帮助

行为:
  - status=ready 的卡片自动跳过(幂等);partial 卡重跑补齐
  - 真实生成需 server/.env 配置 AI_IMAGE_*;缺配置报错退出(dry-run 不受限)
`);
}

// ------------------------------------------------------------
// 2. 主流程
// ------------------------------------------------------------
async function main(): Promise<void> {
  const { category, limit, dryRun, help } = parseArgs();
  if (help) {
    printHelp();
    return;
  }
  if (category && !VALID_CATEGORIES.includes(category)) {
    console.error(`[kc-gen] 非法类目: ${category}(合法值: ${VALID_CATEGORIES.join(' | ')})`);
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    // 查询目标卡片(内置+启用;类目过滤)
    const cards = await prisma.knowledgeCard.findMany({
      where: {
        isBuiltIn: true,
        enabled: true,
        ...(category ? { category } : {}),
      },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });

    // dry-run:输出计划不调 AI(limit 与真实生成一致截断,保证抽样预览=实际行为)
    if (dryRun) {
      console.log('[kc-gen] === DRY-RUN 生成计划(不调 AI 不写 DB)===');
      console.log(`[kc-gen] 目标卡片: ${cards.length} 张${category ? `(类目=${category})` : ''}`);
      let pending = cards.filter((c) => {
        const s = (c.referenceAssets as { status?: string } | null)?.status;
        return s !== 'ready';
      });
      if (limit && limit < pending.length) {
        pending = pending.slice(0, limit);
      }
      console.log(`[kc-gen] 待生成(非 ready): ${pending.length} 张(其余 ${cards.length - pending.length} 张已 ready 将跳过)`);
      for (const card of pending) {
        const plan = buildCardPlan(card);
        const skipMark = plan.status === 'ready' ? '(已 ready,跳过)' : '';
        console.log(`\n[${plan.cardId}] ${plan.topic} [${plan.category}] ${plan.steps} 步 ${skipMark}`);
        for (let i = 0; i < plan.stepPrompts.length; i++) {
          console.log(`  第${i + 1}步: ${plan.stepPrompts[i]}`);
        }
      }
      console.log(
        `\n[kc-gen] 计划输出完毕,共 ${pending.length} 张 / ${pending.reduce((sum, c) => sum + buildCardPlan(c).steps, 0)} 步`,
      );
      return;
    }

    // 真实生成:前置配置检查
    const resolved = resolveImageAIConfig();
    if (!resolved) {
      console.error(
        '[kc-gen] AI 图像生成配置缺失(server/.env 的 AI_IMAGE_*),无法真实生成。' +
          '可先用 --dry-run 预览计划,或补齐配置后重跑。',
      );
      process.exit(1);
    }
    console.log(
      `[kc-gen] Provider 就绪: ${resolved.provider}${resolved.fallback ? '(降级)' : ''} / 模型 ${resolved.model}`,
    );

    // 目标卡:非 ready 的才生成(幂等),再按 limit 截断(抽样)
    let targets = cards.filter((c) => {
      const s = (c.referenceAssets as { status?: string } | null)?.status;
      return s !== 'ready';
    });
    if (limit && limit < targets.length) {
      targets = targets.slice(0, limit);
    }
    console.log(`[kc-gen] 待生成: ${targets.length} 张(ready 跳过 ${cards.length - targets.length} 张)`);
    if (targets.length === 0) {
      console.log('[kc-gen] 无待生成卡片,全部 ready,结束。');
      return;
    }

    // 串行生成(避免 provider 限流;离线脚本不追求吞吐)
    let ready = 0;
    let partial = 0;
    let failed = 0;
    const startedAt = Date.now();
    for (let i = 0; i < targets.length; i++) {
      const card = targets[i]!;
      console.log(`\n[kc-gen] (${i + 1}/${targets.length}) ${card.id} - ${card.topic} ...`);
      const outcome = await generateCardImages(prisma, card);
      switch (outcome.outcome) {
        case 'ready':
          ready += 1;
          console.log(`  完成: ${outcome.generatedSteps}/${outcome.steps} 步,耗时 ${(outcome.durationMs / 1000).toFixed(1)}s`);
          break;
        case 'partial':
          partial += 1;
          console.warn(`  部分成功: ${outcome.generatedSteps}/${outcome.steps} 步(${outcome.failureReason}),重跑可补齐`);
          break;
        default:
          failed += 1;
          console.error(`  失败: ${outcome.failureReason}(已记 failureReason,重跑可重试)`);
      }
    }

    const totalSec = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(`\n[kc-gen] === 汇总 ===`);
    console.log(`[kc-gen] 成功 ${ready} / 部分 ${partial} / 失败 ${failed},共 ${targets.length} 张,总耗时 ${totalSec}s`);
    if (partial + failed > 0) {
      console.log('[kc-gen] 提示:存在未完成卡片,直接重跑本脚本即可补齐(幂等)。');
      process.exitCode = 2; // 部分失败退出码 2(便于 CI 感知,但不阻塞本地补跑)
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[kc-gen] 未捕获异常:', err);
  process.exit(1);
});
