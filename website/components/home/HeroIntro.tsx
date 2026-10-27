'use client';

import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { OPENING_ARTWORKS, type PublicArtwork } from '@/lib/public-artworks';

/**
 * 首页开场动画 — 墨滴落水 · 三层涟漪 · 作品谱系 · 品牌浮现
 *
 * 完整时序(总时长约 7.2s,尊减弱动态偏好时直接跳过):
 *   P0 墨滴落下        0.0s ~ 1.1s   墨滴从顶部坠落,镜头跟随
 *   P1 涟漪一圈        1.1s ~ 2.0s   淡淡涟漪扩散
 *   P2 涟漪二圈        2.0s ~ 3.1s   丹青色彩(朱砂/石青)在涟漪中显现
 *   P3 涟漪三圈+作品  3.1s ~ 5.4s   涟漪滑过画面,依次掠过中外名作
 *   P4 作品消散+品名  5.4s ~ 6.4s   作品淡出,产品名"丹青有AI"放大浮现
 *   P5 收尾过渡        6.4s ~ 7.2s   涟漪收束,品名过渡到首页位置,整体淡出
 */

const EASE = [0.22, 1, 0.36, 1] as const;

const PHASE_MS = {
  drop: 0,
  ripple1: 1100,
  ripple2: 2000,
  ripple3: 3100,
  name: 5400,
  out: 6400,
  end: 7200,
};

