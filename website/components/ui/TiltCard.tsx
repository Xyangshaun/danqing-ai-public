'use client';

import React, { useRef, useCallback } from 'react';
import { useReducedMotion } from 'framer-motion';

type TiltCardProps = {
  children: React.ReactNode;
  className?: string;
  /** 最大倾斜角度(度),默认 3 */
  max?: number;
};

/**
 * 3D 倾斜卡片
 * - 鼠标悬停时基于光标位置做 ≤3° 的 3D 视差倾斜
 * - 内置光斑高光跟随光标(--mx/--my CSS 变量驱动 .tilt-card-glow)
 * - 尊重 prefers-reduced-motion:降级为普通卡片
 * - 仅用 transform,不影响布局,性能友好
 */
export function TiltCard({ children, className = '', max = 3 }: TiltCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const prefersReduced = useReducedMotion();

  const handleMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!ref.current || prefersReduced) return;
      const rect = ref.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const px = x / rect.width;
      const py = y / rect.height;
      // 倾斜:光标在右侧 → 绕 Y 轴正向旋转;在下方 → 绕 X 轴负向旋转
      const rotateY = (px - 0.5) * 2 * max;
      const rotateX = -(py - 0.5) * 2 * max;
      ref.current.style.transform = `perspective(800px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
      ref.current.style.setProperty('--mx', `${px * 100}%`);
      ref.current.style.setProperty('--my', `${py * 100}%`);
    },
    [prefersReduced, max]
  );

  const handleLeave = useCallback(() => {
    if (!ref.current) return;
    ref.current.style.transform = 'perspective(800px) rotateX(0deg) rotateY(0deg)';
  }, []);

  return (
    <div
      ref={ref}
      className={`tilt-card ${className}`}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
    >
      <div className="tilt-card-glow" aria-hidden="true" />
      {children}
    </div>
  );
}
