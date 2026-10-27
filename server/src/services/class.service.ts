// ============================================================
// 班级管理业务服务(班级即租户 type='class')
// 对应 API:/api/v1/classes/*(契约 §3.20)
//
// 职责:
//   1. 班级创建/列表/详情(复用 Tenant + TenantMember 模型)
//   2. 班级邀请码(复用 invitationRepository,role 固定 student)
//   3. 学生作品查询(Analysis + ReviewRecord 聚合,强制 tenantId=班级 ID)
//   4. 教师打分(委托 reviewService.createReview,reviewerType 固定 professor)
//
// 安全约束:
//   - 所有班级操作先经 assertMembership 校验当前用户成员资格(403)
//   - 班级必须存在且 type='class'(404,不泄露其他类型租户存在性)
//   - Analysis 查询强制 tenantId=班级 ID,杜绝跨班级读取
//   - 打分通知由 reviewService.createReview 内置完成(非阻塞,复用 notificationService)
// ============================================================

import crypto from 'node:crypto';
import { classRepository } from '../repositories/class.repository.js';
import { tenantRepository } from '../repositories/tenant.repository.js';
import {
  invitationRepository,
  INVITATION_CODE_LENGTH,
} from '../repositories/invitation.repository.js';
import { analysisRepository } from '../repositories/analysis.repository.js';
import { reviewRepository } from '../repositories/review.repository.js';
import { reviewService } from './review.service.js';
import { BusinessError } from '../middlewares/error-handler.js';
import { logger } from '../utils/logger.js';
import {
  ErrorCode,
  type ClassSummary,
  type ClassDetailResponse,
  type ClassInvitationInfo,
  type ClassStudentWorkItem,
  type ClassStudentWorkReview,
  type CreateClassRequest,
  type CreateClassInvitationRequest,
  type ListClassStudentWorksQuery,
  type ListClassStudentWorksResponse,
  type ReviewRecordSummary,
  type ReviewScoresPayload,
  type SubmitClassReviewRequest,
  type TenantMemberInfo,
  type UserRole,
  type AnalysisDetail,
  type ClassMessageItem,
  type ClassMessageSnapshot,
  type ClassMessageType,
  type ListClassMessagesQuery,
  type ListClassMessagesResponse,
  type SendClassMessageRequest,
} from '../types/api-contract.js';
import type { AnalysisResult } from '../types/api-contract.js';
import type { Tenant, TenantMember, ReviewRecord, Analysis, ClassMessage, User } from '@prisma/client';

/** 班级默认席位上限 */
const CLASS_DEFAULT_MAX_SEATS = 50;
/** 班级邀请码默认最大使用次数 */
const INVITATION_DEFAULT_MAX_USES = 50;
/** 班级邀请码默认有效期(小时,168=7 天) */
const INVITATION_DEFAULT_EXPIRES_HOURS = 168;

class ClassServiceClass {
  // ============================================================
  // 班级创建 / 列表 / 详情
  // ============================================================

  /**
   * 创建班级
   * 创建者自动成为班级 teacher(事务保证原子性)
   *
   * @param userId 创建者用户 ID(从 JWT 注入)
   * @param body 请求体(Zod 已校验)
   */
  async createClass(userId: string, body: CreateClassRequest): Promise<ClassSummary> {
    const { tenant, membership } = await classRepository.createClassWithTeacher({
      name: body.name,
      description: body.description ?? null,
      teacherId: userId,
      maxSeats: CLASS_DEFAULT_MAX_SEATS,
    });

    logger.info(
      { classId: tenant.id, name: tenant.name, teacherId: userId },
      '[class] created',
    );

    return {
      id: tenant.id,
      name: tenant.name,
      description: tenant.description,
      role: membership.role as UserRole,
      memberCount: 1, // 创建时仅创建者一人
      maxSeats: tenant.maxSeats,
      status: tenant.status as ClassSummary['status'],
      joinedAt: membership.joinedAt.toISOString(),
      createdAt: tenant.createdAt.toISOString(),
    };
  }

