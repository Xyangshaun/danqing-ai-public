const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const members = await p.tenantMember.findMany({
    select: { tenantId: true, role: true, joinedAt: true, user: { select: { email: true, name: true } } },
    orderBy: { joinedAt: 'asc' },
  });
  console.log('===MEMBERS===');
  members.forEach((m) => console.log([m.tenantId, m.user.email, m.user.name, m.role, m.joinedAt.toISOString()].join('|')));
  const analyses = await p.analysis.groupBy({ by: ['tenantId'], _count: true });
  console.log('===ANALYSIS-BY-TENANT===');
  analyses.forEach((a) => console.log([a.tenantId, a._count].join('|')));
  const messages = await p.classMessage.count();
  console.log('===CLASS-MESSAGES===', messages);
  await p.$disconnect();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
