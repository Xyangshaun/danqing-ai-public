import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Search, Bell, Settings, HelpCircle, Cloud, CloudOff,
  ChevronRight, ChevronDown, Home, Command, X, ArrowRight,
  User, Image as ImageIcon, LogOut, Check, Sparkles,
  CheckCircle2, TrendingUp, RefreshCw, Trash2, Clock,
  Brush, PenTool, Box, Layers, History, Download, type LucideIcon,
  ExternalLink, Gauge, School, Scroll,
} from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import LogoMark from './LogoMark';
import { useToast } from './ToastProvider';
import { useAuth } from '../hooks/useAuth';
import TenantSwitcher, { RoleBadge } from './auth/TenantSwitcher';
import { isAdminRole } from './auth/RequireAdminRole';
import {
  getAnalysisHistory,
  clearAnalysisHistory,
  getSettings,
  saveSettings,
  LS_KEYS,
  type UserSettings,
} from '../services/data-service';
import type { HistoryRecord, ArtType } from '../types';
import {
  listNotifications,
  getUnreadNotificationCount,
  markNotificationRead,
  markAllNotificationsRead,
} from '../services/api';
import type { Notification as ApiNotification, NotificationType, NotificationLevel } from '../types/api-contract';

/* 路由 → 页面标题映射 */
const routeMeta: Record<string, { title: string; subtitle: string; category: string }> = {
  '/': { title: '工作台', subtitle: '我的创作仪表盘', category: '首页' },
  '/analyze': { title: 'AI 诊断', subtitle: '智能分析作品构图、色彩、技法', category: '核心工具' },
  '/materials': { title: '素材库', subtitle: '中外艺术作品参考', category: '核心工具' },
  '/styles': { title: '风格库', subtitle: '中式美学风格转换', category: '核心工具' },
  '/fuse': { title: '灵感嫁接', subtitle: '元素融合生成新作品', category: '核心工具' },
  '/emotion': { title: '情绪画布', subtitle: '情绪转色调参考', category: '核心工具' },
  '/history': { title: '历史记录', subtitle: '查看所有诊断记录', category: '数据追踪' },
  '/growth': { title: '成长曲线', subtitle: '能力变化趋势分析', category: '数据追踪' },
  '/settings': { title: '设置', subtitle: '系统偏好与配置', category: '系统' },
};

/* 分类 → 首条路由（用于面包屑回退） */
const categoryRoute: Record<string, string> = {
  '首页': '/',
  '核心工具': '/analyze',
  '数据追踪': '/history',
  '系统': '/settings',
};

/* 命令面板搜索项（keywords 含中文别名 + 拼音首字母，支持拼音首字母搜索） */
const searchItems: { path: string; title: string; desc: string; icon: LucideIcon; keywords: string }[] = [
  { path: '/analyze', title: '新建 AI 诊断', desc: '上传作品进行智能分析', icon: Search, keywords: '诊断 分析 上传 AI zd fx sc' },
  { path: '/materials', title: '浏览素材库', desc: '中外艺术作品参考', icon: Search, keywords: '素材 作品 参考 灵感 sc zp ck lg' },
  { path: '/styles', title: '风格库', desc: '中式美学风格转换', icon: Search, keywords: '风格 水墨 青绿 非遗 fg sm ql fy' },
  { path: '/fuse', title: '灵感嫁接', desc: '融合两张草图生成新作品', icon: Search, keywords: '嫁接 融合 灵感 元素 jj rh lg ys' },
  { path: '/emotion', title: '情绪画布', desc: '情绪关键词转色调', icon: Search, keywords: '情绪 画布 色调 心情 qx hb sd xq' },
  { path: '/history', title: '历史记录', desc: '查看所有诊断记录', icon: Search, keywords: '历史 记录 之前 ls jl zq' },
  { path: '/growth', title: '成长曲线', desc: '能力变化趋势', icon: Search, keywords: '成长 曲线 趋势 数据 cz qx qs sj' },
  { path: '/settings', title: '设置', desc: '系统偏好与配置', icon: Search, keywords: '设置 偏好 配置 sz ph pz' },
];

/* 模拟通知数据 */
type NotificationItem = {
  id: number;
  icon: LucideIcon;
  iconClass: string;
  title: string;
  desc: string;
  time: string;
};

/**
 * 通知面板统一展示类型
 * - 基础字段来自 NotificationItem(mock 与 API 映射项均含)
 * - 扩展字段(apiId/linkUrl/read/level)仅在已登录使用 API 数据时存在;
 *   mock(未登录回退)不提供这些字段,故设为可选,渲染时通过 isAuthenticated 分支区分
 */
type DisplayNotification = NotificationItem & {
  apiId?: string;
  linkUrl?: string | null;
  read?: boolean;
  level?: NotificationLevel;
};

const mockNotifications: NotificationItem[] = [
  {
    id: 1,
    icon: CheckCircle2,
    iconClass: 'text-jade bg-jade/10',
    title: '作品分析完成',
    desc: '《山水图》智能分析报告已生成，可查看',
    time: '2 分钟前',
  },
  {
    id: 2,
    icon: TrendingUp,
    iconClass: 'text-stone bg-stone/10',
    title: '成长报告已生成',
    desc: '本月能力提升 12%，新增 8 件作品记录',
    time: '1 小时前',
  },
  {
    id: 3,
    icon: RefreshCw,
    iconClass: 'text-cinnabar bg-cinnabar/10',
    title: '系统更新提示',
    desc: '新版本 v1.2.0 已就绪，建议立即更新',
    time: '昨天',
  },
];

/* ====== 通知系统:类型 → 图标/样式映射 + 相对时间格式化(任务包 B)====== */

/**
 * 通知类型 → 图标 + 样式映射
 * 与后端 NotificationType 枚举一一对应(SYSTEM/ANALYSIS_DONE/ANALYSIS_FAIL/REVIEW/SUBSCRIPTION/INVITATION)
 */
const notificationTypeMeta: Record<NotificationType, { icon: LucideIcon; iconClass: string }> = {
  SYSTEM: { icon: Sparkles, iconClass: 'text-stone bg-stone/10' },
  ANALYSIS_DONE: { icon: CheckCircle2, iconClass: 'text-jade bg-jade/10' },
  ANALYSIS_FAIL: { icon: RefreshCw, iconClass: 'text-cinnabar bg-cinnabar/10' },
  REVIEW: { icon: TrendingUp, iconClass: 'text-stone bg-stone/10' },
  SUBSCRIPTION: { icon: Cloud, iconClass: 'text-jade bg-jade/10' },
  INVITATION: { icon: User, iconClass: 'text-gold-dark bg-gold/10' },
};

/**
 * 通知级别 → 边框/强调色(用于未读项左侧色条,可选增强)
 * INFO/SUCCESS/WARN/ERROR 与后端 NotificationLevel 枚举一一对应
 */
const notificationLevelAccent: Record<NotificationLevel, string> = {
  INFO: '',
  SUCCESS: 'border-l-2 border-l-jade',
  WARN: 'border-l-2 border-l-gold-dark',
  ERROR: 'border-l-2 border-l-cinnabar',
};

/**
 * 将 ISO 时间字符串格式化为中文相对时间(如"2 分钟前""1 小时前""昨天")
 * @param iso ISO 8601 时间字符串
 * @returns 中文相对时间描述
 */
