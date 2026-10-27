// ============================================================
// useVirtualList - 轻量虚拟列表 Hook (任务包D:性能优化)
//
// 设计目标:
//   1. 不引入第三方虚拟列表库(react-window/react-virtual)
//   2. 固定行高简化计算,避免 measure 开销
//   3. useState + useRef + useCallback + useMemo 实现
//   4. overscan 渲染可视区外额外项,减少滚动时白屏
//   5. visibleItems 用 useMemo 包装,范围未变化时复用引用
//   6. onScroll 仅在跨行时 setState,避免像素级 re-render
//
// 使用约定:
//   - 容器需 overflow-y: auto + position: relative + 固定高度
//   - 调用方需为每个可见项设置 height: itemHeight + transform: translateY(offsetTop)
//   - 内部层用 height: totalHeight 撑出滚动条
//
// 性能特性:
//   - visibleItems 仅在可视范围 [start, end) 跨行变化时重建数组
//   - 同一行内滚动(小于 itemHeight)不触发 setState
//   - 调用方应使用 useMemo 稳定 items 引用,避免每次重渲染都重建
// ============================================================

import { useCallback, useMemo, useRef, useState } from 'react';

export interface VirtualListOptions {
  /** 固定行高(必须,简化实现) */
  itemHeight: number;
  /** 可视区外额外渲染的行数,默认 5 */
  overscan?: number;
  /** 容器可视高度 */
  containerHeight: number;
}

export interface VisibleItem<T> {
  item: T;
  index: number;
  offsetTop: number;
}

export interface VirtualListResult<T> {
  visibleItems: VisibleItem<T>[];
  totalHeight: number;
  scrollTop: number;
  onScroll: (e: React.UIEvent<HTMLDivElement>) => void;
}

/**
 * 轻量虚拟列表 Hook
 *
 * @param items 完整列表数据(建议调用方用 useMemo 稳定引用)
 * @param options 配置项
 * @returns visibleItems / totalHeight / scrollTop / onScroll
 */
export function useVirtualList<T>(
  items: readonly T[],
  options: VirtualListOptions,
): VirtualListResult<T> {
  const { itemHeight, overscan = 5, containerHeight } = options;

  const [scrollTop, setScrollTop] = useState(0);
  // 同步缓存最新 scrollTop,避免 onScroll 闭包依赖 scrollTop 导致每次重建
  const scrollTopRef = useRef(0);

  const totalHeight = useMemo(
    () => items.length * itemHeight,
    [items.length, itemHeight],
  );

  // visibleItems 仅在范围变化时重建,同像素内滚动复用引用
  const visibleItems = useMemo<VisibleItem<T>[]>(() => {
    const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
    const visibleCount = Math.ceil(containerHeight / itemHeight) + overscan * 2;
    const endIndex = Math.min(items.length, startIndex + visibleCount);

    const result: VisibleItem<T>[] = [];
    for (let i = startIndex; i < endIndex; i++) {
      result.push({
        item: items[i],
        index: i,
        offsetTop: i * itemHeight,
      });
    }
    return result;
  }, [scrollTop, itemHeight, containerHeight, overscan, items]);

  const onScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const next = e.currentTarget.scrollTop;
      // 仅在跨行时 setState,避免像素级 re-render
      const prevRow = Math.floor(scrollTopRef.current / itemHeight);
      const nextRow = Math.floor(next / itemHeight);
      scrollTopRef.current = next;
      if (nextRow !== prevRow) {
        setScrollTop(next);
      }
    },
    [itemHeight],
  );

  return {
    visibleItems,
    totalHeight,
    scrollTop,
    onScroll,
  };
}

export default useVirtualList;
