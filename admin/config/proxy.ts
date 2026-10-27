/**
 * @name 开发环境代理配置
 * 后端业务应用同时承载:
 *   /api/v1/*  认证 + 业务接口
 *   /api/admin/* 管理后台接口
 * 两者统一代理到同一后端,无需分别配置
 */
export default function proxy(target: string) {
  return {
    '/api': {
      target,
      changeOrigin: true,
      secure: false,
      // /api/v1 与 /api/admin 均保持原路径透传(不加 rewrite)
    },
  };
}
