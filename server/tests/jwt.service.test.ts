// ============================================================
// JWT Service 测试
// 对应源码:src/services/jwt.service.ts
// 对应文档:auth-design.md §2.1(JWT 设计)+ §2.2(滚动刷新)
// 测试范围:
//   - issueAccessToken:RS256 签发,payload 完整性,audience 按客户端切换
//   - issueRefreshToken:RS256 签发,payload 含 type=refresh
//   - verifyAccessToken:有效/过期/签名无效/HS256 攻击
//   - verifyRefreshToken:有效/过期/类型不匹配/issuer 不匹配
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest';
import jwt, { TokenExpiredError, JsonWebTokenError } from 'jsonwebtoken';
import crypto from 'node:crypto';
import { jwtService } from '../src/services/jwt.service.js';
import { testJwtKeys } from './mocks/jwt-keys.mock.js';

describe('jwt.service', () => {
  const testUserId = 'u-jwt-test-0001';
  const testTenantId = 't-jwt-test-0001';
  const testFeishuOpenId = 'ou_jwt_test_open_id';
  const testRole = 'student';

  // ============================================================
  // issueAccessToken
  // ============================================================
  describe('issueAccessToken', () => {
    it('should_issue_access_token_with_correct_payload', () => {
      const result = jwtService.issueAccessToken({
        userId: testUserId,
        tenantId: testTenantId,
        role: testRole,
        feishuOpenId: testFeishuOpenId,
        client: 'web',
      });

      expect(result.token).toBeTruthy();
      expect(typeof result.token).toBe('string');
      expect(result.jti).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
      expect(result.expiresIn).toBe(900); // 15m

      // 解析 payload 验证字段
      const decoded = jwt.decode(result.token, { complete: true });
      expect(decoded).not.toBeNull();
      const payload = decoded!.payload as jwt.JwtPayload;
      expect(payload.sub).toBe(testUserId);
      expect(payload['tenant_id']).toBe(testTenantId);
      expect(payload['role']).toBe(testRole);
      expect(payload['feishu_open_id']).toBe(testFeishuOpenId);
      expect(payload.jti).toBe(result.jti);
      expect(payload.iss).toBe('danqing-ai-auth');
      expect(payload.aud).toBe('danqing-ai-web');
      expect(payload.iat).toBeDefined();
      expect(payload.exp).toBeDefined();
    });

    it('should_issue_access_token_with_rs256_algorithm', () => {
      const result = jwtService.issueAccessToken({
        userId: testUserId,
        tenantId: testTenantId,
        role: testRole,
        feishuOpenId: testFeishuOpenId,
        client: 'web',
      });

      const decoded = jwt.decode(result.token, { complete: true });
      expect(decoded?.header.alg).toBe('RS256');
    });

    it('should_issue_access_token_with_correct_kid', () => {
      const result = jwtService.issueAccessToken({
        userId: testUserId,
        tenantId: testTenantId,
        role: testRole,
        feishuOpenId: testFeishuOpenId,
        client: 'web',
      });

      const decoded = jwt.decode(result.token, { complete: true });
      expect(decoded?.header.kid).toBe('test-kid-2026');
    });

    it('should_issue_access_token_with_15m_expiry', () => {
      const result = jwtService.issueAccessToken({
        userId: testUserId,
        tenantId: testTenantId,
        role: testRole,
        feishuOpenId: testFeishuOpenId,
        client: 'web',
      });

      const decoded = jwt.decode(result.token, { complete: true });
      const payload = decoded!.payload as jwt.JwtPayload;
      const duration = (payload.exp as number) - (payload.iat as number);
      expect(duration).toBe(900); // 15m = 900s
    });

    it('should_set_audience_based_on_client_web', () => {
      const result = jwtService.issueAccessToken({
        userId: testUserId,
        tenantId: testTenantId,
        role: testRole,
        feishuOpenId: testFeishuOpenId,
        client: 'web',
      });
      const payload = jwt.decode(result.token) as jwt.JwtPayload;
      expect(payload.aud).toBe('danqing-ai-web');
    });

    it('should_set_audience_based_on_client_admin', () => {
      const result = jwtService.issueAccessToken({
        userId: testUserId,
        tenantId: testTenantId,
        role: 'admin',
        feishuOpenId: testFeishuOpenId,
        client: 'admin',
      });
      const payload = jwt.decode(result.token) as jwt.JwtPayload;
      expect(payload.aud).toBe('danqing-ai-admin');
    });

    it('should_set_audience_based_on_client_mobile', () => {
      const result = jwtService.issueAccessToken({
        userId: testUserId,
        tenantId: testTenantId,
        role: testRole,
        feishuOpenId: testFeishuOpenId,
        client: 'mobile',
      });
      const payload = jwt.decode(result.token) as jwt.JwtPayload;
      expect(payload.aud).toBe('danqing-ai-mobile');
    });

    it('should_generate_unique_jti_per_token', () => {
      const r1 = jwtService.issueAccessToken({
        userId: testUserId,
        tenantId: testTenantId,
        role: testRole,
        feishuOpenId: testFeishuOpenId,
        client: 'web',
      });
      const r2 = jwtService.issueAccessToken({
        userId: testUserId,
        tenantId: testTenantId,
        role: testRole,
        feishuOpenId: testFeishuOpenId,
        client: 'web',
      });
      expect(r1.jti).not.toBe(r2.jti);
    });
  });

  // ============================================================
  // issueRefreshToken
  // ============================================================
  describe('issueRefreshToken', () => {
    it('should_issue_refresh_token_with_type_refresh', () => {
      const result = jwtService.issueRefreshToken({
        userId: testUserId,
        client: 'web',
      });

      const payload = jwt.decode(result.token) as jwt.JwtPayload;
      expect(payload['type']).toBe('refresh');
      expect(payload.sub).toBe(testUserId);
      expect(payload.jti).toBe(result.jti);
      expect(payload.iss).toBe('danqing-ai-auth');
      expect(payload.aud).toBe('danqing-ai-auth-refresh');
    });

    it('should_issue_refresh_token_with_rs256_algorithm', () => {
      const result = jwtService.issueRefreshToken({
        userId: testUserId,
        client: 'web',
      });
      const decoded = jwt.decode(result.token, { complete: true });
      expect(decoded?.header.alg).toBe('RS256');
    });

    it('should_issue_refresh_token_with_7d_expiry', () => {
      const result = jwtService.issueRefreshToken({
        userId: testUserId,
        client: 'web',
      });
      const decoded = jwt.decode(result.token, { complete: true });
      const payload = decoded!.payload as jwt.JwtPayload;
      const duration = (payload.exp as number) - (payload.iat as number);
      expect(duration).toBe(604800); // 7d = 604800s
    });

    it('should_not_include_business_info_in_refresh_token', () => {
      // 安全:refresh_token 最小化,不含 tenant_id / role / feishu_open_id
      const result = jwtService.issueRefreshToken({
        userId: testUserId,
        client: 'web',
      });
      const payload = jwt.decode(result.token) as jwt.JwtPayload;
      expect(payload['tenant_id']).toBeUndefined();
      expect(payload['role']).toBeUndefined();
      expect(payload['feishu_open_id']).toBeUndefined();
    });
  });

  // ============================================================
  // verifyAccessToken
  // ============================================================
  describe('verifyAccessToken', () => {
    it('should_verify_valid_access_token', () => {
      const issueResult = jwtService.issueAccessToken({
        userId: testUserId,
        tenantId: testTenantId,
        role: testRole,
        feishuOpenId: testFeishuOpenId,
        client: 'web',
      });

      const payload = jwtService.verifyAccessToken(issueResult.token);
      expect(payload.sub).toBe(testUserId);
      expect(payload['tenant_id']).toBe(testTenantId);
      expect(payload['role']).toBe(testRole);
      expect(payload.jti).toBe(issueResult.jti);
    });

    it('should_throw_token_expired_when_access_token_expired', () => {
      // 签发一个已过期的 token(直接用底层 jwt.sign)
      const payload = {
        sub: testUserId,
        tenant_id: testTenantId,
        role: testRole,
        feishu_open_id: testFeishuOpenId,
        jti: crypto.randomUUID(),
        iss: 'danqing-ai-auth',
        aud: 'danqing-ai-web',
      };
      const expiredToken = jwt.sign(payload, testJwtKeys.privateKey, {
        algorithm: 'RS256',
        expiresIn: -100, // 已过期 100 秒(超过 clockTolerance: 30)
        keyid: 'test-kid-2026',
      });

      expect(() => jwtService.verifyAccessToken(expiredToken)).toThrow(TokenExpiredError);
    });

    it('should_throw_json_web_token_error_when_signature_invalid', () => {
      // 用错误的密钥签发
      const { privateKey: wrongKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
      });
      const payload = {
        sub: testUserId,
        tenant_id: testTenantId,
        role: testRole,
        feishu_open_id: testFeishuOpenId,
        jti: crypto.randomUUID(),
        iss: 'danqing-ai-auth',
        aud: 'danqing-ai-web',
      };
      const badToken = jwt.sign(payload, wrongKey as string, {
        algorithm: 'RS256',
        expiresIn: '15m',
        keyid: 'test-kid-2026',
      });

      expect(() => jwtService.verifyAccessToken(badToken)).toThrow(JsonWebTokenError);
    });

    it('should_throw_when_access_token_signed_with_hs256', () => {
      // 攻击场景:用 HS256 对称签名伪造(对应 auth-design.md §0 C1 防 alg 混淆)
      const payload = {
        sub: testUserId,
        tenant_id: testTenantId,
        role: testRole,
        feishu_open_id: testFeishuOpenId,
        jti: crypto.randomUUID(),
        iss: 'danqing-ai-auth',
        aud: 'danqing-ai-web',
      };
      const hs256Token = jwt.sign(payload, 'malicious-secret', {
        algorithm: 'HS256',
        expiresIn: '15m',
      });

      // RS256 公钥校验应拒绝 HS256 token
      expect(() => jwtService.verifyAccessToken(hs256Token)).toThrow();
    });

    it('should_throw_when_issuer_mismatch', () => {
      const payload = {
        sub: testUserId,
        tenant_id: testTenantId,
        role: testRole,
        feishu_open_id: testFeishuOpenId,
        jti: crypto.randomUUID(),
        iss: 'wrong-issuer',
        aud: 'danqing-ai-web',
      };
      const token = jwt.sign(payload, testJwtKeys.privateKey, {
        algorithm: 'RS256',
        expiresIn: '15m',
        keyid: 'test-kid-2026',
      });

      expect(() => jwtService.verifyAccessToken(token)).toThrow(JsonWebTokenError);
    });

    it('should_throw_when_audience_mismatch', () => {
      const payload = {
        sub: testUserId,
        tenant_id: testTenantId,
        role: testRole,
        feishu_open_id: testFeishuOpenId,
        jti: crypto.randomUUID(),
        iss: 'danqing-ai-auth',
        aud: 'wrong-audience',
      };
      const token = jwt.sign(payload, testJwtKeys.privateKey, {
        algorithm: 'RS256',
        expiresIn: '15m',
        keyid: 'test-kid-2026',
      });

      expect(() => jwtService.verifyAccessToken(token)).toThrow(JsonWebTokenError);
    });

    it('should_throw_when_token_is_garbage', () => {
      expect(() => jwtService.verifyAccessToken('not.a.jwt')).toThrow();
      expect(() => jwtService.verifyAccessToken('')).toThrow();
    });
  });

  // ============================================================
  // verifyRefreshToken
  // ============================================================
  describe('verifyRefreshToken', () => {
    it('should_verify_valid_refresh_token', () => {
      const issueResult = jwtService.issueRefreshToken({
        userId: testUserId,
        client: 'web',
      });

      const payload = jwtService.verifyRefreshToken(issueResult.token);
      expect(payload.sub).toBe(testUserId);
      expect(payload.jti).toBe(issueResult.jti);
      expect(payload['type']).toBe('refresh');
    });

    it('should_throw_token_expired_when_refresh_token_expired', () => {
      const payload = {
        sub: testUserId,
        jti: crypto.randomUUID(),
        iss: 'danqing-ai-auth',
        aud: 'danqing-ai-auth-refresh',
        type: 'refresh',
      };
      const expiredToken = jwt.sign(payload, testJwtKeys.privateKey, {
        algorithm: 'RS256',
        expiresIn: -100, // 已过期 100 秒(超过 clockTolerance: 30)
        keyid: 'test-kid-2026',
      });

      expect(() => jwtService.verifyRefreshToken(expiredToken)).toThrow(TokenExpiredError);
    });

    it('should_throw_when_refresh_token_type_not_refresh', () => {
      // 用 access_token 冒充 refresh_token
      const accessToken = jwtService.issueAccessToken({
        userId: testUserId,
        tenantId: testTenantId,
        role: testRole,
        feishuOpenId: testFeishuOpenId,
        client: 'web',
      });

      expect(() => jwtService.verifyRefreshToken(accessToken.token)).toThrow(JsonWebTokenError);
    });

    it('should_throw_when_signature_invalid', () => {
      const { privateKey: wrongKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
      });
      const payload = {
        sub: testUserId,
        jti: crypto.randomUUID(),
        iss: 'danqing-ai-auth',
        aud: 'danqing-ai-auth-refresh',
        type: 'refresh',
      };
      const badToken = jwt.sign(payload, wrongKey as string, {
        algorithm: 'RS256',
        expiresIn: '7d',
        keyid: 'test-kid-2026',
      });

      expect(() => jwtService.verifyRefreshToken(badToken)).toThrow(JsonWebTokenError);
    });

    it('should_throw_when_issuer_mismatch', () => {
      const payload = {
        sub: testUserId,
        jti: crypto.randomUUID(),
        iss: 'wrong-issuer',
        aud: 'danqing-ai-auth-refresh',
        type: 'refresh',
      };
      const token = jwt.sign(payload, testJwtKeys.privateKey, {
        algorithm: 'RS256',
        expiresIn: '7d',
        keyid: 'test-kid-2026',
      });

      expect(() => jwtService.verifyRefreshToken(token)).toThrow(JsonWebTokenError);
    });
  });
});
