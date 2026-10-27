// ============================================================
// 丹青有AI - 混合场景压测(mixed-workload.js)
// 配置:50 VU,持续 60s
// 场景分配(按执行概率):
//   20% GET  /auth/feishu/authorize
//   30% GET  /auth/me
//   30% GET  /analyses (列表)
//   20% POST /analyses (提交)
// 阈值:整体 P95 < 2000ms,P99 < 4000ms,错误率 < 1%
// 目的:验证真实业务流量下系统表现,发现资源争用瓶颈
// ============================================================

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';
import { SharedArray } from 'k6/data';

const mixedDuration = new Trend('mixed_duration');
const mixedSuccess = new Rate('mixed_success');
const slaViolationsMixed = new Counter('sla_violations_mixed');
const tokenExhaustedMixed = new Counter('token_exhausted_mixed');

// 按场景拆分的耗时指标,便于定位瓶颈
const authorizeDuration = new Trend('mixed_authorize_duration');
const meDuration = new Trend('mixed_me_duration');
const listDuration = new Trend('mixed_list_duration');
const submitDuration = new Trend('mixed_submit_duration');

const tokens = new SharedArray('tokens', function () {
  const tokensFile = __ENV.TOKENS_FILE || 'scripts/tokens.json';
  try {
    return JSON.parse(open(tokensFile));
  } catch (err) {
    console.error(`[mixed] 无法加载 ${tokensFile}: ${err}`);
    console.error('[mixed] 请先运行: node performance/scripts/generate-tokens.js');
    return [];
  }
});

export const options = {
  vus: 50,
  duration: '60s',
  thresholds: {
    // 对应 thresholds.json#mixed
    http_req_duration: ['p(95)<2000', 'p(99)<4000'],
    http_req_failed: ['rate<0.01'],
    mixed_duration: ['p(95)<2000'],
    mixed_success: ['rate>0.99'],
    sla_violations_mixed: ['count<20'],
    iterations: ['count>1000'],
  },
  noConnectionReuse: false,
};

const API_BASE = __ENV.API_BASE || 'http://localhost:3000';
const SINGLE_TOKEN = __ENV.TEST_TOKEN || '';
const SLA_MS = 3000;

function pickToken() {
  if (tokens.length > 0) {
    return tokens[__VU % tokens.length].accessToken;
  }
  return SINGLE_TOKEN;
}

