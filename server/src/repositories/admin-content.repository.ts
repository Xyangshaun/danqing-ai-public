// ============================================================
// 管理后台 - 内容 Repository(Phase 4)
// 对应 API:/api/admin/artworks + /api/admin/templates
//
// 职责:
//   1. 作品列表/详情查询(含审核状态筛选)
//   2. 作品审核(通过/拒绝/标记)
//   3. 作品删除(物理删除违规内容)
//   4. 创意模板 CRUD
//
// 安全约束:
//   - 作品查询按 tenantId 过滤(管理后台允许跨租户查询)
//   - 审核记录 reviewedBy/reviewedAt/reviewNote
// ============================================================

import type { Prisma} from '@prisma/client';
import { type Analysis, type CreativeTemplate, type ArtType, type AnalysisStatus, type ReviewStatus } from '@prisma/client';
import { prisma } from '../config/prisma.js';

/** 作品列表查询过滤 */
export interface ListAdminArtworksFilter {
  currentTenantId: string;
  targetTenantId?: string;
  userId?: string;
  workType?: ArtType;
  status?: AnalysisStatus;
  reviewStatus?: ReviewStatus;
  startDate?: Date;
  endDate?: Date;
  search?: string;
  page: number;
  pageSize: number;
}

export class AdminContentRepository {
  /**
   * 分页查询作品列表(含审核状态)
   * 关联 user 表获取 userName
   */
  async listArtworks(filter: ListAdminArtworksFilter): Promise<{ items: Array<Analysis & { user: { name: string } }>; total: number }> {
    const where: Prisma.AnalysisWhereInput = {};

    where.tenantId = filter.targetTenantId ?? filter.currentTenantId;

    if (filter.userId) where.userId = filter.userId;
    if (filter.workType) where.workType = filter.workType;
    if (filter.status) where.status = filter.status;
    if (filter.reviewStatus) where.reviewStatus = filter.reviewStatus;

    if (filter.startDate || filter.endDate) {
      where.createdAt = {};
      if (filter.startDate) where.createdAt.gte = filter.startDate;
      if (filter.endDate) where.createdAt.lte = filter.endDate;
    }

    // 模糊搜索:title
    if (filter.search) {
      where.title = { contains: filter.search.trim(), mode: 'insensitive' };
    }

    const [items, total] = await Promise.all([
      prisma().analysis.findMany({
        where,
        include: {
          user: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (filter.page - 1) * filter.pageSize,
        take: filter.pageSize,
      }),
      prisma().analysis.count({ where }),
    ]);

    return { items: items as Array<Analysis & { user: { name: string } }>, total };
  }

  /**
   * 按 ID 查询作品详情(支持跨租户)
   */
  async findArtworkById(
    currentTenantId: string,
    artworkId: string,
    allowCrossTenant = false,
  ): Promise<Analysis | null> {
    const where: Prisma.AnalysisWhereInput = { id: artworkId };
    if (!allowCrossTenant) {
      where.tenantId = currentTenantId;
    }
    return prisma().analysis.findFirst({ where });
  }

  /**
   * 审核作品(更新 reviewStatus/reviewedBy/reviewedAt/reviewNote)
   */
  async reviewArtwork(
    artworkId: string,
    reviewStatus: ReviewStatus,
    reviewerId: string,
    note?: string,
  ): Promise<Analysis> {
    return prisma().analysis.update({
      where: { id: artworkId },
      data: {
        reviewStatus,
        reviewedBy: reviewerId,
        reviewedAt: new Date(),
        reviewNote: note ?? null,
      },
    });
  }

  /**
   * 删除作品(物理删除违规内容)
   */
  async deleteArtwork(artworkId: string): Promise<boolean> {
    try {
      await prisma().analysis.delete({ where: { id: artworkId } });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 统计租户内作品数
   */
  async countArtworksByTenant(tenantId: string): Promise<number> {
    return prisma().analysis.count({ where: { tenantId } });
  }

  /**
   * 统计当日新增作品数
   */
  async countTodayNewArtworks(): Promise<number> {
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    return prisma().analysis.count({
      where: { createdAt: { gte: startOfDay } },
    });
  }

  /**
   * 统计总作品数
   */
  async countTotalArtworks(): Promise<number> {
    return prisma().analysis.count();
  }

  /**
   * 统计当日 AI 调用量(当日创建的分析任务)
   */
  async countTodayAiCalls(): Promise<number> {
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    return prisma().analysis.count({
      where: { createdAt: { gte: startOfDay } },
    });
  }

  /**
   * 统计处理中任务数(用于 realtime)
   */
  async countPendingTasks(): Promise<number> {
    return prisma().analysis.count({
      where: { status: { in: ['pending', 'processing'] as AnalysisStatus[] } },
    });
  }

  /**
   * 统计最近 7 日作品数(按租户)
   */
  async countLast7dArtworksByTenant(tenantId: string): Promise<number> {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    return prisma().analysis.count({
      where: { tenantId, createdAt: { gte: sevenDaysAgo } },
    });
  }

  /**
   * 计算租户内作品平均分
   */
  async avgScoreByTenant(tenantId: string): Promise<number> {
    const result = await prisma().analysis.aggregate({
      where: { tenantId, overallScore: { not: null } },
      _avg: { overallScore: true },
    });
    return result._avg.overallScore ?? 0;
  }

  // ============================================================
  // 创意模板 CRUD
  // ============================================================

  /**
   * 分页查询创意模板
   */
  async listTemplates(filter: {
    artType?: ArtType;
    enabled?: boolean;
    search?: string;
    page: number;
    pageSize: number;
  }): Promise<{ items: CreativeTemplate[]; total: number }> {
    const where: Prisma.CreativeTemplateWhereInput = {};
    if (filter.artType) where.artType = filter.artType;
    if (filter.enabled !== undefined) where.enabled = filter.enabled;
    if (filter.search) {
      where.name = { contains: filter.search.trim(), mode: 'insensitive' };
    }
    const [items, total] = await Promise.all([
      prisma().creativeTemplate.findMany({
        where,
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
        skip: (filter.page - 1) * filter.pageSize,
        take: filter.pageSize,
      }),
      prisma().creativeTemplate.count({ where }),
    ]);
    return { items, total };
  }

  /**
   * 按 ID 查询模板
   */
  async findTemplateById(id: string): Promise<CreativeTemplate | null> {
    return prisma().creativeTemplate.findUnique({ where: { id } });
  }

  /**
   * 创建模板
   */
  async createTemplate(data: Prisma.CreativeTemplateCreateInput): Promise<CreativeTemplate> {
    return prisma().creativeTemplate.create({ data });
  }

  /**
   * 更新模板
   */
  async updateTemplate(id: string, data: Prisma.CreativeTemplateUpdateInput): Promise<CreativeTemplate> {
    return prisma().creativeTemplate.update({ where: { id }, data });
  }

  /**
   * 删除模板(物理删除)
   */
  async deleteTemplate(id: string): Promise<boolean> {
    try {
      await prisma().creativeTemplate.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }
}

export const adminContentRepository = new AdminContentRepository();
