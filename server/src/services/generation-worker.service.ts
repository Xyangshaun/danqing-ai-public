// ============================================================
// AI 图像生成后台 Worker(M2-T6)
// 对应文档:.trae/documents/m2-generation-plan-2026-08-07.md §2.3(异步任务)
// 职责:
//   1. startGenerationWorker:启动轮询循环(递归 setTimeout),每轮调用
//      generationService.processQueueOnce() 处理 1 个队列任务
//   2. stopGenerationWorker:停止轮询(优雅退出时调用)
//
// 设计要点:
//   - 递归 setTimeout(而非 setInterval):若单轮处理耗时超过间隔,不会叠加触发,
//     天然避免"处理中又起新轮次"
//   - 防重入锁(isProcessing):processQueueOnce 处理期间,即使下一轮到点也跳过,
//     防止同一进程内两个循环并发处理(双重保险)
//   - 轮询间隔建议 1-2s(默认 1000ms);生成频率低(单用户 5 次/分钟),开销极小
//   - 仅处理队列中的任务,不阻塞主 HTTP 服务(所有 await 均异步,不占用事件循环长任务)
//
// 优雅退出:
//   - stopGenerationWorker() 置 stopped 标志并清空 pending timer,处理中任务让其自然结束
//   - 挂到 index.ts 的 gracefulShutdown(closeRedis/closePrisma 之前)
//
// 安全:
//   - 日志不记录敏感信息(仅 taskId/状态/耗时)
//   - Worker 仅在"生成功能开启"时启动(由 index.ts 用 isGenerationEnabled 判定)
// ============================================================

import { generationService } from './generation.service.js';
import { generationQueueService } from './generation-queue.service.js';
import { logger } from '../utils/logger.js';

class GenerationWorkerClass {
  /** 轮询定时器句柄(递归 setTimeout) */
  private timer: NodeJS.Timeout | null = null;
  /** 是否已停止(true=已停止,不再调度下一轮) */
  private stopped = true;
  /** 防重入锁:true 表示当前正有一轮在处理队列 */
  private isProcessing = false;
  /** 轮询间隔(毫秒) */
  private intervalMs = 1000;

  /**
   * 启动轮询 Worker
   * @param intervalMs 轮询间隔(毫秒),默认 1000(1s)
   * @returns true=已启动;false=已在运行或 Redis 队列不可用
   */
  async start(intervalMs: number = 1000): Promise<boolean> {
    if (!this.stopped) {
      logger.warn('[generation-worker] already running, skip start');
      return false;
    }

    // 前置检查:Redis 队列必须可用,否则 Worker 无法出队,不启动
    const available = await generationQueueService.isAvailable();
    if (!available) {
      logger.warn('[generation-worker] redis queue unavailable, worker not started');
      return false;
    }

    this.intervalMs = intervalMs;
    this.stopped = false;
    this.isProcessing = false;
    void this.tick();
    logger.info(
      { intervalMs: this.intervalMs },
      '[generation-worker] started',
    );
    return true;
  }

  /**
   * 单轮轮询(内部)
   * 逻辑:若已停止则返回;若正在处理则跳过本轮稍后重试;否则处理 1 个任务后调度下一轮
   */
  private async tick(): Promise<void> {
    if (this.stopped) return;

    // 防重入:上一轮仍在处理,跳过本轮(不并发),稍后按间隔再试
    if (this.isProcessing) {
      this.schedule();
      return;
    }

    this.isProcessing = true;
    try {
      await generationService.processQueueOnce();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // 单轮失败不影响 Worker 存活,记录后继续下一轮
      logger.error({ err: msg }, '[generation-worker] processQueueOnce error');
    } finally {
      this.isProcessing = false;
      this.schedule();
    }
  }

  /**
   * 调度下一轮(仅当未停止时)
   */
  private schedule(): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.tick(), this.intervalMs);
  }

  /**
   * 停止轮询(优雅退出)
   * 置停止标志并清空 pending timer;处理中的任务让其自然完成
   */
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    logger.info('[generation-worker] stopped');
  }

  /**
   * 是否在运行(供测试/状态检查)
   */
  isRunning(): boolean {
    return !this.stopped;
  }
}

export const generationWorker = new GenerationWorkerClass();
