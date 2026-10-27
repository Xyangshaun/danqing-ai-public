// ============================================================
// 成长曲线业务服务
// 对应 API:GET /api/v1/growth
//
// 职责:
//   从 Analysis 表聚合用户的历次分析分数,按时间排序构建成长曲线数据点,
//   并计算汇总统计(当前/平均/趋势/变化/总数)。
//
// 数据范围过滤(基于 RBAC 权限矩阵,同 analysis.service.listAnalyses):
//   - student:强制 WHERE user_id = 自己,忽略 targetUserId 越权
//   - teacher / admin / owner:可传 targetUserId 查看指定学生;不传则聚合租户全量
//
// 分数提取(dimension → AnalysisResult JSON 路径):
//   - overall     → result.overallScore(兜底 DB overall_score 列)
//   - originality → result.originality.score
//   - composition → result.dimensions.composition.score(仅 painting 有此维度)
//   - color       → result.dimensions.color.score(painting)
//                  / result.dimensions.colorApplication.score(design)
//   某条记录若不存在该维度分数,则跳过(不计入 dataPoints)
//
// 安全策略:
//   - tenantId 强制从 JWT 注入(防跨租户)
//   - 越权 targetUserId(student 试图查询他人)被 service 层强制覆盖
//   - 不暴露内部堆栈,异常统一由 errorHandler 处理
// ============================================================

import { analysisRepository } from '../repositories/analysis.repository.js';
import { canReadTenantWide } from '../config/permissions.js';
import { logger } from '../utils/logger.js';
import type {
  GrowthResponse,
  GrowthDataPoint,
  GrowthSummary,
  GrowthTrend,
  GrowthDimension,
  GrowthTimeRange,
  ArtType,
  UserRole,
} from '../types/api-contract.js';

/**
 * timeRange → 天数映射(null 表示不限,即 "all")
 */
const TIME_RANGE_DAYS: Readonly<Record<GrowthTimeRange, number | null>> = Object.freeze({
  '7d': 7,
  '30d': 30,
  '90d': 90,
  all: null,
});

/**
 * 从 AnalysisResult JSON 中按维度安全提取分数
 *
 * @param result      Analysis.result 字段(Json,运行时为 unknown)
 * @param dimension   成长维度
 * @param dbOverallScore  DB 冗余列 overall_score(overall 维度兜底)
 * @returns 分数(0-100);null 表示该记录不存在此维度分数,调用方应跳过
 */
function extractScore(
  result: unknown,
  dimension: GrowthDimension,
  dbOverallScore: number | null,
): number | null {
  // result 为 null/undefined 时:仅 overall 维度可兜底用 DB 列
  if (!result || typeof result !== 'object') {
    if (dimension === 'overall' && dbOverallScore !== null) {
      return dbOverallScore;
    }
    return null;
  }

  const r = result as Record<string, unknown>;

  // overall:优先取 result.overallScore,兜底 DB 列
  if (dimension === 'overall') {
    if (typeof r['overallScore'] === 'number') {
      return r['overallScore'];
    }
    if (dbOverallScore !== null) {
      return dbOverallScore;
    }
    return null;
  }

  // originality:result.originality.score(所有作品类型共享)
  if (dimension === 'originality') {
    const orig = r['originality'];
    if (orig && typeof orig === 'object') {
      const score = (orig as Record<string, unknown>)['score'];
      if (typeof score === 'number') {
        return score;
      }
    }
    return null;
  }

  // composition / color:位于 result.dimensions 内
  const dims = r['dimensions'];
  if (!dims || typeof dims !== 'object') {
    return null;
  }
  const d = dims as Record<string, unknown>;

  // composition:仅 painting 有 dimensions.composition
  if (dimension === 'composition') {
    const comp = d['composition'];
    if (comp && typeof comp === 'object') {
      const score = (comp as Record<string, unknown>)['score'];
      if (typeof score === 'number') {
        return score;
      }
    }
    return null;
  }

  // color:painting → dimensions.color;design → dimensions.colorApplication
  if (dimension === 'color') {
    const color = d['color'];
    if (color && typeof color === 'object') {
      const score = (color as Record<string, unknown>)['score'];
      if (typeof score === 'number') {
        return score;
      }
    }
    const colorApp = d['colorApplication'];
    if (colorApp && typeof colorApp === 'object') {
      const score = (colorApp as Record<string, unknown>)['score'];
      if (typeof score === 'number') {
        return score;
      }
    }
    return null;
  }

  return null;
}

