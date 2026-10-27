// ============================================================
// 环境变量加载与启动自检
// 对应文档:auth-design.md §4 + §4.7
// 任何缺失/非法的 env 一律抛错拒绝启动(Deny by default)
// ============================================================

import crypto from 'node:crypto';

/**
 * 环境变量类型(只读)
 * 所有字段在启动时已校验非空(必填字段),代码中可安全使用
 */
export interface EnvConfig {
  // 飞书
  feishuAppId: string;
  feishuAppSecret: string;
  feishuRedirectUriWeb: string;
  feishuRedirectUriAdmin: string;
  feishuRedirectUriMobile: string;
  feishuAuthzEndpoint: string;
  feishuTokenEndpoint: string;
  feishuUserinfoEndpoint: string;

  // JWT
  jwtPrivateKey: string;
  jwtPublicKey: string;
  jwtKeyId: string;
  jwtIssuer: string;
  jwtAudienceWeb: string;
  jwtAudienceAdmin: string;
  jwtAudienceMobile: string;
  jwtAccessExpires: string; // 形如 "15m"
  jwtRefreshExpires: string; // 形如 "7d"

  // Cookie
  cookieSecure: boolean;
  cookieDomain: string;
  cookieSameSite: 'strict' | 'lax' | 'none';
  cookiePath: string;
  cookieMaxAge: number; // 秒

  // 基础设施
  databaseUrl: string;
  redisUrl: string;

  // CORS
  corsOrigins: string[];

  // 限流
  rateLimitAuthPerMin: number;
  rateLimitCallbackPerMin: number;
  rateLimitRefreshPerMin: number;
  rateLimitApiPerMin: number;
  /** 问题分析(ask-question)每用户每分钟上限(默认 10,防 AI 成本滥用) */
  rateLimitAskQuestionPerMin: number;

  // Redis 监控(对应 redis-brpop-fix-2026-08-07.md §7)
  rateLimitRedisTimeoutMs: number; // rate-limit Redis 操作硬超时(默认 200ms)
  redisMetricsLogIntervalMs: number; // Redis 指标日志输出间隔(默认 30000ms)

  // 租户
  tenantDefaultPlan: 'free' | 'standard' | 'enterprise';
  tenantDefaultType: 'school' | 'college' | 'class' | 'individual';

  // 安全
  enableHsts: boolean;
  logLevel: 'error' | 'warn' | 'info' | 'debug';
  nodeEnv: 'development' | 'production' | 'test';
  port: number;

  // 文件上传(multer 磁盘存储)
  uploadDir: string;
  uploadMaxSize: number;

  // AI 视觉分析(Phase 2 追加,全部可选带默认值,保证向后兼容)
  /** AI 功能总开关(默认 false,生产环境手动开启) */
  aiEnabled: boolean;
  /** AI 服务提供商选择(glm=智谱GLM / trae=TRAE,默认 glm,向后兼容) */
  aiProvider: 'glm' | 'trae';
  /** 智谱 API Key(留空时 AI_ENABLED=true 也会自动 fallback) */
  aiApiKey: string;
  /** 智谱 GLM-4V API 端点(OpenAI 兼容格式) */
  aiApiUrl: string;
  /** AI 请求超时(毫秒,硬性 2500ms 保障 3 秒 SLA) */
  aiApiTimeout: number;
  /** AI 模型名(glm-4v-flash 免费 / glm-4v-plus 付费高精度),取 aiApiModels 第一个 */
  aiApiModel: string;
  /** AI 模型候选列表(逗号分隔,支持额度耗尽自动切换,默认 [glm-4v-flash]) */
  aiApiModels: string[];
  /** AI 视觉分析最大输出 token 数(默认 2048;AI 深度分析输出含视觉描述+5条带证据建议+examResult,
   *  1024 会被截断导致 JSON 解析失败(AI_PARSE_ERROR),故默认提到 2048,可设 4096) */
  aiApiMaxTokens: number;
  /** 问题分析(阶段3 ask-question)专用超时(毫秒,默认 60000;不受 3s SLA 约束,与 aiApiTimeout 解耦) */
  aiQaTimeout: number;
  /** AI 深度分析(阶段2 ai-enhance)专用超时(毫秒,默认 15000;
   *  不受 3s SLA 约束。深度分析 Prompt 更长、输出更多字段,
   *  沿用 2.5s 会 100% 超时导致"总是失败"。) */
  aiEnhanceTimeout: number;
  /** 风格分析(M-4 style 模式两步法 Step1)专用超时(毫秒,默认 20000;
   *  在生成 Worker 内执行,不受诊断 3s SLA 约束,与 aiApiTimeout/aiEnhanceTimeout 解耦。
   *  对应 m4-style-transfer-plan §2.8,环境变量 AI_STYLE_TIMEOUT) */
  aiStyleTimeout: number;

