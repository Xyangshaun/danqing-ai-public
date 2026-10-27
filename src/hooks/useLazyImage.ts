// ============================================================
// useLazyImage - 图片懒加载 Hook (任务包D:性能优化)
//
// 设计目标:
//   1. 用 IntersectionObserver 提前预加载(rootMargin 默认 200px)
//   2. SSR 安全:typeof IntersectionObserver !== 'undefined' 检查
//   3. once=true 时触发后停止观察,避免重复触发
//   4. 卸载时 disconnect observer,避免内存泄漏
//   5. 提供灰底 1x1 PNG 占位,避免布局抖动(CLS)
//   6. 支持 src 切换:src 变化时重新观察并重置 loadedSrc
//   7. 内部通过 addEventListener 监听 img load/error,自动维护 isLoaded/isError
//
// 使用约定:
//   const { imgRef, loadedSrc, isLoaded, isError } = useLazyImage(src);
//   <img ref={imgRef} src={loadedSrc} loading="lazy" />
//   注:hook 内部已绑定 load/error 事件,调用方无需再绑定 onLoad/onError
//
// 调试日志(V2-D 性能验证):
//   通过 localStorage.setItem('lazyimg-debug', '0') 可关闭;
//   默认开启,输出以下事件到 console.debug:
//   - [LazyImg] observe    IntersectionObserver 已创建并开始观察
//   - [LazyImg] intersect  元素进入视口,准备加载真实 src
//   - [LazyImg] loaded      图片加载完成
//   - [LazyImg] error      图片加载失败
//   - [LazyImg] disconnect  observer 已断开
//   - [LazyImg] fallback   不支持 IntersectionObserver,直接加载
//   - [LazyImg] src-change src 变化,重新观察
//   - [LazyImg] no-src     src 为空,清空状态
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 调试日志开关(可通过 localStorage 关闭)
 *   localStorage.setItem('lazyimg-debug', '0') 关闭
 *   localStorage.setItem('lazyimg-debug', '1') 开启(默认)
 *
 * 测试环境(import.meta.env.MODE === 'test' 或 NODE_ENV=test)默认关闭,
 * 避免 vitest 输出被日志噪声污染。
 */
const LAZY_IMG_DEBUG = (() => {
  // vitest 会设置 import.meta.env.MODE === 'test',生产构建/开发为 'production'/'development'
  // 注:不再检查 process.env.NODE_ENV —— process 是 Node.js 全局,
  // 在浏览器 Vite 构建中未声明会导致 TS 编译错误;MODE 已足够覆盖测试场景
  const isTestEnv = (import.meta as { env?: { MODE?: string } }).env?.MODE === 'test';
  if (isTestEnv) return false;
  if (typeof localStorage === 'undefined') return false;
  const flag = localStorage.getItem('lazyimg-debug');
  // 默认开启(未设置视为开启);显式 '0' 关闭
  return flag !== '0';
})();

/** 统一前缀 + 短 src 标识(截断到 40 字符,避免日志过长) */
function logLazy(event: string, src?: string, extra?: unknown): void {
  if (!LAZY_IMG_DEBUG) return;
  const shortSrc = src ? (src.length > 40 ? '...' + src.slice(-37) : src) : '<empty>';
  const ts = new Date().toISOString().slice(11, 23); // HH:mm:ss.SSS
  console.debug(`[LazyImg ${ts}] ${event.padEnd(11)}`, shortSrc, extra ?? '');
}

/**
 * 全局 img 资源加载观察器(零侵入,覆盖所有 <img loading="lazy"> 原生懒加载场景)
 *
 * 原生 loading="lazy" 没有 JS 钩子暴露"何时决定加载"。
 * 通过 PerformanceObserver 监听 'resource' 条目,过滤 initiatorType==='img',
 * 可以在图片真正发起网络请求时输出日志。
 *
 * 仅在浏览器环境 + LAZY_IMG_DEBUG 开启时初始化。
 */
if (typeof window !== 'undefined' && typeof PerformanceObserver !== 'undefined' && LAZY_IMG_DEBUG) {
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const res = entry as PerformanceResourceTiming;
        if (res.initiatorType === 'img' && res.name && !res.name.startsWith('data:')) {
          logLazy('resource', res.name, {
            duration: Math.round(res.duration),
            size: res.transferSize,
          });
        }
      }
    });
    observer.observe({ type: 'resource', buffered: true });
    // 不在卸载时 disconnect:页面整个生命周期都观察
  } catch {
    // 某些浏览器不支持 type: 'resource' 的 buffered,忽略
  }
}

