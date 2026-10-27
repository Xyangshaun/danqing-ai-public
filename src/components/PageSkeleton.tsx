import { Loader2 } from 'lucide-react';

/* ============================================================
 * 水墨风格骨架屏系统
 *
 * 设计规范:
 * - 背景色 bg-rice-200(与页面一致)
 * - 骨架块底色:ink-900/5(rgba(15,15,15,0.05))
 * - shimmer 扫光:透明 → ink-900/5 → 透明(横向 -100% → 100% 扫过)
 * - 圆角统一 rounded-md(0.375rem),契合 8px 网格
 * - 主色调朱砂红,保持品牌一致性
 *
 * 通过 <style> 标签定义 dqShimmer keyframe,命名加前缀避免与
 * tailwind 既有 shimmer keyframe(backgroundPosition 语义)冲突。
 * ============================================================ */

const SKELETON_STYLE = `
@keyframes dqShimmer {
  0%   { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}
.dq-skeleton {
  position: relative;
  overflow: hidden;
  background-color: rgba(15, 15, 15, 0.05);   /* ink-900/5 */
  border-radius: 0.375rem;                     /* rounded-md */
}
.dq-skeleton::after {
  content: '';
  position: absolute;
  inset: 0;
  transform: translateX(-100%);
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(15, 15, 15, 0.05) 50%,
    transparent 100%
  );
  animation: dqShimmer 1.6s ease-in-out infinite;
  pointer-events: none;
}
@media (prefers-reduced-motion: reduce) {
  .dq-skeleton::after { animation: none; }
}
`;

/** 注入 shimmer 动画样式:渲染一个 <style> 标签定义 keyframe 与工具类 */
export function SkeletonStyle() {
  return <style dangerouslySetInnerHTML={{ __html: SKELETON_STYLE }} />;
}

/** 基础骨架块:所有高级骨架的构建单元,也可单独使用 */
export function SkeletonBox({ className = '' }: { className?: string }) {
  return <div className={`dq-skeleton ${className}`} aria-hidden="true" />;
}

/* ============================================================
 * 页面级 variant 骨架块
 *
 * variant 内容块采用 Tailwind animate-pulse(更轻量),
 * 底色与 SkeletonBox 保持一致(ink-900/8)以维持视觉统一。
 * ============================================================ */

/**
 * variant 内容块:animate-pulse 驱动的轻量骨架块。
 * - 不依赖 dq-skeleton 的 ::after 扫光(避免 variant 大量块嵌套时 ::after 重绘开销)
 * - 圆角 rounded-md 与 SkeletonBox 一致
 * - aria-hidden 让屏幕阅读器跳过装饰性占位
 */
function PulseBlock({ className = '' }: { className?: string }) {
  return <div className={`bg-ink-900/8 animate-pulse rounded-md ${className}`} aria-hidden="true" />;
}

/** variant 类型:不同页面采用不同的骨架布局 */
export type PageSkeletonVariant = 'home' | 'history' | 'analysis' | 'settings' | 'generic';

export interface PageSkeletonProps {
  /** 页面变体,默认 generic */
  variant?: PageSkeletonVariant;
  /** 容器额外类名(透传给最外层) */
  className?: string;
}

/* -------------------- 页面级骨架(路由懒加载 fallback) -------------------- */

/**
 * 页面级加载骨架屏:用于路由懒加载 Suspense fallback。
 * - 默认 variant='generic':朱砂印章式旋转图标 + 加载文案 + shimmer 进度条
 * - 其他 variant:按页面布局预占位(home/history/analysis/settings)
 *
 * 用法:
 *   <PageSkeleton />                          // generic
 *   <PageSkeleton variant="history" />        // 历史页列表骨架
 *   <PageSkeleton variant="home" />
 */
export default function PageSkeleton({ variant = 'generic', className = '' }: PageSkeletonProps) {
  return (
    <>
      <SkeletonStyle />
      <div
        className={`h-full w-full bg-rice-200 ${className}`}
        role="status"
        aria-live="polite"
        aria-label={`正在加载${variantLabel(variant)}`}
      >
        {variant === 'generic' ? <GenericSkeleton /> : <VariantSkeleton variant={variant} />}
      </div>
    </>
  );
}

function variantLabel(variant: PageSkeletonVariant): string {
  switch (variant) {
    case 'home': return '工作台';
    case 'history': return '历史记录';
    case 'analysis': return 'AI 诊断';
    case 'settings': return '设置';
    default: return '页面';
  }
}

