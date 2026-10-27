'use client';

import React from 'react';
import { motion, useReducedMotion, type Variants, type TargetAndTransition } from 'framer-motion';

type RevealVariant = 'up' | 'down' | 'left' | 'right' | 'none' | 'ink' | 'clip' | 'blur' | 'scale';

type RevealOnScrollProps = {
  children: React.ReactNode;
  /** 延迟(秒),用于错落入场 */
  delay?: number;
  /** 入场变体:
   *  - up/down/left/right/none: 方向性淡入位移(默认 up)
   *  - ink: 水墨晕染揭示(模糊+微缩放,适合标题/深色区块)
   *  - clip: 底部裁切揭示(适合画作/图片,似画卷展开)
   *  - blur: 纯模糊聚焦(极克制,适合数据卡)
   *  - scale: 轻缩放浮现(适合强调卡) */
  variant?: RevealVariant;
  /** 入场方向(up/down/left/right 时的位移距离) */
  distance?: number;
  className?: string;
  /** 是否只触发一次(默认是) */
  once?: boolean;
};

/** 各变体的 hidden/visible 参数表(与 RevealGroup 相同的 label 驱动模式) */
const VARIANTS: Record<
  RevealVariant,
  { hidden: TargetAndTransition; visible: TargetAndTransition; duration: number }
> = {
  up: { hidden: { opacity: 0, y: 24 }, visible: { opacity: 1, y: 0 }, duration: 0.7 },
  down: { hidden: { opacity: 0, y: -24 }, visible: { opacity: 1, y: 0 }, duration: 0.7 },
  left: { hidden: { opacity: 0, x: 24 }, visible: { opacity: 1, x: 0 }, duration: 0.7 },
  right: { hidden: { opacity: 0, x: -24 }, visible: { opacity: 1, x: 0 }, duration: 0.7 },
  none: { hidden: { opacity: 0 }, visible: { opacity: 1 }, duration: 0.7 },
  ink: {
    hidden: { opacity: 0, filter: 'blur(10px)', scale: 1.04 },
    visible: { opacity: 1, filter: 'blur(0px)', scale: 1 },
    duration: 1.1,
  },
  clip: {
    hidden: { opacity: 0, clipPath: 'inset(12% 6% 12% 6% round 8px)', y: 16 },
    visible: { opacity: 1, clipPath: 'inset(0% 0% 0% 0% round 8px)', y: 0 },
    duration: 1.0,
  },
  blur: {
    hidden: { opacity: 0, filter: 'blur(6px)' },
    visible: { opacity: 1, filter: 'blur(0px)' },
    duration: 0.9,
  },
  scale: {
    hidden: { opacity: 0, scale: 0.96 },
    visible: { opacity: 1, scale: 1 },
    duration: 0.8,
  },
};

/**
 * 滚动进入视口时揭示动画
 * 通过 variant 让全站入场动效差异化,避免"千篇一律的淡入上移"
 */
export function RevealOnScroll({
  children,
  delay = 0,
  variant = 'up',
  distance = 24,
  className = '',
  once = true,
}: RevealOnScrollProps) {
  const prefersReduced = useReducedMotion();

  const conf = VARIANTS[variant];
  // up/down/left/right 支持自定义距离(显式类型,避免复杂联合类型推断)
  const hidden: TargetAndTransition = { ...conf.hidden };
  if (variant === 'up') hidden.y = distance;
  else if (variant === 'down') hidden.y = -distance;
  else if (variant === 'left') hidden.x = distance;
  else if (variant === 'right') hidden.x = -distance;

  const variants: Variants = { hidden, visible: conf.visible };

  if (prefersReduced) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      className={className}
      variants={variants}
      initial="hidden"
      whileInView="visible"
      viewport={{ once, margin: '-80px 0px -80px 0px' }}
      transition={{
        duration: conf.duration,
        delay,
        ease: [0.22, 1, 0.36, 1],
      }}
    >
      {children}
    </motion.div>
  );
}
