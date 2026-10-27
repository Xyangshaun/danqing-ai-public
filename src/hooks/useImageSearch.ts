// ============================================================
// useImageSearch - 实时图片搜索 Hook
//
// 设计目标(对应 docs/realtime-image-search-solution.md §4 前端策略):
//   1. 防抖 200ms:避免快速输入触发大量请求
//   2. 竞态防护:每次搜索递增 requestId,仅最新请求的结果会被提交
//      (api.ts 的 request 不暴露 AbortSignal,用 requestId 过期令牌替代,
//       既防止竞态又避免侵入修改 transport 层)
//   3. 联想补全:独立 300ms 防抖,与搜索请求互不干扰
//   4. 无限滚动:维护 page 状态,loadMore 追加结果
//   5. 错误隔离:搜索/联想/加载更多各自独立的 error 状态
//   6. 卸载清理:cancelled 标志位防止卸载后 setState
//
// 使用约定:
//   const {
//     query, setQuery,
//     results, loading, error, hasMore, loadMore,
//     suggestions,
//     category, setCategory, artType, setArtType,
//     retry, reset,
//   } = useImageSearch({ pageSize: 24 });
// ============================================================

import { useState, useEffect, useRef, useCallback } from 'react';
import { searchImages, suggestImages } from '../services/api';
import { withAppBase } from '../services/artworksDatabase';
import type {
  ArtType,
  ImageDoc,
  ImageSearchQuery,
} from '../types/api-contract';

/**
 * 规范化后端返回的图片 URL(2026-08-08 修复):
 * 后端种子/条目存储根绝对路径(如 /images/artworks-real/...),
 * 生产环境应用挂载在 /app 子路径,直接请求根路径会命中官网 SPA 兜底
 * 返回 text/html 导致图片解码失败(裂图)。此处统一补 base 前缀,
 * http(s) 外链与 data: URI 不受影响(withAppBase 内部已判空)。
 */
function normalizeImageDoc(doc: ImageDoc): ImageDoc {
  return {
    ...doc,
    thumbUrl: withAppBase(doc.thumbUrl),
    fullUrl: withAppBase(doc.fullUrl),
  };
}

/** 搜索防抖(200ms,对应设计文档 §4 表格) */
const SEARCH_DEBOUNCE_MS = 200;
/** 联想防抖(300ms,联想请求更轻,但避免按键即查) */
const SUGGEST_DEBOUNCE_MS = 300;
/** 默认每页数量 */
const DEFAULT_PAGE_SIZE = 24;

/* ============================================================
 * 日志埋点(网络请求 + 渲染性能排查)
 * ------------------------------------------------------------
 * 启用方式:
 *   - 开发环境(dev)默认开启
 *   - 生产环境:浏览器控制台执行 localStorage.setItem('imgsearch-debug', '1')
 *   - 关闭:localStorage.removeItem('imgsearch-debug')
 *
 * 日志通道:console.debug(默认折叠,不影响生产控制台)
 * 前缀:[ImgSearch:<phase>],便于 DevTools Console 过滤
 *
 * 关键 phase:
 *   debounce       防抖触发(关键词/筛选变化)
 *   search-start   发起搜索请求(含 page/params)
 *   search-success 搜索成功(含 count/total/hasMore/durationMs)
 *   search-stale   竞态丢弃(旧请求晚到)
 *   search-error   搜索失败(含 error/durationMs)
 *   load-more      无限滚动触发(含 nextPage/skip 原因)
 *   suggest-start  发起联想请求
 *   suggest-success联想成功
 *   suggest-error  联想失败
 * ============================================================ */
const IMG_SEARCH_DEBUG: boolean =
  typeof window !== 'undefined' &&
  typeof localStorage !== 'undefined' &&
  (import.meta.env.DEV ||
    localStorage.getItem('imgsearch-debug') === '1');

interface LogPayload {
  [key: string]: unknown;
}

function logImg(phase: string, payload: LogPayload): void {
  if (!IMG_SEARCH_DEBUG) return;
  // eslint-disable-next-line no-console
  console.debug(
    `%c[ImgSearch:${phase}]`,
    'color:#c0392b;font-weight:bold',
    { ts: new Date().toISOString(), ...payload },
  );
}

export interface UseImageSearchParams {
  /** 初始关键词 */
  initialQuery?: string;
  /** 初始分类筛选 */
  initialCategory?: string;
  /** 初始作品类型筛选 */
  initialArtType?: ArtType;
  /** 每页数量,默认 24 */
  pageSize?: number;
}

