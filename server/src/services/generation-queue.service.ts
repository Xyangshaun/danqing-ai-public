// ============================================================
// AI 图像生成异步队列(基于 Redis List)
// 对应文档:.trae/documents/m2-generation-plan-2026-08-07.md §2.3 / §3.4
// 复用模式:analysis-queue.service.ts(Redis LPUSH/BRPOP + job 状态/TTL)
//
// 设计决策:
//   不引入 BullMQ(与 analysis-queue 保持同源,避免额外依赖 + free tier 资源占用),
//   使用 Redis LPUSH/BRPOP 实现轻量级 FIFO 队列。
//   生成频率低(单用户 5 次/分钟),无需分级,单队列 'queue:generation' 即可。
//
// 职责(对应计划 §2.3 异步任务状态机):
//   1. enqueue:存入 pending 状态 + LPUSH 入队,返回队列长度
//   2. dequeue:Worker BRPOP 阻塞读取,更新为 processing,返回 job
//   3. markSuccess:pipeline 批量存 success 状态 + result(GeneratedImage[])
//   4. markFailed:存 failed 状态 + failureReason
//   5. getJobStatus / getJobResult:供前端轮询
//   6. isAvailable:Redis ping 检查
//
// 状态机: pending → processing → success / failed(与计划 §2.3、契约 GenerationStatus 对齐)
//
// Key 约定:
//   - 队列:queue:generation(List)
//   - 状态:job:{id}:status(短期,TTL 1 小时)
//   - 结果:job:{id}:result(GeneratedImage[],短期,TTL 1 小时)
//   结果同时落库 GenerationTask.images 持久化(由 generation.service M2-T4 编排),
//   跨进程 GET 轮询以 DB 为准(redis 仅作短期加速)。
//
// 安全:日志不记录图片完整内容/密钥,仅记录任务 id/状态/耗时
// ============================================================

import { redis } from '../config/redis.js';
import { logger } from '../utils/logger.js';
import { redisMetrics } from './redis-metrics.service.js';
import type { ArtType, GenerationInputType } from '../types/api-contract.js';

/**
 * 队列 key(单队列,生成频率低无需分级)
 */
const QUEUE_KEY = 'queue:generation';

/**
 * 任务 TTL(秒):1 小时(超时自动清理,与计划 §2.3 建议一致)
 */
const JOB_TTL_SECONDS = 3600;

/**
 * 任务状态(对齐计划 §2.3 状态机 + 契约 GenerationStatus)
 */
export type GenerationJobStatus = 'pending' | 'processing' | 'success' | 'failed';

/**
 * 生成任务数据结构(worker 消费的完整入参)
 * 由上层 generation.service(M2-T4)组装后入队
 *
 * 队列引用模式(M-4 v1.1.0 修订 R1,真源 §2.6 决策 D-2):
 *   - 载荷仅携带任务引用小字段(恒定 ≤ 数 KB),**不携带任何图片数据字段**
 *   - 旧版 `sketchImageUrl`(dataURL 可达数百 KB~6M 字符)已移除——dataURL 整体入
 *     Redis List 构成大 value 风险(LPUSH/BRPOP 传输阻塞、堆积内存放大);
 *   - `styleImageUrl` 不入队(M-4 style 模式直接按引用模式实现);
 *   - Worker 在 sketch/style 分支经 generationRepository.findById(tenantId, job.id)
 *     回读图片 URL(DB 为真源;Worker 本就要读 DB 更新任务状态,无额外查询负担);
 *   - 对外契约与行为零变化(队列内部载荷瘦身,M-2 sketch 模式一并迁移)。
 */
export interface GenerationJob {
  /** 任务 ID(等同 GenerationTask.id) */
  id: string;
  /** 租户 ID(多租户隔离) */
  tenantId: string;
  /** 用户 ID */
  userId: string;
  /** 生成输入来源('text' | 'sketch' | 'style') */
  inputType: GenerationInputType;
  /** 文字提示词(text 模式) / style 模式新画面内容描述 */
  prompt?: string;
  /** 目标作品类型(生成后一键诊断的类型) */
  artType: ArtType;
  /** 生成尺寸提示('portrait' | 'landscape' | 'square') */
  aspect?: 'portrait' | 'landscape' | 'square';
  /** 生成数量(1-4) */
  count?: number;
  /** 入队时间(ISO 8601) */
  enqueuedAt: string;
  /** 全链路 traceId(M3 可观测性;由 traceMiddleware 注入,写入 AiUsageLog.traceId) */
  traceId?: string;
}

