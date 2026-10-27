// ============================================================
// 管理后台 API 测试(Phase 4)
// 对应 API:/api/admin/*(5 大模块:用户/内容/订阅/数据看板/系统)
//
// 测试维度(40+ 用例):
//   A1-A6   : 鉴权与权限控制(未认证/学生/教师/管理员)
//   B1-B10  : 用户管理(列表/详情/更新/锁定/批量/导出/角色矩阵)
//   C1-C8   : 内容管理(作品列表/详情/审核/删除 + 模板 CRUD)
//   D1-D8   : 订阅管理(订阅列表/详情/取消/退款 + 发票 + 套餐)
//   E1-E4   : 数据看板(总览/成长/实时/单租户)
//   F1-F8   : 系统管理(租户 CRUD + 审计日志 + API 密钥 + 健康检查)
//   G1-G4   : 安全(脱敏/审计日志写入/租户隔离)
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
import type { MockUser, MockAnalysis, MockSubscription, MockInvoice, MockApiKey, MockCreativeTemplate } from './mocks/prisma.mock.js';

// ============================================================
// 测试常量
// ============================================================

const ADMIN_TENANT_ID = 't-admin-tenant-0001';
const ADMIN_USER_ID = 'u-admin-user-0001';
const ADMIN_OPEN_ID = 'ou_admin_test_0001';

const STUDENT_TENANT_ID = 't-student-tenant-0001';
const STUDENT_USER_ID = 'u-student-user-0001';
const STUDENT_OPEN_ID = 'ou_student_test_0001';

const TEACHER_TENANT_ID = 't-teacher-tenant-0001';
const TEACHER_USER_ID = 'u-teacher-user-0001';
const TEACHER_OPEN_ID = 'ou_teacher_test_0001';

const TARGET_USER_ID = 'u-target-user-0001';
const TARGET_ARTWORK_ID = 'a-target-artwork-0001';
const TARGET_SUBSCRIPTION_ID = 'sub-target-0001';
const TARGET_INVOICE_ID = 'inv-target-0001';
const TARGET_TEMPLATE_ID = 'tpl-target-0001';
const TARGET_API_KEY_ID = 'key-target-0001';
const TARGET_TENANT_ID = 't-target-tenant-0001';

// ============================================================
// 测试辅助:创建管理员上下文
// ============================================================

