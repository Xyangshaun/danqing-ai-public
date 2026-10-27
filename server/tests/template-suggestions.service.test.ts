// ============================================================
// 模板降级建议库单元测试 (Phase F2-8)
// 对应源码: src/services/template-suggestions.service.ts
//
// 测试范围:
//   1. 47 条规则的触发条件 (正/负向): painting(17) + design(11) + product(9) + sculpture(10)
//   2. 优先级排序: high > medium > low (组内保持触发顺序)
//   3. 数量限制: high ≤ 2, medium ≤ 2, low ≤ 1, total ≤ 5
//   4. 四类作品维度映射: painting/design/product/sculpture 各自维度名
//   5. 无规则触发 → 通用鼓励性建议回退
//   6. 单条规则异常容错 (condition/evidence 抛错不影响其他规则)
//   7. 不足 3 条建议时从通用建议补足
//   8. createFallbackAIVisionResult: 默认语义描述、空评分校准、空参考案例
//
// Mock 策略:
//   - setup.ts 全局 mock Redis/Prisma/Jimp/Feishu,本测试为纯算法无外部依赖
//   - 仅导入 generateTemplateSuggestions / createFallbackAIVisionResult 两个纯函数
// ============================================================

import { describe, it, expect } from 'vitest';
import type { ArtType } from '../src/types/api-contract.js';
import type { JimpMetricsForPrompt } from '../src/types/ai-analysis.js';
import {
  generateTemplateSuggestions,
  createFallbackAIVisionResult,
} from '../src/services/template-suggestions.service.js';

// ============================================================
// 辅助构造器
// ============================================================

/** 构造 JimpMetricsForPrompt,允许覆盖任意字段,默认值全部位于"无规则触发"区间 */
function buildMetrics(overrides: Partial<JimpMetricsForPrompt> = {}): JimpMetricsForPrompt {
  return {
    focusX: 0.5,
    focusY: 0.5,
    whitespaceRatio: 0.3,
    warmRatio: 0.5,
    coolRatio: 0.5,
    dominantColor: '中性灰',
    avgLuminance: 128,
    avgSaturation: 50,
    contrast: 'medium',
    textureComplexity: 0.5,
    edgeDensity: 0.1,
    goldenRatioScore: 70,
    ruleOfThirdsScore: 70,
    leadingLineDirection: 45,
    leadingLineStrength: 0.5,
    harmonyScore: 70,
    harmonyType: 'complementary',
    saturationDistribution: { low: 0.33, mid: 0.34, high: 0.33 },
    directionCoherence: 0.6,
    strokeEnergy: 0.5,
    dominantDirection: 90,
    pHashSimilarity: 0.2,
    mostSimilarWork: null,
    ...overrides,
  };
}

// ============================================================
// 1. 四类作品维度映射
// ============================================================

describe('维度映射 - 四类作品各自维度名', () => {
  it('painting 维度: 构图/色彩/笔触/原创性', () => {
    // 触发各维度规则,验证 dimension 字段属于绘画类预期维度
    const metrics = buildMetrics({
      whitespaceRatio: 0.6, // 触发构图
      warmRatio: 0.8, // 触发色彩
      directionCoherence: 0.1, // 触发笔触
      pHashSimilarity: 0.8, // 触发原创性
    });
    const suggestions = generateTemplateSuggestions(metrics, 'painting');
    const dims = new Set(suggestions.map((s) => s.dimension));
    // 绘画类合法维度
    const allowed = new Set(['构图', '色彩', '笔触', '原创性']);
    for (const d of dims) {
      expect(allowed.has(d)).toBe(true);
    }
    expect(dims.size).toBeGreaterThan(0);
  });

  it('design 维度: 视觉层次/排版/色彩/原创性', () => {
    const metrics = buildMetrics({
      whitespaceRatio: 0.6, // 视觉层次
      leadingLineStrength: 0.1, // 排版
      warmRatio: 0.8, // 色彩
      pHashSimilarity: 0.8, // 原创性
    });
    const suggestions = generateTemplateSuggestions(metrics, 'design');
    const allowed = new Set(['视觉层次', '排版', '色彩', '原创性']);
    for (const s of suggestions) {
      expect(allowed.has(s.dimension)).toBe(true);
    }
  });

  it('product 维度: 形态/材质/功能/原创性', () => {
    const metrics = buildMetrics({
      focusX: 0.85, // 形态
      textureComplexity: 0.1, // 材质
      directionCoherence: 0.1, // 形态(功能/形态共用 directionCoherence)
      pHashSimilarity: 0.8, // 原创性
    });
    const suggestions = generateTemplateSuggestions(metrics, 'product');
    const allowed = new Set(['形态', '材质', '功能', '原创性']);
    for (const s of suggestions) {
      expect(allowed.has(s.dimension)).toBe(true);
    }
  });

  it('sculpture 维度: 空间/形体/材质/原创性', () => {
    const metrics = buildMetrics({
      whitespaceRatio: 0.7, // 空间
      directionCoherence: 0.1, // 形体
      edgeDensity: 0.01, // 材质
      pHashSimilarity: 0.8, // 原创性
    });
    const suggestions = generateTemplateSuggestions(metrics, 'sculpture');
    const allowed = new Set(['空间', '形体', '材质', '原创性']);
    for (const s of suggestions) {
      expect(allowed.has(s.dimension)).toBe(true);
    }
  });
});

// ============================================================
// 2. Painting 规则触发条件 (17 条)
// ============================================================

