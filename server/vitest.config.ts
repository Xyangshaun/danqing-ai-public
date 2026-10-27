// ============================================================
// 丹青有AI 后端 - Vitest 配置
// 对应任务:Phase 1 任务 6 测试环境
// - 环境:node(后端服务测试)
// - coverage:v8 provider,语句/分支/函数/行覆盖率 ≥ 80%
// - setup:tests/setup.ts(全局 mock Redis / Prisma / 飞书 API,初始化 env)
// - ESM:项目使用 NodeNext,vitest 通过 esbuild 处理 .js → .ts 解析
// ============================================================

import { defineConfig } from 'vitest/config';

export default defineConfig({
  // CSS 处理:顶层(注意不能放 test 里)Vite 内联空 PostCSS 配置,阻断 Vite
  // 启动时向上搜索仓库根目录的 postcss.config.js(其依赖 root node_modules
  // 的 tailwindcss,CI 的 backend job 只装 server 依赖会报
  // Cannot find module 'tailwindcss')
  css: {
    postcss: {
      plugins: [],
    },
  },
  test: {
    // Node 环境运行(后端测试,无 DOM)
    environment: 'node',
    // 全局 setup:在所有测试文件之前执行,负责 mock 注入与 env 初始化
    setupFiles: ['./tests/setup.ts'],
    // 不启用 globals,显式 import { describe, it, expect, vi } 保证严格类型
    globals: false,
    // 测试文件匹配规则
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules', 'dist', 'coverage'],
    // 并发隔离:每个测试文件独立隔离,避免 mock 状态串扰
    isolate: true,
    // 超时:OAuth 流程涉及多次 mock 调用,给足 10s
    testTimeout: 10000,
    // 覆盖率配置
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'json', 'html', 'lcov'],
      reportsDirectory: './coverage',
      // 仅统计 src/ 源码,排除类型声明与启动入口
      include: ['src/**/*.ts'],
      exclude: [
        'src/types/**',
        'src/index.ts',
        'src/config/prisma.ts',
        'src/config/redis.ts',
        'src/utils/http-client.ts',
      ],
      // 覆盖率阈值(硬约束,不达标 CI 失败)
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
      // 允许 100% 覆盖的文件存在(避免全量报告)
      all: true,
    },
  },
});
