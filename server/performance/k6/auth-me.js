// ============================================================
// 丹青有AI - /auth/me 接口压测(auth-me.js)
// 场景:GET /auth/me(带预生成 JWT)
// 配置:50 VU,持续 30s
// 阈值:P95 < 100ms,P99 < 200ms,错误率 < 1%
// 验证:JWT RS256 校验性能 + User/Tenant/TenantMember 3 次 DB 查询性能
// 多 token 轮转:从 TOKENS_FILE 加载,避免单用户被限流
// ============================================================

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';
import { SharedArray } from 'k6/data';

const meDuration = new Trend('me_duration');
const meSuccess = new Rate('me_success');
const tokenExhausted = new Counter('token_exhausted');

// 从 tokens.json 加载多 token(由 scripts/generate-tokens.js 生成)
// 文件格式:[{ userId, tenantId, role, accessToken, ... }, ...]
const tokens = new SharedArray('tokens', function () {
  const tokensFile = __ENV.TOKENS_FILE || 'scripts/tokens.json';
  try {
    return JSON.parse(open(tokensFile));
  } catch (err) {
    console.error(`[auth-me] 无法加载 ${tokensFile}: ${err}`);
    console.error('[auth-me] 请先运行: node performance/scripts/generate-tokens.js');
    return [];
  }
});

export const options = {
  vus: 50,
  duration: '30s',
  thresholds: {
    // 对应 thresholds.json#auth_me
    http_req_duration: ['p(95)<100', 'p(99)<200'],
    http_req_failed: ['rate<0.01'],
    me_duration: ['p(95)<100', 'p(99)<200'],
    me_success: ['rate>0.99'],
    iterations: ['count>500'],
    token_exhausted: ['count==0'],
  },
  noConnectionReuse: false,
};

const API_BASE = __ENV.API_BASE || 'http://localhost:3000';
// 备选:单一 token 模式(未提供 tokens.json 时使用)
const SINGLE_TOKEN = __ENV.TEST_TOKEN || '';

function pickToken() {
  if (tokens.length > 0) {
    return tokens[__VU % tokens.length].accessToken;
  }
  return SINGLE_TOKEN;
}

export default function () {
  const token = pickToken();
  if (!token) {
    tokenExhausted.add(1);
    console.error('[auth-me] 无可用 token。请设置 TEST_TOKEN 或运行 generate-tokens.js');
    sleep(1);
    return;
  }

  const res = http.get(`${API_BASE}/auth/me`, {
    headers: {
      'Accept': 'application/json',
      'Authorization': `Bearer ${token}`,
      'X-Client': 'web',
    },
  });

  const ok = check(res, {
    'status 200': (r) => r.status === 200,
    'code 0': (r) => r.json('code') === 0,
    'has user.id': (r) => typeof r.json('data.user.id') === 'string',
    'has user.name': (r) => typeof r.json('data.user.name') === 'string',
    'has user.role': (r) => r.json('data.user.role') !== null,
    'has tenant.id': (r) => typeof r.json('data.tenant.id') === 'string',
    'has tenant.plan': (r) => r.json('data.tenant.plan') !== null,
    'has memberships array': (r) => Array.isArray(r.json('data.memberships')),
    'duration < 100ms': (r) => r.timings.duration < 100,
  });

  meSuccess.add(ok);
  meDuration.add(res.timings.duration);

  if (!ok && res.status !== 200) {
    console.error(
      `[auth-me] VU=${__VU} status=${res.status} code=${res.json('code')} body=${res.body}`,
    );
  }

  // 思考时间 0.05s,模拟前端初始化加载用户信息的间隔
  sleep(0.05);
}
