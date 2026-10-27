// ============================================================
// 设置 Model(主题切换:明/暗)
// ============================================================

import { useState, useCallback } from 'react';
import { theme } from 'antd';
import type { ThemeConfig } from 'antd';

export type ThemeMode = 'light' | 'dark';

const THEME_KEY = 'dq_admin_theme';

function readTheme(): ThemeMode {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === 'dark' || v === 'light') return v;
  } catch {
    /* noop */
  }
  return 'light';
}

export default function useSettings() {
  const [themeMode, setThemeMode] = useState<ThemeMode>(readTheme);

  const toggleTheme = useCallback(() => {
    setThemeMode((prev) => {
      const next: ThemeMode = prev === 'light' ? 'dark' : 'light';
      try {
        localStorage.setItem(THEME_KEY, next);
      } catch {
        /* noop */
      }
      return next;
    });
  }, []);

  const themeConfig: ThemeConfig = {
    algorithm: themeMode === 'dark' ? theme.darkAlgorithm : theme.defaultAlgorithm,
    cssVar: true,
    hashed: false,
  };

  return { themeMode, toggleTheme, themeConfig };
}
