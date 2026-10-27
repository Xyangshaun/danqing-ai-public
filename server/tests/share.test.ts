// ============================================================
// 组织内分享 E2E 测试(报告导出+组织分享特性)
// 对应文档:.trae/specs/report-export-org-share/spec.md §5
// 对应源码:
//   - server/src/routes/share.routes.ts(组织动态流路由)
//   - server/src/routes/analysis.routes.ts(分享/取消分享挂载于 /analyses/:id)
//   - server/src/services/share.service.ts(业务逻辑)
//   - server/src/repositories/share.repository.ts(数据访问)
//
// 测试维度(覆盖 30 用例):
//   S1: POST /analyses/:id/share(分享:成功/校验/越权/幂等/跨租户/通知)
//   S2: DELETE /analyses/:id/share(取消分享:成功/未分享 404)
//   S3: GET /org/feed(动态流:排序/分页/类型筛选/租户隔离/评论摘要)
//   S4: DELETE /org/feed/:id(删除分享:本人/他人 403/share:manage/级联)
//   S5: POST|DELETE /org/feed/:id/pin(置顶:share:manage/学生 403)
//   S6: POST /org/feed/:id/comments(评论:成功/校验/通知)
//   S7: GET /org/feed/:id/comments(评论列表:升序/跨租户 404)
//   S8: DELETE /org/feed/:id/comments/:cid(删评论:本人/他人 403/share:manage)
//
// 通知说明:
//   share.service 经 notificationService.createNotification 触发分享/评论通知,
//   本文件 vi.mock 替换 notification.service 模块,以 spy 断言通知触发行为
//   (fire-and-forget 异步,断言经 vi.waitFor 等待微任务链完成)
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
} from './helpers/fixtures.js';
import { prismaMock } from './mocks/prisma.mock.js';
import { ErrorCode, type UserRole } from '../src/types/api-contract.js';

// ============================================================
// vi.mock:替换 notification.service(断言通知触发,避免依赖 Notification 模型)
// ============================================================

const notificationMock = vi.hoisted(() => ({
  createNotification: vi.fn(async () => ({ id: 'n-mock-0001' })),
}));

vi.mock('../src/services/notification.service.js', () => ({
  notificationService: {
    createNotification: notificationMock.createNotification,
  },
}));

// ============================================================
// 测试常量
// ============================================================

const TENANT_A = 't-share-tenant-a';
const TENANT_B = 't-share-tenant-b';

const STUDENT_1 = 'u-share-student-1';
const STUDENT_2 = 'u-share-student-2';
const TEACHER_1 = 'u-share-teacher-1';
const ADMIN_1 = 'u-share-admin-1';
const STUDENT_B = 'u-share-student-b';

// 分析记录(租户 A)
const ANALYSIS_S1_PAINTING = 'a-share-s1-painting'; // student1, painting, success
const ANALYSIS_S2_DESIGN = 'a-share-s2-design'; // student2, design, success
const ANALYSIS_S1_PENDING = 'a-share-s1-pending'; // student1, painting, pending
const ANALYSIS_S1_SCULPTURE = 'a-share-s1-sculpture'; // student1, sculpture, success
// 分析记录(租户 B)
const ANALYSIS_B_PAINTING = 'a-share-b-painting';

// ============================================================
// 辅助函数
// ============================================================

function tokenFor(userId: string, tenantId: string, role: UserRole): string {
  return createTestTokenSet({
    userId,
    tenantId,
    role,
    feishuOpenId: `ou_${userId}`,
  }).accessToken;
}

const tokenStudent1 = () => tokenFor(STUDENT_1, TENANT_A, 'student');
const tokenStudent2 = () => tokenFor(STUDENT_2, TENANT_A, 'student');
const tokenTeacher = () => tokenFor(TEACHER_1, TENANT_A, 'teacher');
const tokenAdmin = () => tokenFor(ADMIN_1, TENANT_A, 'admin');
const tokenStudentB = () => tokenFor(STUDENT_B, TENANT_B, 'student');

/**
 * 预置测试数据
 * 防御性隔离:显式 __clear() 再 seed,与全局 beforeEach 互不依赖
 */