  /**
   * 列出当前用户作为成员的所有班级(含成员数)
   */
  async listMyClasses(userId: string): Promise<ClassSummary[]> {
    const rows = await classRepository.listClassesByMember(userId);
    return rows.map((r) => ({
      id: r.tenant.id,
      name: r.tenant.name,
      description: r.tenant.description,
      role: r.membership.role as UserRole,
      memberCount: r.memberCount,
      maxSeats: r.tenant.maxSeats,
      status: r.tenant.status as ClassSummary['status'],
      joinedAt: r.membership.joinedAt.toISOString(),
      createdAt: r.tenant.createdAt.toISOString(),
    }));
  }

  /**
   * 班级详情 + 成员列表
   * 校验:班级存在(type='class') + 当前用户是班级成员
   */
  async getClassDetail(classId: string, userId: string): Promise<ClassDetailResponse> {
    const tenant = await this.assertClass(classId);
    await this.assertMembership(classId, userId);

    const members = await tenantRepository.listMembers(classId);
    const memberInfos: TenantMemberInfo[] = members.map((m) => ({
      userId: m.userId,
      tenantId: m.tenantId,
      role: m.role as UserRole,
      joinedAt: m.joinedAt.toISOString(),
      user: {
        id: m.user.id,
        name: m.user.name,
        avatar: m.user.avatar,
        email: m.user.email,
        feishuOpenId: m.user.feishuOpenId,
      },
    }));

    return {
      id: tenant.id,
      name: tenant.name,
      description: tenant.description,
      status: tenant.status as ClassDetailResponse['status'],
      maxSeats: tenant.maxSeats,
      memberCount: memberInfos.length,
      createdAt: tenant.createdAt.toISOString(),
      members: memberInfos,
    };
  }

  // ============================================================
  // 班级邀请码
  // ============================================================

  /**
   * 为班级生成邀请码(role 固定 student)
   * 校验:班级存在 + 当前用户是班级成员(写权限由路由层 review:write 保证)
   *
   * @param classId 班级 ID(路径参数 :id)
   * @param userId 当前用户 ID(创建人)
   * @param body 请求体(maxUses/expiresHours 可选,服务端给默认值)
   */
  async createClassInvitation(
    classId: string,
    userId: string,
    body: CreateClassInvitationRequest,
  ): Promise<ClassInvitationInfo> {
    await this.assertClass(classId);
    await this.assertMembership(classId, userId);

    const maxUses = body.maxUses ?? INVITATION_DEFAULT_MAX_USES;
    const expiresHours = body.expiresHours ?? INVITATION_DEFAULT_EXPIRES_HOURS;
    const code = this.generateInvitationCode();
    const expiresAt = new Date(Date.now() + expiresHours * 3600 * 1000);

    const invitation = await invitationRepository.create({
      code,
      tenantId: classId,
      role: 'student',
      maxUses,
      expiresAt,
      createdBy: userId,
    });

    logger.info(
      { invitationId: invitation.id, classId, userId, maxUses, expiresHours },
      '[class] invitation created',
    );

    return this.toInvitationInfo(invitation);
  }

  /**
   * 列出班级的所有邀请码(按创建时间倒序)
   */
  async listClassInvitations(classId: string, userId: string): Promise<ClassInvitationInfo[]> {
    await this.assertClass(classId);
    await this.assertMembership(classId, userId);

    const invitations = await invitationRepository.listByTenant(classId);
    return invitations.map((i) => this.toInvitationInfo(i));
  }

  // ============================================================
  // 学生作品查看 + 教师打分
  // ============================================================

