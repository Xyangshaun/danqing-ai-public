// ============================================================
// 丹青有AI - 测试后清理(cleanup.js)
// 职责:删除 seed-database.js 创建的所有测试数据
// 删除顺序(尊重外键):Analysis → Session → TenantMember → User → Tenant
//
// 运行:
//   cd server
//   node performance/scripts/cleanup.js
//
// 识别策略:
//   1. 优先读取 seed-result.json 获取 tenantId
//   2. 兜底:按 tenant.name='k6-性能测试租户' 或 feishu_open_id 前缀 'k6-test-' 筛选
// ============================================================

import { readFile, unlink, existsSync } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_ROOT = path.resolve(__dirname, '..', '..');

// ---------- 手动加载 server/.env ----------
function loadEnvFile(envPath) {
  if (!existsSync(envPath)) {
    console.error(`[cleanup] .env 文件不存在: ${envPath}`);
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

const TEST_TENANT_NAME = 'k6-性能测试租户';
const TEST_USER_PREFIX = 'k6-test-';

// ---------- 主流程 ----------
async function main() {
  const prisma = new PrismaClient();
  const startedAt = Date.now();
  let deletedCounts = {
    analyses: 0,
    sessions: 0,
    tenantMembers: 0,
    users: 0,
    tenants: 0,
  };

  try {
    // 1. 定位测试租户
    let tenantId = null;

    // 1a. 优先从 seed-result.json 读取
    const seedResultPath = path.join(__dirname, 'seed-result.json');
    if (existsSync(seedResultPath)) {
      try {
        const seedResult = JSON.parse(await readFile(seedResultPath, 'utf-8'));
        tenantId = seedResult.tenantId;
        console.log(`[cleanup] 从 seed-result.json 读取 tenantId: ${tenantId}`);
      } catch {
        console.warn('[cleanup] seed-result.json 解析失败,改用名称兜底');
      }
    }

    // 1b. 兜底:按名称查找
    if (!tenantId) {
      const tenant = await prisma.tenant.findFirst({
        where: { name: TEST_TENANT_NAME },
        select: { id: true },
      });
      if (tenant) {
        tenantId = tenant.id;
        console.log(`[cleanup] 按名称找到测试租户: ${tenantId}`);
      }
    }

    if (!tenantId) {
      console.log('[cleanup] 未找到测试租户,无需清理');
      return;
    }

    // 2. 按外键依赖顺序删除
    console.log(`[cleanup] 开始清理租户 ${tenantId} 的数据...`);

    // 2a. 删除 Analysis(数量最多,单独计时)
    const t1 = Date.now();
    deletedCounts.analyses = await prisma.analysis.deleteMany({
      where: { tenantId },
    });
    console.log(`[cleanup]   Analysis 删除 ${deletedCounts.analyses} 条 (${Date.now() - t1}ms)`);

    // 2b. 删除 Session
    deletedCounts.sessions = await prisma.session.deleteMany({
      where: { tenantId },
    });
    console.log(`[cleanup]   Session 删除 ${deletedCounts.sessions} 条`);

    // 2c. 删除 TenantMember
    deletedCounts.tenantMembers = await prisma.tenantMember.deleteMany({
      where: { tenantId },
    });
    console.log(`[cleanup]   TenantMember 删除 ${deletedCounts.tenantMembers} 条`);

    // 2d. 删除 User
    deletedCounts.users = await prisma.user.deleteMany({
      where: { tenantId },
    });
    console.log(`[cleanup]   User 删除 ${deletedCounts.users} 条`);

    // 2e. 删除 Tenant
    deletedCounts.tenants = await prisma.tenant.deleteMany({
      where: { id: tenantId },
    });
    console.log(`[cleanup]   Tenant 删除 ${deletedCounts.tenants} 条`);

    // 2f. 兜底:清理 feishu_open_id 以 'k6-test-' 开头的孤儿用户(防止中途失败残留)
    const orphanUsers = await prisma.user.deleteMany({
      where: { feishuOpenId: { startsWith: TEST_USER_PREFIX } },
    });
    if (orphanUsers > 0) {
      console.log(`[cleanup]   孤儿 User(按 feishu_open_id 前缀)删除 ${orphanUsers} 条`);
      deletedCounts.users += orphanUsers;
    }

    // 3. 清理产物文件(可选,保留 tokens.json 供下次复用)
    // 注:tokens.json 与 seed-result.json 保留,因为 token 有效期 15 分钟,
    // 下次运行需重新 generate-tokens。这里仅清理 seed-result.json。
    if (existsSync(seedResultPath)) {
      await unlink(seedResultPath);
      console.log('[cleanup] 已删除 seed-result.json');
    }

    console.log('\n[cleanup] ✅ 测试数据清理完成');
    console.log(`[cleanup]   总耗时: ${Date.now() - startedAt}ms`);
    console.log('[cleanup]   删除统计:', deletedCounts);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[cleanup] 执行失败:', err);
  process.exit(1);
});
