/**
 * 非遗素材库数据服务 V3 (美院级专业字段体系)
 * ------------------------------------------------------------
 * 数据源: /data/heritage-works.json
 * 加载方式: fetch + 内存缓存 + 幂等 Promise (与 artworksDatabase 一致)
 *
 * 与 artworks.json 的区别:
 *   heritage-works.json 采用非遗专用 schema,不套用 ArtworkItem,
 *   保留文化语境字段 (十大专业维度 + 保护体系字段),
 *   供素材库 / 灵感嫁接 / 非遗详情页独立渲染。
 *
 * 图片解析策略(生产安全):
 *   三级降级: 本地真实 JPG → artworkImage() 内联 SVG → 最简金色占位
 *   生产环境严禁 IDE 内部 API(trae-api-cn.mchost.guru)泄露
 *
 * 严格 TypeScript: 禁止 any,所有导出显式类型
 */

import type { HeritageCategory } from '../types';
import { withAppBase } from './artworksDatabase';
import { artworkImage, type PlaceholderSize } from './artworkImage';

// ---------- 类型定义 ----------

/** 非遗二级类目(对齐后端 HeritageCategory) */
export type HeritageSubCategory = HeritageCategory;

/** 非遗二级类目中文标签(全局唯一源, FusePage/MaterialsPage/HistoryPage 统一引用) */
export const HERITAGE_CATEGORY_LABEL: Record<HeritageSubCategory, string> = {
  papercut: '剪纸',
  embroidery: '刺绣',
  porcelain: '瓷器',
  nianhua: '年画',
  shadowpuppet: '皮影',
  weaving: '编织',
  woodcarving: '木雕',
  clay: '泥塑',
  lacquer: '漆器',
  thangka: '唐卡',
};

// 本地别名,本文件内复用 HERITAGE_CATEGORY_LABEL
const HERITAGE_CATEGORY_LABEL_LOCAL = HERITAGE_CATEGORY_LABEL;

/** 中文标签 → 类目 key (灵感嫁接回填 heritageCategory 时使用) */
export const HERITAGE_LABEL_TO_KEY: Record<string, HeritageSubCategory> = {
  剪纸: 'papercut',
  刺绣: 'embroidery',
  瓷器: 'porcelain',
  年画: 'nianhua',
  皮影: 'shadowpuppet',
  编织: 'weaving',
  木雕: 'woodcarving',
  泥塑: 'clay',
  漆器: 'lacquer',
  唐卡: 'thangka',
};

/** 二级类目筛选选项(含「全部」) */
export const HERITAGE_SUBCATEGORY_OPTIONS: ReadonlyArray<{ key: 'all' | HeritageSubCategory; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'papercut', label: '剪纸' },
  { key: 'embroidery', label: '刺绣' },
  { key: 'porcelain', label: '瓷器' },
  { key: 'nianhua', label: '年画' },
  { key: 'shadowpuppet', label: '皮影' },
  { key: 'weaving', label: '编织' },
  { key: 'woodcarving', label: '木雕' },
  { key: 'clay', label: '泥塑' },
  { key: 'lacquer', label: '漆器' },
  { key: 'thangka', label: '唐卡' },
];

// ---------- 专业字段体系(十大维度 + 保护体系) ----------

/** 保护级别(法规定义,不使用「国粹」等非正式表述) */
export type ProtectionLevel =
  | 'humanity'    // 联合国教科文组织人类非物质文化遗产代表作名录
  | 'national'    // 国家级非物质文化遗产代表性项目
  | 'provincial'  // 省级非物质文化遗产代表性项目
  | 'municipal'   // 市级非物质文化遗产代表性项目
  | 'county';     // 县级 / 其他

/** 传承人认定级别(2006 年起批次体系) */
export interface HeritageInheritor {
  /** 真实姓名,实名记录 */
  name: string;
  /** 生卒年或在世 */
  lifespan: string;
  /** 传承谱系代数(第一代起算) */
  generation: number;
  /** 国家级 / 省级 / 市级 + 认定年份批次 + 官方编号 */
  level: string;
  /** 代表作品 / 著述(各举 1-2 个,分号分隔) */
  masterpieces?: string;
  /** 师承关系 / 师徒传代链简述 */
  lineage?: string;
}

/** 材料与工具清单 */
export interface HeritageMaterialsAndTools {
  /** 主材清单(专业术语, 含规格/品级, 例: "红星牌净皮四尺单宣") */
  primaryMaterials: string[];
  /** 辅材清单(胶、蜡、糊、颜料等) */
  auxiliaryMaterials: string[];
  /** 工具清单(专业命名, 例: "张小泉牌翘头剪纸剪·刃长12cm") */
  tools: string[];
}

