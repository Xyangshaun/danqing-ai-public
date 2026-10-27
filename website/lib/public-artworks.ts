/**
 * 丹青有AI 官网开场动画 · 公开领域名作素材库
 *
 * 素材来源:Wikimedia Commons 公有领域(Public Domain)名作
 * 覆盖:中外名画、雕塑、艺术形式,展示"丹青有AI"所理解的多元艺术谱系。
 * 使用 Special:FilePath 稳定缩略图 URL,避免大图加载与版权风险。
 */

const WIKI = 'https://commons.wikimedia.org/wiki/Special:FilePath';

/** 通过文件名生成稳定缩略图 URL */
function artwork(file: string, width = 420) {
  return `${WIKI}/${encodeURIComponent(file)}?width=${width}`;
}

export type PublicArtwork = {
  title: string;
  author: string;
  era: string;
  type: 'painting' | 'sculpture' | 'design';
  url: string;
};

/**
 * 开场动画第三圈涟漪中依次掠过的作品序列
 * 中外名作混排,体现跨文化、跨门类的艺术谱系
 */
export const OPENING_ARTWORKS: PublicArtwork[] = [
  {
    title: '富春山居图',
    author: '黄公望',
    era: '元 · 1350',
    type: 'painting',
    url: artwork(
      'Huang Gongwang. Dwelling in the Fuchun Mountains. detail. National Palace Museum, Taipei.jpg'
    ),
  },
  {
    title: '清明上河图',
    author: '张择端',
    era: '北宋 · 1085',
    type: 'painting',
    url: artwork('Along the River During the Qingming Festival (detail of original).jpg'),
  },
  {
    title: '蒙娜丽莎',
    author: '列奥纳多·达·芬奇',
    era: '意大利 · 1503',
    type: 'painting',
    url: artwork('Mona Lisa, by Leonardo da Vinci, from C2RMF.jpg'),
  },
  {
    title: '星空',
    author: '文森特·梵高',
    era: '荷兰 · 1889',
    type: 'painting',
    url: artwork('Vincent van Gogh - Starry Night - Google Art Project.jpg'),
  },
  {
    title: '掷铁饼者',
    author: '米隆',
    era: '古希腊 · 前450',
    type: 'sculpture',
    url: artwork('Discobolus in the Museo Nazionale Romano.jpg'),
  },
  {
    title: '清明上河图(局部)',
    author: '张择端',
    era: '北宋',
    type: 'design',
    url: artwork('Along the River During the Qingming Festival (detail of original).jpg'),
  },
];