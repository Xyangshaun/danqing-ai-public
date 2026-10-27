// ============================================================
// 丹青有AI - 统一素材服务层
// ------------------------------------------------------------
// 设计目标(阶段2D:素材库打包接口与统一调用机制):
//   1. 统一素材查找机制:所有素材调用(内置艺术库 / 用户保存素材 /
//      收藏)均通过本模块,页面不再直接拼接数据源
//   2. 素材打包记录:支持将素材按主题/用途打包(MaterialPack),
//      持久化到 LocalStorage,接口形态与后端 REST 契约一致,
//      后续可无缝切换为 /api/v1/material-packs
//   3. 严格 TypeScript:禁止 any,所有输入显式类型
//
// 依赖关系:
//   - artworksDatabase.ts  内置艺术作品库(只读)
//   - data-service.ts      用户保存素材 / 收藏(LocalStorage 实现)
//
// 注意:
//   - 素材打包当前走 LocalStorage;新增后端表(Prisma schema 变更)
//     属核心基础设施,需审核确认后再迁移 API 实现
//   - LocalStorage 读写全部 try-catch 兜底,防止数据损坏导致全局崩溃
// ============================================================

import {
  loadBuiltinArtworks,
  searchArtworks,
  resolveArtworkImageUrl,
  type ArtworkItem,
} from './artworksDatabase';
import {
  getSavedMaterials,
  getFavorites,
  type SavedMaterial,
} from './data-service';

/* ============================================================
 * 1. 统一素材类型
 * ============================================================ */

/** 素材来源 */
export type MaterialSource = 'builtin' | 'saved' | 'favorite';

/** 统一素材项(页面展示与调用的单一形态) */
export interface UnifiedMaterial {
  /** 统一 ID:builtin 为艺术作品 ID;saved 为保存记录 ID */
  id: string;
  /** 标题 */
  title: string;
  /** 副标题(艺术家 / 来源说明) */
  subtitle: string;
  /** 图片地址 */
  imageUrl: string;
  /** 来源标识 */
  source: MaterialSource;
  /** 分类(绘画/设计/产品/雕塑等,saved 素材为 undefined) */
  category?: ArtworkItem['category'];
  /** 风格 */
  style?: string;
  /** 时代 */
  era?: string;
  /** 标签 */
  tags: string[];
  /** 原始引用(便于需要完整字段的场景) */
  ref: ArtworkItem | SavedMaterial;
}

/** 统一查找参数 */
export interface MaterialQuery {
  /** 关键词(标题/艺术家/标签模糊匹配) */
  keyword?: string;
  /** 分类过滤 */
  category?: string;
  /** 风格过滤 */
  style?: string;
  /** 时代过滤 */
  era?: string;
  /** 地域过滤 */
  region?: string;
  /** 标签过滤(任一命中) */
  tags?: string[];
  /** 来源过滤(默认全部) */
  sources?: MaterialSource[];
  /** 结果上限(默认 100) */
  limit?: number;
}

/* ============================================================
 * 2. 素材打包记录
 * ============================================================ */

/** 素材包(打包记录) */
export interface MaterialPack {
  id: string;
  /** 包名称(如「宋代山水参考」「蓝金色系灵感」) */
  name: string;
  /** 用途描述 */
  description?: string;
  /** 包内素材 ID 列表(引用 UnifiedMaterial.id) */
  materialIds: string[];
  /** 关联创作形式(可选,便于按场景筛选) */
  artType?: 'painting' | 'design' | 'product' | 'sculpture';
  createdAt: string;
  updatedAt: string;
}

/** 创建素材包输入 */
export interface CreatePackInput {
  name: string;
  description?: string;
  materialIds?: string[];
  artType?: MaterialPack['artType'];
}

/** 更新素材包输入(部分字段) */
export interface UpdatePackInput {
  name?: string;
  description?: string;
  artType?: MaterialPack['artType'];
}

/** LocalStorage key */
const PACKS_LS_KEY = 'danqing-ai-material-packs';

/* ============================================================
 * 3. 内置素材 -> 统一形态转换
 * ============================================================ */