function seedBase(): void {
  prismaMock.__clear();
  notificationMock.createNotification.mockClear();

  createTestTenant({ id: TENANT_A, name: '分享测试学院A', type: 'college', plan: 'standard', maxSeats: 100 });
  createTestTenant({ id: TENANT_B, name: '分享测试学院B', type: 'college', plan: 'standard', maxSeats: 100 });

  createTestUser({ id: STUDENT_1, tenantId: TENANT_A, name: '分享学生1', role: 'student' });
  createTestUser({ id: STUDENT_2, tenantId: TENANT_A, name: '分享学生2', role: 'student' });
  createTestUser({ id: TEACHER_1, tenantId: TENANT_A, name: '分享教师', role: 'teacher' });
  createTestUser({ id: ADMIN_1, tenantId: TENANT_A, name: '分享管理员', role: 'admin' });
  createTestUser({ id: STUDENT_B, tenantId: TENANT_B, name: '租户B学生', role: 'student' });

  // 租户成员关系(listByTenantAndRoles 依赖 tenantMember 表做通知受众查询)
  const joinedAt = new Date('2026-07-01T00:00:00Z');
  for (const [userId, tenantId, role] of [
    [STUDENT_1, TENANT_A, 'student'],
    [STUDENT_2, TENANT_A, 'student'],
    [TEACHER_1, TENANT_A, 'teacher'],
    [ADMIN_1, TENANT_A, 'admin'],
    [STUDENT_B, TENANT_B, 'student'],
  ] as const) {
    prismaMock.tenantMemberStore.set(`${userId}_${tenantId}`, { userId, tenantId, role, joinedAt });
  }

  // 分析记录(租户 A)
  prismaMock.__insertAnalysis({
    id: ANALYSIS_S1_PAINTING,
    tenantId: TENANT_A,
    userId: STUDENT_1,
    workType: 'painting',
    title: '山水习作',
    status: 'success',
    overallScore: 80,
    createdAt: new Date('2026-08-01T10:00:00Z'),
  });
  prismaMock.__insertAnalysis({
    id: ANALYSIS_S2_DESIGN,
    tenantId: TENANT_A,
    userId: STUDENT_2,
    workType: 'design',
    title: '海报设计稿',
    status: 'success',
    overallScore: 85,
    createdAt: new Date('2026-08-02T10:00:00Z'),
  });
  prismaMock.__insertAnalysis({
    id: ANALYSIS_S1_PENDING,
    tenantId: TENANT_A,
    userId: STUDENT_1,
    workType: 'painting',
    title: '处理中作品',
    status: 'pending',
    overallScore: null,
    createdAt: new Date('2026-08-03T10:00:00Z'),
  });
  prismaMock.__insertAnalysis({
    id: ANALYSIS_S1_SCULPTURE,
    tenantId: TENANT_A,
    userId: STUDENT_1,
    workType: 'sculpture',
    title: '泥塑头像',
    status: 'success',
    overallScore: 88,
    createdAt: new Date('2026-08-04T10:00:00Z'),
  });
  // 分析记录(租户 B)
  prismaMock.__insertAnalysis({
    id: ANALYSIS_B_PAINTING,
    tenantId: TENANT_B,
    userId: STUDENT_B,
    workType: 'painting',
    title: '租户B作品',
    status: 'success',
    overallScore: 70,
    createdAt: new Date('2026-08-01T10:00:00Z'),
  });
}

/** 快捷:学生1分享自己的绘画作品(返回响应体 data) */
async function shareByStudent1(caption?: string): Promise<string> {
  const res = await request(getTestApp())
    .post(`/api/v1/analyses/${ANALYSIS_S1_PAINTING}/share`)
    .set(buildAuthHeaders(tokenStudent1()))
    .send(caption !== undefined ? { caption } : {});
  expect(res.status).toBe(200);
  const body = assertApiResponse(res);
  return (body.data as { id: string }).id;
}

// ============================================================
// S1: POST /analyses/:id/share — 分享作品到组织
// ============================================================

