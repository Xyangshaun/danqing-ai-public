// ============================================================
// 评分预设业务服务(Phase 5)
// 对应文档:new-features-design.md §1.5, §2.2, §3.1
//
// 职责:
//   1. 列出可见预设(built-in + 租户共享 + 本人私有)
//   2. 查询预设详情
//   3. 创建用户预设(校验权重总和=100)
//   4. fork 派生预设(从 built-in 或其他预设派生)
//   5. 更新/删除预设(禁止操作 isBuiltIn=true 的记录)
//   6. applyPreset:按预设权重重算加权分(无副作用纯计算)
//
// 安全约束:
//   - isBuiltIn=true 的记录禁止 UPDATE/DELETE(service 层强制校验)
//   - 更新/删除仅限本人创建的预设(creatorId = userId)
//   - 多租户:listVisible 按 tenantId + userId 过滤
//   - 权重总和必须 = 100(Zod 在 controller 层校验,service 层二次防御)
// ============================================================

import { presetRepository } from '../repositories/preset.repository.js';
import { analysisRepository } from '../repositories/analysis.repository.js';
import { BusinessError } from '../middlewares/error-handler.js';
import {
  ErrorCode,
  type EvaluationPresetSummary,
  type EvaluationPresetDetail,
  type CreatePresetRequest,
  type ForkPresetRequest,
  type UpdatePresetRequest,
  type ApplyPresetRequest,
  type ApplyPresetResponse,
  type ArtType,
} from '../types/api-contract.js';
import type {
  PresetDimension,
  PresetStyle,
  PresetStage,
} from '../types/arbitration.js';
import type { EvaluationPreset, Prisma } from '@prisma/client';
import { logger } from '../utils/logger.js';

/** 权重总和容忍误差(浮点累加误差) */
const WEIGHT_SUM_TOLERANCE = 0.01;

class PresetServiceClass {
  // ============================================================
  // 查询
  // ============================================================

  /**
   * 列出用户可见预设
   * @param tenantId 当前租户 ID
   * @param userId 当前用户 ID
   */
  async listPresets(tenantId: string, userId: string): Promise<EvaluationPresetSummary[]> {
    const presets = await presetRepository.listVisible(tenantId, userId);
    return presets.map((p) => this.toSummary(p));
  }

  /**
   * 查询预设详情
   * 内置预设全局可见;用户预设需可见性校验(由 repository listVisible 逻辑覆盖)
   */
  async getPreset(id: string): Promise<EvaluationPresetDetail> {
    const preset = await presetRepository.findById(id);
    if (!preset) {
      throw new BusinessError(ErrorCode.PHASE5_PRESET_NOT_FOUND, '预设不存在', 404);
    }
    if (!preset.enabled) {
      throw new BusinessError(ErrorCode.PHASE5_PRESET_NOT_FOUND, '预设已禁用', 404);
    }
    return this.toDetail(preset);
  }

  // ============================================================
  // 创建 / Fork
  // ============================================================

  /**
   * 创建用户预设
   * 校验:权重总和=100、维度 key 不重复
   */
  async createPreset(
    tenantId: string,
    userId: string,
    body: CreatePresetRequest,
  ): Promise<EvaluationPresetDetail> {
    this.validateDimensions(body.dimensions);

    const preset = await presetRepository.create({
      name: body.name,
      description: body.description ?? null,
      styleType: body.styleType,
      artType: body.artType,
      dimensions: body.dimensions as unknown as Prisma.InputJsonValue,
      applicableStage: body.applicableStage,
      isBuiltIn: false,
      isPrivate: body.isPrivate ?? false,
      forkedFromId: null,
      creatorId: userId,
      tenantId,
      enabled: true,
      sortOrder: 0,
    });

    logger.info({ presetId: preset.id, userId, tenantId }, '[preset] created');
    return this.toDetail(preset);
  }

  /**
   * fork 派生预设(从源预设复制权重,可选覆盖)
   * 源预设可以是 built-in 或其他用户预设(只要可见)
   */
  async forkPreset(
    tenantId: string,
    userId: string,
    sourceId: string,
    body: ForkPresetRequest,
  ): Promise<EvaluationPresetDetail> {
    const source = await presetRepository.findById(sourceId);
    if (!source) {
      throw new BusinessError(ErrorCode.PHASE5_PRESET_NOT_FOUND, '源预设不存在', 404);
    }

    // 确定维度:覆盖 > 完全复制源预设
    const dimensions: PresetDimension[] =
      body.dimensions ?? (source.dimensions as unknown as PresetDimension[]);
    this.validateDimensions(dimensions);

    const preset = await presetRepository.create({
      name: body.name,
      description: body.description ?? source.description,
      styleType: source.styleType as PresetStyle,
      artType: source.artType as ArtType,
      dimensions: dimensions as unknown as Prisma.InputJsonValue,
      applicableStage: source.applicableStage as PresetStage,
      isBuiltIn: false,
      isPrivate: body.isPrivate ?? false,
      forkedFromId: sourceId,
      creatorId: userId,
      tenantId,
      enabled: true,
      sortOrder: 0,
    });

    logger.info({ presetId: preset.id, forkedFrom: sourceId, userId }, '[preset] forked');
    return this.toDetail(preset);
  }

