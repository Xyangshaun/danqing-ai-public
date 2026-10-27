// ============================================================
// 组织内分享业务服务(报告导出+组织分享特性)
// 对应文档:.trae/specs/report-export-org-share/spec.md §5
//
// 职责:
//   1. 分享/取消分享作品到组织动态流(仅自己的作品,幂等)
//   2. 组织动态流分页查询(置顶优先 + 时间倒序 + 类型筛选)
//   3. 置顶/取消置顶(share:manage)
//   4. 评论 CRUD(所有角色可发;删除他人需 share:manage)
//   5. 通知触发(分享→教师;评论→分享者)
//
// 安全约束:
//   - 多租户隔离:所有查询经 tenantId 过滤,跨租户返回 404(不泄露存在性)
//   - 仅可分享 status=success 的自己的分析记录
//   - 同一作品同一用户仅可分享一次(前置检查返回 409 友好文案)
// ============================================================

import { shareRepository, type SharedWorkWithRelations } from '../repositories/share.repository.js';
import { analysisRepository } from '../repositories/analysis.repository.js';
import { userRepository } from '../repositories/user.repository.js';
import { notificationService } from './notification.service.js';
import { BusinessError } from '../middlewares/error-handler.js';
import { hasPermission } from '../config/permissions.js';
import {
  ErrorCode,
  type UserRole,
  type SharedWorkItem,
  type ShareCommentItem,
  type ListOrgFeedResponse,
} from '../types/api-contract.js';
import type { ShareComment } from '@prisma/client';
import { logger } from '../utils/logger.js';

class ShareServiceClass {
  // ============================================================
  // 分享 / 取消分享
  // ============================================================

