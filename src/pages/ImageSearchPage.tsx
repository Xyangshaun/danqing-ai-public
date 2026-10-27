// ============================================================
// ImageSearchPage - 实时图片搜索页
//
// 对应 docs/realtime-image-search-solution.md §4 前端实现
// 功能:
//   1. 顶部 sticky 搜索框 + 联想补全下拉(键盘导航)
//   2. 分类/类型筛选 chips(最小化 P0)
//   3. 响应式结果网格(useLazyImage 懒加载 + SkeletonBox 占位)
//   4. 无限滚动(IntersectionObserver sentinel)
//   5. 空状态 / 错误状态(EmptyState + 重试)
//   6. 点击卡片打开详情 modal(原图)
// ============================================================

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  memo,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import {
  Search,
  X,
  ImageOff,
  Loader2,
  Filter,
  Tag,
  ChevronDown,
  RotateCcw,
} from 'lucide-react';
import { useImageSearch } from '../hooks/useImageSearch';
import { useLazyImage } from '../hooks/useLazyImage';
import { SkeletonBox, SkeletonStyle } from '../components/PageSkeleton';
import EmptyState from '../components/EmptyState';
import type { ArtType, ImageDoc } from '../types/api-contract';

/* ============================================================
 * ImageCard - 单张图片卡片(memo + useLazyImage)
 *
 * 提取为独立组件以:
 *   1. 通过 React.memo 跳过未变化卡片的重渲染
 *   2. 使用 useLazyImage 实现图片懒加载
 *   3. 加载中显示骨架屏,失败显示 ImageOff 占位
 * ============================================================ */

interface ImageCardProps {
  image: ImageDoc;
  onSelect: (image: ImageDoc) => void;
}