describe('Painting 规则触发', () => {
  // ---------- 构图类 (6 条) ----------
  describe('构图类', () => {
    it('painting-comp-whitespace-high: whitespaceRatio > 0.45 触发', () => {
      const m = buildMetrics({ whitespaceRatio: 0.6 });
      const out = generateTemplateSuggestions(m, 'painting');
      const hit = out.find((s) => s.evidence.includes('留白比例') && s.evidence.includes('超过45%'));
      expect(hit).toBeDefined();
      expect(hit?.level).toBe('poor'); // high → poor
      expect(hit?.priority).toBe('high');
      expect(hit?.evidence).toContain('60.0%');
    });

    it('painting-comp-whitespace-high: whitespaceRatio = 0.45 边界不触发 (严格大于)', () => {
      const m = buildMetrics({ whitespaceRatio: 0.45 });
      const out = generateTemplateSuggestions(m, 'painting');
      // 使用与触发测试一致的匹配字符串,避免假绿
      expect(out.some((s) => s.evidence.includes('留白比例') && s.evidence.includes('超过45%'))).toBe(false);
    });

    it('painting-comp-whitespace-low: whitespaceRatio < 0.20 触发 (medium)', () => {
      const m = buildMetrics({ whitespaceRatio: 0.15 });
      const out = generateTemplateSuggestions(m, 'painting');
      const hit = out.find((s) => s.evidence.includes('不足20%'));
      expect(hit).toBeDefined();
      expect(hit?.priority).toBe('medium');
      expect(hit?.level).toBe('average');
      expect(hit?.evidence).toContain('15.0%');
    });

    it('painting-comp-whitespace-low: whitespaceRatio = 0.20 边界不触发', () => {
      const m = buildMetrics({ whitespaceRatio: 0.20 });
      const out = generateTemplateSuggestions(m, 'painting');
      expect(out.some((s) => s.evidence.includes('不足20%'))).toBe(false);
    });

    it('painting-comp-focus-offset-right: focusX > 0.7 触发 (high)', () => {
      const m = buildMetrics({ focusX: 0.85, focusY: 0.5 });
      const out = generateTemplateSuggestions(m, 'painting');
      const hit = out.find((s) => s.evidence.includes('重心偏右'));
      expect(hit).toBeDefined();
      expect(hit?.priority).toBe('high');
      expect(hit?.evidence).toContain('0.85');
    });

    it('painting-comp-focus-offset-left: focusX < 0.3 触发 (high)', () => {
      const m = buildMetrics({ focusX: 0.2, focusY: 0.5 });
      const out = generateTemplateSuggestions(m, 'painting');
      const hit = out.find((s) => s.evidence.includes('重心偏左'));
      expect(hit).toBeDefined();
      expect(hit?.priority).toBe('high');
      expect(hit?.evidence).toContain('0.20');
    });

    it('painting-comp-golden-ratio-low: goldenRatioScore < 50 触发 (medium)', () => {
      const m = buildMetrics({ goldenRatioScore: 35 });
      const out = generateTemplateSuggestions(m, 'painting');
      const hit = out.find((s) => s.evidence.includes('黄金分割评分') && s.evidence.includes('35'));
      expect(hit).toBeDefined();
      expect(hit?.priority).toBe('medium');
    });

    it('painting-comp-golden-ratio-low: goldenRatioScore 缺失时默认 65, 不触发', () => {
      const m: JimpMetricsForPrompt = {
        ...buildMetrics(),
        goldenRatioScore: undefined,
      };
      const out = generateTemplateSuggestions(m, 'painting');
      expect(out.some((s) => s.evidence.includes('黄金分割评分'))).toBe(false);
    });

    it('painting-comp-leading-line-weak: leadingLineStrength < 0.2 触发 (medium)', () => {
      const m = buildMetrics({ leadingLineStrength: 0.1 });
      const out = generateTemplateSuggestions(m, 'painting');
      const hit = out.find((s) => s.evidence.includes('引导线强度'));
      expect(hit).toBeDefined();
      expect(hit?.priority).toBe('medium');
      expect(hit?.evidence).toContain('0.10');
    });
  });

  // ---------- 色彩类 (6 条) ----------
  describe('色彩类', () => {
    it('painting-color-warm-excessive: warmRatio > 0.70 触发 (high)', () => {
      const m = buildMetrics({ warmRatio: 0.85, coolRatio: 0.15 });
      const out = generateTemplateSuggestions(m, 'painting');
      const hit = out.find((s) => s.evidence.includes('暖色占比') && s.evidence.includes('超过70%'));
      expect(hit).toBeDefined();
      expect(hit?.priority).toBe('high');
      expect(hit?.evidence).toContain('85%');
    });

    it('painting-color-warm-excessive: warmRatio = 0.70 边界不触发', () => {
      const m = buildMetrics({ warmRatio: 0.70, coolRatio: 0.30 });
      const out = generateTemplateSuggestions(m, 'painting');
      // 使用与触发测试一致的匹配字符串,避免假绿
      expect(out.some((s) => s.evidence.includes('暖色占比') && s.evidence.includes('超过70%'))).toBe(false);
    });

    it('painting-color-cool-excessive: coolRatio > 0.70 触发 (high)', () => {
      const m = buildMetrics({ coolRatio: 0.85, warmRatio: 0.15 });
      const out = generateTemplateSuggestions(m, 'painting');
      const hit = out.find((s) => s.evidence.includes('冷色占比') && s.evidence.includes('超过70%'));
      expect(hit).toBeDefined();
      expect(hit?.priority).toBe('high');
    });

    it('painting-color-saturation-too-high: avgSaturation > 75 触发 (medium)', () => {
      const m = buildMetrics({ avgSaturation: 90 });
      const out = generateTemplateSuggestions(m, 'painting');
      const hit = out.find((s) => s.evidence.includes('平均饱和度') && s.evidence.includes('超过75'));
      expect(hit).toBeDefined();
      expect(hit?.priority).toBe('medium');
    });

    it('painting-color-saturation-too-low: avgSaturation < 20 触发 (medium)', () => {
      const m = buildMetrics({ avgSaturation: 15 });
      const out = generateTemplateSuggestions(m, 'painting');
      const hit = out.find((s) => s.evidence.includes('平均饱和度仅') && s.evidence.includes('低于20'));
      expect(hit).toBeDefined();
      expect(hit?.priority).toBe('medium');
    });

    it('painting-color-harmony-low: harmonyScore < 50 触发 (high)', () => {
      const m = buildMetrics({ harmonyScore: 35 });
      const out = generateTemplateSuggestions(m, 'painting');
      const hit = out.find((s) => s.evidence.includes('色彩和谐度评分'));
      expect(hit).toBeDefined();
      expect(hit?.priority).toBe('high');
    });

    it('painting-color-saturation-imbalance: low > 0.70 触发 (low)', () => {
      const m = buildMetrics({
        saturationDistribution: { low: 0.85, mid: 0.1, high: 0.05 },
      });
      const out = generateTemplateSuggestions(m, 'painting');
      const hit = out.find((s) => s.evidence.includes('饱和度分布不均'));
      expect(hit).toBeDefined();
      expect(hit?.priority).toBe('low');
      expect(hit?.evidence).toContain('低饱和');
      expect(hit?.evidence).toContain('85%');
    });

    it('painting-color-saturation-imbalance: high > 0.70 触发高饱和主导', () => {
      const m = buildMetrics({
        saturationDistribution: { low: 0.05, mid: 0.1, high: 0.85 },
      });
      const out = generateTemplateSuggestions(m, 'painting');
      const hit = out.find((s) => s.evidence.includes('高饱和'));
      expect(hit).toBeDefined();
      expect(hit?.evidence).toContain('85%');
    });

    it('painting-color-saturation-imbalance: 三档均 ≤ 0.70 不触发', () => {
      const m = buildMetrics({
        saturationDistribution: { low: 0.5, mid: 0.3, high: 0.2 },
      });
      const out = generateTemplateSuggestions(m, 'painting');
      expect(out.some((s) => s.evidence.includes('饱和度分布不均'))).toBe(false);
    });
  });

  // ---------- 笔触类 (3 条) ----------
  describe('笔触类', () => {
    it('painting-brush-direction-incoherent: directionCoherence < 0.30 触发 (high)', () => {
      const m = buildMetrics({ directionCoherence: 0.15 });
      const out = generateTemplateSuggestions(m, 'painting');
      const hit = out.find((s) => s.evidence.includes('方向一致性') && s.evidence.includes('低于0.30'));
      expect(hit).toBeDefined();
      expect(hit?.priority).toBe('high');
    });

    it('painting-brush-energy-low: strokeEnergy < 0.20 触发 (medium)', () => {
      const m = buildMetrics({ strokeEnergy: 0.1 });
      const out = generateTemplateSuggestions(m, 'painting');
      const hit = out.find((s) => s.evidence.includes('笔触能量'));
      expect(hit).toBeDefined();
      expect(hit?.priority).toBe('medium');
    });

    it('painting-brush-texture-too-simple: textureComplexity < 0.20 触发 (low)', () => {
      const m = buildMetrics({ textureComplexity: 0.1 });
      const out = generateTemplateSuggestions(m, 'painting');
      const hit = out.find((s) => s.evidence.includes('纹理复杂度') && s.evidence.includes('低于0.20'));
      expect(hit).toBeDefined();
      expect(hit?.priority).toBe('low');
    });
  });

  // ---------- 原创性类 (2 条) ----------
  describe('原创性类', () => {
    it('painting-orig-similarity-high: pHashSimilarity > 0.5 触发 (high)', () => {
      const m = buildMetrics({
        pHashSimilarity: 0.8,
        mostSimilarWork: { title: '星月夜', artist: '梵高' },
      });
      const out = generateTemplateSuggestions(m, 'painting');
      const hit = out.find((s) => s.evidence.includes('pHash感知哈希相似度'));
      expect(hit).toBeDefined();
      expect(hit?.priority).toBe('high');
      expect(hit?.evidence).toContain('80%');
      expect(hit?.evidence).toContain('梵高');
      expect(hit?.evidence).toContain('星月夜');
    });

    it('painting-orig-similarity-high: pHashSimilarity = undefined 不触发', () => {
      const m: JimpMetricsForPrompt = { ...buildMetrics(), pHashSimilarity: undefined };
      const out = generateTemplateSuggestions(m, 'painting');
      expect(out.some((s) => s.evidence.includes('pHash感知哈希相似度'))).toBe(false);
    });

    it('painting-orig-variation-low: edgeDensity<0.05 且 textureComplexity<0.25 同时满足触发', () => {
      const m = buildMetrics({ edgeDensity: 0.03, textureComplexity: 0.2 });
      const out = generateTemplateSuggestions(m, 'painting');
      const hit = out.find((s) => s.evidence.includes('边缘密度') && s.evidence.includes('纹理复杂度'));
      expect(hit).toBeDefined();
      expect(hit?.priority).toBe('medium');
    });

    it('painting-orig-variation-low: 仅 edgeDensity<0.05 不触发 (与关系)', () => {
      const m = buildMetrics({ edgeDensity: 0.03, textureComplexity: 0.5 });
      const out = generateTemplateSuggestions(m, 'painting');
      expect(out.some((s) => s.evidence.includes('变化不足'))).toBe(false);
    });
  });
});

