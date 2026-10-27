// ============================================================
// 丹青有AI 后端 - ESLint 配置(server/ 本地作用域)
//
// 背景:
//   仓库根目录 .eslintrc.cjs 是前端配置,ignorePatterns 含 'server',
//   导致 server/package.json 的 `npm run lint` 报 "all files are ignored"。
//   本文件为 server 目录提供独立配置(root: true 阻断向上合并),
//   仅启用 TypeScript 规则(后端无 React,不引入 react 插件)。
//
// 设计要点:
//   1. .cjs 扩展名(server package.json 是 "type":"module",.cjs 确保
//      以 CommonJS 解析,避免 ESM/CJS 冲突)
//   2. parser 用 @typescript-eslint/parser(由根 node_modules 提供)
//   3. 规则与前端基线对齐:no-unused-vars=error(_ 前缀豁免)、
//      no-explicit-any=warn、consistent-type-imports=error、
//      no-empty=error(允许空 catch,用于 Redis 降级等非阻塞路径)
//   4. ignorePatterns: dist/node_modules/coverage 与 Prisma 生成物
// ============================================================

module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  rules: {
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/consistent-type-imports': [
      'error',
      { prefer: 'type-imports' },
    ],
    'no-empty': ['error', { allowEmptyCatch: true }],
  },
  ignorePatterns: [
    'dist',
    'node_modules',
    'coverage',
    'prisma/migrations',
    '*.config.js',
    '*.config.cjs',
  ],
};
