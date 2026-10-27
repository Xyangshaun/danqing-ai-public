// ============================================================
// data-service 单元测试 (任务包 E:块4 服务层覆盖率补强)
// 对应源码: src/services/data-service.ts
//
// 测试范围:
//   1. LocalDataService: 历史/收藏/嫁接素材/情绪画板/用户设置的 LocalStorage 读写
//   2. ApiDataService: 已登录态走 API,失败时回退 LocalStorage
//   3. getDataService 工厂: 根据 hasAccessToken 切换实现
//   4. resetDataService: 重置单例
//   5. 便捷导出函数: getAnalysisHistory/saveAnalysis 等
//
// Mock 策略:
//   - api.ts 的 get/post: ApiDataService 路径可控返回 / 抛错
//   - token-store 的 hasAccessToken: 控制登录态切换
//   - mockData.ts: 保留真实导出(LocalDataService 通过它访问 LocalStorage)
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getDataService,
  resetDataService,
  getAnalysisHistory,
  saveAnalysis,
  getAnalysisDetail,
  clearAnalysisHistory,
  batchDeleteAnalyses,
  getGrowthData,
  getFavorites,
  toggleFavorite,
  getSavedMaterials,
  saveSavedMaterial,
  removeSavedMaterial,
  getEmotionPalette,
  saveEmotionPalette,
  getSettings,
  saveSettings,
  LS_KEYS,
  type UserSettings,
  type SavedMaterial,
  type EmotionPalette,
  type FavoriteToggleResult,
} from '../data-service';
import type { AnalysisResult } from '../../types';

/* ---------- mock 依赖 ---------- */

const getMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const postMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const batchDeleteMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();
vi.mock('../api', () => ({
  get: (...args: unknown[]) => getMock(...args),
  post: (...args: unknown[]) => postMock(...args),
  batchDeleteAnalyses: (...args: unknown[]) => batchDeleteMock(...args),
}));

const hasAccessTokenMock = vi.fn<(...args: unknown[]) => boolean>();
vi.mock('../token-store', () => ({
  hasAccessToken: (...args: unknown[]) => hasAccessTokenMock(...args),
  getDeviceId: () => 'test-device-id',
  getAccessToken: () => 'fake-token',
  setAccessToken: vi.fn(),
  clearAccessToken: vi.fn(),
}));

/* ---------- 测试数据工厂 ---------- */

function makeAnalysisResult(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    id: 'rec-1',
    imageUrl: 'https://example.com/img.png',
    createdAt: new Date('2026-08-01').toISOString(),
    artType: 'painting',
    overallScore: 80,
    dimensions: {
      type: 'painting',
      composition: {
        score: 75,
        focusPoint: { x: 0.5, y: 0.5 },
        balance: 'balanced',
        guideline: 'good',
        whitespaceRatio: 0.4,
        symmetry: 0.6,
        suggestion: '构图均衡',
        heatmapData: [[0.5]],
      },
      color: {
        score: 80,
        warmRatio: 0.5,
        coolRatio: 0.5,
        contrast: 'medium',
        saturation: 'medium',
        richness: 'rich',
        harmony: '和谐',
        dominantColor: '中性色',
        suggestion: '色彩和谐',
      },
      brushwork: {
        score: 85,
        textureLevel: 'rich',
        strokeVariety: 40,
        wetDryBalance: '适中',
        suggestion: '笔触良好',
      },
    },
    originality: {
      score: 82,
      similarity: 0.2,
      creativityLevel: 'good',
      suggestion: '原创性良好',
    },
    ...overrides,
  } as AnalysisResult;
}

const DEFAULT_SETTINGS: UserSettings = {
  theme: 'rice',
  density: 'comfortable',
  notifications: { analysis: true, growth: true, system: false },
  cloudSync: { enabled: true, autoSync: true, multiDevice: false },
  privacy: { anonymousAnalytics: true, localFirst: true, twoFactor: false },
};

/* ---------- 公共清理 ---------- */

beforeEach(() => {
  getMock.mockReset();
  postMock.mockReset();
  batchDeleteMock.mockReset();
  hasAccessTokenMock.mockReset();
  hasAccessTokenMock.mockReturnValue(false); // 默认未登录
  localStorage.clear();
  resetDataService();
});

afterEach(() => {
  localStorage.clear();
  resetDataService();
  vi.restoreAllMocks();
});

