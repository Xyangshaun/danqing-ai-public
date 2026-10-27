'use client';

import React from 'react';
import { motion } from 'framer-motion';

/**
 * 全局页面转场(App Router template.tsx:每次路由切换重新挂载)
 *
 * 设计考量:
 * - 仅客户端路由切换时播放"宣纸淡入"转场(0.5s,水墨缓动)
 * - 首次加载(SSR/首屏)不播动画:静态 HTML 直接可见,保护 LCP 与首页开屏动画
 * - 纯 opacity 过渡,不用 transform:transform 会为 fixed 后代创建包含块,
 *   导致 Navbar/VideoIntro 等全屏覆盖层定位异常
 */
let hasNavigated = false;

export default function Template({ children }: { children: React.ReactNode }) {
  const [animate, setAnimate] = React.useState(hasNavigated);

  React.useEffect(() => {
    hasNavigated = true;
  }, []);

  if (!animate) {
    return <>{children}</>;
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}