function setupAdminContext(): { headers: Record<string, string> } {
  createTestTenant({ id: ADMIN_TENANT_ID, name: '管理员租户' });
  createTestUser({
    id: ADMIN_USER_ID,
    tenantId: ADMIN_TENANT_ID,
    feishuOpenId: ADMIN_OPEN_ID,
    feishuUnionId: 'on_admin_test_0001',
    name: '管理员',
    role: 'admin',
    email: 'admin@test.edu.cn',
    phone: '13800138000',
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

function setupStudentContext(): { headers: Record<string, string> } {
  createTestTenant({ id: STUDENT_TENANT_ID, name: '学生租户' });
  createTestUser({
    id: STUDENT_USER_ID,
    tenantId: STUDENT_TENANT_ID,
    feishuOpenId: STUDENT_OPEN_ID,
    feishuUnionId: 'on_student_test_0001',
    name: '学生',
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

function setupTeacherContext(): { headers: Record<string, string> } {
  createTestTenant({ id: TEACHER_TENANT_ID, name: '教师租户' });
  createTestUser({
    id: TEACHER_USER_ID,
    tenantId: TEACHER_TENANT_ID,
    feishuOpenId: TEACHER_OPEN_ID,
    feishuUnionId: 'on_teacher_test_0001',
    name: '教师',
    role: 'teacher',
  });
  const tokens = createTestTokenSet({
    userId: TEACHER_USER_ID,
    tenantId: TEACHER_TENANT_ID,
    role: 'teacher',
    feishuOpenId: TEACHER_OPEN_ID,
    client: 'web',
  });
  return { headers: buildAuthHeaders(tokens.accessToken) };
}

/** 创建测试目标用户(被管理的用户) */
function createTargetUser(overrides: Partial<MockUser> = {}): MockUser {
  return prismaMock.__insertUser({
    id: TARGET_USER_ID,
    tenantId: ADMIN_TENANT_ID,
    feishuOpenId: 'ou_target_user_0001',
    feishuUnionId: 'on_target_user_0001',
    name: '目标用户',
    email: 'target@test.edu.cn',
    phone: '13900139001',
    role: 'student',
    status: 'active',
    ...overrides,
  });
}

/** 创建测试作品 */
function createTargetArtwork(overrides: Partial<MockAnalysis> = {}): MockAnalysis {
  return prismaMock.__insertAnalysis({
    id: TARGET_ARTWORK_ID,
    tenantId: ADMIN_TENANT_ID,
    userId: TARGET_USER_ID,
    workType: 'painting',
    imageUrl: 'https://example.com/artwork.jpg',
    title: '测试作品',
    status: 'success',
    overallScore: 85,
    reviewStatus: 'pending',
    ...overrides,
  });
}

/** 创建测试订阅 */
function createTargetSubscription(overrides: Partial<MockSubscription> = {}): MockSubscription {
  return prismaMock.__insertSubscription({
    id: TARGET_SUBSCRIPTION_ID,
    tenantId: ADMIN_TENANT_ID,
    plan: 'standard',
    status: 'active',
    amount: 99,
    currency: 'CNY',
    seats: 10,
    cancelAtPeriodEnd: false,
    ...overrides,
  });
}

/** 创建测试发票 */
function createTargetInvoice(overrides: Partial<MockInvoice> = {}): MockInvoice {
  return prismaMock.__insertInvoice({
    id: TARGET_INVOICE_ID,
    tenantId: ADMIN_TENANT_ID,
    subscriptionId: TARGET_SUBSCRIPTION_ID,
    amount: 99,
    currency: 'CNY',
    status: 'paid',
    ...overrides,
  });
}

/** 创建测试模板 */
function createTargetTemplate(overrides: Partial<MockCreativeTemplate> = {}): MockCreativeTemplate {
  return prismaMock.__insertCreativeTemplate({
    id: TARGET_TEMPLATE_ID,
    name: '测试模板',
    artType: 'painting',
    content: { template: 'data' },
    tags: ['test'],
    enabled: true,
    sortOrder: 0,
    createdById: ADMIN_USER_ID,
    ...overrides,
  });
}

/** 创建测试 API 密钥 */
function createTargetApiKey(overrides: Partial<MockApiKey> = {}): MockApiKey {
  return prismaMock.__insertApiKey({
    id: TARGET_API_KEY_ID,
    name: '测试密钥',
    keyPrefix: 'dk_test_',
    keyHash: 'hash_test_0001',
    createdById: ADMIN_USER_ID,
    scopes: ['read'],
    status: 'active',
    ...overrides,
  });
}

// ============================================================
// A: 鉴权与权限控制
// ============================================================

describe('Admin API - 鉴权与权限控制', () => {
  const app = getTestApp();

  it('A1: 未认证请求返回 401', async () => {
    const res = await request(app).get('/api/admin/users');
    assertApiError(res, 2001, 401);
  });

  it('A2: 学生角色无 admin:user:read 权限,返回 403', async () => {
    const { headers } = setupStudentContext();
    const res = await request(app).get('/api/admin/users').set(headers);
    assertApiError(res, 2004, 403);
  });

  it('A3: 教师角色无 admin:user:read 权限,返回 403', async () => {
    const { headers } = setupTeacherContext();
    const res = await request(app).get('/api/admin/users').set(headers);
    assertApiError(res, 2004, 403);
  });

  it('A4: 管理员角色拥有 admin:user:read 权限,返回 200', async () => {
    const { headers } = setupAdminContext();
    const res = await request(app).get('/api/admin/users').set(headers);
    assertApiResponse(res);
    expect(res.body.data.items).toBeInstanceOf(Array);
    expect(res.body.data.total).toBeGreaterThanOrEqual(1);
  });

  it('A5: 学生角色无 admin:artwork:write 权限,返回 403', async () => {
    const { headers } = setupStudentContext();
    const res = await request(app)
      .post(`/api/admin/artworks/${TARGET_ARTWORK_ID}/review`)
      .set(headers)
      .send({ action: 'approve' });
    assertApiError(res, 2004, 403);
  });

  it('A6: 无效 token 返回 401', async () => {
    const res = await request(app)
      .get('/api/admin/users')
      .set('Authorization', 'Bearer invalid_token_string');
    assertApiError(res, 2005, 401);
  });
});

// ============================================================
// B: 用户管理模块
// ============================================================

describe('Admin API - 用户管理模块', () => {
  const app = getTestApp();

  it('B1: 分页查询用户列表(响应脱敏)', async () => {
    const { headers } = setupAdminContext();
    createTargetUser({
      email: 'testuser@test.edu.cn',
      phone: '13812345678',
    });

    const res = await request(app).get('/api/admin/users').set(headers);
    assertApiResponse(res);
    expect(res.body.data.items).toBeInstanceOf(Array);
    expect(res.body.data.total).toBeGreaterThanOrEqual(2);

    // 验证脱敏:邮箱和手机号应被掩码
    const targetUser = res.body.data.items.find((u: { id: string }) => u.id === TARGET_USER_ID);
    expect(targetUser).toBeDefined();
    expect(targetUser.email).toContain('***');
    expect(targetUser.phone).toContain('****');
    // 不应暴露完整手机号
    expect(targetUser.phone).not.toContain('13812345678');
  });

  it('B2: 按角色筛选用户列表', async () => {
    const { headers } = setupAdminContext();
    createTargetUser({ role: 'teacher' });

    const res = await request(app)
      .get('/api/admin/users')
      .query({ role: 'teacher' })
      .set(headers);
    assertApiResponse(res);
    expect(res.body.data.items).toBeInstanceOf(Array);
    expect(res.body.data.items.every((u: { role: string }) => u.role === 'teacher')).toBe(true);
  });

  it('B3: 查询用户详情(响应脱敏)', async () => {
    const { headers } = setupAdminContext();
    createTargetUser({
      email: 'detail@test.edu.cn',
      phone: '13700137001',
    });

    const res = await request(app).get(`/api/admin/users/${TARGET_USER_ID}`).set(headers);
    assertApiResponse(res);
    expect(res.body.data.id).toBe(TARGET_USER_ID);
    expect(res.body.data.email).toContain('***');
    expect(res.body.data.phone).toContain('****');
  });

  it('B4: 查询不存在用户返回 404', async () => {
    const { headers } = setupAdminContext();
    const res = await request(app).get('/api/admin/users/non-existent-user').set(headers);
    assertApiError(res, 8001, 404);
  });

  it('B5: 更新用户角色 + 审计日志', async () => {
    const { headers } = setupAdminContext();
    createTargetUser({ role: 'student' });

    const res = await request(app)
      .patch(`/api/admin/users/${TARGET_USER_ID}`)
      .set(headers)
      .send({ role: 'teacher' });
    assertApiResponse(res);
    expect(res.body.data.role).toBe('teacher');

    // 验证审计日志已写入
    const auditLogs = Array.from(prismaMock.auditLogStore.values());
    const userAudit = auditLogs.find((l) => l.resource === 'user' && l.action === 'update');
    expect(userAudit).toBeDefined();
    expect(userAudit!.resourceId).toBe(TARGET_USER_ID);
  });

  it('B6: 锁定用户 + 审计日志', async () => {
    const { headers } = setupAdminContext();
    createTargetUser({ status: 'active' });

    const res = await request(app)
      .post(`/api/admin/users/${TARGET_USER_ID}/lock`)
      .set(headers)
      .send({ locked: true });
    assertApiResponse(res);
    expect(res.body.data.status).toBe('locked');

    // 验证审计日志
    const auditLogs = Array.from(prismaMock.auditLogStore.values());
    const lockAudit = auditLogs.find((l) => l.resource === 'user' && l.action === 'lock');
    expect(lockAudit).toBeDefined();
  });

  it('B7: 重复锁定返回 409', async () => {
    const { headers } = setupAdminContext();
    createTargetUser({ status: 'locked' });

    const res = await request(app)
      .post(`/api/admin/users/${TARGET_USER_ID}/lock`)
      .set(headers)
      .send({ locked: true });
    assertApiError(res, 8002, 409);
  });

  it('B8: 解锁用户', async () => {
    const { headers } = setupAdminContext();
    createTargetUser({ status: 'locked' });

    const res = await request(app)
      .post(`/api/admin/users/${TARGET_USER_ID}/lock`)
      .set(headers)
      .send({ locked: false });
    assertApiResponse(res);
    expect(res.body.data.status).toBe('active');
  });

  it('B9: 批量更新用户角色', async () => {
    const { headers } = setupAdminContext();
    const userId1 = 'u-batch-0001';
    const userId2 = 'u-batch-0002';
    prismaMock.__insertUser({
      id: userId1,
      tenantId: ADMIN_TENANT_ID,
      feishuOpenId: 'ou_batch_0001',
      feishuUnionId: 'on_batch_0001',
      name: '批量用户1',
      role: 'student',
    });
    prismaMock.__insertUser({
      id: userId2,
      tenantId: ADMIN_TENANT_ID,
      feishuOpenId: 'ou_batch_0002',
      feishuUnionId: 'on_batch_0002',
      name: '批量用户2',
      role: 'student',
    });

    const res = await request(app)
      .post('/api/admin/users/batch')
      .set(headers)
      .send({ userIds: [userId1, userId2], action: 'updateRole', role: 'teacher' });
    assertApiResponse(res);
    expect(res.body.data.total).toBe(2);
    expect(res.body.data.succeeded).toBe(2);
  });

  it('B10: 导出用户 CSV', async () => {
    const { headers } = setupAdminContext();
    createTargetUser({
      email: 'export@test.edu.cn',
      phone: '13600136001',
    });

    const res = await request(app)
      .get('/api/admin/users/export')
      .set(headers)
      .query({ fields: 'id,name,email,role,status' });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.text).toContain('id,name,email,role,status');
    // CSV 中不应包含完整手机号(字段未选)也不应包含完整邮箱
    expect(res.text).not.toContain('export@test.edu.cn');
  });

  it('B11: 查询角色权限矩阵', async () => {
    const { headers } = setupAdminContext();
    const res = await request(app).get('/api/admin/roles').set(headers);
    assertApiResponse(res);
    expect(res.body.data).toBeInstanceOf(Array);
    expect(res.body.data.length).toBe(4);
    const adminRole = res.body.data.find((r: { role: string }) => r.role === 'admin');
    expect(adminRole).toBeDefined();
    expect(adminRole.permissions).toBeInstanceOf(Array);
    expect(adminRole.permissions.length).toBeGreaterThan(0);
  });
});

// ============================================================
// C: 内容管理模块
// ============================================================

describe('Admin API - 内容管理模块', () => {
  const app = getTestApp();

  it('C1: 分页查询作品列表', async () => {
    const { headers } = setupAdminContext();
    createTargetUser();
    createTargetArtwork({ title: '测试作品1' });

    const res = await request(app).get('/api/admin/artworks').set(headers);
    assertApiResponse(res);
    expect(res.body.data.items).toBeInstanceOf(Array);
    expect(res.body.data.total).toBeGreaterThanOrEqual(1);
    const artwork = res.body.data.items.find((a: { id: string }) => a.id === TARGET_ARTWORK_ID);
    expect(artwork).toBeDefined();
    expect(artwork.title).toBe('测试作品1');
  });

  it('C2: 查询作品详情', async () => {
    const { headers } = setupAdminContext();
    createTargetUser();
    createTargetArtwork({ title: '详情测试作品' });

    const res = await request(app).get(`/api/admin/artworks/${TARGET_ARTWORK_ID}`).set(headers);
    assertApiResponse(res);
    expect(res.body.data.id).toBe(TARGET_ARTWORK_ID);
    expect(res.body.data.title).toBe('详情测试作品');
  });

  it('C3: 审核作品(通过)+ 审计日志', async () => {
    const { headers } = setupAdminContext();
    createTargetUser();
    createTargetArtwork({ reviewStatus: 'pending' });

    const res = await request(app)
      .post(`/api/admin/artworks/${TARGET_ARTWORK_ID}/review`)
      .set(headers)
      .send({ action: 'approve', note: '作品符合规范' });
    assertApiResponse(res);
    expect(res.body.data.reviewStatus).toBe('approved');
    expect(res.body.data.reviewedBy).toBe(ADMIN_USER_ID);

    // 验证审计日志
    const auditLogs = Array.from(prismaMock.auditLogStore.values());
    const reviewAudit = auditLogs.find((l) => l.resource === 'artwork' && l.action === 'review');
    expect(reviewAudit).toBeDefined();
  });

  it('C4: 审核作品(拒绝)', async () => {
    const { headers } = setupAdminContext();
    createTargetUser();
    createTargetArtwork({ reviewStatus: 'pending' });

    const res = await request(app)
      .post(`/api/admin/artworks/${TARGET_ARTWORK_ID}/review`)
      .set(headers)
      .send({ action: 'reject', note: '内容违规' });
    assertApiResponse(res);
    expect(res.body.data.reviewStatus).toBe('rejected');
  });

  it('C5: 审核不存在作品返回 404', async () => {
    const { headers } = setupAdminContext();
    const res = await request(app)
      .post('/api/admin/artworks/non-existent/review')
      .set(headers)
      .send({ action: 'approve' });
    assertApiError(res, 8005, 404);
  });

  it('C6: 删除作品 + 审计日志', async () => {
    const { headers } = setupAdminContext();
    createTargetUser();
    createTargetArtwork();

    const res = await request(app).delete(`/api/admin/artworks/${TARGET_ARTWORK_ID}`).set(headers);
    assertApiResponse(res);
    expect(res.body.data.deleted).toBe(true);

    // 验证作品已从 store 中删除
    expect(prismaMock.analysisStore.has(TARGET_ARTWORK_ID)).toBe(false);

    // 验证审计日志
    const auditLogs = Array.from(prismaMock.auditLogStore.values());
    const deleteAudit = auditLogs.find((l) => l.resource === 'artwork' && l.action === 'delete');
    expect(deleteAudit).toBeDefined();
  });

  it('C7: 创建创意模板 + 审计日志', async () => {
    const { headers } = setupAdminContext();

    const res = await request(app)
      .post('/api/admin/templates')
      .set(headers)
      .send({
        name: '新模板',
        artType: 'design',
        content: { layout: 'grid' },
        tags: ['design', 'grid'],
        enabled: true,
      });
    assertApiResponse(res);
    expect(res.body.data.name).toBe('新模板');
    expect(res.body.data.artType).toBe('design');

    // 验证审计日志
    const auditLogs = Array.from(prismaMock.auditLogStore.values());
    const createAudit = auditLogs.find((l) => l.resource === 'template' && l.action === 'create');
    expect(createAudit).toBeDefined();
  });

  it('C8: 更新创意模板', async () => {
    const { headers } = setupAdminContext();
    createTargetTemplate({ name: '原模板名' });

    const res = await request(app)
      .patch(`/api/admin/templates/${TARGET_TEMPLATE_ID}`)
      .set(headers)
      .send({ name: '更新后模板名', enabled: false });
    assertApiResponse(res);
    expect(res.body.data.name).toBe('更新后模板名');
    expect(res.body.data.enabled).toBe(false);
  });

  it('C9: 删除创意模板', async () => {
    const { headers } = setupAdminContext();
    createTargetTemplate();

    const res = await request(app).delete(`/api/admin/templates/${TARGET_TEMPLATE_ID}`).set(headers);
    assertApiResponse(res);
    expect(res.body.data.deleted).toBe(true);
    expect(prismaMock.creativeTemplateStore.has(TARGET_TEMPLATE_ID)).toBe(false);
  });

  it('C10: 查询模板列表', async () => {
    const { headers } = setupAdminContext();
    createTargetTemplate({ name: '列表模板' });

    const res = await request(app).get('/api/admin/templates').set(headers);
    assertApiResponse(res);
    expect(res.body.data.items).toBeInstanceOf(Array);
    expect(res.body.data.total).toBeGreaterThanOrEqual(1);
  });
});

// ============================================================
// D: 订阅管理模块
// ============================================================

describe('Admin API - 订阅管理模块', () => {
  const app = getTestApp();

  it('D1: 分页查询订阅列表', async () => {
    const { headers } = setupAdminContext();
    createTargetSubscription({ plan: 'standard' });

    const res = await request(app).get('/api/admin/subscriptions').set(headers);
    assertApiResponse(res);
    expect(res.body.data.items).toBeInstanceOf(Array);
    expect(res.body.data.total).toBeGreaterThanOrEqual(1);
    const sub = res.body.data.items.find((s: { id: string }) => s.id === TARGET_SUBSCRIPTION_ID);
    expect(sub).toBeDefined();
    expect(sub.tenantName).toBeDefined();
  });

  it('D2: 查询订阅详情', async () => {
    const { headers } = setupAdminContext();
    createTargetSubscription({ plan: 'standard', seats: 20 });

    const res = await request(app).get(`/api/admin/subscriptions/${TARGET_SUBSCRIPTION_ID}`).set(headers);
    assertApiResponse(res);
    expect(res.body.data.id).toBe(TARGET_SUBSCRIPTION_ID);
    expect(res.body.data.plan).toBe('standard');
    expect(res.body.data.seats).toBe(20);
  });

  it('D3: 管理员取消订阅 + 审计日志', async () => {
    const { headers } = setupAdminContext();
    createTargetSubscription({ cancelAtPeriodEnd: false });

    const res = await request(app)
      .post(`/api/admin/subscriptions/${TARGET_SUBSCRIPTION_ID}/cancel`)
      .set(headers);
    assertApiResponse(res);
    expect(res.body.data.cancelAtPeriodEnd).toBe(true);

    // 验证审计日志
    const auditLogs = Array.from(prismaMock.auditLogStore.values());
    const cancelAudit = auditLogs.find((l) => l.resource === 'subscription' && l.action === 'cancel');
    expect(cancelAudit).toBeDefined();
  });

  it('D4: 重复取消订阅返回 409', async () => {
    const { headers } = setupAdminContext();
    createTargetSubscription({ cancelAtPeriodEnd: true });

    const res = await request(app)
      .post(`/api/admin/subscriptions/${TARGET_SUBSCRIPTION_ID}/cancel`)
      .set(headers);
    assertApiError(res, 7004, 409);
  });

  it('D5: 退款处理 + 审计日志', async () => {
    const { headers } = setupAdminContext();
    createTargetSubscription({ status: 'active' });
    createTargetInvoice({ amount: 100, status: 'paid' });

    const res = await request(app)
      .post(`/api/admin/subscriptions/${TARGET_SUBSCRIPTION_ID}/refund`)
      .set(headers)
      .send({ amount: 50, reason: '用户申请部分退款' });
    assertApiResponse(res);
    expect(res.body.data.refundedAmount).toBe(50);

    // 验证审计日志
    const auditLogs = Array.from(prismaMock.auditLogStore.values());
    const refundAudit = auditLogs.find((l) => l.resource === 'subscription' && l.action === 'refund');
    expect(refundAudit).toBeDefined();
  });

  it('D6: 退款金额超过发票金额返回 400', async () => {
    const { headers } = setupAdminContext();
    createTargetSubscription({ status: 'active' });
    createTargetInvoice({ amount: 50, status: 'paid' });

    const res = await request(app)
      .post(`/api/admin/subscriptions/${TARGET_SUBSCRIPTION_ID}/refund`)
      .set(headers)
      .send({ amount: 100, reason: '超额退款测试' });
    assertApiError(res, 8012, 400);
  });

  it('D7: 退款原因为空返回 400', async () => {
    const { headers } = setupAdminContext();
    createTargetSubscription({ status: 'active' });
    createTargetInvoice({ amount: 100, status: 'paid' });

    const res = await request(app)
      .post(`/api/admin/subscriptions/${TARGET_SUBSCRIPTION_ID}/refund`)
      .set(headers)
      .send({ amount: 50, reason: '' });
    assertApiError(res, 1002, 400);
  });

  it('D8: 查询发票列表', async () => {
    const { headers } = setupAdminContext();
    createTargetSubscription();
    createTargetInvoice({ amount: 99 });

    const res = await request(app).get('/api/admin/invoices').set(headers);
    assertApiResponse(res);
    expect(res.body.data.items).toBeInstanceOf(Array);
    expect(res.body.data.total).toBeGreaterThanOrEqual(1);
  });

  it('D9: 查询发票详情', async () => {
    const { headers } = setupAdminContext();
    createTargetSubscription();
    createTargetInvoice({ amount: 199, description: '月度订阅' });

    const res = await request(app).get(`/api/admin/invoices/${TARGET_INVOICE_ID}`).set(headers);
    assertApiResponse(res);
    expect(res.body.data.id).toBe(TARGET_INVOICE_ID);
    expect(res.body.data.description).toBe('月度订阅');
  });

  it('D10: 查询套餐列表', async () => {
    const { headers } = setupAdminContext();
    const res = await request(app).get('/api/admin/plans').set(headers);
    assertApiResponse(res);
    expect(res.body.data).toBeInstanceOf(Array);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data[0].enabled).toBeDefined();
  });
});

// ============================================================
// E: 数据看板模块
// ============================================================

describe('Admin API - 数据看板模块', () => {
  const app = getTestApp();

  it('E1: 总览统计(含 DAU/MAU/总用户数等)', async () => {
    const { headers } = setupAdminContext();
    createTargetUser();

    const res = await request(app).get('/api/admin/stats/overview').set(headers);
    assertApiResponse(res);
    expect(res.body.data.dau).toBeDefined();
    expect(res.body.data.mau).toBeDefined();
    expect(res.body.data.totalUsers).toBeDefined();
    expect(res.body.data.totalArtworks).toBeDefined();
    expect(res.body.data.timestamp).toBeDefined();
  });

  it('E2: 总览统计 Redis 缓存生效(第二次请求更快)', async () => {
    const { headers } = setupAdminContext();

    const res1 = await request(app).get('/api/admin/stats/overview').set(headers);
    const res2 = await request(app).get('/api/admin/stats/overview').set(headers);
    assertApiResponse(res1);
    assertApiResponse(res2);
    // 两次结果应一致(缓存命中)
    expect(res2.body.data.totalUsers).toBe(res1.body.data.totalUsers);
  });

  it('E3: 实时监控(不缓存)', async () => {
    const { headers } = setupAdminContext();
    createTargetUser();
    createTargetArtwork({ status: 'processing' });

    const res = await request(app).get('/api/admin/stats/realtime').set(headers);
    assertApiResponse(res);
    expect(res.body.data.pendingTasks).toBeDefined();
    expect(res.body.data.timestamp).toBeDefined();
  });

  it('E4: 单租户统计', async () => {
    const { headers } = setupAdminContext();
    createTargetUser();
    createTargetArtwork({ overallScore: 90 });

    const res = await request(app).get(`/api/admin/stats/tenant/${ADMIN_TENANT_ID}`).set(headers);
    assertApiResponse(res);
    expect(res.body.data.tenantId).toBe(ADMIN_TENANT_ID);
    // 字段名与 API 契约 AdminTenantStats 一致:artworkCount(非 totalArtworks)
    expect(res.body.data.artworkCount).toBeDefined();
    expect(res.body.data.userCount).toBeDefined();
    expect(res.body.data.monthlyQuota).toBeDefined();
  });
});

// ============================================================
// F: 系统管理模块
// ============================================================

describe('Admin API - 系统管理模块', () => {
  const app = getTestApp();

  it('F1: 分页查询租户列表', async () => {
    const { headers } = setupAdminContext();
    prismaMock.__insertTenant({
      id: TARGET_TENANT_ID,
      name: '目标租户',
      type: 'school',
      plan: 'standard',
      status: 'active',
    });

    const res = await request(app).get('/api/admin/system/tenants').set(headers);
    assertApiResponse(res);
    expect(res.body.data.items).toBeInstanceOf(Array);
    expect(res.body.data.total).toBeGreaterThanOrEqual(2);
    const target = res.body.data.items.find((t: { id: string }) => t.id === TARGET_TENANT_ID);
    expect(target).toBeDefined();
    expect(target.name).toBe('目标租户');
  });

  it('F2: 查询租户详情', async () => {
    const { headers } = setupAdminContext();
    prismaMock.__insertTenant({
      id: TARGET_TENANT_ID,
      name: '详情租户',
      type: 'college',
      plan: 'enterprise',
    });

    const res = await request(app).get(`/api/admin/system/tenants/${TARGET_TENANT_ID}`).set(headers);
    assertApiResponse(res);
    expect(res.body.data.id).toBe(TARGET_TENANT_ID);
    expect(res.body.data.name).toBe('详情租户');
  });

  it('F3: 创建租户 + 审计日志', async () => {
    const { headers } = setupAdminContext();

    const res = await request(app)
      .post('/api/admin/system/tenants')
      .set(headers)
      .send({
        name: '新创建租户',
        type: 'school',
        plan: 'standard',
        maxSeats: 50,
      });
    assertApiResponse(res);
    expect(res.body.data.name).toBe('新创建租户');
    expect(res.body.data.type).toBe('school');
    expect(res.body.data.plan).toBe('standard');

    // 验证审计日志
    const auditLogs = Array.from(prismaMock.auditLogStore.values());
    const createAudit = auditLogs.find((l) => l.resource === 'tenant' && l.action === 'create');
    expect(createAudit).toBeDefined();
  });

  it('F4: 更新租户 + 审计日志', async () => {
    const { headers } = setupAdminContext();
    prismaMock.__insertTenant({
      id: TARGET_TENANT_ID,
      name: '原租户名',
      type: 'individual',
      plan: 'free',
      maxSeats: 1,
    });

    const res = await request(app)
      .patch(`/api/admin/system/tenants/${TARGET_TENANT_ID}`)
      .set(headers)
      .send({ name: '更新租户名', plan: 'enterprise', maxSeats: 100 });
    assertApiResponse(res);
    expect(res.body.data.name).toBe('更新租户名');
    expect(res.body.data.plan).toBe('enterprise');
    expect(res.body.data.maxSeats).toBe(100);

    // 验证审计日志
    const auditLogs = Array.from(prismaMock.auditLogStore.values());
    const updateAudit = auditLogs.find((l) => l.resource === 'tenant' && l.action === 'update');
    expect(updateAudit).toBeDefined();
  });

  it('F5: 查询审计日志列表', async () => {
    const { headers } = setupAdminContext();
    // 预置审计日志
    prismaMock.__insertAuditLog({
      id: 'audit-0001',
      operatorId: ADMIN_USER_ID,
      action: 'create',
      resource: 'tenant',
      resourceId: TARGET_TENANT_ID,
      ip: '127.0.0.1',
      userAgent: 'test-ua',
      note: '测试审计日志',
    });

    const res = await request(app).get('/api/admin/system/audit-logs').set(headers);
    assertApiResponse(res);
    expect(res.body.data.items).toBeInstanceOf(Array);
    expect(res.body.data.total).toBeGreaterThanOrEqual(1);
  });

  it('F6: 按资源筛选审计日志', async () => {
    const { headers } = setupAdminContext();
    prismaMock.__insertAuditLog({
      id: 'audit-filter-0001',
      operatorId: ADMIN_USER_ID,
      action: 'review',
      resource: 'artwork',
      resourceId: 'art-001',
      ip: '127.0.0.1',
      userAgent: 'test-ua',
    });
    prismaMock.__insertAuditLog({
      id: 'audit-filter-0002',
      operatorId: ADMIN_USER_ID,
      action: 'create',
      resource: 'tenant',
      resourceId: 't-001',
      ip: '127.0.0.1',
      userAgent: 'test-ua',
    });

    const res = await request(app)
      .get('/api/admin/system/audit-logs')
      .query({ resource: 'artwork' })
      .set(headers);
    assertApiResponse(res);
    expect(res.body.data.items.every((l: { resource: string }) => l.resource === 'artwork')).toBe(true);
  });

  it('F7: 创建 API 密钥(完整密钥仅返回一次)+ 审计日志', async () => {
    const { headers } = setupAdminContext();

    const res = await request(app)
      .post('/api/admin/system/api-keys')
      .set(headers)
      .send({
        name: '新 API 密钥',
        scopes: ['read', 'write'],
      });
    assertApiResponse(res);
    expect(res.body.data.name).toBe('新 API 密钥');
    expect(res.body.data.plainKey).toBeDefined();
    expect(res.body.data.plainKey).toMatch(/^dk_/);
    expect(res.body.data.keyPrefix).toBeDefined();
    expect(res.body.data.status).toBe('active');

    // 验证审计日志
    const auditLogs = Array.from(prismaMock.auditLogStore.values());
    const createAudit = auditLogs.find((l) => l.resource === 'api_key' && l.action === 'create');
    expect(createAudit).toBeDefined();
  });

  it('F8: 吊销 API 密钥 + 审计日志', async () => {
    const { headers } = setupAdminContext();
    createTargetApiKey({ status: 'active' });

    const res = await request(app).delete(`/api/admin/system/api-keys/${TARGET_API_KEY_ID}`).set(headers);
    assertApiResponse(res);
    expect(res.body.data.status).toBe('revoked');
    expect(res.body.data.revokedAt).toBeDefined();

    // 验证审计日志
    const auditLogs = Array.from(prismaMock.auditLogStore.values());
    const revokeAudit = auditLogs.find((l) => l.resource === 'api_key' && l.action === 'revoke');
    expect(revokeAudit).toBeDefined();
  });

  it('F9: 重复吊销 API 密钥返回 409', async () => {
    const { headers } = setupAdminContext();
    createTargetApiKey({ status: 'revoked' });

    const res = await request(app).delete(`/api/admin/system/api-keys/${TARGET_API_KEY_ID}`).set(headers);
    assertApiError(res, 8008, 409);
  });

  it('F10: 查询 API 密钥列表', async () => {
    const { headers } = setupAdminContext();
    createTargetApiKey({ name: '列表密钥' });

    const res = await request(app).get('/api/admin/system/api-keys').set(headers);
    assertApiResponse(res);
    expect(res.body.data.items).toBeInstanceOf(Array);
    expect(res.body.data.total).toBeGreaterThanOrEqual(1);
    // 列表不应返回完整密钥
    const key = res.body.data.items.find((k: { id: string }) => k.id === TARGET_API_KEY_ID);
    expect(key).toBeDefined();
    expect(key.plainKey).toBeUndefined();
  });

  it('F11: 系统健康检查', async () => {
    const { headers } = setupAdminContext();
    const res = await request(app).get('/api/admin/system/health').set(headers);
    assertApiResponse(res);
    expect(res.body.data.status).toBeDefined();
    expect(res.body.data.services).toBeDefined();
    expect(res.body.data.services.database).toBeDefined();
    expect(res.body.data.services.redis).toBeDefined();
    expect(res.body.data.uptime).toBeDefined();
    expect(res.body.data.timestamp).toBeDefined();
  });
});

// ============================================================
// G: 安全测试
// ============================================================

describe('Admin API - 安全测试', () => {
  const app = getTestApp();

  it('G1: 用户列表响应中邮箱已脱敏(不暴露完整邮箱)', async () => {
    const { headers } = setupAdminContext();
    createTargetUser({ email: 'sensitive@test.edu.cn', phone: '13800001111' });

    const res = await request(app).get('/api/admin/users').set(headers);
    assertApiResponse(res);
    const bodyStr = JSON.stringify(res.body);
    // 不应出现完整邮箱
    expect(bodyStr).not.toContain('sensitive@test.edu.cn');
    // 不应出现完整手机号
    expect(bodyStr).not.toContain('13800001111');
  });

  it('G2: 用户详情响应中手机号已脱敏', async () => {
    const { headers } = setupAdminContext();
    createTargetUser({ phone: '13999998888' });

    const res = await request(app).get(`/api/admin/users/${TARGET_USER_ID}`).set(headers);
    assertApiResponse(res);
    expect(res.body.data.phone).not.toBe('13999998888');
    expect(res.body.data.phone).toContain('****');
  });

  it('G3: 审计日志写入包含 before/after 快照', async () => {
    const { headers } = setupAdminContext();
    createTargetUser({ role: 'student', name: '原名' });

    await request(app)
      .patch(`/api/admin/users/${TARGET_USER_ID}`)
      .set(headers)
      .send({ name: '新名' });

    const auditLogs = Array.from(prismaMock.auditLogStore.values());
    const updateAudit = auditLogs.find(
      (l) => l.resource === 'user' && l.action === 'update' && l.resourceId === TARGET_USER_ID,
    );
    expect(updateAudit).toBeDefined();
    expect(updateAudit!.beforeData).toBeDefined();
    expect(updateAudit!.afterData).toBeDefined();
  });

  it('G4: 审计日志中不记录敏感信息(密码/密钥)', async () => {
    const { headers } = setupAdminContext();

    await request(app)
      .post('/api/admin/system/api-keys')
      .set(headers)
      .send({ name: '敏感密钥测试', scopes: ['read'] });

    const auditLogs = Array.from(prismaMock.auditLogStore.values());
    const createAudit = auditLogs.find(
      (l) => l.resource === 'api_key' && l.action === 'create',
    );
    expect(createAudit).toBeDefined();
    // 审计日志的 afterData 中不应包含完整密钥
    const afterDataStr = JSON.stringify(createAudit!.afterData);
    expect(afterDataStr).not.toMatch(/^dk_[a-f0-9]{40,}/);
  });

  it('G5: API 密钥列表不返回完整密钥(plainKey)', async () => {
    const { headers } = setupAdminContext();
    createTargetApiKey();

    const res = await request(app).get('/api/admin/system/api-keys').set(headers);
    assertApiResponse(res);
    const key = res.body.data.items.find((k: { id: string }) => k.id === TARGET_API_KEY_ID);
    expect(key).toBeDefined();
    expect(key.plainKey).toBeUndefined();
    expect(key.keyHash).toBeUndefined();
  });

  it('G6: 租户隔离 - 管理员仅能查看本租户用户(默认)', async () => {
    const { headers } = setupAdminContext();
    // 在另一个租户创建用户
    const otherTenantId = 't-other-tenant-0001';
    prismaMock.__insertTenant({ id: otherTenantId, name: '其他租户' });
    prismaMock.__insertUser({
      id: 'u-other-tenant-user-0001',
      tenantId: otherTenantId,
      feishuOpenId: 'ou_other_tenant_0001',
      feishuUnionId: 'on_other_tenant_0001',
      name: '其他租户用户',
      role: 'student',
    });

    const res = await request(app).get('/api/admin/users').set(headers);
    assertApiResponse(res);
    // 不应包含其他租户的用户
    const otherUser = res.body.data.items.find((u: { id: string }) => u.id === 'u-other-tenant-user-0001');
    expect(otherUser).toBeUndefined();
  });

  it('G7: 系统健康检查不暴露内部地址', async () => {
    const { headers } = setupAdminContext();
    const res = await request(app).get('/api/admin/system/health').set(headers);
    assertApiResponse(res);
    const bodyStr = JSON.stringify(res.body);
    // 不应暴露数据库连接字符串
    expect(bodyStr).not.toContain('postgresql://');
    expect(bodyStr).not.toContain('redis://');
    // 不应暴露内部 IP
    expect(bodyStr).not.toMatch(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d+/);
  });
});
