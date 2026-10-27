'use client';

import { useEffect, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { usePathname } from 'next/navigation';
import dynamic from 'next/dynamic';

/**
 * 全屏水墨入场动画
 *
 * 采用 Canvas 物理模拟:
 * - 墨滴受重力坠落,撞击水面产生动态涟漪与墨团晕染
 * - 卫星墨滴飞溅、墨丝拖尾、品牌印章浮现
 * - 所有物理参数集中在 InkLoaderCanvas.PHYSICS_CONFIG 中
 *
 * 三阶段状态机: animating → fading → done
 */

type LoaderPhase = 'animating' | 'fading' | 'done';

const ANIMATION_DURATION = 2200; // 动画展示时长(与 Canvas 物理时序匹配)
const FADE_DURATION = 600;       // 淡出过渡时长

// 动态导入 Canvas 组件,避免 SSR 问题并减少首屏 bundle
const InkLoaderCanvas = dynamic(
  () => import('./InkLoaderCanvas').then((mod) => mod.InkLoaderCanvas),
  { ssr: false }
);

export function InkLoader() {
  const [phase, setPhase] = useState<LoaderPhase>('animating');
  const prefersReduced = useReducedMotion();
  const pathname = usePathname();

  useEffect(() => {
    // 首页由 VideoIntro 开场动画(笔触划出 + 品牌 + 状态条 + 步骤 + 数据)承担全屏入场,
    // 此处跳过 Canvas 加载动画,避免与开场叠加为"双层开场"。
    if (pathname === '/' || prefersReduced) {
      setPhase('done');
      return;
    }

    const fadeTimer = window.setTimeout(() => {
      setPhase('fading');
    }, ANIMATION_DURATION);

    const doneTimer = window.setTimeout(() => {
      setPhase('done');
    }, ANIMATION_DURATION + FADE_DURATION);

    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(doneTimer);
    };
  }, [pathname, prefersReduced]);

  if (phase === 'done') return null;

  return (
    <div
      className={`ink-loader ${phase === 'fading' ? 'is-fading' : ''}`}
      role="status"
      aria-label="正在加载丹青有AI"
    >
      <InkLoaderCanvas phase={phase} />
    </div>
  );
}
