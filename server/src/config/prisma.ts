// ============================================================
// Prisma 客户端单例
// 多租户强制过滤不在 Prisma 扩展层做,而是由 Repository 层显式传 tenantId
// (对应 data-model-v1.md §7.2:Repository 层强制过滤)
// 理由:Prisma $extends 全局注入会让管理后台聚合查询难以绕过,显式更安全
// ============================================================

import type { Prisma } from '@prisma/client';
import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger.js';

let prismaInstance: PrismaClient | null = null;

/**
 * Prisma 日志事件载荷(对应 emit:'event' 的 warn/error 事件)
 * Prisma 5 未导出 LogEvent 类型,此处显式声明
 */
type PrismaLogEventPayload = {
  target?: string;
  message?: string;
  timestamp?: Date;
};

/**
 * 初始化 Prisma 单例
 * 在 src/index.ts 启动时调用
 */
export function initPrisma(): PrismaClient {
  if (prismaInstance) {
    return prismaInstance;
  }
  prismaInstance = new PrismaClient({
    log: [
      { emit: 'event', level: 'warn' },
      { emit: 'event', level: 'error' },
    ],
  });

  // 日志输出(脱敏:Prisma 默认 query 日志可能含参数,生产环境关闭)
  // Prisma 5: $on 类型仅暴露 'query'/'beforeExit' 重载,warn/error 事件需通过
  // Prisma.LogLevel 类型转换(参见 PrismaClient 源码 LogDefinition)
  // 注意:必须 .bind(prismaInstance) 保留 this 上下文,否则 $on 内部访问
  // this._engineConfig 时报 "Cannot read properties of undefined"
  const onLogEvent = prismaInstance.$on.bind(prismaInstance) as (
    event: Prisma.LogLevel,
    listener: (e: PrismaLogEventPayload) => void,
  ) => void;

  onLogEvent('warn', (e) => {
    logger.warn({ target: e.target, message: e.message }, '[prisma] warn');
  });
  onLogEvent('error', (e) => {
    logger.error({ target: e.target, message: e.message }, '[prisma] error');
  });

  return prismaInstance;
}

/**
 * 获取 Prisma 单例
 * @throws Error 未初始化时抛错
 */
export function prisma(): PrismaClient {
  if (!prismaInstance) {
    throw new Error('[prisma] not initialized. Call initPrisma() at startup first.');
  }
  return prismaInstance;
}

/**
 * 优雅关闭 Prisma 连接
 */
export async function closePrisma(): Promise<void> {
  if (prismaInstance) {
    await prismaInstance.$disconnect();
    prismaInstance = null;
    logger.info('[prisma] disconnected');
  }
}
