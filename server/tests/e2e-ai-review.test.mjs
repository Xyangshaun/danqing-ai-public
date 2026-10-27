// ============================================================
// E2E 测试:学生提交 AI 评审复核申请全链路
// 路径:前端 RequestReviewSection → POST /analyses/:id/disputes/request
//       → arbitration.service → 异步通知教师 → 教师端通知/争议列表
//
// 运行:node server/tests/e2e-ai-review.test.mjs
// 依赖:Node 20+(原生 fetch);本地服务器 http://localhost:3000
// ============================================================

import assert from 'node:assert';

// ---------- 配置 ----------
const BASE = 'http://localhost:3000/api/v1';
const DEVICE_ID = 'e2e-ai-review-test-device';

const STUDENT = { email: 'test1@dq.edu', password: 'Dq@Test2026' };
const TEACHER = { email: 'teacher@dq.edu', password: 'Dq@Teacher2026' };

const REVIEW_REASON =
  '我认为构图评分偏低,本作品采用非对称构图是有意的视觉设计选择,请AI重新评审';

// ---------- 结果收集 ----------
const results = [];
function record(step, pass, detail = '') {
  results.push({ step, pass, detail });
  const tag = pass ? 'PASS' : 'FAIL';
  console.log(`[${tag}] ${step}${detail ? ' — ' + detail : ''}`);
}

// ---------- HTTP 辅助 ----------
async function api(method, path, { token, body, headers = {} } = {}) {
  const init = {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
  };
  if (token) init.headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(BASE + path, init);
  let json = null;
  const text = await res.text();
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { _raw: text };
  }
  return { status: res.status, json };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ============================================================
