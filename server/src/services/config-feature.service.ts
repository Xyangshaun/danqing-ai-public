// ============================================================
// 功能开关(feature flag)服务(M2-T6)
// 对应契约:api-contract.ts §3.11.4(FeatureFlag / FeatureFlagStatus / FeatureFlagType)
// 对应路由:GET /config/features + PATCH /config/features/:featureId(现有 config.routes)
// 对应文档:.trae/documents/m2-generation-plan-2026-08-07.md §9(配置开关)+ 门禁 M2-4
//
// 背景:
//   现有 config.controller 的 feature flag 为预留占位(统一 501),无存储实现。
//   本服务"复用现有 config feature 机制"(沿用冻结契约类型 + /config/features 路由 +
//   权限矩阵),补齐存储与判定逻辑,不另建一套平行系统。
//
// 存储策略:
//   - 内存 Map 为当前进程真源(默认从常量定义种子初始化)
//   - 变更时尽力持久化到 Redis(config:feature:{featureId},JSON),支持跨进程/重启后灰度保持
//   - Redis 不可用时回退内存(功能开关在当前进程内仍生效),不阻断主流程
//
// 关键能力:
//   - isGenerationEnabled(tenantId?):生成功能开关(默认关闭,经 /config 灰度开启)
//   - isEnabled(featureId, tenantId?):通用判定(enabled/disabled/gradual 三态)
//   - listFeatures / getFeature / updateFeature:供 config.controller 接线
//
// 安全:
//   - 不记录敏感信息;开关判定为纯内存操作,不阻塞 3 秒 SLA 主链路
//   - 日志仅记录 featureId/status,不记录完整 value 中的用户列表细节
// ============================================================

import { redis } from '../config/redis.js';
import { logger } from '../utils/logger.js';
import { BusinessError } from '../middlewares/error-handler.js';
import { ErrorCode, type FeatureFlag, type FeatureFlagStatus, type FeatureFlagType } from '../types/api-contract.js';

/**
 * Redis 存储 key 前缀(config:feature:{featureId})
 */
const REDIS_PREFIX = 'config:feature:';

/**
 * 功能开关定义(默认值种子)
 * 新增开关在此登记;默认 status 决定功能默认开/关
 */
interface FeatureDefinition {
  featureId: string;
  name: string;
  description: string;
  type: FeatureFlagType;
  defaultStatus: FeatureFlagStatus;
  defaultValue: boolean | number | string[];
  defaultTargetUserIds?: string[];
  defaultTargetTenantIds?: string[];
}

/**
 * 已登记的功能开关定义
 * 生成功能默认关闭(门禁 M2-4:生成功能默认关闭,经 /api/v1/config 灰度开启)
 *
 * M2-T9(devops-qa)修正:
 *   1) 历史上一处生产热修复(runbook §10.3)将 defaultStatus 误改为 'enabled',
 *      与本计划门禁 M2-4"生成功能默认关闭"冲突。默认关闭是安全性/成本护栏:
 *      AI 图像生成为付费外部 API,默认关闭可避免未授权成本;经 /config 灰度
 *      (disabled → gradual → enabled)逐步放量。本任务恢复为 'disabled'。
 *   2) 类型由 'boolean' 改为 'percentage',使 gradual 真正支持"按租户哈希放量"
 *      (hashForTenant < value 判定)。boolean 类型 gradual 仅支持全量开/关,
 *      无法满足计划"按租户灰度开启"(门禁 M2-4)的成本可控放量诉求。
 *      defaultValue=0:即使误切 gradual 且未设 value 也按 0% 放量(fail-closed)。
 */
const FEATURE_DEFINITIONS: readonly FeatureDefinition[] = [
  {
    featureId: 'generation',
    name: 'AI 图像生成',
    description: 'AI 图像生成功能(异步队列 + 教学闭环),默认关闭,经 /api/v1/config 按租户百分比灰度开启',
    type: 'percentage',
    defaultStatus: 'disabled',
    defaultValue: 0,
  },
  // M-4 风格迁移生图专项(m4-style-transfer-plan §2.8):
  //   独立于 generation 开关——style 模式单任务多一次 GLM-4V 风格分析调用且涉版权
  //   敏感面,需可单独灰度/熔断(一键关闭仅拒新 style 任务,存量任务自然收敛,
  //   不影响 text/sketch 模式与诊断主链路)。
  //   fail-closed 对齐 generation 先例(门禁 M2-4):defaultStatus='disabled' +
  //   type='percentage' + defaultValue=0(即使误切 gradual 且未设 value 也按 0% 放量)。
  {
    featureId: 'styleTransfer',
    name: '风格迁移生图',
    description: 'style 模式风格迁移生图(GLM-4V 风格分析 + 组合 prompt 生图),独立于 generation 开关,默认关闭,经 /api/v1/config 按租户百分比灰度开启',
    type: 'percentage',
    defaultStatus: 'disabled',
    defaultValue: 0,
  },
  // M3 可观测性(对应 m3-observability-plan §6.2 灰度发布)
  // 三个开关相互独立:metrics(指标接口)可单独开启,alerting(告警)可单独开启,
  // trace_id_log(traceId 写入)可单独开启。建议灰度顺序:metrics → alerting → trace_id_log。
  {
    featureId: 'metrics',
    name: '可观测性指标接口',
    description: '/api/admin/metrics/* 指标接口灰度(默认关闭,按租户百分比灰度开启)',
    type: 'percentage',
    defaultStatus: 'disabled',
    defaultValue: 0,
  },
  {
    featureId: 'alerting',
    name: '告警通道',
    description: '指标阈值告警通道(默认关闭,全量或按租户开启;关闭时 fail-closed 不触发)',
    type: 'boolean',
    defaultStatus: 'disabled',
    defaultValue: false,
  },
  {
    featureId: 'trace_id_log',
    name: 'AiUsageLog traceId 贯通',
    description: 'traceId 写入 AiUsageLog(默认关闭,灰度开启,避免一次性写满 traceId 字段)',
    type: 'boolean',
    defaultStatus: 'disabled',
    defaultValue: false,
  },
];

