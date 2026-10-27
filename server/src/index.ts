// ============================================================
// 丹青有AI - 服务启动入口
// 对应文档:
//   - auth-design.md §4.7 启动自检
//   - context-log-2026-07-27.md 技术约束
//
// 启动顺序(关键):
//   1. initEnv()           加载并校验环境变量(失败立即退出)
//   2. initLogger()        初始化 Winston(后续日志可用)
//   3. initPrisma()        初始化 Prisma(数据库连接池)
//   4. initRedis()         初始化 Redis(state/限流/黑名单)
//   5. createApp()         构建 Express 应用(由 app.ts 默认导出已自动构建)
//   6. http.createServer    启动 HTTP 监听
//
// 优雅关闭(SIGTERM/SIGINT):
//   - 停止接收新连接
//   - 关闭 HTTP server
//   - 关闭 Prisma / Redis 连接
//   - 进程退出
//
// 兜底:
//   - uncaughtException:记录后退出(进程状态不可预测)
//   - unhandledRejection:记录后退出(避免资源泄漏)
// ============================================================

import http from 'node:http';
import { initEnv, env } from './config/env.js';
import { initLogger, logger } from './utils/logger.js';
import { initPrisma, closePrisma } from './config/prisma.js';
import { initRedis, closeRedis } from './config/redis.js';
import app from './app.js';
// M2-T6:AI 图像生成后台 Worker + 功能开关(生成功能默认关闭,经 /config 灰度开启)
import { generationWorker } from './services/generation-worker.service.js';
import { generationService } from './services/generation.service.js';
import { configFeatureService } from './services/config-feature.service.js';
import { redisMetrics } from './services/redis-metrics.service.js';
// M3-T8:可观测性指标告警调度器(每分钟 evaluateAndAlert;alerting 开关默认关闭,开启后生效)
import { metricsAggregationService } from './services/metrics-aggregation.service.js';

/**
 * 启动服务器(主入口)
 */
