// ============================================================
// 评分风格档案业务服务(双阶段反馈框架 Phase 2 批次②)
// 对应文档:visual-annotation-feedback-upgrade-spec-2026-09.md §4(LUT 式评分档案)
//
// 职责:
//   1. 列出可见档案(系统内置 + 租户克隆)
//   2. 查询档案详情
//   3. 创建租户档案(config Zod 校验,二次防御)
//   4. fork 派生档案(深拷贝 config、forkedFromId 链、tenantId=当前租户、isBuiltIn=false)
//   5. 更新/删除档案(禁止操作 isBuiltIn=true 的系统内置档案)
//   6. activateProfile:设为租户默认(事务内 per-(tenant,category) 唯一默认)
//   7. resolveEffectiveProfile:解析生效档案(租户默认优先 → 系统内置兜底)
//      ——批次③策略引擎(aiEnhanceAnalysis)的解析入口
//
// 安全约束(照 preset.service):
//   - isBuiltIn=true 禁止 UPDATE/DELETE/设为租户默认(service 层强制校验)
//   - 更新/删除仅限本人创建的档案(creatorId = userId)
//   - 多租户:非内置档案必须属于当前租户
// ============================================================

import { gradingProfileRepository } from '../repositories/grading-profile.repository.js';
import { BusinessError } from '../middlewares/error-handler.js';
import { ErrorCode } from '../types/api-contract.js';
import {
  parseGradingProfileConfig,
  type GradingProfileCategory,
  type GradingProfileConfig,
  type ResolvedGradingProfile,
} from '../types/grading-profile.js';
import type { GradingProfile, Prisma } from '@prisma/client';
import { logger } from '../utils/logger.js';

/** 档案列表/详情 DTO(批次⑤教师端消费) */
export type GradingProfileSummary = {
  id: string;
  name: string;
  description: string | null;
  category: GradingProfileCategory;
  isBuiltIn: boolean;
  isDefault: boolean;
  forkedFromId: string | null;
  creatorId: string | null;
  enabled: boolean;
  sortOrder: number;
};

export type GradingProfileDetail = GradingProfileSummary & {
  config: GradingProfileConfig;
  createdAt: string;
  updatedAt: string;
};

/** 创建档案请求体(controller Zod 校验后传入) */
export type CreateGradingProfileRequest = {
  name: string;
  description?: string;
  category: GradingProfileCategory;
  config: GradingProfileConfig;
};

/** fork 档案请求体 */
export type ForkGradingProfileRequest = {
  name: string;
  description?: string;
};

/** 更新档案请求体(全部可选) */
export type UpdateGradingProfileRequest = {
  name?: string;
  description?: string;
  config?: GradingProfileConfig;
  enabled?: boolean;
};

class GradingProfileServiceClass {
  // ============================================================
  // 查询
  // ============================================================

  /**
   * 列出租户可见档案(系统内置 + 租户克隆,含停用)
   */
  async listProfiles(tenantId: string): Promise<GradingProfileSummary[]> {
    const profiles = await gradingProfileRepository.listVisible(tenantId);
    return profiles.map((p) => this.toSummary(p));
  }

  /**
   * 查询档案详情(系统内置全局可见;租户档案需可见性由列表入口保证)
   */
  async getProfile(id: string): Promise<GradingProfileDetail> {
    const profile = await gradingProfileRepository.findById(id);
    if (!profile) {
      throw new BusinessError(ErrorCode.GRADING_PROFILE_NOT_FOUND, '档案不存在', 404);
    }
    if (!profile.enabled) {
      throw new BusinessError(ErrorCode.GRADING_PROFILE_NOT_FOUND, '档案已停用', 404);
    }
    return this.toDetail(profile);
  }

  // ============================================================
  // 创建 / Fork
  // ============================================================

  /**
   * 创建租户档案(config 已过 controller Zod,此处二次防御)
   */
  async createProfile(
    tenantId: string,
    userId: string,
    body: CreateGradingProfileRequest,
  ): Promise<GradingProfileDetail> {
    const config = this.validateConfig(body.config);

    const profile = await gradingProfileRepository.create({
      name: body.name,
      description: body.description ?? null,
      category: body.category,
      config: config as unknown as Prisma.InputJsonValue,
      isBuiltIn: false,
      isDefault: false,
      forkedFromId: null,
      creatorId: userId,
      tenantId,
      enabled: true,
      sortOrder: 0,
    });

    logger.info({ profileId: profile.id, userId, tenantId }, '[grading-profile] created');
    return this.toDetail(profile);
  }