describe('S1: POST /analyses/:id/share', () => {
  beforeEach(seedBase);

  it('should_share_own_success_analysis_with_caption', async () => {
    const res = await request(getTestApp())
      .post(`/api/v1/analyses/${ANALYSIS_S1_PAINTING}/share`)
      .set(buildAuthHeaders(tokenStudent1()))
      .send({ caption: '请大家指点构图' });

    expect(res.status).toBe(200);
    const body = assertApiResponse(res);
    expect(body.message).toBe('已分享到组织');
    const data = body.data as {
      id: string;
      caption: string | null;
      isPinned: boolean;
      analysis: { id: string; workType: string; title: string; overallScore: number };
      user: { id: string; name: string; role: string };
      commentCount: number;
      recentComments: unknown[];
    };
    expect(data.id).toBeDefined();
    expect(data.caption).toBe('请大家指点构图');
    expect(data.isPinned).toBe(false);
    expect(data.analysis.id).toBe(ANALYSIS_S1_PAINTING);
    expect(data.analysis.workType).toBe('painting');
    expect(data.analysis.title).toBe('山水习作');
    expect(data.analysis.overallScore).toBe(80);
    expect(data.user.id).toBe(STUDENT_1);
    expect(data.user.name).toBe('分享学生1');
    expect(data.commentCount).toBe(0);
    expect(data.recentComments).toEqual([]);

    // DB 断言:分享记录已落库且归属租户 A
    const stored = await prismaMock.sharedWork.findFirst({
      where: { tenantId: TENANT_A, analysisId: ANALYSIS_S1_PAINTING, userId: STUDENT_1 },
    });
    expect(stored).not.toBeNull();
    expect(stored!.caption).toBe('请大家指点构图');
  });

  it('should_share_without_caption_defaulting_to_null', async () => {
    const res = await request(getTestApp())
      .post(`/api/v1/analyses/${ANALYSIS_S1_PAINTING}/share`)
      .set(buildAuthHeaders(tokenStudent1()))
      .send({});

    expect(res.status).toBe(200);
    const body = assertApiResponse(res);
    expect((body.data as { caption: string | null }).caption).toBeNull();
  });

  it('should_return_400_when_caption_exceeds_200_chars', async () => {
    const res = await request(getTestApp())
      .post(`/api/v1/analyses/${ANALYSIS_S1_PAINTING}/share`)
      .set(buildAuthHeaders(tokenStudent1()))
      .send({ caption: 'x'.repeat(201) });

    assertApiError(res, ErrorCode.PARAM_INVALID, 400);
  });

  it('should_return_401_when_unauthenticated', async () => {
    const res = await request(getTestApp())
      .post(`/api/v1/analyses/${ANALYSIS_S1_PAINTING}/share`)
      .send({});
    expect(res.status).toBe(401);
  });

  it('should_return_403_when_sharing_others_analysis', async () => {
    // student2 尝试分享 student1 的作品
    const res = await request(getTestApp())
      .post(`/api/v1/analyses/${ANALYSIS_S1_PAINTING}/share`)
      .set(buildAuthHeaders(tokenStudent2()))
      .send({});

    assertApiError(res, ErrorCode.FORBIDDEN, 403);
    expect(res.body.message).toContain('仅可分享自己的作品');
  });

  it('should_return_400_when_analysis_not_success', async () => {
    const res = await request(getTestApp())
      .post(`/api/v1/analyses/${ANALYSIS_S1_PENDING}/share`)
      .set(buildAuthHeaders(tokenStudent1()))
      .send({});

    assertApiError(res, ErrorCode.PARAM_INVALID, 400);
    expect(res.body.message).toContain('仅可分享已完成分析的作品');
  });

  it('should_return_409_when_share_duplicated', async () => {
    await shareByStudent1('首次分享');

    const res = await request(getTestApp())
      .post(`/api/v1/analyses/${ANALYSIS_S1_PAINTING}/share`)
      .set(buildAuthHeaders(tokenStudent1()))
      .send({ caption: '重复分享' });

    assertApiError(res, ErrorCode.SHARE_ALREADY_EXISTS, 409);
    expect(res.body.message).toContain('请勿重复分享');

    // DB 断言:仍仅一条分享记录
    const count = await prismaMock.sharedWork.count({
      where: { tenantId: TENANT_A, analysisId: ANALYSIS_S1_PAINTING },
    });
    expect(count).toBe(1);
  });

  it('should_return_404_when_cross_tenant_access', async () => {
    // 租户 B 学生尝试分享租户 A 的分析记录(不泄露存在性)
    const res = await request(getTestApp())
      .post(`/api/v1/analyses/${ANALYSIS_S1_PAINTING}/share`)
      .set(buildAuthHeaders(tokenStudentB()))
      .send({});

    assertApiError(res, ErrorCode.ANALYSIS_NOT_FOUND, 404);
  });

  it('should_notify_teachers_and_admins_on_share', async () => {
    await shareByStudent1();

    // fire-and-forget 异步通知:等待微任务链完成
    await vi.waitFor(() => {
      expect(notificationMock.createNotification).toHaveBeenCalled();
    });

    // 受众:租户 A 内 teacher + admin(排除分享者本人)
    const calls = notificationMock.createNotification.mock.calls;
    const notifiedUserIds = calls.map((c) => (c[0] as { userId: string }).userId).sort();
    expect(notifiedUserIds).toEqual([ADMIN_1, TEACHER_1].sort());
    for (const call of calls) {
      const arg = call[0] as { tenantId: string; type: string; title: string; content: string };
      expect(arg.tenantId).toBe(TENANT_A);
      expect(arg.type).toBe('SHARE');
      expect(arg.content).toContain('分享学生1');
      expect(arg.content).toContain('山水习作');
    }
  });
});

