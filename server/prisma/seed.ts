// ============================================================
// 丹青有AI - Prisma Seed 脚本(Phase 5)
// 注入 16 套内置评分预设(SEED_PRESETS)+ 3 套联考评分风格档案(SEED_GRADING_PROFILES,Phase 2)
//   + 28 张知识点卡片(SEED_KNOWLEDGE_CARDS,Phase 3 参考图混合方案)
//   - isBuiltIn=true, creatorId=null, tenantId=null(全局可见)
//   - 使用 upsert 按固定 id 幂等注入(可重复执行)
//   - 调用 validateSeedPresets()/validateSeedGradingProfiles()/validateSeedKnowledgeCards() 预校验
//
// 配置:package.json "prisma": { "seed": "tsx prisma/seed.ts" }
// 执行:`npx prisma db seed`
// ============================================================

import { PrismaClient, type ArtType, type PresetStyle, type PresetStage } from '@prisma/client';
import { SEED_PRESETS, validateSeedPresets } from '../src/seed/presets-data.js';
import {
  SEED_GRADING_PROFILES,
  validateSeedGradingProfiles,
} from '../src/seed/grading-profiles-data.js';
import {
  SEED_KNOWLEDGE_CARDS,
  validateSeedKnowledgeCards,
} from '../src/seed/knowledge-cards-data.js';
import { hashPassword } from '../src/utils/password.js';

const prisma = new PrismaClient();

/**
 * 将 SeedPreset 转换为 Prisma upsert 入参
 * 注意:dimensions 为 JSON 字段,直接传数组
 */
function toPresetCreateData(preset: (typeof SEED_PRESETS)[number]) {
  return {
    id: preset.id,
    name: preset.name,
    description: preset.description,
    styleType: preset.styleType as PresetStyle,
    artType: preset.artType as ArtType,
    dimensions: preset.dimensions,
    applicableStage: preset.applicableStage as PresetStage,
    isBuiltIn: true,
    isPrivate: false,
    forkedFromId: null,
    creatorId: null,
    tenantId: null,
    enabled: true,
    sortOrder: preset.sortOrder,
  };
}