  /**
   * fork 派生档案:深拷贝源档案 config,forkedFromId 指向源档案
   * 源可以是系统内置或本租户档案(跨租户非内置档案按不存在处理,不泄露存在性)
   */
  async forkProfile(
    tenantId: string,
    userId: string,
    sourceId: string,
    body: ForkGradingProfileRequest,
  ): Promise<GradingProfileDetail> {
    const source = await gradingProfileRepository.findById(sourceId);
    if (!source || (!source.isBuiltIn && source.tenantId !== tenantId)) {
      throw new BusinessError(ErrorCode.GRADING_PROFILE_NOT_FOUND, '源档案不存在', 404);
    }
    if (!source.enabled) {
      throw new BusinessError(ErrorCode.GRADING_PROFILE_NOT_FOUND, '源档案已停用', 404);
    }

    // 深拷贝源 config(教师克隆后微调)
    const config = this.validateConfig(source.config);

    const profile = await gradingProfileRepository.create({
      name: body.name,
      description: body.description ?? source.description,
      category: source.category,
      config: config as unknown as Prisma.InputJsonValue,
      isBuiltIn: false,
      isDefault: false,
      forkedFromId: sourceId,
      creatorId: userId,
      tenantId,
      enabled: true,
      sortOrder: 0,
    });

    logger.info({ profileId: profile.id, forkedFrom: sourceId, userId }, '[grading-profile] forked');
    return this.toDetail(profile);
  }

  // ============================================================
  // 更新 / 删除 / 设默认
  // ============================================================

  /**
   * 更新档案(仅本人创建、非系统内置)
   */
  async updateProfile(
    tenantId: string,
    userId: string,
    id: string,
    body: UpdateGradingProfileRequest,
  ): Promise<GradingProfileDetail> {
    await this.assertModifiable(id, userId, tenantId);

    const updateData: Record<string, unknown> = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.config !== undefined) {
      updateData.config = this.validateConfig(body.config);
    }
    if (body.enabled !== undefined) updateData.enabled = body.enabled;