  /**
   * 分享作品到组织动态流
   * @param analysisId 分析任务 ID
   * @param tenantId 租户 ID(强制隔离)
   * @param userId 分享者 ID(仅可分享自己的作品)
   * @param caption 分享感言(可选)
   */
  async shareAnalysis(
    analysisId: string,
    tenantId: string,
    userId: string,
    caption?: string,
  ): Promise<SharedWorkItem> {
    // 1. 校验分析归属租户(多租户隔离)
    const analysis = await analysisRepository.findById(tenantId, analysisId);
    if (!analysis) {
      throw new BusinessError(ErrorCode.ANALYSIS_NOT_FOUND, '分析任务不存在', 404);
    }

    // 2. 仅可分享自己的作品
    if (analysis.userId !== userId) {
      throw new BusinessError(ErrorCode.FORBIDDEN, '仅可分享自己的作品', 403);
    }

    // 3. 仅可分享分析成功的作品(失败/处理中作品无可分享结果)
    if (analysis.status !== 'success') {
      throw new BusinessError(
        ErrorCode.PARAM_INVALID,
        '仅可分享已完成分析的作品',
        400,
      );
    }

    // 4. 幂等前置检查:同一作品同一用户仅可分享一次
    const existing = await shareRepository.findByAnalysisAndUser(tenantId, analysisId, userId);
    if (existing) {
      throw new BusinessError(ErrorCode.SHARE_ALREADY_EXISTS, '该作品已分享,请勿重复分享', 409);
    }

    // 5. 创建分享记录
    const shared = await shareRepository.create({
      tenantId,
      analysisId,
      userId,
      caption: caption ?? null,
    });

    logger.info(
      { sharedWorkId: shared.id, analysisId, tenantId, userId },
      '[share] work shared to org feed',
    );

    // 6. 异步通知租户内教师/管理员:有新作品分享(不阻塞主流程)
    this.notifyTeachersOnShare(tenantId, userId, analysis.title, shared.id).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(
        { err: msg, sharedWorkId: shared.id, tenantId },
        '[share] notify teachers failed (non-blocking)',
      );
    });

    return this.toSharedWorkItem(shared);
  }

  /**
   * 取消分享(仅分享者本人)
   * 教师删除他人分享走 deleteSharedWork(share:manage)
   */
  async unshareAnalysis(analysisId: string, tenantId: string, userId: string): Promise<void> {
    const existing = await shareRepository.findByAnalysisAndUser(tenantId, analysisId, userId);
    if (!existing) {
      throw new BusinessError(ErrorCode.SHARE_NOT_FOUND, '分享记录不存在', 404);
    }
    await shareRepository.delete(existing.id);
    logger.info(
      { sharedWorkId: existing.id, analysisId, tenantId, userId },
      '[share] work unshared',
    );
  }

  /**
   * 删除分享记录(share:manage,可删除他人分享;本人亦可)
   * tenantId 可选:教师/admin/owner 跨租户协作时传 undefined 则不按租户过滤
   */
  async deleteSharedWork(
    tenantId: string | undefined,
    sharedWorkId: string,
    userId: string,
    role: UserRole,
  ): Promise<void> {
    const shared = await shareRepository.findById(tenantId, sharedWorkId);
    if (!shared) {
      throw new BusinessError(ErrorCode.SHARE_NOT_FOUND, '分享记录不存在', 404);
    }
    // 本人可删;非本人需 share:manage 权限
    if (shared.userId !== userId && !hasPermission(role, 'share:manage')) {
      throw new BusinessError(ErrorCode.FORBIDDEN, '权限不足', 403);
    }
    await shareRepository.delete(sharedWorkId);
    logger.info(
      { sharedWorkId, tenantId, operatorId: userId, ownerId: shared.userId },
      '[share] shared work deleted',
    );
  }

  // ============================================================
  // 组织动态流
  // ============================================================

  /**
   * 组织动态流分页查询(tenantId 可选:教师/admin/owner 跨租户协作时传 undefined 则全局可见;学生仍严格隔离)
   */
  async listOrgFeed(
    tenantId: string | undefined,
    page: number,
    pageSize: number,
    workType?: string,
  ): Promise<ListOrgFeedResponse> {
    const { items, total } = await shareRepository.listByTenant(tenantId, page, pageSize, workType);
    return {
      items: items.map((item) => this.toSharedWorkItem(item)),
      total,
      page,
      pageSize,
      hasMore: page * pageSize < total,
    };
  }

  // ============================================================
  // 置顶(share:manage)
  // ============================================================

  /**
   * 置顶/取消置顶(tenantId 可选:教师/admin/owner 跨租户协作时传 undefined 则不按租户过滤)
   */
  async setPinned(
    tenantId: string | undefined,
    sharedWorkId: string,
    isPinned: boolean,
  ): Promise<{ id: string; isPinned: boolean }> {
    const shared = await shareRepository.findById(tenantId, sharedWorkId);
    if (!shared) {
      throw new BusinessError(ErrorCode.SHARE_NOT_FOUND, '分享记录不存在', 404);
    }
    await shareRepository.updatePinned(sharedWorkId, isPinned);
    logger.info(
      { sharedWorkId, tenantId, isPinned },
      '[share] pin status updated',
    );
    return { id: sharedWorkId, isPinned };
  }

  // ============================================================
  // 评论
  // ============================================================

  /**
   * 发表评论(所有角色;tenantId 可选:教师/admin/owner 跨租户协作时传 undefined 则不按租户过滤)
   */
  async createComment(
    tenantId: string | undefined,
    sharedWorkId: string,
    userId: string,
    content: string,
  ): Promise<ShareCommentItem> {
    // 1. 校验动态归属租户
    const shared = await shareRepository.findById(tenantId, sharedWorkId);
    if (!shared) {
      throw new BusinessError(ErrorCode.SHARE_NOT_FOUND, '分享记录不存在', 404);
    }

    // 2. 写入评论
    const comment = await shareRepository.createComment({
      sharedWorkId,
      userId,
      content,
    });

    logger.info(
      { commentId: comment.id, sharedWorkId, tenantId, userId },
      '[share] comment created',
    );

    // 3. 异步通知分享者(评论者非本人时)
    // 通知归属以分享作品实际所属租户为准(跨租户协作时 tenantId 可能为 undefined)
    if (shared.userId !== userId) {
      this.notifyOwnerOnComment(shared.tenantId, shared, comment.id).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(
          { err: msg, commentId: comment.id, sharedWorkId },
          '[share] notify owner failed (non-blocking)',
        );
      });
    }

    // 4. 查询评论者信息组装返回
    const commenter = await userRepository.findById(userId);
    return this.toCommentItem(comment, commenter);
  }

  /**
   * 评论列表(完整,时间升序;tenantId 可选:教师/admin/owner 跨租户协作时传 undefined 则不按租户过滤)
   */
  async listComments(tenantId: string | undefined, sharedWorkId: string): Promise<ShareCommentItem[]> {
    const shared = await shareRepository.findById(tenantId, sharedWorkId);
    if (!shared) {
      throw new BusinessError(ErrorCode.SHARE_NOT_FOUND, '分享记录不存在', 404);
    }
    const comments = await shareRepository.listComments(sharedWorkId);
    return comments.map((c) => this.toCommentItem(c, c.user));
  }

  /**
   * 删除评论(本人可删;非本人需 share:manage;tenantId 可选:教师/admin/owner 跨租户协作时传 undefined 则不按租户过滤)
   */
  async deleteComment(
    tenantId: string | undefined,
    sharedWorkId: string,
    commentId: string,
    userId: string,
    role: UserRole,
  ): Promise<void> {
    // 1. 校验动态归属租户
    const shared = await shareRepository.findById(tenantId, sharedWorkId);
    if (!shared) {
      throw new BusinessError(ErrorCode.SHARE_NOT_FOUND, '分享记录不存在', 404);
    }
    // 2. 校验评论归属该动态
    const comment = await shareRepository.findCommentById(commentId);
    if (!comment || comment.sharedWorkId !== sharedWorkId) {
      throw new BusinessError(ErrorCode.SHARE_COMMENT_NOT_FOUND, '评论不存在', 404);
    }
    // 3. 本人可删;非本人需 share:manage
    if (comment.userId !== userId && !hasPermission(role, 'share:manage')) {
      throw new BusinessError(ErrorCode.FORBIDDEN, '权限不足', 403);
    }
    await shareRepository.deleteComment(commentId);
    logger.info(
      { commentId, sharedWorkId, tenantId, operatorId: userId },
      '[share] comment deleted',
    );
  }

  // ============================================================
  // 私有:通知触发(异步,不阻塞主流程)
  // ============================================================

  /**
   * 分享 → 通知租户内教师/管理员(排除分享者本人)
   */
  private async notifyTeachersOnShare(
    tenantId: string,
    sharerId: string,
    workTitle: string | null,
    sharedWorkId: string,
  ): Promise<void> {
    const sharer = await userRepository.findById(sharerId);
    const sharerName = sharer?.name ?? '同学';
    const teachers = await userRepository.listByTenantAndRoles(tenantId, ['teacher', 'admin', 'owner']);
    const targets = teachers.filter((t) => t.id !== sharerId);
    await Promise.all(
      targets.map((t) =>
        notificationService.createNotification({
          tenantId,
          userId: t.id,
          type: 'SHARE',
          title: '有新作品分享到组织',
          content: `${sharerName} 分享了作品《${workTitle ?? '未命名作品'}》,快去点评吧`,
          level: 'INFO',
          linkUrl: `/org/feed`,
          metadata: { sharedWorkId, sharerId },
        }),
      ),
    );
  }

  /**
   * 评论 → 通知分享者
   */
  private async notifyOwnerOnComment(
    tenantId: string,
    shared: SharedWorkWithRelations,
    commentId: string,
  ): Promise<void> {
    const comment = await shareRepository.findCommentById(commentId);
    if (!comment) return;
    const commenter = await userRepository.findById(comment.userId);
    const commenterName = commenter?.name ?? '有人';
    await notificationService.createNotification({
      tenantId,
      userId: shared.userId,
      type: 'COMMENT',
      title: '作品收到新点评',
      content: `${commenterName} 点评了你分享的作品《${shared.analysis.title ?? '未命名作品'}》`,
      level: 'INFO',
      linkUrl: `/org/feed`,
      metadata: { sharedWorkId: shared.id, commentId },
    });
  }

  // ============================================================
  // 私有:视图组装
  // ============================================================

  private toSharedWorkItem(item: SharedWorkWithRelations): SharedWorkItem {
    return {
      id: item.id,
      caption: item.caption,
      isPinned: item.isPinned,
      analysis: {
        id: item.analysis.id,
        workType: item.analysis.workType,
        imageUrl: item.analysis.imageUrl,
        title: item.analysis.title,
        overallScore: item.analysis.overallScore,
        status: item.analysis.status,
        createdAt: item.analysis.createdAt.toISOString(),
      },
      user: {
        id: item.user.id,
        name: item.user.name,
        avatar: item.user.avatar,
        role: item.user.role,
      },
      commentCount: item._count.comments,
      // recentComments 按时间倒序取 3 条;展示时翻转为升序更符合阅读习惯
      recentComments: item.comments
        .map((c) => this.toCommentItem(c, c.user))
        .reverse(),
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    };
  }

  private toCommentItem(
    comment: ShareComment,
    user: { id: string; name: string; avatar: string; role: UserRole } | null,
  ): ShareCommentItem {
    return {
      id: comment.id,
      sharedWorkId: comment.sharedWorkId,
      content: comment.content,
      user: user
        ? { id: user.id, name: user.name, avatar: user.avatar, role: user.role }
        : { id: comment.userId, name: '已注销用户', avatar: '', role: 'student' },
      createdAt: comment.createdAt.toISOString(),
    };
  }
}

export const shareService = new ShareServiceClass();
