// ============================================================
// RBAC 权限体系测试(单元 + 集成)
// 对应文档:
//   - .trae/documents/auth-design.md §2.4(多租户 JWT 处理 + RBAC)
//   - .trae/documents/api-contract-v1.md §3.4(角色与权限)
//   - server/src/config/permissions.ts(权限矩阵定义)
//   - server/src/middlewares/permission.ts(权限检查中间件)
//
// 测试维度(覆盖 30+ 用例):
//   P1-P6   : 权限矩阵纯函数单元测试(hasPermission / hasAnyPermission / hasAllPermissions)
//   P7-P11  : 权限中间件单元测试(requirePermission / requireAnyPermission / requireAllPermissions)
//   P12-P17 : Analysis 资源权限集成测试(创建/读/删 × 4 角色)
//   P18-P22 : Tenant 成员管理权限集成测试(列表/邀请/移除 × 4 角色)
//   P23-P25 : 数据范围过滤集成测试(student/teacher/admin 视图差异)
//   P26-P28 : 边界与安全策略(默认拒绝/无角色/越权不泄露存在性)
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { getTestApp } from './helpers/test-app.js';
import { assertApiResponse, assertApiError } from './helpers/assertions.js';
import {
  createTestUser,
  createTestTenant,
  createTestTokenSet,
  buildAuthHeaders,
  TEST_TENANT_ID_A,
  TEST_USER_ID_A,
} from './helpers/fixtures.js';
import { prismaMock } from './mocks/prisma.mock.js';
import {
  hasPermission,
  hasAnyPermission,
  hasAllPermissions,
  getPermissionsByRole,
  canReadTenantWide,
  canDeleteTenantWide,
  ROLE_PERMISSIONS,
  ALL_PERMISSIONS,
  type Permission,
} from '../src/config/permissions.js';
import {
  requirePermission,
  requireAnyPermission,
  requireAllPermissions,
} from '../src/middlewares/permission.js';
import { ErrorCode, type UserRole } from '../src/types/api-contract.js';
import type { Request, Response, NextFunction, RequestHandler } from 'express';

// ============================================================
// 测试常量(本文件专用,避免与 fixtures 默认值冲突)
// ============================================================

const TENANT_ID = 't-rbac-tenant-0001';
const STUDENT_ID = 'u-rbac-student-0001';
const STUDENT_ID_2 = 'u-rbac-student-0002';
const TEACHER_ID = 'u-rbac-teacher-0001';
const ADMIN_ID = 'u-rbac-admin-0001';
const OWNER_ID = 'u-rbac-owner-0001';

const STUDENT_OPEN_ID = 'ou_rbac_student';
const STUDENT_OPEN_ID_2 = 'ou_rbac_student_2';
const TEACHER_OPEN_ID = 'ou_rbac_teacher';
const ADMIN_OPEN_ID = 'ou_rbac_admin';
const OWNER_OPEN_ID = 'ou_rbac_owner';

const ANALYSIS_OWN_STUDENT = 'a-rbac-student-own-0001';
const ANALYSIS_OWN_STUDENT_2 = 'a-rbac-student-own-0002';
const ANALYSIS_OWN_TEACHER = 'a-rbac-teacher-own-0001';

// ============================================================
// Express mock 工厂(用于中间件单元测试)
// ============================================================

type MockRequest = Partial<Request> & {
  headers: Record<string, string | string[] | undefined>;
  traceId?: string;
  userId?: string;
  tenantId?: string;
  role?: UserRole;
  url?: string;
  method?: string;
};

type MockResponse = {
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
  req: MockRequest;
};

function createMockReq(overrides: MockRequest = {}): MockRequest {
  return {
    headers: {},
    traceId: 'test-trace-id-rbac',
    url: '/test',
    method: 'GET',
    ...overrides,
  };
}

function createMockRes(req?: MockRequest): MockResponse {
  const mockReq = req ?? createMockReq();
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    req: mockReq,
  };
}

function createMockNext(): NextFunction & { calls: unknown[][] } {
  return vi.fn() as unknown as NextFunction & { calls: unknown[][] };
}

async function runMiddleware(
  middleware: RequestHandler,
  req: MockRequest,
  res: MockResponse,
  next: NextFunction,
): Promise<void> {
  await Promise.resolve(middleware(req as Request, res as unknown as Response, next));
}

// ============================================================
// 辅助:构造带 Authorization 头的请求选项
// ============================================================

function authHeaders(accessToken: string): Record<string, string> {
  return buildAuthHeaders(accessToken);
}

/**
 * 预置测试数据(租户 + 4 种角色用户 + 3 条分析记录)
 * - 学生 1 创建 ANALYSIS_OWN_STUDENT
 * - 学生 2 创建 ANALYSIS_OWN_STUDENT_2
 * - 教师 创建 ANALYSIS_OWN_TEACHER
 *
 * 防御性隔离:先 __clear() 再 seed,使每个 describe 的 beforeEach 自包含,
 * 不依赖 setup.ts 全局 beforeEach 的执行顺序,避免并发场景下的跨测试串扰。
 */
