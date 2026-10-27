// ============================================================
// 空闲自动登出 Hook
// - 监听 mousemove/keydown/click/scroll/touchstart
// - 超过 timeout 无操作触发 onIdle
// - 提前 warnBefore 触发 onWarn(剩余毫秒)
// - 30 分钟无操作自动登出(符合安全约束)
// ============================================================

import { useEffect, useRef } from 'react';

interface UseIdleTimerOptions {
  /** 总空闲阈值(毫秒) */
  timeout: number;
  /** 提前预警量(毫秒) */
  warnBefore?: number;
  /** 空闲触发 */
  onIdle?: () => void;
  /** 预警触发(剩余毫秒) */
  onWarn?: (remainingMs: number) => void;
  /** 是否启用(默认 true) */
  enabled?: boolean;
}

const ACTIVITY_EVENTS: (keyof WindowEventMap)[] = [
  'mousemove',
  'keydown',
  'click',
  'scroll',
  'touchstart',
  'wheel',
];

export function useIdleTimer(options: UseIdleTimerOptions): void {
  const { timeout, warnBefore = 0, onIdle, onWarn, enabled = true } = options;
  const lastActivityRef = useRef<number>(Date.now());
  const warnFiredRef = useRef(false);
  const idleFiredRef = useRef(false);

  // 用 ref 持有最新回调,避免重建定时器
  const onIdleRef = useRef(onIdle);
  const onWarnRef = useRef(onWarn);
  useEffect(() => {
    onIdleRef.current = onIdle;
    onWarnRef.current = onWarn;
  }, [onIdle, onWarn]);

  useEffect(() => {
    if (!enabled) return;

    const resetActivity = () => {
      lastActivityRef.current = Date.now();
      warnFiredRef.current = false;
      idleFiredRef.current = false;
    };

    // 节流:每事件最多 1 秒重置一次
    let lastReset = 0;
    const handler = () => {
      const now = Date.now();
      if (now - lastReset > 1000) {
        lastReset = now;
        resetActivity();
      }
    };

    ACTIVITY_EVENTS.forEach((evt) => window.addEventListener(evt, handler, { passive: true }));

    const interval = window.setInterval(() => {
      const elapsed = Date.now() - lastActivityRef.current;
      const remaining = timeout - elapsed;

      if (!warnFiredRef.current && warnBefore > 0 && remaining <= warnBefore && remaining > 0) {
        warnFiredRef.current = true;
        onWarnRef.current?.(remaining);
      }

      if (!idleFiredRef.current && elapsed >= timeout) {
        idleFiredRef.current = true;
        onIdleRef.current?.();
      }
    }, 1000);

    return () => {
      ACTIVITY_EVENTS.forEach((evt) => window.removeEventListener(evt, handler));
      window.clearInterval(interval);
    };
  }, [timeout, warnBefore, enabled]);
}