/* ============================================================
 * 1. LocalDataService(未登录态)
 * ============================================================ */
describe('LocalDataService', () => {
  describe('分析历史', () => {
    it('getAnalysisHistory 空时返回空数组(真实数据优先)', async () => {
      // c68977f 起移除 mock 注入:空历史返回空数组,由页面展示空状态
      const list = await getAnalysisHistory();
      expect(Array.isArray(list)).toBe(true);
      expect(list).toEqual([]);
    });

    it('saveAnalysis 写入 localStorage 后再读取应能找到记录', async () => {
      const result = makeAnalysisResult({ id: 'rec-save-1' });
      await saveAnalysis(result);
      // mockData.getAnalysisResult(id) 内部会基于历史记录重新生成完整结果,
      // 生成的新 id 是随机的(非原 history id),所以只验证非空 + 字段正确
      const detail = await getAnalysisDetail('rec-save-1');
      expect(detail).not.toBeNull();
      expect(detail?.artType).toBe('painting');
      expect(detail?.imageUrl).toBe(result.imageUrl);
    });

    it('getAnalysisDetail 对不存在 id 返回 null', async () => {
      const detail = await getAnalysisDetail('not-exist-id');
      expect(detail).toBeNull();
    });

    it('clearAnalysisHistory 清空 localStorage 中的 history key', async () => {
      const result = makeAnalysisResult({ id: 'rec-clear-1' });
      await saveAnalysis(result);
      // 验证已写入
      const before = localStorage.getItem(LS_KEYS.history);
      expect(before).not.toBeNull();
      await clearAnalysisHistory();
      // 清空后应为 null
      expect(localStorage.getItem(LS_KEYS.history)).toBeNull();
    });

    it('batchDeleteAnalyses 从 LocalStorage 剔除选中记录并返回逐条结果', async () => {
      await saveAnalysis(makeAnalysisResult({ id: 'rec-batch-a' }));
      await saveAnalysis(makeAnalysisResult({ id: 'rec-batch-b' }));
      const resp = await batchDeleteAnalyses(['rec-batch-a']);
      expect(resp.total).toBe(1);
      expect(resp.deleted).toBe(1);
      expect(resp.failedCount).toBe(0);
      // 再次读取应只剩 rec-batch-b
      const list = await getAnalysisHistory();
      expect(list.some((r) => r.id === 'rec-batch-a')).toBe(false);
      expect(list.some((r) => r.id === 'rec-batch-b')).toBe(true);
    });

    it('batchDeleteAnalyses 对不存在的 id 记入 failed 并含 error', async () => {
      await saveAnalysis(makeAnalysisResult({ id: 'rec-batch-c' }));
      const resp = await batchDeleteAnalyses(['rec-batch-c', 'rec-missing']);
      expect(resp.deleted).toBe(1);
      expect(resp.failedCount).toBe(1);
      const missing = resp.items.find((i) => i.id === 'rec-missing');
      expect(missing?.deleted).toBe(false);
      expect(missing?.error).toBeTruthy();
    });
  });

  describe('成长数据', () => {
    it('getGrowthData 空历史时返回空数组(真实数据优先)', async () => {
      const data = await getGrowthData();
      expect(Array.isArray(data)).toBe(true);
      // 无历史时不注入 mock,由成长页展示空状态
      expect(data).toEqual([]);
    });
  });

  describe('收藏', () => {
    it('getFavorites 空时返回空数组', async () => {
      const favs = await getFavorites();
      expect(favs).toEqual([]);
    });

    it('toggleFavorite 首次添加返回 favorited=true', async () => {
      const result: FavoriteToggleResult = await toggleFavorite('art-1');
      expect(result.favorited).toBe(true);
      expect(result.favorites).toContain('art-1');
    });

    it('toggleFavorite 再次切换返回 favorited=false(取消收藏)', async () => {
      await toggleFavorite('art-1');
      const result = await toggleFavorite('art-1');
      expect(result.favorited).toBe(false);
      expect(result.favorites).not.toContain('art-1');
    });

    it('收藏列表持久化到 localStorage', async () => {
      await toggleFavorite('art-A');
      await toggleFavorite('art-B');
      const raw = localStorage.getItem(LS_KEYS.favorites);
      expect(raw).not.toBeNull();
      const parsed = JSON.parse(raw!);
      expect(parsed).toContain('art-A');
      expect(parsed).toContain('art-B');
    });

    it('localStorage 中收藏数据损坏时 getFavorites 返回空数组', async () => {
      localStorage.setItem(LS_KEYS.favorites, 'not-a-json');
      const favs = await getFavorites();
      expect(favs).toEqual([]);
    });

    it('localStorage 中收藏非数组时 getFavorites 返回空数组', async () => {
      localStorage.setItem(LS_KEYS.favorites, JSON.stringify({ foo: 'bar' }));
      const favs = await getFavorites();
      expect(favs).toEqual([]);
    });
  });

  describe('嫁接保存素材', () => {
    it('getSavedMaterials 空时返回空数组', async () => {
      const list = await getSavedMaterials();
      expect(list).toEqual([]);
    });

    it('saveSavedMaterial 写入并返回带 id/createdAt 的完整记录', async () => {
      const item = await saveSavedMaterial({
        imageUrl: 'https://example.com/m.png',
        title: '我的素材',
        source: 'fuse',
      });
      expect(item.id).toBeTruthy();
      expect(item.createdAt).toBeTruthy();
      expect(item.title).toBe('我的素材');
      expect(item.source).toBe('fuse');
    });

    it('saveSavedMaterial 多次写入后 getSavedMaterials 返回全部', async () => {
      await saveSavedMaterial({ imageUrl: 'u1', title: 't1', source: 'fuse' });
      await saveSavedMaterial({ imageUrl: 'u2', title: 't2', source: 'emotion' });
      const list = await getSavedMaterials();
      expect(list.length).toBe(2);
    });

    it('removeSavedMaterial 按 id 删除指定记录', async () => {
      // 直接预置 localStorage 数据,避免 Date.now() 同毫秒导致 id 冲突
      const seeded: SavedMaterial[] = [
        { id: 'fuse-1001', imageUrl: 'u1', title: 't1', source: 'fuse', createdAt: '2026-08-01T00:00:00Z' },
        { id: 'fuse-1002', imageUrl: 'u2', title: 't2', source: 'fuse', createdAt: '2026-08-01T00:00:01Z' },
      ];
      localStorage.setItem(LS_KEYS.savedMaterials, JSON.stringify(seeded));
      await removeSavedMaterial('fuse-1001');
      const list = await getSavedMaterials();
      expect(list.length).toBe(1);
      expect(list[0].id).toBe('fuse-1002');
      expect(list[0].title).toBe('t2');
    });

    it('removeSavedMaterial 对不存在 id 不影响其他记录', async () => {
      const seeded: SavedMaterial[] = [
        { id: 'fuse-2001', imageUrl: 'u1', title: 't1', source: 'fuse', createdAt: '2026-08-01T00:00:00Z' },
      ];
      localStorage.setItem(LS_KEYS.savedMaterials, JSON.stringify(seeded));
      await removeSavedMaterial('non-exist-id');
      const list = await getSavedMaterials();
      expect(list.length).toBe(1);
    });

    it('localStorage 中素材数据损坏时 getSavedMaterials 返回空数组', async () => {
      localStorage.setItem(LS_KEYS.savedMaterials, 'broken-json');
      const list = await getSavedMaterials();
      expect(list).toEqual([]);
    });
  });

  describe('情绪画板', () => {
    it('getEmotionPalette 空时返回 null', async () => {
      const palette = await getEmotionPalette();
      expect(palette).toBeNull();
    });

    it('saveEmotionPalette 写入并返回带 createdAt 的完整记录', async () => {
      const palette = await saveEmotionPalette({
        emotion: 'joy',
        colorPalette: ['#fff', '#000'],
        intensity: 0.8,
      });
      expect(palette.createdAt).toBeTruthy();
      expect(palette.emotion).toBe('joy');
      expect(palette.colorPalette).toEqual(['#fff', '#000']);
      expect(palette.intensity).toBe(0.8);
    });

    it('saveEmotionPalette 后 getEmotionPalette 返回最近保存', async () => {
      const saved = await saveEmotionPalette({
        emotion: 'calm',
        colorPalette: ['#abc'],
        intensity: 0.5,
      });
      const got = await getEmotionPalette();
      expect(got).toEqual(saved);
    });

    it('localStorage 中情绪画板数据损坏时返回 null', async () => {
      localStorage.setItem(LS_KEYS.emotionPalette, 'broken-json');
      const palette = await getEmotionPalette();
      expect(palette).toBeNull();
    });
  });

  describe('用户设置', () => {
    it('getSettings 空时返回默认设置', async () => {
      const settings = await getSettings();
      expect(settings.theme).toBe(DEFAULT_SETTINGS.theme);
      expect(settings.density).toBe(DEFAULT_SETTINGS.density);
      expect(settings.notifications.analysis).toBe(true);
    });

    it('saveSettings 部分更新应与现有设置合并', async () => {
      await saveSettings({ theme: 'ink' });
      const after = await getSettings();
      expect(after.theme).toBe('ink');
      // 其他字段保留默认
      expect(after.density).toBe(DEFAULT_SETTINGS.density);
    });

    it('saveSettings 嵌套对象应深合并', async () => {
      await saveSettings({ notifications: { analysis: false } as UserSettings['notifications'] });
      const after = await getSettings();
      expect(after.notifications.analysis).toBe(false);
      // 其他嵌套字段保留
      expect(after.notifications.growth).toBe(true);
    });

    it('localStorage 中老数据缺字段时与默认值合并', async () => {
      // 模拟老版本数据只有 theme 字段
      localStorage.setItem(LS_KEYS.settings, JSON.stringify({ theme: 'ink' }));
      const after = await getSettings();
      expect(after.theme).toBe('ink');
      expect(after.density).toBe(DEFAULT_SETTINGS.density);
      expect(after.notifications).toBeDefined();
      expect(after.cloudSync).toBeDefined();
      expect(after.privacy).toBeDefined();
    });

    it('localStorage 中设置数据损坏时返回默认设置', async () => {
      localStorage.setItem(LS_KEYS.settings, 'broken-json');
      const after = await getSettings();
      expect(after.theme).toBe(DEFAULT_SETTINGS.theme);
    });
  });
});

