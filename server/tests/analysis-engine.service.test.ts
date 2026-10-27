// ============================================================
// 图像分析引擎 纯算法单元测试 (Phase F2-7)
// 对应源码: src/services/analysis-engine.service.ts
//
// 测试范围:
//   1. calculateColorHarmony: 6种和谐类型 + mixed 回退
//   2. calculateGoldenRatioScore: 黄金分割点命中/偏离/边界
//   3. calculateRuleOfThirdsScore: 三分点命中/偏离
//   4. detectLeadingLines: 无边缘/弱边缘/水平/垂直/对角方向
//   5. computeStructureTensor: 全透明/零梯度/方向性/各向同性
//   6. computePHashFromJimp: 返回格式/确定性/区分度
//   7. hammingDistance: 相同/不同长度/已知位差异
//   8. computeObjectiveChecksData: 客观画面检测(画面灰/对比度/饱和度/重心, Phase 1B)
//
// Mock 策略:
//   - setup.ts 全局 mock Jimp (避免 HTTP 请求)
//   - computePHashFromJimp 需要构造伪 Jimp 实例 (含 clone/resize/grayscale/bitmap.data)
//   - 其余纯算法函数只需构造 PixelAnalysis 中间结构,无外部依赖
// ============================================================

import { describe, it, expect } from 'vitest';
import type Jimp from 'jimp';
import {
  calculateColorHarmony,
  calculateGoldenRatioScore,
  calculateRuleOfThirdsScore,
  detectLeadingLines,
  computeStructureTensor,
  computePHashFromJimp,
  hammingDistance,
  computeObjectiveChecksData,
  rejudgeObjectiveChecks,
} from '../src/services/analysis-engine.service.js';
import type { ObjectiveChecksData } from '../src/types/api-contract.js';

// ============================================================
// 辅助类型与构造器
// ============================================================

/** PixelAnalysis 兼容结构 (源码中 PixelAnalysis 未导出,用结构兼容类型替代) */
interface PixelAnalysisLike {
  pixels: Array<{ r: number; g: number; b: number; a: number }>;
  width: number;
  height: number;
  luminanceMap: number[];
  edgeMap: boolean[];
  colorBuckets: Record<string, number>;
  warmRatio: number;
  avgLuminance: number;
  avgSaturation: number;
  totalValid: number;
  hueHistogram: number[];
  saturationDistribution: { low: number; mid: number; high: number };
  gradientX: number[];
  gradientY: number[];
}

/**
 * 构造 PixelAnalysis 中间结构,允许覆盖任意字段
 * 默认值: 10×10 全黑不透明图像,无边缘,零梯度,中等饱和度
 */
function buildPixelAnalysis(overrides: Partial<PixelAnalysisLike> = {}): PixelAnalysisLike {
  const width = overrides.width ?? 10;
  const height = overrides.height ?? 10;
  const total = width * height;
  return {
    pixels: Array.from({ length: total }, () => ({ r: 128, g: 128, b: 128, a: 255 })),
    width,
    height,
    luminanceMap: new Array<number>(total).fill(128),
    edgeMap: new Array<boolean>(total).fill(false),
    colorBuckets: { '4-4-4': total },
    warmRatio: 0.5,
    avgLuminance: 128,
    avgSaturation: 50,
    totalValid: total,
    hueHistogram: new Array<number>(36).fill(0),
    saturationDistribution: { low: 0.33, mid: 0.34, high: 0.33 },
    gradientX: new Array<number>(total).fill(0),
    gradientY: new Array<number>(total).fill(0),
    ...overrides,
  };
}

/** 构造全为单一色相分布的 hueHistogram (36 桶,指定 bin 设为 ratio,其余为 0) */
function buildHueHistogram(bins: Record<number, number>): number[] {
  const hist = new Array<number>(36).fill(0);
  for (const [bin, val] of Object.entries(bins)) {
    hist[Number(bin)] = val;
  }
  return hist;
}

// ============================================================
// 伪 Jimp 实例 (供 computePHashFromJimp 测试使用)
// ============================================================

interface FakeJimpInstance {
  bitmap: { width: number; height: number; data: Buffer };
  clone(): FakeJimpInstance;
  resize(w: number, h: number): FakeJimpInstance;
  grayscale(): FakeJimpInstance;
}

/**
 * 构造伪 Jimp 实例,像素由 getPixelValue(x, y) 决定 (灰度:r=g=b=v, a=255)
 * 支持 clone/resize/grayscale 链式调用,与 computePHashFromJimp 内部使用方式兼容
 */
function createFakeJimpForHash(
  getPixelValue: (x: number, y: number) => number,
  width = 100,
  height = 100,
): FakeJimpInstance {
  const buildData = (w: number, h: number): Buffer => {
    const data = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        const v = getPixelValue(x, y);
        data[idx] = v;
        data[idx + 1] = v;
        data[idx + 2] = v;
        data[idx + 3] = 255;
      }
    }
    return data;
  };

  const instance: FakeJimpInstance = {
    bitmap: { width, height, data: buildData(width, height) },
    clone(): FakeJimpInstance {
      return createFakeJimpForHash(getPixelValue, width, height);
    },
    resize(w: number, h: number): FakeJimpInstance {
      instance.bitmap = { width: w, height: h, data: buildData(w, h) };
      return instance;
    },
    grayscale(): FakeJimpInstance {
      return instance;
    },
  };
  return instance;
}

// ============================================================
// 1. calculateColorHarmony 测试
// ============================================================

