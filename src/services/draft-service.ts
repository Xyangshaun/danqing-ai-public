// ============================================================
// 丹青有AI - 创作草稿服务 (任务包 A)
// ------------------------------------------------------------
// 设计目标:
//   1. 上传图片后自动创建草稿,刷新页面/切标签后可在工作台"继续创作"
//   2. 分析成功完成自动清理草稿,失败保留以便用户继续
//   3. 多租户隔离:草稿带 tenantId/userId,listDrafts 按当前用户过滤
//   4. LocalStorage 存储,所有读写 try-catch 兜底,失败不抛错不阻塞主流程
//   5. 跨标签同步:subscribeDrafts 监听 storage 事件,实现多标签实时刷新
//
// 存储格式:
//   - 单条草稿: dq_draft_<uuid>  -> JSON.stringify(Draft)
//   - 索引列表:  dq_draft_index   -> JSON.stringify(string[])  (id 列表)
//
// 注意:
//   - 草稿是前端独有概念(LocalStorage),不与后端表同步,故类型定义在本文件
//   - 不引入新依赖,uuid 用 crypto.randomUUID() (Node 19+ / 现代浏览器原生支持)
// ============================================================

/** 草稿状态:草稿 / 分析中 */
export type DraftStatus = 'draft' | 'analyzing';

/** 创作草稿 */
export interface Draft {
  /** uuid v4 */
  id: string;
  /** 当前用户租户 ID (多租户隔离) */
  tenantId: string;
  /** 当前用户 ID */
  userId: string;
  /** 标题,默认 "未命名作品_<时间戳>" */
  title: string;
  /** 作品类型 (painting/design/product/sculpture) */
  artworkType: string;
  /** 风格分类 (可选) */
  styleCategory?: string;
  /** 创作备注 (可选) */
  notes?: string;
  /** 缩略图 dataURL (最大 200x200 压缩,可选) */
  imagePreview?: string;
  /** 状态 */
  status: DraftStatus;
  /** 创建时间 (unix ms) */
  createdAt: number;
  /** 更新时间 (unix ms) */
  updatedAt: number;
}

/** 创建草稿输入 (id/时间戳/status 由服务自动生成) */
export type CreateDraftInput = Omit<Draft, 'id' | 'createdAt' | 'updatedAt' | 'status'>;

/** LocalStorage key 前缀与索引 key */
const DRAFT_KEY_PREFIX = 'dq_draft_';
const DRAFT_INDEX_KEY = 'dq_draft_index';

/** 自动清理阈值:7 天 (ms) */
const AUTO_CLEAN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/* ============================================================
 * LocalStorage 配额检测与 LRU 淘汰
 * ------------------------------------------------------------
 * 浏览器 LocalStorage 典型上限 5MB(UTF-16 字符计数),含 imagePreview
 * dataURL(200x200 约 5-15KB/张)的草稿约 300-600 张即可能爆配额。
 * 写入前预估占用,超 80% 高水位触发 LRU 淘汰最旧草稿至 60% 低水位;
 * 写入失败(QuotaExceededError)时紧急淘汰至 30% 后重试一次。
 * ============================================================ */

/** LocalStorage 配额上限估算(字符数,近似浏览器 5MB 限制) */
const QUOTA_LIMIT_CHARS = 5_000_000;
/** 高水位(80%):超过触发 LRU 淘汰 */
const QUOTA_HIGH_WATER = 0.8;
/** 低水位(60%):LRU 淘汰至此停止 */
const QUOTA_LOW_WATER = 0.6;
/** 紧急水位(30%):写入失败时淘汰至此 */
const QUOTA_EMERGENCY_WATER = 0.3;

/* ============================================================
 * 内部工具:安全 LocalStorage 读写 (失败返回 null/空,不抛错)
 * ============================================================ */

