// 丹青有AI 状态标签(分析状态 → 水墨色 pill)
// 配色:排队=金 / 分析中=石青 / 已完成=墨黑 / 失败=朱砂
import { StyleSheet, Text, View } from 'react-native';
import type { AnalysisStatus } from '../types/api-contract';
import { statusToLabel } from '../utils/format';
import {
  CinnabarColor,
  GoldColor,
  InkColor,
  StoneBlueColor,
} from '../theme/colors';

const STATUS_COLOR: Record<AnalysisStatus, string> = {
  pending: GoldColor,
  processing: StoneBlueColor,
  success: InkColor,
  failed: CinnabarColor,
};

export function StatusTag({ status }: { status: AnalysisStatus }) {
  const color = STATUS_COLOR[status] ?? InkColor;
  return (
    <View style={[styles.wrap, { borderColor: color }]}>
      <Text style={[styles.text, { color }]}>{statusToLabel(status)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    borderWidth: 1,
    backgroundColor: 'transparent',
  },
  text: {
    fontSize: 12,
    fontWeight: '600',
  },
});
