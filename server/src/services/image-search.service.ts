// ============================================================
// 实时图片搜索服务(P0 落地实现)
//
// 实现范围:
//   - 关键词全文检索(中文二元分词 + 英文单词分词,复用 knowledge 思路)
//   - 倒排索引(token → imageIds),字段加权评分
//     title×5 / tags×4 / category×2
//   - 关键词联想补全(基于索引 token 集前缀匹配)
//   - 标签(AND)/ 分类 / 作品类型 / 状态 筛选
//   - 多租户数据隔离(每租户独立存储与索引)
//   - CRUD + 角色权限强制(student 仅可见 published)
//   - 种子数据(艺术作品图片样本)
//
// 对应文档:docs/realtime-image-search-solution.md
// 性能目标:搜索延迟 ≤300ms(进程内存索引 + 线性扫描,小数据量场景下足够)
// ============================================================

import { randomUUID } from 'node:crypto';
import type {
  ArtType,
  CreateImageRequest,
  ImageDoc,
  ImageSearchQuery,
  ImageSearchResponse,
  ImageStatus,
  ImageSuggestQuery,
  ImageSuggestResponse,
  UpdateImageRequest,
  UserRole,
} from '../types/api-contract.js';
import { logger } from '../utils/logger.js';

// ============================================================
// 1. 分词器(中文二元 + 英文单词)
// ============================================================

/** 中文 Unicode 区间判断 */
function isCJK(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return (
    (code >= 0x4e00 && code <= 0x9fff) || // CJK 统一表意文字
    (code >= 0x3400 && code <= 0x4dbf) || // 扩展 A
    (code >= 0xf900 && code <= 0xfaff) // 兼容表意文字
  );
}

/**
 * 文本分词:
 * - 英文/数字:按非字母数字切分,小写化
 * - 中文:连续中文片段切为滑动窗口二元组(bigram),单字保留
 */
export function tokenize(text: string): string[] {
  if (!text) return [];
  const tokens: string[] = [];
  const segments = text.toLowerCase().split(/([一-鿿㐀-䶿豈-﫿]+)/u);
  for (const seg of segments) {
    if (!seg) continue;
    if (isCJK(seg[0] ?? '')) {
      if (seg.length === 1) {
        tokens.push(seg);
      } else {
        for (let i = 0; i < seg.length - 1; i++) {
          tokens.push(seg.slice(i, i + 2));
        }
      }
    } else {
      const words = seg.match(/[a-z0-9]+/g);
      if (words) tokens.push(...words);
    }
  }
  return tokens;
}

// ============================================================
// 2. 租户级存储与倒排索引
// ============================================================

/** 倒排索引:token → Set<imageId> */
type InvertedIndex = Map<string, Set<string>>;

interface TenantStore {
  /** 图片条目:imageId → ImageDoc */
  images: Map<string, ImageDoc>;
  /** 倒排索引:token → imageId 集合 */
  index: InvertedIndex;
  /** 索引构建时间 */
  lastBuildAt: string | null;
  /** 是否已加载种子数据 */
  seeded: boolean;
}

/** 全局存储:tenantId → TenantStore */
const stores = new Map<string, TenantStore>();

/** 索引字段权重(与方案文档第8节一致) */
const FIELD_WEIGHTS = {
  title: 5,
  tags: 4,
  category: 2,
} as const;

/**
 * 将图片条目写入倒排索引
 * 仅索引 title / tags / category 三个字段(图片无正文内容)
 */
function indexImage(store: TenantStore, image: ImageDoc): void {
  const fields: Array<[string, number]> = [
    [image.title, FIELD_WEIGHTS.title],
    [image.tags.join(' '), FIELD_WEIGHTS.tags],
    [image.category, FIELD_WEIGHTS.category],
  ];
  for (const [text] of fields) {
    for (const token of tokenize(text)) {
      let bucket = store.index.get(token);
      if (!bucket) {
        bucket = new Set<string>();
        store.index.set(token, bucket);
      }
      bucket.add(image.id);
    }
  }
}

/** 从倒排索引移除条目(简化:全量重建该租户索引) */
function rebuildTenantIndex(store: TenantStore): void {
  store.index.clear();
  for (const image of store.images.values()) {
    indexImage(store, image);
  }
  store.lastBuildAt = new Date().toISOString();
}

// ============================================================
// 3. 种子数据(艺术作品图片样本)
// ============================================================

