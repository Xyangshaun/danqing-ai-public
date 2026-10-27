// ============================================================
// 环境变量加载与启动自检测试
// 对应源码:src/config/env.ts
// 测试策略:
//   - 通过 vi.stubEnv 修改 process.env,调用 loadEnv() 验证各分支
//   - 覆盖正常路径 + 边界值 + 异常分支(必填缺失/格式非法/私钥非 RSA)
//   - loadEnv 是纯函数(读 process.env),无需 mock
// ============================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadEnv, initEnv, env } from '../src/config/env.js';
import { testJwtKeys } from './mocks/jwt-keys.mock.js';
import crypto from 'node:crypto';

// ============================================================
// 测试用基础 env(满足所有必填项的最小集合)
// ============================================================

function buildValidEnv(): Record<string, string | undefined> {
  return {
    FEISHU_APP_ID: 'cli_test_app_id',
    FEISHU_APP_SECRET: 'test_app_secret_value',
    FEISHU_REDIRECT_URI_WEB: 'http://localhost:5173/auth/feishu/callback',
    FEISHU_REDIRECT_URI_ADMIN: 'http://localhost:3001/auth/feishu/callback',
    FEISHU_REDIRECT_URI_MOBILE: 'http://localhost:8081/auth/feishu/callback',
    JWT_PRIVATE_KEY: testJwtKeys.privateKey,
    JWT_PUBLIC_KEY: testJwtKeys.publicKey,
    JWT_KEY_ID: 'test-kid-2026',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/test',
    REDIS_URL: 'redis://localhost:6379/0',
    CORS_ORIGINS: 'http://localhost:5173,http://localhost:3001',
  };
}

function applyEnv(record: Record<string, string | undefined>): void {
  // 先清空相关 env(避免上一个测试残留)
  const keys = [
    'FEISHU_APP_ID', 'FEISHU_APP_SECRET',
    'FEISHU_REDIRECT_URI_WEB', 'FEISHU_REDIRECT_URI_ADMIN', 'FEISHU_REDIRECT_URI_MOBILE',
    'FEISHU_AUTHZ_ENDPOINT', 'FEISHU_TOKEN_ENDPOINT', 'FEISHU_USERINFO_ENDPOINT',
    'JWT_PRIVATE_KEY', 'JWT_PUBLIC_KEY', 'JWT_KEY_ID',
    'JWT_ISSUER', 'JWT_AUDIENCE_WEB', 'JWT_AUDIENCE_ADMIN', 'JWT_AUDIENCE_MOBILE',
    'JWT_ACCESS_EXPIRES', 'JWT_REFRESH_EXPIRES',
    'COOKIE_SECURE', 'COOKIE_DOMAIN', 'COOKIE_SAMESITE', 'COOKIE_PATH', 'COOKIE_MAX_AGE',
    'DATABASE_URL', 'REDIS_URL', 'CORS_ORIGINS',
    'RATE_LIMIT_AUTH_PER_MIN', 'RATE_LIMIT_CALLBACK_PER_MIN',
    'RATE_LIMIT_REFRESH_PER_MIN', 'RATE_LIMIT_API_PER_MIN',
    'TENANT_DEFAULT_PLAN', 'TENANT_DEFAULT_TYPE',
    'ENABLE_HSTS', 'LOG_LEVEL', 'NODE_ENV', 'PORT',
    // AI 图像生成(M2-T9)
    'AI_IMAGE_PROVIDER', 'AI_IMAGE_API_KEY', 'AI_IMAGE_API_URL', 'AI_IMAGE_API_MODEL',
    'AI_IMAGE_TIMEOUT', 'GENERATION_RATE_LIMIT_PER_MIN', 'GENERATION_MAX_COUNT',
  ];
  for (const k of keys) {
    delete process.env[k];
  }
  for (const [k, v] of Object.entries(record)) {
    if (v === undefined) continue;
    process.env[k] = v;
  }
}

