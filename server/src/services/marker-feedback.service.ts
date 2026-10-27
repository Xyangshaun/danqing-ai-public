// ============================================================
// 标注反馈 Service(反馈闭环 Phase 4 批次②/数据飞轮)
// 对应 API:POST /analyses/:id/marker-feedback
// 用户对 AI issueMarker 的"有用/没用"反馈,积累供未来训练专属评审模型(spec §7.3 第 1 项)
//
// 设计要点:
//   - 归属校验照 getAnalysis 先例:跨租户/学生查他人 → 统一 404(不泄露存在性)
//   - marker 定位:markerId 优先(批次①后新数据),markerIndex 兜底(旧数据);
//     二者都无效 → 404(宁缺勿滥,防反馈悬挂)
//   - markerSnapshot 固化反馈时点全特征(先例:ScoreDiffRecord.aiScore),
//     防 result 变更导致反馈与实际标注失联
//   - marker 定位与快照固化复用 marker-locator(批次③教师批注同语义,防两处漂移)
//   - upsert 语义:同用户同 marker 仅一条,切换 up/down 走 update
//   - 审计:结构化日志仅记 id/索引/动作,不记快照内容
// ============================================================

import { BusinessError } from '../middlewares/error-handler.js';
import { ErrorCode } from '../types/api-contract.js';
import { logger } from '../utils/logger.js';
import { canReadTenantWide } from '../config/permissions.js';
import type { UserRole } from '@prisma/client';
import { analysisRepository } from '../repositories/analysis.repository.js';
import { markerFeedbackRepository } from '../repositories/marker-feedback.repository.js';
import { extractMarkers, locateMarker, buildMarkerSnapshot } from './marker-locator.js';

/** 反馈请求体(经 controller Zod 校验后) */
export interface MarkerFeedbackInput {
  /** marker 稳定 ID(批次①后新数据;可选) */
  markerId?: string;
  /** marker 在 issueMarkers 数组中的原始索引 */
  markerIndex: number;
  /** 反馈动作:up=有用/认同,down=没用/不准确 */
  action: 'up' | 'down';
}

export class MarkerFeedbackService {
  /**
   * 提交/更新一条标注反馈(upsert)
   *
   * 校验链:租户归属 → ownership(student 仅自己) → status=success → marker 定位
   * @throws BusinessError 404 ANALYSIS_NOT_FOUND(不存在/越权)
   * @throws BusinessError 400 ANALYSIS_NOT_COMPLETED(未完成分析)
   * @throws BusinessError 404 MARKER_NOT_FOUND(索引越界/markerId 无匹配)
   */
  async createMarkerFeedback(params: {
    tenantId: string;
    userId: string;
    role: UserRole;
    analysisId: string;
    input: MarkerFeedbackInput;
  }): Promise<{ markerIndex: number; markerId: string | null; action: 'up' | 'down' }> {
    const { tenantId, userId, role, analysisId, input } = params;

    // 1. 归属校验(照 getAnalysis 先例:统一 404 不泄露存在性)
    const analysis = await analysisRepository.findById(tenantId, analysisId);
    if (!analysis) {
      throw new BusinessError(ErrorCode.ANALYSIS_NOT_FOUND, '分析记录不存在', 404);
    }
    if (!canReadTenantWide(role) && analysis.userId !== userId) {
      throw new BusinessError(ErrorCode.ANALYSIS_NOT_FOUND, '分析记录不存在', 404);
    }

    // 2. 状态校验:仅成功分析可反馈(失败/处理中的结果无标注)
    if (analysis.status !== 'success') {
      throw new BusinessError(ErrorCode.ANALYSIS_NOT_COMPLETED, '分析尚未完成,无法反馈', 400);
    }

    // 3. marker 定位:markerId 优先,markerIndex 兜底(共享 marker-locator)
    const markers = extractMarkers(analysis);
    if (markers.length === 0) {
      throw new BusinessError(ErrorCode.MARKER_NOT_FOUND, '该分析无标注数据', 404);
    }

    const located = locateMarker(markers, { markerId: input.markerId, markerIndex: input.markerIndex });
    if (!located) {
      throw new BusinessError(ErrorCode.MARKER_NOT_FOUND, '标注不存在或已变更', 404);
    }

    // 4. 快照固化 + upsert(同用户同 marker 仅一条,切换动作走 update)
    const snapshot = buildMarkerSnapshot(located.marker);
    const saved = await markerFeedbackRepository.upsert({
      tenantId,
      userId,
      analysisId,
      markerId: located.marker.id ?? null,
      markerIndex: located.markerIndex,
      action: input.action,
      markerSnapshot: snapshot,
      workType: analysis.workType ?? null,
      // 分析时的诊断模式(教学/考试)进训练特征——非反馈自身产生,无循环依赖
      diagnosisMode: analysis.diagnosisMode,
    });

    // 审计日志:结构化仅记关键位,不记快照内容(照 report.service 先例)
    logger.info(
      {
        feedbackId: saved.id,
        analysisId,
        userId,
        markerIndex: located.markerIndex,
        action: input.action,
      },
      '[marker-feedback] saved',
    );

    return { markerIndex: located.markerIndex, markerId: saved.markerId, action: input.action };
  }
}

export const markerFeedbackService = new MarkerFeedbackService();
