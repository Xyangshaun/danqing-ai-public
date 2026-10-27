import {
  useEffect, useRef, useState, type ReactNode,
} from 'react';
import { useLocation } from 'react-router-dom';

export interface RouteTransitionProps {
  /** 子节点(通常是 <Routes> 或路由对应的内容) */
  children: ReactNode;
  /**
   * 触发淡入动画的 key:变化时重新挂载子树并播放淡入。
   * 默认取 useLocation().pathname,业务方也可传入自定义 key(如 pathname+search)。
   */
  locationKey?: string;
  /** 容器额外类名(透传) */
  className?: string;
  /** 淡入时长(ms),默认 200 */
  duration?: number;
}

/**
 * 路由淡入包装组件
 *
 * 设计要点:
 *  - 通过 key={locationKey} 强制重新挂载子树:既保证动画触发,
 *    也确保子组件 state 在路由切换时被重置(符合"路由切换应重置 state"的语义)
 *  - 用 useRef + useState + useEffect 实现"先 opacity-0,下一帧切到 opacity-100":
 *    首次挂载与 locationKey 变化时,都先以 opacity-0 渲染,
 *    随后在 requestAnimationFrame 回调中切到 opacity-100,
 *    配合 Tailwind transition-opacity 实现淡入效果
 *  - 不引入任何动画库,纯 Tailwind class + 一个 rAF 调用
 *  - 3 秒 SLA:duration 默认 200ms,远低于 SLA,不影响首屏
 *
 * 无障碍:
 *  - 容器 aria-label="页面内容" + role="region",便于屏幕阅读器定位
 *  - prefers-reduced-motion: 通过 tailwind motion-reduce: 前缀关闭 transition
 *
 * 用法:
 *   <RouteTransition>
 *     <Routes>...</Routes>
 *   </RouteTransition>
 *
 *   <RouteTransition locationKey={pathname + search} duration={300}>
 *     {children}
 *   </RouteTransition>
 */
export default function RouteTransition({
  children,
  locationKey,
  className = '',
  duration = 200,
}: RouteTransitionProps) {
  /* 默认用 useLocation().pathname 作为 key(在 Router 内部使用) */
  const location = useLocation();
  const key = locationKey ?? location.pathname;

  /* visible=false → opacity-0(初始隐藏);visible=true → opacity-100(淡入完成) */
  const [visible, setVisible] = useState(false);
  /* rAF handle,用于卸载时清理(避免内存泄漏与异步 setState 警告) */
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    /* key 变化 → 重新挂载子树 → useEffect 重新触发 → 先 opacity-0 再下一帧切到 opacity-100 */
    setVisible(false);
    /* 双 rAF:确保浏览器已经把 opacity-0 的样式应用到 DOM,再切到 opacity-100,
     * 这样 transition 才会真正播放(单 rAF 在某些情况下会被合并跳过) */
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = requestAnimationFrame(() => {
        setVisible(true);
      });
    });

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [key]);

  /* 组合 class:基础 + transition + 当前状态 + 透传 + reduced-motion 关闭过渡 */
  const composed = [
    'transition-opacity ease-out motion-reduce:transition-none',
    visible ? 'opacity-100' : 'opacity-0',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      key={key}
      className={composed}
      style={{ transitionDuration: `${duration}ms` }}
      role="region"
      aria-label="页面内容"
    >
      {children}
    </div>
  );
}
