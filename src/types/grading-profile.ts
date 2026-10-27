// ============================================================
// 丹青有AI - 评分档案类型(本地镜像,双阶段反馈框架 Phase 2 批次⑤)
// 镜像来源:
//   - server/src/types/grading-profile.ts(GradingProfileConfig 契约)
//   - server/src/services/grading-profile.service.ts(Summary/Detail DTO)
// 说明:
//   前端 src/types/api-contract.ts 为只读同步副本,Phase 2 批次②的档案
//   DTO 定义于后端 service 层而非 api-contract,故照 types/teacher.ts 惯例
//   在本文件冻结镜像类型,不改动只读副本。
//   接口均位于业务命名空间 /api/v1/grading-profiles(教师/管理员/所有者)。
// ============================================================

import type { ISODateString } from './api-contract';

/** 档案适用类目(与后端 GRADING_PROFILE_CATEGORIES 对齐) */
export type GradingProfileCategory = 'sketch' | 'color' | 'quickSketch' | 'design';

/** 类目中文标签(列表卡片/编辑器共用) */
export const GRADING_PROFILE_CATEGORY_LABELS: Record<GradingProfileCategory, string> = {
  sketch: '素描',
  color: '色彩',
  quickSketch: '速写',
  design: '设计',
};

/** 反馈模式(批次③注入层预判:diagnosis 诊断 / guidance 引导) */
export type FeedbackMode = 'diagnosis' | 'guidance';

/** 反馈模式中文标签 */
export const FEEDBACK_MODE_LABELS: Record<FeedbackMode, string> = {
  diagnosis: '诊断模式',
  guidance: '引导模式',
};

/** 维度权重项(权重 0-100,总和须=100) */
export interface GradingProfileDimensionWeight {
  key: string;
  label: string;
  weight: number;
}

/** 档位映射项(按 min 严格降序,末档 min=0 兜底) */
export interface GradingProfileTier {
  key: string;
  label: string;
  min: number;
}

/** 客观检测阈值覆盖(四项;缺省走引擎默认,批次⑥消费) */
export interface GradingProfileObjectiveChecks {
  /** 画面灰检测:明度标尺利用率下限(引擎默认 0.5) */
  graynessUtil: number;
  /** 对比度检测:Michelson 对比度下限(引擎默认 0.35) */
  contrastMichelson: number;
  /** 饱和度检测:低饱和像素占比上限(引擎默认 0.75) */
  saturationLow: number;
  /** 构图重心检测:重心偏移容差上限(引擎默认 0.18) */
  focusOffset: number;
}

/** 档案配置(GradingProfile.config JSON;校验规则见后端 Zod 契约) */
export interface GradingProfileConfig {
  /** 默认反馈模式(无历史均值冷启动时的注入层预判) */
  defaultFeedbackMode: FeedbackMode;
  /** 维度权重(总和=100,key 不重复) */
  dimensionWeights: GradingProfileDimensionWeight[];
  /** 阈值(basicsLine=综合分达标线,≥时输出层切引导模式) */
  thresholds: {
    basicsLine: number;
    dimensionPass: Record<string, number>;
  };
  /** 档位映射(降序区间换算综合分→档位) */
  tierMapping: GradingProfileTier[];
  /** 反馈风格参数 */
  feedbackStyle: {
    /** 诊断强度 1-5 */
    diagnosisIntensity: number;
    /** 正面反馈占比 0-1 */
    positiveRatio: number;
    /** 语气严格度 1-5 */
    toneStrictness: number;
  };
  /** 四项客观检测阈值覆盖(可选,缺省走引擎默认) */
  objectiveChecks?: GradingProfileObjectiveChecks;
}

/** 档案列表项(后端 GradingProfileSummary 镜像) */
export interface GradingProfileSummary {
  id: string;
  name: string;
  description: string | null;
  category: GradingProfileCategory;
  /** 系统内置(只读,克隆后可微调) */
  isBuiltIn: boolean;
  /** 租户同类目默认档案(解析优先于系统兜底) */
  isDefault: boolean;
  /** fork 溯源(指向源档案) */
  forkedFromId: string | null;
  creatorId: string | null;
  enabled: boolean;
  sortOrder: number;
}

/** 档案详情(后端 GradingProfileDetail 镜像,含 config 全量) */
export interface GradingProfileDetail extends GradingProfileSummary {
  config: GradingProfileConfig;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

/** POST /grading-profiles 请求体 */
export interface CreateGradingProfileRequest {
  name: string;
  description?: string;
  category: GradingProfileCategory;
  config: GradingProfileConfig;
}

/** POST /grading-profiles/:id/fork 请求体 */
export interface ForkGradingProfileRequest {
  name: string;
  description?: string;
}

/** PATCH /grading-profiles/:id 请求体(全部可选) */
export interface UpdateGradingProfileRequest {
  name?: string;
  description?: string;
  config?: GradingProfileConfig;
  enabled?: boolean;
}

/* ============================================================
 * Phase 5 批次③:教学行为画像 + 档案建议(数据飞轮 · 风格沉淀)
 * 镜像来源:server/src/types/grading-profile.ts(画像统计与建议契约)
 * ============================================================ */

/** 教师批注四动作(TeacherAnnotation.action 镜像) */
export type AnnotationAction = 'supplement' | 'correct' | 'confirm' | 'reject';

/** 建议键 = feedbackStyle 三参数名 */
export type SuggestionKey = 'diagnosisIntensity' | 'positiveRatio' | 'toneStrictness';

/** 建议键中文标签(建议卡片展示) */
export const SUGGESTION_KEY_LABELS: Record<SuggestionKey, string> = {
  diagnosisIntensity: '诊断强度',
  positiveRatio: '正面反馈占比',
  toneStrictness: '语气严格度',
};

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
  /** 学生 up 反馈数(邻接一致信号;教师本人画像恒 0) */
  upCount: number;
  /** 学生 down 反馈数(邻接不一致信号;教师本人画像恒 0) */
  downCount: number;
  /** AI 一致率:confirm(与学生 up 邻接同义)为一致信号;无显式裁决 null */
  aiAgreementRate: number | null;
  /** 最近活跃时间(最新批注 createdAt;无批注 null) */
  lastActiveAt: ISODateString | null;
}

/** GET /grading-profiles/insights/teacher 响应(本人画像,只读展示) */
export interface GradingTeacherInsightsResponse {
  teacherId: string;
  stats: GradingBehaviorStats;
}

/** 建议单条(引擎纯函数输出) */
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
export interface CreateSuggestionAdoptionRequest {
  suggestionKey: SuggestionKey;
  beforeValue: number;
  afterValue: number;
}

/** 采纳记录 DTO(响应;教师画像页历史列表消费) */
export interface SuggestionAdoptionRecord {
  id: string;
  tenantId: string;
  teacherId: string;
  profileId: string;
  suggestionKey: SuggestionKey;
  beforeValue: number;
  afterValue: number;
  suggestionBasis: Record<string, number>;
  createdAt: ISODateString;
}

/** GET /grading-profiles/insights/adoptions 响应(本人采纳历史;Phase 5 批次④) */
export interface GradingMyAdoptionsResponse {
  items: Array<SuggestionAdoptionRecord & { profileName: string | null }>;
}
