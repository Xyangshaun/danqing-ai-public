import { useState, useEffect, useMemo, useRef } from 'react';
import { ArrowRight, X, ExternalLink, Heart, Globe, BookMarked, Brush, PenTool, Box, Layers, Landmark, Loader2, ImageOff } from 'lucide-react';
import { loadBuiltinArtworks, styleCategories, resolveArtworkThumbUrl, withAppBase, type ArtworkItem } from '../services/artworksDatabase';
import { artworkImage } from '../services/artworkImage';
import { SkeletonBox, SkeletonStyle } from '../components/PageSkeleton';
import { useToast } from '../components/ToastProvider';
import {
  loadHeritageWorks,
  HERITAGE_CATEGORY_LABEL,
  HERITAGE_SUBCATEGORY_OPTIONS,
  resolveHeritageFull,
  type HeritageWork,
} from '../services/heritageDatabase';

/* 四大创作形式封面:真实公有领域藏品(Wikimedia Commons / Google Art Project),
 * 加载失败时回退到本地生成的 SVG 占位图,保证永不错裂。
 *   绘画   — 梵高《罗纳河上的星夜》(Google Art Project)
 *   设计   — William Morris 孔雀织锦面板
 *   产品   — 明嘉靖五彩鱼藻纹盖罐
 *   雕塑   — 卢浮宫《狄安娜与鹿》喷泉雕塑
 */
const styleConfigs = {
  painting: {
    name: '绘画',
    icon: Brush,
    description: '中国画与西方绘画的经典流派',
    coverImage: withAppBase('/images/artworks-real/full/wm-bdfa9e96f2.jpg'),
    coverFallback: artworkImage('painting-styles-cover', { size: 'landscape_4_3', category: 'painting', title: '绘画' }),
  },
  design: {
    name: '设计',
    icon: PenTool,
    description: '视觉传达与平面设计流派',
    coverImage: withAppBase('/images/artworks-real/full/wm-73f07c6cce.jpg'),
    coverFallback: artworkImage('design-styles-cover', { size: 'landscape_4_3', category: 'design', title: '设计' }),
  },
  product: {
    name: '产品设计',
    icon: Box,
    description: '工业设计与家具设计经典',
    coverImage: withAppBase('/images/artworks-real/full/wm-56455993d3.jpg'),
    coverFallback: artworkImage('product-styles-cover', { size: 'landscape_4_3', category: 'product', title: '产品设计' }),
  },
  sculpture: {
    name: '雕塑',
    icon: Layers,
    description: '古今中外的雕塑艺术杰作',
    coverImage: withAppBase('/images/artworks-real/full/wm-c612851da4.jpg'),
    coverFallback: artworkImage('sculpture-styles-cover', { size: 'landscape_4_3', category: 'sculpture', title: '雕塑' }),
  },
  heritage: {
    name: '非遗知识库',
    icon: Landmark,
    description: '中国非物质文化遗产 · 传统工艺与民间艺术',
    coverImage: '/uploads/heritage/full/hr-37106d4730.jpg',
    coverFallback: artworkImage('heritage-styles-cover', { size: 'landscape_4_3', category: 'heritage', title: '非遗' }),
  },
};

/* 非遗知识库科普文案(与 scripts/fetch-heritage.mjs 的 HERITAGE_DESCRIPTIONS 对齐) */
const heritageKnowledge: { style: string; intro: string }[] = [
  { style: '剪纸', intro: '以剪刻纹样装点节庆的纸艺，已有一千五百余年历史。' },
  { style: '京剧脸谱', intro: '以夸张色彩图案表现忠奸善恶的戏曲面部化妆艺术。' },
  { style: '皮影', intro: '借灯光投影兽皮剪刻人物的民间戏剧，被誉为"电影的祖先"。' },
  { style: '刺绣', intro: '苏绣、湘绣、粤绣、蜀绣四大名绣，传统女红的最高体现。' },
  { style: '陶瓷', intro: '以青花瓷为代表的器物艺术，蓝白相映、纹饰精美。' },
  { style: '木版年画', intro: '木版套色印刷的春节民俗版画，门神灶王、色彩浓艳。' },
  { style: '景泰蓝', intro: '铜胎掐丝珐琅，明代景泰年间盛行，釉色斑斓。' },
  { style: '漆器', intro: '以天然生漆涂覆，雕漆、螺钿等技法造就深厚漆文化。' },
  { style: '泥塑', intro: '黏土捏塑彩绘的民间雕塑，泥人张、惠山泥人最为著名。' },
  { style: '唐卡', intro: '藏族宗教卷轴画，矿物颜料绘制佛尊坛城，色彩历久弥新。' },
  { style: '鼻烟壶', intro: '玻璃、玉、瓷等材质的小壶，内画艺术堪称方寸微缩。' },
  { style: '油纸伞', intro: '竹骨纸面涂桐油，江南水乡与客家婚俗的标志性器物。' },
  { style: '扇艺', intro: '折扇、团扇等传统扇艺，集书画、雕刻、编织于一体。' },
  { style: '中国结', intro: '丝线编织的吉祥结饰，寓意团圆美满，传承千年绳艺。' },
  { style: '风筝', intro: '竹篾为骨纸绢为面，扎糊绘放四艺兼备，潍坊北京最知名。' },
];

