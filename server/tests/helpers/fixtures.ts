// ============================================================
// 测试数据工厂(Fixtures)
// 对应文档:api-contract-v1.md §3(类型定义)+ auth-design.md §1.2(用户/租户结构)
// 提供用户 / 租户 / 会话 / token / state 等测试数据的工厂方法
// ============================================================

import crypto from 'node:crypto';
import { jwtService } from '../../src/services/jwt.service.js';
import { prismaMock } from '../mocks/prisma.mock.js';
import { redisMock } from '../mocks/redis.mock.js';
import type { MockUser, MockTenant, MockSession } from '../mocks/prisma.mock.js';

// ============================================================
// 常量(测试用固定 ID,便于断言)
// ============================================================

export const TEST_TENANT_ID_A = 't-tenant-a-0001';
export const TEST_TENANT_ID_B = 't-tenant-b-0002';
export const TEST_USER_ID_A = 'u-user-a-0001';
export const TEST_USER_ID_B = 'u-user-b-0002';
export const TEST_DEVICE_ID = 'd-test-device-0001';
export const TEST_CLIENT_IP = '192.168.1.100';
export const TEST_USER_AGENT = 'Mozilla/5.0 (Test Browser) Vitest/1.0';
export const TEST_FEISHU_OPEN_ID_A = 'ou_test_open_id_a';
export const TEST_FEISHU_UNION_ID_A = 'on_test_union_id_a';
export const TEST_FEISHU_OPEN_ID_B = 'ou_test_open_id_b';
export const TEST_FEISHU_UNION_ID_B = 'on_test_union_id_b';

// ============================================================
// 客户端上下文头(供 supertest 使用)
// ============================================================

export function buildClientContextHeader(deviceId: string = TEST_DEVICE_ID, client: 'web' | 'admin' | 'mobile' = 'web'): string {
  return JSON.stringify({ device_id: deviceId, client });
}

export function buildAuthHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };
}

// ============================================================
// 用户/租户/会话工厂(直接插入 Prisma mock store)
// ============================================================

export function createTestUser(overrides: Partial<MockUser> = {}): MockUser {
  return prismaMock.__insertUser({
    id: overrides.id ?? TEST_USER_ID_A,
    tenantId: overrides.tenantId ?? TEST_TENANT_ID_A,
    feishuOpenId: overrides.feishuOpenId ?? TEST_FEISHU_OPEN_ID_A,
    feishuUnionId: overrides.feishuUnionId ?? TEST_FEISHU_UNION_ID_A,
    name: overrides.name ?? '测试用户A',
    avatar: overrides.avatar ?? 'https://example.com/avatar-a.jpg',
    email: overrides.email ?? 'usera@test.edu.cn',
    phone: overrides.phone ?? null,
    role: overrides.role ?? 'student',
    lastLoginAt: overrides.lastLoginAt ?? new Date(),
    ...overrides,
  });
}

export function createTestTenant(overrides: Partial<MockTenant> = {}): MockTenant {
  return prismaMock.__insertTenant({
    id: overrides.id ?? TEST_TENANT_ID_A,
    name: overrides.name ?? '测试租户A',
    type: overrides.type ?? 'individual',
    feishuTenantKey: overrides.feishuTenantKey ?? null,
    plan: overrides.plan ?? 'free',
    status: overrides.status ?? 'active',
    maxSeats: overrides.maxSeats ?? 10,
    parentId: overrides.parentId ?? null,
    ...overrides,
  });
}

export function createTestSession(overrides: Partial<MockSession> = {}): MockSession {
  return prismaMock.__insertSession({
    id: overrides.id ?? 's-session-0001',
    userId: overrides.userId ?? TEST_USER_ID_A,
    tenantId: overrides.tenantId ?? TEST_TENANT_ID_A,
    refreshTokenHash: overrides.refreshTokenHash ?? crypto.createHash('sha256').update('test-refresh-token').digest('hex'),
    userAgent: overrides.userAgent ?? TEST_USER_AGENT,
    ip: overrides.ip ?? TEST_CLIENT_IP,
    expiresAt: overrides.expiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    revokedAt: overrides.revokedAt ?? null,
    ...overrides,
  });
}

// ============================================================
// JWT token 工厂(用真实 jwtService + 测试密钥签发)
// ============================================================

export interface TestTokenSet {
  accessToken: string;
  refreshToken: string;
  accessJti: string;
  refreshJti: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
}

/**
 * 签发一组完整 token(用于已登录场景测试)
 */
