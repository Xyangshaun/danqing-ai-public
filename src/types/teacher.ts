// ============================================================
// 丹青有AI - 教师端类型(本地镜像,同步自 server/src/types/api-contract.ts)
// 说明:
//   前端 src/types/api-contract.ts 为只读同步副本,不含租户成员/成长/评审类型。
//   本文件按冻结契约原文定义本地镜像类型(与 types/admin.ts 做法一致),不改动只读副本。
//   接口均位于业务命名空间 /api/v1(非 /api/admin)。
// ============================================================

import type {
  ISODateString,
  UserRole,
  PaginatedData,
  AnalysisListItem,
  ListAnalysesQuery,
  ListAnalysesResponse,
} from './api-contract';

/* 再导出契约基础类型,便于教师端页面统一从本模块引用 */
export type {
  ISODateString,
  UserRole,
  PaginatedData,
  AnalysisListItem,
  ListAnalysesQuery,
  ListAnalysesResponse,
};

// ============ 班级学生列表(GET /api/v1/tenants/:id/members) ============

/** 租户成员信息(列表项) */
export interface TenantMemberInfo {
  userId: string;
  tenantId: string;
  role: UserRole;
  joinedAt: ISODateString;
  user: {
    id: string;
    name: string;
    avatar: string;
    email: string | null;
    feishuOpenId: string | null;
  };
}

/** GET /tenants/:id/members 响应 */
export type ListTenantMembersResponse = TenantMemberInfo[];

// ============ 学生成长曲线(GET /api/v1/growth?userId=) ============

/** 成长维度 */
export type GrowthDimension = 'composition' | 'color' | 'originality' | 'overall';

/** 成长时间范围 */
export type GrowthTimeRange = '7d' | '30d' | '90d' | 'all';

/** 成长趋势 */
export type GrowthTrend = 'up' | 'down' | 'stable';

/** 成长曲线数据点 */
export interface GrowthDataPoint {
  /** ISO 8601 日期(对应分析记录的 createdAt) */
  date: ISODateString;
  /** 分数(0-100) */
  score: number;
  /** 关联的分析记录 ID */
  analysisId: string;
  /** 作品类型(painting/design/product/sculpture) */
  artType: string;
}

/** 成长曲线汇总统计 */
export interface GrowthSummary {
  /** 当前最新分数(0-100) */
  current: number;
  /** 平均分(四舍五入取整) */
  average: number;
  /** 趋势:相比第一个数据点上升/下降/持平 */
  trend: GrowthTrend;
  /** 相比第一个数据点的变化量(当前 - 首个) */
  change: number;
  /** 总分析次数(有效数据点数) */
  totalAnalyses: number;
}

/** GET /growth 查询参数 */
export interface GrowthQuery {
  dimension?: GrowthDimension;
  timeRange?: GrowthTimeRange;
  artType?: string;
  /** TEACHER/ADMIN 查看指定学生的成长(STUDENT 传此参数将被服务端忽略) */
  userId?: string;
}

/** GET /growth 响应 */
export interface GrowthResponse {
  dimension: string;
  timeRange: string;
  dataPoints: GrowthDataPoint[];
  summary: GrowthSummary;
}

// ============ 评审评分(POST /api/v1/analyses/:id/reviews) ============

/** 评委类型(与 Prisma enum 对齐) */
export type ReviewerType = 'professor' | 'lecturer' | 'ai';

/** 评审记录状态 */
export type ReviewRecordStatus = 'draft' | 'submitted' | 'superseded';

/** 评审维度等级(四档) */
export type ReviewLevel = 'excellent' | 'good' | 'qualified' | 'needs_improvement';

/** 评审评分结构 */
export interface ReviewScoresPayload {
  dimensions: Record<
    string,
    {
      score: number;
      level: ReviewLevel;
      note?: string;
    }
  >;
  overallScore: number;
}

/** POST /analyses/:id/reviews 请求体 */
export interface CreateReviewRequest {
  reviewerType: ReviewerType;
  presetId?: string;
  scores: ReviewScoresPayload;
  /** AI 评审时必传 0-1 */
  confidence?: number;
  comment?: string;
  /** 默认 submitted */
  status?: 'draft' | 'submitted';
}

/** GET /analyses/:id/reviews 响应项 */
export interface ReviewRecordSummary {
  id: string;
  reviewerId: string | null;
  reviewerName: string | null;
  reviewerType: ReviewerType;
  presetId: string | null;
  scores: ReviewScoresPayload;
  confidence: number | null;
  comment: string | null;
  status: ReviewRecordStatus;
  createdAt: ISODateString;
}

// ============ 批量评分(前端编排,无独立后端端点) ============

/** 批量评分单条结果 */
export interface BatchReviewItemResult {
  analysisId: string;
  success: boolean;
  error?: string;
}

/** 批量评分汇总 */
export interface BatchReviewSummary {
  total: number;
  succeeded: number;
  failed: number;
  results: BatchReviewItemResult[];
}

// ============ 标注级教师批注(反馈闭环 Phase 4 批次③,/api/v1/analyses/:id/annotations) ============

