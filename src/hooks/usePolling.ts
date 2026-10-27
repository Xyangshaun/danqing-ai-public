// ============================================================
// 丹青有AI - 通用轮询 Hook(管理后台大屏用)
// 特性:
//   - setInterval 周期拉取;支持页面隐藏时暂停(visibilitychange)
//   - 组件卸载自动清理;拉取失败静默(由调用方决定降级)
//   - 返回 { data, error, loading, refresh }
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';

export interface UsePollingOptions {
  /** 轮询间隔(ms) */
  intervalMs: number;
  /** 是否立即执行一次(默认 true) */
  immediate?: boolean;
  /** 页面隐藏时是否暂停(默认 true) */
  pauseWhenHidden?: boolean;
}

export interface UsePollingResult<T> {
  data: T | null;
  error: Error | null;
  /** 首次加载中 */
  loading: boolean;
  /** 手动触发一次刷新 */
  refresh: () => void;
}

export function usePolling<T>(
  fetcher: () => Promise<T>,
  { intervalMs, immediate = true, pauseWhenHidden = true }: UsePollingOptions,
): UsePollingResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState<boolean>(immediate);
  const timerRef = useRef<number | null>(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const run = useCallback(async () => {
    try {
      const result = await fetcherRef.current();
      setData(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, []);

  const stop = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const start = useCallback(() => {
    stop();
    timerRef.current = window.setInterval(run, intervalMs);
  }, [intervalMs, run, stop]);

  useEffect(() => {
    if (immediate) void run();
    start();

    const onVisibility = () => {
      if (!pauseWhenHidden) return;
      if (document.hidden) {
        stop();
      } else {
        void run();
        start();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [immediate, intervalMs, pauseWhenHidden, run, start, stop]);

  const refresh = useCallback(() => {
    void run();
  }, [run]);

  return { data, error, loading, refresh };
}
