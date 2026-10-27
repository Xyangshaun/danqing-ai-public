// ============================================================
// 系统管理 API - 租户仲裁配置覆盖 服务层测试(P-04 / M-1)
// 目标:验证 getTenantArbitrationConfig / updateTenantArbitrationConfig
//       调用 GET/PUT 的正确端点与请求体透传。
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

const requestMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
  put: vi.fn(),
}));
vi.mock('./request', () => requestMock);

import {
  getTenantArbitrationConfig,
  updateTenantArbitrationConfig,
} from './system';

/** 构造一个最小合法生效配置响应 */
function makeResponse(overrides?: Record<string, unknown>) {
  return {
    tenantId: 'tenant-1',
    isDefault: true,
    updatedAt: null,
    updatedBy: null,
    effectiveConfig: {
      triggers: { consistentTotalRange: 5 },
      judgeWeights: { regular: { professor: 0.5, lecturer: 0.3, ai: 0.2 } },
      rules: { final: 'weighted', boundaryTolerance: 1 },
      edgeCases: { outlierDiff: 25 },
    },
    ...overrides,
  };
}

describe('system.ts - 租户仲裁配置', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getTenantArbitrationConfig 调用 GET 端点并返回生效配置', async () => {
    const res = makeResponse();
    requestMock.get.mockResolvedValue(res);
    const result = await getTenantArbitrationConfig('tenant-1');
    expect(requestMock.get).toHaveBeenCalledWith('/api/admin/tenants/tenant-1/arbitration-config');
    expect(result).toEqual(res);
  });

  it('updateTenantArbitrationConfig 调用 PUT 端点并透传部分覆盖请求体', async () => {
    const res = makeResponse({ isDefault: false });
    requestMock.put.mockResolvedValue(res);
    const payload = {
      triggers: { consistentTotalRange: 8 },
      judgeWeights: { regular: { professor: 0.6, lecturer: 0.2, ai: 0.2 } },
    };
    const result = await updateTenantArbitrationConfig('tenant-1', payload);
    expect(requestMock.put).toHaveBeenCalledWith(
      '/api/admin/tenants/tenant-1/arbitration-config',
      payload,
    );
    expect(result).toEqual(res);
  });

  it('updateTenantArbitrationConfig 支持仅传单组覆盖(部分覆盖深合并)', async () => {
    requestMock.put.mockResolvedValue(makeResponse());
    const payload = { rules: { final: 'majority' as const, boundaryTolerance: 2 } };
    await updateTenantArbitrationConfig('tenant-1', payload);
    expect(requestMock.put).toHaveBeenCalledWith(
      '/api/admin/tenants/tenant-1/arbitration-config',
      payload,
    );
  });
});