// ============================================================
// mockData 单元测试 (任务包 E:块4 服务层覆盖率补强)
// 对应源码: src/services/mockData.ts
//
// 测试范围:
//   1. generateAnalysisResult: 4 种 artType 生成结构化分析结果
//   2. saveToHistory / getHistory: localStorage 历史记录读写
//   3. generateMockHistory: 5 条默认 mock 数据
//   4. getAnalysisResult: 按 id 查找并生成完整结果
//   5. generateGrowthDataFromHistory: 从历史聚合成长曲线
//   6. generateMockGrowthData: 14 天默认成长曲线
//   7. calculateGrowthInsights: 成长趋势洞察(进步/瓶颈/波动)
//
// 注意:mockData 中的函数使用 Math.random 生成数据,
//      测试以结构/范围/类型断言为主,不断言具体数值
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  generateAnalysisResult,
  saveToHistory,
  getHistory,
  generateMockHistory,
  getAnalysisResult,
  generateGrowthDataFromHistory,
  generateMockGrowthData,
  calculateGrowthInsights,
} from '../mockData';
import type { ArtType } from '../../types';

/* ---------- 公共清理 ---------- */

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

/* ============================================================
 * 1. generateAnalysisResult: 各 artType 结构正确
 * ============================================================ */
describe('generateAnalysisResult', () => {
  it('painting 类型生成完整的 dimensions/composition/color/brushwork', () => {
    const result = generateAnalysisResult('https://example.com/p.png', 'painting');
    expect(result.artType).toBe('painting');
    expect(result.dimensions.type).toBe('painting');
    expect(result.dimensions.composition).toBeDefined();
    expect(result.dimensions.composition.score).toBeGreaterThanOrEqual(62);
    expect(result.dimensions.composition.score).toBeLessThanOrEqual(94);
    expect(result.dimensions.color).toBeDefined();
    expect(result.dimensions.brushwork).toBeDefined();
    expect(result.originality).toBeDefined();
    expect(result.overallScore).toBeGreaterThan(0);
    expect(result.id).toBeTruthy();
    expect(result.imageUrl).toBe('https://example.com/p.png');
  });

  it('design 类型生成 visualHierarchy/typography/colorApplication', () => {
    const result = generateAnalysisResult('https://example.com/d.png', 'design');
    expect(result.artType).toBe('design');
    expect(result.dimensions.type).toBe('design');
    expect(result.dimensions.visualHierarchy).toBeDefined();
    expect(result.dimensions.typography).toBeDefined();
    expect(result.dimensions.colorApplication).toBeDefined();
  });

  it('product 类型生成 form/materialExpression/functionExpression', () => {
    const result = generateAnalysisResult('https://example.com/pr.png', 'product');
    expect(result.artType).toBe('product');
    expect(result.dimensions.type).toBe('product');
    expect(result.dimensions.form).toBeDefined();
    expect(result.dimensions.materialExpression).toBeDefined();
    expect(result.dimensions.functionExpression).toBeDefined();
  });

  it('sculpture 类型生成 spatialComposition/bodyLanguage/materialLanguage', () => {
    const result = generateAnalysisResult('https://example.com/s.png', 'sculpture');
    expect(result.artType).toBe('sculpture');
    expect(result.dimensions.type).toBe('sculpture');
    expect(result.dimensions.spatialComposition).toBeDefined();
    expect(result.dimensions.bodyLanguage).toBeDefined();
    expect(result.dimensions.materialLanguage).toBeDefined();
  });

  it('默认 artType 为 painting(无第二参数)', () => {
    const result = generateAnalysisResult('https://example.com/default.png');
    expect(result.artType).toBe('painting');
    expect(result.dimensions.type).toBe('painting');
  });

  it('originality.creativityLevel 根据分数分为四档', () => {
    // 多次生成验证 creativityLevel 是合法枚举值
    const validLevels = ['excellent', 'good', 'average', 'needsWork'];
    for (let i = 0; i < 20; i++) {
      const result = generateAnalysisResult('u', 'painting');
      expect(validLevels).toContain(result.originality.creativityLevel);
    }
  });

  it('生成结果包含 heatmapData(20x20 数组)', () => {
    const result = generateAnalysisResult('u', 'painting');
    const heatmap = result.dimensions.composition.heatmapData;
    expect(heatmap).toBeDefined();
    expect(heatmap.length).toBe(20);
    heatmap.forEach((row) => {
      expect(row.length).toBe(20);
    });
  });
});