/**
 * 任务状态记录(存 Redis job:{id}:status)
 */
export interface GenerationJobStatusRecord {
  status: GenerationJobStatus;
  enqueuedAt: string;
  startedAt?: string;
  completedAt?: string;
  failureReason?: string;
  /** 队列位置(用于前端展示) */
  position?: number;
}

class GenerationQueueServiceClass {
  /**
   * 入队:将生成任务推入 Redis List
   * 1. 存储 pending 状态(带 TTL)
   * 2. LPUSH 入队(LPUSH 头插 + BRPOP 尾取,实现 FIFO)
   * @returns 队列长度(剩余任务数)
   */
  async enqueue(job: GenerationJob): Promise<number> {
    try {
      // 1. 存储任务状态(pending)
      const statusKey = `job:${job.id}:status`;
      const statusRecord: GenerationJobStatusRecord = {
        status: 'pending',
        enqueuedAt: job.enqueuedAt,
      };
      await redis().set(statusKey, JSON.stringify(statusRecord), 'EX', JOB_TTL_SECONDS);

      // 2. 推入队列
      const serialized = JSON.stringify(job);
      const queueLength = await redis().lpush(QUEUE_KEY, serialized);

      logger.info(
        { jobId: job.id, queueLength, tenantId: job.tenantId },
        '[generation-queue] job enqueued',
      );

      return queueLength;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err: msg, jobId: job.id }, '[generation-queue] enqueue failed');
      throw err;
    }
  }

  /**
   * 出队:Worker 读取任务
   * - timeoutSeconds > 0:BRPOP 阻塞读取(FIFO,带超时)
   * - timeoutSeconds === 0:RPOP 非阻塞读取(立即返回,队列为空返回 null)
   *
   * 关键修复:Redis BRPOP key 0 = 永久阻塞,会锁死 ioredis 单连接,
   * 导致所有后续 Redis 命令(rate-limit EVALSHA、黑名单 EXISTS 等)排队等待。
   * 当 Worker 轮询调用(已有 1s 间隔)时应使用 RPOP 非阻塞出队。
   *
   * @param timeoutSeconds 阻塞超时(秒),0 表示非阻塞(RPOP),默认 5
   * @returns 任务数据;队列为空时返回 null
   */
  async dequeue(timeoutSeconds: number = 5): Promise<GenerationJob | null> {
    try {
      let serialized: string | null = null;

      if (timeoutSeconds === 0) {
        // 非阻塞:RPOP 立即返回,不占用连接
        const tRpop = performance.now();
        serialized = await redis().rpop(QUEUE_KEY);
        redisMetrics.recordRpop(performance.now() - tRpop, !serialized);
      } else {
        // 阻塞:BRPOP 带超时(仅在专用 Worker 场景使用)
        const tBrpop = performance.now();
        const result = await redis().brpop(QUEUE_KEY, timeoutSeconds);
        const brpopMs = performance.now() - tBrpop;
        redisMetrics.recordBrpop(brpopMs, !result);
        // BRPOP 耗时异常告警(超过 1s 可能连接有问题)
        if (brpopMs > 1000) {
          logger.warn({ brpopMs, timeoutSeconds }, '[generation-queue] brpop slow');
        }
        if (!result) return null;
        serialized = result[1];
      }

      if (!serialized) return null;
      // 平滑过渡(M-4 v1.1.0 修订 R1,真源 §2.6 决策 D-2):
      // 上线瞬间 Redis 可能残留旧格式 job(载荷含 sketchImageUrl/styleImageUrl 等
      // 图片字段),此处显式剔除——Worker 一律以 DB 回读为准,无需清空队列即可平滑切换
      const parsed = JSON.parse(serialized) as GenerationJob & {
        sketchImageUrl?: unknown;
        styleImageUrl?: unknown;
      };
      delete parsed.sketchImageUrl;
      delete parsed.styleImageUrl;
      const job = parsed as GenerationJob;

      // 更新状态为 processing
      const statusKey = `job:${job.id}:status`;
      const statusRecord: GenerationJobStatusRecord = {
        status: 'processing',
        enqueuedAt: job.enqueuedAt ?? new Date().toISOString(),
        startedAt: new Date().toISOString(),
      };
      await redis().set(statusKey, JSON.stringify(statusRecord), 'EX', JOB_TTL_SECONDS);

      logger.info({ jobId: job.id }, '[generation-queue] job dequeued, processing');
      return job;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err: msg }, '[generation-queue] dequeue failed');
      return null;
    }
  }

  /**
   * 标记任务完成(成功)
   * 使用 pipeline 批量存储 success 状态 + 结果(GeneratedImage[])
   * 结果供前端轮询获取;持久化落库由 generation.service(M2-T4)负责
   */
  async markSuccess(jobId: string, result: unknown): Promise<void> {
    try {
      const statusKey = `job:${jobId}:status`;
      const resultKey = `job:${jobId}:result`;
      const now = new Date().toISOString();

      const statusRecord: GenerationJobStatusRecord = {
        status: 'success',
        enqueuedAt: now,
        completedAt: now,
      };

      // pipeline 批量执行,减少 RTT
      const pipeline = redis().pipeline();
      pipeline.set(statusKey, JSON.stringify(statusRecord), 'EX', JOB_TTL_SECONDS);
      pipeline.set(resultKey, JSON.stringify(result), 'EX', JOB_TTL_SECONDS);
      await pipeline.exec();

      logger.info({ jobId }, '[generation-queue] job completed successfully');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err: msg, jobId }, '[generation-queue] markSuccess failed');
    }
  }

  /**
   * 标记任务失败
   * 存储 failed 状态 + failureReason
   */
  async markFailed(jobId: string, failureReason: string): Promise<void> {
    try {
      const statusKey = `job:${jobId}:status`;
      const statusRecord: GenerationJobStatusRecord = {
        status: 'failed',
        enqueuedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        failureReason,
      };
      await redis().set(statusKey, JSON.stringify(statusRecord), 'EX', JOB_TTL_SECONDS);

      logger.warn({ jobId, failureReason }, '[generation-queue] job failed');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err: msg, jobId }, '[generation-queue] markFailed failed');
    }
  }

  /**
   * 查询任务状态(供前端轮询)
   * @returns 状态记录;任务不存在返回 null
   */
  async getJobStatus(jobId: string): Promise<GenerationJobStatusRecord | null> {
    try {
      const statusKey = `job:${jobId}:status`;
      const raw = await redis().get(statusKey);
      if (!raw) return null;
      return JSON.parse(raw) as GenerationJobStatusRecord;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ err: msg, jobId }, '[generation-queue] getJobStatus failed');
      return null;
    }
  }

  /**
   * 获取任务结果(任务成功后,GeneratedImage[])
   * @returns 结果;不存在返回 null
   */
  async getJobResult(jobId: string): Promise<unknown | null> {
    try {
      const resultKey = `job:${jobId}:result`;
      const raw = await redis().get(resultKey);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ err: msg, jobId }, '[generation-queue] getJobResult failed');
      return null;
    }
  }

  /**
   * 获取队列长度(待处理任务数)
   */
  async getQueueLength(): Promise<number> {
    try {
      return await redis().llen(QUEUE_KEY);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ err: msg }, '[generation-queue] getQueueLength failed');
      return 0;
    }
  }

  /**
   * 检查队列是否可用(Redis 是否连通)
   * 用于决定是否走异步模式(Redis 不可用时由编排层回退处理)
   */
  async isAvailable(): Promise<boolean> {
    try {
      const result = await redis().ping();
      return result === 'PONG';
    } catch {
      return false;
    }
  }
}

export const generationQueueService = new GenerationQueueServiceClass();