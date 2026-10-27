// ============================================================
// 丹青有AI - 灌入测试数据(seed-database.js)
// 职责:创建测试租户 + 100 用户 + 10000 条分析记录
// 用于 /analyses 列表查询压测(验证复合索引性能)
//
// 运行:
//   cd server
//   node performance/scripts/seed-database.js
//
// 前置:已执行 prisma migrate dev(数据库表已创建)
// 后置:运行 generate-tokens.js 为这些用户签发 token
// ============================================================

import { writeFile, existsSync } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient, Prisma } from '@prisma/client';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_ROOT = path.resolve(__dirname, '..', '..');

// ---------- 手动加载 server/.env ----------
function loadEnvFile(envPath) {
  if (!existsSync(envPath)) {
    console.error(`[seed] .env 文件不存在: ${envPath}`);
    console.error('[seed] 请先: cp .env.example .env 并填入配置');
    process.exit(1);
  }
  const content = readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    value = value.replace(/\\n/g, '\n');
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

loadEnvFile(path.join(SERVER_ROOT, '.env'));

// ---------- 配置 ----------
const USER_COUNT = parseInt(process.env.SEED_USER_COUNT || '100', 10);
const ANALYSIS_COUNT = parseInt(process.env.SEED_ANALYSIS_COUNT || '10000', 10);
const TEST_USER_PREFIX = 'k6-test-';
const TEST_TENANT_NAME = 'k6-性能测试租户';

const ART_TYPES = ['painting', 'design', 'product', 'sculpture'];
const STATUSES = ['success', 'success', 'success', 'processing', 'failed']; // success 占多数

// mock 分析结果(精简版,与 api-contract.ts 的 AnalysisResult 结构一致)
function buildMockResult(artType, overallScore) {
  return {
    artType,
    overallScore,
    dimensions: {
      type: artType,
      composition: { score: overallScore - 5, focusPoint: { x: 0.5, y: 0.45 }, suggestion: 'k6 测试数据' },
    },
    originality: { score: overallScore - 3, similarity: 0.2, creativityLevel: 'good', suggestion: 'k6 测试数据' },
  };
}

// ---------- 主流程 ----------
async function main() {
  const prisma = new PrismaClient();
  const startedAt = Date.now();

  try {
    // 0. 清理旧的测试数据(幂等)
    console.log('[seed] 清理旧的测试数据(若存在)...');
    const oldTenant = await prisma.tenant.findFirst({
      where: { name: TEST_TENANT_NAME },
      select: { id: true },
    });
    if (oldTenant) {
      await prisma.analysis.deleteMany({ where: { tenantId: oldTenant.id } });
      await prisma.session.deleteMany({ where: { tenantId: oldTenant.id } });
      await prisma.tenantMember.deleteMany({ where: { tenantId: oldTenant.id } });
      await prisma.user.deleteMany({ where: { tenantId: oldTenant.id } });
      await prisma.tenant.delete({ where: { id: oldTenant.id } });
      console.log(`[seed] 已清理旧测试租户 ${oldTenant.id}`);
    }

    // 1. 创建测试租户(plan=enterprise,无限配额,避免压测触发 6001)
    console.log('[seed] 创建测试租户(enterprise 无限配额)...');
    const tenant = await prisma.tenant.create({
      data: {
        name: TEST_TENANT_NAME,
        type: 'college',
        plan: 'enterprise',
        status: 'active',
        maxSeats: 1000,
      },
    });
    console.log(`[seed] 租户创建成功: ${tenant.id}`);

    // 2. 批量创建 100 个测试用户
    console.log(`[seed] 创建 ${USER_COUNT} 个测试用户...`);
    const userCreateData = Array.from({ length: USER_COUNT }, (_, i) => ({
      tenantId: tenant.id,
      feishuOpenId: `${TEST_USER_PREFIX}open-${i}-${Date.now()}`,
      feishuUnionId: `${TEST_USER_PREFIX}union-${i}-${Date.now()}`,
      name: `k6测试用户${String(i).padStart(3, '0')}`,
      avatar: '',
      email: null,
      phone: null,
      role: i === 0 ? 'teacher' : 'student', // 第一个是教师,其余学生
    }));
    await prisma.user.createMany({ data: userCreateData });
    const users = await prisma.user.findMany({
      where: { tenantId: tenant.id },
      select: { id: true, role: true },
    });
    console.log(`[seed] 用户创建成功: ${users.length} 个`);

    // 3. 创建 TenantMember 关系
    console.log('[seed] 创建租户成员关系...');
    const memberCreateData = users.map((u) => ({
      userId: u.id,
      tenantId: tenant.id,
      role: u.role,
    }));
    await prisma.tenantMember.createMany({ data: memberCreateData });

    // 4. 批量创建 10000 条分析记录(分批,每批 1000)
    console.log(`[seed] 创建 ${ANALYSIS_COUNT} 条分析记录(分批写入)...`);
    const BATCH_SIZE = 1000;
    const BATCHES = Math.ceil(ANALYSIS_COUNT / BATCH_SIZE);
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;

    for (let batch = 0; batch < BATCHES; batch++) {
      const batchStart = batch * BATCH_SIZE;
      const batchEnd = Math.min(batchStart + BATCH_SIZE, ANALYSIS_COUNT);
      const batchData = [];
      for (let i = batchStart; i < batchEnd; i++) {
        const user = users[i % users.length];
        const artType = ART_TYPES[i % ART_TYPES.length];
        const status = STATUSES[i % STATUSES.length];
        const overallScore = 60 + (i % 40); // 60-99
        // createdAt 分散在过去 90 天,验证时间范围筛选
        const createdAt = new Date(now - (i % 90) * dayMs - (i % 86400000));
        const completedAt = status === 'success' || status === 'failed'
          ? new Date(createdAt.getTime() + 1500 + (i % 1000))
          : null;
        const durationMs = status === 'success' ? 1500 + (i % 1000) : null;
        const result = status === 'success'
          ? buildMockResult(artType, overallScore)
          : Prisma.JsonNull;
        const failureReason = status === 'failed' ? 'k6 测试失败数据' : null;

        batchData.push({
          tenantId: tenant.id,
          userId: user.id,
          workType: artType,
          imageUrl: `https://cdn.danqing-ai.com/uploads/test/${artType}-${i % 100}.jpg`,
          title: `k6测试作品${i}`,
          remark: null,
          status,
          result,
          failureReason,
          overallScore: status === 'success' ? overallScore : null,
          durationMs,
          createdAt,
          completedAt,
        });
      }
      await prisma.analysis.createMany({ data: batchData });
      console.log(`[seed] 分析记录批次 ${batch + 1}/${BATCHES} 写入完成(${batchData.length} 条)`);
    }

    // 5. 输出 seed-result.json(供 generate-tokens.js 和 cleanup.js 使用)
    const seedResult = {
      tenantId: tenant.id,
      tenantName: TEST_TENANT_NAME,
      userIds: users.map((u) => u.id),
      userCount: users.length,
      analysisCount: ANALYSIS_COUNT,
      createdAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
    };
    const resultPath = path.join(__dirname, 'seed-result.json');
    await writeFile(resultPath, JSON.stringify(seedResult, null, 2), 'utf-8');

    console.log('\n[seed] ✅ 测试数据灌入完成');
    console.log(`[seed]   租户 ID: ${tenant.id}`);
    console.log(`[seed]   用户数: ${users.length}`);
    console.log(`[seed]   分析记录数: ${ANALYSIS_COUNT}`);
    console.log(`[seed]   耗时: ${Date.now() - startedAt}ms`);
    console.log(`[seed]   结果文件: ${resultPath}`);
    console.log('[seed] 下一步:运行 generate-tokens.js 为测试用户签发 token');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[seed] 执行失败:', err);
  process.exit(1);
});
