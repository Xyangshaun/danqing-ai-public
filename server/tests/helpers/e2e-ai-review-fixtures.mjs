// ============================================================
// E2E 夹具:为学生 seed-user-student-1 注入/清理一条 status=success 的分析
// 用途:student 只能为自己的 success 分析发起复核申请;真实 AI 分析链路较慢
//       且依赖外部 AI API,故直接插入一条 success 分析作为前置数据,
//       使 E2E 能跑通 "申请 → 通知 → 教师列表" 的真实 HTTP 全链路。
//
// 用法:
//   node tests/helpers/e2e-ai-review-fixtures.mjs setup     # 清理旧夹具 + 新建一条
//   node tests/helpers/e2e-ai-review-fixtures.mjs cleanup   # 仅清理夹具(分析+其争议)
//
// 幂等:按 title 前缀 "E2E-AI-REVIEW-FIXTURE" 识别夹具数据,可重复执行。
// ============================================================

import { PrismaClient } from '@prisma/client';
import crypto from 'node:crypto';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();
const BCRYPT_ROUNDS = 12;

const TENANT_ID = 'seed-tenant-school';
const USER_ID = 'seed-user-student-1';
const TITLE_PREFIX = 'E2E-AI-REVIEW-FIXTURE';

async function findFixtureAnalyses() {
  return prisma.analysis.findMany({
    where: { title: { startsWith: TITLE_PREFIX } },
    select: { id: true, title: true, status: true },
  });
}

async function cleanup() {
  const fixtures = await findFixtureAnalyses();
  let disputesDeleted = 0;
  for (const a of fixtures) {
    const dr = await prisma.disputeCase.deleteMany({
      where: { analysisId: a.id },
    });
    disputesDeleted += dr.count;
  }
  const ar = await prisma.analysis.deleteMany({
    where: { title: { startsWith: TITLE_PREFIX } },
  });
  console.log(
    `[fixture:cleanup] 删除 analyses=${ar.count} disputes=${disputesDeleted}`,
  );
}

async function setup() {
  // 先清理旧夹具(含其争议),保证每次一条干净的成功分析、无进行中争议
  await cleanup();

  const id = crypto.randomUUID();
  await prisma.analysis.create({
    data: {
      id,
      tenantId: TENANT_ID,
      userId: USER_ID,
      workType: 'painting',
      imageUrl: '/mock/e2e-ai-review-fixture.jpg',
      title: `${TITLE_PREFIX}-${id.slice(0, 8)}`,
      status: 'success',
      overallScore: 78,
      result: {
        overallScore: 78,
        summary: 'E2E 夹具:构图完整,色彩关系协调,用于复核申请全链路测试。',
        dimensions: {
          composition_form: { score: 72, level: 'qualified' },
          color: { score: 80, level: 'good' },
          technique: { score: 76, level: 'qualified' },
          overall: { score: 78, level: 'qualified' },
        },
      },
      completedAt: new Date(),
    },
  });
  console.log(`[fixture:setup] 已创建 success 分析 id=${id} tenant=${TENANT_ID} user=${USER_ID}`);
  // 打印纯 id 便于脚本捕获
  console.log(`ANALYSIS_ID=${id}`);
}

/**
 * 确保教师/管理员账号存在且密码为文档凭据
 * 现状诊断:seed-tenant-school 仅有 admin + 5 学生,缺 teacher@dq.edu
 *           (DB 来自更早 seed 版本,未含教师步骤);admin 密码哈希可能为旧值。
 * 处理:teacher@dq.edu 不存在则创建(upsert),admin@dq.edu 重置密码;
 *       教师补建 TenantMember(与 seed.ts 口径一致),保证 listByTenantAndRoles 能命中。
 */
async function resetAuth() {
  const teacherHash = await bcrypt.hash('Dq@Teacher2026', BCRYPT_ROUNDS);
  const teacher = await prisma.user.upsert({
    where: { email: 'teacher@dq.edu' },
    update: {
      passwordHash: teacherHash,
      authType: 'password',
      status: 'active',
      role: 'teacher',
      tenantId: TENANT_ID,
      name: '示范教师',
    },
    create: {
      id: 'seed-user-teacher',
      tenantId: TENANT_ID,
      authType: 'password',
      email: 'teacher@dq.edu',
      passwordHash: teacherHash,
      name: '示范教师',
      avatar: '',
      role: 'teacher',
      status: 'active',
    },
  });
  await prisma.tenantMember.upsert({
    where: { userId_tenantId: { userId: teacher.id, tenantId: TENANT_ID } },
    update: { role: 'teacher' },
    create: { userId: teacher.id, tenantId: TENANT_ID, role: 'teacher' },
  });
  console.log(`[fixture:reset-auth] teacher@dq.edu upsert ok id=${teacher.id}`);

  const adminHash = await bcrypt.hash('Dq@Admin2026', BCRYPT_ROUNDS);
  const adminRes = await prisma.user.updateMany({
    where: { email: 'admin@dq.edu' },
    data: { passwordHash: adminHash, authType: 'password', status: 'active' },
  });
  console.log(`[fixture:reset-auth] admin@dq.edu matched=${adminRes.count}`);
}

const cmd = process.argv[2] ?? 'setup';
try {
  if (cmd === 'cleanup') {
    await cleanup();
  } else if (cmd === 'reset-auth') {
    await resetAuth();
  } else if (cmd === 'diagnose') {
    const teachers = await prisma.user.findMany({
      where: { role: 'teacher' },
      select: { id: true, email: true, tenantId: true, authType: true, status: true, name: true },
    });
    console.log('[diagnose] role=teacher users:');
    for (const u of teachers) console.log('  ', JSON.stringify(u));
    const schoolUsers = await prisma.user.findMany({
      where: { tenantId: TENANT_ID },
      select: { id: true, email: true, role: true, authType: true, status: true, name: true },
    });
    console.log(`[diagnose] users in ${TENANT_ID}:`);
    for (const u of schoolUsers) console.log('  ', JSON.stringify(u));
  } else {
    await setup();
  }
} catch (e) {
  console.error('[fixture] failed:', e);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
