// ============================================================
// 教师批注 Repository(反馈闭环 Phase 4 批次③)
// 对应模型:prisma TeacherAnnotation(teacher_annotations)
// 对应 API:
//   GET    /analyses/:id/annotations     列出该分析的批注(review:read)
//   POST   /analyses/:id/annotations     创建批注(review:write)
//   PATCH  /analyses/:id/annotations/:aid  更新批注(仅作者本人)
//   DELETE /analyses/:id/annotations/:aid  删除批注(仅作者本人)
//
// 职责:纯数据访问(create/findFirst 查重/findByAnalysis/update/delete)
// 多租户:tenantId 由 service 层校验后传入,写入时固化
// 复合唯一键:analysisId + markerIndex + teacherId(schema @@unique,
//   同教师同 marker 仅一条,修改走 update——重复 create 由 service 先查重报 409,
//   DB 唯一约束兜底并发)
// ============================================================

import type { TeacherAnnotation, Prisma } from '@prisma/client';
import { prisma } from '../config/prisma.js';

export class TeacherAnnotationRepository {
  /**
   * 创建一条批注(唯一键冲突由 DB 兜底;service 层已先查重报 409)
   */
  async create(params: {
    tenantId: string;
    analysisId: string;
    teacherId: string;
    markerId: string | null;
    markerIndex: number;
    action: string;
    comment: string;
    markerSnapshot: Prisma.InputJsonValue;
  }): Promise<TeacherAnnotation> {
    return prisma().teacherAnnotation.create({
      data: {
        tenantId: params.tenantId,
        analysisId: params.analysisId,
        teacherId: params.teacherId,
        markerId: params.markerId,
        markerIndex: params.markerIndex,
        action: params.action,
        comment: params.comment,
        markerSnapshot: params.markerSnapshot,
      },
    });
  }

  /**
   * 按复合唯一键查重(同教师同 marker 是否已批注)
   * mock findFirst/matchWhere 天然支持复合 where;真实 Prisma 同样支持
   */
  async findByUniqueKey(params: {
    analysisId: string;
    markerIndex: number;
    teacherId: string;
  }): Promise<TeacherAnnotation | null> {
    return prisma().teacherAnnotation.findFirst({
      where: {
        analysisId: params.analysisId,
        markerIndex: params.markerIndex,
        teacherId: params.teacherId,
      },
    });
  }

  /**
   * 列出某分析的全部批注(按创建时间升序,先批先展)
   */
  async findByAnalysis(analysisId: string): Promise<TeacherAnnotation[]> {
    return prisma().teacherAnnotation.findMany({
      where: { analysisId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** 按 id 查单条(更新/删除前置) */
  async findById(id: string): Promise<TeacherAnnotation | null> {
    return prisma().teacherAnnotation.findUnique({ where: { id } });
  }

  /** 更新批注内容(仅 action/comment;定位键与快照不可改) */
  async update(id: string, data: { action?: string; comment?: string }): Promise<TeacherAnnotation> {
    return prisma().teacherAnnotation.update({
      where: { id },
      data,
    });
  }

  /** 删除批注 */
  async delete(id: string): Promise<TeacherAnnotation> {
    return prisma().teacherAnnotation.delete({ where: { id } });
  }
}

export const teacherAnnotationRepository = new TeacherAnnotationRepository();
