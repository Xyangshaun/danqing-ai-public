// ============================================================
// 租户级仲裁配置服务(M-1 DOC-2026-08-003/004/005)
// 对应 API:
//   GET /api/admin/tenants/:id/arbitration-config
//   PUT /api/admin/tenants/:id/arbitration-config
//
// 职责:
//   1. 读取生效仲裁配置:优先读 DB 持久化(Tenant.arbitration_config),
//      memory 注册表(arg arbitration-default)保留为二级缓存,防双写漂移
//   2. 更新租户仲裁配置:深合并 + Zod 全量校验 + 权重归一化校验 + 审计日志
//   3. 解决遗留 R-1:getArbitrationConfig 由"纯内存"改为"DB 优先"
//
// 设计原则:
//   - DB 为唯一持久化真源,memory 仅为二级缓存(读时同步,防漂移)
//   - 存"部分覆盖片段"(Partial<ArbitrationConfig>),未覆盖字段继承系统默认
//   - 校验作用于"合并后的生效配置"(避免仅覆盖一权导致权重和≠1 却通过)
//   - 非法返回 ARBITRATION_CONFIG_INVALID(9110)
//   - 配置变更写 AuditLog(auditAction=update, resource=tenant)
// ============================================================

import type { Request } from 'express';
import { z } from 'zod';
import {
  DEFAULT_ARBITRATION_CONFIG,
  deepMergeArbitrationConfig,
  getArbitrationConfig,
  setTenantArbitrationOverride,
} from '../config/arbitration-default.js';
import { tenantRepository, type TenantArbitrationRecord } from '../repositories/tenant.repository.js';
import { writeAudit } from './admin-audit.service.js';
import { BusinessError } from '../middlewares/error-handler.js';
import { ErrorCode } from '../types/api-contract.js';
import type {
  GetTenantArbitrationConfigResponse,
  UpdateTenantArbitrationConfigRequest,
} from '../types/api-contract.js';
import type { ArbitrationConfig, DeepPartial } from '../types/arbitration.js';
import { logger } from '../utils/logger.js';

/** 权重归一化容差(浮点误差) */
const WEIGHT_EPSILON = 1e-3;

/** 权重字段 0-1 范围校验 */
const weightField = z.number().min(0, '权重不能为负').max(1, '权重不能超过 1');

/** 阈值字段校验(正数) */
const positiveThreshold = z.number().positive('阈值必须为正数');
/** 非负字段校验 */
const nonNegative = z.number().nonnegative('取值不能为负');

/** 完整仲裁配置 Zod 全量校验(作用于合并后的生效配置) */
const arbitrationConfigSchema = z.object({
  triggers: z.object({
    consistentTotalRange: positiveThreshold,
    consistentDimDiff: positiveThreshold,
    generalDisputeTotalRange: positiveThreshold,
    generalDisputeDimDiff: positiveThreshold,
    highDisputeTotalRange: positiveThreshold,
    highDisputeDimCount: positiveThreshold,
    gradeCrossTierHigh: positiveThreshold,
    vetoLowGrade: positiveThreshold,
    vetoHighGrade: positiveThreshold,
  }),
  judgeWeights: z.object({
    regular: z.object({ professor: weightField, lecturer: weightField, ai: weightField }),
    professorAi: z.object({ professor: weightField, ai: weightField }),
    committee: z.object({ professorEach: weightField, ai: weightField }),
  }),
  rules: z.object({
    final: z.enum(['weighted', 'majority', 'unanimous']),
    boundaryTolerance: nonNegative,
  }),
  edgeCases: z.object({
    outlierDiff: positiveThreshold,
    outlierWeightFactor: weightField,
    aiLowConfidence: weightField,
    aiLowConfidenceWeight: weightField,
    aiVeryLowConfidence: weightField,
    aiHumanExtremeDiff: positiveThreshold,
    maxMissingDimsToInvalidate: positiveThreshold,
  }),
});

class TenantArbitrationServiceClass {
  /**
   * 获取租户生效仲裁配置(DB 优先,memory 二级缓存)
   * 解决遗留 R-1:仲裁配置以 DB 持久化为主,防双写漂移
   *
   * @returns 合并后的完整生效配置(未配置回退系统默认)
   */
  async getEffectiveConfig(tenantId: string): Promise<ArbitrationConfig> {
    const record = await tenantRepository.getArbitrationRecord(tenantId);
    if (record) {
      // DB 持久化为主,同步 memory 二级缓存(防双写漂移:以 DB 覆盖内存)
      setTenantArbitrationOverride(tenantId, record.config);
      return deepMergeArbitrationConfig(DEFAULT_ARBITRATION_CONFIG, record.config);
    }
    // 无持久化记录 → 回退 memory 覆盖或系统默认
    return getArbitrationConfig(tenantId);
  }

