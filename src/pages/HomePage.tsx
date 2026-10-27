import { useState, useEffect, useMemo, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Eye, BookOpen, Wand2, Heart, Sparkles, TrendingUp, TrendingDown, ArrowRight,
  Plus, Clock, Award, Zap, Brush, PenTool, Box, Layers, RefreshCw, type LucideIcon,
  Quote, ChevronRight, Star, Target, AlertCircle, ChevronLeft, FileEdit, Loader2,
} from 'lucide-react';
import { getAnalysisHistory, getGrowthData } from '../services/data-service';
import { listDrafts, subscribeDrafts, type Draft } from '../services/draft-service';
import { listEmotionPresets, type EmotionPreset } from '../services/emotionPresetStore';
import { listFuseUserPresets, type FuseUserPreset } from '../services/fusePresetStore';
import { getEmotionById } from '../services/emotionLibrary';
import { getStyleById, getMethodById, getIntensityById } from '../services/fuseStandards';
import { useAuth } from '../hooks/useAuth';
import { getRoleMeta } from '../components/auth/TenantSwitcher';
import type { HistoryRecord, GrowthData } from '../types';
import SmartImage from '../components/SmartImage';

/* 艺术名言（每日一条） */
const artQuotes = [
  { text: '外师造化，中得心源', author: '张璾' },
  { text: '搜尽奇峰打草稿', author: '石涛' },
  { text: '意在笔先，画尽意在', author: '王维' },
  { text: '远观其势，近取其质', author: '郭熙' },
  { text: '笔墨当随时代', author: '石涛' },
  { text: '以形写神，形神兼备', author: '顾恺之' },
];

/* 创作类型 */
const artTypeIcons: Record<string, { icon: LucideIcon; label: string; color: string; bg: string }> = {
  painting: { icon: Brush, label: '绘画', color: 'text-cinnabar', bg: 'bg-cinnabar/10' },
  design: { icon: PenTool, label: '设计', color: 'text-stone', bg: 'bg-stone/10' },
  product: { icon: Box, label: '产品设计', color: 'text-gold-dark', bg: 'bg-gold/10' },
  sculpture: { icon: Layers, label: '雕塑', color: 'text-purple-500', bg: 'bg-purple-500/10' },
};

/* 相对时间格式化 */
function formatRelativeDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '—';
  const diff = (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24);
  if (diff < 1) return '今天';
  if (diff < 2) return '昨天';
  if (diff < 7) return `${Math.floor(diff)}天前`;
  return d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