/* ============================================================
 * 2. saveToHistory / getHistory
 * ============================================================ */
describe('saveToHistory / getHistory', () => {
  it('getHistory 空时返回空数组(真实数据优先,不注入 mock)', () => {
    // c68977f 起移除"空时伪造 mock 历史"行为:避免假数据污染真实用户成长曲线
    const list = getHistory();
    expect(list).toEqual([]);
    // 不应写入 localStorage
    expect(localStorage.getItem('danqing-ai-history')).toBeNull();
  });

  it('saveToHistory 将新记录插入到历史头部(unshift)', () => {
    // 预置 2 条历史(真实数据优先,不再自动注入 mock)
    const seed = [1, 2].map((i) => ({
      id: `seed-${i}`,
      imageUrl: `https://example.com/seed-${i}.png`,
      createdAt: new Date(Date.now() - i * 86400000).toISOString(),
      artType: 'painting' as const,
      overallScore: 80,
      dimension1Score: 75, dimension2Score: 80, dimension3Score: 85,
    }));
    localStorage.setItem('danqing-ai-history', JSON.stringify(seed));
    // 保存一条新结果
    const result = generateAnalysisResult('https://example.com/new.png', 'painting');
    saveToHistory(result);
    const after = getHistory();
    expect(after.length).toBe(3);
    // 新记录应在头部
    expect(after[0].imageUrl).toBe('https://example.com/new.png');
  });

  it('saveToHistory 从 painting dimensions 提取三维度分数', () => {
    const result = generateAnalysisResult('u', 'painting');
    saveToHistory(result);
    const list = getHistory();
    const record = list[0];
    // painting: d1=composition.score, d2=color.score, d3=brushwork.score
    expect(record.dimension1Score).toBe(result.dimensions.composition.score);
    expect(record.dimension2Score).toBe(result.dimensions.color.score);
    expect(record.dimension3Score).toBe(result.dimensions.brushwork.score);
  });

  it('saveToHistory 从 design dimensions 提取三维度分数', () => {
    const result = generateAnalysisResult('u', 'design');
    saveToHistory(result);
    const list = getHistory();
    const record = list[0];
    expect(record.dimension1Score).toBe(result.dimensions.visualHierarchy.score);
    expect(record.dimension2Score).toBe(result.dimensions.typography.score);
    expect(record.dimension3Score).toBe(result.dimensions.colorApplication.score);
  });

  it('saveToHistory 从 product dimensions 提取三维度分数', () => {
    const result = generateAnalysisResult('u', 'product');
    saveToHistory(result);
    const list = getHistory();
    const record = list[0];
    expect(record.dimension1Score).toBe(result.dimensions.form.score);
    expect(record.dimension2Score).toBe(result.dimensions.materialExpression.score);
    expect(record.dimension3Score).toBe(result.dimensions.functionExpression.score);
  });

  it('saveToHistory 从 sculpture dimensions 提取三维度分数', () => {
    const result = generateAnalysisResult('u', 'sculpture');
    saveToHistory(result);
    const list = getHistory();
    const record = list[0];
    expect(record.dimension1Score).toBe(result.dimensions.spatialComposition.score);
    expect(record.dimension2Score).toBe(result.dimensions.bodyLanguage.score);
    expect(record.dimension3Score).toBe(result.dimensions.materialLanguage.score);
  });

  it('getHistory 中 localStorage 数据损坏时返回空数组', () => {
    localStorage.setItem('danqing-ai-history', 'corrupt-data');
    const list = getHistory();
    // 真实数据优先:损坏数据不再触发 mock 注入
    expect(list).toEqual([]);
  });

  it('getHistory 中 localStorage 数据为非数组时返回空数组', () => {
    localStorage.setItem('danqing-ai-history', JSON.stringify({ foo: 'bar' }));
    const list = getHistory();
    expect(Array.isArray(list)).toBe(true);
    expect(list).toEqual([]);
  });
});