/** 读取单条草稿原始 JSON,失败返回 null */
function readDraftRaw(id: string): Draft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY_PREFIX + id);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!isDraft(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * 写入单条草稿
 * 含配额检测:写入前若预估超过 80% 高水位,先 LRU 淘汰最旧草稿(排除当前草稿);
 * 写入失败(QuotaExceededError / 隐私模式)时紧急 LRU 淘汰至 30% 后重试一次
 * @returns 写入成功返回 true;LocalStorage 不可用或超配额返回 false
 */
function writeDraftRaw(draft: Draft): boolean {
  const serialized = JSON.stringify(draft);
  // 配额检测:预估写入后占用,超 80% 高水位 → LRU 淘汰至 60% 低水位
  const currentChars = estimateDraftsChars();
  let existingChars = 0;
  try {
    const existing = localStorage.getItem(DRAFT_KEY_PREFIX + draft.id);
    if (existing) existingChars = existing.length;
  } catch {
    /* 静默 */
  }
  const projectedChars = currentChars - existingChars + serialized.length;
  if (projectedChars > QUOTA_LIMIT_CHARS * QUOTA_HIGH_WATER) {
    evictLRU(QUOTA_LIMIT_CHARS * QUOTA_LOW_WATER, draft.id);
  }
  try {
    localStorage.setItem(DRAFT_KEY_PREFIX + draft.id, serialized);
    return true;
  } catch {
    // 写入失败:紧急 LRU 淘汰至 30% 后重试一次
    evictLRU(QUOTA_LIMIT_CHARS * QUOTA_EMERGENCY_WATER, draft.id);
    try {
      localStorage.setItem(DRAFT_KEY_PREFIX + draft.id, serialized);
      return true;
    } catch {
      // 仍然失败(隐私模式 / 配额极小):放弃
      return false;
    }
  }
}

/** 删除单条草稿,失败静默 */
function removeDraftRaw(id: string): void {
  try {
    localStorage.removeItem(DRAFT_KEY_PREFIX + id);
  } catch {
    /* 静默 */
  }
}

/** 读取索引 (id 列表),损坏时返回空数组并自我修复 */
function readIndex(): string[] {
  try {
    const raw = localStorage.getItem(DRAFT_INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string' && x.length > 0);
  } catch {
    return [];
  }
}

/** 写入索引,失败返回 false */
function writeIndex(ids: string[]): boolean {
  try {
    localStorage.setItem(DRAFT_INDEX_KEY, JSON.stringify(ids));
    return true;
  } catch {
    return false;
  }
}

/* ============================================================
 * 配额估算与 LRU 淘汰(内部工具)
 * ============================================================ */

/**
 * 估算当前草稿相关 LocalStorage 占用(字符数)
 * 遍历索引 key + 所有草稿 key,累加字符串长度
 */
function estimateDraftsChars(): number {
  let total = 0;
  try {
    const idxRaw = localStorage.getItem(DRAFT_INDEX_KEY);
    if (idxRaw) total += idxRaw.length;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(DRAFT_KEY_PREFIX)) continue;
      const raw = localStorage.getItem(key);
      if (raw) total += raw.length;
    }
  } catch {
    /* 静默 */
  }
  return total;
}

/**
 * LRU 淘汰:按 updatedAt 升序(最旧优先)删除草稿,直到占用 ≤ targetChars
 * @param targetChars 目标占用字符数
 * @param excludeId 排除的草稿 ID(正在写入的草稿不淘汰)
 * @returns 实际删除数量
 */
function evictLRU(targetChars: number, excludeId?: string): number {
  let removed = 0;
  const removedIds: string[] = [];
  try {
    const ids = readIndex();
    const entries: Array<{ id: string; updatedAt: number; chars: number }> = [];
    for (const id of ids) {
      if (id === excludeId) continue;
      const raw = localStorage.getItem(DRAFT_KEY_PREFIX + id);
      if (!raw) continue;
      let updatedAt = 0;
      try {
        const parsed = JSON.parse(raw) as { updatedAt?: unknown };
        if (typeof parsed.updatedAt === 'number') updatedAt = parsed.updatedAt;
      } catch {
        /* 损坏数据 → updatedAt=0,最先被淘汰 */
      }
      entries.push({ id, updatedAt, chars: raw.length });
    }
    // 按 updatedAt 升序(最旧优先)淘汰
    entries.sort((a, b) => a.updatedAt - b.updatedAt);
    let currentChars = estimateDraftsChars();
    for (const entry of entries) {
      if (currentChars <= targetChars) break;
      removeDraftRaw(entry.id);
      currentChars -= entry.chars;
      removedIds.push(entry.id);
      removed++;
    }
    // 同步更新索引(移除已淘汰的 id)
    if (removedIds.length > 0) {
      const removedSet = new Set(removedIds);
      const remaining = ids.filter((id) => !removedSet.has(id));
      writeIndex(remaining);
    }
  } catch {
    /* 静默 */
  }
  return removed;
}

/**
 * 模块级 flag:控制 reconcileIndex 在首次 listDrafts 时惰性触发一次
 * 避免每次列表都扫描 localStorage(仅在会话首次补全历史孤儿)
 */
let reconcileDone = false;

/**
 * 扫描 LocalStorage 中所有草稿 key,补全索引中缺失的 id(修复历史孤儿)
 * 场景:历史版本 createDraft 索引写入失败导致的孤儿草稿(本体存在但不在索引中)
 * @returns 补全的条数(0 表示无需补全或 localStorage 不可用)
 */