describe('calculateColorHarmony', () => {
  it('achromatic: avgSaturation < 15 时返回 achromatic 类型', () => {
    const pa = buildPixelAnalysis({ avgSaturation: 10 });
    const result = calculateColorHarmony(pa);
    expect(result.type).toBe('achromatic');
    expect(result.score).toBeGreaterThanOrEqual(70);
    expect(result.score).toBeLessThan(80);
  });

  it('achromatic: avgSaturation = 14.99 仍触发 achromatic', () => {
    const pa = buildPixelAnalysis({ avgSaturation: 14.99 });
    expect(calculateColorHarmony(pa).type).toBe('achromatic');
  });

  it('achromatic: avgSaturation = 15 不触发 achromatic (边界)', () => {
    const pa = buildPixelAnalysis({
      avgSaturation: 15,
      hueHistogram: new Array<number>(36).fill(0.01),
    });
    const result = calculateColorHarmony(pa);
    expect(result.type).not.toBe('achromatic');
  });

  it('monochromatic: 主色相 ±2 桶占比 > 60% 时触发', () => {
    // bin 0 = 0.65, 其余 0 → monoSum (bins 34,35,0,1,2) = 0.65 > 0.6
    const pa = buildPixelAnalysis({
      avgSaturation: 50,
      hueHistogram: buildHueHistogram({ 0: 0.65 }),
    });
    const result = calculateColorHarmony(pa);
    expect(result.type).toBe('monochromatic');
    expect(result.score).toBeGreaterThanOrEqual(75);
  });

  it('monochromatic: 主色相 ±2 桶占比 = 60% 不触发 (边界, < 不是 <=)', () => {
    // monoSum = 0.6, 不 > 0.6 → 进入 complementary 检查
    // compSum = 0, monoSum + compSum = 0.6 > 0.3 → complementary
    const pa = buildPixelAnalysis({
      avgSaturation: 50,
      hueHistogram: buildHueHistogram({ 0: 0.6 }),
    });
    const result = calculateColorHarmony(pa);
    expect(result.type).toBe('complementary');
  });

  it('complementary: 主色 + 互补色合计 > 30% 时触发', () => {
    // bin 0 = 0.2 (monoSum = 0.2), bin 18 = 0.15 (compSum = 0.15)
    // monoSum + compSum = 0.35 > 0.3, monoSum <= 0.6
    const pa = buildPixelAnalysis({
      avgSaturation: 50,
      hueHistogram: buildHueHistogram({ 0: 0.2, 18: 0.15 }),
    });
    const result = calculateColorHarmony(pa);
    expect(result.type).toBe('complementary');
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it('analogous: 4 连续桶占比 > 50% 时触发 (需绕过 complementary)', () => {
    // bin 0 = 0.3 (monoSum = 0.3, 不 > 0.6)
    // compSum (bins 15-21) = 0, monoSum + compSum = 0.3 (不 > 0.3, 严格大于)
    // bins 10,11,12,13 = 0.13 each (maxAnalogous = 0.52 > 0.5) → analogous
    const pa = buildPixelAnalysis({
      avgSaturation: 50,
      hueHistogram: buildHueHistogram({ 0: 0.3, 10: 0.13, 11: 0.13, 12: 0.13, 13: 0.13 }),
    });
    const result = calculateColorHarmony(pa);
    expect(result.type).toBe('analogous');
    expect(result.score).toBeGreaterThanOrEqual(78);
  });

  it('triadic: 三个 120° 间隔色相合计 > 45% 时触发', () => {
    // maxBin = 0, monoSum = 0.22 (> 0.15)
    // tri1 (bins 9-15) = bin 12 = 0.13 (> 0.1)
    // tri2 (bins 21-27) = bin 24 = 0.13 (> 0.1)
    // total = 0.22 + 0.13 + 0.13 = 0.48 > 0.45
    // compSum (bins 15-21) = 0, monoSum + compSum = 0.22 (不 > 0.3)
    // maxAnalogous = 0.22 (不 > 0.5)
    const pa = buildPixelAnalysis({
      avgSaturation: 50,
      hueHistogram: buildHueHistogram({ 0: 0.22, 12: 0.13, 24: 0.13 }),
    });
    const result = calculateColorHarmony(pa);
    expect(result.type).toBe('triadic');
    expect(result.score).toBeGreaterThanOrEqual(82);
  });

  it('split-complementary: 主色 + 互补色两侧扇区触发', () => {
    // maxBin = 0, monoSum = 0.25 (> 0.2, 不 > 0.6)
    // compSum (bins 15-21) = 0, monoSum + compSum = 0.25 (不 > 0.3)
    // maxAnalogous = 0.25 (不 > 0.5)
    // tri1 (bins 9-15) = bin 14 = 0.1, tri2 (bins 21-27) = 0
    // monoSum + tri1Sum + tri2Sum = 0.25 + 0.1 + 0 = 0.35 (不 > 0.45) → 不触发 triadic
    // sc1Start = (0+14)%36 = 14, sc1Sum = hist[14]+hist[15]+hist[13] = 0.1+0+0 = 0.1 (> 0.08)
    const pa = buildPixelAnalysis({
      avgSaturation: 50,
      hueHistogram: buildHueHistogram({ 0: 0.25, 14: 0.1 }),
    });
    const result = calculateColorHarmony(pa);
    expect(result.type).toBe('split-complementary');
  });

  it('mixed: 无明确和谐方案时返回 mixed', () => {
    // 所有 bin = 0.01, monoSum = 0.05, compSum = 0.07
    // monoSum + compSum = 0.12 (不 > 0.3)
    // maxAnalogous = 0.04 (不 > 0.5)
    // monoSum = 0.05 (不 > 0.15) → triadic 不触发
    // monoSum = 0.05 (不 > 0.2) → split-complementary 不触发
    const pa = buildPixelAnalysis({
      avgSaturation: 50,
      hueHistogram: new Array<number>(36).fill(0.01),
    });
    const result = calculateColorHarmony(pa);
    expect(result.type).toBe('mixed');
    expect(result.score).toBeGreaterThanOrEqual(55);
    expect(result.score).toBeLessThan(66);
  });

  it('所有和谐类型分数应在 [0, 100] 范围内', () => {
    const cases = [
      buildHueHistogram({ 0: 0.65 }),
      buildHueHistogram({ 0: 0.2, 18: 0.15 }),
      buildHueHistogram({ 0: 0.3, 10: 0.13, 11: 0.13, 12: 0.13, 13: 0.13 }),
      buildHueHistogram({ 0: 0.22, 12: 0.13, 24: 0.13 }),
      buildHueHistogram({ 0: 0.25, 14: 0.1 }),
      new Array<number>(36).fill(0.01),
    ];
    for ( const hist of cases) {
      const pa = buildPixelAnalysis({ avgSaturation: 50, hueHistogram: hist });
      const result = calculateColorHarmony(pa);
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
    }
  });
});

// ============================================================
// 2. calculateGoldenRatioScore 测试
// ============================================================

describe('calculateGoldenRatioScore', () => {
  it('焦点恰在黄金分割点上 → 100 分', () => {
    expect(calculateGoldenRatioScore({ x: 0.382, y: 0.382 })).toBe(100);
    expect(calculateGoldenRatioScore({ x: 0.382, y: 0.618 })).toBe(100);
    expect(calculateGoldenRatioScore({ x: 0.618, y: 0.382 })).toBe(100);
    expect(calculateGoldenRatioScore({ x: 0.618, y: 0.618 })).toBe(100);
  });

  it('焦点在画面中心 → 分数低于 100 但 > 0', () => {
    const score = calculateGoldenRatioScore({ x: 0.5, y: 0.5 });
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(100);
    // 中心到最近黄金点距离 = sqrt(2) * 0.118 ≈ 0.1669
    // score = 100 - 0.1669 * 200 ≈ 66.62
    expect(score).toBeCloseTo(66.62, 1);
  });

  it('焦点在角落 → 分数被 clamp 到 0', () => {
    expect(calculateGoldenRatioScore({ x: 0, y: 0 })).toBe(0);
    expect(calculateGoldenRatioScore({ x: 1, y: 1 })).toBe(0);
    expect(calculateGoldenRatioScore({ x: 0, y: 1 })).toBe(0);
    expect(calculateGoldenRatioScore({ x: 1, y: 0 })).toBe(0);
  });

  it('分数始终在 [0, 100] 范围内', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 0.5, y: 0.5 },
      { x: 0.382, y: 0.382 },
      { x: 0.9, y: 0.9 },
      { x: 0.1, y: 0.1 },
    ];
    for ( const p of points) {
      const score = calculateGoldenRatioScore(p);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });

  it('结果保留 2 位小数', () => {
    const score = calculateGoldenRatioScore({ x: 0.5, y: 0.5 });
    expect(Math.round(score * 100) / 100).toBe(score);
  });
});

