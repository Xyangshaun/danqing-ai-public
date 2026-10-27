// ============================================================
// Redis 指标监控服务
//
// 职责:
//   1. 收集 Redis 连接状态(连接次数/错误/重连/当前状态)
//   2. 收集关键命令耗时(brpop/rpop/evalsha/eval/ping/exists 等)
//   3. 收集业务级指标(rate-limit 超时/fail open 次数、BRPOP 阻塞时长)
//   4. 提供 getSnapshot() 供 API 端点查询
//   5. 提供定时日志输出(默认 30s 摘要,便于运维实时观察)
//
// 设计原则:
//   - 零额外 Redis 连接:不使用 MONITOR,仅基于事件 + 手动埋点
//   - 低开销:计数用 Map,耗时用 performance.now(),无外部依赖
//   - 线程安全:单进程 Node.js,无锁;计数器用 Number(精度足够)
//   - 可重置:reset() 供测试和定期归零使用
//
// 对应文档:.trae/documents/redis-brpop-fix-2026-08-07.md §7 后续改进
// ============================================================

import { logger } from '../utils/logger.js';

/** 单个命令的耗时统计 */
interface CommandStats {
  count: number;
  totalMs: number;
  minMs: number;
  maxMs: number;
}

/** BRPOP/RPOP 专项统计 */
interface QueueCommandStats {
  count: number;
  totalMs: number;
  maxMs: number;
  /** BRPOP 返回 null 的次数(队列为空或超时) */
  emptyCount: number;
}

/** 连接级统计 */
interface ConnectionStats {
  status: string;
  totalConnects: number;
  totalErrors: number;
  totalReconnects: number;
  lastConnectAt: string | null;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
}

/** 指标快照(供 API 端点返回) */
export interface RedisMetricsSnapshot {
  collectedAt: string;
  uptimeMs: number;
  connection: ConnectionStats;
  commands: Record<string, CommandStats>;
  queue: {
    brpop: QueueCommandStats;
    rpop: QueueCommandStats;
  };
  rateLimit: {
    /** rate-limit Redis 操作超时(200ms)次数 */
    timeoutCount: number;
    /** fail open 放行次数 */
    failOpenCount: number;
    /** 限流命中次数(count > max) */
    hitCount: number;
  };
}

class RedisMetricsClass {
  private readonly startedAt = Date.now();

  // 连接级
  private connStatus = 'init';
  private connTotalConnects = 0;
  private connTotalErrors = 0;
  private connTotalReconnects = 0;
  private connLastConnectAt: string | null = null;
  private connLastErrorAt: string | null = null;
  private connLastErrorMessage: string | null = null;

  // 命令级(command name → stats)
  private readonly commands = new Map<string, CommandStats>();

  // 队列专项
  private readonly brpopStats: QueueCommandStats = { count: 0, totalMs: 0, maxMs: 0, emptyCount: 0 };
  private readonly rpopStats: QueueCommandStats = { count: 0, totalMs: 0, maxMs: 0, emptyCount: 0 };

  // 限流专项
  private rlTimeoutCount = 0;
  private rlFailOpenCount = 0;
  private rlHitCount = 0;

  // 定时器
  private logTimer: NodeJS.Timeout | null = null;

  // ---------- 连接事件 ----------

  onConnect(): void {
    this.connTotalConnects++;
    this.connStatus = 'ready';
    this.connLastConnectAt = new Date().toISOString();
  }

  onReconnecting(): void {
    this.connTotalReconnects++;
    this.connStatus = 'reconnecting';
  }

  onError(message: string): void {
    this.connTotalErrors++;
    this.connLastErrorAt = new Date().toISOString();
    this.connLastErrorMessage = message;
    this.connStatus = 'error';
  }

  onClose(): void {
    this.connStatus = 'closed';
  }

  setStatus(status: string): void {
    this.connStatus = status;
  }

  // ---------- 命令耗时 ----------

  /**
   * 记录单条 Redis 命令耗时
   * @param command 命令名(小写,如 'brpop'/'evalsha')
   * @param durationMs 耗时(毫秒)
   */
  recordCommand(command: string, durationMs: number): void {
    const cmd = command.toLowerCase();
    const existing = this.commands.get(cmd);
    if (existing) {
      existing.count++;
      existing.totalMs += durationMs;
      if (durationMs < existing.minMs) existing.minMs = durationMs;
      if (durationMs > existing.maxMs) existing.maxMs = durationMs;
    } else {
      this.commands.set(cmd, {
        count: 1,
        totalMs: durationMs,
        minMs: durationMs,
        maxMs: durationMs,
      });
    }
  }

  // ---------- 队列专项(BRPOP/RPOP) ----------

