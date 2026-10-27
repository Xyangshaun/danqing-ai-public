// ============================================================
// 标注反馈统计 API 测试(反馈闭环 Phase 5 批次①:数据飞轮备料)
// 对应源码:src/routes/admin.routes.ts /stats/feedback/* 系列
//          src/services/admin-feedback-stats.service.ts
//          src/repositories/marker-feedback-stats.repository.ts
//
// 测试维度(8 组):
//   G1   : overview 聚合正确(up/down/有用率/用户数/覆盖分析/近 7 天)
//   G2   : by-dimension 快照 dimension 聚合 + 未分类兜底
//   G3   : by-worktype 分组 + workType null → unknown 兜底
//   G4   : trend 按日聚合 + days clamp(200 → 90)
//   G5   : 日期过滤(startDate 排除老数据)
//   G6   : 权限(学生 403 / 未认证 401)
//   G7   : 空数据全 0 不炸
//   G8   : Redis 缓存写入断言(key feedback-stats:*)
//
// 设计要点:
//   - 走真实 adminRouter(getTestApp),复用 fixtures 权限上下文
//   - 反馈数据直插 prismaMock.markerFeedbackStore(统计只读,不走写入 API)
//   - ORM findMany + 内存聚合路线(mock 不支持 $queryRaw,本模块刻意避开)
// ============================================================

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { getTestApp } from './helpers/test-app.js';
import { assertApiResponse, assertApiError } from './helpers/assertions.js';
import {
  createTestUser,
  createTestTenant,
  createTestTokenSet,
  buildAuthHeaders,
} from './helpers/fixtures.js';
import { prismaMock } from './mocks/prisma.mock.js';
import { redisMock } from './mocks/redis.mock.js';
import type { MockMarkerFeedback } from './mocks/prisma.mock.js';

// ============================================================
// 测试常量与辅助
// ============================================================

const ADMIN_TENANT_ID = 't-fb-admin-0001';
const ADMIN_USER_ID = 'u-fb-admin-0001';
const ADMIN_OPEN_ID = 'ou_fb_admin_0001';

const STUDENT_TENANT_ID = 't-fb-student-0001';
const STUDENT_USER_ID = 'u-fb-student-0001';
const STUDENT_OPEN_ID = 'ou_fb_student_0001';

/** 管理员上下文(admin:stats:read 权限) */
function setupAdminContext(): { headers: Record<string, string> } {
  createTestTenant({ id: ADMIN_TENANT_ID, name: '统计管理员租户' });
  createTestUser({
    id: ADMIN_USER_ID,
    tenantId: ADMIN_TENANT_ID,
    feishuOpenId: ADMIN_OPEN_ID,
    feishuUnionId: 'on_fb_admin_0001',
    name: '统计管理员',
    role: 'admin',
  });
  const tokens = createTestTokenSet({
    userId: ADMIN_USER_ID,
    tenantId: ADMIN_TENANT_ID,
    role: 'admin',
    feishuOpenId: ADMIN_OPEN_ID,
    client: 'web',
  });
  return { headers: buildAuthHeaders(tokens.accessToken) };
}

/** 学生上下文(无 admin:stats:read 权限) */
function setupStudentContext(): { headers: Record<string, string> } {
  createTestTenant({ id: STUDENT_TENANT_ID, name: '统计学生租户' });
  createTestUser({
    id: STUDENT_USER_ID,
    tenantId: STUDENT_TENANT_ID,
    feishuOpenId: STUDENT_OPEN_ID,
    feishuUnionId: 'on_fb_student_0001',
    name: '统计学生',
    role: 'student',
  });
  const tokens = createTestTokenSet({
    userId: STUDENT_USER_ID,
    tenantId: STUDENT_TENANT_ID,
    role: 'student',
    feishuOpenId: STUDENT_OPEN_ID,
    client: 'web',
  });
  return { headers: buildAuthHeaders(tokens.accessToken) };
}

