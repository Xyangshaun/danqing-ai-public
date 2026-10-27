// ============================================================
// AI 分析业务服务
// 对应 API:POST /analyses + POST /analyses/upload + GET /analyses + GET /analyses/:id + DELETE /analyses/:id
//
// 实现策略(3 秒 SLA):
//   - Jimp 像素分析通常 < 1 秒,走同步模式:直接返回 status=success + 完整 result
//   - Jimp 读取/分析失败时:返回 fallback 结果(仍为 success,保证接口可用)
//   - 配额耗尽:抛 6001 ANALYSIS_QUOTA_EXCEEDED
//   - 图片无效:抛 6005 ANALYSIS_IMAGE_INVALID
//
// 数据落库:
//   - 创建时 status=pending(短暂状态)
//   - 分析完成后 update 为 status=success,写入 result/overallScore/durationMs/completedAt
//   - 失败时 update 为 status=failed,写入 failureReason
//
// RBAC 数据范围过滤(对应 server/src/config/permissions.ts):
//   - listAnalyses:student 强制 WHERE user_id=自己;teacher/admin/owner 租户全量
//   - getAnalysis:student 越权访问他人记录 → 404(不泄露存在性)
//   - deleteAnalysis:teacher/student 仅删自己;admin/owner 删任意
// ============================================================

import { existsSync, promises as fs } from 'node:fs';
import { basename, join } from 'node:path';
import { analysisRepository } from '../repositories/analysis.repository.js';
import { tenantRepository } from '../repositories/tenant.repository.js';
import { BusinessError } from '../middlewares/error-handler.js';
import {
  ErrorCode,
  type CreateAnalysisRequest,
  type CreateAnalysisResponse,
  type AnalysisDetail,
  type ListAnalysesQuery,
  type ListAnalysesResponse,
  type ArtType,
  type AnalysisResult,
  type DeleteAnalysisResponse,
  type UserRole,
  type BatchDeleteAnalysesResponse,
  type BatchDeleteAnalysisItem,
  type ReportDataResponse,
  type RadarDataPoint,
  type HistoryComparison,
  type GrowthMiniPoint,
  type AskQuestionResponse,
  type HeritageCategory,
  type AIInvocationMeta,
} from '../types/api-contract.js';
import { canReadTenantWide, canDeleteTenantWide } from '../config/permissions.js';
import { runLocalAnalysis, runAIEnhance, predictFeedbackMode } from './ai-analysis.service.js';
import { rejudgeObjectiveChecks } from './analysis-engine.service.js';
import { isAIEnabled, askQuestionWithAI } from './ai-vision.service.js';
import { analysisCacheService } from './analysis-cache.service.js';
import { notificationService } from './notification.service.js';
import { gradingProfileService } from './grading-profile.service.js';
import {
  injectMarkerReferences,
  resolveKnowledgeCardCategory,
} from './knowledge-card-match.service.js';
import { GRADING_PROFILE_CATEGORIES, type GradingProfileCategory, type ResolvedGradingProfile } from '../types/grading-profile.js';
import { logger } from '../utils/logger.js';
import { sha256 } from '../utils/crypto.js';
import { env } from '../config/env.js';
import {
  aiUsageRepository,
  estimateCostYuan,
  resolveEffectiveProvider,
} from '../repositories/ai-usage.repository.js';
import type { Analysis, Tenant } from '@prisma/client';
import type { HybridAnalysisResult, EvaluationStage, IssueMarker } from '../types/ai-analysis.js';

/**
 * 订阅计划对应配额上限
 */
const PLAN_QUOTA: Record<Tenant['plan'], number> = {
  free: 50,
  standard: 2000,
  enterprise: -1, // 无限
};

/**
 * Phase 2 批次③:分析记录 → 评分档案类目映射
 *   - exam 模式:科目即类目(sketch/color/quickSketch 与档案类目 1:1)
 *   - teaching 模式:仅 design 作品类目直配;其余(painting/product/sculpture/heritage)
 *     暂无对应系统预设 → undefined(无档案=现状行为,prompt 不注入策略段,向后兼容)
 */
function resolveGradingProfileCategory(analysis: {
  diagnosisMode: string;
  examSubject: string | null;
  workType: string;
}): GradingProfileCategory | undefined {
  if (analysis.diagnosisMode === 'exam') {
    const subject = analysis.examSubject ?? 'sketch';
    return GRADING_PROFILE_CATEGORIES.includes(subject as GradingProfileCategory)
      ? (subject as GradingProfileCategory)
      : undefined;
  }
  return analysis.workType === 'design' ? 'design' : undefined;
}

/**
 * Phase 2 批次⑥:客观检测阈值并入档案——阶段 2 重判定注入。
 *
 * 档案含 objectiveChecks 覆盖时,对 storedResult.objectiveChecks.checks 按本校
 * 阈值重算判定结论(status/value/detail/suggestion,测量值不动)后以副本返回:
 *   ① prompt 的 OBJECTIVE_DATA 段随档案阈值走(教师改阈值 → AI 引用新判定)
 *   ② mergeResults 落库的 objectiveChecks 即重判定版(profileThresholdsApplied=true)
 *
 * 阶段 1 缓存与 DB 原始记录不碰(缓存只存引擎默认判定的原始测量,跨租户不串档);
 * AI 失败不落库,重判定无副作用;无档案/档案未覆盖 → 原样返回(现状行为)。
 */
export function applyProfileObjectiveThresholds(
  storedResult: HybridAnalysisResult,
  gradingProfile: ResolvedGradingProfile | undefined,
): HybridAnalysisResult {
  const thresholds = gradingProfile?.config.objectiveChecks;
  if (!thresholds || !storedResult.objectiveChecks) return storedResult;
  return {
    ...storedResult,
    objectiveChecks: rejudgeObjectiveChecks(storedResult.objectiveChecks, thresholds),
  };
}

// ============================================================
// Phase 4 批次①:marker 稳定 ID 注入(反馈/教师批注的锚定前提)
// ============================================================

/**
 * 为单条 marker 补确定性稳定 ID(已有 id 原样返回,幂等)
 *
 * ID = mk_ + sha256(label|归一化坐标|type) 前 12 位:
 *   - 同内容同 ID → 跨分析聚合统计(某类问题的高频反馈)天然可行
 *   - 坐标 toFixed(4) 归一化,防浮点尾差(0.30000001 vs 0.3)产生分裂 ID
 *   - 唯一性由 markerIndex 兜底保证(ID 冲突的极端情况不影响反馈表唯一约束语义)
 */
function ensureMarkerId(m: IssueMarker): IssueMarker {
  if (m.id) return m;
  const fingerprint = [
    m.label,
    m.x.toFixed(4),
    m.y.toFixed(4),
    m.w.toFixed(4),
    m.h.toFixed(4),
    m.type ?? '',
  ].join('|');
  return { ...m, id: `mk_${sha256(fingerprint).slice(0, 12)}` };
}

/**
 * 输入参数:创建分析任务
 * - imageUrl:用户提供的外部图片 URL(与 localImagePath 二选一)
 * - localImagePath:multer 上传到本地的临时文件绝对路径(分析后自动清理)
 * - title / remark:可选元数据
 */
export interface CreateAnalysisInput {
  tenantId: string;
  userId: string;
  body: CreateAnalysisRequest;
  /** 本地上传文件绝对路径(multer 提供);与 body.imageUrl 二选一 */
  localImagePath?: string;
  /** 原始文件名(用于日志审计,可选) */
  originalFileName?: string;
}

class AnalysisServiceClass {
  /**
   * 提交分析任务(URL 模式)
   * 流程:校验配额 → 写 DB(pending) → 调用 Jimp 分析 → 更新 DB(success) → 返回完整结果
   */
  async createAnalysis(params: {
    tenantId: string;
    userId: string;
    body: CreateAnalysisRequest;
  }): Promise<CreateAnalysisResponse> {
    return this.runAnalysis(params);
  }

  /**
   * 提交分析任务(文件上传模式)
   * 流程与 createAnalysis 一致,文件存储策略由 UPLOAD_DIR 配置决定:
   *   - 绝对路径(如 /lhcos-data/uploads,COS挂载):文件持久化保留,URL为 /uploads/xxx
   *   - 相对路径(如 uploads,本地目录):分析完成后自动清理临时文件
   */
  async createAnalysisFromUpload(params: {
    tenantId: string;
    userId: string;
    artType: ArtType;
    localImagePath: string;
    originalFileName?: string;
    title?: string;
    remark?: string;
    /** 诊断模式(2026-08-16 诊断理念重构;缺省 teaching) */
    diagnosisMode?: 'teaching' | 'exam';
    /** 艺考科目(仅 exam 模式) */
    examSubject?: 'sketch' | 'color' | 'quickSketch';
    /** 评价阶段(评分参照系档位;阶段 C Task 9 透传) */
    evaluationStage?: import('../types/ai-analysis.js').EvaluationStage;
    /** 非遗类目(仅 artType='heritage';阶段 C Task 9 透传) */
    heritageCategory?: import('../types/api-contract.js').HeritageCategory;
  }): Promise<CreateAnalysisResponse> {
    const { tenantId, userId, artType, localImagePath, originalFileName, title, remark, diagnosisMode, examSubject, evaluationStage, heritageCategory } = params;
    // 生成可通过 Nginx 访问的 URL 路径(/uploads/文件名),持久化保存到 DB
    const publicUrl = `/uploads/${basename(localImagePath)}`;
    return this.runAnalysis({
      tenantId,
      userId,
      body: {
        artType,
        // 上传到COS挂载目录的文件持久化存储,使用公开访问URL
        imageUrl: publicUrl,
        title,
        remark,
        diagnosisMode,
        examSubject,
        // 深度分析字段透传(阶段 C Task 9)
        evaluationStage,
        heritageCategory,
      },
      localImagePath,
      originalFileName,
    });
  }