function artworkToUnified(item: ArtworkItem): UnifiedMaterial {
  return {
    id: item.id,
    title: item.title,
    subtitle: `${item.artist} · ${item.era}`,
    imageUrl: resolveArtworkImageUrl(item).imageUrl,
    source: 'builtin',
    category: item.category,
    style: item.style,
    era: item.era,
    tags: item.tags,
    ref: item,
  };
}

function savedToUnified(item: SavedMaterial): UnifiedMaterial {
  const sourceName =
    item.source === 'fuse' ? '灵感嫁接' : item.source === 'emotion' ? '情绪画布' : '素材库';
  return {
    id: item.id,
    title: item.title,
    subtitle: `${sourceName} · 我的保存`,
    imageUrl: item.imageUrl,
    source: 'saved',
    tags: [sourceName],
    ref: item,
  };
}

/* ============================================================
 * 4. 统一查找机制
 * ============================================================ */

/**
 * 异步查询内置艺术作品库
 *
 * 先确保 /data/artworks.json 已加载,再委托 searchArtworks 过滤。
 * 页面应在 useEffect 中调用并设置状态,避免在 render 阶段直接 await。
 */
export async function searchBuiltinMaterials(
  query: Omit<MaterialQuery, 'sources' | 'limit'> = {}
): Promise<UnifiedMaterial[]> {
  await loadBuiltinArtworks();
  const artworks = searchArtworks({
    keyword: query.keyword,
    category: query.category,
    style: query.style,
    era: query.era,
    region: query.region,
    tags: query.tags,
  });
  return artworks.map(artworkToUnified);
}

/** 异步获取全部内置素材(拷贝) */
export async function getAllBuiltinMaterials(): Promise<UnifiedMaterial[]> {
  const artworks = await loadBuiltinArtworks();
  return artworks.map(artworkToUnified);
}

/**
 * 异步获取内置艺术作品库原始数据
 *
 * 供 fuse / 风格库等仍需 ArtworkItem 完整字段的场景使用。
 * 通过本函数调用即可纳入统一素材查找机制,底层 artworksDatabase
 * 不再被页面直接引用。
 */
export async function getBuiltinArtworkItems(): Promise<ArtworkItem[]> {
  const artworks = await loadBuiltinArtworks();
  return [...artworks];
}

/**
 * 统一素材查找
 *
 * 所有页面的素材检索入口。内部聚合:
 *   - 内置艺术作品库(复用 searchArtworks 的多维过滤)
 *   - 用户保存的素材(嫁接结果 / 情绪画布导出)
 *   - 收藏状态(作为来源标记,收藏本身仍由 data-service 管理)
 *
 * @returns 统一形态素材列表,builtin 在前、saved 在后
 */
export async function searchMaterials(query: MaterialQuery = {}): Promise<UnifiedMaterial[]> {
  const sources = query.sources ?? ['builtin', 'saved'];
  const limit = query.limit ?? 100;
  const results: UnifiedMaterial[] = [];

  /* ---------- 内置艺术库 ---------- */
  if (sources.includes('builtin')) {
    const artworks = await searchBuiltinMaterials({
      keyword: query.keyword,
      category: query.category,
      style: query.style,
      era: query.era,
      region: query.region,
      tags: query.tags,
    });
    results.push(...artworks);
  }

  /* ---------- 用户保存素材 ---------- */
  if (sources.includes('saved')) {
    try {
      const saved = await getSavedMaterials();
      let savedUnified = saved.map(savedToUnified);
      if (query.keyword) {
        const kw = query.keyword.toLowerCase();
        savedUnified = savedUnified.filter(
          (m) => m.title.includes(query.keyword!) || m.subtitle.toLowerCase().includes(kw)
        );
      }
      results.push(...savedUnified);
    } catch {
      /* 保存素材读取失败不阻塞内置库结果 */
    }
  }

  return results.slice(0, limit);
}

/**
 * 按 ID 精确查找单个素材
 * 先异步加载内置库,再查用户保存;找不到返回 null
 */
export async function getMaterialById(id: string): Promise<UnifiedMaterial | null> {
  const artworks = await loadBuiltinArtworks();
  const builtin = artworks.find((a) => a.id === id);
  if (builtin) return artworkToUnified(builtin);
  try {
    const saved = await getSavedMaterials();
    const hit = saved.find((s) => s.id === id);
    if (hit) return savedToUnified(hit);
  } catch {
    /* 忽略读取异常 */
  }
  return null;
}

