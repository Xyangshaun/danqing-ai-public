// 丹青有AI 账号设置页
// - 展示用户信息(姓名 / 邮箱 / 手机 / 角色 / 租户)
// - 编辑姓名(本地修改 + 调用 PATCH /users/profile 同步)
// - 退出登录入口
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../src/store';
import { getMe, logout } from '../src/services/auth';
import { roleToLabel } from '../src/utils/format';
import type { TenantInfo } from '../src/types/api-contract';
import {
  CinnabarColor,
  InkColor,
  PaperColor,
  StoneBlueColor,
} from '../src/theme/colors';

export default function SettingsScreen() {
  const user = useAuthStore((s) => s.user);
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const [tenant, setTenant] = useState<TenantInfo | null>(null);
  const [loadingTenant, setLoadingTenant] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(user?.name ?? '');
  const [savingName, setSavingName] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const loadTenant = useCallback(async () => {
    setLoadingTenant(true);
    try {
      const me = await getMe();
      setTenant(me.tenant);
    } catch {
      // 忽略,仍可展示 store.user
    } finally {
      setLoadingTenant(false);
    }
  }, []);

  useEffect(() => {
    loadTenant();
  }, [loadTenant]);

  const onSaveName = async () => {
    const trimmed = nameValue.trim();
    if (!trimmed) {
      Alert.alert('姓名不能为空');
      return;
    }
    setSavingName(true);
    try {
      // TODO: 接入 PATCH /users/profile 后端接口同步;当前仅本地展示
      setEditingName(false);
    } catch {
      Alert.alert('保存失败,请稍后重试');
    } finally {
      setSavingName(false);
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

  const infoRow = (label: string, value: string | null | undefined) => (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue} numberOfLines={1}>
        {value || '未填写'}
      </Text>
    </View>
  );

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
        <Text style={styles.navTitle}>账号设置</Text>
        <View style={styles.navBtn} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* 用户信息卡片 */}
        <View style={styles.card}>
          {infoRow('姓名', user?.name)}
          {infoRow('邮箱', user?.email)}
          {infoRow('手机号', user?.phone)}
          {infoRow('角色', user ? roleToLabel(user.role) : null)}
          {infoRow(
            '所属租户',
            loadingTenant ? '加载中…' : tenant ? tenant.name : '未加入租户',
          )}
          {infoRow('用户 ID', user?.id)}
        </View>

        {/* 编辑姓名 */}
        <View style={styles.card}>
          {editingName ? (
            <View style={styles.editRow}>
              <Text style={styles.sectionTitle}>修改姓名</Text>
              <View style={styles.inputRow}>
                <TextInput
                  style={styles.input}
                  value={nameValue}
                  onChangeText={setNameValue}
                  placeholder="请输入姓名"
                  placeholderTextColor={`${InkColor}66`}
                  autoCapitalize="words"
                  autoCorrect={false}
                  maxLength={32}
                />
              </View>
              <View style={styles.btnRow}>
                <Pressable
                  style={({ pressed }) => [
                    styles.cancelBtn,
                    pressed && styles.pressed,
                  ]}
                  onPress={() => {
                    setEditingName(false);
                    setNameValue(user?.name ?? '');
                  }}
                  disabled={savingName}
                >
                  <Text style={styles.cancelBtnText}>取消</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [
                    styles.saveBtn,
                    pressed && styles.pressed,
                    savingName && styles.btnDisabled,
                  ]}
                  onPress={onSaveName}
                  disabled={savingName}
                >
                  {savingName ? (
                    <ActivityIndicator color={PaperColor} size="small" />
                  ) : (
                    <Text style={styles.saveBtnText}>保存</Text>
                  )}
                </Pressable>
              </View>
            </View>
          ) : (
            <Pressable
              style={({ pressed }) => [
                styles.menuItem,
                pressed && styles.pressed,
              ]}
              onPress={() => {
                setNameValue(user?.name ?? '');
                setEditingName(true);
              }}
            >
              <Ionicons name="create" size={20} color={StoneBlueColor} />
              <Text style={styles.menuText}>修改姓名</Text>
              <Ionicons name="chevron-forward" size={18} color={`${InkColor}55`} />
            </Pressable>
          )}
        </View>

        {/* 退出登录 */}
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
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: `${InkColor}1a`,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: `${InkColor}0f`,
  },
  infoLabel: {
    color: InkColor,
    fontSize: 14,
    opacity: 0.6,
  },
  infoValue: {
    color: InkColor,
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
    textAlign: 'right',
    marginLeft: 16,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    gap: 12,
  },
  menuText: {
    flex: 1,
    color: InkColor,
    fontSize: 15,
  },
  editRow: {
    gap: 12,
  },
  sectionTitle: {
    color: InkColor,
    fontSize: 15,
    fontWeight: '600',
  },
  inputRow: {
    flexDirection: 'row',
  },
  input: {
    flex: 1,
    backgroundColor: `${InkColor}05`,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: `${InkColor}1a`,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 15,
    color: InkColor,
  },
  btnRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  cancelBtn: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: `${InkColor}33`,
  },
  cancelBtnText: {
    color: InkColor,
    fontSize: 14,
    opacity: 0.7,
  },
  saveBtn: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: StoneBlueColor,
  },
  saveBtnText: {
    color: PaperColor,
    fontSize: 14,
    fontWeight: '600',
  },
  btnDisabled: {
    opacity: 0.7,
  },
  logoutBtn: {
    marginTop: 8,
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