/** 种子条目模板(不含租户/审计字段,加载时注入) */
interface SeedImage {
  title: string;
  tags: string[];
  category: string;
  artType: ArtType;
  status: ImageStatus;
  thumbUrl: string;
  fullUrl: string;
  meta: { width: number; height: number; size: number };
}

/**
 * 种子数据:22 条真实公有领域藏品(Wikimedia Commons)
 * 覆盖绘画/设计/产品/雕塑四类,含 published / draft / archived 三态
 *
 * 注意(2026-08-08 修复):
 *   旧种子指向 /uploads/seed/*.png,文件从不存在且缺少 /app 前缀,
 *   导致图片搜索页全量裂图。现改为前端静态目录 artworks-real 中的
 *   真实图片(thumb 640px / full 1280px),URL 为根绝对路径,
 *   前端 useImageSearch 会用 withAppBase 补 /app 前缀后加载。
 *   标题采用「中文名 + 英文原名」,标签含中文检索词,保证中文搜索可命中。
 */
const SEED_IMAGES: SeedImage[] = [
  {
    title: '自画像·黑背景 Helene Schjerfbeck Self-Portrait 1915',
    tags: ['素描', '人像', '自画像', '肖像', '结构', 'Schjerfbeck'],
    category: '素描人像',
    artType: 'painting',
    status: 'published',
    thumbUrl: '/images/artworks-real/thumb/wm-1a089159a1.jpg',
    fullUrl: '/images/artworks-real/full/wm-1a089159a1.jpg',
    meta: { width: 11402, height: 14615, size: 472900 },
  },
  {
    title: '元太祖成吉思汗像 Yuan Emperor Album Genghis Portrait',
    tags: ['人像', '肖像', '元代', '帝王', '工笔', 'Genghis'],
    category: '素描人像',
    artType: 'painting',
    status: 'published',
    thumbUrl: '/images/artworks-real/thumb/wm-dcad2d1b84.jpg',
    fullUrl: '/images/artworks-real/full/wm-dcad2d1b84.jpg',
    meta: { width: 3180, height: 4040, size: 420100 },
  },
  {
    title: '费利克斯·费内翁肖像 Paul Signac Portrait de Félix Fénéon',
    tags: ['人像', '点彩', '西涅克', '肖像', '色彩', 'Signac'],
    category: '素描人像',
    artType: 'painting',
    status: 'published',
    thumbUrl: '/images/artworks-real/thumb/wm-130427ba20.jpg',
    fullUrl: '/images/artworks-real/full/wm-130427ba20.jpg',
    meta: { width: 6229, height: 4973, size: 491376 },
  },
  {
    title: '星月夜·梵高 Vincent van Gogh Starry Night',
    tags: ['油画', '梵高', '后印象派', '色彩', '星空', 'Van Gogh'],
    category: '色彩理论',
    artType: 'painting',
    status: 'published',
    thumbUrl: '/images/artworks-real/thumb/wm-bdfa9e96f2.jpg',
    fullUrl: '/images/artworks-real/full/wm-bdfa9e96f2.jpg',
    meta: { width: 4331, height: 3346, size: 378673 },
  },
  {
    title: '水果静物 Isaak Soreau Still Life with Fruit',
    tags: ['静物', '水果', '色彩', '油画', '巴洛克', 'Still Life'],
    category: '色彩理论',
    artType: 'painting',
    status: 'published',
    thumbUrl: '/images/artworks-real/thumb/wm-4f273f9047.jpg',
    fullUrl: '/images/artworks-real/full/wm-4f273f9047.jpg',
    meta: { width: 5091, height: 3726, size: 247283 },
  },
  {
    title: '陶罐花卉 Albertus Jonas Brandt Flowers in a Terracotta Vase',
    tags: ['静物', '花卉', '色彩', '花瓶', '写生', 'Terracotta'],
    category: '色彩理论',
    artType: 'painting',
    status: 'published',
    thumbUrl: '/images/artworks-real/thumb/wm-f422311a81.jpg',
    fullUrl: '/images/artworks-real/full/wm-f422311a81.jpg',
    meta: { width: 5309, height: 6807, size: 309680 },
  },
  {
    title: '雾海上的漫游者 Caspar David Friedrich Wanderer above the Sea of Fog',
    tags: ['风景', '油画', '浪漫主义', '雾', '山水', 'Friedrich'],
    category: '速写风景',
    artType: 'painting',
    status: 'published',
    thumbUrl: '/images/artworks-real/thumb/wm-0962ed722b.jpg',
    fullUrl: '/images/artworks-real/full/wm-0962ed722b.jpg',
    meta: { width: 5256, height: 6742, size: 338505 },
  },
  {
    title: '布拉布兰教堂冬景 Winter Landscape with Brabrand Church',
    tags: ['风景', '冬景', '教堂', '速写', '雪景', 'Winter'],
    category: '速写风景',
    artType: 'painting',
    status: 'published',
    thumbUrl: '/images/artworks-real/thumb/wm-58788bb401.jpg',
    fullUrl: '/images/artworks-real/full/wm-58788bb401.jpg',
    meta: { width: 5145, height: 3265, size: 220735 },
  },
  {
    title: '竹林大士出山图 The Mahasattva of Truc Lam Leaves the Mountain',
    tags: ['山水', '中国画', '竹林', '长卷', '风景', 'Truc Lam'],
    category: '速写风景',
    artType: 'painting',
    status: 'published',
    thumbUrl: '/images/artworks-real/thumb/wm-38d5c57baf.jpg',
    fullUrl: '/images/artworks-real/full/wm-38d5c57baf.jpg',
    meta: { width: 21956, height: 2000, size: 48761 },
  },
  {
    title: '清明上河图(清院本) Along the River During the Qingming Festival',
    tags: ['构图', '长卷', '风俗', '中国画', '界画', 'Qingming'],
    category: '构图法则',
    artType: 'painting',
    status: 'published',
    thumbUrl: '/images/artworks-real/thumb/wm-0c9d72affe.jpg',
    fullUrl: '/images/artworks-real/full/wm-0c9d72affe.jpg',
    meta: { width: 56531, height: 1700, size: 21039 },
  },
  {
    title: '肉摊与圣家族 Pieter Aertsen A Meat Stall with the Holy Family',
    tags: ['构图', '静物', '人物', '油画', '场景', 'Aertsen'],
    category: '构图法则',
    artType: 'painting',
    status: 'published',
    thumbUrl: '/images/artworks-real/thumb/wm-141d5e4361.jpg',
    fullUrl: '/images/artworks-real/full/wm-141d5e4361.jpg',
    meta: { width: 6480, height: 4512, size: 263633 },
  },
  {
    title: '桧图屏风·狩野永德 Kanō Eitoku Cypress Trees Folding Screen',
    tags: ['构图', '屏风', '日本画', '松树', '金碧', 'Eitoku'],
    category: '构图法则',
    artType: 'painting',
    status: 'published',
    thumbUrl: '/images/artworks-real/thumb/wm-7326bae954.jpg',
    fullUrl: '/images/artworks-real/full/wm-7326bae954.jpg',
    meta: { width: 15450, height: 5698, size: 241536 },
  },
  {
    title: '作画少女 Villers Young Woman Drawing',
    tags: ['素描', '人物', '写生', '基础', '少女', 'Drawing'],
    category: '绘画基础',
    artType: 'painting',
    status: 'published',
    thumbUrl: '/images/artworks-real/thumb/wm-57ab24bf0f.jpg',
    fullUrl: '/images/artworks-real/full/wm-57ab24bf0f.jpg',
    meta: { width: 4752, height: 5921, size: 293427 },
  },
  {
    title: '采花 Helen Galloway McNicoll Picking Flowers',
    tags: ['油画', '人物', '光影', '印象派', '写生', 'McNicoll'],
    category: '绘画基础',
    artType: 'painting',
    status: 'published',
    thumbUrl: '/images/artworks-real/thumb/wm-030ff41cc4.jpg',
    fullUrl: '/images/artworks-real/full/wm-030ff41cc4.jpg',
    meta: { width: 4618, height: 5521, size: 494109 },
  },
  {
    title: '孔雀与龙织锦面板 William Morris Peacock and Dragon Panel',
    tags: ['设计', '纹样', '威廉莫里斯', '图案', '装饰', 'Morris'],
    category: '设计构成',
    artType: 'design',
    status: 'published',
    thumbUrl: '/images/artworks-real/thumb/wm-73f07c6cce.jpg',
    fullUrl: '/images/artworks-real/full/wm-73f07c6cce.jpg',
    meta: { width: 4816, height: 6106, size: 631117 },
  },
  {
    title: '丘比特离园·比亚兹莱 Aubrey Beardsley The Driving of Cupid from the Garden',
    tags: ['设计', '插画', '黑白', '线条', '装饰', 'Beardsley'],
    category: '设计构成',
    artType: 'design',
    status: 'published',
    thumbUrl: '/images/artworks-real/thumb/wm-23fdfd400c.jpg',
    fullUrl: '/images/artworks-real/full/wm-23fdfd400c.jpg',
    meta: { width: 2637, height: 3501, size: 388908 },
  },
  {
    title: '歌剧服装效果图 Eugène Du Faget Costume Designs for Les Huguenots',
    tags: ['设计', '服装', '效果图', '手绘', '水彩', 'Costume'],
    category: '设计构成',
    artType: 'design',
    status: 'published',
    thumbUrl: '/images/artworks-real/thumb/wm-541648cb77.jpg',
    fullUrl: '/images/artworks-real/full/wm-541648cb77.jpg',
    meta: { width: 4876, height: 3244, size: 225825 },
  },
  {
    title: '十竹斋书画谱页 Ten Bamboo Studio Manual Page',
    tags: ['版画', '饾版', '印刷', '中国画', '设计', 'Bamboo'],
    category: '设计构成',
    artType: 'design',
    status: 'published',
    thumbUrl: '/images/artworks-real/thumb/wm-02c552809c.jpg',
    fullUrl: '/images/artworks-real/full/wm-02c552809c.jpg',
    meta: { width: 2821, height: 2500, size: 183073 },
  },
  {
    title: '五彩鱼藻纹盖罐 Lidded Jar with Design of a Lotus Pond',
    tags: ['陶瓷', '五彩', '明代', '器物', '产品', 'Jar'],
    category: '设计构成',
    artType: 'product',
    status: 'published',
    thumbUrl: '/images/artworks-real/thumb/wm-56455993d3.jpg',
    fullUrl: '/images/artworks-real/full/wm-56455993d3.jpg',
    meta: { width: 1280, height: 1600, size: 157506 },
  },
  {
    title: '狄安娜喷泉雕塑 Fountain of Diana Louvre',
    tags: ['雕塑', '喷泉', '卢浮宫', '古典', '人体', 'Diana'],
    category: '雕塑基础',
    artType: 'sculpture',
    status: 'published',
    thumbUrl: '/images/artworks-real/thumb/wm-c612851da4.jpg',
    fullUrl: '/images/artworks-real/full/wm-c612851da4.jpg',
    meta: { width: 3520, height: 4832, size: 245873 },
  },
  {
    title: '天堂曲喙面具 Crooked Beak of Heaven Mask',
    tags: ['雕塑', '面具', '木雕', '民族', '体量', 'Mask'],
    category: '雕塑基础',
    artType: 'sculpture',
    status: 'archived',
    thumbUrl: '/images/artworks-real/thumb/wm-6611394378.jpg',
    fullUrl: '/images/artworks-real/full/wm-6611394378.jpg',
    meta: { width: 3796, height: 2988, size: 180348 },
  },
  {
    title: '海鸥少女像 Maiden with the Seagull Opatija',
    tags: ['雕塑', '铜像', '少女', '纪念碑', '写实', 'Seagull'],
    category: '雕塑基础',
    artType: 'sculpture',
    status: 'draft',
    thumbUrl: '/images/artworks-real/thumb/wm-72527a4824.jpg',
    fullUrl: '/images/artworks-real/full/wm-72527a4824.jpg',
    meta: { width: 3672, height: 2331, size: 184069 },
  },
];

