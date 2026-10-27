// ============================================================
// 认证 Controller 集成测试(Supertest + 内存 mock)
// 对应源码:src/controllers/auth.controller.ts + src/routes/auth.routes.ts
// 对应 API:
//   GET  /auth/feishu/authorize
//   GET  /auth/feishu/callback
//   POST /auth/refresh
//   POST /auth/logout
//   GET  /auth/me
//
// 测试策略:
//   - 使用 supertest(request) 直接调用 getTestApp() 返回的 Express 实例
//   - Redis / Prisma / 飞书 API 已通过 setup.ts 全局 mock
//   - 通过 fixtures 工厂构造测试数据(state/user/tenant/session/token)
//   - 通过 feishuMockState 控制飞书 API 响应
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { getTestApp } from './helpers/test-app.js';
import {
  assertApiResponse,
  assertApiError,
  assertRefreshTokenCookie,
  assertNoSensitiveDataInBody,
  assertTraceIdHeader,
} from './helpers/assertions.js';
import {
  createTestUser,
  createTestTenant,
  createTestSession,
  createTestTokenSet,
  createValidState,
  createInvalidFormatState,
  buildClientContextHeader,
  buildAuthHeaders,
  TEST_USER_ID_A,
  TEST_TENANT_ID_A,
  TEST_DEVICE_ID,
  TEST_CLIENT_IP,
  TEST_USER_AGENT,
  TEST_FEISHU_UNION_ID_A,
  TEST_FEISHU_OPEN_ID_A,
} from './helpers/fixtures.js';
import { redisMock } from './mocks/redis.mock.js';
import { prismaMock } from './mocks/prisma.mock.js';
import { feishuMockState } from './mocks/feishu-api.mock.js';
import { ErrorCode } from '../src/types/api-contract.js';
import { sha256 } from '../src/utils/crypto.js';

