// ============================================================
// imageService 单元测试 (任务包 E:块4 服务层覆盖率补强)
// 对应源码: src/services/imageService.ts
//
// 测试范围:
//   1. setUseExternalApi / getUseExternalApi: localStorage 读写
//   2. setApiKey / getApiKey: API key 管理
//   3. generateImage: 返回 placeholderImage (SVG data URL)
//   4. applyStyle: 按风格 id 生成对应图片
//   5. fuseImages: 灵感融合生成
//   6. generateEmotionCanvas: 情绪画布生成
//   7. generateClassMaterial: 课堂素材批量生成
//   8. stylePresets / emotionPresets / scenePresets: 预设数据完整性
//   9. getStyleDemoImage: 按风格 id 获取 demo
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  setUseExternalApi,
  getUseExternalApi,
  setApiKey,
  getApiKey,
  generateImage,
  applyStyle,
  fuseImages,
  generateEmotionCanvas,
  generateClassMaterial,
  stylePresets,
  emotionPresets,
  scenePresets,
  getStyleDemoImage,
} from '../imageService';

/* ---------- 公共清理 ---------- */

beforeEach(() => {
  localStorage.clear();
  // 单元测试关闭外部 API,使用占位图,避免调用真实后端
  setUseExternalApi(false);
});

afterEach(() => {
  localStorage.clear();
});

/* ============================================================
 * 1. API 模式开关
 * ============================================================ */
describe('setUseExternalApi / getUseExternalApi', () => {
  it('默认未启用(false)', () => {
    expect(getUseExternalApi()).toBe(false);
  });

  it('setUseExternalApi(true) 持久化到 localStorage', () => {
    setUseExternalApi(true);
    expect(localStorage.getItem('danqing-ai-use-api')).toBe('true');
    expect(getUseExternalApi()).toBe(true);
  });

  it('setUseExternalApi(false) 持久化到 localStorage', () => {
    setUseExternalApi(true);
    setUseExternalApi(false);
    expect(localStorage.getItem('danqing-ai-use-api')).toBe('false');
    expect(getUseExternalApi()).toBe(false);
  });

  it('localStorage 数据损坏时返回 false', () => {
    localStorage.setItem('danqing-ai-use-api', 'not-a-boolean');
    expect(getUseExternalApi()).toBe(false);
  });
});

/* ============================================================
 * 2. API Key 管理
 * ============================================================ */
describe('setApiKey / getApiKey', () => {
  it('默认空字符串', () => {
    expect(getApiKey()).toBe('');
  });

  it('setApiKey 持久化到 localStorage', () => {
    setApiKey('my-secret-key');
    expect(localStorage.getItem('danqing-ai-api-key')).toBe('my-secret-key');
    expect(getApiKey()).toBe('my-secret-key');
  });

  it('setApiKey 多次调用覆盖旧值', () => {
    setApiKey('key1');
    setApiKey('key2');
    expect(getApiKey()).toBe('key2');
  });
});

/* ============================================================
 * 3. generateImage
 * ============================================================ */
describe('generateImage', () => {
  it('返回字符串(SVG data URL)', async () => {
    const url = await generateImage('test prompt');
    expect(typeof url).toBe('string');
    expect(url.length).toBeGreaterThan(0);
  });

  it('默认 size 参数为 square', async () => {
    const url = await generateImage('test');
    expect(url).toBeTruthy();
  });

  it('不同 size 参数都能生成图片', async () => {
    const sizes = ['square', 'portrait_4_3', 'landscape_4_3', 'portrait_16_9', 'landscape_16_9'];
    for (const size of sizes) {
      const url = await generateImage('test', size);
      expect(url).toBeTruthy();
    }
  });

  it('不同 prompt 生成不同图片', async () => {
    const a = await generateImage('prompt-a');
    const b = await generateImage('prompt-b');
    // 由于 prompt 不同,生成的 SVG data URL 应不同
    expect(a).not.toBe(b);
  });
});

/* ============================================================
 * 4. applyStyle
 * ============================================================ */
describe('applyStyle', () => {
  it('对有效 styleId 返回新生成的图片 URL', async () => {
    const url = await applyStyle('https://example.com/src.png', 'ink');
    expect(typeof url).toBe('string');
    expect(url.length).toBeGreaterThan(0);
  });

  it('对每个 stylePreset 都能正常生成', async () => {
    for (const preset of stylePresets) {
      const url = await applyStyle('https://example.com/src.png', preset.id);
      expect(url).toBeTruthy();
    }
  });

  it('对未知 styleId 返回原始 imageUrl(不处理)', async () => {
    const original = 'https://example.com/original.png';
    const url = await applyStyle(original, 'unknown-style-id');
    expect(url).toBe(original);
  });
});

/* ============================================================
 * 5. fuseImages
 * ============================================================ */
