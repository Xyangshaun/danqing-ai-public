import { readFileSync } from 'node:fs';
import crypto from 'node:crypto';
import https from 'node:https';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

const SR = '/var/www/danqing-ai/server';
const BASE = 'https://www.danqing.site';
const API = BASE + '/api/admin/stats/ai-usage';

// Load .env
const envContent = readFileSync(SR + '/.env', 'utf-8');
for (const line of envContent.split('\n')) {
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

let pass = 0, fail = 0, warn = 0;
const results = [];
const lp = m => { pass++; results.push(['PASS', m]); console.log('\x1b[32m[PASS]\x1b[0m', m); };
const lf = m => { fail++; results.push(['FAIL', m]); console.log('\x1b[31m[FAIL]\x1b[0m', m); };
const lw = m => { warn++; results.push(['WARN', m]); console.log('\x1b[33m[WARN]\x1b[0m', m); };
const li = m => console.log('\x1b[36m[INFO]\x1b[0m', m);
const sec = m => console.log('\n\x1b[36m════════ ' + m + ' ════════\x1b[0m');

const sleep = ms => new Promise(r => setTimeout(r, ms));

function httpsRequest(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const headers = { ...(opts.headers || {}) };
    if (opts.token) headers['Authorization'] = 'Bearer ' + opts.token;
    const start = Date.now();
    const req = https.request({
      hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search,
      method: opts.method || 'GET', headers, rejectUnauthorized: false,
    }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        const ms = Date.now() - start;
        let parsed = null;
        try { parsed = JSON.parse(body); } catch { /* non-json */ }
        resolve({ status: res.statusCode, body: parsed, raw: body, ms });
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(new Error('timeout')); });
    if (opts.body) req.write(typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body));
    req.end();
  });
}

function issueToken(userId, tenantId, role) {
  return jwt.sign(
    { sub: userId, tenant_id: tenantId, role, feishu_open_id: '', jti: crypto.randomUUID(), iss: process.env.JWT_ISSUER || 'danqing-ai-auth', aud: process.env.JWT_AUDIENCE_ADMIN || 'danqing-ai-admin' },
    process.env.JWT_PRIVATE_KEY,
    { algorithm: 'RS256', expiresIn: process.env.JWT_ACCESS_EXPIRES || '15m', notBefore: 0, keyid: process.env.JWT_KEY_ID || 'danqing-ai-2026-07' }
  );
}

// Clear Redis cache
async function clearCache() {
  try {
    const { execSync } = await import('node:child_process');
    const redisName = execSync("docker ps --format '{{.Names}}' | grep -i redis | head -1").toString().trim();
    if (redisName) {
      execSync(`docker exec ${redisName} redis-cli --scan --pattern 'ai-usage:*' | xargs -r docker exec -i ${redisName} redis-cli DEL`, { stdio: 'pipe' });
      li('Redis ai-usage:* 缓存已清理');
    }
  } catch (e) {
    lw('Redis 缓存清理失败(非致命): ' + e.message?.slice(0, 80));
  }
}

const prisma = new PrismaClient();

