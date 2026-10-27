// ============================================================
// DeploymentService 部署日志服务单元测试(任务包 C:部署日志同步)
// 对应源码: src/services/deployment.service.ts
// 对应模型: prisma/schema.prisma DeploymentLog
//
// 测试范围(核心:验证部署事件能否被捕获并映射落库):
//   1. recordDeployment:成功落库(create 字段映射完整)
//   2. recordDeployment:timestamp 缺省 → data.timestamp undefined(DB now() 兜底)
//   3. recordDeployment:可选字段缺省 → null(不传脏值)
//   4. recordDeployment:details 传入 → 原样透传
//   5. recordDeployment:DB 失败 → 抛错(controller 据此返回"同步失败" 500)
//   6. getLatestDeployment:有记录 → LatestDeploymentStatusResponse(clear success/failure)
//   7. getLatestDeployment:无记录 → null(下游读取 404)
//   8. getLatestDeployment:serverId 过滤 → findFirst where 正确
//   9. toEntry → 字段命名/格式统一(ISO 时间戳)
//
// Mock 策略:
//   - vi.mock 替换 config/prisma.js,让 prisma() 返回 mock client
//   - 纯单元测试,不依赖真实数据库/prisma.mock
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { deploymentService } from '../src/services/deployment.service.js';
import type { CreateDeploymentLogRequest } from '../src/types/api-contract.js';

// ============================================================
// vi.mock:替换 config/prisma.js
// ============================================================

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    deploymentLog: {
      create: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}));

vi.mock('../src/config/prisma.js', () => ({
  prisma: vi.fn(() => mockPrisma),
}));

// ============================================================
// 测试工厂
// ============================================================

interface DeploymentRecord {
  id: string;
  timestamp: Date;
  version: string;
  serverId: string;
  status: string;
  deployer: string | null;
  branch: string | null;
  commitSha: string | null;
  details: unknown;
  errorMessage: string | null;
  sourceIp: string | null;
  createdAt: Date;
}

/** 构造 Prisma DeploymentLog 记录(测试工厂) */
function makeRecord(overrides: Partial<DeploymentRecord> = {}): DeploymentRecord {
  return {
    id: 'dl-0001',
    timestamp: new Date('2026-08-06T15:00:00.000Z'),
    version: 'v3.0.0-test',
    serverId: 'danqing-prod-01',
    status: 'success',
    deployer: 'ci-bot',
    branch: 'main',
    commitSha: 'abc1234',
    details: { backupDir: 'dist.bak.20260806_120000', nginxStatus: 'active', assetCount: 42 },
    errorMessage: null,
    sourceIp: '10.0.0.1',
    createdAt: new Date('2026-08-06T15:00:00.001Z'),
    ...overrides,
  };
}

