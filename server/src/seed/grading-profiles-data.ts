// ============================================================
// 丹青有AI - GradingProfile 系统预设 Seed 数据(双阶段反馈框架 Phase 2 批次①)
// 3 套 = 联考三科(素描/色彩/速写)标准版
// 对应文档:visual-annotation-feedback-upgrade-spec-2026-09.md §4(LUT 式评分档案)/§6 Phase 2
//
// 维度与档位依据:ai-vision.service.ts EXAM_SUBJECT_STANDARDS(省级美术联考评分标准)
//   一档(90-100) / 二档(80-89) / 三档(70-79) / 四档(60-69) / 五档(<60)
// 注入方式:prisma db seed,isBuiltIn=true,creatorId=null,tenantId=null
// 不可变性:isBuiltIn=true 的记录在 service 层强制禁止 UPDATE/DELETE(批次②)
// 固定 ID:便于 fork 引用(非标准 UUID 字符串,Prisma @id 为 String 支持)
//
// 说明:本文件为批次①纯数据结构;批次②将在 src/types/grading-profile.ts 建立
//       Zod 契约(校验规则与 validateGradingProfiles 保持一致)
// ============================================================

/** 维度权重项 */
// (type 别名而非 interface:获得隐式索引签名,可整体赋值给 Prisma InputJsonObject)
export type GradingWeightItem = {
  key: string;
  label: string;
  /** 权重百分比(整数,所有维度总和必须=100) */
  weight: number;
};

/** 档位映射项(降序;AI 综合分 ≥ min 落入该档) */
export type GradingTierItem = {
  key: string;
  label: string;
  min: number;
};

/** 档案配置(GradingProfile.config JSON 结构;批次②建 Zod 契约) */
export type GradingProfileConfigData = {
  /** 首轮 prompt 注入预判用反馈模式(批次③注入层;输出层按综合分真实判定) */
  defaultFeedbackMode: 'diagnosis' | 'guidance';
  /** 维度权重(总和=100;综合分兜底均值计算按此加权) */
  dimensionWeights: GradingWeightItem[];
  /** 阈值:基本功达标线(诊断/引导切换)+ 各维度及格线 */
  thresholds: {
    basicsLine: number;
    dimensionPass: Record<string, number>;
  };
  /** 档位映射(降序;租户四档/联考五档均可,教师克隆后可自由调整) */
  tierMapping: GradingTierItem[];
  /** 反馈风格:诊断强度 1-5 / 正向标注占比 0-1 / 语气严格度 1-5 */
  feedbackStyle: {
    diagnosisIntensity: number;
    positiveRatio: number;
    toneStrictness: number;
  };
  /** 四项客观检测阈值覆盖(可选;缺省走引擎默认,批次⑥消费) */
  objectiveChecks?: {
    graynessUtil: number;
    contrastMichelson: number;
    saturationLow: number;
    focusOffset: number;
  };
};

/** Seed 档案数据结构(供 seed 脚本注入) */
export type SeedGradingProfile = {
  /** 固定 ID,便于 fork 引用,如 'gprofile_builtin_sketch' */
  id: string;
  name: string;
  description: string;
  /** 适用类目:sketch=素描, color=色彩, quickSketch=速写, design=设计 */
  category: 'sketch' | 'color' | 'quickSketch' | 'design';
  config: GradingProfileConfigData;
  /** 排序权重(数字越小越靠前) */
  sortOrder: number;
};

// ============================================================
// 联考五档 tierMapping(三科共用;取自 EXAM_SUBJECT_STANDARDS bands)
// ============================================================

const LIANKAO_TIERS: GradingTierItem[] = [
  { key: 'A', label: '一档(90-100)', min: 90 },
  { key: 'B', label: '二档(80-89)', min: 80 },
  { key: 'C', label: '三档(70-79)', min: 70 },
  { key: 'D', label: '四档(60-69)', min: 60 },
  { key: 'E', label: '五档(<60)', min: 0 },
];

