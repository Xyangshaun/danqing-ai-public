// ============================================================
// 报告视图模型(报告导出 + 分析报告增强共用)
// 将后端 ReportDataResponse 归一化为模板可直接渲染的结构
// 对应规划:.trae/specs/report-export-org-share/spec.md §3.3
// ============================================================

import type {
  ArtType,
  HistoryComparison,
  GrowthMiniPoint,
  RadarDataPoint,
  ReportDataResponse,
} from '../../types/api-contract';
import { ART_TYPE_CONFIG } from '../../types';

/** 报告模板类型 */
export type ReportTemplate = 'student' | 'teacher' | 'summary';

export const REPORT_TEMPLATE_LABELS: Record<ReportTemplate, string> = {
  student: '学生成长版',
  teacher: '教师教学版',
  summary: '简洁摘要版',
};

/** 维度明细(分数 + 评语) */
export interface ReportDimensionDetail {
  key: string;
  label: string;
  score: number;
  /** 维度评语(维度对象 suggestion 字段) */
  comment: string;
}

/** 建议项(归一化优先级) */
export interface ReportSuggestionItem {
  priority: 'high' | 'medium' | 'low';
  priorityLabel: string;
  /** 建议正文(优先 operation,兼容旧 suggestion 字段) */
  content: string;
  /** 证据(可选) */
  evidence?: string;
}

/** 报告视图模型(模板渲染的唯一数据源) */
export interface ReportViewModel {
  id: string;
  title: string;
  artType: ArtType;
  artTypeLabel: string;
  imageUrl: string;
  createdAt: string;
  /** 格式化日期(YYYY年M月D日) */
  dateLabel: string;
  /** 综合分(批次⑤:基础检测不产分时为 null,报告不再以 0 分假显示) */
  overallScore: number | null;
  radar: RadarDataPoint[];
  dimensions: ReportDimensionDetail[];
  suggestions: ReportSuggestionItem[];
  aiEnhanced: boolean;
  historyComparison: HistoryComparison;
  growthMini: GrowthMiniPoint[];
  /** 班级百分位(仅教师/管理员可见,否则 null) */
  classPercentile: number | null;
}

const PRIORITY_LABELS: Record<ReportSuggestionItem['priority'], string> = {
  high: '必改',
  medium: '提升',
  low: '亮点',
};

/** 格式化 ISO 日期为中文日期 */
export function formatDateLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 从维度对象提取 score + suggestion(运行时结构宽容解析) */
function extractDimension(
  key: string,
  value: unknown,
  radarLabels: Map<string, string>,
): ReportDimensionDetail | null {
  if (value === null || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  if (typeof obj.score !== 'number') return null;
  return {
    key,
    label: radarLabels.get(key) ?? key,
    score: Math.round(obj.score),
    comment: typeof obj.suggestion === 'string' ? obj.suggestion : '',
  };
}

/** 归一化单条建议(兼容新旧字段:operation 优先,回退 suggestion) */
function normalizeSuggestion(raw: unknown): ReportSuggestionItem | null {
  if (raw === null || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const content =
    typeof obj.operation === 'string' && obj.operation.trim()
      ? obj.operation
      : typeof obj.suggestion === 'string'
        ? obj.suggestion
        : '';
  if (!content) return null;
  const p = obj.priority;
  const priority: ReportSuggestionItem['priority'] =
    p === 'high' || p === 'low' ? p : 'medium';
  return {
    priority,
    priorityLabel: PRIORITY_LABELS[priority],
    content,
    evidence: typeof obj.evidence === 'string' ? obj.evidence : undefined,
  };
}

/**
 * 从后端 report-data 响应构建视图模型
 * professionalSuggestions 为运行时透传字段(契约 AnalysisResult 未显式声明),宽容解析
 */
export function buildReportViewModel(res: ReportDataResponse): ReportViewModel {
  const { analysis, radarData, historyComparison, growthMini, classPercentile } = res;
  const result = analysis.result as (Record<string, unknown> & {
    dimensions?: Record<string, unknown>;
    professionalSuggestions?: unknown[];
    overallScore?: number;
  }) | null;

  const radarLabels = new Map(radarData.map((r) => [r.dimension, r.label]));

  const dimensions: ReportDimensionDetail[] = [];
  if (result?.dimensions) {
    for (const [key, value] of Object.entries(result.dimensions)) {
      if (key === 'type') continue;
      const detail = extractDimension(key, value, radarLabels);
      if (detail) dimensions.push(detail);
    }
  }

  const suggestions: ReportSuggestionItem[] = [];
  if (Array.isArray(result?.professionalSuggestions)) {
    for (const raw of result.professionalSuggestions) {
      const item = normalizeSuggestion(raw);
      if (item) suggestions.push(item);
    }
  }
  // 排序:high → medium → low
  const order = { high: 0, medium: 1, low: 2 };
  suggestions.sort((a, b) => order[a.priority] - order[b.priority]);

  return {
    id: analysis.id,
    title: analysis.title ?? '未命名作品',
    artType: analysis.workType,
    artTypeLabel: ART_TYPE_CONFIG[analysis.workType]?.label ?? analysis.workType,
    imageUrl: analysis.imageUrl,
    createdAt: analysis.createdAt,
    dateLabel: formatDateLabel(analysis.createdAt),
    // 批次⑤:null 透传——无 AI 深度分析的基础检测报告不再显示假 0 分
    overallScore:
      typeof result?.overallScore === 'number' ? Math.round(result.overallScore) : null,
    radar: radarData,
    dimensions,
    suggestions,
    aiEnhanced: (analysis as { aiEnhanced?: boolean }).aiEnhanced === true,
    historyComparison,
    growthMini,
    classPercentile,
  };
}