// ============================================================
// S2: DELETE /analyses/:id/share — 取消分享(本人)
// ============================================================

describe('S2: DELETE /analyses/:id/share', () => {
  beforeEach(seedBase);

  it('should_unshare_own_analysis', async () => {
    await shareByStudent1();

    const res = await request(getTestApp())
      .delete(`/api/v1/analyses/${ANALYSIS_S1_PAINTING}/share`)
      .set(buildAuthHeaders(tokenStudent1()));

    expect(res.status).toBe(200);
    assertApiResponse(res);

    const count = await prismaMock.sharedWork.count({ where: { tenantId: TENANT_A } });
    expect(count).toBe(0);
  });

  it('should_return_404_when_not_shared', async () => {
    const res = await request(getTestApp())
      .delete(`/api/v1/analyses/${ANALYSIS_S1_PAINTING}/share`)
      .set(buildAuthHeaders(tokenStudent1()));

    assertApiError(res, ErrorCode.SHARE_NOT_FOUND, 404);
  });
});

// ============================================================
// S3: GET /org/feed — 组织动态流
// ============================================================

describe('S3: GET /org/feed', () => {
  beforeEach(seedBase);

  it('should_return_empty_feed_when_no_shares', async () => {
    const res = await request(getTestApp())
      .get('/api/v1/org/feed')
      .set(buildAuthHeaders(tokenStudent1()));

    expect(res.status).toBe(200);
    const body = assertApiResponse(res);
    const data = body.data as { items: unknown[]; total: number; hasMore: boolean };
    expect(data.items).toEqual([]);
    expect(data.total).toBe(0);
    expect(data.hasMore).toBe(false);
  });

  it('should_list_feed_with_pinned_first_then_created_at_desc', async () => {
    // 三条分享:sw-1(08-01,未置顶)/ sw-2(08-03,未置顶)/ sw-3(08-02,置顶)
    prismaMock.__insertSharedWork({
      id: 'sw-feed-1',
      tenantId: TENANT_A,
      analysisId: ANALYSIS_S1_PAINTING,
      userId: STUDENT_1,
      createdAt: new Date('2026-08-01T12:00:00Z'),
    });
    prismaMock.__insertSharedWork({
      id: 'sw-feed-2',
      tenantId: TENANT_A,
      analysisId: ANALYSIS_S2_DESIGN,
      userId: STUDENT_2,
      createdAt: new Date('2026-08-03T12:00:00Z'),
    });
    prismaMock.__insertSharedWork({
      id: 'sw-feed-3',
      tenantId: TENANT_A,
      analysisId: ANALYSIS_S1_SCULPTURE,
      userId: STUDENT_1,
      isPinned: true,
      createdAt: new Date('2026-08-02T12:00:00Z'),
    });

    const res = await request(getTestApp())
      .get('/api/v1/org/feed')
      .set(buildAuthHeaders(tokenStudent1()));

    expect(res.status).toBe(200);
    const body = assertApiResponse(res);
    const data = body.data as { items: Array<{ id: string; isPinned: boolean }>; total: number };
    expect(data.total).toBe(3);
    expect(data.items.map((i) => i.id)).toEqual(['sw-feed-3', 'sw-feed-2', 'sw-feed-1']);
    expect(data.items[0]!.isPinned).toBe(true);
  });

  it('should_paginate_feed_correctly', async () => {
    for (const [idx, analysisId] of [ANALYSIS_S1_PAINTING, ANALYSIS_S2_DESIGN, ANALYSIS_S1_SCULPTURE].entries()) {
      prismaMock.__insertSharedWork({
        id: `sw-page-${idx}`,
        tenantId: TENANT_A,
        analysisId,
        userId: STUDENT_1,
        createdAt: new Date(`2026-08-0${idx + 1}T12:00:00Z`),
      });
    }

    const page1 = await request(getTestApp())
      .get('/api/v1/org/feed?page=1&pageSize=2')
      .set(buildAuthHeaders(tokenStudent1()));
    const body1 = assertApiResponse(page1);
    const data1 = body1.data as { items: unknown[]; total: number; hasMore: boolean; page: number; pageSize: number };
    expect(data1.items.length).toBe(2);
    expect(data1.total).toBe(3);
    expect(data1.hasMore).toBe(true);
    expect(data1.page).toBe(1);
    expect(data1.pageSize).toBe(2);

    const page2 = await request(getTestApp())
      .get('/api/v1/org/feed?page=2&pageSize=2')
      .set(buildAuthHeaders(tokenStudent1()));
    const body2 = assertApiResponse(page2);
    const data2 = body2.data as { items: unknown[]; hasMore: boolean };
    expect(data2.items.length).toBe(1);
    expect(data2.hasMore).toBe(false);
  });

  it('should_filter_feed_by_work_type', async () => {
    prismaMock.__insertSharedWork({
      id: 'sw-filter-painting',
      tenantId: TENANT_A,
      analysisId: ANALYSIS_S1_PAINTING,
      userId: STUDENT_1,
    });
    prismaMock.__insertSharedWork({
      id: 'sw-filter-design',
      tenantId: TENANT_A,
      analysisId: ANALYSIS_S2_DESIGN,
      userId: STUDENT_2,
    });

    const res = await request(getTestApp())
      .get('/api/v1/org/feed?workType=painting')
      .set(buildAuthHeaders(tokenStudent1()));

    const body = assertApiResponse(res);
    const data = body.data as { items: Array<{ id: string; analysis: { workType: string } }>; total: number };
    expect(data.total).toBe(1);
    expect(data.items[0]!.id).toBe('sw-filter-painting');
    expect(data.items[0]!.analysis.workType).toBe('painting');
  });

  it('should_return_400_when_work_type_invalid', async () => {
    const res = await request(getTestApp())
      .get('/api/v1/org/feed?workType=calligraphy')
      .set(buildAuthHeaders(tokenStudent1()));
    assertApiError(res, ErrorCode.PARAM_INVALID, 400);
  });

  it('should_isolate_feed_between_tenants', async () => {
    prismaMock.__insertSharedWork({
      id: 'sw-tenant-a',
      tenantId: TENANT_A,
      analysisId: ANALYSIS_S1_PAINTING,
      userId: STUDENT_1,
    });
    prismaMock.__insertSharedWork({
      id: 'sw-tenant-b',
      tenantId: TENANT_B,
      analysisId: ANALYSIS_B_PAINTING,
      userId: STUDENT_B,
    });

    // 租户 B 学生仅可见本租户动态
    const res = await request(getTestApp())
      .get('/api/v1/org/feed')
      .set(buildAuthHeaders(tokenStudentB()));

    const body = assertApiResponse(res);
    const data = body.data as { items: Array<{ id: string }>; total: number };
    expect(data.total).toBe(1);
    expect(data.items[0]!.id).toBe('sw-tenant-b');
  });

  it('should_return_401_when_unauthenticated', async () => {
    const res = await request(getTestApp()).get('/api/v1/org/feed');
    expect(res.status).toBe(401);
  });

  it('should_include_comment_count_and_recent_3_comments_ascending', async () => {
    prismaMock.__insertSharedWork({
      id: 'sw-comments',
      tenantId: TENANT_A,
      analysisId: ANALYSIS_S1_PAINTING,
      userId: STUDENT_1,
    });
    // 4 条评论,时间升序 c1 → c4
    for (let i = 1; i <= 4; i++) {
      prismaMock.__insertShareComment({
        id: `c-${i}`,
        sharedWorkId: 'sw-comments',
        userId: i % 2 === 0 ? TEACHER_1 : STUDENT_2,
        content: `评论${i}`,
        createdAt: new Date(`2026-08-05T0${i}:00:00Z`),
      });
    }

    const res = await request(getTestApp())
      .get('/api/v1/org/feed')
      .set(buildAuthHeaders(tokenStudent1()));

    const body = assertApiResponse(res);
    const data = body.data as {
      items: Array<{
        id: string;
        commentCount: number;
        recentComments: Array<{ id: string; user: { name: string } }>;
      }>;
    };
    expect(data.items.length).toBe(1);
    const item = data.items[0]!;
    expect(item.commentCount).toBe(4);
    // 预览为最新 3 条(c2/c3/c4),展示层翻转为时间升序
    expect(item.recentComments.length).toBe(3);
    expect(item.recentComments.map((c) => c.id)).toEqual(['c-2', 'c-3', 'c-4']);
    expect(item.recentComments[0]!.user.name).toBeDefined();
  });
});