export interface UseImageSearchResult {
  /** 当前输入框值(未防抖) */
  query: string;
  /** 设置输入框值 */
  setQuery: (q: string) => void;
  /** 搜索结果(累积所有已加载页) */
  results: ImageDoc[];
  /** 总匹配数(服务端返回) */
  total: number;
  /** 首次加载中 */
  loading: boolean;
  /** 加载更多中 */
  loadingMore: boolean;
  /** 首次加载错误(加载更多错误不覆盖此状态) */
  error: Error | null;
  /** 是否还有更多页 */
  hasMore: boolean;
  /** 加载下一页(无限滚动触发) */
  loadMore: () => void;
  /** 分类筛选 */
  category: string | undefined;
  setCategory: (c: string | undefined) => void;
  /** 作品类型筛选 */
  artType: ArtType | undefined;
  setArtType: (a: ArtType | undefined) => void;
  /** 联想补全候选词 */
  suggestions: string[];
  /** 联想加载中 */
  suggestionLoading: boolean;
  /** 重试上次失败的搜索 */
  retry: () => void;
  /** 重置全部状态(清空关键词 + 结果) */
  reset: () => void;
}

/**
 * 实时图片搜索 Hook
 *
 * 竞态防护策略:
 *   - 每次 q/category/artType 变化触发新搜索时,searchRequestIdRef 自增
 *   - 异步回调中比较捕获的 requestId 与当前最新值,不一致则丢弃结果
 *   - 这等价于 AbortController 的"忽略已发出请求的响应",但无需修改
 *     api.ts 暴露 signal(transport 层保持纯净)
 *
 * 无限滚动:
 *   - results 累积所有已加载页的 items
 *   - hasMore 来自服务端响应
 *   - loadMore 触发下一页请求(用 loadingMore 状态区分)
 *   - 筛选条件变化时重置 page=1,清空 results
 */