/** 工序步骤(≥5 步, 核心工序需标注) */
export interface HeritageProcessStep {
  stepNo: number;
  /** 工序中文名(非遗行业标准术语) */
  name: string;
  /** 是否核心工序 */
  isCore?: boolean;
  /** 工艺要点 / 火候 / 温度 / 时长 参数 */
  description: string;
}

/** 图像志(Iconography)造型与母题 */
export interface HeritageIconography {
  /** 造型体系(例: "意象造型+几何格律") */
  formSystem: string;
  /** 构图范式(例: "圆形团花·放射对称·五层开光式") */
  composition: string;
  /** 粉本/图谱谱系出处 */
  sketchSource?: string;
  /** 核心图像母题及语义象征(≥2 个, 逐条写清楚谐音/典故/文化来源) */
  motifs: Array<{
    motif: string;
    semantics: string;
  }>;
}

/** 民俗功能与使用场域(三维度) */
export interface HeritageFolkUsage {
  /** 岁时节令时间维度 */
  festivals: string;
  /** 空间场域维度(民居/庙宇/会馆/仪式现场) */
  spaces: string;
  /** 社会功能维度(祭祀/婚嫁/丧葬/馈赠/装饰) */
  socialFunctions: string;
  /** 形制-场景的约束性说明(例: "圆形团花仅用于婚寿,方形贴窗") */
  constraints?: string;
}

/** 鉴赏要点(美院四维法:章法/刀痕线质/色彩釉色/材质肌理) */
export interface HeritageAppreciation {
  /** 章法·构图经营 */
  composition: string;
  /** 线质·刀痕·针脚·笔意(骨法用笔) */
  brushwork: string;
  /** 色彩·釉色·色调·色阶·窑变 */
  color: string;
  /** 材质肌理·地子·包浆·窑汗 */
  material: string;
}

/** 学术与文化价值(三大美院话语) */
export interface HeritageAcademicValue {
  /** 造型艺术价值·形式语言贡献 */
  artistic: string;
  /** 社会史价值·民俗活态档案 */
  social: string;
  /** 工艺史价值·技术文明样本 */
  technological: string;
  /** 当代转译(设计转化/跨媒介创新) */
  modernReinterpretation?: string;
}

/** 保护体系字段(对齐 ihchina.cn 国家级名录字段) */
export interface HeritageProtectionInfo {
  /** 保护级别( humanity / national / provincial / municipal / county ) */
  level: ProtectionLevel;
  /** 入选国家级非遗名录批次(例:"2006年第一批·编号Ⅶ-16") */
  nationalBatch?: string;
  /** 列入联合国人类非遗时间/子项说明 */
  humanityNote?: string;
  /** 申报地区或单位(行政区划+文化生态) */
  declaredRegion?: string;
  /** 保护单位全称(ihchina.cn 公布为准) */
  protectionUnit?: string;
}

/** 非遗作品图片状态(用于占位回退) */
export type HeritageImageStatus =
  | 'local'           // 已固化本地 JPG (public/images/heritage/full|thumb/<id>.jpg)
  | 'cos'             // 已固化 COS /uploads/heritage/*
  | 'generating'      // 尚未生成, 走占位降级
  | 'pending-upload'; // 待上传固化

/** 非遗作品单条 schema(灵感嫁接 / 非遗详情页主对象) */
export interface HeritageWork {
  /** 主键(例:heritage-001, 或与 artworks.json 对应 hr-xxxxxx) */
  id: string;
  /** ① 项目定名(「流派·产地·题材·形制」四级定名法) */
  title: string;
  /** 二级类目 key */
  category: HeritageSubCategory;
  /** ②-1 年代断代(明清/清代/清末民初/唐宋/当代等) */
  dynasty: string;
  /** ③ 产地/传承地(行政+地理+人文语境) */
  origin: string;
  /** ② 历史渊源(文献可考断代+名录批次+工艺流变节点) */
  history: string;
  /** ④+⑤ 材料/工具+工艺工序(合并简述,供列表/卡片快速展示) */
  craftFeature: string;
  /** 代表作(本项目代表作, 非整类通用模板) */
  representativeWork: string;
  /** 技法要点数组(≥4 条, 非遗专业术语) */
  techniquePoints: string[];
  /** 图片:原字段保兼容, 建议通过 resolveHeritageImage 获取 */
  images: { thumb: string; full: string };
  /** 标签(造型/题材/地域/民俗用途, 不超过 6 条) */
  tags: string[];

