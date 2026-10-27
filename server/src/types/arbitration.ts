// ============================================================
// 丹青有AI - 多评委争议仲裁类型定义(Phase 5)
// 对应文档:.trae/documents/art-evaluation-research.md §5.2
//          .trae/documents/new-features-design.md §1.1, §3
// 严格 TypeScript,禁止 any
// ============================================================

/** 评委类型(与 Prisma enum ReviewerType 对齐) */
export type ReviewerType = 'professor' | 'lecturer' | 'ai';

/** 争议触发级别(与 Prisma enum DisputeLevel 对齐) */
export type DisputeLevel = 'consistent' | 'general' | 'high' | 'veto';

/** 争议案件状态(与 Prisma enum DisputeStatus 对齐) */
export type DisputeStatus = 'open' | 'reviewing' | 'resolved' | 'closed';

/** 评审记录状态(与 Prisma enum ReviewRecordStatus 对齐) */
export type ReviewRecordStatus = 'draft' | 'submitted' | 'superseded';

/** 预设风格(与 Prisma enum PresetStyle 对齐) */
export type PresetStyle = 'academic' | 'artist' | 'academy' | 'applied' | 'custom';

/** 预设适用阶段(与 Prisma enum PresetStage 对齐) */
export type PresetStage = 'basic' | 'foundation' | 'advanced' | 'creative';

/** 用户认证方式(与 Prisma enum AuthType 对齐) */
export type AuthType = 'feishu' | 'phone' | 'invitation' | 'password';

/** 等级档位(五档制,A≥90 / B 80-89 / C 70-79 / D 60-69 / E<60) */
export type GradeTier = 'A' | 'B' | 'C' | 'D' | 'E';

/**
 * 深度部分类型(递归可选化嵌套字段)
 * 用于仲裁配置"部分覆盖"(租户级覆盖片段 / 深合并入参)
 * 例:DeepPartial<ArbitrationConfig> 允许任意叶子字段单独覆盖
 */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

/** 建议级别(对应维度评分四档描述) */
export type SuggestionLevel = 'excellent' | 'good' | 'qualified' | 'needs_improvement';

/**
 * 仲裁配置(系统级默认,可被租户级覆盖[v2])
 * 所有阈值均可调,默认值即 art-evaluation-research.md §3 推荐值
 */
export interface ArbitrationConfig {
  /** 争议触发阈值 */
  triggers: {
    /** 一致:总分极差低于此值且维度差小,5 */
    consistentTotalRange: number;
    /** 一致:维度差低于此值,8 */
    consistentDimDiff: number;
    /** 一般争议:总分极差阈值,10 */
    generalDisputeTotalRange: number;
    /** 一般争议:维度差阈值,15 */
    generalDisputeDimDiff: number;
    /** 高争议:总分极差阈值,20 */
    highDisputeTotalRange: number;
    /** 高争议:维度差超阈值的维度数,2 */
    highDisputeDimCount: number;
    /** 高争议:跨档数阈值,2 */
    gradeCrossTierHigh: number;
    /** 否决触发:低分阈值(E 不合格),60 */
    vetoLowGrade: number;
    /** 否决触发:高分阈值(A 优秀),90 */
    vetoHighGrade: number;
  };
  /** 评委权重(按模式) */
  judgeWeights: {
    /** 常规双评委模式:教授 0.5 / 讲师 0.3 / AI 0.2 */
    regular: { professor: number; lecturer: number; ai: number };
    /** 教授+AI 双人模式:教授 0.7 / AI 0.3 */
    professorAi: { professor: number; ai: number };
    /** 委员会复议模式:每位教授 0.3 / AI 0.1 */
    committee: { professorEach: number; ai: number };
  };
  /** 最终裁定规则 */
  rules: {
    /** 默认裁定规则 */
    final: 'weighted' | 'majority' | 'unanimous';
    /** 边界容差:加权分落边界±此值内「就低」定档,1 */
    boundaryTolerance: number;
  };
  /** 边界情况处理 */
  edgeCases: {
    /** 离群分差阈值,25 */
    outlierDiff: number;
    /** 离群评分权重折半系数,0.5 */
    outlierWeightFactor: number;
    /** AI 权重降级阈值(置信度<此值),0.6 */
    aiLowConfidence: number;
    /** AI 降级后权重,0.1 */
    aiLowConfidenceWeight: number;
    /** AI 仅作参考不计入阈值(置信度<此值),0.4 */
    aiVeryLowConfidence: number;
    /** AI 与全员人工极端分歧阈值,20 */
    aiHumanExtremeDiff: number;
    /** 缺失维度超此数则评分作废,2 */
    maxMissingDimsToInvalidate: number;
  };
}

/** 评分维度项(预设内一项) */
export interface PresetDimension {
  /** 维度键,须与 AnalysisResult.dimensions 维度名对应 */
  key: string;
  /** 中文规范术语 */
  label: string;
  /** 英文术语 */
  labelEn: string;
  /** 权重 0-100,同预设内总和=100 */
  weight: number;
}

/** 评委评分维度详情(scores.dimensions[key] 值) */
export interface DimensionScore {
  /** 维度得分 0-100 */
  score: number;
  /** 等级判定 */
  level: SuggestionLevel;
  /** 评语(可选) */
  note?: string;
}

/** 评委评分快照(scores 字段结构) */
export interface ReviewScores {
  /** 各维度评分 */
  dimensions: Record<string, DimensionScore>;
  /** 总分 0-100 */
  overallScore: number;
  /** 使用的预设 ID(可选,用于追溯) */
  weightedByPreset?: string;
}

/** 争议触发原因 */
export interface DisputeTriggerReason {
  /** 总分极差 */
  totalRange: number;
  /** 各维度极差 */
  dimDiffs: Record<string, number>;
  /** 跨档数 */
  gradeCrossCount: number;
  /** 否决详情(仅 veto 级别) */
  vetoDetail?: { lowGrade: number; highGrade: number };
  /** 发起方式(学生申请人工复核时为 'manual_review';自动触发时缺省) */
  requestType?: 'manual_review';
  /** 申请人用户 ID(仅 manual_review) */
  requesterId?: string;
  /** 申请理由(仅 manual_review) */
  requestReason?: string;
  /** 评审类型(ai=AI评审 / teacher=老师评审,仅 manual_review) */
  reviewType?: 'ai' | 'teacher';
}

/** 争议最终裁定结果(finalScore 字段结构) */
export interface DisputeFinalScore {
  /** 最终总分 */
  overallScore: number;
  /** 各维度最终分 */
  dimensions: Record<string, number>;
  /** 裁定规则 */
  rule: 'weighted' | 'majority' | 'unanimous';
  /** 使用的权重映射(reviewerId → weight) */
  weightsUsed: Record<string, number>;
}

/**
 * 将分数映射为等级档位
 * A≥90 / B 80-89 / C 70-79 / D 60-69 / E<60
 */
export function scoreToGrade(score: number): GradeTier {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'E';
}

/**
 * 边界容差处理:加权分落边界±tolerance 内「就低」定档
 * 例如 89.5 在 90 边界±1 内,取 B 档(80-89)
 */
export function applyBoundaryTolerance(score: number, tolerance: number): number {
  // 若分数在档位边界±tolerance 内,向下取整到档位下限
  const boundaries = [90, 80, 70, 60];
  for (const boundary of boundaries) {
    if (Math.abs(score - boundary) <= tolerance && score >= boundary) {
      // 接近上界,就低:取 boundary - 1(即降一档的最高分)
      return boundary - 1;
    }
  }
  return Math.round(score * 10) / 10; // 保留一位小数
}