// ============================================================
// S4: DELETE /org/feed/:id — 删除分享
// ============================================================

describe('S4: DELETE /org/feed/:id', () => {
  beforeEach(seedBase);

  it('should_delete_own_shared_work', async () => {
    const sharedId = await shareByStudent1();

    const res = await request(getTestApp())
      .delete(`/api/v1/org/feed/${sharedId}`)
      .set(buildAuthHeaders(tokenStudent1()));

    expect(res.status).toBe(200);
    assertApiResponse(res);
    expect(await prismaMock.sharedWork.count({ where: { tenantId: TENANT_A } })).toBe(0);
  });

  it('should_return_403_when_student_deletes_others_share', async () => {
    const sharedId = await shareByStudent1();

    const res = await request(getTestApp())
      .delete(`/api/v1/org/feed/${sharedId}`)
      .set(buildAuthHeaders(tokenStudent2()));

    assertApiError(res, ErrorCode.FORBIDDEN, 403);
    // 记录仍在
    expect(await prismaMock.sharedWork.count({ where: { tenantId: TENANT_A } })).toBe(1);
  });

  it('should_allow_teacher_to_delete_others_share', async () => {
    const sharedId = await shareByStudent1();

    const res = await request(getTestApp())
      .delete(`/api/v1/org/feed/${sharedId}`)
      .set(buildAuthHeaders(tokenTeacher()));

    expect(res.status).toBe(200);
    expect(await prismaMock.sharedWork.count({ where: { tenantId: TENANT_A } })).toBe(0);
  });

  it('should_return_404_when_cross_tenant_delete', async () => {
    const sharedId = await shareByStudent1();

    const res = await request(getTestApp())
      .delete(`/api/v1/org/feed/${sharedId}`)
      .set(buildAuthHeaders(tokenStudentB()));

    assertApiError(res, ErrorCode.SHARE_NOT_FOUND, 404);
  });

  it('should_cascade_delete_comments_when_share_deleted', async () => {
    const sharedId = await shareByStudent1();
    await request(getTestApp())
      .post(`/api/v1/org/feed/${sharedId}/comments`)
      .set(buildAuthHeaders(tokenTeacher()))
      .send({ content: '构图再收紧一些' });
    expect(await prismaMock.shareComment.count({ where: { sharedWorkId: sharedId } })).toBe(1);

    await request(getTestApp())
      .delete(`/api/v1/org/feed/${sharedId}`)
      .set(buildAuthHeaders(tokenStudent1()));

    // 级联:评论随分享一并清理
    expect(await prismaMock.shareComment.count({ where: { sharedWorkId: sharedId } })).toBe(0);
  });
});

