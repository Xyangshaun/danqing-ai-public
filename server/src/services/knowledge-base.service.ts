// ============================================================
// 艺术品知识库服务
// 从旧版 server/knowledgeBase.js 迁移,数据源 server/data/artworks.json
// 提供关键词搜索、分类查询、风格/时代筛选、风格分类配置
// 数据为静态艺术品知识库,启动时一次性加载并缓存
// ============================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type {
  ArtworkItem,
  ArtworkCategory,
  ArtType,
  StyleCategories,
  PaginatedArtworks,
} from '../types/api-contract.js';
import { logger } from '../utils/logger.js';

// ---------- 数据文件路径 ----------
// 编译产物位于 dist/services/,源码位于 src/services/
// 两种情况下 ../.. 均指向 server/,data/ 目录在其下
const __dirname = dirname(fileURLToPath(import.meta.url));
const ARTWORKS_PATH = join(__dirname, '..', '..', 'data', 'artworks.json');
const STYLE_CATEGORIES_PATH = join(__dirname, '..', '..', 'data', 'style-categories.json');

// ---------- 数据缓存(静态知识库,启动后不变) ----------
let artworksCache: ArtworkItem[] | null = null;
let styleCategoriesCache: StyleCategories | null = null;

/**
 * 加载艺术品数据(99 件)
 * 失败时抛错由调用方捕获(启动自检)
 */
function loadArtworks(): ArtworkItem[] {
  const raw = readFileSync(ARTWORKS_PATH, 'utf-8');
  const parsed = JSON.parse(raw) as ArtworkItem[];
  if (!Array.isArray(parsed)) {
    throw new Error('[knowledge-base] artworks.json 格式错误:期望数组');
  }
  return parsed;
}

/**
 * 加载风格分类配置
 */
function loadStyleCategories(): StyleCategories {
  const raw = readFileSync(STYLE_CATEGORIES_PATH, 'utf-8');
  return JSON.parse(raw) as StyleCategories;
}

/**
 * 获取艺术品列表(带缓存)
 */
function getArtworks(): ArtworkItem[] {
  if (artworksCache === null) {
    artworksCache = loadArtworks();
    logger.info({ count: artworksCache.length }, '[knowledge-base] artworks loaded');
  }
  return artworksCache;
}

/**
 * 获取风格分类配置(带缓存)
 */
function getStyleCategoriesInternal(): StyleCategories {
  if (styleCategoriesCache === null) {
    styleCategoriesCache = loadStyleCategories();
  }
  return styleCategoriesCache;
}

/**
 * 通用分页工具
 */
function paginate(
  items: ArtworkItem[],
  page: number,
  pageSize: number,
): PaginatedArtworks {
  const total = items.length;
  const safePage = Math.max(1, page);
  const safePageSize = Math.max(1, Math.min(100, pageSize));
  const start = (safePage - 1) * safePageSize;
  const paged = items.slice(start, start + safePageSize);
  return {
    items: paged,
    total,
    page: safePage,
    pageSize: safePageSize,
    hasMore: start + safePageSize < total,
  };
}

class KnowledgeBaseServiceClass {
  /**
   * 关键词搜索(匹配标题/艺术家/标签/描述,中英文)
   * @param query 搜索关键词(空串返回全部)
   * @param page 页码(从 1 开始)
   * @param pageSize 每页条数(最大 100)
   */
  searchArtworks(query: string, page = 1, pageSize = 20): PaginatedArtworks {
    const q = query.trim().toLowerCase();
    const all = getArtworks();

    const matched =
      q === ''
        ? all
        : all.filter((a) => {
            const haystack = [
              a.title,
              a.titleEn ?? '',
              a.artist,
              a.artistEn ?? '',
              a.description,
              a.style,
              a.era,
              a.tags.join(' '),
            ]
              .join(' ')
              .toLowerCase();
            return haystack.includes(q);
          });

    return paginate(matched, page, pageSize);
  }

  /**
   * 按 ID 查询艺术品
   */
  getArtworkById(id: string): ArtworkItem | null {
    if (!id) return null;
    return getArtworks().find((a) => a.id === id) ?? null;
  }

  /**
   * 按分类查询艺术品(分页)
   */
  getArtworksByCategory(
    category: ArtworkCategory,
    page = 1,
    pageSize = 20,
  ): PaginatedArtworks {
    const items = getArtworks().filter((a) => a.category === category);
    return paginate(items, page, pageSize);
  }

  /**
   * 获取风格分类配置(四类艺术作品的风格/时代/题材)
   */
  getStyleCategories(): StyleCategories {
    return getStyleCategoriesInternal();
  }

  /**
   * 按分类+风格查询艺术品
   * @param category 作品类型(四类之一)
   * @param style 风格名称(如"水墨"/"油画")
   */
  getArtworksByStyle(category: ArtType, style: string): ArtworkItem[] {
    if (!style) return [];
    return getArtworks().filter(
      (a) => a.category === category && a.style === style,
    );
  }

  /**
   * 按分类+时代查询艺术品
   * @param category 作品类型(四类之一)
   * @param era 时代名称(如"宋代"/"文艺复兴")
   */
  getArtworksByEra(category: ArtType, era: string): ArtworkItem[] {
    if (!era) return [];
    return getArtworks().filter(
      (a) => a.category === category && a.era === era,
    );
  }
}

export const knowledgeBaseService = new KnowledgeBaseServiceClass();
