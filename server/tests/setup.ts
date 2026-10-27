// ============================================================
// Vitest 全局 Setup
// 对应文档:auth-design.md §4(环境变量)+ §4.7(启动自检)
//
// 职责:
//   1. 注入测试用环境变量(含 RSA 密钥,供 env() 启动自检通过)
//   2. vi.mock 替换 Redis / Prisma / httpClient(飞书 API)为内存实现
//   3. 调用 initEnv() 完成单例初始化(后续 service 直接使用)
//   4. 注册全局 beforeEach:清空 mock 状态,保证测试隔离
//
// 注意:
//   - vi.mock 是 hoisted 的(提升到文件顶部),工厂惰性执行
//   - process.env 设置必须在 initEnv() 调用前完成(顶级语句顺序保证)
//   - mock 文件通过动态 import 加载,避免循环依赖
// ============================================================

import { vi, beforeEach } from 'vitest';
import { testJwtKeys } from './mocks/jwt-keys.mock.js';

// ============================================================
// 1. 注入测试环境变量
// 对应 .env.example,使用测试值(不依赖外部服务)
// ============================================================
process.env.FEISHU_APP_ID = 'cli_test_app_id';
process.env.FEISHU_APP_SECRET = 'test_app_secret_value';
process.env.FEISHU_REDIRECT_URI_WEB = 'http://localhost:5173/auth/feishu/callback';
process.env.FEISHU_REDIRECT_URI_ADMIN = 'http://localhost:3001/auth/feishu/callback';
process.env.FEISHU_REDIRECT_URI_MOBILE = 'http://localhost:8081/auth/feishu/callback';
process.env.FEISHU_AUTHZ_ENDPOINT = 'https://open.feishu.cn/open-apis/authen/v1/authorize';
process.env.FEISHU_TOKEN_ENDPOINT = 'https://open.feishu.cn/open-apis/authen/v1/oidc/access_token';
process.env.FEISHU_USERINFO_ENDPOINT = 'https://open.feishu.cn/open-apis/authen/v1/user_info';

process.env.JWT_PRIVATE_KEY = testJwtKeys.privateKey;
process.env.JWT_PUBLIC_KEY = testJwtKeys.publicKey;
process.env.JWT_KEY_ID = 'test-kid-2026';
process.env.JWT_ISSUER = 'danqing-ai-auth';
process.env.JWT_AUDIENCE_WEB = 'danqing-ai-web';
process.env.JWT_AUDIENCE_ADMIN = 'danqing-ai-admin';
process.env.JWT_AUDIENCE_MOBILE = 'danqing-ai-mobile';
process.env.JWT_ACCESS_EXPIRES = '15m';
process.env.JWT_REFRESH_EXPIRES = '7d';

process.env.COOKIE_SECURE = 'false';
process.env.COOKIE_DOMAIN = '';
process.env.COOKIE_SAMESITE = 'strict';
process.env.COOKIE_PATH = '/auth';
process.env.COOKIE_MAX_AGE = '604800';

process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.REDIS_URL = 'redis://localhost:6379';

process.env.CORS_ORIGINS = 'http://localhost:5173,http://localhost:3001';

process.env.RATE_LIMIT_AUTH_PER_MIN = '10';
process.env.RATE_LIMIT_CALLBACK_PER_MIN = '5';
process.env.RATE_LIMIT_REFRESH_PER_MIN = '20';
process.env.RATE_LIMIT_API_PER_MIN = '60';

process.env.TENANT_DEFAULT_PLAN = 'free';
process.env.TENANT_DEFAULT_TYPE = 'individual';

process.env.ENABLE_HSTS = 'false';
process.env.LOG_LEVEL = 'error'; // 测试时降低日志级别,减少噪声
process.env.NODE_ENV = 'test';
process.env.PORT = '3000';

// 文件上传:使用系统临时目录,避免测试污染项目目录
process.env.UPLOAD_DIR = 'test-uploads';
process.env.UPLOAD_MAX_SIZE = '10485760'; // 10MB

// AI 视觉分析(Phase 2 追加)
// 默认关闭,保持现有 260 个测试不受影响
// AI 专项测试通过 vi.mock 替换 axios,并在测试内动态开启 AI_ENABLED
process.env.AI_ENABLED = 'false';
process.env.AI_API_KEY = '';
process.env.AI_API_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
process.env.AI_API_TIMEOUT = '2500';
process.env.AI_API_MODEL = 'glm-4v-flash';

// ============================================================
// 2. vi.mock:替换 Redis / Prisma / httpClient / Jimp
// 工厂内动态 import mock 文件,返回匹配源码导出的对象
// ============================================================
vi.mock('../src/config/redis.js', async () => {
  const mod = await import('./mocks/redis.mock.js');
  return mod.createRedisModule();
});

vi.mock('../src/config/prisma.js', async () => {
  const mod = await import('./mocks/prisma.mock.js');
  return mod.createPrismaModule();
});

vi.mock('../src/utils/http-client.js', async () => {
  const mod = await import('./mocks/feishu-api.mock.js');
  return mod.createHttpClientModule();
});

// Jimp mock:避免 analysis-engine.service.ts 在测试中发起真实 HTTP 请求
// 测试用例使用 https://example.com/*.jpg 占位 URL,本 mock 返回 100x100 伪图像
vi.mock('jimp', async () => {
  const mod = await import('./mocks/jimp.mock.js');
  return mod.createJimpModule();
});

// ============================================================
// 3. 初始化 env 单例
// 必须在 mock 注册后、测试执行前完成
// 此后所有 env() 调用返回测试配置
// ============================================================
import { initEnv } from '../src/config/env.js';
initEnv();

// ============================================================
// 4. 全局 beforeEach:清空 mock 状态
// 保证每个测试用例独立隔离,不串扰
// ============================================================
import { redisMock } from './mocks/redis.mock.js';
import { prismaMock } from './mocks/prisma.mock.js';
import { feishuMockState } from './mocks/feishu-api.mock.js';

beforeEach(() => {
  redisMock.__clear();
  prismaMock.__clear();
  feishuMockState.__reset();
});

// ============================================================
// 导出测试辅助(测试文件可直接 import)
// ============================================================
export { testJwtKeys };
export { redisMock } from './mocks/redis.mock.js';
export { prismaMock } from './mocks/prisma.mock.js';
export { feishuMockState } from './mocks/feishu-api.mock.js';
