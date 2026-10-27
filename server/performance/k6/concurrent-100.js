// ============================================================
// 丹青有AI - 100 并发混合负载压测(concurrent-100.js)
// 场景:100 VU 混合负载,验证 3 秒 SLA 在峰值并发下仍能保持
// 配置:100 VU,持续 60s
// 阈值:整体 P95 < 2000ms,P99 < 4000ms,错误率 < 2%,迭代数 > 500
//       (P95 阈值 2000ms 比 3 秒 SLA 更严格,留 1 秒缓冲)
// ============================================================
//  场景分配(weighted random):
//    10% GET  /auth/feishu/authorize  (登录入口,无需 token;限流 10/min,接受 429)
//    20% GET  /auth/me                (登录态校验,带 token)
//    25% GET  /analyses               (分析列表-浅分页,带 token)
//    20% GET  /analyses               (历史记录-深分页+筛选,带 token)
//    25% GET  /notifications          (通知列表-游标分页,带 token)
// ============================================================
//  ★★★ 核心:3 秒 SLA 硬约束验证(100 并发峰值)★★★
//  - 每 VU 持有独立 token(需 100 个 token,由 generate-tokens.js 生成)
//  - 降级:若 tokens.json < 100 条,多 VU 共享 token(会触发 apiRateLimiter 60/min)
//  - 降级:若无 tokens.json / TEST_TOKEN,setup 用 email+password 登录拿单 token(全部 VU 共享)
//    注:/auth/login/admin 限流 5/min,setup 仅登录一次;单 token 模式会触发限流,
//    结果仅供冒烟参考,正式压测必须用 100 个预生成 token
// ============================================================

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';
import { SharedArray } from 'k6/data';

// 整体指标
const concurrentDuration = new Trend('concurrent_duration');
const concurrentSuccess = new Rate('concurrent_success');
const slaViolationsConcurrent = new Counter('sla_violations_concurrent');
const tokenExhaustedConcurrent = new Counter('token_exhausted_concurrent');

// 按场景拆分的耗时指标,便于在 100 并发下定位瓶颈
const authorizeDuration = new Trend('cc100_authorize_duration');
const meDuration = new Trend('cc100_me_duration');
const analysisListDuration = new Trend('cc100_analysis_list_duration');
const historyListDuration = new Trend('cc100_history_list_duration');
const notificationListDuration = new Trend('cc100_notification_list_duration');

// 从 tokens.json 加载多 token(由 scripts/generate-tokens.js 生成,需 ≥100 条)
// 文件格式:[{ userId, tenantId, role, accessToken, ... }, ...]
const tokens = new SharedArray('tokens', function () {
  const tokensFile = __ENV.TOKENS_FILE || 'scripts/tokens.json';
  try {
    return JSON.parse(open(tokensFile));
  } catch (err) {
    console.error(`[concurrent-100] 无法加载 ${tokensFile}: ${err}`);
    console.error('[concurrent-100] 请先运行: node performance/scripts/generate-tokens.js');
    return [];
  }
});

export const options = {
  vus: 100,
  duration: '60s',
  thresholds: {
    // 对应 thresholds.json#concurrent_100
    // P95 < 2000ms(比 3 秒 SLA 严格 1 秒,留缓冲);P99 < 4000ms
    http_req_duration: ['p(95)<2000', 'p(99)<4000'],
    // 100 并发下错误率略放宽至 2%(含限流 429 等)
    http_req_failed: ['rate<0.02'],
    concurrent_duration: ['p(95)<2000'],
    concurrent_success: ['rate>0.98'],
    // 3 秒 SLA 违约计数(>=3000ms),允许少量但 P95 必须达标
    sla_violations_concurrent: ['count<50'],
    iterations: ['count>500'],
    token_exhausted_concurrent: ['count==0'],
  },
  noConnectionReuse: false,
};

// BASE_URL 优先级:BASE_URL(任务约定) > API_BASE(兼容现有 6 个脚本) > 默认值
const BASE_URL = __ENV.BASE_URL || __ENV.API_BASE || 'http://localhost:3000/api/v1';
const SINGLE_TOKEN = __ENV.TEST_TOKEN || '';
const SLA_MS = 3000; // 3 秒 SLA 硬约束

