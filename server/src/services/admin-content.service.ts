// ============================================================
// 管理后台 - 内容业务服务(Phase 4)
// 对应 API:/api/admin/artworks + /api/admin/templates
//
// 职责:
//   1. 作品列表/详情查询
//   2. 作品审核(通过/拒绝/标记)+ 审计日志
//   3. 作品删除 + 审计日志
//   4. 创意模板 CRUD + 审计日志
//
// 安全约束:
//   - tenant_id 强制从 JWT 注入
//   - 审核动作记录 reviewedBy/reviewedAt/reviewNote
//   - 物理删除违规内容(不可恢复)
// ============================================================

import type { Request } from 'express';
import type { Prisma} from '@prisma/client';
import { type Analysis, type CreativeTemplate, type ArtType, type ReviewStatus } from '@prisma/client';
import { adminContentRepository, type ListAdminArtworksFilter } from '../repositories/admin-content.repository.js';
import { writeAudit } from './admin-audit.service.js';
import { BusinessError } from '../middlewares/error-handler.js';
import { ErrorCode } from '../types/api-contract.js';
import type {
  AdminArtworkListItem,
  AdminArtworkDetail,
  ListAdminArtworksQuery,
  ReviewArtworkRequest,
  ReviewArtworkResponse,
  DeleteAdminArtworkResponse,
  CreativeTemplateInfo,
  ListAdminTemplatesQuery,
  CreateTemplateRequest,
  CreateTemplateResponse,
  UpdateTemplateRequest,
  UpdateTemplateResponse,
  DeleteTemplateResponse,
  ReviewAction,
  PaginatedData,
} from '../types/api-contract.js';

class AdminContentServiceClass {
  // ============================================================
  // 作品列表/详情
  // ============================================================

  async listArtworks(query: ListAdminArtworksQuery, ctx: { tenantId: string }): Promise<PaginatedData<AdminArtworkListItem>> {
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 20, 100);

    const filter: ListAdminArtworksFilter = {
      currentTenantId: ctx.tenantId,
      targetTenantId: query.tenantId,
      userId: query.userId,
      workType: query.workType as ArtType | undefined,
      status: query.status,
      reviewStatus: query.reviewStatus as ReviewStatus | undefined,
      startDate: query.startDate ? new Date(query.startDate) : undefined,
      endDate: query.endDate ? new Date(query.endDate) : undefined,
      search: query.search,
      page,
      pageSize,
    };

    const { items, total } = await adminContentRepository.listArtworks(filter);