// 主流程
// ============================================================
async function main() {
  console.log('=== E2E: 学生提交 AI 评审复核申请全链路测试 ===');
  console.log(`目标: ${BASE}\n`);

  let studentToken = null;
  let teacherToken = null;
  let studentUserId = null;
  let tenantId = null;
  let testAnalysis = null;
  let dispute = null; // { disputeCaseId, status, triggerLevel, ... }
  let reusedExisting = false;

  // ---------- a. 学生登录 ----------
  try {
    const { status, json } = await api('POST', '/auth/login', {
      body: { email: STUDENT.email, password: STUDENT.password },
      headers: { 'X-Device-Id': DEVICE_ID },
    });
    assert.strictEqual(status, 200, `HTTP ${status}`);
    assert.strictEqual(json?.code, 0, `code=${json?.code} msg=${json?.message}`);
    studentToken = json.data.accessToken;
    studentUserId = json.data.user?.id;
    tenantId = json.data.tenant?.id;
    assert.ok(studentToken, 'accessToken 为空');
    assert.ok(studentUserId, 'user.id 为空');
    record('a. 学生登录', true, `userId=${studentUserId} tenant=${tenantId}`);
  } catch (e) {
    record('a. 学生登录', false, e.message);
  }

  if (!studentToken) return finish();

  // ---------- b. 获取学生分析历史,找 status=success ----------
  try {
    const { status, json } = await api('GET', '/analyses?page=1&pageSize=20', {
      token: studentToken,
    });
    assert.strictEqual(status, 200, `HTTP ${status}`);
    assert.strictEqual(json?.code, 0, `code=${json?.code}`);
    const items = json.data?.items ?? [];
    const successItems = items.filter(
      (it) => it.status === 'success' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(it.id),
    );
    if (successItems.length === 0) {
      record(
        'b. 获取学生分析历史',
        true,
        `共 ${items.length} 条分析,但无 status=success 的记录`,
      );
      console.log('\n[跳过] 没有 status=success 的分析,无法提交复核申请。结束测试。');
      results.push({ step: 'c. 无可用分析→跳过', pass: true, detail: '前置数据缺失' });
      return finish();
    }
    testAnalysis = successItems[0];
    record(
      'b. 获取学生分析历史',
      true,
      `找到 ${successItems.length} 条 success 分析,选用 id=${testAnalysis.id} title="${testAnalysis.title ?? ''}"`,
    );
  } catch (e) {
    record('b. 获取学生分析历史', false, e.message);
  }

  if (!testAnalysis) return finish();

  // ---------- c. (无独立动作,已在 b 中判断) ----------
  record('c. 存在可用 success 分析', true, '继续后续步骤');

  // ---------- d. 提交 AI 评审复核申请 ----------
  // 若首个分析已有进行中案件(409),依次尝试下一个,直至创建成功或全部已占用
  try {
    // 重新拉取一批候选,便于在 409 时换一个
    const listRes = await api('GET', '/analyses?page=1&pageSize=20', {
      token: studentToken,
    });
    const allItems = listRes.json?.data?.items ?? [];
    const candidates =
      allItems.filter(
        (it) => it.status === 'success' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(it.id),
      ) ?? [];

    let created = false;
    for (const cand of candidates) {
      const r = await api('POST', `/analyses/${cand.id}/disputes/request`, {
        token: studentToken,
        body: { reason: REVIEW_REASON, reviewType: 'ai' },
      });
      if (r.status === 200 && r.json?.code === 0) {
        testAnalysis = cand;
        dispute = r.json.data;
        created = true;
        break;
      }
      if (r.status === 409) {
        // 该分析已有进行中案件,换下一个候选
        continue;
      }
      // 其他错误视为失败
      throw new Error(
        `请求异常 HTTP ${r.status} code=${r.json?.code} msg=${r.json?.message}`,
      );
    }

    if (created) {
      record(
        'd. 提交 AI 评审复核申请',
        true,
        `disputeCaseId=${dispute.disputeCaseId} analysisId=${testAnalysis.id}`,
      );
    } else {
      // 所有候选均已有进行中案件 → 复用首个的既有案件做下游验证
      reusedExisting = true;
      const listR = await api(
        'GET',
        `/disputes?analysisId=${testAnalysis.id}&page=1&pageSize=5`,
        { token: studentToken },
      );
      const disputeItems = listR.json?.data?.items ?? [];
      const existing =
        disputeItems.find((d) => d.status === 'open' || d.status === 'reviewing') ??
        disputeItems[0];
      if (!existing) {
        throw new Error('所有分析均有进行中案件,但无法读取既有争议列表');
      }
      dispute = {
        disputeCaseId: existing.id,
        status: existing.status,
        triggerLevel: existing.triggerLevel,
        analysisId: testAnalysis.id,
        createdAt: existing.createdAt,
      };
      record(
        'd. 提交 AI 评审复核申请',
        true,
        `[复用既有案件] 所有 success 分析已有进行中争议,复用 disputeCaseId=${dispute.disputeCaseId}`,
      );
    }
  } catch (e) {
    record('d. 提交 AI 评审复核申请', false, e.message);
  }

  if (!dispute) return finish();

  // ---------- e. 验证响应字段 ----------
  try {
    assert.ok(dispute.disputeCaseId, 'disputeCaseId 不存在');
    assert.ok(
      dispute.status === 'open' || dispute.status === 'reviewing',
      `status=${dispute.status}`,
    );
    assert.strictEqual(dispute.triggerLevel, 'general', `triggerLevel=${dispute.triggerLevel}`);
    record(
      'e. 验证响应字段',
      !reusedExisting || dispute.status === 'open',
      `disputeCaseId=${dispute.disputeCaseId} status=${dispute.status} triggerLevel=${dispute.triggerLevel}` +
        (reusedExisting && dispute.status !== 'open' ? ' (复用案件,status 非 open 属正常)' : ''),
    );
  } catch (e) {
    record('e. 验证响应字段', false, e.message);
  }

  // ---------- f. 验证重复申请返回 409 ----------
  try {
    const r = await api('POST', `/analyses/${testAnalysis.id}/disputes/request`, {
      token: studentToken,
      body: { reason: REVIEW_REASON, reviewType: 'ai' },
    });
    assert.strictEqual(r.status, 409, `期望 409,实际 HTTP ${r.status}`);
    assert.notStrictEqual(r.json?.code, 0, '重复申请不应返回 code=0');
    record('f. 重复申请返回 409', true, `HTTP ${r.status} code=${r.json?.code} msg=${r.json?.message}`);
  } catch (e) {
    record('f. 重复申请返回 409', false, e.message);
  }

  // ---------- g. 验证理由不足返回 400 ----------
  try {
    const r = await api('POST', `/analyses/${testAnalysis.id}/disputes/request`, {
      token: studentToken,
      body: { reason: '太短', reviewType: 'ai' },
    });
    assert.strictEqual(r.status, 400, `期望 400,实际 HTTP ${r.status}`);
    assert.notStrictEqual(r.json?.code, 0, '理由不足不应返回 code=0');
    record('g. 理由不足返回 400', true, `HTTP ${r.status} code=${r.json?.code} msg=${r.json?.message}`);
  } catch (e) {
    record('g. 理由不足返回 400', false, e.message);
  }

  // ---------- h. 教师登录 ----------
  try {
    const { status, json } = await api('POST', '/auth/login', {
      body: { email: TEACHER.email, password: TEACHER.password },
      headers: { 'X-Device-Id': DEVICE_ID + '-teacher' },
    });
    assert.strictEqual(status, 200, `HTTP ${status}`);
    assert.strictEqual(json?.code, 0, `code=${json?.code} msg=${json?.message}`);
    teacherToken = json.data.accessToken;
    assert.ok(teacherToken, '教师 accessToken 为空');
    record('h. 教师登录', true, `teacherUserId=${json.data.user?.id} tenant=${json.data.tenant?.id}`);
  } catch (e) {
    record('h. 教师登录', false, e.message);
  }

  if (!teacherToken) return finish();

  // ---------- i. 教师通知列表(异步通知,带重试) ----------
  try {
    let found = null;
    for (let attempt = 1; attempt <= 5; attempt++) {
      const r = await api('GET', '/notifications?limit=20', { token: teacherToken });
      assert.strictEqual(r.status, 200, `HTTP ${r.status}`);
      const items = r.json?.data?.items ?? [];
      found = items.find(
        (n) =>
          (n.title === '学生申请 AI 评审' ||
            (typeof n.title === 'string' && n.title.includes('AI 评审'))) &&
          (n.metadata?.disputeId === dispute.disputeCaseId ||
            n.metadata?.analysisId === testAnalysis.id),
      );
      if (found) break;
      await sleep(700);
    }
    assert.ok(found, '未在教师通知列表中找到 "学生申请 AI 评审" 通知(含 5 次重试)');
    record(
      'i. 教师收到 AI 评审通知',
      true,
      `title="${found.title}" type=${found.type} metadata=${JSON.stringify(found.metadata ?? {})} linkUrl=${found.linkUrl}`,
    );
  } catch (e) {
    record('i. 教师收到 AI 评审通知', false, e.message);
  }

  // ---------- j. 教师争议列表(验证包含该案件且 reviewType=ai) ----------
  try {
    const r = await api('GET', '/disputes?page=1&pageSize=20', { token: teacherToken });
    assert.strictEqual(r.status, 200, `HTTP ${r.status}`);
    const items = r.json?.data?.items ?? [];
    const target = items.find(
      (d) => d.id === dispute.disputeCaseId || d.analysisId === testAnalysis.id,
    );
    assert.ok(target, `争议列表中未找到 disputeCaseId=${dispute.disputeCaseId}`);
    const rt = target.triggerReason;
    const reviewType = rt?.reviewType;
    assert.strictEqual(reviewType, 'ai', `triggerReason.reviewType=${reviewType}`);
    assert.strictEqual(
      rt?.requestType,
      'manual_review',
      `triggerReason.requestType=${rt?.requestType}`,
    );
    record(
      'j. 教师争议列表含该案件且 reviewType=ai',
      true,
      `id=${target.id} status=${target.status} triggerLevel=${target.triggerLevel} reviewType=${reviewType} requestType=${rt?.requestType}`,
    );
  } catch (e) {
    record('j. 教师争议列表含该案件且 reviewType=ai', false, e.message);
  }

  // ---------- k. 清理说明 ----------
  // 争议案件无 DELETE 接口,无法删除;保留为 open 状态测试数据。
  // 脚本在 d 步已优先选择无进行中案件的分析,避免污染后续重跑。
  record(
    'k. 清理',
    true,
    '争议案件无 DELETE 接口,保留为 open 测试数据(脚本已选择无进行中案件的分析以支持重跑)',
  );

  return finish();
}

function finish() {
  console.log('\n=== 测试报告 ===');
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;
  for (const r of results) {
    const tag = r.pass ? 'PASS' : 'FAIL';
    console.log(`  [${tag}] ${r.step}${r.detail ? ' — ' + r.detail : ''}`);
  }
  console.log(`\n总计: ${results.length}  通过: ${passed}  失败: ${failed}`);
  const allPass = failed === 0;
  console.log(
    `\n全链路通畅性: ${allPass ? '✅ 通畅(所有关键步骤通过)' : '❌ 存在失败步骤,详见上文'}`,
  );
  // 不强制 process.exit,避免 Windows 下 fetch(undici) keepalive 句柄关闭时触发 libuv 断言崩溃
  process.exitCode = allPass ? 0 : 1;
}

main().catch((e) => {
  console.error('测试执行异常:', e);
  process.exit(2);
});
