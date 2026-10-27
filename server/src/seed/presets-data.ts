// ============================================================
// 丹青有AI - 内置 Seed 预设数据(Phase 5)
// 16 套 = 4 风格 × 4 类作品
// 对应文档:.trae/documents/art-evaluation-research.md §1, §2
//          .trae/documents/new-features-design.md §4.1
//
// 注入方式:prisma db seed,isBuiltIn=true,creatorId=null,tenantId=null
// 不可变性:isBuiltIn=true 的记录在 service 层强制禁止 UPDATE/DELETE
// 固定 ID:便于 fork 引用(非标准 UUID 字符串,Prisma @id 为 String 支持)
// ============================================================

import type { PresetDimension, PresetStage, PresetStyle } from '../types/arbitration.js';
import type { ArtType } from '../types/api-contract.js';

/** Seed 预设数据结构(供 seed 脚本注入) */
export interface SeedPreset {
  /** 固定 ID,便于 fork 引用,如 'preset_academy__painting' */
  id: string;
  name: string;
  description: string;
  styleType: PresetStyle;
  artType: ArtType;
  applicableStage: PresetStage;
  dimensions: PresetDimension[];
  rationale: string;
  /** 排序权重(数字越小越靠前,美院基准优先) */
  sortOrder: number;
}

// ============================================================
// 维度键规范(与 art-evaluation-research.md §1, art-evaluation-standards.md 对齐)
// painting: composition_form / color / technique / overall
// design:   visual_hierarchy / layout / color_application / creativity
// product:  form_semantics / material / function / ergonomics
// sculpture: spatial_composition / form_language / material_language / concept
// ============================================================

const PAINTING_DIMS = {
  composition_form: { label: '构图与造型', labelEn: 'Composition & Form' },
  color: { label: '色彩表现', labelEn: 'Color Expression' },
  technique: { label: '笔触与技法', labelEn: 'Technique & Brushwork' },
  overall: { label: '整体与完整', labelEn: 'Overall Unity & Completeness' },
};

const DESIGN_DIMS = {
  visual_hierarchy: { label: '视觉层次', labelEn: 'Visual Hierarchy' },
  layout: { label: '排版与构成', labelEn: 'Layout & Composition' },
  color_application: { label: '色彩应用', labelEn: 'Color Application' },
  creativity: { label: '创意表达', labelEn: 'Creative Expression' },
};

const PRODUCT_DIMS = {
  form_semantics: { label: '形态语义', labelEn: 'Form Semantics' },
  material: { label: '材质表现', labelEn: 'Material Expression' },
  function: { label: '功能表达', labelEn: 'Functional Expression' },
  ergonomics: { label: '人机工程', labelEn: 'Ergonomics' },
};

const SCULPTURE_DIMS = {
  spatial_composition: { label: '空间构成', labelEn: 'Spatial Composition' },
  form_language: { label: '形体语言', labelEn: 'Form Language' },
  material_language: { label: '材料语言', labelEn: 'Material Language' },
  concept: { label: '观念表达', labelEn: 'Conceptual Expression' },
};

/** 辅助:构造维度项 */
function dim(key: string, meta: { label: string; labelEn: string }, weight: number): PresetDimension {
  return { key, label: meta.label, labelEn: meta.labelEn, weight };
}

// ============================================================
// 16 套 Seed 预设(4 风格 × 4 类作品)
// 权重来源:art-evaluation-research.md §2.5 四套预设权重对照总表
// ============================================================