  /**
   * 查询分析历史(分页)
   * 数据范围过滤(基于 RBAC 权限矩阵):
   *   - student:强制 WHERE user_id = ?(只能看自己的,忽略 query.userId 越权)
   *   - teacher / admin / owner:租户内全量可见(canReadTenantWide=true),
   *     可通过 query.userId 按用户筛选
   *
   * 安全策略:
   *   - tenantId 强制从 JWT 注入(防跨租户)
   *   - 越权 query.userId(student 试图查询他人)被 service 层强制覆盖
   */
  async listAnalyses(params: {
    tenantId: string;
    userId: string;
    role: UserRole;
    query: ListAnalysesQuery;
  }): Promise<ListAnalysesResponse> {
    const { tenantId, userId, role, query } = params;
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 20, 100);

    // 数据范围过滤:非"租户全量可见"角色强制只能看自己
    // canReadTenantWide(role) === true → teacher/admin/owner
    // canReadTenantWide(role) === false → student,强制 userId=自己,忽略 query.userId
    const effectiveUserId = canReadTenantWide(role) ? query.userId : userId;

    const result = await analysisRepository.list({
      tenantId,
      userId: effectiveUserId,
      artType: query.artType as ArtType | undefined,
      status: query.status as Analysis['status'] | undefined,
      startDate: query.startDate ? new Date(query.startDate) : undefined,
      endDate: query.endDate ? new Date(query.endDate) : undefined,
      page,
      pageSize,
    });

    const items = result.items.map((a) => {
      // 从持久化的 result JSON 提取 aiEnhanced(阶段 C Task 8.3:列表徽章所需最小字段)
      const storedResult = a.result as
        | (AnalysisDetail['result'] & { aiEnhanced?: boolean })
        | null;
      return {
        id: a.id,
        workType: a.workType as ArtType,
        imageUrl: a.imageUrl,
        title: a.title,
        status: a.status as ListAnalysesResponse['items'][number]['status'],
        overallScore: a.overallScore,
        createdAt: a.createdAt.toISOString(),
        // 深度分析徽章字段(阶段 C Task 8.3):aiEnhanced 从 result 提取,evaluationStage 从列读取
        aiEnhanced: storedResult?.aiEnhanced,
        evaluationStage: a.evaluationStage as
          | ListAnalysesResponse['items'][number]['evaluationStage']
          | undefined,
      };
    });

