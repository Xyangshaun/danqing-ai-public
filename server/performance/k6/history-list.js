// ============================================================
// 丹青有AI - 历史记录列表压测(history-list.js)
// 场景:GET /analyses(分页查询历史记录,带 JWT)
//       注:analysis.routes.ts 中历史记录列表接口路径为 GET /analyses,
//       无独立 /history 路径,本脚本以 analysis.routes.ts 为准。
//       与 analysis-list.js 的区别:本脚本聚焦深分页 + 多筛选组合,
//       阈值更宽松(P95<300ms / P99<800ms),验证深分页下的 count 与扫描性能。
// 配置:30 VU,持续 30s
// 阈值:P95 < 300ms,P99 < 800ms,错误率 < 1%,迭代数 > 300
// 验证:复合索引 (tenant_id, created_at) 在深分页下的查询性能
//       + count 查询性能 + artType 筛选下 (tenant_id, work_type) 索引表现
// 注:需先运行 seed-database.js 灌入 10000 条历史记录
// ============================================================
//  接口契约(基于 server/src/routes/analysis.routes.ts):
//    GET /api/v1/analyses?page=<n>&page_size=<n>&artType=<type>
//    响应:{ code:0, data:{ items:[Analysis], total, page, pageSize, hasMore } }
//  鉴权:Authorization: Bearer <accessToken>
//  权限:analysis:read:own | analysis:read:tenant
//  限流:60 次/min/用户(滑动窗口)
// ============================================================

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';
import { SharedArray } from 'k6/data';

// 自定义指标:专门追踪历史列表接口的耗时与成功率
const historyDuration = new Trend('history_duration');
const historySuccess = new Rate('history_success');
const tokenExhaustedHistory = new Counter('token_exhausted_history');

// 从 tokens.json 加载多 token(由 scripts/generate-tokens.js 生成)
// 文件格式:[{ userId, tenantId, role, accessToken, ... }, ...]
const tokens = new SharedArray('tokens', function () {
  const tokensFile = __ENV.TOKENS_FILE || 'scripts/tokens.json';
  try {
    return JSON.parse(open(tokensFile));
  } catch (err) {
    console.error(`[history-list] 无法加载 ${tokensFile}: ${err}`);
    console.error('[history-list] 请先运行: node performance/scripts/generate-tokens.js');
    return [];
  }
});

export const options = {
  vus: 30,
  duration: '30s',
  thresholds: {
    // 对应 thresholds.json#history_list
    http_req_duration: ['p(95)<300', 'p(99)<800'],
    http_req_failed: ['rate<0.01'],
    history_duration: ['p(95)<300', 'p(99)<800'],
    history_success: ['rate>0.99'],
    iterations: ['count>300'],
    token_exhausted_history: ['count==0'],
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
      '[history-list] 无可用 token:请设置 TEST_TOKEN / TOKENS_FILE,或 TEST_USER_EMAIL+TEST_USER_PASSWORD',
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
          device_id: 'k6-history-setup',
          client: 'admin',
        }),
      },
      timeout: '10s',
    },
  );
  if (loginRes.status !== 200 || loginRes.json('code') !== 0) {
    console.error(
      `[history-list] 登录失败 status=${loginRes.status} body=${loginRes.body}`,
    );
    return { loginToken: '' };
  }
  const token = loginRes.json('data.accessToken');
  console.log('[history-list] setup 登录成功,后续 VU 复用该 token');
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

// 深分页参数轮转:覆盖浅分页(1-3)、中分页(4-7)、深分页(8-15)
// 验证 OFFSET 翻页在深页的性能(越深扫描行数越多)
const ART_TYPES = ['painting', 'design', 'product', 'sculpture'];

export default function (data) {
  const token = pickToken(data);
  if (!token) {
    tokenExhaustedHistory.add(1);
    console.error(
      '[history-list] 无可用 token。请设置 TEST_TOKEN 或运行 generate-tokens.js',
    );
    sleep(1);
    return;
  }

  // 深分页轮转:1-15 页(覆盖浅/中/深三档),page_size=20
  const page = (__ITER % 15) + 1;
  const pageSize = 20;
  // 一半请求带 artType 筛选,验证 (tenant_id, work_type) 复合索引
  const useArtTypeFilter = __ITER % 2 === 0;
  const artType = useArtTypeFilter
    ? `&artType=${ART_TYPES[__ITER % ART_TYPES.length]}`
    : '';

  const url = `${BASE_URL}/analyses?page=${page}&page_size=${pageSize}${artType}`;

  const res = http.get(url, {
    headers: {
      'Accept': 'application/json',
      'Authorization': `Bearer ${token}`,
      'X-Client': 'web',
    },
  });

  // 响应结构验证:data.items 为数组(兼容 data.analysis 兜底校验)
  const ok = check(res, {
    'status 200': (r) => r.status === 200,
    'code 0': (r) => r.json('code') === 0,
    'has items array (data.items)': (r) => Array.isArray(r.json('data.items')),
    'has total number': (r) => typeof r.json('data.total') === 'number',
    'has page': (r) => r.json('data.page') === page,
    'has pageSize': (r) => r.json('data.pageSize') === pageSize,
    'has hasMore boolean': (r) => typeof r.json('data.hasMore') === 'boolean',
    'items count <= pageSize': (r) => r.json('data.items').length <= pageSize,
    'duration < 300ms': (r) => r.timings.duration < 300,
  });

  historySuccess.add(ok);
  historyDuration.add(res.timings.duration);

  if (!ok && res.status !== 200) {
    console.error(
      `[history-list] VU=${__VU} iter=${__ITER} page=${page} status=${res.status} code=${res.json('code')} body=${res.body}`,
    );
  }

  // 思考时间 0.1s,模拟用户翻页间隔
  sleep(0.1);
}

export function handleSummary(data) {
  const p95 = data.metrics.history_duration
    ? data.metrics.history_duration['p(95)']
    : undefined;
  const p99 = data.metrics.history_duration
    ? data.metrics.history_duration['p(99)']
    : undefined;
  const failRate = data.metrics.http_req_failed
    ? data.metrics.http_req_failed.rate
    : 0;
  const iterCount = data.metrics.iterations ? data.metrics.iterations.count : 0;

  console.log('\n========== history-list 摘要 ==========');
  console.log(
    `history_duration P95: ${p95 !== undefined ? p95.toFixed(2) + 'ms' : 'N/A'}`,
  );
  console.log(
    `history_duration P99: ${p99 !== undefined ? p99.toFixed(2) + 'ms' : 'N/A'}`,
  );
  console.log(`http_req_failed rate: ${(failRate * 100).toFixed(2)}%`);
  console.log(`iterations count: ${iterCount}`);
  const pass =
    p95 !== undefined && p95 < 300 && p99 !== undefined && p99 < 800;
  console.log(
    `阈值达标(P95<300ms & P99<800ms): ${pass ? '✅ PASS' : '❌ FAIL'}`,
  );
  console.log('========================================\n');

  return {};
}
