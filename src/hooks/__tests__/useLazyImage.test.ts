// ============================================================
// useLazyImage 单元测试 (任务包D:性能优化)
// 对应源码: src/hooks/useLazyImage.ts
//
// 测试范围:
//   1. 初始状态:loadedSrc=placeholder / isLoaded=false / isError=false
//   2. 无 src 时:loadedSrc=undefined
//   3. IntersectionObserver 触发:进入视口后 loadedSrc=src
//   4. once=true:触发后 disconnect
//   5. src 切换:重置状态并重新观察
//   6. SSR 安全:无 IntersectionObserver 时直接加载真实 src
//   7. rootMargin/threshold 正确传递
//   8. 卸载清理
//
// Mock 策略:
//   - mock IntersectionObserver,提供 triggerObservers 手动触发回调
//   - 使用 createElement 渲染 <img ref={imgRef} />,使 ref.current 可用
//   (注:文件扩展名为 .ts,不能用 JSX 语法,用 createElement 替代)
// ============================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { render, act } from '@testing-library/react';
import { useLazyImage } from '../useLazyImage';

/** Mock IntersectionObserver 实例收集器,便于手动触发回调 */
interface MockObserverInstance {
  callback: IntersectionObserverCallback;
  options: IntersectionObserverInit | undefined;
  elements: Element[];
  disconnect: ReturnType<typeof vi.fn>;
  observe: ReturnType<typeof vi.fn>;
  unobserve: ReturnType<typeof vi.fn>;
}

let observerInstances: MockObserverInstance[] = [];

/** 安装 IntersectionObserver mock */
function installIntersectionObserverMock() {
  observerInstances = [];
  class MockIO {
    callback: IntersectionObserverCallback;
    options: IntersectionObserverInit | undefined;
    elements: Element[] = [];
    disconnect = vi.fn(() => {
      this.elements = [];
    });
    observe = vi.fn((el: Element) => {
      this.elements.push(el);
    });
    unobserve = vi.fn((el: Element) => {
      this.elements = this.elements.filter((e) => e !== el);
    });
    constructor(cb: IntersectionObserverCallback, options?: IntersectionObserverInit) {
      this.callback = cb;
      this.options = options;
      observerInstances.push(this);
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).IntersectionObserver = MockIO;
}

/** 卸载 IntersectionObserver mock */
function uninstallIntersectionObserverMock() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).IntersectionObserver = undefined;
  observerInstances = [];
}

/** 触发所有 observer 实例的回调,模拟元素进入/离开视口 */
function triggerObservers(isIntersecting: boolean) {
  for (const inst of observerInstances) {
    const entries = inst.elements.map((el) => ({
      isIntersecting,
      target: el,
      boundingClientRect: {} as DOMRectReadOnly,
      intersectionRect: {} as DOMRectReadOnly,
      rootBounds: null,
      intersectionRatio: isIntersecting ? 1 : 0,
      time: Date.now(),
    }));
    inst.callback(
      entries as unknown as IntersectionObserverEntry[],
      inst as unknown as IntersectionObserver,
    );
  }
}

/* ---------- 测试用包装组件:渲染 img 并捕获 hook 返回值 ---------- */
interface WrapperProps {
  src: string | undefined;
  options?: Parameters<typeof useLazyImage>[1];
}

let lastHookResult: ReturnType<typeof useLazyImage> | null = null;

function TestImage({ src, options }: WrapperProps) {
  const hookResult = useLazyImage(src, options);
  lastHookResult = hookResult;
  // 使用 createElement 而非 JSX(本文件扩展名为 .ts)
  return createElement('img', {
    ref: hookResult.imgRef,
    src: hookResult.loadedSrc,
    alt: 'test',
    'data-testid': 'test-img',
  });
}