// ============================================================
// 3. Design 规则触发 (11 条)
// ============================================================

describe('Design 规则触发', () => {
  describe('视觉层次类', () => {
    it('design-hierarchy-whitespace-high: whitespaceRatio > 0.45 触发 (high)', () => {
      const m = buildMetrics({ whitespaceRatio: 0.6 });
      const out = generateTemplateSuggestions(m, 'design');
      const hit = out.find((s) => s.evidence.includes('信息密度过低'));
      expect(hit).toBeDefined();
      expect(hit?.priority).toBe('high');
      expect(hit?.dimension).toBe('视觉层次');
    });

    it('design-hierarchy-whitespace-low: whitespaceRatio < 0.20 触发 (high)', () => {
      const m = buildMetrics({ whitespaceRatio: 0.15 });
      const out = generateTemplateSuggestions(m, 'design');
      const hit = out.find((s) => s.evidence.includes('版面拥挤'));
      expect(hit).toBeDefined();
      expect(hit?.priority).toBe('high');
    });

    it('design-hierarchy-focus-offset: focusX > 0.7 触发 (high)', () => {
      const m = buildMetrics({ focusX: 0.85 });
      const out = generateTemplateSuggestions(m, 'design');
      const hit = out.find((s) => s.evidence.includes('信息焦点失衡'));
      expect(hit).toBeDefined();
      expect(hit?.operation).toContain('左');
    });

    it('design-hierarchy-focus-offset: focusX < 0.3 触发向右调整', () => {
      const m = buildMetrics({ focusX: 0.2 });
      const out = generateTemplateSuggestions(m, 'design');
      const hit = out.find((s) => s.evidence.includes('信息焦点失衡'));
      expect(hit).toBeDefined();
      expect(hit?.operation).toContain('右');
    });

    it('design-hierarchy-golden-ratio-low: goldenRatioScore < 50 触发 (medium)', () => {
      const m = buildMetrics({ goldenRatioScore: 40 });
      const out = generateTemplateSuggestions(m, 'design');
      const hit = out.find((s) => s.evidence.includes('黄金分割评分') && s.dimension === '视觉层次');
      expect(hit).toBeDefined();
      expect(hit?.priority).toBe('medium');
    });
  });

  describe('排版类', () => {
    it('design-hierarchy-leading-line-weak: leadingLineStrength < 0.2 触发 (medium, 排版维度)', () => {
      const m = buildMetrics({ leadingLineStrength: 0.1 });
      const out = generateTemplateSuggestions(m, 'design');
      const hit = out.find((s) => s.dimension === '排版' && s.evidence.includes('引导线强度'));
      expect(hit).toBeDefined();
      expect(hit?.priority).toBe('medium');
    });

    it('design-typography-direction-incoherent: directionCoherence < 0.30 触发 (medium)', () => {
      const m = buildMetrics({ directionCoherence: 0.15 });
      const out = generateTemplateSuggestions(m, 'design');
      const hit = out.find((s) => s.dimension === '排版' && s.evidence.includes('方向一致性'));
      expect(hit).toBeDefined();
      expect(hit?.priority).toBe('medium');
    });
  });

  describe('色彩类', () => {
    it('design-color-warm-excessive: warmRatio > 0.70 触发 (medium)', () => {
      const m = buildMetrics({ warmRatio: 0.85, coolRatio: 0.15 });
      const out = generateTemplateSuggestions(m, 'design');
      const hit = out.find((s) => s.dimension === '色彩' && s.evidence.includes('暖色占比'));
      expect(hit).toBeDefined();
      expect(hit?.priority).toBe('medium');
    });

    it('design-color-cool-excessive: coolRatio > 0.70 触发 (medium)', () => {
      const m = buildMetrics({ coolRatio: 0.85, warmRatio: 0.15 });
      const out = generateTemplateSuggestions(m, 'design');
      const hit = out.find((s) => s.dimension === '色彩' && s.evidence.includes('冷色占比'));
      expect(hit).toBeDefined();
      expect(hit?.priority).toBe('medium');
    });

    it('design-color-harmony-low: harmonyScore < 50 触发 (high)', () => {
      const m = buildMetrics({ harmonyScore: 35 });
      const out = generateTemplateSuggestions(m, 'design');
      const hit = out.find((s) => s.dimension === '色彩' && s.evidence.includes('色彩和谐度评分'));
      expect(hit).toBeDefined();
      expect(hit?.priority).toBe('high');
    });

    it('design-color-saturation-imbalance: avgSaturation > 75 触发 (low, 高饱和分支)', () => {
      const m = buildMetrics({ avgSaturation: 90 });
      const out = generateTemplateSuggestions(m, 'design');
      const hit = out.find((s) => s.dimension === '色彩' && s.evidence.includes('饱和度'));
      expect(hit).toBeDefined();
      expect(hit?.priority).toBe('low');
      expect(hit?.evidence).toContain('90');
      expect(hit?.evidence).toContain('过高');
    });

    it('design-color-saturation-imbalance: avgSaturation < 20 触发低饱和分支', () => {
      const m = buildMetrics({ avgSaturation: 10 });
      const out = generateTemplateSuggestions(m, 'design');
      const hit = out.find((s) => s.evidence.includes('过低'));
      expect(hit).toBeDefined();
      expect(hit?.evidence).toContain('10');
    });

    it('design-color-saturation-imbalance: avgSaturation 在 20-75 区间不触发', () => {
      const m = buildMetrics({ avgSaturation: 50 });
      const out = generateTemplateSuggestions(m, 'design');
      expect(out.some((s) => s.evidence.includes('饱和度') && (s.evidence.includes('过高') || s.evidence.includes('过低')))).toBe(false);
    });
  });

  describe('原创性类', () => {
    it('design-orig-similarity-high: pHashSimilarity > 0.5 触发 (high)', () => {
      const m = buildMetrics({ pHashSimilarity: 0.8 });
      const out = generateTemplateSuggestions(m, 'design');
      const hit = out.find((s) => s.dimension === '原创性' && s.evidence.includes('pHash'));
      expect(hit).toBeDefined();
      expect(hit?.priority).toBe('high');
    });
  });
});

