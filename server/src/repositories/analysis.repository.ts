// ============================================================
// AI 分析 Repository
// 对应文档:data-model-v1.md §7.2(强制 tenant_id 过滤)
// 所有查询必须带 WHERE tenant_id = ?(由本层显式传入)
// ============================================================

import { Prisma, type Analysis, type ArtType, type AnalysisStatus } from '@prisma/client';
import { prisma } from '../config/prisma.js';

export interface ListAnalysesFilter {
  tenantId: string;
  userId?: string;
  artType?: ArtType;
  status?: AnalysisStatus;
  startDate?: Date;
  endDate?: Date;
  page: number;
  pageSize: number;
}

export class AnalysisRepository {
  /**
   * 创建分析任务(强制带 tenantId + userId)
   *
   * 阶段 C Task 8.1:写入 evaluationStage/heritageCategory(用户选择,创建时持久化)
   * scoreCriteria/issueMarkers 由 AI 增强后经 updateResult 写入,创建时为 null
   */
  async create(
    data: Pick<Analysis, 'tenantId' | 'userId' | 'workType' | 'imageUrl' | 'title' | 'remark'> & {
      /** 诊断模式(2026-08-16 新增,默认 teaching) */
      diagnosisMode?: string;
      /** 艺考科目(仅 exam 模式) */
      examSubject?: string | null;
      /** 评价阶段(评分参照系档位;用户选择,阶段 C Task 8.1) */
      evaluationStage?: string | null;
      /** 非遗类目(仅 artType='heritage';用户选择,阶段 C Task 8.1) */
      heritageCategory?: string | null;
    },
  ): Promise<Analysis> {
    return prisma().analysis.create({
      data: {
        tenantId: data.tenantId,
        userId: data.userId,
        workType: data.workType,
        imageUrl: data.imageUrl,
        title: data.title,
        remark: data.remark,
        diagnosisMode: data.diagnosisMode ?? 'teaching',
        examSubject: data.examSubject ?? null,
        // 深度分析字段(阶段 C Task 8.1):用户选择持久化;缺省 null
        evaluationStage: data.evaluationStage ?? null,
        heritageCategory: data.heritageCategory ?? null,
        status: 'pending',
      },
    });
  }

  /**
   * 按 ID 查询分析任务(强制 tenant_id 校验,防跨租户)
   */
  async findById(tenantId: string | undefined, id: string): Promise<Analysis | null> {
    return prisma().analysis.findFirst({
      where: { id, ...(tenantId ? { tenantId } : {}) },
    });
  }

  /**
   * 更新分析任务结果(强制 tenant_id 校验)
   * 注:result 为 Json 类型,Prisma 要求 null 显式包装为 DbNull / JsonNull
   *
   * 阶段 C Task 8.1:AI 增强后写入 evaluationStage/scoreCriteria/issueMarkers
   *   - evaluationStage:AI 回显的评价阶段(若创建时未设置,此处同步;已设置则保留用户选择)
   *   - scoreCriteria/issueMarkers:深度分析 JSON 字段,冗余自 result 便于列表查询与徽章渲染
   */
  async updateResult(
    tenantId: string | undefined,
    id: string,
    data: Pick<
      Partial<Analysis>,
      'status' | 'result' | 'failureReason' | 'overallScore' | 'durationMs' | 'completedAt'
    > & {
      /** 评价阶段(AI 回显;同步到列,供列表徽章渲染) */
      evaluationStage?: string | null;
      /** 评分标准 JSON(深度分析;冗余自 result.aiVisionResult.scoreCriteria) */
      scoreCriteria?: unknown;
      /** 问题区域标注 JSON(深度分析;冗余自 result.aiVisionResult.issueMarkers) */
      issueMarkers?: unknown;
      /** 档位估算 JSON(Phase 2 批次④;冗余自 result.tierEstimate,供列表/徽章直读) */
      tierEstimate?: unknown;
    },
  ): Promise<Analysis | null> {
    const existing = await prisma().analysis.findFirst({
      where: { id, ...(tenantId ? { tenantId } : {}) },
      select: { id: true },
    });
    if (!existing) return null;
    // Prisma JSON 字段:null 需通过 DbNull 显式表达(否则 TS 类型不允许)
    const updateData: Prisma.AnalysisUpdateInput = {
      status: data.status,
      failureReason: data.failureReason,
      overallScore: data.overallScore,
      durationMs: data.durationMs,
      completedAt: data.completedAt,
    };
    if (data.result === null) {
      updateData.result = Prisma.DbNull;
    } else if (data.result !== undefined) {
      updateData.result = data.result as Prisma.InputJsonValue;
    }
    // 深度分析字段(阶段 C Task 8.1):JSON 字段 null 用 DbNull,有值用 InputJsonValue
    if (data.evaluationStage !== undefined) {
      updateData.evaluationStage = data.evaluationStage;
    }
    if (data.scoreCriteria !== undefined) {
      updateData.scoreCriteria =
        data.scoreCriteria === null
          ? Prisma.DbNull
          : (data.scoreCriteria as Prisma.InputJsonValue);
    }
    if (data.issueMarkers !== undefined) {
      updateData.issueMarkers =
        data.issueMarkers === null
          ? Prisma.DbNull
          : (data.issueMarkers as Prisma.InputJsonValue);
    }
    // 批次④:档位估算 JSON 列(null 用 DbNull,有值用 InputJsonValue)
    if (data.tierEstimate !== undefined) {
      updateData.tierEstimate =
        data.tierEstimate === null
          ? Prisma.DbNull
          : (data.tierEstimate as Prisma.InputJsonValue);
    }
    return prisma().analysis.update({
      where: { id },
      data: updateData,
    });
  }

