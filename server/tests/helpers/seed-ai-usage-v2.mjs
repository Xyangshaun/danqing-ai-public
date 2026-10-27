import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

const SERVER_ROOT = '/var/www/danqing-ai/server';
function loadEnvFile(envPath) {
  const content = readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    value = value.replace(/\\n/g, '\n');
    if (!process.env[key]) process.env[key] = value;
  }
}
loadEnvFile(SERVER_ROOT + '/.env');

const prisma = new PrismaClient();

try {
  await prisma.aiUsageLog.deleteMany({});

  const user = await prisma.user.findFirst({ select: { id: true, tenantId: true } });
  if (!user) { console.error('NO_USER'); process.exit(1); }
  const TID = user.tenantId;
  const UID = user.id;

  const now = new Date();
  const h = (n) => new Date(now.getTime() - n * 3600 * 1000);
  const d = (n) => new Date(now.getTime() - n * 86400 * 1000);

  // 8条测试数据: 6成功+2失败
  // glm=5(4succ+1fail), aliyun=2(1succ+1fail), trae=1(1succ)
  // 4天数据: today5条 + yesterday1条 + dayBefore1条 + 5daysAgo1条
  const baseRows = [
    // Today (hours ago)
    { provider: 'glm', model: 'qwen-vl-plus', apiUrl: 'https://api.example.com/v1', success: true,  durationMs: 1200, promptTokens: 500, completionTokens: 200, totalTokens: 700,  costYuan: 0.000800, failureReason: null,    createdAt: now },
    { provider: 'glm', model: 'qwen-vl-plus', apiUrl: 'https://api.example.com/v1', success: true,  durationMs: 1500, promptTokens: 600, completionTokens: 300, totalTokens: 900,  costYuan: 0.001080, failureReason: null,    createdAt: h(1) },
    { provider: 'glm', model: 'qwen-vl-plus', apiUrl: 'https://api.example.com/v1', success: false, durationMs: 800,  promptTokens: 500, completionTokens: null,totalTokens: null, costYuan: null,     failureReason: 'timeout',createdAt: h(2) },
    { provider: 'aliyun', model: 'qwen-vl-max', apiUrl: 'https://api.aliyun.com/v1', success: true, durationMs: 2000, promptTokens: 800, completionTokens: 400, totalTokens: 1200, costYuan: 0.024000, failureReason: null,   createdAt: h(3) },
    { provider: 'aliyun', model: 'qwen-vl-max', apiUrl: 'https://api.aliyun.com/v1', success: false,durationMs: 1800, promptTokens: 700, completionTokens: null,totalTokens: null, costYuan: null,     failureReason: 'api_error',createdAt:h(4) },
    // Yesterday
    { provider: 'glm', model: 'qwen-vl-plus', apiUrl: 'https://api.example.com/v1', success: true,  durationMs: 1100, promptTokens: 400, completionTokens: 150, totalTokens: 550,  costYuan: 0.000620, failureReason: null,    createdAt: d(1) },
    // Day before yesterday
    { provider: 'glm', model: 'qwen-vl-plus', apiUrl: 'https://api.example.com/v1', success: true,  durationMs: 1300, promptTokens: 450, completionTokens: 180, totalTokens: 630,  costYuan: 0.000720, failureReason: null,    createdAt: d(2) },
    // 5 days ago
    { provider: 'trae', model: 'doubao-vision', apiUrl: 'https://api.trae.com/v1', success: true,  durationMs: 900,  promptTokens: 300, completionTokens: 450, totalTokens: 1450, costYuan: 0.021440, failureReason: null,   createdAt: d(5) },
  ];

  // Verify totals
  let sPT=0, sCT=0, sTT=0, sCost=0, sDur=0, sSucc=0, sFail=0;
  for (const r of baseRows) {
    sPT += r.promptTokens || 0;
    sCT += r.completionTokens || 0;
    sTT += r.totalTokens || 0;
    sCost += r.costYuan || 0;
    sDur += r.durationMs;
    if (r.success) sSucc++; else sFail++;
  }
  const avgDur = Math.round(sDur / baseRows.length);
  const succRate = sSucc / baseRows.length;
  console.error(`Expected: total=${baseRows.length} succ=${sSucc} fail=${sFail} rate=${succRate}`);
  console.error(`  pt=${sPT} ct=${sCT} tt=${sTT} cost=${sCost.toFixed(6)} avgDur=${avgDur}`);

  // Assert expected values
  const expected = { total: 8, succ: 6, fail: 2, rate: 0.75, pt: 4250, ct: 1680, tt: 5430, cost: 0.04866, avgDur: 1325 };
  const errors = [];
  if (baseRows.length !== expected.total) errors.push(`total=${baseRows.length}`);
  if (sSucc !== expected.succ) errors.push(`succ=${sSucc}`);
  if (sFail !== expected.fail) errors.push(`fail=${sFail}`);
  if (Math.abs(succRate - expected.rate) > 0.001) errors.push(`rate=${succRate}`);
  if (sPT !== expected.pt) errors.push(`pt=${sPT}`);
  if (sCT !== expected.ct) errors.push(`ct=${sCT}`);
  if (sTT !== expected.tt) errors.push(`tt=${sTT}`);
  if (Math.abs(sCost - expected.cost) > 0.0001) errors.push(`cost=${sCost.toFixed(6)}`);
  if (avgDur !== expected.avgDur) errors.push(`avgDur=${avgDur}`);
  if (errors.length > 0) {
    console.error('SEED DATA MISMATCH:', errors.join(', '));
    process.exit(1);
  }
  console.error('Seed data verification PASSED');

  for (const r of baseRows) {
    await prisma.aiUsageLog.create({
      data: { tenantId: TID, userId: UID, ...r },
    });
  }

  const cnt = await prisma.aiUsageLog.count();
  console.error('seeded', cnt, 'rows');
  console.log('SEED_OK', cnt);
} catch (e) {
  console.error('SEED_FAIL', e.message);
  console.log('SEED_FAIL', e.message);
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