// ============================================================
// 3. calculateRuleOfThirdsScore 测试
// ============================================================

describe('calculateRuleOfThirdsScore', () => {
  it('焦点恰在三分线交点上 → 100 分', () => {
    expect(calculateRuleOfThirdsScore({ x: 0.333, y: 0.333 })).toBe(100);
    expect(calculateRuleOfThirdsScore({ x: 0.333, y: 0.667 })).toBe(100);
    expect(calculateRuleOfThirdsScore({ x: 0.667, y: 0.333 })).toBe(100);
    expect(calculateRuleOfThirdsScore({ x: 0.667, y: 0.667 })).toBe(100);
  });

  it('焦点在画面中心 → 分数低于 100 但 > 0', () => {
    const score = calculateRuleOfThirdsScore({ x: 0.5, y: 0.5 });
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(100);
    // 中心到最近三分点距离 = sqrt(2) * 0.167 ≈ 0.236
    // score = 100 - 0.236 * 180 ≈ 57.53
    expect(score).toBeCloseTo(57.53, 1);
  });

  it('焦点偏离三分线交点越远分数越低', () => {
    const atThirds = calculateRuleOfThirdsScore({ x: 0.333, y: 0.333 });
    const atCenter = calculateRuleOfThirdsScore({ x: 0.5, y: 0.5 });
    const atCorner = calculateRuleOfThirdsScore({ x: 0, y: 0 });
    expect(atThirds).toBeGreaterThan(atCenter);
    expect(atCenter).toBeGreaterThan(atCorner);
  });

  it('分数始终在 [0, 100] 范围内', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 0.5, y: 0.5 },
      { x: 1, y: 1 },
    ];
    for ( const p of points) {
      const score = calculateRuleOfThirdsScore(p);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });
});

// ============================================================
// 4. detectLeadingLines 测试
// ============================================================

