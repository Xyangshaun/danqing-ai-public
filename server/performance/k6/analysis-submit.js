// ============================================================
// 丹青有AI - 分析提交压测(analysis-submit.js)
// 场景:POST /analyses(提交 AI 分析任务)
// 配置:阶梯加压 10 → 50 → 100 VU(共 2 分钟)
// ============================================================
//  ★★★ 核心:3 秒 SLA 硬约束验证 ★★★
//  阈值:P95 < 3000ms,P99 < 5000ms,错误率 < 1%
//  Phase 1:返回 status=processing mock(不含真实 AI 推理耗时)
//  Phase 2:接入真实模型后必须回归本脚本
// ============================================================

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';
import { SharedArray } from 'k6/data';

// 自定义指标:专门追踪分析接口的耗时与成功率
const analysisDuration = new Trend('analysis_duration');
const analysisSuccess = new Rate('analysis_success');
const slaViolations = new Counter('sla_violations'); // 3 秒 SLA 违约计数
const tokenExhausted = new Counter('token_exhausted_submit');

// 从 tokens.json 加载多 token
const tokens = new SharedArray('tokens', function () {
  const tokensFile = __ENV.TOKENS_FILE || 'scripts/tokens.json';
  try {
    return JSON.parse(open(tokensFile));
  } catch (err) {
    console.error(`[analysis-submit] 无法加载 ${tokensFile}: ${err}`);
    console.error('[analysis-submit] 请先运行: node performance/scripts/generate-tokens.js');
    return [];
  }
});

export const options = {
  // 阶梯加压:基线 → 正常负载 → 峰值 → 降载观察
  stages: [
    { duration: '30s', target: 10 },   // 阶段 1:基线 10 VU
    { duration: '30s', target: 50 },   // 阶段 2:正常负载 50 VU
    { duration: '30s', target: 100 },  // 阶段 3:峰值 100 VU
    { duration: '1m', target: 0 },     // 阶段 4:降载到 0,观察恢复
  ],
  thresholds: {
    // ★★★ 3 秒 SLA 硬约束 ★★★
    http_req_duration: ['p(95)<3000', 'p(99)<5000'],
    http_req_failed: ['rate<0.01'],
    analysis_duration: ['p(95)<3000', 'p(99)<5000'],
    analysis_success: ['rate>0.99'],
    sla_violations: ['count<10'], // 允许少量违约,但 P95 必须达标
    iterations: ['count>200'],
  },
  noConnectionReuse: false,
  // 请求超时设为 6 秒(2 倍 SLA),超时即判定失败
  httpDebug: 'none',
};

const API_BASE = __ENV.API_BASE || 'http://localhost:3000';
const SINGLE_TOKEN = __ENV.TEST_TOKEN || '';
const SLA_MS = 3000; // 3 秒 SLA 硬约束

// 测试图片 URL 池(轮转使用,模拟不同作品)
const IMAGE_URLS = [
  'https://cdn.danqing-ai.com/uploads/test/painting-001.jpg',
  'https://cdn.danqing-ai.com/uploads/test/painting-002.jpg',
  'https://cdn.danqing-ai.com/uploads/test/design-001.jpg',
  'https://cdn.danqing-ai.com/uploads/test/design-002.jpg',
  'https://cdn.danqing-ai.com/uploads/test/product-001.jpg',
  'https://cdn.danqing-ai.com/uploads/test/sculpture-001.jpg',
];

const ART_TYPES = ['painting', 'design', 'product', 'sculpture'];

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
    console.error('[analysis-submit] 无可用 token。请设置 TEST_TOKEN 或运行 generate-tokens.js');
    sleep(1);
    return;
  }

  // 轮转选择 artType 与 imageUrl,模拟真实业务多样性
  const artType = ART_TYPES[__ITER % ART_TYPES.length];
  const imageUrl = IMAGE_URLS[__ITER % IMAGE_URLS.length];

  const payload = JSON.stringify({
    artType,
    imageUrl,
    title: `k6-load-test-${__VU}-${__ITER}`,
    remark: `Phase 1 性能压测 VU=${__VU} iter=${__ITER}`,
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${token}`,
      'X-Client': 'web',
    },
    timeout: '6s', // 2 倍 SLA,超时判定失败
  };

  const res = http.post(`${API_BASE}/analyses`, payload, params);
  const duration = res.timings.duration;

  const ok = check(res, {
    'status 200 or 201': (r) => r.status === 200 || r.status === 201,
    'code 0': (r) => r.json('code') === 0,
    'has analysis id': (r) => typeof r.json('data.id') === 'string',
    'status is processing or success': (r) =>
      r.json('data.status') === 'processing' ||
      r.json('data.status') === 'success',
    'duration < 3000ms (SLA)': (r) => r.timings.duration < SLA_MS,
  });

  analysisSuccess.add(ok);
  analysisDuration.add(duration);

  // 单独记录 SLA 违约(便于在报告中量化)
  if (duration >= SLA_MS) {
    slaViolations.add(1);
    if (__ITER % 50 === 0) {
      console.warn(
        `[analysis-submit] ⚠ SLA 违约: VU=${__VU} iter=${__ITER} duration=${duration}ms status=${res.status}`,
      );
    }
  }

  if (!ok && res.status !== 200 && res.status !== 201) {
    console.error(
      `[analysis-submit] VU=${__VU} iter=${__ITER} status=${res.status} code=${res.json('code')} body=${res.body}`,
    );
  }

  // 思考时间 0.1s,模拟用户上传图片后的提交间隔
  sleep(0.1);
}

// 测试结束摘要:输出 SLA 达标结论到日志
export function handleSummary(data) {
  const p95 = data.metrics.analysis_duration
    ? data.metrics.analysis_duration['p(95)']
    : undefined;
  const p99 = data.metrics.analysis_duration
    ? data.metrics.analysis_duration['p(99)']
    : undefined;
  const slaViolatedCount = data.metrics.sla_violations
    ? data.metrics.sla_violations.count
    : 0;
  const failRate = data.metrics.http_req_failed
    ? data.metrics.http_req_failed.rate
    : 0;

  console.log('\n========== analysis-submit 摘要 ==========');
  console.log(`analysis_duration P95: ${p95 !== undefined ? p95.toFixed(2) + 'ms' : 'N/A'}`);
  console.log(`analysis_duration P99: ${p99 !== undefined ? p99.toFixed(2) + 'ms' : 'N/A'}`);
  console.log(`SLA 违约次数(>=3000ms): ${slaViolatedCount}`);
  console.log(`http_req_failed rate: ${(failRate * 100).toFixed(2)}%`);
  const slaPassed = p95 !== undefined && p95 < SLA_MS;
  console.log(
    `3 秒 SLA 达标(P95<3000ms): ${slaPassed ? '✅ PASS' : '❌ FAIL'}`,
  );
  console.log('==========================================\n');

  // 同时输出 JSON 报告(若指定了 --out json=...)
  return {};
}