export function HeroIntro({ onComplete }: { onComplete: () => void }) {
  const prefersReduced = useReducedMotion();
  const [phase, setPhase] = useState<'drop' | 'r1' | 'r2' | 'r3' | 'name' | 'out' | 'end'>('drop');
  const [exiting, setExiting] = useState(false);
  const doneRef = useRef(false);

  // 时序驱动
  useEffect(() => {
    if (prefersReduced) {
      onComplete();
      return;
    }
    const timers = [
      setTimeout(() => setPhase('r1'), PHASE_MS.ripple1),
      setTimeout(() => setPhase('r2'), PHASE_MS.ripple2),
      setTimeout(() => setPhase('r3'), PHASE_MS.ripple3),
      setTimeout(() => setPhase('name'), PHASE_MS.name),
      setTimeout(() => setPhase('out'), PHASE_MS.out),
      setTimeout(() => {
        setExiting(true);
        setTimeout(() => {
          if (!doneRef.current) {
            doneRef.current = true;
            onComplete();
          }
        }, 700);
      }, PHASE_MS.end),
    ];
    return () => timers.forEach(clearTimeout);
  }, [prefersReduced, onComplete]);

  // 忽略有害 URL 的作品(占位由 CSS 底色兜底)
  const artworks = OPENING_ARTWORKS.slice(0, 5);

  return (
    <AnimatePresence>
      {!exiting && (
        <motion.div
          className="fixed inset-0 z-[90] overflow-hidden bg-paper-100"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, scale: 0.96 }}
          transition={{ duration: 0.7, ease: EASE }}
          aria-hidden="true"
        >
          {/* 宣纸底纹 */}
          <div className="absolute inset-0 bg-paper-grain" />

          {/* 中心水平面 */}
          <div
            className="absolute left-1/2 top-[52%] h-px w-[120%] -translate-x-1/2"
            style={{
              background:
                'linear-gradient(90deg, transparent 0%, rgba(26,26,26,0.12) 20%, rgba(26,26,26,0.12) 80%, transparent 100%)',
            }}
          />

          {/* P0 墨滴下落 */}
          <motion.div
            className="absolute left-1/2 top-[52%] -translate-x-1/2"
            initial={{ y: -420, opacity: 0, scale: 0.4 }}
            animate={
              phase === 'drop'
                ? { y: 0, opacity: 1, scale: 1 }
                : { y: 0, opacity: 1, scale: 1 }
            }
            transition={{ duration: 1.1, ease: EASE }}
          >
            <div
              className="h-16 w-16 rounded-full"
              style={{
                background:
                  'radial-gradient(circle at 35% 30%, #3a3a3a 0%, #1a1a1a 55%, #0d0d0d 100%)',
                boxShadow: '0 10px 30px rgba(26,26,26,0.35)',
              }}
            />
          </motion.div>

          {/* P1 第一圈 · 淡淡涟漪 */}
          {phase !== 'drop' && (
            <motion.div
              className="absolute left-1/2 top-[52%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-ink-300/50"
              initial={{ width: 24, height: 24, opacity: 0.6 }}
              animate={{ width: 420, height: 420, opacity: 0 }}
              transition={{ duration: 1.6, ease: 'easeOut' }}
            />
          )}

          {/* P2 第二圈 · 丹青色彩出现 */}
          {phase !== 'drop' && phase !== 'r1' && (
            <motion.div
              className="absolute left-1/2 top-[52%] -translate-x-1/2 -translate-y-1/2 rounded-full"
              initial={{ width: 24, height: 24, opacity: 0 }}
              animate={{ width: 620, height: 620, opacity: [0, 0.5, 0.2] }}
              transition={{ duration: 2.2, ease: 'easeOut' }}
              style={{
                background:
                  'radial-gradient(circle, rgba(200,57,46,0.18) 0%, rgba(46,92,110,0.16) 35%, rgba(201,169,97,0.1) 60%, transparent 75%)',
              }}
            />
          )}

          {/* P3 第三圈 · 作品掠过(涟漪滑过画面) */}
          {phase !== 'drop' && phase !== 'r1' && phase !== 'r2' && (
            <motion.div
              className="absolute inset-x-0 top-1/2 -translate-y-1/2"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.4 }}
            >
              <motion.div
                className="flex items-center justify-center gap-6"
                initial={{ x: '100%' }}
                animate={{ x: ['100%', '-140%'] }}
                transition={{ duration: 2.3, ease: 'easeInOut' }}
              >
                {artworks.map((a, i) => (
                  <ArtworkCard key={i} art={a} />
                ))}
              </motion.div>
            </motion.div>
          )}

          {/* P4 产品名浮现(放大微动效) */}
          <AnimatePresence>
            {phase === 'name' || phase === 'out' || phase === 'end' ? (
              <motion.div
                key="brand"
                className="absolute inset-0 flex items-center justify-center"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.5 }}
              >
                <div className="text-center">
                  <motion.h1
                    className="font-serif text-6xl font-semibold text-gradient-ink md:text-8xl"
                    initial={{ scale: 0.6, opacity: 0 }}
                    animate={{ scale: [0.6, 1.08, 1], opacity: 1 }}
                    transition={{ duration: 1.1, times: [0, 0.7, 1], ease: EASE }}
                  >
                    丹青有AI
                  </motion.h1>
                  <motion.p
                    className="mt-4 text-xs font-medium uppercase tracking-[0.35em] text-ink-400"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.5, duration: 0.6 }}
                  >
                    AI-Powered Art Education
                  </motion.p>
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>

          {/* P5 收尾:整体向中心收束并淡出(由外层 AnimatePresence 处理) */}
          <motion.div
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={
              phase === 'out' || phase === 'end'
                ? { opacity: 1, scale: 1.02 }
                : { opacity: 0 }
            }
            transition={{ duration: 0.8, ease: EASE }}
            style={{
              background:
                'radial-gradient(circle at 50% 50%, transparent 0%, rgba(26,26,26,0.28) 100%)',
            }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** 作品卡片:名作缩略图 + 题款 */
function ArtworkCard({ art }: { art: PublicArtwork }) {
  return (
    <div className="relative h-40 w-28 shrink-0 overflow-hidden rounded-ink border border-ink-100/60 bg-paper-50 shadow-ink md:h-56 md:w-40">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={art.url}
        alt={`${art.title} · ${art.author}`}
        loading="lazy"
        className="h-full w-full object-cover"
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.display = 'none';
        }}
      />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink-900/70 to-transparent px-2 pb-2 pt-6">
        <div className="text-[11px] font-medium text-paper-50">{art.title}</div>
        <div className="text-[9px] text-paper-200/70">{art.author}</div>
      </div>
    </div>
  );
}