// ============================================================
// S5: POST|DELETE /org/feed/:id/pin — 置顶/取消置顶
// ============================================================

describe('S5: pin / unpin shared work', () => {
  beforeEach(seedBase);

  it('should_allow_teacher_to_pin_and_unpin', async () => {
    const sharedId = await shareByStudent1();

    const pinRes = await request(getTestApp())
      .post(`/api/v1/org/feed/${sharedId}/pin`)
      .set(buildAuthHeaders(tokenTeacher()));
    expect(pinRes.status).toBe(200);
    const pinBody = assertApiResponse(pinRes);
    expect((pinBody.data as { isPinned: boolean }).isPinned).toBe(true);

    // 动态流断言:置顶条目排在最前
    prismaMock.__insertSharedWork({
      id: 'sw-later',
      tenantId: TENANT_A,
      analysisId: ANALYSIS_S2_DESIGN,
      userId: STUDENT_2,
      createdAt: new Date(Date.now() + 60_000),
    });
    const feed = await request(getTestApp())
      .get('/api/v1/org/feed')
      .set(buildAuthHeaders(tokenStudent1()));
    const feedData = assertApiResponse(feed).data as { items: Array<{ id: string }> };
    expect(feedData.items[0]!.id).toBe(sharedId);

    const unpinRes = await request(getTestApp())
      .delete(`/api/v1/org/feed/${sharedId}/pin`)
      .set(buildAuthHeaders(tokenTeacher()));
    expect(unpinRes.status).toBe(200);
    const unpinBody = assertApiResponse(unpinRes);
    expect((unpinBody.data as { isPinned: boolean }).isPinned).toBe(false);
  });

  it('should_return_403_when_student_pins', async () => {
    const sharedId = await shareByStudent1();

    const res = await request(getTestApp())
      .post(`/api/v1/org/feed/${sharedId}/pin`)
      .set(buildAuthHeaders(tokenStudent1()));
    // requirePermission('share:manage') 在 service 之前拦截
    assertApiError(res, ErrorCode.FORBIDDEN, 403);
  });

  it('should_return_404_when_pin_non_existent', async () => {
    const res = await request(getTestApp())
      .post('/api/v1/org/feed/sw-not-exist/pin')
      .set(buildAuthHeaders(tokenTeacher()));
    assertApiError(res, ErrorCode.SHARE_NOT_FOUND, 404);
  });
});