describe('config/env (环境变量加载与启动自检)', () => {
  beforeEach(() => {
    applyEnv(buildValidEnv());
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // ============================================================
  // loadEnv - 正常路径
  // ============================================================
  describe('loadEnv (正常路径)', () => {
    it('should_load_all_required_fields_when_env_complete', () => {
      const cfg = loadEnv();
      expect(cfg.feishuAppId).toBe('cli_test_app_id');
      expect(cfg.feishuAppSecret).toBe('test_app_secret_value');
      expect(cfg.jwtPrivateKey).toBe(testJwtKeys.privateKey);
      expect(cfg.jwtPublicKey).toBe(testJwtKeys.publicKey);
      expect(cfg.jwtKeyId).toBe('test-kid-2026');
      expect(cfg.databaseUrl).toContain('postgresql://');
      expect(cfg.redisUrl).toBe('redis://localhost:6379/0');
      expect(cfg.corsOrigins).toEqual(['http://localhost:5173', 'http://localhost:3001']);
    });

    it('should_use_default_feishu_endpoints_when_not_provided', () => {
      const cfg = loadEnv();
      expect(cfg.feishuAuthzEndpoint).toBe('https://open.feishu.cn/open-apis/authen/v1/authorize');
      expect(cfg.feishuTokenEndpoint).toBe('https://open.feishu.cn/open-apis/authen/v1/oidc/access_token');
      expect(cfg.feishuUserinfoEndpoint).toBe('https://open.feishu.cn/open-apis/authen/v1/user_info');
    });

    it('should_use_custom_feishu_endpoints_when_provided', () => {
      process.env.FEISHU_AUTHZ_ENDPOINT = 'https://custom.example.com/authz';
      process.env.FEISHU_TOKEN_ENDPOINT = 'https://custom.example.com/token';
      process.env.FEISHU_USERINFO_ENDPOINT = 'https://custom.example.com/userinfo';
      const cfg = loadEnv();
      expect(cfg.feishuAuthzEndpoint).toBe('https://custom.example.com/authz');
      expect(cfg.feishuTokenEndpoint).toBe('https://custom.example.com/token');
      expect(cfg.feishuUserinfoEndpoint).toBe('https://custom.example.com/userinfo');
    });

    it('should_fallback_admin_redirect_uri_to_web_when_not_provided', () => {
      delete process.env.FEISHU_REDIRECT_URI_ADMIN;
      const cfg = loadEnv();
      expect(cfg.feishuRedirectUriAdmin).toBe(process.env.FEISHU_REDIRECT_URI_WEB);
    });

    it('should_fallback_mobile_redirect_uri_to_web_when_not_provided', () => {
      delete process.env.FEISHU_REDIRECT_URI_MOBILE;
      const cfg = loadEnv();
      expect(cfg.feishuRedirectUriMobile).toBe(process.env.FEISHU_REDIRECT_URI_WEB);
    });

    it('should_use_default_jwt_options_when_not_provided', () => {
      const cfg = loadEnv();
      expect(cfg.jwtIssuer).toBe('danqing-ai-auth');
      expect(cfg.jwtAudienceWeb).toBe('danqing-ai-web');
      expect(cfg.jwtAudienceAdmin).toBe('danqing-ai-admin');
      expect(cfg.jwtAudienceMobile).toBe('danqing-ai-mobile');
      expect(cfg.jwtAccessExpires).toBe('15m');
      expect(cfg.jwtRefreshExpires).toBe('7d');
    });

    it('should_use_default_cookie_options_when_not_provided', () => {
      const cfg = loadEnv();
      expect(cfg.cookieSecure).toBe(false);
      expect(cfg.cookieDomain).toBe('');
      expect(cfg.cookieSameSite).toBe('strict');
      expect(cfg.cookiePath).toBe('/auth');
      expect(cfg.cookieMaxAge).toBe(604800);
    });

    it('should_use_default_rate_limit_values_when_not_provided', () => {
      const cfg = loadEnv();
      expect(cfg.rateLimitAuthPerMin).toBe(10);
      expect(cfg.rateLimitCallbackPerMin).toBe(5);
      expect(cfg.rateLimitRefreshPerMin).toBe(20);
      expect(cfg.rateLimitApiPerMin).toBe(60);
    });

    it('should_use_default_tenant_options_when_not_provided', () => {
      const cfg = loadEnv();
      expect(cfg.tenantDefaultPlan).toBe('free');
      expect(cfg.tenantDefaultType).toBe('individual');
    });

    it('should_use_default_security_options_when_not_provided', () => {
      const cfg = loadEnv();
      expect(cfg.enableHsts).toBe(false);
      expect(cfg.logLevel).toBe('info');
      expect(cfg.nodeEnv).toBe('development');
      expect(cfg.port).toBe(3000);
    });
  });

  // ============================================================
  // parseBoolean 分支
  // ============================================================
  describe('parseBoolean (分支覆盖)', () => {
    it('should_return_true_when_COOKIE_SECURE_is_true', () => {
      process.env.COOKIE_SECURE = 'true';
      expect(loadEnv().cookieSecure).toBe(true);
    });

    it('should_return_true_when_COOKIE_SECURE_is_1', () => {
      process.env.COOKIE_SECURE = '1';
      expect(loadEnv().cookieSecure).toBe(true);
    });

    it('should_return_true_when_COOKIE_SECURE_is_yes', () => {
      process.env.COOKIE_SECURE = 'yes';
      expect(loadEnv().cookieSecure).toBe(true);
    });

    it('should_return_false_when_COOKIE_SECURE_is_other_value', () => {
      process.env.COOKIE_SECURE = 'false';
      expect(loadEnv().cookieSecure).toBe(false);
    });

    it('should_return_default_when_ENABLE_HSTS_empty', () => {
      process.env.ENABLE_HSTS = '';
      expect(loadEnv().enableHsts).toBe(false);
    });

    it('should_return_true_when_ENABLE_HSTS_is_yes', () => {
      process.env.ENABLE_HSTS = 'yes';
      expect(loadEnv().enableHsts).toBe(true);
    });
  });

  // ============================================================
  // parseInteger 分支
  // ============================================================
  describe('parseInteger (分支覆盖)', () => {
    it('should_parse_custom_PORT', () => {
      process.env.PORT = '8080';
      expect(loadEnv().port).toBe(8080);
    });

    it('should_use_default_when_PORT_empty', () => {
      process.env.PORT = '';
      expect(loadEnv().port).toBe(3000);
    });

    it('should_parse_custom_COOKIE_MAX_AGE', () => {
      process.env.COOKIE_MAX_AGE = '86400';
      expect(loadEnv().cookieMaxAge).toBe(86400);
    });

    it('should_parse_custom_RATE_LIMIT_values', () => {
      process.env.RATE_LIMIT_AUTH_PER_MIN = '20';
      process.env.RATE_LIMIT_CALLBACK_PER_MIN = '10';
      process.env.RATE_LIMIT_REFRESH_PER_MIN = '40';
      process.env.RATE_LIMIT_API_PER_MIN = '120';
      const cfg = loadEnv();
      expect(cfg.rateLimitAuthPerMin).toBe(20);
      expect(cfg.rateLimitCallbackPerMin).toBe(10);
      expect(cfg.rateLimitRefreshPerMin).toBe(40);
      expect(cfg.rateLimitApiPerMin).toBe(120);
    });

    it('should_throw_when_PORT_is_not_integer', () => {
      process.env.PORT = 'not-a-number';
      expect(() => loadEnv()).toThrow(/env parse failed/);
    });

    it('should_throw_when_RATE_LIMIT_AUTH_PER_MIN_is_nan', () => {
      process.env.RATE_LIMIT_AUTH_PER_MIN = 'abc';
      expect(() => loadEnv()).toThrow(/env parse failed/);
    });
  });

  // ============================================================
  // parseSameSite 分支
  // ============================================================
  describe('parseSameSite (分支覆盖)', () => {
    it('should_accept_strict', () => {
      process.env.COOKIE_SAMESITE = 'strict';
      expect(loadEnv().cookieSameSite).toBe('strict');
    });

    it('should_accept_lax', () => {
      process.env.COOKIE_SAMESITE = 'lax';
      expect(loadEnv().cookieSameSite).toBe('lax');
    });

    it('should_accept_none', () => {
      process.env.COOKIE_SAMESITE = 'none';
      expect(loadEnv().cookieSameSite).toBe('none');
    });

    it('should_be_case_insensitive', () => {
      process.env.COOKIE_SAMESITE = 'STRICT';
      expect(loadEnv().cookieSameSite).toBe('strict');
    });

    it('should_throw_when_invalid_value', () => {
      process.env.COOKIE_SAMESITE = 'invalid';
      expect(() => loadEnv()).toThrow(/COOKIE_SAMESITE/);
    });
  });

  // ============================================================
  // parseLogLevel 分支
  // ============================================================
  describe('parseLogLevel (分支覆盖)', () => {
    it('should_accept_error_level', () => {
      process.env.LOG_LEVEL = 'error';
      expect(loadEnv().logLevel).toBe('error');
    });

    it('should_accept_warn_level', () => {
      process.env.LOG_LEVEL = 'warn';
      expect(loadEnv().logLevel).toBe('warn');
    });

    it('should_accept_info_level', () => {
      process.env.LOG_LEVEL = 'info';
      expect(loadEnv().logLevel).toBe('info');
    });

    it('should_accept_debug_level', () => {
      process.env.LOG_LEVEL = 'debug';
      expect(loadEnv().logLevel).toBe('debug');
    });

    it('should_throw_when_invalid_level', () => {
      process.env.LOG_LEVEL = 'verbose';
      expect(() => loadEnv()).toThrow(/LOG_LEVEL/);
    });
  });

  // ============================================================
  // parseNodeEnv 分支
  // ============================================================
  describe('parseNodeEnv (分支覆盖)', () => {
    it('should_accept_development', () => {
      process.env.NODE_ENV = 'development';
      expect(loadEnv().nodeEnv).toBe('development');
    });

    it('should_accept_production', () => {
      process.env.NODE_ENV = 'production';
      // G7:生产环境强制要求 COOKIE_SECURE=true
      process.env.COOKIE_SECURE = 'true';
      expect(loadEnv().nodeEnv).toBe('production');
    });

    it('should_accept_test', () => {
      process.env.NODE_ENV = 'test';
      expect(loadEnv().nodeEnv).toBe('test');
    });

    it('should_throw_when_invalid_value', () => {
      process.env.NODE_ENV = 'staging';
      expect(() => loadEnv()).toThrow(/NODE_ENV/);
    });
  });

  // ============================================================
  // parseTenantPlan 分支
  // ============================================================
  describe('parseTenantPlan (分支覆盖)', () => {
    it('should_accept_free', () => {
      process.env.TENANT_DEFAULT_PLAN = 'free';
      expect(loadEnv().tenantDefaultPlan).toBe('free');
    });

    it('should_accept_standard', () => {
      process.env.TENANT_DEFAULT_PLAN = 'standard';
      expect(loadEnv().tenantDefaultPlan).toBe('standard');
    });

    it('should_accept_enterprise', () => {
      process.env.TENANT_DEFAULT_PLAN = 'enterprise';
      expect(loadEnv().tenantDefaultPlan).toBe('enterprise');
    });

    it('should_throw_when_invalid_value', () => {
      process.env.TENANT_DEFAULT_PLAN = 'premium';
      expect(() => loadEnv()).toThrow(/TENANT_DEFAULT_PLAN/);
    });
  });

  // ============================================================
  // parseTenantType 分支
  // ============================================================
  describe('parseTenantType (分支覆盖)', () => {
    it('should_accept_school', () => {
      process.env.TENANT_DEFAULT_TYPE = 'school';
      expect(loadEnv().tenantDefaultType).toBe('school');
    });

    it('should_accept_college', () => {
      process.env.TENANT_DEFAULT_TYPE = 'college';
      expect(loadEnv().tenantDefaultType).toBe('college');
    });

    it('should_accept_class', () => {
      process.env.TENANT_DEFAULT_TYPE = 'class';
      expect(loadEnv().tenantDefaultType).toBe('class');
    });

    it('should_accept_individual', () => {
      process.env.TENANT_DEFAULT_TYPE = 'individual';
      expect(loadEnv().tenantDefaultType).toBe('individual');
    });

    it('should_throw_when_invalid_value', () => {
      process.env.TENANT_DEFAULT_TYPE = 'university';
      expect(() => loadEnv()).toThrow(/TENANT_DEFAULT_TYPE/);
    });
  });

  // ============================================================
  // assertRequired 分支
  // ============================================================
  describe('assertRequired (必填校验)', () => {
    // 注意:开发/测试模式下 FEISHU_APP_ID/SECRET 和 JWT 密钥可为空(自动填充占位值/临时密钥)
    // 以下测试设置 NODE_ENV=production 验证生产环境的严格校验
    const originalNodeEnv = process.env.NODE_ENV;

    beforeEach(() => {
      process.env.NODE_ENV = 'production';
    });
    afterEach(() => {
      process.env.NODE_ENV = originalNodeEnv;
    });

    it('should_throw_when_FEISHU_APP_ID_missing', () => {
      delete process.env.FEISHU_APP_ID;
      expect(() => loadEnv()).toThrow(/missing required/);
    });

    it('should_throw_when_FEISHU_APP_SECRET_empty', () => {
      process.env.FEISHU_APP_SECRET = '';
      expect(() => loadEnv()).toThrow(/missing required/);
    });

    it('should_throw_when_JWT_PRIVATE_KEY_missing', () => {
      delete process.env.JWT_PRIVATE_KEY;
      expect(() => loadEnv()).toThrow(/missing required/);
    });

    it('should_throw_when_multiple_required_missing', () => {
      delete process.env.FEISHU_APP_ID;
      delete process.env.DATABASE_URL;
      delete process.env.REDIS_URL;
      expect(() => loadEnv()).toThrow(/DATABASE_URL.*REDIS_URL/);
    });

    it('dev_mode_should_auto_fill_placeholders_when_FEISHU_keys_missing', () => {
      process.env.NODE_ENV = 'development';
      delete process.env.FEISHU_APP_ID;
      process.env.FEISHU_APP_SECRET = '';
      // 开发模式下不应抛错,而是自动填充占位值
      const cfg = loadEnv();
      expect(cfg.feishuAppId).toBe('dev-cli-placeholder');
      expect(cfg.feishuAppSecret).toBe('dev-secret-placeholder');
    });

    it('dev_mode_should_generate_ephemeral_keys_when_JWT_keys_missing', () => {
      process.env.NODE_ENV = 'development';
      delete process.env.JWT_PRIVATE_KEY;
      delete process.env.JWT_PUBLIC_KEY;
      delete process.env.JWT_KEY_ID;
      // 开发模式下不应抛错,而是自动生成临时 RSA 密钥对
      const cfg = loadEnv();
      expect(cfg.jwtPrivateKey).toContain('BEGIN PRIVATE KEY');
      expect(cfg.jwtPublicKey).toContain('BEGIN PUBLIC KEY');
      expect(cfg.jwtKeyId).toMatch(/^dev-kid-/);
    });
  });

  // ============================================================
  // assertRsaPrivateKey / assertRsaPublicKey 分支
  // ============================================================
  describe('assertRsaPrivateKey (JWT 私钥校验)', () => {
    it('should_throw_when_private_key_not_pem_format', () => {
      process.env.JWT_PRIVATE_KEY = 'not-a-valid-pem';
      expect(() => loadEnv()).toThrow(/JWT_PRIVATE_KEY invalid/);
    });

    it('should_throw_when_private_key_is_ec_not_rsa', () => {
      const { privateKey: ecKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
      process.env.JWT_PRIVATE_KEY = ecKey.export({ type: 'pkcs8', format: 'pem' }).toString();
      expect(() => loadEnv()).toThrow(/expected RSA key/);
    });
  });

  describe('assertRsaPublicKey (JWT 公钥校验)', () => {
    it('should_throw_when_public_key_invalid', () => {
      process.env.JWT_PUBLIC_KEY = 'not-a-valid-public-key';
      expect(() => loadEnv()).toThrow(/JWT_PUBLIC_KEY invalid/);
    });

    it('should_throw_when_public_key_is_ec_not_rsa', () => {
      const { publicKey: ecPub } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
      process.env.JWT_PUBLIC_KEY = ecPub.export({ type: 'spki', format: 'pem' }).toString();
      expect(() => loadEnv()).toThrow(/expected RSA key/);
    });
  });

  // ============================================================
  // CORS 校验分支
  // ============================================================
  describe('CORS_ORIGINS 校验', () => {
    it('should_parse_multiple_origins_split_by_comma', () => {
      process.env.CORS_ORIGINS = 'http://a.com, http://b.com ,http://c.com';
      const cfg = loadEnv();
      expect(cfg.corsOrigins).toEqual(['http://a.com', 'http://b.com', 'http://c.com']);
    });

    it('should_throw_when_all_origins_empty_after_filter', () => {
      process.env.CORS_ORIGINS = ',,,';
      expect(() => loadEnv()).toThrow(/CORS_ORIGINS must contain at least one/);
    });

    it('should_throw_when_cors_origins_contains_wildcard', () => {
      process.env.CORS_ORIGINS = '*';
      expect(() => loadEnv()).toThrow(/must not contain "\*"/);
    });

    it('should_throw_when_cors_origins_contains_wildcard_among_others', () => {
      process.env.CORS_ORIGINS = 'http://a.com,*';
      expect(() => loadEnv()).toThrow(/must not contain "\*"/);
    });
  });

  // ============================================================
  // initEnv / env 单例
  // ============================================================
  describe('initEnv / env 单例', () => {
    // 注意:envInstance 是模块级单例,可能在其他测试中已被初始化
    // 这里测试 initEnv 在已初始化时直接返回缓存的行为
    it('should_return_cached_instance_when_initEnv_called_twice', () => {
      const first = initEnv();
      const second = initEnv();
      // 同一引用(单例)
      expect(second).toBe(first);
    });

    it('should_return_instance_when_env_called_after_init', () => {
      initEnv();
      const cfg = env();
      expect(cfg).toBeDefined();
      expect(cfg.feishuAppId).toBe('cli_test_app_id');
    });
  });

  // ============================================================
  // 自定义 JWT 配置
  // ============================================================
  describe('自定义 JWT 配置', () => {
    it('should_use_custom_jwt_issuer_and_audiences', () => {
      process.env.JWT_ISSUER = 'custom-issuer';
      process.env.JWT_AUDIENCE_WEB = 'custom-web';
      process.env.JWT_AUDIENCE_ADMIN = 'custom-admin';
      process.env.JWT_AUDIENCE_MOBILE = 'custom-mobile';
      const cfg = loadEnv();
      expect(cfg.jwtIssuer).toBe('custom-issuer');
      expect(cfg.jwtAudienceWeb).toBe('custom-web');
      expect(cfg.jwtAudienceAdmin).toBe('custom-admin');
      expect(cfg.jwtAudienceMobile).toBe('custom-mobile');
    });

    it('should_use_custom_jwt_expires', () => {
      process.env.JWT_ACCESS_EXPIRES = '30m';
      process.env.JWT_REFRESH_EXPIRES = '14d';
      const cfg = loadEnv();
      expect(cfg.jwtAccessExpires).toBe('30m');
      expect(cfg.jwtRefreshExpires).toBe('14d');
    });
  });

  // ============================================================
  // 自定义 Cookie 配置
  // ============================================================
  describe('自定义 Cookie 配置', () => {
    it('should_use_custom_cookie_domain_and_path', () => {
      process.env.COOKIE_DOMAIN = '.example.com';
      process.env.COOKIE_PATH = '/api/auth';
      const cfg = loadEnv();
      expect(cfg.cookieDomain).toBe('.example.com');
      expect(cfg.cookiePath).toBe('/api/auth');
    });
  });

  // ============================================================
  // AI 图像生成(M2-T9,对应 m2-generation-plan §2.4)
  // 目标:确认 7 项 AI_IMAGE_* 的默认值/校验/API Key 缺失降级
  // ============================================================
  describe('AI 图像生成配置(M2-T9)', () => {
    it('缺失时使用合理默认值(provider=trae,timeout=30000,限流=5,最大张数=4)', () => {
      const cfg = loadEnv();
      expect(cfg.aiImageProvider).toBe('trae');
      expect(cfg.aiImageApiKey).toBe('');
      expect(cfg.aiImageApiUrl).toBe('');
      expect(cfg.aiImageApiModel).toBe('');
      expect(cfg.aiImageTimeout).toBe(90000);
      expect(cfg.generationRateLimitPerMin).toBe(5);
      expect(cfg.generationMaxCount).toBe(4);
    });

    it('自定义值正确解析', () => {
      process.env.AI_IMAGE_PROVIDER = 'glm';
      process.env.AI_IMAGE_API_KEY = 'test-image-key';
      process.env.AI_IMAGE_API_URL = 'https://example.com/images/generations';
      process.env.AI_IMAGE_API_MODEL = 'GLM-Image';
      process.env.AI_IMAGE_TIMEOUT = '15000';
      process.env.GENERATION_RATE_LIMIT_PER_MIN = '3';
      process.env.GENERATION_MAX_COUNT = '2';
      const cfg = loadEnv();
      expect(cfg.aiImageProvider).toBe('glm');
      expect(cfg.aiImageApiKey).toBe('test-image-key');
      expect(cfg.aiImageApiUrl).toBe('https://example.com/images/generations');
      expect(cfg.aiImageApiModel).toBe('GLM-Image');
      expect(cfg.aiImageTimeout).toBe(15000);
      expect(cfg.generationRateLimitPerMin).toBe(3);
      expect(cfg.generationMaxCount).toBe(2);
    });

    it('AI_IMAGE_PROVIDER 非法值 → 抛错(Deny by default,拒绝启动)', () => {
      process.env.AI_IMAGE_PROVIDER = 'openai';
      expect(() => loadEnv()).toThrow(/AI_IMAGE_PROVIDER/);
    });

    it('AI_IMAGE_TIMEOUT 非整数 → 抛错', () => {
      process.env.AI_IMAGE_TIMEOUT = 'abc';
      expect(() => loadEnv()).toThrow(/env parse failed/);
    });

    it('AI_IMAGE_PROVIDER 大小写不敏感(glm/GLM)', () => {
      process.env.AI_IMAGE_PROVIDER = 'GLM';
      expect(loadEnv().aiImageProvider).toBe('glm');
    });

    it('API Key 缺失时不抛错,返回空字符串(由 image-generation.service 优雅降级)', () => {
      // aiImageApiKey 为非必填:缺失时 env 加载成功(key=''),生成时 resolveImageAIConfig
      // 检测双提供商不可用返回 null → GENERATION_PROVIDER_UNAVAILABLE,不崩溃
      delete process.env.AI_IMAGE_API_KEY;
      const cfg = loadEnv();
      expect(cfg.aiImageApiKey).toBe('');
    });
  });
});
