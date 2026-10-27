// ============================================================
// 评分预设 Repository(Phase 5)
// 对应文档:new-features-design.md §1.5, §3.1
// 分层:built-in(tenantId=null,全局)+ 租户共享 + 用户私有
// 多租户:listVisible 按 tenantId+userId 过滤;内置预设全局可见
// ============================================================

import type { Prisma, EvaluationPreset } from '@prisma/client';
import { prisma } from '../config/prisma.js';

export class PresetRepository {
  /**
   * 列出用户可见预设:
   *   - isBuiltIn=true(全局 seed,tenantId=null)
   *   - tenantId=当前租户 且 isPrivate=false(租户共享)
   *   - creatorId=当前用户(本人私有)
   * 仅返回 enabled=true
   */
  async listVisible(tenantId: string, userId: string): Promise<EvaluationPreset[]> {
    return prisma().evaluationPreset.findMany({
      where: {
        enabled: true,
        OR: [
          { isBuiltIn: true },
          { tenantId, isPrivate: false },
          { creatorId: userId },
        ],
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /**
   * 列出所有内置预设(seed)
   */
  async listBuiltIn(): Promise<EvaluationPreset[]> {
    return prisma().evaluationPreset.findMany({
      where: { isBuiltIn: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /**
   * 列出所有预设(管理后台,含全局+租户)
   */
  async listAll(): Promise<EvaluationPreset[]> {
    return prisma().evaluationPreset.findMany({
      orderBy: [{ isBuiltIn: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /**
   * 按 ID 查询预设(全局可见,无需 tenantId 过滤,因为预设可被 fork 引用)
   */
  async findById(id: string): Promise<EvaluationPreset | null> {
    return prisma().evaluationPreset.findUnique({
      where: { id },
    });
  }

  /**
   * 创建用户/管理预设
   */
  async create(data: Prisma.EvaluationPresetUncheckedCreateInput): Promise<EvaluationPreset> {
    return prisma().evaluationPreset.create({ data });
  }

  /**
   * 更新预设(禁止 isBuiltIn,由 service 层校验)
   * @param id 预设 ID
   * @param data 更新字段
   */
  async update(id: string, data: Prisma.EvaluationPresetUpdateInput): Promise<EvaluationPreset> {
    return prisma().evaluationPreset.update({
      where: { id },
      data,
    });
  }

  /**
   * 删除预设(禁止 isBuiltIn,由 service 层校验)
   */
  async delete(id: string): Promise<void> {
    await prisma().evaluationPreset.delete({
      where: { id },
    });
  }
}

export const presetRepository = new PresetRepository();
