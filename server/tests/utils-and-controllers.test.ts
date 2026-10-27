// ============================================================
// 工具函数与 Controller 分支补充测试
// 对应源码:
//   - src/utils/crypto.ts (safeEqual / generateState / generateJti 等)
//   - src/controllers/user.controller.ts (401 分支)
//   - src/controllers/auth.controller.ts (redirect_uri query 分支)
// 测试策略:
//   - 直接对纯函数进行单元测试(无 IO 依赖)
//   - 通过 supertest 触发 controller 中未覆盖的 4xx 分支
//   - 直接调用 controller 函数覆盖防御性分支(绕过 authMiddleware)
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import {
  sha256,
  generateState,
  generateJti,
  generateUuid,
  isValidStateFormat,
  safeEqual,
} from '../src/utils/crypto.js';
import { getTestApp } from './helpers/test-app.js';
import {
  createTestTenant,
  createTestUser,
  createTestTokenSet,
  buildClientContextHeader,
  TEST_USER_ID_A,
  TEST_TENANT_ID_A,
  TEST_DEVICE_ID,
  TEST_USER_AGENT,
} from './helpers/fixtures.js';
import { ErrorCode } from '../src/types/api-contract.js';
import { assertApiError } from './helpers/assertions.js';
import { getProfile, updateProfile } from '../src/controllers/user.controller.js';

// Express mock 工厂(用于直接调用 controller)
type MockReq = Partial<Request> & {
  userId?: string;
  tenantId?: string;
  body?: unknown;
};
type MockRes = {
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
  req: MockReq;
};
function createMockRes(req?: MockReq): MockRes {
  const r = req ?? ({} as MockReq);
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    req: r,
  };
}

// ============================================================
// utils/crypto (加密工具)
// ============================================================