describe('detectLeadingLines', () => {
  it('无边缘像素 → direction=0, strength=0', () => {
    const pa = buildPixelAnalysis({
      width: 10,
      height: 10,
      edgeMap: new Array<boolean>(100).fill(false),
    });
    const result = detectLeadingLines(pa);
    expect(result.direction).toBe(0);
    expect(result.strength).toBe(0);
  });

  it('边缘像素 < 10 → direction=0, strength=0', () => {
    const edgeMap = new Array<boolean>(100).fill(false);
    // 仅设 5 个边缘
    for (let i = 0; i < 5; i++) edgeMap[i] = true;
    const pa = buildPixelAnalysis({ width: 10, height: 10, edgeMap });
    const result = detectLeadingLines(pa);
    expect(result.direction).toBe(0);
    expect(result.strength).toBe(0);
  });

  it('水平方向边缘 (iy=0, ix 大) → direction 约 11.25° (bin 0)', () => {
    // 10×10, 内部 8×8=64 像素全为边缘, 梯度全水平
    const total = 100;
    const edgeMap = new Array<boolean>(total).fill(false);
    const gradientX = new Array<number>(total).fill(0);
    const gradientY = new Array<number>(total).fill(0);
    for (let y = 1; y < 9; y++) {
      for (let x = 1; x < 9; x++) {
        const idx = y * 10 + x;
        edgeMap[idx] = true;
        gradientX[idx] = 20; // ix 大
        gradientY[idx] = 0; // iy = 0
      }
    }
    const pa = buildPixelAnalysis({ width: 10, height: 10, edgeMap, gradientX, gradientY });
    const result = detectLeadingLines(pa);
    // atan2(0, 20) = 0°, bin 0, direction = 0*22.5+11.25 = 11.25
    expect(result.direction).toBe(11.25);
    expect(result.strength).toBe(1); // 全部在同一 bin
  });

  it('垂直方向边缘 (ix=0, iy 大) → direction 约 101.25° (bin 4)', () => {
    const total = 100;
    const edgeMap = new Array<boolean>(total).fill(false);
    const gradientX = new Array<number>(total).fill(0);
    const gradientY = new Array<number>(total).fill(0);
    for (let y = 1; y < 9; y++) {
      for (let x = 1; x < 9; x++) {
        const idx = y * 10 + x;
        edgeMap[idx] = true;
        gradientX[idx] = 0;
        gradientY[idx] = 20; // iy 大
      }
    }
    const pa = buildPixelAnalysis({ width: 10, height: 10, edgeMap, gradientX, gradientY });
    const result = detectLeadingLines(pa);
    // atan2(20, 0) = 90°, bin = floor(90/22.5) = 4, direction = 4*22.5+11.25 = 101.25
    expect(result.direction).toBe(101.25);
    expect(result.strength).toBe(1);
  });

  it('45° 对角方向边缘 → direction 约 56.25° (bin 2)', () => {
    const total = 100;
    const edgeMap = new Array<boolean>(total).fill(false);
    const gradientX = new Array<number>(total).fill(0);
    const gradientY = new Array<number>(total).fill(0);
    for (let y = 1; y < 9; y++) {
      for (let x = 1; x < 9; x++) {
        const idx = y * 10 + x;
        edgeMap[idx] = true;
        gradientX[idx] = 20;
        gradientY[idx] = 20; // ix = iy → 45°
      }
    }
    const pa = buildPixelAnalysis({ width: 10, height: 10, edgeMap, gradientX, gradientY });
    const result = detectLeadingLines(pa);
    // atan2(20, 20) = 45°, bin = floor(45/22.5) = 2, direction = 2*22.5+11.25 = 56.25
    expect(result.direction).toBe(56.25);
  });

  it('strength 反映主峰占比 (混合方向)', () => {
    const total = 100;
    const edgeMap = new Array<boolean>(total).fill(false);
    const gradientX = new Array<number>(total).fill(0);
    const gradientY = new Array<number>(total).fill(0);
    // 48 个水平 + 16 个垂直 → 水平占 75%
    let count = 0;
    for (let y = 1; y < 9 && count < 48; y++) {
      for (let x = 1; x < 9 && count < 48; x++) {
        const idx = y * 10 + x;
        edgeMap[idx] = true;
        gradientX[idx] = 20;
        gradientY[idx] = 0;
        count++;
      }
    }
    for (let y = 1; y < 9 && count < 64; y++) {
      for (let x = 1; x < 9 && count < 64; x++) {
        const idx = y * 10 + x;
        if (!edgeMap[idx]) {
          edgeMap[idx] = true;
          gradientX[idx] = 0;
          gradientY[idx] = 20;
          count++;
        }
      }
    }
    const pa = buildPixelAnalysis({ width: 10, height: 10, edgeMap, gradientX, gradientY });
    const result = detectLeadingLines(pa);
    expect(result.direction).toBe(11.25); // 水平为主峰
    expect(result.strength).toBeCloseTo(0.75, 1);
  });

  it('弱边缘 (幅值 < 10) 被忽略', () => {
    const total = 100;
    const edgeMap = new Array<boolean>(total).fill(false);
    const gradientX = new Array<number>(total).fill(0);
    const gradientY = new Array<number>(total).fill(0);
    for (let y = 1; y < 9; y++) {
      for (let x = 1; x < 9; x++) {
        const idx = y * 10 + x;
        edgeMap[idx] = true;
        gradientX[idx] = 5; // 弱边缘, mag < 10
        gradientY[idx] = 5;
      }
    }
    const pa = buildPixelAnalysis({ width: 10, height: 10, edgeMap, gradientX, gradientY });
    const result = detectLeadingLines(pa);
    // 所有边缘幅值 = sqrt(25+25) ≈ 7.07 < 10, totalEdges = 0 < 10
    expect(result.direction).toBe(0);
    expect(result.strength).toBe(0);
  });
});

// ============================================================
// 5. computeStructureTensor 测试
// ============================================================