// ============================================================
// 4. Product 规则触发 (9 条)
// ============================================================

describe('Product 规则触发', () => {
  describe('形态类', () => {
    it('product-form-whitespace-high: whitespaceRatio > 0.45 触发 (medium)', () => {
      const m = buildMetrics({ whitespaceRatio: 0.6 });
      const out = generateTemplateSuggestions(m, 'product');
      const hit = out.find((s) => s.dimension === '形态' && s.evidence.includes('空间占比中空'));
      expect(hit).toBeDefined();
      expect(hit?.priority).toBe('medium');
    });

    it('product-form-focus-offset: focusX > 0.7 触发 (high)', () => {
      const m = buildMetrics({ focusX: 0.85 });
      const out = generateTemplateSuggestions(m, 'product');
      const hit = out.find((s) => s.dimension === '形态' && s.evidence.includes('重心不稳'));
      expect(hit).toBeDefined();
      expect(hit?.priority).toBe('high');
      expect(hit?.operation).toContain('左');
    });

    it('product-form-focus-offset: focusX < 0.3 触发向右回移', () => {
      const m = buildMetrics({ focusX: 0.2 });
      const out = generateTemplateSuggestions(m, 'product');
      const hit = out.find((s) => s.dimension === '形态' && s.evidence.includes('重心不稳'));
      expect(hit).toBeDefined();
      expect(hit?.operation).toContain('右');
    });

    it('product-form-golden-ratio-low: goldenRatioScore < 50 触发 (medium)', () => {
      const m = buildMetrics({ goldenRatioScore: 35 });
      const out = generateTemplateSuggestions(m, 'product');
      const hit = out.find((s) => s.dimension === '形态' && s.evidence.includes('黄金分割评分'));
      expect(hit).toBeDefined();
      expect(hit?.priority).toBe('medium');
    });

    it('product-form-leading-line-weak: leadingLineStrength < 0.2 触发 (low)', () => {
      const m = buildMetrics({ leadingLineStrength: 0.1 });
      const out = generateTemplateSuggestions(m, 'product');
      const hit = out.find((s) => s.dimension === '形态' && s.evidence.includes('线条引导强度'));
      expect(hit).toBeDefined();
      expect(hit?.priority).toBe('low');
    });
  });

  describe('材质类', () => {
    it('product-mat-texture-too-simple: textureComplexity < 0.20 触发 (medium)', () => {
      const m = buildMetrics({ textureComplexity: 0.1 });
      const out = generateTemplateSuggestions(m, 'product');
      const hit = out.find((s) => s.dimension === '材质' && s.evidence.includes('材质纹理复杂度'));
      expect(hit).toBeDefined();
      expect(hit?.priority).toBe('medium');
    });

    it('product-mat-texture-too-complex: textureComplexity > 0.80 触发 (low)', () => {
      const m = buildMetrics({ textureComplexity: 0.9 });
      const out = generateTemplateSuggestions(m, 'product');
      const hit = out.find((s) => s.dimension === '材质' && s.evidence.includes('超过0.80'));
      expect(hit).toBeDefined();
      expect(hit?.priority).toBe('low');
    });

    it('product-mat-edge-too-dense: edgeDensity > 0.20 触发 (medium)', () => {
      const m = buildMetrics({ edgeDensity: 0.3 });
      const out = generateTemplateSuggestions(m, 'product');
      const hit = out.find((s) => s.dimension === '材质' && s.evidence.includes('边缘密度') && s.evidence.includes('超过0.20'));
      expect(hit).toBeDefined();
      expect(hit?.priority).toBe('medium');
    });
  });

  describe('形态(功能)类', () => {
    it('product-func-direction-incoherent: directionCoherence < 0.30 触发 (medium, 形态维度)', () => {
      const m = buildMetrics({ directionCoherence: 0.15 });
      const out = generateTemplateSuggestions(m, 'product');
      const hit = out.find((s) => s.dimension === '形态' && s.evidence.includes('方向一致性'));
      expect(hit).toBeDefined();
      expect(hit?.priority).toBe('medium');
    });
  });

  describe('原创性类', () => {
    it('product-orig-similarity-high: pHashSimilarity > 0.5 触发 (high)', () => {
      const m = buildMetrics({ pHashSimilarity: 0.8 });
      const out = generateTemplateSuggestions(m, 'product');
      const hit = out.find((s) => s.dimension === '原创性' && s.evidence.includes('pHash形态相似度'));
      expect(hit).toBeDefined();
      expect(hit?.priority).toBe('high');
    });
  });
});

