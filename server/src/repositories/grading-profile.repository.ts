// ============================================================
// 评分风格档案 Repository(双阶段反馈框架 Phase 2 批次②)
// 对应文档:visual-annotation-feedback-upgrade-spec-2026-09.md §4
// 分层:系统内置(isBuiltIn=true,tenantId=null,seed 注入)+ 租户克隆档案
// 多租户:listVisible 按 OR [isBuiltIn, tenantId] 过滤(照 preset.repository)
// ============================================================

import type { Prisma, GradingProfile } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import type { GradingProfileCategory } from '../types/grading-profile.js';

export class GradingProfileRepository {
  /**
   * 列出租户可见档案:
   *   - isBuiltIn=true(系统 seed,tenantId=null,全局可见)
   *   - tenantId=当前租户(租户克隆档案)
   * 含已停用档案(教师可启停,列表需展示状态)
   */
  async listVisible(tenantId: string): Promise<GradingProfile[]> {
    return prisma().gradingProfile.findMany({
      where: {
        OR: [{ isBuiltIn: true }, { tenantId }],
      },
      orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /**
   * 按 ID 查询档案(系统内置全局可见,可被 fork 引用,不做租户过滤)
   */
  async findById(id: string): Promise<GradingProfile | null> {
    return prisma().gradingProfile.findUnique({
      where: { id },
    });
  }

  /**
   * 创建租户克隆/自建档案(isBuiltIn 恒为 false,由 service 层保证)
   */
  async create(data: Prisma.GradingProfileUncheckedCreateInput): Promise<GradingProfile> {
    return prisma().gradingProfile.create({ data });
  }

  /**
   * 更新档案(禁止改 isBuiltIn/归属字段,由 service 层校验)
   */
  async update(id: string, data: Prisma.GradingProfileUpdateInput): Promise<GradingProfile> {
    return prisma().gradingProfile.update({
      where: { id },
      data,
    });
  }

  /**
   * 删除档案(禁止删 isBuiltIn,由 service 层校验)
   */
  async delete(id: string): Promise<void> {
    await prisma().gradingProfile.delete({
      where: { id },
    });
  }

  /**
   * 查询租户某类目的生效默认档案(enabled + isDefault)
   */
  async findTenantDefault(
    tenantId: string,
    category: GradingProfileCategory,
  ): Promise<GradingProfile | null> {
    return prisma().gradingProfile.findFirst({
      where: {
        tenantId,
        category,
        enabled: true,
        isDefault: true,
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /**
   * 查询某类目的系统内置兜底档案(同 category 唯一一套 seed)
   */
  async findSystemFallback(category: GradingProfileCategory): Promise<GradingProfile | null> {
    return prisma().gradingProfile.findFirst({
      where: {
        isBuiltIn: true,
        category,
        enabled: true,
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /**
   * 设为租户默认档案(事务内同租户同类目取消其他默认,保证 per-(tenant,category) 唯一默认)
   * 注:系统内置(isBuiltIn=true)不做租户默认,由 service 层在调用前拦截
   */
  async setDefault(id: string, tenantId: string, category: string): Promise<GradingProfile> {
    return prisma().$transaction(async (tx) => {
      // 1. 同租户同类目:其他档案取消默认
      await tx.gradingProfile.updateMany({
        where: {
          tenantId,
          category,
          isDefault: true,
          id: { not: id },
        },
        data: { isDefault: false },
      });
      // 2. 目标档案设为默认
      return tx.gradingProfile.update({
        where: { id },
        data: { isDefault: true },
      });
    });
  }
}

export const gradingProfileRepository = new GradingProfileRepository();
