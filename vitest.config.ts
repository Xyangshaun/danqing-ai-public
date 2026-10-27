// ============================================================
// 丹青有AI 前端 - Vitest 配置
// 对应任务:Phase F3 前端测试基础设施
//
// 设计要点:
//   1. environment: jsdom(React 组件测试需要 DOM)
//   2. setupFiles: 引入 @testing-library/jest-dom 扩展 expect 匹配器
//   3. globals: false(与后端保持一致,显式 import { describe, it, expect })
//   4. include: src/**/__tests__/**/*.test.{ts,tsx} 与 src/**/*.test.{ts,tsx}
//   5. exclude: node_modules / dist / server / admin / prototype*
// ============================================================

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'src/**/__tests__/**/*.test.{ts,tsx}'],
    exclude: ['node_modules', 'dist', 'server', 'admin', 'prototype', 'prototype-backup-**'],
    isolate: true,
    testTimeout: 10000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'json', 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/types/**', 'src/main.tsx', 'src/test/**', '**/*.d.ts'],
    },
  },
});