/* ---------- generic:保留原有的印章式旋转图标 + shimmer 进度条 ---------- */
function GenericSkeleton() {
  return (
    <div className="h-full flex flex-col items-center justify-center">
      <div className="flex flex-col items-center gap-5">
        {/* 朱砂印章式旋转图标 */}
        <div className="relative">
          <div className="w-14 h-14 rounded-full border-2 border-ink-900/8" />
          <Loader2 className="w-14 h-14 text-cinnabar animate-spin absolute inset-0" />
        </div>

        {/* 文案:更有意义的加载描述 */}
        <div className="text-center">
          <p className="text-sm font-medium text-ink-700">正在准备工作台...</p>
          <p className="text-2xs text-ink-400 mt-1 font-mono">Preparing workspace…</p>
        </div>

        {/* 水墨风格 shimmer 进度条(朱砂主色,复用全局 progressShine 动画) */}
        <div className="w-48 h-1 bg-ink-900/5 rounded-full overflow-hidden">
          <div className="h-full w-1/2 bg-cinnabar rounded-full progress-shine-animation" />
        </div>
      </div>
    </div>
  );
}

/* ---------- 各 variant 的具体布局 ---------- */
function VariantSkeleton({ variant }: { variant: Exclude<PageSkeletonVariant, 'generic'> }) {
  /* 外层 padding 与 main 内容区一致(对齐 Header/Sidebar 间距) */
  const wrap = 'p-6 md:p-8 space-y-6 max-w-6xl mx-auto';
  switch (variant) {
    case 'home': return <HomeVariant className={wrap} />;
    case 'history': return <HistoryVariant className={wrap} />;
    case 'analysis': return <AnalysisVariant className={wrap} />;
    case 'settings': return <SettingsVariant className={wrap} />;
    default: return <GenericSkeleton />;
  }
}

