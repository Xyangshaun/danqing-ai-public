// ============================================================
// materialService 单元测试 (阶段2D:素材库打包接口与统一调用机制)
// 对应源码: src/services/materialService.ts
//
// 测试范围:
//   1. getMaterialById: 内置库 / 用户保存素材查找
//   2. getPacks / createPack / deletePack / updatePack: 素材包 CRUD
//   3. addToPack / removeFromPack: 素材包成员管理
//   4. resolvePackMaterials: 解析包内容(含失效引用容错)
//   5. LocalStorage 损坏恢复: 读取时过滤脏数据
//
// Mock 策略:
//   - data-service 中的 getSavedMaterials / getFavorites 用 vi.mock 统一 stub
//   - artworksDatabase 用 vi.mock stub(loadBuiltinArtworks 改为 fetch JSON 后,
//     jsdom 环境无法加载真实文件,内置库数据由本 mock 提供)
//   - localStorage 由 jsdom 提供,每个用例后 clean 防止交叉污染
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getMaterialById,
  getPacks,
  createPack,
  deletePack,
  updatePack,
  addToPack,
  removeFromPack,
  resolvePackMaterials,
  type MaterialPack,
} from '../materialService';
import type { ArtworkItem } from '../artworksDatabase';

/* ---------- Mock artworksDatabase 的内置库数据 ---------- */
const builtinFixtures: ArtworkItem[] = [
  {
    id: 'cn-mountain-001',
    title: '溪山行旅图',
    artist: '范宽',
    year: '北宋',
    category: 'painting',
    style: '水墨',
    era: '宋代',
    region: 'china',
    description: '北宋山水代表作',
    imageUrl: 'https://example.com/mountain.png',
    source: 'mock',
    tags: ['山水'],
  },
];

vi.mock('../artworksDatabase', () => ({
  loadBuiltinArtworks: vi.fn(async () => builtinFixtures),
  searchArtworks: vi.fn(() => builtinFixtures),
  resolveArtworkImageUrl: (item: ArtworkItem) => item,
}));

/* ---------- Mock data-service 的异步接口 ---------- */
vi.mock('../data-service', () => ({
  getSavedMaterials: vi.fn(async () => [
    { id: 'saved-001', imageUrl: 'https://example.com/s1.png', title: '我的嫁接作品1', source: 'fuse' as const, createdAt: '2026-07-31T00:00:00Z' },
    { id: 'saved-002', imageUrl: 'https://example.com/s2.png', title: '情绪画布导出', source: 'emotion' as const, createdAt: '2026-07-31T00:00:00Z' },
  ]),
  getFavorites: vi.fn(async () => ['cn-mountain-001']),
}));

const LS_PACKS_KEY = 'danqing-ai-material-packs';