async function main(): Promise<void> {
  // 1. 预校验:权重总和=100,维度数≥4
  const validation = validateSeedPresets();
  if (!validation.valid) {
    console.error('[seed] SEED_PRESETS 校验失败:');
    for (const e of validation.errors) {
      console.error('  -', e);
    }
    process.exit(1);
  }
  console.log(`[seed] 校验通过,共 ${SEED_PRESETS.length} 套预设待注入`);

  // 2. 幂等 upsert 注入(按固定 id)
  let inserted = 0;
  let updated = 0;
  for (const preset of SEED_PRESETS) {
    const result = await prisma.evaluationPreset.upsert({
      where: { id: preset.id },
      update: {
        // 仅更新可变字段(保留 isBuiltIn/creatorId/tenantId 不变)
        name: preset.name,
        description: preset.description,
        styleType: preset.styleType as PresetStyle,
        artType: preset.artType as ArtType,
        dimensions: preset.dimensions,
        applicableStage: preset.applicableStage as PresetStage,
        sortOrder: preset.sortOrder,
        enabled: true,
      },
      create: toPresetCreateData(preset),
    });
    // 区分新增 vs 更新:createdAt === updatedAt 视为新增(简化判断)
    if (result.createdAt.getTime() === result.updatedAt.getTime()) {
      inserted += 1;
    } else {
      updated += 1;
    }
  }

  console.log(`[seed] 注入完成:新增 ${inserted} 套,更新 ${updated} 套,总计 ${SEED_PRESETS.length} 套内置预设`);

  // 3. 评分风格档案(Phase 2 GradingProfile)预校验 + 幂等 upsert
  const gpValidation = validateSeedGradingProfiles();
  if (!gpValidation.valid) {
    console.error('[seed] SEED_GRADING_PROFILES 校验失败:');
    for (const e of gpValidation.errors) {
      console.error('  -', e);
    }
    process.exit(1);
  }
  console.log(`[seed] 档案校验通过,共 ${SEED_GRADING_PROFILES.length} 套评分风格档案待注入`);

  let gpInserted = 0;
  let gpUpdated = 0;
  for (const profile of SEED_GRADING_PROFILES) {
    const result = await prisma.gradingProfile.upsert({
      where: { id: profile.id },
      update: {
        // 仅更新可变字段(保留 isBuiltIn/creatorId/tenantId 不变,照 presets 模式)
        name: profile.name,
        description: profile.description,
        category: profile.category,
        config: profile.config,
        sortOrder: profile.sortOrder,
        enabled: true,
      },
      create: {
        id: profile.id,
        name: profile.name,
        description: profile.description,
        category: profile.category,
        config: profile.config,
        isBuiltIn: true,
        isDefault: false, // 系统预设不做租户默认(默认档案是租户级概念)
        forkedFromId: null,
        creatorId: null,
        tenantId: null,
        enabled: true,
        sortOrder: profile.sortOrder,
      },
    });
    if (result.createdAt.getTime() === result.updatedAt.getTime()) {
      gpInserted += 1;
    } else {
      gpUpdated += 1;
    }
  }

  console.log(
    `[seed] 档案注入完成:新增 ${gpInserted} 套,更新 ${gpUpdated} 套,总计 ${SEED_GRADING_PROFILES.length} 套评分风格档案`
  );

  // 4. 知识点卡片(Phase 3 KnowledgeCard)预校验 + 幂等 upsert
  const kcValidation = validateSeedKnowledgeCards();
  if (!kcValidation.valid) {
    console.error('[seed] SEED_KNOWLEDGE_CARDS 校验失败:');
    for (const e of kcValidation.errors) {
      console.error('  -', e);
    }
    process.exit(1);
  }
  console.log(`[seed] 卡片校验通过,共 ${SEED_KNOWLEDGE_CARDS.length} 张知识点卡片待注入`);

  let kcInserted = 0;
  let kcUpdated = 0;
  for (const card of SEED_KNOWLEDGE_CARDS) {
    const result = await prisma.knowledgeCard.upsert({
      where: { id: card.id },
      update: {
        // 仅更新可变内容字段;**不含 referenceAssets**(批次②预生成管线写回的
        // 分步图状态/URL 防止被 seed 抹掉)——relatedWorks 为 seed 维护的引用数据,随更新
        category: card.category,
        topic: card.topic,
        problemPattern: card.problemPattern,
        difficulty: card.difficulty,
        explanation: card.explanation,
        practiceDrill: card.practiceDrill,
        relatedWorks: card.relatedWorks,
        sortOrder: card.sortOrder,
        enabled: true,
      },
      create: {
        id: card.id,
        category: card.category,
        topic: card.topic,
        problemPattern: card.problemPattern,
        difficulty: card.difficulty,
        explanation: card.explanation,
        practiceDrill: card.practiceDrill,
        referenceAssets: card.referenceAssets, // 初始 pending(批次②生成后 DB 侧为 ready/partial)
        relatedWorks: card.relatedWorks,
        isBuiltIn: true,
        enabled: true,
        sortOrder: card.sortOrder,
      },
    });
    if (result.createdAt.getTime() === result.updatedAt.getTime()) {
      kcInserted += 1;
    } else {
      kcUpdated += 1;
    }
  }

  console.log(
    `[seed] 卡片注入完成:新增 ${kcInserted} 张,更新 ${kcUpdated} 张,总计 ${SEED_KNOWLEDGE_CARDS.length} 张知识点卡片`
  );
}

/**
 * 注入 DEV_SKIP_AUTH 开发模式 fixture(幂等 upsert)
 * 对应 auth.ts:DEV_USER_ID='dev-user' / DEV_TENANT_ID='dev-tenant' / DEV_ROLE='teacher'
 * 背景:全新数据库执行 seed 后,DEV_SKIP_AUTH 注入的 dev-user 在 User 表不存在,
 *       导致 /users/profile、/subscriptions/current 等端点 401/404。
 * 仅在开发/测试环境需要;生产环境 seed 无影响(记录幂等,内容固定)。
 */
