// ============================================================
// AI 配置管理 Controller(AI 生产化阶段)
// 对应 API:/api/admin/system/ai-config(查看 / 测试)
//
// 职责:
//   1. 查看当前 AI 配置状态(provider/url/model/enabled/key 是否配置)
//   2. 测试 AI 连通性(发送最小化请求验证配置可用)
//   3. 不暴露完整 API Key(仅返回 masked 版本 + 是否已配置)
//   4. 不支持运行时修改配置(安全考虑,配置更新走 .env + PM2 restart)
//
// 设计原则:
//   - 当前 AI 代码本身已是 OpenAI 兼容格式,支持任意兼容端点
//     (GLM / TRAE / OpenAI / Azure OpenAI / 自部署 vLLM 等)
//   - 用户在服务器 .env 文件填入 AI_API_KEY/AI_API_URL/AI_API_MODEL 后重启 PM2 即可
//   - 本接口仅提供"可见性"与"可测试性",不提供"可写性"
//     (避免凭据经 HTTP 入库或日志泄露)
//
// 权限:admin:system:health(与 GET /system/health 共用,仅 ADMIN/OWNER)
// ============================================================

import type { RequestHandler } from 'express';
import { env } from '../config/env.js';
import { success, error } from '../utils/response.js';
import { ErrorCode } from '../types/api-contract.js';
import { isAIEnabled, analyzeWithAI } from '../services/ai-vision.service.js';
import {
  aiUsageRepository,
  estimateCostYuan,
  resolveEffectiveProvider,
} from '../repositories/ai-usage.repository.js';
import { logger } from '../utils/logger.js';

// ============================================================
// 工具:API Key 脱敏
// ============================================================

/**
 * 将 API Key 脱敏为 "前4位...后4位" 格式
 * 长度 < 8 位时返回 "已配置(隐藏)";空值返回 "未配置"
 *
 * 示例:
 *   "sk-abc1234567890xyz" → "sk-a...0xyz"
 *   "short"               → "已配置(隐藏)"
 *   ""                    → "未配置"
 */
