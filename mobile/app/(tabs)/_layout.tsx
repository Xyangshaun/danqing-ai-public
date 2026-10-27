// 丹青有AI 底部 Tab 导航(3 Tab:首页 / 历史 / 我的)
// 水墨色系:TabBar 背景宣纸白 / 激活朱砂红 / 非激活墨黑 50% 透明
// 图标使用 @expo/vector-icons 的 Ionicons(Expo 内置,无需额外安装)
import { StyleSheet } from 'react-native';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  CinnabarColor,
  InkColor,
  PaperColor,
} from '../../src/theme/colors';

// 非激活色:墨黑 50% 透明(8 位 HEX,RN 支持)
const INK_MUTED = `${InkColor}80`;

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: CinnabarColor,
        tabBarInactiveTintColor: INK_MUTED,
        tabBarStyle: {
          backgroundColor: PaperColor,
          borderTopColor: `${InkColor}1a`,
          borderTopWidth: StyleSheet.hairlineWidth,
          height: 56,
          paddingBottom: 4,
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '500',
        },
        tabBarIconStyle: {
          marginTop: 2,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: '首页',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: '历史',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="time" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: '我的',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person" color={color} size={size} />
          ),
        }}
      />
    </Tabs>
  );
}
