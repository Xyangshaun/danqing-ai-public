// ============================================================
// 标注反馈统计 Repository(反馈闭环 Phase 5 批次①:数据飞轮备料)
// 对应表:marker_feedbacks
// 对应 API:GET /api/admin/stats/feedback/{overview,by-dimension,by-worktype,trend}
//
// 设计:
//   - 全部走 Prisma findMany + 内存聚合,不走 $queryRaw
//     (理由:prisma.mock 不支持 $queryRaw → ai-usage 统计零单测的教训;
//      反馈量级 = 分析量 × ~8 marker × 反馈率,与 Analysis 同量级可承受,
//      且统计层有 Redis 5 分钟缓存兜底,换 mock 单测能力值得)
//   - 日期过滤统一闭区间(startDate 00:00:00 / endDate 23:59:59.999,由 service 解析)
//   - dimension 从 markerSnapshot JSON 提取(缺省归「未分类」);
//     workType 为冗余列(null 归 'unknown')
// ============================================================

import { prisma } from '../config/prisma.js';
import type { Prisma } from '@prisma/client';

/** 单条反馈的统计投影(findMany select 字段) */
export interface FeedbackStatsRow {
  userId: string;
  analysisId: string;
  action: string;
  workType: string | null;
  markerSnapshot: Prisma.JsonValue;
  createdAt: Date;
}

/** 日期范围(闭区间;均空 = 不限) */
export interface FeedbackDateRange {
  startDate?: Date;
  endDate?: Date;
}

/** 维度分组项(repository 层原始形态,internal 使用) */
export interface DimensionGroup {
  dimension: string;
  totalCount: number;
  upCount: number;
  downCount: number;
}

/** 类型分组项 */
export interface WorkTypeGroup {
  workType: string;
  totalCount: number;
  upCount: number;
  downCount: number;
}

/** 趋势单日点(repository 层原始形态) */
export interface TrendPointRow {
  date: string; // YYYY-MM-DD
  totalCount: number;
  upCount: number;
  downCount: number;
}

/** 快照内 dimension 字段的兜底值(与契约注释一致) */
const UNCATEGORIZED_DIMENSION = '未分类';

/** 训练数据导出行(repository 原始形态;service 平铺为契约 AdminFeedbackExportRow) */
export interface FeedbackExportRawRow {
  analysisId: string;
  markerId: string | null;
  markerIndex: number;
  action: string;
  workType: string | null;
  diagnosisMode: string | null;
  markerSnapshot: Prisma.JsonValue;
  createdAt: Date;
}

/** 从 markerSnapshot JSON 提取 dimension(非对象/无字段/非字符串均兜底) */
function extractDimension(snapshot: Prisma.JsonValue): string {
  if (typeof snapshot !== 'object' || snapshot === null || Array.isArray(snapshot)) {
    return UNCATEGORIZED_DIMENSION;
  }
  const dim = (snapshot as Record<string, unknown>).dimension;
  return typeof dim === 'string' && dim.length > 0 ? dim : UNCATEGORIZED_DIMENSION;
}

