// ============================================================
// artworks.ts 静态化断言测试 (W1)
// 验证:所有图片 URL 均为本地 /images 路径,
//       不再引用外部 text_to_image 内部接口。
// ============================================================

import { describe, it, expect } from 'vitest';
import { HERO_ART, GALLERY_ART, BRAND_ART } from './artworks';

const ALL_URLS = [HERO_ART, BRAND_ART, ...GALLERY_ART.map((g) => g.url)];

describe('artworks 静态资源 (W1)', () => {
  it('所有图片 URL 均为本地 /images 路径', () => {
    for (const url of ALL_URLS) {
      expect(url).toMatch(/^\/images\//);
    }
  });

  it('不引用任何外部文生图内部接口', () => {
    for (const url of ALL_URLS) {
      expect(url).not.toMatch(/trae-api-cn\.mchost\.guru/);
      expect(url).not.toMatch(/text_to_image/);
      expect(url).not.toMatch(/^https?:\/\//);
    }
  });

  it('画廊包含四幅作品且每幅有标题与本地图', () => {
    expect(GALLERY_ART).toHaveLength(4);
    for (const g of GALLERY_ART) {
      expect(g.title).toBeTruthy();
      expect(g.url).toMatch(/^\/images\//);
    }
  });
});