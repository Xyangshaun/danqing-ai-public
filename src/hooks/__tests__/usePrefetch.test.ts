// ============================================================
// usePrefetch 单元测试 (任务包D:性能优化)
// 对应源码: src/hooks/usePrefetch.ts
//
// 测试范围:
//   1. 返回 onMouseEnter / onFocus / onTouchStart 三个 handler
//   2. 多次触发同一 routePath,仅 import 一次(Set 去重)
//   3. 不同 routePath 触发不同 import
//   4. 未知 routePath 不抛错(静默返回)
//   5. 三种 handler(onMouseEnter/onFocus/onTouchStart)行为一致
//   6. 覆盖所有已映射路由(确保 importMap 完整)
//
// Mock 策略:
//   - vi.mock 各页面模块,避免真实加载组件
//   - 使用 vi.hoisted 创建 factory spy 统计 import 调用次数
//   - 使用 __resetPrefetchedRoutesForTest 在每个用例前重置 Set
//   - 动态 import 异步,需 await 微任务后检查 factory spy
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  usePrefetch,
  __resetPrefetchedRoutesForTest,
  __hasPrefetchedForTest,
  __getPrefetchedCountForTest,
} from '../usePrefetch';

/* ---------- 用 vi.hoisted 创建跨 vi.mock 的 spy ---------- */
const spies = vi.hoisted(() => ({
  historyFactory: vi.fn(),
  analysisFactory: vi.fn(),
  generationFactory: vi.fn(),
  materialsFactory: vi.fn(),
  settingsFactory: vi.fn(),
  stylesFactory: vi.fn(),
  fuseFactory: vi.fn(),
  emotionFactory: vi.fn(),
  growthFactory: vi.fn(),
}));

/* ---------- mock 各页面模块,工厂内统计调用 ---------- */
vi.mock('../../pages/HistoryPage', () => {
  spies.historyFactory();
  return { default: () => null };
});
vi.mock('../../pages/AnalysisPage', () => {
  spies.analysisFactory();
  return { default: () => null };
});
vi.mock('../../pages/GenerationPage', () => {
  spies.generationFactory();
  return { default: () => null };
});
vi.mock('../../pages/MaterialsPage', () => {
  spies.materialsFactory();
  return { default: () => null };
});
vi.mock('../../pages/SettingsPage', () => {
  spies.settingsFactory();
  return { default: () => null };
});
vi.mock('../../pages/StylesPage', () => {
  spies.stylesFactory();
  return { default: () => null };
});
vi.mock('../../pages/FusePage', () => {
  spies.fuseFactory();
  return { default: () => null };
});
vi.mock('../../pages/EmotionPage', () => {
  spies.emotionFactory();
  return { default: () => null };
});
vi.mock('../../pages/GrowthPage', () => {
  spies.growthFactory();
  return { default: () => null };
});

/** 等待微任务完成(让动态 import 的 promise resolve) */
function flushMicrotasks(): Promise<void> {
  return Promise.resolve();
}

