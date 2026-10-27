'use client';

import React from 'react';
import Link from 'next/link';
import { motion, useReducedMotion, useScroll, useTransform } from 'framer-motion';
import { CTA_LINKS, SITE } from '@/lib/site';
import { MagneticButton } from '@/components/ui/MagneticButton';
import { ResilientImage } from '@/components/ui/ResilientImage';
import { HERO_ART } from '@/lib/artworks';

/**
 * 首页 Hero 区(LCP 关键)
 * - 服务端直出文字,动效由客户端增强
 * - 保留三阶段水墨动画(墨滴落下 → 涟漪 → 散开墨团)
 * - 右侧水墨山水画作主视觉,增强第一眼艺术感与品牌识别
 * - 滚动视差:背景水墨晕染与画作随滚动以不同速度移动,营造深度
 * - 立体层次:水墨晕染 + 科技网格 + 玻璃信息卡 + 朱砂印章 + 山水画作
 */

const EASE = [0.22, 1, 0.36, 1] as const;

export function Hero() {
  const prefersReduced = useReducedMotion();
  const heroRef = React.useRef<HTMLDivElement>(null);
  // 滚动视差:整个 Hero 内容随滚动上移/淡出,背景层速度不同
  const { scrollYProgress } = useScroll({
    target: heroRef,
    offset: ['start start', 'end start'],
  });
  const contentY = useTransform(scrollYProgress, [0, 1], [0, 120]);
  const contentOpacity = useTransform(scrollYProgress, [0, 0.7], [1, 0]);
  const artY = useTransform(scrollYProgress, [0, 1], [0, -60]);
  const bgY = useTransform(scrollYProgress, [0, 1], [0, 200]);

  return (
    <section ref={heroRef} className="relative overflow-hidden bg-paper-100">
      {/* 背景层 1:水墨晕染(滚动视差,最慢) */}
      <motion.div
        style={prefersReduced ? undefined : { y: bgY }}
        className="pointer-events-none absolute inset-0"
        aria-hidden="true"
      >
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(ellipse 70% 50% at 75% 30%, rgba(26, 26, 26, 0.07) 0%, transparent 60%), radial-gradient(ellipse 50% 60% at 15% 80%, rgba(201, 169, 97, 0.1) 0%, transparent 55%), radial-gradient(ellipse 40% 50% at 90% 90%, rgba(200, 57, 46, 0.06) 0%, transparent 60%)',
          }}
        />
      </motion.div>

      {/* 背景层 2:科技感网格(极淡) */}
      <div className="grid-bg pointer-events-none absolute inset-0" aria-hidden="true" />

      {/* 背景层 3:顶部金色高光渐变 */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-1/2"
        aria-hidden="true"
        style={{
          background:
            'linear-gradient(180deg, rgba(201, 169, 97, 0.04) 0%, transparent 100%)',
        }}
      />

      {/* 三阶段水墨动画:墨滴落下 → 涟漪 → 散开墨团(右侧偏上位置) */}
      <div
        className="pointer-events-none absolute right-[18%] top-0 z-0 h-[60%] w-[40%] md:right-[22%]"
        aria-hidden="true"
      >
        <div className="hero-ink-drop" />
        <div className="hero-ink-ripple" />
      </div>

      {/* 右侧水墨主视觉:山水画作(滚动视差,替代纯 SVG 墨团) */}
      <motion.div
        style={prefersReduced ? undefined : { y: artY }}
        className="pointer-events-none absolute inset-0 z-0"
        aria-hidden="true"
      >
        <div className="hero-ink-bloom absolute inset-0">
          {/* 山水画作:右侧竖版,带宣纸边框与晕染效果 */}
          <div className="absolute right-0 top-1/2 hidden w-[44%] max-w-[560px] -translate-y-1/2 md:block">
            <div className="relative overflow-hidden rounded-lg border border-ink-100/40 shadow-ink-lg">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <ResilientImage
                localSrc={HERO_ART}
                alt="丹青有AI 水墨山水画作"
                className="aspect-[3/4] w-full object-cover"
                loading="eager"
                decoding="async"
              />
              {/* 宣纸内衬边框 */}
              <div className="pointer-events-none absolute inset-2 border border-paper-50/40" aria-hidden="true" />
              {/* 底部渐变遮罩 */}
              <div className="absolute inset-x-0 bottom-0 h-1/4 bg-gradient-to-t from-ink-900/40 to-transparent" />
              {/* 竖排题款 */}
              <div className="absolute bottom-4 right-4 text-right">
                <span
                  className="font-serif text-sm font-medium text-paper-50/90"
                  style={{ writingMode: 'vertical-rl', letterSpacing: '0.3em' }}
                >
                  山水·丹青
                </span>
              </div>
            </div>
            {/* 朱砂印章 */}
            <div className="hero-brand-emerge absolute -left-6 top-8 rotate-[-6deg]">
              <div className="flex h-16 w-16 items-center justify-center rounded-sm bg-cinnabar-500 shadow-ink">
                <span className="font-serif text-xl font-bold text-paper-50">DQ</span>
              </div>
            </div>
          </div>
        </div>
        {/* 竖排金色题款:丹青不渝 */}
        <div className="hero-brand-emerge pointer-events-none absolute right-[8%] top-[16%] hidden md:block">
          <span
            className="font-serif text-lg font-medium text-gold-600/80"
            style={{ writingMode: 'vertical-rl', letterSpacing: '0.4em' }}
          >
            丹青不渝
          </span>
        </div>
      </motion.div>

      {/* 右下角浮动玻璃信息卡(桌面端) */}
      <HeroStatsCard />

      {/* 主内容区(滚动视差:随滚动上移淡出) */}
      <motion.div
        style={prefersReduced ? undefined : { y: contentY, opacity: contentOpacity }}
        className="container-content relative z-10 flex min-h-[88vh] flex-col justify-center pt-12 pb-20 md:min-h-[92vh]"
      >
        <div className="max-w-3xl">
          {/* Eyebrow */}
          <div
            className="section-eyebrow opacity-0"
            style={{ animation: 'ink-fade-in 0.8s 0.1s cubic-bezier(0.22,1,0.36,1) forwards' }}
          >
            面向高校艺术教育的 AI 作业诊断系统
          </div>

          {/* English Tagline */}
          <motion.p
            initial={prefersReduced ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.15, ease: EASE }}
            className="mt-3 text-xs font-medium uppercase tracking-[0.3em] text-ink-300"
          >
            AI-Powered Art Education · Danqing You AI
          </motion.p>

          {/* 主标题:丹青有AI */}
          <motion.h1
            initial={prefersReduced ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, delay: 0.25, ease: EASE }}
            className="mt-4 text-display-xl font-semibold leading-[1.05] text-gradient-ink"
          >
            丹青有AI
            <span className="mt-2 block text-ink-700">
              让艺术教育<span className="text-gradient-cinnabar">更智能</span>
            </span>
          </motion.h1>

          {/* 核心功能速览:第一眼识别产品核心能力 */}
          <motion.div
            initial={prefersReduced ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, delay: 0.35, ease: EASE }}
            className="mt-6 flex flex-wrap items-center gap-2"
          >
            {['构图分析', '色彩分析', '笔触分析', '绘画 · 设计 · 雕塑'].map((k) => (
              <span
                key={k}
                className="inline-flex items-center rounded-full border border-ink-100/70 bg-paper-50/60 px-3 py-1 text-xs font-medium text-ink-600 backdrop-blur-sm"
              >
                {k}
              </span>
            ))}
          </motion.div>

          {/* Slogan 描述 */}
          <motion.p
            initial={prefersReduced ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, delay: 0.4, ease: EASE }}
            className="mt-6 max-w-xl text-lg leading-relaxed text-ink-500 md:text-xl"
          >
            以专业美院标准,3 秒智能分析绘画、设计、产品设计、雕塑四种创意形式的
            <span className="text-ink-800 font-medium">构图、色彩、笔触</span>。
            为教师减负,让学生成长可见。
          </motion.p>

          {/* CTA 双按钮 */}
          <motion.div
            initial={prefersReduced ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, delay: 0.55, ease: EASE }}
            className="mt-10 flex flex-col items-start gap-4 sm:flex-row sm:items-center"
          >
            <MagneticButton
              href={CTA_LINKS.trial}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary group"
              data-track="hero-cta-trial"
            >
              立即体验
              <span className="transition-transform duration-300 ease-ink group-hover:translate-x-1" aria-hidden="true">
                →
              </span>
            </MagneticButton>
            <Link href="/product" className="btn-secondary" data-track="hero-cta-learn">
              了解产品
            </Link>
          </motion.div>

          {/* 信任信号:卡片化 */}
          <motion.div
            initial={prefersReduced ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, delay: 0.7, ease: EASE }}
            className="mt-12 flex flex-wrap items-center gap-3"
          >
            <TrustBadge color="gold" label="3 秒级响应 SLA" />
            <span className="h-3 w-px bg-ink-200" aria-hidden="true" />
            <TrustBadge color="cinnabar" label="专业美院标准" />
            <span className="h-3 w-px bg-ink-200" aria-hidden="true" />
            <TrustBadge color="stone" label="四种创意形式" />
          </motion.div>
        </div>
      </motion.div>

      {/* 底部滚动提示 */}
      <div className="pointer-events-none absolute bottom-6 left-1/2 z-10 hidden -translate-x-1/2 flex-col items-center gap-2 text-ink-300 md:flex">
        <span className="text-[10px] tracking-[0.3em] uppercase">Scroll</span>
        <span className="h-10 w-px bg-gradient-to-b from-ink-300 to-transparent" />
      </div>
    </section>
  );
}