// setup 阶段:若 tokens.json 与 TEST_TOKEN 均无,则用 email+password 登录拿单 token
// 注:/auth/login/admin 限流 5/min,setup 仅登录一次;100 VU 共享单 token 会触发限流,
//   正式压测必须用 generate-tokens.js 预生成 ≥100 个 token
export function setup() {
  if (tokens.length > 0) {
    console.log(
      `[concurrent-100] 已加载 ${tokens.length} 个 token。${
        tokens.length < 100
          ? '⚠ 数量 < 100,多 VU 将共享 token,可能触发限流(60/min/用户)。'
          : '✅ 数量 ≥ 100,每 VU 独立 token。'
      }`,
    );
    return { loginToken: '' };
  }
  if (SINGLE_TOKEN) {
    console.warn(
      '[concurrent-100] 仅提供 TEST_TOKEN,100 VU 共享单 token,会触发限流(60/min/用户)。正式压测请用 generate-tokens.js 生成 100 token。',
    );
    return { loginToken: '' };
  }
  const email = __ENV.TEST_USER_EMAIL || '';
  const password = __ENV.TEST_USER_PASSWORD || '';
  if (!email || !password) {
    console.error(
      '[concurrent-100] 无可用 token:请设置 TOKENS_FILE(推荐,≥100 条)/ TEST_TOKEN,或 TEST_USER_EMAIL+TEST_USER_PASSWORD',
    );
    return { loginToken: '' };
  }
  const loginRes = http.post(
    `${BASE_URL}/auth/login/admin`,
    JSON.stringify({ email, password }),
    {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Client': 'admin',
        // extractClientContext 必须从 X-Client-Context 提取 device_id,否则返回 PARAM_MISSING
        'X-Client-Context': JSON.stringify({
          device_id: 'k6-cc100-setup',
          client: 'admin',
        }),
      },
      timeout: '10s',
    },
  );
  if (loginRes.status !== 200 || loginRes.json('code') !== 0) {
    console.error(
      `[concurrent-100] 登录失败 status=${loginRes.status} body=${loginRes.body}`,
    );
    return { loginToken: '' };
  }
  console.warn(
    '[concurrent-100] setup 登录成功,100 VU 共享单 token,会触发限流。正式压测请用 generate-tokens.js 生成 100 token。',
  );
  return { loginToken: loginRes.json('data.accessToken') };
}

// 每个 VU 持有独立 token:tokens[__VU % tokens.length]
// 若 tokens 不足 100,多 VU 共享(会触发限流);若无 tokens,降级单 token
function pickToken(setupData) {
  if (tokens.length > 0) {
    return tokens[__VU % tokens.length].accessToken;
  }
  if (SINGLE_TOKEN) {
    return SINGLE_TOKEN;
  }
  return setupData.loginToken || '';
}

function authorizeHeaders() {
  return {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'X-Client': 'web',
    'X-Client-Context': JSON.stringify({
      device_id: `k6-cc100-vu-${__VU}-iter-${__ITER}`,
      client: 'web',
    }),
  };
}

function authHeaders(token) {
  return {
    'Accept': 'application/json',
    'Authorization': `Bearer ${token}`,
    'X-Client': 'web',
  };
}

// ============================================================
// 场景函数:统一返回 { ok, duration },便于 default 统一统计 SLA 违约
// ============================================================

// ---------- 场景 1:登录入口(10%)----------
// GET /auth/feishu/authorize(无需 token,限流 10/min)
// 100 并发下会触发限流,check 接受 200 或 429(429 不计入 http_req_failed)
function scenarioAuthorize() {
  const redirectUri = 'http://localhost:5173/auth/feishu/callback';
  const url = `${BASE_URL}/auth/feishu/authorize?redirect_uri=${encodeURIComponent(
    redirectUri,
  )}&client=web`;
  const res = http.get(url, { headers: authorizeHeaders() });
  const duration = res.timings.duration;
  authorizeDuration.add(duration);
  const ok = check(res, {
    'authorize: status 200 or 429(限流预期)': (r) =>
      r.status === 200 || r.status === 429,
    'authorize: code 0 (when 200)': (r) =>
      r.status === 429 || r.json('code') === 0,
  });
  return { ok, duration };
}

