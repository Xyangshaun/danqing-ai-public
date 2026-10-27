'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import paintingMeta from '@/lib/painting-meta.json';
import { ResilientImage } from '@/components/ui/ResilientImage';

/**
 * VideoIntro · v8 宣纸长卷 · 一河两岸
 *
 * 设计:沿一条隐形的「S 形负空间」将 13 张画作分置于东西两岸。
 * 中央品牌区是「手卷正中题跋」。东方/东亚在左岸与上方,西方在右岸与下方。
 *
 * 关键升级:
 *  1) 真实 ratio 来自 build 时 scan-paintings.mjs 生成的 painting-meta.json
 *  2) 6 种 shape 变体(scroll-horizontal / arched-portrait / arch / round-fan / fan / seal / scroll-thin)
 *  3) BASE_OPACITY 0.40 / BASE_BLUR 2.8px(静止时退居景深背景不抢中心,鼠标靠近点亮清晰)
 *  4) 边缘虚化:多 stop radial 过渡 + 边角渗墨柔晕
 *  5) 题跋式文字:SVG 笔触划出 + 朱砂落款
 *  6) 画作交错入场:0.25s 起每张延迟 55ms 淡入上浮,如长卷徐徐展开
 */

const TOTAL_MS = 4500; // 开场动画总时长(4.5s:编排 ~2.9s 落齐后停留欣赏,最后 0.5s 退出)

type PaintingShape =
  | 'scroll-horizontal'
  | 'arched-portrait'
  | 'arch'
  | 'round-fan'
  | 'fan'
  | 'seal'
  | 'scroll-thin';

type IntroPainting = {
  src: string;
  alt: string;
  /** 视口水平百分比(0-100) */
  x: string;
  /** 视口垂直百分比(0-100) */
  y: string;
  /** 显示宽度 px;高度 = width / ratio(从图本身读取) */
  size: number;
  /** 旋转角度 deg */
  rotate: number;
  shape: PaintingShape;
  /** 岸位标识,纯说明,不影响布局 */
  bank: 'east' | 'west' | 'bridge';
};

type Meta = Record<string, { w: number; h: number; ratio: number }>;

/**
 * 13 张画作在「S 形长卷」上的位置(东岸 6 + 顶部桥 1 + 西岸 6)。
 * 全部使用真实 ratio 渲染。布局避免遮挡中央品牌区(30-70% x · 38-64% y)。
 */
const INTRO_PAINTINGS: IntroPainting[] = [
  // ================ 东岸(中国/东亚 + 卷首卷尾):左侧与上方 ================
  // 1. 水墨山水 · 卷首(左岸顶部)
  { src: '/images/gallery-hero.jpg',     alt: '水墨山水',           x: '10%', y: '15%', size: 230, rotate: -8,  shape: 'scroll-horizontal', bank: 'east' },
  // 2. 花鸟 · 小品点缀
  { src: '/images/gallery-flower.jpg',   alt: '花鸟',               x: '27%', y: '5%',  size: 160, rotate: 6,   shape: 'fan',              bank: 'east' },
  // 3. 荷塘 · 左岸中
  { src: '/images/gallery-lotus.jpg',    alt: '荷塘',               x: '5%',  y: '40%', size: 200, rotate: -4,  shape: 'round-fan',        bank: 'east' },
  // 4. 雕塑 · 内圈(印章方)
  { src: '/images/gallery-sculpture.jpg',alt: '雕塑 · 形神兼备',    x: '23%', y: '58%', size: 180, rotate: 5,   shape: 'seal',             bank: 'east' },
  // 5. 山峦 · 左岸下
  { src: '/images/gallery-mountain.jpg', alt: '山峦',               x: '10%', y: '83%', size: 220, rotate: -3,  shape: 'scroll-horizontal',bank: 'east' },
  // 6. 神奈川冲浪里 · 葛饰北斋 · 长卷条
  { src: '/images/gallery-greavewave.jpg',alt: '神奈川冲浪里 · 葛饰北斋', x: '34%', y: '23%', size: 210, rotate: 4, shape: 'scroll-thin',  bank: 'east' },

  // ================ 顶部桥(中性,横跨东西):长卷水波 ================
  // 7. 日出·印象 · 顶部桥(莫奈属印象派,放在中线桥上)
  { src: '/images/gallery-sunrise.jpg',  alt: '日出·印象 · 莫奈',  x: '50%', y: '3%',  size: 200, rotate: 0,   shape: 'arch',             bank: 'bridge' },

  // ================ 西岸(西方经典):右侧与下方 ================
  // 8. 星夜 · 梵高 · 西岸顶部(主锚)
  { src: '/images/gallery-starrynight.jpg',alt: '星夜 · 梵高',       x: '65%', y: '13%', size: 280, rotate: 6,   shape: 'scroll-horizontal',bank: 'west' },
  // 9. 蒙娜丽莎 · 达·芬奇(竖幅肖像)
  { src: '/images/gallery-monalisa.jpg',alt: '蒙娜丽莎 · 达·芬奇',  x: '88%', y: '16%', size: 200, rotate: -5,  shape: 'arched-portrait',  bank: 'west' },
  // 10. 贺拉斯兄弟之誓 · 大卫(横卷)
  { src: '/images/gallery-horatii.jpg', alt: '贺拉斯兄弟之誓 · 大卫',x: '92%', y: '47%', size: 200, rotate: 4,  shape: 'scroll-horizontal',bank: 'west' },
  // 11. 思想者 · 罗丹(印章方)
  { src: '/images/gallery-thinker.jpg', alt: '思想者 · 罗丹',       x: '95%', y: '66%', size: 180, rotate: -6,  shape: 'seal',             bank: 'west' },
  // 12. 睡莲 · 莫奈(近方)
  { src: '/images/gallery-waterlilies.jpg',alt: '睡莲 · 莫奈',      x: '76%', y: '73%', size: 240, rotate: 5,   shape: 'round-fan',        bank: 'west' },
  // 13. 倒牛奶的女仆 · 维米尔
  { src: '/images/gallery-pearl.jpg',   alt: '倒牛奶的女仆 · 维米尔',x: '88%', y: '87%', size: 180, rotate: -3,  shape: 'arch',             bank: 'west' },
];

