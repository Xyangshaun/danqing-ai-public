﻿// ============================================================
// Deployment 路由鉴权 + Controller 校验测试(任务包 C:部署日志同步)
// 对应源码: src/routes/deployment.routes.ts + src/controllers/deployment.controller.ts
//
// 测试范围(验证同步通道的鉴权与入参校验):
//   1. 未配置 DEPLOY_SYNC_SECRET → 503(同步功能未启用)
//   2. 缺少 X-Deploy-Secret → 401
//   3. 错误 X-Deploy-Secret → 401
//   4. 正确密钥 + 合法 body → 200,{ synced: true }
//   5. 正确密钥 + 非法 status → 400(Zod 校验)
//   6. 正确密钥 + 缺必填字段 → 400
//   7. GET /latest 有记录 → 200 + 最新状态
//   8. GET /latest 无记录 → 404
//
// Mock 策略:
//   - vi.mock 替换 config/env.js(动态控制 deploySyncSecret)
//   - vi.mock 替换 services/deployment.service.js(避免真实 DB)
//   - 用 supertest 挂载 deploymentRouter
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { deploymentRouter } from '../src/routes/deployment.routes.js';
import { errorHandler } from '../src/middlewares/error-handler.js';
import type { DeploymentLogEntry } from '../src/types/api-contract.js';

// 用 express() 包裹 Router,supply finalhandler(直接 request(router) 会缺 finalhandler 导致超时)
const app = express();
app.use(express.json());
app.use(deploymentRouter);
// 挂载项目 errorHandler,把 ZodError 等转成 400(与真实 app.ts 行为一致)
app.use(errorHandler);

// ============================================================
// vi.mock:替换 env.js + deployment.service.js
// ============================================================

const { mockEnv, mockDeploymentService } = vi.hoisted(() => ({
  mockEnv: { deploySyncSecret: '' },
  mockDeploymentService: {
    recordDeployment: vi.fn(),
    getLatestDeployment: vi.fn(),
  },
}));

vi.mock('../src/config/env.js', () => ({
  env: vi.fn(() => mockEnv),
}));

vi.mock('../src/services/deployment.service.js', () => ({
  deploymentService: mockDeploymentService,
}));

// ============================================================
// 测试常量
// ============================================================

const SECRET = 'test-deploy-secret-123';
const VERSION = 'v3.0.0-test';
const SERVER_ID = 'danqing-prod-01';

/** 构造一条 API 契约 DeploymentLogEntry */
function makeEntry(overrides: Partial<DeploymentLogEntry> = {}): DeploymentLogEntry {
  return {
    id: 'dl-0001',
    timestamp: '2026-08-06T15:00:00.000Z',
    version: VERSION,
    serverId: SERVER_ID,
    status: 'success',
    deployer: 'ci-bot',
    branch: 'main',
    commitSha: 'abc1234',
    details: { backupDir: 'dist.bak.x', nginxStatus: 'active', assetCount: 42 },
    errorMessage: null,
    sourceIp: '10.0.0.1',
    createdAt: '2026-08-06T15:00:00.001Z',
    ...overrides,
  };
}

/** 构造合法的 POST /log body */
function makeBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: VERSION,
    serverId: SERVER_ID,
    status: 'success',
    branch: 'main',
    commitSha: 'abc1234',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockEnv.deploySyncSecret = SECRET; // 默认启用密钥
});

// ------------------------------------------------------------
// 鉴权中间件
// ------------------------------------------------------------

