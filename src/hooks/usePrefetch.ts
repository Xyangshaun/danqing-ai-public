// ============================================================
// usePrefetch - 路由 hover 预加载 Hook (任务包D:性能优化)
//
// 设计目标:
//   1. 维护全局 Set<string> 记录已预加载路径,避免重复 import
//   2. 路由 hover/focus/touchstart 时触发对应页面模块的动态 import
//   3. 失败静默(console.warn),不影响用户体验
//   4. 提供 onMouseEnter / onFocus / onTouchStart 三种事件处理器
//   5. 与 App.tsx 中的 React.lazy import 函数对齐,共享 chunk 缓存
//
// 性能特性:
//   - 同一路径仅 import 一次(模块级 Set 去重)
//   - import 失败时不会抛出,保证 hover 不阻塞交互
//   - 模块级 Set 跨组件实例共享,避免每个 Sidebar 项重复预加载
// ============================================================

import { useCallback } from 'react';

/** 模块级缓存:已预加载的路径集合(跨组件实例共享) */
const prefetchedRoutes = new Set<string>();

/**
 * 路由 → 动态 import 函数映射
 * 与 App.tsx 中的 React.lazy 一致,共享 Vite chunk 缓存
 */
const importMap: Record<string, () => Promise<unknown>> = {
  '/analyze': () => import('../pages/AnalysisPage'),
  '/generation': () => import('../pages/GenerationPage'),
  '/materials': () => import('../pages/MaterialsPage'),
  '/styles': () => import('../pages/StylesPage'),
  '/fuse': () => import('../pages/FusePage'),
  '/emotion': () => import('../pages/EmotionPage'),
  '/history': () => import('../pages/HistoryPage'),
  '/growth': () => import('../pages/GrowthPage'),
  '/images': () => import('../pages/ImageSearchPage'),
  '/settings': () => import('../pages/SettingsPage'),
};

export interface PrefetchHandlers {
  onMouseEnter: () => void;
  onFocus: () => void;
  onTouchStart: () => void;
}

/**
 * 路由 hover 预加载 Hook
 *
 * @param routePath 路由路径(如 '/history')
 * @returns onMouseEnter / onFocus / onTouchStart 事件处理器
 *
 * 调试日志(V2-D 性能验证):与 useLazyImage 共用 lazyimg-debug 开关
 *   localStorage.setItem('lazyimg-debug', '0') 关闭
 *   输出事件:
 *   - [Prefetch] prefetch   首次触发预加载(鼠标/焦点/触摸)
 *   - [Prefetch] cached     路径已预加载,跳过(仅 DEBUG 时偶发输出)
 *   - [Prefetch] loaded     chunk 加载成功
 *   - [Prefetch] error      chunk 加载失败(始终输出,不依赖开关)
 */
export function usePrefetch(routePath: string): PrefetchHandlers {
  const prefetch = useCallback(() => {
    // 调试开关:与 useLazyImage 共用,默认开启,测试环境自动关闭
    const debug =
      typeof localStorage !== 'undefined' && localStorage.getItem('lazyimg-debug') !== '0' &&
      (import.meta as { env?: { MODE?: string } }).env?.MODE !== 'test';

    // 已预加载,跳过
    if (prefetchedRoutes.has(routePath)) {
      if (debug) {
        const ts = new Date().toISOString().slice(11, 23);
        console.debug(`[Prefetch ${ts}] cached     ${routePath}`);
      }
      return;
    }
    const importer = importMap[routePath];
    if (!importer) return;

    if (debug) {
      const ts = new Date().toISOString().slice(11, 23);
      console.debug(`[Prefetch ${ts}] prefetch   ${routePath}`);
    }

    // 标记为已预加载(在 import 之前标记,避免并发重复触发)
    prefetchedRoutes.add(routePath);
    importer()
      .then(() => {
        if (debug) {
          const ts = new Date().toISOString().slice(11, 23);
          console.debug(`[Prefetch ${ts}] loaded     ${routePath}`);
        }
      })
      .catch((err) => {
        // 失败时移除标记,允许下次重试
        prefetchedRoutes.delete(routePath);
        // 静默处理,仅 console.warn(失败始终输出,便于发现问题)
        console.warn(`[Prefetch] 预加载路由 ${routePath} 失败:`, err);
      });
  }, [routePath]);

  return {
    onMouseEnter: prefetch,
    onFocus: prefetch,
    onTouchStart: prefetch,
  };
}

/** 测试用:重置已预加载集合(仅用于单元测试,生产代码勿调) */
export function __resetPrefetchedRoutesForTest(): void {
  prefetchedRoutes.clear();
}

/** 测试用:检查路径是否已预加载(仅用于单元测试,生产代码勿调) */
export function __hasPrefetchedForTest(routePath: string): boolean {
  return prefetchedRoutes.has(routePath);
}

/** 测试用:获取已预加载路径数量(仅用于单元测试,生产代码勿调) */
export function __getPrefetchedCountForTest(): number {
  return prefetchedRoutes.size;
}

export default usePrefetch;