const ImageCard = memo(function ImageCard({ image, onSelect }: ImageCardProps) {
  const { imgRef, loadedSrc, isLoaded, isError } = useLazyImage(image.thumbUrl);

  return (
    <div
      className="bg-rice-50 rounded-2xl overflow-hidden shadow-card hover:shadow-card-hover transition-all group cursor-pointer"
      onClick={() => onSelect(image)}
    >
      <div className="aspect-[4/3] overflow-hidden relative bg-ink-100">
        {!isLoaded && !isError && (
          <SkeletonBox className="absolute inset-0 z-10" />
        )}
        {isError ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-rice-100">
            <ImageOff className="w-10 h-10 text-ink-300 mb-2" />
            <p className="text-xs text-ink-400">加载失败</p>
          </div>
        ) : (
          <img
            ref={imgRef}
            src={loadedSrc}
            alt={image.title}
            loading="lazy"
            className={`w-full h-full object-cover group-hover:scale-105 transition-all duration-500 ${
              isLoaded ? 'opacity-100' : 'opacity-0'
            }`}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-ink-900/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
        <div className="absolute top-3 left-3 flex gap-2">
          <span className="px-2 py-0.5 bg-cinnabar/90 text-white text-xs rounded-full">
            {image.category}
          </span>
        </div>
        {image.score !== undefined && image.score > 0 && (
          <div className="absolute top-3 right-3">
            <span className="px-2 py-0.5 bg-ink-900/70 text-white text-xs rounded-full">
              相关度 {(image.score * 100).toFixed(0)}%
            </span>
          </div>
        )}
      </div>
      <div className="p-4">
        <h3 className="font-serif text-base font-bold text-ink-900 line-clamp-1">
          {image.title}
        </h3>
        {image.tags.length > 0 && (
          <div className="flex gap-1 mt-2 flex-wrap">
            {image.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="px-2 py-0.5 bg-rice-100 text-xs rounded-full text-ink-600"
              >
                {tag}
              </span>
            ))}
            {image.tags.length > 3 && (
              <span className="px-2 py-0.5 text-xs text-ink-400">
                +{image.tags.length - 3}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

/* ============================================================
 * 筛选选项(最小化 P0)
 * ============================================================ */

const CATEGORY_OPTIONS: string[] = [
  '绘画基础',
  '色彩理论',
  '构图法则',
  '素描人像',
  '速写风景',
  '设计构成',
];

const ART_TYPE_OPTIONS: { value: ArtType; label: string }[] = [
  { value: 'painting', label: '绘画' },
  { value: 'design', label: '设计' },
  { value: 'product', label: '产品' },
  { value: 'sculpture', label: '雕塑' },
];

/* ============================================================
 * ImageSearchPage 主组件
 * ============================================================ */

export default function ImageSearchPage() {
  const {
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
  } = useImageSearch({ pageSize: 24 });

  /* ---------- 联想下拉状态 ---------- */
  const [showSuggestions, setShowSuggestions] = useState<boolean>(false);
  const [activeSuggestionIdx, setActiveSuggestionIdx] = useState<number>(-1);
  const inputWrapRef = useRef<HTMLDivElement | null>(null);

  /* ---------- 选中图片(详情 modal) ---------- */
  const [selectedImage, setSelectedImage] = useState<ImageDoc | null>(null);

  /* ---------- 无限滚动 sentinel ---------- */
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  /* ---------- 详情图懒加载 ---------- */
  const {
    imgRef: detailImgRef,
    loadedSrc: detailLoadedSrc,
    isLoaded: detailIsLoaded,
    isError: detailIsError,
  } = useLazyImage(selectedImage?.fullUrl);

  /* ---------- 联想下拉:点击外部关闭 ---------- */
  useEffect(() => {
    if (!showSuggestions) return;
    const handler = (e: MouseEvent) => {
      if (
        inputWrapRef.current &&
        !inputWrapRef.current.contains(e.target as Node)
      ) {
        setShowSuggestions(false);
        setActiveSuggestionIdx(-1);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showSuggestions]);

  /* ---------- 联想下拉:键盘导航 ---------- */
  const handleInputKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLInputElement>) => {
      if (!showSuggestions || suggestions.length === 0) {
        // 无联想时,Esc 清空输入
        if (e.key === 'Escape' && query) {
          e.preventDefault();
          setQuery('');
        }
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveSuggestionIdx((prev) =>
          prev < suggestions.length - 1 ? prev + 1 : 0,
        );
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveSuggestionIdx((prev) =>
          prev > 0 ? prev - 1 : suggestions.length - 1,
        );
      } else if (e.key === 'Enter') {
        if (activeSuggestionIdx >= 0 && activeSuggestionIdx < suggestions.length) {
          e.preventDefault();
          setQuery(suggestions[activeSuggestionIdx]);
          setShowSuggestions(false);
          setActiveSuggestionIdx(-1);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setShowSuggestions(false);
        setActiveSuggestionIdx(-1);
      }
    },
    [showSuggestions, suggestions, activeSuggestionIdx, query, setQuery],
  );

  /* ---------- 选中联想词 ---------- */
  const handleSelectSuggestion = useCallback(
    (s: string) => {
      setQuery(s);
      setShowSuggestions(false);
      setActiveSuggestionIdx(-1);
    },
    [setQuery],
  );

  /* ---------- 输入框聚焦时显示联想 ---------- */
  const handleInputFocus = useCallback(() => {
    if (suggestions.length > 0) {
      setShowSuggestions(true);
    }
  }, [suggestions.length]);

  /* ---------- 清空输入 ---------- */
  const handleClearQuery = useCallback(() => {
    setQuery('');
    setShowSuggestions(false);
    setActiveSuggestionIdx(-1);
  }, [setQuery]);

  /* ---------- 无限滚动 IntersectionObserver ---------- */
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    if (typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && hasMore && !loading && !loadingMore) {
            loadMore();
          }
        }
      },
      { rootMargin: '300px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loading, loadingMore, loadMore]);

  /* ---------- 详情 modal:Esc 关闭 ---------- */
  useEffect(() => {
    if (!selectedImage) return;
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedImage(null);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedImage]);

  /* ---------- 筛选 chips 是否激活 ---------- */
  const hasActiveFilters = Boolean(category) || Boolean(artType);

  const handleClearFilters = useCallback(() => {
    setCategory(undefined);
    setArtType(undefined);
  }, [setCategory, setArtType]);

  /* ---------- 渲染 ---------- */
  return (
    <div className="min-h-screen bg-rice-200 ink-texture pt-20 pb-20">
      <SkeletonStyle />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-ink-900/5 rounded-full mb-4">
            <Search className="w-4 h-4 text-cinnabar" />
            <span className="text-sm text-ink-600">实时图片搜索</span>
          </div>
          <h1 className="font-serif text-3xl md:text-4xl font-bold text-ink-900 mb-3">
            画作素材 · 即搜即得
          </h1>
          <p className="text-ink-600 max-w-2xl mx-auto text-sm">
            基于内存倒排索引的全文检索,支持标题、标签、分类多字段加权匹配
          </p>
        </div>

        {/* Search input (sticky) */}
        <div className="sticky top-16 z-30 mb-6">
          <div
            ref={inputWrapRef}
            className="bg-rice-50 rounded-2xl shadow-card p-4 relative"
          >
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-ink-400" />
              <input
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActiveSuggestionIdx(-1);
                }}
                onFocus={handleInputFocus}
                onKeyDown={handleInputKeyDown}
                placeholder="搜索图片标题、标签、分类(支持中文)..."
                className="w-full pl-12 pr-12 py-3 border border-ink-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-cinnabar/30 focus:border-cinnabar text-sm"
                aria-label="搜索图片"
                aria-autocomplete="list"
                aria-expanded={showSuggestions}
                aria-controls="image-suggest-list"
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
                {suggestionLoading && (
                  <Loader2 className="w-4 h-4 text-ink-300 animate-spin" />
                )}
                {query && (
                  <button
                    onClick={handleClearQuery}
                    aria-label="清除搜索"
                    className="p-1 hover:bg-ink-100 rounded-full transition-colors"
                  >
                    <X className="w-4 h-4 text-ink-400" />
                  </button>
                )}
              </div>
            </div>

            {/* Autocomplete dropdown */}
            {showSuggestions && suggestions.length > 0 && (
              <ul
                id="image-suggest-list"
                role="listbox"
                className="absolute left-4 right-4 mt-2 bg-rice-50 rounded-xl shadow-overlay border border-ink-900/8 overflow-hidden z-40 max-h-80 overflow-y-auto scrollbar-thin"
              >
                {suggestions.map((s, idx) => (
                  <li
                    key={s}
                    role="option"
                    aria-selected={idx === activeSuggestionIdx}
                    onMouseEnter={() => setActiveSuggestionIdx(idx)}
                    onMouseDown={(e) => {
                      // mousedown 防止输入框失焦前触发 onClick
                      e.preventDefault();
                      handleSelectSuggestion(s);
                    }}
                    className={`flex items-center gap-2 px-4 py-2.5 text-sm cursor-pointer transition-colors ${
                      idx === activeSuggestionIdx
                        ? 'bg-cinnabar/10 text-ink-900'
                        : 'text-ink-700 hover:bg-rice-100'
                    }`}
                  >
                    <Search className="w-3.5 h-3.5 text-ink-400 flex-shrink-0" />
                    <span className="truncate">{s}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Filter chips (minimal P0) */}
        <div className="bg-rice-50 rounded-2xl p-4 shadow-card mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Filter className="w-4 h-4 text-ink-500" />
            <span className="text-sm font-medium text-ink-700">筛选条件</span>
            {hasActiveFilters && (
              <button
                onClick={handleClearFilters}
                className="ml-auto text-xs text-cinnabar hover:underline flex items-center gap-1"
              >
                <RotateCcw className="w-3 h-3" />
                清除筛选
              </button>
            )}
          </div>

          {/* 分类筛选 */}
          <div className="mb-3">
            <div className="flex items-center gap-1.5 mb-2">
              <Tag className="w-3 h-3 text-ink-500" />
              <span className="text-xs font-medium text-ink-600">分类</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {CATEGORY_OPTIONS.map((c) => (
                <button
                  key={c}
                  onClick={() =>
                    setCategory(category === c ? undefined : c)
                  }
                  className={`px-3 py-1.5 rounded-full text-sm transition-all whitespace-nowrap border ${
                    category === c
                      ? 'bg-cinnabar text-white border-cinnabar'
                      : 'bg-rice-100 text-ink-700 border-transparent hover:bg-rice-200 hover:border-ink-200'
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          {/* 作品类型筛选 */}
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <Tag className="w-3 h-3 text-ink-500" />
              <span className="text-xs font-medium text-ink-600">作品类型</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {ART_TYPE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() =>
                    setArtType(artType === opt.value ? undefined : opt.value)
                  }
                  className={`px-3 py-1.5 rounded-full text-sm transition-all whitespace-nowrap border ${
                    artType === opt.value
                      ? 'bg-cinnabar text-white border-cinnabar'
                      : 'bg-rice-100 text-ink-700 border-transparent hover:bg-rice-200 hover:border-ink-200'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Result count */}
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm text-ink-500">
            共 <span className="font-medium text-ink-900">{total}</span> 张图片
            {query.trim() && (
              <span className="ml-2 text-ink-400">
                关键词「{query.trim()}」
              </span>
            )}
          </p>
          {results.length > 0 && hasActiveFilters && (
            <button
              onClick={handleClearFilters}
              className="text-xs text-ink-400 hover:text-cinnabar transition-colors"
            >
              重置筛选
            </button>
          )}
        </div>

        {/* Results / Loading / Empty / Error */}
        {error ? (
          <div className="bg-rice-50 rounded-2xl shadow-card">
            <EmptyState
              icon={ImageOff}
              title="搜索请求失败"
              desc={error.message || '请检查网络连接后重试'}
              actionLabel="重试"
              onAction={retry}
            />
          </div>
        ) : loading && results.length === 0 ? (
          /* 首次加载骨架屏:12 张卡片占位 */
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {Array.from({ length: 12 }, (_, i) => (
              <div
                key={i}
                className="bg-rice-50 rounded-2xl overflow-hidden shadow-card"
              >
                <SkeletonBox className="aspect-[4/3] w-full" />
                <div className="p-4 space-y-2">
                  <SkeletonBox className="h-4 w-3/4" />
                  <SkeletonBox className="h-3 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : results.length === 0 ? (
          <div className="bg-rice-50 rounded-2xl shadow-card">
            <EmptyState
              icon={Search}
              title={query.trim() || hasActiveFilters ? '没有找到匹配的图片' : '图片库暂无内容'}
              desc={
                query.trim() || hasActiveFilters
                  ? '试试调整关键词或筛选条件'
                  : '请稍后再来,或联系管理员添加素材'
              }
              secondaryHint={
                query.trim() || hasActiveFilters
                  ? '提示:支持标题、标签、分类的中文模糊搜索'
                  : undefined
              }
              actionLabel={
                query.trim() || hasActiveFilters ? '重置全部' : undefined
              }
              onAction={
                query.trim() || hasActiveFilters ? reset : undefined
              }
            />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {results.map((image) => (
                <ImageCard
                  key={image.id}
                  image={image}
                  onSelect={setSelectedImage}
                />
              ))}
            </div>

            {/* 无限滚动 sentinel + 加载更多指示 */}
            <div
              ref={sentinelRef}
              className="flex items-center justify-center py-8"
              aria-hidden="true"
            >
              {loadingMore ? (
                <div className="flex items-center gap-2 text-ink-500">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-sm">加载更多...</span>
                </div>
              ) : hasMore ? (
                <div className="flex items-center gap-2 text-ink-400">
                  <ChevronDown className="w-4 h-4" />
                  <span className="text-xs">滚动加载更多</span>
                </div>
              ) : (
                <p className="text-xs text-ink-400">已加载全部 {results.length} 张图片</p>
              )}
            </div>
          </>
        )}

        {/* Detail Modal */}
        {selectedImage && (
          <div
            className="fixed inset-0 bg-ink-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setSelectedImage(null)}
          >
            <div
              className="bg-rice-50 rounded-2xl overflow-hidden max-w-5xl w-full max-h-[90vh] flex flex-col md:flex-row"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="md:w-3/5 relative bg-ink-900 flex items-center justify-center min-h-[300px]">
                {!detailIsLoaded && !detailIsError && (
                  <div className="absolute inset-0 flex items-center justify-center z-10">
                    <Loader2 className="w-10 h-10 text-rice-100 animate-spin" />
                  </div>
                )}
                {detailIsError ? (
                  <div className="flex flex-col items-center justify-center py-16">
                    <ImageOff className="w-12 h-12 text-ink-500 mb-3" />
                    <p className="text-sm text-ink-400">原图加载失败</p>
                  </div>
                ) : (
                  <img
                    ref={detailImgRef}
                    src={detailLoadedSrc}
                    alt={selectedImage.title}
                    loading="lazy"
                    className={`w-full h-full object-contain max-h-[60vh] md:max-h-[80vh] transition-opacity duration-500 ${
                      detailIsLoaded ? 'opacity-100' : 'opacity-0'
                    }`}
                  />
                )}
                <div className="absolute top-3 left-3 flex gap-2">
                  <span className="px-2 py-1 bg-cinnabar text-white text-sm rounded-full">
                    {selectedImage.category}
                  </span>
                </div>
              </div>
              <div className="md:w-2/5 p-6 overflow-y-auto max-h-[40vh] md:max-h-[80vh] scrollbar-thin">
                <div className="flex items-start justify-between mb-4">
                  <h2 className="font-serif text-2xl font-bold text-ink-900">
                    {selectedImage.title}
                  </h2>
                  <button
                    onClick={() => setSelectedImage(null)}
                    aria-label="关闭"
                    className="p-2 hover:bg-rice-100 rounded-full transition-all"
                  >
                    <X className="w-5 h-5 text-ink-700" />
                  </button>
                </div>

                {selectedImage.tags.length > 0 && (
                  <div className="mb-4">
                    <p className="text-sm font-medium text-ink-700 mb-2">标签</p>
                    <div className="flex flex-wrap gap-2">
                      {selectedImage.tags.map((tag) => (
                        <span
                          key={tag}
                          className="px-3 py-1 bg-rice-100 text-ink-700 text-sm rounded-full"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="bg-rice-50 rounded-lg p-3 border border-ink-900/6">
                    <p className="text-xs text-ink-500">分类</p>
                    <p className="text-sm font-medium text-ink-700">
                      {selectedImage.category}
                    </p>
                  </div>
                  <div className="bg-rice-50 rounded-lg p-3 border border-ink-900/6">
                    <p className="text-xs text-ink-500">尺寸</p>
                    <p className="text-sm font-medium text-ink-700">
                      {selectedImage.meta.width} × {selectedImage.meta.height}
                    </p>
                  </div>
                  <div className="bg-rice-50 rounded-lg p-3 border border-ink-900/6">
                    <p className="text-xs text-ink-500">状态</p>
                    <p className="text-sm font-medium text-ink-700">
                      {selectedImage.status === 'published'
                        ? '已发布'
                        : selectedImage.status === 'draft'
                        ? '草稿'
                        : '已归档'}
                    </p>
                  </div>
                  <div className="bg-rice-50 rounded-lg p-3 border border-ink-900/6">
                    <p className="text-xs text-ink-500">体积</p>
                    <p className="text-sm font-medium text-ink-700">
                      {(selectedImage.meta.size / 1024).toFixed(1)} KB
                    </p>
                  </div>
                </div>

                {selectedImage.fullUrl && (
                  <a
                    href={selectedImage.fullUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 w-full px-4 py-2.5 bg-ink-900 text-white rounded-lg hover:bg-cinnabar transition-all text-sm font-medium"
                  >
                    查看原图
                  </a>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