/** 非遗档案 → ArtworkItem 映射(风格库渲染复用:图片走 /images/heritage/{thumb,full}/<id>.jpg?v=3) */
function heritageToArtworkItem(hw: HeritageWork): ArtworkItem {
  const base = `/images/heritage/thumb/${hw.id}.jpg?v=3`;
  return {
    id: hw.id,
    title: hw.title,
    artist: hw.origin,
    year: hw.dynasty,
    category: 'heritage',
    style: HERITAGE_CATEGORY_LABEL[hw.category],
    era: hw.dynasty,
    region: 'china',
    description: hw.craftFeature,
    imageUrl: resolveHeritageFull(hw),
    thumbUrl: base,
    source: 'heritage-works',
    tags: hw.techniquePoints,
  };
}

export default function StylesPage() {
  const toast = useToast();
  const [selectedCategory, setSelectedCategory] = useState<keyof typeof styleCategories | null>(null);
  const [selectedStyle, setSelectedStyle] = useState<string | null>(null);
  const [selectedArtwork, setSelectedArtwork] = useState<ArtworkItem | null>(null);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [imageLoadStates, setImageLoadStates] = useState<Record<string, 'loading' | 'loaded' | 'error'>>({});
  /* 分类封面图加载状态：独立管理，避免与作品图状态冲突 */
  const [coverLoadStates, setCoverLoadStates] = useState<Record<string, 'loading' | 'loaded' | 'error'>>({});

  /* 素材数据状态 */
  const [artworks, setArtworks] = useState<ArtworkItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  /* 非遗知识库独立数据源(heritage-works.json,570 件十维档案) */
  const [heritageWorks, setHeritageWorks] = useState<HeritageWork[]>([]);
  const [isHeritageLoading, setIsHeritageLoading] = useState(true);

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
        console.error('加载风格库失败:', err);
        if (!cancelled) setIsLoading(false);
      });
    loadHeritageWorks()
      .then((data) => {
        if (!cancelled) {
          setHeritageWorks(data);
          setIsHeritageLoading(false);
        }
      })
      .catch((err) => {
        console.error('加载非遗知识库失败:', err);
        if (!cancelled) setIsHeritageLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const handleImageLoad = (id: string) => {
    setImageLoadStates((prev) => ({ ...prev, [id]: 'loaded' }));
  };

  const handleImageError = (id: string) => {
    setImageLoadStates((prev) => ({ ...prev, [id]: 'error' }));
  };

  const handleCoverLoad = (key: string) => {
    setCoverLoadStates((prev) => ({ ...prev, [key]: 'loaded' }));
  };
  const handleCoverError = (key: string) => {
    setCoverLoadStates((prev) => ({ ...prev, [key]: 'error' }));
  };

  /* ============================================================
   * 性能修复 1: 预分组计数
   * 原实现: 每个分类卡/风格按钮在 render 中对 11734 条数据单独
   *   filter().length,每次渲染执行数十次全量遍历,主线程阻塞。
   * 新实现: artworks 变化时一次遍历,同时产出分类计数和
   *   "分类+风格" 组合计数,render 中 O(1) 查表。
   * ============================================================ */
  const { categoryCounts, styleCounts } = useMemo(() => {
    const catMap: Record<string, number> = {};
    const styleMap: Record<string, number> = {};
    // 普通素材库(绘画/设计/产品/雕塑),排除 heritage(由独立数据源承担)
    for (const a of artworks) {
      if (a.category === 'heritage') continue;
      catMap[a.category] = (catMap[a.category] || 0) + 1;
      const key = `${a.category}::${a.style}`;
      styleMap[key] = (styleMap[key] || 0) + 1;
    }
    // 非遗知识库:以 heritage-works.json(570 件十维档案)为准
    catMap.heritage = heritageWorks.length;
    for (const hw of heritageWorks) {
      const label = HERITAGE_CATEGORY_LABEL[hw.category];
      const key = `heritage::${label}`;
      styleMap[key] = (styleMap[key] || 0) + 1;
    }
    return { categoryCounts: catMap, styleCounts: styleMap };
  }, [artworks, heritageWorks]);

  /* 非遗知识库:标志性作品(优先代表性工艺,取该工艺第一件,来自 570 件独立档案) */
  const heritageIconic = useMemo(() => {
    const items = heritageWorks;
    if (items.length === 0) return null;
    const priority = ['porcelain', 'papercut', 'embroidery', 'shadowpuppet', 'thangka'];
    for (const c of priority) {
      const found = items.find((i) => i.category === c);
      if (found) return heritageToArtworkItem(found);
    }
    return heritageToArtworkItem(items[0]);
  }, [heritageWorks]);

  /* 非遗知识库:10 类工艺 + 各自作品数(以 heritage-works.json 570 件为准) */
  const heritageStyleList = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const a of heritageWorks) {
      counts[HERITAGE_CATEGORY_LABEL[a.category]] = (counts[HERITAGE_CATEGORY_LABEL[a.category]] || 0) + 1;
    }
    // 文案名 ↔ 类目名别名(知识卡片文案沿用历史 15 类名,类目对齐 10 类档案)
    const INTRO_ALIAS: Record<string, string> = { 瓷器: '陶瓷', 年画: '木版年画' };
    return HERITAGE_SUBCATEGORY_OPTIONS
      .filter((o) => o.key !== 'all')
      .map((o) => {
        const key = INTRO_ALIAS[o.label] ?? o.label;
        const knowledge = heritageKnowledge.find((k) => k.style === key);
        return { style: o.label, count: counts[o.label] || 0, intro: knowledge?.intro ?? '' };
      });
  }, [heritageWorks]);

  /* ============================================================
   * 性能修复 2: 作品网格分页渲染
   * 原实现: 选中分类后一次性渲染该分类全部作品(绘画 4939 件),
   *   产生数千个 DOM 节点,浏览器长时间阻塞,布局抖动变形。
   * 新实现: 首屏 24 件,IntersectionObserver 触底追加,
   *   与素材库分页策略一致。切换分类/风格时重置页码。
   * ============================================================ */
  const PAGE_SIZE = 24;
  const [page, setPage] = useState(1);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // 当前筛选下的完整作品列表(数据层,不直接全量渲染)
  const filteredArtworks = useMemo(() => {
    if (!selectedCategory) return [];
    if (selectedCategory === 'heritage') {
      // 非遗知识库:以 heritage-works.json(570 件)为唯一数据源
      const items = heritageWorks.map(heritageToArtworkItem);
      if (selectedStyle) return items.filter((a) => a.style === selectedStyle);
      return items;
    }
    if (selectedStyle) return artworks.filter((a) => a.style === selectedStyle);
    return artworks.filter((a) => a.category === selectedCategory);
  }, [artworks, heritageWorks, selectedCategory, selectedStyle]);

  // 实际渲染的可见切片
  const visibleArtworks = useMemo(
    () => filteredArtworks.slice(0, page * PAGE_SIZE),
    [filteredArtworks, page],
  );
  const hasMore = visibleArtworks.length < filteredArtworks.length;

  // 切换分类/风格时重置到第一页
  useEffect(() => {
    setPage(1);
  }, [selectedCategory, selectedStyle]);

  // 触底加载:观察哨兵元素进入视口时追加一页
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) setPage((p) => p + 1);
      },
      { rootMargin: '600px' }, // 提前 600px 预加载,滚动更顺滑
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, filteredArtworks.length]);

  /* 收藏切换：补全操作反馈，避免"无响应"体验 */
  const toggleFavorite = (id: string, title?: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        toast.info('已取消收藏', title ?? '');
      } else {
        next.add(id);
        toast.success('已收藏', title ?? '作品已加入收藏夹');
      }
      return next;
    });
  };

  return (
    <div className="min-h-screen bg-rice-200 ink-texture pt-20 pb-20">
      {(isLoading || (selectedCategory === 'heritage' && isHeritageLoading)) && (
        <div className="fixed inset-0 bg-rice-200/80 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="flex flex-col items-center">
            <Loader2 className="w-10 h-10 text-cinnabar animate-spin mb-3" />
            <p className="text-ink-700 font-medium">正在加载风格库...</p>
          </div>
        </div>
      )}
      <SkeletonStyle />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-ink-900/5 rounded-full mb-4">
            <BookMarked className="w-4 h-4 text-cinnabar" />
            <span className="text-sm text-ink-600">在线风格库</span>
          </div>
          <h1 className="font-serif text-3xl md:text-4xl font-bold text-ink-900 mb-4">
            艺术风格 · 分类索引
          </h1>
          <p className="text-ink-600 max-w-2xl mx-auto">
            收录{artworks.length}+件海内外艺术作品，覆盖五大创作类型、{Object.values(styleCategories).flatMap(c => c.styles).length}+种风格流派
          </p>
        </div>

        {!selectedCategory ? (
          <>
            {/* 非遗知识库 · 通栏卡片(左图右文) */}
            <div
              className="bg-rice-50 rounded-2xl overflow-hidden shadow-card hover:shadow-card-hover transition-all cursor-pointer mb-8 group"
              onClick={() => setSelectedCategory('heritage')}
            >
              <div className="grid grid-cols-1 md:grid-cols-5">
                {/* 左图:标志性非遗作品 */}
                <div className="md:col-span-2 relative min-h-[280px] bg-ink-900">
                  {heritageIconic ? (
                    <img
                      src={resolveArtworkThumbUrl(heritageIconic)}
                      alt={heritageIconic.title}
                      loading="eager"
                      className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-all duration-700"
                    />
                  ) : (
                    <SkeletonBox className="absolute inset-0" />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-ink-900/80 via-ink-900/10 to-transparent" />
                  <div className="absolute bottom-0 left-0 right-0 p-5">
                    <span className="inline-block px-2.5 py-1 bg-cinnabar text-white text-xs rounded-full mb-2">
                      {heritageIconic?.style || '非遗'}
                    </span>
                    <p className="font-serif text-lg font-bold text-white leading-snug">
                      {heritageIconic?.title || '中国非物质文化遗产'}
                    </p>
                  </div>
                </div>
                {/* 右文:非遗知识科普 */}
                <div className="md:col-span-3 p-6 md:p-8 flex flex-col">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-9 h-9 bg-cinnabar rounded-lg flex items-center justify-center">
                      <Landmark className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <h2 className="font-serif text-2xl font-bold text-ink-900">非遗知识库</h2>
                      <p className="text-sm text-ink-500">{styleConfigs.heritage.description}</p>
                    </div>
                  </div>
                  <p className="text-ink-600 text-sm leading-relaxed mb-5">
                    中国非物质文化遗产是各族人民世代相传的传统技艺与民间艺术瑰宝，涵盖
                    传统美术、传统技艺、传统戏曲与民俗等类别。这里精选 {categoryCounts.heritage || 99} 件
                    代表性作品，附专业科普介绍，帮助理解每项工艺的历史渊源与艺术价值。
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mb-5">
                    {heritageStyleList.slice(0, 6).map((k) => (
                      <div
                        key={k.style}
                        className="flex items-start gap-2.5 p-2.5 rounded-lg bg-rice-100/70 hover:bg-rice-100 transition-all"
                      >
                        <span className="mt-0.5 w-1.5 h-1.5 rounded-full bg-cinnabar shrink-0" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-ink-700">
                            {k.style}
                            <span className="ml-1.5 text-xs text-ink-400">{k.count} 件</span>
                          </p>
                          <p className="text-xs text-ink-500 leading-snug line-clamp-2">{k.intro}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-auto flex items-center justify-between">
                    <div className="flex flex-wrap gap-1.5">
                      {heritageStyleList.slice(0, 8).map((k) => (
                        <span key={k.style} className="px-2 py-0.5 bg-rice-100 text-ink-600 text-xs rounded-full">
                          {k.style}
                        </span>
                      ))}
                    </div>
                    <span className="inline-flex items-center gap-1.5 px-4 py-2 bg-ink-900 text-white text-sm rounded-lg hover:bg-cinnabar transition-all shrink-0">
                      进入知识库
                      <ArrowRight className="w-4 h-4" />
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Category Cards(非遗由上方通栏知识库卡片承载,不入此网格) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
              {Object.entries(styleConfigs)
                .filter(([key]) => key !== 'heritage')
                .map(([key, config]) => {
                const Icon = config.icon;
                const count = categoryCounts[key] || 0;
                const styleCount = styleCategories[key as keyof typeof styleCategories].styles.length;
                
                return (
                  <div
                    key={key}
                    className="bg-rice-50 rounded-2xl overflow-hidden shadow-card hover:shadow-card-hover transition-all group cursor-pointer"
                    onClick={() => setSelectedCategory(key as keyof typeof styleCategories)}
                  >
                    <div className="aspect-[16/9] relative overflow-hidden bg-ink-100">
                      {/* 封面图加载骨架：避免大图加载时空白闪动 */}
                      {coverLoadStates[key] !== 'loaded' && coverLoadStates[key] !== 'error' && (
                        <SkeletonBox className="absolute inset-0 z-10" />
                      )}
                      {coverLoadStates[key] === 'error' ? (
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-rice-100">
                          <ImageOff className="w-8 h-8 text-ink-300 mb-1" />
                          <p className="text-xs text-ink-400">封面加载失败</p>
                        </div>
                      ) : (
                        <img
                          src={config.coverImage}
                          alt={config.name}
                          loading="eager"
                          className={`w-full h-full object-cover group-hover:scale-105 transition-all duration-500 ${
                            coverLoadStates[key] === 'loaded' ? 'opacity-100' : 'opacity-0'
                          }`}
                          onLoad={() => handleCoverLoad(key)}
                          onError={(e) => {
                            // 真实封面失败时回退到内联 SVG 占位(零网络),仍失败才置错误态
                            const img = e.currentTarget;
                            if (img.src !== config.coverFallback) {
                              img.src = config.coverFallback;
                              return;
                            }
                            handleCoverError(key);
                          }}
                        />
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-ink-900/70 via-ink-900/20 to-transparent" />
                      <div className="absolute bottom-0 left-0 right-0 p-6">
                        <div className="flex items-center gap-3 mb-2">
                          <div className="w-10 h-10 bg-cinnabar rounded-lg flex items-center justify-center">
                            <Icon className="w-5 h-5 text-white" />
                          </div>
                          <div>
                            <h3 className="font-serif text-xl font-bold text-white">{config.name}</h3>
                            <p className="text-sm text-white/70">{config.description}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="p-4 flex items-center justify-between">
                      <div className="flex items-center gap-4 text-sm text-ink-500">
                        <span>{count} 件作品</span>
                        <span>·</span>
                        <span>{styleCount} 种风格</span>
                      </div>
                      <ArrowRight className="w-5 h-5 text-ink-400 group-hover:text-cinnabar group-hover:translate-x-1 transition-all" />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Quick Stats */}
            <div className="bg-rice-50 rounded-2xl p-6 shadow-card mb-8">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {Object.entries(styleCategories).map(([key, cat]) => {
                  const config = styleConfigs[key as keyof typeof styleConfigs];
                  const Icon = config.icon;
                  const count = categoryCounts[key] || 0;
                  return (
                    <div
                      key={key}
                      className="flex items-center gap-3 p-3 rounded-xl hover:bg-rice-100 cursor-pointer transition-all"
                      onClick={() => setSelectedCategory(key as keyof typeof styleCategories)}
                    >
                      <div className="w-10 h-10 bg-ink-900/5 rounded-lg flex items-center justify-center">
                        <Icon className="w-5 h-5 text-ink-600" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-ink-700">{cat.name}</p>
                        <p className="text-xs text-ink-500">{count} 件</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Popular Styles */}
            <div className="bg-rice-50 rounded-2xl p-6 shadow-card">
              <h3 className="font-serif text-lg font-bold text-ink-900 mb-4">热门风格</h3>
              <div className="flex flex-wrap gap-3">
                {Object.entries(styleCategories).flatMap(([key, cat]) =>
                  cat.styles.map((style) => {
                    const count = styleCounts[`${key}::${style}`] || 0;
                    return (
                      <button
                        key={`${key}-${style}`}
                        onClick={() => {
                          setSelectedCategory(key as keyof typeof styleCategories);
                          setSelectedStyle(style);
                        }}
                        className="px-4 py-2 bg-rice-100 text-ink-700 rounded-full text-sm hover:bg-cinnabar hover:text-white transition-all"
                      >
                        {style}
                        <span className="ml-2 text-xs opacity-60">({count})</span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </>
        ) : (
          <>
            {/* Category Detail */}
            <div className="mb-6">
              <button
              onClick={() => {
                setSelectedCategory(null);
                setSelectedStyle(null);
              }}
              aria-label="返回分类"
              className="flex items-center gap-2 text-ink-500 hover:text-ink-700 mb-4"
            >
                <ArrowRight className="w-4 h-4 rotate-180" />
                <span>返回分类</span>
              </button>
              
              <div className="bg-rice-50 rounded-2xl p-6 shadow-card">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-12 h-12 bg-cinnabar rounded-lg flex items-center justify-center">
                    {(() => {
                      const Icon = styleConfigs[selectedCategory].icon;
                      return <Icon className="w-6 h-6 text-white" />;
                    })()}
                  </div>
                  <div>
                    <h2 className="font-serif text-2xl font-bold text-ink-900">
                      {styleCategories[selectedCategory].name}
                    </h2>
                    <p className="text-ink-500">{styleConfigs[selectedCategory].description}</p>
                  </div>
                </div>

                {/* Style Tags(heritage 模式:非遗十类工艺,与 570 件档案类目一致) */}
                <div className="flex flex-wrap gap-2 mb-4">
                  <button
                    onClick={() => setSelectedStyle(null)}
                    className={`px-4 py-2 rounded-full text-sm transition-all ${
                      !selectedStyle
                        ? 'bg-cinnabar text-white'
                        : 'bg-rice-100 text-ink-700 hover:bg-rice-200'
                    }`}
                  >
                    全部
                  </button>
                  {(selectedCategory === 'heritage'
                    ? HERITAGE_SUBCATEGORY_OPTIONS.filter((o) => o.key !== 'all').map((o) => o.label)
                    : styleCategories[selectedCategory].styles
                  ).map((style) => {
                    const count = styleCounts[`${selectedCategory}::${style}`] || 0;
                    if (count === 0) return null;
                    return (
                      <button
                        key={style}
                        onClick={() => setSelectedStyle(style)}
                        className={`px-4 py-2 rounded-full text-sm transition-all ${
                          selectedStyle === style
                            ? 'bg-cinnabar text-white'
                            : 'bg-rice-100 text-ink-700 hover:bg-rice-200'
                        }`}
                      >
                        {style}
                        <span className="ml-1 text-xs opacity-60">({count})</span>
                      </button>
                    );
                  })}
                </div>

                {/* Stats */}
                <div className="grid grid-cols-3 gap-4 text-center mb-6">
                  <div className="bg-rice-50 rounded-lg p-3">
                    <p className="text-2xl font-bold text-ink-900">
                      {filteredArtworks.length}
                    </p>
                    <p className="text-xs text-ink-500">件作品</p>
                  </div>
                  <div className="bg-rice-50 rounded-lg p-3">
                    <p className="text-2xl font-bold text-ink-900">
                      {selectedCategory === 'heritage'
                        ? HERITAGE_SUBCATEGORY_OPTIONS.filter((o) => o.key !== 'all').length
                        : styleCategories[selectedCategory].styles.length}
                    </p>
                    <p className="text-xs text-ink-500">种工艺</p>
                  </div>
                  <div className="bg-rice-50 rounded-lg p-3">
                    <p className="text-2xl font-bold text-ink-900">
                      {selectedCategory === 'heritage'
                        ? heritageWorks.length
                        : styleCategories[selectedCategory].eras.length}
                    </p>
                    <p className="text-xs text-ink-500">{selectedCategory === 'heritage' ? '件档案' : '个时代'}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Artworks Grid:分页渲染,触底加载更多 */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {visibleArtworks.map((artwork) => (
                <div
                  key={artwork.id}
                  className="bg-rice-50 rounded-2xl overflow-hidden shadow-card hover:shadow-card-hover transition-all group cursor-pointer"
                  onClick={() => setSelectedArtwork(artwork)}
                >
                  <div className="aspect-[4/3] overflow-hidden relative bg-ink-100">
                    {/* 骨架屏:初始(undefined)和 loading 状态都显示,
                        图片加载完成后隐藏。absolute 定位不撑开容器。 */}
                    {imageLoadStates[artwork.id] !== 'loaded' && imageLoadStates[artwork.id] !== 'error' && (
                      <SkeletonBox className="absolute inset-0 z-10" />
                    )}
                    {imageLoadStates[artwork.id] === 'error' ? (
                      <div className="absolute inset-0 flex flex-col items-center justify-center bg-rice-100">
                        <ImageOff className="w-10 h-10 text-ink-300 mb-2" />
                        <p className="text-xs text-ink-400">图片加载失败</p>
                      </div>
                    ) : (
                      /* img 用 absolute inset-0 脱离文档流:容器高度完全由
                         aspect-[4/3] 决定,超宽横幅(长卷类)图片不会把
                         容器压扁,object-cover 负责裁切填充。 */
                      <img
                        src={resolveArtworkThumbUrl(artwork)}
                        alt={artwork.title}
                        className={`absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-all duration-500 ${
                          imageLoadStates[artwork.id] === 'loaded' ? 'opacity-100' : 'opacity-0'
                        }`}
                        loading="lazy"
                        onLoad={() => handleImageLoad(artwork.id)}
                        onError={() => handleImageError(artwork.id)}
                      />
                    )}
                    <div className="absolute top-3 left-3 flex gap-2">
                      <span className="px-2 py-0.5 bg-cinnabar/90 text-white text-xs rounded-full">
                        {artwork.style}
                      </span>
                      <span className="px-2 py-0.5 bg-ink-900/70 text-white text-xs rounded-full">
                        {artwork.era}
                      </span>
                    </div>
                  </div>
                  <div className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <h3 className="font-serif text-lg font-bold text-ink-900">{artwork.title}</h3>
                        <p className="text-sm text-ink-500">{artwork.artist}</p>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleFavorite(artwork.id, artwork.title);
                        }}
                        aria-label={favorites.has(artwork.id) ? '取消收藏' : '收藏'}
                        className="p-1.5 rounded-full hover:bg-rice-100 transition-all"
                      >
                        <Heart
                          className={`w-4 h-4 ${
                            favorites.has(artwork.id) ? 'text-cinnabar fill-cinnabar' : 'text-ink-400'
                          }`}
                        />
                      </button>
                    </div>
                    <p className="text-sm text-ink-600 line-clamp-2">{artwork.description}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* 触底加载哨兵:进入视口时自动追加下一页 */}
            {hasMore && (
              <div ref={sentinelRef} className="flex items-center justify-center gap-2 py-8 text-ink-400">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-sm">
                  已加载 {visibleArtworks.length} / {filteredArtworks.length} 件,下滑加载更多
                </span>
              </div>
            )}
            {!hasMore && filteredArtworks.length > PAGE_SIZE && (
              <p className="text-center text-sm text-ink-400 py-8">
                已展示全部 {filteredArtworks.length} 件作品
              </p>
            )}
          </>
        )}

        {/* Artwork Detail Modal */}
        {selectedArtwork && (
          <div
            className="fixed inset-0 bg-ink-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setSelectedArtwork(null)}
          >
            <div
              className="bg-rice-50 rounded-2xl overflow-hidden max-w-5xl w-full max-h-[90vh] flex flex-col md:flex-row"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="md:w-3/5 relative bg-ink-900 flex items-center justify-center min-h-[300px]">
                {imageLoadStates[selectedArtwork.id] !== 'loaded' && imageLoadStates[selectedArtwork.id] !== 'error' && (
                  <div className="absolute inset-0 flex items-center justify-center z-10">
                    <Loader2 className="w-10 h-10 text-ink-500 animate-spin" />
                  </div>
                )}
                {imageLoadStates[selectedArtwork.id] === 'error' ? (
                  <div className="flex flex-col items-center justify-center py-16">
                    <ImageOff className="w-12 h-12 text-ink-600 mb-3" />
                    <p className="text-sm text-ink-400">图片加载失败</p>
                  </div>
                ) : (
                  <img
                    src={selectedArtwork.imageUrl}
                    alt={selectedArtwork.title}
                    loading="lazy"
                    className={`w-full h-full object-contain max-h-[60vh] md:max-h-[80vh] transition-opacity duration-500 ${
                      imageLoadStates[selectedArtwork.id] === 'loaded' ? 'opacity-100' : 'opacity-0'
                    }`}
                    onLoad={() => handleImageLoad(selectedArtwork.id)}
                    onError={() => handleImageError(selectedArtwork.id)}
                  />
                )}
                <div className="absolute top-3 left-3 flex gap-2">
                  <span className="px-2 py-1 bg-cinnabar text-white text-sm rounded-full">
                    {selectedArtwork.style}
                  </span>
                  <span className="px-2 py-1 bg-ink-900/80 text-white text-sm rounded-full">
                    {selectedArtwork.era}
                  </span>
                </div>
              </div>
              <div className="md:w-2/5 p-6 overflow-y-auto max-h-[40vh] md:max-h-[80vh]">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h2 className="font-serif text-2xl font-bold text-ink-900">{selectedArtwork.title}</h2>
                    {selectedArtwork.titleEn && (
                      <p className="text-sm text-ink-400 italic">{selectedArtwork.titleEn}</p>
                    )}
                  </div>
                  <button
                    onClick={() => setSelectedArtwork(null)}
                    aria-label="关闭"
                    className="p-2 hover:bg-rice-100 rounded-full transition-all"
                  >
                    <X className="w-5 h-5 text-ink-700" />
                  </button>
                </div>

                <div className="mb-4">
                  <p className="text-ink-500">
                    <span className="font-medium text-ink-700">{selectedArtwork.artist}</span>
                    {selectedArtwork.artistEn && <span className="text-sm text-ink-400 ml-1">({selectedArtwork.artistEn})</span>}
                    <span className="mx-2">·</span>
                    {selectedArtwork.year}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="bg-rice-50 rounded-lg p-3">
                    <p className="text-xs text-ink-500">风格</p>
                    <p className="text-sm font-medium text-ink-700">{selectedArtwork.style}</p>
                  </div>
                  <div className="bg-rice-50 rounded-lg p-3">
                    <p className="text-xs text-ink-500">时代</p>
                    <p className="text-sm font-medium text-ink-700">{selectedArtwork.era}</p>
                  </div>
                  {selectedArtwork.dimensions && (
                    <div className="bg-rice-50 rounded-lg p-3">
                      <p className="text-xs text-ink-500">尺寸</p>
                      <p className="text-sm font-medium text-ink-700">{selectedArtwork.dimensions}</p>
                    </div>
                  )}
                  {selectedArtwork.medium && (
                    <div className="bg-rice-50 rounded-lg p-3">
                      <p className="text-xs text-ink-500">材质</p>
                      <p className="text-sm font-medium text-ink-700">{selectedArtwork.medium}</p>
                    </div>
                  )}
                </div>

                <div className="mb-4">
                  <p className="text-sm font-medium text-ink-700 mb-2">作品介绍</p>
                  <p className="text-sm text-ink-600 leading-relaxed">{selectedArtwork.description}</p>
                </div>

                <div className="mb-4">
                  <p className="text-sm font-medium text-ink-700 mb-2">标签</p>
                  <div className="flex flex-wrap gap-2">
                    {selectedArtwork.tags.map((tag) => (
                      <span key={tag} className="px-3 py-1 bg-ink-900/5 text-ink-700 text-sm rounded-full">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="mb-4 p-3 bg-rice-50 rounded-lg">
                  <p className="text-xs text-ink-500 mb-1">图片来源</p>
                  <p className="text-sm text-ink-700 flex items-center gap-1">
                    <Globe className="w-3 h-3" />
                    {selectedArtwork.source}
                  </p>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={() => toggleFavorite(selectedArtwork.id, selectedArtwork.title)}
                    aria-label={favorites.has(selectedArtwork.id) ? '取消收藏' : '收藏'}
                    className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg transition-all ${
                      favorites.has(selectedArtwork.id)
                        ? 'bg-cinnabar text-white'
                        : 'border-2 border-ink-200 text-ink-700 hover:border-cinnabar hover:text-cinnabar'
                    }`}
                  >
                    <Heart className={`w-4 h-4 ${favorites.has(selectedArtwork.id) ? 'fill-white' : ''}`} />
                    <span className="text-sm font-medium">
                      {favorites.has(selectedArtwork.id) ? '已收藏' : '收藏'}
                    </span>
                  </button>
                  {selectedArtwork.sourceUrl && (
                    <a
                      href={selectedArtwork.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 border-2 border-ink-200 text-ink-700 rounded-lg hover:border-ink-900 transition-all"
                    >
                      <ExternalLink className="w-4 h-4" />
                      <span className="text-sm font-medium">查看原图</span>
                    </a>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}