// ============================================================
// AI-教师评分差异 Repository(框架二 P2)
// 多租户:所有查询强制 tenantId 过滤
// ============================================================

import type { Prisma, ScoreDiffRecord } from '@prisma/client';
import { prisma } from '../config/prisma.js';

export class ScoreDiffRepository {
  /** 创建差异记录 */
  async create(data: Prisma.ScoreDiffRecordUncheckedCreateInput): Promise<ScoreDiffRecord> {
    return prisma().scoreDiffRecord.create({ data });
  }

  /** 查询租户内差异记录(时间倒序,可按时间范围过滤) */
  async listByTenant(
    tenantId: string,
    opts: { from?: Date; to?: Date; take?: number } = {},
  ): Promise<ScoreDiffRecord[]> {
    return prisma().scoreDiffRecord.findMany({
      where: {
        tenantId,
        createdAt: {
          ...(opts.from ? { gte: opts.from } : {}),
          ...(opts.to ? { lte: opts.to } : {}),
        },
      },
      orderBy: { createdAt: 'desc' },
      take: opts.take,
    });
  }

  /** 查询某 Analysis 的全部差异记录 */
  async findByAnalysis(analysisId: string): Promise<ScoreDiffRecord[]> {
    return prisma().scoreDiffRecord.findMany({
      where: { analysisId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** 统计租户内记录数(管理后台看板用) */
  async countByTenant(tenantId: string): Promise<number> {
    return prisma().scoreDiffRecord.count({ where: { tenantId } });
  }

  /** 管理后台跨租户查询(时间倒序,可按时间范围过滤) */
  async listAll(opts: { from?: Date; to?: Date; take?: number } = {}): Promise<ScoreDiffRecord[]> {
    return prisma().scoreDiffRecord.findMany({
      where: {
        createdAt: {
          ...(opts.from ? { gte: opts.from } : {}),
          ...(opts.to ? { lte: opts.to } : {}),
        },
      },
      orderBy: { createdAt: 'desc' },
      take: opts.take,
    });
  }
}

export const scoreDiffRepository = new ScoreDiffRepository();