describe('部署路由鉴权(共享密钥)', () => {
  it('未配置 DEPLOY_SYNC_SECRET → 503(同步功能未启用)', async () => {
    mockEnv.deploySyncSecret = '';

    const res = await request(app).post('/log').send(makeBody());

    expect(res.status).toBe(503);
    expect(res.body.code).toBeDefined();
    expect(res.body.message).toContain('未配置 DEPLOY_SYNC_SECRET');
    // 未通过鉴权 → service 不被调用
    expect(mockDeploymentService.recordDeployment).not.toHaveBeenCalled();
  });

  it('缺少 X-Deploy-Secret 请求头 → 401', async () => {
    const res = await request(app).post('/log').send(makeBody());

    expect(res.status).toBe(401);
    expect(mockDeploymentService.recordDeployment).not.toHaveBeenCalled();
  });

  it('错误 X-Deploy-Secret → 401', async () => {
    const res = await request(app)
      .post('/log')
      .set('X-Deploy-Secret', 'WRONG-SECRET')
      .send(makeBody());

    expect(res.status).toBe(401);
    expect(mockDeploymentService.recordDeployment).not.toHaveBeenCalled();
  });

  it('正确密钥:POST /log 合法 body → 200 + synced:true(捕获并确认已同步)', async () => {
    mockDeploymentService.recordDeployment.mockResolvedValue(makeEntry());

    const res = await request(app)
      .post('/log')
      .set('X-Deploy-Secret', SECRET)
      .send(makeBody());

    expect(res.status).toBe(200);
    expect(res.body.code).toBe(0);
    expect(res.body.data.received).toBe(true);
    expect(res.body.data.synced).toBe(true);
    // service 被调用,并将 sourceIp 传入
    expect(mockDeploymentService.recordDeployment).toHaveBeenCalledTimes(1);
    const [input] = mockDeploymentService.recordDeployment.mock.calls[0]!;
    expect(input.version).toBe(VERSION);
    expect(input.serverId).toBe(SERVER_ID);
    expect(input.status).toBe('success');
  });

  it('正确密钥:POST /log 失败事件(status=failed + errorMessage)→ 200 且 status 透传', async () => {
    mockDeploymentService.recordDeployment.mockResolvedValue(
      makeEntry({ status: 'failed', errorMessage: 'nginx inactive' }),
    );

    const res = await request(app)
      .post('/log')
      .set('X-Deploy-Secret', SECRET)
      .send(makeBody({ status: 'failed', errorMessage: 'nginx inactive' }));

    expect(res.status).toBe(200);
    expect(res.body.data.synced).toBe(true);
    const [input] = mockDeploymentService.recordDeployment.mock.calls[0]!;
    expect(input.status).toBe('failed');
    expect(input.errorMessage).toBe('nginx inactive');
  });
});

// ------------------------------------------------------------
// Controller Zod 校验
// ------------------------------------------------------------

describe('POST /log 入参校验(Zod)', () => {
  it('非法 status → 400', async () => {
    const res = await request(app)
      .post('/log')
      .set('X-Deploy-Secret', SECRET)
      .send(makeBody({ status: 'weird' }));

    expect(res.status).toBe(400);
    expect(mockDeploymentService.recordDeployment).not.toHaveBeenCalled();
  });

  it('缺必填字段 version → 400', async () => {
    const body = makeBody();
    delete body.version;
    const res = await request(app)
      .post('/log')
      .set('X-Deploy-Secret', SECRET)
      .send(body);

    expect(res.status).toBe(400);
  });

  it('缺必填字段 serverId → 400', async () => {
    const body = makeBody();
    delete body.serverId;
    const res = await request(app)
      .post('/log')
      .set('X-Deploy-Secret', SECRET)
      .send(body);

    expect(res.status).toBe(400);
  });

  it('非法 timestamp(非 ISO 8601)→ 400', async () => {
    const res = await request(app)
      .post('/log')
      .set('X-Deploy-Secret', SECRET)
      .send(makeBody({ timestamp: 'not-a-date' }));

    expect(res.status).toBe(400);
  });
});

// ------------------------------------------------------------
// GET /latest
// ------------------------------------------------------------

describe('GET /latest(下游查询)', () => {
  it('有记录 → 200 + 最新部署状态(clear success indicator)', async () => {
    mockDeploymentService.getLatestDeployment.mockResolvedValue({
      status: 'success',
      version: VERSION,
      serverId: SERVER_ID,
      timestamp: '2026-08-06T15:00:00.000Z',
      errorMessage: null,
      log: makeEntry(),
    });

    const res = await request(app)
      .get('/latest')
      .set('X-Deploy-Secret', SECRET);

    expect(res.status).toBe(200);
    expect(res.body.code).toBe(0);
    expect(res.body.data.status).toBe('success');
    expect(res.body.data.version).toBe(VERSION);
    expect(res.body.data.serverId).toBe(SERVER_ID);
  });

  it('失败记录 → 200 + status=failed + errorMessage(clear failure indicator)', async () => {
    mockDeploymentService.getLatestDeployment.mockResolvedValue({
      status: 'failed',
      version: VERSION,
      serverId: SERVER_ID,
      timestamp: '2026-08-06T15:00:00.000Z',
      errorMessage: 'nginx inactive',
      log: makeEntry({ status: 'failed', errorMessage: 'nginx inactive' }),
    });

    const res = await request(app)
      .get('/latest')
      .set('X-Deploy-Secret', SECRET);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('failed');
    expect(res.body.data.errorMessage).toBe('nginx inactive');
  });

  it('无记录 → 404', async () => {
    mockDeploymentService.getLatestDeployment.mockResolvedValue(null);

    const res = await request(app)
      .get('/latest')
      .set('X-Deploy-Secret', SECRET);

    expect(res.status).toBe(404);
  });
});