// ============================================================
// 5. Sculpture 规则触发 (10 条)
// ============================================================

describe('Sculpture 规则触发', () => {
  describe('空间类', () => {
    it('sculpture-space-whitespace-high: whitespaceRatio > 0.50 触发 (high)', () => {
      const m = buildMetrics({ whitespaceRatio: 0.65 });
      const out = generateTemplateSuggestions(m, 'sculpture');
      const hit = out.find((s) => s.dimension === '空间' && s.evidence.includes('实体体积感不足'));
      expect(hit).toBeDefined();
      expect(hit?.priority).toBe('high');
      expect(hit?.evidence).toContain('65.0%');
    });

    it('sculpture-space-whitespace-high: whitespaceRatio = 0.50 边界不触发', () => {
      const m = buildMetrics({ whitespaceRatio: 0.5 });
      const out = generateTemplateSuggestions(m, 'sculpture');
      expect(out.some((s) => s.evidence.includes('实体体积感不足'))).toBe(false);
    });

    it('sculpture-space-whitespace-low: whitespaceRatio < 0.15 触发 (medium)', () => {
      const m = buildMetrics({ whitespaceRatio: 0.1 });
      const out = generateTemplateSuggestions(m, 'sculpture');
      const hit = out.find((s) => s.dimension === '空间' && s.evidence.includes('虚实关系失衡'));
      expect(hit).toBeDefined();
      expect(hit?.priority).toBe('medium');
    });

    it('sculpture-space-focus-offset: 任一坐标偏离 [0.3,0.7] 触发 (high)', () => {
      const m = buildMetrics({ focusX: 0.85, focusY: 0.5 });
      const out = generateTemplateSuggestions(m, 'sculpture');
      const hit = out.find((s) => s.dimension === '空间' && s.evidence.includes('偏离中心区域'));
      expect(hit).toBeDefined();
      expect(hit?.priority).toBe('high');
      expect(hit?.operation).toContain('左');
    });

    it('sculpture-space-focus-offset: focusY > 0.7 触发向下回移', () => {
      const m = buildMetrics({ focusX: 0.5, focusY: 0.85 });
      const out = generateTemplateSuggestions(m, 'sculpture');
      const hit = out.find((s) => s.dimension === '空间' && s.evidence.includes('偏离中心区域'));
      expect(hit).toBeDefined();
      expect(hit?.operation).toContain('下');
    });

    it('sculpture-space-golden-ratio-low: goldenRatioScore < 50 触发 (medium)', () => {
      const m = buildMetrics({ goldenRatioScore: 40 });
      const out = generateTemplateSuggestions(m, 'sculpture');
      const hit = out.find((s) => s.dimension === '空间' && s.evidence.includes('黄金分割评分'));
      expect(hit).toBeDefined();
      expect(hit?.priority).toBe('medium');
    });

    it('sculpture-space-leading-line-weak: leadingLineStrength < 0.2 触发 (low, 动态线)', () => {
      const m = buildMetrics({ leadingLineStrength: 0.1 });
      const out = generateTemplateSuggestions(m, 'sculpture');
      const hit = out.find((s) => s.dimension === '空间' && s.evidence.includes('动态线强度'));
      expect(hit).toBeDefined();
      expect(hit?.priority).toBe('low');
    });
  });

  describe('形体类', () => {
    it('sculpture-body-direction-incoherent: directionCoherence < 0.30 触发 (medium)', () => {
      const m = buildMetrics({ directionCoherence: 0.15 });
      const out = generateTemplateSuggestions(m, 'sculpture');
      const hit = out.find((s) => s.dimension === '形体' && s.evidence.includes('方向一致性'));
      expect(hit).toBeDefined();
      expect(hit?.priority).toBe('medium');
    });

    it('sculpture-body-energy-low: strokeEnergy < 0.20 触发 (medium)', () => {
      const m = buildMetrics({ strokeEnergy: 0.1 });
      const out = generateTemplateSuggestions(m, 'sculpture');
      const hit = out.find((s) => s.dimension === '形体' && s.evidence.includes('形体张力'));
      expect(hit).toBeDefined();
      expect(hit?.priority).toBe('medium');
    });
  });

  describe('材质类', () => {
    it('sculpture-mat-texture-too-simple: textureComplexity < 0.20 触发 (low)', () => {
      const m = buildMetrics({ textureComplexity: 0.1 });
      const out = generateTemplateSuggestions(m, 'sculpture');
      const hit = out.find((s) => s.dimension === '材质' && s.evidence.includes('材质肌理复杂度'));
      expect(hit).toBeDefined();
      expect(hit?.priority).toBe('low');
    });

    it('sculpture-mat-edge-too-few: edgeDensity < 0.03 触发 (medium)', () => {
      const m = buildMetrics({ edgeDensity: 0.01 });
      const out = generateTemplateSuggestions(m, 'sculpture');
      const hit = out.find((s) => s.dimension === '材质' && s.evidence.includes('边缘/细节密度'));
      expect(hit).toBeDefined();
      expect(hit?.priority).toBe('medium');
    });
  });

  describe('原创性类', () => {
    it('sculpture-orig-similarity-high: pHashSimilarity > 0.5 触发 (high)', () => {
      const m = buildMetrics({ pHashSimilarity: 0.8 });
      const out = generateTemplateSuggestions(m, 'sculpture');
      const hit = out.find((s) => s.dimension === '原创性' && s.evidence.includes('pHash造型相似度'));
      expect(hit).toBeDefined();
      expect(hit?.priority).toBe('high');
    });
  });
});

