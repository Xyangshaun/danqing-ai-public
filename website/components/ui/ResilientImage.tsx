'use client';

import React, { useEffect, useRef, useState } from 'react';
import { IMAGE_CDN_BASE, IMAGE_SLOW_FALLBACK_MS } from '@/lib/assetConfig';

/**
 * ResilientImage — 弹性图片
 *
 * 来源链(主用 CDN,本地备用):
 *   [CDN webp → CDN jpg → 本地 webp → 本地 jpg]
 * 未配置 CDN 时退化为本地 webp → 本地 jpg。
 *
 * 触发切换:
 *  1) onError:某来源加载失败,立即切到链上下一来源
 *  2) 慢加载:超过 slowLoadMs 仍未加载完成,自动切到下一来源(覆盖"加载时间长")
 *  3) 链全部失败:调用 onTotalFailure(通常用于隐藏容器,避免破碎占位)
 */
type ResilientImageProps = Omit<
  React.ImgHTMLAttributes<HTMLImageElement>,
  'src' | 'onError' | 'onLoad'
> & {
  /** 本地图片路径(建议传 .jpg;会一起尝试同名 .webp) */
  localSrc: string;
  /** CDN 基础 URL,默认取全局配置;可覆盖 */
  cdnBase?: string;
  /** 慢加载阈值(ms),默认取全局配置 */
  slowLoadMs?: number;
  /** 全部来源失败后调用,入参为当前 img 元素(便于定位容器) */
  onTotalFailure?: (el: HTMLImageElement | null) => void;
};

const toWebp = (p: string) => p.replace(/\.jpg$/i, '.webp');

export function ResilientImage({
  localSrc,
  cdnBase = IMAGE_CDN_BASE,
  slowLoadMs = IMAGE_SLOW_FALLBACK_MS,
  onTotalFailure,
  ...rest
}: ResilientImageProps) {
  const base = cdnBase.replace(/\/+$/, '');
  // 来源链:启用 CDN 时优先 CDN,否则仅本地
  const sources = React.useMemo(() => {
    const local = [toWebp(localSrc), localSrc];
    return base
      ? [`${base}${toWebp(localSrc)}`, `${base}${localSrc}`, ...local]
      : local;
  }, [localSrc, base]);

  const [src, setSrc] = useState(sources[0]);
  const idxRef = useRef(0);
  const loadedRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  // 来源链变化时重置到链首
  useEffect(() => {
    idxRef.current = 0;
    loadedRef.current = false;
    setSrc(sources[0]);
  }, [sources]);

  // 慢加载兜底:每个来源独立计时,超时未加载完成则切到下一来源
  useEffect(() => {
    if (sources.length <= 1) return;
    timerRef.current = window.setTimeout(() => {
      if (loadedRef.current) return;
      if (idxRef.current < sources.length - 1) {
        idxRef.current += 1;
        setSrc(sources[idxRef.current]);
      }
    }, slowLoadMs);
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [sources, slowLoadMs, src]);

  const handleError = () => {
    if (idxRef.current < sources.length - 1) {
      idxRef.current += 1;
      setSrc(sources[idxRef.current]);
    } else {
      onTotalFailure?.(imgRef.current);
    }
  };

  const handleLoad = () => {
    loadedRef.current = true;
    if (timerRef.current) window.clearTimeout(timerRef.current);
  };

  return (
    <img
      ref={imgRef}
      src={src}
      {...rest}
      onError={handleError}
      onLoad={handleLoad}
    />
  );
}