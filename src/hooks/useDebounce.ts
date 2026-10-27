import { useState, useEffect } from 'react';

/**
 * useDebounce - 防抖 Hook
 *
 * 用于高频输入(搜索框、筛选器)的延迟响应,降低在 9999 条素材上的
 * 重复搜索/过滤计算频率。
 *
 * @param value 需要防抖的原始值
 * @param delay 延迟毫秒数(默认 300ms)
 * @returns 防抖后的值
 *
 * 示例:
 *   const [rawQuery, setRawQuery] = useState('');
 *   const searchQuery = useDebounce(rawQuery, 300);
 */
export function useDebounce<T>(value: T, delay: number = 300): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);

  return debouncedValue;
}

export default useDebounce;
