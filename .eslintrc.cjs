// ============================================================
// 丹青有AI 前端 - ESLint 配置
// 对应任务:任务包 E 块1 代码质量基线
//
// 设计要点:
//   1. 使用 .cjs 扩展名(项目 package.json 是 "type":"module",
//      用 .cjs 确保该文件以 CommonJS 语法解析,避免 ESM/CJS 冲突)
//   2. parser 用 @typescript-eslint/parser,支持 TS 5 语法
//   3. extends 链:eslint:recommended -> @typescript-eslint/recommended
//      -> react-hooks/recommended(覆盖 hooks 规则)
//   4. 关键规则:
//      - no-explicit-any: warn(块5 会逐个消除至零)
//      - no-unused-vars: error,_ 前缀豁免
//      - consistent-type-imports: error,强制 import type
//      - react-refresh/only-export-components: warn
//      - no-empty: error 但允许空 catch(LocalStorage 降级路径)
//   5. ignorePatterns: dist/node_modules/website/admin/server/prototype
//      及所有 *.config.{js,cjs}(配置文件不参与 lint)
// ============================================================

module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  plugins: ['@typescript-eslint', 'react-hooks', 'react-refresh'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  rules: {
    'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
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
    'website',
    'admin',
    'server',
    'prototype',
    // dq-video: Remotion 视频模板,由外部工具生成,会自动重置,不参与 lint
    'dq-video',
    // mobile: React Native 独立项目,有自己的 lint 配置
    'mobile',
    '*.config.js',
    '*.config.cjs',
    'src/test/**',
  ],
  settings: {
    react: { version: '18.2' },
  },
};
