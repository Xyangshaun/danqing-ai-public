// ============================================================
// AI 图像生成任务 Repository
// 对应文档:.trae/documents/m2-generation-plan-2026-08-07.md §3.2 / §3.4
// 对应表:generation_tasks(GenerationTask,M-2-T1 已迁移)
// 对应契约:api-contract.ts §3.17(已冻结,禁止修改)
//
// 设计要点(复用 analysis.repository 模式):
//   1. 强制 tenant_id 过滤:所有查询必须显式传 tenantId,防跨租户
//   2. create():创建 pending 状态任务(异步状态机起点)
//   3. findById(id + tenantId):跨租户返回 null,不泄露存在性
//   4. updateStatus():更新 status/images/failureReason/usedFallback/provider/model
//      images 为 Json 字段,null 需通过 Prisma.DbNull 显式表达(参照 analysis.updateResult)
//   5. list():按 (tenantId, createdAt) 倒序分页,支持 userId/status 筛选
//   6. countMonthlyGenerateUsage():当月生成用量(供 M2-T4 配额校验)
//   7. M-4 扩展(DOC-2026-09-002,v1.1.0):styleImageUrl/styleAnalysis/processingStartedAt
//      三列透传 + findStalledProcessing() stalled 恢复扫描查询(修订 R2;跨租户批量扫描
//      由编排层在服务侧聚合,仍以租户为隔离单元,本仓库不提供跨租户入口)
//
// 安全:
//   - 所有写操作先 findFirst(id + tenantId) 预检归属,越权返回 null
//   - 使用 Prisma 参数化查询,杜绝 SQL 注入
// ============================================================

import { Prisma, type GenerationTask, type ArtType, type GenerationStatus } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import type { GeneratedImage, StyleAnalysis } from '../types/api-contract.js';

/**
 * 创建生成任务的数据(对应冻结契约 CreateGenerationRequest 的落库字段)
 * 除 userId 单独参数外,其余由本接口承载
 */
export interface CreateGenerationData {
  /** 生成输入来源('text' | 'sketch') */
  inputType: string;
  /** 文字提示词(text 模式) */
  prompt?: string | null;
  /** 草稿图 URL(sketch 模式) */
  sketchImageUrl?: string | null;
  /** 风格参考图 URL(style 模式,压缩后 dataURL 或 http URL;M-4 新增) */
  styleImageUrl?: string | null;
  /** 目标作品类型(生成后一键诊断的类型) */
  artType: ArtType;
  /** 生成尺寸提示('portrait' | 'landscape' | 'square') */
  aspect?: string | null;
  /** 生成数量(1-4) */
  count: number;
}

/**
 * 更新生成任务状态的字段(异步状态机写入)
 * images 为 GeneratedImage[] 数组(含 reviewStatus),null 表示清空
 */
export interface UpdateGenerationStatusData {
  status?: GenerationStatus;
  /** 生成结果图列表(成功时非空) */
  images?: GeneratedImage[] | null;
  /** 失败原因(status=failed 时非空) */
  failureReason?: string | null;
  /** 是否经过降级(主提供商失败自动降级) */
  usedFallback?: boolean;
  /** 实际生效提供商('glm' | 'trae') */
  provider?: string | null;
  /** 实际生效模型 */
  model?: string | null;
  /** 完成时间(成功/失败时写入) */
  completedAt?: Date | null;
  /** 风格拆解结果(style 模式两阶段落库阶段 1 写入点,M-4 新增;null 表示清空) */
  styleAnalysis?: StyleAnalysis | null;
  /** Worker 开始处理时间(stalled 恢复扫描判定基准,M-4 v1.1.0 修订 R2;队列/同步模式统一写入) */
  processingStartedAt?: Date | null;
}

/**
 * 生成历史分页查询过滤条件
 */
export interface ListGenerationFilter {
  /** 按用户筛选 */
  userId?: string;
  /** 按状态筛选 */
  status?: GenerationStatus;
  /** 页码(从 1 开始) */
  page: number;
  /** 每页条数 */
  pageSize: number;
}

