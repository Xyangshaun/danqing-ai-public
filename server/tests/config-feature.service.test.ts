// ============================================================
// ConfigFeatureService 单元测试(M2-T6)
// 对应源码:src/services/config-feature.service.ts(功能开关存储 + 判定)
// 对应契约:api-contract.ts §3.11.4(FeatureFlag)
//
// 测试范围:
//   1. 生成功能默认关闭(门禁 M2-4)
//   2. isGenerationEnabled / isEnabled 三态(disabled/enabled/gradual)判定
//   3. updateFeature 开关切换(开启后生效、关闭后失效、unknown → FEATURE_NOT_FOUND)
//   4. listFeatures / getFeature
//   5. resetToDefaults 恢复默认
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { redisMock } from './setup.js';
import { configFeatureService } from '../src/services/config-feature.service.js';
import { BusinessError } from '../src/middlewares/error-handler.js';
import { ErrorCode } from '../src/types/api-contract.js';

const TENANT_A = 't-feat-a';
const TENANT_B = 't-feat-b';

describe('ConfigFeatureService(功能开关,M2-T6)', () => {
  beforeEach(async () => {
    // 恢复默认:生成功能默认关闭(门禁 M2-4,经 /config 灰度开启)
    await configFeatureService.resetToDefaults();
  });

  it('生成功能默认关闭', async () => {
    expect(configFeatureService.isGenerationEnabled()).toBe(false);
    expect(configFeatureService.isGenerationEnabled(TENANT_A)).toBe(false);
    const feature = await configFeatureService.getFeature('generation');
    expect(feature?.status).toBe('disabled');
    expect(feature?.type).toBe('percentage');
    expect(feature?.value).toBe(0);
  });

  it('listFeatures 返回 generation 开关(默认 disabled)', async () => {
    const features = await configFeatureService.listFeatures();
    const gen = features.find((f) => f.featureId === 'generation');
    expect(gen).toBeDefined();
    expect(gen!.status).toBe('disabled');
  });

  it('listFeatures 按状态过滤', async () => {
    const enabled = await configFeatureService.listFeatures({ status: 'enabled' });
    expect(enabled.some((f) => f.featureId === 'generation')).toBe(false);
    const disabled = await configFeatureService.listFeatures({ status: 'disabled' });
    expect(disabled.some((f) => f.featureId === 'generation')).toBe(true);
  });

  it('updateFeature 开启后 → isGenerationEnabled true(全局 + 按租户)', async () => {
    await configFeatureService.updateFeature('generation', { status: 'enabled' }, 'operator-1');
    expect(configFeatureService.isGenerationEnabled()).toBe(true);
    expect(configFeatureService.isGenerationEnabled(TENANT_A)).toBe(true);
  });

  it('updateFeature 关闭后 → isGenerationEnabled false', async () => {
    await configFeatureService.updateFeature('generation', { status: 'enabled' }, 'operator-1');
    expect(configFeatureService.isGenerationEnabled()).toBe(true);
    await configFeatureService.updateFeature('generation', { status: 'disabled' }, 'operator-1');
    expect(configFeatureService.isGenerationEnabled()).toBe(false);
  });

  it('updateFeature 不存在的开关 → FEATURE_NOT_FOUND(8401,404)', async () => {
    try {
      await configFeatureService.updateFeature('not-exist', { status: 'enabled' }, 'op');
      expect.fail('expected BusinessError(FEATURE_NOT_FOUND)');
    } catch (err) {
      expect(err).toBeInstanceOf(BusinessError);
      expect((err as BusinessError).code).toBe(ErrorCode.FEATURE_NOT_FOUND);
      expect((err as BusinessError).httpStatus).toBe(404);
    }
  });

  it('gradual + value=100 → 全局开启、按租户开启(100% 放量)', async () => {
    await configFeatureService.updateFeature('generation', { status: 'gradual', value: 100 }, 'op');
    expect(configFeatureService.isGenerationEnabled()).toBe(true);
    expect(configFeatureService.isGenerationEnabled(TENANT_A)).toBe(true);
  });

  it('gradual + value=0 → 全局视角进行中、按租户关闭(0% 放量)', async () => {
    await configFeatureService.updateFeature('generation', { status: 'gradual', value: 0 }, 'op');
    // 全局视角(无 tenantId):灰度进行中,worker 需运行 → true
    expect(configFeatureService.isGenerationEnabled()).toBe(true);
    // 按租户:hash < 0 恒为 false → 0% 放量
    expect(configFeatureService.isGenerationEnabled(TENANT_A)).toBe(false);
  });

  it('gradual + percentage 按租户确定性哈希放量', async () => {
    await configFeatureService.updateFeature('generation', { status: 'gradual', value: 50 }, 'op');
    // 同一租户多次判定结果一致(确定性,避免灰度抖动)
    expect(configFeatureService.isGenerationEnabled(TENANT_A)).toBe(
      configFeatureService.isGenerationEnabled(TENANT_A),
    );
    // 0% 恒不命中 / 100% 恒命中(边界)
    await configFeatureService.updateFeature('generation', { status: 'gradual', value: 0 }, 'op');
    expect(configFeatureService.isGenerationEnabled(TENANT_A)).toBe(false);
    await configFeatureService.updateFeature('generation', { status: 'gradual', value: 100 }, 'op');
    expect(configFeatureService.isGenerationEnabled(TENANT_A)).toBe(true);
    // 部分百分比下,不同租户哈希不同 → 存在放行与不放行两类(抽样校验)
    await configFeatureService.updateFeature('generation', { status: 'gradual', value: 50 }, 'op');
    const sample = Array.from({ length: 40 }, (_, i) => configFeatureService.isGenerationEnabled(`t-hash-${i}`));
    expect(sample.some(Boolean)).toBe(true);
    expect(sample.some((v) => !v)).toBe(true);
  });

  it('updateFeature 变更持久化到 Redis', async () => {
    await configFeatureService.updateFeature('generation', { status: 'enabled' }, 'op');
    const raw = redisMock.__peek('config:feature:generation');
    expect(raw).toBeDefined();
    const parsed = JSON.parse(raw!.value) as { status: string };
    expect(parsed.status).toBe('enabled');
  });

  it('resetToDefaults 后恢复默认关闭', async () => {
    await configFeatureService.updateFeature('generation', { status: 'enabled' }, 'op');
    expect(configFeatureService.isGenerationEnabled()).toBe(true);
    await configFeatureService.resetToDefaults();
    expect(configFeatureService.isGenerationEnabled()).toBe(false);
  });
});