/* 相对时间格式化 (ms 时间戳):"刚刚" / "3 分钟前" / "2 小时前" / "1 天前" */
function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 0) return '刚刚';
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return '刚刚';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day} 天前`;
  return new Date(ts).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

export default function HomePage() {
  const [history, setHistory] = useState<HistoryRecord[]>([]);
  const [growthData, setGrowthData] = useState<GrowthData[]>([]);
  const navigate = useNavigate();
  const { user, tenant } = useAuth();
  /* 名言索引：初始为今日名言，用户可通过左右按钮切换 */
  const [quoteIndex, setQuoteIndex] = useState(() => new Date().getDate() % artQuotes.length);

  /* ====== 创作草稿(任务包A):工作台"继续创作"区域 ======
   * - drafts: 当前用户最近草稿(最多展示 4 条,按 updatedAt 倒序)
   * - draftsTick: 跨标签 storage 事件触发的刷新信号
   * - 未登录或读取失败时静默不显示该区块 */
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [draftsTick, setDraftsTick] = useState(0);

  /* ====== 我的预设(情绪画布+灵感嫁接) ====== */
  const [presets, setPresets] = useState<Array<{
    id: string;
    name: string;
    kind: 'emotion' | 'fuse';
    createdAt: number;
    summary: string;
    accent: string; // 颜色主色(用于左侧色条)
    palette?: string[]; // 情绪画布色板预览
    link: string; // 点击"直接使用"跳转(情绪画布带auto=1直接生成)
    viewLink: string; // 仅载入不生成
  }>>([]);

  useEffect(() => {
    try {
      const emotionList = listEmotionPresets().map((p: EmotionPreset) => {
        const primary = getEmotionById(p.primaryId);
        const secondary = p.secondaryId ? getEmotionById(p.secondaryId) : null;
        const palette = p.customPalette && p.customPalette.length
          ? p.customPalette
          : (secondary ? [...primary.colorPalette, ...secondary.colorPalette].slice(0, 5) : primary.colorPalette.slice(0, 5));
        const intensityLevels = [
          { value: 0.3, label: '淡' },
          { value: 0.6, label: '中' },
          { value: 1.0, label: '浓' },
        ];
        const intensityLabel = intensityLevels.find((l) => Math.abs(l.value - p.intensity) < 0.2)?.label || '中';
        const summary = secondary
          ? `${primary.name} ${Math.round((p.ratio) * 100)}% + ${secondary.name} · 浓度${intensityLabel}`
          : `${primary.name} · 浓度${intensityLabel}`;
        return {
          id: p.id,
          name: p.name,
          kind: 'emotion' as const,
          createdAt: p.createdAt,
          summary,
          accent: primary.colorPalette[0] || '#B91C1C',
          palette,
          link: `/emotion?preset=${encodeURIComponent(p.id)}&auto=1`,
          viewLink: `/emotion?preset=${encodeURIComponent(p.id)}`,
        };
      });
      const fuseList = listFuseUserPresets().map((p: FuseUserPreset) => {
        const style = getStyleById(p.styleId);
        const method = getMethodById(p.methodId);
        const intensity = getIntensityById(p.intensityId);
        const ratioPct = `${Math.round(p.ratio * 100)}%`;
        return {
          id: p.id,
          name: p.name,
          kind: 'fuse' as const,
          createdAt: p.createdAt,
          summary: `${style?.name ?? '风格'} + ${method?.name ?? '手法'} · ${intensity?.name ?? '中浓度'} · 风格${ratioPct}`,
          accent: '#B45309',
          link: `/fuse?preset=${encodeURIComponent(p.id)}`,
          viewLink: `/fuse?preset=${encodeURIComponent(p.id)}`,
        };
      });
      const merged = [...emotionList, ...fuseList]
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 8);
      setPresets(merged);
    } catch (err) {
      console.warn('加载我的预设失败:', err);
      setPresets([]);
    }
  }, []);

  const refreshDrafts = useCallback(() => {
    setDraftsTick((t) => t + 1);
  }, []);

  /* 跨标签同步:其他标签创建/删除草稿时刷新本标签 */
  useEffect(() => {
    const unsub = subscribeDrafts(refreshDrafts);
    return unsub;
  }, [refreshDrafts]);

  /* 加载草稿(用户/租户/刷新信号变化时);失败静默 */
  useEffect(() => {
    if (!user || !tenant) {
      setDrafts([]);
      return;
    }
    try {
      const list = listDrafts(tenant.id, user.id);
      setDrafts(list.slice(0, 4));
    } catch (err) {
      console.warn('加载创作草稿失败:', err);
      setDrafts([]);
    }
  }, [user, tenant, draftsTick]);

  // 异步并行加载历史和成长数据：通过 data-service 自动选择数据源
  // 依赖 user?.id:AuthProvider 异步恢复登录态后,user 从 undefined→对象,
  // 需重试拉取(否则首屏挂载时 token 未恢复会拉空,后续不再重试)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [records, growth] = await Promise.all([
          getAnalysisHistory(),
          getGrowthData(),
        ]);
        if (!cancelled) {
          setHistory(records);
          setGrowthData(growth);
        }
      } catch (err) {
        console.error('加载工作台数据失败:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  /* 每日名言（按日期取初始值，用户可手动切换） */
  const todayQuote = useMemo(() => artQuotes[quoteIndex] ?? artQuotes[0], [quoteIndex]);
  const handlePrevQuote = () => setQuoteIndex((i) => (i - 1 + artQuotes.length) % artQuotes.length);
  const handleNextQuote = () => setQuoteIndex((i) => (i + 1) % artQuotes.length);

  /* 统计数据 */
  const stats = useMemo(() => {
    const total = history.length;
    const recent7 = history.filter((h) => {
      const d = new Date(h.createdAt);
      const diff = (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24);
      return diff <= 7;
    }).length;
    /* 批次②:仅统计有评分记录(基础检测无分不拉低均值、不计入待改进) */
    const scored = history.filter((h) => h.overallScore != null);
    const avgScore = scored.length > 0
      ? Math.round(scored.reduce((s, h) => s + (h.overallScore ?? 0), 0) / scored.length)
      : 0;
    const pending = history.filter((h) => h.overallScore != null && h.overallScore < 70).length;
    return { total, recent7, avgScore, pending };
  }, [history]);

  /* 最近作品（取前 6 条） */
  const recentWorks = useMemo(() => history.slice(0, 6), [history]);

  /* 成长趋势（最近 5 次的总分） */
  const growthTrend = useMemo(() => {
    if (growthData.length < 2) return { trend: 'stable' as const, delta: 0 };
    const recent = growthData.slice(-5);
    const first = recent[0].overall;
    const last = recent[recent.length - 1].overall;
    const delta = last - first;
    return {
      trend: delta > 2 ? 'up' as const : delta < -2 ? 'down' as const : 'stable' as const,
      delta: Math.abs(delta),
    };
  }, [growthData]);

  /* 快捷工具 */
  const quickTools = [
    { path: '/analyze', icon: Eye, label: 'AI 诊断', desc: '3秒智能分析', color: 'cinnabar' },
    { path: '/materials', icon: BookOpen, label: '素材库', desc: '中外名作参考', color: 'stone' },
    { path: '/styles', icon: Wand2, label: '风格库', desc: '中式美学转换', color: 'gold' },
    { path: '/fuse', icon: Sparkles, label: '灵感嫁接', desc: '元素融合创新', color: 'cinnabar' },
    { path: '/emotion', icon: Heart, label: '情绪画布', desc: '情绪转色调', color: 'stone' },
    { path: '/growth', icon: TrendingUp, label: '成长曲线', desc: '能力追踪', color: 'gold' },
  ];

  /* 快速开始卡片（4个核心功能，欢迎区下方） */
  const quickStartCards = [
    { path: '/analyze', icon: Eye, label: 'AI 诊断', desc: '3秒智能分析作品', color: 'cinnabar' },
    { path: '/materials', icon: BookOpen, label: '素材库', desc: '中外名作参考', color: 'stone' },
    { path: '/styles', icon: Wand2, label: '风格库', desc: '中式美学转换', color: 'gold' },
    { path: '/fuse', icon: Sparkles, label: '灵感嫁接', desc: '元素融合创新', color: 'cinnabar' },
  ];

  const colorMap = {
    cinnabar: { bg: 'bg-cinnabar/10', text: 'text-cinnabar', border: 'hover:border-cinnabar/30' },
    stone: { bg: 'bg-stone/10', text: 'text-stone', border: 'hover:border-stone/30' },
    gold: { bg: 'bg-gold/10', text: 'text-gold-dark', border: 'hover:border-gold/30' },
  };

  return (
    <div className="h-full overflow-y-auto scrollbar-thin bg-rice-200 ink-texture">
      <div className="max-w-7xl mx-auto px-4 md:px-6 lg:px-8 py-6 md:py-8 space-y-6">
        {/* ========== 顶部：欢迎 + 快捷操作 ========== */}
        <section className="animate-fade-in">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-6">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-cinnabar/10 text-cinnabar text-2xs font-medium rounded-full">
                  <span className="w-1.5 h-1.5 bg-cinnabar rounded-full animate-pulse" />
                  工作台
                </span>
                <span className="text-2xs text-ink-400 font-mono">
                  {new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}
                </span>
              </div>
              <h1 className="font-serif text-2xl md:text-3xl font-bold text-ink-900">
                欢迎回来，<span className="text-cinnabar">{getRoleMeta(user?.role ?? 'student').label}</span>
              </h1>
              <p className="text-sm text-ink-500 mt-1">
                {stats.total > 0
                  ? `已诊断 ${stats.total} 件作品，平均分 ${stats.avgScore}，继续探索创作可能`
                  : '上传第一件作品，开始你的 AI 创作诊断之旅'}
              </p>
            </div>
            <Link
              to="/analyze"
              className="inline-flex items-center gap-2 px-4 h-10 bg-cinnabar hover:bg-cinnabar-dark text-white rounded-md text-sm font-medium shadow-card hover:shadow-card-hover transition-all group"
            >
              <Plus className="w-4 h-4" />
              新建诊断
              <kbd className="ml-1 px-1.5 py-0.5 bg-cinnabar-dark/30 rounded text-2xs font-mono">N</kbd>
              <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
            </Link>
          </div>
        </section>

        {/* ========== 继续创作 (草稿区,任务包A) ========== */}
        {drafts.length > 0 && (
          <section className="animate-fade-in">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 bg-cinnabar/10 rounded-md flex items-center justify-center">
                  <FileEdit className="w-4 h-4 text-cinnabar" />
                </div>
                <div>
                  <h3 className="font-serif text-base font-semibold text-ink-900">继续创作</h3>
                  <p className="text-2xs text-ink-400">未完成的诊断,点击继续</p>
                </div>
              </div>
              {drafts.length >= 4 && (
                <Link
                  to="/history"
                  className="flex items-center gap-1 text-xs text-ink-500 hover:text-cinnabar transition-colors"
                >
                  查看全部草稿 <ChevronRight className="w-3 h-3" />
                </Link>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
              {drafts.map((draft) => {
                const cfg = artTypeIcons[draft.artworkType] || artTypeIcons.painting;
                const Icon = cfg.icon;
                const isAnalyzing = draft.status === 'analyzing';
                return (
                  <div
                    key={draft.id}
                    onClick={() => navigate(`/analyze?draftId=${draft.id}`)}
                    className="group bg-rice-50 border border-ink-900/6 hover:border-cinnabar/30 hover:shadow-card-hover hover:-translate-y-0.5 rounded-lg overflow-hidden transition-all cursor-pointer"
                  >
                    {/* 缩略图 / 类型图标占位 */}
                    <div className="relative aspect-[4/3] bg-rice-200 overflow-hidden">
                      {draft.imagePreview ? (
                        <img
                          src={draft.imagePreview}
                          alt="草稿缩略图"
                          loading="lazy"
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                        />
                      ) : (
                        <div className={`w-full h-full ${cfg.bg} flex items-center justify-center`}>
                          <Icon className={`w-8 h-8 ${cfg.color}`} />
                        </div>
                      )}
                      {/* 状态徽章 */}
                      <div className={`absolute top-2 left-2 px-1.5 py-0.5 text-2xs rounded flex items-center gap-1 ${
                        isAnalyzing
                          ? 'bg-cinnabar/90 text-white'
                          : 'bg-ink-900/70 backdrop-blur-sm text-rice-100'
                      }`}>
                        {isAnalyzing ? (
                          <Loader2 className="w-2.5 h-2.5 animate-spin" />
                        ) : (
                          <Clock className="w-2.5 h-2.5" />
                        )}
                        {isAnalyzing ? '分析中' : '草稿'}
                      </div>
                      {/* 类型徽章 */}
                      <div className="absolute top-2 right-2 px-1.5 py-0.5 bg-ink-900/80 backdrop-blur-sm text-rice-100 text-2xs rounded flex items-center gap-1">
                        <Icon className="w-2.5 h-2.5" />
                        {cfg.label}
                      </div>
                    </div>
                    {/* 信息 */}
                    <div className="p-3">
                      <p className="text-sm font-medium text-ink-900 truncate group-hover:text-cinnabar transition-colors">
                        {draft.title}
                      </p>
                      <div className="flex items-center justify-between mt-1.5">
                        <span className="flex items-center gap-1 text-2xs text-ink-400">
                          <Clock className="w-2.5 h-2.5" />
                          {formatRelativeTime(draft.updatedAt)}
                        </span>
                        <span className="flex items-center gap-0.5 text-2xs text-cinnabar font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                          继续 <ArrowRight className="w-3 h-3" />
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ========== 我的预设(情绪画布+灵感嫁接) ========== */}
        {presets.length > 0 && (
          <section className="animate-fade-in">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Star className="w-4 h-4 text-gold-dark" />
                <h3 className="font-serif text-base font-semibold text-ink-900">我的预设方案</h3>
                <span className="text-2xs text-ink-400">一键载入，直接生成</span>
              </div>
              <Link to="/emotion" className="text-2xs text-ink-500 hover:text-cinnabar flex items-center gap-0.5 transition-colors">
                管理预设 <ChevronRight className="w-3 h-3" />
              </Link>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {presets.map((preset) => {
                const KindIcon = preset.kind === 'emotion' ? Heart : Sparkles;
                const kindLabel = preset.kind === 'emotion' ? '情绪画布' : '灵感嫁接';
                return (
                  <div
                    key={`${preset.kind}-${preset.id}`}
                    className="group relative bg-rice-50 border border-ink-900/6 rounded-lg overflow-hidden hover:shadow-card-hover hover:-translate-y-0.5 transition-all cursor-pointer"
                    onClick={() => navigate(preset.link)}
                  >
                    {/* 左侧强调色条 */}
                    <div
                      className="absolute left-0 top-0 bottom-0 w-1"
                      style={{ backgroundColor: preset.accent }}
                    />
                    {/* 色板预览 (仅情绪画布) */}
                    {preset.kind === 'emotion' && preset.palette && (
                      <div className="flex h-10 w-full">
                        {preset.palette.map((c, i) => (
                          <div key={i} className="flex-1" style={{ backgroundColor: c }} />
                        ))}
                      </div>
                    )}
                    {preset.kind === 'fuse' && (
                      <div className="h-10 bg-gradient-to-r from-gold/30 via-cinnabar/20 to-ink-900/10 flex items-center px-3 gap-2">
                        <Sparkles className="w-4 h-4 text-gold-dark" />
                        <span className="text-2xs text-ink-700 font-medium">灵感嫁接 · 融合搭配</span>
                      </div>
                    )}
                    <div className="p-3 pl-4">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-medium text-ink-900 truncate group-hover:text-cinnabar transition-colors">
                          {preset.name}
                        </p>
                        <span className={`flex-shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-2xs ${
                          preset.kind === 'emotion' ? 'bg-cinnabar/10 text-cinnabar' : 'bg-gold/15 text-gold-dark'
                        }`}>
                          <KindIcon className="w-2.5 h-2.5" />
                          {kindLabel}
                        </span>
                      </div>
                      <p className="mt-1 text-2xs text-ink-500 line-clamp-2 leading-snug">{preset.summary}</p>
                      <div className="flex items-center justify-between mt-2.5">
                        <span className="text-2xs text-ink-400">{formatRelativeTime(preset.createdAt)}</span>
                        <span className="flex items-center gap-0.5 text-2xs text-cinnabar font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                          {preset.kind === 'emotion' ? '直接生成' : '载入搭配'} <ArrowRight className="w-3 h-3" />
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ========== 快速开始卡片组 ========== */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-3 animate-fade-in">
          {quickStartCards.map((card) => {
            const Icon = card.icon;
            const c = colorMap[card.color as keyof typeof colorMap];
            return (
              <Link
                key={card.path}
                to={card.path}
                className={`group flex items-center gap-3 p-3 bg-rice-50 border border-ink-900/6 ${c.border} hover:shadow-card-hover hover:-translate-y-0.5 rounded-lg transition-all`}
              >
                <div className={`w-10 h-10 ${c.bg} rounded-md flex items-center justify-center flex-shrink-0`}>
                  <Icon className={`w-5 h-5 ${c.text}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink-900 truncate">{card.label}</p>
                  <p className="text-2xs text-ink-400 truncate">{card.desc}</p>
                </div>
                <ArrowRight className="w-4 h-4 text-ink-300 group-hover:text-cinnabar group-hover:translate-x-0.5 transition-all flex-shrink-0" />
              </Link>
            );
          })}
        </section>

        {/* ========== 数据概览卡片 ========== */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-3 animate-slide-up">
          <StatCard
            icon={Eye}
            label="累计诊断"
            value={stats.total}
            unit="件"
            sub={`近7天 +${stats.recent7}`}
            color="cinnabar"
            onClick={() => navigate('/history')}
          />
          <StatCard
            icon={Award}
            label="平均分数"
            value={stats.avgScore}
            unit="分"
            sub={stats.avgScore >= 80 ? '优秀水平' : stats.avgScore >= 70 ? '良好水平' : '待提升'}
            color="stone"
            onClick={() => navigate('/growth')}
          />
          <StatCard
            icon={growthTrend.trend === 'up' ? TrendingUp : growthTrend.trend === 'down' ? TrendingDown : Target}
            label="成长趋势"
            value={growthTrend.delta}
            unit="分"
            sub={growthTrend.trend === 'up' ? '稳步上升' : growthTrend.trend === 'down' ? '注意下滑' : '保持稳定'}
            color="gold"
            onClick={() => navigate('/growth')}
          />
          <StatCard
            icon={AlertCircle}
            label="待改进"
            value={stats.pending}
            unit="件"
            sub="评分 < 70"
            color="cinnabar"
            onClick={() => navigate('/history?filter=pending')}
          />
        </section>

        {/* ========== 主体网格：最近作品 + 侧栏 ========== */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* 左：最近作品（占 2 列） */}
          <div className="lg:col-span-2 space-y-4">
            <Panel
              title="最近作品"
              desc="最近的诊断记录"
              action={
                <Link
                  to="/history"
                  className="flex items-center gap-1 text-xs text-ink-500 hover:text-cinnabar transition-colors"
                >
                  查看全部 <ChevronRight className="w-3 h-3" />
                </Link>
              }
            >
              {recentWorks.length === 0 ? (
                <EmptyState
                  icon={Eye}
                  title="还没有诊断记录"
                  desc="上传你的第一件作品，AI 将在 3 秒内给出专业诊断报告"
                  action={
                    <Link
                      to="/analyze"
                      className="inline-flex items-center gap-1.5 px-3 h-8 bg-cinnabar hover:bg-cinnabar-dark text-white rounded-md text-xs font-medium transition-colors"
                    >
                      <Plus className="w-3 h-3" /> 开始诊断
                    </Link>
                  }
                />
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                  {recentWorks.map((work) => {
                    const cfg = artTypeIcons[work.artType] || artTypeIcons.painting;
                    const Icon = cfg.icon;
                    return (
                      <div
                        key={work.id}
                        onClick={() => navigate('/history')}
                        className="group bg-rice-50 border border-ink-900/6 hover:border-ink-900/15 hover:shadow-card-hover rounded-lg overflow-hidden transition-all cursor-pointer"
                      >
                        {/* 缩略图 */}
                        <div className="relative aspect-[4/3] bg-rice-200 overflow-hidden">
                          {work.imageUrl ? (
                            <SmartImage
                              src={work.imageUrl}
                              alt="作品缩略图"
                              className="w-full h-full"
                              imgClassName="object-cover transition-all duration-500 group-hover:scale-105"
                              fallbackText="作品图加载失败"
                            />
                          ) : (
                            <div className={`w-full h-full ${cfg.bg} flex items-center justify-center`}>
                              <Icon className={`w-8 h-8 ${cfg.color}`} />
                            </div>
                          )}
                          {/* 类型徽章 */}
                          <div className="absolute top-2 left-2 px-1.5 py-0.5 bg-ink-900/80 backdrop-blur-sm text-rice-100 text-2xs rounded flex items-center gap-1">
                            <Icon className="w-2.5 h-2.5" />
                            {cfg.label}
                          </div>
                          {/* 分数(批次②:无评分时不渲染角标) */}
                          {work.overallScore != null && (
                            <div className="absolute top-2 right-2 w-9 h-9 bg-white/95 backdrop-blur-sm rounded-md flex items-center justify-center">
                              <span className={`font-serif text-base font-bold ${
                                work.overallScore >= 85 ? 'text-jade' :
                                work.overallScore >= 70 ? 'text-gold-dark' :
                                'text-cinnabar'
                              }`}>
                                {work.overallScore}
                              </span>
                            </div>
                          )}
                          {/* 快捷操作（hover 滑入） */}
                          <div className="absolute bottom-2 right-2 flex items-center gap-1.5 translate-y-3 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all duration-200">
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); navigate('/history'); }}
                              className="w-8 h-8 bg-white/95 backdrop-blur rounded-md flex items-center justify-center text-ink-700 hover:bg-cinnabar hover:text-white transition-colors shadow-card"
                              title="查看详情"
                              aria-label="查看详情"
                            >
                              <Eye className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); navigate(`/analyze?type=${work.artType}`); }}
                              className="w-8 h-8 bg-white/95 backdrop-blur rounded-md flex items-center justify-center text-ink-700 hover:bg-cinnabar hover:text-white transition-colors shadow-card"
                              title="再次诊断"
                              aria-label="再次诊断"
                            >
                              <RefreshCw className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                        {/* 信息 */}
                        <div className="p-3">
                          <p className="text-sm font-medium text-ink-900 truncate group-hover:text-cinnabar transition-colors">
                            {cfg.label}作品 · {work.overallScore == null ? '待评分' : `${work.overallScore}分`}
                          </p>
                          <div className="flex items-center justify-between mt-1.5">
                            <span className="flex items-center gap-1 text-2xs text-ink-400">
                              <Clock className="w-2.5 h-2.5" />
                              {formatRelativeDate(work.createdAt)}
                            </span>
                            <ArrowRight className="w-3 h-3 text-ink-300 group-hover:text-cinnabar group-hover:translate-x-0.5 transition-all" />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Panel>

            {/* 快捷工具 */}
            <Panel title="快捷工具" desc="一键直达核心功能">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {quickTools.map((tool) => {
                  const Icon = tool.icon;
                  const c = colorMap[tool.color as keyof typeof colorMap];
                  return (
                    <Link
                      key={tool.path}
                      to={tool.path}
                      className={`group flex items-center gap-3 p-3 bg-rice-50 border border-ink-900/6 hover:shadow-card-hover rounded-md transition-all ${c.border}`}
                    >
                      <div className={`w-9 h-9 ${c.bg} rounded-md flex items-center justify-center flex-shrink-0`}>
                        <Icon className={`w-4 h-4 ${c.text}`} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-ink-900 truncate">{tool.label}</p>
                        <p className="text-2xs text-ink-400 truncate">{tool.desc}</p>
                      </div>
                      <ChevronRight className="w-3.5 h-3.5 text-ink-300 group-hover:text-ink-600 group-hover:translate-x-0.5 transition-all" />
                    </Link>
                  );
                })}
              </div>
            </Panel>
          </div>

          {/* 右：侧栏（每日名言 + 待办 + 创作类型） */}
          <div className="space-y-4">
            {/* 每日名言（可切换） */}
            <div className="relative overflow-hidden bg-gradient-to-br from-ink-900 to-ink-800 rounded-lg p-5 shadow-card">
              <div className="absolute -top-8 -right-8 w-32 h-32 bg-cinnabar/10 rounded-full blur-2xl" />
              <div className="absolute -bottom-8 -left-8 w-32 h-32 bg-stone/10 rounded-full blur-2xl" />
              <div className="relative">
                <div className="flex items-center gap-2 mb-3">
                  <Quote className="w-4 h-4 text-cinnabar-light" />
                  <span className="text-2xs text-rice-300 uppercase tracking-wider">每日艺语</span>
                  {/* 切换按钮 + 计数 */}
                  <div className="ml-auto flex items-center gap-1">
                    <button
                      type="button"
                      onClick={handlePrevQuote}
                      aria-label="上一条名言"
                      className="w-6 h-6 flex items-center justify-center rounded text-rice-300 hover:text-rice-100 hover:bg-rice-100/10 transition-colors"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </button>
                    <span className="text-2xs text-rice-400 font-mono tabular-nums">
                      {quoteIndex + 1}/{artQuotes.length}
                    </span>
                    <button
                      type="button"
                      onClick={handleNextQuote}
                      aria-label="下一条名言"
                      className="w-6 h-6 flex items-center justify-center rounded text-rice-300 hover:text-rice-100 hover:bg-rice-100/10 transition-colors"
                    >
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                {/* 用 key 触发淡入动画，切换名言时有过渡 */}
                <p
                  key={quoteIndex}
                  className="font-serif text-lg text-rice-100 leading-relaxed mb-3 animate-fade-in"
                >
                  {todayQuote.text}
                </p>
                <p className="text-xs text-rice-400">—— {todayQuote.author}</p>
              </div>
            </div>

            {/* 快捷入口（创作类型 + 待办提醒 合并） */}
            <Panel title="快捷入口" desc="常用功能与待办">
              {/* 上：创作类型 */}
              <div className="grid grid-cols-4 gap-2 pb-3 mb-3 border-b border-ink-900/6">
                {Object.entries(artTypeIcons).map(([key, cfg]) => {
                  const Icon = cfg.icon;
                  const count = history.filter((h) => h.artType === key).length;
                  return (
                    <Link
                      key={key}
                      to={`/analyze?type=${key}`}
                      className="group flex flex-col items-center p-2 bg-rice-50 border border-ink-900/6 hover:border-ink-900/15 rounded-md transition-all"
                    >
                      <div className={`w-9 h-9 ${cfg.bg} rounded-full flex items-center justify-center mb-1 group-hover:scale-110 transition-transform`}>
                        <Icon className={`w-4 h-4 ${cfg.color}`} />
                      </div>
                      <p className="text-2xs font-medium text-ink-900">{cfg.label}</p>
                      <p className="text-2xs text-ink-400">{count}</p>
                    </Link>
                  );
                })}
              </div>
              {/* 下：待办提醒（最多 2 条） */}
              <div className="space-y-2">
                {stats.pending > 0 && (
                  <div className="flex items-start gap-2 p-2 bg-cinnabar/5 border border-cinnabar/15 rounded-md">
                    <AlertCircle className="w-3.5 h-3.5 text-cinnabar flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-ink-900">{stats.pending} 件作品待改进</p>
                      <p className="text-2xs text-ink-500 mt-0.5">评分低于 70，建议复盘</p>
                    </div>
                    <Link to="/history" className="text-2xs text-cinnabar hover:underline flex-shrink-0">
                      查看
                    </Link>
                  </div>
                )}
                <div className="flex items-start gap-2 p-2 bg-gold/5 border border-gold/15 rounded-md">
                  <Star className="w-3.5 h-3.5 text-gold-dark flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-ink-900">查看本周成长</p>
                    <p className="text-2xs text-ink-500 mt-0.5">复盘能力变化趋势</p>
                  </div>
                  <Link to="/growth" className="text-2xs text-gold-dark hover:underline flex-shrink-0">
                    查看
                  </Link>
                </div>
              </div>
            </Panel>
          </div>
        </section>

        {/* 底部：能力提示 + 完整功能入口 */}
        <section className="bg-rice-100 border border-ink-900/6 rounded-lg p-4 flex flex-col md:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-cinnabar/10 rounded-full flex items-center justify-center">
              <Zap className="w-5 h-5 text-cinnabar" />
            </div>
            <div>
              <p className="text-sm font-medium text-ink-900">支持绘画、设计、产品、雕塑四大创作形式</p>
              <p className="text-2xs text-ink-500 mt-0.5">智能感知复杂度，自动选择最优分析方案</p>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            <Link
              to="/settings"
              className="text-xs text-ink-500 hover:text-cinnabar transition-colors"
            >
              查看完整功能
            </Link>
            <Link
              to="/analyze"
              className="inline-flex items-center gap-1.5 px-4 h-9 bg-ink-900 hover:bg-ink-800 text-rice-100 rounded-md text-sm font-medium transition-colors"
            >
              开始诊断 <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}

