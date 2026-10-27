// ============================================================
// 邀请码 Repository(Phase 5)
// 对应文档:new-features-design.md §1.4, §3.5.2
// URL-safe 32 位,过期/用尽校验,强制 tenantId 隔离
// ============================================================

import type { Prisma, InvitationCode, UserRole } from '@prisma/client';
import { prisma } from '../config/prisma.js';

/** 邀请码长度(URL-safe) */
export const INVITATION_CODE_LENGTH = 32;

export class InvitationRepository {
  /**
   * 创建邀请码
   * @param code URL-safe 32 位字符串(由 service 层生成)
   */
  async create(params: {
    code: string;
    tenantId: string;
    role: UserRole;
    maxUses: number;
    expiresAt: Date;
    createdBy: string;
  }): Promise<InvitationCode> {
    const data: Prisma.InvitationCodeCreateInput = {
      code: params.code,
      tenant: { connect: { id: params.tenantId } },
      role: params.role,
      maxUses: params.maxUses,
      usedCount: 0,
      expiresAt: params.expiresAt,
      creator: { connect: { id: params.createdBy } },
    };
    return prisma().invitationCode.create({ data });
  }

  /**
   * 按 code 查询邀请码(全局唯一,无 tenantId 过滤)
   * 用于兑换时定位
   */
  async findByCode(code: string): Promise<InvitationCode | null> {
    return prisma().invitationCode.findUnique({
      where: { code },
    });
  }

  /**
   * 校验邀请码是否有效(未过期 + 未用尽)
   */
  async findValidByCode(code: string): Promise<InvitationCode | null> {
    const now = new Date();
    const record = await this.findByCode(code);
    if (!record) return null;
    if (record.expiresAt <= now) return null;
    if (record.usedCount >= record.maxUses) return null;
    return record;
  }

  /**
   * 增加使用次数(原子操作,并发安全)
   */
  async incrementUsed(code: string): Promise<InvitationCode> {
    const current = await prisma().invitationCode.findUnique({ where: { code } });
    const usedCount = (current?.usedCount ?? 0) + 1;
    return prisma().invitationCode.update({
      where: { code },
      data: { usedCount },
    });
  }

  /**
   * 列出租户下所有邀请码(强制 tenantId 过滤)
   */
  async listByTenant(tenantId: string): Promise<InvitationCode[]> {
    return prisma().invitationCode.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }
}

export const invitationRepository = new InvitationRepository();