describe('auth.controller (P0 接口集成测试)', () => {
  beforeEach(() => {
    // setup.ts 已全局 beforeEach 清空 mock,这里可做额外重置
  });

  // ============================================================
  // GET /auth/feishu/authorize
  // ============================================================
  describe('GET /auth/feishu/authorize', () => {
    it('should_return_authorize_url_with_state_when_device_id_provided', async () => {
      const res = await request(getTestApp())
        .get('/api/v1/auth/feishu/authorize')
        .set('X-Client-Context', buildClientContextHeader(TEST_DEVICE_ID, 'web'))
        .set('User-Agent', TEST_USER_AGENT)
        .set('X-Forwarded-For', TEST_CLIENT_IP)
        .expect(200);

      const body = assertApiResponse(res);
      const data = body.data as {
        authorizeUrl: string;
        state: string;
        redirectUri: string;
      };
      expect(data.authorizeUrl).toMatch(/^https:\/\/open\.feishu\.cn\/open-apis\/authen\/v1\/authorize\?/);
      expect(data.state).toMatch(/^[0-9a-f]{64}$/);
      expect(data.redirectUri).toBe('http://localhost:5173/auth/feishu/callback');

      // state 应写入 Redis,TTL ≈ 300s
      const entry = redisMock.__peek(`oauth:state:${data.state}`);
      expect(entry).toBeDefined();
      const ttlSec = Math.floor(((entry!.expiresAt as number) - Date.now()) / 1000);
      expect(ttlSec).toBeGreaterThan(290);
      expect(ttlSec).toBeLessThanOrEqual(300);

      // state 上下文应含 clientIp/userAgent/deviceId/client
      const ctx = JSON.parse(entry!.value);
      expect(ctx.clientIp).toBe(TEST_CLIENT_IP);
      expect(ctx.userAgent).toBe(TEST_USER_AGENT);
      expect(ctx.deviceId).toBe(TEST_DEVICE_ID);
      expect(ctx.client).toBe('web');

      assertTraceIdHeader(res);
      assertNoSensitiveDataInBody(res);
    });

    it('should_return_400_when_device_id_missing', async () => {
      const res = await request(getTestApp())
        .get('/api/v1/auth/feishu/authorize')
        .set('User-Agent', TEST_USER_AGENT)
        .expect(400);

      assertApiError(res, ErrorCode.PARAM_MISSING, 400);
      // 不应有 state 写入 Redis
      const keys = redisMock.__keys().filter((k) => k.startsWith('oauth:state:'));
      expect(keys).toHaveLength(0);
    });

    it('should_use_web_redirect_uri_by_default', async () => {
      const res = await request(getTestApp())
        .get('/api/v1/auth/feishu/authorize')
        .set('X-Client-Context', buildClientContextHeader(TEST_DEVICE_ID, 'web'))
        .set('User-Agent', TEST_USER_AGENT)
        .expect(200);

      const data = res.body.data as { redirectUri: string };
      expect(data.redirectUri).toBe('http://localhost:5173/auth/feishu/callback');
    });

    it('should_use_admin_redirect_uri_when_client_admin', async () => {
      const res = await request(getTestApp())
        .get('/api/v1/auth/feishu/authorize')
        .set('X-Client-Context', buildClientContextHeader(TEST_DEVICE_ID, 'admin'))
        .set('User-Agent', TEST_USER_AGENT)
        .expect(200);

      const data = res.body.data as { redirectUri: string };
      expect(data.redirectUri).toBe('http://localhost:3001/auth/feishu/callback');
    });

    it('should_use_mobile_redirect_uri_when_client_mobile', async () => {
      const res = await request(getTestApp())
        .get('/api/v1/auth/feishu/authorize')
        .set('X-Client-Context', buildClientContextHeader(TEST_DEVICE_ID, 'mobile'))
        .set('User-Agent', TEST_USER_AGENT)
        .expect(200);

      const data = res.body.data as { redirectUri: string };
      expect(data.redirectUri).toBe('http://localhost:8081/auth/feishu/callback');
    });

    it('should_accept_x_device_id_header_as_fallback', async () => {
      const res = await request(getTestApp())
        .get('/api/v1/auth/feishu/authorize')
        .set('X-Device-Id', 'alt-device-id')
        .set('X-Client', 'web')
        .set('User-Agent', TEST_USER_AGENT)
        .expect(200);

      const body = assertApiResponse(res);
      expect((body.data as { state: string }).state).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should_return_429_when_authorize_rate_limit_exceeded', async () => {
      // RATE_LIMIT_AUTH_PER_MIN=10,第 11 次触发限流
      const app = getTestApp();
      for (let i = 0; i < 10; i++) {
        await request(app)
          .get('/api/v1/auth/feishu/authorize')
          .set('X-Client-Context', buildClientContextHeader(`${TEST_DEVICE_ID}-${i}`, 'web'))
          .set('User-Agent', TEST_USER_AGENT)
          .set('X-Forwarded-For', '10.0.0.1') // 固定 IP 触发限流
          .expect(200);
      }
      // 第 11 次:限流
      const res = await request(app)
        .get('/api/v1/auth/feishu/authorize')
        .set('X-Client-Context', buildClientContextHeader('dev-11', 'web'))
        .set('User-Agent', TEST_USER_AGENT)
        .set('X-Forwarded-For', '10.0.0.1')
        .expect(429);

      assertApiError(res, ErrorCode.RATE_LIMITED, 429);
      expect(res.headers['retry-after']).toBe('60');
    });
  });

  // ============================================================
  // GET /auth/feishu/callback
  // ============================================================
  describe('GET /auth/feishu/callback', () => {
    it('should_return_access_token_when_callback_with_valid_code_and_state', async () => {
      // 1. 预置 state(模拟 authorize 阶段)
      const state = createValidState({
        clientIp: TEST_CLIENT_IP,
        userAgent: TEST_USER_AGENT,
        deviceId: TEST_DEVICE_ID,
        client: 'web',
      });
      // 2. 飞书 mock 默认返回成功
      feishuMockState.__reset();

      const res = await request(getTestApp())
        .get('/api/v1/auth/feishu/callback')
        .query({ code: 'auth-code-001', state })
        .set('X-Client-Context', buildClientContextHeader(TEST_DEVICE_ID, 'web'))
        .set('User-Agent', TEST_USER_AGENT)
        .set('X-Forwarded-For', TEST_CLIENT_IP)
        .expect(200);

      const body = assertApiResponse(res);
      const data = body.data as {
        accessToken: string;
        accessTokenExpiresAt: string;
        isFirstLogin: boolean;
        user: { id: string; name: string; feishuUnionId: string };
        tenant: { id: string; name: string };
      };

      expect(data.accessToken).toBeTruthy();
      expect(typeof data.accessToken).toBe('string');
      expect(data.accessToken.split('.').length).toBe(3); // JWT 三段式
      expect(data.accessTokenExpiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(data.isFirstLogin).toBe(true); // 新用户
      expect(data.user.name).toBe('张老师');
      expect(data.user.feishuUnionId).toBe('on_test_union_id');
      expect(data.tenant.name).toContain('张老师');

      // refresh_token 应写入 HttpOnly Cookie
      assertRefreshTokenCookie(res, { shouldExist: true });
      assertTraceIdHeader(res);
      assertNoSensitiveDataInBody(res);
    });

    it('should_set_refresh_token_cookie_with_secure_attributes', async () => {
      const state = createValidState();
      const res = await request(getTestApp())
        .get('/api/v1/auth/feishu/callback')
        .query({ code: 'auth-code-cookie', state })
        .set('X-Client-Context', buildClientContextHeader())
        .set('User-Agent', TEST_USER_AGENT)
        .set('X-Forwarded-For', TEST_CLIENT_IP)
        .expect(200);

      const setCookie = res.headers['set-cookie'];
      expect(setCookie).toBeDefined();
      const all = Array.isArray(setCookie) ? setCookie : [setCookie];
      const refreshCookie = all.find((c) => c.startsWith('refresh_token='));
      expect(refreshCookie).toBeDefined();
      expect(refreshCookie).toContain('HttpOnly');
      expect(refreshCookie).toContain('SameSite=Strict');
      expect(refreshCookie).toContain('Path=/auth');
      // Max-Age 应为 604800s(7天)
      expect(refreshCookie).toMatch(/Max-Age=604800/);
    });

    it('should_return_400_when_code_missing', async () => {
      const state = createValidState();
      const res = await request(getTestApp())
        .get('/api/v1/auth/feishu/callback')
        .query({ state })
        .set('X-Client-Context', buildClientContextHeader())
        .set('User-Agent', TEST_USER_AGENT)
        .expect(400);

      assertApiError(res, ErrorCode.PARAM_MISSING, 400);
    });

    it('should_return_400_when_state_missing', async () => {
      const res = await request(getTestApp())
        .get('/api/v1/auth/feishu/callback')
        .query({ code: 'auth-code' })
        .set('X-Client-Context', buildClientContextHeader())
        .set('User-Agent', TEST_USER_AGENT)
        .expect(400);

      assertApiError(res, ErrorCode.PARAM_MISSING, 400);
    });

    it('should_return_400_when_state_format_invalid', async () => {
      const res = await request(getTestApp())
        .get('/api/v1/auth/feishu/callback')
        .query({ code: 'auth-code', state: createInvalidFormatState() })
        .set('X-Client-Context', buildClientContextHeader())
        .set('User-Agent', TEST_USER_AGENT)
        .expect(400);

      assertApiError(res, ErrorCode.FEISHU_AUTH_FAILED, 400);
    });

    it('should_return_400_when_state_not_in_redis', async () => {
      // 不写入 Redis 的 state(64 字符 hex,但不存在)
      const fakeState = 'a'.repeat(64);
      const res = await request(getTestApp())
        .get('/api/v1/auth/feishu/callback')
        .query({ code: 'auth-code', state: fakeState })
        .set('X-Client-Context', buildClientContextHeader())
        .set('User-Agent', TEST_USER_AGENT)
        .expect(400);

      assertApiError(res, ErrorCode.FEISHU_AUTH_FAILED, 400);
    });

    it('should_return_400_when_state_client_ip_mismatch', async () => {
      // 用 IP A 创建 state,用 IP B 回调
      const state = createValidState({ clientIp: '1.1.1.1' });
      const res = await request(getTestApp())
        .get('/api/v1/auth/feishu/callback')
        .query({ code: 'auth-code', state })
        .set('X-Client-Context', buildClientContextHeader())
        .set('User-Agent', TEST_USER_AGENT)
        .set('X-Forwarded-For', '2.2.2.2') // 不同 IP
        .expect(400);

      assertApiError(res, ErrorCode.FEISHU_AUTH_FAILED, 400);
    });

    it('should_return_400_when_state_user_agent_mismatch', async () => {
      const state = createValidState({ userAgent: 'Original-UA' });
      const res = await request(getTestApp())
        .get('/api/v1/auth/feishu/callback')
        .query({ code: 'auth-code', state })
        .set('X-Client-Context', buildClientContextHeader())
        .set('User-Agent', 'Different-UA')
        .set('X-Forwarded-For', TEST_CLIENT_IP)
        .expect(400);

      assertApiError(res, ErrorCode.FEISHU_AUTH_FAILED, 400);
    });

    it('should_return_400_when_state_device_id_mismatch', async () => {
      const state = createValidState({ deviceId: 'device-A' });
      const res = await request(getTestApp())
        .get('/api/v1/auth/feishu/callback')
        .query({ code: 'auth-code', state })
        .set('X-Client-Context', buildClientContextHeader('device-B'))
        .set('User-Agent', TEST_USER_AGENT)
        .set('X-Forwarded-For', TEST_CLIENT_IP)
        .expect(400);

      assertApiError(res, ErrorCode.FEISHU_AUTH_FAILED, 400);
    });

    it('should_consume_state_one_time_only', async () => {
      const state = createValidState();
      const app = getTestApp();

      // 第一次:成功
      await request(app)
        .get('/api/v1/auth/feishu/callback')
        .query({ code: 'auth-code-1', state })
        .set('X-Client-Context', buildClientContextHeader())
        .set('User-Agent', TEST_USER_AGENT)
        .set('X-Forwarded-For', TEST_CLIENT_IP)
        .expect(200);

      // 第二次:state 已被消费,应失败
      const res2 = await request(app)
        .get('/api/v1/auth/feishu/callback')
        .query({ code: 'auth-code-2', state })
        .set('X-Client-Context', buildClientContextHeader())
        .set('User-Agent', TEST_USER_AGENT)
        .set('X-Forwarded-For', TEST_CLIENT_IP)
        .expect(400);

      assertApiError(res2, ErrorCode.FEISHU_AUTH_FAILED, 400);
    });

    it('should_return_502_when_feishu_token_exchange_fails', async () => {
      const state = createValidState();
      feishuMockState.tokenMode = 'feishuError';

      const res = await request(getTestApp())
        .get('/api/v1/auth/feishu/callback')
        .query({ code: 'bad-code', state })
        .set('X-Client-Context', buildClientContextHeader())
        .set('User-Agent', TEST_USER_AGENT)
        .set('X-Forwarded-For', TEST_CLIENT_IP)
        .expect(502);

      assertApiError(res, ErrorCode.FEISHU_TOKEN_EXCHANGE_FAILED, 502);
    });

    it('should_return_502_when_feishu_token_exchange_http_error', async () => {
      const state = createValidState();
      feishuMockState.tokenMode = 'httpError';

      const res = await request(getTestApp())
        .get('/api/v1/auth/feishu/callback')
        .query({ code: 'any-code', state })
        .set('X-Client-Context', buildClientContextHeader())
        .set('User-Agent', TEST_USER_AGENT)
        .set('X-Forwarded-For', TEST_CLIENT_IP)
        .expect(502);

      assertApiError(res, ErrorCode.FEISHU_TOKEN_EXCHANGE_FAILED, 502);
    });

    it('should_return_502_when_feishu_user_info_fails', async () => {
      const state = createValidState();
      feishuMockState.userInfoMode = 'feishuError';

      const res = await request(getTestApp())
        .get('/api/v1/auth/feishu/callback')
        .query({ code: 'auth-code', state })
        .set('X-Client-Context', buildClientContextHeader())
        .set('User-Agent', TEST_USER_AGENT)
        .set('X-Forwarded-For', TEST_CLIENT_IP)
        .expect(502);

      assertApiError(res, ErrorCode.FEISHU_USER_INFO_FAILED, 502);
    });

    it('should_return_502_when_feishu_user_info_missing_union_id', async () => {
      const state = createValidState();
      feishuMockState.userInfoResponse.unionId = '';

      const res = await request(getTestApp())
        .get('/api/v1/auth/feishu/callback')
        .query({ code: 'auth-code', state })
        .set('X-Client-Context', buildClientContextHeader())
        .set('User-Agent', TEST_USER_AGENT)
        .set('X-Forwarded-For', TEST_CLIENT_IP)
        .expect(502);

      assertApiError(res, ErrorCode.FEISHU_USER_INFO_FAILED, 502);
    });

    it('should_set_isFirstLogin_false_for_existing_user', async () => {
      // 预置已有用户(unionId 与飞书 mock 返回一致)
      createTestTenant({ id: TEST_TENANT_ID_A, name: '已有学校' });
      createTestUser({
        id: TEST_USER_ID_A,
        tenantId: TEST_TENANT_ID_A,
        feishuUnionId: 'on_test_union_id', // 与 feishuMockState 默认一致
        feishuOpenId: 'ou_test_open_id',
        name: '原名',
      });

      const state = createValidState();
      const res = await request(getTestApp())
        .get('/api/v1/auth/feishu/callback')
        .query({ code: 'auth-code', state })
        .set('X-Client-Context', buildClientContextHeader())
        .set('User-Agent', TEST_USER_AGENT)
        .set('X-Forwarded-For', TEST_CLIENT_IP)
        .expect(200);

      const data = res.body.data as { isFirstLogin: boolean };
      expect(data.isFirstLogin).toBe(false);
    });

    it('should_create_personal_tenant_when_no_tenant_key', async () => {
      const state = createValidState();
      // feishuMockState 默认 tenantKey=null
      const res = await request(getTestApp())
        .get('/api/v1/auth/feishu/callback')
        .query({ code: 'auth-code', state })
        .set('X-Client-Context', buildClientContextHeader())
        .set('User-Agent', TEST_USER_AGENT)
        .set('X-Forwarded-For', TEST_CLIENT_IP)
        .expect(200);

      const data = res.body.data as { tenant: { name: string; type: string } };
      expect(data.tenant.name).toContain('个人空间');
      expect(data.tenant.type).toBe('individual');
    });

    it('should_match_existing_tenant_by_feishu_tenant_key', async () => {
      // 预置已有租户(按 tenant_key 匹配)
      const existingTenantName = '某某美术学院';
      createTestTenant({
        id: 't-existing-school',
        name: existingTenantName,
        feishuTenantKey: 'school_key_001',
        type: 'college',
      });

      const state = createValidState();
      feishuMockState.userInfoResponse.tenantKey = 'school_key_001';

      const res = await request(getTestApp())
        .get('/api/v1/auth/feishu/callback')
        .query({ code: 'auth-code', state })
        .set('X-Client-Context', buildClientContextHeader())
        .set('User-Agent', TEST_USER_AGENT)
        .set('X-Forwarded-For', TEST_CLIENT_IP)
        .expect(200);

      const data = res.body.data as { tenant: { name: string } };
      expect(data.tenant.name).toBe(existingTenantName);
    });

    it('should_return_429_when_callback_rate_limit_exceeded', async () => {
      // RATE_LIMIT_CALLBACK_PER_MIN=5,第 6 次触发限流
      const app = getTestApp();
      for (let i = 0; i < 5; i++) {
        await request(app)
          .get('/api/v1/auth/feishu/callback')
          .query({ code: `code-${i}`, state: 'a'.repeat(64) })
          .set('X-Client-Context', buildClientContextHeader())
          .set('User-Agent', TEST_USER_AGENT)
          .set('X-Forwarded-For', '11.0.0.1')
          .expect(400); // state 不存在,但限流先检查
      }
      // 第 6 次:限流
      const res = await request(app)
        .get('/api/v1/auth/feishu/callback')
        .query({ code: 'code-6', state: 'b'.repeat(64) })
        .set('X-Client-Context', buildClientContextHeader())
        .set('User-Agent', TEST_USER_AGENT)
        .set('X-Forwarded-For', '11.0.0.1')
        .expect(429);

      assertApiError(res, ErrorCode.RATE_LIMITED, 429);
    });
  });

  // ============================================================
  // POST /auth/refresh
  // ============================================================
  describe('POST /auth/refresh', () => {
    it('should_return_new_access_token_when_refresh_token_valid', async () => {
      // 预置用户 + 租户 + session
      createTestTenant();
      createTestUser();
      const tokens = createTestTokenSet({
        userId: TEST_USER_ID_A,
        tenantId: TEST_TENANT_ID_A,
      });
      createTestSession({
        userId: TEST_USER_ID_A,
        tenantId: TEST_TENANT_ID_A,
        refreshTokenHash: sha256(tokens.refreshToken),
      });

      const res = await request(getTestApp())
        .post('/api/v1/auth/refresh')
        .set('Cookie', [`refresh_token=${tokens.refreshToken}`, 'csrf_token=test-csrf-token'])
        .set('X-CSRF-Token', 'test-csrf-token')
        .expect(200);

      const body = assertApiResponse(res);
      const data = body.data as { accessToken: string; accessTokenExpiresAt: string };
      expect(data.accessToken).toBeTruthy();
      expect(data.accessToken.split('.').length).toBe(3);
      expect(data.accessTokenExpiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('should_rotate_refresh_token_in_redis_and_db', async () => {
      createTestTenant();
      createTestUser();
      const tokens = createTestTokenSet({
        userId: TEST_USER_ID_A,
        tenantId: TEST_TENANT_ID_A,
      });
      const session = createTestSession({
        userId: TEST_USER_ID_A,
        tenantId: TEST_TENANT_ID_A,
        refreshTokenHash: sha256(tokens.refreshToken),
      });

      await request(getTestApp())
        .post('/api/v1/auth/refresh')
        .set('Cookie', [`refresh_token=${tokens.refreshToken}`, 'csrf_token=test-csrf-token'])
        .set('X-CSRF-Token', 'test-csrf-token')
        .expect(200);

      // 1. 旧 jti 应进黑名单
      const blacklistKey = `blacklist:refresh:${tokens.refreshJti}`;
      const blacklisted = redisMock.__peek(blacklistKey);
      expect(blacklisted).toBeDefined();

      // 2. Session.refreshTokenHash 应更新
      const updatedSession = prismaMock.sessionStore.get(session.id);
      expect(updatedSession?.refreshTokenHash).not.toBe(sha256(tokens.refreshToken));
    });

    it('should_return_401_when_refresh_token_cookie_missing', async () => {
      const res = await request(getTestApp())
        .post('/api/v1/auth/refresh')
        .expect(401);

      assertApiError(res, ErrorCode.REFRESH_TOKEN_INVALID, 401);
    });

    it('should_return_401_when_refresh_token_jwt_invalid', async () => {
      const res = await request(getTestApp())
        .post('/api/v1/auth/refresh')
        .set('Cookie', ['refresh_token=invalid.jwt.token', 'csrf_token=test-csrf-token'])
        .set('X-CSRF-Token', 'test-csrf-token')
        .expect(401);

      assertApiError(res, ErrorCode.REFRESH_TOKEN_INVALID, 401);
    });

    it('should_return_401_when_refresh_token_in_blacklist', async () => {
      createTestTenant();
      createTestUser();
      const tokens = createTestTokenSet({
        userId: TEST_USER_ID_A,
        tenantId: TEST_TENANT_ID_A,
      });
      createTestSession({
        userId: TEST_USER_ID_A,
        tenantId: TEST_TENANT_ID_A,
        refreshTokenHash: sha256(tokens.refreshToken),
      });
      // 预置黑名单
      redisMock.__rawSet(`blacklist:refresh:${tokens.refreshJti}`, '1', 3600);

      const res = await request(getTestApp())
        .post('/api/v1/auth/refresh')
        .set('Cookie', [`refresh_token=${tokens.refreshToken}`, 'csrf_token=test-csrf-token'])
        .set('X-CSRF-Token', 'test-csrf-token')
        .expect(401);

      assertApiError(res, ErrorCode.REFRESH_TOKEN_INVALID, 401);
    });

    it('should_return_401_when_session_revoked', async () => {
      createTestTenant();
      createTestUser();
      const tokens = createTestTokenSet({
        userId: TEST_USER_ID_A,
        tenantId: TEST_TENANT_ID_A,
      });
      createTestSession({
        userId: TEST_USER_ID_A,
        tenantId: TEST_TENANT_ID_A,
        refreshTokenHash: sha256(tokens.refreshToken),
        revokedAt: new Date(), // 已撤销
      });

      const res = await request(getTestApp())
        .post('/api/v1/auth/refresh')
        .set('Cookie', [`refresh_token=${tokens.refreshToken}`, 'csrf_token=test-csrf-token'])
        .set('X-CSRF-Token', 'test-csrf-token')
        .expect(401);

      assertApiError(res, ErrorCode.REFRESH_TOKEN_INVALID, 401);
    });

    it('should_return_401_when_session_not_found_in_db', async () => {
      createTestTenant();
      createTestUser();
      const tokens = createTestTokenSet({
        userId: TEST_USER_ID_A,
        tenantId: TEST_TENANT_ID_A,
      });
      // 不创建 session → DB 中找不到 refresh_token_hash

      const res = await request(getTestApp())
        .post('/api/v1/auth/refresh')
        .set('Cookie', [`refresh_token=${tokens.refreshToken}`, 'csrf_token=test-csrf-token'])
        .set('X-CSRF-Token', 'test-csrf-token')
        .expect(401);

      assertApiError(res, ErrorCode.REFRESH_TOKEN_INVALID, 401);
    });

    it('should_return_403_when_tenant_disabled', async () => {
      createTestTenant({ status: 'disabled' });
      createTestUser();
      const tokens = createTestTokenSet({
        userId: TEST_USER_ID_A,
        tenantId: TEST_TENANT_ID_A,
      });
      createTestSession({
        userId: TEST_USER_ID_A,
        tenantId: TEST_TENANT_ID_A,
        refreshTokenHash: sha256(tokens.refreshToken),
      });

      const res = await request(getTestApp())
        .post('/api/v1/auth/refresh')
        .set('Cookie', [`refresh_token=${tokens.refreshToken}`, 'csrf_token=test-csrf-token'])
        .set('X-CSRF-Token', 'test-csrf-token')
        .expect(403);

      assertApiError(res, ErrorCode.TENANT_DISABLED, 403);
    });

    it('should_clear_cookie_on_refresh_failure', async () => {
      // 不预置任何数据,refresh 必失败
      const tokens = createTestTokenSet({
        userId: 'u-nonexist',
        tenantId: 't-nonexist',
      });

      const res = await request(getTestApp())
        .post('/api/v1/auth/refresh')
        .set('Cookie', [`refresh_token=${tokens.refreshToken}`, 'csrf_token=test-csrf-token'])
        .set('X-CSRF-Token', 'test-csrf-token')
        .expect(401);

      assertApiError(res, ErrorCode.REFRESH_TOKEN_INVALID, 401);
      // 失败时应清 Cookie
      const setCookie = res.headers['set-cookie'];
      expect(setCookie).toBeDefined();
      const all = Array.isArray(setCookie) ? setCookie : [setCookie];
      const cleared = all.find(
        (c) => c.startsWith('refresh_token=;') || c.includes('refresh_token=;'),
      );
      expect(cleared).toBeDefined();
    });
  });

  // ============================================================
  // POST /auth/logout
  // ============================================================
  describe('POST /auth/logout', () => {
    it('should_revoke_current_session_when_logout', async () => {
      createTestTenant();
      createTestUser();
      const tokens = createTestTokenSet({
        userId: TEST_USER_ID_A,
        tenantId: TEST_TENANT_ID_A,
      });
      createTestSession({
        userId: TEST_USER_ID_A,
        tenantId: TEST_TENANT_ID_A,
        refreshTokenHash: sha256(tokens.refreshToken),
      });

      const res = await request(getTestApp())
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .set('Cookie', [`refresh_token=${tokens.refreshToken}`, 'csrf_token=test-csrf-token'])
        .set('X-CSRF-Token', 'test-csrf-token')
        .expect(200);

      const body = assertApiResponse(res);
      const data = body.data as { revokedSessions: number };
      expect(data.revokedSessions).toBeGreaterThanOrEqual(1);

      // Cookie 应被清除
      assertRefreshTokenCookie(res, { shouldExist: false });
    });

    it('should_revoke_all_sessions_when_revokeAll_true', async () => {
      createTestTenant();
      createTestUser();
      const tokens = createTestTokenSet({
        userId: TEST_USER_ID_A,
        tenantId: TEST_TENANT_ID_A,
      });
      // 预置 3 个 session
      createTestSession({
        id: 's-1',
        userId: TEST_USER_ID_A,
        tenantId: TEST_TENANT_ID_A,
        refreshTokenHash: sha256('rt-1'),
      });
      createTestSession({
        id: 's-2',
        userId: TEST_USER_ID_A,
        tenantId: TEST_TENANT_ID_A,
        refreshTokenHash: sha256('rt-2'),
      });
      createTestSession({
        id: 's-3',
        userId: TEST_USER_ID_A,
        tenantId: TEST_TENANT_ID_A,
        refreshTokenHash: sha256(tokens.refreshToken),
      });

      const res = await request(getTestApp())
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .set('Cookie', [`refresh_token=${tokens.refreshToken}`, 'csrf_token=test-csrf-token'])
        .set('X-CSRF-Token', 'test-csrf-token')
        .send({ revokeAll: true })
        .expect(200);

      const data = res.body.data as { revokedSessions: number };
      // revokeAllByUser 仅统计尚未撤销的 session:
      // s-3 已被 revokeByRefreshToken 撤销,revokeAll 再撤销 s-1 + s-2 → 返回 2
      expect(data.revokedSessions).toBe(2);

      // 验证全部 3 个 session 均已撤销(端到端验证)
      expect(prismaMock.sessionStore.get('s-1')?.revokedAt).not.toBeNull();
      expect(prismaMock.sessionStore.get('s-2')?.revokedAt).not.toBeNull();
      expect(prismaMock.sessionStore.get('s-3')?.revokedAt).not.toBeNull();
    });

    it('should_add_access_token_to_blacklist', async () => {
      createTestTenant();
      createTestUser();
      const tokens = createTestTokenSet({
        userId: TEST_USER_ID_A,
        tenantId: TEST_TENANT_ID_A,
      });
      createTestSession({
        userId: TEST_USER_ID_A,
        tenantId: TEST_TENANT_ID_A,
        refreshTokenHash: sha256(tokens.refreshToken),
      });

      await request(getTestApp())
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .set('Cookie', [`refresh_token=${tokens.refreshToken}`, 'csrf_token=test-csrf-token'])
        .set('X-CSRF-Token', 'test-csrf-token')
        .expect(200);

      // access_token jti 应进黑名单
      const blacklistKey = `blacklist:access:${tokens.accessJti}`;
      const blacklisted = redisMock.__peek(blacklistKey);
      expect(blacklisted).toBeDefined();
    });

    it('should_return_401_when_logout_without_auth', async () => {
      const res = await request(getTestApp())
        .post('/api/v1/auth/logout')
        .expect(401);

      assertApiError(res, ErrorCode.UNAUTHORIZED, 401);
    });

    it('should_succeed_even_without_refresh_token_cookie', async () => {
      createTestTenant();
      createTestUser();
      const tokens = createTestTokenSet({
        userId: TEST_USER_ID_A,
        tenantId: TEST_TENANT_ID_A,
      });

      const res = await request(getTestApp())
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        // 不带 refresh_token Cookie
        .expect(200);

      const data = res.body.data as { revokedSessions: number };
      expect(data.revokedSessions).toBe(0);
    });
  });

  // ============================================================
  // GET /auth/me
  // ============================================================
  describe('GET /auth/me', () => {
    it('should_return_user_profile_with_memberships_when_authenticated', async () => {
      createTestTenant();
      const user = createTestUser();
      const tokens = createTestTokenSet({
        userId: user.id,
        tenantId: user.tenantId,
        role: user.role,
        feishuOpenId: user.feishuOpenId,
      });

      const res = await request(getTestApp())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .expect(200);

      const body = assertApiResponse(res);
      const data = body.data as {
        user: { id: string; name: string; feishuUnionId: string };
        tenant: { id: string; name: string };
        memberships: unknown[];
      };

      expect(data.user.id).toBe(user.id);
      expect(data.user.name).toBe(user.name);
      expect(data.user.feishuUnionId).toBe(user.feishuUnionId);
      expect(data.tenant.id).toBe(user.tenantId);
      expect(Array.isArray(data.memberships)).toBe(true);

      assertNoSensitiveDataInBody(res);
      assertTraceIdHeader(res);
    });

    it('should_return_401_when_me_without_auth', async () => {
      const res = await request(getTestApp())
        .get('/api/v1/auth/me')
        .expect(401);

      assertApiError(res, ErrorCode.UNAUTHORIZED, 401);
    });

    it('should_return_401_when_token_expired', async () => {
      createTestTenant();
      createTestUser();
      // 直接用 jwt.sign 签发已过期 token
      const jwt = await import('jsonwebtoken');
      const crypto = await import('node:crypto');
      const { testJwtKeys } = await import('./mocks/jwt-keys.mock.js');
      const payload = {
        sub: TEST_USER_ID_A,
        tenant_id: TEST_TENANT_ID_A,
        role: 'student',
        feishu_open_id: TEST_FEISHU_OPEN_ID_A,
        jti: crypto.randomUUID(),
        iss: 'danqing-ai-auth',
        aud: 'danqing-ai-web',
      };
      const expiredToken = jwt.default.sign(payload, testJwtKeys.privateKey, {
        algorithm: 'RS256',
        expiresIn: -100, // 已过期 100 秒(超过 clockTolerance: 30)
        keyid: 'test-kid-2026',
      });

      const res = await request(getTestApp())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${expiredToken}`)
        .expect(401);

      assertApiError(res, ErrorCode.TOKEN_EXPIRED, 401);
    });

    it('should_return_401_when_token_signature_invalid', async () => {
      createTestTenant();
      createTestUser();
      // 用错误密钥签发
      const crypto = await import('node:crypto');
      const jwt = await import('jsonwebtoken');
      const { privateKey: wrongKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
      const payload = {
        sub: TEST_USER_ID_A,
        tenant_id: TEST_TENANT_ID_A,
        role: 'student',
        feishu_open_id: TEST_FEISHU_OPEN_ID_A,
        jti: crypto.randomUUID(),
        iss: 'danqing-ai-auth',
        aud: 'danqing-ai-web',
      };
      const badToken = jwt.default.sign(payload, wrongKey as string, {
        algorithm: 'RS256',
        expiresIn: '15m',
        keyid: 'test-kid-2026',
      });

      const res = await request(getTestApp())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${badToken}`)
        .expect(401);

      assertApiError(res, ErrorCode.TOKEN_SIGNATURE_INVALID, 401);
    });

    it('should_return_401_when_token_blacklisted', async () => {
      createTestTenant();
      createTestUser();
      const tokens = createTestTokenSet({
        userId: TEST_USER_ID_A,
        tenantId: TEST_TENANT_ID_A,
      });
      // 写入 access_token 黑名单
      redisMock.__rawSet(`blacklist:access:${tokens.accessJti}`, '1', 900);

      const res = await request(getTestApp())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .expect(401);

      assertApiError(res, ErrorCode.UNAUTHORIZED, 401);
    });

    it('should_reject_hs256_token_to_enforce_rs256', async () => {
      createTestTenant();
      createTestUser();
      const crypto = await import('node:crypto');
      const jwt = await import('jsonwebtoken');
      const payload = {
        sub: TEST_USER_ID_A,
        tenant_id: TEST_TENANT_ID_A,
        role: 'student',
        feishu_open_id: TEST_FEISHU_OPEN_ID_A,
        jti: crypto.randomUUID(),
        iss: 'danqing-ai-auth',
        aud: 'danqing-ai-web',
      };
      const hs256Token = jwt.default.sign(payload, 'malicious-secret', {
        algorithm: 'HS256',
        expiresIn: '15m',
      });

      const res = await request(getTestApp())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${hs256Token}`)
        .expect(401);

      // RS256 公钥校验应拒绝 HS256 token
      expect(res.body.code).not.toBe(0);
    });

    it('should_return_user_not_found_when_user_deleted_after_login', async () => {
      // 用户在 DB 中不存在(已删除)
      const tokens = createTestTokenSet({
        userId: 'u-deleted-user',
        tenantId: 't-deleted',
      });

      const res = await request(getTestApp())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .expect(401);

      assertApiError(res, ErrorCode.UNAUTHORIZED, 401);
    });
  });

  // ============================================================
  // 全局:健康检查与 trace
  // ============================================================
  describe('Global: /health', () => {
    it('should_return_200_with_service_info', async () => {
      const res = await request(getTestApp())
        .get('/health')
        .expect(200);

      // G8:健康检查脱敏后仅返回 { status, timestamp },不再暴露 service/version/nodeEnv
      const body = res.body as { code: number; data: { status: string; timestamp: string } };
      expect(body.code).toBe(0);
      expect(body.data.status).toBe('up');
      expect(body.data.timestamp).toBeTruthy();
    });

    it('should_return_trace_id_header_for_every_request', async () => {
      const res = await request(getTestApp()).get('/health').expect(200);
      assertTraceIdHeader(res);
    });

    it('should_echo_client_trace_id_when_valid_uuid', async () => {
      const clientTraceId = '11111111-2222-3333-4444-555555555555';
      const res = await request(getTestApp())
        .get('/health')
        .set('X-Trace-Id', clientTraceId)
        .expect(200);

      expect(res.headers['x-trace-id']).toBe(clientTraceId);
    });
  });
});
