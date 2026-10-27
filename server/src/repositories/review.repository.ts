// ============================================================
// 评审记录 Repository(Phase 5)
// 对应文档:new-features-design.md §1.6, §3.2
// 多租户:通过 Analysis.tenantId 间接隔离(查 Analysis 后再查 Review)
// ============================================================

import type { Prisma, ReviewRecord } from '@prisma/client';
import { prisma } from '../config/prisma.js';

export class ReviewRepository {
  /**
   * 创建评审记录
   * 注:scores 为 JSON 字段,直接传对象
   */
  async create(data: Prisma.ReviewRecordUncheckedCreateInput): Promise<ReviewRecord> {
    return prisma().reviewRecord.create({ data });
  }

  /**
   * 按 ID 查询评审记录(全局,用于详情)
   */
  async findById(id: string): Promise<ReviewRecord | null> {
    return prisma().reviewRecord.findUnique({
      where: { id },
    });
  }

  /**
   * 查询某 Analysis 下所有评审记录(含 draft/submitted/superseded)
   * 多租户:由 service 层先校验 Analysis 归属租户
   */
  async findByAnalysis(analysisId: string): Promise<ReviewRecord[]> {
    return prisma().reviewRecord.findMany({
      where: { analysisId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * 批量查询多个 Analysis 的评审记录(按创建时间升序)
   * 用于班级学生作品列表聚合,避免逐条查询产生 N+1
   * 多租户:由 service 层先校验 Analysis 归属租户(此处仅按 analysisId IN 过滤)
   */
  async findByAnalysisIds(analysisIds: string[]): Promise<ReviewRecord[]> {
    if (analysisIds.length === 0) return [];
    return prisma().reviewRecord.findMany({
      where: { analysisId: { in: analysisIds } },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * 查询某 Analysis 下已提交的评审记录(submitted,用于争议判定)
   */
  async listSubmittedByAnalysis(analysisId: string): Promise<ReviewRecord[]> {
    return prisma().reviewRecord.findMany({
      where: { analysisId, status: 'submitted' },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * 更新评审记录状态(用于仲裁后标记 superseded)
   */
  async updateStatus(id: string, status: 'draft' | 'submitted' | 'superseded'): Promise<ReviewRecord> {
    return prisma().reviewRecord.update({
      where: { id },
      data: { status },
    });
  }
}

export const reviewRepository = new ReviewRepository();
