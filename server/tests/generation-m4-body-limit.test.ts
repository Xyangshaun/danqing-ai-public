// ============================================================
// M4-T5 路由级请求体防线测试(风格迁移生图专项)
// 对应源码:src/app.ts(路由级 8mb + 全局 1mb body limit,真源 §2.9)
//           src/controllers/generation.controller.ts(Zod 6M 字符护栏)
// 对应文档:.trae/documents/m4-style-transfer-plan-2026-09-22.md
//   §2.9 请求体限制方案 / §9.1 M4-T5 验收要点 / §十三 验收清单 7
//
// 验收要点(413 边界用例):
//   1. /api/v1/generation 提交 ~2MB(>1mb,<8mb)合法 style 请求体
//      → 不被全局 1mb 拦截,完整进入控制器 → service → 201 pending
//   2. /api/v1/generation 提交 >8mb → 413 FILE_TOO_LARGE(路由级上限兜底)
//   3. 其余路径(/api/v1/analyses)提交 >1mb → 413(全局 1mb 维持不变)
//
// 测试策略:
//   - 使用真实 createApp()(getTestApp),保真验证中间件挂载顺序
//     (路由级 8mb 必须先于全局 1mb 消费 /api/v1/generation 请求体)
//   - setup.ts 全局 mock Prisma/Redis;真实 JWT(fixtures 签发)
//   - generation/styleTransfer 双开关 beforeEach 显式开启(fail-closed 默认关闭)
//   - 2MB 正例走全链路断言:鉴权 → Zod → service → 落库 → 队列引用模式入队
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { getTestApp } from './helpers/test-app.js';
import {
  createTestUser,
  createTestTenant,
  createTestTokenSet,
  buildAuthHeaders,
} from './helpers/fixtures.js';
import { configFeatureService } from '../src/services/config-feature.service.js';
import { prismaMock, redisMock } from './setup.js';
import { ErrorCode } from '../src/types/api-contract.js';

// ============================================================
// 测试常量
// ============================================================

const TENANT_ID = 't-m4-bodylimit';
const USER_ID = 'u-m4-bodylimit';

/**
 * ~2MB dataURL 风格参考图(>1mb 全局限制,<8mb 路由级限制,<6M Zod 上限):
 * 模拟前端 canvas 压缩后复杂画面的产物上限区间
 */
const DATAURL_2MB = `data:image/png;base64,${'A'.repeat(2 * 1024 * 1024)}`;

/** >8mb dataURL:超路由级上限,应在 body parser 层 413(到不了 Zod) */
const DATAURL_9MB = `data:image/png;base64,${'A'.repeat(9 * 1024 * 1024)}`;

// ============================================================
// 用例
// ============================================================

describe('M4-T5 路由级请求体防线(/api/v1/generation 8mb,其余路径维持 1mb)', () => {
  beforeEach(async () => {
    // standard/active 租户(生成配额 200)+ teacher 用户
    createTestTenant({
      id: TENANT_ID,
      name: 'M4-T5 请求体防线租户',
      type: 'college',
      plan: 'standard',
      status: 'active',
    });
    createTestUser({ id: USER_ID, tenantId: TENANT_ID, role: 'teacher' });
    // 双开关默认 disabled(fail-closed),显式开启使 2MB 正例走通全链路
    await configFeatureService.updateFeature('generation', { status: 'enabled' }, 'test');
    await configFeatureService.updateFeature('styleTransfer', { status: 'enabled' }, 'test');
  });

  it('/api/v1/generation 提交 ~2MB(>1mb,<8mb)合法 style 请求体 → 不被全局 1mb 拦截,201 pending', async () => {
    const tokens = createTestTokenSet({ userId: USER_ID, tenantId: TENANT_ID, role: 'teacher' });

    const res = await request(getTestApp())
      .post('/api/v1/generation')
      .set(buildAuthHeaders(tokens.accessToken))
      .send({
        inputType: 'style',
        prompt: '一位戴草帽的少女站在麦田边',
        styleImageUrl: DATAURL_2MB,
        artType: 'painting',
        aspect: 'square',
        count: 1,
      });

    // 关键断言:未被全局 1mb 拦截(非 413),完整走通 鉴权→Zod→service→落库→入队
    expect(res.status).toBe(201);
    expect(res.body.code).toBe(0);
    expect(res.body.data.status).toBe('pending');
    expect(res.body.data.taskId).toBeTruthy();

    // service 全链路:落库 inputType=style + 完整 dataURL(队列引用模式:DB 为图片真源)
    const task = prismaMock.generationTaskStore.get(res.body.data.taskId as string);
    expect(task?.inputType).toBe('style');
    expect(task?.styleImageUrl).toBe(DATAURL_2MB);
    expect(task?.prompt).toBe('一位戴草帽的少女站在麦田边');

    // 队列引用模式:载荷不含 dataURL/base64(仅任务引用小字段)
    const payloads = redisMock.__peekList('queue:generation');
    expect(payloads.length).toBe(1);
    expect(payloads[0]).not.toContain('base64');
    expect(payloads[0]).not.toContain('styleImageUrl');
  });

  it('/api/v1/generation 提交 >8mb → 413 FILE_TOO_LARGE(路由级上限兜底,不进入控制器)', async () => {
    const tokens = createTestTokenSet({ userId: USER_ID, tenantId: TENANT_ID, role: 'teacher' });

    const res = await request(getTestApp())
      .post('/api/v1/generation')
      .set(buildAuthHeaders(tokens.accessToken))
      .send({
        inputType: 'style',
        prompt: '一位戴草帽的少女站在麦田边',
        styleImageUrl: DATAURL_9MB,
      });

    expect(res.status).toBe(413);
    expect(res.body.code).toBe(ErrorCode.FILE_TOO_LARGE);
    // body parser 层拦截:未落库、未入队
    expect(prismaMock.generationTaskStore.size).toBe(0);
    expect(redisMock.__peekList('queue:generation').length).toBe(0);
  });

  it('其余路径(/api/v1/analyses)提交 >1mb → 413 FILE_TOO_LARGE(全局 1mb 维持不变)', async () => {
    // body parser 在路由鉴权之前拒绝,无需 Authorization
    const res = await request(getTestApp())
      .post('/api/v1/analyses')
      .send({ junk: `data:image/png;base64,${'x'.repeat(1024 * 1024 + 2048)}` });

    expect(res.status).toBe(413);
    expect(res.body.code).toBe(ErrorCode.FILE_TOO_LARGE);
  });
});