describe('materialService', () => {
  beforeEach(() => {
    localStorage.removeItem(LS_PACKS_KEY);
  });
  afterEach(() => {
    localStorage.removeItem(LS_PACKS_KEY);
    vi.clearAllMocks();
  });

  /* ============================================================
   * 1. 统一素材查找
   * ============================================================ */
  describe('getMaterialById', () => {
    it('应能找到内置艺术作品库中的作品', async () => {
      const result = await getMaterialById('cn-mountain-001');
      expect(result).not.toBeNull();
      expect(result!.title).toBe('溪山行旅图');
      expect(result!.source).toBe('builtin');
    });

    it('应能找到用户保存的素材', async () => {
      const result = await getMaterialById('saved-001');
      expect(result).not.toBeNull();
      expect(result!.title).toBe('我的嫁接作品1');
      expect(result!.source).toBe('saved');
    });

    it('找不到时应返回 null', async () => {
      const result = await getMaterialById('not-exist-id');
      expect(result).toBeNull();
    });
  });

  /* ============================================================
   * 2. 素材包 CRUD
   * ============================================================ */
  describe('createPack', () => {
    it('应能创建素材包并分配 ID', async () => {
      const pack = await createPack({ name: '宋代山水参考' });
      expect(pack.name).toBe('宋代山水参考');
      expect(pack.id).toMatch(/^pack-\d+-/);
      expect(pack.materialIds).toEqual([]);
      expect(pack.createdAt).toBeTruthy();
      expect(pack.updatedAt).toBeTruthy();
    });

    it('空名称应回退为默认名称', async () => {
      const pack = await createPack({ name: '   ' });
      expect(pack.name).toBe('未命名素材包');
    });

    it('支持可选字段:description / artType / materialIds', async () => {
      const pack = await createPack({
        name: '测试包',
        description: '用途说明',
        artType: 'painting',
        materialIds: ['cn-mountain-001'],
      });
      expect(pack.description).toBe('用途说明');
      expect(pack.artType).toBe('painting');
      expect(pack.materialIds).toContain('cn-mountain-001');
    });

    it('新创建的包应出现在列表首位', async () => {
      await createPack({ name: '包A' });
      await createPack({ name: '包B' });
      const list = await getPacks();
      expect(list[0].name).toBe('包B');
      expect(list[1].name).toBe('包A');
    });
  });

  describe('getPacks', () => {
    it('无数据时应返回空数组', async () => {
      const list = await getPacks();
      expect(list).toEqual([]);
    });

    it('应按更新时间倒序排列', async () => {
      const p1 = await createPack({ name: '最早' });
      await new Promise((r) => setTimeout(r, 30));
      const p2 = await createPack({ name: '最新' });
      const list = await getPacks();
      expect(list.map((p) => p.name)).toEqual(['最新', '最早']);
      expect(list[0].id).toBe(p2.id);
      expect(list[1].id).toBe(p1.id);
    });
  });

  describe('deletePack', () => {
    it('应能删除指定素材包', async () => {
      const pack = await createPack({ name: '待删除' });
      await deletePack(pack.id);
      const list = await getPacks();
      expect(list).toHaveLength(0);
    });

    it('删除不存在的 ID 应静默成功', async () => {
      await expect(deletePack('pack-999')).resolves.not.toThrow();
    });
  });

  describe('updatePack', () => {
    it('应能更新名称和描述', async () => {
      const pack = await createPack({ name: '旧名称' });
      await new Promise((r) => setTimeout(r, 10));
      const updated = await updatePack(pack.id, { name: '新名称', description: '新描述' });
      expect(updated).not.toBeNull();
      expect(updated!.name).toBe('新名称');
      expect(updated!.description).toBe('新描述');
      expect(new Date(updated!.updatedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(pack.updatedAt).getTime()
      );
    });

    it('空名称应保持原名称', async () => {
      const pack = await createPack({ name: '保持' });
      const updated = await updatePack(pack.id, { name: '   ' });
      expect(updated!.name).toBe('保持');
    });

    it('不存在的 ID 应返回 null', async () => {
      const result = await updatePack('pack-999', { name: 'x' });
      expect(result).toBeNull();
    });
  });

  /* ============================================================
   * 3. 素材包成员管理
   * ============================================================ */
  describe('addToPack', () => {
    it('应向素材包添加素材 ID', async () => {
      const pack = await createPack({ name: '包' });
      const updated = await addToPack(pack.id, 'cn-mountain-001');
      expect(updated).not.toBeNull();
      expect(updated!.materialIds).toContain('cn-mountain-001');
    });

    it('同一素材 ID 幂等,不重复添加', async () => {
      const pack = await createPack({ name: '包' });
      await addToPack(pack.id, 'a');
      await addToPack(pack.id, 'a');
      const list = await getPacks();
      expect(list[0].materialIds).toEqual(['a']);
    });

    it('不存在的素材包应返回 null', async () => {
      const result = await addToPack('pack-999', 'a');
      expect(result).toBeNull();
    });
  });

  describe('removeFromPack', () => {
    it('应从素材包移除素材 ID', async () => {
      const pack = await createPack({ name: '包', materialIds: ['a', 'b', 'c'] });
      const updated = await removeFromPack(pack.id, 'b');
      expect(updated!.materialIds).toEqual(['a', 'c']);
    });

    it('不存在的 ID 应静默成功', async () => {
      const pack = await createPack({ name: '包' });
      const updated = await removeFromPack(pack.id, 'not-exist');
      expect(updated!.materialIds).toEqual([]);
    });
  });

  describe('resolvePackMaterials', () => {
    it('应将 materialIds 解析为完整素材', async () => {
      const pack: MaterialPack = {
        id: 'pack-test',
        name: '测试',
        materialIds: ['cn-mountain-001', 'saved-001'],
        createdAt: '',
        updatedAt: '',
      };
      const materials = await resolvePackMaterials(pack);
      expect(materials).toHaveLength(2);
      expect(materials[0].id).toBe('cn-mountain-001');
      expect(materials[1].id).toBe('saved-001');
    });

    it('自动跳过已失效的引用', async () => {
      const pack: MaterialPack = {
        id: 'pack-test',
        name: '测试',
        materialIds: ['cn-mountain-001', 'not-exist-id', 'saved-001'],
        createdAt: '',
        updatedAt: '',
      };
      const materials = await resolvePackMaterials(pack);
      expect(materials).toHaveLength(2);
      expect(materials.map((m) => m.id)).not.toContain('not-exist-id');
    });
  });

  /* ============================================================
   * 4. 数据容错
   * ============================================================ */
  describe('LocalStorage 损坏恢复', () => {
    it('脏 localStorage 数据应被过滤,不导致崩溃', async () => {
      localStorage.setItem(LS_PACKS_KEY, JSON.stringify([
        { id: 'valid-1', name: '有效包', materialIds: ['a'], createdAt: '2026-01-01', updatedAt: '2026-01-01' },
        null,
        { id: 'valid-2', name: '有效包2', materialIds: [], createdAt: '2026-01-01', updatedAt: '2026-01-01' },
        'invalid-string',
        { id: 'bad', notName: '缺少 name 字段' },
        { name: '缺少 id', materialIds: [] },
      ]));
      const list = await getPacks();
      expect(list).toHaveLength(2);
      expect(list.map((p) => p.id)).toEqual(['valid-1', 'valid-2']);
    });

    it('非数组 localStorage 应返回空数组', async () => {
      localStorage.setItem(LS_PACKS_KEY, JSON.stringify({ foo: 'bar' }));
      const list = await getPacks();
      expect(list).toEqual([]);
    });
  });
});