/**
 * 获取用户收藏对应的统一素材列表
 * 收藏 ID 由 data-service 管理,此处仅做形态转换
 */
export async function getFavoriteMaterials(): Promise<UnifiedMaterial[]> {
  try {
    const [artworks, favIds] = await Promise.all([loadBuiltinArtworks(), getFavorites()]);
    const set = new Set(favIds);
    return artworks.filter((a) => set.has(a.id)).map(artworkToUnified);
  } catch {
    return [];
  }
}

/* ============================================================
 * 5. 素材打包记录 CRUD
 * ============================================================ */

/** 读取全部素材包(内部) */
function readPacks(): MaterialPack[] {
  try {
    const raw = localStorage.getItem(PACKS_LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // 基础结构校验,过滤损坏条目
    return parsed.filter(
      (p): p is MaterialPack =>
        p !== null &&
        typeof p === 'object' &&
        typeof (p as MaterialPack).id === 'string' &&
        typeof (p as MaterialPack).name === 'string' &&
        Array.isArray((p as MaterialPack).materialIds)
    );
  } catch {
    return [];
  }
}

/** 写入全部素材包(内部) */
function writePacks(packs: MaterialPack[]): void {
  try {
    localStorage.setItem(PACKS_LS_KEY, JSON.stringify(packs));
  } catch {
    /* localStorage 写入失败(隐私模式/超限),忽略 */
  }
}

/** 获取全部素材包(按更新时间倒序) */
export async function getPacks(): Promise<MaterialPack[]> {
  return readPacks().sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

/** 获取单个素材包 */
export async function getPackById(id: string): Promise<MaterialPack | null> {
  return readPacks().find((p) => p.id === id) ?? null;
}

/** 创建素材包 */
export async function createPack(input: CreatePackInput): Promise<MaterialPack> {
  const packs = readPacks();
  const now = new Date().toISOString();
  const pack: MaterialPack = {
    id: `pack-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: input.name.trim() || '未命名素材包',
    description: input.description,
    materialIds: input.materialIds ?? [],
    artType: input.artType,
    createdAt: now,
    updatedAt: now,
  };
  packs.unshift(pack);
  writePacks(packs);
  return pack;
}

/** 更新素材包(名称/描述/创作形式) */
export async function updatePack(id: string, patch: UpdatePackInput): Promise<MaterialPack | null> {
  const packs = readPacks();
  const idx = packs.findIndex((p) => p.id === id);
  if (idx < 0) return null;
  const next: MaterialPack = {
    ...packs[idx],
    ...patch,
    name: patch.name !== undefined ? patch.name.trim() || packs[idx].name : packs[idx].name,
    updatedAt: new Date().toISOString(),
  };
  packs[idx] = next;
  writePacks(packs);
  return next;
}

/** 删除素材包 */
export async function deletePack(id: string): Promise<void> {
  writePacks(readPacks().filter((p) => p.id !== id));
}

/** 向素材包添加素材(幂等,已存在则不重复添加) */
export async function addToPack(packId: string, materialId: string): Promise<MaterialPack | null> {
  const packs = readPacks();
  const pack = packs.find((p) => p.id === packId);
  if (!pack) return null;
  if (!pack.materialIds.includes(materialId)) {
    pack.materialIds.push(materialId);
    pack.updatedAt = new Date().toISOString();
    writePacks(packs);
  }
  return pack;
}

/** 从素材包移除素材 */
export async function removeFromPack(packId: string, materialId: string): Promise<MaterialPack | null> {
  const packs = readPacks();
  const pack = packs.find((p) => p.id === packId);
  if (!pack) return null;
  pack.materialIds = pack.materialIds.filter((mid) => mid !== materialId);
  pack.updatedAt = new Date().toISOString();
  writePacks(packs);
  return pack;
}

/**
 * 解析素材包内容
 * 将 materialIds 转换为完整统一素材,自动跳过已失效的引用
 */
export async function resolvePackMaterials(pack: MaterialPack): Promise<UnifiedMaterial[]> {
  const results: UnifiedMaterial[] = [];
  for (const id of pack.materialIds) {
    const material = await getMaterialById(id);
    if (material) results.push(material);
  }
  return results;
}