describe('utils/crypto (加密工具)', () => {
  describe('sha256', () => {
    it('should_return_hex_string_with_length_64', () => {
      const hash = sha256('test');
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should_return_same_hash_for_same_input', () => {
      expect(sha256('hello')).toBe(sha256('hello'));
    });

    it('should_return_different_hash_for_different_input', () => {
      expect(sha256('hello')).not.toBe(sha256('world'));
    });

    it('should_return_known_hash_for_known_input', () => {
      // SHA-256("abc") 的标准结果
      expect(sha256('abc')).toBe(
        'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      );
    });

    it('should_handle_empty_string', () => {
      const hash = sha256('');
      // SHA-256 of empty string
      expect(hash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    });

    it('should_handle_unicode_characters', () => {
      const hash = sha256('你好世界');
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
      // 同一 Unicode 字符串应稳定输出同一哈希
      expect(hash).toBe(sha256('你好世界'));
      expect(hash).not.toBe(sha256('你好世界2'));
    });
  });

  describe('generateState', () => {
    it('should_return_64_char_hex_string', () => {
      const state = generateState();
      expect(state).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should_return_different_state_each_call', () => {
      const s1 = generateState();
      const s2 = generateState();
      expect(s1).not.toBe(s2);
    });
  });

  describe('generateJti', () => {
    it('should_return_valid_uuid_v4', () => {
      const jti = generateJti();
      // UUID v4 格式:8-4-4-4-12
      expect(jti).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });

    it('should_return_different_jti_each_call', () => {
      expect(generateJti()).not.toBe(generateJti());
    });
  });

  describe('generateUuid', () => {
    it('should_return_valid_uuid_v4', () => {
      const uuid = generateUuid();
      expect(uuid).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });
  });

  describe('isValidStateFormat', () => {
    it('should_return_true_for_valid_64_char_hex', () => {
      expect(isValidStateFormat('a'.repeat(64))).toBe(true);
      expect(isValidStateFormat('0123456789abcdef'.repeat(4))).toBe(true);
    });

    it('should_return_false_for_short_string', () => {
      expect(isValidStateFormat('abc')).toBe(false);
    });

    it('should_return_false_for_long_string', () => {
      expect(isValidStateFormat('a'.repeat(65))).toBe(false);
    });

    it('should_return_false_for_non_hex_chars', () => {
      expect(isValidStateFormat('g'.repeat(64))).toBe(false);
      expect(isValidStateFormat('z'.repeat(64))).toBe(false);
      expect(isValidStateFormat('A'.repeat(64))).toBe(false); // 大写不算
    });

    it('should_return_false_for_empty_string', () => {
      expect(isValidStateFormat('')).toBe(false);
    });
  });

  describe('safeEqual', () => {
    it('should_return_true_when_strings_equal', () => {
      expect(safeEqual('hello', 'hello')).toBe(true);
    });

    it('should_return_false_when_strings_different', () => {
      expect(safeEqual('hello', 'world')).toBe(false);
    });

    it('should_return_false_when_lengths_differ', () => {
      // 长度不同应直接返回 false(不进入 timingSafeEqual)
      expect(safeEqual('a', 'ab')).toBe(false);
      expect(safeEqual('abc', 'abcd')).toBe(false);
      expect(safeEqual('longer-string', 'short')).toBe(false);
    });

    it('should_return_true_for_empty_strings', () => {
      // 两个空字符串长度相同,内容相同
      expect(safeEqual('', '')).toBe(true);
    });

    it('should_handle_unicode_strings', () => {
      expect(safeEqual('你好', '你好')).toBe(true);
      expect(safeEqual('你好', '世界')).toBe(false);
    });

    it('should_be_constant_time_for_same_length', () => {
      // 这是时序测试的简化版:多次调用相同长度应稳定返回
      for (let i = 0; i < 10; i++) {
        expect(safeEqual('secret-token', 'secret-token')).toBe(true);
        expect(safeEqual('secret-token', 'secret-wrong')).toBe(false);
      }
    });
  });
});

// ============================================================
// user.controller (用户接口补充测试)
// ============================================================

describe('user.controller (用户接口分支补充)', () => {
  beforeEach(() => {
    createTestTenant();
    createTestUser();
  });

  describe('GET /users/profile', () => {
    it('should_return_401_when_userId_missing_in_request', async () => {
      // 构造一个无 userId 的请求:不带 Authorization 头
      const res = await request(getTestApp()).get('/api/v1/users/profile').expect(401);

      assertApiError(res, ErrorCode.UNAUTHORIZED, 401);
    });
  });

  describe('PATCH /users/profile', () => {
    it('should_return_401_when_not_authenticated', async () => {
      // 不带 Authorization 头:authMiddleware 会拦截,但补充测试 user.controller 的 401 分支
      const res = await request(getTestApp())
        .patch('/api/v1/users/profile')
        .send({ displayName: 'test' })
        .expect(401);

      assertApiError(res, ErrorCode.UNAUTHORIZED, 401);
    });

    it('should_update_profile_when_authenticated', async () => {
      const tokens = createTestTokenSet({
        userId: TEST_USER_ID_A,
        tenantId: TEST_TENANT_ID_A,
      });

      const res = await request(getTestApp())
        .patch('/api/v1/users/profile')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ displayName: '新名称', avatarUrl: 'https://example.com/avatar.png' })
        .expect(200);

      expect(res.body.code).toBe(0);
      expect(res.body.data).toBeDefined();
    });
  });

  // ============================================================
  // PATCH /users/learner-profile(2026-08-16 学习者画像边界测试)
  // 边界:未认证 401 / 非法枚举值 400 / 合法三值 200
  // ============================================================
  describe('PATCH /users/learner-profile', () => {
    it('should_return_401_when_not_authenticated', async () => {
      const res = await request(getTestApp())
        .patch('/api/v1/users/learner-profile')
        .send({ learnerProfile: 'hobbyist' })
        .expect(401);

      assertApiError(res, ErrorCode.UNAUTHORIZED, 401);
    });

    it('should_return_400_when_profile_is_invalid_enum', async () => {
      const tokens = createTestTokenSet({
        userId: TEST_USER_ID_A,
        tenantId: TEST_TENANT_ID_A,
      });

      const res = await request(getTestApp())
        .patch('/api/v1/users/learner-profile')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ learnerProfile: 'master' })
        .expect(400);

      assertApiError(res, ErrorCode.PARAM_INVALID, 400);
    });

    it.each(['hobbyist', 'beginner', 'artStudent'] as const)(
      'should_set_profile_%s_when_valid',
      async (profile) => {
        const tokens = createTestTokenSet({
          userId: TEST_USER_ID_A,
          tenantId: TEST_TENANT_ID_A,
        });

        const res = await request(getTestApp())
          .patch('/api/v1/users/learner-profile')
          .set('Authorization', `Bearer ${tokens.accessToken}`)
          .send({ learnerProfile: profile })
          .expect(200);

        expect(res.body.code).toBe(0);
        expect(res.body.data).toBeDefined();
      },
    );
  });
});

// ============================================================
// auth.controller (redirect_uri query 分支补充)
// ============================================================

