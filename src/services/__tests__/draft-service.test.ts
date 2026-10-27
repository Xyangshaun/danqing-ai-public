// ============================================================
// draft-service 单元测试 (任务包 A:工作台"创作草稿")
// 对应源码: src/services/draft-service.ts
//
// 测试范围:
//   1. createDraft: 创建 / 默认值 / 索引追加
//   2. listDrafts: 列表过滤 (tenant+user) / 倒序 / 7天自动清理 / 索引自愈
//   3. getDraft: 命中 / 不存在 / 损坏数据
//   4. updateDraft: 部分更新 / updatedAt 刷新 / id/createdAt 不可变
//   5. deleteDraft: 删除 / 索引同步 / 不存在幂等
//   6. deleteDraftsByAge: 过期清理计数 / 边界
//   7. 跨租户隔离: 不同租户/用户互不可见
//   8. LocalStorage 不可用降级: 隐私模式 / 超配额不抛错
//   9. subscribeDrafts: 跨标签 storage 事件触发回调
//
// Mock 策略:
//   - localStorage 由 jsdom 提供,每个用例前 clear 防止交叉污染
//   - 不 mock 源码本身,测试真实逻辑 (含 LocalStorage 读写)
// ============================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createDraft,
  listDrafts,
  getDraft,
  updateDraft,
  deleteDraft,
  deleteDraftsByAge,
  subscribeDrafts,
  DRAFT_CONSTANTS,
  type CreateDraftInput,
  type DraftChange,
} from '../draft-service';

const { KEY_PREFIX, INDEX_KEY } = DRAFT_CONSTANTS;

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';
const USER_1 = 'user-1';
const USER_2 = 'user-2';

/** 构造最小合法创建输入 */
function makeInput(overrides: Partial<CreateDraftInput> = {}): CreateDraftInput {
  return {
    tenantId: TENANT_A,
    userId: USER_1,
    title: '测试作品',
    artworkType: 'painting',
    ...overrides,
  };
}

/** 直接写一条草稿到 LocalStorage (绕过 createDraft,用于构造历史数据) */
function seedDraft(draft: {
  id: string;
  tenantId: string;
  userId: string;
  artworkType?: string;
  title?: string;
  status?: 'draft' | 'analyzing';
  createdAt?: number;
  updatedAt?: number;
}): void {
  const now = Date.now();
  const full = {
    id: draft.id,
    tenantId: draft.tenantId,
    userId: draft.userId,
    title: draft.title ?? 'seed',
    artworkType: draft.artworkType ?? 'painting',
    status: draft.status ?? 'draft',
    createdAt: draft.createdAt ?? now,
    updatedAt: draft.updatedAt ?? now,
  };
  localStorage.setItem(KEY_PREFIX + draft.id, JSON.stringify(full));
  // 追加到索引
  const idxRaw = localStorage.getItem(INDEX_KEY);
  const idx: string[] = idxRaw ? JSON.parse(idxRaw) : [];
  if (!idx.includes(draft.id)) idx.push(draft.id);
  localStorage.setItem(INDEX_KEY, JSON.stringify(idx));
}

