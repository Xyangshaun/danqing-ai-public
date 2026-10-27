// ============================================================
// NotificationService 通知服务单元测试(任务包 B)
// 对应源码: src/services/notification.service.ts
// 对应文档: .trae/specs/interaction-skeleton-optimization/spec.md(通知系统设计)
//
// 测试范围:
//   1. listNotifications:首页/翻页/游标解码/limit 规范化/onlyUnread/空列表
//   2. getUnreadCount:正常计数/零计数
//   3. markRead:不存在 404/成功标记/幂等(已读再标记)
//   4. markAllRead:批量标记/无未读时返回 0
//   5. createNotification:必填校验/标题超长/成功创建
//   6. 多租户隔离:验证 Repository 被传入正确的 tenantId + userId
//   7. 游标编码/解码:nextCursor 可往返解码
//
// Mock 策略:
//   - vi.mock 替换 notificationRepository 模块(纯单元测试,不依赖 prisma.mock)
//   - 与 preset.service.test.ts 同属纯服务单元测试风格
//   - vi.hoisted 保证 mock 引用在 vi.mock 工厂执行前已初始化
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { notificationService } from '../src/services/notification.service.js';
import { BusinessError } from '../src/middlewares/error-handler.js';
import { ErrorCode } from '../src/types/api-contract.js';
import type { Notification as PrismaNotification } from '@prisma/client';

// ============================================================
// vi.mock:替换 notificationRepository 模块
// ============================================================

const { mockNotifRepo } = vi.hoisted(() => ({
  mockNotifRepo: {
    listByCursor: vi.fn(),
    countUnread: vi.fn(),
    findByIdAndOwner: vi.fn(),
    markRead: vi.fn(),
    markAllRead: vi.fn(),
    create: vi.fn(),
  },
}));

vi.mock('../src/repositories/notification.repository.js', () => ({
  NotificationRepository: class {},
  notificationRepository: mockNotifRepo,
}));

// ============================================================
// 测试常量与工厂
// ============================================================

const TENANT_A = 't-notif-a';
const TENANT_B = 't-notif-b'; // 用于多租户隔离断言
const USER_A = 'u-notif-a';
const USER_B = 'u-notif-b'; // 用于跨用户隔离断言

/**
 * 构造 Prisma Notification 记录(测试工厂)
 * 默认:未读,INFO 级别,SYSTEM 类型
 */
function makeNotification(overrides: Partial<PrismaNotification> = {}): PrismaNotification {
  return {
    id: 'n-0001',
    tenantId: TENANT_A,
    userId: USER_A,
    type: 'SYSTEM',
    title: '测试通知',
    content: '这是一条测试通知内容',
    level: 'INFO',
    linkUrl: null,
    metadata: null,
    readAt: null,
    createdAt: new Date('2026-08-01T10:00:00Z'),
    ...overrides,
  } as PrismaNotification;
}

/**
 * 批量构造通知(按时间倒序,模拟 DB 返回顺序)
 * @param count 数量
 * @param baseTime 基准时间(每条递减 1 分钟,保证 createdAt 递减)
 */
function makeNotificationList(count: number, baseTime = new Date('2026-08-01T10:00:00Z')): PrismaNotification[] {
  const list: PrismaNotification[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(baseTime.getTime() - i * 60_000); // 每条减 1 分钟
    list.push(
      makeNotification({
        id: `n-${String(i + 1).padStart(4, '0')}`,
        createdAt: d,
        title: `通知 ${i + 1}`,
      }),
    );
  }
  return list;
}

/**
 * 解码游标(复用 service 内部编码逻辑的逆向,用于断言 nextCursor 内容)
 * service 使用 Base64URL 编码 JSON { c, i }
 */
function decodeNextCursor(cursor: string): { c: string; i: string } {
  const std = cursor.replace(/-/g, '+').replace(/_/g, '/');
  const padded = std + '='.repeat((4 - (std.length % 4)) % 4);
  const json = Buffer.from(padded, 'base64').toString('utf8');
  return JSON.parse(json) as { c: string; i: string };
}