  /**
   * 记录一次 BRPOP 调用
   * @param durationMs 耗时
   * @param empty 是否返回空(队列空或超时)
   */
  recordBrpop(durationMs: number, empty: boolean): void {
    this.brpopStats.count++;
    this.brpopStats.totalMs += durationMs;
    if (durationMs > this.brpopStats.maxMs) this.brpopStats.maxMs = durationMs;
    if (empty) this.brpopStats.emptyCount++;
    // 同步记入通用命令统计
    this.recordCommand('brpop', durationMs);
  }

  /**
   * 记录一次 RPOP 调用
   * @param durationMs 耗时
   * @param empty 是否返回空
   */
  recordRpop(durationMs: number, empty: boolean): void {
    this.rpopStats.count++;
    this.rpopStats.totalMs += durationMs;
    if (durationMs > this.rpopStats.maxMs) this.rpopStats.maxMs = durationMs;
    if (empty) this.rpopStats.emptyCount++;
    this.recordCommand('rpop', durationMs);
  }

  // ---------- 限流专项 ----------

  recordRateLimitTimeout(): void {
    this.rlTimeoutCount++;
  }

  recordRateLimitFailOpen(): void {
    this.rlFailOpenCount++;
  }

  recordRateLimitHit(): void {
    this.rlHitCount++;
  }

  // ---------- 快照 ----------

  getSnapshot(): RedisMetricsSnapshot {
    return {
      collectedAt: new Date().toISOString(),
      uptimeMs: Date.now() - this.startedAt,
      connection: {
        status: this.connStatus,
        totalConnects: this.connTotalConnects,
        totalErrors: this.connTotalErrors,
        totalReconnects: this.connTotalReconnects,
        lastConnectAt: this.connLastConnectAt,
        lastErrorAt: this.connLastErrorAt,
        lastErrorMessage: this.connLastErrorMessage,
      },
      commands: Object.fromEntries(this.commands),
      queue: {
        brpop: { ...this.brpopStats },
        rpop: { ...this.rpopStats },
      },
      rateLimit: {
        timeoutCount: this.rlTimeoutCount,
        failOpenCount: this.rlFailOpenCount,
        hitCount: this.rlHitCount,
      },
    };
  }

  // ---------- 定时日志 ----------

  /**
   * 启动定时日志输出(默认 30 秒)
   * 在 index.ts 启动时调用,定时输出 Redis 指标摘要
   */
  startLogInterval(intervalMs: number = 30_000): void {
    if (this.logTimer) return;
    this.logTimer = setInterval(() => this.logSummary(), intervalMs);
    // 不阻止进程退出
    if (this.logTimer.unref) this.logTimer.unref();
    logger.info({ intervalMs }, '[redis-metrics] log interval started');
  }

  stopLogInterval(): void {
    if (this.logTimer) {
      clearInterval(this.logTimer);
      this.logTimer = null;
    }
  }

  /**
   * 输出指标摘要到日志(便于运维 grep 实时观察)
   */
  logSummary(): void {
    const snap = this.getSnapshot();
    const cmdSummary = this.formatTopCommands(snap.commands, 5);
    logger.info(
      {
        status: snap.connection.status,
        connects: snap.connection.totalConnects,
        errors: snap.connection.totalErrors,
        reconnects: snap.connection.totalReconnects,
        brpop: snap.queue.brpop,
        rpop: snap.queue.rpop,
        rateLimit: snap.rateLimit,
        topCommands: cmdSummary,
      },
      '[redis-metrics] summary',
    );
  }

  /** 取 Top N 命令(按总耗时降序) */
  private formatTopCommands(
    commands: Record<string, CommandStats>,
    n: number,
  ): Array<{ cmd: string; count: number; avgMs: number; maxMs: number }> {
    return Object.entries(commands)
      .map(([cmd, s]) => ({
        cmd,
        count: s.count,
        avgMs: s.count > 0 ? Math.round((s.totalMs / s.count) * 100) / 100 : 0,
        maxMs: Math.round(s.maxMs * 100) / 100,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, n);
  }

  // ---------- 重置(测试用) ----------

  reset(): void {
    this.commands.clear();
    this.brpopStats.count = 0;
    this.brpopStats.totalMs = 0;
    this.brpopStats.maxMs = 0;
    this.brpopStats.emptyCount = 0;
    this.rpopStats.count = 0;
    this.rpopStats.totalMs = 0;
    this.rpopStats.maxMs = 0;
    this.rpopStats.emptyCount = 0;
    this.rlTimeoutCount = 0;
    this.rlFailOpenCount = 0;
    this.rlHitCount = 0;
  }
}

export const redisMetrics = new RedisMetricsClass();