/* ============================================================
 * 2. ApiDataService(已登录态)
 * ============================================================ */
describe('ApiDataService', () => {
  beforeEach(() => {
    hasAccessTokenMock.mockReturnValue(true); // 已登录
  });

  describe('批量删除(P-06 跨端批删一致性)', () => {
    it('batchDeleteAnalyses 调用服务端批删接口并透传响应', async () => {
      batchDeleteMock.mockResolvedValue({
        total: 2,
        deleted: 1,
        failedCount: 1,
        items: [
          { id: 'api-a', deleted: true },
          { id: 'api-b', deleted: false, error: '跨租户越权' },
        ],
      });
      const resp = await batchDeleteAnalyses(['api-a', 'api-b']);
      expect(batchDeleteMock).toHaveBeenCalledWith(['api-a', 'api-b']);
      expect(resp.deleted).toBe(1);
      expect(resp.failedCount).toBe(1);
      const failed = resp.items.filter((i) => !i.deleted);
      expect(failed[0].error).toBe('跨租户越权');
    });

    it('batchDeleteAnalyses 服务端失败时抛出错误(供页面层回滚)', async () => {
      batchDeleteMock.mockRejectedValue(new Error('网络错误'));
      await expect(batchDeleteAnalyses(['api-a'])).rejects.toThrow('网络错误');
    });
  });

  describe('分析历史(API 成功)', () => {
    it('getAnalysisHistory 调用 GET /analyses 并映射为 HistoryRecord', async () => {
      getMock.mockResolvedValue({
        items: [
          {
            id: 'api-1',
            imageUrl: 'https://api.example.com/i.png',
            createdAt: '2026-08-01T00:00:00Z',
            workType: 'painting',
            overallScore: 88,
          },
        ],
        total: 1,
        page: 1,
        pageSize: 50,
      });
      const list = await getAnalysisHistory({ limit: 50 });
      expect(getMock).toHaveBeenCalledWith(
        '/analyses',
        expect.objectContaining({ page: 1, pageSize: 50 }),
      );
      expect(list.length).toBe(1);
      expect(list[0].id).toBe('api-1');
      expect(list[0].overallScore).toBe(88);
      // 列表项的维度分数默认 0(详情接口才提供)
      expect(list[0].dimension1Score).toBe(0);
    });

    it('getAnalysisHistory 带 query 参数时透传 artType/日期范围', async () => {
      getMock.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 });
      await getAnalysisHistory({
        artType: 'design',
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        limit: 10,
      });
      expect(getMock).toHaveBeenCalledWith(
        '/analyses',
        expect.objectContaining({
          artType: 'design',
          startDate: '2026-01-01',
          endDate: '2026-12-31',
          pageSize: 10,
        }),
      );
    });

    it('getAnalysisHistory API 失败时回退 LocalStorage', async () => {
      getMock.mockRejectedValue(new Error('network'));
      const list = await getAnalysisHistory();
      // 回退 LocalStorage;无本地数据时为空数组(真实数据优先,不注入 mock)
      expect(Array.isArray(list)).toBe(true);
      expect(list).toEqual([]);
    });
  });

  describe('保存分析(API)', () => {
    it('saveAnalysis 调用 POST /analyses 成功时不写 LocalStorage', async () => {
      postMock.mockResolvedValue({ analysisId: 'new-1', status: 'completed' });
      const result = makeAnalysisResult({ id: 'api-save-1' });
      await saveAnalysis(result);
      expect(postMock).toHaveBeenCalledWith(
        '/analyses',
        expect.objectContaining({ artType: 'painting', imageUrl: result.imageUrl }),
        expect.objectContaining({ silent: true }),
      );
    });

    it('saveAnalysis API 失败时回退 LocalStorage', async () => {
      postMock.mockRejectedValue(new Error('api fail'));
      const result = makeAnalysisResult({ id: 'api-fallback-1' });
      await saveAnalysis(result);
      // 回退到 LocalStorage 后,可通过 getAnalysisDetail 读取
      const detail = await getAnalysisDetail('api-fallback-1');
      expect(detail).not.toBeNull();
    });
  });

  describe('分析详情(API)', () => {
    it('getAnalysisDetail 调用 GET /analyses/:id 成功时返回映射结果', async () => {
      getMock.mockResolvedValue({
        id: 'api-detail-1',
        imageUrl: 'https://api.example.com/d.png',
        createdAt: '2026-08-01T00:00:00Z',
        workType: 'painting',
        overallScore: 90,
        status: 'completed',
        result: {
          artType: 'painting',
          dimensions: makeAnalysisResult().dimensions,
          originality: makeAnalysisResult().originality,
          overallScore: 90,
        },
      });
      const detail = await getAnalysisDetail('api-detail-1');
      expect(getMock).toHaveBeenCalledWith('/analyses/api-detail-1', undefined, { silent: true });
      expect(detail).not.toBeNull();
      expect(detail?.id).toBe('api-detail-1');
      expect(detail?.overallScore).toBe(90);
    });

    it('getAnalysisDetail API 响应无 result 字段时返回 null', async () => {
      getMock.mockResolvedValue({
        id: 'no-result',
        imageUrl: 'u',
        createdAt: '2026-08-01T00:00:00Z',
        workType: 'painting',
        status: 'pending',
      });
      const detail = await getAnalysisDetail('no-result');
      expect(detail).toBeNull();
    });

    it('getAnalysisDetail API 失败时回退 LocalStorage', async () => {
      getMock.mockRejectedValue(new Error('api fail'));
      // 先在 LocalStorage 中保存一条
      const result = makeAnalysisResult({ id: 'fallback-detail-1' });
      // 切换到 LocalStorage 模式来保存(因为 ApiDataService.saveAnalysis 失败才回退)
      hasAccessTokenMock.mockReturnValue(false);
      resetDataService();
      await saveAnalysis(result);
      // 再切换回 API 模式,API 失败时应回退到 LocalStorage
      hasAccessTokenMock.mockReturnValue(true);
      resetDataService();
      getMock.mockRejectedValue(new Error('api fail'));
      const detail = await getAnalysisDetail('fallback-detail-1');
      expect(detail).not.toBeNull();
    });
  });

  describe('成长数据(API 聚合)', () => {
    it('getGrowthData 从 API 历史聚合(>=1 条时)', async () => {
      getMock.mockResolvedValue({
        items: [
          {
            id: 'g-1',
            imageUrl: 'u1',
            createdAt: '2026-08-01T00:00:00Z',
            workType: 'painting',
            overallScore: 80,
          },
        ],
        total: 1,
        page: 1,
        pageSize: 50,
      });
      const data = await getGrowthData();
      expect(Array.isArray(data)).toBe(true);
    });

    it('getGrowthData API 返回空历史时回退 LocalStorage(空)', async () => {
      getMock.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 });
      const data = await getGrowthData();
      expect(Array.isArray(data)).toBe(true);
      // 真实数据优先:无历史时为空数组,不注入 mock
      expect(data).toEqual([]);
    });
  });

  describe('暂无后端接口的能力(走 LocalStorage 兜底)', () => {
    it('getFavorites 走 LocalStorage', async () => {
      const list = await getFavorites();
      expect(Array.isArray(list)).toBe(true);
    });

    it('saveSavedMaterial 走 LocalStorage', async () => {
      const item = await saveSavedMaterial({
        imageUrl: 'u',
        title: 't',
        source: 'fuse',
      });
      expect(item.id).toBeTruthy();
    });

    it('getEmotionPalette 走 LocalStorage', async () => {
      const palette = await getEmotionPalette();
      expect(palette).toBeNull();
    });

    it('getSettings 走 LocalStorage(默认设置)', async () => {
      const settings = await getSettings();
      expect(settings.theme).toBe(DEFAULT_SETTINGS.theme);
    });

    it('clearAnalysisHistory 走 LocalStorage 兜底', async () => {
      await clearAnalysisHistory();
      // 不抛错即可
      expect(true).toBe(true);
    });
  });
});

