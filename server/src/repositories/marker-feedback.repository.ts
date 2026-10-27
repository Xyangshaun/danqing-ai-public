// ============================================================
// 标注反馈 Repository(反馈闭环 Phase 4 批次②/数据飞轮)
// 对应模型:prisma MarkerFeedback(marker_feedbacks)
// 对应 API:POST /analyses/:id/marker-feedback
//
// 职责:纯数据访问(唯一 upsert + 按 analysis 聚合查询留后续统计)
// 多租户:tenantId 由 service 层校验后传入,写入时固化(照 Report 先例)
// ============================================================

import type { MarkerFeedback, Prisma } from '@prisma/client';
import { prisma } from '../config/prisma.js';

export class MarkerFeedbackRepository {
  /**
   * upsert 一条反馈(同用户同 marker 仅一条,切换 up/down 走 update)
   * 唯一键:analysisId + userId + markerIndex(schema @@unique)
   */
  async upsert(params: {
    tenantId: string;
    userId: string;
    analysisId: string;
    markerId: string | null;
    markerIndex: number;
    action: string;
    markerSnapshot: Prisma.InputJsonValue;
    workType: string | null;
    diagnosisMode: string | null;
  }): Promise<MarkerFeedback> {
    return prisma().markerFeedback.upsert({
      where: {
        analysisId_userId_markerIndex: {
          analysisId: params.analysisId,
          userId: params.userId,
          markerIndex: params.markerIndex,
        },
      },
      update: {
        // 切换反馈动作时同步刷新 markerId(旧数据首评无 id,补评带 id)
        action: params.action,
        markerId: params.markerId,
        markerSnapshot: params.markerSnapshot,
      },
      create: {
        tenantId: params.tenantId,
        userId: params.userId,
        analysisId: params.analysisId,
        markerId: params.markerId,
        markerIndex: params.markerIndex,
        action: params.action,
        markerSnapshot: params.markerSnapshot,
        workType: params.workType,
        diagnosisMode: params.diagnosisMode,
      },
    });
  }
}

export const markerFeedbackRepository = new MarkerFeedbackRepository();