// ============================================================
// 6. 优先级排序与数量限制
// ============================================================

describe('优先级排序与数量限制', () => {
  it('高优先级规则排在最前,medium 次之,low 最后', () => {
    // 同时触发 high(pHash相似) + medium(笔触能量低) + low(纹理过简)
    const m = buildMetrics({
      pHashSimilarity: 0.8, // high
      strokeEnergy: 0.1, // medium
      textureComplexity: 0.1, // low
    });
    const out = generateTemplateSuggestions(m, 'painting');
    expect(out.length).toBeGreaterThan(0);
    // 找到各 priority 首次出现位置
    const firstHigh = out.findIndex((s) => s.priority === 'high');
    const firstMedium = out.findIndex((s) => s.priority === 'medium');
    const firstLow = out.findIndex((s) => s.priority === 'low');
    // 前置断言:三条规则均应触发(1 high + 1 medium + 1 low = 3 ≤ 5,不会被截断)
    expect(firstHigh).not.toBe(-1);
    expect(firstMedium).not.toBe(-1);
    expect(firstLow).not.toBe(-1);
    expect(firstHigh).toBeLessThanOrEqual(firstMedium);
    expect(firstMedium).toBeLessThanOrEqual(firstLow);
  });

  it('high 优先级最多 2 条', () => {
    // 触发 4 条 high: warm>0.7, cool>0.7, focusX>0.7, pHash>0.5, directionCoherence<0.3
    // (warm/cool 互斥, 实际只能同时触发其一)
    // 改为: warm(高), focusX右(高), pHash(高), directionCoherence(高) → 4 条 high
    const m = buildMetrics({
      warmRatio: 0.85,
      coolRatio: 0.15,
      focusX: 0.85,
      pHashSimilarity: 0.8,
      directionCoherence: 0.15,
    });
    const out = generateTemplateSuggestions(m, 'painting');
    const highCount = out.filter((s) => s.priority === 'high').length;
    expect(highCount).toBeLessThanOrEqual(2);
  });

  it('medium 优先级最多 2 条', () => {
    // 触发多个 medium: whitespace<0.2, goldenRatio<50, leadingLine<0.2, strokeEnergy<0.2
    const m = buildMetrics({
      whitespaceRatio: 0.15,
      goldenRatioScore: 30,
      leadingLineStrength: 0.1,
      strokeEnergy: 0.1,
      edgeDensity: 0.5, // 避免 orig-variation-low
      textureComplexity: 0.5,
    });
    const out = generateTemplateSuggestions(m, 'painting');
    const mediumCount = out.filter((s) => s.priority === 'medium').length;
    expect(mediumCount).toBeLessThanOrEqual(2);
  });

  it('low 优先级触发规则最多 1 条 (触发规则数,排除通用建议补足)', () => {
    // 触发两个 low 规则: texture-too-simple + saturation-imbalance
    // 同时触发 1 个 high + 1 个 medium,使总数 > 3 不触发补足逻辑
    const m = buildMetrics({
      textureComplexity: 0.1, // low (painting-brush-texture-too-simple)
      saturationDistribution: { low: 0.85, mid: 0.1, high: 0.05 }, // low (painting-color-saturation-imbalance)
      // 同时触发 high 和 medium 避免补足逻辑
      pHashSimilarity: 0.8, // high
      goldenRatioScore: 30, // medium
      // 关闭其他干扰规则
      whitespaceRatio: 0.3,
      warmRatio: 0.5,
      coolRatio: 0.5,
      avgSaturation: 50,
      focusX: 0.5,
      harmonyScore: 70,
      leadingLineStrength: 0.5,
      directionCoherence: 0.6,
      strokeEnergy: 0.5,
      edgeDensity: 0.5,
    });
    const out = generateTemplateSuggestions(m, 'painting');
    // 仅统计"触发规则"产生的 low 建议 (evidence 含"纹理复杂度"或"饱和度分布")
    const triggeredLow = out.filter(
      (s) =>
        s.priority === 'low' &&
        (s.evidence.includes('纹理复杂度') || s.evidence.includes('饱和度分布不均')),
    );
    expect(triggeredLow.length).toBeLessThanOrEqual(1);
  });

  it('总数不超过 5 条', () => {
    // 大量指标超出阈值,触发多个规则
    const m = buildMetrics({
      whitespaceRatio: 0.6,
      warmRatio: 0.85,
      focusX: 0.85,
      pHashSimilarity: 0.8,
      directionCoherence: 0.15,
      goldenRatioScore: 30,
      strokeEnergy: 0.1,
      textureComplexity: 0.1,
    });
    const out = generateTemplateSuggestions(m, 'painting');
    expect(out.length).toBeLessThanOrEqual(5);
  });

  it('同优先级组内保持触发顺序 (规则定义顺序)', () => {
    // 触发两条 high: warm-excessive(idx=6) 在 focus-offset-right(idx=2) 之后定义
    // 实际触发顺序按 PAINTING_RULES 中定义顺序: focus-offset-right 先于 warm-excessive
    const m = buildMetrics({
      focusX: 0.85,
      warmRatio: 0.85,
      coolRatio: 0.15,
    });
    const out = generateTemplateSuggestions(m, 'painting');
    const highRules = out.filter((s) => s.priority === 'high');
    // 第一条应为 focus-offset (evidence 含"重心偏右")
    expect(highRules[0]?.evidence).toContain('重心偏右');
    // 第二条应为 warm-excessive (evidence 含"暖色占比")
    expect(highRules[1]?.evidence).toContain('暖色占比');
  });
});

