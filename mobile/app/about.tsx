// 丹青有AI 关于我们页
// - 应用信息(名称 / 版本 / 简介)
// - 功能特性
// - 法律条款入口(隐私政策 / 用户协议)
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { InkColor, PaperColor, StoneBlueColor, GoldColor } from '../src/theme/colors';

const APP_VERSION = Constants.expoConfig?.version ?? '1.0.0';

export default function AboutScreen() {
  const features = [
    { icon: 'analytics' as const, title: 'AI 智能诊断', desc: '多维度评分 + 热力图分析' },
    { icon: 'people' as const, title: '多评委仲裁', desc: '教授/讲师/AI 加权裁定争议' },
    { icon: 'trending-up' as const, title: '成长追踪', desc: '历史趋势可视化' },
    { icon: 'school' as const, title: '院校管理', desc: '多租户角色权限体系' },
  ];

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
        <Text style={styles.navTitle}>关于我们</Text>
        <View style={styles.navBtn} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* 应用标识 */}
        <View style={styles.logoSection}>
          <View style={styles.logoCircle}>
            <Ionicons name="color-palette" size={44} color={GoldColor} />
          </View>
          <Text style={styles.appName}>丹青有AI</Text>
          <Text style={styles.appSlogan}>AI 美术作品诊断平台</Text>
          <Text style={styles.version}>版本 {APP_VERSION}</Text>
        </View>

        {/* 简介 */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>应用简介</Text>
          <Text style={styles.descText}>
            丹青有AI 是面向美术教育的智能作品诊断平台,融合 AI 视觉分析与多评委仲裁机制,
            为学生提供专业级作品评分与改进建议,助力美术教学数字化升级。
          </Text>
        </View>

        {/* 功能特性 */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>核心功能</Text>
          {features.map((f) => (
            <View key={f.title} style={styles.featureRow}>
              <View style={styles.featureIcon}>
                <Ionicons name={f.icon} size={20} color={StoneBlueColor} />
              </View>
              <View style={styles.featureBody}>
                <Text style={styles.featureTitle}>{f.title}</Text>
                <Text style={styles.featureDesc}>{f.desc}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* 法律条款 */}
        <View style={styles.card}>
          <Pressable
            style={({ pressed }) => [styles.menuItem, pressed && styles.pressed]}
            onPress={() => {
              // TODO: 跳转隐私政策页 / 外部链接
            }}
          >
            <Ionicons name="shield-checkmark" size={20} color={StoneBlueColor} />
            <Text style={styles.menuText}>隐私政策</Text>
            <Ionicons name="chevron-forward" size={18} color={`${InkColor}55`} />
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.menuItem, pressed && styles.pressed]}
            onPress={() => {
              // TODO: 跳转用户协议页 / 外部链接
            }}
          >
            <Ionicons name="document-text" size={20} color={StoneBlueColor} />
            <Text style={styles.menuText}>用户协议</Text>
            <Ionicons name="chevron-forward" size={18} color={`${InkColor}55`} />
          </Pressable>
        </View>

        <Text style={styles.copyright}>© 2026 丹青有AI</Text>
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
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
  logoSection: {
    alignItems: 'center',
    paddingVertical: 24,
    gap: 6,
  },
  logoCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#ffffff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: `${InkColor}1a`,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  appName: {
    color: InkColor,
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: 2,
  },
  appSlogan: {
    color: InkColor,
    fontSize: 13,
    opacity: 0.55,
  },
  version: {
    color: InkColor,
    fontSize: 12,
    opacity: 0.4,
    marginTop: 4,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: `${InkColor}1a`,
  },
  sectionTitle: {
    color: InkColor,
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 12,
  },
  descText: {
    color: InkColor,
    fontSize: 13,
    opacity: 0.65,
    lineHeight: 22,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 12,
  },
  featureIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: `${StoneBlueColor}0d`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureBody: {
    flex: 1,
    gap: 2,
  },
  featureTitle: {
    color: InkColor,
    fontSize: 14,
    fontWeight: '500',
  },
  featureDesc: {
    color: InkColor,
    fontSize: 12,
    opacity: 0.5,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: `${InkColor}0f`,
  },
  menuText: {
    flex: 1,
    color: InkColor,
    fontSize: 15,
  },
  copyright: {
    color: InkColor,
    fontSize: 12,
    opacity: 0.4,
    textAlign: 'center',
    marginTop: 8,
  },
});
