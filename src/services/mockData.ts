import type { AnalysisResult, HistoryRecord, GrowthData, ArtType } from '../types';
import { placeholderImage } from './placeholderImage';

const artTypes: ArtType[] = ['painting', 'design', 'product', 'sculpture'];

function randomInRange(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomFloatInRange(min: number, max: number): number {
  return Math.round((Math.random() * (max - min) + min) * 100) / 100;
}

function generateHeatmapData(): number[][] {
  const rows = 20, cols = 20;
  const data: number[][] = [];
  const centerX = Math.random() * 0.6 + 0.2;
  const centerY = Math.random() * 0.6 + 0.2;
  for (let i = 0; i < rows; i++) {
    const row: number[] = [];
    for (let j = 0; j < cols; j++) {
      const x = j / cols, y = i / rows;
      const dist = Math.sqrt(Math.pow(x - centerX, 2) + Math.pow(y - centerY, 2));
      row.push(Math.round(Math.max(0, 1 - dist * 3) * 100) / 100);
    }
    data.push(row);
  }
  return data;
}

function generateFocusPoint() {
  return { x: randomFloatInRange(0.3, 0.7), y: randomFloatInRange(0.3, 0.7) };
}

/**
 * 从只读字符串元组中随机选取一个元素(类型安全,替代 `as any` 写法)。
 * 配合 `as const` 使用可保留字面量联合类型,满足各维度枚举字段类型约束。
 */
function pick<T extends readonly string[]>(options: T): T[number] {
  return options[Math.floor(Math.random() * options.length)];
}

/* ============================================================
   按类型生成模拟分析结果
   ============================================================ */

export function generateAnalysisResult(imageUrl: string, artType: ArtType = 'painting'): AnalysisResult {
  const d1 = randomInRange(62, 94);
  const d2 = randomInRange(65, 92);
  const d3 = randomInRange(68, 96);
  const orig = randomInRange(70, 98);
  const focusPoint = generateFocusPoint();
  const heatmapData = generateHeatmapData();

  let dimensions: AnalysisResult['dimensions'];

  if (artType === 'painting') {
    dimensions = {
      type: 'painting',
      composition: {
        score: d1, focusPoint,
        balance: pick(['balanced', 'left-heavy', 'right-heavy', 'top-heavy', 'bottom-heavy'] as const),
        guideline: pick(['good', 'average', 'poor'] as const),
        whitespaceRatio: randomFloatInRange(0.2, 0.7),
        symmetry: randomFloatInRange(0.3, 0.9),
        suggestion: '画面构图均衡，视觉重心位置合理，黄金分割运用得当。',
        heatmapData,
      },
      color: {
        score: d2, warmRatio: randomFloatInRange(0.3, 0.7), coolRatio: randomFloatInRange(0.3, 0.7),
        contrast: pick(['high', 'medium', 'low'] as const),
        saturation: pick(['high', 'medium', 'low'] as const),
        richness: pick(['rich', 'moderate', 'limited'] as const),
        harmony: '和谐', dominantColor: '中性色',
        suggestion: '色彩搭配和谐，冷暖对比适中，建议保持当前用色风格。',
      },
      brushwork: {
        score: d3, textureLevel: pick(['rich', 'moderate', 'simple'] as const),
        strokeVariety: randomInRange(20, 70), wetDryBalance: '适中',
        suggestion: '笔触技法表现良好，肌理层次丰富，干湿变化自然。',
      },
    };
  } else if (artType === 'design') {
    dimensions = {
      type: 'design',
      visualHierarchy: {
        score: d1, focusPoint,
        primarySecondaryClarity: pick(['clear', 'moderate', 'unclear'] as const),
        informationFlow: pick(['good', 'average', 'poor'] as const),
        heatmapData,
        suggestion: '视觉层次清晰，主次关系明确，信息流动顺畅。',
      },
      typography: {
        score: d2,
        alignmentQuality: pick(['good', 'average', 'poor'] as const),
        rhythmConsistency: pick(['good', 'average', 'poor'] as const),
        negativeSpaceUsage: pick(['good', 'average', 'poor'] as const),
        gridAdherence: randomInRange(40, 95),
        suggestion: '排版规范，对齐统一，节奏感一致，负空间运用得当。',
      },
      colorApplication: {
        score: d3,
        contrast: pick(['high', 'medium', 'low'] as const),
        brandConsistency: pick(['strong', 'moderate', 'weak'] as const),
        colorPsychology: '暖色调传递活力与热情',
        paletteHarmony: '色彩和谐',
        suggestion: '色彩应用得当，品牌色一致，对比度适中，视觉张力良好。',
      },
    };
  } else if (artType === 'product') {
    dimensions = {
      type: 'product',
      form: {
        score: d1,
        focusPoint: { x: 0.5, y: 0.5 },
        proportionBalance: pick(['good', 'average', 'poor'] as const),
        lineFluidity: pick(['smooth', 'moderate', 'stiff'] as const),
        surfaceQuality: pick(['excellent', 'good', 'average'] as const),
        ergonomicsHint: pick(['strong', 'moderate', 'weak'] as const),
        heatmapData,
        suggestion: '形态比例协调，线条流畅，曲面过渡自然，人机工学暗示良好。',
      },
      materialExpression: {
        score: d2,
        textureRealism: pick(['high', 'medium', 'low'] as const),
        lightShadowPerformance: pick(['excellent', 'good', 'average'] as const),
        surfaceTreatment: pick(['refined', 'moderate', 'rough'] as const),
        suggestion: '材质表现优秀，光影还原真实，表面处理细腻。',
      },
      functionExpression: {
        score: d3,
        structureClarity: pick(['clear', 'moderate', 'unclear'] as const),
        functionImplication: pick(['strong', 'moderate', 'weak'] as const),
        detailRefinement: pick(['excellent', 'good', 'average'] as const),
        suggestion: '功能表达清晰，结构分区明确，细节处理精致。',
      },
    };
  } else {
    dimensions = {
      type: 'sculpture',
      spatialComposition: {
        score: d1,
        focusPoint: { x: 0.5, y: 0.5 },
        volumeSense: pick(['strong', 'moderate', 'weak'] as const),
        spaceOccupation: pick(['full', 'moderate', 'sparse'] as const),
        voidSolidRelation: pick(['harmonious', 'moderate', 'imbalanced'] as const),
        heatmapData,
        suggestion: '空间构成饱满，体积感强烈，虚实关系和谐。',
      },
      bodyLanguage: {
        score: d2,
        dynamicSense: pick(['strong', 'moderate', 'static'] as const),
        tensionExpression: pick(['high', 'medium', 'low'] as const),
        rhythmFlow: pick(['fluent', 'moderate', 'stiff'] as const),
        suggestion: '形体语言生动，动态感强烈，张力十足，韵律流畅。',
      },
      materialLanguage: {
        score: d3,
        materialCharacter: pick(['distinct', 'moderate', 'obscure'] as const),
        textureExpression: pick(['rich', 'moderate', 'simple'] as const),
        qualityLayering: pick(['rich', 'moderate', 'simple'] as const),
        suggestion: '材料语言鲜明，肌理表现丰富，质感层次清晰。',
      },
    };
  }

  return {
    id: `analysis-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    imageUrl, createdAt: new Date().toISOString(), artType,
    dimensions,
    originality: {
      score: orig, similarity: randomFloatInRange(0.05, 0.35),
      creativityLevel: orig > 88 ? 'excellent' : orig > 78 ? 'good' : orig > 68 ? 'average' : 'needsWork',
      suggestion: orig > 85 ? '作品具有独特的个人风格，原创性优秀。' : '建议增加更多个人风格元素，提升原创性。',
    },
    overallScore: Math.round((d1 + d2 + d3 + orig) / 4),
  };
}

/* ============================================================
   历史记录
   ============================================================ */

export function saveToHistory(result: AnalysisResult): void {
  const history = getHistory();
  /* 批次③:维度分可空(本地引擎停分),null 保存为 0 占位(本地历史无分展示"—"依赖 overallScore) */
  let d1: number | null = null, d2: number | null = null, d3: number | null = null;
  const dims = result.dimensions;
  if (dims.type === 'painting') { d1 = dims.composition.score; d2 = dims.color.score; d3 = dims.brushwork.score; }
  else if (dims.type === 'design') { d1 = dims.visualHierarchy.score; d2 = dims.typography.score; d3 = dims.colorApplication.score; }
  else if (dims.type === 'product') { d1 = dims.form.score; d2 = dims.materialExpression.score; d3 = dims.functionExpression.score; }
  else { d1 = dims.spatialComposition.score; d2 = dims.bodyLanguage.score; d3 = dims.materialLanguage.score; }

  const record: HistoryRecord = {
    id: result.id, imageUrl: result.imageUrl,
    createdAt: result.createdAt, artType: result.artType,
    overallScore: result.overallScore,
    dimension1Score: d1 ?? 0, dimension2Score: d2 ?? 0, dimension3Score: d3 ?? 0,
  };
  history.unshift(record);
  try {
    localStorage.setItem('danqing-ai-history', JSON.stringify(history));
  } catch {
    /* localStorage 写入失败（隐私模式/配额满），忽略 */
  }
}

export function getHistory(): HistoryRecord[] {
  const stored = localStorage.getItem('danqing-ai-history');
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      /* 数据损坏，返回空数组 */
    }
  }
  return [];
}

export function generateMockHistory(): HistoryRecord[] {
  const records: HistoryRecord[] = [];
  const today = new Date();
  for (let i = 0; i < 5; i++) {
    const date = new Date(today); date.setDate(date.getDate() - i);
    const d1 = randomInRange(65, 95), d2 = randomInRange(68, 92), d3 = randomInRange(72, 98);
    records.push({
      id: `history-${i + 1}`,
      imageUrl: placeholderImage(`beautiful artwork ${i + 1}`, { size: 'square' }),
      createdAt: date.toISOString(),
      artType: artTypes[i % artTypes.length],
      overallScore: Math.round((d1 + d2 + d3) / 3),
      dimension1Score: d1, dimension2Score: d2, dimension3Score: d3,
    });
  }
  return records;
}

export function getAnalysisResult(id: string): AnalysisResult | null {
  const history = getHistory();
  const record = history.find(r => r.id === id);
  if (!record) return null;
  return generateAnalysisResult(record.imageUrl, record.artType);
}

/* ============================================================
   成长数据
   ============================================================ */

export function generateGrowthDataFromHistory(): GrowthData[] {
  const history = getHistory();
  if (history.length === 0) return [];

  const sorted = [...history].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const grouped = new Map<string, HistoryRecord[]>();
  for (const r of sorted) {
    const d = new Date(r.createdAt);
    const key = `${d.getMonth() + 1}/${d.getDate()}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(r);
  }

  const data: GrowthData[] = [];
  for (const [dateStr, records] of grouped) {
    data.push({
      date: dateStr,
      dimension1: Math.round(records.reduce((s, r) => s + r.dimension1Score, 0) / records.length),
      dimension2: Math.round(records.reduce((s, r) => s + r.dimension2Score, 0) / records.length),
      dimension3: Math.round(records.reduce((s, r) => s + r.dimension3Score, 0) / records.length),
      /* 批次②:仅对有评分记录求均值(mock 记录恒有分,此守卫为契约可空化兜底) */
      overall: (() => {
        const scored = records.filter((r) => r.overallScore != null);
        return scored.length > 0
          ? Math.round(scored.reduce((s, r) => s + (r.overallScore ?? 0), 0) / scored.length)
          : 0;
      })(),
    });
  }

  if (data.length < 7) {
    const mock = generateMockGrowthData();
    return [...data, ...mock.slice(data.length)].slice(0, 14);
  }
  return data.slice(-14);
}

export function generateMockGrowthData(): GrowthData[] {
  const data: GrowthData[] = [];
  const today = new Date();
  let d1 = 62, d2 = 65, d3 = 68;
  for (let i = 13; i >= 0; i--) {
    const date = new Date(today); date.setDate(date.getDate() - i);
    d1 = Math.min(95, Math.max(60, d1 + randomInRange(-3, 5)));
    d2 = Math.min(95, Math.max(60, d2 + randomInRange(-2, 4)));
    d3 = Math.min(98, Math.max(65, d3 + randomInRange(-2, 6)));
    data.push({ date: `${date.getMonth() + 1}/${date.getDate()}`, dimension1: d1, dimension2: d2, dimension3: d3, overall: Math.round((d1 + d2 + d3) / 3) });
  }
  return data;
}

export function calculateGrowthInsights(data: GrowthData[]) {
  if (data.length < 2) return null;
  const first = data[0], last = data[data.length - 1];
  const d1Change = last.dimension1 - first.dimension1;
  const d2Change = last.dimension2 - first.dimension2;
  const d3Change = last.dimension3 - first.dimension3;
  const overallChange = last.overall - first.overall;
  const strongest = d1Change >= d2Change && d1Change >= d3Change ? '维度一' : d2Change >= d3Change ? '维度二' : '维度三';
  const weakest = d1Change <= d2Change && d1Change <= d3Change ? '维度一' : d2Change <= d3Change ? '维度二' : '维度三';
  const avgOverall = Math.round(data.reduce((s, d) => s + d.overall, 0) / data.length);
  const volatility = Math.round(data.reduce((s, d, i) => i === 0 ? 0 : s + Math.abs(d.overall - data[i - 1].overall), 0) / (data.length - 1));

  let suggestion: string;
  if (overallChange > 10) suggestion = `进步显著！整体提升了${overallChange}分，${strongest}能力提升最快。建议继续保持，同时在${weakest}方面多加练习。`;
  else if (overallChange > 0) suggestion = `稳步进步中，整体提升了${overallChange}分。${strongest}是优势方向，建议针对${weakest}进行专项训练。`;
  else if (overallChange > -10) suggestion = `近期略有波动，整体变化${overallChange}分。创作能力的发展是螺旋式上升，建议多参考素材库经典作品。`;
  else suggestion = `近期遇到瓶颈，整体下降${Math.abs(overallChange)}分。建议回顾优秀作品，分析创作状态，尝试新技法。`;

  return { d1Change, d2Change, d3Change, overallChange, strongest, weakest, avgOverall, volatility, trend: overallChange > 5 ? 'up' : overallChange < -5 ? 'down' : 'stable', suggestion };
}
