// ============================================================
// 举报 Repository(投诉举报机制,公安备案合规)
// 对应 API:
//   POST /api/v1/reports       提交举报(任意登录角色)
//   GET  /api/admin/reports    管理端分页列表(ADMIN/OWNER)
// 多租户:列表查询强制 tenantId 过滤;写入由 service 注入租户上下文
// 安全:全部走 Prisma 参数化查询,无字符串拼接 SQL
// ============================================================

import type { Prisma, Report, ReportStatus } from '@prisma/client';
import { prisma } from '../config/prisma.js';

/** 管理端列表查询条件(tenantId 强制,多租户隔离硬约束) */
export interface ReportListFilter {
  tenantId: string;
  status?: ReportStatus;
  page: number;
  pageSize: number;
}

/** 举报人信息载荷(include reporter select 场景) */
export type ReportWithReporter = Report & {
  reporter: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
  };
};

export class ReportRepository {
  /**
   * 创建举报记录(status 由 service 层固定为 pending)
   */
  async create(data: Prisma.ReportUncheckedCreateInput): Promise<Report> {
    return prisma().report.create({ data });
  }

  /**
   * 24h 去重窗口查询:同用户同目标在 since 之后是否已有举报
   * 命中索引 (reporter_id, target_id, created_at)
   */
  async findRecentDuplicate(
    reporterId: string,
    targetId: string,
    since: Date,
  ): Promise<Report | null> {
    return prisma().report.findFirst({
      where: {
        reporterId,
        targetId,
        createdAt: { gte: since },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * 管理端分页列表(强制 tenantId 过滤 + 举报人信息联查)
   * 排序 createdAt 倒序(最新举报优先),命中索引 (status, created_at)
   */
  async list(filter: ReportListFilter): Promise<{ items: ReportWithReporter[]; total: number }> {
    const where: Prisma.ReportWhereInput = { tenantId: filter.tenantId };
    if (filter.status) where.status = filter.status;

    const [items, total] = await Promise.all([
      prisma().report.findMany({
        where,
        include: {
          reporter: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (filter.page - 1) * filter.pageSize,
        take: filter.pageSize,
      }),
      prisma().report.count({ where }),
    ]);
    return { items: items as ReportWithReporter[], total };
  }
}

export const reportRepository = new ReportRepository();