/**
 * 获取租户存储(首次访问时注入种子数据并建索引)
 * 种子数据为基线作品库,每个租户独立副本,互不影响
 */
function getTenantStore(tenantId: string): TenantStore {
  let store = stores.get(tenantId);
  if (store) return store;

  store = {
    images: new Map<string, ImageDoc>(),
    index: new Map<string, Set<string>>(),
    lastBuildAt: null,
    seeded: true,
  };
  const now = new Date().toISOString();
  for (const seed of SEED_IMAGES) {
    const image: ImageDoc = {
      id: `img-${randomUUID()}`,
      tenantId,
      title: seed.title,
      tags: seed.tags,
      category: seed.category,
      status: seed.status,
      thumbUrl: seed.thumbUrl,
      fullUrl: seed.fullUrl,
      meta: seed.meta,
      createdById: 'system',
      updatedById: 'system',
      createdAt: now,
      updatedAt: now,
    };
    store.images.set(image.id, image);
  }
  rebuildTenantIndex(store);
  stores.set(tenantId, store);
  logger.info({ tenantId, docs: store.images.size }, '[image-search] tenant seeded');
  return store;
}

// ============================================================
// 4. 搜索评分
// ============================================================

/** 可检索非 published(草稿/归档)内容的角色 */
const ELEVATED_ROLES: readonly UserRole[] = ['teacher', 'admin', 'owner'];