/**
 * 计算汇总统计
 *
 * @param dataPoints 已按时间升序排列的数据点
 * @returns GrowthSummary;空数据返回全 0 + trend=stable
 */
function computeSummary(dataPoints: GrowthDataPoint[]): GrowthSummary {
  if (dataPoints.length === 0) {
    return {
      current: 0,
      average: 0,
      trend: 'stable',
      change: 0,
      totalAnalyses: 0,
    };
  }

  const scores = dataPoints.map((p) => p.score);
  // noUncheckedIndexedAccess: 需做非空校验(length > 0 已保证)
  const current = scores[scores.length - 1]!;
  const first = scores[0]!;
  const average = Math.round(scores.reduce((sum, s) => sum + s, 0) / scores.length);
  const change = current - first;

  let trend: GrowthTrend;
  if (change > 0) {
    trend = 'up';
  } else if (change < 0) {
    trend = 'down';
  } else {
    trend = 'stable';
  }

  return {
    current,
    average,
    trend,
    change,
    totalAnalyses: dataPoints.length,
  };
}

/**
 * 成长曲线服务输入参数
 */
export interface GetGrowthDataInput {
  tenantId: string;
  /** 当前用户 ID(JWT sub) */
  userId: string;
  /** 当前用户角色 */
  role: UserRole;
  dimension: GrowthDimension;
  timeRange: GrowthTimeRange;
  artType?: ArtType;
  /** TEACHER/ADMIN 查看指定学生(STUDENT 传此参数将被忽略) */
  targetUserId?: string;
}

class GrowthServiceClass {
  /**
   * 获取成长曲线数据
   *
   * 流程:
   *   1. 基于 role 计算 effectiveUserId(数据范围过滤)
   *   2. 基于 timeRange 计算起始日期
   *   3. 查询 Analysis 表(listForGrowth,仅 success 记录,按时间升序)
   *   4. 按 dimension 从 result JSON 提取分数,构建 dataPoints
   *   5. 计算 summary(当前/平均/趋势/变化/总数)
   */
  async getGrowthData(params: GetGrowthDataInput): Promise<GrowthResponse> {
    const { tenantId, userId, role, dimension, timeRange, artType, targetUserId } = params;

    // 1. 数据范围过滤(与 analysis.service.listAnalyses 一致)
    //    student:强制只看自己,忽略 targetUserId
    //    teacher/admin/owner:可传 targetUserId 查看指定学生;不传则聚合租户全量
    const canReadWide = canReadTenantWide(role);
    let effectiveUserId: string | undefined;
    if (!canReadWide) {
      effectiveUserId = userId;
    } else if (targetUserId) {
      effectiveUserId = targetUserId;
    } else {
      effectiveUserId = undefined;
    }

    // 2. 计算 timeRange 起始日期
    //    注意:不能使用 ?? 30 兜底,否则 'all'(映射为 null)会被替换成 30,
    //    导致 "all" 仅返回 30 天数据。此处直接读取映射值,null 即表示不限时间范围。
    const days = TIME_RANGE_DAYS[timeRange];
    const startDate = days !== null && days !== undefined
      ? new Date(Date.now() - days * 24 * 60 * 60 * 1000)
      : undefined;

    // 3. 查询 Analysis 表(强制 tenant_id 过滤)
    const analyses = await analysisRepository.listForGrowth({
      tenantId,
      userId: effectiveUserId,
      artType,
      startDate,
    });

    // 4. 按 dimension 提取分数,构建 dataPoints
    //    某条记录不存在该维度分数时跳过(不计入曲线)
    const dataPoints: GrowthDataPoint[] = [];
    for (const a of analyses) {
      const score = extractScore(a.result, dimension, a.overallScore);
      if (score === null) {
        continue;
      }
      dataPoints.push({
        date: a.createdAt.toISOString(),
        score,
        analysisId: a.id,
        artType: a.workType,
      });
    }

    // 5. 计算 summary
    const summary = computeSummary(dataPoints);

    logger.debug(
      {
        tenantId,
        userId: effectiveUserId ?? '(tenant-wide)',
        requestedBy: userId,
        role,
        dimension,
        timeRange,
        artType: artType ?? '(all)',
        dataPoints: dataPoints.length,
      },
      '[growth] query completed',
    );

    return {
      dimension,
      timeRange,
      dataPoints,
      summary,
    };
  }
}

export const growthService = new GrowthServiceClass();
