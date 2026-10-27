// 丹青有AI 分析报告页(app/analysis/[id].tsx)
// - 路由参数 id,GET /analyses/:id 获取 AnalysisDetail
// - 展示:作品大图 / 基本信息卡(类型/状态/评分/时间)/ AI 分析结果摘要 / 失败原因
// - result 字段较多:维度评分 + 主题意境 + 风格识别 + 改进建议(前 2 条 + 展开完整报告)
// - 顶部返回按钮由根 Stack 默认 header 提供(headerShown:true)
// - loading / error 态独立处理
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getAnalysis } from '../../src/services/analyses';
import { ApiError } from '../../src/services/api';
import { StatusTag } from '../../src/components/StatusTag';
import { artTypeToLabel, formatDateTime } from '../../src/utils/format';
import type {
  AnalysisDetail,
  AnalysisResult,
  DimensionResult,
} from '../../src/types/api-contract';
import {
  CinnabarColor,
  GoldColor,
  InkColor,
  PaperColor,
  StoneBlueColor,
} from '../../src/theme/colors';

interface DimScore {
  label: string;
  score: number;
}

/** 按 workType 提取各维度评分(DimensionResult 联合 narrowing) */
function extractDimensionScores(d: DimensionResult): DimScore[] {
  switch (d.type) {
    case 'painting':
      return [
        { label: '构图', score: d.composition.score },
        { label: '色彩', score: d.color.score },
        { label: '笔触', score: d.brushwork.score },
      ];
    case 'design':
      return [
        { label: '视觉层次', score: d.visualHierarchy.score },
        { label: '排版', score: d.typography.score },
        { label: '色彩应用', score: d.colorApplication.score },
      ];
    case 'product':
      return [
        { label: '形态', score: d.form.score },
        { label: '材质表现', score: d.materialExpression.score },
        { label: '功能表达', score: d.functionExpression.score },
      ];
    case 'sculpture':
      return [
        { label: '空间构图', score: d.spatialComposition.score },
        { label: '形体语言', score: d.bodyLanguage.score },
        { label: '材质语言', score: d.materialLanguage.score },
      ];
    default:
      return [];
  }
}