/** 直插反馈记录(统计只读消费,不走写入 API) */
function seedFeedback(overrides: Partial<MockMarkerFeedback>): MockMarkerFeedback {
  const record: MockMarkerFeedback = {
    id: `mf-${Math.random().toString(36).slice(2, 10)}`,
    tenantId: ADMIN_TENANT_ID,
    userId: 'u-fb-student-0001',
    analysisId: 'a-fb-0001',
    markerId: 'mk_testhash01',
    markerIndex: 0,
    action: 'up',
    markerSnapshot: { label: '颧骨结构太平', dimension: '造型' },
    workType: 'painting',
    diagnosisMode: 'teaching',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
  prismaMock.markerFeedbackStore.set(record.id, record);
  return record;
}

/** N 天前的当前时刻 */
function daysAgoNow(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

// ============================================================
// 测试用例
// ============================================================

describe('Admin API - 标注反馈统计模块(Phase 5 批次①)', () => {
  const app = getTestApp();

  it('G1: overview 聚合正确(up/down/有用率/用户数/覆盖分析/近 7 天)', async () => {
    const { headers } = setupAdminContext();
    // 5 条:3 up 2 down;2 用户;2 分析;1 条 8 天前(不进近 7 天口径)
    seedFeedback({ userId: 'u-fb-s1', analysisId: 'a-fb-0001', action: 'up' });
    seedFeedback({ userId: 'u-fb-s1', analysisId: 'a-fb-0001', action: 'down' });
    seedFeedback({ userId: 'u-fb-s2', analysisId: 'a-fb-0002', action: 'up' });
    seedFeedback({ userId: 'u-fb-s2', analysisId: 'a-fb-0002', action: 'up' });
    seedFeedback({ userId: 'u-fb-s2', analysisId: 'a-fb-0002', action: 'down', createdAt: daysAgoNow(8) });

    const res = await request(app).get('/api/admin/stats/feedback/overview').set(headers);
    assertApiResponse(res);
    expect(res.body.data.totalCount).toBe(5);
    expect(res.body.data.upCount).toBe(3);
    expect(res.body.data.downCount).toBe(2);
    expect(res.body.data.usefulRate).toBe(0.6);
    expect(res.body.data.uniqueUsers).toBe(2);
    expect(res.body.data.analysesCovered).toBe(2);
    expect(res.body.data.last7DaysCount).toBe(4);
    expect(res.body.data.startDate).toBeNull();
    expect(res.body.data.endDate).toBeNull();
  });

  it('G2: by-dimension 快照维度聚合 + 无 dimension 归未分类', async () => {
    const { headers } = setupAdminContext();
    // 造型 2 条(1 up 1 down)+ 无 dimension 快照 1 条 down → 未分类
    seedFeedback({ action: 'up', markerSnapshot: { label: '颧骨结构太平', dimension: '造型' } });
    seedFeedback({ action: 'down', markerSnapshot: { label: '色调沉闷', dimension: '造型' } });
    seedFeedback({ action: 'down', markerSnapshot: { label: '旧数据无维度' } });

    const res = await request(app).get('/api/admin/stats/feedback/by-dimension').set(headers);
    assertApiResponse(res);
    const stats = res.body.data.stats as Array<{
      dimension: string; totalCount: number; upCount: number; downCount: number; usefulRate: number;
    }>;
    expect(stats).toHaveLength(2);

    const shape = stats.find((s) => s.dimension === '造型')!;
    expect(shape.totalCount).toBe(2);
    expect(shape.upCount).toBe(1);
    expect(shape.downCount).toBe(1);
    expect(shape.usefulRate).toBe(0.5);

    const uncategorized = stats.find((s) => s.dimension === '未分类')!;
    expect(uncategorized.totalCount).toBe(1);
    expect(uncategorized.downCount).toBe(1);
    expect(uncategorized.usefulRate).toBe(0);
  });

  it('G3: by-worktype 分组 + workType null 归 unknown', async () => {
    const { headers } = setupAdminContext();
    // painting 2 条(2 up)+ null 1 条(down)→ unknown
    seedFeedback({ action: 'up', workType: 'painting' });
    seedFeedback({ action: 'up', workType: 'painting' });
    seedFeedback({ action: 'down', workType: null });

    const res = await request(app).get('/api/admin/stats/feedback/by-worktype').set(headers);
    assertApiResponse(res);
    const stats = res.body.data.stats as Array<{
      workType: string; totalCount: number; upCount: number; downCount: number; usefulRate: number;
    }>;
    expect(stats).toHaveLength(2);

    const painting = stats.find((s) => s.workType === 'painting')!;
    expect(painting.totalCount).toBe(2);
    expect(painting.usefulRate).toBe(1);

    const unknown = stats.find((s) => s.workType === 'unknown')!;
    expect(unknown.totalCount).toBe(1);
    expect(unknown.downCount).toBe(1);
  });

  it('G4: trend 按日聚合 + days 参数 clamp 到 90', async () => {
    const { headers } = setupAdminContext();
    const today = new Date();
    const yesterday = daysAgoNow(1);
    // 今日 2 条(1 up 1 down)+ 昨日 1 条 down
    seedFeedback({ action: 'up', createdAt: today });
    seedFeedback({ action: 'down', createdAt: today });
    seedFeedback({ action: 'down', createdAt: yesterday });

    const res = await request(app)
      .get('/api/admin/stats/feedback/trend')
      .query({ days: 200 })
      .set(headers);
    assertApiResponse(res);
    // days clamp:200 → 90
    expect(res.body.data.days).toBe(90);
    const points = res.body.data.dataPoints as Array<{
      date: string; totalCount: number; upCount: number; downCount: number;
    }>;
    expect(points).toHaveLength(2);
    // 升序
    expect(points[0]!.date < points[1]!.date).toBe(true);

    const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const todayPoint = points.find((p) => p.date === todayKey)!;
    expect(todayPoint.totalCount).toBe(2);
    expect(todayPoint.upCount).toBe(1);
    expect(todayPoint.downCount).toBe(1);
  });

  it('G5: 日期过滤(startDate 排除老数据)', async () => {
    const { headers } = setupAdminContext();
    // 3 天前 2 条 + 今日 1 条
    seedFeedback({ action: 'up', createdAt: daysAgoNow(3) });
    seedFeedback({ action: 'down', createdAt: daysAgoNow(3) });
    seedFeedback({ action: 'up', createdAt: new Date() });

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 1);
    const startKey = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-${String(startDate.getDate()).padStart(2, '0')}`;

    const res = await request(app)
      .get('/api/admin/stats/feedback/overview')
      .query({ startDate: startKey })
      .set(headers);
    assertApiResponse(res);
    expect(res.body.data.totalCount).toBe(1);
    expect(res.body.data.upCount).toBe(1);
    // 近 7 天口径不受 startDate 影响(恒定口径)
    expect(res.body.data.last7DaysCount).toBe(3);
    expect(res.body.data.startDate).toBe(startKey);
  });

  it('G6: 权限控制(学生 403 / 未认证 401)', async () => {
    // 学生无 admin:stats:read 权限
    const { headers: studentHeaders } = setupStudentContext();
    const res403 = await request(app)
      .get('/api/admin/stats/feedback/overview')
      .set(studentHeaders);
    assertApiError(res403, 2004, 403);

    // 未认证
    const res401 = await request(app).get('/api/admin/stats/feedback/overview');
    assertApiError(res401, 2001, 401);
  });

  it('G7: 空数据全 0 不炸', async () => {
    const { headers } = setupAdminContext();

    const [overview, byDimension, byWorkType, trend] = await Promise.all([
      request(app).get('/api/admin/stats/feedback/overview').set(headers),
      request(app).get('/api/admin/stats/feedback/by-dimension').set(headers),
      request(app).get('/api/admin/stats/feedback/by-worktype').set(headers),
      request(app).get('/api/admin/stats/feedback/trend').set(headers),
    ]);
    assertApiResponse(overview);
    expect(overview.body.data.totalCount).toBe(0);
    expect(overview.body.data.usefulRate).toBe(0);
    expect(overview.body.data.uniqueUsers).toBe(0);

    assertApiResponse(byDimension);
    expect(byDimension.body.data.stats).toEqual([]);
    assertApiResponse(byWorkType);
    expect(byWorkType.body.data.stats).toEqual([]);
    assertApiResponse(trend);
    expect(trend.body.data.dataPoints).toEqual([]);
    expect(trend.body.data.days).toBe(7);
  });

  it('G8: Redis 缓存写入(key feedback-stats:*)', async () => {
    const { headers } = setupAdminContext();
    seedFeedback({ action: 'up' });

    await request(app).get('/api/admin/stats/feedback/overview').set(headers);

    // service 层写入缓存 key(5 分钟 TTL)
    const entry = redisMock.__peek('feedback-stats:overview:all:all');
    expect(entry).toBeDefined();
    expect(entry!.expiresAt).not.toBeNull();
    // TTL ≤ 5 分钟(300s,留少量执行误差余量)
    const ttlMs = entry!.expiresAt! - Date.now();
    expect(ttlMs).toBeGreaterThan(0);
    expect(ttlMs).toBeLessThanOrEqual(300 * 1000);
    // 缓存内容可解析且为聚合结果
    const cached = JSON.parse(entry!.value);
    expect(cached.totalCount).toBe(1);
  });
});

// ============================================================
// Phase 5 批次②:训练数据导出 GET /stats/feedback/export(NDJSON)
//   E1 : 行格式(快照平铺 + 元数据键后置覆盖 + NDJSON 头 + X-Row-Count)
//   E2 : 日期过滤(startDate 排除老数据)
//   E3 : 租户数据主权(admin 缺省/越权 403;跨租户行不泄漏)
//   E4 : 平台 owner 全局导出(tenantId=all / 缺省 / 指定租户)
//   E5 : 权限(学生 403 / 未认证 401)
//   E6 : 空数据 0 行不炸
// ============================================================

describe('Admin API - 训练数据导出(Phase 5 批次②)', () => {
  const app = getTestApp();

  const OWNER_TENANT_ID = 't-fb-owner-0001';
  const OWNER_USER_ID = 'u-fb-owner-0001';
  const OWNER_OPEN_ID = 'ou_fb_owner_0001';
  const OTHER_TENANT_ID = 't-fb-other-0001';

  /** 平台 owner 上下文(全权限,可跨租户) */
  function setupOwnerContext(): { headers: Record<string, string> } {
    createTestTenant({ id: OWNER_TENANT_ID, name: '平台所有者租户' });
    createTestUser({
      id: OWNER_USER_ID,
      tenantId: OWNER_TENANT_ID,
      feishuOpenId: OWNER_OPEN_ID,
      feishuUnionId: 'on_fb_owner_0001',
      name: '平台所有者',
      role: 'owner',
    });
    const tokens = createTestTokenSet({
      userId: OWNER_USER_ID,
      tenantId: OWNER_TENANT_ID,
      role: 'owner',
      feishuOpenId: OWNER_OPEN_ID,
      client: 'web',
    });
    return { headers: buildAuthHeaders(tokens.accessToken) };
  }

  /** 解析 NDJSON 响应体为行数组 */
  function parseNdjson(text: string): Array<Record<string, unknown>> {
    return text
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  }

  it('E1: 行格式(快照平铺 + 元数据键后置覆盖 + NDJSON 头 + X-Row-Count)', async () => {
    const { headers } = setupAdminContext();
    seedFeedback({
      analysisId: 'a-fb-e1',
      markerId: 'mk_e1hash01',
      markerIndex: 2,
      action: 'down',
      workType: 'sculpture',
      diagnosisMode: 'master',
      markerSnapshot: { label: '形体转折生硬', dimension: '形体语言', analysisId: 'fake-from-snapshot' },
    });

    const res = await request(app).get('/api/admin/stats/feedback/export').set(headers);
    expect(res.status).toBe(200);
    // NDJSON 响应头
    expect(res.headers['content-type']).toContain('application/x-ndjson');
    expect(String(res.headers['content-disposition'])).toContain('attachment');
    expect(String(res.headers['content-disposition'])).toContain('.jsonl');
    // 行数头与实际行数一致
    expect(Number(res.headers['x-row-count'])).toBe(1);

    const rows = parseNdjson(res.text);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    // 快照键平铺
    expect(row.label).toBe('形体转折生硬');
    expect(row.dimension).toBe('形体语言');
    // 元数据键(快照同键时元数据优先:fake-from-snapshot 被真实 analysisId 覆盖)
    expect(row.analysisId).toBe('a-fb-e1');
    expect(row.markerId).toBe('mk_e1hash01');
    expect(row.markerIndex).toBe(2);
    expect(row.action).toBe('down');
    expect(row.workType).toBe('sculpture');
    expect(row.diagnosisMode).toBe('master');
    expect(typeof row.collectedAt).toBe('string');
    expect(Number.isNaN(Date.parse(row.collectedAt as string))).toBe(false);
  });

  it('E2: 日期过滤(startDate 排除老数据)', async () => {
    const { headers } = setupAdminContext();
    seedFeedback({ analysisId: 'a-fb-old', action: 'up', createdAt: daysAgoNow(10) });
    seedFeedback({ analysisId: 'a-fb-new', action: 'down', createdAt: new Date() });

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const startKey = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;

    const res = await request(app)
      .get('/api/admin/stats/feedback/export')
      .query({ startDate: startKey })
      .set(headers);
    expect(res.status).toBe(200);

    const rows = parseNdjson(res.text);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.analysisId).toBe('a-fb-new');
  });

  it('E3: 租户数据主权(admin 缺省强制本租户,跨租户行不泄漏;越权 all/他人租户 403)', async () => {
    const { headers } = setupAdminContext();
    // 本租户 1 条 + 他人租户 1 条
    seedFeedback({ analysisId: 'a-fb-own', tenantId: ADMIN_TENANT_ID, action: 'up' });
    seedFeedback({ analysisId: 'a-fb-foreign', tenantId: OTHER_TENANT_ID, action: 'up' });

    // 缺省 tenantId:admin 强制本租户 → 仅本租户 1 行
    const resDefault = await request(app).get('/api/admin/stats/feedback/export').set(headers);
    expect(resDefault.status).toBe(200);
    const rows = parseNdjson(resDefault.text);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.analysisId).toBe('a-fb-own');

    // 传 tenantId=all:非 owner → 403
    const resAll = await request(app)
      .get('/api/admin/stats/feedback/export')
      .query({ tenantId: 'all' })
      .set(headers);
    assertApiError(resAll, 2004, 403);

    // 传他人 tenantId:非 owner → 403
    const resForeign = await request(app)
      .get('/api/admin/stats/feedback/export')
      .query({ tenantId: OTHER_TENANT_ID })
      .set(headers);
    assertApiError(resForeign, 2004, 403);
  });

  it('E4: 平台 owner 全局导出(tenantId=all / 缺省全局 / 指定租户)', async () => {
    const { headers } = setupOwnerContext();
    seedFeedback({ analysisId: 'a-fb-o1', tenantId: OWNER_TENANT_ID, action: 'up' });
    seedFeedback({ analysisId: 'a-fb-o2', tenantId: OTHER_TENANT_ID, action: 'down' });

    // tenantId=all → 全局(含他人租户)
    const resAll = await request(app)
      .get('/api/admin/stats/feedback/export')
      .query({ tenantId: 'all' })
      .set(headers);
    expect(resAll.status).toBe(200);
    const rowsAll = parseNdjson(resAll.text);
    expect(rowsAll).toHaveLength(2);
    expect(new Set(rowsAll.map((r) => r.analysisId))).toEqual(
      new Set(['a-fb-o1', 'a-fb-o2']),
    );

    // 缺省 → owner 默认全局
    const resDefault = await request(app).get('/api/admin/stats/feedback/export').set(headers);
    expect(resDefault.status).toBe(200);
    expect(Number(resDefault.headers['x-row-count'])).toBe(2);

    // 指定具体租户 → 仅该租户
    const resScoped = await request(app)
      .get('/api/admin/stats/feedback/export')
      .query({ tenantId: OTHER_TENANT_ID })
      .set(headers);
    expect(resScoped.status).toBe(200);
    const rowsScoped = parseNdjson(resScoped.text);
    expect(rowsScoped).toHaveLength(1);
    expect(rowsScoped[0]!.analysisId).toBe('a-fb-o2');
  });

  it('E5: 权限控制(学生 403 / 未认证 401)', async () => {
    const { headers: studentHeaders } = setupStudentContext();
    const res403 = await request(app)
      .get('/api/admin/stats/feedback/export')
      .set(studentHeaders);
    assertApiError(res403, 2004, 403);

    const res401 = await request(app).get('/api/admin/stats/feedback/export');
    assertApiError(res401, 2001, 401);
  });

  it('E6: 空数据 0 行不炸', async () => {
    const { headers } = setupAdminContext();

    const res = await request(app).get('/api/admin/stats/feedback/export').set(headers);
    expect(res.status).toBe(200);
    expect(Number(res.headers['x-row-count'])).toBe(0);
    expect(res.text.trim()).toBe('');
  });
});
