// 丹青有AI 消息通知页
// - 通知列表(暂无后端通知接口,展示空状态)
// - 后续接入 GET /notifications 后填充列表
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { InkColor, PaperColor, StoneBlueColor } from '../src/theme/colors';

export default function NotificationsScreen() {
  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      {/* 顶部导航栏 */}
      <View style={styles.navBar}>
        <Pressable
          style={({ pressed }) => [styles.navBtn, pressed && styles.pressed]}
          onPress={() => router.back()}
          hitSlop={12}
        >
          <Ionicons name="chevron-back" size={24} color={InkColor} />
        </Pressable>
        <Text style={styles.navTitle}>消息通知</Text>
        <View style={styles.navBtn} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* 空状态 */}
        <View style={styles.emptyBox}>
          <Ionicons name="notifications-off-outline" size={56} color={`${InkColor}33`} />
          <Text style={styles.emptyTitle}>暂无通知</Text>
          <Text style={styles.emptyDesc}>
            评审结果、争议裁定、系统公告等通知将显示在这里
          </Text>
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
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 48,
    paddingHorizontal: 8,
  },
  navBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navTitle: {
    color: InkColor,
    fontSize: 17,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.5,
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
  emptyBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 96,
    gap: 12,
  },
  emptyTitle: {
    color: InkColor,
    fontSize: 16,
    fontWeight: '600',
    opacity: 0.7,
  },
  emptyDesc: {
    color: InkColor,
    fontSize: 13,
    opacity: 0.45,
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 32,
  },
});
