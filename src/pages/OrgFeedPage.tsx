// ============================================================
// OrgFeedPage — 组织动态流
//
// 功能:
//   - 顶部:组织名称 + 动态总数
//   - 筛选:全部 / 绘画 / 设计 / 产品 / 雕塑
//   - 列表:SharedWorkCard(置顶项由后端排序保证靠前)
//   - 分页:IntersectionObserver 自动加载 + 手动按钮降级
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { Users, Loader2, RefreshCw, Brush, PenTool, Box, Layers, LayoutGrid } from 'lucide-react';
import { listOrgFeed, ApiError } from '../services/api';
import type { ArtType, SharedWorkItem } from '../types/api-contract';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../components/ToastProvider';
import SharedWorkCard from '../components/org/SharedWorkCard';

const PAGE_SIZE = 10;

const FILTERS: Array<{ id: ArtType | 'all'; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'all', label: '全部', icon: LayoutGrid },
  { id: 'painting', label: '绘画', icon: Brush },
  { id: 'design', label: '设计', icon: PenTool },
  { id: 'product', label: '产品', icon: Box },
  { id: 'sculpture', label: '雕塑', icon: Layers },
];

export default function OrgFeedPage() {
  const { tenant } = useAuth();
  const toast = useToast();
  /* toast 引用在部分 Provider 实现中不稳定;经 ref 透传,避免 fetchPage 依赖 toast
     导致每次渲染重建并反复触发 useEffect 请求 */
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const [workType, setWorkType] = useState<ArtType | 'all'>('all');
  const [items, setItems] = useState<SharedWorkItem[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  /* 防止 IntersectionObserver 在加载中重复触发 */
  const fetchingRef = useRef(false);

  const fetchPage = useCallback(
    async (targetPage: number, type: ArtType | 'all', append: boolean) => {
      if (fetchingRef.current) return;
      fetchingRef.current = true;
      if (append) setLoadingMore(true);
      else {
        setLoading(true);
        setError(null);
      }
      try {
        const res = await listOrgFeed({
          page: targetPage,
          pageSize: PAGE_SIZE,
          workType: type === 'all' ? undefined : type,
        });
        setItems((prev) => (append ? [...prev, ...res.items] : res.items));
        setTotal(res.total);
        setHasMore(res.hasMore);
        setPage(targetPage);
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : '网络异常,请稍后重试';
        if (append) {
          toastRef.current.error('加载失败', msg);
        } else {
          setError(msg);
        }
      } finally {
        fetchingRef.current = false;
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [],
  );

  /* 筛选变化:重置到第一页 */
  useEffect(() => {
    void fetchPage(1, workType, false);
  }, [workType, fetchPage]);

  /* 无限滚动:哨兵元素进入视口时加载下一页 */
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasMore && !loading && !loadingMore) {
          void fetchPage(page + 1, workType, true);
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loading, loadingMore, page, workType, fetchPage]);

  /** 卡片变更(置顶/删除)后静默刷新当前列表(回到第一页) */
  const handleChanged = useCallback(() => {
    void fetchPage(1, workType, false);
  }, [fetchPage, workType]);

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">
      {/* 页头 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-cinnabar/10 flex items-center justify-center">
            <Users className="w-5 h-5 text-cinnabar" />
          </div>
          <div>
            <h1 className="font-serif text-xl font-bold text-ink-900">
              {tenant?.name ?? '组织'} · 动态
            </h1>
            <p className="text-xs text-ink-400 mt-0.5">
              {total > 0 ? `${total} 条分享 · 同学互鉴,教学相长` : '同学互鉴,教学相长'}
            </p>
          </div>
        </div>
        <button
          onClick={() => void fetchPage(1, workType, false)}
          disabled={loading}
          aria-label="刷新"
          title="刷新动态流"
          className="p-2 text-ink-400 hover:text-ink-700 hover:bg-ink-900/5 rounded-lg transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* 类型筛选 */}
      <div className="flex items-center gap-2 overflow-x-auto scrollbar-thin pb-1">
        {FILTERS.map((f) => {
          const Icon = f.icon;
          const active = workType === f.id;
          return (
            <button
              key={f.id}
              onClick={() => setWorkType(f.id)}
              aria-pressed={active}
              className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-all ${
                active
                  ? 'bg-ink-900 text-rice-100 shadow-subtle'
                  : 'bg-rice-50 text-ink-600 hover:bg-ink-900/5 border border-ink-900/8'
              }`}
            >
              <Icon className={`w-3.5 h-3.5 ${active ? 'text-cinnabar-light' : ''}`} />
              {f.label}
            </button>
          );
        })}
      </div>

      {/* 内容区 */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 text-ink-400">
          <Loader2 className="w-6 h-6 animate-spin mb-3" />
          <p className="text-sm">正在加载组织动态…</p>
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-sm text-cinnabar mb-3">{error}</p>
          <button
            onClick={() => void fetchPage(1, workType, false)}
            className="inline-flex items-center gap-2 px-4 h-9 bg-ink-900 text-rice-100 text-sm rounded-lg hover:bg-cinnabar transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            重试
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-14 h-14 rounded-full bg-ink-900/5 flex items-center justify-center mb-4">
            <Users className="w-7 h-7 text-ink-300" />
          </div>
          <p className="text-sm font-medium text-ink-700 mb-1">
            {workType === 'all' ? '还没有分享' : '该类型下还没有分享'}
          </p>
          <p className="text-xs text-ink-400 max-w-xs leading-relaxed">
            完成一次 AI 诊断后,在结果页点击「分享到组织」,你的作品就会出现在这里
          </p>
        </div>
      ) : (
        <>
          <div className="space-y-5">
            {items.map((item) => (
              <SharedWorkCard key={item.id} item={item} onChanged={handleChanged} />
            ))}
          </div>

          {/* 哨兵 + 加载更多 */}
          <div ref={sentinelRef} className="h-px" />
          <div className="flex justify-center pt-2 pb-6">
            {loadingMore ? (
              <span className="inline-flex items-center gap-2 text-sm text-ink-400">
                <Loader2 className="w-4 h-4 animate-spin" />
                加载中…
              </span>
            ) : hasMore ? (
              <button
                onClick={() => void fetchPage(page + 1, workType, true)}
                className="px-5 h-9 text-sm font-medium text-ink-600 hover:text-ink-900 bg-rice-50 hover:bg-ink-900/5 border border-ink-900/8 rounded-lg transition-colors"
              >
                加载更多
              </button>
            ) : items.length > 3 ? (
              <p className="text-xs text-ink-300">已经到底啦</p>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
