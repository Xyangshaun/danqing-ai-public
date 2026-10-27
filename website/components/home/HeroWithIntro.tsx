'use client';

import React, { useEffect, useState } from 'react';
import { VideoIntro } from './VideoIntro';
import { Hero } from './Hero';

/**
 * 首页 Hero 包一层:每次页面加载自动播放一次开场视频,
 * 结束后淡入真正的 Hero 内容区。
 *
 * 跳过机制:URL 带 ?skipIntro=1 时(如从业务应用登录页"返回官网")
 * 不播放开屏动画,直接展示 Hero;跳过后用 replaceState 清理参数,
 * 保持地址栏干净(用户手动刷新仍会正常播放)。
 *
 * 加载健壮性:除 VideoIntro 的 onComplete 回调外,另设一个兜底定时器
 * (MAX_INTRO_MS + 缓冲),即使开屏内部 JS 异常导致 onComplete 未触发,
 * 页面也会强制淡出遮罩展示 Hero,保证首页永远可访问(不会"卡死在开屏")。
 */
const MAX_INTRO_MS = 4500; // 与 VideoIntro.TOTAL_MS 保持一致
const FALLBACK_BUFFER_MS = 800;

export function HeroWithIntro() {
  const [introDone, setIntroDone] = useState(false);
  const [heroVisible, setHeroVisible] = useState(false);

  // 挂载后检测跳过参数(不放入 useState 初始化器,避免 SSR/CSR hydration 不一致)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('skipIntro') === '1') {
      setIntroDone(true);
      setHeroVisible(true);
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);

  // 兜底:开屏最迟展示上限。即使 VideoIntro 脚本异常/图片异常导致 onComplete 未触发,
  // 也会强制完成开屏,保证页面不被遮罩永久遮挡。
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setIntroDone(true);
      setHeroVisible(true);
    }, MAX_INTRO_MS + FALLBACK_BUFFER_MS);
    return () => window.clearTimeout(timer);
  }, []);

  const handleComplete = React.useCallback(() => {
    setIntroDone(true);
    setHeroVisible(true);
  }, []);

  return (
    <>
      {!introDone && <VideoIntro onComplete={handleComplete} />}
      <div className={heroVisible ? 'opacity-100 transition-opacity duration-700' : 'opacity-0'}>
        <Hero />
      </div>
    </>
  );
}
