// ============================================================
// 轻量级异步分析队列(基于 Redis List)
// 对应文档:.trae/documents/ai-integration-design.md §4.2(异步队列)
//
// 设计决策:
//   不引入 BullMQ(避免额外依赖 + free tier 资源占用),
//   使用 Redis LPUSH/BRPOP 实现轻量级 FIFO 队列 + 优先级支持。
//   适用于 Render.com free tier 部署场景。
//
// 职责:
//   1. 入队:将分析任务推入 Redis List(支持优先级)
//   2. 出队:Worker 轮询获取任务(BRPOP 阻塞读取)
//   3. 状态追踪:job:{id} 记录任务状态(pending/processing/success/failed)
//   4. 结果存储:job:{id}:result 存储分析结果(短期,供前端轮询)
//   5. 超时清理:过期 job 自动清理(TTL 1 小时)
//
// 使用场景:
//   - 同步模式(< 3s SLA):默认走 analysis.service.runAnalysis(同步)
//   - 异步模式(高负载/enterprise):入队后立即返回 taskId,前端轮询结果
//   - 降级策略:Redis 不可用时,回退到同步模式
// ============================================================

import { redis } from '../config/redis.js';
import { logger } from '../utils/logger.js';
import type { ArtType } from '../types/api-contract.js';

/**
 * 队列名称(按优先级分队列)
 */
const QUEUE_HIGH_PRIORITY = 'queue:analysis:high'; // enterprise 用户
const QUEUE_NORMAL_PRIORITY = 'queue:analysis:normal'; // standard/free 用户

/**
 * 任务状态
 */
type JobStatus = 'pending' | 'processing' | 'success' | 'failed';

/**
 * 任务 TTL(秒):1 小时(超时自动清理)
 */
const JOB_TTL_SECONDS = 3600;

/**
 * 任务数据结构
 */
interface AnalysisJob {
  /** 任务 ID(等同 analysis.id) */
  id: string;
  /** 租户 ID */
  tenantId: string;
  /** 用户 ID */
  userId: string;
  /** 作品类型 */
  artType: ArtType;
  /** 图片源(本地路径或 URL) */
  imageSource: string;
  /** 是否本地文件 */
  isLocal: boolean;
  /** 作品标题 */
  title?: string;
  /** 备注 */
  remark?: string;
  /** 原始文件名 */
  originalFileName?: string;
  /** 入队时间 */
  enqueuedAt: string;
}

/**
 * 任务状态记录
 */
interface JobStatusRecord {
  status: JobStatus;
  enqueuedAt: string;
  startedAt?: string;
  completedAt?: string;
  failureReason?: string;
  /** 队列位置(用于前端展示) */
  position?: number;
}