/* ============================================================
 * 3. generateMockHistory
 * ============================================================ */
describe('generateMockHistory', () => {
  it('生成 5 条历史记录,每条包含完整字段', () => {
    const list = generateMockHistory();
    expect(list.length).toBe(5);
    list.forEach((r) => {
      expect(r.id).toBeTruthy();
      expect(r.imageUrl).toBeTruthy();
      expect(r.createdAt).toBeTruthy();
      expect(['painting', 'design', 'product', 'sculpture']).toContain(r.artType);
      expect(typeof r.overallScore).toBe('number');
      expect(typeof r.dimension1Score).toBe('number');
      expect(typeof r.dimension2Score).toBe('number');
      expect(typeof r.dimension3Score).toBe('number');
    });
  });

  it('记录按日期降序(最近在前)', () => {
    const list = generateMockHistory();
    for (let i = 1; i < list.length; i++) {
      const prev = new Date(list[i - 1].createdAt).getTime();
      const curr = new Date(list[i].createdAt).getTime();
      expect(prev).toBeGreaterThanOrEqual(curr);
    }
  });

  it('artType 在 4 种类型中循环', () => {
    const list = generateMockHistory();
    const artTypes: ArtType[] = ['painting', 'design', 'product', 'sculpture'];
    list.forEach((r, i) => {
      expect(r.artType).toBe(artTypes[i % artTypes.length]);
    });
  });
});

/* ============================================================
 * 4. getAnalysisResult
 * ============================================================ */
describe('getAnalysisResult', () => {
  it('对存在的 history id 返回完整 AnalysisResult', () => {
    // 预置历史(真实数据优先,不再自动注入 mock)
    localStorage.setItem('danqing-ai-history', JSON.stringify([{
      id: 'seed-detail-1',
      imageUrl: 'https://example.com/seed-detail.png',
      createdAt: new Date().toISOString(),
      artType: 'design' as const,
      overallScore: 82,
      dimension1Score: 78, dimension2Score: 82, dimension3Score: 86,
    }]));
    const result = getAnalysisResult('seed-detail-1');
    expect(result).not.toBeNull();
    expect(result!.artType).toBe('design');
    expect(result!.imageUrl).toBe('https://example.com/seed-detail.png');
    expect(result!.dimensions).toBeDefined();
    expect(result!.originality).toBeDefined();
  });

  it('对不存在 id 返回 null', () => {
    const result = getAnalysisResult('non-existent-id');
    expect(result).toBeNull();
  });
});

/* ============================================================
 * 5. generateGrowthDataFromHistory
 * ============================================================ */