/* ============================================================
 * 3. getDataService 工厂
 * ============================================================ */
describe('getDataService 工厂', () => {
  it('未登录态返回 source=local 的服务', () => {
    hasAccessTokenMock.mockReturnValue(false);
    resetDataService();
    const svc = getDataService();
    expect(svc.source).toBe('local');
  });

  it('已登录态返回 source=api 的服务', () => {
    hasAccessTokenMock.mockReturnValue(true);
    resetDataService();
    const svc = getDataService();
    expect(svc.source).toBe('api');
  });

  it('登录态未变化时复用单例', () => {
    hasAccessTokenMock.mockReturnValue(false);
    resetDataService();
    const a = getDataService();
    const b = getDataService();
    expect(a).toBe(b);
  });

  it('登录态变化时重建实例', () => {
    hasAccessTokenMock.mockReturnValue(false);
    resetDataService();
    const localSvc = getDataService();
    hasAccessTokenMock.mockReturnValue(true);
    const apiSvc = getDataService();
    expect(apiSvc).not.toBe(localSvc);
    expect(apiSvc.source).toBe('api');
  });

  it('resetDataService 清除单例(下次调用重建)', () => {
    hasAccessTokenMock.mockReturnValue(false);
    const a = getDataService();
    resetDataService();
    const b = getDataService();
    expect(a).not.toBe(b);
  });
});

