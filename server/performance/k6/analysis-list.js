// ============================================================
// 丹青有AI - 分析列表压测(analysis-list.js)
// 场景:GET /analyses?page=1&page_size=20(带 JWT + 分页)
// 配置:30 VU,持续 30s
// 阈值:P95 < 200ms,P99 < 500ms,错误率 < 1%
// 验证:复合索引 (tenant_id, created_at) 查询性能 + count 查询性能
// 注:需先运行 seed-database.js 灌入 10000 条历史记录
// ============================================================

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';
import { SharedArray } from 'k6/data';

const listDuration = new Trend('list_duration');
const listSuccess = new Rate('list_success');
const tokenExhaustedList = new Counter('token_exhausted_list');

const tokens = new SharedArray('tokens', function () {
  const tokensFile = __ENV.TOKENS_FILE || 'scripts/tokens.json';
  try {
    return JSON.parse(open(tokensFile));
  } catch (err) {
    console.error(`[analysis-list] 无法加载 ${tokensFile}: ${err}`);
    console.error('[analysis-list] 请先运行: node performance/scripts/generate-tokens.js');
    return [];
  }
});

export const options = {
  vus: 30,
  duration: '30s',
  thresholds: {
    // 对应 thresholds.json#analysis_list
    http_req_duration: ['p(95)<200', 'p(99)<500'],
    http_req_failed: ['rate<0.01'],
    list_duration: ['p(95)<200', 'p(99)<500'],
    list_success: ['rate>0.99'],
    iterations: ['count>500'],
    token_exhausted_list: ['count==0'],
  },
  noConnectionReuse: false,
};

const API_BASE = __ENV.API_BASE || 'http://localhost:3000';
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
    tokenExhaustedList.add(1);
    console.error('[analysis-list] 无可用 token。请设置 TEST_TOKEN 或运行 generate-tokens.js');
    sleep(1);
    return;
  }

  // 轮转分页参数,模拟用户翻页与筛选
  const page = (__ITER % 10) + 1; // 1-10 页
  const pageSize = 20;
  // 偶尔带 artType 筛选,验证复合索引 (tenant_id, work_type)
  const useArtTypeFilter = __ITER % 3 === 0;
  const artTypes = ['painting', 'design', 'product', 'sculpture'];
  const artType = useArtTypeFilter ? `&artType=${artTypes[__ITER % 4]}` : '';

  const url = `${API_BASE}/analyses?page=${page}&page_size=${pageSize}${artType}`;

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
    'has total': (r) => typeof r.json('data.total') === 'number',
    'has page': (r) => r.json('data.page') === page,
    'has pageSize': (r) => r.json('data.pageSize') === pageSize,
    'has hasMore': (r) => typeof r.json('data.hasMore') === 'boolean',
    'items count <= pageSize': (r) => r.json('data.items').length <= pageSize,
    'duration < 200ms': (r) => r.timings.duration < 200,
  });

  listSuccess.add(ok);
  listDuration.add(res.timings.duration);

  if (!ok && res.status !== 200) {
    console.error(
      `[analysis-list] VU=${__VU} iter=${__ITER} status=${res.status} code=${res.json('code')} body=${res.body}`,
    );
  }

  // 思考时间 0.1s,模拟用户翻页间隔
  sleep(0.1);
}
