// ============================================================
// 多租户数据隔离测试(Supertest 集成 + Repository 白盒)
// 对应文档:
//   - data-model-v1.md §7.2(强制 tenant_id 过滤)
//   - auth-design.md §2.4(中间件注入 tenant_id)
//   - api-contract-v1.md §3.4(租户/角色/成员关系)
//
// 测试目标:
//   验证租户 A 用户无法访问/修改租户 B 的数据,跨租户操作返回相应错误码。
//
// 测试维度(15 个用例,覆盖 T1-T15):
//   T1-T5   : Analysis 资源跨租户隔离(读/写/列表/角色权限)
//   T6-T10  : Tenant 资源跨租户隔离(切换/校验/激活)
//   T11     : User 资源跨租户隔离(更新资料)
//   T12     : Session 跨租户隔离(revokeAll 仅当前租户)
//   T13     : tenantMiddleware 拦截无 tenant_id 请求
//   T14-T15 : Repository 层强制 tenant_id 过滤(白盒)
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { getTestApp } from './helpers/test-app.js';
import { assertApiResponse, assertApiError } from './helpers/assertions.js';
import {
  createTestUser,
  createTestTenant,
  createTestSession,
  createTestTokenSet,
  buildAuthHeaders,
  TEST_TENANT_ID_A,
  TEST_TENANT_ID_B,
  TEST_USER_ID_A,
  TEST_USER_ID_B,
  TEST_DEVICE_ID,
  TEST_CLIENT_IP,
  TEST_USER_AGENT,
  TEST_FEISHU_OPEN_ID_A,
  TEST_FEISHU_OPEN_ID_B,
} from './helpers/fixtures.js';
import { prismaMock } from './mocks/prisma.mock.js';
import { ErrorCode } from '../src/types/api-contract.js';
import { analysisRepository } from '../src/repositories/analysis.repository.js';
import { sha256 } from '../src/utils/crypto.js';

// ============================================================
// 测试常量(本文件专用,避免与 fixtures 默认值冲突)
// ============================================================

const TEACHER_USER_ID_A = 'u-teacher-a-0001';
const STUDENT_USER_ID_A2 = 'u-student-a-0002';
const ADMIN_USER_ID_A = 'u-admin-a-0003';

const TENANT_NAME_A = '美术学院A';
const TENANT_NAME_B = '美术学院B';

const ANALYSIS_ID_A1 = 'a-analysis-a-0001';
const ANALYSIS_ID_B1 = 'a-analysis-b-0001';

// ============================================================
// 辅助:构造带 Authorization 头的请求选项
// ============================================================

function authHeaders(accessToken: string): Record<string, string> {
  return buildAuthHeaders(accessToken);
}

// ============================================================
// 多租户数据隔离测试主体
// ============================================================

