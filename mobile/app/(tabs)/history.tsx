// 丹青有AI 历史 Tab
// - @shopify/flash-list 渲染 GET /analyses 分页数据
// - 下拉刷新(RefreshControl)/ 上拉加载更多(onEndReached)
// - 顶部 artType 筛选(横向 chip 行)
// - 每项 AnalysisListItemCard,点击跳 /analysis/[id]
// - 空态 / 未登录 / 错误态 分别处理
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useAuthStore } from '../../src/store';
import { listAnalyses } from '../../src/services/analyses';
import { ApiError } from '../../src/services/api';
import { AnalysisListItemCard } from '../../src/components/AnalysisListItemCard';
import { EmptyState } from '../../src/components/EmptyState';
import type { AnalysisListItem, ArtType } from '../../src/types/api-contract';
import {
  InkColor,
  PaperColor,
  StoneBlueColor,
} from '../../src/theme/colors';

const PAGE_SIZE = 10;

type FilterValue = ArtType | 'all';
const FILTERS: { label: string; value: FilterValue }[] = [
  { label: '全部', value: 'all' },
  { label: '绘画', value: 'painting' },
  { label: '设计', value: 'design' },
  { label: '产品', value: 'product' },
  { label: '雕塑', value: 'sculpture' },
];

export default function HistoryTab() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [items, setItems] = useState<AnalysisListItem[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterValue>('all');

  const fetchPage = useCallback(
    async (p: number, artType: FilterValue, replace: boolean) => {
      if (replace) {
        setRefreshing(true);
      } else {
        setLoadingMore(true);
      }
      setError(null);
      try {
        const res = await listAnalyses({
          page: p,
          pageSize: PAGE_SIZE,
          ...(artType !== 'all' ? { artType } : {}),
        });
        setItems((prev) => (replace ? res.items : [...prev, ...res.items]));
        setPage(p);
        setHasMore(res.hasMore);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : '加载失败,请稍后重试');
      } finally {
        setRefreshing(false);
        setLoadingMore(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!isAuthenticated) {
      setItems([]);
      setHasMore(false);
      setError(null);
      return;
    }
    fetchPage(1, filter, true);
    // 切换筛选 / 登录态变化时重新拉首页
  }, [isAuthenticated, filter, fetchPage]);

  const onRefresh = () => {
    if (!isAuthenticated) return;
    fetchPage(1, filter, true);
  };
  const onEndReached = () => {
    if (!isAuthenticated || !hasMore || refreshing || loadingMore) return;
    fetchPage(page + 1, filter, false);
  };
  const onItemPress = (id: string) => {
    router.push(`/analysis/${id}`);
  };

  const renderItem = ({ item }: { item: AnalysisListItem }) => (
    <AnalysisListItemCard item={item} onPress={onItemPress} />
  );

  const ListEmpty = () => {
    if (!isAuthenticated) {
      return (
        <EmptyState message="请登录后查看" hint="登录后即可查看历史分析记录" />
      );
    }
    if (error) {
      return (
        <View style={styles.centerBox}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable style={styles.retryBtn} onPress={onRefresh}>
            <Text style={styles.retryText}>重试</Text>
          </Pressable>
        </View>
      );
    }
    return <EmptyState message="暂无分析记录" hint="上传作品后将在此展示" />;
  };

  const ListFooter = () =>
    loadingMore ? (
      <View style={styles.footerBox}>
        <ActivityIndicator color={StoneBlueColor} />
      </View>
    ) : null;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>历史</Text>
      </View>

      {/* artType 筛选 */}
      <View style={styles.filterRow}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterScroll}
        >
          {FILTERS.map((f) => {
            const active = f.value === filter;
            return (
              <Pressable
                key={f.value}
                style={[styles.chip, active && styles.chipActive]}
                onPress={() => setFilter(f.value)}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>
                  {f.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <FlashList
        data={isAuthenticated ? items : []}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.5}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[StoneBlueColor]}
            tintColor={StoneBlueColor}
          />
        }
        ListEmptyComponent={ListEmpty}
        ListFooterComponent={ListFooter}
        showsVerticalScrollIndicator={false}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: PaperColor,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
  },
  headerTitle: {
    color: InkColor,
    fontSize: 26,
    fontWeight: '700',
  },
  filterRow: {
    paddingVertical: 8,
  },
  filterScroll: {
    paddingHorizontal: 16,
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#ffffff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: `${InkColor}1a`,
  },
  chipActive: {
    backgroundColor: StoneBlueColor,
    borderColor: StoneBlueColor,
  },
  chipText: {
    color: InkColor,
    fontSize: 13,
    fontWeight: '500',
  },
  chipTextActive: {
    color: PaperColor,
    fontWeight: '600',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 24,
  },
  centerBox: {
    paddingVertical: 36,
    alignItems: 'center',
    gap: 12,
  },
  errorText: {
    color: InkColor,
    fontSize: 14,
    opacity: 0.7,
    textAlign: 'center',
  },
  retryBtn: {
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: StoneBlueColor,
  },
  retryText: {
    color: StoneBlueColor,
    fontSize: 14,
    fontWeight: '600',
  },
  footerBox: {
    paddingVertical: 16,
    alignItems: 'center',
  },
});