  // TRAE AI 服务配置(Phase B1 追加,均可选带默认值,留空时服务层自动降级到 GLM)
  /** TRAE API Key(留空且 aiProvider='trae' 时自动降级到 GLM) */
  traeApiKey: string;
  /** TRAE API 端点(OpenAI 兼容格式,预留) */
  traeApiUrl: string;
  /** TRAE 模型名 */
  traeApiModel: string;

  // AI 图像生成(M-2 追加,独立于诊断链路,对应 m2-generation-plan §2.4)
  /** 图像生成主提供商标识(trae=主 / glm=备,默认 trae) */
  aiImageProvider: 'trae' | 'glm';
  /** 图像生成 API Key(主提供商;TRAE 图像配置缺失时降级复用诊断 GLM 凭据) */
  aiImageApiKey: string;
  /** 图像生成端点 URL(OpenAI 兼容格式) */
  aiImageApiUrl: string;
  /** 图像生成模型名 */
  aiImageApiModel: string;
  /** 图像生成请求超时(毫秒,默认 90000,独立于诊断 2500) */
  aiImageTimeout: number;
  /** 生成接口单用户分钟限流(次/分钟,默认 5) */
  generationRateLimitPerMin: number;
  /** 单任务最大生成张数(默认 4,对应契约 count 上限) */
  generationMaxCount: number;
  /** 生成任务 stalled 判定阈值(毫秒,默认 300000 = 风格分析 20s + 生图 90s + 缓冲;
   *  Worker 中断后任务卡 processing 超过该阈值,由恢复扫描标记 failed
   *  WORKER_INTERRUPTED(不自动重新入队)。对应 m4-style-transfer-plan §2.6 决策 D-4
   *  (v1.1.0 修订 R2)/§2.8,环境变量 GENERATION_STALLED_TIMEOUT_MS) */
  generationStalledTimeoutMs: number;

  // 开发模式(Phase 2 追加)
  /** 开发模式跳过认证(true 时 auth 中间件注入 dev 用户,仅 NODE_ENV=development 生效) */
  devSkipAuth: boolean;

  // Phase 5 短信网关(手机 OTP)
  /** 短信服务商:mock(默认,日志输出)/ aliyun / tencent */
  smsProvider: 'mock' | 'aliyun' | 'tencent';
  /** 手机号正则校验(默认中国大陆 /^1[3-9]\d{9}$/) */
  phoneRegex: string;

  // 任务包 C:部署日志同步
  /** 部署同步共享密钥(部署脚本通过 X-Deploy-Secret 上报;空则禁用部署日志接收端点) */
  deploySyncSecret: string;

  // 监控告警
  /** 邮件告警总开关 */
  alertEnabled: boolean;
  /** 告警 SMTP 服务器 */
  alertSmtpHost: string;
  /** 告警 SMTP 端口 */
  alertSmtpPort: number;
  /** 是否使用 TLS(465 端口通常为 true) */
  alertSmtpSecure: boolean;
  /** 告警发件账号 */
  alertSmtpUser: string;
  /** 告警 SMTP 授权码 */
  alertSmtpPass: string;
  /** 告警收件人 */
  alertTo: string;
  /** 告警发件人 */
  alertFrom: string;
  /** 邮件发送最大重试次数 */
  alertMaxRetries: number;
  /** 同一组件同级别告警最小间隔(毫秒),防止邮件轰炸 */
  alertMinIntervalMs: number;

