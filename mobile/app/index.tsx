// 丹青有AI 移动端首页(P3-1.1 最简可运行页)
// 展示"丹青有AI"标题,证明脚手架可运行;接入 store 展示登录态占位
// 水墨色系:宣纸白背景 / 墨黑标题 / 金色分隔 / 石青-朱砂状态色
import { SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { useAuthStore } from '../src/store';
import {
  CinnabarColor,
  GoldColor,
  InkColor,
  PaperColor,
  StoneBlueColor,
} from '../src/theme/colors';

export default function HomeScreen() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const user = useAuthStore((state) => state.user);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.brand}>丹青有AI</Text>
        <Text style={styles.subtitle}>高校艺术教育 AI 作业诊断</Text>

        <View style={styles.divider} />

        <Text style={styles.statusLabel}>当前状态</Text>
        <Text
          style={[
            styles.statusValue,
            {
              color: isAuthenticated ? StoneBlueColor : CinnabarColor,
            },
          ]}
        >
          {isAuthenticated
            ? `已登录 · ${user?.name ?? ''}`.trim()
            : '未登录(待接入飞书登录 P3-1.4)'}
        </Text>

        <Text style={styles.hint}>
          移动端脚手架已就绪(P3-1.1)。{'\n'}
          后续:AI 报告与历史(P3-1.2)/ 拍照上传(P3-1.3)/ 飞书登录(P3-1.4)。
        </Text>

        <Text style={styles.badge}>水墨色系 · {GoldColor}</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: PaperColor,
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: 'center',
  },
  brand: {
    color: InkColor,
    fontSize: 40,
    fontWeight: '700',
    letterSpacing: 4,
  },
  subtitle: {
    marginTop: 8,
    color: InkColor,
    fontSize: 15,
    opacity: 0.7,
  },
  divider: {
    height: 1,
    backgroundColor: GoldColor,
    marginVertical: 28,
    opacity: 0.6,
  },
  statusLabel: {
    color: InkColor,
    fontSize: 13,
    opacity: 0.6,
  },
  statusValue: {
    marginTop: 6,
    fontSize: 17,
    fontWeight: '600',
  },
  hint: {
    marginTop: 28,
    color: InkColor,
    fontSize: 13,
    lineHeight: 22,
    opacity: 0.65,
  },
  badge: {
    marginTop: 20,
    color: GoldColor,
    fontSize: 12,
    fontWeight: '600',
  },
});