// ---------- 场景 2:登录态校验 /auth/me(20%)----------
function scenarioMe(token) {
  const res = http.get(`${BASE_URL}/auth/me`, { headers: authHeaders(token) });
  const duration = res.timings.duration;
  meDuration.add(duration);
  const ok = check(res, {
    'me: status 200': (r) => r.status === 200,
    'me: code 0': (r) => r.json('code') === 0,
    'me: has user': (r) => r.json('data.user') !== null,
  });
  return { ok, duration };
}

// ---------- 场景 3:分析列表-浅分页(25%)----------
function scenarioAnalysisList(token) {
  const page = (__ITER % 3) + 1; // 1-3 页(浅分页)
  const url = `${BASE_URL}/analyses?page=${page}&page_size=20`;
  const res = http.get(url, { headers: authHeaders(token) });
  const duration = res.timings.duration;
  analysisListDuration.add(duration);
  const ok = check(res, {
    'analysis-list: status 200': (r) => r.status === 200,
    'analysis-list: code 0': (r) => r.json('code') === 0,
    'analysis-list: has items': (r) => Array.isArray(r.json('data.items')),
  });
  return { ok, duration };
}

// ---------- 场景 4:历史记录-深分页+筛选(20%)----------
// 注:后端无独立 /history 路径,历史记录列表即 GET /analyses(以 analysis.routes.ts 为准)
// 此场景用深分页(8-15 页)+ artType 筛选,与场景 3 参数区分
function scenarioHistoryList(token) {
  const page = (__ITER % 8) + 8; // 8-15 页(深分页)
  const artTypes = ['painting', 'design', 'product', 'sculpture'];
  const artType = artTypes[__ITER % artTypes.length];
  const url = `${BASE_URL}/analyses?page=${page}&page_size=20&artType=${artType}`;
  const res = http.get(url, { headers: authHeaders(token) });
  const duration = res.timings.duration;
  historyListDuration.add(duration);
  const ok = check(res, {
    'history-list: status 200': (r) => r.status === 200,
    'history-list: code 0': (r) => r.json('code') === 0,
    'history-list: has items': (r) => Array.isArray(r.json('data.items')),
    'history-list: has total': (r) => typeof r.json('data.total') === 'number',
  });
  return { ok, duration };
}

// ---------- 场景 5:通知列表-游标分页(25%)----------
function scenarioNotificationList(token) {
  const useOnlyUnread = __ITER % 3 === 0;
  const onlyUnread = useOnlyUnread ? '&onlyUnread=true' : '';
  const url = `${BASE_URL}/notifications?limit=20${onlyUnread}`;
  const res = http.get(url, { headers: authHeaders(token) });
  const duration = res.timings.duration;
  notificationListDuration.add(duration);
  const ok = check(res, {
    'notification-list: status 200': (r) => r.status === 200,
    'notification-list: code 0': (r) => r.json('code') === 0,
    'notification-list: has items': (r) => Array.isArray(r.json('data.items')),
  });
  return { ok, duration };
}

export default function (data) {
  // weighted random 选择场景:10% / 20% / 25% / 20% / 25%
  const roll = Math.random();
  let ok = false;
  let duration = 0;

  group('concurrent-100', function () {
    if (roll < 0.1) {
      // 10% 登录入口(无需 token)
      const r = scenarioAuthorize();
      ok = r.ok;
      duration = r.duration;
    } else {
      // 其余 4 个场景均需 token
      const token = pickToken(data);
      if (!token) {
        tokenExhaustedConcurrent.add(1);
        ok = false;
        return;
      }

      let r;
      if (roll < 0.3) {
        // 20% me
        r = scenarioMe(token);
      } else if (roll < 0.55) {
        // 25% analysis-list
        r = scenarioAnalysisList(token);
      } else if (roll < 0.75) {
        // 20% history-list
        r = scenarioHistoryList(token);
      } else {
        // 25% notification-list
        r = scenarioNotificationList(token);
      }
      ok = r.ok;
      duration = r.duration;
    }
  });

  concurrentSuccess.add(ok);
  concurrentDuration.add(duration);

  // ★ 3 秒 SLA 硬约束违约统计(覆盖全部场景)★★★
  if (duration >= SLA_MS) {
    slaViolationsConcurrent.add(1);
    if (__ITER % 100 === 0) {
      console.warn(
        `[concurrent-100] ⚠ SLA 违约: VU=${__VU} iter=${__ITER} roll=${roll.toFixed(2)} duration=${duration}ms`,
      );
    }
  }

  if (!ok && __ITER % 200 === 0) {
    console.warn(
      `[concurrent-100] VU=${__VU} iter=${__ITER} scenario roll=${roll.toFixed(2)} failed`,
    );
  }

  // 思考时间 0.1s,模拟用户操作间隔
  sleep(0.1);
}

