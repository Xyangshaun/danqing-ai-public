/* ============================================================
 * useMasonryColumns — JS 预分配列瀑布流
 *
 * 为什么需要:
 *   CSS columns 的「列优先填充」算法在无限滚动追加内容时会
 *   重新计算所有卡片的列归属,导致已渲染卡片位置跳变(CLS)。
 *
 * 方案:
 *   1. 用 useMemo 把可见作品按「最短列优先」策略预分配到 N 列
 *      (与 Pinterest 同款算法),每列是一个独立的 flex 容器
 *   2. 翻页追加新作品时,旧卡片在列中的索引完全不变,只往列尾追加
 *   3. 响应式:监听容器宽度/媒体查询,动态切换列数(1/3/4/5)
 *
 * 与原 CSS columns 的差异:
 *   - 视觉顺序:从左到右按列读取(列1第1件、列2第1件…),不再是
 *     严格的作品数组顺序。对瀑布流场景用户无感知差异。
 *   - DOM 结构:columns 容器 → N 个并列的 flex 列容器
 *
 * 稳定性保证:
 *   - 分配函数是纯函数,依赖 [items, columnCount],翻页时旧项的
 *     列归属由同一算法重算,结果必然不变(新项只影响列高度,不
 *     改变旧项的「最短列」选择,因为旧项处理顺序在新项之前)
 * ============================================================ */

import { useEffect, useMemo, useState } from 'react';

/** 各断点对应的列数(与原 Tailwind columns-1 md:3 lg:4 xl:5 对齐) */
const BREAKPOINTS: Array<{ minWidth: number; columns: number }> = [
  { minWidth: 1280, columns: 5 }, // xl
  { minWidth: 1024, columns: 4 }, // lg
  { minWidth: 768, columns: 3 },  // md
  { minWidth: 0, columns: 1 },    // base
];

function resolveColumnCount(width: number): number {
  for (const bp of BREAKPOINTS) {
    if (width >= bp.minWidth) return bp.columns;
  }
  return 1;
}

/**
 * 响应式列数:默认取窗口宽度,SSR/无 window 时回退 3 列。
 * 监听 resize(节流 150ms),窗口跨越断点时切换列数。
 */
export function useMasonryColumnCount(): number {
  const [columnCount, setColumnCount] = useState<number>(() => {
    if (typeof window === 'undefined') return 3;
    return resolveColumnCount(window.innerWidth);
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onResize = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const next = resolveColumnCount(window.innerWidth);
        setColumnCount((prev) => (prev === next ? prev : next));
      }, 150);
    };
    window.addEventListener('resize', onResize);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return columnCount;
}

/**
 * 把 items 按「最短列优先」分配到 columnCount 列。
 *
 * @param items 可见作品数组(顺序即优先级,先出现的先入列)
 * @param columnCount 列数
 * @param getWeight 每项的视觉高度权重(用于估算列高,默认 1)。
 *                  瀑布流中宽高比差异大,用 thumbH/thumbW 作为权重
 *                  能让各列高度更均衡。
 *
 * 返回长度 === columnCount 的二维数组,columns[i] 是第 i 列的作品(按入列顺序)。
 *
 * 稳定性:
 *   - 算法按 items 顺序处理,前 K 项的列归属只依赖前 K 项的权重,
 *     追加新项不会改变已有项的列归属 → 翻页时旧卡片位置不动
 */
export function distributeToColumns<T>(
  items: T[],
  columnCount: number,
  getWeight: (item: T) => number = () => 1,
): T[][] {
  const columns: T[][] = Array.from({ length: columnCount }, () => []);
  const heights: number[] = new Array(columnCount).fill(0);

  for (const item of items) {
    // 找当前最短的列(并列时取最左列,保证确定性)
    let minIdx = 0;
    for (let i = 1; i < columnCount; i++) {
      if (heights[i] < heights[minIdx]) minIdx = i;
    }
    columns[minIdx].push(item);
    heights[minIdx] += getWeight(item);
  }

  return columns;
}

/**
 * 便捷组合 hook:列数 + 列分配一步到位。
 * 用法:
 *   const columnCount = useMasonryColumnCount();
 *   const columns = useMasonryColumns(visibleArtworks, columnCount, a => (a.thumbH ?? 360) / (a.thumbW ?? 640));
 */
export function useMasonryColumns<T>(
  items: T[],
  columnCount: number,
  getWeight?: (item: T) => number,
): T[][] {
  return useMemo(
    () => distributeToColumns(items, columnCount, getWeight),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, columnCount],
  );
}
