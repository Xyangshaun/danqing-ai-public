// 丹青有AI 我的 Tab
// - 用户信息卡片:头像 / 姓名 / 角色 / 租户名(store.user + GET /auth/me 取 tenant.name)
// - 未登录:显示"请登录" + 登录按钮(P3-1.4 飞书登录占位)
// - 菜单列表:账号设置 / 消息通知 / 关于我们(占位)
// - 退出登录:POST /auth/logout(若已登录),成功后 clearAuth() + 跳首页
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
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
import { getMe, logout } from '../../src/services/auth';
import { roleToLabel } from '../../src/utils/format';
import type { TenantInfo } from '../../src/types/api-contract';
import {
  CinnabarColor,
  InkColor,
  PaperColor,
  StoneBlueColor,
} from '../../src/theme/colors';

export default function ProfileTab() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const [tenant, setTenant] = useState<TenantInfo | null>(null);
  const [loadingTenant, setLoadingTenant] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const loadTenant = useCallback(async () => {
    if (!isAuthenticated) {
      setTenant(null);
      return;
    }
    setLoadingTenant(true);
    try {
      const me = await getMe();
      setTenant(me.tenant);
    } catch {
      // 忽略:仍可展示 store.user
    } finally {
      setLoadingTenant(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    loadTenant();
  }, [loadTenant]);

  const onLoginPress = () => {
    // P3-1.4:跳转飞书登录页(路由守卫未登录时也会强制跳转,此处显式跳转保留入口语义)
    router.push('/login');
  };
  const onMenuPress = (key: string) => {
    // 账号设置 / 消息通知 / 关于我们 跳转对应页面
    switch (key) {
      case '账号设置':
        router.push('/settings');
        break;
      case '消息通知':
        router.push('/notifications');
        break;
      case '关于我们':
        router.push('/about');
        break;
      default:
        break;
    }
  };
  const doLogout = async () => {
    setLoggingOut(true);
    try {
      await logout();
    } catch {
      // 忽略网络错误,本地仍清态
    } finally {
      clearAuth();
      setTenant(null);
      setLoggingOut(false);
      router.replace('/');
    }
  };
  const onLogoutPress = () => {
    Alert.alert('退出登录', '确定退出当前账号?', [
      { text: '取消', style: 'cancel' },
      { text: '退出', style: 'destructive', onPress: doLogout },
    ]);
  };

  const initial = user?.name?.charAt(0) ?? '?';

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.headerTitle}>我的</Text>

        {/* 用户信息卡片 */}
        <View style={styles.userCard}>
          {isAuthenticated && user ? (
            <View style={styles.userRow}>
              <View style={styles.avatarWrap}>
                {user.avatar ? (
                  <Image source={{ uri: user.avatar }} style={styles.avatar} />
                ) : (
                  <View style={[styles.avatar, styles.avatarFallback]}>
                    <Text style={styles.avatarFallbackText}>{initial}</Text>
                  </View>
                )}
              </View>
              <View style={styles.userBody}>
                <Text style={styles.userName}>{user.name}</Text>
                <View style={styles.metaRow}>
                  <View style={styles.roleTag}>
                    <Text style={styles.roleTagText}>{roleToLabel(user.role)}</Text>
                  </View>
                  <Text style={styles.metaText} numberOfLines={1}>
                    {loadingTenant
                      ? '加载租户…'
                      : tenant
                        ? tenant.name
                        : '未加入租户'}
                  </Text>
                </View>
              </View>
            </View>
          ) : (
            <View style={styles.loginBox}>
              <Ionicons name="person-circle" size={52} color={`${InkColor}55`} />
              <Text style={styles.loginText}>请登录</Text>
              <Pressable style={styles.loginBtn} onPress={onLoginPress}>
                <Text style={styles.loginBtnText}>登录(飞书)</Text>
              </Pressable>
            </View>
          )}
        </View>

        {/* 菜单列表 */}
        <View style={styles.menuGroup}>
          <Pressable
            style={({ pressed }) => [styles.menuItem, pressed && styles.pressed]}
            onPress={() => onMenuPress('账号设置')}
          >
            <Ionicons name="settings" size={20} color={StoneBlueColor} />
            <Text style={styles.menuText}>账号设置</Text>
            <Ionicons name="chevron-forward" size={18} color={`${InkColor}55`} />
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.menuItem, pressed && styles.pressed]}
            onPress={() => onMenuPress('消息通知')}
          >
            <Ionicons name="notifications" size={20} color={StoneBlueColor} />
            <Text style={styles.menuText}>消息通知</Text>
            <Ionicons name="chevron-forward" size={18} color={`${InkColor}55`} />
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.menuItem, pressed && styles.pressed]}
            onPress={() => onMenuPress('关于我们')}
          >
            <Ionicons name="information-circle" size={20} color={StoneBlueColor} />
            <Text style={styles.menuText}>关于我们</Text>
            <Ionicons name="chevron-forward" size={18} color={`${InkColor}55`} />
          </Pressable>
        </View>

        {/* 退出登录 */}
        {isAuthenticated ? (
          <Pressable
            style={({ pressed }) => [
              styles.logoutBtn,
              pressed && styles.pressed,
            ]}
            onPress={onLogoutPress}
            disabled={loggingOut}
          >
            {loggingOut ? (
              <ActivityIndicator color={CinnabarColor} />
            ) : (
              <Text style={styles.logoutText}>退出登录</Text>
            )}
          </Pressable>
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
  content: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 32,
  },
  headerTitle: {
    color: InkColor,
    fontSize: 26,
    fontWeight: '700',
    marginBottom: 16,
  },
  userCard: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: `${InkColor}1a`,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarWrap: {
    marginRight: 14,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: `${InkColor}0d`,
  },
  avatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarFallbackText: {
    fontSize: 22,
    fontWeight: '600',
    color: StoneBlueColor,
  },
  userBody: {
    flex: 1,
  },
  userName: {
    color: InkColor,
    fontSize: 18,
    fontWeight: '600',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 8,
  },
  roleTag: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    backgroundColor: `${StoneBlueColor}1a`,
  },
  roleTagText: {
    color: StoneBlueColor,
    fontSize: 12,
    fontWeight: '600',
  },
  metaText: {
    flex: 1,
    color: InkColor,
    fontSize: 13,
    opacity: 0.6,
  },
  loginBox: {
    paddingVertical: 16,
    alignItems: 'center',
    gap: 10,
  },
  loginText: {
    color: InkColor,
    fontSize: 15,
    opacity: 0.6,
  },
  loginBtn: {
    marginTop: 4,
    paddingHorizontal: 22,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: StoneBlueColor,
  },
  loginBtnText: {
    color: PaperColor,
    fontSize: 15,
    fontWeight: '600',
  },
  menuGroup: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: `${InkColor}1a`,
    overflow: 'hidden',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: `${InkColor}0f`,
  },
  pressed: {
    opacity: 0.6,
  },
  menuText: {
    flex: 1,
    color: InkColor,
    fontSize: 15,
  },
  logoutBtn: {
    marginTop: 24,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: CinnabarColor,
  },
  logoutText: {
    color: CinnabarColor,
    fontSize: 15,
    fontWeight: '600',
  },
});
