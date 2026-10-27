/**
 * 图片资源 CDN 配置(方案 B:对象存储 COS + CDN)
 *
 * 主用 CDN/COS,本地(服务器)作备用。构建期通过环境变量注入基础 URL:
 *   NEXT_PUBLIC_IMAGE_CDN_BASE=https://cdn.danqing.site
 *
 * 为空时表示未启用 CDN,仅用本地资源(当前线上状态)。
 * Web 端业务应用的 CDN 凭据配置见 server/.env 的 COS_* 变量(由后端上传使用)。
 */
export const IMAGE_CDN_BASE =
  process.env.NEXT_PUBLIC_IMAGE_CDN_BASE?.replace(/\/+$/, '') ?? '';

/** 慢加载判定阈值(ms):超过该时长仍未加载完成,自动切到下一个来源(如本地) */
export const IMAGE_SLOW_FALLBACK_MS = 4000;