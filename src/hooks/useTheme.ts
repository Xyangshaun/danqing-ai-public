// ============================================================
// 丹青有AI - 主题与密度 Hook
// ------------------------------------------------------------
// 读取 settings.theme('rice'|'ink'|'auto')与 settings.density
// 在 document.documentElement 设置 data-theme / data-density 属性
// - data-theme="light"|"dark":由 index.css 的 [data-theme="dark"] 选择器覆盖
// - data-density="compact|comfortable|spacious":调整 html font-size
// 同时监听系统 prefers-color-scheme 变化(auto 模式时动态切换)
// 监听 storage 事件(多 tab 同步)
// ============================================================

import { useEffect, useState } from 'react';
import { LS_KEYS } from '../services/data-service';

type Theme = 'rice' | 'ink' | 'auto';
type Density = 'compact' | 'comfortable' | 'spacious';

function readTheme(): Theme {
  try {
    const v = localStorage.getItem(LS_KEYS.theme);
    if (v === 'rice' || v === 'ink' || v === 'auto') return v;
  } catch { /* ignore */ }
  return 'rice';
}

function readDensity(): Density {
  try {
    const v = localStorage.getItem(LS_KEYS.density);
    if (v === 'compact' || v === 'comfortable' || v === 'spacious') return v;
  } catch { /* ignore */ }
  return 'comfortable';
}

function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function resolveThemeMode(theme: Theme): 'light' | 'dark' {
  if (theme === 'ink') return 'dark';
  if (theme === 'rice') return 'light';
  return systemPrefersDark() ? 'dark' : 'light';
}

function applyTheme(theme: Theme): void {
  const mode = resolveThemeMode(theme);
  document.documentElement.setAttribute('data-theme', mode);
}

function applyDensity(density: Density): void {
  document.documentElement.setAttribute('data-density', density);
}

/**
 * 主题与密度应用 Hook
 * - 挂载时读取 localStorage 并应用
 * - 订阅 storage 事件(其他 tab 修改 settings 时同步)
 * - 订阅 prefers-color-scheme 变化(仅 auto 模式生效)
 */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => readTheme());
  const [density, setDensity] = useState<Density>(() => readDensity());

  // 应用主题与密度
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    applyDensity(density);
  }, [density]);

  // 订阅 storage 事件(多 tab 同步)
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === LS_KEYS.theme) setTheme(readTheme());
      if (e.key === LS_KEYS.density) setDensity(readDensity());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // 订阅系统 prefers-color-scheme 变化(仅 auto 模式生效)
  useEffect(() => {
    if (theme !== 'auto') return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme('auto');
    // 兼容性:addEventListener 在现代浏览器可用,旧版本用 addListener
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    }
    // legacy Safari < 14
    const legacyMql = mql as unknown as {
      addListener?: (cb: () => void) => void;
      removeListener?: (cb: () => void) => void;
    };
    if (typeof legacyMql.addListener === 'function') {
      legacyMql.addListener(onChange);
      return () => legacyMql.removeListener?.(onChange);
    }
    return undefined;
  }, [theme]);

  return { theme, density };
}