function maskApiKey(key: string): string {
  if (!key || key.length === 0) return '未配置';
  if (key.length < 8) return '已配置(隐藏)';
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

// ============================================================
// 响应类型
// ============================================================

/**
 * AI 配置状态响应
 * 不含完整 API Key,仅含 masked 版本与"是否已配置"标志
 */
interface AiConfigStatusResponse {
  /** AI 功能是否启用(env.AI_ENABLED) */
  enabled: boolean;
  /** AI 服务是否真正可用(启用 + Key 已配置) */
  available: boolean;
  /** 当前 Provider(glm / trae) */
  provider: 'glm' | 'trae';
  /** API 端点 URL(OpenAI 兼容格式) */
  apiUrl: string;
  /** 模型名 */
  model: string;
  /** 请求超时(ms) */
  timeoutMs: number;
  /** GLM API Key 是否已配置(不返回 Key 本身) */
  glmApiKeyConfigured: boolean;
  /** GLM API Key 脱敏值 */
  glmApiKeyMasked: string;
  /** TRAE API Key 是否已配置 */
  traeApiKeyConfigured: boolean;
  /** TRAE API Key 脱敏值 */
  traeApiKeyMasked: string;
  /** TRAE API URL(留空表示未配置) */
  traeApiUrl: string;
  /** TRAE 模型名 */
  traeApiModel: string;
  /** 当前实际生效的 Provider(考虑降级:trae 配置不完整时降级到 glm) */
  effectiveProvider: 'glm' | 'trae' | 'none';
  /** 是否发生了降级 */
  fallback: boolean;
  /** 配置提示(用户在 .env 中填入 Key 后此处显示"已就绪") */
  hint: string;
}

/**
 * AI 连通性测试响应
 */
interface AiConfigTestResponse {
  /** 测试是否成功 */
  success: boolean;
  /** 失败原因(成功时为 null) */
  failureReason: string | null;
  /** 耗时(ms) */
  durationMs: number;
  /** 实际使用的 Provider */
  usedProvider: 'glm' | 'trae' | 'none';
  /** 是否发生了降级 */
  fallback: boolean;
  /** 测试时间(ISO 8601) */
  testedAt: string;
  /** 测试用的图片源(URL 或 base64 data URL,截断显示) */
  testImageSource: string;
  /** AI 返回的建议数量(成功时) */
  suggestionsCount: number | null;
}

// ============================================================
// 1. GET /api/admin/system/ai-config - 查看当前 AI 配置状态
// ============================================================

export const getAiConfig: RequestHandler = (_req, res, next) => {
  try {
    const cfg = env();
    const available = isAIEnabled();

    // 计算实际生效的 Provider(与 ai-vision.service.ts resolveAIConfig 逻辑一致)
    let effectiveProvider: 'glm' | 'trae' | 'none' = 'none';
    let fallback = false;

    if (cfg.aiProvider === 'glm') {
      if (cfg.aiApiKey.length > 0) {
        effectiveProvider = 'glm';
      }
    } else {
      // aiProvider === 'trae'
      const traeReady = cfg.traeApiKey.length > 0 && cfg.traeApiUrl.length > 0;
      if (traeReady) {
        effectiveProvider = 'trae';
      } else if (cfg.aiApiKey.length > 0) {
        // TRAE 配置不完整,降级到 GLM
        effectiveProvider = 'glm';
        fallback = true;
      }
    }

    // 生成配置提示
    let hint: string;
    if (!cfg.aiEnabled) {
      hint = 'AI_ENABLED=false,需在 .env 中设为 true 才能启用 AI 分析';
    } else if (effectiveProvider === 'none') {
      hint =
        cfg.aiProvider === 'trae'
          ? 'TRAE_PROVIDER 已选但 TRAE_API_KEY/TRAE_API_URL 未配置,且 GLM API_KEY 也未配置;请在 .env 中填入任一 Provider 的凭证'
          : 'AI_API_KEY 未配置,请在 .env 中填入 AI_API_KEY(GLM 或任意 OpenAI 兼容 API Key)';
    } else if (fallback) {
      hint = `TRAE 配置不完整,已降级到 GLM Provider;如需使用 TRAE 请补全 TRAE_API_KEY 与 TRAE_API_URL`;
    } else {
      hint = 'AI 配置已就绪,可调用 POST /api/admin/system/ai-config/test 测试连通性';
    }

    const response: AiConfigStatusResponse = {
      enabled: cfg.aiEnabled,
      available,
      provider: cfg.aiProvider,
      apiUrl: cfg.aiApiUrl,
      model: cfg.aiApiModel,
      timeoutMs: cfg.aiApiTimeout,
      glmApiKeyConfigured: cfg.aiApiKey.length > 0,
      glmApiKeyMasked: maskApiKey(cfg.aiApiKey),
      traeApiKeyConfigured: cfg.traeApiKey.length > 0,
      traeApiKeyMasked: maskApiKey(cfg.traeApiKey),
      traeApiUrl: cfg.traeApiUrl,
      traeApiModel: cfg.traeApiModel,
      effectiveProvider,
      fallback,
      hint,
    };

    return success(res, response, 'success');
  } catch (err) {
    return next(err);
  }
};

// ============================================================
// 2. POST /api/admin/system/ai-config/test - 测试 AI 连通性
// ============================================================

/**
 * 测试用的示例图片(服务器上的真实图片文件路径)
 * 避免使用 1x1 最小 PNG,部分 Provider(如智谱 GLM-4V)会返回 1210 图片解析错误
 */
const TEST_IMAGE_PATH = '/var/www/danqing-ai/website/images/gallery-hero.jpg';

/**
 * 测试 AI 连通性
 *
 * 实现策略:
 *   - 使用服务器上的真实示例图片 + painting 类型发送 AI 请求
 *   - 复用 analyzeWithAI 主流程(包含 Provider 解析、降级、超时控制)
 *   - 不计入业务统计,仅用于配置验证
 *   - 成功/失败均返回详细结果,便于排查配置问题
 *
 * 注意:
 *   - 测试会消耗一次 AI API 调用配额(免费额度 10 RPM 足够)
 *   - 测试期间会占用 2.5s 超时窗口(与生产 SLA 一致)
 */
export const testAiConfig: RequestHandler = async (req, res, next) => {
  try {
    // 鉴权上下文校验(防御性,authMiddleware 已保证)
    if (!req.userId || !req.tenantId) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }

    const cfg = env();

    // 前置检查:AI 必须已启用
    if (!cfg.aiEnabled) {
      const response: AiConfigTestResponse = {
        success: false,
        failureReason: 'AI_ENABLED=false,AI 功能未启用;请在 .env 中设置 AI_ENABLED=true 后重启 PM2',
        durationMs: 0,
        usedProvider: 'none',
        fallback: false,
        testedAt: new Date().toISOString(),
        testImageSource: TEST_IMAGE_PATH.slice(0, 50) + '...',
        suggestionsCount: null,
      };
      return success(res, response, 'AI 未启用');
    }

    // 前置检查:必须有可用的 Provider 配置
    if (!isAIEnabled()) {
      const response: AiConfigTestResponse = {
        success: false,
        failureReason:
          cfg.aiProvider === 'trae'
            ? 'TRAE Provider 已选但 TRAE_API_KEY/TRAE_API_URL 未配置,且 GLM AI_API_KEY 也未配置'
            : 'AI_API_KEY 未配置,无法发起测试请求',
        durationMs: 0,
        usedProvider: 'none',
        fallback: false,
        testedAt: new Date().toISOString(),
        testImageSource: TEST_IMAGE_PATH.slice(0, 50) + '...',
        suggestionsCount: null,
      };
      return success(res, response, 'AI Key 未配置');
    }

    // 发起测试请求(复用 analyzeWithAI 主流程)
    logger.info(
      { userId: req.userId, provider: cfg.aiProvider, model: cfg.aiApiModel },
      '[admin-ai-config] admin triggered AI connectivity test',
    );

    const testStartMs = Date.now();
    const result = await analyzeWithAI({
      imageSource: TEST_IMAGE_PATH,
      artType: 'painting',
      title: 'AI 连通性测试',
      remark: undefined,
      // 不传 jimpMetrics,让 AI 仅基于图片本身分析
      jimpMetrics: undefined,
    });
    const durationMs = Date.now() - testStartMs;

    // 判断实际使用的 Provider(从日志推断,这里用配置值)
    const usedProvider: 'glm' | 'trae' = cfg.aiProvider === 'trae' &&
    cfg.traeApiKey.length > 0 &&
    cfg.traeApiUrl.length > 0
      ? 'trae'
      : 'glm';

    const response: AiConfigTestResponse = {
      success: result.success,
      failureReason: result.success ? null : result.failureReason,
      durationMs,
      usedProvider: result.success ? usedProvider : 'none',
      fallback: cfg.aiProvider === 'trae' && usedProvider === 'glm',
      testedAt: new Date().toISOString(),
      testImageSource: TEST_IMAGE_PATH.slice(0, 50) + '...',
      suggestionsCount: result.success && result.result
        ? result.result.professionalSuggestions.length
        : null,
    };

    logger.info(
      {
        userId: req.userId,
        success: result.success,
        durationMs,
        failureReason: result.failureReason,
        usedProvider,
      },
      '[admin-ai-config] AI connectivity test completed',
    );

    // 异步记录 AI 用量日志(连通性测试,analysisId 留空),不阻塞响应
    const providerInfo = resolveEffectiveProvider(cfg);
    if (providerInfo && req.tenantId && req.userId) {
      const tokenUsage = result.success ? result.tokenUsage : undefined;
      aiUsageRepository
        .create({
          tenantId: req.tenantId,
          userId: req.userId,
          analysisId: null, // 连通性测试无关联 Analysis
          provider: providerInfo.provider,
          model: providerInfo.model,
          apiUrl: providerInfo.apiUrl,
          success: result.success,
          durationMs: result.durationMs,
          promptTokens: tokenUsage?.promptTokens ?? null,
          completionTokens: tokenUsage?.completionTokens ?? null,
          totalTokens: tokenUsage?.totalTokens ?? null,
          costYuan: result.success
            ? estimateCostYuan(
                providerInfo.model,
                tokenUsage?.promptTokens,
                tokenUsage?.completionTokens,
              )
            : null,
          failureReason: result.success ? null : result.failureReason,
        })
        .catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          logger.warn(
            { err: msg, userId: req.userId },
            '[admin-ai-config] record AI usage log failed (non-blocking)',
          );
        });
    }

    return success(res, response, result.success ? 'AI 连通性测试通过' : 'AI 连通性测试失败');
  } catch (err) {
    return next(err);
  }
};