// ============================================================
// S6: POST /org/feed/:id/comments — 发表评论
// ============================================================

describe('S6: POST /org/feed/:id/comments', () => {
  beforeEach(seedBase);

  it('should_create_comment_with_user_info', async () => {
    const sharedId = await shareByStudent1();

    const res = await request(getTestApp())
      .post(`/api/v1/org/feed/${sharedId}/comments`)
      .set(buildAuthHeaders(tokenTeacher()))
      .send({ content: '色彩层次不错,暗部再压一压' });

    expect(res.status).toBe(200);
    const body = assertApiResponse(res);
    const data = body.data as {
      id: string;
      sharedWorkId: string;
      content: string;
      user: { id: string; name: string; role: string };
    };
    expect(data.sharedWorkId).toBe(sharedId);
    expect(data.content).toBe('色彩层次不错,暗部再压一压');
    expect(data.user.id).toBe(TEACHER_1);
    expect(data.user.name).toBe('分享教师');
    expect(data.user.role).toBe('teacher');
  });

  it('should_return_400_when_content_empty_or_too_long', async () => {
    const sharedId = await shareByStudent1();

    const empty = await request(getTestApp())
      .post(`/api/v1/org/feed/${sharedId}/comments`)
      .set(buildAuthHeaders(tokenTeacher()))
      .send({ content: '' });
    assertApiError(empty, ErrorCode.PARAM_INVALID, 400);

    const tooLong = await request(getTestApp())
      .post(`/api/v1/org/feed/${sharedId}/comments`)
      .set(buildAuthHeaders(tokenTeacher()))
      .send({ content: 'x'.repeat(501) });
    assertApiError(tooLong, ErrorCode.PARAM_INVALID, 400);
  });

  it('should_return_404_when_comment_on_non_existent_share', async () => {
    const res = await request(getTestApp())
      .post('/api/v1/org/feed/sw-not-exist/comments')
      .set(buildAuthHeaders(tokenTeacher()))
      .send({ content: 'test' });
    assertApiError(res, ErrorCode.SHARE_NOT_FOUND, 404);
  });

  it('should_notify_owner_when_others_comment', async () => {
    const sharedId = await shareByStudent1();
    notificationMock.createNotification.mockClear();

    await request(getTestApp())
      .post(`/api/v1/org/feed/${sharedId}/comments`)
      .set(buildAuthHeaders(tokenTeacher()))
      .send({ content: '整体不错' });

    await vi.waitFor(() => {
      expect(notificationMock.createNotification).toHaveBeenCalled();
    });
    const arg = notificationMock.createNotification.mock.calls[0]![0] as {
      userId: string;
      tenantId: string;
      type: string;
      content: string;
    };
    expect(arg.userId).toBe(STUDENT_1);
    expect(arg.tenantId).toBe(TENANT_A);
    expect(arg.type).toBe('COMMENT');
    expect(arg.content).toContain('分享教师');
  });

  it('should_not_notify_when_owner_comments_own_share', async () => {
    const sharedId = await shareByStudent1();
    notificationMock.createNotification.mockClear();

    await request(getTestApp())
      .post(`/api/v1/org/feed/${sharedId}/comments`)
      .set(buildAuthHeaders(tokenStudent1()))
      .send({ content: '补充一下创作背景' });

    // 本人评论本人作品:不触发通知(等待一个事件循环周期确认无调用)
    await new Promise((r) => setTimeout(r, 20));
    expect(notificationMock.createNotification).not.toHaveBeenCalled();
  });
});

// ============================================================
// S7: GET /org/feed/:id/comments — 评论列表
// ============================================================