  // M3 可观测性(M3-T3 env 阈值变量;全部带默认值,缺失不报错,向后兼容)
  /** 指标 Redis 缓存 TTL(秒,默认 300) */
  metricsCacheTtlSeconds: number;
  /** SLA 达标阈值(毫秒,默认 3000,硬约束 3 秒) */
  metricsSlaThresholdMs: number;
  /** AI 降级率告警阈值(0-1,默认 0.1) */
  alertAiFallbackRateThreshold: number;
  /** SLA 达标率告警阈值(0-1,低于此值告警,默认 0.99) */
  alertSlaComplianceRateThreshold: number;
  /** 告警静默窗口(分钟,默认 30,防重复告警) */
  alertSilenceMinutes: number;
  /** 飞书告警 webhook URL(留空则仅写 alerts.log) */
  alertFeishuWebhookUrl: string;
  /** 飞书 webhook 签名密钥(可选) */
  alertFeishuSecret: string;
}

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value === '') return defaultValue;
  return value === 'true' || value === '1' || value === 'yes';
}

function parseInteger(value: string | undefined, defaultValue: number): number {
  if (value === undefined || value === '') return defaultValue;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`env parse failed: expected integer, got "${value}"`);
  }
  return parsed;
}

function parseFloat(value: string | undefined, defaultValue: number): number {
  if (value === undefined || value === '') return defaultValue;
  const parsed = Number.parseFloat(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`env parse failed: expected float, got "${value}"`);
  }
  return parsed;
}

function parseSameSite(value: string | undefined): 'strict' | 'lax' | 'none' {
  const v = (value ?? 'strict').toLowerCase();
  if (v !== 'strict' && v !== 'lax' && v !== 'none') {
    throw new Error(`COOKIE_SAMESITE must be one of strict|lax|none, got "${value}"`);
  }
  return v;
}

function parseLogLevel(value: string | undefined): 'error' | 'warn' | 'info' | 'debug' {
  const v = (value ?? 'info').toLowerCase();
  if (v !== 'error' && v !== 'warn' && v !== 'info' && v !== 'debug') {
    throw new Error(`LOG_LEVEL must be one of error|warn|info|debug, got "${value}"`);
  }
  return v as 'error' | 'warn' | 'info' | 'debug';
}

function parseNodeEnv(value: string | undefined): 'development' | 'production' | 'test' {
  const v = (value ?? 'development').toLowerCase();
  if (v !== 'development' && v !== 'production' && v !== 'test') {
    throw new Error(`NODE_ENV must be one of development|production|test, got "${value}"`);
  }
  return v as 'development' | 'production' | 'test';
}

function parseTenantPlan(value: string | undefined): 'free' | 'standard' | 'enterprise' {
  const v = (value ?? 'free').toLowerCase();
  if (v !== 'free' && v !== 'standard' && v !== 'enterprise') {
    throw new Error(`TENANT_DEFAULT_PLAN must be one of free|standard|enterprise, got "${value}"`);
  }
  return v;
}

function parseTenantType(value: string | undefined): 'school' | 'college' | 'class' | 'individual' {
  const v = (value ?? 'individual').toLowerCase();
  if (v !== 'school' && v !== 'college' && v !== 'class' && v !== 'individual') {
    throw new Error(`TENANT_DEFAULT_TYPE must be one of school|college|class|individual, got "${value}"`);
  }
  return v;
}

function parseAiProvider(value: string | undefined): 'glm' | 'trae' {
  const v = (value ?? 'glm').toLowerCase();
  if (v !== 'glm' && v !== 'trae') {
    throw new Error(`AI_PROVIDER must be one of glm|trae, got "${value}"`);
  }
  return v;
}

/**
 * 解析 AI 视觉分析模型候选列表(逗号分隔,自动去重去空)
 * 用于额度耗尽/限流时在同一 provider 内自动切换模型
 */
function parseAiApiModels(value: string | undefined): string[] {
  const raw = value ?? 'glm-4v-flash';
  const models = raw
    .split(',')
    .map((m) => m.trim())
    .filter((m) => m.length > 0);
  // 去重,保留顺序
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const m of models) {
    if (!seen.has(m)) {
      seen.add(m);
      unique.push(m);
    }
  }
  if (unique.length === 0) {
    throw new Error('AI_API_MODEL must contain at least one non-empty model name');
  }
  return unique;
}

