// 丹青有AI 首页 Tab
// - 顶部品牌区(标题 + 副标题,登录后显示问候)
// - 快捷入口:拍照诊断(跳 /upload)/ 查看历史(跳 /history)
// - 最近分析:GET /analyses?page=1&pageSize=3,点击跳 /analysis/[id]
// - 未登录:占位提示;加载/错误/空态分别处理
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../src/store';
import { listAnalyses } from '../../src/services/analyses';
import { ApiError } from '../../src/services/api';
import { AnalysisListItemCard } from '../../src/components/AnalysisListItemCard';
import { EmptyState } from '../../src/components/EmptyState';
import type { AnalysisListItem } from '../../src/types/api-contract';
import {
  InkColor,
  PaperColor,
  StoneBlueColor,
} from '../../src/theme/colors';

export default function HomeTab() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);
  const [recent, setRecent] = useState<AnalysisListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRecent = useCallback(async () => {
    if (!isAuthenticated) {
      setRecent([]);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await listAnalyses({ page: 1, pageSize: 3 });
      setRecent(res.items);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '加载失败,请稍后重试');
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    loadRecent();
  }, [loadRecent]);

  const onUploadPress = () => {
    // P3-1.3 拍照上传页:跳转 /upload(独立 Stack 页,带返回)
    router.push('/upload');
  };
  const onHistoryPress = () => {
    router.push('/history');
  };
  const onItemPress = (id: string) => {
    router.push(`/analysis/${id}`);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* 品牌区 */}
        <View style={styles.brand}>
          <Text style={styles.brandTitle}>丹青有AI</Text>
          <Text style={styles.brandSub}>
            {isAuthenticated
              ? `你好,${user?.name ?? '同学'}`
              : '高校艺术教育 AI 作业诊断'}
          </Text>
        </View>

        {/* 快捷入口 */}
        <View style={styles.quickRow}>
          <Pressable
            style={({ pressed }) => [
              styles.quickCard,
              styles.quickPrimary,
              pressed && styles.pressed,
            ]}
            onPress={onUploadPress}
          >
            <Ionicons name="camera" size={26} color={PaperColor} />
            <Text style={styles.quickPrimaryText}>拍照诊断</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [
              styles.quickCard,
              styles.quickSecondary,
              pressed && styles.pressed,
            ]}
            onPress={onHistoryPress}
          >
            <Ionicons name="time" size={26} color={StoneBlueColor} />
            <Text style={styles.quickSecondaryText}>查看历史</Text>
          </Pressable>
        </View>

        {/* 最近分析 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>最近分析</Text>
          {isAuthenticated ? (
            loading ? (
              <View style={styles.centerBox}>
                <ActivityIndicator color={StoneBlueColor} />
              </View>
            ) : error ? (
              <View style={styles.centerBox}>
                <Text style={styles.errorText}>{error}</Text>
                <Pressable style={styles.retryBtn} onPress={loadRecent}>
                  <Text style={styles.retryText}>重试</Text>
                </Pressable>
              </View>
            ) : recent.length === 0 ? (
              <EmptyState
                message="暂无分析记录"
                hint="点击「拍照诊断」上传第一份作品"
              />
            ) : (
              recent.map((item) => (
                <AnalysisListItemCard
                  key={item.id}
                  item={item}
                  onPress={onItemPress}
                />
              ))
            )
          ) : (
            <View style={styles.loginHint}>
              <Ionicons name="lock-closed" size={22} color={`${InkColor}55`} />
              <Text style={styles.loginHintText}>请登录后查看</Text>
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: PaperColor,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 24,
  },
  brand: {
    marginBottom: 20,
  },
  brandTitle: {
    color: InkColor,
    fontSize: 30,
    fontWeight: '700',
    letterSpacing: 2,
  },
  brandSub: {
    marginTop: 6,
    color: InkColor,
    fontSize: 14,
    opacity: 0.6,
  },
  quickRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
  },
  quickCard: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 20,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  quickPrimary: {
    backgroundColor: StoneBlueColor,
  },
  quickSecondary: {
    backgroundColor: '#ffffff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: `${InkColor}1a`,
  },
  pressed: {
    opacity: 0.85,
  },
  quickPrimaryText: {
    color: PaperColor,
    fontSize: 15,
    fontWeight: '600',
  },
  quickSecondaryText: {
    color: StoneBlueColor,
    fontSize: 15,
    fontWeight: '600',
  },
  section: {
    marginBottom: 8,
  },
  sectionTitle: {
    color: InkColor,
    fontSize: 17,
    fontWeight: '600',
    marginBottom: 12,
  },
  centerBox: {
    paddingVertical: 32,
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
  loginHint: {
    paddingVertical: 36,
    alignItems: 'center',
    gap: 10,
  },
  loginHintText: {
    color: InkColor,
    fontSize: 14,
    opacity: 0.55,
  },
});
