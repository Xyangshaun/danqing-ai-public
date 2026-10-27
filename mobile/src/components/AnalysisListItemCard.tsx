// 丹青有AI 历史列表项卡片(AnalysisListItem → 水墨卡片)
// 卡片:14px 圆角 / 白色卡面 / 墨黑文字 / 金色评分 / 朱砂-石青状态
// 单手持机:整卡可点,跳转分析详情
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { AnalysisListItem } from '../types/api-contract';
import { StatusTag } from './StatusTag';
import { artTypeToLabel, formatDateTime } from '../utils/format';
import {
  GoldColor,
  InkColor,
  StoneBlueColor,
} from '../theme/colors';

interface Props {
  item: AnalysisListItem;
  onPress?: (id: string) => void;
}

export function AnalysisListItemCard({ item, onPress }: Props) {
  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      onPress={() => onPress?.(item.id)}
    >
      <View style={styles.thumbWrap}>
        {item.imageUrl ? (
          <Image
            source={{ uri: item.imageUrl }}
            style={styles.thumb}
            resizeMode="cover"
          />
        ) : (
          <View style={[styles.thumb, styles.thumbPlaceholder]}>
            <Text style={styles.thumbPlaceholderText}>无图</Text>
          </View>
        )}
      </View>

      <View style={styles.body}>
        <View style={styles.rowTop}>
          <Text style={styles.artType}>{artTypeToLabel(item.workType)}</Text>
          <StatusTag status={item.status} />
        </View>

        <Text style={styles.title} numberOfLines={1}>
          {item.title ?? '未命名作品'}
        </Text>

        <View style={styles.rowBottom}>
          {item.overallScore != null ? (
            <Text style={styles.score}>
              评分 <Text style={styles.scoreNum}>{item.overallScore}</Text>
            </Text>
          ) : (
            <Text style={styles.scoreMuted}>暂无评分</Text>
          )}
          <Text style={styles.date}>{formatDateTime(item.createdAt)}</Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 12,
    marginBottom: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: `${InkColor}1a`, // 极淡墨色描边
  },
  pressed: {
    opacity: 0.85,
  },
  thumbWrap: {
    marginRight: 12,
  },
  thumb: {
    width: 80,
    height: 80,
    borderRadius: 10,
    backgroundColor: `${InkColor}0d`,
  },
  thumbPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbPlaceholderText: {
    fontSize: 12,
    color: `${InkColor}66`,
  },
  body: {
    flex: 1,
    justifyContent: 'space-between',
  },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  artType: {
    fontSize: 13,
    fontWeight: '600',
    color: StoneBlueColor,
  },
  title: {
    fontSize: 15,
    fontWeight: '500',
    color: InkColor,
    marginTop: 6,
  },
  rowBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  score: {
    fontSize: 12,
    color: `${InkColor}99`,
  },
  scoreNum: {
    fontSize: 16,
    fontWeight: '700',
    color: GoldColor,
  },
  scoreMuted: {
    fontSize: 12,
    color: `${InkColor}66`,
  },
  date: {
    fontSize: 12,
    color: `${InkColor}66`,
  },
});