export interface LazyImageOptions {
  /** rootMargin,默认 '200px'(提前 200px 加载) */
  rootMargin?: string;
  /** threshold,默认 0 */
  threshold?: number;
  /** 占位 src(默认 1x1 浅灰 PNG data URI) */
  placeholder?: string;
  /** 触发一次后停止观察,默认 true */
  once?: boolean;
  /** 首屏直出:跳过 IntersectionObserver,立即加载真实 src,默认 false */
  eager?: boolean;
  /** 兜底 src:真实 src 加载失败时自动切换(如本地生成的内联 SVG),默认无 */
  fallbackSrc?: string;
}

export interface LazyImageResult {
  /** 回调 ref,直接赋给 <img ref={imgRef}>;元素挂载时建立懒加载观察 */
  imgRef: (node: HTMLImageElement | null) => void;
  loadedSrc: string | undefined;
  isLoaded: boolean;
  isError: boolean;
}

/** 1x1 浅灰 PNG(透明底,避免布局抖动) */
const DEFAULT_PLACEHOLDER =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mN8/C8AAcsGAR7vHxkAAAAASUVORK5CYII=';

/**
 * 查找元素的最近可滚动祖先(用于 IntersectionObserver 的 root)。
 *
 * 背景:若不指定 root,IntersectionObserver 默认以浏览器视口为 root,
 * 但素材库/风格库等内容渲染在 `<main class="overflow-y-auto">` 这类
 * 内部滚动容器里,元素相对视口可能永远在 rootMargin 之外,导致 observer
 * 永不触发、图片卡在占位符。此处自动检测最近滚动祖先作为 root,使
 * intersection 基于真实滚动容器计算;找不到则回退 null(视口)。
 *
 * 判定规则:overflow-y 为 auto/scroll 且 scrollHeight>clientHeight(确实可滚动)。
 */