/** 批注动作:supplement=补充 / correct=纠正 / confirm=确认 / reject=驳回 */
export type TeacherAnnotationAction = 'supplement' | 'correct' | 'confirm' | 'reject';

/** 创建批注请求体(POST /analyses/:id/annotations) */
export interface CreateTeacherAnnotationRequest {
  /** marker 稳定 ID(批次①后新数据;可选,旧数据由 markerIndex 兜底) */
  markerId?: string;
  /** marker 在 issueMarkers 数组中的原始索引 */
  markerIndex: number;
  action: TeacherAnnotationAction;
  /** 批注内容(1-500 字) */
  comment: string;
}

/** 更新批注请求体(PATCH,至少一项) */
export interface UpdateTeacherAnnotationRequest {
  action?: TeacherAnnotationAction;
  comment?: string;
}

/** 批注记录(GET 列表项/创建/更新响应) */
export interface TeacherAnnotationRecord {
  id: string;
  analysisId: string;
  teacherId: string;
  teacherName: string | null;
  markerId: string | null;
  markerIndex: number;
  action: TeacherAnnotationAction;
  comment: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

// ============ 争议仲裁(GET /api/v1/disputes) ============

/** 争议触发级别(与 Prisma enum 对齐) */
export type DisputeLevel = 'consistent' | 'general' | 'high' | 'veto';

/** 争议状态 */
export type DisputeStatus = 'open' | 'reviewing' | 'resolved' | 'closed';

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

/** 仲裁配置(系统级默认,可被租户级覆盖) */
export interface ArbitrationConfig {
  triggers: {
    consistentTotalRange: number;
    consistentDimDiff: number;
    generalDisputeTotalRange: number;
    generalDisputeDimDiff: number;
    highDisputeTotalRange: number;
    highDisputeDimCount: number;
    gradeCrossTierHigh: number;
    vetoLowGrade: number;
    vetoHighGrade: number;
  };
  judgeWeights: {
    regular: { professor: number; lecturer: number; ai: number };
    professorAi: { professor: number; ai: number };
    committee: { professorEach: number; ai: number };
  };
  rules: {
    final: 'weighted' | 'majority' | 'unanimous';
    boundaryTolerance: number;
  };
  edgeCases: {
    outlierDiff: number;
    outlierWeightFactor: number;
    aiLowConfidence: number;
    aiLowConfidenceWeight: number;
    aiVeryLowConfidence: number;
    aiHumanExtremeDiff: number;
    maxMissingDimsToInvalidate: number;
  };
}

/** 争议最终裁定结果 */
export interface DisputeFinalScore {
  overallScore: number;
  dimensions: Record<string, number>;
  rule: 'weighted' | 'majority' | 'unanimous';
  /** 使用的权重映射(reviewerId → weight) */
  weightsUsed: Record<string, number>;
}

/** GET /disputes/:id 响应(列表项同为该结构) */
export interface DisputeCaseDetail {
  id: string;
  analysisId: string;
  triggerLevel: DisputeLevel;
  triggerReason: DisputeTriggerReason;
  status: DisputeStatus;
  reviews: ReviewRecordSummary[];
  arbitrationConfig: ArbitrationConfig;
  finalScore: DisputeFinalScore | null;
  resolvedBy: string | null;
  resolvedAt: ISODateString | null;
  createdAt: ISODateString;
}

/** GET /disputes 查询参数 */
export interface DisputeListQuery {
  page?: number;
  pageSize?: number;
  status?: DisputeStatus;
  level?: DisputeLevel;
  analysisId?: string;
}

/** GET /disputes 响应 */
export type ListDisputesResponse = PaginatedData<DisputeCaseDetail>;

/** POST /analyses/:id/disputes/request 请求体(学生申请人工复核) */
export interface RequestDisputeRequest {
  /** 申请理由(10-500 字) */
  reason: string;
  /** 评审类型(ai=AI评审 / teacher=老师评审),默认 teacher */
  reviewType?: 'ai' | 'teacher';
}

/** POST /analyses/:id/disputes/request 响应 */
export interface RequestDisputeResponse {
  /** 已创建的争议案件 ID */
  disputeCaseId: string;
  /** 关联的分析任务 ID */
  analysisId: string;
  /** 案件状态(创建后为 open) */
  status: DisputeStatus;
  /** 触发级别(学生申请固定 general) */
  triggerLevel: DisputeLevel;
  /** 创建时间 */
  createdAt: ISODateString;
}

/** POST /disputes/:id/resolve 请求体 */
export interface ResolveDisputeRequest {
  /** 裁定规则:weighted=加权 / majority=多数决 / unanimous=一致 */
  rule: 'weighted' | 'majority' | 'unanimous';
  /** 是否手动覆盖最终分(可选) */
  overrideScore?: {
    overallScore: number;
    dimensions: Record<string, number>;
    note: string;
  };
}

/** POST /disputes/:id/apply-result 响应 */
export interface ApplyDisputeResultResponse {
  disputeId: string;
  analysisId: string;
  appliedScore: number;
  applied: boolean;
}
