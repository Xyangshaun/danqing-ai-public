// ============================================================
// SmartImage - 统一图片组件 (任务:控制台图片加载体验修复)
//
// 设计目标:
//   1. 加载中:显示 shimmer 骨架屏(复用 dq-skeleton),避免空白
//   2. 加载超时:超过 timeoutMs(默认 8s)仍未加载完成 → 视为失败,
//      避免"加载半天"的不良体验
//   3. 加载失败:显示 ImageOff 占位 + 可选重试按钮,不显示破损图标
//   4. 空 src:显示图标占位,不发起请求
//   5. 加载完成:fade-in 显示真实图片
//   6. 原生 loading="lazy" 实现滚动懒加载(无需 IntersectionObserver)
//
// 使用方式(替换裸 <img>):
//   <SmartImage src={work.imageUrl} alt="作品" className="w-full h-full rounded-xl" />
//   <SmartImage src={url} alt="作品" className="w-full max-h-96" imgClassName="object-contain" />
// ============================================================

import { useEffect, useRef, useState, memo } from 'react';
import { ImageOff, RefreshCw } from 'lucide-react';
import { SkeletonBox } from './PageSkeleton';

export interface SmartImageProps {
  /** 图片地址,为空时显示占位图标 */
  src?: string;
  /** alt 文本 */
  alt: string;
  /** 外层 wrapper 样式(尺寸/圆角/overflow 等),默认空 */
  className?: string;
  /** 内层 img 样式(object-fit / transition / hover 等),默认含 fade-in 过渡 */
  imgClassName?: string;
  /** 加载失败时显示的文案,默认 '图片暂不可用' */
  fallbackText?: string;
  /** 加载超时阈值(ms),默认 8000。超时后视为失败,显示 fallback */
  timeoutMs?: number;
  /** 是否显示重试按钮,默认 true */
  showRetry?: boolean;
}

type LoadState = 'loading' | 'loaded' | 'error';

function SmartImage({
  src,
  alt,
  className = '',
  imgClassName = 'object-cover transition-opacity duration-300',
  fallbackText = '图片暂不可用',
  timeoutMs = 8000,
  showRetry = true,
}: SmartImageProps) {
  // retryNonce:重试时递增,作为 img 的 key 触发重新挂载 → 重新发起请求
  const [retryNonce, setRetryNonce] = useState(0);
  const [state, setState] = useState<LoadState>(src ? 'loading' : 'error');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  // src 变化或重试时:重置为 loading 态,并清除旧计时器
  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (!src) {
      setState('error');
      return;
    }
    /* 兜底:dataURL/缓存图片可能在 onLoad 监听绑定前已完成加载,事件不再触发,
       组件会永远停在 loading(图片不可见)。挂载后直接检查 complete 状态。 */
    const im = imgRef.current;
    if (im && im.complete && im.naturalWidth > 0) {
      setState('loaded');
      return;
    }
    setState('loading');
  }, [src, retryNonce]);

  // 卸载时清除计时器
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  // 仅在图片真正开始加载(onLoadStart)后才启动超时计时器。
  // 原因:配合 loading="lazy" 时,视口外的图片被浏览器延迟请求,
  //     若在挂载时立即计时,会在图片尚未开始加载前就误判超时,显示"加载失败"。
  const startTimeout = () => {
    if (timerRef.current) return;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setState((prev) => (prev === 'loading' ? 'error' : prev));
    }, timeoutMs);
  };

  const handleLoad = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setState('loaded');
  };

  const handleError = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setState('error');
  };

  const handleRetry = () => setRetryNonce((n) => n + 1);

  // 空 src:显示占位图标(不显示重试,因为重试也无意义)
  if (!src) {
    return (
      <div
        className={`relative flex items-center justify-center bg-ink-100 ${className}`}
        role="img"
        aria-label={alt}
      >
        <ImageOff className="w-8 h-8 text-ink-300" />
      </div>
    );
  }

  return (
    <div className={`relative overflow-hidden ${className}`}>
      {/* 加载中:shimmer 骨架屏 */}
      {state === 'loading' && (
        <div className="absolute inset-0">
          <SkeletonBox className="absolute inset-0" />
        </div>
      )}

      {/* 加载失败:占位图 + 重试 */}
      {state === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-ink-100 gap-1.5">
          <ImageOff className="w-8 h-8 text-ink-300" />
          <span className="text-xs text-ink-400 text-center px-2">{fallbackText}</span>
          {showRetry && (
            <button
              type="button"
              onClick={handleRetry}
              aria-label="重新加载图片"
              className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 text-xs text-ink-500 hover:text-cinnabar bg-white/70 hover:bg-white rounded transition-colors"
            >
              <RefreshCw className="w-3 h-3" />
              重试
            </button>
          )}
        </div>
      )}

      {/* 真实图片:loaded 后 fade-in;key 随 retryNonce 变化以触发重新挂载 */}
      <img
        key={retryNonce}
        ref={imgRef}
        src={src}
        alt={alt}
        loading="lazy"
        className={`w-full h-full ${imgClassName} ${
          state === 'loaded' ? 'opacity-100' : 'opacity-0'
        }`}
        onLoadStart={startTimeout}
        onLoad={handleLoad}
        onError={handleError}
      />
    </div>
  );
}

export default memo(SmartImage);
