// ============================================================
// 分析结果缓存服务
// 对应文档:.trae/documents/ai-integration-design.md §4.1(结果缓存)
//
// 职责:
//   1. 计算图片 hash(SHA-256,用于缓存 key)
//   2. 按 hash + artType 缓存分析结果(避免重复分析相同图片)
//   3. 提供 cache hit/miss 统计(用于监控缓存命中率)
//
// 缓存策略:
//   - Key: ai:analysis:{hash}:{artType}
//   - TTL: 24 小时(图片内容不变则结果可复用)
//   - 仅缓存成功结果(failed 不缓存)
//   - 仅缓存 AI 增强结果(aiEnhanced=true),Jimp-only 结果也缓存但 TTL 短
//
// 性能收益:
//   - 相同图片重复分析:缓存命中 < 50ms(原 Jimp+AI ~2.5s)
//   - 教师批量查看同一作品:首次分析后,后续命中缓存
//   - 学生重传相同作品:直接返回历史结果,节省配额
// ============================================================

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { cacheService, CACHE_NAMESPACES } from './cache.service.js';
import { logger } from '../utils/logger.js';
import type { ArtType, AnalysisResult } from '../types/api-contract.js';
import type { HybridAnalysisResult } from '../types/ai-analysis.js';

/**
 * 缓存 TTL(秒)
 * - AI 增强结果:24 小时(结果稳定,可长期缓存)
 * - Jimp-only 结果:1 小时(客观数据,但可能因算法更新失效)
 */
const CACHE_TTL_AI_ENHANCED = 24 * 60 * 60; // 24h
const CACHE_TTL_JIMP_ONLY = 60 * 60; // 1h

/**
 * 缓存值结构(存储完整的分析结果 + 元数据)
 */
interface CachedAnalysisResult {
  /** 分析结果(兼容 HybridAnalysisResult) */
  result: HybridAnalysisResult | AnalysisResult;
  /** 是否 AI 增强 */
  aiEnhanced: boolean;
  /** 缓存时间戳 */
  cachedAt: string;
}

class AnalysisCacheServiceClass {
  /**
   * 计算文件的 SHA-256 hash
   * 用于生成缓存 key(相同图片内容 → 相同 hash → 缓存命中)
   */
  async computeFileHash(filePath: string): Promise<string> {
    try {
      const buffer = await fs.readFile(filePath);
      return this.computeBufferHash(buffer);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ filePath, err: msg }, '[analysis-cache] computeFileHash failed');
      throw err;
    }
  }

  /**
   * 计算 Buffer 的 SHA-256 hash
   */
  computeBufferHash(buffer: Buffer): string {
    return createHash('sha256').update(buffer).digest('hex');
  }

  /**
   * 计算 URL 的 hash(对 URL 字符串取 hash,非图片内容 hash)
   * 注意:URL 模式下无法读取图片内容,用 URL 本身作为 key
   * 局限性:同一 URL 图片内容变更不会被感知(可接受,URL 通常稳定)
   */
  computeUrlHash(url: string): string {
    return createHash('sha256').update(url, 'utf8').digest('hex');
  }

  /**
   * 生成缓存 key
   * 格式:{hash}:{artType}
   */
  private buildCacheKey(hash: string, artType: ArtType): string {
    return `${hash}:${artType}`;
  }

  /**
   * 读取缓存的分析结果
   * @returns 缓存的结果;未命中返回 null
   */
  async get(hash: string, artType: ArtType): Promise<CachedAnalysisResult | null> {
    const key = this.buildCacheKey(hash, artType);
    return cacheService.get<CachedAnalysisResult>(CACHE_NAMESPACES.AI_ANALYSIS, key);
  }

  /**
   * 写入分析结果到缓存
   * 仅缓存成功结果,按 aiEnhanced 选择不同 TTL
   */
  async set(
    hash: string,
    artType: ArtType,
    result: HybridAnalysisResult | AnalysisResult,
    aiEnhanced: boolean,
  ): Promise<void> {
    const key = this.buildCacheKey(hash, artType);
    const value: CachedAnalysisResult = {
      result,
      aiEnhanced,
      cachedAt: new Date().toISOString(),
    };
    const ttl = aiEnhanced ? CACHE_TTL_AI_ENHANCED : CACHE_TTL_JIMP_ONLY;
    await cacheService.set(CACHE_NAMESPACES.AI_ANALYSIS, key, value, ttl);

    logger.debug(
      { hash: hash.slice(0, 16), artType, aiEnhanced, ttl },
      '[analysis-cache] result cached',
    );
  }

  /**
   * 获取或分析(getOrSet 模式)
   * 缓存命中直接返回;未命中执行 loader 并回填缓存
   *
   * @param imageSource 图片源(本地路径或 URL)
   * @param artType 作品类型
   * @param isLocal 是否本地文件(true→读文件 hash;false→URL hash)
   * @param loader 缓存未命中时的分析函数
   * @returns 分析结果(缓存命中或 loader 返回)
   */
  async getOrAnalyze(
    imageSource: string,
    artType: ArtType,
    isLocal: boolean,
    loader: () => Promise<{
      result: HybridAnalysisResult | AnalysisResult;
      aiEnhanced: boolean;
    }>,
  ): Promise<{
    result: HybridAnalysisResult | AnalysisResult;
    aiEnhanced: boolean;
    cacheHit: boolean;
  }> {
    // 1. 计算 hash
    let hash: string;
    try {
      hash = isLocal
        ? await this.computeFileHash(imageSource)
        : this.computeUrlHash(imageSource);
    } catch {
      // hash 计算失败,跳过缓存直接分析
      const loaded = await loader();
      return { ...loaded, cacheHit: false };
    }

    // 2. 读缓存
    const cached = await this.get(hash, artType);
    if (cached) {
      logger.info(
        { hash: hash.slice(0, 16), artType, aiEnhanced: cached.aiEnhanced },
        '[analysis-cache] HIT, returning cached result',
      );
      return {
        result: cached.result,
        aiEnhanced: cached.aiEnhanced,
        cacheHit: true,
      };
    }

    // 3. 缓存未命中,执行分析
    logger.debug({ hash: hash.slice(0, 16), artType }, '[analysis-cache] MISS, analyzing');
    const loaded = await loader();

    // 4. 回填缓存(仅成功结果才缓存,由 loader 保证不抛异常时为成功)
    void this.set(hash, artType, loaded.result, loaded.aiEnhanced);

    return { ...loaded, cacheHit: false };
  }

  /**
   * 清除所有分析缓存(管理员操作,如评分标准更新时)
   */
  async invalidateAll(): Promise<number> {
    return cacheService.invalidateNamespace(CACHE_NAMESPACES.AI_ANALYSIS);
  }
}

export const analysisCacheService = new AnalysisCacheServiceClass();
