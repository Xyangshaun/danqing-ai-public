/** @type {import('next').NextConfig} */
const nextConfig = {
  // 静态导出,部署到 Vercel/任意静态托管
  output: 'export',
  // 静态导出模式下,next/image 关闭服务端优化
  images: {
    unoptimized: true,
  },
  // 严格模式
  reactStrictMode: true,
  // 尾随斜杠,便于静态托管路由
  trailingSlash: true,
  // 构建产物目录(output: 'export' 静态导出到 visit/out/)
  // 与 deploy-gh-pages.cjs、deploy-website.sh(nginx 部署)的产物约定保持一致
  distDir: 'out',
  // 官网为纯静态导出,不包含任何 API 路由,不暴露业务端点
  // 注:output: 'export' 模式下不支持 redirects/rewrites,跳转由部署平台处理
  // import 的视频/媒体资源作为打包资源处理(内容哈希命名,路径自动正确)
  webpack(config, { isServer }) {
    config.module.rules.push({
      test: /\.(mp4|webm|ogg)$/i,
      type: 'asset',
      parser: {
        dataUrlCondition: {
          maxSize: 0, // 始终作为独立资源文件输出,不转 base64
        },
      },
      generator: {
        filename: 'static/media/[name].[hash][ext]',
      },
    });
    return config;
  },
};

module.exports = nextConfig;
