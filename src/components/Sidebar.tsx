import { useState, useEffect, useRef, memo, useCallback } from 'react';
import {
  Eye, BookOpen, Wand2, ImagePlus, Heart, History, TrendingUp,
  Settings, ChevronLeft, ChevronRight, Sparkles, Plus,
  Brush, PenTool, Box, Layers, Clock, Search, Home as HomeIcon, type LucideIcon,
  Gauge, Users, Building2, GraduationCap, Scale, School, SlidersHorizontal, Recycle, UserRound,
} from 'lucide-react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { usePrefetch } from '../hooks/usePrefetch';
import { useAuth } from '../hooks/useAuth';
import { isAdminRole } from './auth/RequireAdminRole';
import { isTeacherRole } from './auth/RequireTeacherRole';

type NavItem = {
  path: string;
  label: string;
  icon: LucideIcon;
  badge?: string;
  shortcut?: string;
  highlight?: boolean;
};

type NavGroup = {
  id: string;
  title: string;
  items: NavItem[];
};

const navGroups: NavGroup[] = [
  {
    id: 'home',
    title: '工作台',
    items: [
      { path: '/', label: '工作台', icon: HomeIcon, shortcut: 'H' },
    ],
  },
  {
    id: 'creation',
    title: '创作工具',
    items: [
      { path: '/analyze', label: 'AI 诊断', icon: Eye, shortcut: '1', highlight: true },
      /* ImagePlus:偏差#2 修复,原 Wand2 与风格库重复 */
      { path: '/generation', label: 'AI 生成', icon: ImagePlus },
      { path: '/materials', label: '素材库', icon: BookOpen, shortcut: '2' },
      { path: '/styles', label: '风格库', icon: Wand2, shortcut: '3' },
      { path: '/fuse', label: '灵感嫁接', icon: Sparkles, shortcut: '4' },
      { path: '/emotion', label: '情绪画布', icon: Heart, shortcut: '5' },
    ],
  },
  {
    id: 'insights',
    title: '我的-数据洞察',
    items: [
      { path: '/history', label: '历史记录', icon: History, shortcut: '6' },
      { path: '/growth', label: '成长曲线', icon: TrendingUp, shortcut: '7' },
      { path: '/images', label: '图片搜索', icon: Search, shortcut: '8' },
    ],
  },
  {
    id: 'community',
    title: '社区',
    items: [
      { path: '/org/feed', label: '组织动态', icon: Users, shortcut: '9' },
      { path: '/classes', label: '我的班级', icon: GraduationCap },
    ],
  },
  {
    id: 'system',
    title: '系统',
    items: [
      { path: '/settings', label: '设置', icon: Settings, shortcut: '0' },
    ],
  },
];

/* 管理后台分组(仅 admin/owner 角色可见,在 Sidebar 组件内按角色注入) */
const adminNavGroup: NavGroup = {
  id: 'admin',
  title: '管理后台',
  items: [
    { path: '/admin', label: '监控大屏', icon: Gauge },
    { path: '/admin/users', label: '用户管理', icon: Users },
    { path: '/admin/tenants', label: '租户管理', icon: Building2 },
    { path: '/admin/feedback', label: '反馈看板', icon: Recycle },
  ],
};

/* 教师工作台分组(teacher/admin/owner 可见,在 Sidebar 组件内按角色注入) */
const teacherNavGroup: NavGroup = {
  id: 'teacher',
  title: '教师工作台',
  items: [
    { path: '/teacher', label: '班级学生', icon: GraduationCap },
    { path: '/teacher/classes', label: '班级管理', icon: School },
    { path: '/teacher/grading-profiles', label: '评分档案', icon: SlidersHorizontal },
    { path: '/teacher/insights', label: '教学画像', icon: UserRound },
    { path: '/teacher/disputes', label: '争议仲裁', icon: Scale },
  ],
};

const creationTypes = [
  { id: 'painting', label: '绘画', icon: Brush, color: 'text-cinnabar' },
  { id: 'design', label: '设计', icon: PenTool, color: 'text-stone' },
  { id: 'product', label: '产品', icon: Box, color: 'text-gold' },
  { id: 'sculpture', label: '雕塑', icon: Layers, color: 'text-purple-500' },
];

const allNavItems: NavItem[] = navGroups.flatMap((g) => g.items);

type RecentPage = {
  path: string;
  label: string;
  icon: LucideIcon;
};

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

/* ============================================================
 * SidebarNavItem — 单个导航项(memo + usePrefetch)
 *
 * 提取为独立组件以:
 *   1. 调用 usePrefetch hook(无法在 .map 循环内调用)
 *   2. 通过 React.memo 跳过未变化项的重渲染
 *   3. hover/focus/touchstart 时预加载对应路由 chunk
 * ============================================================ */

interface SidebarNavItemProps {
  item: NavItem;
  isActive: boolean;
  collapsed: boolean;
  isHovered: boolean;
  onHoverChange: (path: string | null) => void;
}