/**
 * 将 FeatureDefinition + 可选覆盖转为契约 FeatureFlag 对象
 */
function toFeatureFlag(def: FeatureDefinition): FeatureFlag {
  const now = new Date().toISOString();
  return {
    featureId: def.featureId,
    name: def.name,
    description: def.description,
    type: def.type,
    status: def.defaultStatus,
    value: def.defaultValue,
    defaultValue: def.defaultValue,
    targetUserIds: def.defaultTargetUserIds ?? [],
    targetTenantIds: def.defaultTargetTenantIds ?? [],
    createdById: 'system',
    updatedById: 'system',
    createdAt: now,
    updatedAt: now,
  };
}

class ConfigFeatureServiceClass {
  /** 当前进程内开关真源(featureId → FeatureFlag) */
  private readonly flags = new Map<string, FeatureFlag>();
  /** 是否已完成从 Redis 的初始化拉取 */
  private hydrated = false;

  constructor() {
    // 用默认定义初始化内存真源
    for (const def of FEATURE_DEFINITIONS) {
      this.flags.set(def.featureId, toFeatureFlag(def));
    }
  }

  /**
   * 从 Redis 拉取覆盖值(尽力而为)
   * 仅在首次访问时执行一次;Redis 不可用/无覆盖时保持内存默认
   */
  private async ensureHydrated(): Promise<void> {
    if (this.hydrated) return;
    this.hydrated = true;
    for (const def of FEATURE_DEFINITIONS) {
      try {
        const raw = await redis().get(`${REDIS_PREFIX}${def.featureId}`);
        if (raw) {
          const parsed = JSON.parse(raw) as FeatureFlag;
          if (parsed && parsed.featureId === def.featureId) {
            this.flags.set(def.featureId, { ...toFeatureFlag(def), ...parsed });
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(
          { err: msg, featureId: def.featureId },
          '[config-feature] hydrate from redis failed, using default',
        );
      }
    }
  }

  /**
   * 持久化单个开关到 Redis(尽力而为,失败不影响内存真源)
   */
  private async persist(featureId: string, flag: FeatureFlag): Promise<void> {
    try {
      await redis().set(`${REDIS_PREFIX}${featureId}`, JSON.stringify(flag));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(
        { err: msg, featureId },
        '[config-feature] persist to redis failed (non-blocking)',
      );
    }
  }

  /**
   * 获取单个开关(返回快照副本,防外部误改内部状态)
   */
  async getFeature(featureId: string): Promise<FeatureFlag | undefined> {
    await this.ensureHydrated();
    const flag = this.flags.get(featureId);
    return flag ? { ...flag } : undefined;
  }

  /**
   * 列出全部功能开关(可选按状态/关键词过滤,对齐 ListFeatureFlagsQuery)
   */
  async listFeatures(params?: { status?: FeatureFlagStatus; q?: string }): Promise<FeatureFlag[]> {
    await this.ensureHydrated();
    let list = Array.from(this.flags.values());
    if (params?.status) {
      list = list.filter((f) => f.status === params.status);
    }
    if (params?.q) {
      const q = params.q.toLowerCase();
      list = list.filter(
        (f) => f.featureId.toLowerCase().includes(q) || f.name.toLowerCase().includes(q),
      );
    }
    return list.map((f) => ({ ...f }));
  }

  /**
   * 更新功能开关(供 PATCH /config/features/:featureId 接线)
   * @throws BusinessError(FEATURE_NOT_FOUND 8401,404) 开关不存在
   */
  async updateFeature(
    featureId: string,
    patch: {
      status?: FeatureFlagStatus;
      value?: boolean | number | string[];
      targetUserIds?: string[];
      targetTenantIds?: string[];
    },
    operatorId: string,
  ): Promise<FeatureFlag> {
    await this.ensureHydrated();
    const current = this.flags.get(featureId);
    if (!current) {
      throw new BusinessError(ErrorCode.FEATURE_NOT_FOUND, `功能开关不存在:${featureId}`, 404);
    }

    const updated: FeatureFlag = {
      ...current,
      status: patch.status ?? current.status,
      value: patch.value !== undefined ? patch.value : current.value,
      targetUserIds: patch.targetUserIds ?? current.targetUserIds,
      targetTenantIds: patch.targetTenantIds ?? current.targetTenantIds,
      updatedById: operatorId,
      updatedAt: new Date().toISOString(),
    };

    this.flags.set(featureId, updated);
    await this.persist(featureId, updated);

    logger.info(
      { action: 'config.feature.update', featureId, status: updated.status, operatorId },
      '[audit] feature flag updated',
    );
    return { ...updated };
  }

  /**
   * 判定某功能开关是否开启(通用)
   * 三态语义:
   *   - enabled:开启
   *   - disabled:关闭
   *   - gradual:灰度,按 type 细分
   *       boolean → value 为 true 即开启
   *       percentage → 按 tenantId 确定性哈希 < value(0-100)判定
   *       tenant-list → tenantId 在 value 或 targetTenantIds 中
   *       user-list → 无 userId 时保守放行,有 userId 时放行(生成功能未用该类型)
   *
   * @param featureId 开关标识
   * @param tenantId 可选;传值时做按租户灰度判定;不传时返回"全局是否可运行"
   *                 (enabled 或 gradual 均视为需运行,供 worker 启动判定)
   */
  isEnabled(featureId: string, tenantId?: string): boolean {
    const flag = this.flags.get(featureId);
    if (!flag) return false;
    if (flag.status === 'enabled') return true;
    if (flag.status === 'disabled') return false;

    // gradual(灰度)分支
    switch (flag.type) {
      case 'boolean':
        return flag.value === true;
      case 'percentage': {
        if (!tenantId) return true; // 全局视角:灰度进行中,worker 需运行
        const pct = typeof flag.value === 'number' ? flag.value : 0;
        return this.hashForTenant(featureId, tenantId) < pct;
      }
      case 'tenant-list': {
        if (!tenantId) return true; // 全局视角:灰度进行中
        const tenants = Array.isArray(flag.value) ? (flag.value as string[]) : [];
        return tenants.includes(tenantId) || flag.targetTenantIds.includes(tenantId);
      }
      case 'user-list':
        // 生成功能未用 user-list;无 userId 上下文时保守放行
        return true;
      default:
        return false;
    }
  }

  /**
   * 生成功能开关(默认关闭)
   * @param tenantId 可选;传值按租户灰度判定(createGeneration 入口校验用)
   * @returns true=开启 / false=关闭
   */
  isGenerationEnabled(tenantId?: string): boolean {
    return this.isEnabled('generation', tenantId);
  }

  /**
   * 风格迁移生图开关(M-4;默认关闭,fail-closed)
   * 独立于 generation 开关:generation 开启仅放行 text/sketch;
   * style 模式需本开关同时开启(createGeneration style 分支前置校验,关闭 → 403)
   * @param tenantId 可选;传值按租户灰度判定
   */
  isStyleTransferEnabled(tenantId?: string): boolean {
    return this.isEnabled('styleTransfer', tenantId);
  }

  /**
   * 可观测性指标接口开关(M3;默认关闭)
   * @param tenantId 可选;传值按租户灰度判定
   */
  isMetricsEnabled(tenantId?: string): boolean {
    return this.isEnabled('metrics', tenantId);
  }

  /**
   * 告警通道开关(M3;默认关闭,fail-closed)
   * @param tenantId 可选;传值按租户判定
   */
  isAlertingEnabled(tenantId?: string): boolean {
    return this.isEnabled('alerting', tenantId);
  }

  /**
   * AiUsageLog traceId 贯通开关(M3;默认关闭,灰度开启)
   * @param tenantId 可选;传值按租户判定
   */
  isTraceIdLogEnabled(tenantId?: string): boolean {
    return this.isEnabled('trace_id_log', tenantId);
  }

  /**
   * 重置为默认值(运维/测试用:清除覆盖,恢复种子默认)
   */
  async resetToDefaults(): Promise<void> {
    for (const def of FEATURE_DEFINITIONS) {
      this.flags.set(def.featureId, toFeatureFlag(def));
      try {
        await redis().del(`${REDIS_PREFIX}${def.featureId}`);
      } catch {
        // 清理 Redis 尽力而为
      }
    }
  }

  /**
   * 按租户确定哈希(0-99),用于 percentage 灰度判定
   */
  private hashForTenant(featureId: string, tenantId: string): number {
    const s = `${featureId}:${tenantId}`;
    let h = 0;
    for (let i = 0; i < s.length; i++) {
      h = (h * 31 + s.charCodeAt(i)) >>> 0;
    }
    return h % 100;
  }
}

export const configFeatureService = new ConfigFeatureServiceClass();
