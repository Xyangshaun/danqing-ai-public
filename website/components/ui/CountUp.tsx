'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useInView, useReducedMotion, useMotionValue, useSpring } from 'framer-motion';

/**
 * 数字滚动动画
 * 元素进入视口时,数字从 0 递增到目标值,带缓动。
 * 基于的 useSpring 提供物理缓动,滚动到目标值即止。
 * 尊重 prefers-reduced-motion:直接显示目标值。
 */

type CountUpProps = {
  /** 目标数值 */
  value: number;
  /** 后缀(如 %、+、万+) */
  suffix?: string;
  /** 计数时长(秒),默认 1.6 */
  duration?: number;
  className?: string;
  /** 小数位 */
  decimals?: number;
};

export function CountUp({ value, suffix = '', duration = 1.6, className = '', decimals = 0 }: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: '-60px 0px -60px 0px' });
  const prefersReduced = useReducedMotion();
  const [display, setDisplay] = useState(0);

  const motionValue = useMotionValue(0);
  const spring = useSpring(motionValue, {
    duration, // framer-motion spring 的 duration 单位为秒
    bounce: 0,
  });

  useEffect(() => {
    if (inView) {
      motionValue.set(value);
    }
  }, [inView, value, motionValue]);

  useEffect(() => {
    const unsubscribe = spring.on('change', (latest) => {
      setDisplay(Number(latest.toFixed(decimals)));
    });
    return unsubscribe;
  }, [spring, decimals]);

  // 减少动画偏好:直接显示目标值
  const finalValue = prefersReduced ? value : display;

  return (
    <span ref={ref} className={className}>
      {finalValue.toLocaleString('zh-CN')}
      {suffix}
    </span>
  );
}