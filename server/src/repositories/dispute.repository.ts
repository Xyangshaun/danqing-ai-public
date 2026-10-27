// ============================================================
// 争议案件 Repository(Phase 5)
// 对应文档:new-features-design.md §1.7, §3.2, §3.4
// 多租户:所有查询强制 tenantId 过滤
// ============================================================

import type { Prisma, DisputeCase, DisputeStatus, DisputeLevel, ReviewRecord } from '@prisma/client';
import { prisma } from '../config/prisma.js';

/** 争议列表查询条件(tenantId 可选:教师/admin/owner 跨租户协作时传 undefined) */
export interface DisputeListFilter {
  tenantId?: string;
  status?: DisputeStatus;
  level?: DisputeLevel;
  analysisId?: string;
  page: number;
  pageSize: number;
}

/** DisputeCase 含 reviews 关系的 payload 类型(include 场景) */
export type DisputeCaseWithReviews = Prisma.DisputeCaseGetPayload<{
  include: { reviews: true };
}>;

export class DisputeRepository {
  /**
   * 创建争议案件
   * triggerReason / arbitrationConfig / finalScore 均为 JSON 字段
   */
  async create(data: Prisma.DisputeCaseUncheckedCreateInput): Promise<DisputeCase> {
    return prisma().disputeCase.create({ data });
  }

  /**
   * 按 ID 查询争议案件(tenantId 可选:跨租户协作时传 undefined 则不按租户过滤,含 reviews 关系)
   */
  async findById(tenantId: string | undefined, id: string): Promise<DisputeCaseWithReviews | null> {
    return prisma().disputeCase.findFirst({
      where: { id, ...(tenantId ? { tenantId } : {}) },
      include: {
        reviews: true,
      },
    });
  }

  /**
   * 按 analysisId 查询争议案件(强制 tenantId 过滤)
   * 用于 checkDispute 时判断是否已存在案件
   */
  async findByAnalysis(tenantId: string, analysisId: string): Promise<DisputeCase | null> {
    return prisma().disputeCase.findFirst({
      where: { analysisId, tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * 列出争议案件(强制 tenantId 过滤 + 分页,含 reviews 关系)
   */
  async listByTenant(filter: DisputeListFilter): Promise<{ items: DisputeCaseWithReviews[]; total: number }> {
    const where: Prisma.DisputeCaseWhereInput = { ...(filter.tenantId ? { tenantId: filter.tenantId } : {}) };
    if (filter.status) where.status = filter.status;
    if (filter.level) where.triggerLevel = filter.level;
    if (filter.analysisId) where.analysisId = filter.analysisId;

    const [items, total] = await Promise.all([
      prisma().disputeCase.findMany({
        where,
        include: { reviews: true },
        orderBy: { createdAt: 'desc' },
        skip: (filter.page - 1) * filter.pageSize,
        take: filter.pageSize,
      }),
      prisma().disputeCase.count({ where }),
    ]);
    return { items, total };
  }

  /**
   * 列出租户内全部争议(用于 service 层 toDisputeCaseDetail 映射)
   */
  async listByTenantSimple(tenantId: string): Promise<DisputeCase[]> {
    return prisma().disputeCase.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * 获取争议关联的评审记录(显式查询,避免依赖 include 类型)
   */
  async getReviews(disputeId: string): Promise<ReviewRecord[]> {
    // 隐式多对多关系("DisputeReviews"):通过 disputeCases 反查关联评审
    return prisma().reviewRecord.findMany({
      where: { disputeCases: { some: { id: disputeId } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * 写入最终裁定结果
   */
  async updateFinalScore(
    tenantId: string,
    id: string,
    params: {
      finalScore: unknown;
      finalRule: string;
      resolvedBy: string;
      resolvedAt: Date;
      resolutionNote?: string | null;
      status: DisputeStatus;
    },
  ): Promise<DisputeCase> {
    // 显式校验 tenantId(防越权)
    const existing = await prisma().disputeCase.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });
    if (!existing) {
      throw new Error(`[disputeRepository] update denied: dispute ${id} not in tenant ${tenantId}`);
    }
    return prisma().disputeCase.update({
      where: { id },
      data: {
        finalScore: params.finalScore as Prisma.InputJsonValue,
        finalRule: params.finalRule,
        resolvedBy: params.resolvedBy,
        resolvedAt: params.resolvedAt,
        resolutionNote: params.resolutionNote ?? null,
        status: params.status,
      },
    });
  }

  /**
   * 全平台统计指定状态的争议数(管理员大屏用,跨租户,无 tenantId 过滤)
   */
  async countGlobalByStatus(statuses: DisputeStatus[]): Promise<number> {
    return prisma().disputeCase.count({
      where: { status: { in: statuses } },
    });
  }

  /**
   * 关联评审记录到争议案件(多对多)
   */
  async attachReviews(disputeId: string, reviewIds: string[]): Promise<void> {
    if (reviewIds.length === 0) return;
    await prisma().disputeCase.update({
      where: { id: disputeId },
      data: {
        reviews: {
          connect: reviewIds.map((rid) => ({ id: rid })),
        },
      },
    });
  }
}

export const disputeRepository = new DisputeRepository();