class AnalysisQueueServiceClass {
  /**
   * 入队:将分析任务推入 Redis List
   * @param priority 优先级('high'=enterprise,'normal'=standard/free)
   * @returns 队列位置(剩余任务数)
   */
  async enqueue(job: AnalysisJob, priority: 'high' | 'normal' = 'normal'): Promise<number> {
    try {
      const queueKey = priority === 'high' ? QUEUE_HIGH_PRIORITY : QUEUE_NORMAL_PRIORITY;

      // 1. 存储任务状态(pending)
      const statusKey = `job:${job.id}:status`;
      const statusRecord: JobStatusRecord = {
        status: 'pending',
        enqueuedAt: job.enqueuedAt,
      };
      await redis().set(statusKey, JSON.stringify(statusRecord), 'EX', JOB_TTL_SECONDS);

      // 2. 推入队列(LPUSH,新任务在头部;Worker 用 BRPOP 从尾部取,实现 FIFO)
      const serialized = JSON.stringify(job);
      const queueLength = await redis().lpush(queueKey, serialized);

      logger.info(
        { jobId: job.id, priority, queueLength, tenantId: job.tenantId },
        '[queue] job enqueued',
      );

      return queueLength;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err: msg, jobId: job.id }, '[queue] enqueue failed');
      throw err;
    }
  }

  /**
   * 出队:Worker 阻塞读取任务
   * 优先从高优先级队列读取,其次普通队列
   *
   * @param timeoutSeconds 阻塞超时(秒),0 表示不阻塞
   * @returns 任务数据;无任务时返回 null
   */
  async dequeue(timeoutSeconds: number = 5): Promise<AnalysisJob | null> {
    try {
      // BRPOP 从队列尾部取(FIFO),支持多队列优先级
      // 优先级:high 队列先消费完,再消费 normal 队列
      const result = await redis().brpop(
        QUEUE_HIGH_PRIORITY,
        QUEUE_NORMAL_PRIORITY,
        timeoutSeconds,
      );

      if (!result) {
        return null;
      }

      const [_queueKey, serialized] = result;
      const job = JSON.parse(serialized) as AnalysisJob;

      // 更新状态为 processing
      const statusKey = `job:${job.id}:status`;
      const statusRecord: JobStatusRecord = {
        status: 'processing',
        enqueuedAt: job.enqueuedAt,
        startedAt: new Date().toISOString(),
      };
      await redis().set(statusKey, JSON.stringify(statusRecord), 'EX', JOB_TTL_SECONDS);

      logger.info({ jobId: job.id }, '[queue] job dequeued, processing');
      return job;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err: msg }, '[queue] dequeue failed');
      return null;
    }
  }

  /**
   * 标记任务完成(成功)
   * 存储结果到 Redis,供前端轮询获取
   */
  async markSuccess(jobId: string, result: unknown): Promise<void> {
    try {
      const statusKey = `job:${jobId}:status`;
      const resultKey = `job:${jobId}:result`;

      const statusRecord: JobStatusRecord = {
        status: 'success',
        enqueuedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      };

      // 使用 pipeline 批量执行
      const pipeline = redis().pipeline();
      pipeline.set(statusKey, JSON.stringify(statusRecord), 'EX', JOB_TTL_SECONDS);
      pipeline.set(resultKey, JSON.stringify(result), 'EX', JOB_TTL_SECONDS);
      await pipeline.exec();

      logger.info({ jobId: jobId }, '[queue] job completed successfully');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err: msg, jobId }, '[queue] markSuccess failed');
    }
  }

  /**
   * 标记任务失败
   */
  async markFailed(jobId: string, failureReason: string): Promise<void> {
    try {
      const statusKey = `job:${jobId}:status`;
      const statusRecord: JobStatusRecord = {
        status: 'failed',
        enqueuedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        failureReason,
      };
      await redis().set(statusKey, JSON.stringify(statusRecord), 'EX', JOB_TTL_SECONDS);

      logger.warn({ jobId, failureReason }, '[queue] job failed');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err: msg, jobId }, '[queue] markFailed failed');
    }
  }

  /**
   * 查询任务状态(供前端轮询)
   * @returns 状态记录;任务不存在返回 null
   */
  async getJobStatus(jobId: string): Promise<JobStatusRecord | null> {
    try {
      const statusKey = `job:${jobId}:status`;
      const raw = await redis().get(statusKey);
      if (!raw) {
        return null;
      }
      return JSON.parse(raw) as JobStatusRecord;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ err: msg, jobId }, '[queue] getJobStatus failed');
      return null;
    }
  }

  /**
   * 获取任务结果(任务成功后)
   * @returns 结果;不存在返回 null
   */
  async getJobResult(jobId: string): Promise<unknown | null> {
    try {
      const resultKey = `job:${jobId}:result`;
      const raw = await redis().get(resultKey);
      if (!raw) {
        return null;
      }
      return JSON.parse(raw);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ err: msg, jobId }, '[queue] getJobResult failed');
      return null;
    }
  }

  /**
   * 获取队列长度(待处理任务数)
   */
  async getQueueLength(): Promise<{ high: number; normal: number; total: number }> {
    try {
      const [high, normal] = await Promise.all([
        redis().llen(QUEUE_HIGH_PRIORITY),
        redis().llen(QUEUE_NORMAL_PRIORITY),
      ]);
      return { high, normal, total: high + normal };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ err: msg }, '[queue] getQueueLength failed');
      return { high: 0, normal: 0, total: 0 };
    }
  }

  /**
   * 检查队列是否可用(Redis 是否连通)
   * 用于决定是否走异步模式
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

export const analysisQueueService = new AnalysisQueueServiceClass();