const SidebarNavItem = memo(function SidebarNavItem({
  item,
  isActive,
  collapsed,
  isHovered,
  onHoverChange,
}: SidebarNavItemProps) {
  const prefetch = usePrefetch(item.path);
  const Icon = item.icon;
  const isHighlighted = !!item.highlight;

  const handleMouseEnter = useCallback(() => {
    onHoverChange(item.path);
    prefetch.onMouseEnter();
  }, [onHoverChange, item.path, prefetch]);

  const handleMouseLeave = useCallback(() => {
    onHoverChange(null);
  }, [onHoverChange]);

  return (
    <Link
      to={item.path}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocus={prefetch.onFocus}
      onTouchStart={prefetch.onTouchStart}
      className={`group relative flex items-center px-2 h-9 rounded-md text-sm transition-all duration-200 ${
        isActive
          ? isHighlighted
            ? 'bg-cinnabar/10 text-ink-900 shadow-subtle'
            : 'bg-ink-900 text-rice-100 shadow-subtle'
          : isHighlighted
          ? 'text-ink-900 hover:bg-cinnabar/5'
          : 'text-ink-600 hover:bg-ink-900/5 hover:text-ink-900'
      } ${collapsed ? 'justify-center gap-0' : 'gap-3'}`}
      title={collapsed ? item.label : undefined}
    >
      {/* AI 诊断左侧朱砂色竖条指示 */}
      {isHighlighted && (
        <span
          className={`absolute left-0 top-0 bg-cinnabar ${
            collapsed ? 'w-0.5 h-full' : 'w-1 h-full rounded-l-md'
          }`}
        />
      )}
      <Icon
        className={`w-4 h-4 flex-shrink-0 ${
          isHighlighted ? 'text-cinnabar' : isActive ? 'text-cinnabar-light' : ''
        }`}
      />
      <div
        className={`flex items-center overflow-hidden transition-all duration-200 ${
          collapsed ? 'opacity-0 max-w-0' : 'opacity-100 flex-1 min-w-0'
        }`}
      >
        <span
          className={`whitespace-nowrap ${
            isHighlighted ? 'font-semibold' : 'font-medium'
          }`}
        >
          {item.label}
        </span>
        {item.shortcut && (
          <kbd
            className={`ml-auto px-1.5 py-0.5 rounded text-2xs font-mono ${
              isActive
                ? isHighlighted
                  ? 'bg-cinnabar/20 text-ink-700'
                  : 'bg-rice-100/10 text-rice-200'
                : isHovered
                ? 'bg-ink-900/10 text-ink-500'
                : 'text-ink-300'
            }`}
          >
            {item.shortcut}
          </kbd>
        )}
      </div>
      {collapsed && <Tooltip label={item.label} />}
    </Link>
  );
});

