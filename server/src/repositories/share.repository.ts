// ============================================================
// 组织内分享 Repository(报告导出+组织分享特性)
// 对应文档:.trae/specs/report-export-org-share/spec.md §5
// 多租户:SharedWork.tenantId 直接隔离;ShareComment 经 SharedWork 间接隔离
// ============================================================

import type { Prisma, SharedWork, ShareComment } from '@prisma/client';
import { prisma } from '../config/prisma.js';

/** 动态流条目查询载荷(含作品/分享者/最新评论) */
const sharedWorkInclude = {
  analysis: {
    select: {
      id: true,
      workType: true,
      imageUrl: true,
      title: true,
      overallScore: true,
      status: true,
      createdAt: true,
    },
  },
  user: {
    select: {
      id: true,
      name: true,
      avatar: true,
      role: true,
    },
  },
  comments: {
    orderBy: { createdAt: 'desc' as const },
    take: 3,
    include: {
      user: {
        select: {
          id: true,
          name: true,
          avatar: true,
          role: true,
        },
      },
    },
  },
  _count: {
    select: { comments: true },
  },
} satisfies Prisma.SharedWorkInclude;

export type SharedWorkWithRelations = Prisma.SharedWorkGetPayload<{
  include: typeof sharedWorkInclude;
}>;

export class ShareRepository {
  // ============================================================
  // SharedWork
  // ============================================================

  /**
   * 创建分享记录
   * 注:@@unique([analysisId, userId]) 重复分享由 Prisma P2002 抛出,service 层转 409
   */
  async create(data: Prisma.SharedWorkUncheckedCreateInput): Promise<SharedWorkWithRelations> {
    return prisma().sharedWork.create({
      data,
      include: sharedWorkInclude,
    });
  }

  /**
   * 按 ID 查询分享记录(tenantId 可选:教师/admin/owner 跨租户协作时传 undefined 则不按租户过滤)
   */
  async findById(tenantId: string | undefined, id: string): Promise<SharedWorkWithRelations | null> {
    return prisma().sharedWork.findFirst({
      where: { id, ...(tenantId ? { tenantId } : {}) },
      include: sharedWorkInclude,
    });
  }

  /**
   * 查询某用户是否已分享某作品(幂等前置检查,返回友好 409 而非 Prisma P2002)
   */
  async findByAnalysisAndUser(
    tenantId: string,
    analysisId: string,
    userId: string,
  ): Promise<SharedWork | null> {
    return prisma().sharedWork.findFirst({
      where: { tenantId, analysisId, userId },
    });
  }

  /**
   * 组织动态流分页查询(tenantId 可选:教师/admin/owner 跨租户协作时传 undefined 则全局可见;置顶优先 + 时间倒序)
   * @param workType 可选作品类型筛选(经关联 Analysis 过滤)
   */
  async listByTenant(
    tenantId: string | undefined,
    page: number,
    pageSize: number,
    workType?: string,
  ): Promise<{ items: SharedWorkWithRelations[]; total: number }> {
    const where: Prisma.SharedWorkWhereInput = {
      ...(tenantId ? { tenantId } : {}),
      ...(workType ? { analysis: { workType: workType as Prisma.EnumArtTypeFilter['equals'] } } : {}),
    };
    const [items, total] = await Promise.all([
      prisma().sharedWork.findMany({
        where,
        include: sharedWorkInclude,
        // 置顶优先,其余按分享时间倒序
        orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma().sharedWork.count({ where }),
    ]);
    return { items, total };
  }

  /**
   * 更新置顶状态
   */
  async updatePinned(id: string, isPinned: boolean): Promise<SharedWork> {
    return prisma().sharedWork.update({
      where: { id },
      data: { isPinned },
    });
  }

  /**
   * 删除分享记录(ShareComment 经 onDelete: Cascade 级联清理)
   */
  async delete(id: string): Promise<void> {
    await prisma().sharedWork.delete({ where: { id } });
  }

  // ============================================================
  // ShareComment
  // ============================================================

  /**
   * 创建评论
   */
  async createComment(data: Prisma.ShareCommentUncheckedCreateInput): Promise<ShareComment> {
    return prisma().shareComment.create({ data });
  }

  /**
   * 按 ID 查询评论(含所属 sharedWorkId,用于 service 层归属校验)
   */
  async findCommentById(id: string): Promise<ShareComment | null> {
    return prisma().shareComment.findUnique({ where: { id } });
  }

  /**
   * 查询某动态的全部评论(时间升序,完整列表)
   */
  async listComments(sharedWorkId: string) {
    return prisma().shareComment.findMany({
      where: { sharedWorkId },
      orderBy: { createdAt: 'asc' },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            avatar: true,
            role: true,
          },
        },
      },
    });
  }

  /**
   * 删除评论
   */
  async deleteComment(id: string): Promise<void> {
    await prisma().shareComment.delete({ where: { id } });
  }
}

export const shareRepository = new ShareRepository();
