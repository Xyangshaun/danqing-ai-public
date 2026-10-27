import { defineConfig } from '@umijs/max';
import routes from './routes';
import proxy from './proxy';
import defaultSettings from './defaultSettings';

const ADMIN_API_TARGET = process.env.ADMIN_API_TARGET || 'http://localhost:3000';
const FEISHU_REDIRECT_URI =
  process.env.FEISHU_REDIRECT_URI || 'http://localhost:8000/auth/feishu/callback';

// 运行时注入前端的常量(用于飞书回调地址,避免硬编码)
const define: Record<string, string> = {
  'process.env.FEISHU_REDIRECT_URI': JSON.stringify(FEISHU_REDIRECT_URI),
};

export default defineConfig({
  /**
   * @name 部署子路径(生产挂载在 Nginx /admin/ 下)
   * base: 路由基础路径;publicPath: 静态资源引用前缀
   * 本地 dev 不受影响(umi dev 自动处理)
   */
  base: '/admin/',
  publicPath: '/admin/',

  /**
   * @name 哈希路由产物命名,避免缓存
   */
  hash: true,

  /**
   * @name antd 5 插件
   */
  antd: {
    theme: {
      token: defaultSettings.antdToken,
    },
    // 暗色主题由运行时 ConfigProvider 切换
    appConfig: {
      message: { maxCount: 3 },
      notification: { maxCount: 3 },
    },
  },

  /**
   * @name 权限插件
   */
  access: {},

  /**
   * @name 数据流插件(全局状态)
   */
  model: {},

  /**
   * @name 初始状态插件
   */
  initialState: {},

  /**
   * @name ProLayout 布局插件
   */
  layout: {
    locale: false,
    ...defaultSettings.proLayout,
  },

  /**
   * @name 路由
   */
  routes,

  /**
   * @name 代理(开发环境)
   *   /api/v1 + /api/admin 统一代理到后端业务应用
   */
  proxy: proxy(ADMIN_API_TARGET),

  /**
   * @name npm 客户端
   */
  npmClient: 'npm',

  /**
   * @name 快速刷新
   */
  fastRefresh: true,

  /**
   * @name define 注入
   */
  define,

  /**
   * @name 按需加载
   */
  codeSplitting: {
    jsStrategy: 'granularChunks',
  },

  /**
   * @name JS 压缩器(使用 terser 避免 esbuild helper 冲突)
   */
  jsMinifier: 'terser',

  /**
   * @name 构建时跳转转译
   */
  svgr: {},

  /**
   * @name less 主题变量注入
   */
  theme: {},

  /**
   * @name 关闭 mock
   */
  mock: false,

  /**
   * @name 关闭国际化(单一中文)
   */
  locale: { default: 'zh-CN', baseNavigator: false },

  /**
   * @name 构建产物分析
   */
  analyze: {
    analyzerMode: 'disabled',
  },

  /**
   * @name targets
   */
  targets: {
    chrome: 100,
  },

  /**
   * @name externals(无)
   */
  headScripts: [
    // 严禁引入 Google Fonts,使用系统字体栈
  ],
});