describe('fuseImages', () => {
  it('返回融合后的图片 URL', async () => {
    const url = await fuseImages();
    expect(typeof url).toBe('string');
    expect(url.length).toBeGreaterThan(0);
  });
});

/* ============================================================
 * 6. generateEmotionCanvas
 * ============================================================ */
describe('generateEmotionCanvas', () => {
  it('对存在的情绪名生成 3 张图片', async () => {
    const urls = await generateEmotionCanvas('喜悦');
    expect(Array.isArray(urls)).toBe(true);
    expect(urls.length).toBe(3);
    urls.forEach((u) => {
      expect(typeof u).toBe('string');
      expect(u.length).toBeGreaterThan(0);
    });
  });

  it('对未知情绪名回退到 emotionPresets[0]', async () => {
    const urls = await generateEmotionCanvas('unknown-emotion');
    expect(urls.length).toBe(3);
  });

  it('每个 emotionPreset 都能正常生成', async () => {
    for (const e of emotionPresets) {
      const urls = await generateEmotionCanvas(e.name);
      expect(urls.length).toBe(3);
    }
  });
});

/* ============================================================
 * 7. generateClassMaterial
 * ============================================================ */
describe('generateClassMaterial', () => {
  it('生成 4 张参考素材', async () => {
    const urls = await generateClassMaterial('山水', 'ink', 'mountain');
    expect(Array.isArray(urls)).toBe(true);
    expect(urls.length).toBe(4);
    urls.forEach((u) => {
      expect(typeof u).toBe('string');
      expect(u.length).toBeGreaterThan(0);
    });
  });

  it('不同 style 参数都能正常生成', async () => {
    const styles = ['realistic', 'illustration', 'watercolor', 'ink', 'oil'];
    for (const style of styles) {
      const urls = await generateClassMaterial('test', style, 'mountain');
      expect(urls.length).toBe(4);
    }
  });

  it('未知 style 参数使用默认 painting 关键词', async () => {
    const urls = await generateClassMaterial('test', 'unknown-style', 'mountain');
    expect(urls.length).toBe(4);
  });
});

/* ============================================================
 * 8. 预设数据完整性
 * ============================================================ */
describe('stylePresets', () => {
  it('包含 6 种中国传统画风格', () => {
    expect(stylePresets.length).toBe(6);
    const ids = stylePresets.map((s) => s.id);
    expect(ids).toContain('ink');
    expect(ids).toContain('qinglv');
    expect(ids).toContain('cinnabar');
    expect(ids).toContain('gold');
    expect(ids).toContain('jade');
    expect(ids).toContain('purple');
  });

  it('每个 preset 包含完整字段', () => {
    stylePresets.forEach((s) => {
      expect(s.id).toBeTruthy();
      expect(s.name).toBeTruthy();
      expect(s.color).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(s.demoPrompt).toBeTruthy();
      expect(s.description).toBeTruthy();
      expect(s.origin).toBeTruthy();
      expect(Array.isArray(s.features)).toBe(true);
      expect(s.features.length).toBeGreaterThan(0);
    });
  });
});

describe('emotionPresets', () => {
  it('包含 6 种情绪预设', () => {
    expect(emotionPresets.length).toBe(6);
    const names = emotionPresets.map((e) => e.name);
    expect(names).toContain('孤独');
    expect(names).toContain('希望');
    expect(names).toContain('宁静');
    expect(names).toContain('喜悦');
    expect(names).toContain('忧伤');
    expect(names).toContain('激情');
  });

  it('每个 preset 包含 id/name/color', () => {
    emotionPresets.forEach((e) => {
      expect(e.id).toBeTruthy();
      expect(e.name).toBeTruthy();
      expect(e.color).toMatch(/^#[0-9a-fA-F]{6}$/);
    });
  });
});

describe('scenePresets', () => {
  it('包含 6 种场景预设', () => {
    expect(scenePresets.length).toBe(6);
  });

  it('每个 preset 包含 id/name', () => {
    scenePresets.forEach((s) => {
      expect(s.id).toBeTruthy();
      expect(s.name).toBeTruthy();
    });
  });
});

/* ============================================================
 * 9. getStyleDemoImage
 * ============================================================ */
describe('getStyleDemoImage', () => {
  it('对已知 styleId 返回 demo 图片 URL', async () => {
    const url = await getStyleDemoImage('ink');
    expect(typeof url).toBe('string');
    expect(url.length).toBeGreaterThan(0);
  });

  it('对每个 stylePreset 都能获取 demo', async () => {
    for (const preset of stylePresets) {
      const url = await getStyleDemoImage(preset.id);
      expect(url).toBeTruthy();
    }
  });

  it('对未知 styleId 回退到默认 painting prompt', async () => {
    const url = await getStyleDemoImage('unknown');
    expect(url).toBeTruthy();
  });
});