  /**
   * 查看指定学生在班级中的作品/诊断列表(分页)
   * 校验链:班级存在 → 当前用户是成员 → 目标学生是成员
   * Analysis 强制 tenantId=班级 ID + userId=学生 ID 双过滤
   */
  async listStudentWorks(
    classId: string,
    studentId: string,
    requesterId: string,
    query: ListClassStudentWorksQuery,
  ): Promise<ListClassStudentWorksResponse> {
    await this.assertClass(classId);
    await this.assertMembership(classId, requesterId);
    await this.assertStudentMembership(classId, studentId);

    const page = query.page ?? 1;
    const pageSize = query.limit ?? 20;

    const { items, total } = await analysisRepository.list({
      tenantId: classId,
      userId: studentId,
      page,
      pageSize,
    });

    // 批量查询本页所有作品的评审记录(避免 N+1)
    const analysisIds = items.map((a) => a.id);
    const reviews = await reviewRepository.findByAnalysisIds(analysisIds);
    const reviewsByAnalysis = new Map<string, ReviewRecord[]>();
    for (const r of reviews) {
      const list = reviewsByAnalysis.get(r.analysisId) ?? [];
      list.push(r);
      reviewsByAnalysis.set(r.analysisId, list);
    }

    return {
      items: items.map((a) => this.toWorkItem(a, reviewsByAnalysis.get(a.id) ?? [])),
      total,
      page,
      pageSize,
      hasMore: page * pageSize < total,
    };
  }

  /**
   * 教师给学生作品打分
   * 校验链:班级存在 → 当前用户(教师)是成员 → 目标学生是成员 → 作品归属该班级且属于该学生
   * 委托 reviewService.createReview(内部复核 Analysis.tenantId + 校验评分 + 非阻塞通知学生)
   *
   * @param classId 班级 ID(即 Analysis.tenantId)
   * @param studentId 学生用户 ID(路径参数 :userId,用于归属校验)
   * @param analysisId 作品/分析 ID(路径参数 :analysisId)
   * @param reviewerId 教师用户 ID(从 JWT 注入)
   * @param body 请求体(reviewerType 固定 professor)
   */
  async submitClassReview(
    classId: string,
    studentId: string,
    analysisId: string,
    reviewerId: string,
    body: SubmitClassReviewRequest,
  ): Promise<ReviewRecordSummary> {
    await this.assertClass(classId);
    await this.assertMembership(classId, reviewerId);
    await this.assertStudentMembership(classId, studentId);

    // 作品归属校验:必须属于本班级且属于目标学生(不泄露跨班级/跨学生资源存在性)
    const analysis = await analysisRepository.findById(classId, analysisId);
    if (!analysis || analysis.userId !== studentId) {
      throw new BusinessError(ErrorCode.ANALYSIS_NOT_FOUND, '作品不存在或不属于该学生', 404);
    }

    // 委托评审服务:reviewerType 固定 professor(忽略客户端传入,双保险)
    // 通知学生在 reviewService.createReview 内部完成(非阻塞,复用 notificationService)
    const review = await reviewService.createReview(analysisId, classId, reviewerId, {
      reviewerType: 'professor',
      presetId: body.presetId,
      scores: body.scores,
      comment: body.comment,
      status: body.status,
    });

    logger.info(
      { reviewId: review.id, classId, studentId, analysisId, reviewerId },
      '[class] review submitted',
    );

    return review;
  }

  // ============================================================
  // 班级讨论(聊天框 + 分享诊断报告)
  // ============================================================

  /**
   * 拉取班级消息(初始/增量/翻页三模式)
   * 校验链:班级存在 → 当前用户是成员
   */
  async listMessages(
    classId: string,
    userId: string,
    query: ListClassMessagesQuery,
  ): Promise<ListClassMessagesResponse> {
    await this.assertClass(classId);
    const membership = await this.assertMembership(classId, userId);

    const limit = query.limit ?? 50;
    const { items, hasMore } = await classRepository.listMessages({
      tenantId: classId,
      limit,
      after: query.after,
      before: query.before,
    });

    return {
      items: items.map((m) => this.toMessageItem(m, membership.role)),
      hasMore,
    };
  }