export const SEED_PRESETS: SeedPreset[] = [
  // ---------- 顶级美院风格(academy,综合均衡,系统默认) ----------
  {
    id: 'preset_academy__painting',
    name: '美院基准·绘画',
    description: '央美/国美/清华三校综合均衡基准,系统默认预设',
    styleType: 'academy',
    artType: 'painting',
    applicableStage: 'foundation',
    dimensions: [
      dim('composition_form', PAINTING_DIMS.composition_form, 25),
      dim('color', PAINTING_DIMS.color, 25),
      dim('technique', PAINTING_DIMS.technique, 25),
      dim('overall', PAINTING_DIMS.overall, 25),
    ],
    rationale: '四维度均衡,适合基础与专业基础阶段综合评估',
    sortOrder: 10,
  },
  {
    id: 'preset_academy__design',
    name: '美院基准·设计',
    description: '三校视觉传达专业综合均衡基准,创意略高',
    styleType: 'academy',
    artType: 'design',
    applicableStage: 'foundation',
    dimensions: [
      dim('visual_hierarchy', DESIGN_DIMS.visual_hierarchy, 25),
      dim('layout', DESIGN_DIMS.layout, 25),
      dim('color_application', DESIGN_DIMS.color_application, 20),
      dim('creativity', DESIGN_DIMS.creativity, 30),
    ],
    rationale: '创意 30% 略高体现设计学科「创意为先」,层次排版各 25%',
    sortOrder: 11,
  },
  {
    id: 'preset_academy__product',
    name: '美院基准·产品',
    description: '清华美院工业设计取向,形态语义领先',
    styleType: 'academy',
    artType: 'product',
    applicableStage: 'foundation',
    dimensions: [
      dim('form_semantics', PRODUCT_DIMS.form_semantics, 30),
      dim('material', PRODUCT_DIMS.material, 25),
      dim('function', PRODUCT_DIMS.function, 25),
      dim('ergonomics', PRODUCT_DIMS.ergonomics, 20),
    ],
    rationale: '形态语义 30% 领先,材质功能各 25%,人机 20%',
    sortOrder: 12,
  },
  {
    id: 'preset_academy__sculpture',
    name: '美院基准·雕塑',
    description: '央美雕塑系基础取向,空间与形体并重',
    styleType: 'academy',
    artType: 'sculpture',
    applicableStage: 'foundation',
    dimensions: [
      dim('spatial_composition', SCULPTURE_DIMS.spatial_composition, 30),
      dim('form_language', SCULPTURE_DIMS.form_language, 30),
      dim('material_language', SCULPTURE_DIMS.material_language, 25),
      dim('concept', SCULPTURE_DIMS.concept, 15),
    ],
    rationale: '空间与形体各 30% 并重,材料 25%,观念 15%',
    sortOrder: 13,
  },

  // ---------- 名教授风格(academic,学术严谨) ----------
  {
    id: 'preset_academic__painting',
    name: '名教授·绘画',
    description: '央美基础部「以造型为本」传统,造型升至 30%',
    styleType: 'academic',
    artType: 'painting',
    applicableStage: 'basic',
    dimensions: [
      dim('composition_form', PAINTING_DIMS.composition_form, 30),
      dim('color', PAINTING_DIMS.color, 25),
      dim('technique', PAINTING_DIMS.technique, 25),
      dim('overall', PAINTING_DIMS.overall, 20),
    ],
    rationale: '造型升至 30% 夯实比例透视结构;整体降至 20%,基础阶段重在「画对」',
    sortOrder: 20,
  },
  {
    id: 'preset_academic__design',
    name: '名教授·设计',
    description: '清华美院「结构与规范优先」,层次排版共 55%',
    styleType: 'academic',
    artType: 'design',
    applicableStage: 'basic',
    dimensions: [
      dim('visual_hierarchy', DESIGN_DIMS.visual_hierarchy, 30),
      dim('layout', DESIGN_DIMS.layout, 25),
      dim('color_application', DESIGN_DIMS.color_application, 20),
      dim('creativity', DESIGN_DIMS.creativity, 25),
    ],
    rationale: '层次与排版共 55% 强调网格与信息秩序;创意降至 25%,规范先于个性',
    sortOrder: 21,
  },
  {
    id: 'preset_academic__product',
    name: '名教授·产品',
    description: '形态语义升至 35%,曲面连续与体量优先',
    styleType: 'academic',
    artType: 'product',
    applicableStage: 'basic',
    dimensions: [
      dim('form_semantics', PRODUCT_DIMS.form_semantics, 35),
      dim('material', PRODUCT_DIMS.material, 25),
      dim('function', PRODUCT_DIMS.function, 25),
      dim('ergonomics', PRODUCT_DIMS.ergonomics, 15),
    ],
    rationale: '形态语义 35%,人机降至 15%(造型基本功阶段暂缓)',
    sortOrder: 22,
  },
  {
    id: 'preset_academic__sculpture',
    name: '名教授·雕塑',
    description: '空间与形体共 65%,三维造型基本功优先',
    styleType: 'academic',
    artType: 'sculpture',
    applicableStage: 'basic',
    dimensions: [
      dim('spatial_composition', SCULPTURE_DIMS.spatial_composition, 35),
      dim('form_language', SCULPTURE_DIMS.form_language, 30),
      dim('material_language', SCULPTURE_DIMS.material_language, 25),
      dim('concept', SCULPTURE_DIMS.concept, 10),
    ],
    rationale: '空间与形体共 65% 三维造型基本功优先;观念降至 10%,基础阶段弱化观念评判',
    sortOrder: 23,
  },

  // ---------- 知名艺术家风格(artist,创意表达) ----------
  {
    id: 'preset_artist__painting',
    name: '艺术家·绘画',
    description: '技法语言升至 35%,强调笔意与个人面貌(仅创作实践阶段)',
    styleType: 'artist',
    artType: 'painting',
    applicableStage: 'creative',
    dimensions: [
      dim('composition_form', PAINTING_DIMS.composition_form, 15),
      dim('color', PAINTING_DIMS.color, 20),
      dim('technique', PAINTING_DIMS.technique, 35),
      dim('overall', PAINTING_DIMS.overall, 30),
    ],
    rationale: '技法 35% + 整体气韵 30% 强调笔意与个人面貌;构图降至 15% 允许打破常规',
    sortOrder: 30,
  },
  {
    id: 'preset_artist__design',
    name: '艺术家·设计',
    description: '创意升至 50%,原创性与文化叙事主导',
    styleType: 'artist',
    artType: 'design',
    applicableStage: 'creative',
    dimensions: [
      dim('visual_hierarchy', DESIGN_DIMS.visual_hierarchy, 15),
      dim('layout', DESIGN_DIMS.layout, 15),
      dim('color_application', DESIGN_DIMS.color_application, 20),
      dim('creativity', DESIGN_DIMS.creativity, 50),
    ],
    rationale: '创意 50% 原创性与文化叙事主导;层次排版各 15%,形式服从创意',
    sortOrder: 31,
  },
  {
    id: 'preset_artist__product',
    name: '艺术家·产品',
    description: '形态+材质=70%,造型与材质作为情感表达载体(艺术衍生品/观念产品)',
    styleType: 'artist',
    artType: 'product',
    applicableStage: 'creative',
    dimensions: [
      dim('form_semantics', PRODUCT_DIMS.form_semantics, 40),
      dim('material', PRODUCT_DIMS.material, 30),
      dim('function', PRODUCT_DIMS.function, 20),
      dim('ergonomics', PRODUCT_DIMS.ergonomics, 10),
    ],
    rationale: '形态 40% + 材质 30% 作为情感表达载体;人机降至 10%,适用于观念性产品',
    sortOrder: 32,
  },
  {
    id: 'preset_artist__sculpture',
    name: '艺术家·雕塑',
    description: '观念升至 30% 与形体并重,强调观念驱动',
    styleType: 'artist',
    artType: 'sculpture',
    applicableStage: 'creative',
    dimensions: [
      dim('spatial_composition', SCULPTURE_DIMS.spatial_composition, 20),
      dim('form_language', SCULPTURE_DIMS.form_language, 30),
      dim('material_language', SCULPTURE_DIMS.material_language, 20),
      dim('concept', SCULPTURE_DIMS.concept, 30),
    ],
    rationale: '观念 30% 与形体并重,材料降至 20%,强调观念驱动与形态语言独特性',
    sortOrder: 33,
  },

  // ---------- 设计取向风格(applied,应用导向) ----------
  {
    id: 'preset_applied__painting',
    name: '设计取向·绘画',
    description: '色彩 30% + 整体 30%,侧重应用插画/海报色彩传达(绘画非主用场)',
    styleType: 'applied',
    artType: 'painting',
    applicableStage: 'advanced',
    dimensions: [
      dim('composition_form', PAINTING_DIMS.composition_form, 20),
      dim('color', PAINTING_DIMS.color, 30),
      dim('technique', PAINTING_DIMS.technique, 20),
      dim('overall', PAINTING_DIMS.overall, 30),
    ],
    rationale: '色彩+整体各 30% 侧重应用插画/海报色彩传达与整体沟通力',
    sortOrder: 40,
  },
  {
    id: 'preset_applied__design',
    name: '设计取向·设计',
    description: '层次+排版+色彩共 80%,强调可用性与信息效率',
    styleType: 'applied',
    artType: 'design',
    applicableStage: 'advanced',
    dimensions: [
      dim('visual_hierarchy', DESIGN_DIMS.visual_hierarchy, 30),
      dim('layout', DESIGN_DIMS.layout, 25),
      dim('color_application', DESIGN_DIMS.color_application, 25),
      dim('creativity', DESIGN_DIMS.creativity, 20),
    ],
    rationale: '层次+排版+色彩共 80% 强调可用性;创意降至 20%,应用导向弱化纯原创评判',
    sortOrder: 41,
  },
  {
    id: 'preset_applied__product',
    name: '设计取向·产品',
    description: '功能 30% + 人机 25% 共 55%,用户体验与可用性优先(红点/iF 取向)',
    styleType: 'applied',
    artType: 'product',
    applicableStage: 'advanced',
    dimensions: [
      dim('form_semantics', PRODUCT_DIMS.form_semantics, 25),
      dim('material', PRODUCT_DIMS.material, 20),
      dim('function', PRODUCT_DIMS.function, 30),
      dim('ergonomics', PRODUCT_DIMS.ergonomics, 25),
    ],
    rationale: '功能+人机共 55% 用户体验优先;形态 25%、材质 20%(红点/iF 评审取向)',
    sortOrder: 42,
  },
  {
    id: 'preset_applied__sculpture',
    name: '设计取向·雕塑',
    description: '空间 35% + 观念 25%,公共艺术环境关系与公众互动优先',
    styleType: 'applied',
    artType: 'sculpture',
    applicableStage: 'advanced',
    dimensions: [
      dim('spatial_composition', SCULPTURE_DIMS.spatial_composition, 35),
      dim('form_language', SCULPTURE_DIMS.form_language, 25),
      dim('material_language', SCULPTURE_DIMS.material_language, 15),
      dim('concept', SCULPTURE_DIMS.concept, 25),
    ],
    rationale: '空间 35% + 观念 25% 公共艺术环境关系优先;材料降至 15%',
    sortOrder: 43,
  },
];

/**
 * 校验所有 seed 预设权重总和=100
 * 在 seed 脚本注入前调用,确保数据完整性
 */
export function validateSeedPresets(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  for (const preset of SEED_PRESETS) {
    const sum = preset.dimensions.reduce((acc, d) => acc + d.weight, 0);
    if (sum !== 100) {
      errors.push(`${preset.id}: 权重总和=${sum},应为 100`);
    }
    if (preset.dimensions.length < 4) {
      errors.push(`${preset.id}: 维度数=${preset.dimensions.length},应≥4`);
    }
  }
  return { valid: errors.length === 0, errors };
}