/* ====== 子组件 ====== */

function StatCard({
  icon: Icon, label, value, unit, sub, color, onClick,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  unit: string;
  sub: string;
  color: 'cinnabar' | 'stone' | 'gold';
  onClick?: () => void;
}) {
  const colorMap = {
    cinnabar: { text: 'text-cinnabar', bg: 'bg-cinnabar/10' },
    stone: { text: 'text-stone', bg: 'bg-stone/10' },
    gold: { text: 'text-gold-dark', bg: 'bg-gold/10' },
  };
  const c = colorMap[color];
  return (
    <div
      onClick={onClick}
      className={`bg-rice-50 border border-ink-900/6 rounded-lg p-4 transition-all ${
        onClick
          ? 'cursor-pointer hover:shadow-card-hover hover:-translate-y-0.5 hover:border-ink-900/15'
          : 'hover:shadow-card-hover'
      }`}
    >
      <div className="flex items-center justify-between mb-3">
        <div className={`w-8 h-8 ${c.bg} rounded-md flex items-center justify-center`}>
          <Icon className={`w-4 h-4 ${c.text}`} />
        </div>
        <span className="text-2xs text-ink-400 font-medium">{label}</span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="font-serif text-2xl md:text-3xl font-bold text-ink-900">{value}</span>
        <span className="text-xs text-ink-400">{unit}</span>
      </div>
      <p className="text-2xs text-ink-500 mt-1">{sub}</p>
    </div>
  );
}

function Panel({
  title, desc, action, children,
}: {
  title: string;
  desc?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-rice-50 border border-ink-900/6 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-ink-900/6">
        <div>
          <h3 className="text-sm font-semibold text-ink-900">{title}</h3>
          {desc && <p className="text-2xs text-ink-400 mt-0.5">{desc}</p>}
        </div>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function EmptyState({
  icon: Icon, title, desc, action,
}: {
  icon: LucideIcon;
  title: string;
  desc: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="w-14 h-14 bg-rice-200 rounded-full flex items-center justify-center mb-3">
        <Icon className="w-7 h-7 text-ink-300" />
      </div>
      <p className="text-sm font-medium text-ink-700 mb-1">{title}</p>
      <p className="text-xs text-ink-400 mb-4 max-w-xs">{desc}</p>
      {action}
    </div>
  );
}