  /**
   * GET /api/admin/tenants/:id/arbitration-config
   * 返回租户仲裁配置详情(含生效配置/是否默认/更新时间/更新人)
   */
  async getConfigForAdmin(tenantId: string): Promise<GetTenantArbitrationConfigResponse> {
    const tenant = await tenantRepository.findById(tenantId);
    if (!tenant) {
      throw new BusinessError(ErrorCode.TENANT_NOT_FOUND, '租户不存在', 404);
    }
    const record = await tenantRepository.getArbitrationRecord(tenantId);
    const effective = record
      ? deepMergeArbitrationConfig(DEFAULT_ARBITRATION_CONFIG, record.config)
      : DEFAULT_ARBITRATION_CONFIG;
    return {
      tenantId,
      effectiveConfig: effective,
      isDefault: !record,
      updatedAt: record?.updatedAt ?? null,
      updatedBy: record?.updatedBy ?? null,
    };
  }

  /**
   * PUT /api/admin/tenants/:id/arbitration-config
   * 更新租户仲裁配置(深合并 + Zod 全量校验 + 权重归一化校验 + 审计日志)
   *
   * @param tenantId 目标租户 ID
   * @param override 部分覆盖配置(triggers/judgeWeights/rules/edgeCases)
   * @param operatorId 操作者 ID
   * @param req 请求上下文(审计日志用)
   */
  async updateConfig(
    tenantId: string,
    override: UpdateTenantArbitrationConfigRequest,
    operatorId: string,
    req: Request,
  ): Promise<GetTenantArbitrationConfigResponse> {
    const tenant = await tenantRepository.findById(tenantId);
    if (!tenant) {
      throw new BusinessError(ErrorCode.TENANT_NOT_FOUND, '租户不存在', 404);
    }

    // 1. 构造覆盖片段(仅传字段,未传字段由深合并继承默认)
    const overrideTree = buildOverrideTree(override);

    // 2. 合并得到生效配置 → 全量校验(Zod 结构 + 权重归一化)
    const effective = deepMergeArbitrationConfig(DEFAULT_ARBITRATION_CONFIG, overrideTree);
    this.validateEffectiveConfig(effective);

    // 3. 构造持久化记录并写入 DB(Tenant.arbitration_config)
    const record: TenantArbitrationRecord = {
      config: overrideTree,
      updatedBy: operatorId,
      updatedAt: new Date().toISOString(),
    };
    await tenantRepository.setArbitrationRecord(tenantId, record);

    // 4. 同步 memory 二级缓存(防双写漂移:以 DB 最新值为准)
    setTenantArbitrationOverride(tenantId, overrideTree);

    // 5. 审计日志(auditAction=update, resource=tenant;不记录敏感信息)
    await writeAudit({
      req,
      action: 'update',
      resource: 'tenant',
      resourceId: tenantId,
      targetTenantId: tenantId,
      beforeData: null,
      afterData: { arbitrationConfig: overrideTree },
      note: `更新租户仲裁配置 ${tenantId}`,
    });

    logger.info(
      {
        tenantId,
        operatorId,
        updatedKeys: Object.keys(overrideTree),
      },
      '[tenant-arbitration] config updated',
    );

    // 6. 返回最新生效配置
    return this.getConfigForAdmin(tenantId);
  }

  /**
   * 校验生效配置(Zod 结构 + 权重归一化)
   * 非法抛出 ARBITRATION_CONFIG_INVALID(9110)
   */
  private validateEffectiveConfig(cfg: ArbitrationConfig): void {
    const parsed = arbitrationConfigSchema.safeParse(cfg);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const msg = `仲裁配置校验失败:${first?.path.join('.') ?? 'unknown'} ${first?.message ?? 'invalid'}`;
      throw new BusinessError(ErrorCode.ARBITRATION_CONFIG_INVALID, msg, 400);
    }

    // 权重归一化:每模式权重和=1(容差 WEIGHT_EPSILON)
    const sums: Array<[string, number]> = [
      [
        'regular',
        cfg.judgeWeights.regular.professor +
          cfg.judgeWeights.regular.lecturer +
          cfg.judgeWeights.regular.ai,
      ],
      ['professorAi', cfg.judgeWeights.professorAi.professor + cfg.judgeWeights.professorAi.ai],
      ['committee', cfg.judgeWeights.committee.professorEach + cfg.judgeWeights.committee.ai],
    ];
    for (const [mode, sum] of sums) {
      if (Math.abs(sum - 1) > WEIGHT_EPSILON) {
        throw new BusinessError(
          ErrorCode.ARBITRATION_CONFIG_INVALID,
          `仲裁配置校验失败:${mode} 模式权重和=${Math.round(sum * 1000) / 1000},必须等于 1`,
          400,
        );
      }
    }
  }
}

/**
 * 将 UpdateTenantArbitrationConfigRequest 转为 DeepPartial<ArbitrationConfig> 覆盖片段
 * 仅保留传入的顶层分组(triggers/judgeWeights/rules/edgeCases),未传则为 undefined
 */
function buildOverrideTree(
  override: UpdateTenantArbitrationConfigRequest,
): DeepPartial<ArbitrationConfig> {
  const tree: DeepPartial<ArbitrationConfig> = {};
  if (override.triggers) tree.triggers = override.triggers;
  if (override.judgeWeights) tree.judgeWeights = override.judgeWeights;
  if (override.rules) tree.rules = override.rules;
  if (override.edgeCases) tree.edgeCases = override.edgeCases;
  return tree;
}

export const tenantArbitrationService = new TenantArbitrationServiceClass();