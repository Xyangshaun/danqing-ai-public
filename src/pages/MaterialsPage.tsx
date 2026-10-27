import { useState, useMemo, useEffect, useCallback, useRef, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Filter, X, ExternalLink, Heart, Download, Grid3X3, List, Globe, RefreshCw, Tag, ChevronDown, Check, Loader2, ImageOff, ChevronUp, Sparkles, Package, PackagePlus, Trash2, Scissors, Gem, Scroll, Flower2, Theater, Network, Hammer, Hand, Palette, Bookmark } from 'lucide-react';
import { loadBuiltinArtworks, getFilterCounts, resolveArtworkThumbUrl, resolveArtworkFallbackUrl, type ArtworkItem, type FilterCounts } from '../services/artworksDatabase';
import {
  loadHeritageWorks,
  filterHeritageByCategory,
  HERITAGE_CATEGORY_LABEL,
  HERITAGE_SUBCATEGORY_OPTIONS,
  resolveHeritageThumb,
  resolveHeritageFull,
  type HeritageWork,
  type HeritageSubCategory,
  type HeritageProtectionInfo,
  type HeritageInheritor,
  type HeritageProcessStep,
} from '../services/heritageDatabase';
import type { LucideIcon } from 'lucide-react';
import { useToast } from '../components/ToastProvider';
import { getFavorites, toggleFavorite as toggleFavoriteService } from '../services/data-service';
import {
  getPacks,
  createPack,
  deletePack,
  addToPack,
  resolvePackMaterials,
  type MaterialPack,
  type UnifiedMaterial,
} from '../services/materialService';
import { SkeletonBox } from '../components/PageSkeleton';
import EmptyState from '../components/EmptyState';
import { useLazyImage } from '../hooks/useLazyImage';
import { useArtworkImage } from '../hooks/useArtworkImage';
import { useDebounce } from '../hooks/useDebounce';
import { useMasonryColumnCount } from '../hooks/useMasonryColumns';

const categoryNames: Record<string, string> = {
  painting: '绘画',
  design: '设计',
  product: '产品设计',
  sculpture: '雕塑',
  calligraphy: '书法',
  architecture: '建筑',
  heritage: '非遗',
};

const regionNames: Record<string, string> = {
  china: '中国',
  'east-asia': '东亚',
  europe: '欧洲',
  america: '美洲',
  other: '其他',
};

/** 非遗二级类目图标(gold 系配色,与文化感一致) */
const HERITAGE_CATEGORY_ICON: Record<HeritageSubCategory, LucideIcon> = {
  papercut: Scissors,
  embroidery: Sparkles,
  porcelain: Gem,
  nianhua: Flower2,
  shadowpuppet: Theater,
  weaving: Network,
  woodcarving: Hammer,
  clay: Hand,          // 泥塑·手工塑形
  lacquer: Palette,    // 漆器·髹漆调色
  thangka: Bookmark,   // 唐卡·卷轴/梵夹装(Bookmark 抽象卷轴)
};

/* ============================================================
 * 非遗分析案例 mock(Task 19):完整流程静态展示
 * 用户上传剪纸 → 4 非遗维度评分 → AI 画面解析 → 优化建议
 * ============================================================ */
interface HeritageCaseDimension {
  name: string;
  score: number;
  comment: string;
}
interface HeritageCaseMock {
  workTitle: string;
  category: HeritageSubCategory;
  uploadHint: string;
  dimensions: HeritageCaseDimension[];
  visualAnalysis: string;
  suggestions: string[];
}
const HERITAGE_CASE_MOCK: HeritageCaseMock = {
  workTitle: '凤翔团花剪纸',
  category: 'papercut',
  uploadHint: '用户上传一张团花剪纸作品',
  dimensions: [
    { name: '工艺技法', score: 88, comment: '阴剪与阳剪结合熟练,锯齿纹匀称,圆如秋月,刀工到位' },
    { name: '造型纹样', score: 82, comment: '八瓣放射对称构图饱满,团花结构完整,瑞兽纹样寓意吉祥' },
    { name: '材质表现', score: 79, comment: '大红单色对比强烈,但纸张层次与透光感表现可更丰富' },
    { name: '文化传承', score: 85, comment: '西北民俗气息浓郁,传统符号运用得当,地域特征鲜明' },
  ],
  visualAnalysis:
    '画面呈中心对称团花结构,八瓣放射式布局层层外扩;以阴剪勾勒瑞兽与花叶轮廓、阳剪留实,锯齿纹与月牙纹交替形成节奏韵律;大红底色衬托喜庆民俗氛围,负形与正形互衬,虚实相生。',
  suggestions: [
    '技法精进:锯齿纹可进一步追求"尖如麦芒、匀如麦穗",提升刀工精度与节奏一致性',
    '纹样层次:团花中心可增加一层芯饰,避免视觉重心过于扁平,增强纵深感',
    '创新嫁接:尝试融入现代极简留白与几何分割,平衡传统繁复与当代审美(可前往灵感嫁接体验)',
  ],
};

/* ============================================================
 * ArtworkCard / ArtworkRow — 素材卡片(memo + useLazyImage)
 *
 * 提取为独立组件以:
 *   1. 通过 React.memo 跳过未变化卡片的重渲染(筛选/收藏切换时仅重渲染变化项)
 *   2. 使用 useLazyImage 实现图片懒加载(IntersectionObserver + 占位图)
 *   3. 图片加载失败时显示 ImageOff 占位,加载中显示骨架屏
 * ============================================================ */

interface ArtworkCardProps {
  artwork: ArtworkItem;
  isFavorite: boolean;
  onSelect: (artwork: ArtworkItem) => void;
  onSendToFuse: (artwork: ArtworkItem) => void;
  onPickPack: (artwork: ArtworkItem) => void;
  onToggleFavorite: (id: string) => void;
  /** 紧凑模式:用于详情弹窗「相关推荐」小卡片,缩小尺寸/字号并隐藏标签行 */
  compact?: boolean;
  /** 首屏直出:跳过懒加载观察,立即加载(用于首屏可见的前 N 张) */
  eager?: boolean;
}

/* ============================================================
 * 网格视图卡片(Pinterest 风格瀑布流)
 *
 * 设计要点(任务 Pinterest 改造):
 *   1. 图片按自然宽高比显示(w-full h-auto),不固定 aspect,
 *      配合外层 CSS columns 实现真正的瀑布流
 *   2. 悬停时叠加渐变遮罩 + 完整标题/艺术家/年份 + 前 3 个标签
 *   3. 右上角悬浮操作按钮组(收藏/嫁接/入包),backdrop-blur 玻璃质感
 *   4. 卡片圆角 + 阴影,鼠标悬停轻微上浮(translateY(-4px))
 *   5. compact 模式供相关推荐复用,缩小尺寸但保持交互一致
 *   6. 触屏设备(hover:none)下遮罩常驻显示,保证信息可达
 * ============================================================ */
