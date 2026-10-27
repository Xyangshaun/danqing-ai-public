// ============================================================
// 丹青有AI - 评分风格档案类型与 Zod 契约(双阶段反馈框架 Phase 2 批次②)
// 对应文档:visual-annotation-feedback-upgrade-spec-2026-09.md §4(LUT 式评分档案)
//
// 职责:
//   1. GradingProfile.config JSON 的 Zod 全量校验契约(controller 入参 + service 二次防御)
//   2. 校验规则与批次① seed 预校验(validateSeedGradingProfiles)保持一致:
//      权重总和=100 / tierMapping 降序且末档 min=0 / 阈值 0-100 / feedbackStyle 范围
//   3. ResolvedGradingProfile:批次③策略引擎的解析入口类型
//
// 校验风格参照:tenant-arbitration.service.ts(Zod 字段级范围 + 跨字段 refine)
// ============================================================

import { z } from 'zod';

/** 权重总和容忍误差(浮点累加,照 preset.service WEIGHT_SUM_TOLERANCE) */
const WEIGHT_SUM_TOLERANCE = 0.01;

// ============================================================
// Zod Schemas
// ============================================================

/** 档案适用类目(与 Analysis 类目体系一致,VarChar 存字符串免 enum migration) */
export const GRADING_PROFILE_CATEGORIES = ['sketch', 'color', 'quickSketch', 'design'] as const;
export type GradingProfileCategory = (typeof GRADING_PROFILE_CATEGORIES)[number];

/** 反馈模式(批次③注入层预判用) */
export const FEEDBACK_MODES = ['diagnosis', 'guidance'] as const;
export type FeedbackMode = (typeof FEEDBACK_MODES)[number];

/** 维度权重项 */
const dimensionWeightItemSchema = z.object({
  key: z.string().min(1).max(64),
  label: z.string().min(1).max(64),
  weight: z.number().min(0).max(100),
});

/** 档位映射项 */
const tierItemSchema = z.object({
  key: z.string().min(1).max(16),
  label: z.string().min(1).max(64),
  min: z.number().min(0).max(100),
});

/**
 * 档案配置全量契约(GradingProfile.config JSON)
 * 跨字段校验(照批次① seed 预校验规则):
 *   - dimensionWeights 非空且权重总和=100、key 不重复
 *   - tierMapping 非空且按 min 严格降序、末档 min=0(兜底档,低于末档线的分数才不会无档可落)
 */
export const gradingProfileConfigSchema = z
  .object({
    defaultFeedbackMode: z.enum(FEEDBACK_MODES),
    dimensionWeights: z.array(dimensionWeightItemSchema).min(1),
    thresholds: z.object({
      basicsLine: z.number().min(0).max(100),
      dimensionPass: z.record(z.string(), z.number().min(0).max(100)),
    }),
    tierMapping: z.array(tierItemSchema).min(1),
    feedbackStyle: z.object({
      diagnosisIntensity: z.number().min(1).max(5),
      positiveRatio: z.number().min(0).max(1),
      toneStrictness: z.number().min(1).max(5),
    }),
    // 四项客观检测阈值覆盖(批次⑥消费;缺省走引擎默认,先宽松校验正值)
    objectiveChecks: z
      .object({
        graynessUtil: z.number().positive(),
        contrastMichelson: z.number().positive(),
        saturationLow: z.number().positive(),
        focusOffset: z.number().positive(),
      })
      .optional(),
  })
  .superRefine((config, ctx) => {
    // 权重总和=100(浮点容差)
    const total = config.dimensionWeights.reduce((sum, d) => sum + d.weight, 0);
    if (Math.abs(total - 100) > WEIGHT_SUM_TOLERANCE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dimensionWeights'],
        message: `维度权重总和必须为 100,当前为 ${total}`,
      });
    }
    // 维度 key 不重复
    const keys = new Set<string>();
    for (const [i, d] of config.dimensionWeights.entries()) {
      if (keys.has(d.key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['dimensionWeights', i, 'key'],
          message: `维度 key 重复:${d.key}`,
        });
      }
      keys.add(d.key);
    }
    // tierMapping 严格降序
    for (let i = 1; i < config.tierMapping.length; i += 1) {
      if (config.tierMapping[i]!.min >= config.tierMapping[i - 1]!.min) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['tierMapping', i, 'min'],
          message: `档位必须按 min 严格降序:${config.tierMapping[i - 1]!.key}(${config.tierMapping[i - 1]!.min}) → ${config.tierMapping[i]!.key}(${config.tierMapping[i]!.min})`,
        });
      }
    }
    // 末档兜底:min=0
    const lastTier = config.tierMapping[config.tierMapping.length - 1]!;
    if (lastTier.min !== 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['tierMapping', config.tierMapping.length - 1, 'min'],
        message: `末档 ${lastTier.key} 的 min 必须为 0(兜底档)`,
      });
    }
  });

/** 档案配置 TS 类型(Zod 推导,与批次① seed 的 GradingProfileConfigData 结构一致) */
export type GradingProfileConfig = z.infer<typeof gradingProfileConfigSchema>;