  // —— V3 新增十大专业维度字段(渐进填充, 全部可选) ——
  /** 保护体系字段(对齐 ihchina.cn) */
  protection?: HeritageProtectionInfo;
  /** 代表传承人数组(1-3 人) */
  inheritors?: HeritageInheritor[];
  /** 材料与工具清单 */
  materialsTools?: HeritageMaterialsAndTools;
  /** 工艺工序步骤(≥5 步, 核心工序标注) */
  processSteps?: HeritageProcessStep[];
  /** 图像志·造型与母题 */
  iconography?: HeritageIconography;
  /** 民俗功能与使用场景(三维度) */
  folkUsage?: HeritageFolkUsage;
  /** 鉴赏要点(美院四维法) */
  appreciation?: HeritageAppreciation;
  /** 学术与文化价值 */
  academicValue?: HeritageAcademicValue;

  // —— V3 新增运行时/维护 字段 ——
  /** 对向关联: 对应 artworks.json 的 heritage bulk 条目的 id(hr-xxxxxx), 用于详情弹窗联动 */
  artworkRefId?: string;
  /** 图片状态(用于占位回退时快速判断, 为空默认 generating) */
  imageStatus?: HeritageImageStatus;
}

interface HeritageWorksFile {
  meta: {
    total: number;
    categories: Partial<Record<HeritageSubCategory, number>>;
    [k: string]: unknown;
  };
  items: HeritageWork[];
}

// ---------- 缓存/加载 ----------

let cachedHeritage: HeritageWork[] | null = null;
let loadPromise: Promise<HeritageWork[]> | null = null;

/** 异步加载非遗素材库 (幂等) */
export async function loadHeritageWorks(): Promise<HeritageWork[]> {
  if (cachedHeritage) return cachedHeritage;
  if (loadPromise) return loadPromise;

  const url = withAppBase('data/heritage-works.json');

  loadPromise = fetch(url)
    .then(async (res) => {
      if (!res.ok) throw new Error(`加载非遗素材库失败: ${res.status}`);
      const data = (await res.json()) as HeritageWorksFile;
      cachedHeritage = data.items;
      // 暴露缓存供 FusePage / 详情页反向查询(heritageArtworkFullUrl)
      try {
        (globalThis as unknown as { __heritageCache?: HeritageWork[] }).__heritageCache = cachedHeritage;
      } catch { /* SSR / strict context 忽略 */ }
      return data.items;
    })
    .catch((err) => {
      console.error('加载非遗素材库失败:', err);
      cachedHeritage = [];
      try {
        (globalThis as unknown as { __heritageCache?: HeritageWork[] }).__heritageCache = cachedHeritage;
      } catch { /* ignore */ }
      return [];
    });

  return loadPromise;
}

/** 同步获取已缓存的非遗作品(未加载时返回空数组) */
export function getHeritageWorks(): HeritageWork[] {
  return cachedHeritage ?? [];
}

/** 是否已完成加载 */
export function isHeritageWorksLoaded(): boolean {
  return cachedHeritage !== null;
}

/** 按二级类目筛选非遗作品 */
export function filterHeritageByCategory(
  items: HeritageWork[],
  category: 'all' | HeritageSubCategory
): HeritageWork[] {
  if (category === 'all') return items;
  return items.filter((it) => it.category === category);
}

// ---------- 图片 URL 解析(三级降级 + 生产安全) ----------

/**
 * IDE 沙箱内部 URL 正则(trae-api-cn.mchost.guru)
 * 生产环境必须拦截: 该域名只在 Trae IDE 沙箱内部可访问
 */
const IDE_INTERNAL_URL_RE = /trae-api-cn\.mchost\.guru/i;