/**
 * 信任徽章:圆点 + 文字,带轻微玻璃感
 */
function TrustBadge({ color, label }: { color: 'gold' | 'cinnabar' | 'stone'; label: string }) {
  const dotColor = {
    gold: 'bg-gold-400',
    cinnabar: 'bg-cinnabar-400',
    stone: 'bg-stone-400',
  }[color];
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-ink-100/60 bg-paper-50/60 px-3 py-1.5 text-xs text-ink-600 backdrop-blur-sm">
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${dotColor}`} />
      {label}
    </span>
  );
}

/**
 * Hero 右下角浮动玻璃信息卡(桌面端)
 * 显示核心指标,增加视觉锚点与立体层次
 */
function HeroStatsCard() {
  return (
    <motion.div
      initial={false}
      animate={{ opacity: 1 }}
      transition={{ duration: 1, delay: 1, ease: EASE }}
      className="pointer-events-none absolute bottom-12 right-10 z-10 hidden opacity-0 lg:block"
      style={{ animation: 'ink-fade-in 1s 1s cubic-bezier(0.22,1,0.36,1) forwards' }}
      aria-hidden="true"
    >
      <div className="glass-card relative w-64 p-5">
        <div className="mb-4 flex items-center justify-between">
          <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-gold-600">
            实时指标
          </span>
          <span className="inline-flex h-1.5 w-1.5 rounded-full bg-cinnabar-400">
            <span className="absolute inline-flex h-1.5 w-1.5 animate-ping rounded-full bg-cinnabar-400 opacity-60" />
          </span>
        </div>
        <div className="space-y-3">
          <div className="flex items-baseline justify-between">
            <span className="text-xs text-ink-500">平均响应</span>
            <span className="font-serif text-lg font-semibold text-ink-900">
              2.8<span className="ml-0.5 text-xs text-ink-400">s</span>
            </span>
          </div>
          <div className="h-px bg-ink-100/60" />
          <div className="flex items-baseline justify-between">
            <span className="text-xs text-ink-500">本日分析</span>
            <span className="font-serif text-lg font-semibold text-ink-900">
              1,284<span className="ml-1 text-xs text-cinnabar-500">+12%</span>
            </span>
          </div>
          <div className="h-px bg-ink-100/60" />
          <div className="flex items-baseline justify-between">
            <span className="text-xs text-ink-500">服务高校</span>
            <span className="font-serif text-lg font-semibold text-ink-900">
              32<span className="ml-0.5 text-xs text-ink-400">所</span>
            </span>
          </div>
        </div>
        <div className="mt-4 -mb-1 text-right text-[9px] tracking-wider text-ink-300">
          {SITE.name}
        </div>
      </div>
    </motion.div>
  );
}