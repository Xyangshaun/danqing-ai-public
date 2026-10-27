// ============================================================
// Prisma Mock(内存实现模拟 PrismaClient)
// 对应源码:src/config/prisma.ts(initPrisma / prisma / closePrisma)
// 对应模型:user / tenant / tenantMember / session / analysis
//
// 设计要点:
//   1. 内存 Map 存储记录,按模型分表
//   2. 支持 findUnique(by id / 唯一字段)/ findFirst / findMany / create / update / updateMany / count
//   3. 支持 $transaction(callback):callback 接收 mock 自身作为 tx
//   4. 支持 Prisma.DbNull / JsonNull 简化处理(analysis.result)
//   5. 不实现 Prisma 完整类型系统,方法签名宽松,运行时保证行为正确
//   6. 通过 prismaState 暴露内部 store 供测试断言(如验证 tenant_id 过滤)
// ============================================================

import { Prisma } from '@prisma/client';

// ============================================================
// Mock 数据模型(对应 prisma/schema.prisma)
// ============================================================

export interface MockUser {
  id: string;
  tenantId: string;
  feishuOpenId: string;
  feishuUnionId: string;
  name: string;
  avatar: string;
  email: string | null;
  phone: string | null;
  role: string;
  status: string; // 'active' | 'locked' | 'deleted'(Phase 4 扩展)
  authType: string; // 'feishu' | 'phone' | 'password'(Phase 5 扩展)
  passwordHash: string | null; // Phase 5 扩展(高危操作 confirmPassword 校验)
  lockedAt: Date | null; // Phase 4 扩展
  lockedBy: string | null; // Phase 4 扩展
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt: Date | null;
}

export interface MockTenant {
  id: string;
  name: string;
  type: string;
  feishuTenantKey: string | null;
  plan: string;
  status: string;
  maxSeats: number;
  parentId: string | null;
  createdAt: Date;
}

export interface MockTenantMember {
  userId: string;
  tenantId: string;
  role: string;
  joinedAt: Date;
}

export interface MockSession {
  id: string;
  userId: string;
  tenantId: string;
  refreshTokenHash: string;
  userAgent: string;
  ip: string;
  expiresAt: Date;
  createdAt: Date;
  revokedAt: Date | null;
}

export interface MockAnalysis {
  id: string;
  tenantId: string;
  userId: string;
  workType: string;
  imageUrl: string;
  title: string | null;
  remark: string | null;
  status: string;
  result: unknown;
  failureReason: string | null;
  overallScore: number | null;
  durationMs: number | null;
  reviewStatus: string | null; // 'pending' | 'approved' | 'rejected' | 'flagged'(Phase 4 扩展)
  reviewedBy: string | null; // Phase 4 扩展
  reviewedAt: Date | null; // Phase 4 扩展
  reviewNote: string | null; // Phase 4 扩展
  diagnosisMode: string; // 反馈闭环 Phase 4 批次②读取(schema 默认 'teaching')
  createdAt: Date;
  completedAt: Date | null;
}

