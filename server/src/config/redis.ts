// ============================================================
// Redis 客户端(ioredis)
// 用途:OAuth state 缓存 / Refresh token 黑名单 / Rate Limiting 计数 / 配额计数
// 对应文档:auth-design.md §1.2 步骤 3, §2.2, §3.3
// ============================================================

import { Redis } from 'ioredis';
import { env } from './env.js';
import { logger } from '../utils/logger.js';
import { redisMetrics } from '../services/redis-metrics.service.js';

let redisInstance: Redis | null = null;

/**
 * 初始化 Redis 单例
 * 在 src/index.ts 启动时调用
 *
 * 监控接入(对应 redis-brpop-fix-2026-08-07.md §7):
 *   - connect/reconnecting/error/close 事件接入 redisMetrics
 *   - 便于实时观察连接池状态与异常重连
 */
export function initRedis(): Redis {
  if (redisInstance) {
    return redisInstance;
  }
  const redisUrl = env().redisUrl;
  redisInstance = new Redis(redisUrl, {
    // 连接失败时打印日志,不重连到死循环
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false,
    reconnectOnError(err: Error) {
      logger.warn({ err: err.message }, '[redis] reconnectOnError triggered');
      // 只对 READONLY 错误重连
      return err.message.includes('READONLY');
    },
  });

  redisInstance.on('connect', () => {
    logger.info('[redis] connected');
    redisMetrics.onConnect();
  });

  redisInstance.on('reconnecting', (delayMs: number) => {
    logger.warn({ delayMs }, '[redis] reconnecting');
    redisMetrics.onReconnecting();
  });

  redisInstance.on('error', (err: Error) => {
    // 不暴露完整错误(可能含 URL/密码)
    logger.error({ err: err.message }, '[redis] connection error');
    redisMetrics.onError(err.message);
  });

  redisInstance.on('close', () => {
    logger.warn('[redis] connection closed');
    redisMetrics.onClose();
  });

  // 状态变更同步到 metrics(供快照读取当前 status)
  const origReadyCheck = redisInstance.options.enableReadyCheck;
  if (origReadyCheck) {
    // ioredis 内部 ready check 完成后会触发 'ready',此处仅做状态同步
    redisInstance.on('ready', () => {
      redisMetrics.setStatus('ready');
    });
  }

  return redisInstance;
}

/**
 * 获取 Redis 单例
 * @throws Error 未初始化时抛错
 */
export function redis(): Redis {
  if (!redisInstance) {
    throw new Error('[redis] not initialized. Call initRedis() at startup first.');
  }
  return redisInstance;
}

/**
 * 优雅关闭 Redis 连接
 */
export async function closeRedis(): Promise<void> {
  if (redisInstance) {
    await redisInstance.quit();
    redisInstance = null;
    logger.info('[redis] closed');
  }
}