/* home:Hero 区 + 卡片网格(3-4 个卡片占位) */
function HomeVariant({ className }: { className: string }) {
  return (
    <div className={className}>
      {/* Hero 区:大标题 + 副标题 + 右侧行动按钮 */}
      <div className="flex items-end justify-between gap-4 pb-2">
        <div className="space-y-2 flex-1">
          <PulseBlock className="h-7 w-48" />
          <PulseBlock className="h-4 w-72" />
        </div>
        <PulseBlock className="h-10 w-28" />
      </div>

      {/* 快速开始卡片网格:4 张卡片占位 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="bg-rice-50 border border-ink-900/6 rounded-md p-5 space-y-3">
            <PulseBlock className="h-8 w-8 rounded-full" />
            <PulseBlock className="h-3 w-1/2" />
            <PulseBlock className="h-3 w-2/3" />
          </div>
        ))}
      </div>

      {/* 数据概览卡片网格 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="bg-rice-50 border border-ink-900/6 rounded-md p-5 space-y-3">
            <PulseBlock className="h-8 w-8 rounded-full" />
            <PulseBlock className="h-3 w-1/2" />
            <PulseBlock className="h-6 w-2/3" />
            <PulseBlock className="h-2 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

/* history:模拟列表(5-6 行表格占位) */
function HistoryVariant({ className }: { className: string }) {
  return (
    <div className={className}>
      {/* 顶部筛选条 */}
      <div className="flex items-center gap-3">
        <PulseBlock className="h-10 flex-1" />
        <PulseBlock className="h-10 w-32" />
        <PulseBlock className="h-10 w-24" />
      </div>

      {/* 列表表头 */}
      <div className="bg-rice-50 border border-ink-900/6 rounded-md p-4">
        <div className="flex items-center gap-4 pb-3 border-b border-ink-900/6">
          <PulseBlock className="h-4 w-24" />
          <PulseBlock className="h-4 w-32" />
          <PulseBlock className="h-4 w-16" />
          <PulseBlock className="h-4 w-20" />
          <PulseBlock className="h-4 w-12 ml-auto" />
        </div>
        {/* 6 行表格占位 */}
        <div className="divide-y divide-ink-900/4">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex items-center gap-4 py-3.5">
              <PulseBlock className="w-12 h-12 rounded-md flex-shrink-0" />
              <div className="flex-1 space-y-2">
                <PulseBlock className="h-3 w-1/3" />
                <PulseBlock className="h-3 w-1/2" />
              </div>
              <PulseBlock className="h-6 w-14 rounded-full" />
              <PulseBlock className="h-3 w-20" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* analysis:上传区 + 表单字段占位 */
function AnalysisVariant({ className }: { className: string }) {
  return (
    <div className={className}>
      {/* 标题区 */}
      <div className="space-y-2">
        <PulseBlock className="h-7 w-40" />
        <PulseBlock className="h-4 w-72" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* 左侧:上传区(占 3 列) */}
        <div className="lg:col-span-3 bg-rice-50 border border-ink-900/6 rounded-md p-8 space-y-4">
          <PulseBlock className="aspect-[4/3] w-full" />
          <div className="flex items-center justify-center gap-2">
            <PulseBlock className="h-8 w-32" />
            <PulseBlock className="h-8 w-24" />
          </div>
        </div>

        {/* 右侧:表单字段(占 2 列) */}
        <div className="lg:col-span-2 bg-rice-50 border border-ink-900/6 rounded-md p-6 space-y-5">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="space-y-2">
              <PulseBlock className="h-3 w-20" />
              <PulseBlock className="h-10 w-full" />
            </div>
          ))}
          <PulseBlock className="h-10 w-full mt-2" />
        </div>
      </div>
    </div>
  );
}

/* settings:表单分组(3 组,每组 2-3 个字段) */
function SettingsVariant({ className }: { className: string }) {
  return (
    <div className={className}>
      {/* 标题 */}
      <div className="space-y-2 pb-2">
        <PulseBlock className="h-7 w-32" />
        <PulseBlock className="h-4 w-56" />
      </div>

      {/* 3 组表单分组 */}
      {[0, 1, 2].map((groupIdx) => (
        <div key={groupIdx} className="bg-rice-50 border border-ink-900/6 rounded-md p-6 space-y-4">
          {/* 分组标题 */}
          <PulseBlock className="h-4 w-28" />
          {/* 每组 2-3 个字段 */}
          <div className="space-y-4">
            {Array.from({ length: groupIdx === 1 ? 3 : 2 }).map((_, fieldIdx) => (
              <div key={fieldIdx} className="space-y-2">
                <PulseBlock className="h-3 w-24" />
                <PulseBlock className="h-10 w-full" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/* -------------------- 列表页骨架 -------------------- */

export interface ListSkeletonProps {
  /** 占位卡片数量,限制在 3-5 之间,默认 4 */
  count?: number;
  /** 容器额外类名 */
  className?: string;
}

/**
 * 列表页骨架:每条占位 = 图标圆 + 两行文字。
 * 适用于历史记录、消息列表等纵向条目场景。
 */
export function ListSkeleton({ count = 4, className = '' }: ListSkeletonProps) {
  const safeCount = Math.min(Math.max(count, 3), 5);
  const items = Array.from({ length: safeCount }, (_, i) => i);
  return (
    <>
      <SkeletonStyle />
      <div
        className={`space-y-3 ${className}`}
        role="status"
        aria-live="polite"
        aria-label="列表加载中"
      >
        {items.map((i) => (
          <div
            key={i}
            className="flex items-center gap-3 bg-rice-50 border border-ink-900/6 rounded-md p-4"
          >
            {/* 图标圆 */}
            <SkeletonBox className="w-10 h-10 rounded-full flex-shrink-0" />
            {/* 两行文字 */}
            <div className="flex-1 space-y-2">
              <SkeletonBox className="h-3 w-1/3" />
              <SkeletonBox className="h-3 w-2/3" />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

/* -------------------- 分析结果骨架 -------------------- */

export interface AnalysisSkeletonProps {
  /** 容器额外类名 */
  className?: string;
}

/**
 * 分析结果骨架:左大图占位 + 右分数圆环占位 + 下方 3 个维度卡片占位。
 * 适用于 AnalysisPage 结果态加载、详情面板加载等场景。
 */
export function AnalysisSkeleton({ className = '' }: AnalysisSkeletonProps) {
  return (
    <>
      <SkeletonStyle />
      <div
        className={`space-y-6 ${className}`}
        role="status"
        aria-live="polite"
        aria-label="分析结果加载中"
      >
        {/* 上:左大图 + 右分数圆环 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <SkeletonBox className="md:col-span-2 aspect-[4/3] w-full" />
          <div className="flex flex-col items-center justify-center gap-4 bg-rice-50 border border-ink-900/6 rounded-md p-6">
            <SkeletonBox className="w-28 h-28 rounded-full" />
            <SkeletonBox className="h-3 w-20" />
          </div>
        </div>

        {/* 下:3 个维度卡片 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="bg-rice-50 border border-ink-900/6 rounded-md p-5 space-y-3"
            >
              <SkeletonBox className="h-8 w-8 rounded-full" />
              <SkeletonBox className="h-3 w-1/2" />
              <SkeletonBox className="h-6 w-2/3" />
              <SkeletonBox className="h-2 w-full" />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

/* -------------------- 通用卡片骨架 -------------------- */

export interface CardSkeletonProps {
  /** 卡片数量,默认 4 */
  count?: number;
  /**
   * 容器布局类名,默认为 4 列响应式网格。
   * 需要单列时传 "grid grid-cols-1 gap-4 max-w-2xl" 等。
   */
  className?: string;
}

/**
 * 通用卡片骨架:用于 HistoryPage、MaterialsPage、GrowthPage 等。
 * 每张卡片含图标块 + 标题 + 数值 + 进度条占位。
 */
export function CardSkeleton({
  count = 4,
  className = 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4',
}: CardSkeletonProps) {
  const items = Array.from({ length: count }, (_, i) => i);
  return (
    <>
      <SkeletonStyle />
      <div
        className={className}
        role="status"
        aria-live="polite"
        aria-label="内容加载中"
      >
        {items.map((i) => (
          <div
            key={i}
            className="bg-rice-50 border border-ink-900/6 rounded-md p-5 space-y-3"
          >
            <SkeletonBox className="h-8 w-8 rounded-full" />
            <SkeletonBox className="h-3 w-1/2" />
            <SkeletonBox className="h-6 w-2/3" />
            <SkeletonBox className="h-2 w-full" />
          </div>
        ))}
      </div>
    </>
  );
}
