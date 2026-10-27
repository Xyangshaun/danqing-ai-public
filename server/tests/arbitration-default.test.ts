// ============================================================
// 租户级仲裁配置覆盖 单元测试
// 对应源码: src/config/arbitration-default.ts
//
// 测试范围:
//   1. getArbitrationConfig 默认行为(无 tenantId / 无覆盖)
//   2. setTenantArbitrationOverride 深度合并
//   3. clearTenantArbitrationOverride / clearAllTenantArbitrationOverrides
//   4. 深度合并不污染 DEFAULT_ARBITRATION_CONFIG
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEFAULT_ARBITRATION_CONFIG,
  getArbitrationConfig,
  setTenantArbitrationOverride,
  clearTenantArbitrationOverride,
  clearAllTenantArbitrationOverrides,
} from '../src/config/arbitration-default.js';

describe('arbitration-default: 租户级配置覆盖', () => {
  beforeEach(() => {
    clearAllTenantArbitrationOverrides();
  });

  it('无 tenantId 返回系统默认(引用相同)', () => {
    const cfg = getArbitrationConfig();
    expect(cfg).toEqual(DEFAULT_ARBITRATION_CONFIG);
  });

  it('有 tenantId 但无覆盖返回系统默认', () => {
    const cfg = getArbitrationConfig('tenant-no-override');
    expect(cfg).toEqual(DEFAULT_ARBITRATION_CONFIG);
  });

  it('单字段覆盖:triggers.consistentTotalRange', () => {
    setTenantArbitrationOverride('t1', {
      triggers: { consistentTotalRange: 10 },
    });
    const cfg = getArbitrationConfig('t1');
    expect(cfg.triggers.consistentTotalRange).toBe(10);
    // 其余 triggers 字段保留默认
    expect(cfg.triggers.consistentDimDiff).toBe(
      DEFAULT_ARBITRATION_CONFIG.triggers.consistentDimDiff,
    );
    expect(cfg.triggers.generalDisputeTotalRange).toBe(
      DEFAULT_ARBITRATION_CONFIG.triggers.generalDisputeTotalRange,
    );
  });

  it('嵌套覆盖:judgeWeights.regular 整体替换', () => {
    setTenantArbitrationOverride('t2', {
      judgeWeights: {
        regular: { professor: 0.6, lecturer: 0.2, ai: 0.2 },
      },
    });
    const cfg = getArbitrationConfig('t2');
    expect(cfg.judgeWeights.regular).toEqual({
      professor: 0.6,
      lecturer: 0.2,
      ai: 0.2,
    });
    // professorAi / committee 保留默认
    expect(cfg.judgeWeights.professorAi).toEqual(
      DEFAULT_ARBITRATION_CONFIG.judgeWeights.professorAi,
    );
    expect(cfg.judgeWeights.committee).toEqual(
      DEFAULT_ARBITRATION_CONFIG.judgeWeights.committee,
    );
  });

  it('多区域覆盖:triggers + edgeCases 同时覆盖', () => {
    setTenantArbitrationOverride('t3', {
      triggers: { highDisputeTotalRange: 25 },
      edgeCases: { outlierDiff: 30, aiLowConfidence: 0.5 },
    });
    const cfg = getArbitrationConfig('t3');
    expect(cfg.triggers.highDisputeTotalRange).toBe(25);
    expect(cfg.edgeCases.outlierDiff).toBe(30);
    expect(cfg.edgeCases.aiLowConfidence).toBe(0.5);
    // 未覆盖的 edgeCases 字段保留默认
    expect(cfg.edgeCases.outlierWeightFactor).toBe(
      DEFAULT_ARBITRATION_CONFIG.edgeCases.outlierWeightFactor,
    );
  });

  it('深度合并不污染 DEFAULT_ARBITRATION_CONFIG', () => {
    const originalRange = DEFAULT_ARBITRATION_CONFIG.triggers.consistentTotalRange;
    setTenantArbitrationOverride('t4', {
      triggers: { consistentTotalRange: 99 },
    });
    getArbitrationConfig('t4');
    expect(DEFAULT_ARBITRATION_CONFIG.triggers.consistentTotalRange).toBe(
      originalRange,
    );
  });

  it('clearTenantArbitrationOverride 回退到系统默认', () => {
    setTenantArbitrationOverride('t5', {
      triggers: { consistentTotalRange: 10 },
    });
    expect(getArbitrationConfig('t5').triggers.consistentTotalRange).toBe(10);
    clearTenantArbitrationOverride('t5');
    expect(getArbitrationConfig('t5')).toEqual(DEFAULT_ARBITRATION_CONFIG);
  });

  it('不同租户覆盖互不影响', () => {
    setTenantArbitrationOverride('tA', {
      triggers: { consistentTotalRange: 7 },
    });
    setTenantArbitrationOverride('tB', {
      triggers: { consistentTotalRange: 12 },
    });
    expect(getArbitrationConfig('tA').triggers.consistentTotalRange).toBe(7);
    expect(getArbitrationConfig('tB').triggers.consistentTotalRange).toBe(12);
    expect(getArbitrationConfig('tC')).toEqual(DEFAULT_ARBITRATION_CONFIG);
  });

  it('空字符串 tenantId 忽略覆盖', () => {
    setTenantArbitrationOverride('', {
      triggers: { consistentTotalRange: 99 },
    });
    expect(getArbitrationConfig('')).toEqual(DEFAULT_ARBITRATION_CONFIG);
  });
});
