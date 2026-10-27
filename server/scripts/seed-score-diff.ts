// ============================================================
// 一致性差异模拟 CLI(框架二 P2 · 演示/联调/算法参数验证工具)
// 用法: npx tsx scripts/seed-score-diff.ts [选项]
//
// 三种模式:
//   1. 写库模式(默认): 构造模拟差异样本写入本地 PostgreSQL
//   2. --dry-run: 只计算统计不写库(无需本地数据库,用于快速验证
//      不同算法参数组合下的一致性指标表现)
//   3. --clean: 仅清除演示数据
//
// 模拟场景默认贴合"陌生作品 AI 系统性偏低"痛点:
//   - AI 分数区间 [ai-min, ai-max](体现 [60,95] 窄区间)
//   - 构图类维度教师上调 [comp-bias-min, comp-bias-max](构图 MAE 过高)
//   - 其他维度上调 [bias-min, bias-max]
//   - 统计算法与 score-audit.service.ts computeConsistencyStats 同源
// ============================================================

import { writeFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { computeConsistencyStats } from '../src/services/score-audit.service.js';

const prisma = new PrismaClient();

const TENANT_ID = 'seed-tenant-consistency-demo';
const USER_ID = 'seed-user-consistency-demo';

/* ---------------- 参数解析(轻量手写,零依赖) ---------------- */

interface CliOptions {
  count: number;
  seed: number;
  aiMin: number;
  aiMax: number;
  biasMin: number;
  biasMax: number;
  compBiasMin: number;
  compBiasMax: number;
  days: number;
  dryRun: boolean;
  stats: boolean;
  output?: string;
  clean: boolean;
  help: boolean;
}

const DEFAULTS: CliOptions = {
  count: 42,
  seed: 20260816,
  aiMin: 62,
  aiMax: 88,
  biasMin: 1,
  biasMax: 6,
  compBiasMin: 5,
  compBiasMax: 11,
  days: 88,
  dryRun: false,
  stats: true,
  clean: false,
  help: false,
};

const HELP = `
一致性差异模拟 CLI(框架二 P2)

用法: npx tsx scripts/seed-score-diff.ts [选项]

数据规模:
  --count <n>            差异样本数(默认 42)
  --seed <n>             随机种子,同种子完全可复现(默认 20260816)
  --days <n>             时间跨度天数(默认 88)

算法参数(AI 分数分布与教师上调幅度,用于模拟不同偏差场景):
  --ai-min <n>           AI 维度分下限(默认 62)
  --ai-max <n>           AI 维度分上限(默认 88)
  --bias-min <n>         非构图维度教师上调下限(默认 1)
  --bias-max <n>         非构图维度教师上调上限(默认 6)
  --comp-bias-min <n>    构图类维度教师上调下限(默认 5,模拟构图 MAE 过高)
  --comp-bias-max <n>    构图类维度教师上调上限(默认 11)

输出控制:
  --dry-run              只计算统计,不写数据库(无需本地 PostgreSQL)
  --stats / --no-stats   控制台一致性统计摘要(默认开启)
  --output <file>        明细+统计写入 JSON 文件(如 out/diff.json)

维护:
  --clean                仅清除演示数据后退出
  --help                 显示本帮助

示例:
  # 快速验证某参数组合的指标表现(不写库)
  npx tsx scripts/seed-score-diff.ts --dry-run --comp-bias-min 2 --comp-bias-max 5

  # 模拟 AI 已优化(构图偏差收窄)后的看板表现并输出明细
  npx tsx scripts/seed-score-diff.ts --dry-run --comp-bias-min 1 --comp-bias-max 4 --output out/optimized.json

  # 写入本地库供管理后台看板展示
  npx tsx scripts/seed-score-diff.ts
`;

function parseArgs(argv: string[]): CliOptions {
  const opts = { ...DEFAULTS };
  const numeric = new Set([
    'count', 'seed', 'ai-min', 'ai-max', 'bias-min', 'bias-max',
    'comp-bias-min', 'comp-bias-max', 'days',
  ]);
  const camel = (k: string) => k.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--help' || a === '-h') { opts.help = true; break; }
    if (a === '--clean') { opts.clean = true; continue; }
    if (a === '--dry-run') { opts.dryRun = true; continue; }
    if (a === '--stats') { opts.stats = true; continue; }
    if (a === '--no-stats') { opts.stats = false; continue; }
    if (a.startsWith('--') && numeric.has(a.slice(2))) {
      const v = Number(argv[i + 1]);
      if (!Number.isFinite(v)) {
        console.error(`[seed-cli] 参数 ${a} 需要一个数字,收到: ${argv[i + 1]}`);
        process.exitCode = 1;
        opts.help = true;
        break;
      }
      (opts as Record<string, unknown>)[camel(a.slice(2))] = Math.floor(v);
      i += 1;
      continue;
    }
    if (a === '--output') {
      const v = argv[i + 1];
      if (!v) { console.error('[seed-cli] --output 需要文件路径'); process.exitCode = 1; opts.help = true; break; }
      opts.output = v;
      i += 1;
      continue;
    }
    console.error(`[seed-cli] 未知参数: ${a}`);
    opts.help = true;
    break;
  }

  // 参数合法性校验
  if (opts.aiMin > opts.aiMax) { console.error('[seed-cli] ai-min 不能大于 ai-max'); opts.help = true; }
  if (opts.biasMin > opts.biasMax) { console.error('[seed-cli] bias-min 不能大于 bias-max'); opts.help = true; }
  if (opts.compBiasMin > opts.compBiasMax) { console.error('[seed-cli] comp-bias-min 不能大于 comp-bias-max'); opts.help = true; }
  return opts;
}

