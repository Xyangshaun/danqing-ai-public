// ============================================================
// 丹青有AI 管理后台 - Vitest 配置
// - 环境:jsdom(工具函数涉及 localStorage / window)
// - 别名:@/* → src/*,与 tsconfig 保持一致
// - 排除:.umi(umi 生成)、node_modules、dist
// ============================================================

import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['node_modules', 'dist', 'src/.umi/**', 'src/.umi-production/**'],
    isolate: true,
    testTimeout: 10000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary'],
      reportsDirectory: './coverage',
      include: ['src/utils/**', 'src/services/**'],
      exclude: ['src/services/types.ts', 'src/**/*.test.*'],
    },
  },
});
