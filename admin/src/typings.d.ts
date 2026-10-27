declare module 'express';

declare module 'umijs';

declare const REACT_APP_ENV: 'dev' | 'test' | 'pre' | false;

/**
 * 构建期由 define 注入的常量。
 * 键必须与 config/config.ts 中 define 的键严格一致:
 *   'process.env.FEISHU_REDIRECT_URI'
 * 因此这里必须声明为 process.env.FEISHU_REDIRECT_URI(连续书写),
 * 使 webpack DefinePlugin 能精确匹配替换。
 */
declare const process: {
  env: {
    FEISHU_REDIRECT_URI?: string;
  };
};
