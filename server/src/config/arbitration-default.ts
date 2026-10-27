// ============================================================
// 丹青有AI - 仲裁配置默认值(Phase 5)
// 对应文档:.trae/documents/art-evaluation-research.md §3.1, §3.3, §3.5
//          .trae/documents/new-features-design.md §4.3
// 系统级全局默认配置;v2 支持租户级覆盖(setTenantArbitrationOverride + 深度合并)
// ============================================================

import type { ArbitrationConfig, DeepPartial } from '../types/arbitration.js';

/**
 * 系统默认仲裁配置
 * 阈值来源:art-evaluation-research.md §3.1(央美/国美/清华三校评审经验值)
 *
 * 说明:
 * - consistent:总分极差<5 且维度差<8 → 一致,直接加权出分
 * - general:总分极差≥10 或维度差≥15 → 一般争议,单人复核
 * - high:总分极差≥20 或 ≥2 维度差≥15 或跨档≥2 → 委员会复议
 * - veto:任一评委判 E(<60)且其余判 A(≥90) → 强制委员会复议
 *
 * 评委权重:
 * - 常规双评委:教授 0.5 / 讲师 0.3 / AI 0.2(教授主导但具实质制衡)
 * - 教授+AI 双人:教授 0.7 / AI 0.3
 * - 委员会复议:每位教授 0.3 / AI 0.1(高争议属专业判断,AI 仅参考)
 *
 * 边界处理:
 * - 离群分差≥25 → 权重折半(×0.5)
 * - AI 置信度<0.6 → AI 权重降至 0.1
 * - AI 置信度<0.4 → AI 评分仅作参考不计入加权
 * - 缺失维度>2 → 评分作废
 */
export const DEFAULT_ARBITRATION_CONFIG: ArbitrationConfig = {
  triggers: {
    consistentTotalRange: 5,
    consistentDimDiff: 8,
    generalDisputeTotalRange: 10,
    generalDisputeDimDiff: 15,
    highDisputeTotalRange: 20,
    highDisputeDimCount: 2,
    gradeCrossTierHigh: 2,
    vetoLowGrade: 60,
    vetoHighGrade: 90,
  },
  judgeWeights: {
    regular: { professor: 0.5, lecturer: 0.3, ai: 0.2 },
    professorAi: { professor: 0.7, ai: 0.3 },
    committee: { professorEach: 0.3, ai: 0.1 },
  },
  rules: {
    final: 'weighted',
    boundaryTolerance: 1,
  },
  edgeCases: {
    outlierDiff: 25,
    outlierWeightFactor: 0.5,
    aiLowConfidence: 0.6,
    aiLowConfidenceWeight: 0.1,
    aiVeryLowConfidence: 0.4,
    aiHumanExtremeDiff: 20,
    maxMissingDimsToInvalidate: 2,
  },
};

/**
 * 深度合并两个仲裁配置(override 优先于 default,逐字段递归覆盖)
 *
 * 设计:
 *  - 仅对普通对象递归合并,基本类型/数组直接覆盖
 *  - 不修改入参(返回新对象),避免污染 DEFAULT_ARBITRATION_CONFIG
 *  - override 中 undefined 的字段不覆盖 default(保留默认值)
 *
 * 导出供租户仲裁配置服务(tenant-arbitration.service.ts)复用:
 *  - 合并 DB 持久化覆盖片段 → 生效配置
 *  - 合并内存覆盖 → 生效配置
 */
export function deepMergeArbitrationConfig(
  base: ArbitrationConfig,
  override: DeepPartial<ArbitrationConfig>,
): ArbitrationConfig {
  const isPlainObject = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v);

  const merge = <T>(b: T, o: unknown): T => {
    if (!isPlainObject(b) || !isPlainObject(o)) {
      // 基本类型或数组:override 优先(undefined 不覆盖)
      return (o === undefined ? b : (o as T));
    }
    const result: Record<string, unknown> = { ...b };
    for (const key of Object.keys(o)) {
      const ov = o[key];
      if (ov === undefined) continue;
      result[key] = merge((b as Record<string, unknown>)[key], ov);
    }
    return result as T;
  };

  return merge(base, override);
}

/**
 * 租户级仲裁配置覆盖注册表(内存态)
 *
 * 说明:
 *  - v2 实现:支持租户级仲裁阈值/权重覆盖,无需 DB 迁移即可生效
 *  - 键=tenantId,值=部分覆盖配置(深度合并到系统默认)
 *  - 持久化(写入 Tenant.config)为后续增强项;当前内存态满足
 *    运营即时调整 + 单元测试需求
 *  - 调用 setTenantArbitrationOverride 注册覆盖,
 *    clearTenantArbitrationOverride 清除,
 *    clearAllTenantArbitrationOverrides 清空全部(测试用)
 */
const tenantArbitrationOverrides = new Map<string, DeepPartial<ArbitrationConfig>>();

/**
 * 设置租户级仲裁配置覆盖(深度合并到系统默认)
 * @param tenantId 租户 ID
 * @param override 部分覆盖配置(仅传需覆盖的字段)
 */
export function setTenantArbitrationOverride(
  tenantId: string,
  override: DeepPartial<ArbitrationConfig>,
): void {
  if (!tenantId) return;
  tenantArbitrationOverrides.set(tenantId, override);
}

/**
 * 清除指定租户的仲裁配置覆盖(回退到系统默认)
 */
export function clearTenantArbitrationOverride(tenantId: string): void {
  tenantArbitrationOverrides.delete(tenantId);
}

/**
 * 清空全部租户级覆盖(单元测试用)
 */
export function clearAllTenantArbitrationOverrides(): void {
  tenantArbitrationOverrides.clear();
}

/**
 * 获取仲裁配置
 *
 * v2 实现:支持租户级覆盖
 *  - 无 tenantId 或无覆盖 → 返回系统默认
 *  - 有覆盖 → 深度合并(override 优先于 default)
 *
 * @param tenantId 租户 ID(用于读取租户级覆盖)
 */
export function getArbitrationConfig(tenantId?: string): ArbitrationConfig {
  if (!tenantId) return DEFAULT_ARBITRATION_CONFIG;
  const override = tenantArbitrationOverrides.get(tenantId);
  if (!override) return DEFAULT_ARBITRATION_CONFIG;
  return deepMergeArbitrationConfig(DEFAULT_ARBITRATION_CONFIG, override);
}
