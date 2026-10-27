// ============================================================
// 教师批注 Service(反馈闭环 Phase 4 批次③)
// 对应 API(嵌套在 /analyses/:id 下,挂 review.routes):
//   GET    /analyses/:id/annotations        列出批注(review:read)
//   POST   /analyses/:id/annotations        创建批注(review:write)
//   PATCH  /analyses/:id/annotations/:aid   更新批注(仅作者本人)
//   DELETE /analyses/:id/annotations/:aid   删除批注(仅作者本人)
//
// 设计要点:
//   - 归属校验照 marker-feedback.service 先例:跨租户/student 查他人 → 统一 404
//   - marker 定位与快照固化复用 marker-locator(与数据飞轮语义一致)
//   - 重复批注(同教师同 marker)→ 409 DUPLICATE_RESOURCE,修改走 PATCH
//   - 更新/删除:批注不存在/跨租户/跨分析错位/非本人 → 统一 404 ANNOTATION_NOT_FOUND
//   - 通知学生照 review.service 先例(type REVIEW,非阻塞失败仅告警);
//     更新/删除不再通知(仅首次创建触达)
// ============================================================

import { BusinessError } from '../middlewares/error-handler.js';
import { ErrorCode } from '../types/api-contract.js';
import { logger } from '../utils/logger.js';
import { canReadTenantWide } from '../config/permissions.js';
import type { UserRole } from '@prisma/client';
import { analysisRepository } from '../repositories/analysis.repository.js';
import { userRepository } from '../repositories/user.repository.js';
import { teacherAnnotationRepository } from '../repositories/teacher-annotation.repository.js';
import { notificationService } from './notification.service.js';
import { extractMarkers, locateMarker, buildMarkerSnapshot } from './marker-locator.js';
import type { TeacherAnnotation } from '@prisma/client';

/** 批注动作(与 schema TeacherAnnotation.action 对齐) */
export type TeacherAnnotationAction = 'supplement' | 'correct' | 'confirm' | 'reject';

/** 创建/更新请求体(经 controller Zod 校验后) */
export interface TeacherAnnotationInput {
  markerId?: string;
  markerIndex: number;
  action: TeacherAnnotationAction;
  comment: string;
}

/** 批注摘要(API 契约;含教师姓名冗余) */
export interface TeacherAnnotationSummary {
  id: string;
  analysisId: string;
  teacherId: string;
  teacherName: string | null;
  markerId: string | null;
  markerIndex: number;
  action: TeacherAnnotationAction;
  comment: string;
  createdAt: string;
  updatedAt: string;
}

export class TeacherAnnotationService {
  /**
   * 列出某分析的全部批注
   * 权限:GET 挂 review:read(租户内所有角色);student 仅可读自己作品的批注
   * @throws BusinessError 404 ANALYSIS_NOT_FOUND(不存在/跨租户/student 查他人)
   */
  async listAnnotations(params: {
    tenantId: string;
    userId: string;
    role: UserRole;
    analysisId: string;
  }): Promise<TeacherAnnotationSummary[]> {
    const analysis = await this.getOwnedAnalysis(params.tenantId, params.analysisId, params.userId, params.role);
    void analysis; // 归属已校验(列表不消费内容)
    const records = await teacherAnnotationRepository.findByAnalysis(params.analysisId);
    return Promise.all(records.map((r) => this.toSummary(r)));
  }

  /**
   * 创建批注(同教师同 marker 仅一条,重复 → 409)
   * @throws BusinessError 404 ANALYSIS_NOT_FOUND / 400 ANALYSIS_NOT_COMPLETED /
   *                       404 MARKER_NOT_FOUND / 409 DUPLICATE_RESOURCE
   */
  async createAnnotation(params: {
    tenantId: string;
    teacherId: string;
    analysisId: string;
    input: TeacherAnnotationInput;
  }): Promise<TeacherAnnotationSummary> {
    const { tenantId, teacherId, analysisId, input } = params;

    // 1. 归属校验(review:write 已限 teacher/admin/owner,canReadTenantWide 必为 true,
    //    此处统一走 getOwnedAnalysis 保持口径一致)
    const analysis = await analysisRepository.findById(tenantId, analysisId);
    if (!analysis) {
      throw new BusinessError(ErrorCode.ANALYSIS_NOT_FOUND, '分析记录不存在', 404);
    }

    // 2. 状态校验:仅成功分析可批注(失败/处理中的结果无标注)
    if (analysis.status !== 'success') {
      throw new BusinessError(ErrorCode.ANALYSIS_NOT_COMPLETED, '分析尚未完成,无法批注', 400);
    }

    // 3. marker 定位(与数据飞轮同语义:markerId 优先/markerIndex 兜底)
    const markers = extractMarkers(analysis);
    if (markers.length === 0) {
      throw new BusinessError(ErrorCode.MARKER_NOT_FOUND, '该分析无标注数据', 404);
    }
    const located = locateMarker(markers, { markerId: input.markerId, markerIndex: input.markerIndex });
    if (!located) {
      throw new BusinessError(ErrorCode.MARKER_NOT_FOUND, '标注不存在或已变更', 404);
    }

    // 4. 查重(同教师同 marker 已批注 → 409,修改走 PATCH)
    const existing = await teacherAnnotationRepository.findByUniqueKey({
      analysisId,
      markerIndex: located.markerIndex,
      teacherId,
    });
    if (existing) {
      throw new BusinessError(ErrorCode.DUPLICATE_RESOURCE, '该标注已有您的批注,请直接编辑', 409);
    }

    // 5. 落库(快照固化防标注漂移)
    const record = await teacherAnnotationRepository.create({
      tenantId,
      analysisId,
      teacherId,
      markerId: located.marker.id ?? null,
      markerIndex: located.markerIndex,
      action: input.action,
      comment: input.comment,
      markerSnapshot: buildMarkerSnapshot(located.marker),
    });

    logger.info(
      { annotationId: record.id, analysisId, teacherId, markerIndex: located.markerIndex, action: input.action },
      '[teacher-annotation] created',
    );

    // 6. 异步通知作品所有者(非阻塞,失败仅告警;照 review.service 先例)
    notificationService
      .createNotification({
        tenantId,
        userId: analysis.userId,
        type: 'REVIEW',
        title: '作品收到教师批注',
        content: `您的作品《${analysis.title ?? '未命名作品'}》收到标注级批注`,
        level: 'INFO',
        linkUrl: `/analysis/${analysisId}`,
        metadata: {
          annotationId: record.id,
          analysisId,
          markerIndex: located.markerIndex,
          action: input.action,
        },
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(
          { err: msg, annotationId: record.id, analysisId, ownerId: analysis.userId },
          '[teacher-annotation] create notification failed (non-blocking)',
        );
      });

    return this.toSummary(record);
  }