/**
 * 6+ 种形状变体的 border-radius + 边缘虚化 mask。
 * 共同原则:多 stop radial 过渡,中间实色区更窄,让边缘羽化更柔。
 */
const SHAPE_STYLES: Record<PaintingShape, { radius: string; mask: string }> = {
  // 横卷:木轴风格
  'scroll-horizontal': {
    radius: '6px 22px 6px 22px / 4px 18px 4px 18px',
    mask:
      'radial-gradient(ellipse 90% 72% at 50% 50%, black 30%, black 70%, transparent 92%)',
  },
  // 拱形竖幅(教堂尖拱)
  arch: {
    radius: '50% 50% 2px 2px / 28% 28% 2px 2px',
    mask:
      'radial-gradient(ellipse 80% 90% at 50% 50%, black 30%, black 75%, transparent 96%)',
  },
  // 顶部圆拱(肖像画框)
  'arched-portrait': {
    radius: '50% 50% 4px 4px / 18% 18% 4px 4px',
    mask:
      'radial-gradient(ellipse 78% 86% at 50% 44%, black 25%, black 72%, transparent 95%)',
  },
  // 团扇:圆右下角切平
  'round-fan': {
    radius: '50% 50% 50% 8% / 50% 50% 50% 14%',
    mask:
      'radial-gradient(circle 78% at 50% 50%, black 35%, black 76%, transparent 96%)',
  },
  // 折扇:上方平,下方半圆
  fan: {
    radius: '8% 8% 50% 50% / 6% 6% 38% 38%',
    mask:
      'linear-gradient(to bottom, transparent 0%, black 18%, black 78%, transparent 96%)',
  },
  // 印章:方,带轻微撕纸
  seal: {
    radius: '10% 10% 10% 10% / 7% 7% 7% 7%',
    mask:
      'linear-gradient(to right, transparent 0%, black 6%, black 94%, transparent 100%), linear-gradient(to bottom, transparent 0%, black 5%, black 95%, transparent 100%)',
  },
  // 北斋长条(葛饰北斋专用)
  'scroll-thin': {
    radius: '4px 28px 4px 28px / 4px 22px 4px 22px',
    mask:
      'radial-gradient(ellipse 92% 78% at 50% 50%, black 40%, black 80%, transparent 97%)',
  },
};

/**
 * 获取 src 对应的真实 ratio(优先用 naturalWidth/Height 修正)。
 * SSR 阶段使用 JSON 静态值,useEffect 中再以 img.onLoad 精确化。
 */
function getRatio(src: string, meta: Meta): number {
  return meta[src]?.ratio ?? 1;
}

/**
 * 光标感应名作层。
 * 13 张画作以 S 形两岸分布,基线退居景深(BASE_OPACITY 0.40 / BASE_BLUR 2.8px,不抢中央品牌区),
 * 鼠标靠近按距离渐显提亮 + 轻微放大 + 去模糊;离开后 lerp 缓慢回落。
 */