/**
 * 解析图像生成主提供商(默认 trae)
 * 与诊断 AI_PROVIDER 解耦,图像生成主提供商独立配置
 */
function parseAiImageProvider(value: string | undefined): 'trae' | 'glm' {
  const v = (value ?? 'trae').toLowerCase();
  if (v !== 'trae' && v !== 'glm') {
    throw new Error(`AI_IMAGE_PROVIDER must be one of trae|glm, got "${value}"`);
  }
  return v;
}

/**
 * 校验必填环境变量非空
 * @throws Error 缺失必填项时抛错(启动自检失败)
 */
function assertRequired(record: Record<string, string | undefined>, keys: readonly string[]): void {
  const missing: string[] = [];
  for (const k of keys) {
    const v = record[k];
    if (v === undefined || v === '') {
      missing.push(k);
    }
  }
  if (missing.length > 0) {
    throw new Error(`[env] missing required environment variables: ${missing.join(', ')}`);
  }
}

/**
 * 校验 JWT 私钥为 RSA 类型(对应 auth-design.md §4.7)
 * @throws Error 私钥不可解析或非 RSA 类型时抛错
 */
function assertRsaPrivateKey(pem: string): void {
  try {
    const keyObj = crypto.createPrivateKey(pem);
    if (keyObj.asymmetricKeyType !== 'rsa') {
      throw new Error(`expected RSA key, got "${keyObj.asymmetricKeyType}"`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`[env] JWT_PRIVATE_KEY invalid: ${msg}`);
  }
}

/**
 * 校验 JWT 公钥为 RSA 类型
 */
function assertRsaPublicKey(pem: string): void {
  try {
    const keyObj = crypto.createPublicKey(pem);
    if (keyObj.asymmetricKeyType !== 'rsa') {
      throw new Error(`expected RSA key, got "${keyObj.asymmetricKeyType}"`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`[env] JWT_PUBLIC_KEY invalid: ${msg}`);
  }
}

/**
 * 加载并校验环境变量,返回强类型配置对象
 * 在 src/index.ts 启动入口调用,任何错误都会让进程退出
 *
 * 开发模式特殊处理:
 *   - NODE_ENV=development 时,FEISHU_APP_ID/FEISHU_APP_SECRET 可为空,
 *     自动填充占位值(OAuth 端点调用会失败,但服务器可启动)
 *   - DEV_SKIP_AUTH=true 且 NODE_ENV=development 时,auth 中间件跳过 JWT 校验,
 *     注入开发测试用户,方便前端 skipLogin 模式联调
 */
export function loadEnv(): EnvConfig {
  const env = process.env;
  const nodeEnv = parseNodeEnv(env.NODE_ENV);
  const isDev = nodeEnv === 'development';
  const isTest = nodeEnv === 'test';
  const devSkipAuth = isDev && parseBoolean(env.DEV_SKIP_AUTH, false);

  // 必填项校验(对应 auth-design.md §4.7 自检清单)
  // 开发/测试模式下 JWT 密钥和飞书密钥可为空,后续自动填充占位值/临时密钥
  // 生产环境必须全部存在,assertRequired 会抛错拒绝启动
  const baseRequired = ['FEISHU_REDIRECT_URI_WEB', 'DATABASE_URL', 'REDIS_URL', 'CORS_ORIGINS'] as const;
  const prodRequired = ['FEISHU_APP_ID', 'FEISHU_APP_SECRET', 'JWT_PRIVATE_KEY', 'JWT_PUBLIC_KEY', 'JWT_KEY_ID'] as const;
  const requiredKeys: readonly string[] = (isDev || isTest) ? baseRequired : [...baseRequired, ...prodRequired];
  assertRequired(env, requiredKeys);

  // 开发/测试模式:为空的飞书配置填充占位值(生产环境已由 assertRequired 保证非空)
  let feishuAppId: string = env.FEISHU_APP_ID || '';
  let feishuAppSecret: string = env.FEISHU_APP_SECRET || '';
  if (isDev || isTest) {
    if (!feishuAppId) feishuAppId = 'dev-cli-placeholder';
    if (!feishuAppSecret) feishuAppSecret = 'dev-secret-placeholder';
  }

  // JWT 密钥:开发/测试模式下若缺失则自动生成临时 RSA 密钥对
  let jwtPrivateKey: string = env.JWT_PRIVATE_KEY || '';
  let jwtPublicKey: string = env.JWT_PUBLIC_KEY || '';
  let jwtKeyId: string = env.JWT_KEY_ID || '';
  if ((isDev || isTest) && (!jwtPrivateKey || !jwtPublicKey)) {
    // 动态生成临时 RSA 密钥对(仅开发/测试使用,每次重启重新生成)
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    jwtPrivateKey = privateKey;
    jwtPublicKey = publicKey;
    if (!jwtKeyId) {
      jwtKeyId = 'dev-kid-' + Date.now().toString(36);
    }
    // eslint-disable-next-line no-console
    console.warn('[env] DEV MODE: JWT keys not provided, generated ephemeral RSA key pair');
  }
  // 生产环境:assertRequired 已保证 JWT 密钥存在,此处仅做类型兜底
  // 开发环境:已通过上面的 if 块自动生成,不会走到这里为空

  // 启动自检:私钥/公钥必须为 RSA 类型
  assertRsaPrivateKey(jwtPrivateKey);
  assertRsaPublicKey(jwtPublicKey);

  const corsRaw = env.CORS_ORIGINS as string;
  const corsOrigins = corsRaw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (corsOrigins.length === 0) {
    throw new Error('[env] CORS_ORIGINS must contain at least one origin');
  }
  if (corsOrigins.includes('*')) {
    throw new Error('[env] CORS_ORIGINS must not contain "*" (security constraint)');
  }

  // G7 安全修复:生产环境强制 COOKIE_SECURE=true
  // 防止配置遗漏导致 refresh_token Cookie 在 HTTP 下传输被中间人窃取
  // (refresh_token 是长效凭据,泄露后果严重;对应 auth-design.md §0 C2 安全原则)
  if (nodeEnv === 'production' && !parseBoolean(env.COOKIE_SECURE, false)) {
    throw new Error('[env] COOKIE_SECURE must be true in production');
  }

  return {
    feishuAppId,
    feishuAppSecret,
    feishuRedirectUriWeb: env.FEISHU_REDIRECT_URI_WEB!,
    feishuRedirectUriAdmin: env.FEISHU_REDIRECT_URI_ADMIN || env.FEISHU_REDIRECT_URI_WEB!,
    feishuRedirectUriMobile: env.FEISHU_REDIRECT_URI_MOBILE || env.FEISHU_REDIRECT_URI_WEB!,
    feishuAuthzEndpoint: env.FEISHU_AUTHZ_ENDPOINT || 'https://open.feishu.cn/open-apis/authen/v1/authorize',
    feishuTokenEndpoint: env.FEISHU_TOKEN_ENDPOINT || 'https://open.feishu.cn/open-apis/authen/v1/oidc/access_token',
    feishuUserinfoEndpoint: env.FEISHU_USERINFO_ENDPOINT || 'https://open.feishu.cn/open-apis/authen/v1/user_info',

    jwtPrivateKey,
    jwtPublicKey,
    jwtKeyId,
    jwtIssuer: env.JWT_ISSUER ?? 'danqing-ai-auth',
    jwtAudienceWeb: env.JWT_AUDIENCE_WEB ?? 'danqing-ai-web',
    jwtAudienceAdmin: env.JWT_AUDIENCE_ADMIN ?? 'danqing-ai-admin',
    jwtAudienceMobile: env.JWT_AUDIENCE_MOBILE ?? 'danqing-ai-mobile',
    jwtAccessExpires: env.JWT_ACCESS_EXPIRES ?? '15m',
    jwtRefreshExpires: env.JWT_REFRESH_EXPIRES ?? '7d',

    cookieSecure: parseBoolean(env.COOKIE_SECURE, false),
    cookieDomain: env.COOKIE_DOMAIN ?? '',
    cookieSameSite: parseSameSite(env.COOKIE_SAMESITE),
    cookiePath: env.COOKIE_PATH ?? '/auth',
    cookieMaxAge: parseInteger(env.COOKIE_MAX_AGE, 604800),

    databaseUrl: env.DATABASE_URL as string,
    redisUrl: env.REDIS_URL as string,

    corsOrigins,

    rateLimitAuthPerMin: parseInteger(env.RATE_LIMIT_AUTH_PER_MIN, 10),
    rateLimitCallbackPerMin: parseInteger(env.RATE_LIMIT_CALLBACK_PER_MIN, 5),
    rateLimitRefreshPerMin: parseInteger(env.RATE_LIMIT_REFRESH_PER_MIN, 20),
    rateLimitApiPerMin: parseInteger(env.RATE_LIMIT_API_PER_MIN, 60),
    rateLimitAskQuestionPerMin: parseInteger(env.RATE_LIMIT_ASK_QUESTION_PER_MIN, 10),

    // Redis 监控参数(可从环境变量配置,便于 Docker 部署固化)
    rateLimitRedisTimeoutMs: parseInteger(env.RATE_LIMIT_REDIS_TIMEOUT_MS, 200),
    redisMetricsLogIntervalMs: parseInteger(env.REDIS_METRICS_LOG_INTERVAL_MS, 30000),

    tenantDefaultPlan: parseTenantPlan(env.TENANT_DEFAULT_PLAN),
    tenantDefaultType: parseTenantType(env.TENANT_DEFAULT_TYPE),

    enableHsts: parseBoolean(env.ENABLE_HSTS, false),
    logLevel: parseLogLevel(env.LOG_LEVEL),
    nodeEnv,
    port: parseInteger(env.PORT, 3000),

    uploadDir: env.UPLOAD_DIR ?? 'uploads',
    uploadMaxSize: parseInteger(env.UPLOAD_MAX_SIZE, 10 * 1024 * 1024),

    // AI 视觉分析(Phase 2,全部带默认值,缺失不报错)
    aiEnabled: parseBoolean(env.AI_ENABLED, false),
    aiProvider: parseAiProvider(env.AI_PROVIDER),
    aiApiKey: env.AI_API_KEY ?? '',
    aiApiUrl: env.AI_API_URL ?? 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    aiApiTimeout: parseInteger(env.AI_API_TIMEOUT, 2500),
    aiApiModels: parseAiApiModels(env.AI_API_MODEL),
    get aiApiModel(): string {
      return this.aiApiModels[0]!;
    },
    aiApiMaxTokens: parseInteger(env.AI_API_MAX_TOKENS, 2048),
    aiQaTimeout: parseInteger(env.AI_QA_TIMEOUT, 60000),
    /** AI 深度分析(阶段2 ai-enhance)专用超时(毫秒,默认 15000;
     *  不受阶段1 3s SLA 约束,与 aiApiTimeout 解耦——
     *  深度分析是用户主动点击触发,且 Prompt 更长(4维度+scoreCriteria+issueMarkers
     *  +评价阶段+去同质化约束),GLM-4V 需要 8-15s 输出完整 JSON,
     *  若沿用 2.5s 会 100% 触发 AI_TIMEOUT 导致"深度分析总是失败"。) */
    aiEnhanceTimeout: parseInteger(env.AI_ENHANCE_TIMEOUT, 15000),
    /** 风格分析超时(M-4,默认 20000;生成 Worker 内执行,不受诊断 3s SLA 约束,
     *  对应 m4-style-transfer-plan §2.3/§2.8) */
    aiStyleTimeout: parseInteger(env.AI_STYLE_TIMEOUT, 20000),

    // TRAE AI 配置(Phase B1,均可选带默认值,留空时服务层自动降级到 GLM)
    traeApiKey: env.TRAE_API_KEY ?? '',
    traeApiUrl: env.TRAE_API_URL ?? '',
    traeApiModel: env.TRAE_API_MODEL ?? '',

    // AI 图像生成(M-2,独立配置,对应 §2.4;API Key 严禁硬编码)
    aiImageProvider: parseAiImageProvider(env.AI_IMAGE_PROVIDER),
    aiImageApiKey: env.AI_IMAGE_API_KEY ?? '',
    aiImageApiUrl: env.AI_IMAGE_API_URL ?? '',
    aiImageApiModel: env.AI_IMAGE_API_MODEL ?? '',
    aiImageTimeout: parseInteger(env.AI_IMAGE_TIMEOUT, 90000),
    generationRateLimitPerMin: parseInteger(env.GENERATION_RATE_LIMIT_PER_MIN, 5),
    generationMaxCount: parseInteger(env.GENERATION_MAX_COUNT, 4),
    // 生成任务 stalled 判定阈值(M-4 v1.1.0 修订 R2,默认 300000;
    // Worker 中断恢复扫描用,超时任务标记 failed WORKER_INTERRUPTED)
    generationStalledTimeoutMs: parseInteger(env.GENERATION_STALLED_TIMEOUT_MS, 300000),

    // 开发模式
    devSkipAuth,

    // Phase 5 短信网关
    smsProvider: parseSmsProvider(env.SMS_PROVIDER),
    phoneRegex: env.PHONE_REGEX ?? '^1[3-9]\\d{9}$',

    // 任务包 C:部署日志同步(空则禁用部署日志接收端点)
    deploySyncSecret: env.DEPLOY_SYNC_SECRET ?? '',

    // 监控告警
    alertEnabled: parseBoolean(env.ALERT_ENABLED, false),
    alertSmtpHost: env.ALERT_SMTP_HOST ?? 'smtp.qq.com',
    alertSmtpPort: parseInteger(env.ALERT_SMTP_PORT, 465),
    alertSmtpSecure: parseBoolean(env.ALERT_SMTP_SECURE, true),
    alertSmtpUser: env.ALERT_SMTP_USER ?? '2692963779@qq.com',
    alertSmtpPass: env.ALERT_SMTP_PASS ?? '',
    alertTo: env.ALERT_TO ?? '2692963779@qq.com',
    alertFrom: env.ALERT_FROM ?? '2692963779@qq.com',
    alertMaxRetries: parseInteger(env.ALERT_MAX_RETRIES, 3),
    alertMinIntervalMs: parseInteger(env.ALERT_MIN_INTERVAL_MS, 300000),

    // M3 可观测性(全部带默认值,缺失不报错,向后兼容;对应 m3-observability-plan §2.4)
    metricsCacheTtlSeconds: parseInteger(env.METRICS_CACHE_TTL_SECONDS, 300),
    metricsSlaThresholdMs: parseInteger(env.METRICS_SLA_THRESHOLD_MS, 3000),
    alertAiFallbackRateThreshold: parseFloat(env.ALERT_AI_FALLBACK_RATE_THRESHOLD, 0.1),
    alertSlaComplianceRateThreshold: parseFloat(env.ALERT_SLA_COMPLIANCE_RATE_THRESHOLD, 0.99),
    alertSilenceMinutes: parseInteger(env.ALERT_SILENCE_MINUTES, 30),
    alertFeishuWebhookUrl: env.ALERT_FEISHU_WEBHOOK_URL ?? '',
    alertFeishuSecret: env.ALERT_FEISHU_SECRET ?? '',
  };
}

/**
 * 解析短信服务商枚举(Phase 5)
 */
function parseSmsProvider(value: string | undefined): 'mock' | 'aliyun' | 'tencent' {
  const v = (value ?? 'mock').toLowerCase();
  if (v !== 'mock' && v !== 'aliyun' && v !== 'tencent') {
    throw new Error(`SMS_PROVIDER must be one of mock|aliyun|tencent, got "${value}"`);
  }
  return v;
}

/**
 * 全局单例 env,在 src/index.ts 启动时通过 initEnv() 初始化
 * 其余模块通过 import { env } from '../config/env.js' 读取
 */
let envInstance: EnvConfig | null = null;

export function initEnv(): EnvConfig {
  if (envInstance) {
    return envInstance;
  }
  envInstance = loadEnv();
  return envInstance;
}

/**
 * 获取 env 单例
 *
 * 设计演进(Gx 修复):
 *   - 显式 initEnv() 仍是首选(测试/生产入口均调用)
 *   - 自动初始化兜底:ESM 模块加载顺序可能导致某些路由文件在 initEnv() 前
 *     调用 env();此时自动执行 loadEnv() 避免启动崩溃
 *   - 不影响测试:setup.ts 已显式 initEnv(),自动初始化不会触发
 */
export function env(): EnvConfig {
  if (!envInstance) {
    envInstance = loadEnv();
  }
  return envInstance;
}