async function seedDevFixtures(): Promise<void> {
  const now = new Date();
  const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  // 1. 开发测试租户(standard 计划,给足配额便于联调)
  await prisma.tenant.upsert({
    where: { id: 'dev-tenant' },
    update: {},
    create: {
      id: 'dev-tenant',
      name: '开发测试租户',
      type: 'individual',
      plan: 'standard',
      status: 'active',
      maxSeats: 5,
    },
  });

  // 2. 开发测试用户(与 auth.ts DEV_USER_ID/DEV_ROLE 一致)
  await prisma.user.upsert({
    where: { id: 'dev-user' },
    update: {},
    create: {
      id: 'dev-user',
      tenantId: 'dev-tenant',
      authType: 'feishu',
      feishuOpenId: 'dev-open-id',
      name: '开发测试用户',
      avatar: '',
      role: 'teacher',
      status: 'active',
    },
  });

  // 3. 租户成员关系(与 User.role 一致)
  await prisma.tenantMember.upsert({
    where: { userId_tenantId: { userId: 'dev-user', tenantId: 'dev-tenant' } },
    update: {},
    create: { userId: 'dev-user', tenantId: 'dev-tenant', role: 'teacher' },
  });

  // 4. 有效订阅(standard,保障 /subscriptions/current 与配额校验可用)
  const existingSub = await prisma.subscription.findFirst({
    where: { tenantId: 'dev-tenant', status: 'active' },
  });
  if (!existingSub) {
    await prisma.subscription.create({
      data: {
        tenantId: 'dev-tenant',
        plan: 'standard',
        status: 'active',
        periodStart: now,
        periodEnd,
        seats: 5,
      },
    });
  }

  console.log('[seed] dev fixtures 注入完成(dev-tenant / dev-user / teacher / standard 订阅)');
}

/**
 * 注入预置账号(幂等 upsert,生产可用)
 *
 * 设计:
 *   - 1 个院校管理员:admin@dq.edu / Dq@Admin2026
 *     · 创建 school 类型租户("丹青示范学院")
 *     · role=admin,authType=password
 *   - 5 个测试学生:test1-5@dq.edu / Dq@Test2026
 *     · 加入管理员所在租户
 *     · role=student,authType=password
 *
 * 注意:
 *   - 密码用 bcrypt(salt rounds=12)哈希,与生产 auth.service.registerAccount 一致
 *   - upsert by email(数据库 email 字段唯一索引)
 *   - 重复执行不会重新哈希密码(仅在新建时哈希;update 路径不修改 passwordHash,
 *     避免重复哈希导致哈希漂移)
 */
