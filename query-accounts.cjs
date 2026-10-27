const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const users = await p.user.findMany({
    select: { email: true, name: true, role: true, authType: true, tenantId: true },
    orderBy: { createdAt: 'asc' },
  });
  console.log('===USERS===');
  users.forEach((u) => console.log([u.email, u.name, u.role, u.authType, u.tenantId].join('|')));
  const tenants = await p.tenant.findMany({
    select: { id: true, name: true, type: true, status: true },
    orderBy: { createdAt: 'asc' },
  });
  console.log('===TENANTS===');
  tenants.forEach((t) => console.log([t.id, t.name, t.type, t.status].join('|')));
  const members = await p.tenantMember.findMany({
    select: { tenantId: true, role: true, status: true, user: { select: { email: true } } },
  });
  console.log('===MEMBERS===');
  members.forEach((m) => console.log([m.tenantId, m.user.email, m.role, m.status].join('|')));
  const analyses = await p.analysis.groupBy({ by: ['userId', 'tenantId'], _count: true });
  console.log('===ANALYSIS-COUNT===');
  analyses.forEach((a) => console.log([a.userId, a.tenantId, a._count].join('|')));
  await p.$disconnect();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