  /**
   * 发送班级消息
   * 校验链:班级存在 → 当前用户是成员
   *   - type=text:content 必填(1-500)
   *   - type=analysis_share:analysisId 必填,且必须是本班级内、发送者本人的 success 分析
   *     (防止把他人作品/外班级作品分享到班级)
   */
  async sendMessage(
    classId: string,
    userId: string,
    body: SendClassMessageRequest,
  ): Promise<ClassMessageItem> {
    await this.assertClass(classId);
    const membership = await this.assertMembership(classId, userId);

    let snapshot: ClassMessageSnapshot | undefined;
    if (body.type === 'analysis_share') {
      // Zod 已保证 analysisId 存在;此处做归属与状态校验
      const analysis = await analysisRepository.findById(classId, body.analysisId!);
      if (!analysis || analysis.userId !== userId) {
        throw new BusinessError(ErrorCode.ANALYSIS_NOT_FOUND, '作品不存在或不属于您', 404);
      }
      if (analysis.status !== 'success') {
        throw new BusinessError(ErrorCode.PARAM_INVALID, '仅可分享分析成功的作品', 400);
      }
      snapshot = {
        title: analysis.title,
        overallScore: analysis.overallScore,
        imageUrl: analysis.imageUrl,
        workType: analysis.workType as ClassMessageSnapshot['workType'],
      };
    }

    const message = await classRepository.createMessage({
      tenantId: classId,
      userId,
      type: body.type,
      content: body.content ?? '',
      analysisId: body.type === 'analysis_share' ? body.analysisId : undefined,
      snapshot,
    });

    return this.toMessageItem(message, membership.role);
  }

  /**
   * 查看被分享到班级的诊断报告(班级成员通用,含学生看同学)
   * 校验链:班级存在 → 当前用户是成员 → 报告存在且归属本班级 → 报告已被分享到本班级
   * 未分享的分析仍按原权限(学生仅可看自己的),此端点不放行
   */
  async getSharedAnalysis(
    classId: string,
    analysisId: string,
    userId: string,
  ): Promise<AnalysisDetail> {
    await this.assertClass(classId);
    await this.assertMembership(classId, userId);

    const analysis = await analysisRepository.findById(classId, analysisId);
    if (!analysis) {
      throw new BusinessError(ErrorCode.ANALYSIS_NOT_FOUND, '分析记录不存在', 404);
    }

    const shared = await classRepository.existsShareMessage(classId, analysisId);
    if (!shared) {
      // 未分享到班级:与 getAnalysis 越权语义一致,返回 404 不泄露存在性
      throw new BusinessError(ErrorCode.ANALYSIS_NOT_FOUND, '分析记录不存在', 404);
    }

    const storedResult = analysis.result as
      | (AnalysisDetail['result'] & { aiEnhanced?: boolean; aiMeta?: { aiDurationMs?: number } })
      | null;

    return {
      id: analysis.id,
      tenantId: analysis.tenantId,
      userId: analysis.userId,
      workType: analysis.workType as AnalysisDetail['workType'],
      imageUrl: analysis.imageUrl,
      title: analysis.title,
      remark: analysis.remark,
      status: analysis.status as AnalysisDetail['status'],
      result: analysis.result as AnalysisDetail['result'],
      failureReason: analysis.failureReason,
      durationMs: analysis.durationMs,
      createdAt: analysis.createdAt.toISOString(),
      completedAt: analysis.completedAt?.toISOString() ?? null,
      aiEnhanced: storedResult?.aiEnhanced,
      aiDurationMs: storedResult?.aiMeta?.aiDurationMs,
    };
  }

  /** ClassMessage 实体(含 user)→ API 契约;role 取发送者在班级内的成员角色 */
  private toMessageItem(
    m: ClassMessage & { user: Pick<User, 'id' | 'name' | 'avatar'> },
    senderRole: string,
  ): ClassMessageItem {
    return {
      id: m.id,
      type: m.type as ClassMessageType,
      content: m.content,
      analysisId: m.analysisId,
      snapshot: (m.snapshot as unknown as ClassMessageSnapshot | null) ?? null,
      sender: {
        id: m.user.id,
        name: m.user.name,
        avatar: m.user.avatar,
        role: senderRole as UserRole,
      },
      createdAt: m.createdAt.toISOString(),
    };
  }