/** 生产环境检测: import.meta.env.PROD(Vite) or hostname 非 localhost */
function isProductionEnvironment(): boolean {
  try {
    if (typeof import.meta !== 'undefined' && (import.meta as unknown as { env?: { PROD?: boolean } }).env?.PROD) return true;
    if (typeof window !== 'undefined') {
      const host = window.location.hostname;
      return !(host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local'));
    }
    return false;
  } catch {
    return true;
  }
}

/** 本地真实路径前缀(/app/images/heritage/...) */
function localImagePath(rel: string): string {
  // rel 为绝对路径 '/images/heritage/...', withAppBase 会正确加 '/app' 前缀
  // 注意: 不能 slice(1) 去斜杠, 否则变成相对路径 'images/...', withAppBase 无法加 /app 前缀
  return withAppBase(rel.startsWith('/') ? rel : '/' + rel);
}

/** 生成占位 SVG(heritage 类) */
function heritagePlaceholderSvg(hw: HeritageWork, size: PlaceholderSize): string {
  const subtitle =
    (hw.protection?.level === 'national' ? '国家级非遗' :
      hw.protection?.level === 'humanity' ? '人类非遗代表作' :
        HERITAGE_CATEGORY_LABEL_LOCAL[hw.category] || '') +
    (hw.dynasty ? ` · ${hw.dynasty}` : '');
  return artworkImage(hw.id, {
    category: 'heritage',
    style: HERITAGE_CATEGORY_LABEL_LOCAL[hw.category],
    title: hw.title.length > 16 ? hw.title.slice(0, 15) + '…' : hw.title,
    subtitle,
    size,
  });
}

/** 最简金色占位兜底(网络失败或极端情况) */
function minimalHeritagePlaceholder(): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='400' height='400' viewBox='0 0 400 400'><rect width='400' height='400' fill='#f5ede0'/><rect x='12' y='12' width='376' height='376' fill='none' stroke='#d4af37' stroke-width='2'/><text x='200' y='210' font-family='serif' font-size='72' fill='#c41e3a' text-anchor='middle' opacity='0.7'>印</text></svg>`;
  return `data:image/svg+xml,${svg
    .replace(/"/g, "'")
    .replace(/#/g, '%23')}`;
}

/**
 * 解析非遗作品图片 URL (thumb / full)
 * 三级降级:
 *   1. 本地真实 JPG: public/images/heritage/{thumb,full}/<id>.jpg → dist → /app/images/heritage/*
 *   2. 内联 SVG: artworkImage heritage 类图案(零网络、首屏必出)
 *   3. 最简金色占位: 极端兜底
 *
 * 生产安全: IDE 内部 URL (trae-api-cn.mchost.guru) 在生产被强制降级,避免打开空图
 *
 * 缓存策略: Nginx 对 /app/images/ 设 expires 30d; 当服务器图片文件被替换
 * (占位图→真实图) 时, 旧 URL 会被浏览器长缓存, 需递增 IMAGE_VERSION 强制刷新。
 */
const IMAGE_VERSION = 3;

function withImageVersion(url: string): string {
  // 已是 data:/http(s) 的降级图不加参数, 仅本地 / 开头的 JPG 加缓存版本号
  if (!url.startsWith('/')) return url;
  return `${url}${url.includes('?') ? '&' : '?'}v=${IMAGE_VERSION}`;
}

export function resolveHeritageThumb(hw: HeritageWork): string {
  return resolveHeritageImage(hw, 'thumb');
}
export function resolveHeritageFull(hw: HeritageWork): string {
  return resolveHeritageImage(hw, 'full');
}

function resolveHeritageImage(hw: HeritageWork, kind: 'thumb' | 'full'): string {
  const size: PlaceholderSize = kind === 'full' ? 'square_hd' : 'square';

  // —— 优先级 1: 本地真实图片(按规范路径 /images/heritage/{thumb,full}/<id>.jpg)
  try {
    const rel = `/images/heritage/${kind}/${hw.id}.jpg`;
    return withImageVersion(localImagePath(rel));
  } catch { /* 向下降级 */ }

  // —— 优先级 2: 读 images 字段, 但先过滤生产危险 URL
  const raw = kind === 'full' ? hw.images?.full : hw.images?.thumb;
  if (raw && typeof raw === 'string') {
    if (IDE_INTERNAL_URL_RE.test(raw)) {
      if (isProductionEnvironment()) {
        // 生产环境: IDE URL 绝对不可达, 直接 SVG 占位
        return heritagePlaceholderSvg(hw, size);
      }
      // 开发环境: 允许访问(IDE 沙箱内可用)
      return raw;
    }
    // 正常的 https:// 或 / 开头 URL: 原样使用(Cos or uploads)
    if (raw.startsWith('http://') || raw.startsWith('https://') || raw.startsWith('/')) {
      return raw;
    }
  }

  // —— 优先级 3: artworkImage SVG(heritage 类)
  try {
    return heritagePlaceholderSvg(hw, size);
  } catch {
    /* 继续兜底 */
  }

  // —— 最兜底: 最简金色 SVG
  return minimalHeritagePlaceholder();
}

/**
 * 用于旧代码兼容: FusePage 通过 heritageToArtworkItem 转 ArtworkItem 后,
 * 会走 resolveArtworkImageUrl(imageUrl: `__ARTWORK_IMAGE__:${hw.id}`)
 * 新代码推荐直接调 resolveHeritageThumb / Full 即可。
 *
 * 该函数返回给旧调用方作为 imageUrl:
 *   始终先返回真实图片相对路径(artworksDatabase.resolveArtworkImageUrl 会加 withAppBase)
 *   若图片 404, FusePage 的 useLazyImage fallbackSrc 会走占位降级
 *
 * 去除 imageStatus 依赖: 不论 generating/ready, 先尝试 JPG 路径,
 * 由浏览器 <img onerror> + useLazyImage 统一兜底, 避免逻辑分叉。
 */
export function heritageAsArtworkImageMarker(hw: HeritageWork): string {
  return `/images/heritage/thumb/${hw.id}.jpg?v=${IMAGE_VERSION}`;
}