/** 默认检索状态 */
const DEFAULT_STATUS: ImageStatus = 'published';

/**
 * 计算条目与查询词的相关性分数(字段加权 + 短语加成)
 * @returns 原始分数(未归一化)
 */
function scoreImage(image: ImageDoc, queryTokens: string[], rawQuery: string): number {
  let score = 0;

  const fieldBags: Array<[string[], number]> = [
    [tokenize(image.title), FIELD_WEIGHTS.title],
    [image.tags.flatMap((t) => tokenize(t)), FIELD_WEIGHTS.tags],
    [tokenize(image.category), FIELD_WEIGHTS.category],
  ];

  for (const token of queryTokens) {
    for (const [bag, weight] of fieldBags) {
      const hits = bag.filter((t) => t === token || t.includes(token) || token.includes(t)).length;
      if (hits > 0) score += hits * weight;
    }
  }

  // 短语精确加成:原始查询完整出现在标题/标签中
  const phrase = rawQuery.trim().toLowerCase();
  if (phrase.length >= 2) {
    if (image.title.toLowerCase().includes(phrase)) score += 20;
    if (image.tags.some((t) => t.toLowerCase() === phrase)) score += 15;
  }

  return score;
}

// ============================================================
// 5. 对外服务接口
// ============================================================

/**
 * 图片搜索
 * - 关键词:倒排索引召回 + 字段加权评分 + 归一化
 * - 筛选:tags(AND)/ category / artType / status
 * - 分页:page / pageSize
 * - 安全:服务端强制角色策略,非 elevated 角色忽略其 status 入参,强制 published
 *   (防止客户端传 status=draft 越权查看未发布内容)
 */
