// ============================================================
// 测试用 Express App 工厂
// 对应源码:src/app.ts(createApp)
//
// 职责:
//   1. 复用生产 createApp() 构建完整中间件链(helmet/cors/cookie/trace/routes/error)
//   2. 通过 setup.ts 已注入的 vi.mock,Redis/Prisma/httpClient 自动替换为内存实现
//   3. 每个测试文件 import { testApp } 即可获取 supertest-ready app 实例
//   4. 不监听端口,使用 supertest 直接调用 app.callback()(in-memory)
//
// 设计要点:
//   - createApp() 内部读取 env 单例,setup.ts 已 initEnv(),无需重复
//   - vi.mock 是模块级的,所有 import src/* 的位置都会拿到 mock 版本
//   - 测试间状态隔离由 setup.ts 的 beforeEach(redisMock.__clear 等) 保证
// ============================================================

import { createApp } from '../../src/app.js';
import type { Express } from 'express';

/**
 * 测试用 Express app 单例(全测试文件共享)
 * 注意:app 实例本身无状态,状态在 mock 单例中,故可共享
 */
let testAppInstance: Express | null = null;

/**
 * 获取测试用 Express app
 * 首次调用时构建,后续复用(避免每个测试重建中间件链)
 */
export function getTestApp(): Express {
  if (!testAppInstance) {
    testAppInstance = createApp();
  }
  return testAppInstance;
}

/**
 * 重置 app 实例(测试中如需重建中间件链时使用,如修改 env 后)
 */
export function resetTestApp(): void {
  testAppInstance = null;
}

/**
 * 默认导出 app 实例(supertest(request) 直接使用)
 * 用法: import { request } from 'supertest'; await request(app).get('/api/v1/auth/me')
 */
export const testApp: Express = getTestApp();