describe('computeStructureTensor', () => {
  it('所有像素透明 (a < 128) → count=0, 返回全零', () => {
    const total = 100;
    const pa = buildPixelAnalysis({
      width: 10,
      height: 10,
      pixels: Array.from({ length: total }, () => ({ r: 128, g: 128, b: 128, a: 0 })),
    });
    const result = computeStructureTensor(pa);
    expect(result.coherence).toBe(0);
    expect(result.energy).toBe(0);
    expect(result.dominantDirection).toBe(0);
  });

  it('零梯度 → coherence=0, energy=0', () => {
    const pa = buildPixelAnalysis({
      width: 10,
      height: 10,
      gradientX: new Array<number>(100).fill(0),
      gradientY: new Array<number>(100).fill(0),
    });
    const result = computeStructureTensor(pa);
    expect(result.coherence).toBe(0);
    expect(result.energy).toBe(0);
  });

  it('水平方向梯度 (ix 大, iy=0) → coherence=1, direction=0', () => {
    const total = 100;
    const gradientX = new Array<number>(total).fill(0);
    const gradientY = new Array<number>(total).fill(0);
    for (let y = 1; y < 9; y++) {
      for (let x = 1; x < 9; x++) {
        const idx = y * 10 + x;
        gradientX[idx] = 10;
        gradientY[idx] = 0;
      }
    }
    const pa = buildPixelAnalysis({ width: 10, height: 10, gradientX, gradientY });
    const result = computeStructureTensor(pa);
    // Ixx=100, Ixy=0, Iyy=0 → lambda1=100, lambda2=0
    // coherence = (100-0)/(100+0) = 1
    // |Ixy|<0.001 且 |lambda1-Ixx|=0 → dominantAngle=0
    expect(result.coherence).toBe(1);
    expect(result.energy).toBeCloseTo(0.02, 2); // 100/5000 = 0.02
    expect(result.dominantDirection).toBe(0);
  });

  it('垂直方向梯度 (ix=0, iy 大) → coherence=1, direction=90', () => {
    const total = 100;
    const gradientX = new Array<number>(total).fill(0);
    const gradientY = new Array<number>(total).fill(0);
    for (let y = 1; y < 9; y++) {
      for (let x = 1; x < 9; x++) {
        const idx = y * 10 + x;
        gradientX[idx] = 0;
        gradientY[idx] = 10;
      }
    }
    const pa = buildPixelAnalysis({ width: 10, height: 10, gradientX, gradientY });
    const result = computeStructureTensor(pa);
    // Ixx=0, Ixy=0, Iyy=100 → lambda1=100, lambda2=0
    // coherence = 1
    // |Ixy|<0.001 但 |lambda1-Ixx|=100 > 0.001 → atan2(100, 0) = 90°
    expect(result.coherence).toBe(1);
    expect(result.dominantDirection).toBe(90);
  });

  it('各向同性梯度 (水平+垂直各半) → coherence 接近 0', () => {
    const total = 100;
    const gradientX = new Array<number>(total).fill(0);
    const gradientY = new Array<number>(total).fill(0);
    let isHorizontal = true;
    for (let y = 1; y < 9; y++) {
      for (let x = 1; x < 9; x++) {
        const idx = y * 10 + x;
        if (isHorizontal) {
          gradientX[idx] = 10;
          gradientY[idx] = 0;
        } else {
          gradientX[idx] = 0;
          gradientY[idx] = 10;
        }
        isHorizontal = !isHorizontal;
      }
    }
    const pa = buildPixelAnalysis({ width: 10, height: 10, gradientX, gradientY });
    const result = computeStructureTensor(pa);
    // Ixx ≈ 50, Iyy ≈ 50, Ixy = 0 → lambda1 ≈ lambda2 ≈ 50
    // coherence = (50-50)/(50+50) = 0
    expect(result.coherence).toBeLessThan(0.05);
  });

  it('coherence 和 energy 在 [0, 1] 范围内, direction 在 [0, 180) 范围内', () => {
    const total = 100;
    const gradientX = new Array<number>(total).fill(0);
    const gradientY = new Array<number>(total).fill(0);
    for (let y = 1; y < 9; y++) {
      for (let x = 1; x < 9; x++) {
        const idx = y * 10 + x;
        gradientX[idx] = 15;
        gradientY[idx] = 8;
      }
    }
    const pa = buildPixelAnalysis({ width: 10, height: 10, gradientX, gradientY });
    const result = computeStructureTensor(pa);
    expect(result.coherence).toBeGreaterThanOrEqual(0);
    expect(result.coherence).toBeLessThanOrEqual(1);
    expect(result.energy).toBeGreaterThanOrEqual(0);
    expect(result.energy).toBeLessThanOrEqual(1);
    expect(result.dominantDirection).toBeGreaterThanOrEqual(0);
    expect(result.dominantDirection).toBeLessThan(180);
  });

  it('45° 对角梯度 → direction 约 45°', () => {
    const total = 100;
    const gradientX = new Array<number>(total).fill(0);
    const gradientY = new Array<number>(total).fill(0);
    for (let y = 1; y < 9; y++) {
      for (let x = 1; x < 9; x++) {
        const idx = y * 10 + x;
        gradientX[idx] = 10;
        gradientY[idx] = 10;
      }
    }
    const pa = buildPixelAnalysis({ width: 10, height: 10, gradientX, gradientY });
    const result = computeStructureTensor(pa);
    // Ixx=100, Ixy=100, Iyy=100
    // trace=200, det=0, disc=10000, sqrtDisc=100
    // lambda1=200, lambda2=0
    // atan2(200-100, 100) = atan2(100,100) = 45°
    expect(result.dominantDirection).toBe(45);
  });
});

// ============================================================
// 6. computePHashFromJimp 测试
// ============================================================

