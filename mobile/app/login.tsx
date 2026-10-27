// ============================================================
// 丹青有AI 移动端登录页(P3-1.4 + Phase 5 多登录方式扩展)
// - 居中布局:logo + 应用名 + 引导文案 + 登录方式切换
// - 水墨色系:背景宣纸白 / 主操作石青 / 文字墨黑 / 金色点缀
// - 支持 4 种登录方式:
//   1. 飞书 OAuth(默认主推,最大按钮,始终可见)
//   2. 手机验证码(手机号 + 验证码 + 60s 倒计时 + 可选邀请码/姓名 + 登录/注册切换)
//   3. 邀请码(邀请码 + 可选姓名)
//   4. 院校管理员(邮箱 + 密码 + 登录/注册切换;注册需邀请码 + 姓名 + 可选租户名)
// - 统一登录成功处理:校验 refreshToken + csrfToken → setAuth + 持久化 secure-store + 跳首页
// - OAuth 流程同 P3-1.4:feishuAuthorize → openAuthSessionAsync → feishuCallback
// - 交互:Tab 切换表单 / OTP 60s 倒计时 / 登录注册分段控件 / 键盘适配
// ============================================================
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../src/store';
import { authStorage } from '../src/utils/storage';
import { getOrCreateDeviceId } from '../src/services/device';
import {
  feishuAuthorize,
  feishuCallback,
  phoneOtp,
  phoneVerify,
  invitationRedeem,
  adminLogin,
  adminRegister,
} from '../src/services/auth';
import type { FeishuCallbackResponse } from '../src/types/api-contract';
import {
  InkColor,
  PaperColor,
  StoneBlueColor,
  GoldColor,
} from '../src/theme/colors';

/** 登录方式 Tab 标识(飞书为独立主推按钮,不参与 Tab 切换) */
type LoginTab = 'phone' | 'invitation' | 'admin';

/** 当前正在执行的登录动作(用于精确显示 loading 指示器) */
type LoadingAction = 'feishu' | 'phone' | 'invitation' | 'admin' | 'otp' | null;

/** Tab 配置(icon 为 Ionicons 图标名) */
const TABS = [
  { key: 'phone', label: '手机号', icon: 'call' },
  { key: 'invitation', label: '邀请码', icon: 'gift' },
  { key: 'admin', label: '管理员', icon: 'school' },
] as const;

/** 从 openAuthSessionAsync 返回的 redirect URL 中解析 code + state 查询参数 */
function parseAuthRedirect(url: string): { code: string; state: string } {
  const parsed = Linking.parse(url);
  const params = parsed.queryParams ?? {};
  const code = params.code;
  const state = params.state;
  const codeStr = Array.isArray(code) ? code[0] : code;
  const stateStr = Array.isArray(state) ? state[0] : state;
  if (!codeStr || !stateStr) {
    throw new Error('授权回调缺少 code 或 state 参数');
  }
  return { code: codeStr, state: stateStr };
}

/** 中国大陆手机号校验:1[3-9] + 9 位数字 */
function isValidPhone(phone: string): boolean {
  return /^1[3-9]\d{9}$/.test(phone);
}

/** 6 位数字验证码校验 */
function isValidOtpCode(code: string): boolean {
  return /^\d{6}$/.test(code);
}