function seedTestData(): void {
  // 显式清空 prisma store,保证起始状态干净(防御性,与全局 beforeEach 互不依赖)
  prismaMock.__clear();
  createTestTenant({
    id: TENANT_ID,
    name: 'RBAC测试学院',
    type: 'college',
    plan: 'standard',
    status: 'active',
    maxSeats: 100,
  });

  createTestUser({
    id: STUDENT_ID,
    tenantId: TENANT_ID,
    feishuOpenId: STUDENT_OPEN_ID,
    feishuUnionId: 'on_rbac_student',
    name: 'RBAC学生1',
    role: 'student',
  });
  createTestUser({
    id: STUDENT_ID_2,
    tenantId: TENANT_ID,
    feishuOpenId: STUDENT_OPEN_ID_2,
    feishuUnionId: 'on_rbac_student_2',
    name: 'RBAC学生2',
    role: 'student',
  });
  createTestUser({
    id: TEACHER_ID,
    tenantId: TENANT_ID,
    feishuOpenId: TEACHER_OPEN_ID,
    feishuUnionId: 'on_rbac_teacher',
    name: 'RBAC教师',
    role: 'teacher',
  });
  createTestUser({
    id: ADMIN_ID,
    tenantId: TENANT_ID,
    feishuOpenId: ADMIN_OPEN_ID,
    feishuUnionId: 'on_rbac_admin',
    name: 'RBAC管理员',
    role: 'admin',
  });
  createTestUser({
    id: OWNER_ID,
    tenantId: TENANT_ID,
    feishuOpenId: OWNER_OPEN_ID,
    feishuUnionId: 'on_rbac_owner',
    name: 'RBAC所有者',
    role: 'owner',
  });

  // 租户成员关系(每个用户在 TENANT_ID 中的角色)
  // 必须显式插入,否则 listMembers/findMembership/countMembers 返回空
  const memberJoinedAt = new Date('2026-07-01T00:00:00Z');
  prismaMock.tenantMemberStore.set(`${STUDENT_ID}_${TENANT_ID}`, {
    userId: STUDENT_ID,
    tenantId: TENANT_ID,
    role: 'student',
    joinedAt: memberJoinedAt,
  });
  prismaMock.tenantMemberStore.set(`${STUDENT_ID_2}_${TENANT_ID}`, {
    userId: STUDENT_ID_2,
    tenantId: TENANT_ID,
    role: 'student',
    joinedAt: memberJoinedAt,
  });
  prismaMock.tenantMemberStore.set(`${TEACHER_ID}_${TENANT_ID}`, {
    userId: TEACHER_ID,
    tenantId: TENANT_ID,
    role: 'teacher',
    joinedAt: memberJoinedAt,
  });
  prismaMock.tenantMemberStore.set(`${ADMIN_ID}_${TENANT_ID}`, {
    userId: ADMIN_ID,
    tenantId: TENANT_ID,
    role: 'admin',
    joinedAt: memberJoinedAt,
  });
  prismaMock.tenantMemberStore.set(`${OWNER_ID}_${TENANT_ID}`, {
    userId: OWNER_ID,
    tenantId: TENANT_ID,
    role: 'owner',
    joinedAt: memberJoinedAt,
  });

  // 3 条分析记录(分别由学生1/学生2/教师创建)
  prismaMock.__insertAnalysis({
    id: ANALYSIS_OWN_STUDENT,
    tenantId: TENANT_ID,
    userId: STUDENT_ID,
    workType: 'painting',
    imageUrl: 'https://example.com/rbac-s1.jpg',
    title: '学生1作品',
    status: 'success',
    overallScore: 80,
    createdAt: new Date('2026-07-01T10:00:00Z'),
  });
  prismaMock.__insertAnalysis({
    id: ANALYSIS_OWN_STUDENT_2,
    tenantId: TENANT_ID,
    userId: STUDENT_ID_2,
    workType: 'design',
    imageUrl: 'https://example.com/rbac-s2.jpg',
    title: '学生2作品',
    status: 'success',
    overallScore: 85,
    createdAt: new Date('2026-07-02T10:00:00Z'),
  });
  prismaMock.__insertAnalysis({
    id: ANALYSIS_OWN_TEACHER,
    tenantId: TENANT_ID,
    userId: TEACHER_ID,
    workType: 'sculpture',
    imageUrl: 'https://example.com/rbac-t1.jpg',
    title: '教师作品',
    status: 'success',
    overallScore: 92,
    createdAt: new Date('2026-07-03T10:00:00Z'),
  });
}

/**
 * 签发指定角色的 access_token
 */
function tokenFor(userId: string, role: UserRole, openId: string): string {
  return createTestTokenSet({
    userId,
    tenantId: TENANT_ID,
    role,
    feishuOpenId: openId,
  }).accessToken;
}

// ============================================================
// P1-P6:权限矩阵纯函数单元测试
// ============================================================