function IntroPaintings({ active }: { active: boolean }) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const mouseRef = useRef({ x: -9999, y: -9999, active: false });
  const rafRef = useRef<number | null>(null);
  const cacheRef = useRef<Array<{ el: HTMLElement; cx: number; cy: number }>>([]);

  // ================ 性能日志状态(排查流畅度) ================
  // 默认开发环境开启;生产需 URL 加 ?perf=1 临时打开。日志用 console.groupCollapsed
  // 折叠,避免污染 console;关键指标:帧耗时、mousemove 触发间隔、显隐跨阈值延迟、cache 刷新耗时。
  const perfEnabled = useRef(false);
  const lastMoveLoggedAt = useRef(0); // 节流:mousemove 触发日志最大 200ms/次
  const lastReveal = useRef<number[]>([]); // 每张画作上一次 reveal,用于跨阈值打点
  const perfStats = useRef({
    moveCount: 0,
    lastMoveAt: 0,
    moveGapMax: 0,
    moveGapSum: 0,
    frameCount: 0,
    frameCostSum: 0,
    frameCostMax: 0,
    slowFrames: 0, // 单帧 loop 耗时 > 16ms
    activeFrames: 0, // mouseActive=true 的帧数
    emptyFrames: 0, // mouseActive=false 的"空跑"帧数
    activatedAt: 0, // mouseActive 切换为 true 的时刻
    firstRevealAt: 0, // 激活后第一张画作 reveal 跨过 0.5 的时刻
    nextSummaryAt: 0, // 下一次汇总日志时间
  });
  // 单条折叠日志:展开后能看到完整触发链路
  const perfLog = (title: string, payload?: Record<string, unknown>) => {
    if (!perfEnabled.current || typeof console === 'undefined') return;
    const t = performance.now();
    // eslint-disable-next-line no-console
    console.groupCollapsed(`[perf] ${title} @${t.toFixed(1)}ms`);
    if (payload) {
      // eslint-disable-next-line no-console
      Object.entries(payload).forEach(([k, v]) => console.log(k, v));
    }
    // eslint-disable-next-line no-console
    console.groupEnd();
  };

  useEffect(() => {
    // 1) 决定是否启用 perf 日志:开发环境默认开;生产需 ?perf=1
    if (typeof window !== 'undefined') {
      const isDev = process.env.NODE_ENV !== 'production';
      const want = new URLSearchParams(window.location.search).get('perf') === '1';
      perfEnabled.current = isDev || want;
    }
    if (!active) return;
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const REVEAL_RADIUS = 340; // 光标感应半径 px
    const LERP = 0.14; // 跟随/淡出速度
    const BASE_OPACITY = 0.4; // 基础可见度(可见但不抢中央品牌区)
    const BASE_BLUR = 2.8; // 基础模糊(景深退居背景,突出中央题跋)
    const SLOW_FRAME_MS = 16; // 60fps 单帧预算
    const SUMMARY_INTERVAL_MS = 2000; // 每 2s 汇总一次帧指标
    const MOVE_LOG_THROTTLE = 200; // mousemove 触发日志节流

    // 初始化 lastReveal
    lastReveal.current = new Array(INTRO_PAINTINGS.length).fill(0);

    const refreshCache = () => {
      const t0 = performance.now();
      const items: Array<{ el: HTMLElement; cx: number; cy: number }> = [];
      wrapper.querySelectorAll<HTMLElement>('.intro-painting').forEach((el) => {
        const rect = el.getBoundingClientRect();
        items.push({
          el,
          cx: rect.left + rect.width / 2,
          cy: rect.top + rect.height / 2,
        });
      });
      cacheRef.current = items;
      const cost = performance.now() - t0;
      perfLog('refreshCache', {
        count: items.length,
        costMs: +cost.toFixed(2),
      });
    };

    const onMove = (e: MouseEvent | TouchEvent) => {
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
      const t = performance.now();
      const wasActive = mouseRef.current.active;
      mouseRef.current = { x: clientX, y: clientY, active: true };

      // 统计:触发计数 + 与上一次触发的间隔(用旧值算,再更新)
      const s = perfStats.current;
      let gapMs = 0;
      s.moveCount += 1;
      if (s.lastMoveAt > 0) {
        gapMs = t - s.lastMoveAt;
        s.moveGapSum += gapMs;
        if (gapMs > s.moveGapMax) s.moveGapMax = gapMs;
      }
      s.lastMoveAt = t;

      // 触发"激活"延迟:从 inactive 切到 active,记录时刻(用于算首张显隐延迟)
      if (!wasActive) {
        s.activatedAt = t;
        s.firstRevealAt = 0;
      }

      // 节流打点:每 200ms 输出一条触发记录
      if (t - lastMoveLoggedAt.current > MOVE_LOG_THROTTLE) {
        lastMoveLoggedAt.current = t;
        perfLog('mousemove', {
          x: clientX,
          y: clientY,
          count: s.moveCount,
          gapMsSinceLast: +gapMs.toFixed(2),
          gapMax: +s.moveGapMax.toFixed(2),
        });
      }
    };
    const onLeave = () => {
      const wasActive = mouseRef.current.active;
      mouseRef.current.active = false;
      if (wasActive) {
        const s = perfStats.current;
        const t = performance.now();
        if (s.activatedAt > 0 && s.firstRevealAt > 0) {
          perfLog('mouseActive→false', {
            activeDurationMs: +(t - s.activatedAt).toFixed(2),
            firstRevealDelayMs: +(s.firstRevealAt - s.activatedAt).toFixed(2),
            moveCount: s.moveCount,
          });
        }
        // 离开时重置统计
        s.activatedAt = 0;
        s.firstRevealAt = 0;
        s.lastMoveAt = 0;
        s.moveGapMax = 0;
        s.moveGapSum = 0;
        s.moveCount = 0;
        lastReveal.current = new Array(INTRO_PAINTINGS.length).fill(0);
      }
    };

    const loop = () => {
      const frameStart = performance.now();
      const { x, y, active: mouseActive } = mouseRef.current;
      const s = perfStats.current;

      // 上一次帧耗时(用于上一帧结束点;当前帧数据在循环末尾汇总)
      if (s.frameCount > 0 && frameStart - s.nextSummaryAt > SUMMARY_INTERVAL_MS) {
        // 每 2s 输出一次帧统计
        const avg = s.frameCostSum / s.frameCount;
        perfLog('frame-summary', {
          frames: s.frameCount,
          avgCostMs: +avg.toFixed(2),
          maxCostMs: +s.frameCostMax.toFixed(2),
          slowFrames: s.slowFrames, // > 16ms
          slowRatio: +(s.slowFrames / s.frameCount).toFixed(3),
          activeFrames: s.activeFrames,
          emptyFrames: s.emptyFrames,
        });
        s.frameCount = 0;
        s.frameCostSum = 0;
        s.frameCostMax = 0;
        s.slowFrames = 0;
        s.activeFrames = 0;
        s.emptyFrames = 0;
        s.nextSummaryAt = frameStart;
      }
      s.nextSummaryAt = s.nextSummaryAt || frameStart + SUMMARY_INTERVAL_MS;
      s.frameCount += 1;
      if (mouseActive) s.activeFrames += 1;
      else s.emptyFrames += 1;

      // =============== 画作显隐计算 ===============
      const revealNow: number[] = [];
      for (let i = 0; i < cacheRef.current.length; i += 1) {
        const p = cacheRef.current[i];
        let reveal = 0;
        if (mouseActive) {
          const dist = Math.hypot(x - p.cx, y - p.cy);
          if (dist < REVEAL_RADIUS) {
            reveal = 1 - dist / REVEAL_RADIUS;
            reveal = Math.pow(reveal, 0.9);
          }
        }
        revealNow.push(reveal);

        // 跨阈值打点:0→0.5 记"进入高显区";0.5→0 记"离开高显区"
        const prev = lastReveal.current[i] ?? 0;
        if (prev < 0.5 && reveal >= 0.5) {
          const t = performance.now();
          if (s.activatedAt > 0 && s.firstRevealAt === 0) {
            s.firstRevealAt = t;
            perfLog('first-reveal-0.5', {
              index: i,
              alt: INTRO_PAINTINGS[i].alt,
              delayMs: +(t - s.activatedAt).toFixed(2),
            });
          } else {
            perfLog('reveal-in', {
              index: i,
              alt: INTRO_PAINTINGS[i].alt,
              dist: +Math.hypot(x - p.cx, y - p.cy).toFixed(1),
            });
          }
        } else if (prev >= 0.5 && reveal < 0.5) {
          perfLog('reveal-out', {
            index: i,
            alt: INTRO_PAINTINGS[i].alt,
          });
        }
        lastReveal.current[i] = reveal;

        const target = BASE_OPACITY + (1 - BASE_OPACITY) * reveal;
        const current = parseFloat(
          p.el.style.getPropertyValue('--p-opacity') || String(BASE_OPACITY)
        );
        const next = current + (target - current) * LERP;

        // 性能优化:仅当值发生明显变化时才写入 style。
        // blur 是昂贵的合成属性,鼠标静止/已收敛时不再每帧改写,避免持续触发布层重合成导致的卡顿。
        if (Math.abs(next - current) > 0.0005) {
          const scale = 0.98 + next * 0.08;
          const blur = Math.max(0, BASE_BLUR - next * BASE_BLUR);
          p.el.style.setProperty('--p-opacity', next.toFixed(4));
          p.el.style.setProperty('--p-scale', scale.toFixed(4));
          p.el.style.setProperty('--p-blur', `${blur.toFixed(1)}px`);
        }
      }

      // =============== 帧渲染耗时统计 ===============
      const frameEnd = performance.now();
      const frameCost = frameEnd - frameStart;
      s.frameCostSum += frameCost;
      if (frameCost > s.frameCostMax) s.frameCostMax = frameCost;
      if (frameCost > SLOW_FRAME_MS) s.slowFrames += 1;

      rafRef.current = requestAnimationFrame(loop);
    };

    perfStats.current.nextSummaryAt = 0;
    refreshCache();
    window.addEventListener('resize', refreshCache);
    window.addEventListener('mousemove', onMove, { passive: true });
    window.addEventListener('mouseleave', onLeave);
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onLeave);
    rafRef.current = requestAnimationFrame(loop);
    perfLog('mount', { active: true, paintingCount: INTRO_PAINTINGS.length });

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', refreshCache);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseleave', onLeave);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onLeave);
      perfLog('unmount');
    };
  }, [active]);

  return (
    <div
      ref={wrapperRef}
      className="intro-paintings-layer absolute inset-0 z-[1] pointer-events-none overflow-hidden"
    >
      {INTRO_PAINTINGS.map((p, i) => {
        const shape = SHAPE_STYLES[p.shape];
        const ratio = getRatio(p.src, paintingMeta as Meta);
        return (
          <div
            key={`${p.src}-${i}`}
            className="intro-painting"
            data-shape={p.shape}
            data-bank={p.bank}
            style={{
              left: p.x,
              top: p.y,
              width: p.size,
              height: Math.round(p.size / ratio),
              '--p-rotate': `${p.rotate}deg`,
              borderRadius: shape.radius,
              maskImage: shape.mask,
              WebkitMaskImage: shape.mask,
            } as React.CSSProperties}
          >
            <ResilientImage
              localSrc={p.src}
              alt={p.alt}
              className="intro-painting-enter w-full h-full object-cover"
              style={{ animationDelay: `${250 + i * 55}ms` } as React.CSSProperties}
              draggable={false}
              loading="eager"
              decoding="async"
              onTotalFailure={(el) => {
                // 所有来源(CDN+本地,webp+jpg)都失败时隐藏该画作,避免破碎占位框
                const painting = el?.closest(
                  '.intro-painting'
                ) as HTMLElement | null;
                if (painting) painting.style.display = 'none';
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

/**
 * 首页开场动画 — 宣纸长卷 · 一河两岸(v8)
 *
 * 主题感来源:
 *  - S 形负空间:13 张画作两岸分布,中央品牌区是「手卷正中题跋」
 *  - 朱砂落款:中央品牌区下方有一方朱砂小印,东方绘画的落款语言
 *  - 笔触划出:中央 SVG 长笔触,1s 划出后淡化为题跋线
 *  - 顶部水波线:暗示手卷首尾的水波,卷首/卷尾各有极淡晕染
 *
 * SSR/CSR 一致:所有入场动画使用 CSS keyframes;不依赖 framer-motion 的 initial/animate。
 */
export function VideoIntro({ onComplete }: { onComplete: () => void }) {
  const prefersReduced = useReducedMotion();
  const doneRef = useRef(false);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    const params =
      typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search)
        : new URLSearchParams();
    const slowParam = parseFloat(params.get('slow') || '1');
    const paused = params.get('pause') === '1';
    const slow = Number.isFinite(slowParam) && slowParam > 0 ? slowParam : 1;

    if (paused) return;

    const total = TOTAL_MS * slow;
    const exitTimer = window.setTimeout(() => setExiting(true), total - 500);
    const doneTimer = window.setTimeout(() => {
      if (doneRef.current) return;
      doneRef.current = true;
      onComplete();
    }, total);

    return () => {
      window.clearTimeout(exitTimer);
      window.clearTimeout(doneTimer);
    };
  }, [onComplete]);

  const reducedClass = prefersReduced ? 'intro-reduced' : '';

  // 用户点击"跳过":立即播放退出淡出,短暂后完成开屏(bypass 剩余动画与计时)
  const handleSkip = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    setExiting(true);
    window.setTimeout(onComplete, 350);
  };

  return (
    <>
      <style>{`
        @keyframes intro-fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes intro-slide-up {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes intro-stroke-draw {
          from { stroke-dashoffset: 1000; }
          to { stroke-dashoffset: 0; }
        }
        @keyframes intro-fade-in-up {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        /* 题跋线:从中心 0% 扩展到 100% */
        @keyframes intro-inscription-draw {
          from { transform: scaleX(0); }
          to { transform: scaleX(1); }
        }
        /* 朱砂方印:scale 0→1 + 微微弹跳 */
        @keyframes intro-seal-pop {
          0%   { transform: scale(0) rotate(-8deg); opacity: 0; }
          60%  { transform: scale(1.12) rotate(-4deg); opacity: 1; }
          100% { transform: scale(1) rotate(-4deg); opacity: 1; }
        }
        /* 画作交错入场:内层 img 一次性淡入上浮(与父级 JS 透明度/模糊正交,互不干扰) */
        @keyframes intro-painting-enter {
          from { opacity: 0; transform: translateY(14px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .intro-painting-enter {
          opacity: 0;
          animation: intro-painting-enter 0.65s cubic-bezier(0.22, 1, 0.36, 1) both;
        }

        /* 卷首卷尾晕染:缓慢呼吸 */
        @keyframes intro-paper-breathe {
          0%, 100% { opacity: 0.5; }
          50%      { opacity: 0.8; }
        }

        .intro-overlay {
          transition:
            opacity 0.55s cubic-bezier(0.22, 1, 0.36, 1),
            transform 0.55s cubic-bezier(0.22, 1, 0.36, 1),
            filter 0.55s cubic-bezier(0.22, 1, 0.36, 1);
          transform-origin: center center;
        }
        .intro-overlay.intro-exit {
          opacity: 0;
          transform: scale(1.03);
          filter: blur(3px);
        }

        .intro-painting {
          position: absolute;
          pointer-events: none;
          opacity: var(--p-opacity, 0.4);
          transform: translate(-50%, -50%) scale(var(--p-scale, 0.98)) rotate(var(--p-rotate, 0deg));
          filter: blur(var(--p-blur, 2.8px)) saturate(0.92);
          box-shadow:
            0 12px 32px -12px rgba(31, 28, 24, 0.22),
            0 0 0 1px rgba(26, 26, 26, 0.04);
          /* 性能:不用 will-change: filter(blur 为最贵合成属性,常驻会拖累 GPU);
             仅保留 transform/opacity 的层提升 */
          will-change: opacity, transform;
          /* border-radius / mask-image 由 inline style 根据 shape 动态设置 */
        }

        /* 减弱动效:所有子元素直接显示,不播放动画 */
        .intro-reduced .intro-layer,
        .intro-reduced .intro-stroke,
        .intro-reduced .intro-brand,
        .intro-reduced .intro-subtitle,
        .intro-reduced .intro-step,
        .intro-reduced .intro-stat,
        .intro-reduced .intro-inscription,
        .intro-reduced .intro-seal,
        .intro-reduced .intro-paper-edge,
        .intro-reduced .intro-painting-enter {
          opacity: 1 !important;
          transform: none !important;
          animation: none !important;
        }

        /* 手机端适配:整个画作层等比向中心收拢(S 形两岸缩放后中央品牌区仍保持留白),
           同时边缘画作不再溢出小屏;桌面端不缩放 */
        @media (max-width: 767px) {
          .intro-paintings-layer {
            transform: scale(0.72);
            transform-origin: center center;
          }
        }

        .intro-layer {
          opacity: 0;
          animation: intro-fade-in 0.5s cubic-bezier(0.22, 1, 0.36, 1) forwards;
        }
        .intro-layer-left  { animation-name: intro-fade-in; }
        .intro-layer-right { animation-name: intro-fade-in; }

        /* 跳过按钮:稍晚淡入,右侧浮出 */
        .intro-skip {
          opacity: 0;
          animation: intro-fade-in 0.5s ease 0.9s forwards;
        }

        .intro-stroke {
          stroke-dasharray: 1000;
          stroke-dashoffset: 1000;
          animation: intro-stroke-draw 1s cubic-bezier(0.22, 1, 0.36, 1) forwards;
        }

        .intro-brand {
          opacity: 0;
          animation: intro-slide-up 0.7s cubic-bezier(0.22, 1, 0.36, 1) 0.7s forwards;
        }
        .intro-subtitle {
          opacity: 0;
          animation: intro-fade-in 0.5s ease 1.1s forwards;
        }

        .intro-step {
          opacity: 0;
          animation: intro-fade-in-up 0.5s cubic-bezier(0.22, 1, 0.36, 1) forwards;
        }
        .intro-step-0 { animation-delay: 1.4s; }
        .intro-step-1 { animation-delay: 1.5s; }
        .intro-step-2 { animation-delay: 1.6s; }
        .intro-step-3 { animation-delay: 1.7s; }

        .intro-stat {
          opacity: 0;
          animation: intro-fade-in-up 0.5s cubic-bezier(0.22, 1, 0.36, 1) forwards;
        }
        .intro-stat-0 { animation-delay: 2.0s; }
        .intro-stat-1 { animation-delay: 2.12s; }
        .intro-stat-2 { animation-delay: 2.24s; }
        .intro-stat-3 { animation-delay: 2.36s; }

        /* 题跋线(中央品牌区下方,朱砂细线):2.0s 从中心扩展 */
        .intro-inscription {
          opacity: 0;
          animation:
            intro-fade-in 0.4s ease 1.3s forwards,
            intro-inscription-draw 0.8s cubic-bezier(0.22, 1, 0.36, 1) 1.3s forwards;
          transform-origin: center center;
        }
        /* 朱砂方印(品牌区右侧):2.0s 弹跳出现 */
        .intro-seal {
          opacity: 0;
          transform-origin: center center;
          animation: intro-seal-pop 0.6s cubic-bezier(0.22, 1, 0.36, 1) 2.0s forwards;
        }
        /* 卷首/卷尾水波晕染(背景装饰):从 0 开始,1.2s 后一直呼吸 */
        .intro-paper-edge {
          opacity: 0;
          animation:
            intro-fade-in 1.2s ease 0.2s forwards,
            intro-paper-breathe 6s ease-in-out 1.4s infinite;
        }
      `}</style>

      <div
        className={`fixed inset-0 z-[90] overflow-hidden bg-paper-100 intro-overlay ${reducedClass} ${exiting ? 'intro-exit' : ''}`}
        aria-hidden="true"
      >
        {/* 背景:宣纸基调 + 金/石色径向晕染(更克制) */}
        <div
          className="absolute inset-0 z-0"
          style={{
            background:
              'radial-gradient(circle at 18% 22%, rgba(201,169,97,0.10) 0%, transparent 42%), radial-gradient(circle at 82% 78%, rgba(46,92,110,0.08) 0%, transparent 42%), radial-gradient(ellipse at 50% 50%, rgba(250,248,243,0.4) 0%, transparent 70%)',
          }}
        />

        {/* 卷首晕染(左上) + 卷尾晕染(右下):极淡的呼吸光晕 */}
        <div
          className="intro-paper-edge absolute z-0 pointer-events-none"
          style={{
            left: '-8%',
            top: '-10%',
            width: '40%',
            height: '40%',
            background:
              'radial-gradient(ellipse at center, rgba(201,169,97,0.18) 0%, transparent 65%)',
            filter: 'blur(40px)',
          }}
        />
        <div
          className="intro-paper-edge absolute z-0 pointer-events-none"
          style={{
            right: '-8%',
            bottom: '-10%',
            width: '40%',
            height: '40%',
            background:
              'radial-gradient(ellipse at center, rgba(46,92,110,0.14) 0%, transparent 65%)',
            filter: 'blur(40px)',
          }}
        />

        {/* 光标感应名作层(S 形两岸排布) */}
        <IntroPaintings active={!prefersReduced} />

        {/* 顶部状态条 */}
        <div className="absolute top-0 left-0 right-0 z-[3] px-6 sm:px-10 pt-5 sm:pt-6 flex items-center justify-between text-[10px] sm:text-[11px] font-mono tracking-[0.18em] text-ink-700/80">
          <div className="intro-layer intro-layer-left flex items-center gap-2">
            <span className="relative inline-flex h-1.5 w-1.5">
              <span className="absolute inset-0 inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-600" />
            </span>
            <span>运行中</span>
            <span className="text-ink-900/40">·</span>
            <span>v1.0</span>
          </div>
          <div className="intro-layer intro-layer-right flex items-center gap-2">
            <span className="uppercase">live demo</span>
            <span className="h-px w-6 sm:w-10 bg-ink-700/40" />
          </div>
        </div>

        {/* 跳过按钮:稍晚淡入,点击立即退出开屏进入首页 */}
        <button
          type="button"
          onClick={handleSkip}
          className="intro-skip absolute top-4 right-4 sm:top-5 sm:right-6 z-[4] rounded-full border border-ink-100/60 bg-paper-50/70 px-3.5 py-1.5 text-[11px] sm:text-xs font-medium tracking-[0.12em] text-ink-700/80 shadow-ink-sm backdrop-blur-md transition-colors hover:bg-paper-100/90 hover:text-ink-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-cinnabar-400/60"
        >
          跳过
        </button>

        {/* 中部主体:笔触 + 品牌 + 副标 + 题跋线 + 朱砂方印 */}
        <div className="absolute inset-0 z-[3] flex flex-col items-center justify-center px-4">
          <div className="relative w-[70vw] max-w-[800px]">
            <svg
              viewBox="0 0 800 40"
              className="w-full"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <defs>
                <linearGradient id="brushGradient" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%"   stopColor="#1a1a1a" stopOpacity="0" />
                  <stop offset="6%"   stopColor="#1a1a1a" stopOpacity="0.5" />
                  <stop offset="20%"  stopColor="#1a1a1a" stopOpacity="0.95" />
                  <stop offset="80%"  stopColor="#1a1a1a" stopOpacity="0.95" />
                  <stop offset="94%"  stopColor="#1a1a1a" stopOpacity="0.5" />
                  <stop offset="100%" stopColor="#1a1a1a" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path
                className="intro-stroke"
                d="M 0 20 C 100 12, 200 26, 300 18 S 500 14, 600 22 S 750 18, 800 20"
                stroke="url(#brushGradient)"
                strokeWidth="2.5"
                fill="none"
                strokeLinecap="round"
              />
            </svg>
          </div>

          <h1 className="intro-brand mt-6 text-4xl sm:text-6xl md:text-7xl font-bold tracking-[0.3em] sm:tracking-[0.4em] text-ink-900">
            丹青有AI
          </h1>

          <p className="intro-subtitle mt-4 text-sm sm:text-base tracking-[0.2em] text-ink-700/80">
            AI 助你看见作品的每一笔墨
          </p>

          {/* 题跋行:朱砂细线 + 方印(品牌区下方) */}
          <div className="mt-5 flex items-center gap-3">
            <div
              className="intro-inscription h-px w-24 sm:w-32"
              style={{
                background:
                  'linear-gradient(90deg, transparent 0%, rgba(200,57,46,0.65) 30%, rgba(200,57,46,0.85) 50%, rgba(200,57,46,0.65) 70%, transparent 100%)',
              }}
              aria-hidden="true"
            />
            <div
              className="intro-seal inline-flex h-7 w-7 sm:h-8 sm:w-8 items-center justify-center rounded-[3px] text-[10px] sm:text-[11px] font-bold text-paper-50"
              style={{
                background:
                  'linear-gradient(135deg, #d85f50 0%, #c8392e 60%, #a82a20 100%)',
                boxShadow:
                  '0 1px 0 rgba(255,255,255,0.2) inset, 0 2px 6px rgba(200,57,46,0.32)',
                fontFamily: 'serif',
                letterSpacing: '0',
              }}
              aria-hidden="true"
            >
              丹青
            </div>
            <div
              className="intro-inscription h-px w-24 sm:w-32"
              style={{
                background:
                  'linear-gradient(90deg, transparent 0%, rgba(200,57,46,0.65) 30%, rgba(200,57,46,0.85) 50%, rgba(200,57,46,0.65) 70%, transparent 100%)',
              }}
              aria-hidden="true"
            />
          </div>
        </div>

        {/* 底部信息层 */}
        <div className="absolute bottom-0 left-0 right-0 z-[3] px-6 sm:px-10 pb-6 sm:pb-8 flex flex-col items-center gap-4 sm:gap-5">
          <div className="flex items-center gap-4 sm:gap-7 text-[10px] sm:text-[11px] font-mono tracking-[0.18em] text-ink-700/85">
            {[
              { no: '01', en: 'upload',    zh: '上传' },
              { no: '02', en: 'analyze',   zh: '诊断' },
              { no: '03', en: 'feedback',  zh: '建议' },
              { no: '04', en: 'archive',   zh: '沉淀' },
            ].map((s, i) => (
              <div key={s.no} className={`intro-step intro-step-${i} flex items-center gap-1.5`}>
                <span className="text-ink-900 font-semibold">{s.no}</span>
                <span className="text-ink-900/35">·</span>
                <span>{s.en}</span>
                <span className="text-ink-900/35">·</span>
                <span className="text-ink-700">{s.zh}</span>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-center gap-x-5 sm:gap-x-8 gap-y-1.5 text-[11px] sm:text-xs text-ink-700/85">
            {[
              { num: '4',    label: '创意形式' },
              { num: '12',   label: '评估维度' },
              { num: '3s',   label: '诊断响应' },
              { num: '128+', label: '风格预设' },
            ].map((d, i) => (
              <div key={d.label} className={`intro-stat intro-stat-${i} flex items-baseline gap-1.5`}>
                <span className="font-mono text-ink-900 font-semibold text-sm sm:text-base">
                  {d.num}
                </span>
                <span className="tracking-wider">{d.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