/** 构造合法的 recordDeployment 入参 */
function makeInput(overrides: Partial<CreateDeploymentLogRequest> = {}): CreateDeploymentLogRequest {
  return {
    version: 'v3.0.0-test',
    serverId: 'danqing-prod-01',
    status: 'success',
    deployer: 'ci-bot',
    branch: 'main',
    commitSha: 'abc1234',
    details: { backupDir: 'dist.bak.20260806_120000', nginxStatus: 'active', assetCount: 42 },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ------------------------------------------------------------
// recordDeployment
// ------------------------------------------------------------

describe('DeploymentService.recordDeployment', () => {
  it('捕获部署事件并落库:create 收到完整字段(version/serverId/status/deployer/branch/commitSha/sourceIp)', async () => {
    mockPrisma.deploymentLog.create.mockResolvedValue(makeRecord());

    const entry = await deploymentService.recordDeployment(makeInput(), '10.0.0.1');

    // 验证 create 被调用
    expect(mockPrisma.deploymentLog.create).toHaveBeenCalledTimes(1);
    const data = mockPrisma.deploymentLog.create.mock.calls[0]![0].data;
    expect(data.version).toBe('v3.0.0-test');
    expect(data.serverId).toBe('danqing-prod-01');
    expect(data.status).toBe('success');
    expect(data.deployer).toBe('ci-bot');
    expect(data.branch).toBe('main');
    expect(data.commitSha).toBe('abc1234');
    expect(data.sourceIp).toBe('10.0.0.1');
    // 返回契约条目
    expect(entry.id).toBe('dl-0001');
    expect(entry.status).toBe('success');
  });

  it('捕获失败部署事件:status=failed + errorMessage 落库(clear failure indicator)', async () => {
    mockPrisma.deploymentLog.create.mockResolvedValue(
      makeRecord({
        status: 'failed',
        errorMessage: 'deploy-ssh.sh exited with code 1: nginx inactive',
      }),
    );

    const entry = await deploymentService.recordDeployment(
      makeInput({ status: 'failed', errorMessage: 'deploy-ssh.sh exited with code 1: nginx inactive' }),
      '10.0.0.1',
    );

    const data = mockPrisma.deploymentLog.create.mock.calls[0]![0].data;
    expect(data.status).toBe('failed');
    expect(data.errorMessage).toBe('deploy-ssh.sh exited with code 1: nginx inactive');
    expect(entry.status).toBe('failed');
    expect(entry.errorMessage).toBe('deploy-ssh.sh exited with code 1: nginx inactive');
  });

  it('timestamp 缺省:data.timestamp 为 undefined(交由 DB now() 兜底)', async () => {
    mockPrisma.deploymentLog.create.mockResolvedValue(makeRecord());

    await deploymentService.recordDeployment(makeInput({ timestamp: undefined }), '10.0.0.1');

    const data = mockPrisma.deploymentLog.create.mock.calls[0]![0].data;
    expect(data.timestamp).toBeUndefined();
  });

  it('timestamp 传入:转为 Date 写入', async () => {
    mockPrisma.deploymentLog.create.mockResolvedValue(makeRecord());

    await deploymentService.recordDeployment(
      makeInput({ timestamp: '2026-08-06T16:00:00.000Z' }),
      '10.0.0.1',
    );

    const data = mockPrisma.deploymentLog.create.mock.calls[0]![0].data;
    expect(data.timestamp).toEqual(new Date('2026-08-06T16:00:00.000Z'));
  });

  it('可选字段缺省:deployer/branch/commitSha/errorMessage → null(不传 undefined 脏值)', async () => {
    mockPrisma.deploymentLog.create.mockResolvedValue(makeRecord());

    await deploymentService.recordDeployment(
      makeInput({ deployer: undefined, branch: undefined, commitSha: undefined, errorMessage: undefined }),
      '10.0.0.1',
    );

    const data = mockPrisma.deploymentLog.create.mock.calls[0]![0].data;
    expect(data.deployer).toBeNull();
    expect(data.branch).toBeNull();
    expect(data.commitSha).toBeNull();
    expect(data.errorMessage).toBeNull();
  });

  it('details 传入:原样透传到 details 字段', async () => {
    const details = { backupDir: 'dist.bak.x', nginxStatus: 'active', assetCount: 7 };
    mockPrisma.deploymentLog.create.mockResolvedValue(makeRecord({ details }));

    await deploymentService.recordDeployment(makeInput({ details }), '10.0.0.1');

    const data = mockPrisma.deploymentLog.create.mock.calls[0]![0].data;
    expect(data.details).toEqual(details);
  });

  it('DB 落库失败:向上抛错(controller 据此返回"同步失败" 500)', async () => {
    mockPrisma.deploymentLog.create.mockRejectedValue(new Error('database connection refused'));

    await expect(
      deploymentService.recordDeployment(makeInput(), '10.0.0.1'),
    ).rejects.toThrow('database connection refused');
  });
});

// ------------------------------------------------------------
// getLatestDeployment
// ------------------------------------------------------------

describe('DeploymentService.getLatestDeployment', () => {
  it('有记录:返回 LatestDeploymentStatusResponse(clear success indicator + 完整 log)', async () => {
    mockPrisma.deploymentLog.findFirst.mockResolvedValue(makeRecord());

    const result = await deploymentService.getLatestDeployment();

    // 无 serverId 时 where 为 undefined
    expect(mockPrisma.deploymentLog.findFirst).toHaveBeenCalledWith({
      where: undefined,
      orderBy: { timestamp: 'desc' },
    });
    expect(result).not.toBeNull();
    expect(result!.status).toBe('success');
    expect(result!.version).toBe('v3.0.0-test');
    expect(result!.serverId).toBe('danqing-prod-01');
    expect(result!.timestamp).toBe('2026-08-06T15:00:00.000Z');
    expect(result!.errorMessage).toBeNull();
    expect(result!.log.id).toBe('dl-0001');
    expect(result!.log.commitSha).toBe('abc1234');
  });

  it('失败记录:返回 failed + errorMessage(clear failure indicator 供下游判断)', async () => {
    mockPrisma.deploymentLog.findFirst.mockResolvedValue(
      makeRecord({ status: 'failed', errorMessage: 'nginx inactive' }),
    );

    const result = await deploymentService.getLatestDeployment();

    expect(result!.status).toBe('failed');
    expect(result!.errorMessage).toBe('nginx inactive');
  });

  it('无记录:返回 null(下游读取 404)', async () => {
    mockPrisma.deploymentLog.findFirst.mockResolvedValue(null);

    const result = await deploymentService.getLatestDeployment();

    expect(result).toBeNull();
  });

  it('serverId 过滤:findFirst where 收到 { serverId }', async () => {
    mockPrisma.deploymentLog.findFirst.mockResolvedValue(makeRecord());

    await deploymentService.getLatestDeployment('danqing-prod-01');

    expect(mockPrisma.deploymentLog.findFirst).toHaveBeenCalledWith({
      where: { serverId: 'danqing-prod-01' },
      orderBy: { timestamp: 'desc' },
    });
  });

  it('查询失败:向上抛错', async () => {
    mockPrisma.deploymentLog.findFirst.mockRejectedValue(new Error('db down'));

    await expect(deploymentService.getLatestDeployment()).rejects.toThrow('db down');
  });
});

// ------------------------------------------------------------
// toEntry 字段映射(时间戳 ISO 格式化一致性)
// ------------------------------------------------------------

describe('DeploymentService 字段映射一致性', () => {
  it('toEntry:timestamp/createdAt 输出 ISO 字符串,details 透传,errorMessage 保留', async () => {
    mockPrisma.deploymentLog.findFirst.mockResolvedValue(
      makeRecord({
        timestamp: new Date('2026-08-06T15:00:00.000Z'),
        createdAt: new Date('2026-08-06T15:00:00.001Z'),
        errorMessage: null,
      }),
    );

    const result = await deploymentService.getLatestDeployment();

    expect(result!.timestamp).toBe('2026-08-06T15:00:00.000Z');
    expect(result!.log.createdAt).toBe('2026-08-06T15:00:00.001Z');
    expect(result!.log.details).toEqual({
      backupDir: 'dist.bak.20260806_120000',
      nginxStatus: 'active',
      assetCount: 42,
    });
  });
});