export class GenerationRepository {
  /**
   * 创建生成任务(强制带 tenantId + userId,初始 status=pending)
   * @returns 创建的 GenerationTask 记录
   */
  async create(tenantId: string, userId: string, data: CreateGenerationData): Promise<GenerationTask> {
    return prisma().generationTask.create({
      data: {
        tenantId,
        userId,
        inputType: data.inputType,
        prompt: data.prompt ?? null,
        sketchImageUrl: data.sketchImageUrl ?? null,
        styleImageUrl: data.styleImageUrl ?? null,
        artType: data.artType,
        aspect: data.aspect ?? null,
        count: data.count,
        status: 'pending',
      },
    });
  }

  /**
   * 按 ID 查询生成任务(强制 tenant_id 校验,防跨租户)
   * @returns 记录;不存在或跨租户返回 null
   */
  async findById(tenantId: string, id: string): Promise<GenerationTask | null> {
    return prisma().generationTask.findFirst({
      where: { id, tenantId },
    });
  }

  /**
   * 更新生成任务状态(强制 tenant_id 校验)
   * 先 findFirst(id + tenantId) 预检归属,跨租户/不存在返回 null
   * 注:images 为 Json 字段,null 需通过 Prisma.DbNull 显式表达
   */
  async updateStatus(
    tenantId: string,
    id: string,
    data: UpdateGenerationStatusData,
  ): Promise<GenerationTask | null> {
    const existing = await prisma().generationTask.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });
    if (!existing) return null;

    const updateData: Prisma.GenerationTaskUpdateInput = {
      status: data.status,
      failureReason: data.failureReason,
      usedFallback: data.usedFallback,
      provider: data.provider,
      model: data.model,
      completedAt: data.completedAt,
      processingStartedAt: data.processingStartedAt,
    };
    // Prisma JSON 字段:null 需通过 DbNull 显式表达,null 表示清空 images
    if (data.images === null) {
      updateData.images = Prisma.DbNull;
    } else if (data.images !== undefined) {
      // GeneratedImage[] 无字符串索引签名,需先转 unknown 再收窄为 InputJsonValue
      updateData.images = data.images as unknown as Prisma.InputJsonValue;
    }
    // styleAnalysis 同为 Json 字段:null 通过 DbNull 显式清空(两阶段落库阶段 1 写入,M-4)
    if (data.styleAnalysis === null) {
      updateData.styleAnalysis = Prisma.DbNull;
    } else if (data.styleAnalysis !== undefined) {
      updateData.styleAnalysis = data.styleAnalysis as unknown as Prisma.InputJsonValue;
    }
    return prisma().generationTask.update({
      where: { id },
      data: updateData,
    });
  }

  /**
   * 分页查询生成历史(强制 tenant_id 过滤)
   * 利用复合索引 (tenant_id, created_at) 倒序;支持 userId/status 筛选
   * @returns { items, total }(service 层可包装为 PaginatedData)
   */
  async list(
    tenantId: string,
    filter: ListGenerationFilter,
  ): Promise<{ items: GenerationTask[]; total: number }> {
    const where: Prisma.GenerationTaskWhereInput = {
      tenantId,
    };
    if (filter.userId) where.userId = filter.userId;
    if (filter.status) where.status = filter.status;

    const [items, total] = await Promise.all([
      prisma().generationTask.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (filter.page - 1) * filter.pageSize,
        take: filter.pageSize,
      }),
      prisma().generationTask.count({ where }),
    ]);
    return { items, total };
  }

  /**
   * 当月生成任务计数(供 M2-T4 配额校验)
   * 口径:统计 status 非 failed(success/processing/pending)的生成任务,
   * 与 analysis.repository.countMonthlyUsage 一致(失败不消耗配额,对应计划 §5.3)
   * @param tenantId 租户 ID(强制隔离)
   * @param year 年份(如 2026)
   * @param month 月份(1-12)
   */
  async countMonthlyGenerateUsage(tenantId: string, year: number, month: number): Promise<number> {
    const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
    const end = new Date(Date.UTC(year, month, 1, 0, 0, 0));
    return prisma().generationTask.count({
      where: {
        tenantId,
        createdAt: { gte: start, lt: end },
        status: { in: ['success', 'processing', 'pending'] },
      },
    });
  }

  /**
   * 查询存在 processing 状态任务的租户 ID 列表(M-4 v1.1.0 修订 R2,供 M4-T4 stalled 恢复
   * 扫描的服务侧跨租户聚合入口)
   *
   * 设计说明(分层边界):
   *   - 真源 §3.2"跨租户批量扫描由编排层在服务侧聚合,仍以租户为隔离单元,本仓库不提供
   *     跨租户入口"——本方法仅返回去重后的 tenantId 聚合,不返回任何跨租户任务数据;
   *     任务数据仍一律经 findStalledProcessing(tenantId, threshold) 按租户隔离读取
   *   - 遵循项目分层惯例(数据访问收敛于 repository,generation.service 现状不直接持有
   *     Prisma 依赖;相较在编排层直连 Prisma distinct,此处为最小侵入方案)
   *   - 实现注:select { tenantId } + TS 侧 Set 去重(processing 任务量级受 5 次/分限流
   *     约束,恒为小集合;规避 distinct 在部分测试 mock 实现上的兼容差异)
   */
  async findProcessingTenantIds(): Promise<string[]> {
    const rows = await prisma().generationTask.findMany({
      where: { status: 'processing' },
      select: { tenantId: true },
    });
    return Array.from(new Set(rows.map((r) => r.tenantId)));
  }

  /**
   * 查询 stalled(卡滞)的 processing 任务(M-4 v1.1.0 修订 R2,供 M4-T4 stalled 恢复扫描读取)
   * 判定口径:status='processing' 且 processingStartedAt 早于阈值时间
   * (processingStartedAt 为 NULL 的任务不满足 lt 比较,不会被误判——对应 D-4 判定条件)
   * 扫描编排(启动时 + 每 60s 定时、超时标记 failed WORKER_INTERRUPTED)属编排层职责,
   * 跨租户批量扫描由编排层在服务侧聚合(仍以租户为隔离单元),本仓库不提供跨租户入口
   * @param tenantId 租户 ID(强制隔离)
   * @param threshold 阈值时间(仅返回 processingStartedAt 早于该时间的任务,由调用方按
   *                  GENERATION_STALLED_TIMEOUT_MS 计算得出)
   */
  async findStalledProcessing(tenantId: string, threshold: Date): Promise<GenerationTask[]> {
    return prisma().generationTask.findMany({
      where: {
        tenantId,
        status: 'processing',
        processingStartedAt: { lt: threshold },
      },
      orderBy: { processingStartedAt: 'asc' },
    });
  }

  /**
   * 原子标记 stalled 任务失败(M-4 stalled 恢复扫描专用,D-4 竞态规避)
   *
   * 仅更新"仍处于 processing 且 processingStartedAt 早于阈值"的行(updateMany
   * 单条原子语句):彻底规避扫描器与 Worker 的竞态——若任务在 findStalledProcessing
   * 读取之后、本更新执行之前恰好被 Worker 推进为 success/failed,本更新影响行数为 0,
   * 不会覆盖 Worker 写入的终态(真源 §2.6 决策 D-4"仅更新仍为 processing 的行")。
   *
   * 仅供恢复扫描内部使用(Worker 正常路径仍走 updateStatus);不自动重新入队
   *
   * @param tenantId 租户 ID(强制隔离)
   * @param id 任务 ID
   * @param threshold 阈值时间(与 findStalledProcessing 同口径)
   * @param data 终态字段(failureReason='WORKER_INTERRUPTED' + completedAt)
   * @returns 实际更新行数(0 表示任务已被并发推进终态或已不满足 stalled 条件)
   */
  async markStalledProcessingFailed(
    tenantId: string,
    id: string,
    threshold: Date,
    data: { failureReason: string; completedAt: Date },
  ): Promise<number> {
    const result = await prisma().generationTask.updateMany({
      where: {
        id,
        tenantId,
        status: 'processing',
        processingStartedAt: { lt: threshold },
      },
      data: {
        status: 'failed',
        failureReason: data.failureReason,
        completedAt: data.completedAt,
      },
    });
    return result.count;
  }
}

export const generationRepository = new GenerationRepository();