export default function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const currentType = searchParams.get('type');
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);
  const [recentPages, setRecentPages] = useState<RecentPage[]>([]);
  const isFirstRender = useRef(true);
  const { user } = useAuth();

  /* 按角色注入分组:教师组(teacher 及以上)、管理组(admin/owner);
     路由层另有 RequireTeacherRole / RequireAdminRole 兜底 */
  const visibleGroups = [
    ...navGroups,
    ...(isTeacherRole(user?.role) ? [teacherNavGroup] : []),
    ...(isAdminRole(user?.role) ? [adminNavGroup] : []),
  ];

  /* 路由变化时记录最近访问（首次进入不记录，避免初始页占据首项） */
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    const path = location.pathname;
    const item = allNavItems.find((it) => it.path === path);
    if (!item) return;
    setRecentPages((prev) => {
      const filtered = prev.filter((p) => p.path !== path);
      return [{ path: item.path, label: item.label, icon: item.icon }, ...filtered].slice(0, 3);
    });
  }, [location.pathname]);

  return (
    // h-full:约束 aside 高度为父容器高度,使下方 nav 的 flex-1 overflow-y-auto 生效;
    // 否则 aside 被内容撑高,超出部分被祖先 overflow-hidden 裁掉,菜单无法滚动
    <aside
      className={`${
        collapsed ? 'w-16' : 'w-60'
      } h-full flex-shrink-0 bg-rice-100 border-r border-ink-900/8 flex flex-col transition-all duration-200 ease-out relative`}
    >
      {/* 顶部：新建诊断快捷按钮 */}
      <div className={`p-3 border-b border-ink-900/8 ${collapsed ? 'px-2' : ''}`}>
        {collapsed ? (
          <Link
            to="/analyze"
            className="w-10 h-10 mx-auto flex items-center justify-center bg-cinnabar hover:bg-cinnabar-dark text-white rounded-lg transition-colors group relative"
            title="新建诊断"
          >
            <Plus className="w-5 h-5" />
            <Tooltip label="新建诊断" />
          </Link>
        ) : (
          <Link
            to="/analyze"
            className="flex items-center justify-center gap-2 w-full h-10 px-3 bg-cinnabar hover:bg-cinnabar-dark text-white rounded-lg transition-colors text-sm font-medium shadow-subtle"
          >
            <Plus className="w-4 h-4" />
            <span>新建诊断</span>
            <kbd className="ml-auto px-1.5 py-0.5 bg-cinnabar-dark/40 rounded text-2xs font-mono">N</kbd>
          </Link>
        )}
      </div>

      {/* 创作类型快速入口（折叠时不显示） */}
      {!collapsed && (
        <div className="px-3 py-3 border-b border-ink-900/8">
          <p className="text-2xs font-medium text-ink-400 uppercase tracking-wider mb-2 px-2">创作类型</p>
          <div className="grid grid-cols-4 gap-1">
            {creationTypes.map((type) => {
              const isSelected = location.pathname === '/analyze' && currentType === type.id;
              return (
                <Link
                  key={type.id}
                  to={`/analyze?type=${type.id}`}
                  className={`aspect-square flex flex-col items-center justify-center bg-rice-200 hover:bg-rice-300 rounded-md transition-all group relative ${
                    isSelected ? 'ring-2 ring-cinnabar/40 bg-cinnabar/5' : ''
                  }`}
                  title={type.label}
                >
                  <type.icon className={`w-4 h-4 ${type.color}`} />
                  <Tooltip label={type.label} />
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* 最近访问区域（折叠时不显示） */}
      {!collapsed && (
        <div className="px-3 py-2 border-b border-ink-900/8">
          <div className="flex items-center gap-1.5 mb-1.5 px-2">
            <Clock className="w-3 h-3 text-ink-400" />
            <p className="text-2xs font-semibold text-ink-400 uppercase tracking-wider">最近访问</p>
          </div>
          {recentPages.length === 0 ? (
            <p className="text-2xs text-ink-300 px-2 py-1.5 italic">暂无最近访问</p>
          ) : (
            <div className="space-y-0.5 px-1">
              {recentPages.map((page) => {
                const Icon = page.icon;
                const isActive = location.pathname === page.path;
                return (
                  <Link
                    key={page.path}
                    to={page.path}
                    className={`flex items-center gap-2 px-2 h-7 rounded text-xs transition-colors ${
                      isActive
                        ? 'bg-ink-900/5 text-ink-900'
                        : 'text-ink-500 hover:bg-ink-900/5 hover:text-ink-900'
                    }`}
                  >
                    <Icon className="w-3 h-3 flex-shrink-0" />
                    <span className="truncate">{page.label}</span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 导航分组 */}
      <nav className="flex-1 overflow-y-auto py-2 scrollbar-thin">
        {visibleGroups.map((group) => (
          <div key={group.id} className="mb-1">
            {!collapsed && (
              <p className="text-2xs font-semibold text-ink-400 uppercase tracking-wider px-4 py-2">
                {group.title}
              </p>
            )}
            <div className="px-2 space-y-0.5">
              {group.items.map((item) => {
                const isActive = location.pathname === item.path;
                return (
                  <SidebarNavItem
                    key={item.path}
                    item={item}
                    isActive={isActive}
                    collapsed={collapsed}
                    isHovered={hoveredItem === item.path}
                    onHoverChange={setHoveredItem}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* 底部：折叠按钮 + 工作状态 */}
      <div className="border-t border-ink-900/8 p-2">
        {collapsed ? (
          <div className="flex justify-center mb-1 py-1 group relative">
            <span className="w-1.5 h-1.5 bg-jade rounded-full animate-pulse" />
            <Tooltip label="引擎就绪 · 本地+云端双模" />
          </div>
        ) : (
          <div className="px-2 py-2 mb-1 bg-rice-200 rounded-md">
            <div className="flex items-center gap-2 mb-1">
              <span className="w-1.5 h-1.5 bg-jade rounded-full animate-pulse" />
              <span className="text-2xs font-medium text-ink-600">引擎就绪</span>
            </div>
            <p className="text-2xs text-ink-400 font-mono">本地+云端双模</p>
          </div>
        )}
        <button
          onClick={onToggle}
          className={`w-full h-8 flex items-center justify-center gap-1 text-ink-500 hover:text-ink-900 bg-rice-200/50 hover:bg-ink-900/5 rounded-md transition-colors border border-ink-900/6 ${
            collapsed ? 'mx-auto' : ''
          }`}
          title={collapsed ? '展开侧栏' : '折叠侧栏'}
        >
          {collapsed ? (
            <ChevronRight className="w-4 h-4" />
          ) : (
            <>
              <ChevronLeft className="w-3.5 h-3.5" />
              <span className="text-xs">折叠</span>
            </>
          )}
        </button>
      </div>
    </aside>
  );
}

/* 轻量 tooltip：折叠状态下显示 */
function Tooltip({ label }: { label: string }) {
  return (
    <span className="pointer-events-none absolute left-full ml-2 px-2 py-1 bg-ink-900 text-rice-100 text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-50 shadow-overlay">
      {label}
    </span>
  );
}

/* 导出创作类型，供其他组件复用 */
// eslint-disable-next-line react-refresh/only-export-components -- 导航配置常量与组件同文件便于协同维护,非 HMR 热点
export { creationTypes };