describe('S7: GET /org/feed/:id/comments', () => {
  beforeEach(seedBase);

  it('should_list_comments_in_created_at_ascending_order', async () => {
    const sharedId = await shareByStudent1();
    for (const [idx, content] of ['第一条', '第二条', '第三条'].entries()) {
      prismaMock.__insertShareComment({
        id: `c-list-${idx}`,
        sharedWorkId: sharedId,
        userId: STUDENT_2,
        content,
        createdAt: new Date(`2026-08-06T0${idx + 1}:00:00Z`),
      });
    }

    const res = await request(getTestApp())
      .get(`/api/v1/org/feed/${sharedId}/comments`)
      .set(buildAuthHeaders(tokenStudent1()));

    expect(res.status).toBe(200);
    const body = assertApiResponse(res);
    const data = body.data as Array<{ content: string; user: { name: string } }>;
    expect(data.length).toBe(3);
    expect(data.map((c) => c.content)).toEqual(['第一条', '第二条', '第三条']);
    expect(data[0]!.user.name).toBe('分享学生2');
  });

  it('should_return_404_when_cross_tenant_list_comments', async () => {
    const sharedId = await shareByStudent1();

    const res = await request(getTestApp())
      .get(`/api/v1/org/feed/${sharedId}/comments`)
      .set(buildAuthHeaders(tokenStudentB()));
    assertApiError(res, ErrorCode.SHARE_NOT_FOUND, 404);
  });
});

// ============================================================
// S8: DELETE /org/feed/:id/comments/:cid — 删除评论
// ============================================================

describe('S8: DELETE /org/feed/:id/comments/:cid', () => {
  beforeEach(seedBase);

  it('should_delete_own_comment', async () => {
    const sharedId = await shareByStudent1();
    const createRes = await request(getTestApp())
      .post(`/api/v1/org/feed/${sharedId}/comments`)
      .set(buildAuthHeaders(tokenStudent2()))
      .send({ content: '同学互评' });
    const commentId = (assertApiResponse(createRes).data as { id: string }).id;

    const res = await request(getTestApp())
      .delete(`/api/v1/org/feed/${sharedId}/comments/${commentId}`)
      .set(buildAuthHeaders(tokenStudent2()));

    expect(res.status).toBe(200);
    expect(await prismaMock.shareComment.count({ where: { sharedWorkId: sharedId } })).toBe(0);
  });

  it('should_return_403_when_student_deletes_others_comment', async () => {
    const sharedId = await shareByStudent1();
    const createRes = await request(getTestApp())
      .post(`/api/v1/org/feed/${sharedId}/comments`)
      .set(buildAuthHeaders(tokenTeacher()))
      .send({ content: '教师点评' });
    const commentId = (assertApiResponse(createRes).data as { id: string }).id;

    const res = await request(getTestApp())
      .delete(`/api/v1/org/feed/${sharedId}/comments/${commentId}`)
      .set(buildAuthHeaders(tokenStudent2()));

    assertApiError(res, ErrorCode.FORBIDDEN, 403);
  });

  it('should_allow_teacher_to_delete_others_comment', async () => {
    const sharedId = await shareByStudent1();
    const createRes = await request(getTestApp())
      .post(`/api/v1/org/feed/${sharedId}/comments`)
      .set(buildAuthHeaders(tokenStudent2()))
      .send({ content: '同学互评' });
    const commentId = (assertApiResponse(createRes).data as { id: string }).id;

    const res = await request(getTestApp())
      .delete(`/api/v1/org/feed/${sharedId}/comments/${commentId}`)
      .set(buildAuthHeaders(tokenTeacher()));

    expect(res.status).toBe(200);
    expect(await prismaMock.shareComment.count({ where: { sharedWorkId: sharedId } })).toBe(0);
  });

  it('should_return_404_when_comment_not_belong_to_share', async () => {
    const sharedId = await shareByStudent1();
    // 评论挂在另一条分享上
    prismaMock.__insertSharedWork({
      id: 'sw-other',
      tenantId: TENANT_A,
      analysisId: ANALYSIS_S2_DESIGN,
      userId: STUDENT_2,
    });
    prismaMock.__insertShareComment({
      id: 'c-other',
      sharedWorkId: 'sw-other',
      userId: STUDENT_2,
      content: '别人的评论',
    });

    const res = await request(getTestApp())
      .delete(`/api/v1/org/feed/${sharedId}/comments/c-other`)
      .set(buildAuthHeaders(tokenTeacher()));

    assertApiError(res, ErrorCode.SHARE_COMMENT_NOT_FOUND, 404);
  });
});
