/**
 * 在线艺术作品数据库服务
 * ------------------------------------------------------------
 * 改造要点(阶段2E:9999条素材 + 视觉化缩略图):
 *   1. 不再硬编码作品数据,改为从 /data/artworks.json 异步加载
 *   2. 图片 URL 使用私有协议 __ARTWORK_IMAGE__:seed,
 *      加载时解析为 artworkImage() 生成的内联 SVG data URI
 *   3. artworksDatabase 变量保留为可填充数组,保持旧引用兼容
 *   4. 搜索/筛选函数在缓存加载前后均可工作(空数据时返回空结果)
 */

import { artworkImage, type ArtworkCategory } from './artworkImage';

export interface ArtworkItem {
  id: string;
  title: string;
  titleEn?: string;
  artist: string;
  artistEn?: string;
  year: string;
  category: 'painting' | 'design' | 'product' | 'sculpture' | 'calligraphy' | 'architecture' | 'heritage';
  style: string;
  era: string;
  region: 'china' | 'east-asia' | 'europe' | 'america' | 'other';
  description: string;
  imageUrl: string;
  thumbUrl?: string;
  /** 缩略图实际宽高(保比例缩略图):用于前端按自然比例渲染容器,消除裁剪与白边 */
  thumbW?: number;
  thumbH?: number;
  source: string;
  sourceUrl?: string;
  tags: string[];
  dimensions?: string;
  medium?: string;
}

// 风格库标签配置(风格库页面仅展示四大经典类型)
export const styleCategories = {
  painting: {
    name: '绘画',
    styles: ['水墨', '工笔', '写意', '青绿', '金碧', '没骨', '泼彩', '油画', '水彩', '素描', '版画', '壁画'],
    eras: ['唐代', '宋代', '元代', '明代', '清代', '近现代', '文艺复兴', '巴洛克', '印象派', '现代主义'],
    subjects: ['山水', '花鸟', '人物', '仕女', '宗教', '历史', '风俗', '静物', '肖像', '抽象'],
  },
  design: {
    name: '设计',
    styles: ['极简主义', '包豪斯', '装饰艺术', '新艺术运动', '后现代', '数字艺术'],
    eras: ['20世纪初', '二战时期', '战后', '当代'],
    subjects: ['海报', '书籍装帧', '字体设计', '品牌标识', '包装设计', 'UI界面'],
  },
  product: {
    name: '产品设计',
    styles: ['功能主义', '流线型', '有机设计', '北欧风格', '日式设计'],
    eras: ['工业革命', '20世纪', '当代'],
    subjects: ['家具', '灯具', '电子产品', '陶瓷器', '玻璃器', '金属工艺'],
  },
  sculpture: {
    name: '雕塑',
    styles: ['写实', '抽象', '装置', '动态雕塑', '大地艺术'],
    eras: ['古代', '中世纪', '文艺复兴', '现代', '当代'],
    subjects: ['人物雕塑', '动物雕塑', '宗教雕塑', '纪念碑', '园林雕塑'],
  },
  heritage: {
    name: '非遗知识库',
    styles: ['剪纸', '京剧脸谱', '皮影', '刺绣', '陶瓷', '木版年画', '景泰蓝', '漆器', '泥塑', '唐卡', '鼻烟壶', '油纸伞', '扇艺', '中国结', '风筝'],
    eras: ['传统', '近现代', '当代'],
    subjects: ['纹样', '器物', '戏曲', '民俗', '宗教', '服饰', '节日'],
  },
};

const ARTWORK_IMAGE_PREFIX = '__ARTWORK_IMAGE__:';

let cachedArtworks: ArtworkItem[] | null = null;
let loadPromise: Promise<ArtworkItem[]> | null = null;

/**
 * 初始空数组,加载完成后会被填充。
 * 保持旧代码 `import { artworksDatabase } from './artworksDatabase'` 的引用有效。
 */
export const artworksDatabase: ArtworkItem[] = [];

/* ============================================================
 * 内存倒排索引:支撑 9999 条素材的快速搜索与筛选统计
 *
 * 设计原则:
 *   1. 数据加载成功后一次性构建,后续搜索复用
 *   2. 按分类/风格/时代/地区/标签建立 Set 索引,多条件取交集
 *   3. 关键词建立字/词级倒排索引,先粗筛再精排(substring 验证)
 *   4. 不预生成大体积索引文件,纯运行时内存索引,服务端零开销
 * ============================================================ */

interface ArtworkSearchIndex {
  /** 分类 -> 作品下标集合 */
  byCategory: Map<string, Set<number>>;
  /** 风格 -> 作品下标集合 */
  byStyle: Map<string, Set<number>>;
  /** 时代 -> 作品下标集合 */
  byEra: Map<string, Set<number>>;
  /** 地区 -> 作品下标集合 */
  byRegion: Map<string, Set<number>>;
  /** 标签 -> 作品下标集合 */
  byTag: Map<string, Set<number>>;
  /** 关键词(中文单字/英文单词) -> 作品下标集合 */
  byKeyword: Map<string, Set<number>>;
}