/** Date → YYYY-MM-DD(本地时区口径,与按日聚合分组键一致) */
function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export class MarkerFeedbackStatsRepository {
  /** 统一查询:日期范围内全量拉取(统计投影字段) */
  private async fetchRows(range: FeedbackDateRange): Promise<FeedbackStatsRow[]> {
    const where: Prisma.MarkerFeedbackWhereInput = {};
    if (range.startDate || range.endDate) {
      where.createdAt = {};
      if (range.startDate) where.createdAt.gte = range.startDate;
      if (range.endDate) where.createdAt.lte = range.endDate;
    }
    return prisma().markerFeedback.findMany({
      where,
      select: {
        userId: true,
        analysisId: true,
        action: true,
        workType: true,
        markerSnapshot: true,
        createdAt: true,
      },
    });
  }

  /**
   * 总览:总量/up/down/独立用户/覆盖分析/近 7 天条数
   * 注:近 7 天口径恒定(不受 range 影响),需独立查询一次
   */
  async overview(range: FeedbackDateRange): Promise<{
    totalCount: number;
    upCount: number;
    downCount: number;
    uniqueUsers: number;
    analysesCovered: number;
    last7DaysCount: number;
  }> {
    const [rows, recentRows] = await Promise.all([
      this.fetchRows(range),
      prisma().markerFeedback.findMany({
        where: { createdAt: { gte: this.daysAgo(7) } },
        select: { id: true },
      }),
    ]);

    let upCount = 0;
    const users = new Set<string>();
    const analyses = new Set<string>();
    for (const r of rows) {
      if (r.action === 'up') upCount += 1;
      users.add(r.userId);
      analyses.add(r.analysisId);
    }

    return {
      totalCount: rows.length,
      upCount,
      downCount: rows.length - upCount,
      uniqueUsers: users.size,
      analysesCovered: analyses.size,
      last7DaysCount: recentRows.length,
    };
  }

  /** 按维度分组(快照 dimension 提取;缺省「未分类」) */
  async groupByDimension(range: FeedbackDateRange): Promise<DimensionGroup[]> {
    const rows = await this.fetchRows(range);
    const groups = new Map<string, DimensionGroup>();
    for (const r of rows) {
      const dimension = extractDimension(r.markerSnapshot);
      const g = groups.get(dimension) ?? {
        dimension,
        totalCount: 0,
        upCount: 0,
        downCount: 0,
      };
      g.totalCount += 1;
      if (r.action === 'up') g.upCount += 1;
      else g.downCount += 1;
      groups.set(dimension, g);
    }
    return Array.from(groups.values()).sort((a, b) => b.totalCount - a.totalCount);
  }

  /** 按作品类型分组(workType 冗余列;null → 'unknown') */
  async groupByWorkType(range: FeedbackDateRange): Promise<WorkTypeGroup[]> {
    const rows = await this.fetchRows(range);
    const groups = new Map<string, WorkTypeGroup>();
    for (const r of rows) {
      const workType = r.workType ?? 'unknown';
      const g = groups.get(workType) ?? {
        workType,
        totalCount: 0,
        upCount: 0,
        downCount: 0,
      };
      g.totalCount += 1;
      if (r.action === 'up') g.upCount += 1;
      else g.downCount += 1;
      groups.set(workType, g);
    }
    return Array.from(groups.values()).sort((a, b) => b.totalCount - a.totalCount);
  }

  /** 按日趋势(最近 N 天,含今日;空日不补点,只返回有数据的日期) */
  async trend(days: number): Promise<TrendPointRow[]> {
    const rows = await prisma().markerFeedback.findMany({
      where: { createdAt: { gte: this.daysAgo(days) } },
      select: { action: true, createdAt: true },
    });
    const points = new Map<string, TrendPointRow>();
    for (const r of rows) {
      const key = toDateKey(r.createdAt);
      const p = points.get(key) ?? { date: key, totalCount: 0, upCount: 0, downCount: 0 };
      p.totalCount += 1;
      if (r.action === 'up') p.upCount += 1;
      else p.downCount += 1;
      points.set(key, p);
    }
    return Array.from(points.values()).sort((a, b) => a.date.localeCompare(b.date));
  }

  /** N 天前零点(本地时区;trend「最近 N 天」含今日 → 取 N 天前 00:00) */
  private daysAgo(days: number): Date {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - (days - 1));
    return d;
  }

  /**
   * 训练数据导出:日期范围 + 可选租户过滤,全字段按采集时间升序返回
   * (Phase 5 批次②;导出量级同统计口径,findMany 可承受;不做缓存——导出要求新鲜数据)
   */
  async exportRows(range: FeedbackDateRange, tenantId?: string): Promise<FeedbackExportRawRow[]> {
    const where: Prisma.MarkerFeedbackWhereInput = {};
    if (tenantId) where.tenantId = tenantId;
    if (range.startDate || range.endDate) {
      where.createdAt = {};
      if (range.startDate) where.createdAt.gte = range.startDate;
      if (range.endDate) where.createdAt.lte = range.endDate;
    }
    return prisma().markerFeedback.findMany({
      where,
      select: {
        analysisId: true,
        markerId: true,
        markerIndex: true,
        action: true,
        workType: true,
        diagnosisMode: true,
        markerSnapshot: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });
  }
}

export const markerFeedbackStatsRepository = new MarkerFeedbackStatsRepository();
