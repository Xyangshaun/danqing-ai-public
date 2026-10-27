// ============================================================
// 丹青有AI - 飞书登录链路压测(auth-login.js)
// 场景:GET /auth/feishu/authorize(生成授权 URL + Redis state 写入)
// 配置:20 VU,持续 30s
// 阈值:P95 < 500ms,P99 < 1000ms,错误率 < 1%
// 注意:不压测 /auth/feishu/callback(依赖飞书外部 API)
//       改为配合 auth-me.js 间接验证 token 链路
// ============================================================

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const authorizeDuration = new Trend('authorize_duration');
const authorizeSuccess = new Rate('authorize_success');

export const options = {
  vus: 20,
  duration: '30s',
  thresholds: {
    // 对应 thresholds.json#auth_login
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
    http_req_failed: ['rate<0.01'],
    authorize_duration: ['p(95)<500', 'p(99)<1000'],
    authorize_success: ['rate>0.99'],
    iterations: ['count>100'],
  },
  noConnectionReuse: false,
};

const API_BASE = __ENV.API_BASE || 'http://localhost:3000';

// 每个 VU 独立的 device_id,模拟不同设备
function deviceIdForVu() {
  return `k6-auth-vu-${__VU}-iter-${__ITER}`;
}

function buildHeaders() {
  return {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'X-Client': 'web',
    'X-Client-Context': JSON.stringify({
      device_id: deviceIdForVu(),
      client: 'web',
    }),
  };
}

export default function () {
  // redirect_uri 必须在飞书应用白名单内;压测时用 env 配置的默认值
  const redirectUri = __ENV.REDIRECT_URI || 'http://localhost:5173/auth/feishu/callback';
  const url = `${API_BASE}/auth/feishu/authorize?redirect_uri=${encodeURIComponent(
    redirectUri,
  )}&client=web`;

  const res = http.get(url, { headers: buildHeaders() });

  const ok = check(res, {
    'status 200': (r) => r.status === 200,
    'code 0': (r) => r.json('code') === 0,
    'has authorizeUrl': (r) =>
      typeof r.json('data.authorizeUrl') === 'string' &&
      r.json('data.authorizeUrl').length > 0,
    'has state (16+ chars)': (r) =>
      typeof r.json('data.state') === 'string' && r.json('data.state').length >= 16,
    'authorizeUrl contains feishu': (r) =>
      r.json('data.authorizeUrl').includes('feishu.cn') ||
      r.json('data.authorizeUrl').includes('larksuite'),
    'redirectUri echoed': (r) => r.json('data.redirectUri') === redirectUri,
    'duration < 500ms': (r) => r.timings.duration < 500,
  });

  authorizeSuccess.add(ok);
  authorizeDuration.add(res.timings.duration);

  if (!ok) {
    console.error(`[auth-login] VU=${__VU} iter=${__ITER} status=${res.status} body=${res.body}`);
  }

  // 思考时间 0.1s,模拟用户点击登录按钮的间隔
  sleep(0.1);
}
