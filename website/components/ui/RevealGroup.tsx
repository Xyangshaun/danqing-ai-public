'use client';

import React from 'react';
import { motion, useReducedMotion, useScroll, useTransform, Variants } from 'framer-motion';

/**
 * 交错入场容器 + 子项
 * 基于 Framer Motion staggerChildren 实现错落入场,避免逐项计算 delay。
 * 核心价值:一容器触发,全部子项按节奏依次浮现。
 */

export const EASE = [0.22, 1, 0.36, 1] as const;

export const containerVariants: Variants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.05,
    },
  },
};

export const itemVariants: Variants = {
  hidden: { opacity: 0, y: 24 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.7, ease: EASE },
  },
};

type RevealGroupProps = {
  children: React.ReactNode;
  className?: string;
  /** 交错间隔(秒) */
  stagger?: number;
  /** 是否只触发一次 */
  once?: boolean;
};

/**
 * 交错入场容器
 * 用法: <RevealGroup><RevealItem>...</RevealItem>...</RevealGroup>
 */
export function RevealGroup({ children, className = '', stagger = 0.1, once = true }: RevealGroupProps) {
  const prefersReduced = useReducedMotion();
  if (prefersReduced) return <div className={className}>{children}</div>;

  const variants: Variants = {
    hidden: {},
    visible: {
      transition: { staggerChildren: stagger, delayChildren: 0.05 },
    },
  };

  return (
    <motion.div
      className={className}
      variants={variants}
      initial="hidden"
      whileInView="visible"
      viewport={{ once, margin: '-80px 0px -80px 0px' }}
    >
      {children}
    </motion.div>
  );
}

type RevealItemVariant = 'up' | 'ink' | 'scale' | 'blur';

type RevealItemProps = {
  children: React.ReactNode;
  className?: string;
  /** 子项位移距离 */
  distance?: number;
  /** 入场变体:up=位移淡入(默认) / ink=水墨晕染 / scale=轻缩放 / blur=模糊聚焦 */
  variant?: RevealItemVariant;
};

/**
 * 交错入场子项(需包裹在 RevealGroup 内)
 */
export function RevealItem({
  children,
  className = '',
  distance = 24,
  variant = 'up',
}: RevealItemProps) {
  const prefersReduced = useReducedMotion();
  if (prefersReduced) return <div className={className}>{children}</div>;

  // 各变体:ink=水墨晕染(模糊+微缩放),scale=轻缩放浮现,blur=纯模糊聚焦,up=位移淡入
  const variants: Variants =
    variant === 'ink'
      ? {
          hidden: { opacity: 0, y: 16, filter: 'blur(10px)', scale: 1.04 },
          visible: {
            opacity: 1,
            y: 0,
            filter: 'blur(0px)',
            scale: 1,
            transition: { duration: 0.9, ease: EASE },
          },
        }
      : variant === 'scale'
        ? {
            hidden: { opacity: 0, scale: 0.96 },
            visible: { opacity: 1, scale: 1, transition: { duration: 0.8, ease: EASE } },
          }
        : variant === 'blur'
          ? {
              hidden: { opacity: 0, filter: 'blur(6px)' },
              visible: { opacity: 1, filter: 'blur(0px)', transition: { duration: 0.9, ease: EASE } },
            }
          : {
              hidden: { opacity: 0, y: distance },
              visible: { opacity: 1, y: 0, transition: { duration: 0.7, ease: EASE } },
            };

  return (
    <motion.div className={className} variants={variants}>
      {children}
    </motion.div>
  );
}

type ParallaxProps = {
  children: React.ReactNode;
  className?: string;
  /** 视差位移范围(px),默认 60 */
  distance?: number;
  /** 视差触发方向 */
  direction?: 'up' | 'down';
};

/**
 * 滚动视差容器
 * 背景层以不同速度移动,营造深度。基于 useScroll + useTransform。
 */
export function Parallax({ children, className = '', distance = 60, direction = 'up' }: ParallaxProps) {
  const ref = React.useRef<HTMLDivElement>(null);
  const prefersReduced = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start end', 'end start'],
  });

  const y = useTransform(
    scrollYProgress,
    [0, 1],
    [direction === 'up' ? distance : -distance, direction === 'up' ? -distance : distance]
  );

  if (prefersReduced) return <div className={className}>{children}</div>;

  return (
    <motion.div ref={ref} style={{ y }} className={className}>
      {children}
    </motion.div>
  );
}