    const updated = await gradingProfileRepository.update(id, updateData);
    logger.info({ profileId: id, userId }, '[grading-profile] updated');
    return this.toDetail(updated);
  }

  /**
   * 删除档案(仅本人创建、非系统内置)
   * 注:删除的是租户默认档案时,isDefault 随记录消失,解析自动回退系统兜底
   */
  async deleteProfile(tenantId: string, userId: string, id: string): Promise<void> {
    await this.assertModifiable(id, userId, tenantId);
    await gradingProfileRepository.delete(id);
    logger.info({ profileId: id, userId }, '[grading-profile] deleted');
  }

  /**
   * 设为租户默认档案(同租户同类目唯一,事务保证)
   * 系统内置档案不做租户默认(默认档案是租户级概念)
   */
  async activateProfile(tenantId: string, userId: string, id: string): Promise<GradingProfileDetail> {
    const profile = await gradingProfileRepository.findById(id);
    if (!profile) {
      throw new BusinessError(ErrorCode.GRADING_PROFILE_NOT_FOUND, '档案不存在', 404);
    }
    if (!profile.enabled) {
      throw new BusinessError(ErrorCode.GRADING_PROFILE_NOT_FOUND, '档案已停用,不可设为默认', 404);
    }
    if (profile.isBuiltIn) {
      throw new BusinessError(
        ErrorCode.GRADING_PROFILE_BUILTIN_IMMUTABLE,
        '系统内置档案不可设为租户默认,请先克隆',
        403,
      );
    }
    if (profile.tenantId !== tenantId) {
      throw new BusinessError(ErrorCode.TENANT_MISMATCH, '无权操作其他租户的档案', 403);
    }

    const updated = await gradingProfileRepository.setDefault(id, tenantId, profile.category);
    logger.info({ profileId: id, tenantId, userId }, '[grading-profile] activated as default');
    return this.toDetail(updated);
  }

  // ============================================================
  // 生效档案解析(批次③策略引擎入口)
  // ============================================================

  /**
   * 解析某租户某类目的生效档案:
   *   1. 租户默认档案(enabled + isDefault)优先
   *      ——租户默认 config 校验失败(脏数据)时 warn 并回退系统兜底
   *   2. 系统内置档案兜底(同 category 唯一一套 seed)
   *   3. 均无 → undefined(调用方保持现状行为,向后兼容)
   *
   * @param tenantId 当前租户 ID
   * @param category 分析类目
   */
  async resolveEffectiveProfile(
    tenantId: string,
    category: GradingProfileCategory,
  ): Promise<ResolvedGradingProfile | undefined> {
    const tenantDefault = await gradingProfileRepository.findTenantDefault(tenantId, category);
    if (tenantDefault) {
      const config = parseGradingProfileConfig(tenantDefault.config);
      if (config) {
        return {
          id: tenantDefault.id,
          name: tenantDefault.name,
          category: tenantDefault.category as GradingProfileCategory,
          config,
        };
      }
      logger.warn(
        { tenantId, category, profileId: tenantDefault.id },
        '[grading-profile] 租户默认档案 config 校验失败,回退系统内置',
      );
    }

    const systemFallback = await gradingProfileRepository.findSystemFallback(category);
    if (systemFallback) {
      const config = parseGradingProfileConfig(systemFallback.config);
      if (config) {
        return {
          id: systemFallback.id,
          name: systemFallback.name,
          category: systemFallback.category as GradingProfileCategory,
          config,
        };
      }
      logger.warn(
        { category, profileId: systemFallback.id },
        '[grading-profile] 系统内置档案 config 校验失败(异常,seed 应已预校验)',
      );
    }

    return undefined;
  }

  // ============================================================
  // 私有工具方法
  // ============================================================

  /**
   * config 二次防御校验(controller Zod 已校验,service 层照 preset 模式重复校验)
   * @returns 校验通过的 config
   */
  private validateConfig(raw: unknown): GradingProfileConfig {
    const config = parseGradingProfileConfig(raw);
    if (!config) {
      throw new BusinessError(
        ErrorCode.GRADING_PROFILE_CONFIG_INVALID,
        '档案配置校验失败(权重总和须=100,档位须降序且末档 min=0,各项阈值须在范围内)',
        400,
      );
    }
    return config;
  }

  /**
   * 断言档案可被当前用户修改(存在 + 非内置 + 本租户 + 本人创建)
   */
  private async assertModifiable(id: string, userId: string, tenantId: string): Promise<GradingProfile> {
    const profile = await gradingProfileRepository.findById(id);
    if (!profile) {
      throw new BusinessError(ErrorCode.GRADING_PROFILE_NOT_FOUND, '档案不存在', 404);
    }
    if (profile.isBuiltIn) {
      throw new BusinessError(
        ErrorCode.GRADING_PROFILE_BUILTIN_IMMUTABLE,
        '系统内置档案不可修改或删除',
        403,
      );
    }
    // 多租户隔离:非内置档案必须属于当前租户
    if (profile.tenantId !== tenantId) {
      throw new BusinessError(ErrorCode.TENANT_MISMATCH, '无权操作其他租户的档案', 403);
    }
    if (profile.creatorId !== userId) {
      throw new BusinessError(ErrorCode.FORBIDDEN, '仅档案创建者可修改或删除', 403);
    }
    return profile;
  }

  /** DB 模型 → Summary */
  private toSummary(p: GradingProfile): GradingProfileSummary {
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      category: p.category as GradingProfileCategory,
      isBuiltIn: p.isBuiltIn,
      isDefault: p.isDefault,
      forkedFromId: p.forkedFromId,
      creatorId: p.creatorId,
      enabled: p.enabled,
      sortOrder: p.sortOrder,
    };
  }

  /** DB 模型 → Detail(config 解析失败按配置损坏报错) */
  private toDetail(p: GradingProfile): GradingProfileDetail {
    const config = parseGradingProfileConfig(p.config);
    if (!config) {
      throw new BusinessError(
        ErrorCode.GRADING_PROFILE_CONFIG_INVALID,
        '档案配置数据损坏,无法解析',
        500,
      );
    }
    return {
      ...this.toSummary(p),
      config,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    };
  }
}

export const gradingProfileService = new GradingProfileServiceClass();