describe('RBAC permissions matrix (unit)', () => {
  describe('P1: hasPermission', () => {
    it('should_return_true_when_admin_has_any_permission', () => {
      for (const perm of ALL_PERMISSIONS) {
        expect(hasPermission('admin', perm)).toBe(true);
      }
    });

    it('should_return_true_when_owner_has_any_permission', () => {
      for (const perm of ALL_PERMISSIONS) {
        expect(hasPermission('owner', perm)).toBe(true);
      }
    });

    it('should_return_true_when_student_has_own_permissions', () => {
      expect(hasPermission('student', 'analysis:create')).toBe(true);
      expect(hasPermission('student', 'analysis:read:own')).toBe(true);
      expect(hasPermission('student', 'analysis:delete:own')).toBe(true);
      expect(hasPermission('student', 'user:update:own')).toBe(true);
      expect(hasPermission('student', 'tenant:read')).toBe(true);
      expect(hasPermission('student', 'tenant:switch')).toBe(true);
      expect(hasPermission('student', 'artwork:read')).toBe(true);
      expect(hasPermission('student', 'stats:read')).toBe(true);
    });

    it('should_return_false_when_student_lacks_tenant_wide_permissions', () => {
      expect(hasPermission('student', 'analysis:read:tenant')).toBe(false);
      expect(hasPermission('student', 'analysis:delete:tenant')).toBe(false);
      expect(hasPermission('student', 'user:read')).toBe(false);
      expect(hasPermission('student', 'user:invite')).toBe(false);
      expect(hasPermission('student', 'user:remove')).toBe(false);
      expect(hasPermission('student', 'tenant:update')).toBe(false);
      expect(hasPermission('student', 'stats:read:tenant')).toBe(false);
    });

    it('should_return_true_when_teacher_has_read_tenant_but_not_delete_tenant', () => {
      expect(hasPermission('teacher', 'analysis:read:tenant')).toBe(true);
      expect(hasPermission('teacher', 'analysis:delete:tenant')).toBe(false);
      expect(hasPermission('teacher', 'user:invite')).toBe(true);
      expect(hasPermission('teacher', 'user:remove')).toBe(false);
    });
  });

  describe('P2: hasAnyPermission (OR 语义)', () => {
    it('should_return_true_when_role_has_at_least_one_permission', () => {
      expect(hasAnyPermission('student', ['analysis:read:own', 'analysis:read:tenant'])).toBe(true);
      expect(hasAnyPermission('teacher', ['analysis:delete:own', 'analysis:delete:tenant'])).toBe(true);
    });

    it('should_return_false_when_role_has_none_of_permissions', () => {
      expect(hasAnyPermission('student', ['analysis:read:tenant', 'user:remove'])).toBe(false);
      expect(hasAnyPermission('teacher', ['analysis:delete:tenant', 'user:remove'])).toBe(false);
    });

    it('should_return_false_when_empty_permissions_list', () => {
      expect(hasAnyPermission('admin', [])).toBe(false);
    });
  });

  describe('P3: hasAllPermissions (AND 语义)', () => {
    it('should_return_true_when_role_has_all_permissions', () => {
      expect(hasAllPermissions('admin', ['analysis:create', 'analysis:read:own'])).toBe(true);
      expect(hasAllPermissions('teacher', ['analysis:read:own', 'analysis:read:tenant'])).toBe(true);
    });

    it('should_return_false_when_role_misses_any_permission', () => {
      expect(hasAllPermissions('teacher', ['analysis:read:own', 'analysis:delete:tenant'])).toBe(false);
      expect(hasAllPermissions('student', ['analysis:read:own', 'analysis:read:tenant'])).toBe(false);
    });

    it('should_return_false_when_empty_permissions_list', () => {
      expect(hasAllPermissions('admin', [])).toBe(false);
    });
  });

  describe('P4: getPermissionsByRole', () => {
    it('should_return_all_permissions_for_admin', () => {
      const perms = getPermissionsByRole('admin');
      expect(perms.length).toBe(ALL_PERMISSIONS.length);
      for (const p of ALL_PERMISSIONS) {
        expect(perms).toContain(p);
      }
    });

    it('should_return_same_permissions_for_owner_as_admin', () => {
      const adminPerms = getPermissionsByRole('admin');
      const ownerPerms = getPermissionsByRole('owner');
      expect(ownerPerms.length).toBe(adminPerms.length);
      for (const p of adminPerms) {
        expect(ownerPerms).toContain(p);
      }
    });

    it('should_return_limited_permissions_for_student', () => {
      const perms = getPermissionsByRole('student');
      // 学生应有 19 个权限:
      //   - Phase 3 基础 9 个(含 subscription:read)
      //   - Phase 5 预留接口追加 4 个读类权限
      //     (knowledge:read / modules:read / ui:config:read / config:features:read)
      //   - Phase 5 新功能追加 3 个读类权限 + 1 个争议申请权限
      //     (preset:read / review:read / dispute:read / dispute:request)
      //   - 实时图片搜索追加 1 个读类权限(image:read,详见 docs/realtime-image-search-solution.md)
      //   - 组织内分享追加 1 个权限(share:create,分享自己的作品+发表评论)
      expect(perms.length).toBe(19);
      expect(perms).not.toContain('analysis:read:tenant');
      expect(perms).not.toContain('analysis:delete:tenant');
      expect(perms).not.toContain('subscription:update');
      // Phase 5 预留接口:学生拥有读类权限,无写/管理类权限
      expect(perms).toContain('knowledge:read');
      expect(perms).toContain('modules:read');
      expect(perms).toContain('ui:config:read');
      expect(perms).toContain('config:features:read');
      expect(perms).not.toContain('knowledge:write');
      expect(perms).not.toContain('modules:manage');
      expect(perms).not.toContain('ui:config:write');
      expect(perms).not.toContain('config:features:write');
      expect(perms).not.toContain('config:workflows:manage');
      // Phase 5 新功能:学生拥有读类权限 + 可为自己的作品申请人工复核,无写/裁定类权限
      expect(perms).toContain('preset:read');
      expect(perms).toContain('review:read');
      expect(perms).toContain('dispute:read');
      expect(perms).toContain('dispute:request');
      expect(perms).not.toContain('preset:write');
      expect(perms).not.toContain('review:write');
      expect(perms).not.toContain('dispute:resolve');
      // 实时图片搜索:学生拥有读权限,无写/删除权限
      expect(perms).toContain('image:read');
      expect(perms).not.toContain('image:create');
      expect(perms).not.toContain('image:update');
      expect(perms).not.toContain('image:delete');
      // 组织内分享:学生可分享自己的作品+发表评论,无管理权限(置顶/删他人)
      expect(perms).toContain('share:create');
      expect(perms).not.toContain('share:manage');
    });
  });

  describe('P5: canReadTenantWide / canDeleteTenantWide', () => {
    it('should_return_true_for_canReadTenantWide_when_admin_or_owner_or_teacher', () => {
      expect(canReadTenantWide('admin')).toBe(true);
      expect(canReadTenantWide('owner')).toBe(true);
      expect(canReadTenantWide('teacher')).toBe(true);
    });

    it('should_return_false_for_canReadTenantWide_when_student', () => {
      expect(canReadTenantWide('student')).toBe(false);
    });

    it('should_return_true_for_canDeleteTenantWide_only_when_admin_or_owner', () => {
      expect(canDeleteTenantWide('admin')).toBe(true);
      expect(canDeleteTenantWide('owner')).toBe(true);
      expect(canDeleteTenantWide('teacher')).toBe(false);
      expect(canDeleteTenantWide('student')).toBe(false);
    });
  });

  describe('P6: ROLE_PERMISSIONS 矩阵完整性', () => {
    it('should_have_all_four_roles_defined', () => {
      expect(ROLE_PERMISSIONS.admin).toBeDefined();
      expect(ROLE_PERMISSIONS.owner).toBeDefined();
      expect(ROLE_PERMISSIONS.teacher).toBeDefined();
      expect(ROLE_PERMISSIONS.student).toBeDefined();
    });

    it('should_not_mutate_role_permissions(frozen)', () => {
      // Object.freeze 后尝试 push 应静默失败(严格模式下抛 TypeError)
      const originalLen = ROLE_PERMISSIONS.student.length;
      expect(() => {
        'use strict';
        (ROLE_PERMISSIONS.student as unknown as Permission[]).push('analysis:read:tenant');
      }).toThrow(TypeError);
      expect(ROLE_PERMISSIONS.student.length).toBe(originalLen);
    });
  });
});

