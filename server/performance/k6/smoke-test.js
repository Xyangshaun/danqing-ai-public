// ============================================================
// 丹青有AI - 冒烟测试(smoke-test.js)
// 目的:快速验证后端服务可达、鉴权链路通、核心接口无报错
// 配置:1 VU,1 iteration(约 5 秒完成)
// 链路:GET /health → GET /auth/feishu/authorize → GET /auth/me(带预生成 token)
// 通过条件:全部 2xx,check 通过率 > 95%
// ============================================================

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const smokeChecksPassed = new Rate('smoke_checks_passed');

export const options = {
  vus: 1,
  iterations: 1,
  thresholds: {
    // 对应 thresholds.json#smoke
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.95'],
    smoke_checks_passed: ['rate>0.95'],
  },
  // 冒烟测试不做重试,快速暴露问题
  noConnectionReuse: false,
};

const API_BASE = __ENV.API_BASE || 'http://localhost:3000';
const TEST_TOKEN = __ENV.TEST_TOKEN || '';

// 复用的请求头:模拟前端 X-Client-Context(含 device_id,飞书授权接口必需)
function clientContextHeaders() {
  return {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'X-Client': 'web',
    'X-Client-Context': JSON.stringify({
      device_id: 'k6-smoke-device-001',
      client: 'web',
    }),
  };
}

export default function () {
  // ---------- 1. 健康检查(无需鉴权,不查 DB/Redis)----------
  const healthRes = http.get(`${API_BASE}/health`);
  const healthOk = check(healthRes, {
    'health: status 200': (r) => r.status === 200,
    'health: code 0': (r) => r.json('code') === 0,
    'health: status up': (r) => r.json('data.status') === 'up',
    'health: service danqing-ai-server': (r) =>
      r.json('data.service') === 'danqing-ai-server',
  });

  // ---------- 2. 飞书授权 URL(无需鉴权,生成 state 写 Redis)----------
  const authRes = http.get(
    `${API_BASE}/auth/feishu/authorize?redirect_uri=${encodeURIComponent(
      'http://localhost:5173/auth/feishu/callback',
    )}&client=web`,
    { headers: clientContextHeaders() },
  );
  const authOk = check(authRes, {
    'authorize: status 200': (r) => r.status === 200,
    'authorize: code 0': (r) => r.json('code') === 0,
    'authorize: has authorizeUrl': (r) =>
      typeof r.json('data.authorizeUrl') === 'string' &&
      r.json('data.authorizeUrl').length > 0,
    'authorize: has state': (r) =>
      typeof r.json('data.state') === 'string' && r.json('data.state').length > 0,
  });

  // ---------- 3. /auth/me(需鉴权,验 JWT + DB)----------
  // 冒烟测试要求传入 TEST_TOKEN;未传则跳过此步并标记失败
  let meOk = true;
  if (TEST_TOKEN) {
    const meRes = http.get(`${API_BASE}/auth/me`, {
      headers: {
        ...clientContextHeaders(),
        Authorization: `Bearer ${TEST_TOKEN}`,
      },
    });
    meOk = check(meRes, {
      'me: status 200': (r) => r.status === 200,
      'me: code 0': (r) => r.json('code') === 0,
      'me: has user': (r) => r.json('data.user') !== null,
      'me: has tenant': (r) => r.json('data.tenant') !== null,
    });
  } else {
    console.warn(
      '[smoke] TEST_TOKEN 未设置,跳过 /auth/me 校验。请先运行 scripts/generate-tokens.js',
    );
    meOk = false;
  }

  const allOk = healthOk && authOk && meOk;
  smokeChecksPassed.add(allOk);

  if (!allOk) {
    console.error(`[smoke] 检查失败 health=${healthOk} auth=${authOk} me=${meOk}`);
  }

  sleep(0.5);
}