function search(
  tenantId: string,
  role: UserRole,
  query: ImageSearchQuery,
): ImageSearchResponse {
  const store = getTenantStore(tenantId);
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));
  // 角色策略强制:student 等非 elevated 角色忽略 status 入参,强制 published
  const requestedStatus = query.status ?? DEFAULT_STATUS;
  const status = ELEVATED_ROLES.includes(role) ? requestedStatus : DEFAULT_STATUS;
  const tagsFilter = (query.tags ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

  const rawQuery = (query.q ?? '').trim();
  const queryTokens = tokenize(rawQuery);

  // ---------- 召回与筛选 ----------
  const candidates: Array<{ image: ImageDoc; rawScore: number }> = [];
  for (const image of store.images.values()) {
    if (image.status !== status) continue;
    if (query.category && image.category !== query.category) continue;
    // 注:ImageDoc 未单独存储 artType 字段(P0 简化),artType 筛选暂不生效,
    // v2.0 扩展 ImageDoc 增加 artType 后启用;此处保留 query.artType 以兼容契约
    if (tagsFilter.length > 0 && !tagsFilter.every((t) => image.tags.includes(t))) continue;

    const rawScore = queryTokens.length > 0 ? scoreImage(image, queryTokens, rawQuery) : 1;
    if (queryTokens.length > 0 && rawScore <= 0) continue;
    candidates.push({ image, rawScore });
  }

  // ---------- 排序 ----------
  const maxScore = Math.max(...candidates.map((c) => c.rawScore), 1);
  if (queryTokens.length > 0) {
    candidates.sort(
      (a, b) => b.rawScore - a.rawScore || b.image.updatedAt.localeCompare(a.image.updatedAt),
    );
  } else {
    candidates.sort((a, b) => b.image.updatedAt.localeCompare(a.image.updatedAt));
  }

  // ---------- 分页 ----------
  const total = candidates.length;
  const start = (page - 1) * pageSize;
  const items = candidates.slice(start, start + pageSize).map(({ image, rawScore }) => ({
    ...image,
    score: queryTokens.length > 0 ? Math.round((rawScore / maxScore) * 100) / 100 : undefined,
  }));

  return {
    items,
    total,
    page,
    pageSize,
    hasMore: start + pageSize < total,
  };
}

/**
 * 关键词联想补全
 * - 基于倒排索引 token 集做前缀匹配
 * - 前缀 ≥1 字符触发,默认返回 8 条
 * - 仅从 published 图片的索引中召回(学生视角)
 */