  // ============================================================
  // 更新 / 删除
  // ============================================================

  /**
   * 更新预设(仅本人创建、非 built-in)
   */
  async updatePreset(
    tenantId: string,
    userId: string,
    id: string,
    body: UpdatePresetRequest,
  ): Promise<EvaluationPresetDetail> {
    await this.assertModifiable(id, userId, tenantId);

    if (body.dimensions) {
      this.validateDimensions(body.dimensions);
    }

    const updateData: Record<string, unknown> = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.dimensions !== undefined) {
      updateData.dimensions = body.dimensions as unknown as Record<string, unknown>;
    }
    if (body.applicableStage !== undefined) updateData.applicableStage = body.applicableStage;
    if (body.isPrivate !== undefined) updateData.isPrivate = body.isPrivate;
    if (body.enabled !== undefined) updateData.enabled = body.enabled;

    const updated = await presetRepository.update(id, updateData);
    logger.info({ presetId: id, userId }, '[preset] updated');
    return this.toDetail(updated);
  }

  /**
   * 删除预设(仅本人创建、非 built-in)
   */
  async deletePreset(tenantId: string, userId: string, id: string): Promise<void> {
    await this.assertModifiable(id, userId, tenantId);
    await presetRepository.delete(id);
    logger.info({ presetId: id, userId }, '[preset] deleted');
  }

  // ============================================================
  // applyPreset:按预设权重重算加权分(无副作用)
  // ============================================================

  /**
   * 应用预设到已有分析结果(重算加权分)
   * 对应 new-features-design.md §3.1
   * 不落库,纯计算返回
   */
  async applyPreset(
    tenantId: string,
    body: ApplyPresetRequest,
  ): Promise<ApplyPresetResponse> {
    // 1. 查分析结果(强制 tenantId 过滤)
    const analysis = await analysisRepository.findById(tenantId, body.analysisId);
    if (!analysis) {
      throw new BusinessError(ErrorCode.ANALYSIS_NOT_FOUND, '分析任务不存在', 404);
    }
    if (analysis.status !== 'success' || !analysis.result) {
      throw new BusinessError(ErrorCode.ANALYSIS_RESULT_FAILED, '分析结果不可用,无法应用预设', 400);
    }

    // 2. 查预设
    const preset = await presetRepository.findById(body.presetId);
    if (!preset) {
      throw new BusinessError(ErrorCode.PHASE5_PRESET_NOT_FOUND, '预设不存在', 404);
    }
    if (!preset.enabled) {
      throw new BusinessError(ErrorCode.PHASE5_PRESET_NOT_FOUND, '预设已禁用', 404);
    }

    // 3. 提取原始维度分(从 analysis.result.dimensions)
    const result = analysis.result as Record<string, unknown>;
    const dimensionsObj = result.dimensions as Record<string, unknown> | undefined;
    if (!dimensionsObj) {
      throw new BusinessError(ErrorCode.PHASE5_PRESET_DIMENSION_MISMATCH, '分析结果缺少维度数据', 400);
    }

    // 4. 校验维度 key 匹配 + 加权重算
    const presetDims = preset.dimensions as unknown as PresetDimension[];
    const weightedDimensions: ApplyPresetResponse['weightedDimensions'] = [];
    let weightedScore = 0;

    for (const dim of presetDims) {
      const dimData = dimensionsObj[dim.key] as { score?: number } | undefined;
      if (!dimData || typeof dimData.score !== 'number') {
        throw new BusinessError(
          ErrorCode.PHASE5_PRESET_DIMENSION_MISMATCH,
          `预设维度 "${dim.key}" 在分析结果中不存在`,
          400,
        );
      }
      const originalScore = dimData.score;
      const contribution = (originalScore * dim.weight) / 100;
      weightedScore += contribution;
      weightedDimensions.push({
        key: dim.key,
        label: dim.label,
        originalScore,
        weight: dim.weight,
        weightedContribution: Math.round(contribution * 100) / 100,
      });
    }

    weightedScore = Math.round(weightedScore * 100) / 100;

    logger.info(
      { analysisId: body.analysisId, presetId: body.presetId, weightedScore },
      '[preset] applied',
    );

    return {
      weightedScore,
      weightedDimensions,
      appliedPreset: this.toSummary(preset),
    };
  }

  // ============================================================
  // 管理后台:列出所有预设 + 派生覆盖
  // ============================================================

  /**
   * 列出所有预设(管理后台,含全局 + 租户)
   */
  async listAllPresets(): Promise<EvaluationPresetDetail[]> {
    const presets = await presetRepository.listAll();
    return presets.map((p) => this.toDetail(p));
  }

  /**
   * 从 built-in 预设派生覆盖预设(管理后台)
   * 创建一个新预设(非 built-in),指向源预设 forkedFromId
   */
  async overridePreset(
    tenantId: string,
    userId: string,
    sourceId: string,
    body: { name: string; description?: string; dimensions: PresetDimension[]; isPrivate?: boolean },
  ): Promise<EvaluationPresetDetail> {
    const source = await presetRepository.findById(sourceId);
    if (!source) {
      throw new BusinessError(ErrorCode.PHASE5_PRESET_NOT_FOUND, '源预设不存在', 404);
    }
    this.validateDimensions(body.dimensions);

    const preset = await presetRepository.create({
      name: body.name,
      description: body.description ?? null,
      styleType: source.styleType as PresetStyle,
      artType: source.artType as ArtType,
      dimensions: body.dimensions as unknown as Prisma.InputJsonValue,
      applicableStage: source.applicableStage as PresetStage,
      isBuiltIn: false,
      isPrivate: body.isPrivate ?? false,
      forkedFromId: sourceId,
      creatorId: userId,
      tenantId,
      enabled: true,
      sortOrder: 0,
    });

    logger.info({ presetId: preset.id, forkedFrom: sourceId, userId, tenantId }, '[preset] admin override created');
    return this.toDetail(preset);
  }

  // ============================================================
  // 私有工具方法
  // ============================================================

  /**
   * 校验维度权重总和=100 + key 不重复
   */
  private validateDimensions(dimensions: PresetDimension[]): void {
    if (!Array.isArray(dimensions) || dimensions.length === 0) {
      throw new BusinessError(ErrorCode.PARAM_INVALID, '维度列表不能为空', 400);
    }
    const keys = new Set<string>();
    let sum = 0;
    for (const dim of dimensions) {
      if (!dim.key || !dim.label || !dim.labelEn) {
        throw new BusinessError(ErrorCode.PARAM_INVALID, '维度字段不完整(key/label/labelEn)', 400);
      }
      if (typeof dim.weight !== 'number' || dim.weight < 0 || dim.weight > 100) {
        throw new BusinessError(ErrorCode.PARAM_INVALID, `维度 "${dim.key}" 权重必须在 0-100 之间`, 400);
      }
      if (keys.has(dim.key)) {
        throw new BusinessError(ErrorCode.PARAM_INVALID, `维度 key 重复:${dim.key}`, 400);
      }
      keys.add(dim.key);
      sum += dim.weight;
    }
    if (Math.abs(sum - 100) > WEIGHT_SUM_TOLERANCE) {
      throw new BusinessError(
        ErrorCode.PHASE5_PRESET_DIMENSION_MISMATCH,
        `维度权重总和必须为 100,当前为 ${sum}`,
        400,
      );
    }
  }

  /**
   * 断言预设可被当前用户修改(非 built-in + 本人创建)
   */
  private async assertModifiable(id: string, userId: string, tenantId: string): Promise<EvaluationPreset> {
    const preset = await presetRepository.findById(id);
    if (!preset) {
      throw new BusinessError(ErrorCode.PHASE5_PRESET_NOT_FOUND, '预设不存在', 404);
    }
    if (preset.isBuiltIn) {
      throw new BusinessError(
        ErrorCode.PHASE5_PRESET_BUILTIN_IMMUTABLE,
        '内置预设不可修改或删除',
        403,
      );
    }
    // 多租户隔离:非内置预设必须属于当前租户
    if (preset.tenantId !== tenantId) {
      throw new BusinessError(ErrorCode.TENANT_MISMATCH, '无权操作其他租户的预设', 403);
    }
    if (preset.creatorId !== userId) {
      throw new BusinessError(ErrorCode.FORBIDDEN, '仅预设创建者可修改或删除', 403);
    }
    return preset;
  }

  /** DB 模型 → Summary */
  private toSummary(p: EvaluationPreset): EvaluationPresetSummary {
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      styleType: p.styleType as PresetStyle,
      artType: p.artType as ArtType,
      applicableStage: p.applicableStage as PresetStage,
      isBuiltIn: p.isBuiltIn,
      isPrivate: p.isPrivate,
      forkedFromId: p.forkedFromId,
      creatorId: p.creatorId,
      enabled: p.enabled,
      sortOrder: p.sortOrder,
    };
  }

  /** DB 模型 → Detail */
  private toDetail(p: EvaluationPreset): EvaluationPresetDetail {
    return {
      ...this.toSummary(p),
      dimensions: p.dimensions as unknown as PresetDimension[],
      rationale: null,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    };
  }
}

export const presetService = new PresetServiceClass();
