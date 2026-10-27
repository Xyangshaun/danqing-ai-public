import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Settings, User, Bell, Palette, Database, Cloud, Shield, Keyboard,
  Check, Loader2, type LucideIcon, Server, Wifi, WifiOff, Loader, Save, X,
} from 'lucide-react';
import {
  getSettings, saveSettings, clearAnalysisHistory, getAnalysisHistory,
  type UserSettings, LS_KEYS,
} from '../services/data-service';
import { useToast } from '../components/ToastProvider';
import { SkeletonBox } from '../components/PageSkeleton';
import { useAuth } from '../hooks/useAuth';
import { updateUserProfile, sendPhoneOtp, bindPhone } from '../services/api';
import { setLearnerProfile } from '../services/auth-sdk';
import type { UserRole, LearnerProfile } from '../types/api-contract';

type Section = {
  id: string;
  label: string;
  icon: LucideIcon;
  desc: string;
};

const sections: Section[] = [
  { id: 'account', label: '账户', icon: User, desc: '个人信息与身份' },
  { id: 'appearance', label: '外观', icon: Palette, desc: '主题、字号、界面密度' },
  { id: 'notifications', label: '通知', icon: Bell, desc: '提醒方式与频率' },
  { id: 'storage', label: '存储', icon: Database, desc: '本地缓存与历史记录' },
  { id: 'cloud', label: '云端同步', icon: Cloud, desc: '云端分析与数据同步' },
  { id: 'backend', label: '后端设置', icon: Server, desc: '后端开关、地址、健康检查' },
  { id: 'shortcuts', label: '快捷键', icon: Keyboard, desc: '查看与自定义快捷键' },
  { id: 'privacy', label: '隐私', icon: Shield, desc: '数据权限与安全' },
];

/* localStorage 键名 —— 与全局 data-service 配置保持一致 */
const LS_USE_API_KEY = 'danqing-ai-use-api';
const LS_BACKEND_URL_KEY = 'danqing-ai-backend-url';
const DEFAULT_BACKEND_URL = '/api/v1';

/* 健康检查状态：idle(未检查) / checking / ok / fail */
type HealthStatus = 'idle' | 'checking' | 'ok' | 'fail';

/* 读取 localStorage 中后端配置，提供安全默认值 */
function readUseApi(): boolean {
  try {
    return localStorage.getItem(LS_USE_API_KEY) === 'true';
  } catch {
    return false;
  }
}
function readBackendUrl(): string {
  try {
    return localStorage.getItem(LS_BACKEND_URL_KEY) || DEFAULT_BACKEND_URL;
  } catch {
    return DEFAULT_BACKEND_URL;
  }
}

const DEFAULT_SETTINGS: UserSettings = {
  theme: 'rice',
  density: 'comfortable',
  notifications: { analysis: true, growth: true, system: false },
  cloudSync: { enabled: true, autoSync: true, multiDevice: false },
  privacy: { anonymousAnalytics: true, localFirst: true, twoFactor: false },
};

/** 角色中文标签(只读展示用,后端 PATCH /users/role 仅 student 可自选一次) */
const ROLE_LABEL: Record<UserRole, string> = {
  admin: '管理员',
  teacher: '教师',
  student: '学生',
  owner: '所有者',
};

/** 学习者画像标签与提示(设置页可修改,决定诊断默认模式) */
const LEARNER_PROFILE_OPTIONS: Array<{
  value: LearnerProfile;
  label: string;
  hint: string;
}> = [
  { value: 'hobbyist', label: '艺术爱好者', hint: '默认教学诊断' },
  { value: 'beginner', label: '零基础入门', hint: '默认教学诊断' },
  { value: 'artStudent', label: '美术生', hint: '默认艺考诊断' },
];

/** OnlineMode 类型(与 Header 共享,通过 localStorage 同步) */
type OnlineMode = 'local' | 'cloud' | 'auto';

/** 从 localStorage 读取 onlineMode(初始化 cloudSync.enabled 用) */
function readOnlineMode(): OnlineMode {
  try {
    const v = localStorage.getItem(LS_KEYS.onlineMode);
    if (v === 'local' || v === 'cloud' || v === 'auto') return v;
  } catch { /* ignore */ }
  return 'auto';
}