/** 邮箱格式校验 */
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export default function LoginScreen() {
  const setAuth = useAuthStore((s) => s.setAuth);

  // ---- 公共状态 ----
  const [loadingAction, setLoadingAction] = useState<LoadingAction>(null);
  const [activeTab, setActiveTab] = useState<LoginTab>('phone');

  // ---- 手机验证码表单 ----
  const [phone, setPhone] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [phonePurpose, setPhonePurpose] = useState<'login' | 'register'>('login');
  const [phoneInvitationCode, setPhoneInvitationCode] = useState('');
  const [phoneName, setPhoneName] = useState('');
  // 验证码倒计时(>0 表示倒计时中,获取按钮禁用)
  const [otpCountdown, setOtpCountdown] = useState(0);
  const otpTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ---- 邀请码表单 ----
  const [invitationCode, setInvitationCode] = useState('');
  const [invitationName, setInvitationName] = useState('');

  // ---- 管理员表单 ----
  const [adminMode, setAdminMode] = useState<'login' | 'register'>('login');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [adminName, setAdminName] = useState('');
  const [adminInvitationCode, setAdminInvitationCode] = useState('');
  const [adminTenantName, setAdminTenantName] = useState('');

  const loading = loadingAction !== null;

  // ---- 组件卸载时清理 OTP 倒计时(避免内存泄漏)----
  useEffect(() => {
    return () => {
      if (otpTimerRef.current) {
        clearInterval(otpTimerRef.current);
        otpTimerRef.current = null;
      }
    };
  }, []);

  /**
   * 清理 OTP 倒计时定时器并重置计数。
   * 登录成功 / 组件卸载时调用。
   * 注:切换 Tab 时不清除(保留冷却计时,防止用户切换 Tab 绕过客户端重发限制)。
   */
  const clearOtpTimer = () => {
    if (otpTimerRef.current) {
      clearInterval(otpTimerRef.current);
      otpTimerRef.current = null;
    }
    setOtpCountdown(0);
  };

  /**
   * 统一登录成功处理(4 种登录方式共用,避免重复代码)。
   * 1. 校验 mobile 分支必返回字段(refreshToken + csrfToken)
   * 2. 写入 zustand store(内存态,立即生效)
   * 3. 持久化 secure-store(下次冷启动水合)
   * 4. 跳首页(路由守卫基于 isAuthenticated 放行)
   */
  const handleLoginSuccess = async (resp: FeishuCallbackResponse): Promise<void> => {
    if (!resp.refreshToken || !resp.csrfToken) {
      throw new Error(
        '后端未返回 refreshToken/csrfToken(请确认 client=mobile 分支已启用)',
      );
    }
    setAuth({
      accessToken: resp.accessToken,
      accessTokenExpiresAt: resp.accessTokenExpiresAt,
      refreshToken: resp.refreshToken,
      csrfToken: resp.csrfToken,
      user: resp.user,
    });
    await Promise.all([
      authStorage.setAccessToken(resp.accessToken),
      authStorage.setAccessTokenExpiresAt(resp.accessTokenExpiresAt),
      authStorage.setRefreshToken(resp.refreshToken),
      authStorage.setCsrfToken(resp.csrfToken),
      authStorage.setUser(resp.user),
    ]);
    clearOtpTimer();
    router.replace('/');
  };

  const onCancel = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      // 无可返回页(冷启动直达登录):跳首页,路由守卫会再次拉回 /login
      router.replace('/');
    }
  };

  // ============ 1. 飞书 OAuth 登录 ============
  const loginWithFeishu = async () => {
    if (loading) return;
    setLoadingAction('feishu');
    try {
      // 1. 设备 ID(首次生成并持久化)
      const deviceId = await getOrCreateDeviceId();
      // 2. redirect URI(app.config.js extra.feishuRedirectUriMobile)
      const redirectUri =
        (Constants.expoConfig?.extra as { feishuRedirectUriMobile?: string } | undefined)
          ?.feishuRedirectUriMobile ?? 'danqing://auth/feishu/callback';
      // 3. 取授权 URL + state
      const authorizeResp = await feishuAuthorize({ deviceId, redirectUri });
      // 4. 系统浏览器打开飞书授权页(深链接回调由 promise 捕获)
      const result = await WebBrowser.openAuthSessionAsync(
        authorizeResp.authorizeUrl,
        redirectUri,
      );
      if (result.type !== 'success' || !result.url) {
        // 用户取消 / 浏览器异常:静默退出,不报错
        return;
      }
      // 5. 解析 redirect URL 取 code + state
      const { code, state } = parseAuthRedirect(result.url);
      // 6. 换 token(后端对 client=mobile 在响应体返回 refreshToken + csrfToken)
      const cb = await feishuCallback({ code, state, deviceId });
      // 7. 统一处理登录成功
      await handleLoginSuccess(cb);
    } catch (err) {
      const message = err instanceof Error ? err.message : '登录失败,请稍后重试';
      Alert.alert('登录失败', message);
    } finally {
      setLoadingAction(null);
    }
  };

  // ============ 2. 手机验证码:获取验证码 ============
  const sendOtp = async () => {
    if (otpCountdown > 0 || loading) return;
    if (!isValidPhone(phone)) {
      Alert.alert('手机号格式错误', '请输入正确的 11 位手机号');
      return;
    }
    setLoadingAction('otp');
    try {
      const resp = await phoneOtp({ phone, purpose: phonePurpose });
      if (resp.sent) {
        // 启动倒计时(以后端 resendAfter 为准,兜底 60s)
        const seconds = resp.resendAfter > 0 ? resp.resendAfter : 60;
        setOtpCountdown(seconds);
        otpTimerRef.current = setInterval(() => {
          setOtpCountdown((prev) => {
            if (prev <= 1) {
              if (otpTimerRef.current) {
                clearInterval(otpTimerRef.current);
                otpTimerRef.current = null;
              }
              return 0;
            }
            return prev - 1;
          });
        }, 1000);
      } else {
        Alert.alert('发送失败', '验证码发送失败,请稍后重试');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '验证码发送失败';
      Alert.alert('发送失败', message);
    } finally {
      setLoadingAction(null);
    }
  };

  // ============ 2. 手机验证码:登录/注册 ============
  const loginWithPhone = async () => {
    if (loading) return;
    if (!isValidPhone(phone)) {
      Alert.alert('手机号格式错误', '请输入正确的 11 位手机号');
      return;
    }
    if (!isValidOtpCode(otpCode)) {
      Alert.alert('验证码错误', '请输入 6 位数字验证码');
      return;
    }
    setLoadingAction('phone');
    try {
      const deviceId = await getOrCreateDeviceId();
      const resp = await phoneVerify({
        phone,
        code: otpCode,
        purpose: phonePurpose,
        invitationCode: phoneInvitationCode.trim() || undefined,
        name: phoneName.trim() || undefined,
        deviceId,
      });
      await handleLoginSuccess(resp);
    } catch (err) {
      const message = err instanceof Error ? err.message : '登录失败,请稍后重试';
      Alert.alert('登录失败', message);
    } finally {
      setLoadingAction(null);
    }
  };

  // ============ 3. 邀请码兑换 ============
  const loginWithInvitation = async () => {
    if (loading) return;
    if (!invitationCode.trim()) {
      Alert.alert('邀请码不能为空', '请输入邀请码');
      return;
    }
    setLoadingAction('invitation');
    try {
      const deviceId = await getOrCreateDeviceId();
      const resp = await invitationRedeem({
        code: invitationCode.trim(),
        name: invitationName.trim() || undefined,
        deviceId,
      });
      await handleLoginSuccess(resp);
    } catch (err) {
      const message = err instanceof Error ? err.message : '兑换失败,请稍后重试';
      Alert.alert('兑换失败', message);
    } finally {
      setLoadingAction(null);
    }
  };

  // ============ 4. 管理员登录/注册 ============
  const submitAdmin = async () => {
    if (loading) return;
    if (!isValidEmail(adminEmail)) {
      Alert.alert('邮箱格式错误', '请输入正确的邮箱地址');
      return;
    }
    if (adminPassword.length < 8) {
      Alert.alert('密码强度不足', '密码至少 8 位,需含大小写字母 + 数字');
      return;
    }
    if (adminMode === 'register') {
      if (!adminName.trim()) {
        Alert.alert('姓名不能为空', '请输入姓名');
        return;
      }
      if (!adminInvitationCode.trim()) {
        Alert.alert('邀请码不能为空', '请输入院校管理员邀请码');
        return;
      }
    }
    setLoadingAction('admin');
    try {
      const deviceId = await getOrCreateDeviceId();
      if (adminMode === 'login') {
        const resp = await adminLogin({
          email: adminEmail.trim(),
          password: adminPassword,
          deviceId,
        });
        await handleLoginSuccess(resp);
      } else {
        const resp = await adminRegister({
          email: adminEmail.trim(),
          password: adminPassword,
          name: adminName.trim(),
          invitationCode: adminInvitationCode.trim(),
          tenantName: adminTenantName.trim() || undefined,
          deviceId,
        });
        await handleLoginSuccess(resp);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '操作失败,请稍后重试';
      Alert.alert(adminMode === 'login' ? '登录失败' : '注册失败', message);
    } finally {
      setLoadingAction(null);
    }
  };

  // ============ 切换 Tab(保留各表单已输入内容 + OTP 倒计时)============
  const switchTab = (tab: LoginTab) => {
    if (loading) return;
    setActiveTab(tab);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      {/* 顶部取消按钮(固定,不随滚动) */}
      <View style={styles.topBar}>
        <Pressable
          style={({ pressed }) => [styles.cancelBtn, pressed && styles.pressed]}
          onPress={onCancel}
          hitSlop={12}
          disabled={loading}
        >
          <Text style={styles.cancelText}>取消</Text>
        </Pressable>
      </View>

      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          alwaysBounceVertical={false}
          showsVerticalScrollIndicator={false}
        >
          {/* Logo + 应用名 */}
          <View style={styles.logoWrap}>
            <View style={styles.logoCircle}>
              <Ionicons name="color-palette" size={48} color={GoldColor} />
            </View>
            <Text style={styles.appName}>丹青有AI</Text>
            <Text style={styles.appSlogan}>AI 美术作品诊断</Text>
          </View>

          {/* 飞书登录(主推,最大按钮) */}
          <View style={styles.feishuSection}>
            <Text style={styles.guideText}>
              使用飞书账号登录,快速开始 AI 美术诊断
            </Text>
            <Pressable
              style={({ pressed }) => [
                styles.feishuBtn,
                pressed && styles.pressed,
                loading && styles.btnDisabled,
              ]}
              onPress={loginWithFeishu}
              disabled={loading}
            >
              {loadingAction === 'feishu' ? (
                <ActivityIndicator color={PaperColor} />
              ) : (
                <>
                  <Ionicons name="people" size={20} color={PaperColor} />
                  <Text style={styles.feishuBtnText}>飞书登录</Text>
                </>
              )}
            </Pressable>
          </View>

          {/* 分割线:其他登录方式 */}
          <View style={styles.dividerWrap}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>其他登录方式</Text>
            <View style={styles.dividerLine} />
          </View>

          {/* Tab 切换 */}
          <View style={styles.tabRow}>
            {TABS.map((tab) => {
              const active = activeTab === tab.key;
              return (
                <Pressable
                  key={tab.key}
                  style={({ pressed }) => [
                    styles.tabBtn,
                    active && styles.tabBtnActive,
                    pressed && styles.pressed,
                    loading && styles.btnDisabled,
                  ]}
                  onPress={() => switchTab(tab.key)}
                  disabled={loading}
                >
                  <Ionicons
                    name={tab.icon}
                    size={14}
                    color={active ? StoneBlueColor : InkColor}
                  />
                  <Text
                    style={[
                      styles.tabBtnText,
                      active && styles.tabBtnTextActive,
                    ]}
                  >
                    {tab.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* 当前 Tab 的表单 */}
          <View style={styles.formWrap}>
            {/* ---- 手机验证码表单 ---- */}
            {activeTab === 'phone' && (
              <View style={styles.formCard}>
                {/* 登录/注册分段切换 */}
                <View style={styles.segmentRow}>
                  {([
                    { key: 'login', label: '已注册登录' },
                    { key: 'register', label: '新用户注册' },
                  ] as const).map((seg) => {
                    const active = phonePurpose === seg.key;
                    return (
                      <Pressable
                        key={seg.key}
                        style={({ pressed }) => [
                          styles.segmentBtn,
                          active && styles.segmentBtnActive,
                          pressed && styles.pressed,
                        ]}
                        onPress={() => setPhonePurpose(seg.key)}
                        disabled={loading}
                      >
                        <Text
                          style={[
                            styles.segmentBtnText,
                            active && styles.segmentBtnTextActive,
                          ]}
                        >
                          {seg.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                {/* 手机号 */}
                <View style={styles.fieldWrap}>
                  <Text style={styles.fieldLabel}>手机号</Text>
                  <TextInput
                    style={styles.input}
                    value={phone}
                    onChangeText={setPhone}
                    placeholder="请输入 11 位手机号"
                    placeholderTextColor={`${InkColor}66`}
                    keyboardType="phone-pad"
                    maxLength={11}
                    autoCapitalize="none"
                    autoCorrect={false}
                    textContentType="telephoneNumber"
                    editable={!loading}
                  />
                </View>

                {/* 验证码 + 获取验证码按钮 */}
                <View style={styles.fieldWrap}>
                  <Text style={styles.fieldLabel}>验证码</Text>
                  <View style={styles.inputRow}>
                    <TextInput
                      style={[styles.input, styles.inputFlex]}
                      value={otpCode}
                      onChangeText={setOtpCode}
                      placeholder="6 位验证码"
                      placeholderTextColor={`${InkColor}66`}
                      keyboardType="number-pad"
                      maxLength={6}
                      autoCapitalize="none"
                      autoCorrect={false}
                      textContentType="oneTimeCode"
                      editable={!loading}
                    />
                    <Pressable
                      style={({ pressed }) => [
                        styles.otpBtn,
                        pressed && styles.pressed,
                        (otpCountdown > 0 || loading) && styles.otpBtnDisabled,
                      ]}
                      onPress={sendOtp}
                      disabled={otpCountdown > 0 || loading}
                    >
                      {loadingAction === 'otp' ? (
                        <ActivityIndicator size="small" color={StoneBlueColor} />
                      ) : (
                        <Text
                          style={[
                            styles.otpBtnText,
                            otpCountdown > 0 && styles.otpBtnTextDisabled,
                          ]}
                        >
                          {otpCountdown > 0 ? `${otpCountdown}s 后重发` : '获取验证码'}
                        </Text>
                      )}
                    </Pressable>
                  </View>
                </View>

                {/* 可选:邀请码(register 场景推荐填写,加入指定租户) */}
                <View style={styles.fieldWrap}>
                  <Text style={styles.fieldLabel}>
                    邀请码
                    <Text style={styles.fieldOptional}> (可选,加入指定租户)</Text>
                  </Text>
                  <TextInput
                    style={styles.input}
                    value={phoneInvitationCode}
                    onChangeText={setPhoneInvitationCode}
                    placeholder="请输入邀请码"
                    placeholderTextColor={`${InkColor}66`}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    editable={!loading}
                  />
                </View>

                {/* 可选:姓名(新用户建议填写) */}
                <View style={styles.fieldWrap}>
                  <Text style={styles.fieldLabel}>
                    姓名
                    <Text style={styles.fieldOptional}> (可选,新用户建议填写)</Text>
                  </Text>
                  <TextInput
                    style={styles.input}
                    value={phoneName}
                    onChangeText={setPhoneName}
                    placeholder="请输入姓名"
                    placeholderTextColor={`${InkColor}66`}
                    autoCapitalize="words"
                    autoCorrect={false}
                    editable={!loading}
                  />
                </View>

                <Pressable
                  style={({ pressed }) => [
                    styles.submitBtn,
                    pressed && styles.pressed,
                    loading && styles.btnDisabled,
                  ]}
                  onPress={loginWithPhone}
                  disabled={loading}
                >
                  {loadingAction === 'phone' ? (
                    <ActivityIndicator color={PaperColor} />
                  ) : (
                    <Text style={styles.submitBtnText}>
                      {phonePurpose === 'login' ? '登录' : '注册并登录'}
                    </Text>
                  )}
                </Pressable>
              </View>
            )}

            {/* ---- 邀请码表单 ---- */}
            {activeTab === 'invitation' && (
              <View style={styles.formCard}>
                <Text style={styles.formHint}>
                  输入老师/院校发放的邀请码,兑换后自动加入对应租户
                </Text>

                <View style={styles.fieldWrap}>
                  <Text style={styles.fieldLabel}>邀请码</Text>
                  <TextInput
                    style={styles.input}
                    value={invitationCode}
                    onChangeText={setInvitationCode}
                    placeholder="请输入邀请码"
                    placeholderTextColor={`${InkColor}66`}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    editable={!loading}
                  />
                </View>

                <View style={styles.fieldWrap}>
                  <Text style={styles.fieldLabel}>
                    姓名
                    <Text style={styles.fieldOptional}> (可选)</Text>
                  </Text>
                  <TextInput
                    style={styles.input}
                    value={invitationName}
                    onChangeText={setInvitationName}
                    placeholder="请输入姓名"
                    placeholderTextColor={`${InkColor}66`}
                    autoCapitalize="words"
                    autoCorrect={false}
                    editable={!loading}
                  />
                </View>

                <Pressable
                  style={({ pressed }) => [
                    styles.submitBtn,
                    pressed && styles.pressed,
                    loading && styles.btnDisabled,
                  ]}
                  onPress={loginWithInvitation}
                  disabled={loading}
                >
                  {loadingAction === 'invitation' ? (
                    <ActivityIndicator color={PaperColor} />
                  ) : (
                    <Text style={styles.submitBtnText}>兑换并登录</Text>
                  )}
                </Pressable>
              </View>
            )}

            {/* ---- 管理员邮箱密码表单 ---- */}
            {activeTab === 'admin' && (
              <View style={styles.formCard}>
                <Text style={styles.formHint}>
                  院校管理员账号登录;新管理员需使用邀请码注册
                </Text>

                {/* 登录/注册分段切换 */}
                <View style={styles.segmentRow}>
                  {([
                    { key: 'login', label: '登录' },
                    { key: 'register', label: '注册' },
                  ] as const).map((seg) => {
                    const active = adminMode === seg.key;
                    return (
                      <Pressable
                        key={seg.key}
                        style={({ pressed }) => [
                          styles.segmentBtn,
                          active && styles.segmentBtnActive,
                          pressed && styles.pressed,
                        ]}
                        onPress={() => setAdminMode(seg.key)}
                        disabled={loading}
                      >
                        <Text
                          style={[
                            styles.segmentBtnText,
                            active && styles.segmentBtnTextActive,
                          ]}
                        >
                          {seg.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                <View style={styles.fieldWrap}>
                  <Text style={styles.fieldLabel}>邮箱</Text>
                  <TextInput
                    style={styles.input}
                    value={adminEmail}
                    onChangeText={setAdminEmail}
                    placeholder="请输入邮箱"
                    placeholderTextColor={`${InkColor}66`}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    textContentType="emailAddress"
                    editable={!loading}
                  />
                </View>

                <View style={styles.fieldWrap}>
                  <Text style={styles.fieldLabel}>密码</Text>
                  <TextInput
                    style={styles.input}
                    value={adminPassword}
                    onChangeText={setAdminPassword}
                    placeholder="至少 8 位,含大小写 + 数字"
                    placeholderTextColor={`${InkColor}66`}
                    secureTextEntry
                    autoCapitalize="none"
                    autoCorrect={false}
                    textContentType="password"
                    editable={!loading}
                  />
                </View>

                {/* 注册专属字段:姓名 + 管理员邀请码 + 租户名 */}
                {adminMode === 'register' && (
                  <>
                    <View style={styles.fieldWrap}>
                      <Text style={styles.fieldLabel}>姓名</Text>
                      <TextInput
                        style={styles.input}
                        value={adminName}
                        onChangeText={setAdminName}
                        placeholder="请输入姓名"
                        placeholderTextColor={`${InkColor}66`}
                        autoCapitalize="words"
                        autoCorrect={false}
                        editable={!loading}
                      />
                    </View>

                    <View style={styles.fieldWrap}>
                      <Text style={styles.fieldLabel}>管理员邀请码</Text>
                      <TextInput
                        style={styles.input}
                        value={adminInvitationCode}
                        onChangeText={setAdminInvitationCode}
                        placeholder="请输入院校管理员邀请码"
                        placeholderTextColor={`${InkColor}66`}
                        autoCapitalize="characters"
                        autoCorrect={false}
                        editable={!loading}
                      />
                    </View>

                    <View style={styles.fieldWrap}>
                      <Text style={styles.fieldLabel}>
                        租户名称
                        <Text style={styles.fieldOptional}> (可选,新建院校名称)</Text>
                      </Text>
                      <TextInput
                        style={styles.input}
                        value={adminTenantName}
                        onChangeText={setAdminTenantName}
                        placeholder="如:XX 美术学院"
                        placeholderTextColor={`${InkColor}66`}
                        autoCapitalize="words"
                        autoCorrect={false}
                        editable={!loading}
                      />
                    </View>
                  </>
                )}

                <Pressable
                  style={({ pressed }) => [
                    styles.submitBtn,
                    pressed && styles.pressed,
                    loading && styles.btnDisabled,
                  ]}
                  onPress={submitAdmin}
                  disabled={loading}
                >
                  {loadingAction === 'admin' ? (
                    <ActivityIndicator color={PaperColor} />
                  ) : (
                    <Text style={styles.submitBtnText}>
                      {adminMode === 'login' ? '登录' : '注册并登录'}
                    </Text>
                  )}
                </Pressable>
              </View>
            )}
          </View>

          {/* 协议 */}
          <Text style={styles.termsText}>
            登录即表示同意《用户协议》与《隐私政策》
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: PaperColor,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingBottom: 32,
  },
  // ---- 顶部取消按钮 ----
  topBar: {
    height: 44,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  cancelBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  cancelText: {
    color: InkColor,
    fontSize: 16,
    opacity: 0.7,
  },
  pressed: {
    opacity: 0.5,
  },
  btnDisabled: {
    opacity: 0.7,
  },
  // ---- Logo + 应用名 ----
  logoWrap: {
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 24,
  },
  logoCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: '#ffffff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: `${InkColor}1a`,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    shadowColor: InkColor,
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  appName: {
    color: InkColor,
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: 2,
  },
  appSlogan: {
    color: InkColor,
    fontSize: 13,
    opacity: 0.55,
    marginTop: 6,
    letterSpacing: 1,
  },
  // ---- 飞书登录区(主推)----
  feishuSection: {
    gap: 12,
    marginBottom: 24,
  },
  guideText: {
    color: InkColor,
    fontSize: 13,
    opacity: 0.7,
    textAlign: 'center',
    lineHeight: 20,
  },
  feishuBtn: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: StoneBlueColor,
  },
  feishuBtnText: {
    color: PaperColor,
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 1,
  },
  // ---- 分割线 ----
  dividerWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: `${InkColor}1a`,
  },
  dividerText: {
    color: InkColor,
    fontSize: 12,
    opacity: 0.5,
  },
  // ---- Tab 切换 ----
  tabRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  tabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: `${InkColor}1a`,
    backgroundColor: '#ffffff',
  },
  tabBtnActive: {
    borderColor: StoneBlueColor,
    backgroundColor: `${StoneBlueColor}0d`,
  },
  tabBtnText: {
    color: InkColor,
    fontSize: 13,
    opacity: 0.7,
  },
  tabBtnTextActive: {
    color: StoneBlueColor,
    opacity: 1,
    fontWeight: '600',
  },
  // ---- 表单区 ----
  formWrap: {
    minHeight: 160,
    marginBottom: 20,
  },
  formCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: `${InkColor}0f`,
    gap: 12,
  },
  formHint: {
    color: InkColor,
    fontSize: 12,
    opacity: 0.55,
    lineHeight: 18,
  },
  // ---- 分段切换(登录/注册)----
  segmentRow: {
    flexDirection: 'row',
    backgroundColor: `${InkColor}08`,
    borderRadius: 10,
    padding: 3,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  segmentBtnActive: {
    backgroundColor: '#ffffff',
    shadowColor: InkColor,
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  segmentBtnText: {
    color: InkColor,
    fontSize: 13,
    opacity: 0.6,
  },
  segmentBtnTextActive: {
    color: InkColor,
    opacity: 1,
    fontWeight: '600',
  },
  // ---- 输入框 ----
  fieldWrap: {
    gap: 6,
  },
  fieldLabel: {
    color: InkColor,
    fontSize: 13,
    fontWeight: '500',
  },
  fieldOptional: {
    fontWeight: '400',
    opacity: 0.5,
    fontSize: 12,
  },
  input: {
    backgroundColor: `${InkColor}05`,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: `${InkColor}1a`,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 15,
    color: InkColor,
  },
  inputRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'stretch',
  },
  inputFlex: {
    flex: 1,
  },
  // ---- 获取验证码按钮 ----
  otpBtn: {
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: StoneBlueColor,
    backgroundColor: `${StoneBlueColor}0d`,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 112,
  },
  otpBtnDisabled: {
    borderColor: `${InkColor}1a`,
    backgroundColor: `${InkColor}05`,
    opacity: 0.7,
  },
  otpBtnText: {
    color: StoneBlueColor,
    fontSize: 13,
    fontWeight: '600',
  },
  otpBtnTextDisabled: {
    color: InkColor,
    opacity: 0.6,
  },
  // ---- 提交按钮 ----
  submitBtn: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: StoneBlueColor,
    marginTop: 4,
  },
  submitBtnText: {
    color: PaperColor,
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 1,
  },
  // ---- 协议 ----
  termsText: {
    color: InkColor,
    fontSize: 12,
    opacity: 0.5,
    textAlign: 'center',
    lineHeight: 18,
  },
});