// 反馈闭环 Phase 4 批次②:标注反馈(数据飞轮)
// 对应 schema.prisma MarkerFeedback;@@unique([analysisId,userId,markerIndex])
export interface MockMarkerFeedback {
  id: string;
  tenantId: string;
  userId: string;
  analysisId: string;
  markerId: string | null;
  markerIndex: number;
  action: string;
  markerSnapshot: unknown;
  workType: string | null;
  diagnosisMode: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// 反馈闭环 Phase 4 批次③:标注级教师批注
// 对应 schema.prisma TeacherAnnotation;@@unique([analysisId,markerIndex,teacherId])
export interface MockTeacherAnnotation {
  id: string;
  tenantId: string;
  analysisId: string;
  teacherId: string;
  markerId: string | null;
  markerIndex: number;
  markerSnapshot: unknown;
  action: string;
  comment: string;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================
// Phase 4 新增 Mock 数据模型
// ============================================================

export interface MockAuditLog {
  id: string;
  operatorId: string;
  operatorRole: string;
  operatorTenantId: string | null;
  action: string;
  resource: string;
  resourceId: string | null;
  targetTenantId: string | null;
  beforeData: unknown;
  afterData: unknown;
  ip: string;
  userAgent: string;
  traceId: string | null;
  note: string | null;
  createdAt: Date;
}

export interface MockApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  keyHash: string;
  tenantId: string | null;
  scopes: unknown;
  status: string; // 'active' | 'revoked'
  createdById: string;
  revokedAt: Date | null;
  revokedBy: string | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  lastUsedAt: Date | null;
  lastUsedIp: string | null;
}

export interface MockCreativeTemplate {
  id: string;
  name: string;
  description: string | null;
  artType: string;
  content: unknown;
  tags: unknown;
  thumbnailUrl: string | null;
  enabled: boolean;
  sortOrder: number;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface MockSubscription {
  id: string;
  tenantId: string;
  plan: string;
  status: string; // 'active' | 'past_due' | 'canceled' | 'expired'
  periodStart: Date;
  periodEnd: Date;
  cancelAtPeriodEnd: boolean;
  paymentProvider: string | null;
  externalSubId: string | null;
  amount: bigint | number;
  currency: string;
  seats: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface MockInvoice {
  id: string;
  tenantId: string;
  subscriptionId: string;
  amount: bigint | number;
  currency: string;
  status: string; // 'paid' | 'pending' | 'refunded' | 'failed'
  periodStart: Date;
  periodEnd: Date;
  paidAt: Date | null;
  paymentProvider: string | null;
  externalInvoiceId: string | null;
  description: string | null;
  createdAt: Date;
}

// ============================================================
// M-2 新增 Mock 数据模型:AI 图像生成任务
// 对应 prisma/schema.prisma GenerationTask(M-2 计划 §3.2)
// 对应 api-contract.ts §3.17(契约已冻结)
// ============================================================

export interface MockGenerationTask {
  id: string;
  tenantId: string; // 多租户隔离核心字段
  userId: string;
  inputType: string; // 'text' | 'sketch' | 'style'(M-4 扩展)
  prompt: string | null;
  sketchImageUrl: string | null;
  artType: string; // 'painting' | 'design' | 'product' | 'sculpture'
  aspect: string | null; // 'portrait' | 'landscape' | 'square'
  count: number; // 1-4
  status: string; // 'pending' | 'processing' | 'success' | 'failed'
  images: unknown; // GeneratedImage[] 数组(含 reviewStatus),Json 类型
  failureReason: string | null;
  usedFallback: boolean;
  provider: string | null;
  model: string | null;
  // M-4 新增三列(DOC-2026-09-002,对应 schema.prisma GenerationTask 扩展)
  styleImageUrl: string | null; // style 模式风格参考图(dataURL 或 http URL)
  styleAnalysis: unknown; // StyleAnalysis 七字段,Json 类型(两阶段落库阶段 1 写入)
  processingStartedAt: Date | null; // Worker 开始处理时间(stalled 恢复扫描判定基准)
  createdAt: Date;
  completedAt: Date | null;
}

// ============================================================
// M-2 新增 Mock 数据模型:AI 用量日志
// 对应 prisma/schema.prisma AiUsageLog(M-2 追加 usageType/generationId)
// ============================================================

export interface MockAiUsageLog {
  id: string;
  tenantId: string;
  userId: string;
  analysisId: string | null;
  provider: string;
  model: string;
  apiUrl: string;
  success: boolean;
  durationMs: number;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  costYuan: unknown; // Decimal | null
  failureReason: string | null;
  usageType: string; // 'diagnose' | 'generate'
  generationId: string | null;
  // M3 可观测性:是否经降级 + traceId 全链路贯通(对齐 schema.prisma)
  usedFallback: boolean;
  traceId: string | null;
  createdAt: Date;
}

// ============================================================
// Phase 5 新增 Mock 数据模型:争议案件
// 对应 prisma/schema.prisma DisputeCase
// 管理员大屏 countGlobalByStatus(open/reviewing)依赖本模型
// ============================================================

export interface MockDisputeCase {
  id: string;
  tenantId: string;
  analysisId: string;
  status: string; // 'open' | 'reviewing' | 'resolved' | 'rejected'
  triggerLevel: string; // 'low' | 'medium' | 'high'
  triggerReason: unknown; // Json
  arbitrationConfig: unknown; // Json
  finalScore: unknown; // Json | null
  finalRule: string | null;
  resolvedBy: string | null;
  resolvedAt: Date | null;
  resolutionNote: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================
// 评分链路透明化(框架二 P2)新增 Mock 数据模型
// 对应 prisma/schema.prisma ScoreDiffRecord
// ============================================================

export interface MockScoreDiffRecord {
  id: string;
  analysisId: string;
  tenantId: string;
  source: string; // 'teacher_review' | 'dispute_final'
  reviewerId: string | null;
  aiScore: unknown; // Json
  aiBand: string;
  humanScore: unknown; // Json
  humanBand: string;
  overallDiff: number;
  dimensionDiffs: unknown; // Json
  bandAgreement: boolean;
  artType: string;
  createdAt: Date;
}

// ============================================================
// 组织内分享新增 Mock 数据模型(报告导出+组织分享特性)
// 对应 prisma/schema.prisma SharedWork / ShareComment
// 多租户:SharedWork.tenantId 直接隔离;ShareComment 经 SharedWork 间接隔离
// ============================================================

export interface MockSharedWork {
  id: string;
  tenantId: string;
  analysisId: string;
  userId: string;
  caption: string | null;
  isPinned: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface MockShareComment {
  id: string;
  sharedWorkId: string;
  userId: string;
  content: string;
  createdAt: Date;
}

// ============================================================
// 投诉举报新增 Mock 数据模型(公安备案合规)
// 对应 prisma/schema.prisma Report
// 多租户:Report.tenantId 直接隔离;24h 去重走 (reporterId,targetId,createdAt) 查询
// ============================================================

export interface MockReport {
  id: string;
  tenantId: string;
  reporterId: string;
  targetType: string; // 'artwork' | 'comment' | 'user'
  targetId: string;
  reason: string; // 'porn' | 'violence' | 'politics' | 'copyright' | 'spam' | 'other'
  detail: string | null;
  status: string; // 'pending' | 'resolved' | 'dismissed'
  createdAt: Date;
  updatedAt: Date;
}

// 反馈闭环 Phase 5 批次③:评分档案(mock 对齐 GradingProfile)
export interface MockGradingProfile {
  id: string;
  name: string;
  description: string | null;
  category: string;
  config: unknown;
  isBuiltIn: boolean;
  isDefault: boolean;
  forkedFromId: string | null;
  creatorId: string | null;
  tenantId: string | null;
  enabled: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

// 反馈闭环 Phase 5 批次③:档案建议采纳记录(mock 对齐 ProfileSuggestionAdoption)
export interface MockProfileSuggestionAdoption {
  id: string;
  tenantId: string;
  teacherId: string;
  profileId: string;
  suggestionKey: string;
  beforeValue: number;
  afterValue: number;
  suggestionBasis: unknown;
  createdAt: Date;
}

// ============================================================
// Where 条件简化匹配
// 支持等值匹配 + 复合唯一键(userId_tenantId)+ 范围(gte/lte/in)
// ============================================================

type WhereValue = string | number | boolean | null | { equals?: unknown; gte?: unknown; lte?: unknown; in?: unknown[] } | Record<string, unknown>;

function matchValue(recordValue: unknown, condition: WhereValue): boolean {
  if (condition === null) {
    return recordValue === null;
  }
  if (typeof condition === 'object' && condition !== null && !Array.isArray(condition)) {
    const cond = condition as {
      equals?: unknown;
      gte?: unknown;
      lte?: unknown;
      lt?: unknown;
      gt?: unknown;
      in?: unknown[];
      contains?: string;
      mode?: string;
      not?: unknown;
    };
    // not 操作符:recordValue 不等于 cond.not(Phase 4 新增)
    if (cond.not !== undefined) {
      if (recordValue === cond.not) return false;
      // null 不等于 null 时通过,非 null 值不等于 cond.not 时通过
      return true;
    }
    // contains 操作符:字符串包含匹配(Phase 4 新增)
    if (cond.contains !== undefined) {
      if (typeof recordValue !== 'string') return false;
      const search = String(cond.contains);
      if (cond.mode === 'insensitive') {
        return recordValue.toLowerCase().includes(search.toLowerCase());
      }
      return recordValue.includes(search);
    }
    if (cond.equals !== undefined && recordValue !== cond.equals) return false;
    // 统一转换为时间戳进行比较(支持 Date 对象与 number)
    const toMs = (v: unknown): number => {
      if (v instanceof Date) return v.getTime();
      if (typeof v === 'number') return v;
      return NaN;
    };
    const recordMs = toMs(recordValue);
    if (cond.gte !== undefined && (Number.isNaN(recordMs) || recordMs < toMs(cond.gte))) return false;
    if (cond.lte !== undefined && (Number.isNaN(recordMs) || recordMs > toMs(cond.lte))) return false;
    if (cond.gt !== undefined && (Number.isNaN(recordMs) || recordMs <= toMs(cond.gt))) return false;
    if (cond.lt !== undefined && (Number.isNaN(recordMs) || recordMs >= toMs(cond.lt))) return false;
    if (cond.in !== undefined && !Array.isArray(cond.in)) return false;
    if (cond.in !== undefined && Array.isArray(cond.in) && !cond.in.includes(recordValue)) return false;
    return true;
  }
  return recordValue === condition;
}

function matchWhere<T extends Record<string, unknown>>(record: T, where: Record<string, unknown>): boolean {
  for (const [key, condition] of Object.entries(where)) {
    if (key === 'AND' && Array.isArray(condition)) {
      for (const sub of condition) {
        if (!matchWhere(record, sub as Record<string, unknown>)) return false;
      }
      continue;
    }
    if (key === 'OR' && Array.isArray(condition)) {
      const matched = condition.some((sub) => matchWhere(record, sub as Record<string, unknown>));
      if (!matched) return false;
      continue;
    }
    // 复合唯一键:userId_tenantId = { userId, tenantId }
    if (key === 'userId_tenantId' && typeof condition === 'object' && condition !== null) {
      const cond = condition as { userId?: string; tenantId?: string };
      if (cond.userId !== undefined && record['userId' as keyof T] !== cond.userId) return false;
      if (cond.tenantId !== undefined && record['tenantId' as keyof T] !== cond.tenantId) return false;
      continue;
    }
    const recordValue = record[key as keyof T];
    if (!matchValue(recordValue, condition as WhereValue)) return false;
  }
  return true;
}

/**
 * 按 select 裁剪记录字段(include 关系解析共用,对齐真实 Prisma select 语义)
 */
function pickFields<T extends Record<string, unknown>>(
  record: T,
  select: Record<string, boolean> | undefined,
): T | Partial<T> {
  if (!select) return record;
  const picked: Record<string, unknown> = {};
  for (const [field, enabled] of Object.entries(select)) {
    if (enabled && field in record) {
      picked[field] = record[field];
    }
  }
  return picked as Partial<T>;
}

/**
 * 嵌套关系过滤解析器(组织内分享:analysis: { workType } 等关系过滤)
 * 返回值:
 *   - true / false:该 key 已按关系过滤处理,采用返回值
 *   - undefined:非关系过滤 key,回退到默认 matchWhere 单键匹配
 */
type RelationFilter<T> = (record: T, key: string, condition: unknown) => boolean | undefined;

// ============================================================
// 各模型委托实现
// ============================================================

interface DelegateArgs {
  where?: Record<string, unknown>;
  data?: Record<string, unknown>;
  select?: unknown;
  include?: unknown;
  orderBy?: unknown;
  skip?: number;
  take?: number;
}

function pickId(args: DelegateArgs): string | undefined {
  const where = args.where;
  if (!where) return undefined;
  if (typeof where.id === 'string') return where.id;
  return undefined;
}

/**
 * 归一化 JSON 特殊值:Prisma.DbNull / Prisma.JsonNull → null
 * 真实 Prisma 中,JSON 字段赋 DbNull 会写入 SQL NULL;
 * mock 需同样把该哨兵值展开为 null,使仓储层行为与真实一致。
 */
function normalizeJsonNull(value: unknown): unknown {
  if (value === Prisma.DbNull || value === Prisma.JsonNull) return null;
  return value;
}

/**
 * 对 data 中的所有字段做归一化:
 *   1. DbNull/JsonNull → null
 *   2. undefined → 跳过(对齐真实 Prisma 语义:undefined 视为"未提供"字段,
 *      update 时不清空已有值,create 时由 fieldDefaults 补默认)
 */
function normalizeDataNulls(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    out[key] = normalizeJsonNull(value);
  }
  return out;
}

/**
 * include 关系解析器:为记录附加关联模型数据
 * 用于支持 tenantMember.findMany({ include: { user/tenant } }) 等场景
 */
type IncludeResolver<T> = (record: T, include: Record<string, unknown>) => T;

function createModelDelegate<T extends Record<string, unknown> & { id: string }>(
  store: Map<string, T>,
  uniqueFields: string[] = [],
  includeResolver?: IncludeResolver<T>,
  fieldDefaults: Record<string, unknown> = {},
  relationFilter?: RelationFilter<T>,
) {
  function applyInclude(record: T, include: unknown): T {
    if (!include || typeof include !== 'object' || !includeResolver) return record;
    return includeResolver(record, include as Record<string, unknown>);
  }

  /**
   * 记录匹配入口:默认走 matchWhere;注册 relationFilter 的委托逐键分发,
   * 使嵌套关系过滤(如 analysis: { workType })可被委托自定义解析
   */
  function matchesRecord(record: T, where: Record<string, unknown>): boolean {
    if (!relationFilter) return matchWhere(record, where);
    for (const [key, condition] of Object.entries(where)) {
      // AND / OR / 复合唯一键仍由通用 matchWhere 处理
      if (key === 'AND' || key === 'OR' || key === 'userId_tenantId') {
        if (!matchWhere(record, { [key]: condition })) return false;
        continue;
      }
      const handled = relationFilter(record, key, condition);
      if (handled === undefined) {
        if (!matchWhere(record, { [key]: condition })) return false;
      } else if (!handled) {
        return false;
      }
    }
    return true;
  }

  return {
    async findUnique(args: DelegateArgs): Promise<T | null> {
      const where = args.where ?? {};
      let result: T | null = null;
      // 按 id 查找
      if (typeof where.id === 'string') {
        result = store.get(where.id) ?? null;
      } else {
        // 按唯一字段查找
        for (const field of uniqueFields) {
          if (typeof where[field] === 'string') {
            for (const record of store.values()) {
              if (record[field as keyof T] === where[field]) {
                result = record;
                break;
              }
            }
            break;
          }
          // 复合唯一键
          if (field === 'userId_tenantId' && where.userId_tenantId && typeof where.userId_tenantId === 'object') {
            const cond = where.userId_tenantId as { userId?: string; tenantId?: string };
            for (const record of store.values()) {
              if (record['userId' as keyof T] === cond.userId && record['tenantId' as keyof T] === cond.tenantId) {
                result = record;
                break;
              }
            }
            break;
          }
        }
      }
      if (result === null) return null;
      return applyInclude(result, args.include);
    },

    async findFirst(args: DelegateArgs): Promise<T | null> {
      const where = args.where ?? {};
      for (const record of store.values()) {
        if (matchesRecord(record, where)) {
          return applyInclude(record, args.include);
        }
      }
      return null;
    },

    async findMany(args: DelegateArgs): Promise<T[]> {
      const where = args.where ?? {};
      let items = Array.from(store.values()).filter((r) => matchesRecord(r, where));
      // orderBy:支持 { createdAt: 'desc' } 单字段 / [{ isPinned: 'desc' }, { createdAt: 'desc' }] 多字段
      // 多字段时逆序应用排序键(Array.prototype.sort 稳定),保证数组首项为最高优先级
      if (args.orderBy && typeof args.orderBy === 'object') {
        const orderByList: Array<Record<string, 'asc' | 'desc'>> = Array.isArray(args.orderBy)
          ? (args.orderBy as Array<Record<string, 'asc' | 'desc'>>)
          : [args.orderBy as Record<string, 'asc' | 'desc'>];
        for (let i = orderByList.length - 1; i >= 0; i--) {
          const ob = orderByList[i]!;
          for (const [field, dir] of Object.entries(ob)) {
            items.sort((a, b) => {
              const av = a[field as keyof T];
              const bv = b[field as keyof T];
              if (av === bv) return 0;
              if (av === null || av === undefined) return 1;
              if (bv === null || bv === undefined) return -1;
              if (av < bv) return dir === 'asc' ? -1 : 1;
              return dir === 'asc' ? 1 : -1;
            });
          }
        }
      }
      // 分页
      if (args.skip !== undefined) items = items.slice(args.skip);
      if (args.take !== undefined) items = items.slice(0, args.take);
      // include 解析
      if (args.include && includeResolver) {
        items = items.map((r) => applyInclude(r, args.include));
      }
      return items;
    },

    async create(args: DelegateArgs): Promise<T> {
      const data = (args.data ?? {}) as Record<string, unknown>;
      const id = (data['id'] as string) ?? generateId();
      // 处理嵌套 connect:{ id } 关系
      const flatData: Record<string, unknown> = { ...data };
      for (const [key, value] of Object.entries(flatData)) {
        if (value && typeof value === 'object' && !Array.isArray(value) && 'connect' in (value as Record<string, unknown>)) {
          const connect = (value as { connect: Record<string, unknown> }).connect;
          for (const [connectField, connectValue] of Object.entries(connect)) {
            flatData[connectField] = connectValue;
          }
          delete flatData[key];
        }
      }
      const now = new Date();
      const record = {
        id,
        createdAt: now,
        updatedAt: now,
        // 字段默认值:补全省略的可空/有默认字段(对齐真实 schema 默认),data 显式值覆盖
        ...fieldDefaults,
        ...normalizeDataNulls(flatData),
        // 覆盖:若 data 显式提供了 createdAt/updatedAt 则保留
        ...(data['createdAt'] !== undefined ? { createdAt: data['createdAt'] } : {}),
        ...(data['updatedAt'] !== undefined ? { updatedAt: data['updatedAt'] } : {}),
      } as T;
      store.set(id, record);
      // create 携带 include 时同步解析关系(如 sharedWork.create({ include }) 返回完整载荷)
      return applyInclude(record, args.include);
    },

    async update(args: DelegateArgs): Promise<T> {
      const id = pickId(args);
      if (!id) throw new Error('mock update: missing where.id');
      const existing = store.get(id);
      if (!existing) throw new Error(`mock update: record ${id} not found`);
      const data = normalizeDataNulls((args.data ?? {}) as Record<string, unknown>);
      const updated = { ...existing, ...data, updatedAt: new Date() } as T;
      store.set(id, updated);
      return updated;
    },

    async updateMany(args: DelegateArgs): Promise<{ count: number }> {
      const where = args.where ?? {};
      const data = (args.data ?? {}) as Record<string, unknown>;
      let count = 0;
      for (const [key, record] of Array.from(store.entries())) {
        if (matchesRecord(record, where)) {
          const updated = { ...record, ...data } as T;
          store.set(key, updated);
          count += 1;
        }
      }
      return { count };
    },

    async count(args?: DelegateArgs): Promise<number> {
      const where = args?.where ?? {};
      let n = 0;
      for (const record of store.values()) {
        if (matchesRecord(record, where)) n += 1;
      }
      return n;
    },

    async delete(args: DelegateArgs): Promise<T> {
      const where = args.where ?? {};
      // 按 id 删除
      if (typeof where.id === 'string') {
        const existing = store.get(where.id);
        if (!existing) {
          const err = new Error('mock delete: record not found');
          err.name = 'PrismaClientKnownRequestError';
          throw err;
        }
        store.delete(where.id);
        return existing;
      }
      // 按复合唯一键删除(userId_tenantId)
      if (where.userId_tenantId && typeof where.userId_tenantId === 'object') {
        const cond = where.userId_tenantId as { userId?: string; tenantId?: string };
        for (const [key, record] of Array.from(store.entries())) {
          if (record['userId' as keyof T] === cond.userId && record['tenantId' as keyof T] === cond.tenantId) {
            store.delete(key);
            return record;
          }
        }
        const err = new Error('mock delete: record not found');
        err.name = 'PrismaClientKnownRequestError';
        throw err;
      }
      // 按唯一字段删除
      for (const field of uniqueFields) {
        if (typeof where[field] === 'string') {
          for (const [key, record] of Array.from(store.entries())) {
            if (record[field as keyof T] === where[field]) {
              store.delete(key);
              return record;
            }
          }
        }
      }
      // findFirst 风格:按 where 条件删除首条匹配
      for (const [key, record] of Array.from(store.entries())) {
        if (matchesRecord(record, where)) {
          store.delete(key);
          return record;
        }
      }
      const err = new Error('mock delete: record not found');
      err.name = 'PrismaClientKnownRequestError';
      throw err;
    },

    async deleteMany(args: DelegateArgs): Promise<{ count: number }> {
      const where = args.where ?? {};
      let count = 0;
      for (const [key, record] of Array.from(store.entries())) {
        if (matchesRecord(record, where)) {
          store.delete(key);
          count += 1;
        }
      }
      return { count };
    },
  };
}

function generateId(): string {
  return `mock-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

// ============================================================
// Prisma Mock 主体
// ============================================================

class PrismaMock {
  readonly userStore = new Map<string, MockUser>();
  readonly tenantStore = new Map<string, MockTenant>();
  readonly tenantMemberStore = new Map<string, MockTenantMember>();
  readonly sessionStore = new Map<string, MockSession>();
  readonly analysisStore = new Map<string, MockAnalysis>();
  // Phase 4 新增 stores
  readonly auditLogStore = new Map<string, MockAuditLog>();
  readonly apiKeyStore = new Map<string, MockApiKey>();
  readonly creativeTemplateStore = new Map<string, MockCreativeTemplate>();
  readonly subscriptionStore = new Map<string, MockSubscription>();
  readonly invoiceStore = new Map<string, MockInvoice>();
  // M-2 新增 store:AI 图像生成任务
  readonly generationTaskStore = new Map<string, MockGenerationTask>();
  // M-2 新增 store:AI 用量日志(支撑 M2-T4 用量日志测试)
  readonly aiUsageLogStore = new Map<string, MockAiUsageLog>();
  // Phase 5 新增 store:争议案件(支撑管理员大屏 openDisputes 统计)
  readonly disputeCaseStore = new Map<string, MockDisputeCase>();
  // 框架二 P2 新增:AI-教师评分差异记录 store
  readonly scoreDiffRecordStore = new Map<string, MockScoreDiffRecord>();
  // 组织内分享新增 stores(报告导出+组织分享特性)
  readonly sharedWorkStore = new Map<string, MockSharedWork>();
  readonly shareCommentStore = new Map<string, MockShareComment>();
  // 投诉举报新增 store(公安备案合规)
  readonly reportStore = new Map<string, MockReport>();
  // 反馈闭环 Phase 4 批次②新增 store:标注反馈(数据飞轮)
  readonly markerFeedbackStore = new Map<string, MockMarkerFeedback>();
  // 反馈闭环 Phase 4 批次③新增 store:标注级教师批注
  readonly teacherAnnotationStore = new Map<string, MockTeacherAnnotation>();
  // 反馈闭环 Phase 5 批次③新增 stores:评分档案 + 建议采纳记录
  readonly gradingProfileStore = new Map<string, MockGradingProfile>();
  readonly profileSuggestionAdoptionStore = new Map<string, MockProfileSuggestionAdoption>();

  // 各模型委托(唯一字段对应 schema.prisma 中的 @unique)
  // tenantMember 委托:支持 include user / include tenant 关系解析
  readonly tenantMember = createModelDelegate<MockTenantMember>(
    this.tenantMemberStore,
    ['userId_tenantId'],
    (record, include) => {
      const enriched = { ...record } as MockTenantMember & {
        user?: Partial<MockUser>;
        tenant?: Partial<MockTenant>;
      };
      if ('user' in include) {
        const userSelect = (include as { user?: { select?: Record<string, boolean> } }).user?.select;
        const fullUser = this.userStore.get(record.userId);
        if (fullUser) {
          if (userSelect) {
            // 仅返回 select 指定字段
            const picked: Partial<MockUser> = {};
            for (const [field, enabled] of Object.entries(userSelect)) {
              if (enabled && field in fullUser) {
                (picked as Record<string, unknown>)[field] = (fullUser as Record<string, unknown>)[field];
              }
            }
            enriched.user = picked;
          } else {
            enriched.user = fullUser;
          }
        }
      }
      if ('tenant' in include) {
        const tenantSelect = (include as { tenant?: { select?: Record<string, boolean> } }).tenant?.select;
        const fullTenant = this.tenantStore.get(record.tenantId);
        if (fullTenant) {
          if (tenantSelect) {
            const picked: Partial<MockTenant> = {};
            for (const [field, enabled] of Object.entries(tenantSelect)) {
              if (enabled && field in fullTenant) {
                (picked as Record<string, unknown>)[field] = (fullTenant as Record<string, unknown>)[field];
              }
            }
            enriched.tenant = picked;
          } else {
            enriched.tenant = fullTenant;
          }
        }
      }
      return enriched as unknown as MockTenantMember;
    },
  );

  // user 委托:支持 include memberships 关系解析(用于 /auth/me)
  readonly user = createModelDelegate<MockUser>(
    this.userStore,
    ['feishuUnionId', 'feishuOpenId'],
    (record, include) => {
      const enriched = { ...record } as MockUser & {
        memberships?: Array<MockTenantMember & { tenant?: Partial<MockTenant> }>;
      };
      if ('memberships' in include) {
        const nestedInclude = (include as { memberships?: { include?: Record<string, unknown> } }).memberships?.include;
        const memberships: Array<MockTenantMember & { tenant?: Partial<MockTenant> }> = [];
        for (const m of this.tenantMemberStore.values()) {
          if (m.userId === record.id) {
            const mWithTenant = { ...m } as MockTenantMember & { tenant?: Partial<MockTenant> };
            if (nestedInclude && 'tenant' in nestedInclude) {
              const tenantSelect = (nestedInclude as { tenant?: { select?: Record<string, boolean> } }).tenant?.select;
              const fullTenant = this.tenantStore.get(m.tenantId);
              if (fullTenant) {
                if (tenantSelect) {
                  const picked: Partial<MockTenant> = {};
                  for (const [field, enabled] of Object.entries(tenantSelect)) {
                    if (enabled && field in fullTenant) {
                      (picked as Record<string, unknown>)[field] = (fullTenant as Record<string, unknown>)[field];
                    }
                  }
                  mWithTenant.tenant = picked;
                } else {
                  mWithTenant.tenant = fullTenant;
                }
              }
            }
            memberships.push(mWithTenant);
          }
        }
        enriched.memberships = memberships;
      }
      return enriched as unknown as MockUser;
    },
  );

  readonly tenant = createModelDelegate<MockTenant>(this.tenantStore, ['feishuTenantKey']);
  readonly session = createModelDelegate<MockSession>(this.sessionStore, ['refreshTokenHash']);

  // analysis 委托:支持 include user 关系解析(Phase 4 admin-content 使用)
  readonly analysis = Object.assign(
    createModelDelegate<MockAnalysis>(this.analysisStore, [], (record, include) => {
      const enriched = { ...record } as MockAnalysis & {
        user?: { name: string } | Partial<MockUser>;
      };
      if ('user' in include) {
        const userSelect = (include as { user?: { select?: Record<string, boolean> } }).user?.select;
        const fullUser = this.userStore.get(record.userId);
        if (fullUser) {
          if (userSelect) {
            const picked: Partial<MockUser> = {};
            for (const [field, enabled] of Object.entries(userSelect)) {
              if (enabled && field in fullUser) {
                (picked as Record<string, unknown>)[field] = (fullUser as Record<string, unknown>)[field];
              }
            }
            enriched.user = picked as { name: string };
          } else {
            enriched.user = fullUser;
          }
        }
      }
      return enriched as unknown as MockAnalysis;
    }),
    {
      // aggregate 方法:支持 _avg 计算(Phase 4 admin-content 使用)
      // 注意:必须用箭头函数,通过词法作用域捕获 PrismaMock 实例的 this,
      // 否则通过 prisma().analysis.aggregate(...) 调用时 this 指向 delegate 对象(无 analysisStore)
      aggregate: async (args: {
        where?: Record<string, unknown>;
        _avg?: Record<string, boolean>;
        _sum?: Record<string, boolean>;
        _count?: Record<string, boolean>;
        _min?: Record<string, boolean>;
        _max?: Record<string, boolean>;
      }): Promise<{
        _avg?: Record<string, number | null>;
        _sum?: Record<string, number | null>;
        _count?: number;
        _min?: Record<string, unknown>;
        _max?: Record<string, unknown>;
      }> => {
        const where = args?.where ?? {};
        const items = Array.from(this.analysisStore.values()).filter((r) => matchWhere(r, where));
        const result: {
          _avg?: Record<string, number | null>;
          _sum?: Record<string, number | null>;
          _count?: number;
          _min?: Record<string, unknown>;
          _max?: Record<string, unknown>;
        } = {};
        if (args?._avg) {
          const avg: Record<string, number | null> = {};
          for (const [field, enabled] of Object.entries(args._avg)) {
            if (!enabled) continue;
            const values = items
              .map((i) => (i as Record<string, unknown>)[field])
              .filter((v): v is number => typeof v === 'number' && !Number.isNaN(v));
            avg[field] = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;
          }
          result._avg = avg;
        }
        if (args?._sum) {
          const sum: Record<string, number | null> = {};
          for (const [field, enabled] of Object.entries(args._sum)) {
            if (!enabled) continue;
            const values = items
              .map((i) => (i as Record<string, unknown>)[field])
              .filter((v): v is number => typeof v === 'number' && !Number.isNaN(v));
            sum[field] = values.length > 0 ? values.reduce((a, b) => a + b, 0) : null;
          }
          result._sum = sum;
        }
        if (args?._count) {
          result._count = items.length;
        }
        return result;
      },
    },
  );

  // Phase 4 新增模型委托
  // subscription 委托:支持 include tenant 关系解析
  readonly subscription = createModelDelegate<MockSubscription>(
    this.subscriptionStore,
    [],
    (record, include) => {
      const enriched = { ...record } as MockSubscription & {
        tenant?: { name: string } | Partial<MockTenant>;
      };
      if ('tenant' in include) {
        const tenantSelect = (include as { tenant?: { select?: Record<string, boolean> } }).tenant?.select;
        const fullTenant = this.tenantStore.get(record.tenantId);
        if (fullTenant) {
          if (tenantSelect) {
            const picked: Partial<MockTenant> = {};
            for (const [field, enabled] of Object.entries(tenantSelect)) {
              if (enabled && field in fullTenant) {
                (picked as Record<string, unknown>)[field] = (fullTenant as Record<string, unknown>)[field];
              }
            }
            enriched.tenant = picked as { name: string };
          } else {
            enriched.tenant = fullTenant;
          }
        }
      }
      return enriched as unknown as MockSubscription;
    },
  );

  // invoice 委托:支持 include tenant 关系解析
  readonly invoice = createModelDelegate<MockInvoice>(
    this.invoiceStore,
    [],
    (record, include) => {
      const enriched = { ...record } as MockInvoice & {
        tenant?: { name: string } | Partial<MockTenant>;
      };
      if ('tenant' in include) {
        const tenantSelect = (include as { tenant?: { select?: Record<string, boolean> } }).tenant?.select;
        const fullTenant = this.tenantStore.get(record.tenantId);
        if (fullTenant) {
          if (tenantSelect) {
            const picked: Partial<MockTenant> = {};
            for (const [field, enabled] of Object.entries(tenantSelect)) {
              if (enabled && field in fullTenant) {
                (picked as Record<string, unknown>)[field] = (fullTenant as Record<string, unknown>)[field];
              }
            }
            enriched.tenant = picked as { name: string };
          } else {
            enriched.tenant = fullTenant;
          }
        }
      }
      return enriched as unknown as MockInvoice;
    },
  );

  // M-2 新增:GenerationTask 委托(AI 图像生成任务,无关系 include)
  // fieldDefaults:对齐 schema.prisma GenerationTask 模型默认值(可空字段→null,枚举→默认值;
  // 含 M-4 新增三列 styleImageUrl/styleAnalysis/processingStartedAt,默认 null)
  readonly generationTask = createModelDelegate<MockGenerationTask>(
    this.generationTaskStore,
    [],
    undefined,
    {
      inputType: 'text',
      prompt: null,
      sketchImageUrl: null,
      artType: 'painting',
      aspect: null,
      count: 1,
      status: 'pending',
      images: null,
      failureReason: null,
      usedFallback: false,
      provider: null,
      model: null,
      styleImageUrl: null,
      styleAnalysis: null,
      processingStartedAt: null,
      completedAt: null,
    },
  );

  readonly auditLog = createModelDelegate<MockAuditLog>(this.auditLogStore, []);
  readonly apiKey = createModelDelegate<MockApiKey>(this.apiKeyStore, ['keyPrefix', 'keyHash']);
  readonly creativeTemplate = createModelDelegate<MockCreativeTemplate>(this.creativeTemplateStore, []);

  // M-2 新增:AiUsageLog 委托(AI 用量日志,含 usageType/generationId)
  // fieldDefaults:对齐 schema.prisma AiUsageLog 模型默认值
  readonly aiUsageLog = createModelDelegate<MockAiUsageLog>(
    this.aiUsageLogStore,
    [],
    undefined,
    {
      analysisId: null,
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
      costYuan: null,
      failureReason: null,
      usageType: 'diagnose',
      generationId: null,
      usedFallback: false,
      traceId: null,
    },
  );

  // Phase 5 新增:DisputeCase 委托(争议仲裁;管理员大屏 countGlobalByStatus 依赖)
  readonly disputeCase = createModelDelegate<MockDisputeCase>(this.disputeCaseStore, []);

  // 框架二 P2 新增:ScoreDiffRecord 委托(AI-教师评分差异记录)
  readonly scoreDiffRecord = createModelDelegate<MockScoreDiffRecord>(this.scoreDiffRecordStore, []);

  // ============================================================
  // 组织内分享新增委托(报告导出+组织分享特性)
  // ============================================================

  /**
   * SharedWork 委托
   * include 支持:analysis(select)/ user(select)/ comments(orderBy+take+include user)/ _count(comments)
   * relationFilter:analysis: { workType } 嵌套关系过滤(经 analysisId 关联 analysisStore)
   * delete 级联:删除分享时同步清理其下评论(对齐 schema onDelete: Cascade)
   */
  readonly sharedWork = (() => {
    const delegate = createModelDelegate<MockSharedWork>(
      this.sharedWorkStore,
      [],
      (record, include) => {
        const enriched = { ...record } as MockSharedWork & {
          analysis?: Partial<MockAnalysis>;
          user?: Partial<MockUser>;
          comments?: Array<MockShareComment & { user?: Partial<MockUser> }>;
          _count?: { comments?: number };
        };
        // analysis 关系(作品信息)
        if ('analysis' in include) {
          const select = (include as { analysis?: { select?: Record<string, boolean> } }).analysis?.select;
          const full = this.analysisStore.get(record.analysisId);
          if (full) {
            enriched.analysis = pickFields(full as unknown as Record<string, unknown>, select) as Partial<MockAnalysis>;
          }
        }
        // user 关系(分享者信息)
        if ('user' in include) {
          const select = (include as { user?: { select?: Record<string, boolean> } }).user?.select;
          const full = this.userStore.get(record.userId);
          if (full) {
            enriched.user = pickFields(full as unknown as Record<string, unknown>, select) as Partial<MockUser>;
          }
        }
        // comments 关系(最新 N 条预览 + 每条含评论者信息)
        if ('comments' in include) {
          const commentsArgs = (include as {
            comments?: { orderBy?: unknown; take?: number; include?: Record<string, unknown> };
          }).comments;
          let comments = Array.from(this.shareCommentStore.values()).filter(
            (c) => c.sharedWorkId === record.id,
          );
          // orderBy createdAt desc(本特性唯一使用场景;升序由 listComments 全量查询走 delegate orderBy)
          const orderBy = commentsArgs?.orderBy as { createdAt?: 'asc' | 'desc' } | undefined;
          const desc = orderBy?.createdAt !== 'asc';
          comments.sort((a, b) =>
            desc ? b.createdAt.getTime() - a.createdAt.getTime() : a.createdAt.getTime() - b.createdAt.getTime(),
          );
          if (commentsArgs?.take !== undefined) comments = comments.slice(0, commentsArgs.take);
          // 嵌套 include user(评论者信息)
          if (commentsArgs?.include && 'user' in commentsArgs.include) {
            const userSelect = (commentsArgs.include as { user?: { select?: Record<string, boolean> } }).user?.select;
            enriched.comments = comments.map((c) => {
              const u = this.userStore.get(c.userId);
              return {
                ...c,
                ...(u
                  ? { user: pickFields(u as unknown as Record<string, unknown>, userSelect) as Partial<MockUser> }
                  : {}),
              };
            });
          } else {
            enriched.comments = comments;
          }
        }
        // _count 关系(评论总数)
        if ('_count' in include) {
          const countSelect = (include as { _count?: { select?: Record<string, boolean> } })._count?.select;
          if (countSelect?.comments) {
            let n = 0;
            for (const c of this.shareCommentStore.values()) {
              if (c.sharedWorkId === record.id) n += 1;
            }
            enriched._count = { comments: n };
          }
        }
        return enriched as unknown as MockSharedWork;
      },
      // fieldDefaults:对齐 schema.prisma SharedWork 默认值
      { caption: null, isPinned: false },
      // relationFilter:支持 analysis: { workType: 'painting' } 嵌套关系过滤
      (record, key, condition) => {
        if (key === 'analysis' && condition && typeof condition === 'object' && !Array.isArray(condition)) {
          const analysis = this.analysisStore.get(record.analysisId);
          if (!analysis) return false;
          for (const [field, cond] of Object.entries(condition as Record<string, unknown>)) {
            if (!matchValue((analysis as unknown as Record<string, unknown>)[field], cond as WhereValue)) {
              return false;
            }
          }
          return true;
        }
        return undefined;
      },
    );
    // 级联删除:对齐 schema ShareComment onDelete: Cascade
    const baseDelete = delegate.delete;
    delegate.delete = async (args: DelegateArgs): Promise<MockSharedWork> => {
      const removed = await baseDelete(args);
      for (const [key, comment] of Array.from(this.shareCommentStore.entries())) {
        if (comment.sharedWorkId === removed.id) {
          this.shareCommentStore.delete(key);
        }
      }
      return removed;
    };
    return delegate;
  })();

  /**
   * ShareComment 委托
   * include 支持:user(select)(评论者信息)
   */
  readonly shareComment = createModelDelegate<MockShareComment>(
    this.shareCommentStore,
    [],
    (record, include) => {
      const enriched = { ...record } as MockShareComment & { user?: Partial<MockUser> };
      if ('user' in include) {
        const select = (include as { user?: { select?: Record<string, boolean> } }).user?.select;
        const full = this.userStore.get(record.userId);
        if (full) {
          enriched.user = pickFields(full as unknown as Record<string, unknown>, select) as Partial<MockUser>;
        }
      }
      return enriched as unknown as MockShareComment;
    },
  );

  /**
   * Report 委托(投诉举报,公安备案合规)
   * include 支持:reporter(select)(举报人信息)
   * fieldDefaults:对齐 schema.prisma Report 默认值(detail 可空/status 默认 pending)
   */
  readonly report = createModelDelegate<MockReport>(
    this.reportStore,
    [],
    (record, include) => {
      const enriched = { ...record } as MockReport & { reporter?: Partial<MockUser> };
      if ('reporter' in include) {
        const select = (include as { reporter?: { select?: Record<string, boolean> } }).reporter?.select;
        const full = this.userStore.get(record.reporterId);
        if (full) {
          enriched.reporter = pickFields(full as unknown as Record<string, unknown>, select) as Partial<MockUser>;
        }
      }
      return enriched as unknown as MockReport;
    },
    { detail: null, status: 'pending' },
  );

  /**
   * MarkerFeedback 委托(反馈闭环 Phase 4 批次②/数据飞轮)
   * 核心语义 upsert:按复合唯一键 analysisId_userId_markerIndex 定位
   * (对齐 schema @@unique;可空 markerId 不参与定位——NULL 不参与唯一比较)
   * 注意:upsert 必须用箭头函数捕获 PrismaMock 实例的 this(照 analysis.aggregate 先例)
   */
  readonly markerFeedback = Object.assign(
    createModelDelegate<MockMarkerFeedback>(this.markerFeedbackStore, []),
    {
      upsert: async (args: {
        where: {
          analysisId_userId_markerIndex: { analysisId: string; userId: string; markerIndex: number };
        };
        update: Record<string, unknown>;
        create: Record<string, unknown>;
      }): Promise<MockMarkerFeedback> => {
        const key = args.where.analysisId_userId_markerIndex;
        for (const record of this.markerFeedbackStore.values()) {
          if (
            record.analysisId === key.analysisId &&
            record.userId === key.userId &&
            record.markerIndex === key.markerIndex
          ) {
            const updated = {
              ...record,
              ...normalizeDataNulls(args.update ?? {}),
              updatedAt: new Date(),
            } as MockMarkerFeedback;
            this.markerFeedbackStore.set(record.id, updated);
            return updated;
          }
        }
        const now = new Date();
        const created = {
          id: generateId(),
          createdAt: now,
          updatedAt: now,
          ...normalizeDataNulls(args.create ?? {}),
        } as unknown as MockMarkerFeedback;
        this.markerFeedbackStore.set(created.id, created);
        return created;
      },
    },
  );

  /**
   * TeacherAnnotation 委托(反馈闭环 Phase 4 批次③:标注级教师批注)
   * 查重/更新/删除走通用 create/findFirst/findMany/update/delete;
   * fieldDefaults 对齐 schema(action 默认 'supplement')
   */
  readonly teacherAnnotation = createModelDelegate<MockTeacherAnnotation>(
    this.teacherAnnotationStore,
    [],
    undefined,
    { action: 'supplement' },
  );

  /**
   * GradingProfile 委托(反馈闭环 Phase 5 批次③:画像/建议链路)
   * findUnique 按主键 id;findMany/findFirst 支持 where/orderBy(listVisible 的 OR
   * 由通用 matchWhere 处理);画像建议链路仅消费 findById + 画像聚合查询
   */
  readonly gradingProfile = createModelDelegate<MockGradingProfile>(
    this.gradingProfileStore,
    [],
    undefined,
    { isBuiltIn: false, isDefault: false, enabled: true, sortOrder: 0 },
  );

  /**
   * ProfileSuggestionAdoption 委托(反馈闭环 Phase 5 批次③)
   * 采纳记录:findMany 按 profileId 查询(防重复过滤);create 落库
   */
  readonly profileSuggestionAdoption = createModelDelegate<MockProfileSuggestionAdoption>(
    this.profileSuggestionAdoptionStore,
    [],
  );

  /**
   * 事务:直接在 mock 自身上执行回调(无真实隔离,但保证顺序)
   */
  async $transaction<T>(fn: (tx: this) => Promise<T>): Promise<T> {
    return fn(this);
  }

  async $disconnect(): Promise<void> {
    // no-op
  }

  // ============================================================
  // 测试辅助方法
  // ============================================================

  /** 清空所有 store(每个测试 beforeEach 调用) */
  __clear(): void {
    this.userStore.clear();
    this.tenantStore.clear();
    this.tenantMemberStore.clear();
    this.sessionStore.clear();
    this.analysisStore.clear();
    // Phase 4 新增 stores
    this.auditLogStore.clear();
    this.apiKeyStore.clear();
    this.creativeTemplateStore.clear();
    this.subscriptionStore.clear();
    this.invoiceStore.clear();
    // M-2 新增 store
    this.generationTaskStore.clear();
    this.aiUsageLogStore.clear();
    // Phase 5 新增 stores
    this.disputeCaseStore.clear();
    // 框架二 P2 新增 store
    this.scoreDiffRecordStore.clear();
    // 组织内分享新增 stores
    this.sharedWorkStore.clear();
    this.shareCommentStore.clear();
    // 投诉举报新增 store
    this.reportStore.clear();
    // 反馈闭环 Phase 4 批次②新增 store
    this.markerFeedbackStore.clear();
    // 反馈闭环 Phase 4 批次③新增 store
    this.teacherAnnotationStore.clear();
    // 反馈闭环 Phase 5 批次③新增 stores
    this.gradingProfileStore.clear();
    this.profileSuggestionAdoptionStore.clear();
  }

  /**
   * 直接插入用户(跳过 create 逻辑,用于预置测试数据)
   */
  __insertUser(user: Partial<MockUser> & { id: string; tenantId: string; feishuUnionId: string }): MockUser {
    const now = new Date();
    const full: MockUser = {
      feishuOpenId: `ou_${user.id}`,
      name: 'test-user',
      avatar: '',
      email: null,
      phone: null,
      role: 'student',
      status: 'active',
      authType: 'feishu',
      passwordHash: null,
      lockedAt: null,
      lockedBy: null,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: null,
      ...user,
    };
    this.userStore.set(full.id, full);
    return full;
  }

  __insertTenant(tenant: Partial<MockTenant> & { id: string; name: string }): MockTenant {
    const now = new Date();
    const full: MockTenant = {
      type: 'individual',
      feishuTenantKey: null,
      plan: 'free',
      status: 'active',
      maxSeats: 1,
      parentId: null,
      createdAt: now,
      ...tenant,
    };
    this.tenantStore.set(full.id, full);
    return full;
  }

  __insertSession(session: Partial<MockSession> & { id: string; userId: string; tenantId: string; refreshTokenHash: string }): MockSession {
    const now = new Date();
    const full: MockSession = {
      userAgent: 'test-ua',
      ip: '127.0.0.1',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      createdAt: now,
      revokedAt: null,
      ...session,
    };
    this.sessionStore.set(full.id, full);
    return full;
  }

  __insertAnalysis(analysis: Partial<MockAnalysis> & { id: string; tenantId: string; userId: string }): MockAnalysis {
    const now = new Date();
    const full: MockAnalysis = {
      workType: 'painting',
      imageUrl: 'https://example.com/test.jpg',
      title: null,
      remark: null,
      status: 'success',
      result: null,
      failureReason: null,
      overallScore: null,
      durationMs: null,
      reviewStatus: 'pending',
      reviewedBy: null,
      reviewedAt: null,
      reviewNote: null,
      diagnosisMode: 'teaching',
      createdAt: now,
      completedAt: null,
      ...analysis,
    };
    this.analysisStore.set(full.id, full);
    return full;
  }

  // ============================================================
  // Phase 4 新增 __insert 辅助方法
  // ============================================================

  __insertAuditLog(log: Partial<MockAuditLog> & { id: string; operatorId: string; action: string; resource: string; ip: string; userAgent: string }): MockAuditLog {
    const full: MockAuditLog = {
      operatorRole: 'admin',
      operatorTenantId: null,
      resourceId: null,
      targetTenantId: null,
      beforeData: null,
      afterData: null,
      traceId: null,
      note: null,
      createdAt: new Date(),
      ...log,
    };
    this.auditLogStore.set(full.id, full);
    return full;
  }

  __insertApiKey(key: Partial<MockApiKey> & { id: string; name: string; keyPrefix: string; keyHash: string; createdById: string }): MockApiKey {
    const now = new Date();
    const full: MockApiKey = {
      tenantId: null,
      scopes: [],
      status: 'active',
      revokedAt: null,
      revokedBy: null,
      expiresAt: null,
      createdAt: now,
      updatedAt: now,
      lastUsedAt: null,
      lastUsedIp: null,
      ...key,
    };
    this.apiKeyStore.set(full.id, full);
    return full;
  }

  __insertCreativeTemplate(template: Partial<MockCreativeTemplate> & { id: string; name: string; artType: string; content: unknown; createdById: string }): MockCreativeTemplate {
    const now = new Date();
    const full: MockCreativeTemplate = {
      description: null,
      tags: [],
      thumbnailUrl: null,
      enabled: true,
      sortOrder: 0,
      createdAt: now,
      updatedAt: now,
      ...template,
    };
    this.creativeTemplateStore.set(full.id, full);
    return full;
  }

  __insertSubscription(sub: Partial<MockSubscription> & { id: string; tenantId: string }): MockSubscription {
    const now = new Date();
    const full: MockSubscription = {
      plan: 'free',
      status: 'active',
      periodStart: now,
      periodEnd: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      cancelAtPeriodEnd: false,
      paymentProvider: null,
      externalSubId: null,
      amount: 0,
      currency: 'CNY',
      seats: 1,
      createdAt: now,
      updatedAt: now,
      ...sub,
    };
    this.subscriptionStore.set(full.id, full);
    return full;
  }

  __insertInvoice(inv: Partial<MockInvoice> & { id: string; tenantId: string; subscriptionId: string }): MockInvoice {
    const now = new Date();
    const full: MockInvoice = {
      amount: 0,
      currency: 'CNY',
      status: 'paid',
      periodStart: now,
      periodEnd: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      paidAt: new Date(),
      paymentProvider: null,
      externalInvoiceId: null,
      description: null,
      createdAt: now,
      ...inv,
    };
    this.invoiceStore.set(full.id, full);
    return full;
  }

  // ============================================================
  // M-2 新增 __insert 辅助方法:AI 图像生成任务
  // ============================================================

  __insertGenerationTask(
    task: Partial<MockGenerationTask> & { id: string; tenantId: string; userId: string },
  ): MockGenerationTask {
    const now = new Date();
    const full: MockGenerationTask = {
      inputType: 'text',
      prompt: null,
      sketchImageUrl: null,
      artType: 'painting',
      aspect: null,
      count: 1,
      status: 'pending',
      images: null,
      failureReason: null,
      usedFallback: false,
      provider: null,
      model: null,
      // M-4 新增三列默认 null(可空列,对齐 schema.prisma 默认值)
      styleImageUrl: null,
      styleAnalysis: null,
      processingStartedAt: null,
      createdAt: now,
      completedAt: null,
      ...task,
    };
    this.generationTaskStore.set(full.id, full);
    return full;
  }

  // ============================================================
  // M-2 新增 __insert 辅助方法:AI 用量日志
  // ============================================================

  __insertAiUsageLog(
    log: Partial<MockAiUsageLog> & { id: string; tenantId: string; userId: string; provider: string; model: string; apiUrl: string; success: boolean; durationMs: number },
  ): MockAiUsageLog {
    const full: MockAiUsageLog = {
      analysisId: null,
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
      costYuan: null,
      failureReason: null,
      usageType: 'diagnose',
      generationId: null,
      usedFallback: false,
      traceId: null,
      createdAt: new Date(),
      ...log,
    };
    this.aiUsageLogStore.set(full.id, full);
    return full;
  }

  // ============================================================
  // 组织内分享新增 __insert 辅助方法(报告导出+组织分享特性)
  // ============================================================

  __insertSharedWork(
    work: Partial<MockSharedWork> & { id: string; tenantId: string; analysisId: string; userId: string },
  ): MockSharedWork {
    const now = new Date();
    const full: MockSharedWork = {
      caption: null,
      isPinned: false,
      createdAt: now,
      updatedAt: now,
      ...work,
    };
    this.sharedWorkStore.set(full.id, full);
    return full;
  }

  __insertShareComment(
    comment: Partial<MockShareComment> & { id: string; sharedWorkId: string; userId: string; content: string },
  ): MockShareComment {
    const full: MockShareComment = {
      createdAt: new Date(),
      ...comment,
    };
    this.shareCommentStore.set(full.id, full);
    return full;
  }

  // ============================================================
  // 投诉举报新增 __insert 辅助方法(公安备案合规)
  // ============================================================

  __insertReport(
    report: Partial<MockReport> & { id: string; tenantId: string; reporterId: string; targetType: string; targetId: string; reason: string },
  ): MockReport {
    const now = new Date();
    const full: MockReport = {
      detail: null,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      ...report,
    };
    this.reportStore.set(full.id, full);
    return full;
  }
}

/**
 * 全局 Prisma Mock 单例
 */
export const prismaMock: PrismaMock = new PrismaMock();

/**
 * 兼容别名
 */
export const prismaState: PrismaMock = prismaMock;

/**
 * 暴露 Prisma 特殊值(analysis.repository 使用 Prisma.DbNull)
 */
export const prismaDbNull = Prisma.DbNull;
export const prismaJsonNull = Prisma.JsonNull;

/**
 * 创建匹配 src/config/prisma.ts 导出的模块对象
 * 注意:返回的 prisma() 类型为 unknown,运行时由 vi.mock 替换
 */
export function createPrismaModule(): {
  initPrisma: () => PrismaMock;
  prisma: () => PrismaMock;
  closePrisma: () => Promise<void>;
} {
  return {
    initPrisma: () => prismaMock,
    prisma: () => prismaMock,
    closePrisma: async () => {
      prismaMock.__clear();
    },
  };
}