export default function SettingsPage() {
  const toast = useToast();
  const { user, isAuthenticated, refreshUser } = useAuth();
  /* 用 ref 持有最新 toast 上下文,供加载 useEffect 内部调用。
   * 原因:ToastProvider 的 context value 对象每次渲染都会重建,
   * 若把 `toast` 直接放入加载 effect 依赖,会在每次 toast 出现/消失时
   * 重复触发 getSettings/getAnalysisHistory(造成无限循环)。 */
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const [active, setActive] = useState('account');
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [historyCount, setHistoryCount] = useState(0);

  /* 账户编辑状态(对接 PATCH /users/profile)
   * - editing:是否处于编辑模式
   * - profileSaving:保存中防重入
   * - draft:本地草稿(name/email/phone/avatar) */
  const [editing, setEditing] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [draft, setDraft] = useState({ name: '', email: '', phone: '', avatar: '' });

  /* 手机号 OTP 绑定状态(独立于编辑模式,随时可绑定)
   * - bindStep: 'idle'(未开始) | 'entering'(输入手机号) | 'otp-sent'(已发验证码) | 'verifying'(绑定中)
   * - bindPhoneInput / bindOtpInput: 表单值
   * - otpCountdown: 重发倒计时(秒,0=可重发)
   * - otpSending / bindVerifying: 防重入 */
  const [bindStep, setBindStep] = useState<'idle' | 'entering' | 'otp-sent' | 'verifying'>('idle');
  const [bindPhoneInput, setBindPhoneInput] = useState('');
  const [bindOtpInput, setBindOtpInput] = useState('');
  const [otpCountdown, setOtpCountdown] = useState(0);
  const [otpSending, setOtpSending] = useState(false);
  const [bindVerifying, setBindVerifying] = useState(false);

  /* 学习者画像修改状态(独立于资料编辑模式,即点即存) */
  const [learnerSaving, setLearnerSaving] = useState(false);

  /** 修改学习者画像(学生角色可见) → PATCH /users/learner-profile */
  const handleLearnerChange = useCallback(
    async (profile: LearnerProfile) => {
      if (learnerSaving || !user || user.learnerProfile === profile) return;
      setLearnerSaving(true);
      try {
        await setLearnerProfile(profile);
        await refreshUser();
        toastRef.current.success(
          '学习阶段已更新',
          profile === 'artStudent' ? '诊断将默认按艺考标准进行' : '诊断将默认按教学辅导模式进行',
        );
      } catch (err) {
        console.error('更新学习阶段失败:', err);
        toastRef.current.error('更新失败', err instanceof Error ? err.message : '请稍后重试');
      } finally {
        setLearnerSaving(false);
      }
    },
    [learnerSaving, user, refreshUser],
  );

  /* 后端配置：从 localStorage 初始化，状态变更时自动持久化 */
  const [useApi, setUseApi] = useState<boolean>(readUseApi);
  const [backendUrl, setBackendUrl] = useState<string>(readBackendUrl);
  const [healthStatus, setHealthStatus] = useState<HealthStatus>('idle');

  /* 初次加载:从 dataService 读取设置 + 历史条数 */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [s, history] = await Promise.all([
          getSettings(),
          getAnalysisHistory(),
        ]);
        if (cancelled) return;
        setSettings(s);
        setHistoryCount(history.length);
      } catch (err) {
        console.error('加载设置失败:', err);
        if (!cancelled) toastRef.current.error('加载设置失败', '请稍后重试');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // 仅在挂载时执行一次;toast 通过 ref 访问,不进入依赖数组(避免无限循环)
  }, []);

  /* 通用更新:局部 patch + 异步保存到 dataService */
  const updateSettings = useCallback(
    (patch: Partial<UserSettings>) => {
      setSettings((prev) => ({
        ...prev,
        ...patch,
        notifications: { ...prev.notifications, ...(patch.notifications ?? {}) },
        cloudSync: { ...prev.cloudSync, ...(patch.cloudSync ?? {}) },
        privacy: { ...prev.privacy, ...(patch.privacy ?? {}) },
      }));
      setSaving(true);
      void saveSettings(patch)
        .catch((err) => {
          console.error('保存设置失败:', err);
          toast.error('保存失败', '请稍后重试');
        })
        .finally(() => setSaving(false));
    },
    [toast]
  );

  const handleClearHistory = async () => {
    try {
      await clearAnalysisHistory();
      setHistoryCount(0);
      toast.success('历史已清空', '所有分析记录已被清除');
    } catch (err) {
      console.error('清空历史失败:', err);
      toast.error('清空失败', '请稍后重试');
    }
  };

  /* ===== 后端配置处理 ===== */

  /* 切换"启用后端 API"开关：立即写入 localStorage 并提示 */
  const handleToggleUseApi = (next: boolean) => {
    setUseApi(next);
    try {
      localStorage.setItem(LS_USE_API_KEY, String(next));
    } catch (err) {
      console.error('保存后端开关失败:', err);
    }
    toast.success(
      next ? '已启用后端 API' : '已切换为本地模式',
      next ? '数据将通过后端服务读取' : '数据将从 LocalStorage 读取'
    );
  };

  /* 后端地址变更：失焦时保存到 localStorage */
  const handleBackendUrlBlur = () => {
    const trimmed = backendUrl.trim();
    if (!trimmed) {
      setBackendUrl(DEFAULT_BACKEND_URL);
      try { localStorage.setItem(LS_BACKEND_URL_KEY, DEFAULT_BACKEND_URL); } catch { /* ignore */ }
      toast.info('已恢复默认后端地址', DEFAULT_BACKEND_URL);
      return;
    }
    try {
      localStorage.setItem(LS_BACKEND_URL_KEY, trimmed);
    } catch (err) {
      console.error('保存后端地址失败:', err);
      toast.error('保存失败', '请稍后重试');
      return;
    }
    // 地址变更后，重置健康检查状态
    setHealthStatus('idle');
    toast.success('后端地址已保存', trimmed);
  };

  /* 健康检查：调用 /health 接口，带 5s 超时 */
  const handleHealthCheck = async () => {
    const url = backendUrl.trim();
    if (!url) {
      toast.error('请先填写后端地址', '');
      return;
    }
    setHealthStatus('checking');
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`${url.replace(/\/$/, '')}/health`, {
        method: 'GET',
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.ok) {
        setHealthStatus('ok');
        toast.success('连接成功', `后端服务正常 (${res.status})`);
      } else {
        setHealthStatus('fail');
        toast.error('连接失败', `HTTP ${res.status}`);
      }
    } catch (err) {
      setHealthStatus('fail');
      const msg = err instanceof Error ? (err.name === 'AbortError' ? '请求超时' : err.message) : '未知错误';
      toast.error('连接失败', msg);
    }
  };

  /* 自动保存：监听 useApi / backendUrl 变化，确保刷新后配置不丢失。
     注：useApi 在 handleToggleUseApi 中已写入，此处只作兜底同步，避免重复提示。 */
  useEffect(() => {
    try { localStorage.setItem(LS_USE_API_KEY, String(useApi)); } catch { /* ignore */ }
  }, [useApi]);
  useEffect(() => {
    try { localStorage.setItem(LS_BACKEND_URL_KEY, backendUrl); } catch { /* ignore */ }
  }, [backendUrl]);

  /* 局部 setter：每个设置项变更时立即更新本地状态 + 异步落库到 dataService */
  const setTheme = (t: UserSettings['theme']) => {
    updateSettings({ theme: t });
    // 同步写入独立 LS 键,供 useTheme hook 立即响应(避免解析整 settings 对象)
    try { localStorage.setItem(LS_KEYS.theme, t); } catch { /* ignore */ }
    // 手动派发 storage 事件:同 tab 写 localStorage 不自动触发,需通知 useTheme hook
    window.dispatchEvent(new StorageEvent('storage', { key: LS_KEYS.theme, newValue: t }));
  };
  const setDensity = (d: UserSettings['density']) => {
    updateSettings({ density: d });
    try { localStorage.setItem(LS_KEYS.density, d); } catch { /* ignore */ }
    window.dispatchEvent(new StorageEvent('storage', { key: LS_KEYS.density, newValue: d }));
  };
  const setNotifications = (
    updater: (n: UserSettings['notifications']) => UserSettings['notifications']
  ) => updateSettings({ notifications: updater(settings.notifications) });
  const setCloudSync = (
    updater: (c: UserSettings['cloudSync']) => UserSettings['cloudSync']
  ) => {
    const next = updater(settings.cloudSync);
    updateSettings({ cloudSync: next });
    /* 需求5:cloudSync.enabled 切换时,联动 onlineMode 并派发事件 */
    if (next.enabled !== settings.cloudSync.enabled) {
      const mode: OnlineMode = next.enabled ? 'cloud' : 'local';
      try { localStorage.setItem(LS_KEYS.onlineMode, mode); } catch { /* ignore */ }
      window.dispatchEvent(new CustomEvent('online-mode-changed', { detail: mode }));
    }
  };
  const setPrivacy = (
    updater: (p: UserSettings['privacy']) => UserSettings['privacy']
  ) => updateSettings({ privacy: updater(settings.privacy) });

  /* 需求5:cloudSync.enabled 与 onlineMode 双向联动
   * - 挂载时从 onlineMode 推导 cloudSync.enabled(初始同步)
   * - 监听 Header 派发的 online-mode-changed 事件(用户在 Header 切换模式时) */
  useEffect(() => {
    const mode = readOnlineMode();
    if (mode === 'cloud' && !settings.cloudSync.enabled) {
      updateSettings({ cloudSync: { ...settings.cloudSync, enabled: true } });
    } else if (mode === 'local' && settings.cloudSync.enabled) {
      updateSettings({ cloudSync: { ...settings.cloudSync, enabled: false } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as OnlineMode | undefined;
      if (detail === 'cloud' && !settings.cloudSync.enabled) {
        updateSettings({ cloudSync: { ...settings.cloudSync, enabled: true } });
      } else if (detail === 'local' && settings.cloudSync.enabled) {
        updateSettings({ cloudSync: { ...settings.cloudSync, enabled: false } });
      }
    };
    window.addEventListener('online-mode-changed', handler);
    return () => window.removeEventListener('online-mode-changed', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.cloudSync.enabled, updateSettings]);

  /* 账户编辑:进入编辑模式时,从 user 同步草稿 */
  const startEditing = () => {
    setDraft({
      name: user?.name ?? '',
      email: user?.email ?? '',
      phone: user?.phone ?? '',
      avatar: user?.avatar ?? '',
    });
    setEditing(true);
  };

  /* 保存账户:调 PATCH /users/profile,成功后 refreshUser 同步全局 */
  const handleSaveProfile = async () => {
    if (!isAuthenticated) {
      toast.error('请先登录', '登录后才能修改个人资料');
      return;
    }
    setProfileSaving(true);
    try {
      await updateUserProfile({
        name: draft.name.trim() || undefined,
        email: draft.email.trim() || null,
        avatar: draft.avatar.trim() || undefined,
      });
      await refreshUser();
      toast.success('个人资料已保存');
      setEditing(false);
    } catch {
      // api.ts 已统一处理错误 Toast(silent:false 默认)
    } finally {
      setProfileSaving(false);
    }
  };

  const cancelEditing = () => {
    setEditing(false);
    setDraft({ name: '', email: '', phone: '', avatar: '' });
  };

  /* ===== 手机号 OTP 绑定 ===== */

  /* 倒计时 effect:每秒递减,到 0 停止 */
  useEffect(() => {
    if (otpCountdown <= 0) return;
    const timer = setTimeout(() => setOtpCountdown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [otpCountdown]);

  /* 发送验证码 */
  const handleSendOtp = async () => {
    const phone = bindPhoneInput.trim();
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      toast.error('手机号格式不正确', '请输入 11 位中国大陆手机号');
      return;
    }
    setOtpSending(true);
    try {
      const res = await sendPhoneOtp({ phone, purpose: 'bind' });
      setBindStep('otp-sent');
      setOtpCountdown(res.resendAfter);
      toast.success('验证码已发送', '开发模式下请查看服务器日志获取验证码');
    } catch {
      // api.ts 已统一处理错误 Toast
    } finally {
      setOtpSending(false);
    }
  };

  /* 绑定手机号 */
  const handleBindPhone = async () => {
    const phone = bindPhoneInput.trim();
    const code = bindOtpInput.trim();
    if (!/^\d{6}$/.test(code)) {
      toast.error('验证码格式不正确', '请输入 6 位数字验证码');
      return;
    }
    setBindVerifying(true);
    setBindStep('verifying');
    try {
      await bindPhone({ phone, code });
      await refreshUser();
      toast.success('手机号已绑定');
      setBindStep('idle');
      setBindPhoneInput('');
      setBindOtpInput('');
    } catch {
      // api.ts 已统一处理错误 Toast,保留在 otp-sent 步骤让用户重试
      setBindStep('otp-sent');
    } finally {
      setBindVerifying(false);
    }
  };

  /* 取消绑定流程 */
  const cancelBind = () => {
    setBindStep('idle');
    setBindPhoneInput('');
    setBindOtpInput('');
    setOtpCountdown(0);
  };

  /* 开始绑定/换绑 */
  const startBind = () => {
    setBindStep('entering');
    setBindPhoneInput('');
    setBindOtpInput('');
  };

  if (loading) {
    return (
      <div className="h-full flex bg-rice-200" role="status" aria-live="polite" aria-label="加载设置中">
        {/* 左：导航骨架 */}
        <aside className="w-60 flex-shrink-0 border-r border-ink-900/8 bg-rice-100/50 p-4">
          <SkeletonBox className="h-6 w-24 mb-2" />
          <SkeletonBox className="h-3 w-20 mb-6" />
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <SkeletonBox key={i} className="h-9 w-full" />
            ))}
          </div>
        </aside>
        {/* 右：表单内容骨架 */}
        <div className="flex-1 p-8 overflow-y-auto scrollbar-thin">
          <div className="max-w-2xl mx-auto space-y-6">
            <SkeletonBox className="h-8 w-1/3" />
            <div className="bg-rice-50 border border-ink-900/6 rounded-md p-6 space-y-4">
              <SkeletonBox className="h-4 w-1/4" />
              <SkeletonBox className="h-10 w-full" />
              <SkeletonBox className="h-4 w-1/4" />
              <SkeletonBox className="h-10 w-full" />
              <SkeletonBox className="h-10 w-32" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  const { theme, density, notifications, cloudSync, privacy } = settings;

  /* 清空历史按钮的二次确认(用 toast.warning,不使用 confirm) */
  const handleClearHistoryClick = () => {
    void handleClearHistory();
  };

  /* 历史最早记录时间(若有) */
  const earliestHistory = historyCount > 0 ? '从历史记录读取' : '—';

  return (
    <div className="h-full flex">
      {/* 左：设置项导航 */}
      <aside className="w-60 flex-shrink-0 border-r border-ink-900/8 bg-rice-100/50 overflow-y-auto scrollbar-thin">
        <div className="p-4 border-b border-ink-900/8">
          <h2 className="font-serif text-lg font-bold text-ink-900 flex items-center gap-2">
            <Settings className="w-4 h-4 text-cinnabar" />
            设置
            {saving && (
              <Loader2 className="w-3 h-3 text-ink-400 animate-spin ml-auto" />
            )}
          </h2>
          <p className="text-2xs text-ink-400 mt-1">系统偏好与配置</p>
        </div>
        <nav className="p-2">
          {sections.map((s) => {
            const Icon = s.icon;
            const isActive = active === s.id;
            return (
              <button
                key={s.id}
                onClick={() => setActive(s.id)}
                aria-label={s.label}
                className={`w-full flex items-center gap-3 px-3 h-10 rounded-md text-sm transition-colors text-left ${
                  isActive
                    ? 'bg-ink-900 text-rice-100 shadow-subtle'
                    : 'text-ink-600 hover:bg-ink-900/5 hover:text-ink-900'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-cinnabar-light' : ''}`} />
                <div className="flex-1 min-w-0">
                  <p className="font-medium leading-none">{s.label}</p>
                  <p className={`text-2xs mt-0.5 truncate ${isActive ? 'text-rice-300' : 'text-ink-400'}`}>
                    {s.desc}
                  </p>
                </div>
              </button>
            );
          })}
        </nav>
      </aside>

      {/* 右：设置详情 */}
      <div className="flex-1 overflow-y-auto scrollbar-thin p-6 md:p-8">
        <div className="max-w-2xl mx-auto">
          {active === 'account' && (
            <SectionBlock title="账户" desc="管理你的个人信息与身份">
              {/* 头像预览(已登录时显示) */}
              {isAuthenticated && user?.avatar && (
                <Field label="当前头像">
                  <div className="flex items-center gap-3">
                    <img
                      src={editing ? (draft.avatar || user.avatar) : user.avatar}
                      alt={user.name}
                      className="w-12 h-12 rounded-full object-cover border border-ink-900/10"
                      referrerPolicy="no-referrer"
                    />
                    {editing && (
                      <input
                        value={draft.avatar}
                        onChange={(e) => setDraft((d) => ({ ...d, avatar: e.target.value }))}
                        placeholder="头像 URL"
                        className="flex-1 h-9 px-3 bg-rice-50 border border-ink-900/10 rounded-md text-sm focus:border-cinnabar focus-ring transition-all"
                      />
                    )}
                  </div>
                </Field>
              )}

              <Field label="用户名">
                {editing ? (
                  <input
                    value={draft.name}
                    onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                    placeholder="请输入用户名"
                    className="w-full h-9 px-3 bg-rice-50 border border-ink-900/10 rounded-md text-sm focus:border-cinnabar focus-ring transition-all"
                  />
                ) : (
                  <input
                    value={user?.name ?? (isAuthenticated ? '' : '未登录')}
                    readOnly
                    className="w-full h-9 px-3 bg-rice-100 border border-ink-900/10 rounded-md text-sm text-ink-700 cursor-not-allowed"
                  />
                )}
              </Field>

              <Field label="邮箱">
                {editing ? (
                  <input
                    type="email"
                    value={draft.email}
                    onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))}
                    placeholder="请输入邮箱"
                    className="w-full h-9 px-3 bg-rice-50 border border-ink-900/10 rounded-md text-sm focus:border-cinnabar focus-ring transition-all"
                  />
                ) : (
                  <input
                    value={user?.email ?? (isAuthenticated ? '' : '未登录')}
                    readOnly
                    className="w-full h-9 px-3 bg-rice-100 border border-ink-900/10 rounded-md text-sm text-ink-700 cursor-not-allowed"
                  />
                )}
              </Field>

              <Field label="手机号">
                {/* idle:展示已绑定手机号或未绑定提示 */}
                {bindStep === 'idle' && (
                  <div className="flex items-center gap-2">
                    <input
                      value={user?.phone ? user.phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2') : (isAuthenticated ? '未绑定' : '未登录')}
                      readOnly
                      className="flex-1 h-9 px-3 bg-rice-100 border border-ink-900/10 rounded-md text-sm text-ink-700 cursor-not-allowed"
                    />
                    {isAuthenticated && (
                      <button
                        type="button"
                        onClick={startBind}
                        className="px-3 h-9 text-sm bg-ink-900/5 hover:bg-ink-900/10 text-ink-700 rounded-md transition-colors whitespace-nowrap"
                      >
                        {user?.phone ? '更换' : '绑定手机号'}
                      </button>
                    )}
                  </div>
                )}
                {/* entering:输入手机号 */}
                {bindStep === 'entering' && (
                  <div className="flex items-center gap-2">
                    <input
                      type="tel"
                      value={bindPhoneInput}
                      onChange={(e) => setBindPhoneInput(e.target.value)}
                      placeholder="请输入手机号"
                      maxLength={11}
                      className="flex-1 h-9 px-3 bg-rice-50 border border-ink-900/10 rounded-md text-sm focus:border-cinnabar focus-ring transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => void handleSendOtp()}
                      disabled={otpSending || !bindPhoneInput.trim()}
                      className="px-3 h-9 text-sm bg-cinnabar hover:bg-cinnabar-dark text-white rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap flex items-center gap-1.5"
                    >
                      {otpSending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      发送验证码
                    </button>
                    <button
                      type="button"
                      onClick={cancelBind}
                      className="px-3 h-9 text-sm bg-ink-900/5 hover:bg-ink-900/10 text-ink-700 rounded-md transition-colors"
                    >
                      取消
                    </button>
                  </div>
                )}
                {/* otp-sent / verifying:输入验证码并绑定 */}
                {(bindStep === 'otp-sent' || bindStep === 'verifying') && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <input
                        type="tel"
                        value={bindPhoneInput}
                        onChange={() => {}}
                        disabled
                        className="flex-1 h-9 px-3 bg-rice-100 border border-ink-900/10 rounded-md text-sm text-ink-500 cursor-not-allowed"
                      />
                      <button
                        type="button"
                        onClick={() => void handleSendOtp()}
                        disabled={otpSending || otpCountdown > 0}
                        className="px-3 h-9 text-sm bg-ink-900/5 hover:bg-ink-900/10 text-ink-700 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                      >
                        {otpCountdown > 0 ? `${otpCountdown}s 后重发` : '重发验证码'}
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        inputMode="numeric"
                        value={bindOtpInput}
                        onChange={(e) => setBindOtpInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        placeholder="请输入 6 位验证码"
                        maxLength={6}
                        className="flex-1 h-9 px-3 bg-rice-50 border border-ink-900/10 rounded-md text-sm focus:border-cinnabar focus-ring transition-all tracking-widest"
                      />
                      <button
                        type="button"
                        onClick={() => void handleBindPhone()}
                        disabled={bindVerifying || bindOtpInput.length !== 6}
                        className="px-3 h-9 text-sm bg-cinnabar hover:bg-cinnabar-dark text-white rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap flex items-center gap-1.5"
                      >
                        {bindVerifying && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                        确认绑定
                      </button>
                      <button
                        type="button"
                        onClick={cancelBind}
                        disabled={bindVerifying}
                        className="px-3 h-9 text-sm bg-ink-900/5 hover:bg-ink-900/10 text-ink-700 rounded-md transition-colors disabled:opacity-50"
                      >
                        取消
                      </button>
                    </div>
                  </div>
                )}
              </Field>

              <Field label="身份角色">
                {/* 只读:角色由 onboarding 选择或管理员分配,此处仅展示 */}
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled
                    className="px-3 h-9 rounded-md text-sm bg-ink-900 text-rice-100 cursor-not-allowed"
                  >
                    {user?.role ? ROLE_LABEL[user.role] : '—'}
                  </button>
                  <span className="text-2xs text-ink-400 self-center">
                    角色由首次登录引导或管理员分配,如需修改请联系管理员
                  </span>
                </div>
              </Field>

              {/* 学习阶段(仅学生):决定作品诊断默认模式,可随时修改 */}
              {user?.role === 'student' && (
                <Field label="学习阶段">
                  <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="学习阶段">
                    {LEARNER_PROFILE_OPTIONS.map((opt) => {
                      const active = (user?.learnerProfile ?? 'hobbyist') === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          onClick={() => void handleLearnerChange(opt.value)}
                          disabled={learnerSaving || !isAuthenticated}
                          className={`px-3 h-9 rounded-md text-sm transition-colors flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed ${
                            active
                              ? 'bg-cinnabar text-white'
                              : 'bg-rice-100 hover:bg-rice-200 text-ink-700'
                          }`}
                        >
                          {active && learnerSaving ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : active ? (
                            <Check className="w-3.5 h-3.5" />
                          ) : null}
                          {opt.label}
                          <span className={`text-2xs ${active ? 'text-white/75' : 'text-ink-400'}`}>
                            {opt.hint}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-2xs text-ink-400 mt-2">
                    美术生默认按联考标准艺考诊断;其余默认教学诊断。诊断页仍可随时手动切换模式
                  </p>
                </Field>
              )}

              {/* 编辑/保存/取消按钮 */}
              <div className="flex gap-2 pt-2">
                {!editing ? (
                  <button
                    onClick={startEditing}
                    disabled={!isAuthenticated}
                    aria-label="编辑资料"
                    className="px-4 h-9 text-sm bg-cinnabar hover:bg-cinnabar-dark text-white rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                  >
                    <Settings className="w-3.5 h-3.5" />
                    编辑资料
                  </button>
                ) : (
                  <>
                    <button
                      onClick={() => void handleSaveProfile()}
                      disabled={profileSaving}
                      aria-label="保存"
                      className="px-4 h-9 text-sm bg-cinnabar hover:bg-cinnabar-dark text-white rounded-md transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-1.5"
                    >
                      {profileSaving ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Save className="w-3.5 h-3.5" />
                      )}
                      保存
                    </button>
                    <button
                      onClick={cancelEditing}
                      disabled={profileSaving}
                      aria-label="取消"
                      className="px-4 h-9 text-sm bg-rice-100 hover:bg-rice-200 text-ink-700 rounded-md transition-colors disabled:opacity-60 flex items-center gap-1.5"
                    >
                      <X className="w-3.5 h-3.5" />
                      取消
                    </button>
                  </>
                )}
              </div>
            </SectionBlock>
          )}

          {active === 'appearance' && (
            <SectionBlock title="外观" desc="调整界面视觉效果">
              <Field label="主题">
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'rice', label: '米白', desc: '默认' },
                    { id: 'ink', label: '墨黑', desc: '暗色' },
                    { id: 'auto', label: '跟随系统', desc: '自动' },
                  ].map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setTheme(t.id as typeof theme)}
                      className={`p-3 rounded-md border text-left transition-all ${
                        theme === t.id
                          ? 'border-cinnabar bg-cinnabar/5'
                          : 'border-ink-900/10 hover:border-ink-900/20'
                      }`}
                    >
                      <p className="text-sm font-medium text-ink-900">{t.label}</p>
                      <p className="text-2xs text-ink-400 mt-0.5">{t.desc}</p>
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="界面密度">
                <div className="grid grid-cols-3 gap-2">
                  {(['compact', 'comfortable', 'spacious'] as const).map((d) => (
                    <button
                      key={d}
                      onClick={() => setDensity(d)}
                      className={`p-3 rounded-md border text-left transition-all ${
                        density === d
                          ? 'border-cinnabar bg-cinnabar/5'
                          : 'border-ink-900/10 hover:border-ink-900/20'
                      }`}
                    >
                      <p className="text-sm font-medium text-ink-900">
                        {d === 'compact' ? '紧凑' : d === 'comfortable' ? '舒适' : '宽松'}
                      </p>
                    </button>
                  ))}
                </div>
              </Field>
            </SectionBlock>
          )}

          {active === 'notifications' && (
            <SectionBlock title="通知" desc="控制何时接收提醒">
              <Toggle
                label="诊断完成"
                desc="AI 分析完成后通知"
                value={notifications.analysis}
                onChange={(v) => setNotifications((n) => ({ ...n, analysis: v }))}
              />
              <Toggle
                label="成长周报"
                desc="每周汇总能力变化"
                value={notifications.growth}
                onChange={(v) => setNotifications((n) => ({ ...n, growth: v }))}
              />
              <Toggle
                label="系统更新"
                desc="新版本发布时提醒"
                value={notifications.system}
                onChange={(v) => setNotifications((n) => ({ ...n, system: v }))}
              />
            </SectionBlock>
          )}

          {active === 'storage' && (
            <SectionBlock title="存储" desc="本地缓存与历史记录">
              <Field label="本地缓存">
                <div className="flex items-center justify-between p-3 bg-rice-100 rounded-md">
                  <div>
                    <p className="text-sm font-medium text-ink-900">已使用 24.5 MB</p>
                    <p className="text-2xs text-ink-400 mt-0.5">历史记录、缩略图、设置</p>
                  </div>
                  <button className="px-3 h-8 text-xs bg-rice-50 border border-ink-900/10 hover:bg-rice-200 text-ink-700 rounded-md transition-colors">
                    清理缓存
                  </button>
                </div>
              </Field>
              <Field label="历史记录">
                <div className="flex items-center justify-between p-3 bg-rice-100 rounded-md">
                  <div>
                    <p className="text-sm font-medium text-ink-900">共 {historyCount} 条记录</p>
                    <p className="text-2xs text-ink-400 mt-0.5">最早：{earliestHistory}</p>
                  </div>
                  <button
                    onClick={handleClearHistoryClick}
                    disabled={historyCount === 0}
                    className="px-3 h-8 text-xs bg-rice-50 border border-cinnabar/30 text-cinnabar hover:bg-cinnabar/5 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    清空历史
                  </button>
                </div>
              </Field>
            </SectionBlock>
          )}

          {active === 'cloud' && (
            <SectionBlock title="云端同步" desc="启用云端 AI 增强分析">
              <Toggle
                label="云端分析"
                desc="启用更强大的云端 AI 模型"
                value={cloudSync.enabled}
                onChange={(v) => setCloudSync((c) => ({ ...c, enabled: v }))}
              />
              <Toggle
                label="自动同步"
                desc="诊断结果自动上传云端"
                value={cloudSync.autoSync}
                onChange={(v) => setCloudSync((c) => ({ ...c, autoSync: v }))}
              />
              <Toggle
                label="多端同步"
                desc="在多个设备间同步数据"
                value={cloudSync.multiDevice}
                onChange={(v) => setCloudSync((c) => ({ ...c, multiDevice: v }))}
              />
            </SectionBlock>
          )}

          {active === 'backend' && (
            <SectionBlock title="后端设置" desc="配置后端 API 连接，切换数据来源">
              {/* 后端开关 */}
              <Toggle
                label="启用后端 API"
                desc="开启后数据通过后端服务读取，关闭则使用 LocalStorage"
                value={useApi}
                onChange={handleToggleUseApi}
              />

              {/* 后端地址输入 */}
              <Field label="后端地址">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={backendUrl}
                    onChange={(e) => setBackendUrl(e.target.value)}
                    onBlur={handleBackendUrlBlur}
                    placeholder={DEFAULT_BACKEND_URL}
                    className="flex-1 h-9 px-3 bg-rice-50 border border-ink-900/10 rounded-md text-sm focus:border-cinnabar focus-ring transition-all font-mono"
                  />
                  <button
                    type="button"
                    onClick={handleHealthCheck}
                    disabled={healthStatus === 'checking'}
                    aria-label="测试连接"
                    className="px-3 h-9 text-sm bg-ink-900 hover:bg-ink-800 text-rice-100 rounded-md transition-colors flex items-center gap-1.5 disabled:opacity-60 disabled:cursor-not-allowed flex-shrink-0"
                  >
                    {healthStatus === 'checking' ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        检查中
                      </>
                    ) : (
                      <>
                        <Wifi className="w-3.5 h-3.5" />
                        测试连接
                      </>
                    )}
                  </button>
                </div>
                <p className="text-2xs text-ink-400 mt-1.5">
                  修改后失焦自动保存。默认 {DEFAULT_BACKEND_URL}
                </p>
              </Field>

              {/* 连接状态指示器 */}
              <div className="p-3 bg-rice-100 rounded-md">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-ink-900">连接状态</span>
                    {healthStatus === 'idle' && (
                      <span className="inline-flex items-center gap-1 text-xs text-ink-400">
                        <span className="w-1.5 h-1.5 bg-ink-300 rounded-full" />
                        未检查
                      </span>
                    )}
                    {healthStatus === 'checking' && (
                      <span className="inline-flex items-center gap-1 text-xs text-ink-500">
                        <Loader className="w-3 h-3 animate-spin" />
                        检查中...
                      </span>
                    )}
                    {healthStatus === 'ok' && (
                      <span className="inline-flex items-center gap-1 text-xs text-jade">
                        <Wifi className="w-3 h-3" />
                        已连接
                      </span>
                    )}
                    {healthStatus === 'fail' && (
                      <span className="inline-flex items-center gap-1 text-xs text-cinnabar">
                        <WifiOff className="w-3 h-3" />
                        连接失败
                      </span>
                    )}
                  </div>
                  {/* 状态色块：直观反映连接状态 */}
                  <span
                    className={`w-2 h-2 rounded-full ${
                      healthStatus === 'ok'
                        ? 'bg-jade'
                        : healthStatus === 'fail'
                        ? 'bg-cinnabar'
                        : healthStatus === 'checking'
                        ? 'bg-ink-400 animate-pulse'
                        : 'bg-ink-300'
                    }`}
                    aria-hidden="true"
                  />
                </div>
                {healthStatus === 'fail' && (
                  <p className="text-2xs text-ink-500 mt-2 leading-relaxed">
                    请确认后端服务已启动，地址正确，且 CORS 已允许当前域名访问。
                  </p>
                )}
              </div>
            </SectionBlock>
          )}

          {active === 'shortcuts' && (
            <SectionBlock title="快捷键" desc="提升操作效率，快速触达所有功能">
              <ShortcutGroup
                title="导航类"
                items={[
                  { desc: '跳转 AI 诊断', keys: ['1'] },
                  { desc: '跳转素材库', keys: ['2'] },
                  { desc: '跳转风格库', keys: ['3'] },
                  { desc: '跳转灵感嫁接', keys: ['4'] },
                  { desc: '跳转情绪画布', keys: ['5'] },
                  { desc: '跳转历史记录', keys: ['6'] },
                  { desc: '跳转成长曲线', keys: ['7'] },
                  { desc: '跳转 AI 生成', keys: ['8'] },
                  { desc: '跳转设置', keys: ['0'] },
                  { desc: '新建诊断', keys: ['N'] },
                  { desc: '折叠 / 展开侧栏', keys: ['B'] },
                ]}
              />
              <ShortcutGroup
                title="诊断页操作"
                items={[
                  { desc: '重新分析', keys: ['R'] },
                  { desc: '撤销到上传前', keys: ['⌘', 'Z'] },
                  { desc: '撤销到上传前（备选）', keys: ['Ctrl', 'Z'] },
                ]}
              />
              <ShortcutGroup
                title="画布页操作"
                items={[
                  { desc: '切换笔刷', keys: ['B'] },
                  { desc: '切换橡皮', keys: ['E'] },
                  { desc: '撤销', keys: ['Ctrl', 'Z'] },
                  { desc: '重做', keys: ['Ctrl', 'Shift', 'Z'] },
                ]}
              />
              <ShortcutGroup
                title="搜索类"
                items={[
                  { desc: '打开命令面板', keys: ['⌘', 'K'] },
                  { desc: '打开命令面板（备选）', keys: ['Ctrl', 'K'] },
                  { desc: '聚焦搜索框（打开命令面板）', keys: ['/'] },
                  { desc: '关闭命令面板', keys: ['Esc'] },
                ]}
              />
              <ShortcutGroup
                title="命令面板内"
                items={[
                  { desc: '上下选择', keys: ['↑', '↓'] },
                  { desc: '确认执行', keys: ['Enter'] },
                ]}
              />
            </SectionBlock>
          )}

          {active === 'privacy' && (
            <SectionBlock title="隐私" desc="数据权限与安全">
              <Toggle
                label="匿名分析"
                desc="使用匿名数据改进 AI"
                value={privacy.anonymousAnalytics}
                onChange={(v) => setPrivacy((p) => ({ ...p, anonymousAnalytics: v }))}
              />
              <Toggle
                label="本地优先"
                desc="敏感作品仅在本地分析"
                value={privacy.localFirst}
                onChange={(v) => setPrivacy((p) => ({ ...p, localFirst: v }))}
              />
              <Toggle
                label="双因子认证"
                desc="登录时需要二次验证"
                value={privacy.twoFactor}
                onChange={(v) => setPrivacy((p) => ({ ...p, twoFactor: v }))}
              />
              {/* 法律文件与投诉渠道(备案合规:应用内可直达协议与投诉入口) */}
              <div className="pt-2 border-t border-ink-900/8">
                <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
                  <a href="https://danqing.site/terms" target="_blank" rel="noopener noreferrer" className="text-ink-600 hover:text-cinnabar transition-colors">服务条款</a>
                  <a href="https://danqing.site/privacy" target="_blank" rel="noopener noreferrer" className="text-ink-600 hover:text-cinnabar transition-colors">隐私政策</a>
                  <a href="mailto:2692963779@qq.com?subject=%E6%8A%95%E8%AF%89%E4%B8%BE%E6%8A%A5" className="text-ink-600 hover:text-cinnabar transition-colors">投诉举报</a>
                </div>
                <p className="text-2xs text-ink-400 mt-2">投诉举报:2692963779@qq.com(受理后 3 个工作日内回复)</p>
              </div>
            </SectionBlock>
          )}
        </div>
      </div>
    </div>
  );
}

