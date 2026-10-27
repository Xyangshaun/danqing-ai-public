import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

const SR = '/var/www/danqing-ai/server';
const content = readFileSync(SR + '/.env', 'utf-8');
for (const line of content.split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('=');
  if (i < 0) continue;
  const k = t.slice(0, i).trim();
  let v = t.slice(i + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  v = v.replace(/\\n/g, '\n');
  if (!process.env[k]) process.env[k] = v;
}

const p = new PrismaClient();
try {
  const [tot, succ, fail] = await Promise.all([
    p.aiUsageLog.count(),
    p.aiUsageLog.count({ where: { success: true } }),
    p.aiUsageLog.count({ where: { success: false } }),
  ]);
  console.log('DB: total=' + tot + ' succ=' + succ + ' fail=' + fail);
} catch (e) {
  console.error('ERR:', e.message);
  process.exit(1);
} finally {
  await p.$disconnect();
}
