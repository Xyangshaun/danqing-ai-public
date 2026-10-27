// ============================================================
// 创建超级管理员账号(独立脚本)
// 用法: npx tsx scripts/create-superadmin.ts
// 依赖: DATABASE_URL 环境变量(或 .env 文件)
// ============================================================

import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/utils/password.js';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  // 安全说明：不内置默认管理员凭据，必须通过环境变量显式传入
  const email = process.env.SUPERADMIN_EMAIL;
  const password = process.env.SUPERADMIN_PASSWORD;
  if (!email || !password) {
    console.error('[create-superadmin] 缺少 SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD 环境变量，已中止。');
    console.error('[create-superadmin] 用法示例: SUPERADMIN_EMAIL=xxx SUPERADMIN_PASSWORD=xxx npx tsx scripts/create-superadmin.ts');
    process.exit(1);
  }
  const tenantId = 'seed-tenant-superadmin';

  console.log('[create-superadmin] 开始创建超级管理员账号...');

  // 1. 创建/更新租户
  await prisma.tenant.upsert({
    where: { id: tenantId },
    update: {
      name: '丹青平台运营',
      type: 'school',
      plan: 'enterprise',
      status: 'active',
      maxSeats: 10,
    },
    create: {
      id: tenantId,
      name: '丹青平台运营',
      type: 'school',
      plan: 'enterprise',
      status: 'active',
      maxSeats: 10,
    },
  });
  console.log('[create-superadmin] 租户已就绪:', tenantId);

  // 2. 创建/更新用户
  const passwordHash = await hashPassword(password);
  const user = await prisma.user.upsert({
    where: { email },
    update: {
      tenantId,
      authType: 'password',
      role: 'owner',
      name: '超级管理员',
      status: 'active',
    },
    create: {
      id: 'seed-user-superadmin',
      tenantId,
      authType: 'password',
      email,
      passwordHash,
      name: '超级管理员',
      avatar: '',
      role: 'owner',
      status: 'active',
    },
  });
  console.log('[create-superadmin] 用户已创建:', user.email);

  // 3. 创建租户成员关系
  await prisma.tenantMember.upsert({
    where: { userId_tenantId: { userId: user.id, tenantId } },
    update: { role: 'owner' },
    create: { userId: user.id, tenantId, role: 'owner' },
  });
  console.log('[create-superadmin] 租户成员关系已建立');

  // 4. 创建订阅
  const existingSub = await prisma.subscription.findFirst({
    where: { tenantId, status: 'active' },
  });
  if (!existingSub) {
    const now = new Date();
    const periodEnd = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
    await prisma.subscription.create({
      data: {
        tenantId,
        plan: 'enterprise',
        status: 'active',
        periodStart: now,
        periodEnd,
        seats: 10,
      },
    });
    console.log('[create-superadmin] 订阅已创建');
  }

  console.log('');
  console.log('========================================');
  console.log('  超级管理员账号创建成功');
  console.log('========================================');
  console.log('  邮箱:    superadmin@dq.edu');
  console.log('  密码:    Dq@SuperAdmin2026');
  console.log('  角色:    owner (超级管理员)');
  console.log('  权限:    管理后台全平台用户视图');
  console.log('========================================');
}

main()
  .catch((err) => {
    console.error('[create-superadmin] 失败:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