/** 中性反馈风格默认值(教师克隆后可调) */
const NEUTRAL_FEEDBACK_STYLE = {
  diagnosisIntensity: 3,
  positiveRatio: 0.3,
  toneStrictness: 3,
};

/** 辅助:构造档案配置(联考标准版模板) */
function liankaoConfig(dimensionWeights: GradingWeightItem[]): GradingProfileConfigData {
  return {
    // 联考场景学生多为基本功训练,默认诊断模式(具体可操作纠错);
    // 综合分 ≥ basicsLine 时输出层切换为引导模式(批次③)
    defaultFeedbackMode: 'diagnosis',
    dimensionWeights,
    // 基本功达标线=三档线 70(教学经验值:联考三档即基本功过关);
    // 各维度及格线=四档线 60
    thresholds: {
      basicsLine: 70,
      dimensionPass: Object.fromEntries(dimensionWeights.map((d) => [d.key, 60])),
    },
    tierMapping: LIANKAO_TIERS,
    feedbackStyle: NEUTRAL_FEEDBACK_STYLE,
    // objectiveChecks 缺省:走引擎默认阈值(批次⑥教师可覆盖)
  };
}

// ============================================================
// 3 套系统预设(联考三科,维度与 EXAM_SUBJECT_STANDARDS 严格一致,权重均等 20%)
// ============================================================

export const SEED_GRADING_PROFILES: SeedGradingProfile[] = [
  {
    id: 'gprofile_builtin_sketch',
    name: '联考·素描·标准版',
    description:
      '省级美术联考素描评分标准(五维度均等权重),系统默认档案;画室/教师可克隆后微调权重与档位',
    category: 'sketch',
    config: liankaoConfig([
      { key: 'form_proportion', label: '造型与比例', weight: 20 },
      { key: 'structure', label: '结构理解', weight: 20 },
      { key: 'value_relationship', label: '黑白灰关系', weight: 20 },
      { key: 'rendering', label: '深入塑造', weight: 20 },
      { key: 'completeness', label: '完整度', weight: 20 },
    ]),
    sortOrder: 10,
  },
  {
    id: 'gprofile_builtin_color',
    name: '联考·色彩·标准版',
    description:
      '省级美术联考色彩评分标准(五维度均等权重),系统默认档案;画室/教师可克隆后微调权重与档位',
    category: 'color',
    config: liankaoConfig([
      { key: 'tonal_unity', label: '色调统一性', weight: 20 },
      { key: 'color_relationship', label: '色彩关系', weight: 20 },
      { key: 'color_rendering', label: '色彩塑造', weight: 20 },
      { key: 'technique', label: '技法表现', weight: 20 },
      { key: 'completeness', label: '完整度', weight: 20 },
    ]),
    sortOrder: 11,
  },
  {
    id: 'gprofile_builtin_quick_sketch',
    name: '联考·速写·标准版',
    description:
      '省级美术联考速写评分标准(五维度均等权重),系统默认档案;画室/教师可克隆后微调权重与档位',
    category: 'quickSketch',
    config: liankaoConfig([
      { key: 'dynamic_proportion', label: '动态与比例', weight: 20 },
      { key: 'structure', label: '结构理解', weight: 20 },
      { key: 'line_expression', label: '线条表现', weight: 20 },
      { key: 'composition', label: '画面组织', weight: 20 },
      { key: 'completeness', label: '完整度', weight: 20 },
    ]),
    sortOrder: 12,
  },
];

// ============================================================
// 校验(seed 注入前预校验;与批次② types/grading-profile.ts Zod 规则保持一致)
// ============================================================

export type ValidationResult = {
  valid: boolean;
  errors: string[];
};