// ============================================================
// P7-P11:权限中间件单元测试
// ============================================================

describe('RBAC permission middleware (unit)', () => {
  describe('P7: requirePermission allow/deny', () => {
    it('should_call_next_when_role_has_required_permission', async () => {
      const req = createMockReq({ role: 'admin', userId: 'u1', tenantId: 't1' });
      const res = createMockRes(req);
      const next = createMockNext();
      await runMiddleware(requirePermission('analysis:create'), req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should_return_403_when_role_lacks_required_permission', async () => {
      const req = createMockReq({
        role: 'student',
        userId: 'u1',
        tenantId: 't1',
        url: '/api/v1/analyses',
        method: 'GET',
      });
      const res = createMockRes(req);
      const next = createMockNext();
      await runMiddleware(requirePermission('analysis:read:tenant'), req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
      // 响应体不应暴露具体缺失的权限标识
      const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Record<string, unknown>;
      expect(body.code).toBe(ErrorCode.FORBIDDEN);
      expect(JSON.stringify(body)).not.toContain('analysis:read:tenant');
    });
  });

  describe('P8: requirePermission 默认拒绝(无角色)', () => {
    it('should_return_403_when_role_missing', async () => {
      const req = createMockReq({ userId: 'u1', tenantId: 't1' }); // 无 role
      const res = createMockRes(req);
      const next = createMockNext();
      await runMiddleware(requirePermission('analysis:create'), req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('should_return_403_when_role_unknown', async () => {
      const req = createMockReq({
        role: 'superadmin' as UserRole,
        userId: 'u1',
        tenantId: 't1',
      });
      const res = createMockRes(req);
      const next = createMockNext();
      await runMiddleware(requirePermission('analysis:create'), req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  describe('P9: requireAnyPermission (OR 语义)', () => {
    it('should_call_next_when_role_has_any_of_required', async () => {
      const req = createMockReq({ role: 'student', userId: 'u1', tenantId: 't1' });
      const res = createMockRes(req);
      const next = createMockNext();
      // student 有 analysis:delete:own,无 analysis:delete:tenant
      await runMiddleware(
        requireAnyPermission('analysis:delete:own', 'analysis:delete:tenant'),
        req,
        res,
        next,
      );
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('should_return_403_when_role_has_none_of_required', async () => {
      const req = createMockReq({ role: 'student', userId: 'u1', tenantId: 't1' });
      const res = createMockRes(req);
      const next = createMockNext();
      // student 都没有
      await runMiddleware(
        requireAnyPermission('analysis:read:tenant', 'user:remove'),
        req,
        res,
        next,
      );
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('should_deny_when_no_permissions_provided(safety_default)', async () => {
      const req = createMockReq({ role: 'admin', userId: 'u1', tenantId: 't1' });
      const res = createMockRes(req);
      const next = createMockNext();
      await runMiddleware(requireAnyPermission(), req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  describe('P10: requireAllPermissions (AND 语义)', () => {
    it('should_call_next_when_role_has_all_required', async () => {
      const req = createMockReq({ role: 'admin', userId: 'u1', tenantId: 't1' });
      const res = createMockRes(req);
      const next = createMockNext();
      await runMiddleware(
        requireAllPermissions('tenant:update', 'user:update:tenant'),
        req,
        res,
        next,
      );
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('should_return_403_when_role_misses_any', async () => {
      const req = createMockReq({ role: 'teacher', userId: 'u1', tenantId: 't1' });
      const res = createMockRes(req);
      const next = createMockNext();
      // teacher 有 user:update:own,无 user:update:tenant
      await runMiddleware(
        requireAllPermissions('user:update:own', 'user:update:tenant'),
        req,
        res,
        next,
      );
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  describe('P11: 权限拒绝响应不泄露内部信息', () => {
    it('should_not_expose_permission_identifier_in_error_message', async () => {
      const req = createMockReq({
        role: 'student',
        userId: 'u1',
        tenantId: 't1',
        url: '/api/v1/tenants/t1/members',
        method: 'POST',
      });
      const res = createMockRes(req);
      const next = createMockNext();
      await runMiddleware(requirePermission('user:invite'), req, res, next);
      const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Record<string, unknown>;
      expect(body.message).toBe('权限不足');
      // 不应包含内部权限标识
      expect(JSON.stringify(body)).not.toContain('user:invite');
      expect(JSON.stringify(body)).not.toContain('permission');
      // traceId 应保留(供日志关联)
      expect(body.traceId).toBe('test-trace-id-rbac');
    });
  });
});

// ============================================================
// P12-P17:Analysis 资源权限集成测试
// ============================================================

describe('RBAC analysis API (integration)', () => {
  beforeEach(() => {
    seedTestData();
  });

  describe('P12: POST /analyses 创建分析(所有角色可创建)', () => {
    it('should_allow_student_to_create_analysis', async () => {
      const res = await request(getTestApp())
        .post('/api/v1/analyses')
        .set(authHeaders(tokenFor(STUDENT_ID, 'student', STUDENT_OPEN_ID)))
        .send({ artType: 'painting', imageUrl: 'https://example.com/new.jpg' })
        .expect(200);
      assertApiResponse(res);
    });

    it('should_allow_teacher_to_create_analysis', async () => {
      const res = await request(getTestApp())
        .post('/api/v1/analyses')
        .set(authHeaders(tokenFor(TEACHER_ID, 'teacher', TEACHER_OPEN_ID)))
        .send({ artType: 'design', imageUrl: 'https://example.com/new-t.jpg' })
        .expect(200);
      assertApiResponse(res);
    });

    it('should_allow_admin_to_create_analysis', async () => {
      const res = await request(getTestApp())
        .post('/api/v1/analyses')
        .set(authHeaders(tokenFor(ADMIN_ID, 'admin', ADMIN_OPEN_ID)))
        .send({ artType: 'sculpture', imageUrl: 'https://example.com/new-a.jpg' })
        .expect(200);
      assertApiResponse(res);
    });
  });

  describe('P13: GET /analyses 列表数据范围过滤', () => {
    it('should_return_only_own_analyses_for_student', async () => {
      const res = await request(getTestApp())
        .get('/api/v1/analyses')
        .set(authHeaders(tokenFor(STUDENT_ID, 'student', STUDENT_OPEN_ID)))
        .expect(200);
      const body = assertApiResponse(res);
      const data = body.data as { items: Array<{ id: string }>; total: number };
      // 学生1 只能看到自己的 1 条
      expect(data.total).toBe(1);
      expect(data.items[0]!.id).toBe(ANALYSIS_OWN_STUDENT);
    });

    it('should_return_all_tenant_analyses_for_teacher', async () => {
      const res = await request(getTestApp())
        .get('/api/v1/analyses')
        .set(authHeaders(tokenFor(TEACHER_ID, 'teacher', TEACHER_OPEN_ID)))
        .expect(200);
      const body = assertApiResponse(res);
      const data = body.data as { items: Array<{ id: string }>; total: number };
      // 教师可看租户全量 3 条
      expect(data.total).toBe(3);
    });

    it('should_return_all_tenant_analyses_for_admin', async () => {
      const res = await request(getTestApp())
        .get('/api/v1/analyses')
        .set(authHeaders(tokenFor(ADMIN_ID, 'admin', ADMIN_OPEN_ID)))
        .expect(200);
      const body = assertApiResponse(res);
      const data = body.data as { items: Array<{ id: string }>; total: number };
      expect(data.total).toBe(3);
    });

    it('should_return_all_tenant_analyses_for_owner', async () => {
      const res = await request(getTestApp())
        .get('/api/v1/analyses')
        .set(authHeaders(tokenFor(OWNER_ID, 'owner', OWNER_OPEN_ID)))
        .expect(200);
      const body = assertApiResponse(res);
      const data = body.data as { items: Array<{ id: string }>; total: number };
      expect(data.total).toBe(3);
    });
  });

  describe('P14: GET /analyses/:id 详情数据范围过滤', () => {
    it('should_allow_student_to_view_own_analysis', async () => {
      const res = await request(getTestApp())
        .get(`/api/v1/analyses/${ANALYSIS_OWN_STUDENT}`)
        .set(authHeaders(tokenFor(STUDENT_ID, 'student', STUDENT_OPEN_ID)))
        .expect(200);
      const body = assertApiResponse(res);
      const data = body.data as { id: string; userId: string };
      expect(data.id).toBe(ANALYSIS_OWN_STUDENT);
      expect(data.userId).toBe(STUDENT_ID);
    });

    it('should_deny_student_viewing_other_student_analysis_with_404', async () => {
      // 学生1 试图查看学生2 的分析 → 404(不泄露存在性)
      const res = await request(getTestApp())
        .get(`/api/v1/analyses/${ANALYSIS_OWN_STUDENT_2}`)
        .set(authHeaders(tokenFor(STUDENT_ID, 'student', STUDENT_OPEN_ID)))
        .expect(404);
      assertApiError(res, ErrorCode.ANALYSIS_NOT_FOUND, 404);
    });

    it('should_allow_teacher_to_view_any_tenant_analysis', async () => {
      const res = await request(getTestApp())
        .get(`/api/v1/analyses/${ANALYSIS_OWN_STUDENT}`)
        .set(authHeaders(tokenFor(TEACHER_ID, 'teacher', TEACHER_OPEN_ID)))
        .expect(200);
      const body = assertApiResponse(res);
      const data = body.data as { id: string };
      expect(data.id).toBe(ANALYSIS_OWN_STUDENT);
    });

    it('should_allow_admin_to_view_any_tenant_analysis', async () => {
      const res = await request(getTestApp())
        .get(`/api/v1/analyses/${ANALYSIS_OWN_TEACHER}`)
        .set(authHeaders(tokenFor(ADMIN_ID, 'admin', ADMIN_OPEN_ID)))
        .expect(200);
      const body = assertApiResponse(res);
      const data = body.data as { id: string };
      expect(data.id).toBe(ANALYSIS_OWN_TEACHER);
    });
  });

  describe('P15: DELETE /analyses/:id 删除自己的记录(所有角色)', () => {
    it('should_allow_student_to_delete_own_analysis', async () => {
      const res = await request(getTestApp())
        .delete(`/api/v1/analyses/${ANALYSIS_OWN_STUDENT}`)
        .set(authHeaders(tokenFor(STUDENT_ID, 'student', STUDENT_OPEN_ID)))
        .expect(200);
      const body = assertApiResponse(res);
      const data = body.data as { id: string; deleted: boolean };
      expect(data.id).toBe(ANALYSIS_OWN_STUDENT);
      expect(data.deleted).toBe(true);
      // 验证 DB 中记录已删除
      expect(prismaMock.analysisStore.has(ANALYSIS_OWN_STUDENT)).toBe(false);
    });

    it('should_allow_teacher_to_delete_own_analysis', async () => {
      const res = await request(getTestApp())
        .delete(`/api/v1/analyses/${ANALYSIS_OWN_TEACHER}`)
        .set(authHeaders(tokenFor(TEACHER_ID, 'teacher', TEACHER_OPEN_ID)))
        .expect(200);
      const body = assertApiResponse(res);
      const data = body.data as { deleted: boolean };
      expect(data.deleted).toBe(true);
    });

    it('should_deny_student_deleting_others_analysis_with_404', async () => {
      // 学生1 试图删学生2 的记录 → 404(不泄露存在性)
      const res = await request(getTestApp())
        .delete(`/api/v1/analyses/${ANALYSIS_OWN_STUDENT_2}`)
        .set(authHeaders(tokenFor(STUDENT_ID, 'student', STUDENT_OPEN_ID)))
        .expect(404);
      assertApiError(res, ErrorCode.ANALYSIS_NOT_FOUND, 404);
      // 验证记录未被删除
      expect(prismaMock.analysisStore.has(ANALYSIS_OWN_STUDENT_2)).toBe(true);
    });

    it('should_deny_teacher_deleting_others_analysis_with_404', async () => {
      // 教师 试图删学生的记录 → 404(teacher 仅拥有 analysis:delete:own)
      const res = await request(getTestApp())
        .delete(`/api/v1/analyses/${ANALYSIS_OWN_STUDENT}`)
        .set(authHeaders(tokenFor(TEACHER_ID, 'teacher', TEACHER_OPEN_ID)))
        .expect(404);
      assertApiError(res, ErrorCode.ANALYSIS_NOT_FOUND, 404);
      expect(prismaMock.analysisStore.has(ANALYSIS_OWN_STUDENT)).toBe(true);
    });
  });

  describe('P16: DELETE /analyses/:id 删除租户内任意记录(仅 admin/owner)', () => {
    it('should_allow_admin_to_delete_any_tenant_analysis', async () => {
      const res = await request(getTestApp())
        .delete(`/api/v1/analyses/${ANALYSIS_OWN_STUDENT}`)
        .set(authHeaders(tokenFor(ADMIN_ID, 'admin', ADMIN_OPEN_ID)))
        .expect(200);
      const body = assertApiResponse(res);
      const data = body.data as { deleted: boolean };
      expect(data.deleted).toBe(true);
      expect(prismaMock.analysisStore.has(ANALYSIS_OWN_STUDENT)).toBe(false);
    });

    it('should_allow_owner_to_delete_any_tenant_analysis', async () => {
      const res = await request(getTestApp())
        .delete(`/api/v1/analyses/${ANALYSIS_OWN_TEACHER}`)
        .set(authHeaders(tokenFor(OWNER_ID, 'owner', OWNER_OPEN_ID)))
        .expect(200);
      const body = assertApiResponse(res);
      const data = body.data as { deleted: boolean };
      expect(data.deleted).toBe(true);
      expect(prismaMock.analysisStore.has(ANALYSIS_OWN_TEACHER)).toBe(false);
    });
  });

  describe('P17: DELETE /analyses/:id 跨租户删除拦截', () => {
    it('should_return_404_when_deleting_analysis_of_other_tenant', async () => {
      // 创建租户 B 的分析记录
      const otherTenantAnalysisId = 'a-rbac-other-tenant-0001';
      prismaMock.__insertAnalysis({
        id: otherTenantAnalysisId,
        tenantId: TEST_TENANT_ID_A, // 不同租户
        userId: TEST_USER_ID_A,
        workType: 'painting',
        imageUrl: 'https://example.com/other.jpg',
        status: 'success',
      });

      // 管理员(admin)在 TENANT_ID 中试图删除 TEST_TENANT_ID_A 的记录 → 404
      const res = await request(getTestApp())
        .delete(`/api/v1/analyses/${otherTenantAnalysisId}`)
        .set(authHeaders(tokenFor(ADMIN_ID, 'admin', ADMIN_OPEN_ID)))
        .expect(404);
      assertApiError(res, ErrorCode.ANALYSIS_NOT_FOUND, 404);
      // 验证记录未被删除
      expect(prismaMock.analysisStore.has(otherTenantAnalysisId)).toBe(true);
    });
  });
});

// ============================================================
// P18-P22:Tenant 成员管理权限集成测试
// ============================================================

describe('RBAC tenant member management (integration)', () => {
  beforeEach(() => {
    seedTestData();
  });

  describe('P18: GET /tenants/:id/members 列出成员(需 user:read)', () => {
    it('should_allow_admin_to_list_members', async () => {
      const res = await request(getTestApp())
        .get(`/api/v1/tenants/${TENANT_ID}/members`)
        .set(authHeaders(tokenFor(ADMIN_ID, 'admin', ADMIN_OPEN_ID)))
        .expect(200);
      const body = assertApiResponse(res);
      const data = body.data as Array<{ userId: string }>;
      expect(data.length).toBeGreaterThan(0);
    });

    it('should_allow_teacher_to_list_members', async () => {
      const res = await request(getTestApp())
        .get(`/api/v1/tenants/${TENANT_ID}/members`)
        .set(authHeaders(tokenFor(TEACHER_ID, 'teacher', TEACHER_OPEN_ID)))
        .expect(200);
      assertApiResponse(res);
    });

    it('should_deny_student_to_list_members_with_403', async () => {
      // student 无 user:read 权限
      const res = await request(getTestApp())
        .get(`/api/v1/tenants/${TENANT_ID}/members`)
        .set(authHeaders(tokenFor(STUDENT_ID, 'student', STUDENT_OPEN_ID)))
        .expect(403);
      assertApiError(res, ErrorCode.FORBIDDEN, 403);
    });
  });

  describe('P19: POST /tenants/:id/members 邀请成员(需 user:invite)', () => {
    it('should_allow_admin_to_invite_member', async () => {
      // 先创建一个待邀请的用户
      const newUserId = 'u-rbac-invite-target-0001';
      createTestUser({
        id: newUserId,
        tenantId: TEST_TENANT_ID_A, // 该用户当前不在 TENANT_ID
        feishuOpenId: 'ou_rbac_invite',
        feishuUnionId: 'on_rbac_invite',
        name: '被邀请用户',
        role: 'student',
      });

      const res = await request(getTestApp())
        .post(`/api/v1/tenants/${TENANT_ID}/members`)
        .set(authHeaders(tokenFor(ADMIN_ID, 'admin', ADMIN_OPEN_ID)))
        .send({ userId: newUserId, role: 'student' })
        .expect(200);
      const body = assertApiResponse(res);
      const data = body.data as { userId: string; tenantId: string };
      expect(data.userId).toBe(newUserId);
      expect(data.tenantId).toBe(TENANT_ID);
    });

    it('should_allow_teacher_to_invite_member', async () => {
      const newUserId = 'u-rbac-invite-target-0002';
      createTestUser({
        id: newUserId,
        tenantId: TEST_TENANT_ID_A,
        feishuOpenId: 'ou_rbac_invite_2',
        feishuUnionId: 'on_rbac_invite_2',
        name: '被邀请用户2',
        role: 'student',
      });

      const res = await request(getTestApp())
        .post(`/api/v1/tenants/${TENANT_ID}/members`)
        .set(authHeaders(tokenFor(TEACHER_ID, 'teacher', TEACHER_OPEN_ID)))
        .send({ userId: newUserId, role: 'student' })
        .expect(200);
      assertApiResponse(res);
    });

    it('should_deny_student_to_invite_member_with_403', async () => {
      const res = await request(getTestApp())
        .post(`/api/v1/tenants/${TENANT_ID}/members`)
        .set(authHeaders(tokenFor(STUDENT_ID, 'student', STUDENT_OPEN_ID)))
        .send({ userId: 'any-user', role: 'student' })
        .expect(403);
      assertApiError(res, ErrorCode.FORBIDDEN, 403);
    });
  });

  describe('P20: DELETE /tenants/:id/members/:userId 移除成员(需 user:remove)', () => {
    it('should_allow_admin_to_remove_member', async () => {
      // 先把学生2 加入 TENANT_ID(若尚未加入,通过 inviteMember 流程)
      // 直接操作 mock store,简化测试
      prismaMock.tenantMemberStore.set(`${STUDENT_ID_2}_${TENANT_ID}`, {
        userId: STUDENT_ID_2,
        tenantId: TENANT_ID,
        role: 'student',
        joinedAt: new Date(),
      });

      const res = await request(getTestApp())
        .delete(`/api/v1/tenants/${TENANT_ID}/members/${STUDENT_ID_2}`)
        .set(authHeaders(tokenFor(ADMIN_ID, 'admin', ADMIN_OPEN_ID)))
        .expect(200);
      const body = assertApiResponse(res);
      const data = body.data as { removed: boolean; userId: string };
      expect(data.removed).toBe(true);
      expect(data.userId).toBe(STUDENT_ID_2);
    });

    it('should_deny_teacher_to_remove_member_with_403', async () => {
      // teacher 无 user:remove 权限
      const res = await request(getTestApp())
        .delete(`/api/v1/tenants/${TENANT_ID}/members/${STUDENT_ID_2}`)
        .set(authHeaders(tokenFor(TEACHER_ID, 'teacher', TEACHER_OPEN_ID)))
        .expect(403);
      assertApiError(res, ErrorCode.FORBIDDEN, 403);
    });

    it('should_deny_student_to_remove_member_with_403', async () => {
      const res = await request(getTestApp())
        .delete(`/api/v1/tenants/${TENANT_ID}/members/${STUDENT_ID_2}`)
        .set(authHeaders(tokenFor(STUDENT_ID, 'student', STUDENT_OPEN_ID)))
        .expect(403);
      assertApiError(res, ErrorCode.FORBIDDEN, 403);
    });

    it('should_prevent_admin_from_removing_self', async () => {
      // 防止误操作:管理员不可移除自己
      const res = await request(getTestApp())
        .delete(`/api/v1/tenants/${TENANT_ID}/members/${ADMIN_ID}`)
        .set(authHeaders(tokenFor(ADMIN_ID, 'admin', ADMIN_OPEN_ID)))
        .expect(400);
      assertApiError(res, ErrorCode.PARAM_INVALID, 400);
    });
  });

  describe('P21: GET /tenants/current / GET /tenants(所有角色可读)', () => {
    it('should_allow_student_to_get_current_tenant', async () => {
      const res = await request(getTestApp())
        .get('/api/v1/tenants/current')
        .set(authHeaders(tokenFor(STUDENT_ID, 'student', STUDENT_OPEN_ID)))
        .expect(200);
      const body = assertApiResponse(res);
      const data = body.data as { id: string };
      expect(data.id).toBe(TENANT_ID);
    });

    it('should_allow_student_to_list_own_tenants', async () => {
      const res = await request(getTestApp())
        .get('/api/v1/tenants')
        .set(authHeaders(tokenFor(STUDENT_ID, 'student', STUDENT_OPEN_ID)))
        .expect(200);
      assertApiResponse(res);
    });
  });

  describe('P22: POST /tenants/switch(所有角色可切换)', () => {
    it('should_allow_student_to_switch_tenant_when_member', async () => {
      // 创建另一个租户,并把学生1 加为成员
      const anotherTenantId = 't-rbac-another-0001';
      createTestTenant({
        id: anotherTenantId,
        name: '另一个学院',
        type: 'college',
        status: 'active',
      });
      prismaMock.tenantMemberStore.set(`${STUDENT_ID}_${anotherTenantId}`, {
        userId: STUDENT_ID,
        tenantId: anotherTenantId,
        role: 'student',
        joinedAt: new Date(),
      });

      const res = await request(getTestApp())
        .post('/api/v1/tenants/switch')
        .set(authHeaders(tokenFor(STUDENT_ID, 'student', STUDENT_OPEN_ID)))
        .send({ tenantId: anotherTenantId })
        .expect(200);
      const body = assertApiResponse(res);
      const data = body.data as { tenant: { id: string }; role: string };
      expect(data.tenant.id).toBe(anotherTenantId);
      expect(data.role).toBe('student');
    });
  });
});

// ============================================================
// P23-P25:数据范围过滤集成测试(端到端)
// ============================================================

describe('RBAC data scope filtering (integration)', () => {
  beforeEach(() => {
    seedTestData();
  });

  describe('P23: 学生越权 query.userId 被忽略', () => {
    it('should_ignore_query_userId_for_student_and_return_only_own', async () => {
      // 学生1 试图通过 ?userId=STUDENT_ID_2 查询学生2 的记录
      const res = await request(getTestApp())
        .get('/api/v1/analyses')
        .query({ userId: STUDENT_ID_2 })
        .set(authHeaders(tokenFor(STUDENT_ID, 'student', STUDENT_OPEN_ID)))
        .expect(200);
      const body = assertApiResponse(res);
      const data = body.data as { items: Array<{ id: string }>; total: number };
      // service 层强制覆盖:student 角色的 effectiveUserId = 自己
      expect(data.total).toBe(1);
      expect(data.items[0]!.id).toBe(ANALYSIS_OWN_STUDENT);
    });
  });

  describe('P24: 教师按 userId 筛选生效', () => {
    it('should_filter_by_userId_for_teacher', async () => {
      const res = await request(getTestApp())
        .get('/api/v1/analyses')
        .query({ userId: STUDENT_ID })
        .set(authHeaders(tokenFor(TEACHER_ID, 'teacher', TEACHER_OPEN_ID)))
        .expect(200);
      const body = assertApiResponse(res);
      const data = body.data as { items: Array<{ id: string }>; total: number };
      expect(data.total).toBe(1);
      expect(data.items[0]!.id).toBe(ANALYSIS_OWN_STUDENT);
    });

    it('should_return_all_when_no_userId_for_teacher', async () => {
      const res = await request(getTestApp())
        .get('/api/v1/analyses')
        .set(authHeaders(tokenFor(TEACHER_ID, 'teacher', TEACHER_OPEN_ID)))
        .expect(200);
      const body = assertApiResponse(res);
      const data = body.data as { total: number };
      expect(data.total).toBe(3);
    });
  });

  describe('P25: 管理员视图与教师视图一致(全量可见)', () => {
    it('should_return_same_count_for_admin_and_teacher', async () => {
      const resTeacher = await request(getTestApp())
        .get('/api/v1/analyses')
        .set(authHeaders(tokenFor(TEACHER_ID, 'teacher', TEACHER_OPEN_ID)))
        .expect(200);
      const resAdmin = await request(getTestApp())
        .get('/api/v1/analyses')
        .set(authHeaders(tokenFor(ADMIN_ID, 'admin', ADMIN_OPEN_ID)))
        .expect(200);
      const teacherData = resTeacher.body.data as { total: number };
      const adminData = resAdmin.body.data as { total: number };
      expect(teacherData.total).toBe(adminData.total);
      expect(adminData.total).toBe(3);
    });
  });
});

// ============================================================
// P26-P28:边界与安全策略
// ============================================================

describe('RBAC security policies (integration)', () => {
  beforeEach(() => {
    seedTestData();
  });

  describe('P26: 无 Authorization 头默认拒绝', () => {
    it('should_return_401_when_no_authorization_header', async () => {
      const res = await request(getTestApp())
        .get('/api/v1/analyses')
        .expect(401);
      assertApiError(res, ErrorCode.UNAUTHORIZED, 401);
    });

    it('should_return_401_when_no_authorization_header_on_delete', async () => {
      const res = await request(getTestApp())
        .delete(`/api/v1/analyses/${ANALYSIS_OWN_STUDENT}`)
        .expect(401);
      assertApiError(res, ErrorCode.UNAUTHORIZED, 401);
    });
  });

  describe('P27: 越权访问不泄露资源存在性(404 而非 403)', () => {
    it('should_return_404_not_403_when_student_access_others_analysis', async () => {
      // 学生1 访问学生2 的分析:权限中间件放行(student 有 analysis:read:own),
      // 但 service 层数据范围过滤返回 404(不泄露存在性)
      const res = await request(getTestApp())
        .get(`/api/v1/analyses/${ANALYSIS_OWN_STUDENT_2}`)
        .set(authHeaders(tokenFor(STUDENT_ID, 'student', STUDENT_OPEN_ID)))
        .expect(404);
      assertApiError(res, ErrorCode.ANALYSIS_NOT_FOUND, 404);
      // 响应体不应包含学生2 的作品信息
      expect(JSON.stringify(res.body)).not.toContain('学生2作品');
    });

    it('should_return_404_not_403_when_teacher_deletes_others_analysis', async () => {
      // 教师删除学生的分析:权限中间件放行(teacher 有 analysis:delete:own),
      // 但 service 层数据范围过滤返回 404(不泄露存在性)
      const res = await request(getTestApp())
        .delete(`/api/v1/analyses/${ANALYSIS_OWN_STUDENT}`)
        .set(authHeaders(tokenFor(TEACHER_ID, 'teacher', TEACHER_OPEN_ID)))
        .expect(404);
      assertApiError(res, ErrorCode.ANALYSIS_NOT_FOUND, 404);
    });
  });

  describe('P28: 审计日志(写操作记录)', () => {
    it('should_log_audit_info_when_admin_deletes_analysis', async () => {
      // 验证 logger.info 被调用,且包含审计字段
      // 此处通过 spy 拦截 logger.info 调用
      const { logger } = await import('../src/utils/logger.js');
      const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => undefined);

      await request(getTestApp())
        .delete(`/api/v1/analyses/${ANALYSIS_OWN_STUDENT}`)
        .set(authHeaders(tokenFor(ADMIN_ID, 'admin', ADMIN_OPEN_ID)))
        .expect(200);

      // 查找包含 'analysis.delete' action 的日志调用
      const auditCall = infoSpy.mock.calls.find(
        (call) => {
          const meta = call[0] as Record<string, unknown> | undefined;
          return meta && meta.action === 'analysis.delete';
        },
      );
      expect(auditCall).toBeDefined();
      const meta = auditCall![0] as Record<string, unknown>;
      expect(meta.action).toBe('analysis.delete');
      expect(meta.tenantId).toBe(TENANT_ID);
      expect(meta.analysisId).toBe(ANALYSIS_OWN_STUDENT);
      expect(meta.operatorUserId).toBe(ADMIN_ID);
      expect(meta.operatorRole).toBe('admin');
      expect(meta.ownerId).toBe(STUDENT_ID);
      expect(meta.workType).toBe('painting');
      // 不应记录敏感信息(imageUrl/title)
      expect(meta.imageUrl).toBeUndefined();
      expect(meta.title).toBeUndefined();

      infoSpy.mockRestore();
    });

    it('should_log_audit_info_when_student_deletes_own_analysis', async () => {
      const { logger } = await import('../src/utils/logger.js');
      const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => undefined);

      await request(getTestApp())
        .delete(`/api/v1/analyses/${ANALYSIS_OWN_STUDENT}`)
        .set(authHeaders(tokenFor(STUDENT_ID, 'student', STUDENT_OPEN_ID)))
        .expect(200);

      const auditCall = infoSpy.mock.calls.find(
        (call) => {
          const meta = call[0] as Record<string, unknown> | undefined;
          return meta && meta.action === 'analysis.delete';
        },
      );
      expect(auditCall).toBeDefined();
      const meta = auditCall![0] as Record<string, unknown>;
      expect(meta.operatorRole).toBe('student');
      expect(meta.operatorUserId).toBe(STUDENT_ID);
      expect(meta.ownerId).toBe(STUDENT_ID); // 操作者 === 拥有者

      infoSpy.mockRestore();
    });
  });
});