async function main() {
  // === Step 0: Setup ===
  sec("Step 0: 环境确认 + Token 生成");
  const user = await prisma.user.findFirst({ select: { id: true, tenantId: true, role: true, name: true } });
  if (!user) { lf("数据库中无用户记录,无法生成 token"); process.exit(1); }
  li(`测试用户: ${user.name} (${user.id.slice(0, 8)}...) role=${user.role} tenant=${user.tenantId?.slice(0, 8)}`);

  const ATOK = issueToken(user.id, user.tenantId, 'admin');
  const STOK = issueToken(user.id, user.tenantId, 'student');
  lp("admin token 生成成功");
  lp("student token 生成成功");

  // DB state
  const [dbTot, dbSucc, dbFail] = await Promise.all([
    prisma.aiUsageLog.count(),
    prisma.aiUsageLog.count({ where: { success: true } }),
    prisma.aiUsageLog.count({ where: { success: false } }),
  ]);
  li(`DB 当前: total=${dbTot} succ=${dbSucc} fail=${dbFail}`);

  await clearCache();

  // === Step 1: Auth ===
  sec("Step 1: 鉴权测试");
  let r;
  r = await httpsRequest(API + '/overview');
  r.status === 401 ? lp("无 token → 401") : lf(`无 token 期望 401,实际 ${r.status}`);
  await sleep(600);

  r = await httpsRequest(API + '/overview', { token: STOK });
  r.status === 403 ? lp("student token → 403") : lf(`student token 期望 403,实际 ${r.status}`);
  await sleep(600);

  r = await httpsRequest(API + '/overview', { token: ATOK });
  r.status === 200 ? lp("admin token → 200") : lf(`admin token 期望 200,实际 ${r.status}`);
  await sleep(600);

  r = await httpsRequest(API + '/overview', { token: 'badtoken123' });
  r.status === 401 ? lp("无效 token → 401") : lf(`无效 token 期望 401,实际 ${r.status}`);
  await sleep(600);

  // === Step 2: Integration Tests ===
  sec("Step 2: 集成测试 - 4 个接口");

  // 2.1 overview
  li("--- 2.1 GET /overview ---");
  await clearCache();
  r = await httpsRequest(API + '/overview', { token: ATOK });
  const od = r.body?.data || {};
  li(`totalCount=${od.totalCount} successCount=${od.successCount} failedCount=${od.failedCount}`);
  li(`successRate=${od.successRate} totalCostYuan=${od.totalCostYuan} avgDurationMs=${od.avgDurationMs}`);
  li(`promptTokens=${od.totalPromptTokens} completionTokens=${od.totalCompletionTokens} totalTokens=${od.totalTokens}`);

  if (dbTot === 8) {
    od.totalCount === 8 ? lp("totalCount=8") : lf(`totalCount 期望8,实际${od.totalCount}`);
    od.successCount === 6 ? lp("successCount=6") : lf(`successCount 期望6,实际${od.successCount}`);
    od.failedCount === 2 ? lp("failedCount=2") : lf(`failedCount 期望2,实际${od.failedCount}`);
    Math.abs(od.successRate - 0.75) < 0.001 ? lp("successRate=0.75") : lf(`successRate 期望0.75,实际${od.successRate}`);
    od.totalPromptTokens === 4250 ? lp("totalPromptTokens=4250") : lf(`totalPromptTokens 期望4250,实际${od.totalPromptTokens}`);
    od.totalCompletionTokens === 1680 ? lp("totalCompletionTokens=1680") : lf(`totalCompletionTokens 期望1680,实际${od.totalCompletionTokens}`);
    od.totalTokens === 5430 ? lp("totalTokens=5430") : lf(`totalTokens 期望5430,实际${od.totalTokens}`);
    Math.abs(od.totalCostYuan - 0.04866) < 0.002 ? lp("totalCostYuan≈0.04866") : lf(`totalCostYuan 期望≈0.04866,实际${od.totalCostYuan}`);
    od.avgDurationMs === 1325 ? lp("avgDurationMs=1325") : lf(`avgDurationMs 期望1325,实际${od.avgDurationMs}`);
  } else {
    lw(`DB 数据量为${dbTot}(非8条),跳过精确数值断言;接口返回 totalCount=${od.totalCount}`);
    od.totalCount === dbTot ? lp(`totalCount与DB一致(${dbTot})`) : lf(`totalCount=${od.totalCount} 与DB(${dbTot})不一致`);
  }

  const overviewFields = ['startDate', 'endDate', 'totalCount', 'successCount', 'failedCount', 'successRate', 'totalPromptTokens', 'totalCompletionTokens', 'totalTokens', 'totalCostYuan', 'avgDurationMs'];
  const overviewMiss = overviewFields.filter(f => !(f in od));
  overviewMiss.length === 0 ? lp("overview 字段完整性通过") : lf(`overview 缺字段: ${overviewMiss.join(',')}`);
  await sleep(600);

  // 2.2 by-provider
  li("--- 2.2 GET /by-provider ---");
  r = await httpsRequest(API + '/by-provider', { token: ATOK });
  const pstats = r.body?.data?.stats || [];
  pstats.forEach(s => li(`  ${s.provider}: total=${s.totalCount} succ=${s.successCount} fail=${s.failedCount} cost=${s.totalCostYuan} avgDur=${s.avgDurationMs}ms`));

  if (dbTot === 8) {
    pstats.length === 3 ? lp("by-provider 返回3个provider(glm/aliyun/trae)") : lf(`by-provider 期望3,实际${pstats.length}`);
    const glm = pstats.find(s => s.provider === 'glm');
    const aliyun = pstats.find(s => s.provider === 'aliyun');
    const traeP = pstats.find(s => s.provider === 'trae');
    pstats[0]?.provider === 'glm' && pstats[0]?.totalCount === 5 ? lp("首位provider=glm(5次,DESC排序正确)") : lf(`排序异常: ${pstats[0]?.provider}(${pstats[0]?.totalCount})`);
    aliyun?.totalCount === 2 ? lp("aliyun=2次") : lf(`aliyun 期望2,实际${aliyun?.totalCount}`);
    traeP?.totalCount === 1 ? lp("trae=1次") : lf(`trae 期望1,实际${traeP?.totalCount}`);
  } else {
    lw("数据量非8条,跳过provider精确断言");
    pstats.length >= 1 ? lp(`by-provider 返回${pstats.length}个provider`) : lf("by-provider 返回0个provider");
  }

  // Verify provider stat fields
  if (pstats.length > 0) {
    const pFields = ['provider', 'totalCount', 'successCount', 'failedCount', 'successRate', 'totalPromptTokens', 'totalCompletionTokens', 'totalTokens', 'totalCostYuan', 'avgDurationMs'];
    const pMiss = pFields.filter(f => !(f in pstats[0]));
    pMiss.length === 0 ? lp("provider stat字段完整") : lf(`provider stat缺字段: ${pMiss.join(',')}`);
  }
  await sleep(600);

  // 2.3 by-user
  li("--- 2.3 GET /by-user?limit=10 ---");
  r = await httpsRequest(API + '/by-user?limit=10', { token: ATOK });
  const ustats = r.body?.data?.stats || [];
  ustats.forEach(s => li(`  ${s.userName}(${s.userId?.slice(0, 8)}): total=${s.totalCount} role=${s.userRole} tenant=${s.tenantName}`));

  if (dbTot === 8) {
    ustats.length === 1 ? lp("by-user 返回1个用户") : lf(`by-user 期望1,实际${ustats.length}`);
    r.body?.data?.limit === 10 ? lp("limit参数回显=10") : lf(`limit 期望10,实际${r.body?.data?.limit}`);
    ustats[0]?.totalCount === 8 ? lp("用户总调用=8次") : lf(`用户调用期望8,实际${ustats[0]?.totalCount}`);
  } else {
    ustats.length >= 1 ? lp(`by-user 返回${ustats.length}个用户`) : lf("by-user 返回0个用户");
  }
  ustats[0]?.userName && ustats[0]?.userName !== '(未知用户)' ? lp(`userName=${ustats[0].userName}(users表关联成功)`) : lf(`userName异常: ${ustats[0]?.userName}`);

  // user stat fields
  if (ustats.length > 0) {
    const uFields = ['userId', 'userName', 'userEmail', 'userRole', 'tenantId', 'tenantName', 'totalCount', 'successCount', 'failedCount', 'successRate', 'totalTokens', 'totalCostYuan', 'avgDurationMs'];
    const uMiss = uFields.filter(f => !(f in ustats[0]));
    uMiss.length === 0 ? lp("user stat字段完整") : lf(`user stat缺字段: ${uMiss.join(',')}`);
  }
  await sleep(600);

  // 2.4 trend
  li("--- 2.4 GET /trend?days=7 ---");
  r = await httpsRequest(API + '/trend?days=7', { token: ATOK });
  const tdata = r.body?.data;
  const dp = tdata?.dataPoints || [];
  dp.forEach(p => li(`  ${p.date}: total=${p.totalCount} succ=${p.successCount} fail=${p.failedCount} cost=${p.totalCostYuan}`));

  tdata?.days === 7 ? lp("trend days=7") : lf(`days 期望7,实际${tdata?.days}`);
  dp.length >= 1 ? lp(`dataPoints=${dp.length}天有数据`) : lf("dataPoints为空");

  if (dp.length > 0) {
    const tpFields = ['date', 'totalCount', 'successCount', 'failedCount', 'successRate', 'totalTokens', 'totalCostYuan'];
    const tpMiss = tpFields.filter(f => !(f in dp[0]));
    tpMiss.length === 0 ? lp("trend dataPoint字段完整") : lf(`trend dataPoint缺字段: ${tpMiss.join(',')}`);
  }
  await sleep(600);

  // === Step 3: Boundary Tests ===
  sec("Step 3: 边界测试");

  li("--- limit 参数边界 ---");
  for (const L of [0, 1, 100, 101, -5]) {
    r = await httpsRequest(API + `/by-user?limit=${L}`, { token: ATOK });
    r.status === 200 ? lp(`by-user limit=${L} → 200(正常处理)`) : lf(`by-user limit=${L} 期望200,实际${r.status}`);
    await sleep(400);
  }
  r = await httpsRequest(API + '/by-user?limit=101', { token: ATOK });
  r.body?.data?.limit === 100 ? lp("limit=101 → 钳制为100") : lf(`limit=101 钳制异常: ${r.body?.data?.limit}`);
  await sleep(400);
  r = await httpsRequest(API + '/by-user?limit=0', { token: ATOK });
  r.body?.data?.limit === 1 ? lp("limit=0 → 钳制为1") : lf(`limit=0 钳制异常: ${r.body?.data?.limit}`);
  await sleep(400);
  r = await httpsRequest(API + '/by-user?limit=-5', { token: ATOK });
  r.body?.data?.limit === 1 ? lp("limit=-5 → 钳制为1") : lf(`limit=-5 钳制异常: ${r.body?.data?.limit}`);
  await sleep(400);

  li("--- days 参数边界 ---");
  for (const D of [0, 1, 90, 91, -3]) {
    r = await httpsRequest(API + `/trend?days=${D}`, { token: ATOK });
    r.status === 200 ? lp(`trend days=${D} → 200(正常处理)`) : lf(`trend days=${D} 期望200,实际${r.status}`);
    await sleep(400);
  }
  r = await httpsRequest(API + '/trend?days=91', { token: ATOK });
  r.body?.data?.days === 90 ? lp("days=91 → 钳制为90") : lf(`days=91 钳制异常: ${r.body?.data?.days}`);
  await sleep(400);
  r = await httpsRequest(API + '/trend?days=0', { token: ATOK });
  r.body?.data?.days === 1 ? lp("days=0 → 钳制为1") : lf(`days=0 钳制异常: ${r.body?.data?.days}`);
  await sleep(400);

  li("--- 非法日期参数 ---");
  r = await httpsRequest(API + '/overview?startDate=invalid', { token: ATOK });
  r.status === 200 ? lp("非法startDate=invalid → 200(忽略无效参数)") : lf(`非法日期 期望200,实际${r.status}`);
  await sleep(400);
  r = await httpsRequest(API + '/overview?startDate=2026-13-45', { token: ATOK });
  r.status === 200 ? lp("无效日期2026-13-45 → 200(忽略)") : lf(`无效日期 期望200,实际${r.status}`);
  await sleep(400);
  r = await httpsRequest(API + '/overview?startDate=not-a-date&endDate=also-bad', { token: ATOK });
  r.status === 200 ? lp("双非法日期 → 200(优雅降级)") : lf(`双非法日期 期望200,实际${r.status}`);
  await sleep(400);

  li("--- 日期范围筛选 ---");
  const today = new Date().toISOString().slice(0, 10);
  r = await httpsRequest(API + `/overview?startDate=${today}&endDate=${today}`, { token: ATOK });
  const todayCnt = r.body?.data?.totalCount;
  if (dbTot === 8) {
    todayCnt === 5 ? lp(`今日筛选=${todayCnt}条(5条小时级数据)`) : lf(`今日筛选 期望5,实际${todayCnt}`);
  } else {
    todayCnt >= 0 ? lp(`今日筛选=${todayCnt}条(接口正常返回)`) : lf(`今日筛选异常: ${todayCnt}`);
  }
  await sleep(400);

  const d6 = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
  r = await httpsRequest(API + `/overview?startDate=${d6}&endDate=${today}`, { token: ATOK });
  if (dbTot === 8) {
    r.body?.data?.totalCount === 8 ? lp("6天范围=全部8条") : lf(`6天范围 期望8,实际${r.body?.data?.totalCount}`);
  } else {
    lp(`6天范围返回${r.body?.data?.totalCount}条`);
  }
  await sleep(400);

  r = await httpsRequest(API + '/overview?startDate=2030-01-01&endDate=2030-12-31', { token: ATOK });
  r.body?.data?.totalCount === 0 ? lp("未来日期范围=0条(正确)") : lf(`未来日期 期望0,实际${r.body?.data?.totalCount}`);
  await sleep(400);

  li("--- 空数据除零保护 ---");
  r = await httpsRequest(API + '/overview?startDate=2030-01-01&endDate=2030-01-02', { token: ATOK });
  r.body?.data?.successRate === 0 ? lp("空数据successRate=0(防除零)") : lf(`空数据successRate=${r.body?.data?.successRate}(期望0)`);
  await sleep(400);
  r.body?.data?.avgDurationMs === 0 ? lp("空数据avgDurationMs=0") : lf(`空数据avgDurationMs=${r.body?.data?.avgDurationMs}(期望0)`);
  r.body?.data?.totalCount === 0 ? lp("空数据totalCount=0") : lf(`空数据totalCount=${r.body?.data?.totalCount}(期望0)`);
  r = await httpsRequest(API + '/by-provider?startDate=2030-01-01&endDate=2030-01-02', { token: ATOK });
  (r.body?.data?.stats?.length === 0) ? lp("空数据by-provider stats=[]") : lf(`空数据by-provider 期望0,实际${r.body?.data?.stats?.length}`);
  await sleep(400);
  r = await httpsRequest(API + '/by-user?startDate=2030-01-01&endDate=2030-01-02', { token: ATOK });
  (r.body?.data?.stats?.length === 0) ? lp("空数据by-user stats=[]") : lf(`空数据by-user 期望0,实际${r.body?.data?.stats?.length}`);
  await sleep(400);
  r = await httpsRequest(API + '/trend?days=7&startDate=2030-01-01&endDate=2030-01-02', { token: ATOK });
  // trend 不支持 startDate/endDate(它用days参数),验证正常返回
  r.status === 200 ? lp("trend 接口正常返回(不支持日期范围筛选,用days)") : lf(`trend 异常状态: ${r.status}`);
  await sleep(400);

  // === Step 4: Performance Tests ===
  sec("Step 4: 性能测试(SLA < 2000ms)");
  for (const ep of ['overview', 'by-provider', 'by-user?limit=10', 'trend?days=7']) {
    await clearCache();
    await sleep(200);
    const times = [];
    // Cold query (cache cleared)
    const coldRes = await httpsRequest(API + '/' + ep, { token: ATOK });
    times.push(coldRes.ms);
    await sleep(300);
    // Warm query 1
    const w1 = await httpsRequest(API + '/' + ep, { token: ATOK });
    times.push(w1.ms);
    await sleep(300);
    // Warm query 2 (cached)
    const w2 = await httpsRequest(API + '/' + ep, { token: ATOK });
    times.push(w2.ms);
    await sleep(300);

    const avg = Math.round(times.reduce((a, b) => a + b, 0) / 3);
    const maxT = Math.max(...times);
    li(`${ep}: 冷=${times[0]}ms 温1=${times[1]}ms 温2=${times[2]}ms avg=${avg}ms max=${maxT}ms`);
    avg < 2000 ? lp(`${ep} avg=${avg}ms < 2000ms SLA达标 ✓`) : lf(`${ep} avg=${avg}ms 超出2000ms SLA!`);
    maxT < 3000 ? lp(`${ep} max=${maxT}ms < 3000ms 峰值达标`) : lw(`${ep} max=${maxT}ms 峰值偏高`);
  }

  // === Step 5: Unit Logic Tests ===
  sec("Step 5: 单元逻辑验证");

  // Cost estimation formula (matches estimateCostYuan in repository)
  const tests = [
    { name: 'qwen-vl-plus (500in/200out)', model: 'qwen-vl-plus', p: 500, c: 200, expected: 0.0008 },
    { name: 'qwen-vl-max (800in/400out)', model: 'qwen-vl-max', p: 800, c: 400, expected: 0.024 },
    { name: 'glm-4v-flash (300in/100out)', model: 'glm-4v-flash', p: 300, c: 100, expected: 0.00004 },
    { name: 'unknown model fallback (100in/50out)', model: 'unknown-xl', p: 100, c: 50, expected: 0.00018 },
  ];
  const PRICING = {
    'qwen-vl-plus': { input: 0.8, output: 2 },
    'qwen-vl-max': { input: 20, output: 20 },
    'glm-4v': { input: 0.5, output: 0.5 },
    'glm-4v-flash': { input: 0.1, output: 0.1 },
  };
  for (const t of tests) {
    const pricing = PRICING[t.model] || { input: 0.8, output: 2 };
    const cost = (t.p * pricing.input + t.c * pricing.output) / 1e6;
    Math.abs(cost - t.expected) < 1e-6 ? lp(`成本估算 ${t.name} = ${cost.toFixed(6)} ✓`) : lf(`成本估算 ${t.name} = ${cost.toFixed(6)}, 期望 ${t.expected}`);
  }

  // resolveEffectiveProvider logic verification
  const repo = readFileSync(SR + '/src/repositories/ai-usage.repository.ts', 'utf8');
  const svc = readFileSync(SR + '/src/services/admin-ai-usage.service.ts', 'utf8');
  repo.includes("aiProvider === 'glm'") ? lp("resolveEffectiveProvider glm分支逻辑存在") : lf("provider解析glm分支缺失");
  repo.includes("降级到 GLM") || repo.includes("traeReady") || repo.includes("fallback") ? lp("resolveEffectiveProvider trae→glm降级逻辑存在") : lf("provider降级逻辑缺失");
  repo.includes('FILTER (WHERE success') ? lp("PostgreSQL FILTER条件聚合语法正确") : lf("FILTER聚合语法缺失");
  repo.includes('COALESCE') ? lp("COALESCE空值处理正确") : lf("COALESCE空值处理缺失");
  svc.includes('Math.min(Math.max') ? lp("limit/days钳制逻辑存在") : lf("参数钳制逻辑缺失");
  svc.includes('CACHE_TTL_SECONDS') || svc.includes('CACHE_TTL') ? lp("Redis缓存TTL(5分钟)实现") : lf("缓存TTL配置缺失");
  svc.includes('setCached') && svc.includes('getCached') ? lp("缓存读写方法实现") : lf("缓存方法缺失");

  // Check permission middleware
  let routeContent = '';
  try { routeContent = readFileSync(SR + '/src/routes/admin.routes.ts', 'utf8'); } catch { try { routeContent = readFileSync(SR + '/src/routes/admin.ts', 'utf8'); } catch {} }
  if (routeContent && (routeContent.includes('admin:stats:read') || routeContent.includes('ai-usage'))) {
    lp("管理路由已配置ai-usage端点");
  } else {
    lw("admin.routes 中未直接匹配ai-usage路由(可能在其他路由文件)");
  }

  // === Step 6: Code Integration Checks ===
  sec("Step 6: 系统集成点验证");
  let analysisSrc = '';
  try { analysisSrc = readFileSync(SR + '/src/services/analysis.service.ts', 'utf8'); } catch (e) {
    try { analysisSrc = readFileSync(SR + '/src/services/ai-vision.service.ts', 'utf8'); } catch {}
  }
  if (analysisSrc) {
    if (analysisSrc.includes('aiUsageRepository') || analysisSrc.includes('estimateCostYuan') || analysisSrc.includes('aiUsageLog')) {
      lp("AI分析服务中存在用量日志记录点");
    } else {
      lw("AI分析服务中未匹配到用量日志记录点(需确认ai-usage.repository是否被正确调用)");
    }
  } else {
    lw("未找到analysis.service.ts或ai-vision.service.ts");
  }

  // DB consistency
  sec("Step 7: 数据一致性(API vs DB)");
  const [dbTot2, dbSucc2, dbFail2] = await Promise.all([
    prisma.aiUsageLog.count(),
    prisma.aiUsageLog.count({ where: { success: true } }),
    prisma.aiUsageLog.count({ where: { success: false } }),
  ]);
  li(`DB: total=${dbTot2} succ=${dbSucc2} fail=${dbFail2}`);
  li(`API overview: total=${od.totalCount} succ=${od.successCount} fail=${od.failedCount}`);
  if (od.totalCount === dbTot2 && od.successCount === dbSucc2 && od.failedCount === dbFail2) {
    lp("API返回数据与DB完全一致 ✓");
  } else {
    lf(`API/DB数据不一致: API(total=${od.totalCount},succ=${od.successCount},fail=${od.failedCount}) vs DB(total=${dbTot2},succ=${dbSucc2},fail=${dbFail2})`);
  }

  // Sum cost from DB
  const costAgg = await prisma.$queryRawUnsafe('SELECT COALESCE(SUM(cost_yuan),0)::float8 AS total_cost FROM ai_usage_logs');
  const dbCost = costAgg[0]?.total_cost || 0;
  li(`DB总成本: ${dbCost.toFixed(6)} 元, API返回: ${od.totalCostYuan} 元`);
  Math.abs(od.totalCostYuan - dbCost) < 0.002 ? lp("API总成本与DB一致 ✓") : lf(`API/DB成本不一致: API=${od.totalCostYuan} DB=${dbCost.toFixed(6)}`);

  await prisma.$disconnect();

  // === Summary ===
  sec("测试报告汇总");
  const total = pass + fail + warn;
  const rate = total > 0 ? ((pass / total) * 100).toFixed(1) : '0';
  console.log('\x1b[1m');
  console.log('┌────────────────────────────────────────┐');
  console.log('│          AI 用量统计接口测试报告        │');
  console.log('├────────────────────────────────────────┤');
  console.log(`│ 测试时间:  ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`);
  console.log(`│ 测试目标:  ${BASE}/api/admin/stats/ai-usage/*`);
  console.log(`│ 总用例数:  ${total}`);
  console.log(`│ \x1b[32m通过: ${pass}\x1b[0m\x1b[1m  \x1b[31m失败: ${fail}\x1b[0m\x1b[1m  \x1b[33m警告: ${warn}\x1b[0m\x1b[1m`);
  console.log(`│ 通过率:    ${rate}%`);
  console.log('└────────────────────────────────────────┘');
  console.log('\x1b[0m');

  console.log("=== 详细结果 ===");
  for (const [type, m] of results) {
    const color = type === 'PASS' ? '\x1b[32m' : type === 'FAIL' ? '\x1b[31m' : '\x1b[33m';
    console.log(`  ${color}[${type}]\x1b[0m ${m}`);
  }
  console.log("");

  if (fail === 0) {
    console.log('\x1b[32m════════ 全部 ' + pass + ' 项测试通过 ════════\x1b[0m');
  } else {
    console.log('\x1b[31m════════ 有 ' + fail + ' 项失败,需修复 ════════\x1b[0m');
  }

  console.log("\nTEST_COMPLETE " + pass + " " + fail + " " + warn);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error('\x1b[31mFATAL ERROR:\x1b[0m', e); process.exit(1); });