// ============================================================
// 7. 通用建议回退 (无规则触发)
// ============================================================

describe('通用鼓励性建议回退', () => {
  it('painting: 所有指标正常 → 返回通用建议 (≥3 条)', () => {
    const m = buildMetrics(); // 默认值全部在正常区间
    const out = generateTemplateSuggestions(m, 'painting');
    expect(out.length).toBeGreaterThanOrEqual(3);
    expect(out.length).toBeLessThanOrEqual(4); // painting 通用建议 4 条
    // 维度应属于绘画类
    const dims = out.map((s) => s.dimension);
    expect(dims.some((d) => ['构图', '色彩', '笔触', '原创性'].includes(d))).toBe(true);
  });

  it('design: 所有指标正常 → 返回通用建议', () => {
    const m = buildMetrics();
    const out = generateTemplateSuggestions(m, 'design');
    expect(out.length).toBeGreaterThanOrEqual(3);
    const dims = out.map((s) => s.dimension);
    expect(dims.some((d) => ['视觉层次', '排版', '色彩', '原创性'].includes(d))).toBe(true);
  });

  it('product: 所有指标正常 → 返回通用建议', () => {
    const m = buildMetrics();
    const out = generateTemplateSuggestions(m, 'product');
    expect(out.length).toBeGreaterThanOrEqual(3);
  });

  it('sculpture: 所有指标正常 → 返回通用建议', () => {
    const m = buildMetrics();
    const out = generateTemplateSuggestions(m, 'sculpture');
    expect(out.length).toBeGreaterThanOrEqual(3);
  });
});

// ============================================================
// 8. 不足 3 条建议时补足到 3 条
// ============================================================

describe('建议补足逻辑', () => {
  it('仅触发 1 条规则时,从通用建议补足到至少 3 条', () => {
    // 仅触发 painting-color-saturation-imbalance (low, 唯一 low)
    const m = buildMetrics({
      saturationDistribution: { low: 0.85, mid: 0.1, high: 0.05 },
      // 关闭其他所有规则
      whitespaceRatio: 0.3,
      warmRatio: 0.5,
      coolRatio: 0.5,
      avgSaturation: 50,
      focusX: 0.5,
      goldenRatioScore: 70,
      harmonyScore: 70,
      leadingLineStrength: 0.5,
      directionCoherence: 0.6,
      strokeEnergy: 0.5,
      textureComplexity: 0.5, // 不触发 texture-too-simple
      edgeDensity: 0.5,
      pHashSimilarity: 0.2,
    });
    const out = generateTemplateSuggestions(m, 'painting');
    expect(out.length).toBeGreaterThanOrEqual(3);
    // 第一条应为触发的 low 规则 (饱和度分布)
    expect(out[0]?.evidence).toContain('饱和度分布不均');
    // 后续为通用建议,维度不重复
    const dims = out.map((s) => s.dimension);
    // 触发规则维度为"色彩",通用建议补足时跳过"色彩"
    expect(dims.filter((d) => d === '色彩').length).toBe(1);
  });

  it('仅触发 2 条规则时,补足到至少 3 条', () => {
    // 触发 painting-color-saturation-imbalance (low) + painting-brush-texture-too-simple (low)
    // 但 low 限制为 1 条 → 实际 selected 只有 1 条 low,触发补足逻辑
    const m = buildMetrics({
      saturationDistribution: { low: 0.85, mid: 0.1, high: 0.05 },
      textureComplexity: 0.1,
      // 关闭其他
      whitespaceRatio: 0.3,
      warmRatio: 0.5,
      coolRatio: 0.5,
      avgSaturation: 50,
      focusX: 0.5,
      goldenRatioScore: 70,
      harmonyScore: 70,
      leadingLineStrength: 0.5,
      directionCoherence: 0.6,
      strokeEnergy: 0.5,
      edgeDensity: 0.5,
      pHashSimilarity: 0.2,
    });
    const out = generateTemplateSuggestions(m, 'painting');
    expect(out.length).toBeGreaterThanOrEqual(3);
  });
});

// ============================================================
// 9. ProfessionalSuggestion 字段完整性
// ============================================================

describe('ProfessionalSuggestion 字段完整性', () => {
  it('每条建议包含 dimension/level/evidence/operation/reference/practice/priority 七字段', () => {
    const m = buildMetrics({ whitespaceRatio: 0.6 });
    const out = generateTemplateSuggestions(m, 'painting');
    expect(out.length).toBeGreaterThan(0);
    for (const s of out) {
      expect(typeof s.dimension).toBe('string');
      expect(s.dimension.length).toBeGreaterThan(0);
      expect(['excellent', 'good', 'average', 'poor']).toContain(s.level);
      expect(typeof s.evidence).toBe('string');
      expect(s.evidence.length).toBeGreaterThan(0);
      expect(typeof s.operation).toBe('string');
      expect(s.operation.length).toBeGreaterThan(0);
      expect(typeof s.reference).toBe('string');
      expect(s.reference.length).toBeGreaterThan(0);
      expect(typeof s.practice).toBe('string');
      expect(s.practice.length).toBeGreaterThan(0);
      expect(['high', 'medium', 'low']).toContain(s.priority);
    }
  });

  it('priority → level 映射: high→poor, medium→average, low→good', () => {
    const m = buildMetrics({
      whitespaceRatio: 0.6, // high (painting-comp-whitespace-high)
      goldenRatioScore: 30, // medium
      textureComplexity: 0.1, // low
    });
    const out = generateTemplateSuggestions(m, 'painting');
    const high = out.find((s) => s.priority === 'high');
    const medium = out.find((s) => s.priority === 'medium');
    const low = out.find((s) => s.priority === 'low');
    // 前置断言确保规则已触发,避免条件断言被静默跳过
    expect(high).toBeDefined();
    expect(medium).toBeDefined();
    expect(low).toBeDefined();
    expect(high?.level).toBe('poor');
    expect(medium?.level).toBe('average');
    expect(low?.level).toBe('good');
  });

  it('evidence 必须包含具体数值证据 (非空泛反馈)', () => {
    const m = buildMetrics({
      whitespaceRatio: 0.583,
      warmRatio: 0.82,
    });
    const out = generateTemplateSuggestions(m, 'painting');
    const whitespace = out.find((s) => s.evidence.includes('留白比例'));
    expect(whitespace?.evidence).toMatch(/58\.3%|58%/);
    const warm = out.find((s) => s.evidence.includes('暖色占比'));
    expect(warm?.evidence).toContain('82%');
  });
});