describe('tenant-isolation (多租户数据隔离)', () => {
  beforeEach(() => {
    // setup.ts 全局 beforeEach 已清空 mock,这里预置共享测试数据
    // 租户 A:active + free plan
    createTestTenant({
      id: TEST_TENANT_ID_A,
      name: TENANT_NAME_A,
      type: 'college',
      plan: 'standard',
      status: 'active',
      maxSeats: 50,
    });
    // 租户 B:active + free plan
    createTestTenant({
      id: TEST_TENANT_ID_B,
      name: TENANT_NAME_B,
      type: 'college',
      plan: 'standard',
      status: 'active',
      maxSeats: 50,
    });

    // 租户 A 成员
    createTestUser({
      id: TEST_USER_ID_A,
      tenantId: TEST_TENANT_ID_A,
      feishuOpenId: TEST_FEISHU_OPEN_ID_A,
      feishuUnionId: 'on_union_a',
      name: '学生A1',
      role: 'student',
    });
    createTestUser({
      id: STUDENT_USER_ID_A2,
      tenantId: TEST_TENANT_ID_A,
      feishuOpenId: 'ou_student_a2',
      feishuUnionId: 'on_union_a2',
      name: '学生A2',
      role: 'student',
    });
    createTestUser({
      id: TEACHER_USER_ID_A,
      tenantId: TEST_TENANT_ID_A,
      feishuOpenId: 'ou_teacher_a',
      feishuUnionId: 'on_union_teacher_a',
      name: '教师A',
      role: 'teacher',
    });
    createTestUser({
      id: ADMIN_USER_ID_A,
      tenantId: TEST_TENANT_ID_A,
      feishuOpenId: 'ou_admin_a',
      feishuUnionId: 'on_union_admin_a',
      name: '管理员A',
      role: 'admin',
    });

    // 租户 B 成员
    createTestUser({
      id: TEST_USER_ID_B,
      tenantId: TEST_TENANT_ID_B,
      feishuOpenId: TEST_FEISHU_OPEN_ID_B,
      feishuUnionId: 'on_union_b',
      name: '学生B1',
      role: 'student',
    });

    // 租户 A 的分析记录(学生A1 创建)— createdAt 使用当前月,保障 countMonthlyUsage 测试稳定
    const nowDate = new Date();
    prismaMock.__insertAnalysis({
      id: ANALYSIS_ID_A1,
      tenantId: TEST_TENANT_ID_A,
      userId: TEST_USER_ID_A,
      workType: 'painting',
      imageUrl: 'https://example.com/a1.jpg',
      title: 'A1作品',
      status: 'success',
      overallScore: 85,
      createdAt: new Date(Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), 1, 10, 0, 0)),
    });
    // 租户 A 的另一条(学生A2 创建)
    prismaMock.__insertAnalysis({
      id: 'a-analysis-a-0002',
      tenantId: TEST_TENANT_ID_A,
      userId: STUDENT_USER_ID_A2,
      workType: 'design',
      imageUrl: 'https://example.com/a2.jpg',
      title: 'A2作品',
      status: 'success',
      overallScore: 78,
      createdAt: new Date(Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), 2, 10, 0, 0)),
    });
    // 租户 B 的分析记录(学生B1 创建)
    prismaMock.__insertAnalysis({
      id: ANALYSIS_ID_B1,
      tenantId: TEST_TENANT_ID_B,
      userId: TEST_USER_ID_B,
      workType: 'sculpture',
      imageUrl: 'https://example.com/b1.jpg',
      title: 'B1作品',
      status: 'success',
      overallScore: 92,
      createdAt: new Date(Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), 3, 10, 0, 0)),
    });
  });

  // ============================================================
  // T1: Analysis 跨租户读 - A 租户用户用 ID 直接访问 B 租户分析 → 404
  // ============================================================
  describe('T1: GET /analyses/:id 跨租户访问拦截', () => {
    it('should_return_404_when_tenant_a_user_access_tenant_b_analysis_by_id', async () => {
      const tokens = createTestTokenSet({
        userId: TEST_USER_ID_A,
        tenantId: TEST_TENANT_ID_A,
        role: 'student',
        feishuOpenId: TEST_FEISHU_OPEN_ID_A,
      });

      const res = await request(getTestApp())
        .get(`/api/v1/analyses/${ANALYSIS_ID_B1}`)
        .set(authHeaders(tokens.accessToken))
        .expect(404);

      assertApiError(res, ErrorCode.ANALYSIS_NOT_FOUND, 404);
      // 响应体不应泄露租户 B 的任何信息
      expect(res.body.data).toBeNull();
      const bodyStr = JSON.stringify(res.body);
      expect(bodyStr).not.toContain(TENANT_NAME_B);
      expect(bodyStr).not.toContain('B1作品');
    });

    it('should_return_200_when_tenant_a_user_access_own_tenant_analysis_by_id', async () => {
      const tokens = createTestTokenSet({
        userId: TEST_USER_ID_A,
        tenantId: TEST_TENANT_ID_A,
        role: 'student',
        feishuOpenId: TEST_FEISHU_OPEN_ID_A,
      });

      const res = await request(getTestApp())
        .get(`/api/v1/analyses/${ANALYSIS_ID_A1}`)
        .set(authHeaders(tokens.accessToken))
        .expect(200);

      const body = assertApiResponse(res);
      const data = body.data as { id: string; tenantId: string; title: string };
      expect(data.id).toBe(ANALYSIS_ID_A1);
      expect(data.tenantId).toBe(TEST_TENANT_ID_A);
      expect(data.title).toBe('A1作品');
    });
  });

  // ============================================================
  // T2: Analysis 列表隔离 - A 租户列表查询不含 B 租户记录
  // ============================================================
  describe('T2: GET /analyses 列表跨租户隔离', () => {
    it('should_return_only_current_tenant_analyses_in_list', async () => {
      const tokens = createTestTokenSet({
        userId: TEACHER_USER_ID_A,
        tenantId: TEST_TENANT_ID_A,
        role: 'teacher',
        feishuOpenId: 'ou_teacher_a',
      });

      const res = await request(getTestApp())
        .get('/api/v1/analyses')
        .set(authHeaders(tokens.accessToken))
        .expect(200);

      const body = assertApiResponse(res);
      const data = body.data as { items: Array<{ id: string; tenantId?: string }>; total: number };
      expect(data.total).toBe(2); // 仅租户 A 的 2 条
      const ids = data.items.map((i) => i.id);
      expect(ids).toContain(ANALYSIS_ID_A1);
      expect(ids).toContain('a-analysis-a-0002');
      expect(ids).not.toContain(ANALYSIS_ID_B1);
    });

    it('should_return_empty_list_when_tenant_has_no_analyses', async () => {
      // 租户 B 仅 1 条分析(B1),但学生 B1 视角只能看自己的(就是 B1)
      // 这里改用学生 B1 视角,验证 B 租户用户列表中不出现 A 租户记录
      const tokens = createTestTokenSet({
        userId: TEST_USER_ID_B,
        tenantId: TEST_TENANT_ID_B,
        role: 'student',
        feishuOpenId: TEST_FEISHU_OPEN_ID_B,
      });

      const res = await request(getTestApp())
        .get('/api/v1/analyses')
        .set(authHeaders(tokens.accessToken))
        .expect(200);

      const body = assertApiResponse(res);
      const data = body.data as { items: Array<{ id: string }>; total: number };
      expect(data.total).toBe(1);
      expect(data.items[0]!.id).toBe(ANALYSIS_ID_B1);
      // 确保租户 A 的记录不出现
      const ids = data.items.map((i) => i.id);
      expect(ids).not.toContain(ANALYSIS_ID_A1);
      expect(ids).not.toContain('a-analysis-a-0002');
    });
  });

  // ============================================================
  // T3: Analysis 跨租户写 - A 租户 token 创建分析时,数据落 A 租户
  // ============================================================
  describe('T3: POST /analyses 创建分析租户归属', () => {
    it('should_persist_analysis_with_jwt_tenant_id_not_request_body', async () => {
      const tokens = createTestTokenSet({
        userId: TEST_USER_ID_A,
        tenantId: TEST_TENANT_ID_A,
        role: 'student',
        feishuOpenId: TEST_FEISHU_OPEN_ID_A,
      });

      // 攻击尝试:请求体中注入 tenantId 字段(应被忽略)
      const res = await request(getTestApp())
        .post('/api/v1/analyses')
        .set(authHeaders(tokens.accessToken))
        .send({
          artType: 'painting',
          imageUrl: 'https://example.com/new.jpg',
          title: '新作品',
          remark: '测试',
          tenantId: TEST_TENANT_ID_B, // 注入攻击:试图归属到租户 B
        })
        .expect(200);

      const body = assertApiResponse(res);
      const data = body.data as { id: string; status: string };

      // 验证 DB 中该记录的 tenantId 是 A(JWT 中的),不是请求体中的 B
      const created = prismaMock.analysisStore.get(data.id);
      expect(created).toBeDefined();
      expect(created!.tenantId).toBe(TEST_TENANT_ID_A);
      expect(created!.tenantId).not.toBe(TEST_TENANT_ID_B);
      expect(created!.userId).toBe(TEST_USER_ID_A);
    });
  });

  // ============================================================
  // T4: Analysis 学生只能查自己 - 租户内仍有数据隔离
  // ============================================================
  describe('T4: GET /analyses 学生角色租户内隔离', () => {
    it('should_return_only_own_analyses_for_student_role', async () => {
      // 学生 A1 查询,只能看到自己创建的(1 条),看不到学生 A2 的
      const tokens = createTestTokenSet({
        userId: TEST_USER_ID_A,
        tenantId: TEST_TENANT_ID_A,
        role: 'student',
        feishuOpenId: TEST_FEISHU_OPEN_ID_A,
      });

      const res = await request(getTestApp())
        .get('/api/v1/analyses')
        .set(authHeaders(tokens.accessToken))
        .expect(200);

      const body = assertApiResponse(res);
      const data = body.data as { items: Array<{ id: string; userId?: string }>; total: number };
      expect(data.total).toBe(1);
      expect(data.items[0]!.id).toBe(ANALYSIS_ID_A1);
      // 不应出现学生 A2 的记录
      const ids = data.items.map((i) => i.id);
      expect(ids).not.toContain('a-analysis-a-0002');
    });

    it('should_return_only_own_analyses_even_when_student_specifies_other_userId', async () => {
      // 学生 A1 试图通过 userId 参数查询学生 A2 的记录(越权)
      const tokens = createTestTokenSet({
        userId: TEST_USER_ID_A,
        tenantId: TEST_TENANT_ID_A,
        role: 'student',
        feishuOpenId: TEST_FEISHU_OPEN_ID_A,
      });

      const res = await request(getTestApp())
        .get('/api/v1/analyses')
        .query({ userId: STUDENT_USER_ID_A2 }) // 试图查 A2 的记录
        .set(authHeaders(tokens.accessToken))
        .expect(200);

      const body = assertApiResponse(res);
      const data = body.data as { items: Array<{ id: string }>; total: number };
      // service 层强制覆盖:学生角色 effectiveUserId = 自己,忽略 query.userId
      expect(data.total).toBe(1);
      expect(data.items[0]!.id).toBe(ANALYSIS_ID_A1);
    });
  });

  // ============================================================
  // T5: Analysis 教师查租户全量
  // ============================================================
  describe('T5: GET /analyses 教师角色租户全量可见', () => {
    it('should_return_all_tenant_analyses_for_teacher_role', async () => {
      const tokens = createTestTokenSet({
        userId: TEACHER_USER_ID_A,
        tenantId: TEST_TENANT_ID_A,
        role: 'teacher',
        feishuOpenId: 'ou_teacher_a',
      });

      const res = await request(getTestApp())
        .get('/api/v1/analyses')
        .set(authHeaders(tokens.accessToken))
        .expect(200);

      const body = assertApiResponse(res);
      const data = body.data as { items: Array<{ id: string }>; total: number };
      // 教师可见租户 A 的全部 2 条(学生 A1 + 学生 A2)
      expect(data.total).toBe(2);
      const ids = data.items.map((i) => i.id);
      expect(ids).toContain(ANALYSIS_ID_A1);
      expect(ids).toContain('a-analysis-a-0002');
      expect(ids).not.toContain(ANALYSIS_ID_B1);
    });

    it('should_filter_by_userId_for_teacher_role', async () => {
      const tokens = createTestTokenSet({
        userId: TEACHER_USER_ID_A,
        tenantId: TEST_TENANT_ID_A,
        role: 'teacher',
        feishuOpenId: 'ou_teacher_a',
      });

      const res = await request(getTestApp())
        .get('/api/v1/analyses')
        .query({ userId: STUDENT_USER_ID_A2 })
        .set(authHeaders(tokens.accessToken))
        .expect(200);

      const body = assertApiResponse(res);
      const data = body.data as { items: Array<{ id: string }>; total: number };
      expect(data.total).toBe(1);
      expect(data.items[0]!.id).toBe('a-analysis-a-0002');
    });

    it('should_return_all_for_admin_role_too', async () => {
      const tokens = createTestTokenSet({
        userId: ADMIN_USER_ID_A,
        tenantId: TEST_TENANT_ID_A,
        role: 'admin',
        feishuOpenId: 'ou_admin_a',
      });

      const res = await request(getTestApp())
        .get('/api/v1/analyses')
        .set(authHeaders(tokens.accessToken))
        .expect(200);

      const body = assertApiResponse(res);
      const data = body.data as { items: Array<{ id: string }>; total: number };
      expect(data.total).toBe(2);
    });
  });

  // ============================================================
  // T6: Tenant 切换到非成员租户 → 403 FORBIDDEN
  // ============================================================
  describe('T6: POST /tenants/switch 切换到非成员租户', () => {
    it('should_return_403_when_switch_to_tenant_user_not_member_of', async () => {
      // 用户 A 不属于租户 B(未在 tenantMember 中)
      const tokens = createTestTokenSet({
        userId: TEST_USER_ID_A,
        tenantId: TEST_TENANT_ID_A,
        role: 'student',
        feishuOpenId: TEST_FEISHU_OPEN_ID_A,
      });

      const res = await request(getTestApp())
        .post('/api/v1/tenants/switch')
        .set(authHeaders(tokens.accessToken))
        .send({ tenantId: TEST_TENANT_ID_B })
        .expect(403);

      assertApiError(res, ErrorCode.FORBIDDEN, 403);
      // 响应体不应泄露租户 B 信息
      expect(res.body.data).toBeNull();
    });
  });

  // ============================================================
  // T7: Tenant 切换到不存在租户 → 404 TENANT_NOT_FOUND
  // ============================================================
  describe('T7: POST /tenants/switch 切换到不存在租户', () => {
    it('should_return_404_when_switch_to_nonexistent_tenant', async () => {
      const tokens = createTestTokenSet({
        userId: TEST_USER_ID_A,
        tenantId: TEST_TENANT_ID_A,
        role: 'student',
        feishuOpenId: TEST_FEISHU_OPEN_ID_A,
      });

      const res = await request(getTestApp())
        .post('/api/v1/tenants/switch')
        .set(authHeaders(tokens.accessToken))
        .send({ tenantId: 't-nonexistent-tenant-9999' })
        .expect(404);

      assertApiError(res, ErrorCode.TENANT_NOT_FOUND, 404);
    });
  });

  // ============================================================
  // T8: Tenant 切换到禁用租户 → 403 TENANT_DISABLED
  // ============================================================
  describe('T8: POST /tenants/switch 切换到禁用租户', () => {
    it('should_return_403_when_switch_to_disabled_tenant', async () => {
      // 创建一个禁用的租户,并把用户 A 加为成员
      const disabledTenantId = 't-disabled-tenant-0001';
      createTestTenant({
        id: disabledTenantId,
        name: '已禁用学院',
        type: 'college',
        status: 'disabled',
      });
      prismaMock.tenantMemberStore.set(
        `${TEST_USER_ID_A}_${disabledTenantId}`,
        {
          userId: TEST_USER_ID_A,
          tenantId: disabledTenantId,
          role: 'student',
          joinedAt: new Date(),
        },
      );

      const tokens = createTestTokenSet({
        userId: TEST_USER_ID_A,
        tenantId: TEST_TENANT_ID_A,
        role: 'student',
        feishuOpenId: TEST_FEISHU_OPEN_ID_A,
      });

      const res = await request(getTestApp())
        .post('/api/v1/tenants/switch')
        .set(authHeaders(tokens.accessToken))
        .send({ tenantId: disabledTenantId })
        .expect(403);

      assertApiError(res, ErrorCode.TENANT_DISABLED, 403);
    });
  });

  // ============================================================
  // T9: Tenant 切换成功签发新 token(含新 tenant_id)
  // ============================================================
  describe('T9: POST /tenants/switch 切换成功签发新 token', () => {
    it('should_issue_new_access_token_with_new_tenant_id_when_switch_success', async () => {
      // 把用户 A 也加入租户 B(模拟多租户成员)
      prismaMock.tenantMemberStore.set(`${TEST_USER_ID_A}_${TEST_TENANT_ID_B}`, {
        userId: TEST_USER_ID_A,
        tenantId: TEST_TENANT_ID_B,
        role: 'teacher',
        joinedAt: new Date(),
      });

      const tokens = createTestTokenSet({
        userId: TEST_USER_ID_A,
        tenantId: TEST_TENANT_ID_A,
        role: 'student',
        feishuOpenId: TEST_FEISHU_OPEN_ID_A,
      });

      const res = await request(getTestApp())
        .post('/api/v1/tenants/switch')
        .set(authHeaders(tokens.accessToken))
        .send({ tenantId: TEST_TENANT_ID_B })
        .expect(200);

      const body = assertApiResponse(res);
      const data = body.data as {
        accessToken: string;
        accessTokenExpiresAt: string;
        tenant: { id: string; name: string };
      };

      expect(data.accessToken).toBeTruthy();
      expect(data.tenant.id).toBe(TEST_TENANT_ID_B);
      expect(data.tenant.name).toBe(TENANT_NAME_B);

      // 解码新 token 验证 tenant_id 已更新
      const jwt = await import('jsonwebtoken');
      const decoded = jwt.decode(data.accessToken, { complete: true });
      const payload = decoded!.payload as Record<string, unknown>;
      expect(payload['tenant_id']).toBe(TEST_TENANT_ID_B);
      expect(payload['role']).toBe('teacher'); // 新租户内角色
      expect(payload.sub).toBe(TEST_USER_ID_A);

      // 新 token 可访问租户 B 的资源
      const res2 = await request(getTestApp())
        .get('/api/v1/analyses')
        .set(authHeaders(data.accessToken))
        .expect(200);
      const body2 = res2.body as { data: { items: Array<{ id: string }>; total: number } };
      expect(body2.data.total).toBe(1);
      expect(body2.data.items[0]!.id).toBe(ANALYSIS_ID_B1);
    });
  });

  // ============================================================
  // T10: Tenant current 返回当前激活租户信息
  // ============================================================
  describe('T10: GET /tenants/current 返回当前激活租户', () => {
    it('should_return_current_tenant_info_from_jwt_tenant_id', async () => {
      const tokens = createTestTokenSet({
        userId: TEST_USER_ID_A,
        tenantId: TEST_TENANT_ID_A,
        role: 'student',
        feishuOpenId: TEST_FEISHU_OPEN_ID_A,
      });

      const res = await request(getTestApp())
        .get('/api/v1/tenants/current')
        .set(authHeaders(tokens.accessToken))
        .expect(200);

      const body = assertApiResponse(res);
      const data = body.data as {
        id: string;
        name: string;
        type: string;
        plan: string;
        status: string;
        usedQuota?: number;
        maxQuota?: number;
      };
      expect(data.id).toBe(TEST_TENANT_ID_A);
      expect(data.name).toBe(TENANT_NAME_A);
      expect(data.type).toBe('college');
      expect(data.status).toBe('active');
      // 不应返回租户 B 的信息
      expect(data.id).not.toBe(TEST_TENANT_ID_B);
    });

    it('should_return_404_when_jwt_tenant_not_exist_in_db', async () => {
      // 清空租户后用旧 token 访问
      prismaMock.tenantStore.clear();
      // 重新插入 B(让 beforeEach 的部分场景不冲突)
      createTestTenant({ id: TEST_TENANT_ID_B, name: TENANT_NAME_B });

      const tokens = createTestTokenSet({
        userId: TEST_USER_ID_A,
        tenantId: TEST_TENANT_ID_A, // 已不存在
        role: 'student',
        feishuOpenId: TEST_FEISHU_OPEN_ID_A,
      });

      const res = await request(getTestApp())
        .get('/api/v1/tenants/current')
        .set(authHeaders(tokens.accessToken))
        .expect(404);

      assertApiError(res, ErrorCode.TENANT_NOT_FOUND, 404);
    });

    it('should_return_403_when_current_tenant_disabled', async () => {
      // 将租户 A 置为 disabled
      prismaMock.tenantStore.get(TEST_TENANT_ID_A)!.status = 'disabled';

      const tokens = createTestTokenSet({
        userId: TEST_USER_ID_A,
        tenantId: TEST_TENANT_ID_A,
        role: 'student',
        feishuOpenId: TEST_FEISHU_OPEN_ID_A,
      });

      const res = await request(getTestApp())
        .get('/api/v1/tenants/current')
        .set(authHeaders(tokens.accessToken))
        .expect(403);

      assertApiError(res, ErrorCode.TENANT_DISABLED, 403);
    });
  });

  // ============================================================
  // T11: User 跨租户更新被拒
  // ============================================================
  describe('T11: PATCH /users/profile 跨租户更新拦截', () => {
    it('should_return_401_when_user_tenant_id_mismatch_jwt_tenant_id', async () => {
      // 模拟:用户 A 的 tenantId 已被改为 B,但 JWT 还是 A
      prismaMock.userStore.get(TEST_USER_ID_A)!.tenantId = TEST_TENANT_ID_B;

      const tokens = createTestTokenSet({
        userId: TEST_USER_ID_A,
        tenantId: TEST_TENANT_ID_A, // JWT 中是 A
        role: 'student',
        feishuOpenId: TEST_FEISHU_OPEN_ID_A,
      });

      const res = await request(getTestApp())
        .patch('/api/v1/users/profile')
        .set(authHeaders(tokens.accessToken))
        .send({ name: '被篡改的名字' })
        .expect(401);

      assertApiError(res, ErrorCode.UNAUTHORIZED, 401);

      // 验证 DB 中用户名未被修改
      const user = prismaMock.userStore.get(TEST_USER_ID_A);
      expect(user!.name).not.toBe('被篡改的名字');
    });

    it('should_succeed_when_user_tenant_id_matches_jwt_tenant_id', async () => {
      const tokens = createTestTokenSet({
        userId: TEST_USER_ID_A,
        tenantId: TEST_TENANT_ID_A,
        role: 'student',
        feishuOpenId: TEST_FEISHU_OPEN_ID_A,
      });

      const res = await request(getTestApp())
        .patch('/api/v1/users/profile')
        .set(authHeaders(tokens.accessToken))
        .send({ name: '新名字A' })
        .expect(200);

      const body = assertApiResponse(res);
      const data = body.data as { id: string; name: string; tenantId: string };
      expect(data.id).toBe(TEST_USER_ID_A);
      expect(data.name).toBe('新名字A');
      expect(data.tenantId).toBe(TEST_TENANT_ID_A);
    });
  });

  // ============================================================
  // T12: Session revokeAll 仅当前租户
  // ============================================================
  describe('T12: POST /auth/logout revokeAll 仅撤销当前租户会话', () => {
    it('should_revoke_only_current_tenant_sessions_when_revokeAll', async () => {
      // 用户 A 在租户 A 有 1 个 session,在租户 B 也有 1 个 session(模拟多租户登录)
      const tokensA = createTestTokenSet({
        userId: TEST_USER_ID_A,
        tenantId: TEST_TENANT_ID_A,
        role: 'student',
        feishuOpenId: TEST_FEISHU_OPEN_ID_A,
      });
      createTestSession({
        id: 's-a-001',
        userId: TEST_USER_ID_A,
        tenantId: TEST_TENANT_ID_A,
        refreshTokenHash: sha256(tokensA.refreshToken),
      });
      // 租户 B 的 session(同用户,但 tenantId=B)
      createTestSession({
        id: 's-b-001',
        userId: TEST_USER_ID_A,
        tenantId: TEST_TENANT_ID_B,
        refreshTokenHash: sha256('other-refresh-token-b'),
      });

      // 不传 refresh_token Cookie,仅用 revokeAll=true
      // 这样 revokedSessions 计数 = revokeAllByUser 返回值(仅租户 A 的未撤销 session 数)
      const res = await request(getTestApp())
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${tokensA.accessToken}`)
        .send({ revokeAll: true })
        .expect(200);

      const body = assertApiResponse(res);
      const data = body.data as { revokedSessions: number };
      // 应仅撤销租户 A 的 1 个 session(不含租户 B 的)
      expect(data.revokedSessions).toBe(1);

      // 验证:租户 A 的 session 已撤销
      const sessionA = prismaMock.sessionStore.get('s-a-001');
      expect(sessionA?.revokedAt).not.toBeNull();

      // 验证:租户 B 的 session 仍有效(未被跨租户撤销)
      const sessionB = prismaMock.sessionStore.get('s-b-001');
      expect(sessionB?.revokedAt).toBeNull();
    });
  });

  // ============================================================
  // T13: tenantMiddleware 拦截无 tenant_id 请求
  // ============================================================
  describe('T13: tenantMiddleware 无 tenant_id 拦截', () => {
    it('should_return_401_when_jwt_missing_tenant_id_field', async () => {
      // 用 jsonwebtoken 直接签发一个无 tenant_id 的 token
      const jwt = await import('jsonwebtoken');
      const crypto = await import('node:crypto');
      const { testJwtKeys } = await import('./mocks/jwt-keys.mock.js');
      const payload = {
        sub: TEST_USER_ID_A,
        // 故意省略 tenant_id
        role: 'student',
        feishu_open_id: TEST_FEISHU_OPEN_ID_A,
        jti: crypto.randomUUID(),
        iss: 'danqing-ai-auth',
        aud: 'danqing-ai-web',
      };
      const tokenWithoutTenant = jwt.default.sign(payload, testJwtKeys.privateKey, {
        algorithm: 'RS256',
        expiresIn: '15m',
        keyid: 'test-kid-2026',
      });

      const res = await request(getTestApp())
        .get('/api/v1/analyses')
        .set('Authorization', `Bearer ${tokenWithoutTenant}`)
        .expect(401);

      assertApiError(res, ErrorCode.UNAUTHORIZED, 401);
    });

    it('should_reject_request_without_authorization_header', async () => {
      const res = await request(getTestApp())
        .get('/api/v1/analyses')
        .expect(401);

      assertApiError(res, ErrorCode.UNAUTHORIZED, 401);
    });
  });

  // ============================================================
  // T14: Repository 层强制 tenant_id 过滤(白盒)
  // ============================================================
  describe('T14: analysisRepository 强制 tenant_id 过滤(白盒)', () => {
    it('should_return_null_when_findById_with_mismatched_tenant_id', async () => {
      // 用租户 B 的 tenantId 查询租户 A 的分析 ID
      const result = await analysisRepository.findById(TEST_TENANT_ID_B, ANALYSIS_ID_A1);
      expect(result).toBeNull();
    });

    it('should_return_record_when_findById_with_matched_tenant_id', async () => {
      const result = await analysisRepository.findById(TEST_TENANT_ID_A, ANALYSIS_ID_A1);
      expect(result).not.toBeNull();
      expect(result!.id).toBe(ANALYSIS_ID_A1);
      expect(result!.tenantId).toBe(TEST_TENANT_ID_A);
    });

    it('should_return_null_when_findById_with_nonexistent_id', async () => {
      const result = await analysisRepository.findById(TEST_TENANT_ID_A, 'nonexistent-id-9999');
      expect(result).toBeNull();
    });

    it('should_list_only_specified_tenant_analyses', async () => {
      const resultA = await analysisRepository.list({
        tenantId: TEST_TENANT_ID_A,
        page: 1,
        pageSize: 50,
      });
      expect(resultA.total).toBe(2);
      expect(resultA.items.every((a) => a.tenantId === TEST_TENANT_ID_A)).toBe(true);

      const resultB = await analysisRepository.list({
        tenantId: TEST_TENANT_ID_B,
        page: 1,
        pageSize: 50,
      });
      expect(resultB.total).toBe(1);
      expect(resultB.items.every((a) => a.tenantId === TEST_TENANT_ID_B)).toBe(true);
      // 确认租户 B 的结果不含租户 A 的记录
      const idsB = resultB.items.map((a) => a.id);
      expect(idsB).not.toContain(ANALYSIS_ID_A1);
    });

    it('should_return_null_when_updateResult_with_mismatched_tenant_id', async () => {
      // 试图用租户 B 的 tenantId 更新租户 A 的分析 → 应返回 null(不更新)
      const result = await analysisRepository.updateResult(
        TEST_TENANT_ID_B,
        ANALYSIS_ID_A1,
        {
          status: 'failed',
          failureReason: '恶意篡改',
        },
      );
      expect(result).toBeNull();

      // 验证原记录未被修改
      const original = prismaMock.analysisStore.get(ANALYSIS_ID_A1);
      expect(original!.status).toBe('success');
      expect(original!.failureReason).toBeNull();
    });

    it('should_count_only_specified_tenant_monthly_usage', async () => {
      const now = new Date();
      const countA = await analysisRepository.countMonthlyUsage(
        TEST_TENANT_ID_A,
        now.getUTCFullYear(),
        now.getUTCMonth() + 1,
      );
      const countB = await analysisRepository.countMonthlyUsage(
        TEST_TENANT_ID_B,
        now.getUTCFullYear(),
        now.getUTCMonth() + 1,
      );
      expect(countA).toBe(2);
      expect(countB).toBe(1);
    });
  });

  // ============================================================
  // T15: 完整跨租户访问链路验证
  // ============================================================
  describe('T15: 完整跨租户访问链路(端到端)', () => {
    it('should_prevent_cross_tenant_access_via_direct_id_in_full_flow', async () => {
      // 场景:用户 B 试图通过完整流程访问租户 A 的资源
      // 1. 用户 B 登录(用 B 租户 token)
      const tokensB = createTestTokenSet({
        userId: TEST_USER_ID_B,
        tenantId: TEST_TENANT_ID_B,
        role: 'student',
        feishuOpenId: TEST_FEISHU_OPEN_ID_B,
      });

      // 2. 用户 B 试图访问租户 A 的分析详情 → 404
      const res1 = await request(getTestApp())
        .get(`/api/v1/analyses/${ANALYSIS_ID_A1}`)
        .set(authHeaders(tokensB.accessToken))
        .expect(404);
      assertApiError(res1, ErrorCode.ANALYSIS_NOT_FOUND, 404);

      // 3. 用户 B 查询列表,不应出现租户 A 的记录
      const res2 = await request(getTestApp())
        .get('/api/v1/analyses')
        .set(authHeaders(tokensB.accessToken))
        .expect(200);
      const listData = res2.body.data as { items: Array<{ id: string }>; total: number };
      expect(listData.total).toBe(1);
      const ids = listData.items.map((i) => i.id);
      expect(ids).not.toContain(ANALYSIS_ID_A1);
      expect(ids).not.toContain('a-analysis-a-0002');

      // 4. 用户 B 试图通过创建分析注入 tenantId=A → 数据应落在 B
      const res3 = await request(getTestApp())
        .post('/api/v1/analyses')
        .set(authHeaders(tokensB.accessToken))
        .send({
          artType: 'design',
          imageUrl: 'https://example.com/b-new.jpg',
          title: 'B新作品',
          tenantId: TEST_TENANT_ID_A, // 注入攻击
        })
        .expect(200);
      const createdId = (res3.body.data as { id: string }).id;
      const created = prismaMock.analysisStore.get(createdId);
      expect(created!.tenantId).toBe(TEST_TENANT_ID_B); // 落在 B,不是 A

      // 5. 用户 B 试图切换到租户 A(非成员)→ 403
      const res4 = await request(getTestApp())
        .post('/api/v1/tenants/switch')
        .set(authHeaders(tokensB.accessToken))
        .send({ tenantId: TEST_TENANT_ID_A })
        .expect(403);
      assertApiError(res4, ErrorCode.FORBIDDEN, 403);
    });

    it('should_enforce_isolation_consistently_across_user_and_analysis_apis', async () => {
      // 验证:即使 JWT 被伪造 tenant_id(实际上 jwtService 会校验签名,这里模拟合法 token)
      // 通过 jwtService 签发的 token,tenant_id 不可篡改(签名保护)
      // 这里测试:user A 用 A 的 token 访问 /users/profile,正常返回
      const tokensA = createTestTokenSet({
        userId: TEST_USER_ID_A,
        tenantId: TEST_TENANT_ID_A,
        role: 'student',
        feishuOpenId: TEST_FEISHU_OPEN_ID_A,
      });

      const res = await request(getTestApp())
        .get('/api/v1/users/profile')
        .set(authHeaders(tokensA.accessToken))
        .expect(200);

      const body = assertApiResponse(res);
      const data = body.data as { id: string; tenantId: string };
      expect(data.id).toBe(TEST_USER_ID_A);
      expect(data.tenantId).toBe(TEST_TENANT_ID_A);
      // 不应泄露租户 B 的任何字段
      expect(data.tenantId).not.toBe(TEST_TENANT_ID_B);
    });
  });

  // ============================================================
  // 附加:配额隔离(租户 A 配额耗尽不影响租户 B)
  // ============================================================
  describe('配额隔离:租户间配额独立计算', () => {
    it('should_count_quota_independently_per_tenant', async () => {
      // 给租户 A 注入 50 条分析记录(free plan 上限 50)
      // 但 beforeEach 已设置 plan=standard(2000/月),这里改回 free 测试
      prismaMock.tenantStore.get(TEST_TENANT_ID_A)!.plan = 'free';

      for (let i = 0; i < 50; i++) {
        prismaMock.__insertAnalysis({
          id: `a-quota-a-${i}`,
          tenantId: TEST_TENANT_ID_A,
          userId: TEST_USER_ID_A,
          workType: 'painting',
          imageUrl: `https://example.com/quota-${i}.jpg`,
          status: 'success',
          createdAt: new Date(),
        });
      }

      const tokensA = createTestTokenSet({
        userId: TEST_USER_ID_A,
        tenantId: TEST_TENANT_ID_A,
        role: 'student',
        feishuOpenId: TEST_FEISHU_OPEN_ID_A,
      });

      // 租户 A 用户创建分析 → 应触发配额超限(50/50)
      const resA = await request(getTestApp())
        .post('/api/v1/analyses')
        .set(authHeaders(tokensA.accessToken))
        .send({
          artType: 'painting',
          imageUrl: 'https://example.com/over-quota.jpg',
        })
        .expect(402);

      assertApiError(resA, ErrorCode.ANALYSIS_QUOTA_EXCEEDED, 402);

      // 租户 B 用户创建分析 → 应成功(B 配额独立,未耗尽)
      const tokensB = createTestTokenSet({
        userId: TEST_USER_ID_B,
        tenantId: TEST_TENANT_ID_B,
        role: 'student',
        feishuOpenId: TEST_FEISHU_OPEN_ID_B,
      });
      // 租户 B 也设为 free(上限 50),已有 1 条,还能创建
      prismaMock.tenantStore.get(TEST_TENANT_ID_B)!.plan = 'free';

      const resB = await request(getTestApp())
        .post('/api/v1/analyses')
        .set(authHeaders(tokensB.accessToken))
        .send({
          artType: 'painting',
          imageUrl: 'https://example.com/b-ok.jpg',
        })
        .expect(200);

      const bodyB = assertApiResponse(resB);
      expect((bodyB.data as { id: string }).id).toBeTruthy();
    });
  });
});