export function reconcileIndex(): number {
  let added = 0;
  try {
    const existingIds = new Set(readIndex());
    const missing: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(DRAFT_KEY_PREFIX)) continue;
      const id = key.slice(DRAFT_KEY_PREFIX.length);
      if (id && !existingIds.has(id)) {
        missing.push(id);
      }
    }
    if (missing.length > 0) {
      const merged = [...existingIds, ...missing];
      if (writeIndex(merged)) {
        added = missing.length;
      }
    }
  } catch {
    /* localStorage 不可用,静默 */
  }
  return added;
}

/** 类型守卫:校验对象是否为合法 Draft */
function isDraft(v: unknown): v is Draft {
  if (!v || typeof v !== 'object') return false;
  const d = v as Record<string, unknown>;
  return (
    typeof d.id === 'string' &&
    typeof d.tenantId === 'string' &&
    typeof d.userId === 'string' &&
    typeof d.title === 'string' &&
    typeof d.artworkType === 'string' &&
    (d.status === 'draft' || d.status === 'analyzing') &&
    typeof d.createdAt === 'number' &&
    typeof d.updatedAt === 'number'
  );
}

/** 生成 uuid v4,优先用 crypto.randomUUID,不可用时降级到手动实现 */
function uuid(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    /* 降级 */
  }
  // 降级:基于 Math.random 的 RFC4122 v4 (无 crypto.randomUUID 环境)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/* ============================================================
 * 公开 API
 * ============================================================ */

/**
 * 创建草稿
 * 写入单条数据 + 追加索引,任一失败时尝试回滚已写入部分
 * @returns 创建成功的草稿;LocalStorage 不可用时返回 null
 */
export function createDraft(input: CreateDraftInput): Draft | null {
  const now = Date.now();
  const draft: Draft = {
    id: uuid(),
    tenantId: input.tenantId,
    userId: input.userId,
    title: input.title || `未命名作品_${now}`,
    artworkType: input.artworkType,
    styleCategory: input.styleCategory,
    notes: input.notes,
    imagePreview: input.imagePreview,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
  };

  // 先写草稿本体,失败直接返回 null
  if (!writeDraftRaw(draft)) return null;

  // 再追加索引,失败时回滚草稿本体(避免孤儿草稿:listDrafts 只遍历索引,不在索引中的草稿无法被发现)
  const ids = readIndex();
  if (ids.includes(draft.id)) {
    // 理论上不会出现,防御性处理
    return draft;
  }
  ids.push(draft.id);
  if (!writeIndex(ids)) {
    // 索引写入失败:回滚草稿本体,保持索引与数据一致
    removeDraftRaw(draft.id);
    return null;
  }

  return draft;
}

/**
 * 列出当前用户(租户+用户)的草稿,按 updatedAt 倒序
 * - 顺便清理 7 天前的过期草稿 (全局,不分租户)
 * - 修复索引中失效的 id 引用 (草稿已被外部删除的情况)
 */
export function listDrafts(tenantId: string, userId: string): Draft[] {
  // 0. 惰性触发一次索引补全(修复历史孤儿草稿,会话内仅执行一次)
  if (!reconcileDone) {
    reconcileDone = true;
    reconcileIndex();
  }

  // 1. 全局清理过期草稿
  deleteDraftsByAge(AUTO_CLEAN_MAX_AGE_MS);

  const ids = readIndex();
  const validDrafts: Draft[] = [];
  const validIds: string[] = [];
  let indexChanged = false;

  for (const id of ids) {
    const draft = readDraftRaw(id);
    if (!draft) {
      // 草稿不存在 (已被外部清除),跳过并标记索引需修复
      indexChanged = true;
      continue;
    }
    validIds.push(id);
    // 多租户 + 用户隔离过滤
    if (draft.tenantId === tenantId && draft.userId === userId) {
      validDrafts.push(draft);
    }
  }

  // 2. 索引自愈:清除失效 id
  if (indexChanged) {
    writeIndex(validIds);
  }

  // 3. 按 updatedAt 倒序
  validDrafts.sort((a, b) => b.updatedAt - a.updatedAt);
  return validDrafts;
}

/** 按 id 获取单条草稿,不存在或损坏返回 null */
export function getDraft(id: string): Draft | null {
  return readDraftRaw(id);
}

/**
 * 更新草稿 (部分字段)
 * 自动刷新 updatedAt;id 不存在返回 null
 */