export function validateSeedGradingProfiles(): ValidationResult {
  const errors: string[] = [];

  if (SEED_GRADING_PROFILES.length === 0) {
    errors.push('SEED_GRADING_PROFILES 为空');
  }

  const seenIds = new Set<string>();
  for (const profile of SEED_GRADING_PROFILES) {
    if (seenIds.has(profile.id)) {
      errors.push(`档案 ID 重复: ${profile.id}`);
    }
    seenIds.add(profile.id);

    if (!profile.id.startsWith('gprofile_builtin_')) {
      errors.push(`档案 ID 前缀不规范(应为 gprofile_builtin_): ${profile.id}`);
    }
    if (!profile.name || !profile.description) {
      errors.push(`档案 ${profile.id} 缺少 name/description`);
    }
    if (!['sketch', 'color', 'quickSketch', 'design'].includes(profile.category)) {
      errors.push(`档案 ${profile.id} category 非法: ${profile.category}`);
    }

    const { config } = profile;
    if (!['diagnosis', 'guidance'].includes(config.defaultFeedbackMode)) {
      errors.push(`档案 ${profile.id} defaultFeedbackMode 非法: ${config.defaultFeedbackMode}`);
    }

    // 维度权重:非空、正数、总和=100
    if (config.dimensionWeights.length === 0) {
      errors.push(`档案 ${profile.id} dimensionWeights 为空`);
    } else {
      const total = config.dimensionWeights.reduce((sum, d) => sum + d.weight, 0);
      if (total !== 100) {
        errors.push(`档案 ${profile.id} 权重总和=${total}(应为 100)`);
      }
      for (const d of config.dimensionWeights) {
        if (!Number.isInteger(d.weight) || d.weight <= 0) {
          errors.push(`档案 ${profile.id} 维度 ${d.key} 权重非法: ${d.weight}`);
        }
        if (!d.key || !d.label) {
          errors.push(`档案 ${profile.id} 维度缺少 key/label`);
        }
      }
    }

    // 阈值:0-100 范围
    const { basicsLine } = config.thresholds;
    if (basicsLine < 0 || basicsLine > 100) {
      errors.push(`档案 ${profile.id} basicsLine 超出 0-100: ${basicsLine}`);
    }
    for (const [key, pass] of Object.entries(config.thresholds.dimensionPass)) {
      if (pass < 0 || pass > 100) {
        errors.push(`档案 ${profile.id} 维度 ${key} 及格线超出 0-100: ${pass}`);
      }
    }

    // 档位映射:非空、降序、min 0-100
    if (config.tierMapping.length === 0) {
      errors.push(`档案 ${profile.id} tierMapping 为空`);
    } else {
      for (let i = 0; i < config.tierMapping.length; i += 1) {
        const tier = config.tierMapping[i]!;
        if (tier.min < 0 || tier.min > 100) {
          errors.push(`档案 ${profile.id} 档位 ${tier.key} min 超出 0-100: ${tier.min}`);
        }
        if (i > 0 && tier.min >= config.tierMapping[i - 1]!.min) {
          errors.push(`档案 ${profile.id} tierMapping 未按 min 降序: ${tier.key}`);
        }
      }
      const lastTier = config.tierMapping[config.tierMapping.length - 1]!;
      if (lastTier.min !== 0) {
        errors.push(`档案 ${profile.id} 末档 min 应为 0(兜底): ${lastTier.min}`);
      }
    }

    // 反馈风格:范围校验
    const fs = config.feedbackStyle;
    if (fs.diagnosisIntensity < 1 || fs.diagnosisIntensity > 5) {
      errors.push(`档案 ${profile.id} diagnosisIntensity 超出 1-5`);
    }
    if (fs.positiveRatio < 0 || fs.positiveRatio > 1) {
      errors.push(`档案 ${profile.id} positiveRatio 超出 0-1`);
    }
    if (fs.toneStrictness < 1 || fs.toneStrictness > 5) {
      errors.push(`档案 ${profile.id} toneStrictness 超出 1-5`);
    }
  }

  return { valid: errors.length === 0, errors };
}
