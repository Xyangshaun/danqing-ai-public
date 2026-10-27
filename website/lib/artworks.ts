/**
 * 丹青有AI 官网艺术画作素材库
 *
 * 所有图片均为本地静态资源(位于 /images/),避免运行时依赖外部文生图接口。
 * 静态化保证:加载稳定、无内部接口暴露、无第三方请求、可被 CDN 缓存。
 */

const IMG_ROOT = '/images';

/**
 * 首页 Hero 主视觉:大幅水墨山水画作
 * 作为品牌视觉锚点,强化第一眼艺术感
 */
export const HERO_ART = `${IMG_ROOT}/gallery-hero.jpg`;

/**
 * 艺术画廊区:四幅不同风格画作
 * 展示丹青有AI 所理解的多元艺术形式
 */
export const GALLERY_ART = [
  {
    title: '山水',
    subtitle: '墨分五色',
    url: `${IMG_ROOT}/gallery-mountain.jpg`,
  },
  {
    title: '花鸟',
    subtitle: '气韵生动',
    url: `${IMG_ROOT}/gallery-flower.jpg`,
  },
  {
    title: '写意',
    subtitle: '笔简意赅',
    url: `${IMG_ROOT}/gallery-lotus.jpg`,
  },
  {
    title: '雕塑',
    subtitle: '形神兼备',
    url: `${IMG_ROOT}/gallery-sculpture.jpg`,
  },
];

/**
 * 关于/产品页:品牌故事配图
 * 复用山水画作,保持品牌视觉统一
 */
export const BRAND_ART = `${IMG_ROOT}/gallery-mountain.jpg`;