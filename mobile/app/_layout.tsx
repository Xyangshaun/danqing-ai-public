// 丹青有AI 移动端根布局(expo-router Stack)
// - (tabs) 接管主入口(首页/历史/我的),headerShown:false
// - login:飞书登录页(P3-1.4),无 header,fade 动画
// - analysis/[id] 使用 Stack 默认 header(含返回按钮),水墨色系适配
// - StatusBar 适配 iOS / Android
// - 启动水合:从 secure-store 读 accessToken/refreshToken/csrfToken/user 灌入 store
// - 路由守卫:未登录且不在 /login → replace('/login');已登录且在 /login → replace('/')
import { useEffect, useState } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { InkColor, PaperColor } from '../src/theme/colors';
import { useAuthStore } from '../src/store';
import { authStorage } from '../src/utils/storage';
import type { UserProfile } from '../src/types/api-contract';

export default function RootLayout() {
  const [isHydrated, setIsHydrated] = useState(false);
  const router = useRouter();
  const segments = useSegments();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  // ---- 启动水合:从 secure-store 读取凭据灌入 store ----
  useEffect(() => {
    (async () => {
      try {
        const [accessToken, accessTokenExpiresAt, refreshToken, csrfToken, user] =
          await Promise.all([
            authStorage.getAccessToken(),
            authStorage.getAccessTokenExpiresAt(),
            authStorage.getRefreshToken(),
            authStorage.getCsrfToken(),
            authStorage.getUser<UserProfile>(),
          ]);
        // 四要素齐全才水合(user 非空保证 TS narrowing)
        if (accessToken && refreshToken && csrfToken && user) {
          useAuthStore.getState().setAuth({
            accessToken,
            accessTokenExpiresAt: accessTokenExpiresAt ?? '',
            refreshToken,
            csrfToken,
            user,
          });
        }
      } catch {
        // secure-store 读取异常:忽略,保持未登录态,路由守卫会拉到 /login
      } finally {
        setIsHydrated(true);
      }
    })();
  }, []);

  // ---- 路由守卫:基于 isAuthenticated 与当前 segment 决定重定向 ----
  useEffect(() => {
    if (!isHydrated) return;
    const inLoginGroup = segments[0] === 'login';
    if (!isAuthenticated && !inLoginGroup) {
      router.replace('/login');
    } else if (isAuthenticated && inLoginGroup) {
      router.replace('/');
    }
  }, [isHydrated, isAuthenticated, segments, router]);

  // 水合完成前不渲染,避免路由守卫在水合前误跳
  if (!isHydrated) {
    return <View style={{ flex: 1, backgroundColor: PaperColor }} />;
  }

  return (
    <>
      <StatusBar style="dark" backgroundColor={PaperColor} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: PaperColor },
        }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="login"
          options={{
            headerShown: false,
            animation: 'fade',
            contentStyle: { backgroundColor: PaperColor },
          }}
        />
        <Stack.Screen
          name="upload"
          options={{
            headerShown: true,
            title: '拍照诊断',
            headerBackTitle: '返回',
            headerTintColor: InkColor,
            headerStyle: { backgroundColor: PaperColor },
            headerTitleStyle: { color: InkColor, fontWeight: '600' },
            headerShadowVisible: false,
            contentStyle: { backgroundColor: PaperColor },
          }}
        />
        <Stack.Screen
          name="analysis/[id]"
          options={{
            headerShown: true,
            title: '分析报告',
            headerBackTitle: '返回',
            headerTintColor: InkColor,
            headerStyle: { backgroundColor: PaperColor },
            headerTitleStyle: { color: InkColor, fontWeight: '600' },
            headerShadowVisible: false,
            contentStyle: { backgroundColor: PaperColor },
          }}
        />
      </Stack>
    </>
  );
}
