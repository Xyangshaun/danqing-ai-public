// ============================================================
// 丹青有AI 官网 - Vitest 配置
// - 环境:jsdom(组件测试涉及 DOM / window)
// - 别名:@/* → 项目根目录,与 tsconfig 保持一致
// - JSX/TSX 通过 @vitejs/plugin-react 转译
// ============================================================

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['**/*.test.{ts,tsx}'],
    exclude: ['node_modules', '.next', 'out'],
    testTimeout: 10000,
  },
});