describe('generateGrowthDataFromHistory', () => {
  it('空历史时返回空数组(不注入 mock)', () => {
    // 真实数据优先:无历史时返回空数组,由页面展示空状态
    localStorage.setItem('danqing-ai-history', JSON.stringify([]));
    const data = generateGrowthDataFromHistory();
    expect(data).toEqual([]);
  });

  it('从历史记录聚合成长曲线(按日期分组取平均)', () => {
    // 预置 3 条不同日期的历史
    const history = [
      { id: 'h1', imageUrl: 'u1', createdAt: '2026-08-01T00:00:00Z', artType: 'painting' as ArtType, overallScore: 80, dimension1Score: 75, dimension2Score: 80, dimension3Score: 85 },
      { id: 'h2', imageUrl: 'u2', createdAt: '2026-08-02T00:00:00Z', artType: 'design' as ArtType, overallScore: 82, dimension1Score: 78, dimension2Score: 82, dimension3Score: 86 },
    ];
    localStorage.setItem('danqing-ai-history', JSON.stringify(history));
    const data = generateGrowthDataFromHistory();
    expect(data.length).toBeGreaterThanOrEqual(2);
    data.forEach((d) => {
      expect(d.date).toBeTruthy();
      expect(typeof d.dimension1).toBe('number');
      expect(typeof d.dimension2).toBe('number');
      expect(typeof d.dimension3).toBe('number');
      expect(typeof d.overall).toBe('number');
    });
  });

  it('同日多条记录取平均值', () => {
    const sameDay = '2026-08-01T00:00:00Z';
    const history = [
      { id: 'h1', imageUrl: 'u1', createdAt: sameDay, artType: 'painting' as ArtType, overallScore: 80, dimension1Score: 70, dimension2Score: 80, dimension3Score: 90 },
      { id: 'h2', imageUrl: 'u2', createdAt: sameDay, artType: 'painting' as ArtType, overallScore: 90, dimension1Score: 80, dimension2Score: 90, dimension3Score: 100 },
    ];
    localStorage.setItem('danqing-ai-history', JSON.stringify(history));
    const data = generateGrowthDataFromHistory();
    // 至少包含该日聚合数据
    const sameDayRecord = data.find((d) => d.dimension1 === 75); // (70+80)/2 = 75
    expect(sameDayRecord).toBeDefined();
    expect(sameDayRecord!.dimension2).toBe(85); // (80+90)/2
    expect(sameDayRecord!.dimension3).toBe(95); // (90+100)/2
    expect(sameDayRecord!.overall).toBe(85); // (80+90)/2
  });

  it('返回结果不超过 14 条(取最近 14 天)', () => {
    // 生成 20 天的历史数据
    const history: Array<{
      id: string; imageUrl: string; createdAt: string;
      artType: ArtType; overallScore: number;
      dimension1Score: number; dimension2Score: number; dimension3Score: number;
    }> = [];
    for (let i = 0; i < 20; i++) {
      history.push({
        id: `h-${i}`,
        imageUrl: `u${i}`,
        createdAt: new Date(2026, 7, i + 1).toISOString(),
        artType: 'painting',
        overallScore: 70 + i,
        dimension1Score: 70 + i,
        dimension2Score: 70 + i,
        dimension3Score: 70 + i,
      });
    }
    localStorage.setItem('danqing-ai-history', JSON.stringify(history));
    const data = generateGrowthDataFromHistory();
    expect(data.length).toBeLessThanOrEqual(14);
  });
});

/* ============================================================
 * 6. generateMockGrowthData
 * ============================================================ */
describe('generateMockGrowthData', () => {
  it('生成 14 天的成长曲线', () => {
    const data = generateMockGrowthData();
    expect(data.length).toBe(14);
  });

  it('每日数据包含完整四维度', () => {
    const data = generateMockGrowthData();
    data.forEach((d) => {
      expect(d).toHaveProperty('date');
      expect(d).toHaveProperty('dimension1');
      expect(d).toHaveProperty('dimension2');
      expect(d).toHaveProperty('dimension3');
      expect(d).toHaveProperty('overall');
    });
  });

  it('各维度分数在 60-98 之间(随机但受约束)', () => {
    const data = generateMockGrowthData();
    data.forEach((d) => {
      expect(d.dimension1).toBeGreaterThanOrEqual(60);
      expect(d.dimension1).toBeLessThanOrEqual(95);
      expect(d.dimension2).toBeGreaterThanOrEqual(60);
      expect(d.dimension2).toBeLessThanOrEqual(95);
      expect(d.dimension3).toBeGreaterThanOrEqual(65);
      expect(d.dimension3).toBeLessThanOrEqual(98);
    });
  });
});

/* ============================================================
 * 7. calculateGrowthInsights
 * ============================================================ */