let searchIndex: ArtworkSearchIndex | null = null;

/** 索引构建耗时日志阈值(ms) */
const INDEX_PERF_THRESHOLD = 20;

function addToIndex(map: Map<string, Set<number>>, key: string, idx: number): void {
  let set = map.get(key);
  if (!set) {
    set = new Set<number>();
    map.set(key, set);
  }
  set.add(idx);
}

/** 提取中文单字与英文单词作为索引词 */
function tokenize(text: string): string[] {
  const tokens = new Set<string>();
  const normalized = text.toLowerCase();

  // 英文/数字单词
  const words = normalized.match(/[a-z0-9]+/g);
  if (words) {
    for (const w of words) {
      tokens.add(w);
    }
  }

  // 中文单字
  for (const char of normalized) {
    if (/[\u4e00-\u9fa5]/.test(char)) {
      tokens.add(char);
    }
  }

  return Array.from(tokens);
}

function buildSearchIndex(items: ArtworkItem[]): ArtworkSearchIndex {
  const t0 = performance.now();
  const byCategory = new Map<string, Set<number>>();
  const byStyle = new Map<string, Set<number>>();
  const byEra = new Map<string, Set<number>>();
  const byRegion = new Map<string, Set<number>>();
  const byTag = new Map<string, Set<number>>();
  const byKeyword = new Map<string, Set<number>>();

  items.forEach((item, idx) => {
    addToIndex(byCategory, item.category, idx);
    addToIndex(byStyle, item.style, idx);
    addToIndex(byEra, item.era, idx);
    addToIndex(byRegion, item.region, idx);
    item.tags.forEach((tag) => addToIndex(byTag, tag, idx));

    const searchText = `${item.title} ${item.titleEn ?? ''} ${item.artist} ${item.artistEn ?? ''} ${item.description} ${item.tags.join(' ')}`;
    for (const token of tokenize(searchText)) {
      addToIndex(byKeyword, token, idx);
    }
  });

  const elapsed = performance.now() - t0;
  if (elapsed > INDEX_PERF_THRESHOLD) {
    console.warn(`[artworksDatabase] 索引构建耗时 ${elapsed.toFixed(1)}ms,作品数 ${items.length}`);
  }

  return { byCategory, byStyle, byEra, byRegion, byTag, byKeyword };
}

/** 多个 Set 取交集,返回 number[] */
function intersectSets(sets: Array<Set<number> | undefined>): number[] {
  const validSets = sets.filter((s): s is Set<number> => s !== undefined && s.size > 0);
  if (validSets.length === 0) return [];
  if (validSets.length === 1) return Array.from(validSets[0]);

  // 按大小排序,优先遍历最小集合
  validSets.sort((a, b) => a.size - b.size);
  const [first, ...rest] = validSets;
  const result: number[] = [];
  for (const idx of first) {
    if (rest.every((s) => s.has(idx))) {
      result.push(idx);
    }
  }
  return result;
}

export interface FilterCounts {
  category: Record<string, number>;
  style: Record<string, number>;
  era: Record<string, number>;
  region: Record<string, number>;
  tag: Record<string, number>;
}

/**
 * 基于索引快速统计各维度数量(避免每次扫描 9999 条)
 *
 * @param items 当前素材列表,用于在索引尚未构建时兜底构建
 */
export function getFilterCounts(items: ArtworkItem[] = getBuiltinArtworks()): FilterCounts {
  const idx = searchIndex ?? (items.length > 0 ? buildSearchIndex(items) : null);
  if (!idx) {
    return { category: {}, style: {}, era: {}, region: {}, tag: {} };
  }

  const countMap = (map: Map<string, Set<number>>): Record<string, number> => {
    const result: Record<string, number> = {};
    map.forEach((set, key) => {
      result[key] = set.size;
    });
    return result;
  };

  return {
    category: countMap(idx.byCategory),
    style: countMap(idx.byStyle),
    era: countMap(idx.byEra),
    region: countMap(idx.byRegion),
    tag: countMap(idx.byTag),
  };
}

/**
 * 根绝对路径(如 /images/...)补应用 base 前缀。
 * 应用部署在 /app/ 子路径,浏览器直接请求 /images/... 会命中官网 SPA 兜底,
 * 返回 text/html 导致图片解码失败。dev 下 BASE_URL='/' 时保持原样。
 */
export function withAppBase(url: string): string {
  if (!url.startsWith('/')) return url;
  const base = import.meta.env.BASE_URL || '/';
  return base === '/' ? url : base.replace(/\/$/, '') + url;
}

