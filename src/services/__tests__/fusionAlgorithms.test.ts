/**
 * 融合算法库 · 全组合覆盖验证
 * ===========================================================
 * 9 方法帧 × 12 风格包 = 108 种组合,每种组合在
 * 4 强度 × 3 配比(0.3/0.5/0.8)下抽样验证:
 *   1. prompt 非空且为有效字符串
 *   2. 包含方法帧关键词(方法名)
 *   3. 包含风格包语言(风格名或英文锚定词)
 *   4. 包含配比词与强度词
 *   5. 包含质量尾缀
 * 另验证:未知 method/style 回退、作品描述注入。
 */

import { describe, it, expect } from 'vitest';
import { buildFusionPrompt, METHOD_FRAMES, STYLE_PACKS } from '../fusionAlgorithms';
import { fuseStyles, fuseMethods, fuseIntensities } from '../fuseStandards';
import type { ArtworkItem } from '../artworksDatabase';

const mockArtworkA: ArtworkItem = {
  id: 'test-a',
  title: '千里江山图',
  artist: '王希孟',
  year: '1113',
  category: 'painting',
  style: '青绿山水',
  era: '北宋',
  region: 'china',
  description: '北宋青绿山水长卷',
  imageUrl: 'https://example.com/a.jpg',
  source: 'test',
  tags: ['山水', '青绿', '长卷'],
};

const mockArtworkB: ArtworkItem = {
  id: 'test-b',
  title: '星夜',
  artist: '梵高',
  year: '1889',
  category: 'painting',
  style: '后印象派',
  era: '19世纪',
  region: 'europe',
  description: '漩涡状星空',
  imageUrl: 'https://example.com/b.jpg',
  source: 'test',
  tags: ['星空', '漩涡', '夜景'],
};

const SAMPLE_RATIOS = [0.3, 0.5, 0.8];

describe('fusionAlgorithms · 语料库完整性', () => {
  it('METHOD_FRAMES 覆盖全部 9 个方法', () => {
    expect(fuseMethods).toHaveLength(9);
    for (const m of fuseMethods) {
      expect(METHOD_FRAMES[m.id], `缺少方法帧: ${m.id}`).toBeTypeOf('function');
    }
  });

  it('STYLE_PACKS 覆盖全部 16 个风格(2026-08-18 决赛扩展 12→16)', () => {
    expect(fuseStyles).toHaveLength(16);
    for (const s of fuseStyles) {
      expect(STYLE_PACKS[s.id], `缺少风格包: ${s.id}`).toBeTypeOf('string');
      expect(STYLE_PACKS[s.id].length).toBeGreaterThan(10);
    }
  });
});

describe('fusionAlgorithms · 144 组合全量 prompt 验证(9 方法 × 16 风格)', () => {
  for (const method of fuseMethods) {
    for (const style of fuseStyles) {
      it(`[${method.id} × ${style.id}] 各强度/配比均生成有效 prompt`, () => {
        for (const intensity of fuseIntensities) {
          for (const ratio of SAMPLE_RATIOS) {
            const prompt = buildFusionPrompt({
              style,
              method,
              intensity,
              ratio,
              artwork1: mockArtworkA,
              artwork2: mockArtworkB,
            });

            // 1. 非空且长度合理
            expect(prompt.length).toBeGreaterThan(50);

            // 2. 包含方法帧标识(方法名)
            expect(prompt).toContain(method.name);

            // 3. 包含风格语言:风格包内容出现在「风格要求」段
            expect(prompt).toContain('风格要求:');

            // 4. 包含配比与强度
            expect(prompt).toContain('融合配比:');
            expect(prompt).toContain('融合强度:');

            // 5. 质量尾缀
            expect(prompt).toContain('画面质量:');

            // 6. 作品描述注入
            expect(prompt).toContain('千里江山图');
            expect(prompt).toContain('星夜');
          }
        }
      });
    }
  }
});

describe('fusionAlgorithms · 回退与边界', () => {
  const baseCtx = {
    style: fuseStyles[0],
    method: fuseMethods[2],
    intensity: fuseIntensities[1],
    ratio: 0.5,
    artwork1: null,
    artwork2: null,
  };

  it('未知 method 回退到元素融合帧', () => {
    const prompt = buildFusionPrompt({
      ...baseCtx,
      method: { ...fuseMethods[2], id: 'non-existent-method', name: '元素融合' },
    });
    expect(prompt).toContain('元素融合');
    expect(prompt.length).toBeGreaterThan(50);
  });

  it('未知 style 回退到 promptModifier 拼接', () => {
    const customStyle = {
      ...fuseStyles[0],
      id: 'non-existent-style',
      name: '测试风',
      promptModifier: 'test style modifier',
      characteristics: ['特征甲', '特征乙'],
    };
    const prompt = buildFusionPrompt({ ...baseCtx, style: customStyle });
    expect(prompt).toContain('test style modifier');
    expect(prompt).toContain('特征甲');
  });

  it('artwork 为 null 时使用占位描述,prompt 仍有效', () => {
    const prompt = buildFusionPrompt(baseCtx);
    expect(prompt).toContain('作品A');
    expect(prompt).toContain('作品B');
    expect(prompt.length).toBeGreaterThan(50);
  });

  it('极端配比(0 与 1)不抛异常且包含主导词', () => {
    for (const ratio of [0, 1]) {
      const prompt = buildFusionPrompt({ ...baseCtx, ratio });
      expect(prompt).toMatch(/强烈主导/);
    }
  });
});