describe('useLazyImage', () => {
  beforeEach(() => {
    installIntersectionObserverMock();
    lastHookResult = null;
  });
  afterEach(() => {
    uninstallIntersectionObserverMock();
    vi.restoreAllMocks();
  });

  /* ============================================================
   * 1. 初始状态
   * ============================================================ */
  it('初始 loadedSrc 为 placeholder,isLoaded=false, isError=false', () => {
    render(createElement(TestImage, { src: 'https://example.com/a.png' }));
    expect(lastHookResult).not.toBeNull();
    expect(lastHookResult!.loadedSrc).toMatch(/^data:image\/png;base64,/);
    expect(lastHookResult!.isLoaded).toBe(false);
    expect(lastHookResult!.isError).toBe(false);
  });

  it('自定义 placeholder 生效', () => {
    render(
      createElement(TestImage, {
        src: 'https://example.com/a.png',
        options: { placeholder: 'custom-ph' },
      }),
    );
    expect(lastHookResult!.loadedSrc).toBe('custom-ph');
  });

  /* ============================================================
   * 2. 无 src
   * ============================================================ */
  it('无 src 时 loadedSrc=undefined', () => {
    render(createElement(TestImage, { src: undefined }));
    expect(lastHookResult!.loadedSrc).toBeUndefined();
    expect(lastHookResult!.isLoaded).toBe(false);
    expect(lastHookResult!.isError).toBe(false);
  });

  /* ============================================================
   * 3. IntersectionObserver 触发
   * ============================================================ */
  it('进入视口后 loadedSrc 切换为真实 src', () => {
    render(createElement(TestImage, { src: 'https://example.com/a.png' }));
    expect(lastHookResult!.loadedSrc).toMatch(/^data:image/);
    expect(observerInstances.length).toBeGreaterThan(0);

    act(() => {
      triggerObservers(true);
    });

    expect(lastHookResult!.loadedSrc).toBe('https://example.com/a.png');
  });

  /* ============================================================
   * 4. once=true 触发后 disconnect
   * ============================================================ */
  it('once=true 触发后调用 disconnect', () => {
    render(
      createElement(TestImage, {
        src: 'https://example.com/a.png',
        options: { once: true },
      }),
    );
    expect(observerInstances.length).toBeGreaterThan(0);
    const inst = observerInstances[0];

    act(() => {
      triggerObservers(true);
    });

    expect(inst.disconnect).toHaveBeenCalled();
    expect(lastHookResult!.loadedSrc).toBe('https://example.com/a.png');
  });

  it('once=false 触发后不调用 disconnect', () => {
    render(
      createElement(TestImage, {
        src: 'https://example.com/a.png',
        options: { once: false },
      }),
    );
    expect(observerInstances.length).toBeGreaterThan(0);
    const inst = observerInstances[0];

    act(() => {
      triggerObservers(true);
    });

    expect(inst.disconnect).not.toHaveBeenCalled();
  });

  /* ============================================================
   * 5. src 切换
   * ============================================================ */
  it('src 切换时重置状态并重新观察', () => {
    const { rerender } = render(
      createElement(TestImage, { src: 'https://example.com/a.png' }),
    );

    act(() => {
      triggerObservers(true);
    });
    expect(lastHookResult!.loadedSrc).toBe('https://example.com/a.png');

    // 切换 src 到 b.png,应重置为 placeholder
    rerender(createElement(TestImage, { src: 'https://example.com/b.png' }));
    expect(lastHookResult!.loadedSrc).toMatch(/^data:image/);
    expect(lastHookResult!.isLoaded).toBe(false);
  });

  /* ============================================================
   * 6. SSR 安全
   * ============================================================ */
  it('无 IntersectionObserver 时直接加载真实 src', () => {
    uninstallIntersectionObserverMock();

    render(createElement(TestImage, { src: 'https://example.com/a.png' }));
    expect(lastHookResult!.loadedSrc).toBe('https://example.com/a.png');
  });

  /* ============================================================
   * 7. rootMargin / threshold 传递
   * ============================================================ */
  it('rootMargin 与 threshold 正确传递给 observer', () => {
    render(
      createElement(TestImage, {
        src: 'https://example.com/a.png',
        options: { rootMargin: '100px', threshold: 0.5 },
      }),
    );
    expect(observerInstances.length).toBeGreaterThan(0);
    // M-3 起 options 含 root(自动检测滚动祖先,测试环境为 null)
    expect(observerInstances[0].options).toMatchObject({
      rootMargin: '100px',
      threshold: 0.5,
    });
  });

  /* ============================================================
   * 8. 卸载清理
   * ============================================================ */
  it('卸载时不抛错', () => {
    const { unmount } = render(
      createElement(TestImage, { src: 'https://example.com/a.png' }),
    );
    expect(() => unmount()).not.toThrow();
  });
});
