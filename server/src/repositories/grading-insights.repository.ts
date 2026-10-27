// ============================================================
// 教学行为画像 Repository(反馈闭环 Phase 5 批次③)
// 对应模型:TeacherAnnotation / MarkerFeedback / ProfileSuggestionAdoption
// 对应 API:
//   GET /grading-profiles/insights/teacher        (本人画像聚合)
//   GET /grading-profiles/:id/insights/suggestion (租户建议聚合)
//   POST /grading-profiles/:id/suggestion-adoptions(采纳记录)
//
// 职责:纯数据访问(findMany + create);聚合换算在 service/engine
// 路线决策:ORM findMany + 内存聚合(照批次① feedback-stats 模式,
//   刻意避开 $queryRaw 保 mock 单测能力;画像数据量小,毫秒级)
// ============================================================

import type { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma.js';

export class GradingInsightsRepository {
  /**
   * 查询教师批注(画像聚合原始行)
   * @param tenantId 租户隔离
   * @param teacherId 可选:指定教师(本人画像);缺省=本租户全部教师(租户聚合)
   */
  async findAnnotations(
    tenantId: string,
    teacherId?: string,
  ): Promise<
    Array<{
      teacherId: string;
      analysisId: string;
      action: string;
      createdAt: Date;
    }>
  > {
    const where: Prisma.TeacherAnnotationWhereInput = { tenantId };
    if (teacherId) where.teacherId = teacherId;
    return prisma().teacherAnnotation.findMany({
      where,
      select: {
        teacherId: true,
        analysisId: true,
        action: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * 查询租户学生 marker 反馈(action 投影;建议聚合的邻接一致信号)
   */
  async findStudentFeedbacks(tenantId: string): Promise<Array<{ action: string }>> {
    return prisma().markerFeedback.findMany({
      where: { tenantId },
      select: { action: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * 查询档案的采纳记录(防重复过滤 + 采纳历史展示)
   */
  async findAdoptions(
    profileId: string,
  ): Promise<
    Array<{
      id: string;
      tenantId: string;
      teacherId: string;
      profileId: string;
      suggestionKey: string;
      beforeValue: number;
      afterValue: number;
      suggestionBasis: Prisma.JsonValue;
      createdAt: Date;
    }>
  > {
    return prisma().profileSuggestionAdoption.findMany({
      where: { profileId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * 查询教师在租户内的采纳历史(本人画像页展示;Phase 5 批次④)
   */
  async findAdoptionsByTeacher(
    tenantId: string,
    teacherId: string,
  ): Promise<
    Array<{
      id: string;
      tenantId: string;
      teacherId: string;
      profileId: string;
      suggestionKey: string;
      beforeValue: number;
      afterValue: number;
      suggestionBasis: Prisma.JsonValue;
      createdAt: Date;
    }>
  > {
    return prisma().profileSuggestionAdoption.findMany({
      where: { tenantId, teacherId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * 落库采纳记录(建议一致性与防重复由 service 层校验后调用)
   */
  async createAdoption(data: {
    tenantId: string;
    teacherId: string;
    profileId: string;
    suggestionKey: string;
    beforeValue: number;
    afterValue: number;
    suggestionBasis: Prisma.InputJsonValue;
  }): Promise<{
    id: string;
    tenantId: string;
    teacherId: string;
    profileId: string;
    suggestionKey: string;
    beforeValue: number;
    afterValue: number;
    suggestionBasis: Prisma.JsonValue;
    createdAt: Date;
  }> {
    return prisma().profileSuggestionAdoption.create({ data });
  }
}

export const gradingInsightsRepository = new GradingInsightsRepository();