function getScrollParent(el: Element | null): Element | null {
  let node = el?.parentElement ?? null;
  while (node) {
    const style = typeof getComputedStyle === 'function' ? getComputedStyle(node) : null;
    const overflowY = style?.overflowY;
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

/**
 * 图片懒加载 Hook
 *
 * @param src 目标图片地址(undefined 时 loadedSrc 返回 undefined)
 * @param options 配置项
 */
export function useLazyImage(
  src: string | undefined,
  options: LazyImageOptions = {},
): LazyImageResult {
  const {
    rootMargin = '200px',
    threshold = 0,
    placeholder = DEFAULT_PLACEHOLDER,
    once = true,
    eager = false,
    fallbackSrc,
  } = options;

  const observerRef = useRef<IntersectionObserver | null>(null);
  // 缓存当前已加载的 src,用于 load/error 事件比较(避免 placeholder 触发 isLoaded)
  const activeSrcRef = useRef<string | undefined>(undefined);
  // 记录 observer 依附的元素(回调 ref 与 effect 共享)
  const elRef = useRef<HTMLImageElement | null>(null);

  // 当前应展示的 src:未触发前用 placeholder,触发后用真实 src
  const [loadedSrc, setLoadedSrc] = useState<string | undefined>(
    src ? placeholder : undefined,
  );
  const [isLoaded, setIsLoaded] = useState(false);
  const [isError, setIsError] = useState(false);

  // 统一比较 img.src 与目标 src:对 data URI 做前缀比较(浏览器会规范化
  // 百分号编码大小写/空白,导致完整串 includes 失配),对普通 URL 用 includes
  const srcMatches = useCallback((elSrc: string, target: string | undefined): boolean => {
    if (!target) return false;
    if (target.startsWith('data:')) {
      // data URI:比较 scheme + mime + 前 64 字符指纹即可唯一确定
      return elSrc.slice(0, 96) === target.slice(0, 96);
    }
    return elSrc.includes(target);
  }, []);

  // 清理 observer
  const disconnect = useCallback(() => {
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
      logLazy('disconnect', activeSrcRef.current);
    }
  }, []);

  // 在指定元素上建立 IntersectionObserver 观察(供 effect 与回调 ref 共用)
  const attachObserver = useCallback(
    (el: HTMLImageElement) => {
      const target = activeSrcRef.current;
      if (!target || target.startsWith('data:')) return;
      if (typeof IntersectionObserver === 'undefined') return;
      disconnect();
      // 自动检测最近可滚动祖先作为 root;若内容在内部滚动容器(如素材库的
      // <main class="overflow-y-auto">)内,默认视口 root 会使图片永远超出
      // rootMargin,observer 永不触发。找不到时回退 null(视口)。
      const root = getScrollParent(el);
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              logLazy('intersect', target, { rootMargin, threshold, hasRoot: !!root });
              setLoadedSrc(target);
              if (once) disconnect();
            }
          }
        },
        { root, rootMargin, threshold },
      );
      observerRef.current = observer;
      observer.observe(el);
      logLazy('observe', target, { rootMargin, threshold, hasRoot: !!root });
    },
    [rootMargin, threshold, once, disconnect],
  );

  // 回调 ref:元素挂载时建立观察,卸载时断开。
  // 解决 useEffect 先于 ref 赋值导致 imgRef.current 为 null、观察永不建立的时序竞态。
  const imgRef = useCallback(
    (node: HTMLImageElement | null) => {
      elRef.current = node;
      if (node) {
        attachObserver(node);
      } else {
        disconnect();
      }
    },
    [attachObserver, disconnect],
  );

  // src 变化时:重置状态并重新观察
  useEffect(() => {
    // 无 src 时直接清空
    if (!src) {
      logLazy('no-src', activeSrcRef.current);
      activeSrcRef.current = undefined;
      setLoadedSrc(undefined);
      setIsLoaded(false);
      setIsError(false);
      disconnect();
      return;
    }

    logLazy('src-change', src);
    // 重置状态
    activeSrcRef.current = src;
    setIsLoaded(false);
    setIsError(false);

    // eager 模式(首屏直出):跳过 IntersectionObserver,立即加载真实 src。
    // 用于首屏可见图片,避免等待 observer 回调造成白屏闪烁。
    if (eager) {
      setLoadedSrc(src);
      logLazy('eager-direct', src);
      return;
    }

    // data URI(素材库/风格库内联 SVG)同步可解码、零网络:
    // 无需 IntersectionObserver 懒加载,直接赋值 + 立即标记完成,
    // 避免 observer/ref 时序问题导致骨架屏常驻。
    if (src.startsWith('data:')) {
      setLoadedSrc(src);
      setIsLoaded(true);
      logLazy('data-uri-direct', src);
      return;
    }

    setLoadedSrc(placeholder);

    // SSR 安全检查:不支持 IntersectionObserver 时直接加载真实 src
    if (typeof IntersectionObserver === 'undefined') {
      logLazy('fallback', src, 'no-IntersectionObserver');
      setLoadedSrc(src);
      return;
    }

    // 元素未挂载时等待回调 ref 建立观察(见 attachObserver)
    const el = elRef.current;
    if (!el) return;
    attachObserver(el);
    // eslint-disable-next-line consistent-return
    return () => {
      disconnect();
    };
  }, [src, rootMargin, threshold, placeholder, once, eager, disconnect]);

  // 卸载时清理 observer
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  // 监听 img 的 load/error 事件,自动维护 isLoaded/isError
  // 仅当 loadedSrc 是真实 src(非 placeholder)时才标记状态
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    // 当前 loadedSrc 不是真实 src(是 placeholder 或 undefined),无需监听
    if (!loadedSrc || loadedSrc === placeholder) return;

    const handleLoad = () => {
      // 仅当 img.src 与当前 activeSrc 一致时才标记(避免 src 切换竞态)
      if (srcMatches(el.src, activeSrcRef.current)) {
        setIsLoaded(true);
        setIsError(false);
        logLazy('loaded', activeSrcRef.current, {
          naturalWidth: el.naturalWidth,
          naturalHeight: el.naturalHeight,
        });
      }
    };
    const handleError = () => {
      if (srcMatches(el.src, activeSrcRef.current)) {
        // 有兜底地址且当前失败的不是兜底本身:切换到兜底(如内联 SVG,零网络)
        if (fallbackSrc && activeSrcRef.current !== fallbackSrc) {
          logLazy('error-fallback', activeSrcRef.current);
          activeSrcRef.current = fallbackSrc;
          setLoadedSrc(fallbackSrc);
          return;
        }
        setIsError(true);
        setIsLoaded(false);
        logLazy('error', activeSrcRef.current);
      }
    };
    el.addEventListener('load', handleLoad);
    el.addEventListener('error', handleError);
    // 若图片已加载完成(浏览器缓存或 data URI 同步解码),complete=true 且 naturalWidth>0
    // data URI 在赋值后可能已同步完成,需立即兜底判定,否则骨架屏/失败态卡住
    if (el.complete && el.naturalWidth > 0) {
      // 强制标记(data URI 无前缀失配风险,直接用当前 activeSrc)
      if (activeSrcRef.current) {
        setIsLoaded(true);
        setIsError(false);
        logLazy('loaded', activeSrcRef.current, { cached: true, naturalWidth: el.naturalWidth });
      } else {
        handleLoad();
      }
    } else if (el.complete && el.naturalWidth === 0 && el.src.startsWith('data:')) {
      // data URI complete 但解码失败(损坏)→ 直接置错误态
      setIsError(true);
      setIsLoaded(false);
      logLazy('error', activeSrcRef.current, { cached: true });
    }
    return () => {
      el.removeEventListener('load', handleLoad);
      el.removeEventListener('error', handleError);
    };
  }, [loadedSrc, placeholder, fallbackSrc, srcMatches]);

  return {
    imgRef,
    loadedSrc,
    isLoaded,
    isError,
  };
}

export default useLazyImage;