function formatRelativeTime(iso: string): string {
  const date = new Date(iso);
  const now = Date.now();
  const diffMs = now - date.getTime();
  if (Number.isNaN(diffMs)) return '';
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return '刚刚';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} 小时前`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay === 1) return '昨天';
  if (diffDay < 7) return `${diffDay} 天前`;
  return date.toLocaleDateString('zh-CN');
}

/**
 * 将 API 通知条目映射为面板展示项
 * @param n API 契约 Notification
 * @returns 面板展示项(含图标/样式/相对时间)
 */
function mapApiNotificationToDisplay(n: ApiNotification): NotificationItem & {
  apiId: string;
  linkUrl?: string | null;
  read: boolean;
  level: NotificationLevel;
} {
  const meta = notificationTypeMeta[n.type] ?? notificationTypeMeta.SYSTEM;
  return {
    id: 0, // 占位,实际用 apiId
    apiId: n.id,
    icon: meta.icon,
    iconClass: meta.iconClass,
    title: n.title,
    desc: n.content,
    time: formatRelativeTime(n.createdAt),
    linkUrl: n.linkUrl,
    read: n.readAt !== null,
    level: n.level,
  };
}

/* 运行模式选项 */
type OnlineMode = 'local' | 'cloud' | 'auto';

const onlineModes: { id: OnlineMode; label: string; icon: LucideIcon; desc: string }[] = [
  { id: 'local', label: '本地模式', icon: CloudOff, desc: '离线运行，数据不上传' },
  { id: 'cloud', label: '云端模式', icon: Cloud, desc: '连接云端，全功能可用' },
  { id: 'auto', label: '自动选择', icon: Sparkles, desc: '根据网络智能切换' },
];

/* 用户菜单项 */
const userMenuItems: { id: string; label: string; icon: LucideIcon; path: string }[] = [
  { id: 'profile', label: '个人中心', icon: User, path: '/settings' },
  { id: 'works', label: '我的作品', icon: ImageIcon, path: '/history' },
  { id: 'settings', label: '设置', icon: Settings, path: '/settings' },
];

/* ====== 命令面板：分类搜索增强 ====== */
type CommandCategory = 'function' | 'recent' | 'work' | 'action';
type CategoryFilter = 'all' | CommandCategory;

interface CommandItem {
  id: string;
  category: CommandCategory;
  title: string;
  desc: string;
  icon: LucideIcon;
  iconClass: string;
  action: () => void;
  /** 拼音/别名关键词，参与搜索过滤（支持拼音首字母匹配） */
  keywords?: string;
  /** 快捷键提示（如导航命令 1-8），渲染为右侧 kbd */
  shortcut?: string;
}

const commandCategories: { id: CategoryFilter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'function', label: '功能' },
  { id: 'recent', label: '最近' },
  { id: 'work', label: '作品' },
  { id: 'action', label: '操作' },
];

const categorySectionTitles: Record<CommandCategory, string> = {
  function: '功能',
  recent: '最近访问',
  work: '历史作品',
  action: '操作',
};

const artTypeMeta: Record<ArtType, { label: string; icon: LucideIcon }> = {
  painting: { label: '绘画', icon: Brush },
  design: { label: '设计', icon: PenTool },
  product: { label: '产品设计', icon: Box },
  sculpture: { label: '雕塑', icon: Layers },
  heritage: { label: '非遗', icon: Scroll },
};

export default function Header() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, tenant, isAuthenticated, logout } = useAuth();
  const [cmdOpen, setCmdOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [online, setOnline] = useState(true);
  const [activeCategory, setActiveCategory] = useState<CategoryFilter>('all');
  const [recentVisits, setRecentVisits] = useState<string[]>([]);
  const [historyWorks, setHistoryWorks] = useState<HistoryRecord[]>([]);
  const cmdInputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  /* 新增：各下拉面板的展开状态 */
  const [notifOpen, setNotifOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [modeOpen, setModeOpen] = useState(false);
  /* 需求5:onlineMode 从 localStorage 初始化,持久化 + 派发事件 */
  const [onlineMode, setOnlineMode] = useState<OnlineMode>(() => {
    try {
      const v = localStorage.getItem(LS_KEYS.onlineMode);
      if (v === 'local' || v === 'cloud' || v === 'auto') return v;
    } catch { /* ignore */ }
    return 'auto';
  });
  const [unreadCount, setUnreadCount] = useState(0);

  /* 需求1+4:帮助 + 快设面板状态 */
  const [helpOpen, setHelpOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /* 需求4:快设面板中的本地偏好(theme/density/notifications,从 settings 同步) */
  const [quickSettings, setQuickSettings] = useState<UserSettings | null>(null);

  /* 任务包 B:通知系统真实数据状态 */
  // apiNotifications:从后端拉取的通知列表(已登录时);未登录时为空,回退到 mock
  const [apiNotifications, setApiNotifications] = useState<ApiNotification[]>([]);
  // notifLoading:防止重复拉取 + 面板打开时显示轻量加载态
  const [notifLoading, setNotifLoading] = useState(false);

  /* 各面板外层容器 ref，用于点击外部关闭 */
  const notifRef = useRef<HTMLDivElement>(null);
  const userRef = useRef<HTMLDivElement>(null);
  const modeRef = useRef<HTMLDivElement>(null);
  const helpRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);

  /* 需求4:延迟关闭计时器(避免鼠标移动抖动导致面板闪烁) */
  const settingsHoverTimer = useRef<number | null>(null);

  /* 需求4:首次打开快设面板时加载 settings(惰性加载,避免每次渲染都读 LS) */
  useEffect(() => {
    if (!settingsOpen) return;
    let cancelled = false;
    (async () => {
      try {
        const s = await getSettings();
        if (!cancelled) setQuickSettings(s);
      } catch {
        if (!cancelled) setQuickSettings(null);
      }
    })();
    return () => { cancelled = true; };
  }, [settingsOpen]);

  const meta = routeMeta[location.pathname] || routeMeta['/'];

  /* 任务包 B:拉取未读计数(已登录时,30 秒轮询)
   * - 仅在 isAuthenticated 时启动轮询,登出时停止
   * - silent: true(api.ts 已配置),401/网络错误不弹 Toast
   * - 组件卸载时清理定时器,避免内存泄漏
   */
  const fetchUnreadCount = useCallback(async () => {
    if (!isAuthenticated) {
      setUnreadCount(0);
      return;
    }
    try {
      const res = await getUnreadNotificationCount();
      setUnreadCount(res.count);
    } catch {
      // 静默失败:不影响主界面,下次轮询重试
    }
  }, [isAuthenticated]);

  useEffect(() => {
    void fetchUnreadCount();
    if (!isAuthenticated) return;
    const timer = window.setInterval(() => void fetchUnreadCount(), 30_000);
    return () => window.clearInterval(timer);
  }, [fetchUnreadCount, isAuthenticated]);

  /* 任务包 B:通知面板打开时拉取通知列表(已登录时)
   * - 仅在 notifOpen 切换为 true 且已登录时拉取(惰性加载,减少无效请求)
   * - 拉取最近 20 条(limit=20),游标分页后续可扩展"加载更多"
   * - 拉取失败时保持空列表,面板显示"暂无通知"兜底
   */
  useEffect(() => {
    if (!notifOpen || !isAuthenticated) return;
    let cancelled = false;
    (async () => {
      setNotifLoading(true);
      try {
        const res = await listNotifications({ limit: 20 });
        if (!cancelled) setApiNotifications(res.items);
      } catch {
        if (!cancelled) setApiNotifications([]);
      } finally {
        if (!cancelled) setNotifLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [notifOpen, isAuthenticated]);

  /* 全局快捷键：⌘K / Ctrl+K 打开命令面板；Esc 关闭；监听 / 键触发的 open-command-palette 事件 */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCmdOpen(true);
      }
      if (e.key === 'Escape' && cmdOpen) setCmdOpen(false);
    };
    const openPalette = () => setCmdOpen(true);
    window.addEventListener('keydown', handler);
    window.addEventListener('open-command-palette', openPalette as EventListener);
    return () => {
      window.removeEventListener('keydown', handler);
      window.removeEventListener('open-command-palette', openPalette as EventListener);
    };
  }, [cmdOpen]);

  /* 监听全局 close-notification-panel 事件以关闭通知面板。
   * App.tsx 在按 Esc 时派发该事件(与命令面板对称),此处补齐监听器,
   * 让 Esc 能关闭通知面板(无障碍:弹层应支持 Esc 关闭,符合 WAI-ARIA 模态对话框约定)。 */
  useEffect(() => {
    const closeNotif = () => setNotifOpen(false);
    window.addEventListener('close-notification-panel', closeNotif);
    return () => window.removeEventListener('close-notification-panel', closeNotif);
  }, []);

  /* 命令面板打开时聚焦输入框、重置状态、异步读取历史作品 */
  useEffect(() => {
    if (!cmdOpen) return;
    setTimeout(() => cmdInputRef.current?.focus(), 50);
    setQuery('');
    setSelectedIndex(0);
    setActiveCategory('all');
    let cancelled = false;
    (async () => {
      try {
        const records = await getAnalysisHistory();
        if (!cancelled) setHistoryWorks(records);
      } catch (err) {
        console.error('命令面板加载历史失败:', err);
        if (!cancelled) setHistoryWorks([]);
      }
    })();
    return () => { cancelled = true; };
  }, [cmdOpen]);

  /* 记录最近访问页面（最多5个，去重） */
  useEffect(() => {
    const path = location.pathname;
    setRecentVisits((prev) => [path, ...prev.filter((p) => p !== path)].slice(0, 5));
  }, [location.pathname]);

  /* 选中索引在搜索词/分类变化时重置为 0 */
  useEffect(() => {
    setSelectedIndex(0);
  }, [query, activeCategory]);

  /* 在线状态检测 */
  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  /* 点击外部关闭各下拉面板 */
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (notifRef.current && !notifRef.current.contains(target)) setNotifOpen(false);
      if (userRef.current && !userRef.current.contains(target)) setUserOpen(false);
      if (modeRef.current && !modeRef.current.contains(target)) setModeOpen(false);
      if (helpRef.current && !helpRef.current.contains(target)) setHelpOpen(false);
      if (settingsRef.current && !settingsRef.current.contains(target)) setSettingsOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  /* 构建各分类命令项 — useMemo 避免每次渲染重建大数组 */
  const functionItems = useMemo<CommandItem[]>(() => [
    ...searchItems.map((it, idx) => ({
      id: `fn-${it.path}`,
      category: 'function' as const,
      title: it.title,
      desc: it.desc,
      icon: it.icon,
      iconClass: 'bg-cinnabar/10 text-cinnabar',
      action: () => { navigate(it.path); setCmdOpen(false); },
      keywords: it.keywords,
      shortcut: String(idx + 1),
    })),
    /* 新增：切换作品类型命令（dispatch 'switch-art-type' 事件，由分析页等监听） */
    {
      id: 'fn-switch-painting',
      category: 'function',
      title: '切换作品类型：绘画',
      desc: '将当前分析类型切换为绘画',
      icon: Brush,
      iconClass: 'bg-cinnabar/10 text-cinnabar',
      action: () => {
        window.dispatchEvent(new CustomEvent('switch-art-type', { detail: { artType: 'painting' } }));
        toast.success('已切换为绘画类型');
        setCmdOpen(false);
      },
      keywords: '切换 类型 绘画 painting hh qh lx',
    },
    {
      id: 'fn-switch-design',
      category: 'function',
      title: '切换作品类型：设计',
      desc: '将当前分析类型切换为设计',
      icon: PenTool,
      iconClass: 'bg-cinnabar/10 text-cinnabar',
      action: () => {
        window.dispatchEvent(new CustomEvent('switch-art-type', { detail: { artType: 'design' } }));
        toast.success('已切换为设计类型');
        setCmdOpen(false);
      },
      keywords: '切换 类型 设计 design sj qh lx',
    },
    {
      id: 'fn-switch-product',
      category: 'function',
      title: '切换作品类型：产品',
      desc: '将当前分析类型切换为产品设计',
      icon: Box,
      iconClass: 'bg-cinnabar/10 text-cinnabar',
      action: () => {
        window.dispatchEvent(new CustomEvent('switch-art-type', { detail: { artType: 'product' } }));
        toast.success('已切换为产品设计类型');
        setCmdOpen(false);
      },
      keywords: '切换 类型 产品 设计 product cp sj qh lx',
    },
    {
      id: 'fn-switch-sculpture',
      category: 'function',
      title: '切换作品类型：雕塑',
      desc: '将当前分析类型切换为雕塑',
      icon: Layers,
      iconClass: 'bg-cinnabar/10 text-cinnabar',
      action: () => {
        window.dispatchEvent(new CustomEvent('switch-art-type', { detail: { artType: 'sculpture' } }));
        toast.success('已切换为雕塑类型');
        setCmdOpen(false);
      },
      keywords: '切换 类型 雕塑 sculpture ds qh lx',
    },
  ], [navigate, toast]);

  const recentItems = useMemo<CommandItem[]>(() => recentVisits.flatMap((path) => {
    const found = searchItems.find((it) => it.path === path);
    if (!found) return [];
    return [{
      id: `rc-${found.path}`,
      category: 'recent' as const,
      title: found.title,
      desc: found.desc,
      icon: Clock,
      iconClass: 'bg-stone/10 text-stone',
      action: () => { navigate(found.path); setCmdOpen(false); },
      keywords: found.keywords,
    }];
  }), [recentVisits, navigate]);

  const workItems = useMemo<CommandItem[]>(() => historyWorks.map((rec) => {
    const meta = artTypeMeta[rec.artType] || artTypeMeta.painting;
    const dateStr = new Date(rec.createdAt).toLocaleDateString('zh-CN');
    return {
      id: `wk-${rec.id}`,
      category: 'work' as const,
      title: `${meta.label}作品 · ${rec.overallScore == null ? '待评分' : `${rec.overallScore}分`}`,
      desc: dateStr,
      icon: meta.icon,
      iconClass: 'bg-gold/10 text-gold-dark',
      action: () => { navigate('/history'); setCmdOpen(false); },
      keywords: `${meta.label} 作品 ${rec.overallScore == null ? '待评分' : `${rec.overallScore} 分`} zp`,
    };
  }), [historyWorks, navigate]);

  const actionItems = useMemo<CommandItem[]>(() => [
    {
      id: 'ac-clear',
      category: 'action',
      title: '清除缓存',
      desc: '清除本地历史记录',
      icon: Trash2,
      iconClass: 'bg-cinnabar/10 text-cinnabar',
      action: () => {
        /* 异步清空历史：通过 data-service 清空本地缓存(API 模式下也清本地兜底) */
        (async () => {
          try {
            await clearAnalysisHistory();
            setHistoryWorks([]);
            toast.success('缓存已清除', '历史记录已清空');
          } catch {
            toast.error('清除失败', '请稍后重试');
          }
          setCmdOpen(false);
        })();
      },
    },
    {
      id: 'ac-local',
      category: 'action',
      title: '切换到本地模式',
      desc: '离线运行，数据不上传',
      icon: CloudOff,
      iconClass: 'bg-rice-200 text-ink-500',
      action: () => {
        localStorage.setItem('danqing-ai-use-api', JSON.stringify(false));
        toast.success('已切换到本地模式');
        setCmdOpen(false);
      },
    },
    {
      id: 'ac-cloud',
      category: 'action',
      title: '切换到云端模式',
      desc: '连接云端，全功能可用',
      icon: Cloud,
      iconClass: 'bg-jade/10 text-jade',
      action: () => {
        localStorage.setItem('danqing-ai-use-api', JSON.stringify(true));
        toast.success('已切换到云端模式');
        setCmdOpen(false);
      },
    },
    {
      id: 'ac-settings',
      category: 'action',
      title: '跳转到设置',
      desc: '系统偏好与配置',
      icon: Settings,
      iconClass: 'bg-rice-200 text-ink-500',
      action: () => { navigate('/settings'); setCmdOpen(false); },
    },
    /* 新增：导出分析结果（dispatch 'export-analysis' 事件，由分析页等监听） */
    {
      id: 'ac-export',
      category: 'action',
      title: '导出分析结果',
      desc: '导出当前分析报告',
      icon: Download,
      iconClass: 'bg-jade/10 text-jade',
      action: () => {
        window.dispatchEvent(new CustomEvent('export-analysis'));
        toast.info('正在准备导出分析结果...');
        setCmdOpen(false);
      },
      keywords: '导出 分析 结果 报告 export dc fx jg bg',
    },
    /* 新增：查看分析历史（导航到 /history） */
    {
      id: 'ac-history',
      category: 'action',
      title: '查看分析历史',
      desc: '前往历史记录页面',
      icon: History,
      iconClass: 'bg-rice-200 text-ink-500',
      action: () => { navigate('/history'); setCmdOpen(false); },
      keywords: '查看 分析 历史 记录 ck ls jl',
    },
  ], [navigate, toast]);

  /* 按分类与关键词过滤，构建分段结果（每类最多 3 条）— useMemo 避免每次渲染重新过滤 */
  const q = query.trim().toLowerCase();
  const flatItems = useMemo(() => {
    const allSections: { category: CommandCategory; items: CommandItem[] }[] = [
      { category: 'function', items: functionItems },
      { category: 'recent', items: recentItems },
      { category: 'work', items: workItems },
      { category: 'action', items: actionItems },
    ];
    const filtered = allSections
      .filter((sec) => activeCategory === 'all' || sec.category === activeCategory)
      .map((sec) => ({
        category: sec.category,
        items: sec.items
          .filter((it) => !q
            || it.title.toLowerCase().includes(q)
            || it.desc.toLowerCase().includes(q)
            || (it.keywords || '').toLowerCase().includes(q))
          .slice(0, 3),
      }))
      .filter((sec) => sec.items.length > 0);
    return filtered.flatMap((sec) => sec.items);
  }, [functionItems, recentItems, workItems, actionItems, activeCategory, q]);

  const handleCmdKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, Math.max(flatItems.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && flatItems[selectedIndex]) {
      flatItems[selectedIndex].action();
    }
  };

  /* 切换下拉面板：同时只允许一个打开 */
  const toggleNotif = () => {
    setNotifOpen((o) => !o);
    setUserOpen(false);
    setModeOpen(false);
  };
  const toggleUser = () => {
    setUserOpen((o) => !o);
    setNotifOpen(false);
    setModeOpen(false);
  };
  const toggleMode = () => {
    setModeOpen((o) => !o);
    setNotifOpen(false);
    setUserOpen(false);
  };

  /* 任务包 B:标记全部已读(已登录走真实 API,未登录本地置零)
   * - 调用 POST /notifications/read-all,后端返回本次标记条数
   * - 成功后本地同步:apiNotifications 全部置已读 + unreadCount 归零
   * - 失败时 Toast 提示(silent 模式下 401 不弹,仅网络错误弹)
   */
  const markAllRead = async () => {
    if (!isAuthenticated) {
      setUnreadCount(0);
      return;
    }
    try {
      const res = await markAllNotificationsRead();
      setApiNotifications((prev) =>
        prev.map((n) => (n.readAt === null ? { ...n, readAt: new Date().toISOString() } : n)),
      );
      setUnreadCount(0);
      if (res.count > 0) {
        toast.success(`已标记 ${res.count} 条通知为已读`);
      }
    } catch {
      toast.error('操作失败', '请稍后重试');
    }
  };

  /* 任务包 B:单条通知标记已读 + 跳转(若有 linkUrl)
   * - 仅未读通知调用 API(已读的不再重复请求,减少无效调用)
   * - 成功后本地同步该条 readAt + unreadCount 递减
   * - 若通知含 linkUrl,标记成功后导航到目标路径
   */
  const handleNotificationClick = async (n: ApiNotification) => {
    // 有 linkUrl 的优先跳转(分析完成 → /history 等)
    const shouldNavigate = typeof n.linkUrl === 'string' && n.linkUrl.length > 0;

    if (n.readAt === null && isAuthenticated) {
      try {
        await markNotificationRead(n.id);
        // 本地同步:标记该条已读 + 未读数 -1
        setApiNotifications((prev) =>
          prev.map((item) => (item.id === n.id ? { ...item, readAt: new Date().toISOString() } : item)),
        );
        setUnreadCount((c) => Math.max(0, c - 1));
      } catch {
        // 标记失败不阻塞跳转(silent 模式下不弹 Toast)
      }
    }

    setNotifOpen(false);
    if (shouldNavigate && n.linkUrl) {
      navigate(n.linkUrl);
    }
  };

  /* 任务包 B:计算面板展示列表
   * - 已登录:用真实 API 数据映射为展示项(含 apiId/read/level)
   * - 未登录:回退到 mockNotifications(仅基础字段,保持未登录态视觉完整性)
   * 统一为 DisplayNotification[]:扩展字段可选,渲染时按 isAuthenticated 分支取用
   */
  const displayNotifications: DisplayNotification[] =
    isAuthenticated && apiNotifications.length > 0
      ? apiNotifications.map(mapApiNotificationToDisplay)
      : isAuthenticated && apiNotifications.length === 0 && !notifLoading
        ? [] // 已登录但无通知:显示空态
        : isAuthenticated
          ? [] // 已登录加载中:暂显示空(避免闪烁)
          : mockNotifications; // 未登录:回退 mock

  /* 选择运行模式(需求5:写入 localStorage + 派发事件,供 SettingsPage 同步 cloudSync) */
  const selectMode = (m: OnlineMode) => {
    setOnlineMode(m);
    setModeOpen(false);
    try { localStorage.setItem(LS_KEYS.onlineMode, m); } catch { /* ignore */ }
    window.dispatchEvent(new CustomEvent('online-mode-changed', { detail: m }));
  };

  /* 需求1:切换帮助面板 */
  const toggleHelp = () => {
    setHelpOpen((o) => !o);
    setNotifOpen(false);
    setUserOpen(false);
    setModeOpen(false);
  };

  /* 需求4:快设面板的局部 setter
   * - theme/density:写 settings(走 saveSettings)+ 独立 LS 键(供 useTheme 立即响应)
   * - notifications:写 settings
   * - onlineMode:复用 selectMode */
  const quickSetTheme = (t: UserSettings['theme']) => {
    setQuickSettings((prev) => prev ? { ...prev, theme: t } : prev);
    void saveSettings({ theme: t });
    try { localStorage.setItem(LS_KEYS.theme, t); } catch { /* ignore */ }
    toast.success(t === 'rice' ? '已切换米白主题' : t === 'ink' ? '已切换墨黑主题' : '已跟随系统主题');
  };
  const quickSetDensity = (d: UserSettings['density']) => {
    setQuickSettings((prev) => prev ? { ...prev, density: d } : prev);
    void saveSettings({ density: d });
    try { localStorage.setItem(LS_KEYS.density, d); } catch { /* ignore */ }
    toast.success(d === 'compact' ? '已切换紧凑密度' : d === 'comfortable' ? '已切换舒适密度' : '已切换宽松密度');
  };
  const quickSetNotifications = (key: keyof UserSettings['notifications'], value: boolean) => {
    setQuickSettings((prev) => prev
      ? { ...prev, notifications: { ...prev.notifications, [key]: value } }
      : prev);
    if (quickSettings) {
      void saveSettings({ notifications: { ...quickSettings.notifications, [key]: value } });
    }
  };

  /* 需求4:hover 触发快设面板(200ms 延迟关闭避免抖动) */
  const openSettingsPanel = () => {
    if (settingsHoverTimer.current !== null) {
      window.clearTimeout(settingsHoverTimer.current);
      settingsHoverTimer.current = null;
    }
    setSettingsOpen(true);
  };
  const closeSettingsPanelWithDelay = () => {
    if (settingsHoverTimer.current !== null) {
      window.clearTimeout(settingsHoverTimer.current);
    }
    settingsHoverTimer.current = window.setTimeout(() => {
      setSettingsOpen(false);
      settingsHoverTimer.current = null;
    }, 200);
  };
  useEffect(() => {
    return () => {
      if (settingsHoverTimer.current !== null) {
        window.clearTimeout(settingsHoverTimer.current);
      }
    };
  }, []);

  /* 触发器显示：根据当前模式 + 网络状态推导 */
  const modeDisplay =
    onlineMode === 'auto'
      ? online
        ? { icon: Cloud, label: '自动·云', color: 'text-jade' }
        : { icon: CloudOff, label: '自动·本地', color: 'text-cinnabar' }
      : onlineMode === 'cloud'
      ? { icon: Cloud, label: '云端', color: 'text-jade' }
      : { icon: CloudOff, label: '本地', color: 'text-cinnabar' };
  const ModeIcon = modeDisplay.icon;

  /* 退出登录:调用后端登出 + 清状态 + 跳登录页(useAuth.logout 已处理 Toast 与导航) */
  const handleLogout = async () => {
    setUserOpen(false);
    await logout();
  };

  return (
    <>
      <header className="h-14 flex-shrink-0 bg-rice-50/95 backdrop-blur-md border-b border-ink-900/8 flex items-center px-4 gap-4 z-40">
        {/* 左：Logo + 面包屑 */}
        <div className="flex items-center gap-3 min-w-0">
          <Link to="/" className="flex-shrink-0">
            <LogoMark />
          </Link>

          {/* 面包屑（增强：可点击 + hover 反馈） */}
          <nav className="hidden md:flex items-center gap-0.5 text-xs text-ink-400 ml-2 pl-3 border-l border-ink-900/10">
            <Link
              to="/"
              title="返回工作台"
              className="flex items-center gap-1 px-1.5 py-1 rounded-md text-ink-500 hover:text-cinnabar hover:bg-cinnabar/5 transition-colors"
            >
              <Home className="w-3.5 h-3.5" />
            </Link>
            <ChevronRight className="w-3 h-3 text-ink-300 mx-0.5" />
            <Link
              to={categoryRoute[meta.category] || '/'}
              title={`返回${meta.category}`}
              className="px-1.5 py-1 rounded-md text-ink-500 hover:text-cinnabar hover:bg-cinnabar/5 transition-colors"
            >
              {meta.category}
            </Link>
            <ChevronRight className="w-3 h-3 text-ink-300 mx-0.5" />
            <span className="px-1.5 py-1 text-ink-800 font-medium">{meta.title}</span>
          </nav>
        </div>

        {/* 中：全局搜索框（点击展开命令面板，hover 边框朱砂色） */}
        <button
          onClick={() => setCmdOpen(true)}
          aria-label="打开搜索命令面板"
          className="flex-1 max-w-md mx-auto flex items-center gap-2 h-9 px-3 bg-rice-200 hover:bg-rice-300 border border-ink-900/8 hover:border-cinnabar/40 rounded-md text-sm text-ink-400 transition-colors group"
        >
          <Search className="w-4 h-4 group-hover:text-cinnabar transition-colors" />
          <span className="flex-1 text-left">搜索功能、作品、风格…</span>
          <kbd className="hidden md:flex items-center gap-0.5 px-1.5 py-0.5 bg-rice-50 border border-ink-900/10 rounded text-2xs font-mono text-ink-500">
            <Command className="w-2.5 h-2.5" />K
          </kbd>
        </button>

        {/* 右：工具栏 */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {/* 在线状态下拉（增强：可切换模式） */}
          <div ref={modeRef} className="relative hidden sm:block">
            <button
              onClick={toggleMode}
              className="flex items-center gap-1.5 px-2 h-8 rounded-md text-2xs hover:bg-ink-900/5 transition-colors"
              title="切换运行模式"
              aria-label="切换运行模式"
              aria-expanded={modeOpen}
            >
              <ModeIcon className={`w-3.5 h-3.5 ${modeDisplay.color}`} />
              <span className={modeDisplay.color}>{modeDisplay.label}</span>
              <ChevronDown
                className={`w-3 h-3 text-ink-400 transition-transform ${modeOpen ? 'rotate-180' : ''}`}
              />
            </button>

            {modeOpen && (
              <div className="absolute top-full right-0 mt-1 w-60 bg-rice-50 rounded-md shadow-overlay border border-ink-900/8 z-50 animate-slide-down overflow-hidden">
                <p className="px-3 pt-2.5 pb-1 text-2xs font-semibold text-ink-400 uppercase tracking-wider">
                  运行模式
                </p>
                <div className="p-1">
                  {onlineModes.map((m) => {
                    const Icon = m.icon;
                    const active = onlineMode === m.id;
                    return (
                      <button
                        key={m.id}
                        onClick={() => selectMode(m.id)}
                        aria-label={m.label}
                        className={`w-full flex items-center gap-2.5 h-10 px-2 rounded-md text-left transition-colors ${
                          active ? 'bg-cinnabar/5' : 'hover:bg-ink-900/5'
                        }`}
                      >
                        <div
                          className={`w-7 h-7 flex items-center justify-center rounded-md flex-shrink-0 ${
                            active ? 'bg-cinnabar/10 text-cinnabar' : 'bg-rice-200 text-ink-500'
                          }`}
                        >
                          <Icon className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-medium ${active ? 'text-cinnabar' : 'text-ink-800'}`}>
                            {m.label}
                          </p>
                          <p className="text-2xs text-ink-400 truncate">{m.desc}</p>
                        </div>
                        {active && <Check className="w-4 h-4 text-cinnabar flex-shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="w-px h-5 bg-ink-900/10 mx-1 hidden sm:block" />

          {/* 通知（增强：可展开通知面板） */}
          <div ref={notifRef} className="relative">
            <button
              onClick={toggleNotif}
              className={`relative w-8 h-8 flex items-center justify-center rounded-md transition-colors ${
                notifOpen ? 'bg-ink-900/5 text-ink-900' : 'text-ink-500 hover:text-ink-900 hover:bg-ink-900/5'
              }`}
              title="通知"
              aria-label={notifOpen ? '关闭通知面板' : '打开通知面板'}
              aria-expanded={notifOpen}
            >
              <Bell className="w-4 h-4" />
              {unreadCount > 0 && (
                <span className="absolute top-0.5 right-0.5 min-w-[16px] h-4 px-1 flex items-center justify-center bg-cinnabar text-white text-2xs font-bold rounded-full ring-2 ring-rice-50">
                  {unreadCount}
                </span>
              )}
            </button>

            {notifOpen && (
              <div className="absolute top-full right-0 mt-1 w-80 bg-rice-50 rounded-md shadow-overlay border border-ink-900/8 z-50 animate-slide-down overflow-hidden">
                {/* 面板头部 */}
                <div className="flex items-center justify-between px-3 h-10 border-b border-ink-900/8">
                  <p className="text-sm font-medium text-ink-900">
                    通知
                    <span className="ml-1 text-2xs text-ink-400 font-normal">
                      ({isAuthenticated ? apiNotifications.length : mockNotifications.length})
                    </span>
                  </p>
                  <button
                    onClick={() => void markAllRead()}
                    className="text-2xs text-ink-400 hover:text-cinnabar transition-colors"
                  >
                    全部已读
                  </button>
                </div>

                {/* 通知列表 */}
                <div className="max-h-80 overflow-y-auto scrollbar-thin">
                  {/* 加载态(已登录拉取中)*/}
                  {isAuthenticated && notifLoading && (
                    <div className="px-3 py-8 text-center text-sm text-ink-400">
                      加载中…
                    </div>
                  )}
                  {/* 空态(已登录且无通知)*/}
                  {isAuthenticated && !notifLoading && displayNotifications.length === 0 && (
                    <div className="px-3 py-8 text-center text-sm text-ink-400">
                      暂无通知
                    </div>
                  )}
                  {/* 通知项列表(真实 API 数据或未登录 mock)*/}
                  {displayNotifications.map((n) => {
                    const Icon = n.icon;
                    // 已登录:点击触发标记已读 + 跳转;未登录(mock):仅关闭面板
                    const handleClick = isAuthenticated
                      ? () => {
                          // 通过 apiId 反查原始 ApiNotification 以传给 handleNotificationClick
                          const original = apiNotifications.find((a) => a.id === n.apiId);
                          if (original) void handleNotificationClick(original);
                        }
                      : () => setNotifOpen(false);
                    return (
                      <button
                        key={n.apiId ?? n.id}
                        onClick={handleClick}
                        aria-label={n.title}
                        className={`w-full flex items-start gap-2.5 px-3 py-2.5 text-left hover:bg-ink-900/3 transition-colors border-b border-ink-900/4 last:border-b-0 ${n.level ? notificationLevelAccent[n.level] : ''} ${isAuthenticated && !n.read ? 'bg-cinnabar/3' : ''}`}
                      >
                        <div className={`w-8 h-8 flex items-center justify-center rounded-md flex-shrink-0 ${n.iconClass}`}>
                          <Icon className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <p className={`text-sm font-medium truncate ${isAuthenticated && !n.read ? 'text-ink-900' : 'text-ink-700'}`}>
                              {n.title}
                            </p>
                            <span className="text-2xs text-ink-400 flex-shrink-0">{n.time}</span>
                          </div>
                          <p className="text-xs text-ink-500 mt-0.5 line-clamp-2">{n.desc}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* 面板底部：查看全部 */}
                <Link
                  to="/history"
                  onClick={() => setNotifOpen(false)}
                  className="flex items-center justify-center gap-1 h-10 border-t border-ink-900/8 text-xs font-medium text-ink-600 hover:text-cinnabar hover:bg-cinnabar/5 transition-colors"
                >
                  查看全部
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            )}
          </div>

          {/* 帮助(需求1:点击展开 Popover,显示快捷键 + 文档链接 + 反馈入口) */}
          <div ref={helpRef} className="relative">
            <button
              onClick={toggleHelp}
              className={`w-8 h-8 flex items-center justify-center rounded-md transition-colors ${
                helpOpen ? 'bg-ink-900/5 text-ink-900' : 'text-ink-500 hover:text-ink-900 hover:bg-ink-900/5'
              }`}
              title="帮助"
              aria-label="帮助"
              aria-expanded={helpOpen}
            >
              <HelpCircle className="w-4 h-4" />
            </button>

            {helpOpen && (
              <div className="absolute top-full right-0 mt-1 w-72 bg-rice-50 rounded-md shadow-overlay border border-ink-900/8 z-50 animate-slide-down overflow-hidden">
                {/* 头部 */}
                <div className="px-3 h-10 border-b border-ink-900/8 flex items-center">
                  <p className="text-sm font-medium text-ink-900 flex items-center gap-1.5">
                    <HelpCircle className="w-3.5 h-3.5 text-cinnabar" />
                    帮助
                  </p>
                </div>

                {/* 快捷键提示 */}
                <div className="p-3 space-y-2">
                  <p className="text-2xs font-semibold text-ink-400 uppercase tracking-wider">快捷键</p>
                  <div className="space-y-1.5">
                    {[
                      { desc: '命令面板', keys: '⌘K / Ctrl+K' },
                      { desc: '工作台', keys: 'H' },
                      { desc: '跳转模块', keys: '1-7' },
                      { desc: '跳转设置', keys: '0' },
                      { desc: '新建诊断', keys: 'N' },
                      { desc: '关闭弹层', keys: 'Esc' },
                    ].map((item) => (
                      <div key={item.desc} className="flex justify-between items-center text-xs">
                        <span className="text-ink-600">{item.desc}</span>
                        <kbd className="px-1.5 py-0.5 bg-rice-200 border border-ink-900/10 rounded text-2xs font-mono text-ink-700">
                          {item.keys}
                        </kbd>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 文档与反馈入口(inline 提示,无实际跳转) */}
                <div className="border-t border-ink-900/8 p-3 space-y-1.5">
                  <a
                    href="https://danqing.site/docs"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between px-2 h-8 rounded-md text-xs text-ink-700 hover:bg-ink-900/5 transition-colors"
                  >
                    <span className="flex items-center gap-1.5">
                      <ExternalLink className="w-3.5 h-3.5 text-ink-500" />
                      使用文档
                    </span>
                    <ArrowRight className="w-3 h-3 text-ink-400" />
                  </a>
                  <a
                    href="mailto:feedback@danqing.site"
                    className="flex items-center justify-between px-2 h-8 rounded-md text-xs text-ink-700 hover:bg-ink-900/5 transition-colors"
                  >
                    <span className="flex items-center gap-1.5">
                      <RefreshCw className="w-3.5 h-3.5 text-ink-500" />
                      反馈与建议
                    </span>
                    <ArrowRight className="w-3 h-3 text-ink-400" />
                  </a>
                </div>
              </div>
            )}
          </div>

          {/* 设置(需求4:hover 弹出快设面板,点击仍可跳转 /settings) */}
          <div
            ref={settingsRef}
            className="relative"
            onMouseEnter={openSettingsPanel}
            onMouseLeave={closeSettingsPanelWithDelay}
          >
            <Link
              to="/settings"
              onClick={() => setSettingsOpen(false)}
              className="w-8 h-8 flex items-center justify-center text-ink-500 hover:text-ink-900 hover:bg-ink-900/5 rounded-md transition-colors"
              title="设置"
              aria-label="设置"
            >
              <Settings className="w-4 h-4" />
            </Link>

            {settingsOpen && (
              <div
                className="absolute bottom-full mb-1 right-0 w-72 bg-rice-50 rounded-md shadow-overlay border border-ink-900/8 z-50 animate-slide-up overflow-hidden"
                onMouseEnter={openSettingsPanel}
                onMouseLeave={closeSettingsPanelWithDelay}
              >
                {/* 头部 */}
                <div className="px-3 h-10 border-b border-ink-900/8 flex items-center justify-between">
                  <p className="text-sm font-medium text-ink-900 flex items-center gap-1.5">
                    <Settings className="w-3.5 h-3.5 text-cinnabar" />
                    快速设置
                  </p>
                  <Link
                    to="/settings"
                    onClick={() => setSettingsOpen(false)}
                    className="text-2xs text-ink-400 hover:text-cinnabar transition-colors flex items-center gap-0.5"
                  >
                    全部设置
                    <ArrowRight className="w-3 h-3" />
                  </Link>
                </div>

                {/* 主题切换 */}
                <div className="p-3 space-y-2 border-b border-ink-900/8">
                  <p className="text-2xs font-semibold text-ink-400 uppercase tracking-wider">主题</p>
                  <div className="grid grid-cols-3 gap-1.5">
                    {([
                      { id: 'rice', label: '米白' },
                      { id: 'ink', label: '墨黑' },
                      { id: 'auto', label: '跟随' },
                    ] as const).map((t) => (
                      <button
                        key={t.id}
                        onClick={() => quickSetTheme(t.id)}
                        className={`h-8 text-xs rounded-md border transition-all ${
                          quickSettings?.theme === t.id
                            ? 'border-cinnabar bg-cinnabar/5 text-cinnabar'
                            : 'border-ink-900/10 text-ink-600 hover:bg-ink-900/5'
                        }`}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 界面密度 */}
                <div className="p-3 space-y-2 border-b border-ink-900/8">
                  <p className="text-2xs font-semibold text-ink-400 uppercase tracking-wider">密度</p>
                  <div className="grid grid-cols-3 gap-1.5">
                    {([
                      { id: 'compact', label: '紧凑' },
                      { id: 'comfortable', label: '舒适' },
                      { id: 'spacious', label: '宽松' },
                    ] as const).map((d) => (
                      <button
                        key={d.id}
                        onClick={() => quickSetDensity(d.id)}
                        className={`h-8 text-xs rounded-md border transition-all ${
                          quickSettings?.density === d.id
                            ? 'border-cinnabar bg-cinnabar/5 text-cinnabar'
                            : 'border-ink-900/10 text-ink-600 hover:bg-ink-900/5'
                        }`}
                      >
                        {d.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 通知开关 */}
                <div className="p-3 space-y-2 border-b border-ink-900/8">
                  <p className="text-2xs font-semibold text-ink-400 uppercase tracking-wider">通知</p>
                  <div className="space-y-1.5">
                    {[
                      { key: 'analysis' as const, label: '诊断完成' },
                      { key: 'growth' as const, label: '成长周报' },
                      { key: 'system' as const, label: '系统更新' },
                    ].map((item) => (
                      <button
                        key={item.key}
                        onClick={() => quickSetNotifications(item.key, !quickSettings?.notifications[item.key])}
                        className="w-full flex items-center justify-between h-7 px-2 rounded-md text-xs text-ink-700 hover:bg-ink-900/5 transition-colors"
                      >
                        <span>{item.label}</span>
                        <span className={`relative w-8 h-4 rounded-full transition-colors ${
                          quickSettings?.notifications[item.key] ? 'bg-cinnabar' : 'bg-ink-900/15'
                        }`}>
                          <span className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow-subtle transition-all ${
                            quickSettings?.notifications[item.key] ? 'left-[14px]' : 'left-0.5'
                          }`} />
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* 运行模式 */}
                <div className="p-3 space-y-2">
                  <p className="text-2xs font-semibold text-ink-400 uppercase tracking-wider">运行模式</p>
                  <div className="grid grid-cols-3 gap-1.5">
                    {onlineModes.map((m) => {
                      const Icon = m.icon;
                      const active = onlineMode === m.id;
                      return (
                        <button
                          key={m.id}
                          onClick={() => selectMode(m.id)}
                          className={`h-8 text-2xs rounded-md border transition-all flex items-center justify-center gap-1 ${
                            active
                              ? 'border-cinnabar bg-cinnabar/5 text-cinnabar'
                              : 'border-ink-900/10 text-ink-600 hover:bg-ink-900/5'
                          }`}
                        >
                          <Icon className="w-3 h-3" />
                          {m.label.replace('模式', '')}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 租户切换(已登录 + 多租户时显示;单租户时组件内部返回 null) */}
          {isAuthenticated && <TenantSwitcher />}

          <div className="w-px h-5 bg-ink-900/10 mx-1" />

          {/* 用户区域:未登录显示登录按钮,已登录显示头像+下拉菜单(含角色 badge/登出) */}
          {!isAuthenticated ? (
            <Link
              to="/login"
              className="h-8 px-3 flex items-center gap-1.5 rounded-md text-xs font-medium text-rice-50 bg-cinnabar hover:bg-cinnabar-dark transition-colors"
              title="登录丹青有AI"
            >
              <User className="w-3.5 h-3.5" />
              <span>登录</span>
            </Link>
          ) : (
            <div ref={userRef} className="relative">
              <button
                onClick={toggleUser}
                className={`flex items-center gap-2 h-8 pl-1 pr-2 rounded-md transition-colors ${
                  userOpen ? 'bg-ink-900/5' : 'hover:bg-ink-900/5'
                }`}
                title="用户中心"
                aria-label="用户中心"
                aria-expanded={userOpen}
              >
                {user?.avatar ? (
                  <img
                    src={user.avatar}
                    alt={user.name}
                    loading="lazy"
                    className="w-6 h-6 rounded-full object-cover border border-ink-900/10"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="w-6 h-6 rounded-full bg-gradient-to-br from-stone to-stone-dark flex items-center justify-center text-2xs font-bold text-white">
                    {user?.name?.charAt(0) ?? 'U'}
                  </div>
                )}
                <span className="hidden md:block text-xs font-medium text-ink-700">
                  {user?.name ?? '用户'}
                </span>
                <ChevronDown
                  className={`hidden md:block w-3 h-3 text-ink-400 transition-transform ${userOpen ? 'rotate-180' : ''}`}
                />
              </button>

              {userOpen && (
                <div className="absolute top-full right-0 mt-1 w-64 bg-rice-50 rounded-md shadow-overlay border border-ink-900/8 z-50 animate-slide-down overflow-hidden">
                  {/* 用户信息头部 */}
                  <div className="px-3 py-2.5 border-b border-ink-900/8 bg-rice-100">
                    <div className="flex items-center gap-2.5">
                      {user?.avatar ? (
                        <img
                          src={user.avatar}
                          alt={user.name}
                          loading="lazy"
                          className="w-9 h-9 rounded-full object-cover border border-ink-900/10"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-stone to-stone-dark flex items-center justify-center text-xs font-bold text-white">
                          {user?.name?.charAt(0) ?? 'U'}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <p className="text-sm font-medium text-ink-900 truncate">
                            {user?.name ?? '用户'}
                          </p>
                          {/* 角色 badge:管理员/教师/学生 */}
                          {user?.role && <RoleBadge role={user.role} size="xs" />}
                        </div>
                        <p className="text-2xs text-ink-400 truncate">
                          {user?.email ?? user?.phone ?? '—'}
                        </p>
                        {tenant && (
                          <p className="text-2xs text-cinnabar truncate mt-0.5">
                            {tenant.name}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* 菜单项(管理后台[admin/owner] / 加入班级[student] / 个人中心 / 我的作品 / 设置) */}
                  <div className="p-1">
                    {isAdminRole(user?.role) && (
                      <Link
                        to="/admin"
                        onClick={() => setUserOpen(false)}
                        className="w-full flex items-center gap-2.5 h-10 px-2 rounded-md text-sm text-cinnabar hover:bg-cinnabar/5 transition-colors"
                      >
                        <Gauge className="w-4 h-4" />
                        <span className="font-medium">管理后台</span>
                      </Link>
                    )}
                    {user?.role === 'student' && (
                      <Link
                        to="/join-class"
                        onClick={() => setUserOpen(false)}
                        className="w-full flex items-center gap-2.5 h-10 px-2 rounded-md text-sm text-stone hover:bg-stone/5 transition-colors"
                      >
                        <School className="w-4 h-4" />
                        <span className="font-medium">加入班级</span>
                      </Link>
                    )}
                    {userMenuItems.map((item) => {
                      const Icon = item.icon;
                      return (
                        <Link
                          key={item.id}
                          to={item.path}
                          onClick={() => setUserOpen(false)}
                          className="w-full flex items-center gap-2.5 h-10 px-2 rounded-md text-sm text-ink-700 hover:bg-ink-900/5 hover:text-ink-900 transition-colors"
                        >
                          <Icon className="w-4 h-4 text-ink-500" />
                          <span className="font-medium">{item.label}</span>
                        </Link>
                      );
                    })}
                  </div>

                  {/* 分隔线(切换租户已移至顶部 TenantSwitcher 组件) */}
                  <div className="border-t border-ink-900/8" />

                  {/* 退出登录 */}
                  <div className="p-1">
                    <button
                      onClick={() => void handleLogout()}
                      aria-label="退出登录"
                      className="w-full flex items-center gap-2.5 h-10 px-2 rounded-md text-sm text-cinnabar hover:bg-cinnabar/5 transition-colors"
                    >
                      <LogOut className="w-4 h-4" />
                      <span className="font-medium">退出登录</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </header>

      {/* 命令面板 */}
      {cmdOpen && (
        <div
          className="fixed inset-0 z-50 cmd-overlay flex items-start justify-center pt-[12vh] px-4 animate-fade-in"
          onClick={() => setCmdOpen(false)}
        >
          <div
            className="w-full max-w-xl bg-rice-50 rounded-xl shadow-modal overflow-hidden animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 搜索框（focus 时显示提示文字） */}
            <div className="flex items-center gap-3 px-4 h-14 border-b border-ink-900/8">
              <Search className="w-4 h-4 text-ink-400 flex-shrink-0" />
              <input
                ref={cmdInputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSelectedIndex(0);
                }}
                onKeyDown={handleCmdKey}
                placeholder="输入关键词搜索功能..."
                className="flex-1 bg-transparent outline-none text-sm text-ink-900 placeholder:text-ink-300"
              />
              <kbd className="px-1.5 py-0.5 bg-rice-200 border border-ink-900/10 rounded text-2xs font-mono text-ink-400">
                ESC
              </kbd>
              <button
                onClick={() => setCmdOpen(false)}
                aria-label="关闭"
                className="w-6 h-6 flex items-center justify-center text-ink-400 hover:text-ink-700 hover:bg-ink-900/5 rounded transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* 分类标签栏 */}
            <div className="flex items-center gap-1.5 px-4 py-2 border-b border-ink-900/8 overflow-x-auto scrollbar-thin">
              {commandCategories.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setActiveCategory(cat.id)}
                  className={`h-7 px-2.5 text-xs rounded-md whitespace-nowrap transition-colors ${
                    activeCategory === cat.id
                      ? 'bg-cinnabar text-white'
                      : 'bg-rice-200 text-ink-600 hover:bg-rice-300'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>

            {/* 搜索结果（按分类分段） */}
            <div className="max-h-80 overflow-y-auto py-2 scrollbar-thin">
              {flatItems.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-ink-400">
                  没有找到匹配的结果
                </div>
              ) : (
                flatItems.map((item, i) => {
                  const Icon = item.icon;
                  const selected = i === selectedIndex;
                  const showHeader = i === 0 || flatItems[i - 1].category !== item.category;
                  return (
                    <div key={item.id}>
                      {showHeader && (
                        <p className="text-2xs font-semibold text-ink-400 uppercase tracking-wider px-4 py-2">
                          {categorySectionTitles[item.category]}
                        </p>
                      )}
                      <button
                        onClick={() => item.action()}
                        onMouseEnter={() => setSelectedIndex(i)}
                        aria-label={item.title}
                        className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                          selected ? 'bg-cinnabar/5' : 'hover:bg-ink-900/3'
                        }`}
                      >
                        <div
                          className={`w-8 h-8 flex items-center justify-center rounded-md ${
                            selected ? 'bg-cinnabar/10 text-cinnabar' : item.iconClass
                          }`}
                        >
                          <Icon className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-ink-900">{item.title}</p>
                          <p className="text-xs text-ink-400 truncate">{item.desc}</p>
                        </div>
                        {item.shortcut && (
                          <kbd className="px-1.5 py-0.5 bg-rice-200 rounded text-2xs font-mono text-ink-400 flex-shrink-0">
                            {item.shortcut}
                          </kbd>
                        )}
                        {selected && (
                          <ArrowRight className="w-4 h-4 text-cinnabar flex-shrink-0" />
                        )}
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            {/* 底部提示 */}
            <div className="px-4 py-2 border-t border-ink-900/8 bg-rice-100 flex items-center justify-between text-2xs text-ink-400">
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1">
                  <kbd className="px-1 py-0.5 bg-rice-200 rounded font-mono">↑↓</kbd>
                  选择
                </span>
                <span className="flex items-center gap-1">
                  <kbd className="px-1 py-0.5 bg-rice-200 rounded font-mono">↵</kbd>
                  确认
                </span>
              </div>
              <span className="font-mono">DQ AI · 命令面板</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
