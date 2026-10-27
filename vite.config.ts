import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { visualizer } from 'rollup-plugin-visualizer'

/**
 * V2-D 性能优化:Bundle 分析与拆分
 *
 * 1. 第三方依赖按"体积/加载时机"拆为独立 chunk:
 *    - react-vendor: react / react-dom / react-router-dom(首屏必需,主 chunk 同步加载)
 *    - recharts: 仅 GrowthPage 使用,体积大(>400KB),独立拆分按需加载
 *    - lucide: 图标库,各页面均按需 named import,集中到一个 chunk 避免重复打包
 *    - 其他 node_modules 走默认 vendor chunk
 *
 * 2. 路由级 code splitting 已通过 React.lazy + dynamic import 实现(见 App.tsx),
 *    每个页面独立 chunk,Suspense fallback 由 PageSkeleton 接管。
 *
 * 3. visualizer 仅在 build 时生成 stats.html,提交到 .gitignore 避免污染仓库。
 */
export default defineConfig({
  // VITE_SKIP_PUBLIC=1 时跳过 public 目录复制(纯代码更新构建用):
  // public 含 7.4GB 素材图片,完整复制需双倍磁盘;代码-only 构建时置 1,
  // 此时 dist 不含 images/data,部署包需从 public/data 或既有 dist 补齐
  publicDir: process.env.VITE_SKIP_PUBLIC === '1' ? false : 'public',
  plugins: [
    react(),
    visualizer({
      filename: 'dist/stats.html',
      template: 'treemap',
      gzipSize: true,
      brotliSize: true,
      emitFile: false,
    }),
  ],
  // 业务应用部署在 /app/ 路径,base 必须为 '/app/' 以保证资源引用正确
  // (若为 '/' 则资源请求 /assets/xxx.js 会被 Nginx 路由到官网目录导致 404)
  base: '/app/',
  server: {
    proxy: {
      '/api': {
        // 丹青后端(default 3000 被独立官网 Next.js 占用,改用 3002)
        target: 'http://localhost:3002',
        changeOrigin: true,
      },
      // 种子图片等静态资源(后端 express.static 服务)
      '/uploads': {
        target: 'http://localhost:3002',
        changeOrigin: true,
      },
    },
  },
  build: {
    // chunk 大小告警阈值提高到 1000KB(避免 recharts 等大库误警)
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks(id): string | undefined {
          // 仅处理 node_modules 中的第三方依赖;业务代码走默认路由级 chunk 拆分
          if (!id.includes('node_modules')) return undefined

          // react 核心:react / react-dom / scheduler(react-dom 的唯一外部依赖)
          // 三者合并为 react-vendor,避免 scheduler 归入 vendor 造成循环引用
          // 注意:react-router-dom 依赖 @remix-run/router 等内部包,若与 react 合并
          // 会产生 vendor -> react-vendor -> vendor 循环,故 react-router 归入 vendor
          if (
            id.includes('node_modules/react/') ||
            id.includes('node_modules/react-dom/') ||
            id.includes('node_modules/scheduler/')
          ) {
            return 'react-vendor'
          }

          // recharts 独立拆分(仅 GrowthPage 使用,体积大,按需加载)
          if (id.includes('node_modules/recharts')) {
            return 'recharts'
          }

          // lucide-react 独立拆分(图标库,各页面共享)
          if (id.includes('node_modules/lucide-react')) {
            return 'lucide'
          }

          // 其他第三方(含 react-router-dom 及其依赖)统一归入 vendor
          return 'vendor'
        },
      },
    },
  },
})