const ArtworkCard = memo(function ArtworkCard({
  artwork,
  isFavorite,
  onSelect,
  onSendToFuse,
  onPickPack,
  onToggleFavorite,
  compact = false,
  eager = false,
}: ArtworkCardProps) {
  const artworkImageUrl = useArtworkImage(artwork, 'thumb');
  const artworkFallbackUrl = useMemo(() => resolveArtworkFallbackUrl(artwork), [artwork]);
  const { imgRef, loadedSrc, isLoaded, isError } = useLazyImage(artworkImageUrl, { eager, fallbackSrc: artworkFallbackUrl });
  // 自然宽高比:缩略图为保比例生成(宽640高自适应),容器按 thumbW/thumbH 定比例,
  // img object-cover 恰好铺满 → 无裁剪、无白边、无 CLS;缺尺寸信息时回退 16:9
  const aspectRatio = artwork.thumbW && artwork.thumbH
    ? `${artwork.thumbW} / ${artwork.thumbH}`
    : '16 / 9';

  return (
    <div
      className={`break-inside-avoid bg-rice-50 overflow-hidden shadow-card hover:shadow-card-hover transition-all duration-300 hover:-translate-y-1 group cursor-pointer ${
        compact ? 'rounded-lg mb-2' : 'rounded-xl mb-4'
      }`}
      onClick={() => onSelect(artwork)}
    >
      {/* 图片容器:按缩略图自然宽高比(aspect-ratio),img object-cover 铺满,
          占位/加载/兜底全程零布局跳动 */}
      <div className="relative bg-ink-100 overflow-hidden" style={{ aspectRatio }}>
        {!isLoaded && !isError && (
          <SkeletonBox className="absolute inset-0 z-10" />
        )}
        {isError ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-rice-100">
            <ImageOff className={`${compact ? 'w-6 h-6' : 'w-10 h-10'} text-ink-300 mb-2`} />
            <p className="text-xs text-ink-400">加载失败</p>
          </div>
        ) : (
          <img
            ref={imgRef}
            src={loadedSrc}
            alt={artwork.title}
            loading={eager ? 'eager' : 'lazy'}
            className={`absolute inset-0 w-full h-full object-cover transition-all duration-500 ${
              isLoaded ? 'opacity-100 group-hover:scale-105' : 'opacity-0'
            }`}
          />
        )}

        {/* Pinterest 风格悬停渐变遮罩 */}
        <div className="absolute inset-0 bg-gradient-to-t from-ink-900/85 via-ink-900/25 to-transparent opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity duration-300 pointer-events-none" />

        {/* 左上角分类徽章(常驻可见) */}
        <div className="absolute top-2 left-2 flex gap-1.5 z-10">
          <span className={`px-1.5 py-0.5 bg-cinnabar/90 text-white rounded-full ${compact ? 'text-2xs' : 'text-xs'}`}>
            {categoryNames[artwork.category] || artwork.category}
          </span>
        </div>

        {/* 右上角悬浮操作按钮组 */}
        <div className="absolute top-2 right-2 flex flex-col gap-1.5 z-20 opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity duration-300">
          <button
            onClick={(e) => { e.stopPropagation(); onToggleFavorite(artwork.id); }}
            aria-label={isFavorite ? '取消收藏' : '收藏'}
            aria-pressed={isFavorite}
            title={isFavorite ? '取消收藏' : '收藏'}
            className={`rounded-full backdrop-blur-md bg-white/25 text-white hover:bg-cinnabar/90 transition-colors ${compact ? 'p-1' : 'p-1.5'}`}
          >
            <Heart className={`${compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} ${isFavorite ? 'fill-white' : ''}`} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onSendToFuse(artwork); }}
            aria-label="用于嫁接"
            title="用于嫁接"
            className={`rounded-full backdrop-blur-md bg-white/25 text-white hover:bg-cinnabar/90 transition-colors ${compact ? 'p-1' : 'p-1.5'}`}
          >
            <Sparkles className={compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onPickPack(artwork); }}
            aria-label="加入素材包"
            title="加入素材包"
            className={`rounded-full backdrop-blur-md bg-white/25 text-white hover:bg-cinnabar/90 transition-colors ${compact ? 'p-1' : 'p-1.5'}`}
          >
            <PackagePlus className={compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
          </button>
        </div>

        {/* 底部信息:完整标题/艺术家/年份 + 前 3 个标签(悬停显示) */}
        <div className={`absolute inset-x-0 bottom-0 z-10 opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity duration-300 ${compact ? 'p-2' : 'p-3'}`}>
          <h3 className={`font-serif font-bold text-white line-clamp-2 drop-shadow-sm ${compact ? 'text-sm' : 'text-base'}`}>
            {artwork.title}
          </h3>
          <p className={`text-white/85 mt-0.5 truncate ${compact ? 'text-2xs' : 'text-xs'}`}>
            {artwork.artist} · {artwork.year}
          </p>
          {!compact && (
            <div className="flex gap-1 flex-wrap mt-1.5">
              {artwork.tags.slice(0, 3).map((tag) => (
                <span key={tag} className="px-1.5 py-0.5 bg-white/25 backdrop-blur-sm text-white text-2xs rounded-full">
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

/* 列表视图行卡片 */
const ArtworkRow = memo(function ArtworkRow({
  artwork,
  isFavorite,
  onSelect,
  onSendToFuse,
  onPickPack,
  onToggleFavorite,
  eager = false,
}: ArtworkCardProps) {
  const artworkImageUrl = useArtworkImage(artwork, 'thumb');
  const artworkFallbackUrl = useMemo(() => resolveArtworkFallbackUrl(artwork), [artwork]);
  const { imgRef, loadedSrc, isLoaded, isError } = useLazyImage(artworkImageUrl, { eager, fallbackSrc: artworkFallbackUrl });

  return (
    <div
      className="bg-rice-50 rounded-2xl overflow-hidden shadow-card hover:shadow-card-hover transition-all cursor-pointer flex"
      onClick={() => onSelect(artwork)}
    >
      <div className="w-48 h-36 flex-shrink-0 overflow-hidden bg-ink-100 relative">
        {!isLoaded && !isError && (
          <SkeletonBox className="absolute inset-0 z-10" />
        )}
        {isError ? (
          <div className="w-full h-full flex flex-col items-center justify-center">
            <ImageOff className="w-6 h-6 text-ink-300 mb-1" />
            <p className="text-xs text-ink-400">加载失败</p>
          </div>
        ) : (
          <img
            ref={imgRef}
            src={loadedSrc}
            alt={artwork.title}
            loading={eager ? 'eager' : 'lazy'}
            className={`w-full h-full object-cover transition-opacity duration-300 ${
              isLoaded ? 'opacity-100' : 'opacity-0'
            }`}
          />
        )}
      </div>
      <div className="p-4 flex-1">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-serif text-lg font-bold text-ink-900">{artwork.title}</h3>
            <p className="text-sm text-ink-500">{artwork.artist} · {artwork.era} · {artwork.style}</p>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={(e) => { e.stopPropagation(); onSendToFuse(artwork); }}
              aria-label="用于嫁接"
              className="p-1.5 rounded-full hover:bg-cinnabar/10 hover:text-cinnabar text-ink-400 transition-all"
              title="用于嫁接"
            >
              <Sparkles className="w-4 h-4" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onPickPack(artwork); }}
              aria-label="加入素材包"
              className="p-1.5 rounded-full hover:bg-cinnabar/10 hover:text-cinnabar text-ink-400 transition-all"
              title="加入素材包"
            >
              <PackagePlus className="w-4 h-4" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onToggleFavorite(artwork.id); }}
              className="p-1.5 rounded-full hover:bg-rice-100 transition-all"
              aria-label={isFavorite ? '取消收藏' : '收藏'}
              aria-pressed={isFavorite}
            >
              <Heart className={`w-4 h-4 ${isFavorite ? 'text-cinnabar fill-cinnabar' : 'text-ink-400'}`} />
            </button>
          </div>
        </div>
        <p className="text-sm text-ink-600 mt-2 line-clamp-2">{artwork.description}</p>
        <div className="flex gap-2 mt-3 flex-wrap">
          {artwork.tags.slice(0, 5).map((tag) => (
            <span key={tag} className="px-2 py-0.5 bg-rice-100 text-xs rounded-full text-ink-600">{tag}</span>
          ))}
        </div>
      </div>
    </div>
  );
});

/* ============================================================
 * HeritageCard — 非遗素材卡片(gold 系配色,memo)
 * 展示:title + 类目图标 + dynasty + origin + craftFeature(截断) + techniquePoints 标签
 * ============================================================ */
interface HeritageCardProps {
  work: HeritageWork;
  onSelect: (work: HeritageWork) => void;
  /** 首屏直出:跳过懒加载观察,立即加载真实图片 */
  eager?: boolean;
}

const HeritageCard = memo(function HeritageCard({ work, onSelect, eager = false }: HeritageCardProps) {
  const Icon = HERITAGE_CATEGORY_ICON[work.category];
  const thumbUrl = useMemo(() => resolveHeritageThumb(work), [work]);
  // fallback: 类目色带 + 图标(原图)，加载失败时显示
  const { imgRef, loadedSrc, isLoaded, isError } = useLazyImage(thumbUrl, { eager });

  return (
    <button
      onClick={() => onSelect(work)}
      className="group text-left bg-rice-50 rounded-xl overflow-hidden shadow-card hover:shadow-card-hover transition-all duration-300 hover:-translate-y-1 border border-gold/20 hover:border-gold/50"
    >
      {/* 顶部:真实图片 + 加载骨架 + fallback 类目色带/图标 */}
      <div className="relative h-40 bg-gradient-to-br from-gold/15 via-gold/5 to-rice-100 overflow-hidden">
        {/* 骨架屏(加载中显示) */}
        {!isLoaded && !isError && (
          <SkeletonBox className="absolute inset-0 z-10" />
        )}

        {/* 真实图片层(优先展示) */}
        {!isError && (
          <img
            ref={imgRef}
            src={loadedSrc}
            alt={work.title}
            loading={eager ? 'eager' : 'lazy'}
            className={`absolute inset-0 w-full h-full object-cover transition-all duration-500 ${
              isLoaded ? 'opacity-100 group-hover:scale-105' : 'opacity-0'
            }`}
          />
        )}

        {/* Fallback: 加载失败显示类目图标(与原图一致的 gold 系色带) */}
        {isError && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="absolute inset-0 opacity-30" style={{ backgroundImage: 'radial-gradient(circle at 30% 40%, rgba(212,175,55,0.25), transparent 60%)' }} />
            <Icon className="w-12 h-12 text-gold-dark relative z-10 group-hover:scale-110 transition-transform duration-300" />
          </div>
        )}

        {/* 常驻徽章(左:类目 右:年代) */}
        <span className="absolute top-2 left-2 px-2 py-0.5 bg-gold-dark/90 text-white text-2xs rounded-full z-20 shadow-sm">
          {HERITAGE_CATEGORY_LABEL[work.category]}
        </span>
        <span className="absolute top-2 right-2 px-2 py-0.5 bg-ink-900/70 text-rice-100 text-2xs rounded-full z-20 shadow-sm">{work.dynasty}</span>

        {/* 图片渐暗遮罩(悬停时加深,提升标签对比度) */}
        {!isError && isLoaded && (
          <div className="absolute inset-0 bg-gradient-to-t from-ink-900/30 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none z-10" />
        )}
      </div>
      <div className="p-3">
        <h3 className="font-serif text-base font-bold text-ink-900 truncate">{work.title}</h3>
        <p className="text-xs text-ink-500 mt-0.5 flex items-center gap-1">
          <Globe className="w-3 h-3" />
          {work.origin}
        </p>
        <p className="text-xs text-ink-600 mt-2 line-clamp-2 leading-relaxed">{work.craftFeature}</p>
        <div className="flex gap-1.5 mt-2.5 flex-wrap">
          {work.techniquePoints.slice(0, 3).map((pt) => (
            <span key={pt} className="px-1.5 py-0.5 bg-gold/10 text-gold-dark text-2xs rounded-full border border-gold/20">{pt}</span>
          ))}
        </div>
      </div>
    </button>
  );
});

/* ============================================================
 * HeritageDetailModal — 非遗详情弹窗(V3 全字段)
 * 顶部:大尺寸真实图片(full) + fallback
 * 内容区:13 组字段(原 5 + 新增 8 组 V3 专业维度)
 * ============================================================ */
interface HeritageDetailModalProps {
  work: HeritageWork;
  onClose: () => void;
}

function HeritageDetailModal({ work, onClose }: HeritageDetailModalProps) {
  const Icon = HERITAGE_CATEGORY_ICON[work.category];
  const fullUrl = useMemo(() => resolveHeritageFull(work), [work]);
  const { imgRef, loadedSrc, isLoaded, isError } = useLazyImage(fullUrl, { eager: true });

  // 保护级别中文标签
  const PROTECTION_LEVEL_LABEL: Record<NonNullable<HeritageProtectionInfo['level']>, string> = {
    humanity: '联合国人类非遗代表作',
    national: '国家级非遗',
    provincial: '省级非遗',
    municipal: '市级非遗',
    county: '县级非遗',
  };

  return (
    <div
      className="fixed inset-0 bg-ink-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-rice-50 rounded-2xl overflow-hidden max-w-3xl w-full max-h-[92vh] flex flex-col border border-gold/30 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏(gold 系) */}
        <div className="flex items-center justify-between px-5 py-4 bg-gradient-to-r from-gold/15 to-transparent border-b border-gold/20 shrink-0">
          <div className="flex items-center gap-3">
            <Icon className="w-6 h-6 text-gold-dark shrink-0" />
            <div>
              <h2 className="font-serif text-xl font-bold text-ink-900 leading-tight">{work.title}</h2>
              <p className="text-xs text-ink-500 mt-0.5">
                {HERITAGE_CATEGORY_LABEL[work.category]} · {work.dynasty} · {work.origin}
              </p>
            </div>
          </div>
          <button onClick={onClose} aria-label="关闭" className="p-2 hover:bg-rice-100 rounded-full transition-all shrink-0">
            <X className="w-5 h-5 text-ink-700" />
          </button>
        </div>

        {/* 内容区(可滚动) */}
        <div className="overflow-y-auto flex-1">
          {/* 一、顶部大图区(full 尺寸 + fallback) */}
          <div className="relative w-full aspect-[4/3] bg-gradient-to-br from-gold/15 via-gold/5 to-rice-100 overflow-hidden">
            {!isLoaded && !isError && <SkeletonBox className="absolute inset-0 z-10" />}
            {!isError && (
              <img
                ref={imgRef}
                src={loadedSrc}
                alt={work.title}
                className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-700 ${
                  isLoaded ? 'opacity-100' : 'opacity-0'
                }`}
              />
            )}
            {isError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <div className="absolute inset-0 opacity-30" style={{ backgroundImage: 'radial-gradient(circle at 40% 30%, rgba(212,175,55,0.3), transparent 60%)' }} />
                <Icon className="w-20 h-20 text-gold-dark relative z-10 mb-3 opacity-80" />
                <p className="text-sm text-ink-500 relative z-10">真实图片整理中 · 稍后上线</p>
              </div>
            )}
            {/* 左上·保护级别徽章 */}
            {work.protection?.level && (
              <span className={`absolute top-3 left-3 px-3 py-1 rounded-full text-xs font-medium z-20 shadow-md ${
                work.protection.level === 'humanity' ? 'bg-purple-700/90 text-white' :
                work.protection.level === 'national' ? 'bg-cinnabar/90 text-white' :
                work.protection.level === 'provincial' ? 'bg-gold-dark/90 text-white' :
                'bg-ink-700/80 text-rice-100'
              }`}>
                {PROTECTION_LEVEL_LABEL[work.protection.level]}
              </span>
            )}
          </div>

          {/* 二、正文字段区 */}
          <div className="p-5 md:p-6 space-y-5">
            {/* 1. 保护体系(对齐 ihchina.cn) */}
            {work.protection && (
              <section className="bg-gradient-to-r from-cinnabar/5 via-transparent to-transparent rounded-xl p-4 border border-cinnabar/15">
                <h3 className="text-sm font-bold text-ink-800 mb-2.5 flex items-center gap-2">
                  <span className="w-1 h-4 bg-cinnabar rounded-full" />
                  保护体系 · 名录信息
                </h3>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <div className="flex gap-2"><dt className="text-ink-500 shrink-0 w-20">保护级别</dt><dd className="text-ink-800 font-medium">{PROTECTION_LEVEL_LABEL[work.protection.level]}</dd></div>
                  {work.protection.nationalBatch && <div className="flex gap-2"><dt className="text-ink-500 shrink-0 w-20">名录批次</dt><dd className="text-ink-800">{work.protection.nationalBatch}</dd></div>}
                  {work.protection.humanityNote && <div className="flex gap-2 sm:col-span-2"><dt className="text-ink-500 shrink-0 w-20">人类非遗</dt><dd className="text-ink-800">{work.protection.humanityNote}</dd></div>}
                  {work.protection.declaredRegion && <div className="flex gap-2"><dt className="text-ink-500 shrink-0 w-20">申报地区</dt><dd className="text-ink-800">{work.protection.declaredRegion}</dd></div>}
                  {work.protection.protectionUnit && <div className="flex gap-2"><dt className="text-ink-500 shrink-0 w-20">保护单位</dt><dd className="text-ink-800">{work.protection.protectionUnit}</dd></div>}
                </dl>
              </section>
            )}

            {/* 2. 历史溯源 */}
            <section>
              <h3 className="text-sm font-bold text-ink-800 mb-2 flex items-center gap-2">
                <span className="w-1 h-4 bg-gold-dark rounded-full" />历史溯源
              </h3>
              <p className="text-sm text-ink-600 leading-relaxed whitespace-pre-line">{work.history}</p>
            </section>

            {/* 3. 工艺特征 */}
            <section>
              <h3 className="text-sm font-bold text-ink-800 mb-2 flex items-center gap-2">
                <span className="w-1 h-4 bg-cinnabar rounded-full" />工艺特征
              </h3>
              <p className="text-sm text-ink-600 leading-relaxed whitespace-pre-line">{work.craftFeature}</p>
            </section>

            {/* 4. 代表作品(高亮卡片) */}
            <section className="bg-rice-100 rounded-xl p-4 border border-gold/20">
              <p className="text-xs text-ink-500 mb-1 tracking-wide">代表作品 · Representative Work</p>
              <p className="text-sm font-semibold text-ink-800 leading-relaxed">{work.representativeWork}</p>
            </section>

            {/* 5. 传承人(V3 新增) */}
            {work.inheritors && work.inheritors.length > 0 && (
              <section>
                <h3 className="text-sm font-bold text-ink-800 mb-2.5 flex items-center gap-2">
                  <span className="w-1 h-4 bg-jade rounded-full" />传承人名录
                </h3>
                <div className="space-y-2.5">
                  {work.inheritors.map((inh: HeritageInheritor) => (
                    <div key={inh.name} className="bg-jade/5 rounded-lg p-3 border border-jade/20">
                      <div className="flex items-baseline gap-2 mb-1">
                        <span className="font-serif font-bold text-ink-900">{inh.name}</span>
                        <span className="text-xs text-ink-500">· {inh.lifespan}</span>
                        <span className="ml-auto text-xs px-2 py-0.5 bg-jade/20 text-jade-800 rounded-full">第{inh.generation}代</span>
                      </div>
                      <p className="text-xs text-ink-700 mb-1"><span className="text-ink-500">认定：</span>{inh.level}</p>
                      {inh.masterpieces && <p className="text-xs text-ink-600"><span className="text-ink-500">代表作：</span>{inh.masterpieces}</p>}
                      {inh.lineage && <p className="text-xs text-ink-600 mt-0.5"><span className="text-ink-500">师承：</span>{inh.lineage}</p>}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* 6. 材料与工具清单(V3 新增) */}
            {work.materialsTools && (
              <section>
                <h3 className="text-sm font-bold text-ink-800 mb-2.5 flex items-center gap-2">
                  <span className="w-1 h-4 bg-stone rounded-full" />材料与工具
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {work.materialsTools.primaryMaterials.length > 0 && (
                    <div className="bg-rice-100 rounded-lg p-3 border border-gold/15">
                      <p className="text-xs font-medium text-gold-dark mb-1.5">主材</p>
                      <ul className="space-y-0.5">
                        {work.materialsTools.primaryMaterials.map((m) => (
                          <li key={m} className="text-xs text-ink-700 leading-snug pl-2 border-l-2 border-gold/30">{m}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {work.materialsTools.auxiliaryMaterials.length > 0 && (
                    <div className="bg-rice-100 rounded-lg p-3 border border-gold/15">
                      <p className="text-xs font-medium text-cinnabar mb-1.5">辅材</p>
                      <ul className="space-y-0.5">
                        {work.materialsTools.auxiliaryMaterials.map((m) => (
                          <li key={m} className="text-xs text-ink-700 leading-snug pl-2 border-l-2 border-cinnabar/30">{m}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {work.materialsTools.tools.length > 0 && (
                    <div className="bg-rice-100 rounded-lg p-3 border border-gold/15">
                      <p className="text-xs font-medium text-stone-700 mb-1.5">工具</p>
                      <ul className="space-y-0.5">
                        {work.materialsTools.tools.map((t) => (
                          <li key={t} className="text-xs text-ink-700 leading-snug pl-2 border-l-2 border-stone/30">{t}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* 7. 工艺工序步骤(V3 新增) */}
            {work.processSteps && work.processSteps.length > 0 && (
              <section>
                <h3 className="text-sm font-bold text-ink-800 mb-2.5 flex items-center gap-2">
                  <span className="w-1 h-4 bg-cinnabar rounded-full" />工艺工序
                </h3>
                <ol className="space-y-2">
                  {work.processSteps.map((step: HeritageProcessStep) => (
                    <li key={step.stepNo} className={`relative pl-9 ${step.isCore ? 'bg-cinnabar/5 rounded-lg p-3 -ml-3 -mr-3 border border-cinnabar/15' : ''}`}>
                      <span className={`absolute left-0 top-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                        step.isCore ? 'bg-cinnabar text-white shadow-sm' : 'bg-gold/20 text-gold-dark'
                      }`}>
                        {step.stepNo}
                      </span>
                      <p className={`text-sm font-medium ${step.isCore ? 'text-cinnabar-900' : 'text-ink-800'}`}>
                        {step.name}
                        {step.isCore && <span className="ml-2 text-xs font-normal text-cinnabar/80">· 核心工序</span>}
                      </p>
                      <p className="text-xs text-ink-600 mt-0.5 leading-relaxed">{step.description}</p>
                    </li>
                  ))}
                </ol>
              </section>
            )}

            {/* 8. 图像志·造型与母题(V3 新增) */}
            {work.iconography && (
              <section className="bg-gradient-to-br from-gold/5 via-rice-100/50 to-transparent rounded-xl p-4 border border-gold/20">
                <h3 className="text-sm font-bold text-ink-800 mb-2.5 flex items-center gap-2">
                  <span className="w-1 h-4 bg-gold rounded-full" />图像志 · 造型与母题
                </h3>
                <div className="space-y-2.5 text-sm">
                  <p className="text-ink-700"><span className="text-ink-500 font-medium w-16 inline-block shrink-0">造型体系</span>{work.iconography.formSystem}</p>
                  <p className="text-ink-700"><span className="text-ink-500 font-medium w-16 inline-block shrink-0">构图范式</span>{work.iconography.composition}</p>
                  {work.iconography.sketchSource && <p className="text-ink-700"><span className="text-ink-500 font-medium w-16 inline-block shrink-0">粉本出处</span>{work.iconography.sketchSource}</p>}
                  <div>
                    <p className="text-ink-500 font-medium mb-1.5">核心图像母题</p>
                    <div className="space-y-1.5">
                      {work.iconography.motifs.map((m, i) => (
                        <div key={i} className="flex gap-2 text-xs">
                          <span className="px-2 py-0.5 bg-cinnabar/15 text-cinnabar rounded-full shrink-0 font-medium">{m.motif}</span>
                          <span className="text-ink-600 leading-snug">{m.semantics}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </section>
            )}

            {/* 9. 民俗功能与使用场域(V3 新增) */}
            {work.folkUsage && (
              <section>
                <h3 className="text-sm font-bold text-ink-800 mb-2.5 flex items-center gap-2">
                  <span className="w-1 h-4 bg-jade rounded-full" />民俗功能 · 使用场域
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="bg-jade/5 rounded-lg p-3 border border-jade/15">
                    <p className="text-xs font-medium text-jade-800 mb-1">岁时节令</p>
                    <p className="text-xs text-ink-700 leading-relaxed">{work.folkUsage.festivals}</p>
                  </div>
                  <div className="bg-jade/5 rounded-lg p-3 border border-jade/15">
                    <p className="text-xs font-medium text-jade-800 mb-1">空间场域</p>
                    <p className="text-xs text-ink-700 leading-relaxed">{work.folkUsage.spaces}</p>
                  </div>
                  <div className="bg-jade/5 rounded-lg p-3 border border-jade/15">
                    <p className="text-xs font-medium text-jade-800 mb-1">社会功能</p>
                    <p className="text-xs text-ink-700 leading-relaxed">{work.folkUsage.socialFunctions}</p>
                  </div>
                </div>
                {work.folkUsage.constraints && (
                  <p className="mt-2 text-xs text-ink-500 bg-ink-900/5 rounded-lg p-2 border border-ink-900/10">
                    <span className="font-medium text-ink-700">形制约束：</span>{work.folkUsage.constraints}
                  </p>
                )}
              </section>
            )}

            {/* 10. 鉴赏要点(美院四维法)(V3 新增) */}
            {work.appreciation && (
              <section className="bg-gradient-to-r from-stone/5 via-transparent to-transparent rounded-xl p-4 border border-stone/15">
                <h3 className="text-sm font-bold text-ink-800 mb-3 flex items-center gap-2">
                  <span className="w-1 h-4 bg-stone rounded-full" />鉴赏要点 · 美院四维法
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs font-semibold text-stone-700 mb-1">章法 · 构图经营</p>
                    <p className="text-xs text-ink-600 leading-relaxed">{work.appreciation.composition}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-stone-700 mb-1">骨法 · 线质刀痕</p>
                    <p className="text-xs text-ink-600 leading-relaxed">{work.appreciation.brushwork}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-stone-700 mb-1">随类 · 色彩釉色</p>
                    <p className="text-xs text-ink-600 leading-relaxed">{work.appreciation.color}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-stone-700 mb-1">材质 · 肌理地子</p>
                    <p className="text-xs text-ink-600 leading-relaxed">{work.appreciation.material}</p>
                  </div>
                </div>
              </section>
            )}

            {/* 11. 学术与文化价值(V3 新增) */}
            {work.academicValue && (
              <section>
                <h3 className="text-sm font-bold text-ink-800 mb-2.5 flex items-center gap-2">
                  <span className="w-1 h-4 bg-ink-700 rounded-full" />学术与文化价值
                </h3>
                <div className="space-y-2">
                  <div className="flex gap-2 text-sm">
                    <span className="shrink-0 w-20 text-xs font-medium text-purple-700 bg-purple-700/10 rounded px-2 py-0.5 h-fit">造型艺术</span>
                    <p className="text-ink-600 leading-relaxed text-xs">{work.academicValue.artistic}</p>
                  </div>
                  <div className="flex gap-2 text-sm">
                    <span className="shrink-0 w-20 text-xs font-medium text-cinnabar bg-cinnabar/10 rounded px-2 py-0.5 h-fit">社会史</span>
                    <p className="text-ink-600 leading-relaxed text-xs">{work.academicValue.social}</p>
                  </div>
                  <div className="flex gap-2 text-sm">
                    <span className="shrink-0 w-20 text-xs font-medium text-jade-800 bg-jade/15 rounded px-2 py-0.5 h-fit">工艺史</span>
                    <p className="text-ink-600 leading-relaxed text-xs">{work.academicValue.technological}</p>
                  </div>
                  {work.academicValue.modernReinterpretation && (
                    <div className="flex gap-2 text-sm mt-1 bg-gold/5 rounded-lg p-3 border border-gold/15 -m-1">
                      <span className="shrink-0 w-20 text-xs font-medium text-gold-dark bg-gold/20 rounded px-2 py-0.5 h-fit">当代转译</span>
                      <p className="text-ink-700 leading-relaxed text-xs">{work.academicValue.modernReinterpretation}</p>
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* 12. 技法要点(原有) */}
            <section>
              <h3 className="text-sm font-bold text-ink-800 mb-2 flex items-center gap-2">
                <span className="w-1 h-4 bg-stone rounded-full" />技法要点
              </h3>
              <div className="flex flex-wrap gap-2">
                {work.techniquePoints.map((pt) => (
                  <span key={pt} className="px-3 py-1.5 bg-gold/10 text-gold-dark text-sm rounded-full border border-gold/20 font-medium">{pt}</span>
                ))}
              </div>
            </section>

            {/* 13. 标签(原有) */}
            {work.tags.length > 0 && (
              <section>
                <h3 className="text-sm font-bold text-ink-800 mb-2 flex items-center gap-2">
                  <span className="w-1 h-4 bg-jade rounded-full" />标签
                </h3>
                <div className="flex flex-wrap gap-2">
                  {work.tags.map((tag) => (
                    <span key={tag} className="px-3 py-1.5 bg-ink-900/5 text-ink-600 text-sm rounded-full border border-ink-900/10">{tag}</span>
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
 * HeritageCaseShowcase — 非遗分析案例展示(Task 19)
 * 完整流程:上传 → 4 非遗维度评分 → AI 画面解析 → 优化建议(静态 mock)
 * ============================================================ */
function HeritageCaseShowcase() {
  const Icon = HERITAGE_CATEGORY_ICON[HERITAGE_CASE_MOCK.category];
  return (
    <section className="bg-rice-50 rounded-2xl shadow-card border border-gold/25 overflow-hidden mb-6">
      {/* 标题栏 */}
      <div className="flex items-center gap-2 px-5 py-3 bg-gradient-to-r from-gold/15 to-transparent border-b border-gold/20">
        <Scroll className="w-4 h-4 text-gold-dark" />
        <span className="font-serif text-base font-bold text-ink-900">非遗分析案例</span>
        <span className="text-xs text-ink-500">· 完整诊断流程演示</span>
        <span className="ml-auto px-2 py-0.5 bg-gold/15 text-gold-dark text-2xs rounded-full">示例</span>
      </div>

      <div className="p-5 grid md:grid-cols-[auto_1fr] gap-5">
        {/* 左:上传作品占位 */}
        <div className="flex flex-col items-center justify-start">
          <div className="w-32 h-32 rounded-xl bg-gradient-to-br from-gold/20 via-cinnabar/10 to-rice-100 flex items-center justify-center border border-gold/30 relative overflow-hidden">
            <Icon className="w-12 h-12 text-cinnabar" />
            <span className="absolute bottom-1 left-0 right-0 text-center text-2xs text-ink-600 bg-rice-50/80 py-0.5">{HERITAGE_CASE_MOCK.uploadHint}</span>
          </div>
          <p className="font-serif text-sm font-bold text-ink-900 mt-2">{HERITAGE_CASE_MOCK.workTitle}</p>
          <span className="text-2xs text-gold-dark">{HERITAGE_CATEGORY_LABEL[HERITAGE_CASE_MOCK.category]} · 非遗诊断</span>
        </div>

        {/* 右:评分 + 解析 + 建议 */}
        <div className="space-y-4">
          {/* 4 维度评分 */}
          <div>
            <p className="text-xs font-medium text-ink-700 mb-2 flex items-center gap-1.5">
              <span className="w-1 h-3 bg-gold-dark rounded-full" />系统评估 · 4 非遗维度评分
            </p>
            <div className="grid grid-cols-2 gap-2">
              {HERITAGE_CASE_MOCK.dimensions.map((d) => (
                <div key={d.name} className="bg-rice-100 rounded-lg p-2.5 border border-gold/15">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-ink-700">{d.name}</span>
                    <span className={`text-sm font-bold ${d.score >= 85 ? 'text-jade' : d.score >= 80 ? 'text-gold-dark' : 'text-cinnabar'}`}>{d.score}</span>
                  </div>
                  <div className="h-1.5 bg-rice-300 rounded-full overflow-hidden mb-1">
                    <div className={`h-full rounded-full ${d.score >= 85 ? 'bg-jade' : d.score >= 80 ? 'bg-gold' : 'bg-cinnabar'}`} style={{ width: `${d.score}%` }} />
                  </div>
                  <p className="text-2xs text-ink-500 leading-snug line-clamp-2">{d.comment}</p>
                </div>
              ))}
            </div>
          </div>

          {/* AI 画面解析 */}
          <div>
            <p className="text-xs font-medium text-ink-700 mb-1.5 flex items-center gap-1.5">
              <span className="w-1 h-3 bg-cinnabar rounded-full" />深度解读 · AI 画面解析
            </p>
            <p className="text-xs text-ink-600 leading-relaxed bg-rice-100 rounded-lg p-2.5 border border-ink-900/5">{HERITAGE_CASE_MOCK.visualAnalysis}</p>
          </div>

          {/* 优化建议 */}
          <div>
            <p className="text-xs font-medium text-ink-700 mb-1.5 flex items-center gap-1.5">
              <span className="w-1 h-3 bg-stone rounded-full" />优化建议
            </p>
            <ul className="space-y-1">
              {HERITAGE_CASE_MOCK.suggestions.map((s, i) => (
                <li key={i} className="text-xs text-ink-600 flex gap-1.5 leading-relaxed">
                  <span className="text-gold-dark flex-shrink-0">{i + 1}.</span>
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function MaterialsPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [rawSearchQuery, setRawSearchQuery] = useState('');
  // 搜索输入防抖 300ms,降低 9999 条素材上的高频过滤计算
  const searchQuery = useDebounce(rawSearchQuery, 300);
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
  const [selectedStyles, setSelectedStyles] = useState<Set<string>>(new Set());
  const [selectedEras, setSelectedEras] = useState<Set<string>>(new Set());
  const [selectedRegions, setSelectedRegions] = useState<Set<string>>(new Set());
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [selectedArtwork, setSelectedArtwork] = useState<ArtworkItem | null>(null);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [groupBy, setGroupBy] = useState<'none' | 'style' | 'era' | 'region'>('none');
  const [selectedArtists, setSelectedArtists] = useState<Set<string>>(new Set());
  // 各筛选分组统一折叠/展开:默认只显示前N个代表标签,点击展开显示全部
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const toggleSection = useCallback((key: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);
  // 搜索框标签提示下拉
  const [showSuggestions, setShowSuggestions] = useState(false);

  /* ---------- 素材数据状态 ---------- */
  const [artworks, setArtworks] = useState<ArtworkItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  /* ---------- 非遗素材状态(Task 17:heritage 素材库集成) ---------- */
  const [heritageWorks, setHeritageWorks] = useState<HeritageWork[]>([]);
  const [heritageLoading, setHeritageLoading] = useState(true);
  /** 二级类目筛选:全部 / 剪纸 / 刺绣 / 瓷器 */
  const [heritageSubCategory, setHeritageSubCategory] = useState<'all' | HeritageSubCategory>('all');
  /** 非遗详情弹窗选中项 */
  const [selectedHeritage, setSelectedHeritage] = useState<HeritageWork | null>(null);
  /** heritage 模式:选中创作类型中的「非遗」tab 时激活,切换数据源至 heritage-works.json */
  const isHeritageMode = selectedCategories.has('heritage');

  /* ---------- 分页状态(无限滚动:page 递增,visibleArtworks 累积展示) ---------- */
  const PAGE_SIZE = 24;
  const [page, setPage] = useState(1);
  // 无限滚动底部哨兵:IntersectionObserver 监听触底加载下一页
  const sentinelRef = useRef<HTMLDivElement>(null);
  // 详情弹窗右侧滚动容器:切换相关作品时滚回顶部
  const detailScrollRef = useRef<HTMLDivElement>(null);

  // 异步加载内置艺术作品库
  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    loadBuiltinArtworks()
      .then((data) => {
        if (!cancelled) {
          setArtworks(data);
          setIsLoading(false);
        }
      })
      .catch((err) => {
        console.error('加载素材库失败:', err);
        if (!cancelled) setIsLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  // 异步加载非遗素材库(Task 17):与 artworks 加载方式一致,fetch /data/heritage-works.json
  useEffect(() => {
    let cancelled = false;
    setHeritageLoading(true);
    loadHeritageWorks()
      .then((data) => {
        if (!cancelled) {
          setHeritageWorks(data);
          setHeritageLoading(false);
        }
      })
      .catch((err) => {
        console.error('加载非遗素材库失败:', err);
        if (!cancelled) setHeritageLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  /* ---------- 素材包状态 ---------- */
  const [packs, setPacks] = useState<MaterialPack[]>([]);
  const [activePackId, setActivePackId] = useState<string | null>(null);
  const [packMaterials, setPackMaterials] = useState<UnifiedMaterial[]>([]);
  const [showPackPanel, setShowPackPanel] = useState(false);
  const [newPackName, setNewPackName] = useState('');
  const [packPickerArtwork, setPackPickerArtwork] = useState<ArtworkItem | null>(null);

  // 加载素材包列表
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await getPacks();
        if (!cancelled) setPacks(list);
      } catch (err) {
        console.error('加载素材包失败:', err);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // 查看某个素材包内容
  const handleViewPack = useCallback(async (packId: string) => {
    if (activePackId === packId) {
      setActivePackId(null);
      setPackMaterials([]);
      return;
    }
    try {
      const pack = packs.find((p) => p.id === packId);
      if (!pack) return;
      const materials = await resolvePackMaterials(pack);
      setActivePackId(packId);
      setPackMaterials(materials);
    } catch (err) {
      console.error('解析素材包失败:', err);
      toast.error('加载失败', '请稍后重试');
    }
  }, [activePackId, packs, toast]);

  // 创建素材包
  const handleCreatePack = useCallback(async () => {
    const name = newPackName.trim();
    if (!name) {
      toast.warning('请输入素材包名称');
      return;
    }
    try {
      const pack = await createPack({ name });
      setPacks((prev) => [pack, ...prev]);
      setNewPackName('');
      toast.success('素材包已创建', `「${pack.name}」`);
    } catch (err) {
      console.error('创建素材包失败:', err);
      toast.error('创建失败', '请稍后重试');
    }
  }, [newPackName, toast]);

  // 删除素材包
  const handleDeletePack = useCallback(async (packId: string) => {
    try {
      await deletePack(packId);
      setPacks((prev) => prev.filter((p) => p.id !== packId));
      if (activePackId === packId) {
        setActivePackId(null);
        setPackMaterials([]);
      }
      toast.success('素材包已删除');
    } catch (err) {
      console.error('删除素材包失败:', err);
      toast.error('删除失败', '请稍后重试');
    }
  }, [activePackId, toast]);

  // 将作品加入素材包
  const handleAddToPack = useCallback(async (packId: string) => {
    if (!packPickerArtwork) return;
    try {
      const updated = await addToPack(packId, packPickerArtwork.id);
      if (!updated) {
        toast.error('素材包不存在');
        return;
      }
      setPacks((prev) => prev.map((p) => (p.id === packId ? updated : p)));
      toast.success('已加入素材包', `「${updated.name}」`);
      setPackPickerArtwork(null);
    } catch (err) {
      console.error('加入素材包失败:', err);
      toast.error('操作失败', '请稍后重试');
    }
  }, [packPickerArtwork, toast]);

  // 跳转到灵感嫁接页面，携带素材信息 — useCallback 稳定引用,供 memo 化卡片使用
  const handleSendToFuse = useCallback((artwork: ArtworkItem) => {
    toast.info('已选择素材，前往嫁接页面');
    navigate(
      `/fuse?src=material&artworkId=${encodeURIComponent(artwork.id)}&title=${encodeURIComponent(artwork.title)}`
    );
  }, [navigate, toast]);

  // 包内统一素材跳转嫁接:内置作品传 artworkId(保留元数据),我的保存素材传 imageUrl
  const handleSendUnifiedToFuse = useCallback((material: UnifiedMaterial) => {
    toast.info('已选择素材，前往嫁接页面');
    if (material.source === 'builtin') {
      navigate(
        `/fuse?src=material&artworkId=${encodeURIComponent(material.id)}&title=${encodeURIComponent(material.title)}`
      );
    } else {
      navigate(
        `/fuse?src=material&imageUrl=${encodeURIComponent(material.imageUrl)}&title=${encodeURIComponent(material.title)}`
      );
    }
  }, [navigate, toast]);

  const filterOptions = useMemo(() => {
    const categories = new Set<string>();
    const styles = new Set<string>();
    const eras = new Set<string>();
    const regions = new Set<string>();
    const artists = new Set<string>();
    const allTags = new Set<string>();
    artworks.forEach((a) => {
      categories.add(a.category);
      styles.add(a.style);
      eras.add(a.era);
      regions.add(a.region);
      artists.add(a.artist);
      a.tags.forEach((t) => allTags.add(t));
    });
    return {
      categories: Array.from(categories),
      styles: Array.from(styles),
      eras: Array.from(eras),
      regions: Array.from(regions),
      artists: Array.from(artists),
      tags: Array.from(allTags),
    };
  }, [artworks]);

  // 通过内存倒排索引快速获取各维度数量,避免每次渲染扫描 9999 条
  const filterCounts: FilterCounts = useMemo(() => getFilterCounts(artworks), [artworks]);

  // 统计每个标签的作品数量
  const tagCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    artworks.forEach((a) => {
      a.tags.forEach((t) => {
        counts[t] = (counts[t] || 0) + 1;
      });
    });
    return counts;
  }, [artworks]);

  // 按作品数量排序标签
  const sortedTags = useMemo(() => {
    return Object.entries(tagCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([tag, count]) => ({ tag, count }));
  }, [tagCounts]);

  // 统计每个艺术家的作品数量,用于筛选区按作品数排序展示
  const artistCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    artworks.forEach((a) => {
      counts[a.artist] = (counts[a.artist] || 0) + 1;
    });
    return counts;
  }, [artworks]);

  // 艺术家按作品数量降序排序
  const sortedArtists = useMemo(() => {
    return Object.entries(artistCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([artist, count]) => ({ artist, count }));
  }, [artistCounts]);

  // 各分组折叠时显示的代表标签数量
  const SECTION_PREVIEW = 6;

  // 搜索框标签提示:从所有维度(标签/艺术家/风格/时代)中匹配输入,按作品数排序
  const tagSuggestions = useMemo(() => {
    if (!rawSearchQuery || rawSearchQuery.length < 1) return [];
    const q = rawSearchQuery.toLowerCase();
    const all: { label: string; count: number; type: string; action: () => void }[] = [];
    // 作品标签
    sortedTags.forEach(({ tag, count }) => {
      if (tag.toLowerCase().includes(q)) all.push({ label: tag, count, type: '标签', action: () => toggleSet(tag, setSelectedTags) });
    });
    // 艺术家
    sortedArtists.forEach(({ artist, count }) => {
      if (artist.toLowerCase().includes(q)) all.push({ label: artist, count, type: '艺术家', action: () => toggleSet(artist, setSelectedArtists) });
    });
    // 风格
    filterOptions.styles.forEach(s => {
      if (s.toLowerCase().includes(q)) all.push({ label: s, count: filterCounts.style[s] ?? 0, type: '风格', action: () => toggleSet(s, setSelectedStyles) });
    });
    // 时代
    filterOptions.eras.forEach(e => {
      if (e.toLowerCase().includes(q)) all.push({ label: e, count: filterCounts.era[e] ?? 0, type: '时代', action: () => toggleSet(e, setSelectedEras) });
    });
    return all.sort((a, b) => b.count - a.count).slice(0, 10);
  }, [rawSearchQuery, sortedTags, sortedArtists, filterOptions, filterCounts]);

  // 过滤作品
  const filteredArtworks = useMemo(() => {
    let results = [...artworks];

    if (searchQuery) {
      const kw = searchQuery.toLowerCase();
      results = results.filter(
        (a) =>
          a.title.includes(searchQuery) ||
          a.titleEn?.toLowerCase().includes(kw) ||
          a.artist.includes(searchQuery) ||
          a.artistEn?.toLowerCase().includes(kw) ||
          a.description.includes(searchQuery) ||
          a.tags.some((t) => t.includes(searchQuery))
      );
    }

    if (selectedCategories.size > 0) {
      results = results.filter((a) => selectedCategories.has(a.category));
    }

    if (selectedStyles.size > 0) {
      results = results.filter((a) => selectedStyles.has(a.style));
    }

    if (selectedEras.size > 0) {
      results = results.filter((a) => selectedEras.has(a.era));
    }

    if (selectedRegions.size > 0) {
      results = results.filter((a) => selectedRegions.has(a.region));
    }

    if (selectedArtists.size > 0) {
      results = results.filter((a) => selectedArtists.has(a.artist));
    }

    if (selectedTags.size > 0) {
      results = results.filter((a) => a.tags.some((t) => selectedTags.has(t)));
    }

    return results;
  }, [artworks, searchQuery, selectedCategories, selectedStyles, selectedEras, selectedRegions, selectedArtists, selectedTags]);

  // 非遗素材:按二级类目 + 搜索词筛选(heritage 模式下替代 filteredArtworks)
  const filteredHeritage = useMemo(() => {
    let results = filterHeritageByCategory(heritageWorks, heritageSubCategory);
    if (searchQuery) {
      const kw = searchQuery;
      results = results.filter(
        (w) =>
          w.title.includes(kw) ||
          w.origin.includes(kw) ||
          w.dynasty.includes(kw) ||
          w.craftFeature.includes(kw) ||
          w.techniquePoints.some((p) => p.includes(kw)) ||
          w.tags.some((t) => t.includes(kw))
      );
    }
    return results;
  }, [heritageWorks, heritageSubCategory, searchQuery]);

  // 切换收藏：通过 data-service 异步落库,本地状态同步更新
  const toggleFavorite = useCallback(async (id: string) => {
    try {
      const { favorited } = await toggleFavoriteService(id);
      setFavorites((prev) => {
        const next = new Set(prev);
        if (favorited) next.add(id);
        else next.delete(id);
        return next;
      });
    } catch (err) {
      console.error('收藏切换失败:', err);
      toast.error('操作失败', '请稍后重试');
    }
  }, [toast]);

  /* 详情弹窗图片:eager 直出,跳过 IntersectionObserver 与原生 lazy,
     配合 fetchPriority="high" 让浏览器把大图请求排到列表缩略图之前,
     解决弹窗打开时大图排队几十张缩略图导致的长时间转圈。 */
  const selectedArtworkImageUrl = useArtworkImage(selectedArtwork, 'full');
  const selectedArtworkFallbackUrl = useMemo(
    () => (selectedArtwork ? resolveArtworkFallbackUrl(selectedArtwork) : undefined),
    [selectedArtwork],
  );
  const {
    imgRef: detailImgRef,
    loadedSrc: detailLoadedSrc,
    isLoaded: detailIsLoaded,
    isError: detailIsError,
  } = useLazyImage(selectedArtworkImageUrl, { eager: true, fallbackSrc: selectedArtworkFallbackUrl });

  /* 相关推荐:按「共同标签数 × 10 + 同风格 3 + 同时代 2 + 同地区 1」打分排序,
     排除当前作品,取前 6 件。点击相关作品切换详情,弹窗滚回顶部。 */
  const relatedArtworks = useMemo<ArtworkItem[]>(() => {
    if (!selectedArtwork) return [];
    const currentTags = new Set(selectedArtwork.tags);
    return artworks
      .filter((a) => a.id !== selectedArtwork.id)
      .map((a) => {
        const sharedTags = a.tags.reduce((n, t) => n + (currentTags.has(t) ? 1 : 0), 0);
        let score = sharedTags * 10;
        if (a.style === selectedArtwork.style) score += 3;
        if (a.era === selectedArtwork.era) score += 2;
        if (a.region === selectedArtwork.region) score += 1;
        return { a, score };
      })
      .sort((x, y) => y.score - x.score)
      .slice(0, 6)
      .map((s) => s.a);
  }, [selectedArtwork, artworks]);

  // 切换详情作品时,弹窗右侧滚动容器滚回顶部(切换相关作品体验)
  // 守卫 typeof scrollTo === 'function':jsdom / 非滚动元素下避免抛错
  useEffect(() => {
    const el = detailScrollRef.current;
    if (el && typeof el.scrollTo === 'function') {
      el.scrollTo({ top: 0 });
    }
  }, [selectedArtwork]);

  const toggleSet = (
    value: string,
    setter: (fn: (prev: Set<string>) => Set<string>) => void
  ) => {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  };

  const toggleGroupCollapse = (groupKey: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      return next;
    });
  };

  // 筛选/搜索变化时重置到第一页(无限滚动累积重新开始)
  useEffect(() => {
    setPage(1);
  }, [searchQuery, selectedCategories, selectedStyles, selectedEras, selectedRegions, selectedArtists, selectedTags]);

  // 累积展示的作品:page 递增时累积 slice(0, page*PAGE_SIZE),
  // 而非每页 slice 替换 —— 实现无限滚动「向下加载更多」体验。
  // 避免一次性渲染 9999 个 DOM 节点导致浏览器卡顿。
  const visibleArtworks = useMemo(() => {
    return filteredArtworks.slice(0, page * PAGE_SIZE);
  }, [filteredArtworks, page]);

  // 是否还有更多未加载作品(用于哨兵显隐与 IntersectionObserver 开关)
  const hasMore = visibleArtworks.length < filteredArtworks.length;

  // 首屏直出集合:第一页(PAGE_SIZE 张)跳过懒加载观察,立即请求,
  // 避免打开页面时首屏图片等待 IntersectionObserver 回调的白屏窗口。
  const eagerIds = useMemo(() => {
    return new Set(filteredArtworks.slice(0, PAGE_SIZE).map((a) => a.id));
  }, [filteredArtworks, PAGE_SIZE]);

  // 空闲预取下一页:首屏渲染完成后,requestIdleCallback 预载第 2 页缩略图,
  // 用户滚动触底时图片已在 HTTP 缓存中,翻页零等待。搜索/筛选变化后同样生效。
  useEffect(() => {
    if (!hasMore) return;
    const nextPageItems = filteredArtworks.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    if (nextPageItems.length === 0) return;

    const prefetch = () => {
      nextPageItems.forEach((a) => {
        const url = resolveArtworkThumbUrl(a);
        // 跳过 data URI(内联 SVG 无需网络预取)
        if (url && !url.startsWith('data:')) {
          const img = new Image();
          img.src = url;
        }
      });
    };

    if (typeof requestIdleCallback === 'function') {
      const id = requestIdleCallback(prefetch, { timeout: 2000 });
      return () => cancelIdleCallback(id);
    }
    // Safari 等无 requestIdleCallback 的浏览器:退化为 500ms 后预取
    const timer = setTimeout(prefetch, 500);
    return () => clearTimeout(timer);
  }, [filteredArtworks, page, hasMore, PAGE_SIZE]);

  // 无限滚动:IntersectionObserver 监听底部哨兵,触底时 page+1。
  // 依赖 [hasMore, page] 让每次加载后重新建立观察:若哨兵仍在视口内(首屏未填满),
  // 新观察器立即触发,继续加载下一页直到哨兵被推出视口或全部加载完。
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') return;
    if (!hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setPage((p) => p + 1);
        }
      },
      { rootMargin: '300px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, page]);

  const groupedArtworks = useMemo(() => {
    if (groupBy === 'none') return { all: visibleArtworks };
    const groups: Record<string, ArtworkItem[]> = {};
    visibleArtworks.forEach((artwork) => {
      const key = groupBy === 'style' ? artwork.style :
                  groupBy === 'era' ? artwork.era :
                  regionNames[artwork.region] || artwork.region;
      if (!groups[key]) groups[key] = [];
      groups[key].push(artwork);
    });
    return groups;
  }, [visibleArtworks, groupBy]);

  /* ============================================================
   * JS 预分配列瀑布流(替换 CSS columns)
   *
   * 原实现 columns-1 md:columns-3 lg:columns-4 xl:columns-5 的缺陷:
   *   CSS columns 是「列优先填充」,浏览器先把第 1 列填到容器高度
   *   再填第 2 列。无限滚动追加新作品时容器高度变化,浏览器重新
   *   分配所有卡片的列归属 → 已渲染卡片位置跳变(CLS),用户看到
   *   「布局一直变、图片重复加载」。
   *
   * 新实现:
   *   1. useMasonryColumnCount 监听窗口宽度,返回当前断点对应列数
   *   2. useMasonryColumns 按「最短列优先」把作品分配到各列
   *   3. 每列一个 flex flex-col 容器,翻页只往列尾追加,旧卡片不动
   *   4. 分组模式下每个分组独立分配列(视觉与交互与原实现一致)
   * ============================================================ */
  const masonryColumnCount = useMasonryColumnCount();

  // 视觉高度权重:用缩略图高宽比估算,让各列高度更均衡。
  // 缺尺寸信息时回退 16:9(与 ArtworkCard 的 aspectRatio 回退一致)。
  const getArtworkWeight = useCallback((a: ArtworkItem) => {
    const w = a.thumbW ?? 640;
    const h = a.thumbH ?? 360;
    return h / w;
  }, []);

  // 分组模式:每组独立分配列(groupBy === 'none' 时 groupedArtworks = { all: visibleArtworks })
  const groupedColumns = useMemo(() => {
    const entries = Object.entries(groupedArtworks);
    return entries.map(([key, items]) => ({
      key,
      items,
      columns: distributeColumns(items, masonryColumnCount, getArtworkWeight),
    }));
  }, [groupedArtworks, masonryColumnCount, getArtworkWeight]);

  // 列分配工具(内联,避免组件外引用 hook)
  function distributeColumns(
    items: ArtworkItem[],
    count: number,
    weight: (item: ArtworkItem) => number,
  ): ArtworkItem[][] {
    const cols: ArtworkItem[][] = Array.from({ length: count }, () => []);
    const heights: number[] = new Array(count).fill(0);
    for (const item of items) {
      let minIdx = 0;
      for (let i = 1; i < count; i++) {
        if (heights[i] < heights[minIdx]) minIdx = i;
      }
      cols[minIdx].push(item);
      heights[minIdx] += weight(item);
    }
    return cols;
  }

  const resetFilters = () => {
    setRawSearchQuery('');
    setSelectedCategories(new Set());
    setSelectedStyles(new Set());
    setSelectedEras(new Set());
    setSelectedRegions(new Set());
    setSelectedArtists(new Set());
    setSelectedTags(new Set());
  };

  const activeFilterCount =
    (searchQuery ? 1 : 0) +
    selectedCategories.size +
    selectedStyles.size +
    selectedEras.size +
    selectedRegions.size +
    selectedArtists.size +
    selectedTags.size;

  // 初始化：通过 data-service 异步加载收藏列表
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ids = await getFavorites();
        if (!cancelled) setFavorites(new Set(ids));
      } catch (err) {
        console.error('加载收藏列表失败:', err);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // 标签按钮组件
  const TagButton = ({ label, count, active, onClick }: { label: string; count?: number; active: boolean; onClick: () => void }) => (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-sm transition-all whitespace-nowrap ${
        active
          ? 'bg-cinnabar text-white border border-cinnabar'
          : 'bg-rice-100 text-ink-700 border border-transparent hover:bg-rice-200 hover:border-ink-200'
      }`}
    >
      {label}
      {count !== undefined && (
        <span className={`ml-1 text-xs ${active ? 'text-white/70' : 'text-ink-400'}`}>{count}</span>
      )}
      {active && <Check className="w-3 h-3 inline ml-1" />}
    </button>
  );

  return (
    <div className="min-h-screen bg-rice-200 ink-texture pt-20 pb-20">
      {isLoading && (
        <div className="fixed inset-0 bg-rice-200/80 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="flex flex-col items-center">
            <Loader2 className="w-10 h-10 text-cinnabar animate-spin mb-3" />
            <p className="text-ink-700 font-medium">正在加载素材库...</p>
          </div>
        </div>
      )}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-ink-900/5 rounded-full mb-4">
            <Globe className="w-4 h-4 text-cinnabar" />
            <span className="text-sm text-ink-600">在线艺术素材库</span>
          </div>
          <h1 className="font-serif text-3xl md:text-4xl font-bold text-ink-900 mb-4">
            海内外名作 · 实时获取
          </h1>
          <p className="text-ink-600 max-w-2xl mx-auto">
            整合Wikimedia Commons等公开数据源，收录{artworks.length}+件中外艺术杰作
            <br />
            <span className="text-sm text-ink-500">涵盖绘画、设计、雕塑、书法等多种创作形式</span>
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
          <div className="bg-rice-50 rounded-xl p-4 shadow-card text-center">
            <p className="text-2xl font-bold text-ink-900">{artworks.length}</p>
            <p className="text-sm text-ink-500">总作品数</p>
          </div>
          <div className="bg-rice-50 rounded-xl p-4 shadow-card text-center">
            <p className="text-2xl font-bold text-ink-900">{filterOptions.styles.length}</p>
            <p className="text-sm text-ink-500">风格类型</p>
          </div>
          <div className="bg-rice-50 rounded-xl p-4 shadow-card text-center">
            <p className="text-2xl font-bold text-ink-900">{filterOptions.eras.length}</p>
            <p className="text-sm text-ink-500">时代跨度</p>
          </div>
          <div className="bg-rice-50 rounded-xl p-4 shadow-card text-center">
            <p className="text-2xl font-bold text-ink-900">{filterOptions.regions.length}</p>
            <p className="text-sm text-ink-500">地区来源</p>
          </div>
          <div className="bg-rice-50 rounded-xl p-4 shadow-card text-center">
            <p className="text-2xl font-bold text-ink-900">{sortedTags.length}</p>
            <p className="text-sm text-ink-500">标签数量</p>
          </div>
        </div>

        {/* 素材包面板 */}
        <div className="bg-rice-50 rounded-2xl p-4 shadow-card mb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Package className="w-4 h-4 text-cinnabar" />
              <span className="text-sm font-medium text-ink-700">我的素材包</span>
              {packs.length > 0 && (
                <span className="text-xs text-ink-400">{packs.length} 个</span>
              )}
            </div>
            <button
              onClick={() => setShowPackPanel(!showPackPanel)}
              aria-label={showPackPanel ? '收起素材包面板' : '管理素材包'}
              className="text-xs text-cinnabar hover:underline flex items-center gap-1"
            >
              {showPackPanel ? '收起' : '管理素材包'}
              <ChevronDown className={`w-3 h-3 transition-transform ${showPackPanel ? 'rotate-180' : ''}`} />
            </button>
          </div>
          {showPackPanel && (
            <div className="mt-4 space-y-3">
              {/* 创建新素材包 */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newPackName}
                  onChange={(e) => setNewPackName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleCreatePack(); }}
                  placeholder="新建素材包名称，如「宋代山水参考」..."
                  className="flex-1 px-3 py-2 border border-ink-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-cinnabar/30 focus:border-cinnabar"
                />
                <button
                  onClick={handleCreatePack}
                  aria-label="创建素材包"
                  className="flex items-center gap-1 px-4 py-2 bg-ink-900 text-white text-sm rounded-lg hover:bg-cinnabar transition-all"
                >
                  <PackagePlus className="w-4 h-4" />
                  创建
                </button>
              </div>
              {/* 素材包列表 */}
              {packs.length === 0 ? (
                <p className="text-xs text-ink-400 text-center py-3">
                  暂无素材包，创建后可将作品按主题打包管理
                </p>
              ) : (
                <div className="space-y-2">
                  {packs.map((pack) => (
                    <div key={pack.id}>
                      <div className="flex items-center justify-between px-3 py-2 bg-rice-100 rounded-lg hover:bg-rice-200/60 transition-all">
                        <button
                          onClick={() => handleViewPack(pack.id)}
                          aria-label={`查看素材包 ${pack.name}`}
                          className="flex items-center gap-2 flex-1 text-left"
                        >
                          <Package className={`w-4 h-4 ${activePackId === pack.id ? 'text-cinnabar' : 'text-ink-400'}`} />
                          <span className={`text-sm font-medium ${activePackId === pack.id ? 'text-cinnabar' : 'text-ink-700'}`}>
                            {pack.name}
                          </span>
                          <span className="text-xs text-ink-400">{pack.materialIds.length} 件</span>
                        </button>
                        <button
                          onClick={() => handleDeletePack(pack.id)}
                          aria-label={`删除素材包 ${pack.name}`}
                          className="p-1.5 text-ink-400 hover:text-cinnabar rounded transition-all"
                          title="删除素材包"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      {/* 展开的包内容 */}
                      {activePackId === pack.id && (
                        <div className="mt-2 px-3 pb-2">
                          {packMaterials.length === 0 ? (
                            <p className="text-xs text-ink-400 py-2">包内暂无素材，点击作品卡片上的「入包」按钮添加</p>
                          ) : (
                            <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
                              {packMaterials.map((m) => (
                                <div key={m.id} className="relative group/pack-item aspect-square rounded-lg overflow-hidden bg-ink-100">
                                  <img
                                    src={m.imageUrl}
                                    alt={m.title}
                                    className="w-full h-full object-cover"
                                    loading="lazy"
                                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                  />
                                  {/* 用于嫁接:直达灵感嫁接页面 */}
                                  <button
                                    onClick={() => handleSendUnifiedToFuse(m)}
                                    aria-label={`将 ${m.title} 用于嫁接`}
                                    title="用于嫁接"
                                    className="absolute top-1 right-1 p-1.5 rounded-full backdrop-blur-md bg-white/25 text-white hover:bg-cinnabar/90 transition-colors opacity-0 group-hover/pack-item:opacity-100 z-10"
                                  >
                                    <Sparkles className="w-3 h-3" />
                                  </button>
                                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink-900/80 to-transparent px-1.5 py-1 opacity-0 group-hover/pack-item:opacity-100 transition-opacity">
                                    <p className="text-[10px] text-white truncate">{m.title}</p>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Search */}
        <div className="bg-rice-50 rounded-2xl p-4 shadow-card mb-4">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-ink-400" />
            <input
              type="text"
              value={rawSearchQuery}
              onChange={(e) => { setRawSearchQuery(e.target.value); setShowSuggestions(true); }}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
              placeholder="搜索作品名称、画家、标签（支持中英文）..."
              className="w-full pl-12 pr-4 py-3 border border-ink-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-cinnabar/30 focus:border-cinnabar"
            />
            {rawSearchQuery && (
              <button onClick={() => { setRawSearchQuery(''); setShowSuggestions(false); }} aria-label="清除搜索" className="absolute right-4 top-1/2 -translate-y-1/2 p-1 hover:bg-ink-100 rounded-full">
                <X className="w-4 h-4 text-ink-400" />
              </button>
            )}
            {/* 标签提示下拉 */}
            {showSuggestions && tagSuggestions.length > 0 && (
              <div className="absolute z-30 left-0 right-0 mt-1 bg-white rounded-xl shadow-card-hover border border-ink-100 max-h-80 overflow-y-auto">
                <p className="px-4 py-2 text-xs text-ink-400 border-b border-ink-50">相关标签 · 点击快速筛选</p>
                {tagSuggestions.map((s) => (
                  <button
                    key={s.type + s.label}
                    onMouseDown={(e) => { e.preventDefault(); s.action(); setRawSearchQuery(''); setShowSuggestions(false); }}
                    className="w-full flex items-center justify-between px-4 py-2 hover:bg-rice-50 transition-colors text-left"
                  >
                    <span className="flex items-center gap-2">
                      <span className="text-sm text-ink-800">{s.label}</span>
                      <span className="text-2xs px-1.5 py-0.5 bg-ink-50 text-ink-400 rounded-full">{s.type}</span>
                    </span>
                    <span className="text-xs text-ink-400">{s.count} 件</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 标签筛选面板 */}
        <div className="bg-rice-50 rounded-2xl p-4 shadow-card mb-4">
          {/* 类型标签 */}
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-2">
              <Filter className="w-4 h-4 text-ink-500" />
              <span className="text-sm font-medium text-ink-700">创作类型</span>
              <span className="text-xs text-ink-400">（可多选）</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(categoryNames).map(([key, name]) => {
                // heritage 数据源独立(heritage-works.json),count 取自非遗库,确保 tab 始终可见
                const count = key === 'heritage' ? heritageWorks.length : (filterCounts.category[key] ?? 0);
                if (count === 0) return null;
                return (
                  <TagButton
                    key={key}
                    label={name}
                    count={count}
                    active={selectedCategories.has(key)}
                    onClick={() => toggleSet(key, setSelectedCategories)}
                  />
                );
              })}
            </div>
          </div>

          {/* heritage 模式下隐藏不适用的高级筛选(艺术家/地区/风格/时代/标签),仅保留创作类型 + 二级类目 */}
          {!isHeritageMode && (
            <>
          {/* 艺术家筛选 */}
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-2">
              <Tag className="w-4 h-4 text-ink-500" />
              <span className="text-sm font-medium text-ink-700">艺术家</span>
              <span className="text-xs text-ink-400">（可多选）</span>
              {sortedArtists.length > SECTION_PREVIEW && (
                <button
                  onClick={() => toggleSection('artists')}
                  aria-label={expandedSections.has('artists') ? '收起艺术家' : '展开全部艺术家'}
                  className="ml-auto text-xs text-cinnabar hover:underline flex items-center gap-1"
                >
                  {expandedSections.has('artists') ? '收起' : `展开全部 (${sortedArtists.length})`}
                  <ChevronDown className={`w-3 h-3 transition-transform ${expandedSections.has('artists') ? 'rotate-180' : ''}`} />
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {(expandedSections.has('artists') ? sortedArtists : sortedArtists.slice(0, SECTION_PREVIEW)).map(({ artist, count }) => (
                <TagButton
                  key={artist}
                  label={artist}
                  count={count}
                  active={selectedArtists.has(artist)}
                  onClick={() => toggleSet(artist, setSelectedArtists)}
                />
              ))}
            </div>
          </div>

          {/* 地区标签 */}
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-2">
              <Globe className="w-4 h-4 text-ink-500" />
              <span className="text-sm font-medium text-ink-700">地区</span>
              <span className="text-xs text-ink-400">（可多选）</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(regionNames).map(([key, name]) => {
                const count = filterCounts.region[key] ?? 0;
                if (count === 0) return null;
                return (
                  <TagButton
                    key={key}
                    label={name}
                    count={count}
                    active={selectedRegions.has(key)}
                    onClick={() => toggleSet(key, setSelectedRegions)}
                  />
                );
              })}
            </div>
          </div>

          {/* 风格标签 */}
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-2">
              <Tag className="w-4 h-4 text-ink-500" />
              <span className="text-sm font-medium text-ink-700">风格流派</span>
              <span className="text-xs text-ink-400">（可多选）</span>
              {filterOptions.styles.length > SECTION_PREVIEW && (
                <button
                  onClick={() => toggleSection('styles')}
                  aria-label={expandedSections.has('styles') ? '收起风格' : '展开全部风格'}
                  className="ml-auto text-xs text-cinnabar hover:underline flex items-center gap-1"
                >
                  {expandedSections.has('styles') ? '收起' : `展开全部 (${filterOptions.styles.length})`}
                  <ChevronDown className={`w-3 h-3 transition-transform ${expandedSections.has('styles') ? 'rotate-180' : ''}`} />
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {(expandedSections.has('styles') ? filterOptions.styles : filterOptions.styles.slice(0, SECTION_PREVIEW)).map((style) => {
                const count = filterCounts.style[style] ?? 0;
                if (count === 0) return null;
                return (
                  <TagButton
                    key={style}
                    label={style}
                    count={count}
                    active={selectedStyles.has(style)}
                    onClick={() => toggleSet(style, setSelectedStyles)}
                  />
                );
              })}
            </div>
          </div>

          {/* 时代标签 */}
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-2">
              <Tag className="w-4 h-4 text-ink-500" />
              <span className="text-sm font-medium text-ink-700">时代</span>
              <span className="text-xs text-ink-400">（可多选）</span>
              {filterOptions.eras.length > SECTION_PREVIEW && (
                <button
                  onClick={() => toggleSection('eras')}
                  aria-label={expandedSections.has('eras') ? '收起时代' : '展开全部时代'}
                  className="ml-auto text-xs text-cinnabar hover:underline flex items-center gap-1"
                >
                  {expandedSections.has('eras') ? '收起' : `展开全部 (${filterOptions.eras.length})`}
                  <ChevronDown className={`w-3 h-3 transition-transform ${expandedSections.has('eras') ? 'rotate-180' : ''}`} />
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {(expandedSections.has('eras') ? filterOptions.eras : filterOptions.eras.slice(0, SECTION_PREVIEW)).map((era) => {
                const count = filterCounts.era[era] ?? 0;
                if (count === 0) return null;
                return (
                  <TagButton
                    key={era}
                    label={era}
                    count={count}
                    active={selectedEras.has(era)}
                    onClick={() => toggleSet(era, setSelectedEras)}
                  />
                );
              })}
            </div>
          </div>

          {/* 作品标签云 - 统一折叠,默认显示前6个,展开显示全部 */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Tag className="w-4 h-4 text-ink-500" />
              <span className="text-sm font-medium text-ink-700">作品标签</span>
              <span className="text-xs text-ink-400">（可多选）</span>
              {sortedTags.length > SECTION_PREVIEW && (
                <button
                  onClick={() => toggleSection('tags')}
                  aria-label={expandedSections.has('tags') ? '收起标签' : '展开全部标签'}
                  className="ml-auto text-xs text-cinnabar hover:underline flex items-center gap-1"
                >
                  {expandedSections.has('tags') ? '收起' : `展开全部 (${sortedTags.length})`}
                  <ChevronDown className={`w-3 h-3 transition-transform ${expandedSections.has('tags') ? 'rotate-180' : ''}`} />
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {(expandedSections.has('tags') ? sortedTags : sortedTags.slice(0, SECTION_PREVIEW)).map(({ tag, count }) => (
                <TagButton
                  key={tag}
                  label={tag}
                  count={count}
                  active={selectedTags.has(tag)}
                  onClick={() => toggleSet(tag, setSelectedTags)}
                />
              ))}
            </div>
          </div>
            </>
          )}
        </div>

        {isHeritageMode ? (
          /* ===== 非遗素材库面板(heritage 模式:数据源切换至 heritage-works.json) ===== */
          <div className="space-y-6">
            {/* Task 19:非遗分析案例展示(完整流程 mock) */}
            <HeritageCaseShowcase />

            {/* 二级类目筛选:全部 / 剪纸 / 刺绣 / 瓷器 */}
            <div className="bg-rice-50 rounded-2xl p-4 shadow-card border border-gold/20">
              <div className="flex items-center gap-2 mb-3">
                <Scroll className="w-4 h-4 text-gold-dark" />
                <span className="text-sm font-medium text-ink-700">非遗类目</span>
                <span className="text-xs text-ink-400">（十大类目）</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {HERITAGE_SUBCATEGORY_OPTIONS.map((opt) => {
                  const cnt = opt.key === 'all'
                    ? heritageWorks.length
                    : heritageWorks.filter((w) => w.category === opt.key).length;
                  return (
                    <button
                      key={opt.key}
                      onClick={() => setHeritageSubCategory(opt.key)}
                      className={`px-3 py-1.5 rounded-full text-sm transition-all whitespace-nowrap border ${
                        heritageSubCategory === opt.key
                          ? 'bg-gold-dark text-white border-gold-dark'
                          : 'bg-rice-100 text-ink-700 border-transparent hover:bg-gold/15 hover:border-gold/30'
                      }`}
                    >
                      {opt.label}
                      <span className={`ml-1 text-xs ${heritageSubCategory === opt.key ? 'text-white/70' : 'text-ink-400'}`}>{cnt}</span>
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-ink-500 mt-3">
                {heritageWorks.length} 件非遗专项档案 · 十维深度结构化 · 数据对齐国家级非遗名录,可溯源、不虚构
              </p>
            </div>

            <p className="text-sm text-ink-500">
              共 <span className="font-medium text-ink-900">{filteredHeritage.length}</span> 件非遗作品
            </p>

            {/* heritage 卡片网格 */}
            {heritageLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="w-8 h-8 text-gold-dark animate-spin" />
                <p className="text-sm text-ink-500 ml-2">正在加载非遗素材库...</p>
              </div>
            ) : filteredHeritage.length === 0 ? (
              <div className="bg-rice-50 rounded-2xl shadow-card">
                <EmptyState icon={Search} title="没有找到匹配的非遗作品" desc="试试其他关键词或类目" />
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {filteredHeritage.map((work) => (
                  <HeritageCard key={work.id} work={work} onSelect={setSelectedHeritage} eager />
                ))}
              </div>
            )}
          </div>
        ) : (
        <>
        {/* Toolbar */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3 flex-wrap">
            <p className="text-sm text-ink-500">
              共 <span className="font-medium text-ink-900">{filteredArtworks.length}</span> 件作品
              {favorites.size > 0 && <span className="ml-2">· 已收藏 {favorites.size} 件</span>}
            </p>
            {activeFilterCount > 0 && (
              <span className="px-2 py-0.5 bg-cinnabar/10 text-cinnabar text-xs rounded-full">
                {activeFilterCount} 个筛选条件
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {activeFilterCount > 0 && (
              <button
                onClick={resetFilters}
                aria-label="清除筛选"
                className="flex items-center gap-1 px-3 py-2 text-sm text-ink-600 hover:text-cinnabar transition-all"
              >
                <RefreshCw className="w-4 h-4" />
                清除筛选
              </button>
            )}
            <div className="flex items-center gap-1 bg-white rounded-lg p-1">
              <span className="text-xs text-ink-400 px-2">分组:</span>
              {[
                { key: 'none', label: '无' },
                { key: 'style', label: '风格' },
                { key: 'era', label: '时代' },
                { key: 'region', label: '地区' },
              ].map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => { setGroupBy(opt.key as typeof groupBy); setCollapsedGroups(new Set()); }}
                  className={`px-2 py-1 text-xs rounded transition-all ${
                    groupBy === opt.key
                      ? 'bg-cinnabar text-white'
                      : 'text-ink-600 hover:bg-rice-100'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => setViewMode('grid')}
              aria-label="网格视图"
              aria-pressed={viewMode === 'grid'}
              className={`p-2 rounded-lg transition-all ${viewMode === 'grid' ? 'bg-ink-900 text-white' : 'bg-white text-ink-600 hover:bg-rice-100'}`}
            >
              <Grid3X3 className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode('list')}
              aria-label="列表视图"
              aria-pressed={viewMode === 'list'}
              className={`p-2 rounded-lg transition-all ${viewMode === 'list' ? 'bg-ink-900 text-white' : 'bg-white text-ink-600 hover:bg-rice-100'}`}
            >
              <List className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Artworks */}
        {filteredArtworks.length === 0 ? (
          <div className="bg-rice-50 rounded-2xl shadow-card">
            <EmptyState
              icon={Search}
              title="没有找到匹配的作品"
              desc="试试其他关键词或筛选条件"
            />
          </div>
        ) : (
          <div className="space-y-8">
            {groupedColumns.map(({ key: groupKey, items: artworks, columns }) => {
              const isCollapsed = collapsedGroups.has(groupKey);
              return (
                <div key={groupKey}>
                  {groupBy !== 'none' && (
                    <button
                      onClick={() => toggleGroupCollapse(groupKey)}
                      aria-label={isCollapsed ? `展开分组 ${groupKey}` : `收起分组 ${groupKey}`}
                      className="w-full flex items-center justify-between mb-4 px-4 py-3 bg-rice-50 rounded-xl shadow-card hover:shadow-card-hover transition-all group"
                    >
                      <div className="flex items-center gap-3">
                        <Tag className="w-4 h-4 text-cinnabar" />
                        <span className="font-serif text-lg font-bold text-ink-900">{groupKey}</span>
                        <span className="text-sm text-ink-500">{artworks.length} 件作品</span>
                      </div>
                      {isCollapsed ? (
                        <ChevronDown className="w-5 h-5 text-ink-400 group-hover:text-cinnabar transition-all" />
                      ) : (
                        <ChevronUp className="w-5 h-5 text-ink-400 group-hover:text-cinnabar transition-all" />
                      )}
                    </button>
                  )}
                  {!isCollapsed && (
                    <>
                      {viewMode === 'grid' ? (
                        <div className="flex gap-4 items-start">
                          {columns.map((columnItems, colIdx) => (
                            <div key={colIdx} className="flex-1 flex flex-col gap-4 min-w-0">
                              {columnItems.map((artwork) => (
                                <ArtworkCard
                                  key={artwork.id}
                                  artwork={artwork}
                                  isFavorite={favorites.has(artwork.id)}
                                  onSelect={setSelectedArtwork}
                                  onSendToFuse={handleSendToFuse}
                                  onPickPack={setPackPickerArtwork}
                                  onToggleFavorite={toggleFavorite}
                                  eager={eagerIds.has(artwork.id)}
                                />
                              ))}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {artworks.map((artwork) => (
                            <ArtworkRow
                              key={artwork.id}
                              artwork={artwork}
                              isFavorite={favorites.has(artwork.id)}
                              onSelect={setSelectedArtwork}
                              onSendToFuse={handleSendToFuse}
                              onPickPack={setPackPickerArtwork}
                              onToggleFavorite={toggleFavorite}
                              eager={eagerIds.has(artwork.id)}
                            />
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* 无限滚动哨兵 + 加载/结束提示 */}
        {filteredArtworks.length > 0 && (
          <div ref={sentinelRef} className="h-12 flex items-center justify-center mt-8" aria-live="polite">
            {hasMore ? (
              <div className="flex items-center gap-2 text-ink-500">
                <Loader2 className="w-4 h-4 animate-spin text-cinnabar" />
                <span className="text-sm">正在加载更多作品...</span>
              </div>
            ) : (
              <span className="text-sm text-ink-400">
                已加载全部 {filteredArtworks.length} 件作品
              </span>
            )}
          </div>
        )}
        </>
        )}

        {/* Detail Modal */}
        {selectedArtwork && (
          <div className="fixed inset-0 bg-ink-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setSelectedArtwork(null)}>
            <div className="bg-rice-50 rounded-2xl overflow-hidden max-w-5xl w-full max-h-[90vh] flex flex-col md:flex-row" onClick={(e) => e.stopPropagation()}>
              <div className="md:w-3/5 relative bg-ink-900 flex items-center justify-center min-h-[300px]">
                {!detailIsLoaded && !detailIsError && (
                  <div className="absolute inset-0 flex items-center justify-center z-10">
                    <Loader2 className="w-10 h-10 text-ink-500 animate-spin" />
                  </div>
                )}
                {detailIsError ? (
                  <div className="flex flex-col items-center justify-center py-16">
                    <ImageOff className="w-12 h-12 text-ink-600 mb-3" />
                    <p className="text-sm text-ink-400">图片加载失败</p>
                  </div>
                ) : (
                  <img
                    ref={detailImgRef}
                    src={detailLoadedSrc}
                    alt={selectedArtwork.title}
                    loading="eager"
                    fetchPriority="high"
                    className={`w-full h-full object-contain max-h-[60vh] md:max-h-[80vh] transition-opacity duration-500 ${
                      detailIsLoaded ? 'opacity-100' : 'opacity-0'
                    }`}
                  />
                )}
                <div className="absolute top-3 left-3 flex gap-2">
                  <span className="px-2 py-1 bg-cinnabar text-white text-sm rounded-full">{categoryNames[selectedArtwork.category] || selectedArtwork.category}</span>
                  <span className="px-2 py-1 bg-ink-900/80 text-white text-sm rounded-full">{regionNames[selectedArtwork.region] || selectedArtwork.region}</span>
                </div>
              </div>
              <div ref={detailScrollRef} className="md:w-2/5 p-6 overflow-y-auto max-h-[40vh] md:max-h-[80vh]">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h2 className="font-serif text-2xl font-bold text-ink-900">{selectedArtwork.title}</h2>
                    {selectedArtwork.titleEn && <p className="text-sm text-ink-400 italic">{selectedArtwork.titleEn}</p>}
                  </div>
                  <button onClick={() => setSelectedArtwork(null)} aria-label="关闭" className="p-2 hover:bg-rice-100 rounded-full transition-all"><X className="w-5 h-5 text-ink-700" /></button>
                </div>
                <div className="mb-4">
                  <p className="text-ink-500">
                    <span className="font-medium text-ink-700">{selectedArtwork.artist}</span>
                    {selectedArtwork.artistEn && <span className="text-sm text-ink-400 ml-1">({selectedArtwork.artistEn})</span>}
                    <span className="mx-2">·</span>{selectedArtwork.year}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="bg-rice-50 rounded-lg p-3"><p className="text-xs text-ink-500">风格</p><p className="text-sm font-medium text-ink-700">{selectedArtwork.style}</p></div>
                  <div className="bg-rice-50 rounded-lg p-3"><p className="text-xs text-ink-500">时代</p><p className="text-sm font-medium text-ink-700">{selectedArtwork.era}</p></div>
                  {selectedArtwork.dimensions && <div className="bg-rice-50 rounded-lg p-3"><p className="text-xs text-ink-500">尺寸</p><p className="text-sm font-medium text-ink-700">{selectedArtwork.dimensions}</p></div>}
                  {selectedArtwork.medium && <div className="bg-rice-50 rounded-lg p-3"><p className="text-xs text-ink-500">材质</p><p className="text-sm font-medium text-ink-700">{selectedArtwork.medium}</p></div>}
                </div>
                <div className="mb-4">
                  <p className="text-sm font-medium text-ink-700 mb-2">作品介绍</p>
                  <p className="text-sm text-ink-600 leading-relaxed">{selectedArtwork.description}</p>
                </div>
                <div className="mb-4">
                  <p className="text-sm font-medium text-ink-700 mb-2">标签</p>
                  <div className="flex flex-wrap gap-2">
                    {selectedArtwork.tags.map((tag) => (
                      <button
                        key={tag}
                        onClick={() => { toggleSet(tag, setSelectedTags); setSelectedArtwork(null); }}
                        className="px-3 py-1 bg-ink-900/5 text-ink-700 text-sm rounded-full hover:bg-cinnabar hover:text-white transition-all"
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="mb-4 p-3 bg-rice-50 rounded-lg">
                  <p className="text-xs text-ink-500 mb-1">图片来源</p>
                  <p className="text-sm text-ink-700 flex items-center gap-1"><Globe className="w-3 h-3" />{selectedArtwork.source}</p>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => toggleFavorite(selectedArtwork.id)}
                    aria-label={favorites.has(selectedArtwork.id) ? '取消收藏' : '收藏'}
                    className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg transition-all ${favorites.has(selectedArtwork.id) ? 'bg-cinnabar text-white' : 'border-2 border-ink-200 text-ink-700 hover:border-cinnabar hover:text-cinnabar'}`}
                  >
                    <Heart className={`w-4 h-4 ${favorites.has(selectedArtwork.id) ? 'fill-white' : ''}`} />
                    <span className="text-sm font-medium">{favorites.has(selectedArtwork.id) ? '已收藏' : '收藏'}</span>
                  </button>
                  <button
                    onClick={() => { setPackPickerArtwork(selectedArtwork); }}
                    aria-label="加入素材包"
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 border-2 border-ink-200 text-ink-700 rounded-lg hover:border-cinnabar hover:text-cinnabar transition-all"
                  >
                    <PackagePlus className="w-4 h-4" /><span className="text-sm font-medium">入包</span>
                  </button>
                  {selectedArtwork.sourceUrl && (
                    <a href={selectedArtwork.sourceUrl} target="_blank" rel="noopener noreferrer" className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 border-2 border-ink-200 text-ink-700 rounded-lg hover:border-ink-900 transition-all">
                      <ExternalLink className="w-4 h-4" /><span className="text-sm font-medium">查看原图</span>
                    </a>
                  )}
                  <button
                    onClick={() => { const link = document.createElement('a'); link.href = selectedArtworkImageUrl || selectedArtwork.imageUrl; link.download = `${selectedArtwork.title}.svg`; link.target = '_blank'; document.body.appendChild(link); link.click(); document.body.removeChild(link); }}
                    aria-label="下载参考"
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-ink-900 text-white rounded-lg hover:bg-cinnabar transition-all"
                  >
                    <Download className="w-4 h-4" /><span className="text-sm font-medium">下载参考</span>
                </button>
                </div>

                {/* 相关推荐:按共同标签/同风格/同时代/同地区打分排序,点击切换详情 */}
                {relatedArtworks.length > 0 && (
                  <div className="mt-6">
                    <p className="text-sm font-medium text-ink-700 mb-2 flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-cinnabar" />
                      相关推荐
                    </p>
                    <div className="grid grid-cols-3 gap-2">
                      {relatedArtworks.map((rel) => (
                        <ArtworkCard
                          key={rel.id}
                          artwork={rel}
                          isFavorite={favorites.has(rel.id)}
                          onSelect={setSelectedArtwork}
                          onSendToFuse={handleSendToFuse}
                          onPickPack={setPackPickerArtwork}
                          onToggleFavorite={toggleFavorite}
                          compact
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 非遗详情弹窗(Task 17 + V3 字段):点击卡片展开完整内容 */}
        {selectedHeritage && (
          <HeritageDetailModal
            work={selectedHeritage}
            onClose={() => setSelectedHeritage(null)}
          />
        )}

        {/* 素材包选择弹窗 */}
        {packPickerArtwork && (
          <div
            className="fixed inset-0 bg-ink-900/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4"
            onClick={() => setPackPickerArtwork(null)}
          >
            <div
              className="bg-rice-50 rounded-2xl p-6 max-w-sm w-full shadow-card"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-serif text-lg font-bold text-ink-900 flex items-center gap-2">
                  <Package className="w-5 h-5 text-cinnabar" />
                  加入素材包
                </h3>
                <button
                  onClick={() => setPackPickerArtwork(null)}
                  aria-label="关闭"
                  className="p-1.5 hover:bg-rice-100 rounded-full transition-all"
                >
                  <X className="w-4 h-4 text-ink-700" />
                </button>
              </div>
              <p className="text-sm text-ink-500 mb-4">
                将「{packPickerArtwork.title}」加入：
              </p>
              {packs.length === 0 ? (
                <div className="text-center py-6">
                  <p className="text-sm text-ink-400 mb-3">暂无素材包</p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newPackName}
                      onChange={(e) => setNewPackName(e.target.value)}
                      placeholder="输入名称创建素材包"
                      className="flex-1 px-3 py-2 border border-ink-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-cinnabar/30"
                    />
                    <button
                      onClick={handleCreatePack}
                      className="px-3 py-2 bg-ink-900 text-white text-sm rounded-lg hover:bg-cinnabar transition-all"
                    >
                      创建
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {packs.map((pack) => {
                    const alreadyIn = pack.materialIds.includes(packPickerArtwork.id);
                    return (
                      <button
                        key={pack.id}
                        onClick={() => !alreadyIn && handleAddToPack(pack.id)}
                        disabled={alreadyIn}
                        aria-label={alreadyIn ? `${pack.name}（已加入）` : `加入素材包 ${pack.name}`}
                        className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border-2 text-left transition-all ${
                          alreadyIn
                            ? 'border-jade/40 bg-jade/5 cursor-default'
                            : 'border-ink-200 hover:border-cinnabar hover:bg-cinnabar/5'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <Package className={`w-4 h-4 ${alreadyIn ? 'text-jade' : 'text-ink-400'}`} />
                          <span className="text-sm font-medium text-ink-700">{pack.name}</span>
                          <span className="text-xs text-ink-400">{pack.materialIds.length} 件</span>
                        </div>
                        {alreadyIn && (
                          <span className="text-xs text-jade flex items-center gap-1">
                            <Check className="w-3 h-3" />
                            已加入
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