export default function AnalysisDetailScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const id = typeof params.id === 'string' ? params.id : undefined;

  const [detail, setDetail] = useState<AnalysisDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async () => {
    if (!id) {
      setError('缺少分析 ID');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await getAnalysis(id);
      setDetail(data);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '加载失败,请稍后重试');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={StoneBlueColor} size="large" />
      </View>
    );
  }
  if (error || !detail) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{error ?? '未找到分析记录'}</Text>
        <Pressable style={styles.retryBtn} onPress={load}>
          <Text style={styles.retryText}>重试</Text>
        </Pressable>
      </View>
    );
  }

  const result: AnalysisResult | null = detail.result;
  const dimScores: DimScore[] = result
    ? extractDimensionScores(result.dimensions)
    : [];
  const suggestions = result?.professionalSuggestions ?? [];
  const visibleSuggestions = expanded ? suggestions : suggestions.slice(0, 2);
  const overallScore = result?.overallScore ?? null;

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* 作品大图 */}
        <View style={styles.imageWrap}>
          {detail.imageUrl ? (
            <Image
              source={{ uri: detail.imageUrl }}
              style={styles.image}
              resizeMode="contain"
            />
          ) : (
            <View style={[styles.image, styles.imagePlaceholder]}>
              <Text style={styles.imagePlaceholderText}>无作品图</Text>
            </View>
          )}
        </View>

        {/* 基本信息卡片 */}
        <View style={styles.card}>
          <View style={styles.cardRow}>
            <Text style={styles.cardLabel}>类型</Text>
            <Text style={styles.cardValue}>{artTypeToLabel(detail.workType)}</Text>
          </View>
          <View style={styles.cardRow}>
            <Text style={styles.cardLabel}>状态</Text>
            <StatusTag status={detail.status} />
          </View>
          {overallScore != null ? (
            <View style={styles.cardRow}>
              <Text style={styles.cardLabel}>综合评分</Text>
              <Text style={styles.scoreBig}>{overallScore}</Text>
            </View>
          ) : null}
          <View style={styles.cardRow}>
            <Text style={styles.cardLabel}>创建时间</Text>
            <Text style={styles.cardValue}>{formatDateTime(detail.createdAt)}</Text>
          </View>
          {detail.title ? (
            <View style={styles.cardRow}>
              <Text style={styles.cardLabel}>标题</Text>
              <Text style={styles.cardValue} numberOfLines={2}>
                {detail.title}
              </Text>
            </View>
          ) : null}
        </View>

        {/* 失败态 */}
        {detail.status === 'failed' ? (
          <View style={[styles.card, styles.failCard]}>
            <Text style={styles.failTitle}>分析失败</Text>
            <Text style={styles.failText}>
              {detail.failureReason ?? '未知原因,请重新提交'}
            </Text>
          </View>
        ) : null}

        {/* AI 分析结果摘要 */}
        {result ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>AI 分析结果</Text>

            {dimScores.length > 0 ? (
              <View style={styles.dimWrap}>
                {dimScores.map((d) => (
                  <View key={d.label} style={styles.dimRow}>
                    <Text style={styles.dimLabel}>{d.label}</Text>
                    <Text style={styles.dimScore}>{d.score}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            {result.semanticTheme ? (
              <Text style={styles.paragraph}>
                <Text style={styles.paragraphLabel}>主题意境:</Text>
                {result.semanticTheme}
              </Text>
            ) : null}
            {result.styleRecognition ? (
              <Text style={styles.paragraph}>
                <Text style={styles.paragraphLabel}>风格识别:</Text>
                {result.styleRecognition}
              </Text>
            ) : null}

            {visibleSuggestions.length > 0 ? (
              <View style={styles.suggestionWrap}>
                <Text style={styles.paragraphLabel}>改进建议</Text>
                {visibleSuggestions.map((s, i) => (
                  <View key={i} style={styles.suggestionItem}>
                    <Text style={styles.suggestionDim}>{s.dimension}</Text>
                    <Text style={styles.suggestionText}>{s.operation}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            {suggestions.length > 2 ? (
              <Pressable
                style={styles.expandBtn}
                onPress={() => setExpanded((v) => !v)}
              >
                <Text style={styles.expandText}>
                  {expanded
                    ? '收起'
                    : `查看完整报告(共 ${suggestions.length} 条建议)`}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: PaperColor,
  },
  center: {
    flex: 1,
    backgroundColor: PaperColor,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 32,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 32,
  },
  imageWrap: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: `${InkColor}1a`,
    overflow: 'hidden',
    marginBottom: 16,
  },
  image: {
    width: '100%',
    height: 280,
    backgroundColor: `${InkColor}0d`,
  },
  imagePlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  imagePlaceholderText: {
    color: `${InkColor}66`,
    fontSize: 14,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: `${InkColor}1a`,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  cardLabel: {
    color: InkColor,
    fontSize: 14,
    opacity: 0.6,
  },
  cardValue: {
    color: InkColor,
    fontSize: 14,
    fontWeight: '500',
    flexShrink: 1,
    textAlign: 'right',
  },
  scoreBig: {
    fontSize: 28,
    fontWeight: '700',
    color: GoldColor,
  },
  failCard: {
    borderColor: `${CinnabarColor}4d`,
    backgroundColor: `${CinnabarColor}0d`,
  },
  failTitle: {
    color: CinnabarColor,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 6,
  },
  failText: {
    color: CinnabarColor,
    fontSize: 14,
    opacity: 0.85,
  },
  sectionTitle: {
    color: InkColor,
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
  },
  dimWrap: {
    marginBottom: 12,
  },
  dimRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: `${InkColor}0f`,
  },
  dimLabel: {
    color: InkColor,
    fontSize: 14,
  },
  dimScore: {
    color: StoneBlueColor,
    fontSize: 16,
    fontWeight: '700',
  },
  paragraph: {
    color: InkColor,
    fontSize: 14,
    lineHeight: 22,
    marginTop: 8,
  },
  paragraphLabel: {
    color: InkColor,
    fontSize: 14,
    fontWeight: '600',
  },
  suggestionWrap: {
    marginTop: 12,
    gap: 8,
  },
  suggestionItem: {
    backgroundColor: `${InkColor}08`,
    borderRadius: 10,
    padding: 10,
  },
  suggestionDim: {
    color: StoneBlueColor,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 4,
  },
  suggestionText: {
    color: InkColor,
    fontSize: 13,
    lineHeight: 20,
    opacity: 0.85,
  },
  expandBtn: {
    marginTop: 12,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: StoneBlueColor,
  },
  expandText: {
    color: StoneBlueColor,
    fontSize: 14,
    fontWeight: '600',
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
});