/** 将 __ARTWORK_IMAGE__:seed 协议解析为内联 SVG data URI */
function resolveProtocolUrl(url: string, item: ArtworkItem): string {
  if (url.startsWith(ARTWORK_IMAGE_PREFIX)) {
    const seed = url.slice(ARTWORK_IMAGE_PREFIX.length);
    return artworkImage(seed, {
      category: item.category as ArtworkCategory,
      style: item.style,
      title: item.title,
      subtitle: item.artist,
      size: 'landscape_4_3',
    });
  }
  // /uploads/ 由 nginx 在根路径提供(COS 挂载),不加 /app/ 前缀
  if (url.startsWith('/uploads/')) return url;
  return withAppBase(url);
}

/** 为单个作品生成视觉化缩略图 URL */
export function resolveArtworkImageUrl(item: ArtworkItem): ArtworkItem {
  return {
    ...item,
    imageUrl: resolveProtocolUrl(item.imageUrl, item),
  };
}

/**
 * 解析列表用缩略图 URL:优先 thumbUrl(640x360,约 18KB),
 * 无 thumbUrl 时回退 imageUrl。列表卡片应始终用此函数,
 * 详情弹窗才使用 resolveArtworkImageUrl 加载原图。
 */
export function resolveArtworkThumbUrl(item: ArtworkItem): string {
  const raw = item.thumbUrl || item.imageUrl;
  return resolveProtocolUrl(raw, item);
}

/**
 * 兜底图 URL:始终返回本地生成的内联 SVG(零网络,永不错裂)。
 * 当真实 PNG/JPG 加载失败(404/网络异常)时,useLazyImage 自动切换到此地址,
 * 保证演示场景下任何素材都有视觉呈现。seed 取作品 id,风格与标题保持一致。
 */
export function resolveArtworkFallbackUrl(item: ArtworkItem): string {
  return artworkImage(item.id, {
    category: item.category as ArtworkCategory,
    style: item.style,
    title: item.title,
    subtitle: item.artist,
    size: 'landscape_4_3',
  });
}

/**
 * 异步加载内置艺术作品库
 * 幂等:已加载或正在加载时返回同一 Promise
 */
export async function loadBuiltinArtworks(): Promise<ArtworkItem[]> {
  if (cachedArtworks) return cachedArtworks;
  if (loadPromise) return loadPromise;

  // 支持 ?mock=1 切换到 mock 数据(本地测试标签展开/次级标签显示逻辑)
  const useMock = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('mock') === '1';
  const url = useMock ? 'data/artworks-mock.json' : 'data/artworks.json';

  loadPromise = fetch(url)
    .then(async (res) => {
      if (!res.ok) throw new Error(`加载素材库失败: ${res.status}`);
      const data = (await res.json()) as { total: number; items: ArtworkItem[] };
      // 注意：此处不一次性解析全部 SVG，避免主线程阻塞。
      // imageUrl 保持 __ARTWORK_IMAGE__:seed 协议，组件渲染时按需解析。
      cachedArtworks = data.items;
      // 保持 artworksDatabase 数组引用,填充数据
      artworksDatabase.length = 0;
      artworksDatabase.push(...data.items);
      // 构建内存倒排索引,支撑后续快速搜索与筛选统计
      searchIndex = buildSearchIndex(data.items);
      return data.items;
    })
    .catch((err) => {
      console.error('加载素材库失败:', err);
      cachedArtworks = [];
      artworksDatabase.length = 0;
      searchIndex = null;
      return [];
    });

  return loadPromise;
}

/** 同步获取已缓存的作品(未加载时返回空数组) */
export function getBuiltinArtworks(): ArtworkItem[] {
  return cachedArtworks ?? [];
}

/** 是否已完成加载 */
export function isBuiltinArtworksLoaded(): boolean {
  return cachedArtworks !== null;
}

/**
 * 从素材库搜索作品
 *
 * 实现策略:
 *   1. 当内存索引已构建时,优先使用 Set 索引取交集,避免全量扫描
 *   2. 关键词搜索先通过倒排索引粗筛,再对候选集做 substring 精排,
 *      保证与旧行为一致(支持中英文混合、部分匹配)
 *   3. 索引未就绪时(如首次加载前),回退到线性扫描
 */