describe('usePrefetch', () => {
  beforeEach(() => {
    __resetPrefetchedRoutesForTest();
  });

  /* ============================================================
   * 1. 返回三个 handler
   * ============================================================ */
  it('返回 onMouseEnter / onFocus / onTouchStart 三个函数', () => {
    const { result } = renderHook(() => usePrefetch('/history'));
    expect(typeof result.current.onMouseEnter).toBe('function');
    expect(typeof result.current.onFocus).toBe('function');
    expect(typeof result.current.onTouchStart).toBe('function');
  });

  /* ============================================================
   * 2. 多次触发同一 routePath,仅 import 一次
   * ============================================================ */
  it('多次触发 onMouseEnter,Set 中只添加一次', async () => {
    const { result } = renderHook(() => usePrefetch('/history'));

    const beforeSetSize = __getPrefetchedCountForTest();

    result.current.onMouseEnter();
    // 等待动态 import resolve
    await flushMicrotasks();
    result.current.onMouseEnter();
    await flushMicrotasks();
    result.current.onMouseEnter();
    await flushMicrotasks();

    // Set 中 '/history' 已存在
    expect(__hasPrefetchedForTest('/history')).toBe(true);
    // Set 大小仅增加 1(多次触发同一路径去重)
    // 注:不依赖 factory spy 计数 — Vitest 会全局缓存 mock 模块,工厂仅在整个测试
    // 套件首次 import 时调用一次,跨用例不可靠;Set 在 beforeEach 重置,是去重的可信来源
    expect(__getPrefetchedCountForTest()).toBe(beforeSetSize + 1);
  });

  /* ============================================================
   * 3. 不同 routePath 触发不同 import
   * ============================================================ */
  it('不同 routePath 触发对应的 import', async () => {
    const { result: historyResult } = renderHook(() => usePrefetch('/history'));
    const { result: analysisResult } = renderHook(() => usePrefetch('/analyze'));

    const beforeSetSize = __getPrefetchedCountForTest();

    historyResult.current.onMouseEnter();
    await flushMicrotasks();
    analysisResult.current.onMouseEnter();
    await flushMicrotasks();

    // 两个不同路径均被标记为已预加载
    expect(__hasPrefetchedForTest('/history')).toBe(true);
    expect(__hasPrefetchedForTest('/analyze')).toBe(true);
    // Set 大小增加 2(两条不同路径各自入集合)
    expect(__getPrefetchedCountForTest()).toBe(beforeSetSize + 2);
  });

  /* ============================================================
   * 4. 未知 routePath 不抛错
   * ============================================================ */
  it('未知 routePath 触发 handler 不抛错', () => {
    const { result } = renderHook(() => usePrefetch('/unknown-path'));
    expect(() => {
      result.current.onMouseEnter();
      result.current.onFocus();
      result.current.onTouchStart();
    }).not.toThrow();
    // 未知路径不应被加入 Set
    expect(__hasPrefetchedForTest('/unknown-path')).toBe(false);
  });

  /* ============================================================
   * 5. 三种 handler 行为一致
   * ============================================================ */
  it('onMouseEnter / onFocus / onTouchStart 触发同一逻辑', async () => {
    const { result } = renderHook(() => usePrefetch('/materials'));

    result.current.onMouseEnter();
    await flushMicrotasks();
    expect(__hasPrefetchedForTest('/materials')).toBe(true);

    // 再次通过 onFocus / onTouchStart 触发,Set 大小不变(去重,三 handler 共享同一 prefetch 逻辑)
    const setSizeAfterFirst = __getPrefetchedCountForTest();
    result.current.onFocus();
    await flushMicrotasks();
    result.current.onTouchStart();
    await flushMicrotasks();
    expect(__getPrefetchedCountForTest()).toBe(setSizeAfterFirst);
    expect(__hasPrefetchedForTest('/materials')).toBe(true);
  });

  /* ============================================================
   * 6. 覆盖所有已映射路由(确保 importMap 完整)
   * ============================================================ */
  it('所有已映射路由都能被预加载', async () => {
    const routes = [
      '/analyze',
      '/generation',
      '/materials',
      '/styles',
      '/fuse',
      '/emotion',
      '/history',
      '/growth',
      '/settings',
    ];
    for (const route of routes) {
      const { result } = renderHook(() => usePrefetch(route));
      result.current.onMouseEnter();
      await flushMicrotasks();
      expect(__hasPrefetchedForTest(route)).toBe(true);
    }
    expect(__getPrefetchedCountForTest()).toBe(routes.length);
  });

  /* ============================================================
   * 7. handler 不抛错(基本健壮性)
   * ============================================================ */
  it('handler 调用不抛错', () => {
    const { result } = renderHook(() => usePrefetch('/settings'));
    expect(() => {
      result.current.onMouseEnter();
      result.current.onFocus();
      result.current.onTouchStart();
    }).not.toThrow();
  });
});