export function createTestTokenSet(params: {
  userId: string;
  tenantId: string;
  role?: string;
  feishuOpenId?: string;
  client?: 'web' | 'admin' | 'mobile';
}): TestTokenSet {
  const access = jwtService.issueAccessToken({
    userId: params.userId,
    tenantId: params.tenantId,
    role: (params.role ?? 'student') as Parameters<typeof jwtService.issueAccessToken>[0]['role'],
    feishuOpenId: params.feishuOpenId ?? TEST_FEISHU_OPEN_ID_A,
    client: params.client ?? 'web',
  });
  const refresh = jwtService.issueRefreshToken({
    userId: params.userId,
    client: params.client ?? 'web',
  });
  return {
    accessToken: access.token,
    refreshToken: refresh.token,
    accessJti: access.jti,
    refreshJti: refresh.jti,
    accessExpiresAt: access.expiresAt,
    refreshExpiresAt: refresh.expiresAt,
  };
}

/**
 * 签发过期的 access_token(直接用 jsonwebtoken 签发,exp 设为过去)
 */
export function createExpiredAccessToken(params: {
  userId: string;
  tenantId: string;
}): string {
  // 使用 jwtService 内部相同密钥,通过手动构造过期 payload
  // 简化:签发后立即用,但 exp 设为 1 秒前
  // 由于 jwtService 不支持自定义 exp,这里用底层 jsonwebtoken
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const jwt = require('jsonwebtoken') as typeof import('jsonwebtoken');
  const payload = {
    sub: params.userId,
    tenant_id: params.tenantId,
    role: 'student',
    feishu_open_id: TEST_FEISHU_OPEN_ID_A,
    jti: crypto.randomUUID(),
    iss: 'danqing-ai-auth',
    aud: 'danqing-ai-web',
  };
  return jwt.sign(payload, testJwtPrivateKey, {
    algorithm: 'RS256',
    expiresIn: -100, // 已过期 100 秒(超过 clockTolerance: 30)
    keyid: 'test-kid-2026',
  });
}

// 测试私钥(从 setup 间接获取,避免循环 import)
import { testJwtKeys } from '../mocks/jwt-keys.mock.js';
const testJwtPrivateKey = testJwtKeys.privateKey;

/**
 * 签发签名无效的 token(用错误的密钥)
 */
export function createInvalidSignatureToken(params: {
  userId: string;
  tenantId: string;
}): string {
  const { privateKey: wrongKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const jwt = require('jsonwebtoken') as typeof import('jsonwebtoken');
  const payload = {
    sub: params.userId,
    tenant_id: params.tenantId,
    role: 'student',
    feishu_open_id: TEST_FEISHU_OPEN_ID_A,
    jti: crypto.randomUUID(),
    iss: 'danqing-ai-auth',
    aud: 'danqing-ai-web',
  };
  return jwt.sign(payload, wrongKey as string, {
    algorithm: 'RS256',
    expiresIn: '15m',
    keyid: 'test-kid-2026',
  });
}

/**
 * 用 HS256 签发 token(测试 RS256 强制校验)
 */
export function createHs256Token(params: { userId: string; tenantId: string }): string {
  const jwt = require('jsonwebtoken') as typeof import('jsonwebtoken');
  const payload = {
    sub: params.userId,
    tenant_id: params.tenantId,
    role: 'student',
    feishu_open_id: TEST_FEISHU_OPEN_ID_A,
    jti: crypto.randomUUID(),
    iss: 'danqing-ai-auth',
    aud: 'danqing-ai-web',
  };
  return jwt.sign(payload, 'wrong-hs-secret', {
    algorithm: 'HS256',
    expiresIn: '15m',
  });
}

// ============================================================
// state 工厂(直接写入 Redis mock)
// ============================================================

export interface StatePayload {
  clientIp: string;
  userAgent: string;
  deviceId: string;
  client: 'web' | 'admin' | 'mobile';
  createdAt: number;
}

/**
 * 生成有效 state 并写入 Redis mock(模拟 authorize 阶段)
 * 返回 state 值,供 callback 使用
 */
export function createValidState(overrides: Partial<StatePayload> = {}): string {
  const state = crypto.randomBytes(32).toString('hex');
  const payload: StatePayload = {
    clientIp: overrides.clientIp ?? TEST_CLIENT_IP,
    userAgent: overrides.userAgent ?? TEST_USER_AGENT,
    deviceId: overrides.deviceId ?? TEST_DEVICE_ID,
    client: overrides.client ?? 'web',
    createdAt: overrides.createdAt ?? Date.now(),
  };
  // 写入 Redis mock,键名与 auth.service 一致
  redisMock.__rawSet(`oauth:state:${state}`, JSON.stringify(payload), 300);
  return state;
}

/**
 * 生成格式非法的 state(非 64 字符 hex)
 */
export function createInvalidFormatState(): string {
  return 'invalid-state-not-hex';
}
