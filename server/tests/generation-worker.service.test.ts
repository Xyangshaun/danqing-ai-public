// ============================================================
// GenerationWorker 单元测试(M2-T6)
// 对应源码:src/services/generation-worker.service.ts(轮询 + 防重入 + 优雅退出)
//
// 测试范围:
//   1. start:Redis 可用则启动返回 true,不可用返回 false 且不运行
//   2. 重复 start:已在运行返回 false(防重复启动)
//   3. stop:优雅停止,isRunning 变 false
//   4. 防重入:处理中(isProcessing=true)时,下一轮到点不并发调用 processQueueOnce
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { generationWorker } from '../src/services/generation-worker.service.js';
import { generationService } from '../src/services/generation.service.js';
import { generationQueueService } from '../src/services/generation-queue.service.js';

describe('GenerationWorker(后台轮询,M2-T6)', () => {
  beforeEach(() => {
    generationWorker.stop();
    vi.restoreAllMocks();
  });

  it('Redis 队列不可用 → start 返回 false 且不运行', async () => {
    vi.spyOn(generationQueueService, 'isAvailable').mockResolvedValue(false);
    const started = await generationWorker.start();
    expect(started).toBe(false);
    expect(generationWorker.isRunning()).toBe(false);
  });

  it('Redis 队列可用 → start 返回 true 且运行', async () => {
    vi.spyOn(generationQueueService, 'isAvailable').mockResolvedValue(true);
    const processSpy = vi
      .spyOn(generationService, 'processQueueOnce')
      .mockResolvedValue(0);
    const started = await generationWorker.start();
    expect(started).toBe(true);
    expect(generationWorker.isRunning()).toBe(true);
    // 启动后已触发一轮处理(队列空返回 0)
    expect(processSpy).toHaveBeenCalled();
    generationWorker.stop();
  });

  it('已在运行时重复 start → 返回 false(防重复启动)', async () => {
    vi.spyOn(generationQueueService, 'isAvailable').mockResolvedValue(true);
    vi.spyOn(generationService, 'processQueueOnce').mockResolvedValue(0);
    await generationWorker.start();
    const again = await generationWorker.start();
    expect(again).toBe(false);
    generationWorker.stop();
  });

  it('stop 后 isRunning 变 false(优雅退出)', async () => {
    vi.spyOn(generationQueueService, 'isAvailable').mockResolvedValue(true);
    vi.spyOn(generationService, 'processQueueOnce').mockResolvedValue(0);
    await generationWorker.start();
    expect(generationWorker.isRunning()).toBe(true);
    generationWorker.stop();
    expect(generationWorker.isRunning()).toBe(false);
  });

  it('防重入:处理中(isProcessing=true)时,下一轮到点不并发调用 processQueueOnce', async () => {
    vi.useFakeTimers();
    vi.spyOn(generationQueueService, 'isAvailable').mockResolvedValue(true);

    // 第一轮 processQueueOnce 返回一个可控的 pending promise(模拟长任务)
    let releaseProcessing!: () => void;
    const pendingPromise = new Promise<number>((resolve) => {
      releaseProcessing = () => resolve(1);
    });
    const processSpy = vi
      .spyOn(generationService, 'processQueueOnce')
      .mockReturnValueOnce(pendingPromise)
      .mockResolvedValue(1);

    await generationWorker.start(10);
    // 启动即触发第一轮,进入处理中(尚未完成)
    expect(processSpy).toHaveBeenCalledTimes(1);

    // 推进一个间隔(10ms):此时 isProcessing=true,应跳过,不并发调用
    await vi.advanceTimersByTimeAsync(10);
    expect(processSpy).toHaveBeenCalledTimes(1);

    // 完成第一轮后,下一轮到点再次处理(推进一个间隔)
    releaseProcessing();
    await vi.advanceTimersByTimeAsync(10);
    expect(processSpy).toHaveBeenCalledTimes(2);

    generationWorker.stop();
    vi.useRealTimers();
  });
});