// ============================================================
// Phase 5 批次③:教学行为画像 + 档案建议(数据飞轮 · 风格沉淀)
// ============================================================

/** 教师批注四动作(TeacherAnnotation.action) */
export const ANNOTATION_ACTIONS = ['supplement', 'correct', 'confirm', 'reject'] as const;
export type AnnotationAction = (typeof ANNOTATION_ACTIONS)[number];

/** 建议键 = feedbackStyle 三参数名 */
export const SUGGESTION_KEYS = ['diagnosisIntensity', 'positiveRatio', 'toneStrictness'] as const;
export type SuggestionKey = (typeof SUGGESTION_KEYS)[number];

/** 四动作计数/占比(键固定,零值填充) */
export type ActionStatMap = Record<AnnotationAction, number>;

/** 行为统计快照(教师本人 / 租户聚合共用口径) */
export interface GradingBehaviorStats {
  /** 批注总数 */
  annotationCount: number;
  /** 评审作品数(批注去重 analysisId) */
  reviewedWorks: number;
  /** 批注密度 = 批注总数 / 评审作品数(无作品恒 0) */
  annotationDensity: number;
  /** 四动作计数 */
  actionCounts: ActionStatMap;
  /** 四动作占比(分母=批注总数;0 批注时全 0) */
  actionRatios: ActionStatMap;
  /** 学生 up 反馈数(邻接一致信号;教师本人画像不统计学生反馈,恒 0) */
  upCount: number;
  /** 学生 down 反馈数(邻接不一致信号;教师本人画像恒 0) */
  downCount: number;
  /** AI 一致率:教师侧 confirm(与学生侧 up 邻接同义)为一致信号 */
  aiAgreementRate: number | null;
  /** 最近活跃时间(最新批注 createdAt;无批注 null) */
  lastActiveAt: string | null;
}

/** GET /grading-profiles/insights/teacher 响应(本人画像,只读展示) */
export interface GradingTeacherInsightsResponse {
  teacherId: string;
  stats: GradingBehaviorStats;
}

/** 建议单条(engine 纯函数输出) */
export interface GradingStyleSuggestion {
  suggestionKey: SuggestionKey;
  /** 当前档案值 */
  currentValue: number;
  /** 建议值(与 currentValue 不同才输出) */
  suggestedValue: number;
  /** 人类可读依据(含统计数字) */
  basis: string;
  /** 依据统计快照(采纳落库审计用) */
  basisSnapshot: Record<string, number>;
}

/** GET /grading-profiles/:id/insights/suggestion 响应 */
export interface GradingProfileSuggestionsResponse {
  profileId: string;
  /** 租户行为聚合(建议推导输入,一并返回便于前端展示依据) */
  stats: GradingBehaviorStats;
  /** 建议(防重复过滤后;样本不足/无触发为空数组) */
  suggestions: GradingStyleSuggestion[];
}

/** POST /grading-profiles/:id/suggestion-adoptions 请求体 */
export const suggestionAdoptionSchema = z.object({
  suggestionKey: z.enum(SUGGESTION_KEYS),
  beforeValue: z.number().finite(),
  afterValue: z.number().finite(),
});
export type CreateSuggestionAdoptionRequest = z.infer<typeof suggestionAdoptionSchema>;

/** 采纳记录 DTO(响应) */
export interface SuggestionAdoptionRecordResponse {
  id: string;
  tenantId: string;
  teacherId: string;
  profileId: string;
  suggestionKey: SuggestionKey;
  beforeValue: number;
  afterValue: number;
  suggestionBasis: Record<string, number>;
  createdAt: string;
}

/** GET /grading-profiles/insights/adoptions 响应(本人采纳历史;Phase 5 批次④) */
export interface GradingMyAdoptionsResponse {
  items: Array<SuggestionAdoptionRecordResponse & { profileName: string | null }>;
}

/**
 * 解析后的生效档案(批次③策略引擎消费)
 * 来源:resolveEffectiveProfile(tenantId, category)
 */
export type ResolvedGradingProfile = {
  /** 档案 ID(fork 链溯源用) */
  id: string;
  name: string;
  category: GradingProfileCategory;
  /** 已通过 Zod 校验的档案配置 */
  config: GradingProfileConfig;
};

/**
 * 解析 DB 的 config JSON(unknown → GradingProfileConfig)
 * @returns 校验失败返回 null(调用方自行决定回退策略)
 */
export function parseGradingProfileConfig(raw: unknown): GradingProfileConfig | null {
  const result = gradingProfileConfigSchema.safeParse(raw);
  return result.success ? result.data : null;
}

/** 校验失败详情(错误消息列表,供 controller 400 响应) */
export function gradingProfileConfigIssues(raw: unknown): string[] {
  const result = gradingProfileConfigSchema.safeParse(raw);
  if (result.success) return [];
  return result.error.issues.map((issue) => `${issue.path.join('.') || 'config'}: ${issue.message}`);
}