  /**
   * 更新批注(仅作者本人;action/comment 可改,定位键与快照不可改)
   * @throws BusinessError 404 ANNOTATION_NOT_FOUND(不存在/跨租户/跨分析错位/非本人)
   */
  async updateAnnotation(params: {
    tenantId: string;
    teacherId: string;
    analysisId: string;
    annotationId: string;
    input: { action?: TeacherAnnotationAction; comment?: string };
  }): Promise<TeacherAnnotationSummary> {
    const record = await this.getOwnedAnnotation(params);

    // Zod optional:undefined=未提供,仅更新显式字段(action/comment,定位键不可改)
    const updated = await teacherAnnotationRepository.update(record.id, {
      ...(params.input.action !== undefined ? { action: params.input.action } : {}),
      ...(params.input.comment !== undefined ? { comment: params.input.comment } : {}),
    });

    logger.info(
      { annotationId: record.id, analysisId: params.analysisId, teacherId: params.teacherId },
      '[teacher-annotation] updated',
    );
    return this.toSummary(updated);
  }

  /**
   * 删除批注(仅作者本人)
   * @throws BusinessError 404 ANNOTATION_NOT_FOUND(不存在/跨租户/跨分析错位/非本人)
   */
  async deleteAnnotation(params: {
    tenantId: string;
    teacherId: string;
    analysisId: string;
    annotationId: string;
  }): Promise<void> {
    const record = await this.getOwnedAnnotation(params);
    await teacherAnnotationRepository.delete(record.id);
    logger.info(
      { annotationId: record.id, analysisId: params.analysisId, teacherId: params.teacherId },
      '[teacher-annotation] deleted',
    );
  }

  // ============================================================
  // 私有工具
  // ============================================================

  /** 归属校验(照 marker-feedback.service 先例:统一 404 不泄露存在性) */
  private async getOwnedAnalysis(
    tenantId: string,
    analysisId: string,
    userId: string,
    role: UserRole,
  ) {
    const analysis = await analysisRepository.findById(tenantId, analysisId);
    if (!analysis) {
      throw new BusinessError(ErrorCode.ANALYSIS_NOT_FOUND, '分析记录不存在', 404);
    }
    if (!canReadTenantWide(role) && analysis.userId !== userId) {
      throw new BusinessError(ErrorCode.ANALYSIS_NOT_FOUND, '分析记录不存在', 404);
    }
    return analysis;
  }

  /**
   * 批注归属校验(更新/删除前置):
   * 不存在/跨租户/跨分析错位(路径 :id 与记录 analysisId 不符)/非本人 → 统一 404
   */
  private async getOwnedAnnotation(params: {
    tenantId: string;
    teacherId: string;
    analysisId: string;
    annotationId: string;
  }): Promise<TeacherAnnotation> {
    const record = await teacherAnnotationRepository.findById(params.annotationId);
    if (
      !record ||
      record.tenantId !== params.tenantId ||
      record.analysisId !== params.analysisId ||
      record.teacherId !== params.teacherId
    ) {
      throw new BusinessError(ErrorCode.ANNOTATION_NOT_FOUND, '批注不存在或无权操作', 404);
    }
    return record;
  }

  /** DB 模型 → API 契约(教师姓名冗余,照 review.service.toSummary) */
  private async toSummary(r: TeacherAnnotation): Promise<TeacherAnnotationSummary> {
    const teacher = await userRepository.findById(r.teacherId);
    return {
      id: r.id,
      analysisId: r.analysisId,
      teacherId: r.teacherId,
      teacherName: teacher?.name ?? null,
      markerId: r.markerId,
      markerIndex: r.markerIndex,
      action: r.action as TeacherAnnotationAction,
      comment: r.comment,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }
}

export const teacherAnnotationService = new TeacherAnnotationService();