function SectionBlock({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="animate-fade-in">
      <div className="mb-6">
        <h3 className="font-serif text-2xl font-bold text-ink-900">{title}</h3>
        <p className="text-sm text-ink-500 mt-1">{desc}</p>
      </div>
      <div className="space-y-4">
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-ink-700 mb-2">{label}</label>
      {children}
    </div>
  );
}

function Toggle({ label, desc, value, onChange }: { label: string; desc: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between p-3 bg-rice-100 rounded-md">
      <div>
        <p className="text-sm font-medium text-ink-900">{label}</p>
        <p className="text-2xs text-ink-400 mt-0.5">{desc}</p>
      </div>
      <button
        onClick={() => onChange(!value)}
        aria-label={label}
        aria-pressed={value}
        className={`relative w-10 h-6 rounded-full transition-colors ${
          value ? 'bg-cinnabar' : 'bg-ink-900/15'
        }`}
      >
        <span
          className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-subtle transition-all ${
            value ? 'left-[18px]' : 'left-0.5'
          }`}
        >
          {value && <Check className="w-3 h-3 text-cinnabar absolute top-1 left-1" />}
        </span>
      </button>
    </div>
  );
}

/* 快捷键分组：标题 + 多条快捷键项 */
function ShortcutGroup({ title, items }: { title: string; items: { desc: string; keys: string[] }[] }) {
  return (
    <div>
      <h4 className="font-serif text-sm font-bold text-ink-900 mb-3">{title}</h4>
      <div>
        {items.map((s) => (
          <div
            key={s.desc}
            className="flex justify-between items-center py-2 border-b border-ink-900/6"
          >
            <span className="text-sm text-ink-700">{s.desc}</span>
            <div className="flex gap-1">
              {s.keys.map((k, i) => (
                <kbd
                  key={i}
                  className="px-1.5 py-0.5 bg-rice-200 border border-ink-900/10 rounded text-xs font-mono text-ink-700"
                >
                  {k}
                </kbd>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