function suggest(
  tenantId: string,
  role: UserRole,
  query: ImageSuggestQuery,
): ImageSuggestResponse {
  const store = getTenantStore(tenantId);
  const prefix = (query.q ?? '').trim().toLowerCase();
  if (!prefix) return { suggestions: [] };
  const limit = Math.min(20, Math.max(1, query.limit ?? 8));

  // 候选来源:倒排索引的 token 集合
  const candidates = new Set<string>();
  for (const token of store.index.keys()) {
    if (token.startsWith(prefix)) {
      candidates.add(token);
    }
  }

  // 角色过滤:非 elevated 角色排除来自 draft/archived 图片的 token
  // (倒排索引未区分状态,需回查图片状态)
  if (!ELEVATED_ROLES.includes(role)) {
    const filtered = new Set<string>();
    for (const token of candidates) {
      const ids = store.index.get(token);
      if (!ids) continue;
      // 只要存在任一 published 图片命中该 token,即保留
      let keep = false;
      for (const id of ids) {
        const img = store.images.get(id);
        if (img && img.status === 'published') {
          keep = true;
          break;
        }
      }
      if (keep) filtered.add(token);
    }
    return { suggestions: Array.from(filtered).sort().slice(0, limit) };
  }

  return { suggestions: Array.from(candidates).sort().slice(0, limit) };
}

/**
 * 获取图片条目详情(含租户隔离 + 角色权限强制)
 */
function getById(tenantId: string, role: UserRole, id: string): ImageDoc | null {
  const store = getTenantStore(tenantId);
  const image = store.images.get(id);
  if (!image) return null;
  // 非 elevated 角色不可见 draft/archived
  if (!ELEVATED_ROLES.includes(role) && image.status !== DEFAULT_STATUS) {
    return null;
  }
  return image;
}

/**
 * 创建图片条目
 */
function create(
  tenantId: string,
  userId: string,
  input: CreateImageRequest,
): ImageDoc {
  const store = getTenantStore(tenantId);
  const now = new Date().toISOString();
  const image: ImageDoc = {
    id: `img-${randomUUID()}`,
    tenantId,
    title: input.title,
    tags: input.tags ?? [],
    category: input.category,
    status: input.status ?? 'draft',
    thumbUrl: input.thumbUrl,
    fullUrl: input.fullUrl,
    meta: input.meta ?? { width: 0, height: 0, size: 0 },
    createdById: userId,
    updatedById: userId,
    createdAt: now,
    updatedAt: now,
  };
  store.images.set(image.id, image);
  indexImage(store, image);
  store.lastBuildAt = now;
  logger.info({ tenantId, id: image.id, title: image.title }, '[image-search] image created');
  return image;
}

/**
 * 更新图片条目(部分更新)
 */
function update(
  tenantId: string,
  id: string,
  userId: string,
  input: UpdateImageRequest,
): ImageDoc | null {
  const store = getTenantStore(tenantId);
  const existing = store.images.get(id);
  if (!existing) return null;

  const updated: ImageDoc = {
    ...existing,
    ...(input.title !== undefined && { title: input.title }),
    ...(input.tags !== undefined && { tags: input.tags }),
    ...(input.category !== undefined && { category: input.category }),
    ...(input.status !== undefined && { status: input.status }),
    ...(input.thumbUrl !== undefined && { thumbUrl: input.thumbUrl }),
    ...(input.fullUrl !== undefined && { fullUrl: input.fullUrl }),
    ...(input.meta !== undefined && { meta: input.meta }),
    updatedById: userId,
    updatedAt: new Date().toISOString(),
  };
  store.images.set(id, updated);
  rebuildTenantIndex(store);
  logger.info({ tenantId, id }, '[image-search] image updated');
  return updated;
}

/**
 * 删除图片条目
 */
function remove(tenantId: string, id: string): boolean {
  const store = getTenantStore(tenantId);
  if (!store.images.delete(id)) return false;
  rebuildTenantIndex(store);
  logger.info({ tenantId, id }, '[image-search] image deleted');
  return true;
}

/**
 * 测试辅助:清空全部租户存储(测试隔离用)
 */
function __clearForTest(): void {
  stores.clear();
}

// ============================================================
// 导出
// ============================================================

export const imageSearchService = {
  search,
  suggest,
  getById,
  create,
  update,
  remove,
  tokenize,
  __clearForTest,
};