describe('calculateGrowthInsights', () => {
  it('数据少于 2 条时返回 null', () => {
    expect(calculateGrowthInsights([])).toBeNull();
    expect(calculateGrowthInsights([
      { date: '1/1', dimension1: 70, dimension2: 70, dimension3: 70, overall: 70 },
    ])).toBeNull();
  });

  it('整体进步 >10 时返回 trend=up 且 suggestion 含"进步显著"', () => {
    const data = [
      { date: '1/1', dimension1: 60, dimension2: 60, dimension3: 60, overall: 60 },
      { date: '1/2', dimension1: 80, dimension2: 80, dimension3: 80, overall: 80 },
    ];
    const result = calculateGrowthInsights(data);
    expect(result).not.toBeNull();
    expect(result!.overallChange).toBe(20);
    expect(result!.trend).toBe('up');
    expect(result!.suggestion).toContain('进步显著');
    expect(result!.suggestion).toContain('20');
  });

  it('整体小幅进步时 trend=up(>5)', () => {
    const data = [
      { date: '1/1', dimension1: 70, dimension2: 70, dimension3: 70, overall: 70 },
      { date: '1/2', dimension1: 76, dimension2: 76, dimension3: 76, overall: 76 },
    ];
    const result = calculateGrowthInsights(data);
    expect(result).not.toBeNull();
    expect(result!.overallChange).toBe(6);
    expect(result!.trend).toBe('up');
    expect(result!.suggestion).toContain('稳步进步');
  });

  it('整体小幅波动时 trend=stable(overallChange 在 -5 ~ 5 之间)', () => {
    // overallChange=2 进入"稳步进步"分支(>0),验证 trend 与文案
    const data = [
      { date: '1/1', dimension1: 70, dimension2: 70, dimension3: 70, overall: 70 },
      { date: '1/2', dimension1: 72, dimension2: 72, dimension3: 72, overall: 72 },
    ];
    const result = calculateGrowthInsights(data);
    expect(result!.overallChange).toBe(2);
    expect(result!.trend).toBe('stable');
    expect(result!.suggestion).toContain('稳步进步');
  });

  it('整体略有下降(>-10)时 trend=stable 且 suggestion 含"螺旋式上升"', () => {
    // overallChange=-5 进入"略有波动"分支(>-10)
    const data = [
      { date: '1/1', dimension1: 70, dimension2: 70, dimension3: 70, overall: 70 },
      { date: '1/2', dimension1: 65, dimension2: 65, dimension3: 65, overall: 65 },
    ];
    const result = calculateGrowthInsights(data);
    expect(result!.overallChange).toBe(-5);
    expect(result!.trend).toBe('stable');
    expect(result!.suggestion).toContain('螺旋式上升');
  });

  it('整体显著下降时 trend=down 且 suggestion 含"瓶颈"', () => {
    const data = [
      { date: '1/1', dimension1: 80, dimension2: 80, dimension3: 80, overall: 80 },
      { date: '1/2', dimension1: 65, dimension2: 65, dimension3: 65, overall: 65 },
    ];
    const result = calculateGrowthInsights(data);
    expect(result!.overallChange).toBe(-15);
    expect(result!.trend).toBe('down');
    expect(result!.suggestion).toContain('瓶颈');
  });

  it('返回对象包含 d1Change/d2Change/d3Change/strongest/weakest/avgOverall/volatility', () => {
    const data = [
      { date: '1/1', dimension1: 60, dimension2: 70, dimension3: 80, overall: 70 },
      { date: '1/2', dimension1: 80, dimension2: 75, dimension3: 82, overall: 79 },
    ];
    const result = calculateGrowthInsights(data);
    expect(result).not.toBeNull();
    expect(result).toHaveProperty('d1Change', 20);
    expect(result).toHaveProperty('d2Change', 5);
    expect(result).toHaveProperty('d3Change', 2);
    expect(result).toHaveProperty('strongest');
    expect(result).toHaveProperty('weakest');
    expect(result).toHaveProperty('avgOverall');
    expect(result).toHaveProperty('volatility');
    // strongest = 维度一(d1Change 最大)
    expect(result!.strongest).toBe('维度一');
    // weakest = 维度三(d3Change 最小)
    expect(result!.weakest).toBe('维度三');
  });
});
