// ============================================================
// useVirtualList 单元测试 (任务包D:性能优化)
// 对应源码: src/hooks/useVirtualList.ts
//
// 测试范围:
//   1. 基本渲染:items.length / totalHeight / 初始 visibleItems
//   2. overscan:可视区外额外渲染的行数
//   3. scrollTop 变化:visibleItems 范围正确计算
//   4. onScroll 跨行触发 setState,同像素内不触发
//   5. 边界:items.length=0 / scrollTop=0 / scrollTop 超出 totalHeight
//   6. visibleItems 引用稳定性:同范围不重建数组
//
// Mock 策略:
//   - 使用 renderHook + act 模拟 scroll 事件
//   - 构造 mock UIEvent,currentTarget.scrollTop 可控
// ============================================================

import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVirtualList } from '../useVirtualList';

/** 构造 mock scroll event,currentTarget.scrollTop = value */
function makeScrollEvent(scrollTop: number): React.UIEvent<HTMLDivElement> {
  return {
    currentTarget: { scrollTop } as HTMLDivElement,
  } as unknown as React.UIEvent<HTMLDivElement>;
}

describe('useVirtualList', () => {
  /* ============================================================
   * 1. 基本渲染
   * ============================================================ */
  it('初始 visibleItems 包含从 index 0 开始的项(含 overscan)', () => {
    const items = Array.from({ length: 100 }, (_, i) => i);
    const { result } = renderHook(() =>
      useVirtualList(items, { itemHeight: 50, containerHeight: 500 }),
    );

    // scrollTop=0, overscan=5 → start=0, end=ceil(500/50)+5*2=20
    expect(result.current.visibleItems.length).toBe(20);
    expect(result.current.visibleItems[0].index).toBe(0);
    expect(result.current.visibleItems[0].item).toBe(0);
    expect(result.current.visibleItems[0].offsetTop).toBe(0);
    expect(result.current.visibleItems[19].index).toBe(19);
    expect(result.current.visibleItems[19].offsetTop).toBe(19 * 50);
  });

  it('totalHeight = items.length * itemHeight', () => {
    const items = Array.from({ length: 100 }, (_, i) => i);
    const { result } = renderHook(() =>
      useVirtualList(items, { itemHeight: 50, containerHeight: 500 }),
    );
    expect(result.current.totalHeight).toBe(5000);
  });

  it('初始 scrollTop 为 0', () => {
    const { result } = renderHook(() =>
      useVirtualList([1, 2, 3], { itemHeight: 50, containerHeight: 200 }),
    );
    expect(result.current.scrollTop).toBe(0);
  });

  /* ============================================================
   * 2. overscan 行为
   * ============================================================ */
  it('overscan=0 时 visibleItems 仅含可视区内的项', () => {
    const items = Array.from({ length: 100 }, (_, i) => i);
    const { result } = renderHook(() =>
      useVirtualList(items, { itemHeight: 50, containerHeight: 500, overscan: 0 }),
    );
    // start=0, visibleCount=ceil(500/50)+0=10, end=10
    expect(result.current.visibleItems.length).toBe(10);
  });

  it('overscan 自定义值生效', () => {
    const items = Array.from({ length: 100 }, (_, i) => i);
    const { result } = renderHook(() =>
      useVirtualList(items, { itemHeight: 50, containerHeight: 500, overscan: 10 }),
    );
    // start=max(0, 0-10)=0, visibleCount=10+10*2=30, end=30
    expect(result.current.visibleItems.length).toBe(30);
  });

  /* ============================================================
   * 3. scrollTop 变化
   * ============================================================ */
  it('滚动到中间位置,visibleItems 范围正确计算', () => {
    const items = Array.from({ length: 100 }, (_, i) => i);
    const { result } = renderHook(() =>
      useVirtualList(items, { itemHeight: 50, containerHeight: 500, overscan: 5 }),
    );

    act(() => {
      result.current.onScroll(makeScrollEvent(1000));
    });

    // scrollTop=1000, itemHeight=50 → row=20
    // start=max(0, 20-5)=15, visibleCount=10+10=20, end=35
    expect(result.current.scrollTop).toBe(1000);
    expect(result.current.visibleItems[0].index).toBe(15);
    expect(result.current.visibleItems[0].offsetTop).toBe(15 * 50);
    expect(result.current.visibleItems[19].index).toBe(34);
  });

  it('滚动到接近末尾,end 被 items.length 截断', () => {
    const items = Array.from({ length: 100 }, (_, i) => i);
    const { result } = renderHook(() =>
      useVirtualList(items, { itemHeight: 50, containerHeight: 500, overscan: 5 }),
    );

    act(() => {
      result.current.onScroll(makeScrollEvent(4800));
    });

    // scrollTop=4800, row=96
    // start=max(0, 96-5)=91, end=min(100, 91+20)=100
    expect(result.current.visibleItems[0].index).toBe(91);
    expect(result.current.visibleItems[result.current.visibleItems.length - 1].index).toBe(99);
  });

  /* ============================================================
   * 4. onScroll 跨行触发 setState
   * ============================================================ */
  it('onScroll 同行内不触发 setState(scrollTop 不变)', () => {
    const items = Array.from({ length: 100 }, (_, i) => i);
    const { result } = renderHook(() =>
      useVirtualList(items, { itemHeight: 50, containerHeight: 500, overscan: 5 }),
    );

    // 跨行触发一次(0 → row 1)
    act(() => {
      result.current.onScroll(makeScrollEvent(50));
    });
    expect(result.current.scrollTop).toBe(50);

    // 同行内滚动(50 → 60),scrollTop state 不变
    act(() => {
      result.current.onScroll(makeScrollEvent(60));
    });
    expect(result.current.scrollTop).toBe(50);
  });

  it('onScroll 跨行时触发 setState', () => {
    const items = Array.from({ length: 100 }, (_, i) => i);
    const { result } = renderHook(() =>
      useVirtualList(items, { itemHeight: 50, containerHeight: 500, overscan: 5 }),
    );

    act(() => {
      result.current.onScroll(makeScrollEvent(60));
    });
    // 60 → row 1,跨行触发
    expect(result.current.scrollTop).toBe(60);
  });

  /* ============================================================
   * 5. 边界情况
   * ============================================================ */
  it('items.length=0 时 visibleItems 为空,totalHeight=0', () => {
    const { result } = renderHook(() =>
      useVirtualList([], { itemHeight: 50, containerHeight: 500 }),
    );
    expect(result.current.visibleItems.length).toBe(0);
    expect(result.current.totalHeight).toBe(0);
  });

  it('scrollTop 超过 totalHeight 时,start 被 max 限制', () => {
    const items = Array.from({ length: 10 }, (_, i) => i);
    const { result } = renderHook(() =>
      useVirtualList(items, { itemHeight: 50, containerHeight: 500, overscan: 5 }),
    );

    act(() => {
      result.current.onScroll(makeScrollEvent(10000));
    });

    // scrollTop=10000, row=200, start=max(0, 200-5)=195
    // 但 end=min(10, 195+20)=10 → start 实际被截到 10 以下
    // 因为循环 for(i=start; i<end; i++) 在 start>end 时不执行
    // start=195, end=10 → 循环不执行 → visibleItems 为空
    // 但实际:visibleItems 长度应该为 0(因为 start>end)
    expect(result.current.visibleItems.length).toBe(0);
  });

  it('items 引用变化时 visibleItems 重建', () => {
    const items1 = Array.from({ length: 100 }, (_, i) => `a${i}`);
    const items2 = Array.from({ length: 100 }, (_, i) => `b${i}`);
    const { result, rerender } = renderHook(
      ({ items }) => useVirtualList(items, { itemHeight: 50, containerHeight: 500 }),
      { initialProps: { items: items1 } },
    );

    expect(result.current.visibleItems[0].item).toBe('a0');

    rerender({ items: items2 });
    expect(result.current.visibleItems[0].item).toBe('b0');
  });

  /* ============================================================
   * 6. visibleItems 引用稳定性
   * ============================================================ */
  it('同范围内 scroll,visibleItems 引用保持稳定', () => {
    const items = Array.from({ length: 100 }, (_, i) => i);
    const { result } = renderHook(() =>
      useVirtualList(items, { itemHeight: 50, containerHeight: 500, overscan: 5 }),
    );

    const firstRef = result.current.visibleItems;
    // 同行内 scroll,onScroll 不触发 setState,但即使触发了也会因 useMemo deps 不变而稳定
    act(() => {
      result.current.onScroll(makeScrollEvent(10));
    });
    // 10 → row 0,与初始 0 同行,scrollTop 不变,visibleItems 引用稳定
    expect(result.current.visibleItems).toBe(firstRef);
  });
});