    return {
      items: items.map((a) => this.toArtworkListItem(a)),
      total,
      page,
      pageSize,
      hasMore: page * pageSize < total,
    };
  }

  async getArtwork(artworkId: string, ctx: { tenantId: string }): Promise<AdminArtworkDetail> {
    const artwork = await adminContentRepository.findArtworkById(ctx.tenantId, artworkId);
    if (!artwork) {
      throw new BusinessError(ErrorCode.ADMIN_ARTWORK_NOT_FOUND, '作品不存在', 404);
    }
    return this.toArtworkDetail(artwork);
  }

  // ============================================================
  // 作品审核
  // ============================================================

  async reviewArtwork(
    artworkId: string,
    body: ReviewArtworkRequest,
    ctx: { req: Request; tenantId: string; operatorId: string },
  ): Promise<ReviewArtworkResponse> {
    const before = await adminContentRepository.findArtworkById(ctx.tenantId, artworkId);
    if (!before) {
      throw new BusinessError(ErrorCode.ADMIN_ARTWORK_NOT_FOUND, '作品不存在', 404);
    }

    // 审核动作映射到 reviewStatus
    const reviewStatus = this.actionToStatus(body.action);

    const after = await adminContentRepository.reviewArtwork(
      artworkId,
      reviewStatus,
      ctx.operatorId,
      body.note,
    );

    await writeAudit({
      req: ctx.req,
      action: 'review',
      resource: 'artwork',
      resourceId: artworkId,
      targetTenantId: after.tenantId,
      beforeData: { reviewStatus: before.reviewStatus, reviewedBy: before.reviewedBy },
      afterData: { reviewStatus: after.reviewStatus, reviewedBy: after.reviewedBy, reviewNote: after.reviewNote },
      note: body.note ?? `审核动作:${body.action}`,
    });

    return {
      id: after.id,
      reviewStatus: after.reviewStatus as 'pending' | 'approved' | 'rejected' | 'flagged',
      reviewedAt: after.reviewedAt!.toISOString(),
      reviewedBy: after.reviewedBy!,
    };
  }

  // ============================================================
  // 作品删除
  // ============================================================

  async deleteArtwork(
    artworkId: string,
    ctx: { req: Request; tenantId: string },
  ): Promise<DeleteAdminArtworkResponse> {
    const before = await adminContentRepository.findArtworkById(ctx.tenantId, artworkId);
    if (!before) {
      throw new BusinessError(ErrorCode.ADMIN_ARTWORK_NOT_FOUND, '作品不存在', 404);
    }

    const deleted = await adminContentRepository.deleteArtwork(artworkId);

    await writeAudit({
      req: ctx.req,
      action: 'delete',
      resource: 'artwork',
      resourceId: artworkId,
      targetTenantId: before.tenantId,
      beforeData: { id: before.id, title: before.title, workType: before.workType },
      afterData: null,
      note: '物理删除作品',
    });

    return { id: artworkId, deleted };
  }

  // ============================================================
  // 创意模板 CRUD
  // ============================================================

  async listTemplates(query: ListAdminTemplatesQuery): Promise<PaginatedData<CreativeTemplateInfo>> {
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 20, 100);

    const { items, total } = await adminContentRepository.listTemplates({
      artType: query.artType as ArtType | undefined,
      enabled: query.enabled,
      search: query.search,
      page,
      pageSize,
    });

    return {
      items: items.map((t) => this.toTemplateInfo(t)),
      total,
      page,
      pageSize,
      hasMore: page * pageSize < total,
    };
  }

  async getTemplate(templateId: string): Promise<CreativeTemplateInfo> {
    const template = await adminContentRepository.findTemplateById(templateId);
    if (!template) {
      throw new BusinessError(ErrorCode.ADMIN_TEMPLATE_NOT_FOUND, '模板不存在', 404);
    }
    return this.toTemplateInfo(template);
  }

  async createTemplate(
    body: CreateTemplateRequest,
    ctx: { req: Request; operatorId: string },
  ): Promise<CreateTemplateResponse> {
    const created = await adminContentRepository.createTemplate({
      name: body.name,
      description: body.description ?? null,
      artType: body.artType as ArtType,
      content: body.content as unknown as Prisma.InputJsonValue,
      tags: (body.tags ?? []) as unknown as Prisma.InputJsonValue,
      thumbnailUrl: body.thumbnailUrl ?? null,
      enabled: body.enabled ?? true,
      sortOrder: body.sortOrder ?? 0,
      createdById: ctx.operatorId,
    });

    await writeAudit({
      req: ctx.req,
      action: 'create',
      resource: 'template',
      resourceId: created.id,
      targetTenantId: null,
      beforeData: null,
      afterData: { id: created.id, name: created.name, artType: created.artType },
      note: `创建模板 ${created.name}`,
    });

    return this.toTemplateInfo(created);
  }

  async updateTemplate(
    templateId: string,
    body: UpdateTemplateRequest,
    ctx: { req: Request; operatorId: string },
  ): Promise<UpdateTemplateResponse> {
    const before = await adminContentRepository.findTemplateById(templateId);
    if (!before) {
      throw new BusinessError(ErrorCode.ADMIN_TEMPLATE_NOT_FOUND, '模板不存在', 404);
    }

    const updateData: Record<string, unknown> = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.content !== undefined) updateData.content = body.content;
    if (body.tags !== undefined) updateData.tags = body.tags;
    if (body.thumbnailUrl !== undefined) updateData.thumbnailUrl = body.thumbnailUrl;
    if (body.enabled !== undefined) updateData.enabled = body.enabled;
    if (body.sortOrder !== undefined) updateData.sortOrder = body.sortOrder;

    const after = await adminContentRepository.updateTemplate(templateId, updateData);

    await writeAudit({
      req: ctx.req,
      action: 'update',
      resource: 'template',
      resourceId: templateId,
      targetTenantId: null,
      beforeData: { name: before.name, enabled: before.enabled, sortOrder: before.sortOrder },
      afterData: { name: after.name, enabled: after.enabled, sortOrder: after.sortOrder },
    });

    return this.toTemplateInfo(after);
  }

  async deleteTemplate(
    templateId: string,
    ctx: { req: Request },
  ): Promise<DeleteTemplateResponse> {
    const before = await adminContentRepository.findTemplateById(templateId);
    if (!before) {
      throw new BusinessError(ErrorCode.ADMIN_TEMPLATE_NOT_FOUND, '模板不存在', 404);
    }

    const deleted = await adminContentRepository.deleteTemplate(templateId);

    await writeAudit({
      req: ctx.req,
      action: 'delete',
      resource: 'template',
      resourceId: templateId,
      targetTenantId: null,
      beforeData: { id: before.id, name: before.name },
      afterData: null,
    });

    return { id: templateId, deleted };
  }

  // ============================================================
  // 内部工具方法
  // ============================================================

  /** 审核动作 → reviewStatus 映射 */
  private actionToStatus(action: ReviewAction): ReviewStatus {
    switch (action) {
      case 'approve':
        return 'approved' as ReviewStatus;
      case 'reject':
        return 'rejected' as ReviewStatus;
      case 'flag':
        return 'flagged' as ReviewStatus;
      default:
        throw new BusinessError(ErrorCode.ADMIN_REVIEW_ACTION_INVALID, `审核动作非法: ${String(action)}`, 400);
    }
  }

  /** Analysis(+user) → AdminArtworkListItem */
  private toArtworkListItem(a: Analysis & { user?: { name: string } | null }): AdminArtworkListItem {
    return {
      id: a.id,
      tenantId: a.tenantId,
      userId: a.userId,
      userName: a.user?.name ?? '',
      workType: a.workType as 'painting' | 'design' | 'product' | 'sculpture',
      imageUrl: a.imageUrl,
      title: a.title,
      status: a.status as 'pending' | 'processing' | 'success' | 'failed',
      reviewStatus: a.reviewStatus as 'pending' | 'approved' | 'rejected' | 'flagged',
      overallScore: a.overallScore,
      createdAt: a.createdAt.toISOString(),
      reviewedAt: a.reviewedAt?.toISOString() ?? null,
    };
  }

  /** Analysis(+user) → AdminArtworkDetail */
  private toArtworkDetail(a: Analysis & { user?: { name: string } | null }): AdminArtworkDetail {
    return {
      ...this.toArtworkListItem(a),
      remark: a.remark,
      failureReason: a.failureReason,
      durationMs: a.durationMs,
      completedAt: a.completedAt?.toISOString() ?? null,
      reviewedBy: a.reviewedBy,
      reviewNote: a.reviewNote,
    };
  }

  /** CreativeTemplate → CreativeTemplateInfo */
  private toTemplateInfo(t: CreativeTemplate): CreativeTemplateInfo {
    return {
      id: t.id,
      name: t.name,
      description: t.description,
      artType: t.artType as 'painting' | 'design' | 'product' | 'sculpture',
      content: t.content as Record<string, unknown>,
      tags: (t.tags as string[]) ?? [],
      thumbnailUrl: t.thumbnailUrl,
      enabled: t.enabled,
      sortOrder: t.sortOrder,
      createdById: t.createdById,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    };
  }
}

export const adminContentService = new AdminContentServiceClass();