// ============================================================
// 辅助:断言 BusinessError
// ============================================================

async function expectBusinessError(
  fn: () => Promise<unknown>,
  code: ErrorCode,
  httpStatus: number,
): Promise<void> {
  try {
    await fn();
    expect.fail(`expected BusinessError(code=${code}) but no error was thrown`);
  } catch (err) {
    expect(err).toBeInstanceOf(BusinessError);
    expect((err as BusinessError).code).toBe(code);
    expect((err as BusinessError).httpStatus).toBe(httpStatus);
  }
}

// ============================================================
// 测试组
// ============================================================

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------- listNotifications ----------

describe('NotificationService.listNotifications', () => {
  it('首页:返回 ≤ limit 条,nextCursor 在有更多数据时非空', async () => {
    // 模拟 DB 返回 limit+1=21 条(表示有下一页)
    const records = makeNotificationList(21);
    mockNotifRepo.listByCursor.mockResolvedValue(records);

    const result = await notificationService.listNotifications(TENANT_A, USER_A, { limit: 20 });

    // 验证 Repository 被正确调用(tenantId + userId + limit+1 策略)
    expect(mockNotifRepo.listByCursor).toHaveBeenCalledWith(
      TENANT_A,
      USER_A,
      expect.objectContaining({ limit: 21, onlyUnread: false }),
    );
    // 截取前 20 条
    expect(result.items).toHaveLength(20);
    // 有下一页 → nextCursor 非空
    expect(result.nextCursor).not.toBeNull();
    // nextCursor 解码后应为第 20 条的 createdAt + id
    const decoded = decodeNextCursor(result.nextCursor!);
    expect(decoded.i).toBe('n-0020');
    expect(decoded.c).toBe(records[19]!.createdAt.toISOString());
  });

  it('最后一页:返回 < limit 条,nextCursor 为 null(无更多数据)', async () => {
    // 模拟 DB 返回 5 条(≤ limit=20,无下一页)
    const records = makeNotificationList(5);
    mockNotifRepo.listByCursor.mockResolvedValue(records);

    const result = await notificationService.listNotifications(TENANT_A, USER_A, { limit: 20 });

    expect(result.items).toHaveLength(5);
    expect(result.nextCursor).toBeNull();
  });

  it('空列表:返回空数组 + nextCursor null', async () => {
    mockNotifRepo.listByCursor.mockResolvedValue([]);

    const result = await notificationService.listNotifications(TENANT_A, USER_A, { limit: 20 });

    expect(result.items).toEqual([]);
    expect(result.nextCursor).toBeNull();
  });

  it('limit 规范化:undefined → 默认 20', async () => {
    mockNotifRepo.listByCursor.mockResolvedValue([]);

    await notificationService.listNotifications(TENANT_A, USER_A, {});

    // limit 未传 → 默认 20 → Repository 收到 21(limit+1)
    expect(mockNotifRepo.listByCursor).toHaveBeenCalledWith(
      TENANT_A,
      USER_A,
      expect.objectContaining({ limit: 21 }),
    );
  });

  it('limit 规范化:超范围(100)→ 钳制为 50', async () => {
    mockNotifRepo.listByCursor.mockResolvedValue([]);

    await notificationService.listNotifications(TENANT_A, USER_A, { limit: 100 });

    // limit=100 → 钳制为 50 → Repository 收到 51
    expect(mockNotifRepo.listByCursor).toHaveBeenCalledWith(
      TENANT_A,
      USER_A,
      expect.objectContaining({ limit: 51 }),
    );
  });

  it('limit 规范化:0/负数 → 钳制为 1', async () => {
    mockNotifRepo.listByCursor.mockResolvedValue([]);

    await notificationService.listNotifications(TENANT_A, USER_A, { limit: 0 });

    expect(mockNotifRepo.listByCursor).toHaveBeenCalledWith(
      TENANT_A,
      USER_A,
      expect.objectContaining({ limit: 2 }), // 1+1
    );
  });

  it('limit 规范化:非整数(15.7)→ 回退默认 20', async () => {
    mockNotifRepo.listByCursor.mockResolvedValue([]);

    await notificationService.listNotifications(TENANT_A, USER_A, { limit: 15.7 });

    expect(mockNotifRepo.listByCursor).toHaveBeenCalledWith(
      TENANT_A,
      USER_A,
      expect.objectContaining({ limit: 21 }),
    );
  });

  it('onlyUnread=true:传递给 Repository', async () => {
    mockNotifRepo.listByCursor.mockResolvedValue([]);

    await notificationService.listNotifications(TENANT_A, USER_A, { onlyUnread: true });

    expect(mockNotifRepo.listByCursor).toHaveBeenCalledWith(
      TENANT_A,
      USER_A,
      expect.objectContaining({ onlyUnread: true }),
    );
  });

  it('游标翻页:传入有效 cursor 时解码并传给 Repository', async () => {
    // 构造一个有效游标(Base64URL of { c, i })
    const cursorPayload = { c: '2026-08-01T09:30:00.000Z', i: 'n-0010' };
    const cursor = Buffer.from(JSON.stringify(cursorPayload), 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    mockNotifRepo.listByCursor.mockResolvedValue([]);

    await notificationService.listNotifications(TENANT_A, USER_A, { cursor });

    expect(mockNotifRepo.listByCursor).toHaveBeenCalledWith(
      TENANT_A,
      USER_A,
      expect.objectContaining({
        cursor: { createdAt: new Date(cursorPayload.c), id: 'n-0010' },
      }),
    );
  });

  it('非法游标(非 Base64)→ PARAM_INVALID 400', async () => {
    await expectBusinessError(
      () => notificationService.listNotifications(TENANT_A, USER_A, { cursor: '!!!invalid-base64@@@' }),
      ErrorCode.PARAM_INVALID,
      400,
    );
    expect(mockNotifRepo.listByCursor).not.toHaveBeenCalled();
  });

  it('非法游标(JSON 字段缺失)→ PARAM_INVALID 400', async () => {
    // 编码一个缺少 i 字段的 JSON
    const badPayload = { c: '2026-08-01T09:30:00.000Z' };
    const badCursor = Buffer.from(JSON.stringify(badPayload), 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    await expectBusinessError(
      () => notificationService.listNotifications(TENANT_A, USER_A, { cursor: badCursor }),
      ErrorCode.PARAM_INVALID,
      400,
    );
  });

  it('多租户隔离:Repository 收到正确的 tenantId + userId', async () => {
    mockNotifRepo.listByCursor.mockResolvedValue([]);

    await notificationService.listNotifications(TENANT_B, USER_B, { limit: 10 });

    expect(mockNotifRepo.listByCursor).toHaveBeenCalledWith(
      TENANT_B,
      USER_B,
      expect.any(Object),
    );
  });

  it('实体映射:Prisma Notification → API 契约 Notification(字段一一对应)', async () => {
    const record = makeNotification({
      type: 'ANALYSIS_DONE',
      level: 'SUCCESS',
      linkUrl: '/history',
      metadata: { analysisId: 'a-0001' },
      readAt: new Date('2026-08-01T11:00:00Z'),
    });
    mockNotifRepo.listByCursor.mockResolvedValue([record]);

    const result = await notificationService.listNotifications(TENANT_A, USER_A, { limit: 20 });

    const item = result.items[0]!;
    expect(item.id).toBe(record.id);
    expect(item.tenantId).toBe(record.tenantId);
    expect(item.userId).toBe(record.userId);
    expect(item.type).toBe('ANALYSIS_DONE');
    expect(item.level).toBe('SUCCESS');
    expect(item.linkUrl).toBe('/history');
    expect(item.metadata).toEqual({ analysisId: 'a-0001' });
    expect(item.readAt).toBe('2026-08-01T11:00:00.000Z');
    expect(item.createdAt).toBe('2026-08-01T10:00:00.000Z');
  });
});

// ---------- getUnreadCount ----------

describe('NotificationService.getUnreadCount', () => {
  it('正常返回未读计数', async () => {
    mockNotifRepo.countUnread.mockResolvedValue(5);

    const result = await notificationService.getUnreadCount(TENANT_A, USER_A);

    expect(mockNotifRepo.countUnread).toHaveBeenCalledWith(TENANT_A, USER_A);
    expect(result.count).toBe(5);
  });

  it('无未读时返回 0', async () => {
    mockNotifRepo.countUnread.mockResolvedValue(0);

    const result = await notificationService.getUnreadCount(TENANT_A, USER_A);

    expect(result.count).toBe(0);
  });

  it('多租户隔离:Repository 收到正确的 tenantId + userId', async () => {
    mockNotifRepo.countUnread.mockResolvedValue(0);

    await notificationService.getUnreadCount(TENANT_B, USER_B);

    expect(mockNotifRepo.countUnread).toHaveBeenCalledWith(TENANT_B, USER_B);
  });
});

// ---------- markRead ----------

describe('NotificationService.markRead', () => {
  it('成功标记未读通知为已读', async () => {
    const original = makeNotification({ id: 'n-0001', readAt: null });
    const updated = makeNotification({ id: 'n-0001', readAt: new Date('2026-08-01T12:00:00Z') });
    mockNotifRepo.findByIdAndOwner.mockResolvedValue(original);
    mockNotifRepo.markRead.mockResolvedValue(updated);

    const result = await notificationService.markRead(TENANT_A, USER_A, 'n-0001');

    // 先查 existing 判断是否已读(语义重构:替代原时间戳比较)
    expect(mockNotifRepo.findByIdAndOwner).toHaveBeenCalledWith(TENANT_A, USER_A, 'n-0001');
    // 验证 Repository 收到正确参数(tenantId + userId + notificationId + readAt Date)
    expect(mockNotifRepo.markRead).toHaveBeenCalledWith(
      TENANT_A,
      USER_A,
      'n-0001',
      expect.any(Date),
    );
    expect(result.id).toBe('n-0001');
    expect(result.readAt).toBe('2026-08-01T12:00:00.000Z');
  });

  it('通知不存在 → RESOURCE_NOT_FOUND 404', async () => {
    mockNotifRepo.findByIdAndOwner.mockResolvedValue(null);

    await expectBusinessError(
      () => notificationService.markRead(TENANT_A, USER_A, 'n-non-existent'),
      ErrorCode.RESOURCE_NOT_FOUND,
      404,
    );
    // 不存在时跳过 markRead 写操作
    expect(mockNotifRepo.markRead).not.toHaveBeenCalled();
  });

  it('跨租户通知(双过滤返回 null)→ RESOURCE_NOT_FOUND 404(不泄露存在性)', async () => {
    mockNotifRepo.findByIdAndOwner.mockResolvedValue(null);

    await expectBusinessError(
      () => notificationService.markRead(TENANT_B, USER_B, 'n-0001'),
      ErrorCode.RESOURCE_NOT_FOUND,
      404,
    );
    // 验证 findByIdAndOwner 被传入 TENANT_B + USER_B(隔离在 Repository 层强制)
    expect(mockNotifRepo.findByIdAndOwner).toHaveBeenCalledWith(
      TENANT_B,
      USER_B,
      'n-0001',
    );
    // 跨租户查不到 → 跳过 markRead 写操作
    expect(mockNotifRepo.markRead).not.toHaveBeenCalled();
  });

  it('通知 ID 为空 → PARAM_MISSING 400', async () => {
    await expectBusinessError(
      () => notificationService.markRead(TENANT_A, USER_A, ''),
      ErrorCode.PARAM_MISSING,
      400,
    );
    expect(mockNotifRepo.findByIdAndOwner).not.toHaveBeenCalled();
    expect(mockNotifRepo.markRead).not.toHaveBeenCalled();
  });

  it('通知 ID 仅空白字符 → PARAM_MISSING 400', async () => {
    await expectBusinessError(
      () => notificationService.markRead(TENANT_A, USER_A, '   '),
      ErrorCode.PARAM_MISSING,
      400,
    );
    expect(mockNotifRepo.findByIdAndOwner).not.toHaveBeenCalled();
    expect(mockNotifRepo.markRead).not.toHaveBeenCalled();
  });

  it('幂等:已读通知再次标记返回当前状态(不报错,跳过写操作)', async () => {
    // 模拟已读通知(findByIdAndOwner 返回已读记录,readAt 已有值)
    const alreadyRead = makeNotification({ id: 'n-0001', readAt: new Date('2026-08-01T11:00:00Z') });
    mockNotifRepo.findByIdAndOwner.mockResolvedValue(alreadyRead);

    const result = await notificationService.markRead(TENANT_A, USER_A, 'n-0001');

    // 不抛错,返回当前已读状态
    expect(result.id).toBe('n-0001');
    expect(result.readAt).toBe('2026-08-01T11:00:00.000Z');
    // 已读通知不再调用 markRead(跳过 updateMany 写操作)
    expect(mockNotifRepo.markRead).not.toHaveBeenCalled();
  });
});

// ---------- markAllRead ----------

describe('NotificationService.markAllRead', () => {
  it('成功批量标记未读通知为已读', async () => {
    mockNotifRepo.markAllRead.mockResolvedValue(8);

    const result = await notificationService.markAllRead(TENANT_A, USER_A);

    expect(mockNotifRepo.markAllRead).toHaveBeenCalledWith(
      TENANT_A,
      USER_A,
      expect.any(Date),
    );
    expect(result.count).toBe(8);
  });

  it('无未读通知时返回 count=0', async () => {
    mockNotifRepo.markAllRead.mockResolvedValue(0);

    const result = await notificationService.markAllRead(TENANT_A, USER_A);

    expect(result.count).toBe(0);
  });

  it('多租户隔离:Repository 收到正确的 tenantId + userId', async () => {
    mockNotifRepo.markAllRead.mockResolvedValue(0);

    await notificationService.markAllRead(TENANT_B, USER_B);

    expect(mockNotifRepo.markAllRead).toHaveBeenCalledWith(
      TENANT_B,
      USER_B,
      expect.any(Date),
    );
  });
});

// ---------- createNotification ----------

describe('NotificationService.createNotification', () => {
  it('成功创建通知(含可选字段)', async () => {
    const created = makeNotification({
      id: 'n-new-0001',
      type: 'ANALYSIS_DONE',
      level: 'SUCCESS',
      linkUrl: '/history',
    });
    mockNotifRepo.create.mockResolvedValue(created);

    const result = await notificationService.createNotification({
      tenantId: TENANT_A,
      userId: USER_A,
      type: 'ANALYSIS_DONE',
      title: '作品分析完成',
      content: '《山水图》分析报告已生成',
      level: 'SUCCESS',
      linkUrl: '/history',
      metadata: { analysisId: 'a-0001' },
    });

    expect(mockNotifRepo.create).toHaveBeenCalledTimes(1);
    const callArg = mockNotifRepo.create.mock.calls[0]![0];
    expect(callArg.tenantId).toBe(TENANT_A);
    expect(callArg.userId).toBe(USER_A);
    expect(callArg.type).toBe('ANALYSIS_DONE');
    expect(callArg.level).toBe('SUCCESS');
    expect(callArg.linkUrl).toBe('/history');
    expect(result.id).toBe('n-new-0001');
    expect(result.type).toBe('ANALYSIS_DONE');
  });

  it('level 省略时默认 INFO', async () => {
    const created = makeNotification({ level: 'INFO' });
    mockNotifRepo.create.mockResolvedValue(created);

    await notificationService.createNotification({
      tenantId: TENANT_A,
      userId: USER_A,
      type: 'SYSTEM',
      title: '系统通知',
      content: '内容',
    });

    const callArg = mockNotifRepo.create.mock.calls[0]![0];
    expect(callArg.level).toBe('INFO');
  });

  it('tenantId 缺失 → PARAM_MISSING 400', async () => {
    await expectBusinessError(
      () =>
        notificationService.createNotification({
          tenantId: '',
          userId: USER_A,
          type: 'SYSTEM',
          title: '标题',
          content: '内容',
        }),
      ErrorCode.PARAM_MISSING,
      400,
    );
    expect(mockNotifRepo.create).not.toHaveBeenCalled();
  });

  it('userId 缺失 → PARAM_MISSING 400', async () => {
    await expectBusinessError(
      () =>
        notificationService.createNotification({
          tenantId: TENANT_A,
          userId: '',
          type: 'SYSTEM',
          title: '标题',
          content: '内容',
        }),
      ErrorCode.PARAM_MISSING,
      400,
    );
  });

  it('title 为空 → PARAM_MISSING 400', async () => {
    await expectBusinessError(
      () =>
        notificationService.createNotification({
          tenantId: TENANT_A,
          userId: USER_A,
          type: 'SYSTEM',
          title: '   ',
          content: '内容',
        }),
      ErrorCode.PARAM_MISSING,
      400,
    );
  });

  it('content 为空 → PARAM_MISSING 400', async () => {
    await expectBusinessError(
      () =>
        notificationService.createNotification({
          tenantId: TENANT_A,
          userId: USER_A,
          type: 'SYSTEM',
          title: '标题',
          content: '',
        }),
      ErrorCode.PARAM_MISSING,
      400,
    );
  });

  it('title 超过 128 字符 → PARAM_INVALID 400(对应 schema.prisma VarChar(128))', async () => {
    const longTitle = 'a'.repeat(129);
    await expectBusinessError(
      () =>
        notificationService.createNotification({
          tenantId: TENANT_A,
          userId: USER_A,
          type: 'SYSTEM',
          title: longTitle,
          content: '内容',
        }),
      ErrorCode.PARAM_INVALID,
      400,
    );
    expect(mockNotifRepo.create).not.toHaveBeenCalled();
  });

  it('title 恰好 128 字符 → 创建成功(边界值)', async () => {
    const exactTitle = 'a'.repeat(128);
    const created = makeNotification({ title: exactTitle });
    mockNotifRepo.create.mockResolvedValue(created);

    await notificationService.createNotification({
      tenantId: TENANT_A,
      userId: USER_A,
      type: 'SYSTEM',
      title: exactTitle,
      content: '内容',
    });

    expect(mockNotifRepo.create).toHaveBeenCalledTimes(1);
  });
});

// ---------- 游标编码/解码往返测试 ----------

describe('NotificationService 游标往返编码', () => {
  it('nextCursor 编码的内容可被 service 再次解码(翻页连续性)', async () => {
    // 第一页:返回 21 条(有下一页),nextCursor 指向第 20 条
    const page1 = makeNotificationList(21);
    mockNotifRepo.listByCursor.mockResolvedValueOnce(page1);

    const r1 = await notificationService.listNotifications(TENANT_A, USER_A, { limit: 20 });
    expect(r1.nextCursor).not.toBeNull();

    // 第二页:用第一页的 nextCursor 翻页,Repository 应收到正确的 cursor
    const page2 = makeNotificationList(5);
    mockNotifRepo.listByCursor.mockResolvedValueOnce(page2);

    await notificationService.listNotifications(TENANT_A, USER_A, { limit: 20, cursor: r1.nextCursor! });

    // 验证第二次调用时 cursor 参数为第 20 条的 createdAt + id
    const secondCallArgs = mockNotifRepo.listByCursor.mock.calls[1]!;
    expect(secondCallArgs[2].cursor).toEqual({
      createdAt: page1[19]!.createdAt,
      id: 'n-0020',
    });
  });
});