  /**
   * 分页查询分析历史(强制 tenant_id 过滤)
   * 利用复合索引 (tenant_id, created_at) 加速
   */
  async list(filter: ListAnalysesFilter): Promise<{ items: Analysis[]; total: number }> {
    const where: Prisma.AnalysisWhereInput = {
      tenantId: filter.tenantId,
    };
    if (filter.userId) where.userId = filter.userId;
    if (filter.artType) where.workType = filter.artType;
    if (filter.status) where.status = filter.status;
    if (filter.startDate || filter.endDate) {
      where.createdAt = {};
      if (filter.startDate) where.createdAt.gte = filter.startDate;
      if (filter.endDate) where.createdAt.lte = filter.endDate;
    }

    const [items, total] = await Promise.all([
      prisma().analysis.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (filter.page - 1) * filter.pageSize,
        take: filter.pageSize,
      }),
      prisma().analysis.count({ where }),
    ]);
    return { items, total };
  }

  /**
   * 成长曲线查询(无分页,按时间升序)
   * 强制 tenant_id 过滤;仅查询 status=success 的记录(成长曲线仅统计成功分析)
   * 支持 userId / artType / 时间范围筛选
   *
   * 安全策略:
   *   - tenantId 必填,防止跨租户读取
   *   - userId 可选(teacher/admin 查看租户全量时不传)
   *   - 仅返回 success 状态记录(失败/处理中的记录不计入成长曲线)
   */
  async listForGrowth(filter: {
    tenantId: string;
    userId?: string;
    artType?: ArtType;
    startDate?: Date;
    endDate?: Date;
  }): Promise<Analysis[]> {
    const where: Prisma.AnalysisWhereInput = {
      tenantId: filter.tenantId,
      status: 'success',
    };
    if (filter.userId) where.userId = filter.userId;
    if (filter.artType) where.workType = filter.artType;
    if (filter.startDate || filter.endDate) {
      where.createdAt = {};
      if (filter.startDate) where.createdAt.gte = filter.startDate;
      if (filter.endDate) where.createdAt.lte = filter.endDate;
    }
    return prisma().analysis.findMany({
      where,
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * 学生近期 AI 综合分(Phase 2 批次③ 反馈模式预判用)
   * 取最近若干条"已 AI 增强"的成功记录的 overallScore(倒序,最多 limit 个);
   * select 仅取 result JSON,避免拉整行,保持轻量。
   *
   * @param workType 限定作品类型,防止素描/色彩等不同科目分数互相稀释预判
   */
  async findRecentEnhancedScores(
    tenantId: string,
    userId: string,
    workType: ArtType,
    limit = 3,
  ): Promise<number[]> {
    const rows = await prisma().analysis.findMany({
      where: { tenantId, userId, workType, status: 'success' },
      orderBy: { createdAt: 'desc' },
      take: limit * 3, // 多取一些,内存中过滤出 aiEnhanced 后再截断
      select: { result: true },
    });
    const scores: number[] = [];
    for (const row of rows) {
      const r = row.result as { aiEnhanced?: boolean; overallScore?: number | null } | null;
      if (r?.aiEnhanced === true && typeof r.overallScore === 'number') {
        scores.push(r.overallScore);
        if (scores.length >= limit) break;
      }
    }
    return scores;
  }

  /**
   * 当月分析次数(用于配额校验)
   */
  async countMonthlyUsage(tenantId: string, year: number, month: number): Promise<number> {
    const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
    const end = new Date(Date.UTC(year, month, 1, 0, 0, 0));
    return prisma().analysis.count({
      where: {
        tenantId,
        createdAt: { gte: start, lt: end },
        status: { in: ['success', 'processing', 'pending'] },
      },
    });
  }

  /**
   * 删除分析任务(强制 tenant_id 校验,防跨租户删除)
   * @param tenantId 租户 ID
   * @param id 分析任务 ID
   * @returns true 删除成功;false 记录不存在或不属于该租户
   */
  async delete(tenantId: string, id: string): Promise<boolean> {
    const existing = await prisma().analysis.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });
    if (!existing) return false;
    await prisma().analysis.delete({
      where: { id },
    });
    return true;
  }

  /**
   * 批量查询分析记录(强制 tenant_id 过滤,防跨租户)
   * 用于批删接口:先查询归属,再逐条判定越权/不存在
   * @param tenantId 租户 ID(强制隔离)
   * @param ids 分析记录 ID 列表
   */
  async findManyByIds(tenantId: string, ids: string[]): Promise<Analysis[]> {
    return prisma().analysis.findMany({
      where: { tenantId, id: { in: ids } },
    });
  }

  /**
   * 批量删除分析记录(事务批量删除)
   * 注意:调用方必须先通过 findManyByIds 校验 ids 归属 tenantId,
   * 此处仅按 id 删除(tenant_id 已在预检中强制过滤,防跨租户)
   * @param ids 已通过归属校验的分析记录 ID 列表
   * @returns 实际删除条数
   */
  async deleteMany(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const result = await prisma().analysis.deleteMany({
      where: { id: { in: ids } },
    });
    return result.count;
  }
}

export const analysisRepository = new AnalysisRepository();