export function updateDraft(id: string, patch: Partial<Draft>): Draft | null {
  const existing = readDraftRaw(id);
  if (!existing) return null;

  // 不允许通过 patch 改 id/createdAt (保持身份与创建时间不变)
  const { id: _omitId, createdAt: _omitCreatedAt, ...safePatch } = patch;
  void _omitId;
  void _omitCreatedAt;

  const next: Draft = {
    ...existing,
    ...safePatch,
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: Date.now(),
  };

  if (!writeDraftRaw(next)) return null;
  return next;
}

/**
 * 删除草稿
 * 同步从索引移除,返回是否成功 (草稿原本不存在也视为成功)
 */
export function deleteDraft(id: string): boolean {
  // 先从索引移除
  const ids = readIndex();
  const nextIds = ids.filter((x) => x !== id);
  if (nextIds.length !== ids.length) {
    writeIndex(nextIds);
  }
  // 再删草稿本体
  removeDraftRaw(id);
  return true;
}

/**
 * 清理过期草稿 (按 updatedAt 计算年龄)
 * @param maxAgeMs 最大年龄 (毫秒),超过则删除
 * @returns 实际删除数量
 */
export function deleteDraftsByAge(maxAgeMs: number): number {
  const now = Date.now();
  const ids = readIndex();
  const keepIds: string[] = [];
  let removed = 0;

  for (const id of ids) {
    const draft = readDraftRaw(id);
    // 草稿不存在或已损坏:从索引移除 (计为清理)
    if (!draft) {
      removed++;
      continue;
    }
    // 超龄:删除本体,不保留索引
    if (now - draft.updatedAt > maxAgeMs) {
      removeDraftRaw(id);
      removed++;
      continue;
    }
    keepIds.push(id);
  }

  if (removed > 0) {
    writeIndex(keepIds);
  }
  return removed;
}

/* ============================================================
 * 跨标签同步:监听 storage 事件(增量通知)
 * ============================================================ */

/** 草稿变更类型(跨标签增量通知) */
export type DraftChangeType = 'add' | 'update' | 'delete';

/** 草稿变更事件(跨标签增量同步) */
export interface DraftChange {
  /** 变更类型 */
  type: DraftChangeType;
  /** 变更的草稿 ID */
  id: string;
}

/**
 * 订阅草稿变化 (跨标签增量同步)
 * 监听 window 'storage' 事件,仅在本标签之外的标签修改 LocalStorage 时触发
 * 同标签内的变更需由调用方自行刷新 (组件 state 驱动)
 *
 * 增量通知:回调接收 { type, id },调用方可按需更新单条而非全量 listDrafts 重拉
 * - add: 其他标签新建草稿(oldValue=null, newValue=JSON)
 * - update: 其他标签更新草稿(oldValue 和 newValue 均非 null)
 * - delete: 其他标签删除草稿(newValue=null)
 *
 * 注意:
 *   - 索引 key 变更不触发回调(与草稿 key 事件冗余,避免重复通知)
 *   - clear() 全清(key=null)不触发回调(上层重新拉取空列表,保持原有行为)
 *
 * @param cb 变化回调(接收增量变更信息)
 * @returns 取消订阅函数
 */
export function subscribeDrafts(cb: (change: DraftChange) => void): () => void {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
    return () => {
      /* no-op */
    };
  }
  const handler = (e: StorageEvent) => {
    // clear() 全清:key=null,不触发增量通知(上层重新拉取空列表)
    if (e.key === null) return;
    // 索引 key 变更:跳过(与草稿 key 事件冗余,避免重复通知)
    if (e.key === DRAFT_INDEX_KEY) return;
    // 仅关心草稿 key 变更
    if (!e.key.startsWith(DRAFT_KEY_PREFIX)) return;
    const id = e.key.slice(DRAFT_KEY_PREFIX.length);
    if (!id) return;
    // 根据 oldValue/newValue 推断变更类型
    let type: DraftChangeType;
    if (e.newValue === null) {
      type = 'delete';
    } else if (e.oldValue === null) {
      type = 'add';
    } else {
      type = 'update';
    }
    cb({ type, id });
  };
  window.addEventListener('storage', handler);
  return () => window.removeEventListener('storage', handler);
}

/** 暴露常量供测试与调试使用 */
export const DRAFT_CONSTANTS = {
  KEY_PREFIX: DRAFT_KEY_PREFIX,
  INDEX_KEY: DRAFT_INDEX_KEY,
  AUTO_CLEAN_MAX_AGE_MS,
  QUOTA_LIMIT_CHARS,
  QUOTA_HIGH_WATER,
  QUOTA_LOW_WATER,
  QUOTA_EMERGENCY_WATER,
} as const;