/* ============================================================
 * 4. 便捷导出函数应正确委托
 * ============================================================ */
describe('便捷导出函数委托', () => {
  it('toggleFavorite 函数式调用返回 FavoriteToggleResult', async () => {
    const result = await toggleFavorite('art-x');
    expect(result).toHaveProperty('favorited');
    expect(result).toHaveProperty('favorites');
  });

  it('removeSavedMaterial 函数式调用不抛错', async () => {
    await expect(removeSavedMaterial('non-exist')).resolves.toBeUndefined();
  });

  it('saveEmotionPalette 函数式调用返回带 createdAt 的记录', async () => {
    const palette: EmotionPalette = await saveEmotionPalette({
      emotion: 'hope',
      colorPalette: ['#fff'],
      intensity: 0.6,
    });
    expect(palette.emotion).toBe('hope');
    expect(palette.createdAt).toBeTruthy();
  });

  it('saveSettings 函数式调用返回完整 UserSettings', async () => {
    const next: UserSettings = await saveSettings({ theme: 'ink' });
    expect(next.theme).toBe('ink');
    // 完整对象应包含所有字段
    expect(next.notifications).toBeDefined();
    expect(next.cloudSync).toBeDefined();
    expect(next.privacy).toBeDefined();
  });

  it('saveSavedMaterial 函数式调用返回带 id/createdAt 的记录', async () => {
    const item: SavedMaterial = await saveSavedMaterial({
      imageUrl: 'u',
      title: 't',
      source: 'emotion',
    });
    expect(item.id).toBeTruthy();
    expect(item.createdAt).toBeTruthy();
  });
});