async function seedAccounts(): Promise<void> {
  console.log('[seed] 开始注入预置账号...');

  // ---------- 1. 管理员租户(school 类型,代表院校) ----------
  const adminTenantId = 'seed-tenant-school';
  await prisma.tenant.upsert({
    where: { id: adminTenantId },
    update: {
      name: '丹青示范学院',
      type: 'school',
      plan: 'enterprise',
      status: 'active',
      maxSeats: 100,
    },
    create: {
      id: adminTenantId,
      name: '丹青示范学院',
      type: 'school',
      plan: 'enterprise',
      status: 'active',
      maxSeats: 100,
    },
  });

  // ---------- 2. 管理员账号 ----------
  const adminEmail = 'admin@dq.edu';
  const adminPasswordHash = await hashPassword('Dq@Admin2026');
  await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      // 已存在则不修改密码(避免哈希漂移);仅修正关键字段
      // 注意:不重置 tenantId —— 它是用户运行时激活租户(如切换到班级空间),
      // 重复跑 seed 若强制重置会把用户的班级激活状态打回初始租户,
      // 导致学生后续分析挂错租户、教师班级看不到作品(2026-09-18 数据互通事故根因)
      authType: 'password',
      role: 'admin',
      name: '系统管理员',
      status: 'active',
    },
    create: {
      id: 'seed-user-admin',
      tenantId: adminTenantId,
      authType: 'password',
      email: adminEmail,
      passwordHash: adminPasswordHash,
      name: '系统管理员',
      avatar: '',
      role: 'admin',
      status: 'active',
    },
  });
  // 租户成员关系
  await prisma.tenantMember.upsert({
    where: { userId_tenantId: { userId: 'seed-user-admin', tenantId: adminTenantId } },
    update: { role: 'admin' },
    create: { userId: 'seed-user-admin', tenantId: adminTenantId, role: 'admin' },
  });

  // ---------- 3. 5 个测试学生账号 ----------
  const studentPasswordHash = await hashPassword('Dq@Test2026');
  const studentNames = ['张同学', '李同学', '王同学', '赵同学', '钱同学'];

  for (let i = 1; i <= 5; i += 1) {
    const email = `test${i}@dq.edu`;
    const userId = `seed-user-student-${i}`;
    const name = studentNames[i - 1];

    await prisma.user.upsert({
      where: { email },
      update: {
        // 已存在则修正关键字段(不修改密码)
        // 不重置 tenantId(用户可能已通过班级邀请码切换激活租户,重置会断开师生数据互通)
        authType: 'password',
        role: 'student',
        name,
        status: 'active',
      },
      create: {
        id: userId,
        tenantId: adminTenantId,
        authType: 'password',
        email,
        passwordHash: studentPasswordHash,
        name,
        avatar: '',
        role: 'student',
        status: 'active',
      },
    });

    await prisma.tenantMember.upsert({
      where: { userId_tenantId: { userId, tenantId: adminTenantId } },
      update: { role: 'student' },
      create: { userId, tenantId: adminTenantId, role: 'student' },
    });
  }

  // ---------- 4. 院校订阅(premium,长期有效) ----------
  const existingSchoolSub = await prisma.subscription.findFirst({
    where: { tenantId: adminTenantId, status: 'active' },
  });
  if (!existingSchoolSub) {
    const now = new Date();
    const periodEnd = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000); // 1 年
    await prisma.subscription.create({
      data: {
        tenantId: adminTenantId,
        plan: 'enterprise',
        status: 'active',
        periodStart: now,
        periodEnd,
        seats: 100,
      },
    });
  }

  // ---------- 5. 教师账号(示范教师,加入丹青示范学院) ----------
  const teacherEmail = 'teacher@dq.edu';
  const teacherPasswordHash = await hashPassword('Dq@Teacher2026');
  await prisma.user.upsert({
    where: { email: teacherEmail },
    update: {
      // 已存在则修正关键字段(不修改密码,避免哈希漂移)
      // 不重置 tenantId(教师可能已切换激活租户,重置会造成数据错位)
      authType: 'password',
      role: 'teacher',
      name: '示范教师',
      status: 'active',
    },
    create: {
      id: 'seed-user-teacher',
      tenantId: adminTenantId,
      authType: 'password',
      email: teacherEmail,
      passwordHash: teacherPasswordHash,
      name: '示范教师',
      avatar: '',
      role: 'teacher',
      status: 'active',
    },
  });
  await prisma.tenantMember.upsert({
    where: { userId_tenantId: { userId: 'seed-user-teacher', tenantId: adminTenantId } },
    update: { role: 'teacher' },
    create: { userId: 'seed-user-teacher', tenantId: adminTenantId, role: 'teacher' },
  });

  // ---------- 6. 二级只读管理员(加入丹青示范学院) ----------
  // 注意:不修改权限模型(role=admin 拥有完整 admin:* 权限),
  //       "只读"限制由前端隐藏操作按钮实现(轻量方案,用户已确认)
  const subadminEmail = 'subadmin@dq.edu';
  const subadminPasswordHash = await hashPassword('Dq@SubAdmin2026');
  await prisma.user.upsert({
    where: { email: subadminEmail },
    update: {
      // 不重置 tenantId(保护用户激活租户状态)
      authType: 'password',
      role: 'admin',
      name: '二级管理员(只读)',
      status: 'active',
    },
    create: {
      id: 'seed-user-subadmin',
      tenantId: adminTenantId,
      authType: 'password',
      email: subadminEmail,
      passwordHash: subadminPasswordHash,
      name: '二级管理员(只读)',
      avatar: '',
      role: 'admin',
      status: 'active',
    },
  });
  await prisma.tenantMember.upsert({
    where: { userId_tenantId: { userId: 'seed-user-subadmin', tenantId: adminTenantId } },
    update: { role: 'admin' },
    create: { userId: 'seed-user-subadmin', tenantId: adminTenantId, role: 'admin' },
  });

  // ---------- 7. 超级管理员账号(全平台视图,role=owner) ----------
  // 用于管理后台查看全部租户用户数据,突破租户隔离限制
  const superAdminTenantId = 'seed-tenant-superadmin';
  await prisma.tenant.upsert({
    where: { id: superAdminTenantId },
    update: {
      name: '丹青平台运营',
      type: 'school',
      plan: 'enterprise',
      status: 'active',
      maxSeats: 10,
    },
    create: {
      id: superAdminTenantId,
      name: '丹青平台运营',
      type: 'school',
      plan: 'enterprise',
      status: 'active',
      maxSeats: 10,
    },
  });

  const superAdminEmail = 'superadmin@dq.edu';
  const superAdminPasswordHash = await hashPassword('Dq@SuperAdmin2026');
  await prisma.user.upsert({
    where: { email: superAdminEmail },
    update: {
      // 不重置 tenantId(保护用户激活租户状态)
      authType: 'password',
      role: 'owner',
      name: '超级管理员',
      status: 'active',
    },
    create: {
      id: 'seed-user-superadmin',
      tenantId: superAdminTenantId,
      authType: 'password',
      email: superAdminEmail,
      passwordHash: superAdminPasswordHash,
      name: '超级管理员',
      avatar: '',
      role: 'owner',
      status: 'active',
    },
  });
  await prisma.tenantMember.upsert({
    where: { userId_tenantId: { userId: 'seed-user-superadmin', tenantId: superAdminTenantId } },
    update: { role: 'owner' },
    create: { userId: 'seed-user-superadmin', tenantId: superAdminTenantId, role: 'owner' },
  });

  // 超级管理员租户订阅(enterprise,长期有效)
  const existingSuperAdminSub = await prisma.subscription.findFirst({
    where: { tenantId: superAdminTenantId, status: 'active' },
  });
  if (!existingSuperAdminSub) {
    const now = new Date();
    const periodEnd = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000); // 1 年
    await prisma.subscription.create({
      data: {
        tenantId: superAdminTenantId,
        plan: 'enterprise',
        status: 'active',
        periodStart: now,
        periodEnd,
        seats: 10,
      },
    });
  }

  // ---------- 8. 企业账号(独立租户 + enterprise 订阅) ----------
  // 租户类型枚举仅 school/college/class/individual,组织级租户统一用 school
  const enterpriseTenantId = 'seed-tenant-enterprise';
  await prisma.tenant.upsert({
    where: { id: enterpriseTenantId },
    update: {
      name: '丹青创意科技',
      type: 'school',
      plan: 'enterprise',
      status: 'active',
      maxSeats: 50,
    },
    create: {
      id: enterpriseTenantId,
      name: '丹青创意科技',
      type: 'school',
      plan: 'enterprise',
      status: 'active',
      maxSeats: 50,
    },
  });

  const enterpriseEmail = 'enterprise@dq.edu';
  const enterprisePasswordHash = await hashPassword('Dq@Enterprise2026');
  await prisma.user.upsert({
    where: { email: enterpriseEmail },
    update: {
      // 不重置 tenantId(保护用户激活租户状态)
      authType: 'password',
      role: 'owner',
      name: '企业管理员',
      status: 'active',
    },
    create: {
      id: 'seed-user-enterprise',
      tenantId: enterpriseTenantId,
      authType: 'password',
      email: enterpriseEmail,
      passwordHash: enterprisePasswordHash,
      name: '企业管理员',
      avatar: '',
      role: 'owner',
      status: 'active',
    },
  });
  await prisma.tenantMember.upsert({
    where: { userId_tenantId: { userId: 'seed-user-enterprise', tenantId: enterpriseTenantId } },
    update: { role: 'owner' },
    create: { userId: 'seed-user-enterprise', tenantId: enterpriseTenantId, role: 'owner' },
  });

  // 企业租户订阅(enterprise,1 年有效期,seats=50;参考院校订阅写法,幂等)
  const existingEnterpriseSub = await prisma.subscription.findFirst({
    where: { tenantId: enterpriseTenantId, status: 'active' },
  });
  if (!existingEnterpriseSub) {
    const now = new Date();
    const periodEnd = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000); // 1 年
    await prisma.subscription.create({
      data: {
        tenantId: enterpriseTenantId,
        plan: 'enterprise',
        status: 'active',
        periodStart: now,
        periodEnd,
        seats: 50,
      },
    });
  }

  console.log(
    '[seed] 预置账号注入完成:\n' +
      '  - 管理员    admin@dq.edu        (丹青示范学院, admin)\n' +
      '  - 学生      test1-5@dq.edu      (丹青示范学院, student × 5)\n' +
      '  - 教师      teacher@dq.edu      (丹青示范学院, teacher)\n' +
      '  - 二级管理  subadmin@dq.edu     (丹青示范学院, admin, 只读由前端隐藏按钮实现)\n' +
      '  - 超级管理  superadmin@dq.edu   (丹青平台运营, owner, 全平台用户视图)\n' +
      '  - 企业      enterprise@dq.edu   (丹青创意科技, owner, enterprise 订阅 seats=50)'
  );
}

main()
  .then(async () => {
    await seedDevFixtures();
    await seedAccounts();
    console.log('[seed] done');
  })
  .catch((err) => {
    console.error('[seed] failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
