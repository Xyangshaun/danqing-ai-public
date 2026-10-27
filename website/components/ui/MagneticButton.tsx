'use client';

import React, { useRef, useCallback } from 'react';
import { useReducedMotion } from 'framer-motion';

type MagneticButtonProps = {
  children: React.ReactNode;
  className?: string;
  href: string;
  target?: string;
  rel?: string;
  'data-track'?: string;
  /** 磁吸强度(像素),默认 6 */
  strength?: number;
};

/**
 * 磁吸按钮
 * - 鼠标悬停时按钮轻微跟随光标(磁吸效果)
 * - 内部高光光斑跟随光标位置(--mx/--my CSS 变量)
 * - 尊重 prefers-reduced-motion:降级为普通按钮
 */
export function MagneticButton({
  children,
  className = '',
  href,
  target,
  rel,
  'data-track': dataTrack,
  strength = 6,
}: MagneticButtonProps) {
  const ref = useRef<HTMLAnchorElement>(null);
  const prefersReduced = useReducedMotion();

  const handleMove = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>) => {
      if (!ref.current || prefersReduced) return;
      const rect = ref.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      // 磁吸位移:基于光标偏离中心的距离,做限幅
      const dx = ((x - cx) / cx) * strength;
      const dy = ((y - cy) / cy) * strength;
      ref.current.style.transform = `translate(${dx}px, ${dy}px)`;
      // 光斑位置(百分比)
      ref.current.style.setProperty('--mx', `${(x / rect.width) * 100}%`);
      ref.current.style.setProperty('--my', `${(y / rect.height) * 100}%`);
    },
    [prefersReduced, strength]
  );

  const handleLeave = useCallback(() => {
    if (!ref.current) return;
    ref.current.style.transform = 'translate(0, 0)';
  }, []);

  return (
    <a
      ref={ref}
      href={href}
      target={target}
      rel={rel}
      data-track={dataTrack}
      className={`btn-magnetic ${className}`}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
    >
      {children}
    </a>
  );
}
