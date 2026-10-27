// ============================================================
// 知识库实时检索服务(v1.1 落地实现)
//
// 实现范围:
//   - 关键词全文检索(中文二元分词 + 英文单词分词)
//   - 倒排索引(term → entryIds),字段加权评分
//   - 标签(AND)/ 分类 / 作品类型 / 状态 筛选
//   - 多租户数据隔离(每租户独立存储与索引)
//   - CRUD + 索引状态 + 搜索权限预校验
//
// 存储策略:
//   Phase 1 使用进程内存存储 + 内置艺术教育种子数据,
//   保证无 DB 依赖即可本地验证搜索效果;
//   v2.0 可平移至 Prisma/ES(repository 接口保持稳定)。
// ============================================================

import { randomUUID } from 'node:crypto';
import type {
  ArtType,
  KnowledgeEntry,
  KnowledgeIndexRebuildResponse,
  KnowledgeIndexStatus,
  KnowledgeSearchQuery,
  KnowledgeSearchResponse,
  KnowledgeSearchValidateResponse,
  KnowledgeSource,
  KnowledgeStatus,
  CreateKnowledgeRequest,
  UpdateKnowledgeRequest,
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
 * - 中文:连续中文片段切为二元组(bigram),单字片段保留单字
 *   例:"素描基础" → ["素描", "基础", "描基"]?否 —— bigram 为 ["素描","描基","基础"]
 *   采用滑动窗口二元:["素描基础"] → 素 描 基 础 → ["素描","描基","基础"]
 */
export function tokenize(text: string): string[] {
  if (!text) return [];
  const tokens: string[] = [];
  // 拆分中文片段与非中文片段
  const segments = text.toLowerCase().split(/([一-鿿㐀-䶿豈-﫿]+)/u);
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

/** 倒排索引:term → Set<entryId> */
type InvertedIndex = Map<string, Set<string>>;

interface TenantStore {
  entries: Map<string, KnowledgeEntry>;
  index: InvertedIndex;
  /** 索引构建时间 */
  lastBuildAt: string | null;
  /** 是否已加载种子数据 */
  seeded: boolean;
}

/** 全局存储:tenantId → TenantStore */
const stores = new Map<string, TenantStore>();

/** 索引字段权重 */
const FIELD_WEIGHTS = {
  title: 5,
  tags: 4,
  summary: 3,
  category: 2,
  content: 1,
} as const;

/**
 * 将条目写入倒排索引
 * 记录 term 来源字段权重:term → entryId(评分时按字段权重加权)
 */
function indexEntry(store: TenantStore, entry: KnowledgeEntry): void {
  const fields: Array<[string, number]> = [
    [entry.title, FIELD_WEIGHTS.title],
    [entry.tags.join(' '), FIELD_WEIGHTS.tags],
    [entry.summary, FIELD_WEIGHTS.summary],
    [entry.category, FIELD_WEIGHTS.category],
    [entry.content, FIELD_WEIGHTS.content],
  ];
  for (const [text] of fields) {
    for (const term of tokenize(text)) {
      let bucket = store.index.get(term);
      if (!bucket) {
        bucket = new Set<string>();
        store.index.set(term, bucket);
      }
      bucket.add(entry.id);
    }
  }
}

/** 从倒排索引移除条目(简化:全量重建该租户索引) */
function rebuildTenantIndex(store: TenantStore): void {
  store.index.clear();
  for (const entry of store.entries.values()) {
    indexEntry(store, entry);
  }
  store.lastBuildAt = new Date().toISOString();
}

// ============================================================
// 3. 种子数据(艺术教育知识库)
// ============================================================

/** 种子条目模板(不含租户/审计字段,加载时注入) */
interface SeedEntry {
  title: string;
  summary: string;
  content: string;
  artType: ArtType | null;
  tags: string[];
  category: string;
  source: KnowledgeSource;
  status: KnowledgeStatus;
}

const SEED_ENTRIES: SeedEntry[] = [
  {
    title: '素描的三大面五大调',
    summary: '讲解素描造型中明暗关系的基本规律:亮面、灰面、暗面三大面,以及高光、亮部、中间调、暗部、反光五大调子。',
    content:
      '## 三大面\n物体受光后呈现出亮面、灰面、暗面三个基本明暗区域。\n\n## 五大调\n1. 高光:光源直接反射点\n2. 亮部:受光最强的面\n3. 中间调:明暗过渡区\n4. 暗部:背光区域\n5. 反光:环境反射光\n\n掌握三大面五大调是素描造型的基础,适用于几何体、静物、石膏像与头像写生。',
    artType: 'painting',
    tags: ['素描', '明暗', '基础', '造型'],
    category: '绘画基础',
    source: 'manual',
    status: 'published',
  },
  {
    title: '透视原理:一点透视与两点透视',
    summary: '介绍线性透视的基本原理,包括视平线、消失点的概念,以及一点透视和两点透视在场景绘画中的应用。',
    content:
      '## 一点透视(平行透视)\n只有一个消失点,适用于正面视角的街道、走廊等场景。\n\n## 两点透视(成角透视)\n两个消失点位于视平线两端,适用于表现建筑物的转角。\n\n## 常见错误\n- 消失点不在同一视平线上\n- 近大远小比例失调',
    artType: 'painting',
    tags: ['透视', '素描', '场景', '基础'],
    category: '绘画基础',
    source: 'manual',
    status: 'published',
  },
  {
    title: '色彩三要素:色相、明度、纯度',
    summary: '色彩的基本属性解析:色相决定颜色种类,明度决定深浅,纯度决定鲜艳程度,并介绍调色实践中的运用。',
    content:
      '## 色相\n颜色的相貌,如红、黄、蓝。\n\n## 明度\n颜色的明暗程度。\n\n## 纯度(饱和度)\n颜色的鲜艳程度。\n\n## 实践建议\n水粉写生时先铺大色调,注意冷暖对比与整体色调统一。',
    artType: 'painting',
    tags: ['色彩', '水粉', '色调', '基础'],
    category: '色彩理论',
    source: 'manual',
    status: 'published',
  },
  {
    title: '构图法则:黄金分割与视觉中心',
    summary: '讲解经典构图法则,包括黄金分割、三分法、对角线构图,帮助建立画面主次与视觉引导。',
    content:
      '## 黄金分割\n比例约为 1:0.618,主体置于分割点附近最具美感。\n\n## 三分法\n将画面横竖各三等分,交点为视觉中心。\n\n## 对角线构图\n增强动感与纵深感。\n\n忌居中呆板、忌主体贴边。',
    artType: null,
    tags: ['构图', '黄金分割', '视觉中心', '创作'],
    category: '创作方法',
    source: 'manual',
    status: 'published',
  },
  {
    title: '人物速写的比例与动态',
    summary: '人物速写入门:立七坐五盘三半的头身比例法则,动态线的捕捉方法,以及衣纹处理技巧。',
    content:
      '## 头身比例\n站立约 7 个头长,坐姿约 5 个,盘腿约 3.5 个。\n\n## 动态线\n从头顶到支撑点的主要动势线,决定人物姿态。\n\n## 训练方法\n每天 10 张 5 分钟快写,重点抓大动态而非细节。',
    artType: 'painting',
    tags: ['速写', '人物', '比例', '动态'],
    category: '绘画基础',
    source: 'manual',
    status: 'published',
  },
  {
    title: '平面设计的版式基础',
    summary: '版式设计核心原则:对比、重复、对齐、亲密性(CRAP 原则),以及网格系统的基本用法。',
    content:
      '## CRAP 原则\n- Contrast 对比\n- Repetition 重复\n- Alignment 对齐\n- Proximity 亲密性\n\n## 网格系统\n12 栏网格是最常用的版式骨架,保证信息层级清晰。',
    artType: 'design',
    tags: ['版式', '平面设计', '网格', '排版'],
    category: '设计理论',
    source: 'manual',
    status: 'published',
  },
  {
    title: '产品手绘效果图表现技法',
    summary: '马克笔产品效果图的绘制流程:起稿、铺色、塑造、高光,以及材质(金属/塑料/玻璃)的表现要点。',
    content:
      '## 绘制流程\n1. 针管笔起稿\n2. 马克笔铺大色\n3. 叠色塑造体积\n4. 白笔点高光\n\n## 材质表现\n金属强对比、塑料柔和过渡、玻璃留白反光。',
    artType: 'product',
    tags: ['马克笔', '产品手绘', '效果图', '材质'],
    category: '产品设计',
    source: 'manual',
    status: 'published',
  },
  {
    title: '雕塑的空间与体量感',
    summary: '雕塑艺术的核心语言:体量、空间、肌理。从泥塑练习理解三维造型与负空间的关系。',
    content:
      '## 体量感\n雕塑以实体占据空间,体量是第一语言。\n\n## 负空间\n实体之外的虚空部分同样参与造型。\n\n## 训练建议\n从小件泥塑头像开始,注重多角度观察。',
    artType: 'sculpture',
    tags: ['雕塑', '泥塑', '体量', '空间'],
    category: '雕塑基础',
    source: 'manual',
    status: 'published',
  },
  {
    title: '艺考生色彩静物常见失分点',
    summary: '总结联考色彩静物的高频失分问题:色调不统一、冷暖混乱、投影脏、主体不突出,并给出改进方法。',
    content:
      '## 高频失分点\n1. 色调不统一,画面花乱\n2. 冷暖关系混乱\n3. 投影颜色脏、闷\n4. 主体物塑造不深入\n\n## 改进\n起稿后先定色调,大笔铺色阶段控制整体关系。',
    artType: 'painting',
    tags: ['色彩', '联考', '静物', '应试'],
    category: '应试指导',
    source: 'ai-generated',
    status: 'published',
  },
  {
    title: '素描头像的结构与骨点',
    summary: '头像素描进阶:颅骨结构、主要骨点(额结节、颧骨、下颌角)的位置与表现,避免"画皮不画骨"。',
    content:
      '## 主要骨点\n- 额结节\n- 眉弓\n- 颧骨\n- 下颌角\n\n## 常见问题\n只描摹明暗而忽略内在结构,导致形体松软。\n\n建议结合骷髅头写生理解结构。',
    artType: 'painting',
    tags: ['素描', '头像', '结构', '骨点'],
    category: '绘画基础',
    source: 'manual',
    status: 'published',
  },
  {
    title: '设计素描与全因素素描的区别',
    summary: '对比设计类素描与造型类全因素素描在目的、表现手法与评价标准上的差异,帮助考生明确方向。',
    content:
      '## 全因素素描\n追求光影、质感、空间的真实再现。\n\n## 设计素描\n强调结构分析、创意构成与形式语言,服务于设计思维。',
    artType: 'design',
    tags: ['素描', '设计素描', '校考', '对比'],
    category: '应试指导',
    source: 'imported',
    status: 'published',
  },
  {
    title: '中国传统水墨画的留白意境',
    summary: '水墨画留白的美学内涵:计白当黑、虚实相生,以及留白在山水、花鸟构图中的具体运用。',
    content:
      '## 计白当黑\n空白处亦是画面的有机组成。\n\n## 虚实相生\n实景与留白相互衬托,营造意境。\n\n代表画家:八大山人、齐白石。',
    artType: 'painting',
    tags: ['水墨', '留白', '国画', '意境'],
    category: '艺术鉴赏',
    source: 'manual',
    status: 'published',
  },
  {
    title: '校考创意速写命题解析方法',
    summary: '针对设计类校考创意速写:审题、立意、构图、表现四步解题法,附近年真题分析。',
    content:
      '## 四步解题\n1. 审题:圈出关键词\n2. 立意:确定主题表达\n3. 构图:安排画面元素\n4. 表现:选择合适技法\n\n## 真题示例\n"未来教室":需体现科技感与教育场景。',
    artType: 'design',
    tags: ['速写', '创意', '校考', '命题'],
    category: '应试指导',
    source: 'ai-generated',
    status: 'draft',
  },
  {
    title: '油画材料与媒介剂入门',
    summary: '油画颜料、调色油、松节油、上光油的基本用途与肥盖瘦原则,帮助初学者安全使用油画材料。',
    content:
      '## 常用媒介\n- 调色油:增加流动性\n- 松节油:稀释与洗笔\n- 上光油:画面保护\n\n## 肥盖瘦\n含油多的涂层覆盖含油少的涂层,防止开裂。',
    artType: 'painting',
    tags: ['油画', '材料', '媒介剂'],
    category: '材料技法',
    source: 'external',
    status: 'archived',
  },
];

/**
 * 获取租户存储(首次访问时注入种子数据并建索引)
 * 种子数据为基线知识库,每个租户独立副本,互不影响
 */
function getTenantStore(tenantId: string): TenantStore {
  let store = stores.get(tenantId);
  if (store) return store;

  store = {
    entries: new Map<string, KnowledgeEntry>(),
    index: new Map<string, Set<string>>(),
    lastBuildAt: null,
    seeded: true,
  };
  const now = new Date().toISOString();
  for (const seed of SEED_ENTRIES) {
    const entry: KnowledgeEntry = {
      id: `kn-${randomUUID()}`,
      tenantId,
      title: seed.title,
      summary: seed.summary,
      content: seed.content,
      artType: seed.artType,
      artworkId: null,
      tags: seed.tags,
      category: seed.category,
      source: seed.source,
      status: seed.status,
      createdById: 'system',
      updatedById: 'system',
      createdAt: now,
      updatedAt: now,
    };
    store.entries.set(entry.id, entry);
  }
  rebuildTenantIndex(store);
  stores.set(tenantId, store);
  logger.info({ tenantId, docs: store.entries.size }, '[knowledge] tenant seeded');
  return store;
}

// ============================================================
// 4. 搜索评分
// ============================================================

/**
 * 计算条目与查询词的相关性分数(字段加权 + 短语加成)
 * @returns 原始分数(未归一化)
 */
function scoreEntry(entry: KnowledgeEntry, queryTokens: string[], rawQuery: string): number {
  let score = 0;

  // 字段词袋(惰性分词,条目量级小,开销可忽略)
  const fieldBags: Array<[string[], number]> = [
    [tokenize(entry.title), FIELD_WEIGHTS.title],
    [entry.tags.flatMap((t) => tokenize(t)), FIELD_WEIGHTS.tags],
    [tokenize(entry.summary), FIELD_WEIGHTS.summary],
    [tokenize(entry.category), FIELD_WEIGHTS.category],
    [tokenize(entry.content), FIELD_WEIGHTS.content],
  ];

  for (const token of queryTokens) {
    for (const [bag, weight] of fieldBags) {
      const hits = bag.filter((t) => t === token || t.includes(token) || token.includes(t)).length;
      if (hits > 0) score += hits * weight;
    }
  }

  // 短语精确加成:原始查询完整出现在标题/摘要中
  const phrase = rawQuery.trim().toLowerCase();
  if (phrase.length >= 2) {
    if (entry.title.toLowerCase().includes(phrase)) score += 20;
    if (entry.summary.toLowerCase().includes(phrase)) score += 8;
    if (entry.tags.some((t) => t.toLowerCase() === phrase)) score += 15;
  }

  return score;
}

// ============================================================
// 5. 对外服务接口
// ============================================================

/** 允许的排序默认值 */
const DEFAULT_STATUS: KnowledgeStatus = 'published';

/** 可检索非 published(草稿/归档)内容的角色 */
const ELEVATED_ROLES: readonly UserRole[] = ['teacher', 'admin', 'owner'];

/**
 * 知识库搜索
 * - 关键词:倒排索引召回 + 字段加权评分 + 归一化
 * - 筛选:tags(AND)/ category / artType / status
 * - 分页:page / pageSize
 * - 安全:服务端强制角色策略,非 elevated 角色仅可检索 published
 *   (与 validateSearch 策略一致,防止客户端直接传 status=draft 越权)
 */
function search(
  tenantId: string,
  role: UserRole,
  query: KnowledgeSearchQuery,
): KnowledgeSearchResponse {
  const store = getTenantStore(tenantId);
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));
  // 角色策略强制:student 等非 elevated 角色忽略其 status 入参,强制 published
  const requestedStatus = query.status ?? DEFAULT_STATUS;
  const status = ELEVATED_ROLES.includes(role) ? requestedStatus : DEFAULT_STATUS;
  const tagsFilter = (query.tags ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

  const rawQuery = (query.q ?? '').trim();
  const queryTokens = tokenize(rawQuery);

  // ---------- 召回与筛选 ----------
  const candidates: Array<{ entry: KnowledgeEntry; rawScore: number }> = [];
  for (const entry of store.entries.values()) {
    // 状态过滤(默认仅 published;显式传入 all 语义无,保持枚举)
    if (entry.status !== status) continue;
    // 分类过滤
    if (query.category && entry.category !== query.category) continue;
    // 作品类型过滤
    if (query.artType && entry.artType !== query.artType) continue;
    // 标签过滤(AND 语义:条目须包含全部筛选标签)
    if (tagsFilter.length > 0 && !tagsFilter.every((t) => entry.tags.includes(t))) continue;

    // 评分(无关键词时全部召回,按更新时间倒序)
    const rawScore = queryTokens.length > 0 ? scoreEntry(entry, queryTokens, rawQuery) : 1;
    if (queryTokens.length > 0 && rawScore <= 0) continue;
    candidates.push({ entry, rawScore });
  }

  // ---------- 排序 ----------
  const maxScore = Math.max(...candidates.map((c) => c.rawScore), 1);
  if (queryTokens.length > 0) {
    candidates.sort((a, b) => b.rawScore - a.rawScore || b.entry.updatedAt.localeCompare(a.entry.updatedAt));
  } else {
    candidates.sort((a, b) => b.entry.updatedAt.localeCompare(a.entry.updatedAt));
  }

  // ---------- 分页 ----------
  const total = candidates.length;
  const start = (page - 1) * pageSize;
  const items = candidates.slice(start, start + pageSize).map(({ entry, rawScore }) => ({
    ...entry,
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
 * 获取知识条目详情(含租户隔离)
 */
function getById(tenantId: string, id: string): KnowledgeEntry | null {
  const store = getTenantStore(tenantId);
  return store.entries.get(id) ?? null;
}

/**
 * 创建知识条目
 */
function create(
  tenantId: string,
  userId: string,
  input: CreateKnowledgeRequest,
): KnowledgeEntry {
  const store = getTenantStore(tenantId);
  const now = new Date().toISOString();
  const entry: KnowledgeEntry = {
    id: `kn-${randomUUID()}`,
    tenantId,
    title: input.title,
    summary: input.summary,
    content: input.content,
    artType: input.artType ?? null,
    artworkId: input.artworkId ?? null,
    tags: input.tags ?? [],
    category: input.category,
    source: input.source ?? 'manual',
    status: input.status ?? 'draft',
    createdById: userId,
    updatedById: userId,
    createdAt: now,
    updatedAt: now,
  };
  store.entries.set(entry.id, entry);
  indexEntry(store, entry);
  store.lastBuildAt = now;
  logger.info({ tenantId, id: entry.id, title: entry.title }, '[knowledge] entry created');
  return entry;
}

/**
 * 更新知识条目(部分更新)
 */
function update(
  tenantId: string,
  id: string,
  userId: string,
  input: UpdateKnowledgeRequest,
): KnowledgeEntry | null {
  const store = getTenantStore(tenantId);
  const existing = store.entries.get(id);
  if (!existing) return null;

  const updated: KnowledgeEntry = {
    ...existing,
    ...(input.title !== undefined && { title: input.title }),
    ...(input.summary !== undefined && { summary: input.summary }),
    ...(input.content !== undefined && { content: input.content }),
    ...(input.artType !== undefined && { artType: input.artType }),
    ...(input.artworkId !== undefined && { artworkId: input.artworkId }),
    ...(input.tags !== undefined && { tags: input.tags }),
    ...(input.category !== undefined && { category: input.category }),
    ...(input.status !== undefined && { status: input.status }),
    updatedById: userId,
    updatedAt: new Date().toISOString(),
  };
  store.entries.set(id, updated);
  // 简化策略:增量移除代价高,租户量级小,直接重建该租户索引
  rebuildTenantIndex(store);
  logger.info({ tenantId, id }, '[knowledge] entry updated');
  return updated;
}

/**
 * 删除知识条目
 */
function remove(tenantId: string, id: string): boolean {
  const store = getTenantStore(tenantId);
  if (!store.entries.delete(id)) return false;
  rebuildTenantIndex(store);
  logger.info({ tenantId, id }, '[knowledge] entry deleted');
  return true;
}

/**
 * 重建索引(同步实现,条目量级小;v2.0 迁 ES 时改异步任务)
 */
function rebuildIndex(tenantId: string): KnowledgeIndexRebuildResponse {
  const store = getTenantStore(tenantId);
  const startedAt = new Date().toISOString();
  rebuildTenantIndex(store);
  logger.info({ tenantId, docs: store.entries.size }, '[knowledge] index rebuilt');
  return {
    taskId: `rebuild-${randomUUID()}`,
    rebuiltCount: store.entries.size,
    status: 'completed',
    startedAt,
  };
}

/**
 * 索引状态查询
 */
function getIndexStatus(tenantId: string): KnowledgeIndexStatus {
  const store = getTenantStore(tenantId);
  return {
    ready: store.lastBuildAt !== null,
    indexType: 'keyword',
    totalDocs: store.entries.size,
    indexedDocs: store.entries.size,
    lastBuildAt: store.lastBuildAt,
    rebuilding: false,
  };
}

/** 搜索权限矩阵说明:草稿/归档内容仅教师及以上可见(ELEVATED_ROLES 定义见 search 上方) */

/**
 * 搜索权限预校验
 * - 学生(student)不允许检索 draft / archived 状态
 * - 校准查询条件:钳制分页参数、注入默认状态
 */
function validateSearch(
  role: UserRole,
  query: KnowledgeSearchQuery,
): KnowledgeSearchValidateResponse {
  const requestedStatus = query.status ?? DEFAULT_STATUS;

  // 权限校验:非 elevated 角色不可检索非 published 内容
  if (requestedStatus !== 'published' && !ELEVATED_ROLES.includes(role)) {
    return {
      allowed: false,
      reason: '当前角色无权检索草稿或归档内容',
      sanitizedQuery: { ...query, status: DEFAULT_STATUS },
    };
  }

  // 校准:钳制分页,规范化关键词
  const sanitizedQuery: KnowledgeSearchQuery = {
    ...query,
    q: (query.q ?? '').trim().slice(0, 100),
    page: Math.max(1, query.page ?? 1),
    pageSize: Math.min(100, Math.max(1, query.pageSize ?? 20)),
    status: requestedStatus,
  };

  return {
    allowed: true,
    reason: null,
    sanitizedQuery,
  };
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

export const knowledgeService = {
  search,
  getById,
  create,
  update,
  remove,
  rebuildIndex,
  getIndexStatus,
  validateSearch,
  tokenize,
  __clearForTest,
};