/* ---------------- 数据生成 ---------------- */

/** 四档分档(与 score-audit.service.ts toBand 一致:优≥90/良≥75/中≥60/差<60) */
function toBand(score: number): string {
  if (score >= 90) return '优';
  if (score >= 75) return '良';
  if (score >= 60) return '中';
  return '差';
}

/** 可复现伪随机(mulberry32) */
function mulberry32(seed: number): () => number {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 四类作品的维度键 */
const DIMENSION_KEYS: Record<string, string[]> = {
  painting: ['composition', 'color', 'brushwork', 'overall'],
  design: ['visualHierarchy', 'typography', 'colorApplication', 'overall'],
  product: ['form', 'materialExpression', 'functionExpression', 'overall'],
  sculpture: ['spatialComposition', 'bodyLanguage', 'materialLanguage', 'overall'],
};

/** 构图类维度(用于 comp-bias 模拟构图 MAE 偏高) */
const COMPOSITION_LIKE = new Set([
  'composition', 'visualHierarchy', 'form', 'spatialComposition', 'overall',
]);

/** 作品类型配比(painting 18 / design 10 / product 7 / sculpture 7,42 份时) */
function buildArtTypePlan(count: number): string[] {
  const ratios: Array<[string, number]> = [
    ['painting', 18], ['design', 10], ['product', 7], ['sculpture', 7],
  ];
  const total = ratios.reduce((s, [, w]) => s + w, 0);
  const plan: string[] = [];
  for (const [type, w] of ratios) {
    plan.push(...Array(Math.max(1, Math.round((w / total) * count))).fill(type));
  }
  while (plan.length > count) plan.pop();
  while (plan.length < count) plan.push('painting');
  return plan;
}

/** 一条差异样本(与 Prisma ScoreDiffRecord 字段对齐) */
interface DiffRecordDraft {
  overallDiff: number;
  bandAgreement: boolean;
  dimensionDiffs: Record<string, number>;
  source: string;
  artType: string;
  createdAt: Date;
  aiScore: { overallScore: number; dimensions: Record<string, number> };
  aiBand: string;
  humanScore: { overallScore: number; dimensions: Record<string, number> };
  humanBand: string;
}

function buildRecords(opts: CliOptions): DiffRecordDraft[] {
  const rand = mulberry32(opts.seed);
  const randInt = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;
  const now = Date.now();
  const records: DiffRecordDraft[] = [];

  buildArtTypePlan(opts.count).forEach((artType, i) => {
    const dimKeys = DIMENSION_KEYS[artType]!;
    const mainKeys = dimKeys.filter((k) => k !== 'overall');

    // AI 维度分(窄区间 [ai-min, ai-max])
    const aiDims: Record<string, number> = {};
    for (const k of mainKeys) aiDims[k] = randInt(opts.aiMin, opts.aiMax);
    const aiOverall = Math.round(mainKeys.reduce((s, k) => s + aiDims[k]!, 0) / mainKeys.length);
    aiDims['overall'] = aiOverall;

    // 教师分:构图类维度上调幅度更大(模拟构图 MAE 过高)
    const humanDims: Record<string, number> = {};
    const dimensionDiffs: Record<string, number> = {};
    for (const k of mainKeys) {
      const bump = COMPOSITION_LIKE.has(k)
        ? randInt(opts.compBiasMin, opts.compBiasMax)
        : randInt(opts.biasMin, opts.biasMax);
      const v = Math.min(96, aiDims[k]! + bump);
      humanDims[k] = v;
      dimensionDiffs[k] = Math.round((v - aiDims[k]!) * 10) / 10;
    }
    const humanOverall = Math.min(
      96,
      Math.round(mainKeys.reduce((s, k) => s + humanDims[k]!, 0) / mainKeys.length),
    );
    humanDims['overall'] = humanOverall;
    dimensionDiffs['overall'] = Math.round((humanOverall - aiOverall) * 10) / 10;

    const daysAgo = Math.floor(rand() ** 1.6 * opts.days);

    records.push({
      overallDiff: dimensionDiffs['overall']!,
      bandAgreement: toBand(aiOverall) === toBand(humanOverall),
      dimensionDiffs,
      source: i % 4 === 3 ? 'dispute_resolve' : 'teacher_review',
      artType,
      createdAt: new Date(now - daysAgo * 24 * 3600 * 1000),
      aiScore: { overallScore: aiOverall, dimensions: { ...aiDims } },
      aiBand: toBand(aiOverall),
      humanScore: { overallScore: humanOverall, dimensions: { ...humanDims } },
      humanBand: toBand(humanOverall),
    });
  });
  return records;
}

/* ---------------- 输出 ---------------- */

const DIMENSION_LABELS: Record<string, string> = {
  composition: '构图', color: '色彩', brushwork: '笔触',
  visualHierarchy: '视觉层次', typography: '排版', colorApplication: '色彩应用',
  form: '形态', materialExpression: '材料表现', functionExpression: '功能表达',
  spatialComposition: '空间构成', bodyLanguage: '形体语言', materialLanguage: '材料语言',
  overall: '总评',
};
const SOURCE_LABELS: Record<string, string> = {
  teacher_review: '教师评审',
  dispute_resolve: '仲裁裁定',
};

function printStats(stats: ReturnType<typeof computeConsistencyStats>): void {
  const pct = (v: number) => `${Math.round(v * 1000) / 10}%`;
  console.log('\n===== 一致性指标统计 =====');
  console.log(`样本数        ${stats.sampleCount}`);
  console.log(`档位一致率    ${pct(stats.bandAgreementRate)}`);
  console.log(`MAE           ${stats.mae} 分`);
  console.log(`RMSE          ${stats.rmse} 分`);
  console.log(`平均偏差      ${stats.meanDiff} 分(正=AI偏低)`);
  console.log(`AI偏低/偏高   ${stats.aiUnderCount} / ${stats.aiOverCount}(完全一致 ${stats.exactCount})`);
  console.log('维度级 MAE:');
  for (const [k, v] of Object.entries(stats.dimensionMae)) {
    console.log(`  ${DIMENSION_LABELS[k] ?? k}: ${v}`);
  }
  console.log('按来源:');
  for (const [s, v] of Object.entries(stats.bySource)) {
    console.log(`  ${SOURCE_LABELS[s] ?? s}: MAE ${v.mae} · 档位一致 ${pct(v.bandAgreementRate)} · ${v.sampleCount} 份`);
  }
}

/* ---------------- 主流程 ---------------- */

async function writeDatabase(records: DiffRecordDraft[]): Promise<void> {
  // 租户/用户就绪
  await prisma.tenant.upsert({
    where: { id: TENANT_ID },
    update: {},
    create: { id: TENANT_ID, name: '一致性演示租户', type: 'school', plan: 'free', status: 'active', maxSeats: 50 },
  });
  await prisma.user.upsert({
    where: { id: USER_ID },
    update: {},
    create: {
      id: USER_ID, tenantId: TENANT_ID, authType: 'password', role: 'student',
      name: '一致性演示学生', email: 'consistency-demo@dq.edu', passwordHash: 'seed-placeholder', status: 'active',
    },
  });

  // 清除旧演示数据(可重复执行)
  const oldDiffs = await prisma.scoreDiffRecord.deleteMany({ where: { tenantId: TENANT_ID } });
  const oldAnalyses = await prisma.analysis.deleteMany({
    where: { tenantId: TENANT_ID, id: { startsWith: 'seed-analysis-' } },
  });
  console.log(`[seed-cli] 清除旧数据: diff=${oldDiffs.count} analysis=${oldAnalyses.count}`);

  for (let i = 0; i < records.length; i++) {
    const r = records[i]!;
    const analysis = await prisma.analysis.create({
      data: {
        id: `seed-analysis-${String(i + 1).padStart(3, '0')}-${opts.seed}`,
        tenantId: TENANT_ID,
        userId: USER_ID,
        workType: r.artType as 'painting',
        imageUrl: `https://demo.local/seed-${i + 1}.jpg`,
        title: `一致性演示作品 ${i + 1}`,
        status: 'success',
        result: { artType: r.artType, overallScore: r.aiScore.overallScore, aiEnhanced: i % 2 === 0 },
        overallScore: r.aiScore.overallScore,
        completedAt: r.createdAt,
        createdAt: r.createdAt,
      },
    });
    await prisma.scoreDiffRecord.create({
      data: {
        analysisId: analysis.id,
        tenantId: TENANT_ID,
        source: r.source,
        aiScore: { ...r.aiScore, aiEnhanced: i % 2 === 0 },
        aiBand: r.aiBand,
        humanScore: r.humanScore,
        humanBand: r.humanBand,
        overallDiff: r.overallDiff,
        dimensionDiffs: r.dimensionDiffs,
        bandAgreement: r.bandAgreement,
        artType: r.artType,
        createdAt: r.createdAt,
      },
    });
  }
  console.log(`[seed-cli] 已写入 ${records.length} 条差异样本(tenant=${TENANT_ID})`);
}

async function main(): Promise<void> {
  if (opts.help) {
    console.log(HELP);
    return;
  }

  if (opts.clean) {
    const diffs = await prisma.scoreDiffRecord.deleteMany({ where: { tenantId: TENANT_ID } });
    const analyses = await prisma.analysis.deleteMany({
      where: { tenantId: TENANT_ID, id: { startsWith: 'seed-analysis-' } },
    });
    console.log(`[seed-cli] 已清除: diff=${diffs.count} analysis=${analyses.count}`);
    return;
  }

  console.log(
    `[seed-cli] 生成 ${opts.count} 份样本(seed=${opts.seed}` +
    `, comp-bias=[${opts.compBiasMin},${opts.compBiasMax}]` +
    `, bias=[${opts.biasMin},${opts.biasMax}]` +
    `, ai=[${opts.aiMin},${opts.aiMax}]` +
    `${opts.dryRun ? ', dry-run' : ''})`,
  );

  const records = buildRecords(opts);
  const stats = computeConsistencyStats(records);

  if (opts.stats) printStats(stats);

  if (opts.output) {
    const payload = { generatedAt: new Date().toISOString(), options: opts, stats, records };
    writeFileSync(opts.output, JSON.stringify(payload, null, 2), 'utf-8');
    console.log(`[seed-cli] 明细已写入 ${opts.output}`);
  }

  if (opts.dryRun) {
    console.log('[seed-cli] dry-run 模式:未连接/写入数据库');
  } else {
    await writeDatabase(records);
  }
}

const opts = parseArgs(process.argv.slice(2));
void main()
  .catch((err) => {
    console.error('[seed-cli] 失败:', err);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