    return {
      items,
      total: result.total,
      page,
      pageSize,
      hasMore: page * pageSize < result.total,
    };
  }

  /**
   * 查询单条分析详情
   * 数据范围过滤(基于 RBAC 权限矩阵):
   *   - 跨租户访问 → 404(由 repository findFirst 过滤实现,不泄露存在性)
   *   - student 查询他人记录 → 404(强制 ownership 校验,不泄露存在性)
   *   - teacher / admin / owner 可查询租户内任意记录
   *
   * 安全策略:
   *   - 不返回 403 FORBIDDEN 以免泄露资源存在性
   *   - 越权访问统一返回 404 ANALYSIS_NOT_FOUND
   */
  async getAnalysis(params: {
    tenantId: string;
    analysisId: string;
    userId: string;
    role: UserRole;
  }): Promise<AnalysisDetail> {
    const { tenantId, analysisId, userId, role } = params;
    const analysis = await analysisRepository.findById(tenantId, analysisId);
    if (!analysis) {
      throw new BusinessError(ErrorCode.ANALYSIS_NOT_FOUND, '分析记录不存在', 404);
    }

    // 数据范围过滤:非"租户全量可见"角色仅可查看自己创建的记录
    // canReadTenantWide(role) === false → student,必须 ownership
    if (!canReadTenantWide(role) && analysis.userId !== userId) {
      // 出于安全,不暴露 403(避免泄露存在性),统一返回 404
      throw new BusinessError(ErrorCode.ANALYSIS_NOT_FOUND, '分析记录不存在', 404);
    }

    // 复用 buildAnalysisDetailFromRecord 统一构造 AnalysisDetail(含深度分析字段)
    // 阶段 C Task 8.2:getAnalysis 必须完整返回 evaluationStage/heritageCategory/
    // scoreCriteria/issueMarkers/aiVisionResult,前端详情页与历史差异化依赖这些字段。
    // 修复:原先手动构造遗漏了深度字段,导致 GET /analyses/:id 缺失深度分析结果。
    return this.buildAnalysisDetailFromRecord(analysis);
  }

  /**
   * 报告数据聚合(报告导出+分析报告增强特性)
   * 对应 API:GET /analyses/:id/report-data
   *
   * 返回报告渲染所需的聚合数据:
   *   1. analysis:当前分析详情(复用 getAnalysis 结构)
   *   2. radarData:维度雷达图数据(从 result.dimensions 遍历提取 score 字段)
   *   3. historyComparison:本人同类型历史对比(上一次得分/平均分/趋势)
   *   4. growthMini:近 5 次同类型成长趋势(时间升序)
   *   5. classPercentile:班级百分位(仅 canReadTenantWide 角色请求时计算)
   *
   * 权限与数据范围:与 getAnalysis 一致(student 越权 → 404)
   */
  async getReportData(params: {
    tenantId: string;
    analysisId: string;
    userId: string;
    role: UserRole;
  }): Promise<ReportDataResponse> {
    const { tenantId, analysisId, userId, role } = params;

    // 1. 复用 getAnalysis 的查询 + 数据范围过滤(越权 → 404)
    const analysis = await this.getAnalysis({ tenantId, analysisId, userId, role });

    // 2. 雷达图数据:遍历 dimensions 提取所有 { score } 维度
    const radarData = this.extractRadarData(analysis.result);

    // 3. 历史对比 + 成长趋势:查作者本人同类型全部成功记录(时间升序)
    const history = await analysisRepository.listForGrowth({
      tenantId,
      userId: analysis.userId,
      artType: analysis.workType,
    });
    const historyComparison = this.buildHistoryComparison(history, analysisId, analysis.result?.overallScore);
    const growthMini = this.buildGrowthMini(history, analysisId);

    // 4. 班级百分位:仅租户全量可见角色(teacher/admin/owner)请求时计算
    //    定义:租户内同类型成功作品中,得分低于当前作品的比例 × 100
    let classPercentile: number | null = null;
    const currentScore = analysis.result?.overallScore;
    if (canReadTenantWide(role) && typeof currentScore === 'number') {
      const tenantWorks = await analysisRepository.listForGrowth({
        tenantId,
        artType: analysis.workType,
      });
      const scores = tenantWorks
        .map((w) => w.overallScore)
        .filter((s): s is number => typeof s === 'number');
      if (scores.length > 0) {
        const below = scores.filter((s) => s < currentScore).length;
        classPercentile = Math.round((below / scores.length) * 100);
      }
    }

    return {
      analysis,
      radarData,
      historyComparison,
      growthMini,
      classPercentile,
    };
  }

  /** 维度键 → 中文标签映射(雷达图渲染用,覆盖四类艺术作品全部维度) */
  private static readonly DIMENSION_LABELS: Readonly<Record<string, string>> = Object.freeze({
    // painting
    composition: '构图',
    color: '色彩',
    brushwork: '笔触',
    // design
    visualHierarchy: '视觉层级',
    typography: '排版',
    colorApplication: '色彩应用',
    // product
    form: '形态',
    materialExpression: '材质表达',
    functionExpression: '功能表达',
    // sculpture
    spatialComposition: '空间构成',
    bodyLanguage: '形体语言',
    materialLanguage: '材料语言',
  });

  /**
   * 从 AnalysisResult.dimensions 提取雷达图数据
   * 策略:遍历 dimensions 对象(跳过 type 字段),提取所有含 number 型 score 的子维度
   */
  private extractRadarData(result: AnalysisDetail['result']): RadarDataPoint[] {
    if (!result || !result.dimensions) return [];
    const points: RadarDataPoint[] = [];
    for (const [key, value] of Object.entries(result.dimensions)) {
      if (key === 'type') continue;
      if (
        value !== null &&
        typeof value === 'object' &&
        'score' in value &&
        typeof (value as { score: unknown }).score === 'number'
      ) {
        points.push({
          dimension: key,
          label: AnalysisServiceClass.DIMENSION_LABELS[key] ?? key,
          score: (value as { score: number }).score,
          fullMark: 100,
        });
      }
    }
    return points;
  }

  /**
   * 构建历史对比(排除当前记录;基于时间升序列表)
   * trend 判定:与上一次得分差值 >2 为 up,<-2 为 down,其余 flat
   */
  private buildHistoryComparison(
    history: Analysis[],
    currentAnalysisId: string,
    currentScore: number | null | undefined,
  ): HistoryComparison {
    const others = history.filter(
      (h) => h.id !== currentAnalysisId && typeof h.overallScore === 'number',
    );
    if (others.length === 0) {
      return { previous: null, average: null, trend: null };
    }
    const last = others[others.length - 1]!;
    const average =
      Math.round((others.reduce((sum, h) => sum + (h.overallScore ?? 0), 0) / others.length) * 10) / 10;
    let trend: HistoryComparison['trend'] = null;
    if (typeof currentScore === 'number') {
      const diff = currentScore - (last.overallScore ?? 0);
      trend = diff > 2 ? 'up' : diff < -2 ? 'down' : 'flat';
    }
    return {
      previous: {
        score: last.overallScore ?? 0,
        date: last.createdAt.toISOString(),
      },
      average,
      trend,
    };
  }

  /**
   * 构建成长趋势迷你图数据(近 5 次同类型,时间升序,含当前记录)
   */
  private buildGrowthMini(history: Analysis[], currentAnalysisId: string): GrowthMiniPoint[] {
    const valid = history.filter((h) => typeof h.overallScore === 'number');
    // 截取截至当前记录的最近 5 条(若当前记录不在列表中则取末尾 5 条)
    const currentIdx = valid.findIndex((h) => h.id === currentAnalysisId);
    const end = currentIdx >= 0 ? currentIdx + 1 : valid.length;
    const slice = valid.slice(Math.max(0, end - 5), end);
    return slice.map((h) => ({
      date: h.createdAt.toISOString(),
      score: h.overallScore ?? 0,
    }));
  }

  /**
   * 阶段 2:AI 增强分析(方案 A)
   * 用户主动触发(POST /analyses/:id/ai-enhance),对已存的本地分析结果追加 AI 语义增强。
   *
   * 流程:
   *   1. 查询分析记录(tenantId 强制过滤,跨租户返回 null → 404)
   *   2. RBAC:非 canReadTenantWide 角色(student/teacher)仅可操作自己的记录
   *   3. 校验记录可增强:status=success 且 result 非空
   *   4. 幂等:若 result.aiEnhanced === true,直接返回当前结果(不重复调 AI、不重复计费)
   *   5. 校验 AI 配置:未启用 → 抛 ANALYSIS_RESULT_FAILED
   *   6. 解析图片源(外部 URL 直接用;/uploads/xxx 解析回 uploadDir 本地路径,文件缺失则报错)
   *   7. 调 runAIEnhance(读 storedResult → 提取指标 → 调 AI → 合并)
   *   8. AI 失败(merged.aiEnhanced === false)→ 按 failureReason 映射状态码与文案抛 BusinessError(不覆盖已存的本地结果)
   *      - AI_TIMEOUT → 408/ANALYSIS_TIMEOUT
   *      - AI_PARSE_ERROR/AI_SCHEMA_ERROR/AI_HTTP_ERROR/AI_NETWORK_ERROR → 502/ANALYSIS_RESULT_FAILED
   *      - AI_KEY_MISSING/AI_DISABLED → 503/ANALYSIS_RESULT_FAILED
   *      - 其他 → 500/ANALYSIS_RESULT_FAILED
   *   9. AI 成功 → updateResult 覆盖写回 DB(result JSON 含 AI 字段,overallScore/durationMs 更新)
   *   10. 异步记录 AI 用量日志(从原 runAnalysis 搬移,作品所有者计费)
   *   11. 返回 AnalysisDetail(含新的 aiEnhanced/aiDurationMs,保留原 jimpDurationMs)
   *
   * 权限:复用 analysis:read:own / analysis:read:tenant(路由层)
   *   - student/teacher 仅可增强自己的记录
   *   - admin/owner 可增强租户内任意记录
   *
   * 幂等:已 aiEnhanced=true 的记录再次调用,直接返回当前结果,不重复计费
   */
  async aiEnhanceAnalysis(params: {
    tenantId: string;
    analysisId: string;
    userId: string;
    role: UserRole;
  }): Promise<AnalysisDetail> {
    const { tenantId, analysisId, userId, role } = params;

    // 1. 查询记录(tenantId 过滤)
    const analysis = await analysisRepository.findById(tenantId, analysisId);
    if (!analysis) {
      throw new BusinessError(ErrorCode.ANALYSIS_NOT_FOUND, '分析记录不存在', 404);
    }

    // 2. RBAC:非"租户全量可见"角色仅可操作自己创建的记录
    if (!canReadTenantWide(role) && analysis.userId !== userId) {
      // 出于安全,不暴露 403,统一返回 404
      throw new BusinessError(ErrorCode.ANALYSIS_NOT_FOUND, '分析记录不存在', 404);
    }

    // 3. 校验记录可增强:status=success 且 result 非空
    if (analysis.status !== 'success') {
      throw new BusinessError(
        ErrorCode.ANALYSIS_RESULT_FAILED,
        `仅成功状态的分析可进行 AI 增强(当前状态:${analysis.status})`,
        409,
      );
    }
    const storedResult = analysis.result as HybridAnalysisResult | null;
    if (!storedResult) {
      throw new BusinessError(
        ErrorCode.ANALYSIS_RESULT_FAILED,
        '分析结果为空,无法进行 AI 增强',
        409,
      );
    }

    // 4. 幂等:已 AI 增强 → 直接返回当前结果
    if (storedResult.aiEnhanced === true) {
      logger.debug(
        { analysisId, tenantId, userId },
        '[analysis] aiEnhance: already AI-enhanced, returning current result',
      );
      return this.buildAnalysisDetailFromRecord(analysis);
    }

    // 5. 校验 AI 配置
    if (!isAIEnabled()) {
      throw new BusinessError(
        ErrorCode.ANALYSIS_RESULT_FAILED,
        'AI 未启用,无法进行 AI 增强',
        503,
      );
    }

    // 6. 解析图片源:外部 URL 直接用;/uploads/xxx 解析回 uploadDir 本地路径
    const imageSource = this.resolveImageSourceForEnhance(analysis.imageUrl);
    if (!imageSource) {
      throw new BusinessError(
        ErrorCode.ANALYSIS_IMAGE_INVALID,
        '原始图片文件已清理,无法进行 AI 增强(请重新上传)',
        410,
      );
    }

    // 7. 调用阶段 2:runAIEnhance(外层第二层 Promise.race 做总时限兜底,防止内层漏网)
    const cfg2 = env();
    const enhanceStartMs = Date.now();
    const overallDeadlineMs = (cfg2.aiEnhanceTimeout ?? 15000) + 1500;
    const jimpDurationMs = analysis.durationMs ?? 0;

    // 6.5 Phase 2 批次③:解析生效评分档案 + 学生近期 AI 综合分(反馈模式预判输入)
    //     档案缺失/类目无预设 → undefined = 现状行为(prompt 不注入策略段,综合分等权兜底)
    const gradingCategory = resolveGradingProfileCategory(analysis);
    let gradingProfile: ResolvedGradingProfile | undefined;
    let recentOverallAvg: number | undefined;
    if (gradingCategory) {
      gradingProfile = await gradingProfileService.resolveEffectiveProfile(
        tenantId,
        gradingCategory,
      );
      if (gradingProfile) {
        const recentScores = await analysisRepository.findRecentEnhancedScores(
          tenantId,
          analysis.userId,
          analysis.workType as ArtType,
        );
        recentOverallAvg =
          recentScores.length > 0
            ? recentScores.reduce((s, v) => s + v, 0) / recentScores.length
            : undefined;
      }
    }

    // 6.6 Phase 2 批次⑥:档案 objectiveChecks 阈值重判定(测量值不动,仅重算判定结论)
    //     以副本传入 runAIEnhance:prompt OBJECTIVE_DATA 段与落库 objectiveChecks
    //     均随本校档案阈值走;阶段 1 缓存与 DB 原始记录不碰(见函数头注释)
    const effectiveStoredResult = applyProfileObjectiveThresholds(storedResult, gradingProfile);

    let merged: HybridAnalysisResult;
    try {
      merged = await Promise.race([
        runAIEnhance({
          analysisId,
          imageSource,
          artType: analysis.workType as ArtType,
          title: analysis.title ?? undefined,
          remark: analysis.remark ?? undefined,
          // Phase 2 批次⑥:档案阈值重判定版(prompt 联动 + 落库覆盖,见 6.6 注释)
          storedResult: effectiveStoredResult,
          jimpDurationMs,
          diagnosisMode: analysis.diagnosisMode as 'teaching' | 'exam',
          examSubject: (analysis.examSubject ?? undefined) as
            | 'sketch'
            | 'color'
            | 'quickSketch'
            | undefined,
          evaluationStage: (analysis.evaluationStage ?? undefined) as EvaluationStage | undefined,
          heritageCategory: (analysis.heritageCategory ?? undefined) as HeritageCategory | undefined,
          gradingProfile,
          recentOverallAvg,
        }),
        new Promise<HybridAnalysisResult>((_, reject) => {
          setTimeout(() => {
            const elapsed = Date.now() - enhanceStartMs;
            reject(
              new BusinessError(
                ErrorCode.ANALYSIS_TIMEOUT,
                `AI 增强总耗时超过上限(${overallDeadlineMs}ms),已中断`,
                408,
                {
                  aiMeta: {
                    aiSuccess: false,
                    aiDurationMs: elapsed,
                    aiFailureReason: 'AI_TIMEOUT',
                    aiModel: cfg2.aiApiModel,
                    aiInvokedAt: new Date().toISOString(),
                    // 外层超时:此时 runAIEnhance 被中断,stageTimings 尚未产生,置空避免 unknown 类型
                    stageTimings: {} as NonNullable<import('../types/api-contract.js').AIInvocationMeta['stageTimings']>,
                    debugHint: `外层硬兜底触发:runAIEnhance 总耗时 ${elapsed}ms 超过 ${overallDeadlineMs}ms。建议调大 AI_ENHANCE_TIMEOUT 或联系管理员。`,
                  } satisfies Partial<import('../types/api-contract.js').AIInvocationMeta> & {
                    aiSuccess: boolean;
                    aiDurationMs: number;
                  },
                  aiEffectiveTimeoutMs: cfg2.aiEnhanceTimeout ?? 15000,
                },
              ),
            );
          }, overallDeadlineMs).unref?.();
        }),
      ]);
    } catch (err) {
      // runAIEnhance 内部已捕获 AI 异常并返回 fallback,但外层 reject 会抛 BusinessError
      if (err instanceof BusinessError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(
        { err: msg, analysisId, tenantId, userId },
        '[analysis] aiEnhance: runAIEnhance threw unexpectedly',
      );
      throw new BusinessError(
        ErrorCode.ANALYSIS_RESULT_FAILED,
        `AI 增强失败:${msg}`,
        500,
      );
    }
    const aiDurationMs = merged.aiMeta.aiDurationMs;

    // 8. AI 失败 → 抛 BusinessError(不覆盖已存的本地结果;按 failureReason 映射状态码与文案)
    //    本地阶段 1 结果已在 DB 保留,前端收到错误后不覆盖展示,用户可依据文案重试。
    //    状态码语义:
    //      AI_TIMEOUT → 408(请求超时,可重试)
    //      AI_PARSE_ERROR / AI_SCHEMA_ERROR → 502(上游 AI 返回内容异常,可重试)
    //      AI_HTTP_ERROR / AI_NETWORK_ERROR → 502(上游 AI 网络/HTTP 异常,可重试)
    //      AI_KEY_MISSING / AI_DISABLED → 503(AI 未配置,非用户可重试)
    //      其他/未知 → 500(兜底)
    if (!merged.aiEnhanced) {
      const cfg2 = env();
      const failureReason = merged.aiMeta.aiFailureReason;
      const effectiveTimeoutMs = cfg2.aiEnhanceTimeout ?? 15000;
      // P0 深度诊断黑盒修复:按失败原因生成人类可读 debugHint(超时配置、重试建议)
      let debugHint = merged.aiMeta.debugHint ?? '';
      if (failureReason === 'AI_TIMEOUT') {
        debugHint = `当前 AI 深度分析超时配置为 ${effectiveTimeoutMs}ms,实际耗时 ${merged.aiMeta.aiDurationMs}ms。建议:1)稍后重试(非高峰时段模型响应更快);2)联系管理员调大 AI_TIMEOUT 环境变量;3)确认 GLM-4V 服务端是否限流。`;
      } else if (failureReason === 'AI_HTTP_ERROR' || failureReason === 'AI_NETWORK_ERROR') {
        debugHint = `AI 服务调用异常(耗时 ${merged.aiMeta.aiDurationMs}ms)。建议:1)稍后重试;2)检查服务器外网连通性(443 端口);3)联系管理员查看 AI_API_KEY / AI_API_ENDPOINT 配置。`;
      } else if (failureReason === 'AI_PARSE_ERROR' || failureReason === 'AI_SCHEMA_ERROR') {
        debugHint = `AI 返回内容无法解析为预期 JSON Schema(耗时 ${merged.aiMeta.aiDurationMs}ms)。通常由模型输出不稳定导致,建议立即重试 1-2 次。`;
      } else if (failureReason === 'AI_KEY_MISSING' || failureReason === 'AI_DISABLED') {
        debugHint = 'AI 服务未启用或 API Key 未配置。请联系管理员在 .env 中设置 AI_ENABLED=true 并填写 AI_API_KEY。';
      } else {
        debugHint = `AI 调用失败(原因=${failureReason ?? 'UNKNOWN'},耗时 ${merged.aiMeta.aiDurationMs}ms)。请稍后重试或联系管理员排查日志(traceId 见响应)。`;
      }
      // 补齐 merged.aiMeta 的 debugHint / effectiveTimeout,确保前端折叠面板有完整信息
      const aiMetaForClient = {
        ...merged.aiMeta,
        debugHint,
      };
      logger.warn(
        {
          analysisId,
          tenantId,
          userId,
          aiFailureReason: failureReason,
          aiDurationMs,
          aiEffectiveTimeoutMs: effectiveTimeoutMs,
          debugHint,
          stageTimings: aiMetaForClient.stageTimings,
        },
        '[analysis] aiEnhance: AI call failed, aborting (local result preserved)',
      );
      let code = ErrorCode.ANALYSIS_RESULT_FAILED;
      let status = 500;
      let message = 'AI 增强失败,请稍后重试';
      switch (failureReason) {
        case 'AI_TIMEOUT':
          code = ErrorCode.ANALYSIS_TIMEOUT;
          status = 408;
          message = 'AI 增强超时,请稍后重试';
          break;
        case 'AI_PARSE_ERROR':
        case 'AI_SCHEMA_ERROR':
          status = 502;
          message = 'AI 模型返回内容异常,请稍后重试';
          break;
        case 'AI_HTTP_ERROR':
          status = 502;
          message = 'AI 服务响应异常,请稍后重试';
          break;
        case 'AI_NETWORK_ERROR':
          status = 502;
          message = 'AI 服务网络异常,请稍后重试';
          break;
        case 'AI_KEY_MISSING':
        case 'AI_DISABLED':
          status = 503;
          message = 'AI 服务未配置,请联系管理员';
          break;
      }
      // P0 错误透传:把 aiMeta + effectiveTimeout 打包进 BusinessError.data,
      // 由 error-handler → error(res, ..., data) 透传到前端响应 data 字段。
      throw new BusinessError(code, message, status, {
        aiMeta: aiMetaForClient,
        aiEffectiveTimeoutMs: effectiveTimeoutMs,
      });
    }

    // 8.5 Phase 3 批次③:标注参考注入(第④层"参考")
    //     AI 增强完成后、落库前,按 problemPattern 匹配知识点卡片/关联作品,
    //     将 reference 注入 issueMarkers(本地检索 <100ms 不破 SLA;AI 不感知
    //     卡片库避免幻觉 ID;匹配失败静默跳过=现状行为,宁缺勿滥)
    //     批次④:feedbackMode 提前计算并持久化进 result(前端跨域启发区块渲染条件)
    const feedbackMode = predictFeedbackMode(gradingProfile, recentOverallAvg);
    merged = { ...merged, feedbackMode };
    if (merged.issueMarkers && merged.issueMarkers.length > 0) {
      const cardCategory = resolveKnowledgeCardCategory(analysis);
      if (cardCategory) {
        merged = {
          ...merged,
          issueMarkers: await injectMarkerReferences(merged.issueMarkers, {
            category: cardCategory,
            feedbackMode,
          }),
        };
      }
    }

    // 8.6 Phase 4 批次①:marker 稳定 ID 注入(反馈/教师批注的锚定前提)
    //     落库前逐条补确定性短 hash(label+坐标+type,同内容同 ID 可跨分析去重统计);
    //     已有 id 不覆盖(幂等);AI 增强幂等已保证落库后 result 不变 → ID 稳定。
    //     旧数据(本次改造前)无 ID:消费侧(MarkerFeedback/TeacherAnnotation)按
    //     markerIndex + markerSnapshot 快照兜底
    if (merged.issueMarkers && merged.issueMarkers.length > 0) {
      merged = {
        ...merged,
        issueMarkers: merged.issueMarkers.map(ensureMarkerId),
      };
    }

    // 9. AI 成功 → 覆盖写回 DB(result JSON 含 AI 字段,overallScore/durationMs 更新)
    const tPersist = performance.now();
    try {
      await analysisRepository.updateResult(tenantId, analysisId, {
        status: 'success',
        result: merged as unknown as Analysis['result'],
        overallScore: merged.overallScore,
        // durationMs = 阶段 1 Jimp + 阶段 2 AI(保留历史 + 记录 AI 增强耗时)
        durationMs: jimpDurationMs + aiDurationMs,
        // completedAt 保留原值(阶段 1 完成时间);兜底 new Date() 防御 null
        completedAt: analysis.completedAt ?? new Date(),
        failureReason: null,
        // 深度分析字段(阶段 C Task 8.1):冗余自 merged 顶层,供列表徽章渲染与详情直读
        // evaluationStage:AI 回显的实际参照系(优先于创建时用户选择)
        evaluationStage: merged.evaluationStage ?? null,
        scoreCriteria: merged.scoreCriteria ?? null,
        issueMarkers: merged.issueMarkers ?? null,
        // 批次④:档位估算冗余写列(供列表/徽章直读;未产出写 null 清列防幂等重放残留)
        tierEstimate: merged.tierEstimate ?? null,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(
        { err: msg, analysisId, tenantId },
        '[analysis] aiEnhance: failed to persist enhanced result',
      );
      // 不抛错:结果已计算并返回前端;DB 状态留旧值,前端可重试
    }
    // P0 黑盒修复:补上 persist 阶段计时,写入 aiMeta(前面 merge 时还没到这步)
    if (merged.aiMeta) {
      const persistMs = Math.round(performance.now() - tPersist);
      (merged.aiMeta as AIInvocationMeta & { stageTimings?: Partial<Record<string, number>> })
        .stageTimings = {
        ...((merged.aiMeta as { stageTimings?: Partial<Record<string, number>> }).stageTimings ??
          {}),
        persist: persistMs,
      };
    }

    // 10. 异步记录 AI 用量日志(从原 runAnalysis 搬移)
    // 用作品所有者 ID 计费(即使 admin 代为增强,也归属作品所有者)
    this.recordAIUsage(analysis, merged).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(
        { err: msg, analysisId },
        '[analysis] aiEnhance: record AI usage log failed (non-blocking)',
      );
    });

    logger.info(
      {
        analysisId,
        tenantId,
        userId,
        operatorRole: role,
        aiEnhanced: merged.aiEnhanced,
        jimpDurationMs,
        aiDurationMs,
        totalDurationMs: Date.now() - enhanceStartMs,
      },
      '[analysis] aiEnhance: completed (synchronous)',
    );

    // 11. 返回 AnalysisDetail
    return {
      id: analysis.id,
      tenantId: analysis.tenantId,
      userId: analysis.userId,
      workType: analysis.workType as ArtType,
      imageUrl: analysis.imageUrl,
      title: analysis.title,
      remark: analysis.remark,
      status: 'success',
      result: merged as unknown as AnalysisDetail['result'],
      failureReason: null,
      durationMs: jimpDurationMs + aiDurationMs,
      createdAt: analysis.createdAt.toISOString(),
      completedAt: analysis.completedAt?.toISOString() ?? new Date().toISOString(),
      aiEnhanced: merged.aiEnhanced,
      aiDurationMs,
      jimpDurationMs,
      // 深度分析字段(阶段 C Task 8.2):从 merged 顶层透传 + DB 列回填
      evaluationStage: merged.evaluationStage ?? null,
      heritageCategory: analysis.heritageCategory as HeritageCategory | null,
      scoreCriteria: merged.scoreCriteria,
      issueMarkers: merged.issueMarkers,
      // 批次④:档位估算(AI 自主估算或档案换算;null=未产出,前端不渲染徽章)
      tierEstimate: merged.tierEstimate ?? null,
      aiVisionResult: merged.aiVisionResult,
      // ---- P0 深度诊断黑盒修复:AI 元信息顶层透传(成功路径) ----
      aiMeta: merged.aiMeta,
      aiEffectiveTimeoutMs: cfg2.aiEnhanceTimeout ?? 15000,
    };
  }

  /**
   * 阶段 3:问题分析(2026-08-16 新增)
   * AI 深度分析完成后,用户就诊断结果提问,AI 围绕问题做定向解答。
   *
   * 流程:
   *   1. 查询记录(tenantId 过滤)+ RBAC 数据范围(同 aiEnhanceAnalysis)
   *   2. 前置校验:status=success 且 result.aiEnhanced === true(问题分析以深度分析为前提)
   *   3. 校验 AI 配置 + 图片源可用
   *   4. 从已存结果构建诊断摘要(评分/AI 画面解析/建议标题)注入 prompt
   *   5. 调 askQuestionWithAI(图片 + 摘要 + 问题 → 定向解答)
   *   6. 失败按 failureReason 映射状态码抛 BusinessError(同 aiEnhanceAnalysis)
   *   7. 返回 AskQuestionResponse(即时返回,不落库——问答为延伸交互,不改变已存诊断)
   *
   * 权限:复用 analysis:read:own / analysis:read:tenant(路由层)
   */
  async askQuestionAnalysis(params: {
    tenantId: string;
    analysisId: string;
    userId: string;
    role: UserRole;
    question: string;
  }): Promise<AskQuestionResponse> {
    const { tenantId, analysisId, userId, role, question } = params;

    // 1. 查询记录 + RBAC(同 aiEnhanceAnalysis:越权统一 404,不泄露存在性)
    const analysis = await analysisRepository.findById(tenantId, analysisId);
    if (!analysis) {
      throw new BusinessError(ErrorCode.ANALYSIS_NOT_FOUND, '分析记录不存在', 404);
    }
    if (!canReadTenantWide(role) && analysis.userId !== userId) {
      throw new BusinessError(ErrorCode.ANALYSIS_NOT_FOUND, '分析记录不存在', 404);
    }

    // 2. 前置校验:仅成功状态可提问
    if (analysis.status !== 'success') {
      throw new BusinessError(
        ErrorCode.ANALYSIS_RESULT_FAILED,
        `仅成功状态的分析可进行问题分析(当前状态:${analysis.status})`,
        409,
      );
    }
    const storedResult = analysis.result as HybridAnalysisResult | null;
    if (!storedResult) {
      throw new BusinessError(ErrorCode.ANALYSIS_RESULT_FAILED, '分析结果为空,无法进行问题分析', 409);
    }
    // 问题分析以 AI 深度分析为前提(摘要依赖 aiVisionResult;未增强先引导完成阶段 2)
    if (storedResult.aiEnhanced !== true) {
      throw new BusinessError(
        ErrorCode.ANALYSIS_RESULT_FAILED,
        '请先完成 AI 深度分析,再针对诊断结果提问',
        409,
      );
    }

    // 3. AI 配置 + 图片源
    if (!isAIEnabled()) {
      throw new BusinessError(ErrorCode.ANALYSIS_RESULT_FAILED, 'AI 未启用,无法进行问题分析', 503);
    }
    const imageSource = this.resolveImageSourceForEnhance(analysis.imageUrl);
    if (!imageSource) {
      throw new BusinessError(
        ErrorCode.ANALYSIS_IMAGE_INVALID,
        '原始图片文件已清理,无法进行问题分析(请重新上传)',
        410,
      );
    }

    // 4. 构建诊断摘要(注入 prompt,控制在 800 字内;字段缺失时容错跳过)
    const summary = this.buildDiagnosisSummaryForQuestion(storedResult);

    // 5. 调用阶段 3
    const result = await askQuestionWithAI({
      imageSource,
      question,
      artType: analysis.workType as ArtType,
      diagnosisMode: (analysis.diagnosisMode ?? 'teaching') as 'teaching' | 'exam',
      diagnosisSummary: summary,
    });

    // 6. 失败映射(同 aiEnhanceAnalysis 的状态码语义)
    if (!result.success || !result.answer) {
      const failureReason = result.failureReason;
      logger.warn(
        { analysisId, tenantId, userId, failureReason, aiDurationMs: result.durationMs },
        '[analysis] askQuestion: AI call failed',
      );
      let code = ErrorCode.ANALYSIS_RESULT_FAILED;
      let status = 500;
      let message = '问题分析失败,请稍后重试';
      switch (failureReason) {
        case 'AI_TIMEOUT':
          code = ErrorCode.ANALYSIS_TIMEOUT;
          status = 408;
          message = '问题分析超时,请稍后重试';
          break;
        case 'AI_PARSE_ERROR':
        case 'AI_SCHEMA_ERROR':
          status = 502;
          message = 'AI 模型返回内容异常,请稍后重试';
          break;
        case 'AI_HTTP_ERROR':
          status = 502;
          message = 'AI 服务响应异常,请稍后重试';
          break;
        case 'AI_NETWORK_ERROR':
          status = 502;
          message = 'AI 服务网络异常,请稍后重试';
          break;
        case 'AI_KEY_MISSING':
        case 'AI_DISABLED':
          status = 503;
          message = 'AI 服务未配置,请联系管理员';
          break;
      }
      throw new BusinessError(code, message, status);
    }

    logger.info(
      { analysisId, tenantId, userId, focusDimension: result.focusDimension, aiDurationMs: result.durationMs },
      '[analysis] askQuestion: completed',
    );

    // 6.5 异步记录 AI 用量(与 aiEnhance 的 recordAIUsage 同口径;usageType=diagnose,追问归入诊断类)
    // 用作品所有者 ID 计费(即使 admin 代问,也归属作品所有者)
    const qaProviderInfo = resolveEffectiveProvider(env());
    if (qaProviderInfo) {
      const qaTokenUsage = result.tokenUsage;
      aiUsageRepository
        .create({
          tenantId: analysis.tenantId,
          userId: analysis.userId,
          analysisId: analysis.id,
          provider: qaProviderInfo.provider,
          model: result.model ?? qaProviderInfo.model,
          apiUrl: qaProviderInfo.apiUrl,
          success: true,
          durationMs: result.durationMs,
          promptTokens: qaTokenUsage?.promptTokens ?? null,
          completionTokens: qaTokenUsage?.completionTokens ?? null,
          totalTokens: qaTokenUsage?.totalTokens ?? null,
          costYuan: estimateCostYuan(
            result.model ?? qaProviderInfo.model,
            qaTokenUsage?.promptTokens,
            qaTokenUsage?.completionTokens,
          ),
          usageType: 'diagnose',
        })
        .catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          logger.warn(
            { err: msg, analysisId },
            '[analysis] askQuestion: record AI usage log failed (non-blocking)',
          );
        });
    }

    // 7. 即时返回(不落库)
    return {
      analysisId,
      question,
      answer: result.answer,
      focusDimension: result.focusDimension,
      suggestions: result.suggestions ?? [],
      durationMs: result.durationMs,
    };
  }

  /**
   * 从已存混合结果构建问题分析用的诊断摘要(≤800 字)
   * 容错:所有字段可选,缺失时跳过,不抛错
   */
  private buildDiagnosisSummaryForQuestion(stored: HybridAnalysisResult): string {
    const parts: string[] = [];
    parts.push(`综合评分:${stored.overallScore ?? '未知'}/100`);
    if (stored.semanticTheme) parts.push(`主题意境:${stored.semanticTheme}`);
    if (stored.styleRecognition) parts.push(`风格识别:${stored.styleRecognition}`);
    const v = stored.aiVisionResult;
    if (v) {
      if (v.visualDescription) parts.push(`画面描述:${v.visualDescription}`);
      if (v.composition) parts.push(`构图分析:${v.composition}`);
      if (v.color) parts.push(`色彩分析:${v.color}`);
      if (v.technique) parts.push(`技法分析:${v.technique}`);
      if (v.examResult?.gradeLabel) parts.push(`艺考档位:${v.examResult.gradeLabel}`);
      const sugTitles = (v.professionalSuggestions ?? [])
        .slice(0, 5)
        .map((s) => (typeof s === 'string' ? s : (s as { title?: string }).title))
        .filter((t): t is string => !!t);
      if (sugTitles.length > 0) parts.push(`改进建议:${sugTitles.join(';')}`);
    }
    let summary = parts.join('\n');
    if (summary.length > 800) summary = `${summary.slice(0, 800)}…`;
    return summary;
  }

  /**
   * 解析 AI 增强用的图片源
   * - 外部 URL(http/https)直接返回
   * - /uploads/xxx → 拼接 uploadDir + basename,并校验文件存在
   * - 其他格式(如 data: URL)直接返回
   *
   * @returns 解析后的图片源;本地文件不存在时返回 null
   */
  private resolveImageSourceForEnhance(imageUrl: string): string | null {
    // 外部 URL 直接可用
    if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
      return imageUrl;
    }
    // /uploads/xxx → 解析回本地文件系统路径
    if (imageUrl.startsWith('/uploads/')) {
      const filename = basename(imageUrl);
      const localPath = join(env().uploadDir, filename);
      if (!existsSync(localPath)) {
        logger.warn(
          { imageUrl, localPath, uploadDir: env().uploadDir },
          '[analysis] aiEnhance: local file not found (cleaned after phase 1?)',
        );
        return null;
      }
      return localPath;
    }
    // 其他格式(data: URL 等)直接返回
    return imageUrl;
  }

  /**
   * 异步记录 AI 用量日志(成功/失败均记录)
   * 从原 runAnalysis 搬移至 aiEnhanceAnalysis,仅阶段 2 触发 AI 时记录
   */
  private async recordAIUsage(
    analysis: Analysis,
    merged: HybridAnalysisResult,
  ): Promise<void> {
    const providerInfo = resolveEffectiveProvider(env());
    if (!providerInfo) {
      return;
    }
    const aiMeta = merged.aiMeta;
    const tokenUsage = aiMeta.aiTokenUsage;
    await aiUsageRepository.create({
      tenantId: analysis.tenantId,
      // 用作品所有者 ID 计费(即使 admin 代为增强,也归属作品所有者)
      userId: analysis.userId,
      analysisId: analysis.id,
      provider: providerInfo.provider,
      model: providerInfo.model,
      apiUrl: providerInfo.apiUrl,
      success: aiMeta.aiSuccess,
      durationMs: aiMeta.aiDurationMs,
      promptTokens: tokenUsage?.promptTokens ?? null,
      completionTokens: tokenUsage?.completionTokens ?? null,
      totalTokens: tokenUsage?.totalTokens ?? null,
      costYuan: aiMeta.aiSuccess
        ? estimateCostYuan(
            providerInfo.model,
            tokenUsage?.promptTokens,
            tokenUsage?.completionTokens,
          )
        : null,
      failureReason: aiMeta.aiFailureReason,
    });
  }

  /**
   * 从 DB 记录构造 AnalysisDetail(幂等返回路径复用)
   */
  private buildAnalysisDetailFromRecord(analysis: Analysis): AnalysisDetail {
    const storedResult = analysis.result as
      | (AnalysisDetail['result'] & {
          aiEnhanced?: boolean;
          aiMeta?: { aiDurationMs?: number; jimpDurationMs?: number };
          // 深度分析字段(阶段 C Task 8.2):从 result JSON 顶层提取
          evaluationStage?: EvaluationStage;
          scoreCriteria?: AnalysisDetail['scoreCriteria'];
          issueMarkers?: AnalysisDetail['issueMarkers'];
          aiVisionResult?: AnalysisDetail['aiVisionResult'];
          // 批次④:档位估算(AI 增强后冗余写入 result JSON 顶层)
          tierEstimate?: AnalysisDetail['tierEstimate'];
        })
      | null;
    return {
      id: analysis.id,
      tenantId: analysis.tenantId,
      userId: analysis.userId,
      workType: analysis.workType as ArtType,
      imageUrl: analysis.imageUrl,
      title: analysis.title,
      remark: analysis.remark,
      status: analysis.status as AnalysisDetail['status'],
      result: analysis.result as AnalysisDetail['result'],
      failureReason: analysis.failureReason,
      durationMs: analysis.durationMs,
      createdAt: analysis.createdAt.toISOString(),
      completedAt: analysis.completedAt?.toISOString() ?? null,
      aiEnhanced: storedResult?.aiEnhanced,
      aiDurationMs: storedResult?.aiMeta?.aiDurationMs,
      jimpDurationMs: storedResult?.aiMeta?.jimpDurationMs,
      diagnosisMode: analysis.diagnosisMode as AnalysisDetail['diagnosisMode'],
      examSubject: analysis.examSubject as AnalysisDetail['examSubject'],
      // 深度分析字段(阶段 C Task 8.2):
      //   evaluationStage/heritageCategory 优先取 DB 列(创建时用户选择 + AI 增强回显更新),
      //   回退 result JSON 顶层(AI 增强后冗余写入)
      //   scoreCriteria/issueMarkers/aiVisionResult 取 result JSON 顶层(AI 增强产出)
      evaluationStage:
        (analysis.evaluationStage as EvaluationStage | null) ??
        storedResult?.evaluationStage ??
        null,
      heritageCategory: analysis.heritageCategory as HeritageCategory | null,
      scoreCriteria: storedResult?.scoreCriteria,
      issueMarkers: storedResult?.issueMarkers,
      aiVisionResult: storedResult?.aiVisionResult,
      // 批次④:档位估算回读(DB 列优先,回退 result JSON 顶层;对齐 issueMarkers 先例语义)
      tierEstimate:
        (analysis.tierEstimate as AnalysisDetail['tierEstimate']) ??
        storedResult?.tierEstimate ??
        null,
    };
  }

  /**
   * 删除分析记录
   * 数据范围过滤(基于 RBAC 权限矩阵):
   *   - admin / owner(canDeleteTenantWide=true):可删除租户内任意记录
   *   - teacher / student:仅可删除自己创建的记录(ownership 校验)
   *
   * 路由层权限:requireAnyPermission('analysis:delete:own', 'analysis:delete:tenant')
   *   - teacher 拥有 analysis:delete:own,无 analysis:delete:tenant
   *   - student 拥有 analysis:delete:own,无 analysis:delete:tenant
   *   - admin / owner 拥有两者
   *
   * 安全策略:
   *   - tenantId 强制从 JWT 注入(防跨租户删除)
   *   - 越权删除(teacher/student 删他人记录)统一返回 404(不泄露存在性)
   *   - 审计日志:记录删除操作(operatorUserId / analysisId / ownerId / role)
   */
  async deleteAnalysis(params: {
    tenantId: string;
    analysisId: string;
    operatorUserId: string;
    role: UserRole;
  }): Promise<DeleteAnalysisResponse> {
    const { tenantId, analysisId, operatorUserId, role } = params;

    // 1. 查询记录(强制 tenant_id 过滤,跨租户返回 null)
    const analysis = await analysisRepository.findById(tenantId, analysisId);
    if (!analysis) {
      throw new BusinessError(ErrorCode.ANALYSIS_NOT_FOUND, '分析记录不存在', 404);
    }

    // 2. 数据范围过滤:非"租户全量删除"角色仅可删除自己的记录
    // canDeleteTenantWide(role) === false → teacher/student,必须 ownership
    if (!canDeleteTenantWide(role) && analysis.userId !== operatorUserId) {
      // 越权删除:统一返回 404(不泄露存在性)
      throw new BusinessError(ErrorCode.ANALYSIS_NOT_FOUND, '分析记录不存在', 404);
    }

    // 3. 执行删除(repository 内部再次校验 tenant_id)
    const deleted = await analysisRepository.delete(tenantId, analysisId);
    if (!deleted) {
      // 极端情况:并发删除导致记录已被清除
      throw new BusinessError(ErrorCode.ANALYSIS_NOT_FOUND, '分析记录不存在', 404);
    }

    // 4. 审计日志(对应技术约束:所有写操作必须审计)
    // 不记录敏感信息(imageUrl/title 等),仅记录删除操作的元数据
    logger.info(
      {
        action: 'analysis.delete',
        tenantId,
        analysisId,
        operatorUserId,
        operatorRole: role,
        ownerId: analysis.userId,
        workType: analysis.workType,
      },
      '[audit] analysis deleted',
    );

    return {
      id: analysisId,
      deleted: true,
    };
  }

  /**
   * 批量删除分析记录(跨端批删一致性,P-06)
   * 对应 API:POST /analyses/batch-delete
   * 契约:api-contract.ts BatchDeleteAnalysesRequest/Response
   *
   * 设计要点:
   *   - 多租户强制:所有 ids 归属 req.tenantId,任一越权/不存在则该条记入 failed(不整体回滚误删)
   *   - 数据范围过滤(基于 RBAC canDeleteTenantWide):
   *       - admin/owner(canDeleteTenantWide=true):可删租户内任意记录
   *       - teacher/student:仅可删自己创建的记录(越权记 failed)
   *   - 逐条记录失败原因,前端可精确提示
   *   - 条数上限(≤100)由 controller 层校验(ANALYSIS_BATCH_LIMIT_EXCEEDED)
   *
   * @param params 租户/操作者/角色/待删 ID 列表
   */
  async batchDeleteAnalyses(params: {
    tenantId: string;
    userId: string;
    role: UserRole;
    ids: string[];
  }): Promise<BatchDeleteAnalysesResponse> {
    const { tenantId, userId, role, ids } = params;

    // 去重(保序):重复 ID 只处理一次,避免重复计数
    const uniqueIds = [...new Set(ids)];

    // 1. 查询租户内记录(强制 tenant_id 过滤,防跨租户)
    const records = await analysisRepository.findManyByIds(tenantId, uniqueIds);
    const recordById = new Map(records.map((r) => [r.id, r]));
    const tenantWide = canDeleteTenantWide(role);

    // 2. 逐条判定可删除性(越权/不存在 → failed,不整体回滚)
    const toDelete: string[] = [];
    const failedItems: BatchDeleteAnalysisItem[] = [];
    for (const id of uniqueIds) {
      const rec = recordById.get(id);
      if (!rec) {
        // 不存在或不属于当前租户(不泄露存在性,统一提示)
        failedItems.push({ id, deleted: false, error: '分析记录不存在或不属于当前租户' });
        continue;
      }
      if (!tenantWide && rec.userId !== userId) {
        // 越权删除他人记录(teacher/student 仅能删自己)
        failedItems.push({ id, deleted: false, error: '无权删除他人分析记录' });
        continue;
      }
      toDelete.push(id);
    }

    // 3. 事务批量删除(仅删除已通过归属校验的记录)
    let deleted = 0;
    if (toDelete.length > 0) {
      deleted = await analysisRepository.deleteMany(toDelete);
    }

    // 4. 构造每条结果(成功条目 + 失败条目,保序)
    const successIds = new Set(toDelete);
    const items: BatchDeleteAnalysisItem[] = uniqueIds.map((id) => {
      if (successIds.has(id)) {
        return { id, deleted: true };
      }
      return failedItems.find((f) => f.id === id) ?? { id, deleted: false, error: '删除失败' };
    });

    const failedCount = uniqueIds.length - deleted;

    // 5. 审计日志(不记录敏感信息,仅删除元数据)
    logger.info(
      {
        action: 'analysis.batchDelete',
        tenantId,
        operatorUserId: userId,
        operatorRole: role,
        requested: uniqueIds.length,
        deleted,
        failedCount,
      },
      '[audit] analyses batch deleted',
    );

    return {
      total: uniqueIds.length,
      deleted,
      failedCount,
      items,
    };
  }

  // ============================================================

  /**
   * 执行分析的核心逻辑
   * 1. 校验配额
   * 2. 校验图片输入(imageUrl 或 localImagePath 至少一个)
   * 3. 写 DB(pending)
   * 4. 调用 Jimp 分析(同步,< 1s)
   * 5. 更新 DB(success + result + overallScore + durationMs)
   * 6. 清理临时文件(若为上传模式)
   * 7. 返回 CreateAnalysisResponse(包含完整 result)
   */
  private async runAnalysis(params: CreateAnalysisInput): Promise<CreateAnalysisResponse> {
    const { tenantId, userId, body, localImagePath } = params;

    // 1. 校验租户配额(抛 6001 / 3001 / 3002)
    await this.checkQuota(tenantId);

    // 2. 校验图片输入:localImagePath(上传)优先,其次 body.imageUrl
    const hasLocal = !!localImagePath && existsSync(localImagePath);
    const hasUrl = !!body.imageUrl && body.imageUrl.length > 0;
    if (!hasLocal && !hasUrl) {
      throw new BusinessError(
        ErrorCode.PARAM_MISSING,
        '缺少必填参数:imageUrl 或上传图片文件',
        400,
      );
    }
    if (hasLocal && localImagePath) {
      // 校验文件可读
      try {
        await fs.access(localImagePath, fs.constants.R_OK);
      } catch {
        throw new BusinessError(
          ErrorCode.ANALYSIS_IMAGE_INVALID,
          '上传文件不可读',
          400,
        );
      }
    }

    // 3. 决定分析输入源:本地文件路径优先,否则用 imageUrl
    const analysisSource = hasLocal && localImagePath ? localImagePath : body.imageUrl!;
    // body.imageUrl 已由调用方处理:
    //   - JSON模式:直接使用用户提供的外部URL
    //   - 上传模式:createAnalysisFromUpload 已生成 /uploads/xxx 公开访问路径
    const imageUrlForDb = body.imageUrl!;

    // 4. 写 DB(pending)
    const analysis = await analysisRepository.create({
      tenantId,
      userId,
      workType: body.artType as Analysis['workType'],
      imageUrl: imageUrlForDb,
      title: body.title ?? null,
      remark: body.remark ?? null,
      // 诊断模式(2026-08-16 诊断理念重构):默认教学诊断;exam 需带科目
      diagnosisMode: body.diagnosisMode ?? 'teaching',
      examSubject: body.diagnosisMode === 'exam' ? (body.examSubject ?? 'sketch') : null,
      // 深度分析字段(阶段 C Task 8.1):持久化用户选择,供阶段 2 AI 增强读取注入 prompt
      evaluationStage: body.evaluationStage ?? null,
      heritageCategory: body.heritageCategory ?? null,
    });

    // 5. 调用分析引擎(同步模式,3 秒 SLA)
    // AI_ENABLED=true 时走混合分析(Jimp + AI),否则走 Jimp-only(现有逻辑)
    // Phase 3 优化:优先检查 Redis 缓存(相同图片+类型 → 缓存命中 < 50ms)
    // Phase F1:捕获 jimpDurationMs/aiDurationMs 用于可观测性透传
    const startMs = Date.now();
    let result: AnalysisResult;
    let analysisStatus: 'success' | 'failed' = 'success';
    let failureReason: string | null = null;
    let aiEnhanced = false;
    let cacheHit = false;
    let jimpDurationMs: number | undefined;
    let aiDurationMs: number | undefined;

    try {
      // 缓存优化:通过图片 hash 查找缓存结果
      // 缓存命中时跳过 Jimp+AI 分析,直接返回历史结果(节省配额与时间)
      const isLocal = hasLocal && !!localImagePath;
      const cacheResult = await analysisCacheService.getOrAnalyze(
        analysisSource,
        body.artType,
        isLocal,
        async () => {
          // 方案 A 阶段 1:始终仅本地 Jimp 分析 + 模板建议(aiEnhanced=false)
          // AI 增强改由阶段 2(POST /analyses/:id/ai-enhance)用户主动触发,解耦 3s SLA
          // runLocalAnalysis 内部:Jimp 像素分析 + createFallbackAIVisionResult 模板建议
          const jimpStartMs = Date.now();
          const localResult = await runLocalAnalysis({
            imageSource: analysisSource,
            artType: body.artType,
            title: body.title,
            remark: body.remark,
          });
          jimpDurationMs = Date.now() - jimpStartMs;
          aiDurationMs = 0;
          return { result: localResult, aiEnhanced: false };
        },
      );

      result = cacheResult.result;
      aiEnhanced = cacheResult.aiEnhanced;
      cacheHit = cacheResult.cacheHit;

      // 缓存命中时无实际计算,耗时归零(可观测性标识)
      if (cacheHit) {
        jimpDurationMs = 0;
        aiDurationMs = 0;
      }

      if (cacheHit) {
        logger.info(
          { analysisId: analysis.id, artType: body.artType, aiEnhanced },
          '[analysis] cache HIT, skipped analysis',
        );
      }
    } catch (err) {
      // 兜底:runLocalAnalysis/analyzeImage 内部已捕获异常并返回 fallback,
      // 这里仅作终极兜底(理论上不会进入)
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(
        { err: msg, analysisId: analysis.id, tenantId, userId, artType: body.artType },
        '[analysis] analyzeImage threw unexpectedly',
      );
      result = this.generateEmptyFallback(body.artType);
      analysisStatus = 'failed';
      failureReason = `分析失败:${msg}`;
    }
    const durationMs = Date.now() - startMs;

    // 6. 更新 DB(success / failed)
    try {
      const updated = await analysisRepository.updateResult(tenantId, analysis.id, {
        status: analysisStatus,
        // AnalysisResult 接口缺少 index signature,Prisma JsonValue 不直接接受,
        // repository 内部已 `as Prisma.InputJsonValue`,这里通过 unknown 中转保证类型安全
        result: result as unknown as Analysis['result'],
        overallScore: result.overallScore,
        durationMs,
        completedAt: new Date(),
        failureReason,
      });
      if (!updated) {
        // 极端情况:并发删除导致更新失败,记录日志但不影响响应
        logger.warn(
          { analysisId: analysis.id, tenantId },
          '[analysis] updateResult returned null (record missing?)',
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(
        { err: msg, analysisId: analysis.id, tenantId },
        '[analysis] failed to persist analysis result',
      );
      // 不抛错:结果已计算,返回给前端;DB 状态留 pending,后台任务可补偿
    }

    // 6.5 异步创建通知(不阻塞主流程,失败仅记录日志)
    // 通知触发点:分析完成/失败 → 通知作品所有者(userId)
    notificationService
      .createNotification({
        tenantId,
        userId,
        type: analysisStatus === 'success' ? 'ANALYSIS_DONE' : 'ANALYSIS_FAIL',
        title: analysisStatus === 'success' ? '作品分析完成' : '作品分析失败',
        content:
          analysisStatus === 'success'
            ? `《${analysis.title ?? '未命名作品'}》分析完成${result.overallScore != null ? `,综合评分 ${result.overallScore}` : ''}`
            : `《${analysis.title ?? '未命名作品'}》分析失败${failureReason ? ':' + failureReason : ''}`,
        level: analysisStatus === 'success' ? 'SUCCESS' : 'ERROR',
        linkUrl: `/analysis/${analysis.id}`,
        metadata: {
          analysisId: analysis.id,
          artType: body.artType,
          overallScore: result.overallScore,
        },
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(
          { err: msg, analysisId: analysis.id, tenantId, userId },
          '[analysis] create notification failed (non-blocking)',
        );
      });

    // 7. 文件保留(方案A 两阶段响应)
    // 阶段1完成后不删除上传的原始图片:
    //   - 阶段2 ai-enhance 需要原始图片调用 GLM-4v(否则 resolveImageSourceForEnhance 返回 410)
    //   - analysis.imageUrl 指向该文件,前端展示历史记录也需要
    // 注:原 safeCleanup 已移除(会导致阶段2 文件缺失 410);本地开发 uploads/ 可定期手动清理
    if (hasLocal && localImagePath) {
      logger.debug({ path: localImagePath }, '[analysis] file kept (phase 2 ai-enhance needs it)');
    }

    logger.info(
      {
        analysisId: analysis.id,
        tenantId,
        userId,
        artType: body.artType,
        status: analysisStatus,
        durationMs,
        overallScore: result.overallScore,
        aiEnabled: isAIEnabled(),
        aiEnhanced,
      },
      '[analysis] completed (synchronous)',
    );

    // 8. 返回完整结果(同步模式)
    // 注:CreateAnalysisResponse.result 类型为 AnalysisDetail | null,
    // 但同步模式下我们返回完整 AnalysisDetail 以便前端立即渲染
    // Phase F1:透传 aiEnhanced/cacheHit/jimpDurationMs/aiDurationMs 可观测性元信息
    const detail: AnalysisDetail = {
      id: analysis.id,
      tenantId: analysis.tenantId,
      userId: analysis.userId,
      workType: analysis.workType as ArtType,
      imageUrl: analysis.imageUrl,
      title: analysis.title,
      remark: analysis.remark,
      status: analysisStatus,
      result,
      failureReason,
      durationMs,
      createdAt: analysis.createdAt.toISOString(),
      completedAt: new Date().toISOString(),
      aiEnhanced,
      cacheHit,
      jimpDurationMs,
      aiDurationMs,
      diagnosisMode: analysis.diagnosisMode as AnalysisDetail['diagnosisMode'],
      examSubject: analysis.examSubject as AnalysisDetail['examSubject'],
      // 深度分析字段(阶段 C Task 8.2):Phase 1 透传用户选择(AI 增强字段在阶段 2 填充)
      evaluationStage: analysis.evaluationStage as EvaluationStage | null,
      heritageCategory: analysis.heritageCategory as HeritageCategory | null,
    };

    return {
      id: analysis.id,
      status: analysisStatus,
      result: detail,
      durationMs,
    };
  }

  /**
   * 空回退(analyzeImage 异常时的兜底,理论上不会触发)
   * 批次③(2026-09-05):不再编造默认分数——失败即无分(null),诚实呈现
   */
  private generateEmptyFallback(artType: ArtType): AnalysisResult {
    return {
      artType,
      dimensions: {
        type: artType,
        // 最小结构,具体字段在 controller 序列化时由类型守卫保证
      } as AnalysisResult['dimensions'],
      originality: {
        score: null,
        similarity: 0.2,
        creativityLevel: 'good',
        suggestion: '分析失败,暂无原创性数据',
      },
      overallScore: null,
    };
  }

  /**
   * 配额校验(对应错误码 6001)
   */
  private async checkQuota(tenantId: string): Promise<void> {
    const tenant = await tenantRepository.findById(tenantId);
    if (!tenant) {
      throw new BusinessError(ErrorCode.TENANT_NOT_FOUND, '租户不存在', 404);
    }
    if (tenant.status === 'disabled') {
      throw new BusinessError(ErrorCode.TENANT_DISABLED, '租户已被禁用', 403);
    }

    const maxQuota = PLAN_QUOTA[tenant.plan];
    if (maxQuota === -1) return; // enterprise 无限

    const now = new Date();
    const usedQuota = await analysisRepository.countMonthlyUsage(
      tenantId,
      now.getUTCFullYear(),
      now.getUTCMonth() + 1,
    );

    if (usedQuota >= maxQuota) {
      throw new BusinessError(
        ErrorCode.ANALYSIS_QUOTA_EXCEEDED,
        `本月分析配额已用完(${usedQuota}/${maxQuota}),请升级订阅`,
        402,
      );
    }
  }
}

export const analysisService = new AnalysisServiceClass();