async function startServer(): Promise<void> {
  // 1. 环境变量(启动自检:任一必填项缺失都会抛错)
  initEnv();

  // 2. Logger(后续所有日志使用此实例)
  initLogger();

  const cfg = env();
  logger.info(
    { nodeEnv: cfg.nodeEnv, port: cfg.port, logLevel: cfg.logLevel },
    '[startup] env loaded',
  );

  // 3. Prisma 初始化(连接池由 DATABASE_URL 控制)
  try {
    initPrisma();
    logger.info('[startup] prisma initialized');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err: msg }, '[startup] prisma init failed');
    process.exit(1);
  }

  // 4. Redis 初始化(用于 OAuth state / 限流 / 黑名单)
  try {
    initRedis();
    logger.info('[startup] redis initialized');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err: msg }, '[startup] redis init failed');
    // Redis 是认证与限流的核心依赖,不可降级,直接退出
    process.exit(1);
  }

  // 4a. AI 图像生成 Worker 启动(M2-T6)
  // 仅在"生成功能开启"时启动(默认关闭,经 /api/v1/config/features/:featureId 灰度开启);
  // worker 仅后台轮询队列,不阻塞主 HTTP 服务;Redis 不可用时自动跳过
  //
  // 竞态修复(M2-T6):isGenerationEnabled() 为同步判定,基于内存 flags Map;
  // 若启动时未先从 Redis hydration,则读到的是默认 disabled。
  // 故在判定前显式触发一次 hydration(经 getFeature 内部 ensureHydrated),
  // 确保读取到 Redis 中的灰度覆盖(如生产已 enabled)后再决定是否启动 worker。
  try {
    await configFeatureService.getFeature('generation');
    if (configFeatureService.isGenerationEnabled()) {
      const started = await generationWorker.start();
      if (started) {
        logger.info('[startup] generation worker started');
      } else {
        logger.warn('[startup] generation worker not started (redis unavailable)');
      }
    } else {
      logger.info('[startup] generation feature disabled, worker not started');
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Worker 启动失败不阻断主服务(生成功能退化为仅同步降级模式)
    logger.warn({ err: msg }, '[startup] generation worker start skipped');
  }

  // 4a-1. stalled 恢复扫描器启动(M-4 v1.1.0 修订 R2,真源 §2.6 决策 D-4)
  // 服务启动时立即扫描一次 + 每 60s 定时;超时 processing 任务标记 failed
  // WORKER_INTERRUPTED(不自动重新入队),前端轮询可获终态。
  // 无条件启动(不依赖 generation/styleTransfer 开关、不随 Worker 生命周期):
  // 同步模式任务不入队、开关关闭时存量卡滞任务同样需要收敛终态;
  // 定时器已 unref,不阻塞进程退出(优雅退出时由 gracefulShutdown 显式停止)
  try {
    generationService.startStalledScanner();
    logger.info('[startup] generation stalled scanner started');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err: msg }, '[startup] stalled scanner start skipped');
  }

  // 4b. Redis 指标定时日志(间隔由 REDIS_METRICS_LOG_INTERVAL_MS 控制,默认 30s)
  // 对应文档:redis-brpop-fix-2026-08-07.md §7 后续改进
  redisMetrics.startLogInterval(env().redisMetricsLogIntervalMs);

  // 4c. 可观测性指标告警调度器(M3-T8)
  // 每分钟 evaluateAndAlert:构造近 1 分钟快照 → alert.service 阈值判定
  // fail-safe:evaluateAndAlert 内部 catch swallow,不阻断主链路(门禁 M3-4)
  // alerting 开关默认 disabled;开启前先显式 hydration,确保读到 Redis 灰度覆盖
  let metricsAlertTimer: NodeJS.Timeout | null = null;
  try {
    await configFeatureService.getFeature('alerting');
    if (configFeatureService.isAlertingEnabled()) {
      metricsAlertTimer = setInterval(() => {
        void metricsAggregationService.evaluateAndAlert();
      }, 60 * 1000);
      logger.info('[startup] metrics alert scheduler started (alerting enabled)');
    } else {
      logger.info('[startup] metrics alert scheduler not started (alerting disabled)');
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err: msg }, '[startup] metrics alert scheduler start skipped');
  }

  // 5. HTTP 服务(由 app.ts 已构建)
  const server = http.createServer(app);

  // 6. 启动监听
  server.listen(cfg.port, () => {
    logger.info(
      { port: cfg.port, nodeEnv: cfg.nodeEnv },
      '[startup] danqing-ai-server listening',
    );
    logger.info(
      {
        auth: `/auth/*`,
        users: `/users/*`,
        tenants: `/tenants/*`,
        analyses: `/analyses/*`,
        health: `/health`,
      },
      '[startup] routes mounted',
    );
  });

  // ---------- 优雅关闭 ----------
  // 关闭标识:防止 SIGTERM/SIGINT 多次触发重复执行清理
  let isShuttingDown = false;

  async function gracefulShutdown(signal: string): Promise<void> {
    if (isShuttingDown) {
      logger.warn({ signal }, '[shutdown] already in progress, skip');
      return;
    }
    isShuttingDown = true;
    logger.info({ signal }, '[shutdown] graceful shutdown start');

    // 6a. 停止接收新连接(noNewConnections)
    server.close((err) => {
      if (err) {
        logger.error({ err: err.message }, '[shutdown] http server close error');
      } else {
        logger.info('[shutdown] http server closed');
      }
    });

    // 6a-1. 停止 AI 图像生成 Worker(M2-T6)
    // 置停止标志并清空 pending timer;处理中的任务让其自然完成,随后再关 Redis
    generationWorker.stop();

    // 6a-1b. 停止 stalled 恢复扫描器(M-4 v1.1.0 修订 R2)
    // 清空扫描定时器;已标记的终态已落库,未扫描到的卡滞任务由下次启动时的
    // 首轮扫描收敛(启动即扫一次)
    generationService.stopStalledScanner();

    // 6a-2. 停止 Redis 指标定时日志
    redisMetrics.stopLogInterval();

    // 6a-3. 停止 M3 指标告警调度器(若已启动)
    if (metricsAlertTimer) {
      clearInterval(metricsAlertTimer);
      metricsAlertTimer = null;
      logger.info('[shutdown] metrics alert scheduler stopped');
    }

    // 6b. 关闭 Redis(给 in-flight 请求 5s 缓冲)
    try {
      await closeRedis();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err: msg }, '[shutdown] redis close error');
    }

    // 6c. 关闭 Prisma
    try {
      await closePrisma();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err: msg }, '[shutdown] prisma close error');
    }

    logger.info('[shutdown] graceful shutdown complete, exit 0');
    process.exit(0);
  }

  // SIGTERM:K8s/Docker 停容器时发送
  process.on('SIGTERM', () => {
    void gracefulShutdown('SIGTERM');
  });

  // SIGINT:Ctrl+C
  process.on('SIGINT', () => {
    void gracefulShutdown('SIGINT');
  });

  // ---------- 进程级兜底 ----------
  // uncaughtException:同步代码未捕获的异常
  // 进程状态已不可预测,记录后强制退出(交给进程管理器重启)
  process.on('uncaughtException', (err) => {
    logger.error(
      { err: err.message, stack: err.stack, name: err.name },
      '[fatal] uncaughtException',
    );
    process.exit(1);
  });

  // unhandledRejection:Promise 未处理的 rejection
  // Node 15+ 默认会终止进程,这里显式处理确保日志落盘
  process.on('unhandledRejection', (reason) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    const stack = reason instanceof Error ? reason.stack : undefined;
    logger.error({ reason: msg, stack }, '[fatal] unhandledRejection');
    process.exit(1);
  });
}

// 启动(顶层 await 仅在 ESM 中可用,本项目 type:module)
void startServer().catch((err) => {
  // 启动失败兜底(initEnv 抛错时 logger 可能还未初始化)
  const msg = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  // eslint-disable-next-line no-console
  console.error('[fatal] startup failed:', msg, stack);
  process.exit(1);
});