  // ============================================================
  // 私有工具方法
  // ============================================================

  /**
   * 断言班级存在且为 class 类型、未禁用
   * 不存在/类型不符统一 404(不泄露其他类型租户存在性)
   */
  private async assertClass(classId: string): Promise<Tenant> {
    const tenant = await classRepository.findClassById(classId);
    if (!tenant) {
      throw new BusinessError(ErrorCode.TENANT_NOT_FOUND, '班级不存在', 404);
    }
    if (tenant.status === 'disabled') {
      throw new BusinessError(ErrorCode.TENANT_DISABLED, '班级已被禁用', 403);
    }
    return tenant;
  }

  /**
   * 断言用户是班级成员(任意角色),返回成员关系
   */
  private async assertMembership(classId: string, userId: string): Promise<TenantMember> {
    const membership = await tenantRepository.findMembership(userId, classId);
    if (!membership) {
      throw new BusinessError(ErrorCode.FORBIDDEN, '您不是该班级成员', 403);
    }
    return membership;
  }

  /**
   * 断言目标学生是班级成员
   * 非成员返回 404(语义:该班级下不存在该学生,不泄露用户的跨班级存在性)
   */
  private async assertStudentMembership(classId: string, studentId: string): Promise<void> {
    const membership = await tenantRepository.findMembership(studentId, classId);
    if (!membership) {
      throw new BusinessError(ErrorCode.RESOURCE_NOT_FOUND, '该学生不是该班级成员', 404);
    }
  }

  /**
   * 生成 URL-safe 32 位邀请码(与 admin-phase5.controller 规则一致)
   */
  private generateInvitationCode(): string {
    return crypto
      .randomBytes(INVITATION_CODE_LENGTH)
      .toString('base64url')
      .slice(0, INVITATION_CODE_LENGTH);
  }

  /** InvitationCode 实体 → API 契约 */
  private toInvitationInfo(i: {
    id: string;
    code: string;
    tenantId: string;
    role: string;
    maxUses: number;
    usedCount: number;
    expiresAt: Date;
    createdBy: string;
    createdAt: Date;
  }): ClassInvitationInfo {
    return {
      id: i.id,
      code: i.code,
      tenantId: i.tenantId,
      role: i.role as UserRole,
      maxUses: i.maxUses,
      usedCount: i.usedCount,
      expiresAt: i.expiresAt.toISOString(),
      createdBy: i.createdBy,
      createdAt: i.createdAt.toISOString(),
    };
  }

  /** Analysis 实体 + 评审记录 → 学生作品列表项 */
  private toWorkItem(a: Analysis, reviews: ReviewRecord[]): ClassStudentWorkItem {
    return {
      id: a.id,
      workType: a.workType as ClassStudentWorkItem['workType'],
      imageUrl: a.imageUrl,
      title: a.title,
      status: a.status as ClassStudentWorkItem['status'],
      overallScore: a.overallScore,
      result: (a.result as unknown as AnalysisResult | null) ?? null,
      reviews: reviews.map((r) => this.toWorkReview(r)),
      createdAt: a.createdAt.toISOString(),
      completedAt: a.completedAt?.toISOString() ?? null,
    };
  }

  /** ReviewRecord 实体 → 精简评审视图 */
  private toWorkReview(r: ReviewRecord): ClassStudentWorkReview {
    return {
      id: r.id,
      reviewerId: r.reviewerId,
      reviewerType: r.reviewerType as ClassStudentWorkReview['reviewerType'],
      scores: r.scores as unknown as ReviewScoresPayload,
      comment: r.comment,
      status: r.status as ClassStudentWorkReview['status'],
      createdAt: r.createdAt.toISOString(),
    };
  }
}

export const classService = new ClassServiceClass();