export function handleSummary(data) {
  const p95 = data.metrics.http_req_duration
    ? data.metrics.http_req_duration['p(95)']
    : undefined;
  const p99 = data.metrics.http_req_duration
    ? data.metrics.http_req_duration['p(99)']
    : undefined;
  const authP95 = data.metrics.cc100_authorize_duration
    ? data.metrics.cc100_authorize_duration['p(95)']
    : undefined;
  const meP95 = data.metrics.cc100_me_duration
    ? data.metrics.cc100_me_duration['p(95)']
    : undefined;
  const aListP95 = data.metrics.cc100_analysis_list_duration
    ? data.metrics.cc100_analysis_list_duration['p(95)']
    : undefined;
  const hListP95 = data.metrics.cc100_history_list_duration
    ? data.metrics.cc100_history_list_duration['p(95)']
    : undefined;
  const nListP95 = data.metrics.cc100_notification_list_duration
    ? data.metrics.cc100_notification_list_duration['p(95)']
    : undefined;
  const slaViolated = data.metrics.sla_violations_concurrent
    ? data.metrics.sla_violations_concurrent.count
    : 0;
  const failRate = data.metrics.http_req_failed
    ? data.metrics.http_req_failed.rate
    : 0;
  const iterCount = data.metrics.iterations ? data.metrics.iterations.count : 0;

  console.log('\n========== concurrent-100 摘要 ==========');
  console.log(
    `整体 http_req_duration P95: ${p95 !== undefined ? p95.toFixed(2) + 'ms' : 'N/A'}`,
  );
  console.log(
    `整体 http_req_duration P99: ${p99 !== undefined ? p99.toFixed(2) + 'ms' : 'N/A'}`,
  );
  console.log('--- 各场景 P95 ---');
  console.log(`  authorize:        ${authP95 !== undefined ? authP95.toFixed(2) + 'ms' : 'N/A'}`);
  console.log(`  me:               ${meP95 !== undefined ? meP95.toFixed(2) + 'ms' : 'N/A'}`);
  console.log(`  analysis-list:    ${aListP95 !== undefined ? aListP95.toFixed(2) + 'ms' : 'N/A'}`);
  console.log(`  history-list:     ${hListP95 !== undefined ? hListP95.toFixed(2) + 'ms' : 'N/A'}`);
  console.log(`  notification-list:${nListP95 !== undefined ? nListP95.toFixed(2) + 'ms' : 'N/A'}`);
  console.log(`SLA 违约(>=3000ms): ${slaViolated}`);
  console.log(`http_req_failed rate: ${(failRate * 100).toFixed(2)}%`);
  console.log(`iterations count: ${iterCount}`);
  // ★★★ 3 秒 SLA 硬约束达标判定 ★★★
  const slaPassed = p95 !== undefined && p95 < SLA_MS;
  const thresholdPassed =
    p95 !== undefined && p95 < 2000 && p99 !== undefined && p99 < 4000;
  console.log(
    `3 秒 SLA 达标(整体 P95<3000ms): ${slaPassed ? '✅ PASS' : '❌ FAIL'}`,
  );
  console.log(
    `阈值达标(P95<2000ms & P99<4000ms): ${thresholdPassed ? '✅ PASS' : '❌ FAIL'}`,
  );
  console.log('==========================================\n');

  return {};
}
