// ============================================================
// 通用 Redis 缓存服务
// 对应文档:.trae/documents/ai-integration-design.md §4(性能优化)
//
// 职责:
//   1. 提供 get/set/del 基础操作(带 TTL)
//   2. 提供 getOrSet 模式(缓存未命中时执行 loader 并回填)
//   3. 提供带命名空间的 key 管理(避免 key 冲突)
//   4. Redis 不可达时优雅降级(不阻塞主流程)
//
// 设计原则:
//   - 缓存是性能优化手段,不是数据持久化
//   - 缓存失败不影响业务逻辑,仅记录日志
//   - 所有缓存 key 带命名空间前缀,便于管理与清理
//   - TTL 默认 1 小时,可按场景覆盖
// ============================================================

import { redis } from '../config/redis.js';
import { logger } from '../utils/logger.js';

/**
 * 默认 TTL(秒):1 小时
 */
const DEFAULT_TTL_SECONDS = 3600;

/**
 * 缓存命名空间(避免不同业务 key 冲突)
 */
export const CACHE_NAMESPACES = {
  /** AI 分析结果缓存(按图片 hash + artType) */
  AI_ANALYSIS: 'ai:analysis',
  /** 用户会话缓存 */
  USER_SESSION: 'user:session',
  /** 租户信息缓存 */
  TENANT_INFO: 'tenant:info',
  /** 计划配置缓存 */
  PLAN_CONFIG: 'plan:config',
  /** 热门艺术品缓存 */
  ARTWORK_HOT: 'artwork:hot',
} as const;

class CacheServiceClass {
  /**
   * 构造带命名空间的 key
   */
  private buildKey(namespace: string, key: string): string {
    return `${namespace}:${key}`;
  }

  /**
   * 获取缓存值(JSON 反序列化)
   * @returns 缓存值;未命中或出错返回 null
   */
  async get<T>(namespace: string, key: string): Promise<T | null> {
    try {
      const fullKey = this.buildKey(namespace, key);
      const raw = await redis().get(fullKey);
      if (raw === null) {
        return null;
      }
      return JSON.parse(raw) as T;
    } catch (err) {
      // 缓存读取失败不阻塞业务,记录日志后返回 null
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ namespace, key, err: msg }, '[cache] get failed, degrade to null');
      return null;
    }
  }

  /**
   * 设置缓存值(JSON 序列化,带 TTL)
   * @param ttlSeconds TTL(秒),默认 1 小时
   */
  async set<T>(namespace: string, key: string, value: T, ttlSeconds: number = DEFAULT_TTL_SECONDS): Promise<void> {
    try {
      const fullKey = this.buildKey(namespace, key);
      const serialized = JSON.stringify(value);
      await redis().set(fullKey, serialized, 'EX', ttlSeconds);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ namespace, key, err: msg }, '[cache] set failed, skip caching');
    }
  }

  /**
   * 删除缓存
   */
  async del(namespace: string, key: string): Promise<void> {
    try {
      const fullKey = this.buildKey(namespace, key);
      await redis().del(fullKey);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ namespace, key, err: msg }, '[cache] del failed');
    }
  }

  /**
   * 获取或设置缓存(getOrSet 模式)
   * 缓存未命中时执行 loader 获取值,并回填缓存
   *
   * @param namespace 缓存命名空间
   * @param key 缓存 key
   * @param loader 缓存未命中时的数据加载函数
   * @param ttlSeconds TTL(秒)
   * @returns 缓存值或 loader 返回值
   */
  async getOrSet<T>(
    namespace: string,
    key: string,
    loader: () => Promise<T>,
    ttlSeconds: number = DEFAULT_TTL_SECONDS,
  ): Promise<T> {
    // 1. 先读缓存
    const cached = await this.get<T>(namespace, key);
    if (cached !== null) {
      logger.debug({ namespace, key }, '[cache] hit');
      return cached;
    }

    // 2. 缓存未命中,执行 loader
    logger.debug({ namespace, key }, '[cache] miss, executing loader');
    const value = await loader();

    // 3. 回填缓存(异步,不阻塞返回)
    // 注意:不 await,让回填在后台执行,加快响应速度
    void this.set(namespace, key, value, ttlSeconds);

    return value;
  }

  /**
   * 批量删除某命名空间下的所有 key(按 pattern)
   * 谨慎使用:SCAN + DEL,大 key 空间下可能耗时
   */
  async invalidateNamespace(namespace: string): Promise<number> {
    try {
      const pattern = `${namespace}:*`;
      let cursor = '0';
      let deletedCount = 0;

      do {
        // 使用 SCAN 避免阻塞 Redis(不用 KEYS)
        const [nextCursor, keys] = await redis().scan(
          cursor,
          'MATCH',
          pattern,
          'COUNT',
          100,
        );
        cursor = nextCursor;

        if (keys.length > 0) {
          await redis().del(...keys);
          deletedCount += keys.length;
        }
      } while (cursor !== '0');

      logger.info({ namespace, deletedCount }, '[cache] namespace invalidated');
      return deletedCount;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ namespace, err: msg }, '[cache] invalidateNamespace failed');
      return 0;
    }
  }

  /**
   * 检查缓存是否可用(Redis 是否连通)
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

export const cacheService = new CacheServiceClass();