describe('draft-service', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  /* ============================================================
   * 1. createDraft
   * ============================================================ */
  describe('createDraft', () => {
    it('应创建草稿并生成 id/时间戳/status 默认值', () => {
      const before = Date.now();
      const draft = createDraft(makeInput());
      const after = Date.now();

      expect(draft).not.toBeNull();
      expect(draft!.id).toMatch(/^[\da-f-]{36}$/i); // uuid v4 形态
      expect(draft!.tenantId).toBe(TENANT_A);
      expect(draft!.userId).toBe(USER_1);
      expect(draft!.artworkType).toBe('painting');
      expect(draft!.status).toBe('draft'); // 默认 draft
      expect(draft!.createdAt).toBeGreaterThanOrEqual(before);
      expect(draft!.createdAt).toBeLessThanOrEqual(after);
      expect(draft!.updatedAt).toBe(draft!.createdAt);
    });

    it('空标题应回退为 "未命名作品_<时间戳>"', () => {
      const draft = createDraft(makeInput({ title: '' }));
      expect(draft!.title).toMatch(/^未命名作品_\d+$/);
    });

    it('应在 LocalStorage 写入草稿本体与索引', () => {
      const draft = createDraft(makeInput());
      const raw = localStorage.getItem(KEY_PREFIX + draft!.id);
      expect(raw).not.toBeNull();
      const parsed = JSON.parse(raw!);
      expect(parsed.id).toBe(draft!.id);

      const idxRaw = localStorage.getItem(INDEX_KEY);
      expect(idxRaw).not.toBeNull();
      const idx = JSON.parse(idxRaw!);
      expect(idx).toContain(draft!.id);
    });

    it('可选字段应正确持久化 (styleCategory/notes/imagePreview)', () => {
      const draft = createDraft(
        makeInput({
          styleCategory: 'ink',
          notes: '草稿备注',
          imagePreview: 'data:image/jpeg;base64,xxx',
        })
      );
      expect(draft!.styleCategory).toBe('ink');
      expect(draft!.notes).toBe('草稿备注');
      expect(draft!.imagePreview).toBe('data:image/jpeg;base64,xxx');
    });
  });

  /* ============================================================
   * 2. listDrafts
   * ============================================================ */
  describe('listDrafts', () => {
    it('无数据时返回空数组', () => {
      expect(listDrafts(TENANT_A, USER_1)).toEqual([]);
    });

    it('应按 updatedAt 倒序排列', () => {
      const old = createDraft(makeInput({ title: 'old' }));
      // 手动把 old 的 updatedAt 调到更早
      updateDraft(old!.id, { notes: 'touched' });
      // 重新写入 old 为更早时间
      const oldRaw = JSON.parse(localStorage.getItem(KEY_PREFIX + old!.id)!);
      oldRaw.updatedAt = Date.now() - 10000;
      localStorage.setItem(KEY_PREFIX + old!.id, JSON.stringify(oldRaw));

      const mid = createDraft(makeInput({ title: 'mid' }));
      const midRaw = JSON.parse(localStorage.getItem(KEY_PREFIX + mid!.id)!);
      midRaw.updatedAt = Date.now() - 5000;
      localStorage.setItem(KEY_PREFIX + mid!.id, JSON.stringify(midRaw));

      const latest = createDraft(makeInput({ title: 'latest' }));
      expect(latest).not.toBeNull();

      const list = listDrafts(TENANT_A, USER_1);
      expect(list.map((d) => d.title)).toEqual(['latest', 'mid', 'old']);
    });

    it('应过滤掉不属于当前 tenantId+userId 的草稿', () => {
      createDraft(makeInput({ tenantId: TENANT_A, userId: USER_1, title: 'mine' }));
      createDraft(makeInput({ tenantId: TENANT_A, userId: USER_2, title: 'other-user' }));
      createDraft(makeInput({ tenantId: TENANT_B, userId: USER_1, title: 'other-tenant' }));

      expect(listDrafts(TENANT_A, USER_1).map((d) => d.title)).toEqual(['mine']);
      expect(listDrafts(TENANT_A, USER_2).map((d) => d.title)).toEqual(['other-user']);
      expect(listDrafts(TENANT_B, USER_1).map((d) => d.title)).toEqual(['other-tenant']);
    });

    it('索引中失效的 id 应被自愈清除 (草稿本体已被外部删除)', () => {
      seedDraft({ id: 'valid-1', tenantId: TENANT_A, userId: USER_1 });
      seedDraft({ id: 'gone-1', tenantId: TENANT_A, userId: USER_1 });
      // 删除 gone-1 本体但保留索引引用
      localStorage.removeItem(KEY_PREFIX + 'gone-1');

      const list = listDrafts(TENANT_A, USER_1);
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe('valid-1');

      // 索引应已修复,移除失效 id
      const idx = JSON.parse(localStorage.getItem(INDEX_KEY)!);
      expect(idx).toEqual(['valid-1']);
    });

    it('应自动清理 7 天前的过期草稿', () => {
      const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
      seedDraft({
        id: 'expired',
        tenantId: TENANT_A,
        userId: USER_1,
        updatedAt: eightDaysAgo,
      });
      seedDraft({ id: 'fresh', tenantId: TENANT_A, userId: USER_1 });

      const list = listDrafts(TENANT_A, USER_1);
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe('fresh');
      // 过期草稿本体应被删除
      expect(localStorage.getItem(KEY_PREFIX + 'expired')).toBeNull();
    });

    it('损坏的索引数据应返回空数组', () => {
      localStorage.setItem(INDEX_KEY, 'not-json{');
      expect(listDrafts(TENANT_A, USER_1)).toEqual([]);
    });

    it('非数组索引应返回空数组', () => {
      localStorage.setItem(INDEX_KEY, JSON.stringify({ foo: 'bar' }));
      expect(listDrafts(TENANT_A, USER_1)).toEqual([]);
    });
  });

  /* ============================================================
   * 3. getDraft
   * ============================================================ */
  describe('getDraft', () => {
    it('应能按 id 获取已存在的草稿', () => {
      const created = createDraft(makeInput({ title: 'find-me' }));
      const got = getDraft(created!.id);
      expect(got).not.toBeNull();
      expect(got!.title).toBe('find-me');
    });

    it('不存在的 id 应返回 null', () => {
      expect(getDraft('non-existent-id')).toBeNull();
    });

    it('损坏的草稿 JSON 应返回 null', () => {
      localStorage.setItem(KEY_PREFIX + 'broken', '{bad json');
      expect(getDraft('broken')).toBeNull();
    });

    it('字段缺失的草稿应返回 null (类型守卫拦截)', () => {
      localStorage.setItem(KEY_PREFIX + 'incomplete', JSON.stringify({ id: 'incomplete' }));
      expect(getDraft('incomplete')).toBeNull();
    });
  });

  /* ============================================================
   * 4. updateDraft
   * ============================================================ */
  describe('updateDraft', () => {
    it('应更新部分字段并刷新 updatedAt', () => {
      const created = createDraft(makeInput({ title: 'old-title' }));
      const beforeUpdate = created!.updatedAt;
      // 确保时间戳前进 (Date.now 精度)
      const fakeNow = beforeUpdate + 100;
      vi.spyOn(Date, 'now').mockReturnValue(fakeNow);

      const updated = updateDraft(created!.id, { title: 'new-title', notes: 'added' });
      expect(updated).not.toBeNull();
      expect(updated!.title).toBe('new-title');
      expect(updated!.notes).toBe('added');
      expect(updated!.updatedAt).toBe(fakeNow);
      expect(updated!.createdAt).toBe(created!.createdAt); // createdAt 不变
    });

    it('不应通过 patch 修改 id 与 createdAt', () => {
      const created = createDraft(makeInput());
      const fakeId = 'hijacked-id';
      const fakeCreatedAt = 1;
      const updated = updateDraft(created!.id, {
        id: fakeId,
        createdAt: fakeCreatedAt,
        notes: 'x',
      } as Partial<typeof created>);
      // id/createdAt 保持原值
      expect(updated!.id).toBe(created!.id);
      expect(updated!.createdAt).toBe(created!.createdAt);
      // LocalStorage 中不应出现 hijacked-id
      expect(localStorage.getItem(KEY_PREFIX + fakeId)).toBeNull();
    });

    it('不存在的 id 应返回 null', () => {
      expect(updateDraft('nope', { title: 'x' })).toBeNull();
    });

    it('status 可在 draft/analyzing 间切换', () => {
      const created = createDraft(makeInput());
      const analyzing = updateDraft(created!.id, { status: 'analyzing' });
      expect(analyzing!.status).toBe('analyzing');
      const backToDraft = updateDraft(created!.id, { status: 'draft' });
      expect(backToDraft!.status).toBe('draft');
    });
  });

  /* ============================================================
   * 5. deleteDraft
   * ============================================================ */
  describe('deleteDraft', () => {
    it('应删除草稿本体与索引引用', () => {
      const created = createDraft(makeInput());
      const ok = deleteDraft(created!.id);
      expect(ok).toBe(true);
      expect(localStorage.getItem(KEY_PREFIX + created!.id)).toBeNull();
      const idx = JSON.parse(localStorage.getItem(INDEX_KEY)!);
      expect(idx).not.toContain(created!.id);
    });

    it('删除不存在的 id 应返回 true (幂等)', () => {
      expect(deleteDraft('never-existed')).toBe(true);
    });

    it('删除后 listDrafts 不应再返回该草稿', () => {
      const a = createDraft(makeInput({ title: 'keep' }));
      const b = createDraft(makeInput({ title: 'delete' }));
      deleteDraft(b!.id);
      const list = listDrafts(TENANT_A, USER_1).map((d) => d.title);
      expect(list).toEqual(['keep']);
      expect(getDraft(a!.id)).not.toBeNull();
    });
  });

  /* ============================================================
   * 6. deleteDraftsByAge
   * ============================================================ */
  describe('deleteDraftsByAge', () => {
    it('应删除超过阈值的草稿并返回数量', () => {
      seedDraft({ id: 'old', tenantId: TENANT_A, userId: USER_1, updatedAt: Date.now() - 2000 });
      seedDraft({ id: 'new', tenantId: TENANT_A, userId: USER_1, updatedAt: Date.now() });
      const removed = deleteDraftsByAge(1000);
      expect(removed).toBe(1);
      expect(localStorage.getItem(KEY_PREFIX + 'old')).toBeNull();
      expect(localStorage.getItem(KEY_PREFIX + 'new')).not.toBeNull();
    });

    it('清理应同步更新索引', () => {
      seedDraft({ id: 'old', tenantId: TENANT_A, userId: USER_1, updatedAt: Date.now() - 2000 });
      seedDraft({ id: 'new', tenantId: TENANT_A, userId: USER_1, updatedAt: Date.now() });
      deleteDraftsByAge(1000);
      const idx = JSON.parse(localStorage.getItem(INDEX_KEY)!);
      expect(idx).toEqual(['new']);
    });

    it('无过期草稿时返回 0 且不写索引', () => {
      seedDraft({ id: 'fresh', tenantId: TENANT_A, userId: USER_1 });
      const removed = deleteDraftsByAge(60 * 1000);
      expect(removed).toBe(0);
    });

    it('索引中失效的 id 也应被计入清理', () => {
      seedDraft({ id: 'gone', tenantId: TENANT_A, userId: USER_1 });
      localStorage.removeItem(KEY_PREFIX + 'gone'); // 本体丢失但索引保留
      const removed = deleteDraftsByAge(60 * 1000);
      expect(removed).toBe(1);
      const idx = JSON.parse(localStorage.getItem(INDEX_KEY)!);
      expect(idx).not.toContain('gone');
    });

    it('边界:恰好等于阈值不应删除 (用 > 而非 >=)', () => {
      const exactly = Date.now() - 1000;
      seedDraft({ id: 'edge', tenantId: TENANT_A, userId: USER_1, updatedAt: exactly });
      vi.spyOn(Date, 'now').mockReturnValue(exactly + 1000);
      const removed = deleteDraftsByAge(1000);
      expect(removed).toBe(0); // now - updatedAt = 1000, 不 > 1000
    });
  });

  /* ============================================================
   * 7. 跨租户隔离 (端到端)
   * ============================================================ */
  describe('跨租户/用户隔离', () => {
    it('租户 A 用户 1 的草稿对租户 B 不可见', () => {
      createDraft(makeInput({ tenantId: TENANT_A, userId: USER_1, title: 'private-a' }));
      expect(listDrafts(TENANT_B, USER_1)).toEqual([]);
    });

    it('同一租户不同用户互不可见', () => {
      createDraft(makeInput({ tenantId: TENANT_A, userId: USER_1, title: 'u1' }));
      createDraft(makeInput({ tenantId: TENANT_A, userId: USER_2, title: 'u2' }));
      expect(listDrafts(TENANT_A, USER_1).map((d) => d.title)).toEqual(['u1']);
      expect(listDrafts(TENANT_A, USER_2).map((d) => d.title)).toEqual(['u2']);
    });

    it('getDraft 不做隔离 (按 id 直查,跨租户可读)', () => {
      // getDraft 是低层 API,隔离由 listDrafts 保证;这里验证行为符合设计
      const created = createDraft(makeInput({ tenantId: TENANT_A, userId: USER_1 }));
      expect(getDraft(created!.id)).not.toBeNull();
    });
  });

  /* ============================================================
   * 8. LocalStorage 不可用降级 (隐私模式 / 超配额)
   * ============================================================ */
  describe('LocalStorage 不可用降级', () => {
    function breakLocalStorage() {
      const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('QuotaExceededError');
      });
      return spy;
    }

    it('createDraft 在 setItem 抛错时返回 null 且不抛错', () => {
      breakLocalStorage();
      expect(() => createDraft(makeInput())).not.toThrow();
      expect(createDraft(makeInput())).toBeNull();
    });

    it('listDrafts 在 getItem 抛错时返回空数组且不抛错', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('security');
      });
      expect(() => listDrafts(TENANT_A, USER_1)).not.toThrow();
      expect(listDrafts(TENANT_A, USER_1)).toEqual([]);
    });

    it('updateDraft 在写入失败时返回 null 且不抛错', () => {
      const created = createDraft(makeInput());
      breakLocalStorage(); // 创建后破坏写入
      expect(() => updateDraft(created!.id, { title: 'x' })).not.toThrow();
      expect(updateDraft(created!.id, { title: 'x' })).toBeNull();
    });

    it('deleteDraft 在 removeItem 抛错时不抛错 (返回 true)', () => {
      const created = createDraft(makeInput());
      vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
        throw new Error('denied');
      });
      expect(() => deleteDraft(created!.id)).not.toThrow();
      expect(deleteDraft(created!.id)).toBe(true);
    });
  });

  /* ============================================================
   * 9. subscribeDrafts (跨标签 storage 事件,增量通知)
   * ============================================================ */
  describe('subscribeDrafts', () => {
    it('新建草稿(oldValue=null)应触发 add 增量通知', () => {
      const cb = vi.fn<(change: DraftChange) => void>();
      const unsub = subscribeDrafts(cb);
      // oldValue 未传(默认 null)→ add
      window.dispatchEvent(
        new StorageEvent('storage', { key: KEY_PREFIX + 'abc', newValue: '{}' })
      );
      expect(cb).toHaveBeenCalledTimes(1);
      expect(cb).toHaveBeenCalledWith({ type: 'add', id: 'abc' });
      unsub();
    });

    it('更新草稿(oldValue 和 newValue 均非 null)应触发 update 增量通知', () => {
      const cb = vi.fn<(change: DraftChange) => void>();
      const unsub = subscribeDrafts(cb);
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: KEY_PREFIX + 'xyz',
          oldValue: '{"old":true}',
          newValue: '{"new":true}',
        })
      );
      expect(cb).toHaveBeenCalledWith({ type: 'update', id: 'xyz' });
      unsub();
    });

    it('删除草稿(newValue=null)应触发 delete 增量通知', () => {
      const cb = vi.fn<(change: DraftChange) => void>();
      const unsub = subscribeDrafts(cb);
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: KEY_PREFIX + 'gone',
          oldValue: '{}',
          newValue: null,
        })
      );
      expect(cb).toHaveBeenCalledWith({ type: 'delete', id: 'gone' });
      unsub();
    });

    it('索引 key 变更不应触发回调(与草稿 key 事件冗余)', () => {
      const cb = vi.fn();
      const unsub = subscribeDrafts(cb);
      window.dispatchEvent(
        new StorageEvent('storage', { key: INDEX_KEY, newValue: '["abc"]' })
      );
      expect(cb).not.toHaveBeenCalled();
      unsub();
    });

    it('不相关的 key 变更不应触发回调', () => {
      const cb = vi.fn();
      const unsub = subscribeDrafts(cb);
      window.dispatchEvent(
        new StorageEvent('storage', { key: 'unrelated-key', newValue: 'x' })
      );
      expect(cb).not.toHaveBeenCalled();
      unsub();
    });

    it('key=null (clear 全清) 不应触发回调 (上层重新拉取空列表)', () => {
      const cb = vi.fn();
      const unsub = subscribeDrafts(cb);
      window.dispatchEvent(new StorageEvent('storage', { key: null, newValue: null }));
      expect(cb).not.toHaveBeenCalled();
      unsub();
    });

    it('取消订阅后不应再收到回调', () => {
      const cb = vi.fn();
      const unsub = subscribeDrafts(cb);
      unsub();
      window.dispatchEvent(
        new StorageEvent('storage', { key: KEY_PREFIX + 'abc', newValue: '{}' })
      );
      expect(cb).not.toHaveBeenCalled();
    });
  });

  /* ============================================================
   * 10. LocalStorage 配额检测与 LRU 淘汰
   * ============================================================ */
  describe('配额检测与 LRU 淘汰', () => {
    it('配额未超阈值时不触发 LRU 淘汰', () => {
      const d1 = createDraft(makeInput({ title: 'keep-1' }));
      const d2 = createDraft(makeInput({ title: 'keep-2' }));
      expect(d1).not.toBeNull();
      expect(d2).not.toBeNull();
      // 正常写入不会触发淘汰(占用远低于 80% 高水位)
      expect(getDraft(d1!.id)).not.toBeNull();
      expect(getDraft(d2!.id)).not.toBeNull();
    });

    it('写入超 80% 高水位时 LRU 淘汰最旧草稿', () => {
      // 通过大 imagePreview 模拟高占用
      const bigPreview = 'data:image/jpeg;base64,' + 'A'.repeat(200_000); // ~200KB
      // 预置 20 条大草稿(总占用 ~4MB,接近高水位)
      for (let i = 0; i < 20; i++) {
        seedDraft({
          id: `old-${i}`,
          tenantId: TENANT_A,
          userId: USER_1,
          title: `old-${i}`,
          updatedAt: Date.now() - (20 - i) * 1000, // 越早越旧
        });
        // 手动写入大 imagePreview
        const raw = JSON.parse(localStorage.getItem(KEY_PREFIX + `old-${i}`)!);
        raw.imagePreview = bigPreview;
        localStorage.setItem(KEY_PREFIX + `old-${i}`, JSON.stringify(raw));
      }
      // 再创建一条新草稿,预估超 80% → 触发 LRU 淘汰至 60%
      const newDraft = createDraft(
        makeInput({ title: 'new', imagePreview: bigPreview })
      );
      expect(newDraft).not.toBeNull();
      // 最旧的几条应被淘汰(old-0, old-1, ...)
      const idx = JSON.parse(localStorage.getItem(INDEX_KEY)!);
      expect(idx).toContain(newDraft!.id);
      // 至少淘汰了部分旧草稿
      const remaining = idx.filter((id: string) => id.startsWith('old-'));
      expect(remaining.length).toBeLessThan(20);
    });

    it('LRU 淘汰不删除正在写入的草稿(excludeId)', () => {
      const bigPreview = 'data:image/jpeg;base64,' + 'B'.repeat(200_000);
      // 预置大占用草稿
      for (let i = 0; i < 20; i++) {
        seedDraft({
          id: `pre-${i}`,
          tenantId: TENANT_A,
          userId: USER_1,
          updatedAt: Date.now() - i * 1000,
        });
        const raw = JSON.parse(localStorage.getItem(KEY_PREFIX + `pre-${i}`)!);
        raw.imagePreview = bigPreview;
        localStorage.setItem(KEY_PREFIX + `pre-${i}`, JSON.stringify(raw));
      }
      // updateDraft 一个已存在的大草稿 → 不应淘汰它自身
      const target = 'pre-10';
      const updated = updateDraft(target, { title: 'updated' });
      expect(updated).not.toBeNull();
      expect(getDraft(target)).not.toBeNull();
    });

    it('写入失败时紧急 LRU 淘汰后重试', () => {
      // 先预置草稿供 LRU 淘汰(在 mock 应用前,seedDraft 的 setItem 正常执行)
      seedDraft({ id: 'victim', tenantId: TENANT_A, userId: USER_1, updatedAt: Date.now() - 99999 });
      // 模拟首次 setItem 抛 QuotaExceededError,重试时成功
      let callCount = 0;
      const origSetItem = Storage.prototype.setItem;
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
        this: Storage,
        key: string,
        value: string,
      ) {
        callCount++;
        // 对草稿 key 的写入:首次抛错,第二次成功
        if (key.startsWith(KEY_PREFIX) && callCount === 1) {
          throw new DOMException('QuotaExceededError');
        }
        origSetItem.call(this, key, value);
      });
      const result = createDraft(makeInput({ title: 'retry-success' }));
      expect(result).not.toBeNull();
    });

    it('配额极小/隐私模式时 LRU 淘汰后仍失败返回 null', () => {
      // setItem 始终抛错(模拟隐私模式)
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('QuotaExceededError');
      });
      const result = createDraft(makeInput());
      expect(result).toBeNull();
    });
  });
});