export function useImageSearch(
  params: UseImageSearchParams = {},
): UseImageSearchResult {
  const {
    initialQuery = '',
    initialCategory,
    initialArtType,
    pageSize = DEFAULT_PAGE_SIZE,
  } = params;

  const [query, setQuery] = useState<string>(initialQuery);
  const [debouncedQuery, setDebouncedQuery] = useState<string>(initialQuery);
  const [category, setCategory] = useState<string | undefined>(initialCategory);
  const [artType, setArtType] = useState<ArtType | undefined>(initialArtType);

  const [results, setResults] = useState<ImageDoc[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [loadingMore, setLoadingMore] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);
  const [hasMore, setHasMore] = useState<boolean>(false);

  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggestionLoading, setSuggestionLoading] = useState<boolean>(false);

  const pageRef = useRef<number>(1);
  const searchRequestIdRef = useRef<number>(0);
  const suggestRequestIdRef = useRef<number>(0);
  const mountedRef = useRef<boolean>(true);
  const lastSearchParamsRef = useRef<{
    q: string;
    category: string | undefined;
    artType: ArtType | undefined;
  }>({ q: debouncedQuery, category, artType });

  // 卸载标志:防止卸载后 setState 导致 React 警告
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // ---------- 搜索防抖 ----------
  useEffect(() => {
    const timer = window.setTimeout(() => {
      logImg('debounce', { to: query, delayMs: SEARCH_DEBOUNCE_MS });
      setDebouncedQuery(query);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  // ---------- 联想防抖 ----------
  useEffect(() => {
    // 空关键词或以空格为主时,不发起联想
    const trimmed = query.trim();
    if (!trimmed) {
      setSuggestions([]);
      setSuggestionLoading(false);
      return;
    }

    setSuggestionLoading(true);
    const requestId = ++suggestRequestIdRef.current;
    const timer = window.setTimeout(async () => {
      const suggestStart = performance.now();
      logImg('suggest-start', { q: trimmed, limit: 8, requestId });
      try {
        const resp = await suggestImages(trimmed, 8);
        const durationMs = Math.round(performance.now() - suggestStart);
        // 仅最新请求的结果会被提交
        if (!mountedRef.current || requestId !== suggestRequestIdRef.current) {
          logImg('suggest-stale', {
            q: trimmed,
            requestId,
            latestRequestId: suggestRequestIdRef.current,
            durationMs,
          });
          return;
        }
        setSuggestions(resp.suggestions ?? []);
        logImg('suggest-success', {
          q: trimmed,
          count: resp.suggestions?.length ?? 0,
          durationMs,
        });
      } catch (err) {
        const durationMs = Math.round(performance.now() - suggestStart);
        // 联想失败静默处理(不打断主搜索,不抛错)
        if (!mountedRef.current || requestId !== suggestRequestIdRef.current) {
          return;
        }
        setSuggestions([]);
        logImg('suggest-error', {
          q: trimmed,
          error: err instanceof Error ? err.message : String(err),
          durationMs,
        });
      } finally {
        if (mountedRef.current && requestId === suggestRequestIdRef.current) {
          setSuggestionLoading(false);
        }
      }
    }, SUGGEST_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [query]);

  // ---------- 主搜索:debouncedQuery / category / artType 变化触发 ----------
  const performSearch = useCallback(
    async (pageNum: number, append: boolean) => {
      const requestId = ++searchRequestIdRef.current;
      lastSearchParamsRef.current = { q: debouncedQuery, category, artType };
      const searchStart = performance.now();

      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
        setError(null);
      }

      const searchQuery: ImageSearchQuery = {
        q: debouncedQuery.trim() || undefined,
        category,
        artType,
        page: pageNum,
        pageSize,
      };

      logImg('search-start', {
        requestId,
        append,
        page: pageNum,
        pageSize,
        q: searchQuery.q,
        category: searchQuery.category,
        artType: searchQuery.artType,
      });

      try {
        const resp = await searchImages(searchQuery);
        const durationMs = Math.round(performance.now() - searchStart);
        // 竞态防护:仅最新请求的结果会被提交
        if (!mountedRef.current || requestId !== searchRequestIdRef.current) {
          logImg('search-stale', {
            requestId,
            latestRequestId: searchRequestIdRef.current,
            append,
            page: pageNum,
            durationMs,
            reason: 'unmounted-or-superseded',
          });
          return;
        }
        // 防止筛选条件已变化但旧请求晚到:校验捕获的参数与当前一致
        const latest = lastSearchParamsRef.current;
        if (
          latest.q !== debouncedQuery ||
          latest.category !== category ||
          latest.artType !== artType
        ) {
          logImg('search-stale', {
            requestId,
            append,
            page: pageNum,
            durationMs,
            reason: 'params-changed',
            captured: { q: debouncedQuery, category, artType },
            latest,
          });
          return;
        }

        const items = (resp.items ?? []).map(normalizeImageDoc);
        const itemCount = items.length;
        if (append) {
          setResults((prev) => [...prev, ...items]);
        } else {
          setResults(items);
        }
        setTotal(resp.total ?? 0);
        setHasMore(Boolean(resp.hasMore));
        pageRef.current = pageNum;

        logImg('search-success', {
          requestId,
          append,
          page: pageNum,
          itemCount,
          total: resp.total,
          hasMore: resp.hasMore,
          durationMs,
          accumulated: append ? undefined : itemCount,
        });
      } catch (err) {
        const durationMs = Math.round(performance.now() - searchStart);
        if (!mountedRef.current || requestId !== searchRequestIdRef.current) {
          return;
        }
        const e = err instanceof Error ? err : new Error(String(err));
        // 加载更多失败不覆盖首次加载的 error(避免误显示)
        if (!append) {
          setError(e);
        }
        logImg('search-error', {
          requestId,
          append,
          page: pageNum,
          error: e.message,
          durationMs,
        });
      } finally {
        if (mountedRef.current && requestId === searchRequestIdRef.current) {
          if (append) {
            setLoadingMore(false);
          } else {
            setLoading(false);
          }
        }
      }
    },
    [debouncedQuery, category, artType, pageSize],
  );

  // 首次加载 + 筛选条件变化时触发搜索
  useEffect(() => {
    logImg('trigger', {
      reason: 'params-change',
      q: debouncedQuery,
      category,
      artType,
    });
    performSearch(1, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery, category, artType, pageSize]);

  // ---------- 无限滚动:加载下一页 ----------
  const loadMore = useCallback(() => {
    const nextPage = pageRef.current + 1;
    if (!hasMore) {
      logImg('load-more', { skip: true, reason: 'no-more', nextPage });
      return;
    }
    if (loading) {
      logImg('load-more', { skip: true, reason: 'first-loading', nextPage });
      return;
    }
    if (loadingMore) {
      logImg('load-more', { skip: true, reason: 'already-loading-more', nextPage });
      return;
    }
    logImg('load-more', {
      skip: false,
      nextPage,
      currentPage: pageRef.current,
      currentCount: results.length,
    });
    performSearch(nextPage, true);
  }, [performSearch, loadingMore, loading, hasMore, results.length]);

  // ---------- 重试 ----------
  const retry = useCallback(() => {
    performSearch(1, false);
  }, [performSearch]);

  // ---------- 重置 ----------
  const reset = useCallback(() => {
    setQuery('');
    setDebouncedQuery('');
    setCategory(undefined);
    setArtType(undefined);
    setResults([]);
    setSuggestions([]);
    setError(null);
    setTotal(0);
    setHasMore(false);
    pageRef.current = 1;
    searchRequestIdRef.current++;
  }, []);

  return {
    query,
    setQuery,
    results,
    total,
    loading,
    loadingMore,
    error,
    hasMore,
    loadMore,
    category,
    setCategory,
    artType,
    setArtType,
    suggestions,
    suggestionLoading,
    retry,
    reset,
  };
}

export default useImageSearch;