export function searchArtworks(query: {
  keyword?: string;
  category?: string;
  style?: string;
  era?: string;
  region?: string;
  artist?: string;
  tags?: string[];
}): ArtworkItem[] {
  const db = getBuiltinArtworks();
  const idx = searchIndex;

  if (!idx) {
    // 索引未就绪:回退线性扫描(首次加载前或加载失败)
    return linearSearch(db, query);
  }

  // 结构化条件通过索引快速定位候选下标
  const candidateSets: Array<Set<number> | undefined> = [];

  if (query.category && query.category !== '全部') {
    candidateSets.push(idx.byCategory.get(query.category));
  }
  if (query.style && query.style !== '全部') {
    candidateSets.push(idx.byStyle.get(query.style));
  }
  if (query.era && query.era !== '全部') {
    candidateSets.push(idx.byEra.get(query.era));
  }
  if (query.region && query.region !== '全部') {
    candidateSets.push(idx.byRegion.get(query.region));
  }
  if (query.tags && query.tags.length > 0) {
    for (const tag of query.tags) {
      candidateSets.push(idx.byTag.get(tag));
    }
  }

  let candidateIdx: number[];
  if (candidateSets.length === 0) {
    candidateIdx = db.map((_, i) => i);
  } else if (candidateSets.some((s) => s === undefined || s.size === 0)) {
    // 任一结构化条件无命中,直接返回空
    return [];
  } else {
    candidateIdx = intersectSets(candidateSets);
  }

  // 关键词精排
  if (query.keyword) {
    const kw = query.keyword.toLowerCase();
    const kwTokens = tokenize(query.keyword);
    const tokenSets = kwTokens.map((t) => idx.byKeyword.get(t)).filter((s): s is Set<number> => s !== undefined);

    // 若关键词能命中索引,先用索引进一步缩小候选范围
    if (tokenSets.length > 0) {
      const tokenHits = new Set(intersectSets(tokenSets));
      candidateIdx = candidateIdx.filter((i) => tokenHits.has(i));
    }

    candidateIdx = candidateIdx.filter((i) => {
      const a = db[i];
      const hay = `${a.title} ${a.titleEn ?? ''} ${a.artist} ${a.artistEn ?? ''} ${a.description} ${a.tags.join(' ')}`.toLowerCase();
      return hay.includes(kw);
    });
  }

  // artist 字段单独处理(支持中英文艺术家名)
  if (query.artist) {
    const artistKw = query.artist.toLowerCase();
    candidateIdx = candidateIdx.filter((i) => {
      const a = db[i];
      return a.artist.includes(query.artist!) || a.artistEn?.toLowerCase().includes(artistKw) === true;
    });
  }

  return candidateIdx.map((i) => db[i]);
}

/** 线性扫描回退(索引未就绪时使用,保持与旧行为一致) */
function linearSearch(
  db: ArtworkItem[],
  query: {
    keyword?: string;
    category?: string;
    style?: string;
    era?: string;
    region?: string;
    artist?: string;
    tags?: string[];
  }
): ArtworkItem[] {
  let results = [...db];

  if (query.keyword) {
    const kw = query.keyword.toLowerCase();
    results = results.filter(
      (a) =>
        a.title.includes(query.keyword!) ||
        a.titleEn?.toLowerCase().includes(kw) ||
        a.artist.includes(query.keyword!) ||
        a.artistEn?.toLowerCase().includes(kw) ||
        a.description.includes(query.keyword!) ||
        a.tags.some((t) => t.includes(query.keyword!))
    );
  }

  if (query.category && query.category !== '全部') {
    results = results.filter((a) => a.category === query.category);
  }

  if (query.style && query.style !== '全部') {
    results = results.filter((a) => a.style === query.style);
  }

  if (query.era && query.era !== '全部') {
    results = results.filter((a) => a.era === query.era);
  }

  if (query.region && query.region !== '全部') {
    results = results.filter((a) => a.region === query.region);
  }

  if (query.artist) {
    results = results.filter(
      (a) => a.artist.includes(query.artist!) || a.artistEn?.toLowerCase().includes(query.artist!.toLowerCase())
    );
  }

  if (query.tags && query.tags.length > 0) {
    results = results.filter((a) => query.tags!.some((t) => a.tags.includes(t)));
  }

  return results;
}

// 获取所有唯一的筛选选项
export function getFilterOptions() {
  const db = getBuiltinArtworks();
  const categories = new Set<string>();
  const styles = new Set<string>();
  const eras = new Set<string>();
  const regions = new Set<string>();
  const artists = new Set<string>();
  const allTags = new Set<string>();

  db.forEach((a) => {
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
}

// 按标签分组获取作品
export function getArtworksByTag(tag: string): ArtworkItem[] {
  return getBuiltinArtworks().filter((a) => a.tags.includes(tag));
}

// 获取随机推荐作品
export function getRandomArtworks(count: number = 6): ArtworkItem[] {
  const db = getBuiltinArtworks();
  const shuffled = [...db].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

// 获取特定类别的所有风格
export function getStylesByCategory(category: string): string[] {
  return Array.from(new Set(getBuiltinArtworks().filter((a) => a.category === category).map((a) => a.style)));
}

// 获取特定类别的所有时代
export function getErasByCategory(category: string): string[] {
  return Array.from(new Set(getBuiltinArtworks().filter((a) => a.category === category).map((a) => a.era)));
}

export default artworksDatabase;
