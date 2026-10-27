// ============================================================
// 丹青有AI - 通知列表压测(notification-list.js)
// 场景:GET /notifications(游标分页,带 JWT)
// 配置:50 VU,持续 30s
// 阈值:P95 < 200ms,P99 < 500ms,错误率 < 1%,迭代数 > 500
// 验证:Notification 表 (tenant_id, user_id, created_at) 索引 + 游标分页性能
//       Repository 层 (tenantId, userId) 双过滤 + take=limit+1 翻页策略
// 注:需先运行 seed 脚本灌入通知数据
// ============================================================
//  接口契约(基于 server/src/routes/notification.routes.ts):
//    GET /api/v1/notifications?limit=20&onlyUnread=true&cursor=<base64url>
//    响应:{ code:0, data:{ items:[Notification], nextCursor:string|null } }
//  鉴权:Authorization: Bearer <accessToken>
//  限流:60 次/min/用户(滑动窗口)
// ============================================================

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';
import { SharedArray } from 'k6/data';

// 自定义指标:专门追踪通知列表接口的耗时与成功率
const notifyDuration = new Trend('notification_duration');
const notifySuccess = new Rate('notification_success');
const tokenExhaustedNotify = new Counter('token_exhausted_notification');

// 从 tokens.json 加载多 token(由 scripts/generate-tokens.js 生成)
// 文件格式:[{ userId, tenantId, role, accessToken, ... }, ...]
const tokens = new SharedArray('tokens', function () {
  const tokensFile = __ENV.TOKENS_FILE || 'scripts/tokens.json';
  try {
    return JSON.parse(open(tokensFile));
  } catch (err) {
    console.error(`[notification-list] 无法加载 ${tokensFile}: ${err}`);
    console.error('[notification-list] 请先运行: node performance/scripts/generate-tokens.js');
    return [];
  }
});

export const options = {
  vus: 50,
  duration: '30s',
  thresholds: {
    // 对应 thresholds.json#notification_list
    http_req_duration: ['p(95)<200', 'p(99)<500'],
    http_req_failed: ['rate<0.01'],
    notification_duration: ['p(95)<200', 'p(99)<500'],
    notification_success: ['rate>0.99'],
    iterations: ['count>500'],
    token_exhausted_notification: ['count==0'],
  },
  noConnectionReuse: false,
};

// BASE_URL 优先级:BASE_URL(任务约定) > API_BASE(兼容现有 6 个脚本) > 默认值
// 默认值含 /api/v1 前缀,开箱即用(对应 app.ts 的 app.use('/api/v1', apiV1))
const BASE_URL = __ENV.BASE_URL || __ENV.API_BASE || 'http://localhost:3000/api/v1';
// 备选:单一 token 模式(未提供 tokens.json 时使用)
const SINGLE_TOKEN = __ENV.TEST_TOKEN || '';

// setup 阶段:若无 tokens.json / TEST_TOKEN,则用 email+password 登录拿 token
// 注:/auth/login/admin 限流 5/min,setup 仅登录一次拿单 token 复用
//   批量多 token 场景请使用 scripts/generate-tokens.js 离线生成 tokens.json
export function setup() {
  if (tokens.length > 0 || SINGLE_TOKEN) {
    return { loginToken: '' };
  }
  const email = __ENV.TEST_USER_EMAIL || '';
  const password = __ENV.TEST_USER_PASSWORD || '';
  if (!email || !password) {
    console.error(
      '[notification-list] 无可用 token:请设置 TEST_TOKEN / TOKENS_FILE,或 TEST_USER_EMAIL+TEST_USER_PASSWORD',
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
          device_id: 'k6-notify-setup',
          client: 'admin',
        }),
      },
      timeout: '10s',
    },
  );
  if (loginRes.status !== 200 || loginRes.json('code') !== 0) {
    console.error(
      `[notification-list] 登录失败 status=${loginRes.status} body=${loginRes.body}`,
    );
    return { loginToken: '' };
  }
  const token = loginRes.json('data.accessToken');
  console.log('[notification-list] setup 登录成功,后续 VU 复用该 token');
  return { loginToken: token };
}

function pickToken(setupData) {
  if (tokens.length > 0) {
    return tokens[__VU % tokens.length].accessToken;
  }
  if (SINGLE_TOKEN) {
    return SINGLE_TOKEN;
  }
  return setupData.loginToken || '';
}

export default function (data) {
  const token = pickToken(data);
  if (!token) {
    tokenExhaustedNotify.add(1);
    console.error(
      '[notification-list] 无可用 token。请设置 TEST_TOKEN 或运行 generate-tokens.js',
    );
    sleep(1);
    return;
  }

  // 游标分页参数轮转:模拟用户翻页与筛选
  const limit = 20; // 默认每页 20 条(服务端 DEFAULT_LIMIT)
  // 1/3 请求只看未读,验证 onlyUnread 过滤路径
  const useOnlyUnread = __ITER % 3 === 0;
  const onlyUnread = useOnlyUnread ? '&onlyUnread=true' : '';

  const url = `${BASE_URL}/notifications?limit=${limit}${onlyUnread}`;

  const res = http.get(url, {
    headers: {
      'Accept': 'application/json',
      'Authorization': `Bearer ${token}`,
      'X-Client': 'web',
    },
  });

  const ok = check(res, {
    'status 200': (r) => r.status === 200,
    'code 0': (r) => r.json('code') === 0,
    'has items array': (r) => Array.isArray(r.json('data.items')),
    'has nextCursor': (r) =>
      r.json('data.nextCursor') === null ||
      typeof r.json('data.nextCursor') === 'string',
    'items count <= limit': (r) => r.json('data.items').length <= limit,
    'duration < 200ms': (r) => r.timings.duration < 200,
  });

  notifySuccess.add(ok);
  notifyDuration.add(res.timings.duration);

  if (!ok && res.status !== 200) {
    console.error(
      `[notification-list] VU=${__VU} iter=${__ITER} status=${res.status} code=${res.json('code')} body=${res.body}`,
    );
  }

  // 思考时间 0.1s,模拟用户查看通知列表的翻页间隔
  sleep(0.1);
}

export function handleSummary(data) {
  const p95 = data.metrics.notification_duration
    ? data.metrics.notification_duration['p(95)']
    : undefined;
  const p99 = data.metrics.notification_duration
    ? data.metrics.notification_duration['p(99)']
    : undefined;
  const failRate = data.metrics.http_req_failed
    ? data.metrics.http_req_failed.rate
    : 0;
  const iterCount = data.metrics.iterations ? data.metrics.iterations.count : 0;

  console.log('\n========== notification-list 摘要 ==========');
  console.log(
    `notification_duration P95: ${p95 !== undefined ? p95.toFixed(2) + 'ms' : 'N/A'}`,
  );
  console.log(
    `notification_duration P99: ${p99 !== undefined ? p99.toFixed(2) + 'ms' : 'N/A'}`,
  );
  console.log(`http_req_failed rate: ${(failRate * 100).toFixed(2)}%`);
  console.log(`iterations count: ${iterCount}`);
  const pass =
    p95 !== undefined && p95 < 200 && p99 !== undefined && p99 < 500;
  console.log(
    `阈值达标(P95<200ms & P99<500ms): ${pass ? '✅ PASS' : '❌ FAIL'}`,
  );
  console.log('============================================\n');

  return {};
}
