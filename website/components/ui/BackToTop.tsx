'use client';

import React, { useCallback, useEffect, useState } from 'react';

/**
 * BackToTop · 全站统一返回顶部按钮
 *
 * 设计:
 *  - 水墨圆点 + 朱砂箭头,宣纸底色 + 边框,呼应品牌
 *  - 右下角悬浮,滚动 ~600px 淡入,移动端稍小
 *  - 无障碍:focus-visible 朱砂焦点环,aria-label
 *  - 平滑滚动 + 节流(rAF),不干扰主流程
 */
export function BackToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        setVisible(window.scrollY > 600);
        ticking = false;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const handleClick = useCallback(() => {
    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: prefersReduced ? 'auto' : 'smooth' });
  }, []);

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label="返回顶部"
      title="返回顶部"
      className={[
        'group fixed bottom-6 right-6 sm:bottom-8 sm:right-8 z-[80]',
        'inline-flex h-11 w-11 sm:h-12 sm:w-12 items-center justify-center',
        'rounded-full border border-ink-100/60 bg-paper-50/80 backdrop-blur-md',
        'shadow-ink-md transition-all duration-300 ease-out',
        'hover:bg-paper-100 hover:border-ink-200 hover:shadow-ink-lg hover:-translate-y-0.5',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-cinnabar-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-paper-100',
        visible
          ? 'opacity-100 translate-y-0 pointer-events-auto'
          : 'opacity-0 translate-y-2 pointer-events-none',
      ].join(' ')}
    >
      {/* 水墨底点 */}
      <span
        className="absolute inset-1 rounded-full opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{
          background:
            'radial-gradient(circle at 50% 50%, rgba(26,26,26,0.06) 0%, transparent 70%)',
        }}
        aria-hidden="true"
      />
      {/* 朱砂上行箭头 */}
      <svg
        viewBox="0 0 24 24"
        className="relative h-4 w-4 sm:h-5 sm:w-5 text-cinnabar-500 transition-transform duration-300 group-hover:-translate-y-0.5"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M12 5 L12 19 M5 12 L12 5 L19 12"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