function buildAuthorizeHeaders() {
  return {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'X-Client': 'web',
    'X-Client-Context': JSON.stringify({
      device_id: `k6-mixed-vu-${__VU}-iter-${__ITER}`,
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

// ---------- 场景 1:飞书授权 URL(20%)----------
function scenarioAuthorize() {
  const redirectUri = 'http://localhost:5173/auth/feishu/callback';
  const url = `${API_BASE}/auth/feishu/authorize?redirect_uri=${encodeURIComponent(
    redirectUri,
  )}&client=web`;
  const res = http.get(url, { headers: buildAuthorizeHeaders() });
  authorizeDuration.add(res.timings.duration);
  return check(res, {
    'authorize: status 200': (r) => r.status === 200,
    'authorize: code 0': (r) => r.json('code') === 0,
    'authorize: has authorizeUrl': (r) =>
      typeof r.json('data.authorizeUrl') === 'string',
  });
}

// ---------- 场景 2:/auth/me(30%)----------
function scenarioMe(token) {
  const res = http.get(`${API_BASE}/auth/me`, { headers: authHeaders(token) });
  meDuration.add(res.timings.duration);
  return check(res, {
    'me: status 200': (r) => r.status === 200,
    'me: code 0': (r) => r.json('code') === 0,
    'me: has user': (r) => r.json('data.user') !== null,
  });
}

// ---------- 场景 3:分析列表(30%)----------
function scenarioList(token) {
  const page = (__ITER % 5) + 1;
  const url = `${API_BASE}/analyses?page=${page}&page_size=20`;
  const res = http.get(url, { headers: authHeaders(token) });
  listDuration.add(res.timings.duration);
  return check(res, {
    'list: status 200': (r) => r.status === 200,
    'list: code 0': (r) => r.json('code') === 0,
    'list: has items': (r) => Array.isArray(r.json('data.items')),
  });
}

// ---------- 场景 4:分析提交(20%)----------
function scenarioSubmit(token) {
  const artTypes = ['painting', 'design', 'product', 'sculpture'];
  const artType = artTypes[__ITER % 4];
  const payload = JSON.stringify({
    artType,
    imageUrl: `https://cdn.danqing-ai.com/uploads/test/${artType}-${__ITER % 6}.jpg`,
    title: `k6-mixed-${__VU}-${__ITER}`,
  });
  const res = http.post(`${API_BASE}/analyses`, payload, {
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(token),
    },
    timeout: '6s',
  });
  submitDuration.add(res.timings.duration);
  const ok = check(res, {
    'submit: status 200 or 201': (r) => r.status === 200 || r.status === 201,
    'submit: code 0': (r) => r.json('code') === 0,
    'submit: has id': (r) => typeof r.json('data.id') === 'string',
  });
  if (res.timings.duration >= SLA_MS) {
    slaViolationsMixed.add(1);
  }
  return ok;
}

export default function () {
  // 按概率分配场景:20% / 30% / 30% / 20%
  const roll = Math.random();
  let ok = false;
  let duration = 0;

  group('mixed-workload', function () {
    if (roll < 0.2) {
      // 20% authorize(无需 token)
      ok = scenarioAuthorize();
    } else if (roll < 0.5) {
      // 30% me
      const token = pickToken();
      if (!token) {
        tokenExhaustedMixed.add(1);
        ok = false;
      } else {
        ok = scenarioMe(token);
      }
    } else if (roll < 0.8) {
      // 30% list
      const token = pickToken();
      if (!token) {
        tokenExhaustedMixed.add(1);
        ok = false;
      } else {
        ok = scenarioList(token);
      }
    } else {
      // 20% submit
      const token = pickToken();
      if (!token) {
        tokenExhaustedMixed.add(1);
        ok = false;
      } else {
        ok = scenarioSubmit(token);
      }
    }
  });

  mixedSuccess.add(ok);
  // mixed_duration 不在此处单独 add,各子场景已分别记录

  if (!ok) {
    // 仅采样打印,避免日志爆炸
    if (__ITER % 100 === 0) {
      console.warn(`[mixed] VU=${__VU} iter=${__ITER} scenario roll=${roll.toFixed(2)} failed`);
    }
  }

  // 思考时间 0.1s
  sleep(0.1);
}

export function handleSummary(data) {
  const p95 = data.metrics.http_req_duration
    ? data.metrics.http_req_duration['p(95)']
    : undefined;
  const authP95 = data.metrics.mixed_authorize_duration
    ? data.metrics.mixed_authorize_duration['p(95)']
    : undefined;
  const meP95 = data.metrics.mixed_me_duration
    ? data.metrics.mixed_me_duration['p(95)']
    : undefined;
  const listP95 = data.metrics.mixed_list_duration
    ? data.metrics.mixed_list_duration['p(95)']
    : undefined;
  const submitP95 = data.metrics.mixed_submit_duration
    ? data.metrics.mixed_submit_duration['p(95)']
    : undefined;
  const slaViolated = data.metrics.sla_violations_mixed
    ? data.metrics.sla_violations_mixed.count
    : 0;
  const failRate = data.metrics.http_req_failed
    ? data.metrics.http_req_failed.rate
    : 0;

  console.log('\n========== mixed-workload 摘要 ==========');
  console.log(`整体 http_req_duration P95: ${p95 !== undefined ? p95.toFixed(2) + 'ms' : 'N/A'}`);
  console.log('--- 各场景 P95 ---');
  console.log(`  authorize: ${authP95 !== undefined ? authP95.toFixed(2) + 'ms' : 'N/A'}`);
  console.log(`  me:        ${meP95 !== undefined ? meP95.toFixed(2) + 'ms' : 'N/A'}`);
  console.log(`  list:      ${listP95 !== undefined ? listP95.toFixed(2) + 'ms' : 'N/A'}`);
  console.log(`  submit:    ${submitP95 !== undefined ? submitP95.toFixed(2) + 'ms' : 'N/A'}`);
  console.log(`SLA 违约(submit>=3000ms): ${slaViolated}`);
  console.log(`http_req_failed rate: ${(failRate * 100).toFixed(2)}%`);
  const overallPass = p95 !== undefined && p95 < 2000;
  console.log(`整体 P95<2000ms 达标: ${overallPass ? '✅ PASS' : '❌ FAIL'}`);
  console.log('==========================================\n');

  return {};
}