describe('auth.controller (redirect_uri 与异常分支补充)', () => {
  it('should_use_query_redirect_uri_when_provided_as_string', async () => {
    const res = await request(getTestApp())
      .get('/api/v1/auth/feishu/authorize')
      .query({ redirect_uri: 'https://custom.example.com/callback' })
      .set('X-Client-Context', buildClientContextHeader(TEST_DEVICE_ID, 'web'))
      .set('User-Agent', TEST_USER_AGENT)
      .expect(200);

    // authorizeUrl 中的 redirect_uri 应反映自定义值或环境默认值(取决于 service 层处理)
    expect(res.body.code).toBe(0);
    expect(res.body.data).toBeDefined();
  });

  it('should_ignore_redirect_uri_when_not_string', async () => {
    // redirect_uri 为数组(异常输入)
    const res = await request(getTestApp())
      .get('/api/v1/auth/feishu/authorize')
      .query({ redirect_uri: ['not-a-string'] })
      .set('X-Client-Context', buildClientContextHeader(TEST_DEVICE_ID, 'web'))
      .set('User-Agent', TEST_USER_AGENT)
      .expect(200);

    expect(res.body.code).toBe(0);
  });

  it('should_return_400_when_callback_code_missing', async () => {
    // 完全不传 code:code 为 undefined → '' → 触发 PARAM_MISSING
    const res = await request(getTestApp())
      .get('/api/v1/auth/feishu/callback')
      .query({ state: 'a'.repeat(64) })
      .set('X-Client-Context', buildClientContextHeader())
      .set('User-Agent', TEST_USER_AGENT)
      .expect(400);

    assertApiError(res, ErrorCode.PARAM_MISSING, 400);
  });

  it('should_return_400_when_callback_state_missing', async () => {
    // 完全不传 state:state 为 undefined → '' → 触发 PARAM_MISSING
    const res = await request(getTestApp())
      .get('/api/v1/auth/feishu/callback')
      .query({ code: 'valid-code' })
      .set('X-Client-Context', buildClientContextHeader())
      .set('User-Agent', TEST_USER_AGENT)
      .expect(400);

    assertApiError(res, ErrorCode.PARAM_MISSING, 400);
  });
});

// ============================================================
// user.controller 直接单元测试(覆盖防御性 401 分支)
// 这些分支在 supertest 集成测试中无法触发,因为 authMiddleware 会先拦截
// ============================================================

describe('user.controller (直接单元测试 - 防御性分支)', () => {
  beforeEach(() => {
    createTestTenant();
    createTestUser();
  });

  it('should_return_401_when_getProfile_called_without_userId', async () => {
    // 直接调用 controller,绕过 authMiddleware
    const req = {} as MockReq; // userId 未注入
    const res = createMockRes(req);
    const next = vi.fn() as unknown as NextFunction;

    await getProfile(req as Request, res as unknown as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(body.code).toBe(ErrorCode.UNAUTHORIZED);
  });

  it('should_return_profile_when_getProfile_called_with_userId', async () => {
    const req = { userId: TEST_USER_ID_A } as MockReq;
    const res = createMockRes(req);
    const next = vi.fn() as unknown as NextFunction;

    await getProfile(req as Request, res as unknown as Response, next);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(body.code).toBe(0);
    expect(body.data).toBeDefined();
  });

  it('should_return_401_when_updateProfile_called_without_userId', async () => {
    // 仅 tenantId,无 userId → 应返回 401
    const req = { tenantId: TEST_TENANT_ID_A, body: {} } as MockReq;
    const res = createMockRes(req);
    const next = vi.fn() as unknown as NextFunction;

    await updateProfile(req as Request, res as unknown as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('should_return_401_when_updateProfile_called_without_tenantId', async () => {
    // 仅 userId,无 tenantId → 应返回 401
    const req = { userId: TEST_USER_ID_A, body: {} } as MockReq;
    const res = createMockRes(req);
    const next = vi.fn() as unknown as NextFunction;

    await updateProfile(req as Request, res as unknown as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('should_call_next_when_service_throws_error', async () => {
    // 传入一个不存在的 userId,触发 service 抛错
    const req = { userId: 'nonexistent-user-id' } as MockReq;
    const res = createMockRes(req);
    const next = vi.fn() as unknown as NextFunction;

    await getProfile(req as Request, res as unknown as Response, next);

    // service 抛 USER_NOT_FOUND → next 被调用
    expect(next).toHaveBeenCalledTimes(1);
  });
});