describe('computePHashFromJimp', () => {
  it('返回 16 字符 hex 字符串', () => {
    const fakeImg = createFakeJimpForHash(() => 128);
    const hash = computePHashFromJimp(fakeImg as unknown as Jimp);
    expect(hash).toHaveLength(16);
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('相同图像 → 相同哈希 (确定性)', () => {
    const img1 = createFakeJimpForHash(() => 128);
    const img2 = createFakeJimpForHash(() => 128);
    const hash1 = computePHashFromJimp(img1 as unknown as Jimp);
    const hash2 = computePHashFromJimp(img2 as unknown as Jimp);
    expect(hash1).toBe(hash2);
  });

  it('不同图像 → 不同哈希', () => {
    // 使用不同的非均匀图案 (均匀图像经 DCT 后非 DC 系数全为 0, 会产生相同哈希)
    const img1 = createFakeJimpForHash((x, y) => (x * 8) % 256);
    const img2 = createFakeJimpForHash((x, y) => (y * 8) % 256);
    const hash1 = computePHashFromJimp(img1 as unknown as Jimp);
    const hash2 = computePHashFromJimp(img2 as unknown as Jimp);
    expect(hash1).not.toBe(hash2);
  });

  it('渐变图像 → 有效哈希', () => {
    const img = createFakeJimpForHash((x, y) => (x + y) * 4);
    const hash = computePHashFromJimp(img as unknown as Jimp);
    expect(hash).toHaveLength(16);
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('哈希距离在合理范围 (与自身距离=0)', () => {
    const img = createFakeJimpForHash(() => 128);
    const hash = computePHashFromJimp(img as unknown as Jimp);
    expect(hammingDistance(hash, hash)).toBe(0);
  });
});

// ============================================================
// 7. hammingDistance 测试
// ============================================================

describe('hammingDistance', () => {
  it('相同哈希 → 距离 0', () => {
    expect(hammingDistance('0000000000000000', '0000000000000000')).toBe(0);
    expect(hammingDistance('ffffffffffffffff', 'ffffffffffffffff')).toBe(0);
    expect(hammingDistance('a5b3c7d9e1f2a3b4', 'a5b3c7d9e1f2a3b4')).toBe(0);
  });

  it('不同长度 → 返回 64 (最大距离)', () => {
    expect(hammingDistance('000', '0000')).toBe(64);
    expect(hammingDistance('', '0000000000000000')).toBe(64);
    expect(hammingDistance('0000000000000000', '000000000000000')).toBe(64);
  });

  it('仅最后一位不同 → 距离 1', () => {
    // 0 XOR 1 = 0001 → 1 bit
    expect(hammingDistance('0000000000000000', '0000000000000001')).toBe(1);
  });

  it('全 f vs 全 0 → 距离 64', () => {
    // f = 1111, 每个字符 4 bit 差异, 16 字符 = 64
    expect(hammingDistance('ffffffffffffffff', '0000000000000000')).toBe(64);
  });

  it('a vs 5 (每个字符 4 bit 差异) → 距离 64', () => {
    // a = 1010, 5 = 0101, XOR = 1111 = 4 bits
    expect(hammingDistance('aaaaaaaaaaaaaaaa', '5555555555555555')).toBe(64);
  });

  it('首字符 f vs 0 → 距离 4', () => {
    expect(hammingDistance('f000000000000000', '0000000000000000')).toBe(4);
  });

  it('距离对称性: dist(a, b) === dist(b, a)', () => {
    const a = 'a5b3c7d9e1f2a3b4';
    const b = '5a4c3d2e1f0b9c8d';
    expect(hammingDistance(a, b)).toBe(hammingDistance(b, a));
  });

  it('距离满足三角不等式: dist(a,c) <= dist(a,b) + dist(b,c)', () => {
    const a = 'ffff0000ffff0000';
    const b = '0ff00ff00ff00ff0';
    const c = '0000ffff0000ffff';
    const dab = hammingDistance(a, b);
    const dbc = hammingDistance(b, c);
    const dac = hammingDistance(a, c);
    expect(dac).toBeLessThanOrEqual(dab + dbc);
  });

  it('距离在 [0, 64] 范围内', () => {
    const pairs = [
      ['0000000000000000', '0000000000000000'],
      ['ffffffffffffffff', '0000000000000000'],
      ['a5b3c7d9e1f2a3b4', '5a4c3d2e1f0b9c8d'],
    ];
    for ( const [a, b] of pairs) {
      const dist = hammingDistance(a, b);
      expect(dist).toBeGreaterThanOrEqual(0);
      expect(dist).toBeLessThanOrEqual(64);
    }
  });
});

// ============================================================
// 8. computeObjectiveChecksData: 客观画面检测 (Phase 1B, 2026-09-04)
//    阈值:标尺利用率<50% 判画面灰;Michelson<0.35 判对比不足;
//        低饱和占比>75% 判颜色挤压;重心偏移>0.18 判失重
// ============================================================

describe('computeObjectiveChecksData', () => {
  /** 按检测 id 查找检查项 */
  const byId = (
    checks: ReturnType<typeof computeObjectiveChecksData>['checks'],
    id: string,
  ) => checks.find((c) => c.id === id);

  /** 棋盘格黑白图:0/255 交替 → 明度两端拉开且重心居中 → 四项全 pass */
  function buildCheckerboard() {
    const lum = Array.from({ length: 100 }, (_, i) => {
      const x = i % 10;
      const y = Math.floor(i / 10);
      return (x + y) % 2 === 0 ? 0 : 255;
    });
    return buildPixelAnalysis({
      luminanceMap: lum,
      pixels: lum.map((v) => ({ r: v, g: v, b: v, a: 255 })),
      avgLuminance: 127.5,
      saturationDistribution: { low: 0.2, mid: 0.3, high: 0.5 },
    });
  }

  /** 左列暗块图:仅 x=0 列为 0(权重 255),其余 255(权重 0) → 重心偏左 → focus warn */
  function buildLeftDarkColumn() {
    const lum = Array.from({ length: 100 }, (_, i) => (i % 10 === 0 ? 0 : 255));
    return buildPixelAnalysis({
      luminanceMap: lum,
      pixels: lum.map((v) => ({ r: v, g: v, b: v, a: 255 })),
      avgLuminance: 229.5,
      saturationDistribution: { low: 0.2, mid: 0.3, high: 0.5 },
    });
  }

  it('默认全灰图(painting):画面灰+对比度 warn,饱和度+重心 pass,共 4 项', () => {
    // 全 128 → 利用率 0%<50% warn;Michelson=0<0.35 warn;
    // low=0.33≤0.75 pass;权重均匀 → 重心(0.45,0.45) pass
    const r = computeObjectiveChecksData(buildPixelAnalysis(), 'painting');
    expect(r.checks).toHaveLength(4);
    expect(byId(r.checks, 'grayness')!.status).toBe('warn');
    expect(byId(r.checks, 'grayness')!.value).toContain('标尺利用率 0%');
    expect(byId(r.checks, 'contrast')!.status).toBe('warn');
    expect(byId(r.checks, 'saturation')!.status).toBe('pass');
    expect(byId(r.checks, 'focus')!.status).toBe('pass');
  });

  it('棋盘格黑白拉开(painting):四项全 pass', () => {
    // min=vals[5]=0, max=vals[94]=255 → 利用率 100% pass;
    // P01=0,P99=255 → Michelson=1 pass;棋盘对称 → 重心(0.45,0.45) pass
    const r = computeObjectiveChecksData(buildCheckerboard(), 'painting');
    expect(r.checks).toHaveLength(4);
    for (const c of r.checks) expect(c.status).toBe('pass');
  });

  it('luminanceScale:16 桶直方图归一化(sum≈1),黑白各占一半,utilization=(max-min)/255', () => {
    const r = computeObjectiveChecksData(buildCheckerboard(), 'painting');
    const ls = r.luminanceScale!;
    expect(ls.histogram).toHaveLength(16);
    expect(ls.histogram.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5);
    expect(ls.histogram[0]).toBeCloseTo(0.5, 5); // 亮度 0-15 → 桶 0
    expect(ls.histogram[15]).toBeCloseTo(0.5, 5); // 亮度 240-255 → 桶 15
    expect(ls.min).toBeLessThanOrEqual(ls.max);
    expect(ls.utilization).toBeCloseTo((ls.max - ls.min) / 255, 5);
  });

  it('饱和度:低饱和占比 90%(painting) → warn 含 90%;sculpture → 无该项(3 项)', () => {
    const overrides = { saturationDistribution: { low: 0.9, mid: 0.1, high: 0 } };
    const p = computeObjectiveChecksData(buildPixelAnalysis(overrides), 'painting');
    expect(byId(p.checks, 'saturation')!.status).toBe('warn');
    expect(byId(p.checks, 'saturation')!.value).toContain('90%');
    const s = computeObjectiveChecksData(buildPixelAnalysis(overrides), 'sculpture');
    expect(s.checks.find((c) => c.id === 'saturation')).toBeUndefined();
    expect(s.checks).toHaveLength(3);
  });

  it('构图重心:仅左列暗块 → 重心(0%, 45%) 偏左 → warn 且方向描述正确', () => {
    // 权重=255-亮度:x=0 列 10 像素 weight 255,其余 90 像素 weight 0(完全不参与)
    // wx=0 → fx=0%(<0.32 偏左);wy=45*255/2550/10=0.45 → fy=45%(不触发偏上/下)
    const r = computeObjectiveChecksData(buildLeftDarkColumn(), 'painting');
    const focus = byId(r.checks, 'focus')!;
    expect(focus.status).toBe('warn');
    expect(focus.value).toContain('(0%, 45%)');
    expect(focus.value).toContain('偏左');
  });
});

// ============================================================
// 9. rejudgeObjectiveChecks: 阶段 2 档案阈值重判定 (Phase 2 批次⑥, 2026-09-06)
//    设计要点:测量值不动(明度范围/利用率%/Michelson/百分比/重心坐标不变),
//    仅按档案阈值重算 status/value 尾部/detail/suggestion;解析失败保留原判定
// ============================================================

describe('rejudgeObjectiveChecks', () => {
  /** 按检测 id 查找检查项 */
  const byId = (checks: ObjectiveChecksData['checks'], id: string) =>
    checks.find((c) => c.id === id);

  /**
   * 构造阶段 1 引擎默认判定下的 objectiveChecks 快照
   * (引擎默认阈值:graynessUtil=0.5 / contrastMichelson=0.35 / saturationLow=0.75 / focusOffset=0.18)
   */
  function buildEngineData(overrides: Partial<ObjectiveChecksData> = {}): ObjectiveChecksData {
    return {
      luminanceScale: {
        histogram: new Array<number>(16).fill(1 / 16),
        min: 85,
        max: 175,
        utilization: 0.353,
      },
      checks: [
        {
          id: 'grayness',
          label: '画面灰检测',
          status: 'warn',
          value: '明度范围 85-175,标尺利用率 35%(理论 0-255)',
          detail: '画面整体明度集中在中间调,最重处不够黑、最亮处不够白——这就是"画面灰":物体体积感和空间层次因此难以拉开。',
          suggestion: '最重处(如投影/暗部)整体压重到 45 以下,最亮处(如受光面/高光)提到 215 以上,先拉开两端再调中间调。',
        },
        {
          id: 'contrast',
          label: '对比度检测',
          status: 'warn',
          value: 'Michelson 对比度 0.3(参考:扎实画面通常 ≥0.35)',
          detail: '各区域明度过于接近,画面发"平",主体与背景黏在一起,视觉冲击力弱。',
          suggestion: '确定主体后,主动拉开主体与背景的明度差至少 2 个明度层级(亮衬暗/暗衬亮)。',
        },
        {
          id: 'saturation',
          label: '饱和度检测',
          status: 'pass',
          value: '72% 像素处于低饱和区',
          detail: '饱和度分布健康,画面有明确的鲜灰对比。',
          suggestion: '保持"大面积灰、小面积鲜"的用色节奏。',
        },
        {
          id: 'focus',
          label: '构图重心检测',
          status: 'pass',
          value: '视觉重心 (58%, 50%)',
          detail: '重心位置稳定,画面力量分布均衡。',
          suggestion: '保持均衡意识,可进一步向黄金分割点优化。',
        },
      ],
      ...overrides,
    };
  }

  it('教师放宽画面灰阈值(0.5→0.3):warn→pass,测量值与标尺数据不变', () => {
    const data = buildEngineData();
    const r = rejudgeObjectiveChecks(data, {
      graynessUtil: 0.3,
      contrastMichelson: 0.35,
      saturationLow: 0.75,
      focusOffset: 0.18,
    });
    const g = byId(r.checks, 'grayness')!;
    expect(g.status).toBe('pass'); // 0.353 ≥ 0.3 → pass
    expect(g.value).toBe('明度范围 85-175,标尺利用率 35%'); // 测量值不动,warn 尾注消失
    expect(g.detail).toContain('不存在"灰"的问题');
    // luminanceScale 原样透传(测量值不动)
    expect(r.luminanceScale).toEqual(data.luminanceScale);
  });

  it('教师收紧对比度阈值(0.35→0.5):保持 warn 且 value 引用新阈值 ≥0.5', () => {
    const data = buildEngineData();
    data.checks[1] = { ...data.checks[1]!, status: 'pass', value: 'Michelson 对比度 0.36' };
    const r = rejudgeObjectiveChecks(data, {
      graynessUtil: 0.5,
      contrastMichelson: 0.5,
      saturationLow: 0.75,
      focusOffset: 0.18,
    });
    const c = byId(r.checks, 'contrast')!;
    expect(c.status).toBe('warn'); // 0.36 < 0.5 → warn
    expect(c.value).toContain('Michelson 对比度 0.36');
    expect(c.value).toContain('≥0.5'); // 阈值引用随档案走
  });

  it('教师收紧饱和度阈值(0.75→0.7):pass→warn,百分比测量值不变', () => {
    const data = buildEngineData();
    const r = rejudgeObjectiveChecks(data, {
      graynessUtil: 0.5,
      contrastMichelson: 0.35,
      saturationLow: 0.7,
      focusOffset: 0.18,
    });
    const s = byId(r.checks, 'saturation')!;
    expect(s.status).toBe('warn'); // 0.72 > 0.7 → warn
    expect(s.value).toBe('72% 像素处于低饱和区'); // 测量值不动
    expect(s.detail).toContain('画面"脏""闷"');
  });

  it('教师收紧重心阈值(0.18→0.05):pass→warn,方向为"偏离中心"(0.58 未过 0.68 档)', () => {
    const data = buildEngineData();
    const r = rejudgeObjectiveChecks(data, {
      graynessUtil: 0.5,
      contrastMichelson: 0.35,
      saturationLow: 0.75,
      focusOffset: 0.05,
    });
    const f = byId(r.checks, 'focus')!;
    expect(f.status).toBe('warn'); // |0.58-0.5|=0.08 > 0.05 → warn
    expect(f.value).toContain('(58%, 50%)'); // 测量值不动
    expect(f.value).toContain('偏离中心'); // 0.58 < 0.68 → 不判"偏右",兜底"偏离中心"
  });

  it('grayness 优先用 luminanceScale.utilization 精确值(0.455 阈值 0.46 → warn,文本 46% 无法区分)', () => {
    const data = buildEngineData({
      luminanceScale: {
        histogram: new Array<number>(16).fill(1 / 16),
        min: 85,
        max: 201,
        utilization: 0.455, // 文本显示 46%
      },
    });
    data.checks[0] = {
      ...data.checks[0]!,
      status: 'pass',
      value: '明度范围 85-201,标尺利用率 46%',
    };
    const r = rejudgeObjectiveChecks(data, {
      graynessUtil: 0.46, // 0.455 < 0.46 → warn(若按文本 0.46 则会误判 pass)
      contrastMichelson: 0.35,
      saturationLow: 0.75,
      focusOffset: 0.18,
    });
    expect(byId(r.checks, 'grayness')!.status).toBe('warn');
  });

  it('luminanceScale 缺失时 grayness 从 value 文本解析利用率(35% → 0.35,min/max 兜底理论范围)', () => {
    const data = buildEngineData({ luminanceScale: undefined });
    const r = rejudgeObjectiveChecks(data, {
      graynessUtil: 0.34, // 0.35 ≥ 0.34 → pass
      contrastMichelson: 0.35,
      saturationLow: 0.75,
      focusOffset: 0.18,
    });
    const g = byId(r.checks, 'grayness')!;
    expect(g.status).toBe('pass');
    // 利用率测量值保留;明度范围无数据来源,退化为理论 0-255(边缘场景可接受)
    expect(g.value).toBe('明度范围 0-255,标尺利用率 35%');
  });

  it('value 文本无法解析(旧数据格式异常):该项保留引擎默认判定不阻断', () => {
    // luminanceScale 一并缺失 → grayness 文本兜底也失败 → 四项全部保留原判定
    const data = buildEngineData({ luminanceScale: undefined });
    data.checks = [
      { id: 'grayness', label: '画面灰检测', status: 'pass', value: '旧格式数据', detail: 'd', suggestion: 's' },
      { id: 'contrast', label: '对比度检测', status: 'warn', value: '旧格式数据', detail: 'd', suggestion: 's' },
      { id: 'saturation', label: '饱和度检测', status: 'pass', value: '旧格式数据', detail: 'd', suggestion: 's' },
      { id: 'focus', label: '构图重心检测', status: 'pass', value: '旧格式数据', detail: 'd', suggestion: 's' },
    ];
    const r = rejudgeObjectiveChecks(data, {
      graynessUtil: 0.1,
      contrastMichelson: 0.9,
      saturationLow: 0.1,
      focusOffset: 0.9,
    });
    // 全部解析失败 → 原判定原样保留(极端阈值也不改 status)
    for (const c of r.checks) {
      const orig = data.checks.find((o) => o.id === c.id)!;
      expect(c.status).toBe(orig.status);
      expect(c.value).toBe(orig.value);
    }
  });

  it('用引擎默认阈值重判定:与阶段 1 判定完全一致(回归保证)', () => {
    const pa = buildPixelAnalysis({
      luminanceMap: Array.from({ length: 100 }, (_, i) => (i % 10 === 0 ? 0 : 255)),
      saturationDistribution: { low: 0.9, mid: 0.1, high: 0 },
    });
    const engine = computeObjectiveChecksData(pa as never, 'painting');
    const r = rejudgeObjectiveChecks(engine, {
      graynessUtil: 0.5,
      contrastMichelson: 0.35,
      saturationLow: 0.75,
      focusOffset: 0.18,
    });
    expect(r.checks).toEqual(engine.checks); // 默认阈值 → 判定零变化
    expect(r.profileThresholdsApplied).toBe(true); // 标记恒置 true(调用方只在档案覆盖时调用)
  });

  it('纯函数:原 data 不被修改,返回新对象', () => {
    const data = buildEngineData();
    const snapshot = JSON.stringify(data);
    rejudgeObjectiveChecks(data, {
      graynessUtil: 0.1,
      contrastMichelson: 0.9,
      saturationLow: 0.1,
      focusOffset: 0.9,
    });
    expect(JSON.stringify(data)).toBe(snapshot);
  });
});
