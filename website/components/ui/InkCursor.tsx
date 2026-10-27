'use client';

import { useEffect, useRef } from 'react';

/**
 * 水墨光标涟漪效果 — 全面重新设计
 *
 * 三阶段水墨物理模拟:
 *   1. 墨滴撞击 (drop-impact)    — 中心实心墨点瞬间出现并轻微回弹
 *   2. 涟漪扩散 (ripple-wave x3)  — 三层波纹依次扩散,半径/速度/透明度递增
 *   3. 墨花溅射 (splash-particle) — 6 颗墨点向外飞溅,模拟液态飞溅
 *
 * 每次点击生成一个 container,内含 10 个子元素,动画结束后自动清除
 */

const RING_COUNT = 3;
const PARTICLE_COUNT = 6;
const PARTICLE_DISTANCE_MIN = 28;
const PARTICLE_DISTANCE_MAX = 52;

function isInteractive(target: HTMLElement): boolean {
  return !!(
    target.closest('button') ||
    target.closest('a') ||
    target.closest('input') ||
    target.closest('textarea') ||
    target.closest('select') ||
    target.closest('[role="button"]') ||
    target.closest('[data-no-ink-ripple]')
  );
}

export function InkCursor() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // 尊重减少动画偏好
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }

    // 触摸设备跳过(避免移动端误触)
    if (window.matchMedia('(pointer: coarse)').matches) {
      return;
    }

    const handleClick = (e: MouseEvent) => {
      if (isInteractive(e.target as HTMLElement)) return;

      const ripple = document.createElement('div');
      ripple.className = 'ink-ripple-container';
      ripple.style.left = `${e.clientX}px`;
      ripple.style.top = `${e.clientY}px`;

      // 1. 中心墨滴撞击
      const drop = document.createElement('span');
      drop.className = 'ink-drop-impact';
      ripple.appendChild(drop);

      // 2. 三层涟漪波纹(依次延迟扩散)
      for (let i = 0; i < RING_COUNT; i++) {
        const ring = document.createElement('span');
        ring.className = `ink-ripple-ring ink-ripple-ring--${i + 1}`;
        ripple.appendChild(ring);
      }

      // 3. 墨花溅射粒子(随机角度+距离)
      const baseAngle = Math.random() * Math.PI; // 每次点击随机旋转偏移
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const particle = document.createElement('span');
        particle.className = 'ink-splash-particle';
        const angle = baseAngle + (i / PARTICLE_COUNT) * Math.PI * 2;
        const dist = PARTICLE_DISTANCE_MIN + Math.random() * (PARTICLE_DISTANCE_MAX - PARTICLE_DISTANCE_MIN);
        const size = 2 + Math.random() * 3; // 2~5px
        particle.style.setProperty('--tx', `${Math.cos(angle) * dist}px`);
        particle.style.setProperty('--ty', `${Math.sin(angle) * dist}px`);
        particle.style.setProperty('--size', `${size}px`);
        particle.style.setProperty('--delay', `${i * 0.015}s`);
        ripple.appendChild(particle);
      }

      container.appendChild(ripple);

      // 所有动画结束后清除(取最长动画时间 1.2s + 缓冲)
      const cleanup = () => ripple.remove();
      ripple.addEventListener('animationend', cleanup);
      // 兜底:1.8s 后强制清除
      window.setTimeout(cleanup, 1800);
    };

    document.addEventListener('click', handleClick, { passive: true });
    return () => document.removeEventListener('click', handleClick);
  }, []);

  return <div ref={containerRef} className="pointer-events-none fixed inset-0 z-[9999]" aria-hidden="true" />;
}