// ============================================================
// 10. createFallbackAIVisionResult
// ============================================================

describe('createFallbackAIVisionResult', () => {
  it('painting: 返回 AIVisionResult 结构,语义描述含"绘画"', () => {
    const m = buildMetrics();
    const result = createFallbackAIVisionResult(m, 'painting');
    expect(result.semanticTheme).toContain('绘画');
    // 批次③:降级文案改为"AI 深度语义分析暂不可用,可稍后重试"
    expect(result.semanticTheme).toContain('AI 深度语义分析暂不可用');
    expect(result.styleRecognition).toBe('离线分析模式(AI暂不可用)');
    expect(Array.isArray(result.professionalSuggestions)).toBe(true);
    expect(result.scoreAdjustments.dimensionAdjustments).toEqual([]);
    expect(result.scoreAdjustments.overallDelta).toBe(0);
    expect(result.scoreAdjustments.overallReason).toContain('AI分析暂不可用');
    expect(result.referenceArtworks).toEqual([]);
  });

  it('design: 语义描述含"设计"', () => {
    const result = createFallbackAIVisionResult(buildMetrics(), 'design');
    expect(result.semanticTheme).toContain('设计');
  });

  it('product: 语义描述含"产品设计"', () => {
    const result = createFallbackAIVisionResult(buildMetrics(), 'product');
    expect(result.semanticTheme).toContain('产品设计');
  });

  it('sculpture: 语义描述含"雕塑"', () => {
    const result = createFallbackAIVisionResult(buildMetrics(), 'sculpture');
    expect(result.semanticTheme).toContain('雕塑');
  });

  it('fallback 不再填充模板建议(批次③:模板话术下线,建议恒为空)', () => {
    const m = buildMetrics({ whitespaceRatio: 0.6, warmRatio: 0.85, coolRatio: 0.15 });
    const result = createFallbackAIVisionResult(m, 'painting');
    // 批次③:阈值触发的模板建议对所有作品输出同样话术,已下线
    expect(result.professionalSuggestions).toEqual([]);
  });
});

// ============================================================
// 11. 边界与容错
// ============================================================

describe('边界与容错', () => {
  it('所有可选指标缺失时仍能正常运行 (使用默认值)', () => {
    const m: JimpMetricsForPrompt = {
      focusX: 0.5,
      focusY: 0.5,
      whitespaceRatio: 0.3,
      warmRatio: 0.5,
      coolRatio: 0.5,
      dominantColor: '灰',
      avgLuminance: 128,
      avgSaturation: 50,
      contrast: 'medium',
      textureComplexity: 0.5,
      edgeDensity: 0.1,
      // 所有可选字段缺失
    };
    expect(() => generateTemplateSuggestions(m, 'painting')).not.toThrow();
    const out = generateTemplateSuggestions(m, 'painting');
    expect(out.length).toBeGreaterThan(0);
  });

  it('极端值指标不导致崩溃', () => {
    const m = buildMetrics({
      whitespaceRatio: 0.99,
      warmRatio: 0.99,
      coolRatio: 0.99, // 故意矛盾
      avgSaturation: 200, // 越界
      textureComplexity: 5, // 越界
      edgeDensity: -1, // 越界
      pHashSimilarity: 1.5, // 越界
    });
    expect(() => generateTemplateSuggestions(m, 'painting')).not.toThrow();
  });

  it('相同输入确定性输出', () => {
    const m = buildMetrics({ whitespaceRatio: 0.6, warmRatio: 0.85, coolRatio: 0.15 });
    const out1 = generateTemplateSuggestions(m, 'painting');
    const out2 = generateTemplateSuggestions(m, 'painting');
    expect(out1.length).toBe(out2.length);
    for (let i = 0; i < out1.length; i++) {
      expect(out1[i].dimension).toBe(out2[i].dimension);
      expect(out1[i].evidence).toBe(out2[i].evidence);
      expect(out1[i].operation).toBe(out2[i].operation);
    }
  });

  it('condition 异常时跳过该规则,不影响其他规则 (容错验证)', () => {
    // saturationDistribution=null 会使 painting-color-saturation-imbalance 的 condition 抛 TypeError
    // 源码 try-catch 应跳过该规则,其他规则仍正常输出
    const m = buildMetrics({
      whitespaceRatio: 0.6, // 触发 painting-comp-whitespace-high
      warmRatio: 0.85, coolRatio: 0.15, // 触发 painting-color-warm-excessive
      saturationDistribution: null as any, // 故意设为 null 触发 condition 异常
    });
    expect(() => generateTemplateSuggestions(m, 'painting')).not.toThrow();
    const out = generateTemplateSuggestions(m, 'painting');
    // 其他规则仍应正常触发
    expect(out.some((s) => s.evidence.includes('留白比例'))).toBe(true);
    expect(out.some((s) => s.evidence.includes('暖色占比'))).toBe(true);
    // 异常规则不应出现在输出中
    expect(out.some((s) => s.evidence.includes('饱和度分布不均'))).toBe(false);
  });

  it('evidence 异常时跳过该规则,不影响其他规则 (容错验证)', () => {
    // mostSimilarWork 设为异常值 (非对象),可能使 evidence 函数抛错
    // 源码 try-catch 应跳过该规则的 evidence 生成
    const m = buildMetrics({
      pHashSimilarity: 0.8,
      mostSimilarWork: 'invalid-string' as any, // 非对象,可能使 evidence 中 .title 抛错
    });
    expect(() => generateTemplateSuggestions(m, 'painting')).not.toThrow();
    const out = generateTemplateSuggestions(m, 'painting');
    // 其他通用建议仍应输出 (因 pHash 规则 evidence 可能失败被跳过)
    expect(out.length).toBeGreaterThan(0);
  });
});
