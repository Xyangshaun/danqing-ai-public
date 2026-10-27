// ============================================================
// 管理后台 - 订阅 Repository(Phase 4)
// 对应 API:/api/admin/subscriptions + /api/admin/invoices + /api/admin/plans
//
// 职责:
//   1. 订阅列表/详情查询(支持跨租户)
//   2. 管理员取消订阅
//   3. 退款处理(更新发票状态为 refunded)
//   4. 发票列表/详情查询
//   5. 套餐管理(静态配置 + Redis 缓存)
//
// 安全约束:
//   - 订阅查询按 tenantId 过滤(管理后台允许跨租户)
//   - 退款需事务保证订阅状态 + 发票状态一致
// ============================================================

import type { Prisma} from '@prisma/client';
import { type Subscription, type Invoice, type TenantPlan, type SubscriptionStatus, type InvoiceStatus } from '@prisma/client';
import { prisma } from '../config/prisma.js';

export interface ListAdminSubscriptionsFilter {
  currentTenantId: string;
  targetTenantId?: string;
  plan?: TenantPlan;
  status?: SubscriptionStatus;
  startDate?: Date;
  endDate?: Date;
  page: number;
  pageSize: number;
}

export interface ListAdminInvoicesFilter {
  currentTenantId: string;
  targetTenantId?: string;
  status?: InvoiceStatus;
  startDate?: Date;
  endDate?: Date;
  page: number;
  pageSize: number;
}

export class AdminSubscriptionRepository {
  /**
   * 分页查询订阅列表(关联 tenant 表获取 tenantName)
   */
  async listSubscriptions(filter: ListAdminSubscriptionsFilter): Promise<{ items: Array<Subscription & { tenant: { name: string } }>; total: number }> {
    const where: Prisma.SubscriptionWhereInput = {};
    where.tenantId = filter.targetTenantId ?? filter.currentTenantId;
    if (filter.plan) where.plan = filter.plan;
    if (filter.status) where.status = filter.status;
    if (filter.startDate || filter.endDate) {
      where.createdAt = {};
      if (filter.startDate) where.createdAt.gte = filter.startDate;
      if (filter.endDate) where.createdAt.lte = filter.endDate;
    }

    const [items, total] = await Promise.all([
      prisma().subscription.findMany({
        where,
        include: { tenant: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (filter.page - 1) * filter.pageSize,
        take: filter.pageSize,
      }),
      prisma().subscription.count({ where }),
    ]);

    return { items: items as Array<Subscription & { tenant: { name: string } }>, total };
  }

  /**
   * 按 ID 查询订阅详情(支持跨租户,关联 tenant 获取 tenantName)
   */
  async findSubscriptionById(
    currentTenantId: string,
    subscriptionId: string,
    allowCrossTenant = false,
  ): Promise<(Subscription & { tenant: { name: string } }) | null> {
    const where: Prisma.SubscriptionWhereInput = { id: subscriptionId };
    if (!allowCrossTenant) {
      where.tenantId = currentTenantId;
    }
    const result = await prisma().subscription.findFirst({
      where,
      include: { tenant: { select: { name: true } } },
    });
    return result as (Subscription & { tenant: { name: string } }) | null;
  }

  /**
   * 管理员取消订阅(cancelAtPeriodEnd=true,周期结束生效)
   */
  async cancelSubscription(subscriptionId: string): Promise<Subscription> {
    return prisma().subscription.update({
      where: { id: subscriptionId },
      data: {
        cancelAtPeriodEnd: true,
      },
    });
  }

  /**
   * 退款处理(事务:更新订阅状态 + 发票状态)
   * @param subscriptionId 订阅 ID
   * @param invoiceId 发票 ID
   * @param status 订阅新状态
   * @returns 更新后的订阅
   */
  async refund(
    subscriptionId: string,
    invoiceId: string,
    status: SubscriptionStatus,
  ): Promise<Subscription> {
    return prisma().$transaction(async (tx) => {
      // 1. 更新发票状态为 refunded
      await tx.invoice.update({
        where: { id: invoiceId },
        data: { status: 'refunded' as InvoiceStatus },
      });
      // 2. 更新订阅状态
      return tx.subscription.update({
        where: { id: subscriptionId },
        data: { status },
      });
    });
  }

  /**
   * 分页查询发票列表(关联 tenant 表)
   */
  async listInvoices(filter: ListAdminInvoicesFilter): Promise<{ items: Array<Invoice & { tenant: { name: string } }>; total: number }> {
    const where: Prisma.InvoiceWhereInput = {};
    where.tenantId = filter.targetTenantId ?? filter.currentTenantId;
    if (filter.status) where.status = filter.status;
    if (filter.startDate || filter.endDate) {
      where.createdAt = {};
      if (filter.startDate) where.createdAt.gte = filter.startDate;
      if (filter.endDate) where.createdAt.lte = filter.endDate;
    }

    const [items, total] = await Promise.all([
      prisma().invoice.findMany({
        where,
        include: { tenant: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (filter.page - 1) * filter.pageSize,
        take: filter.pageSize,
      }),
      prisma().invoice.count({ where }),
    ]);

    return { items: items as Array<Invoice & { tenant: { name: string } }>, total };
  }

  /**
   * 按 ID 查询发票详情(关联 tenant 获取 tenantName)
   */
  async findInvoiceById(
    currentTenantId: string,
    invoiceId: string,
    allowCrossTenant = false,
  ): Promise<(Invoice & { tenant: { name: string } }) | null> {
    const where: Prisma.InvoiceWhereInput = { id: invoiceId };
    if (!allowCrossTenant) {
      where.tenantId = currentTenantId;
    }
    const result = await prisma().invoice.findFirst({
      where,
      include: { tenant: { select: { name: true } } },
    });
    return result as (Invoice & { tenant: { name: string } }) | null;
  }

  /**
   * 查询订阅最新发票(用于退款)
   */
  async findLatestInvoiceBySubscription(subscriptionId: string): Promise<Invoice | null> {
    return prisma().invoice.findFirst({
      where: { subscriptionId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * 统计当月 AI 调用量(按租户)
   */
  async countMonthlyAiCalls(tenantId: string): Promise<number> {
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    // 通过 analysis 表统计(analysis 与 subscription 共享 tenantId)
    return prisma().analysis.count({
      where: {
        tenantId,
        createdAt: { gte: start, lt: end },
      },
    });
  }

  /**
   * 事务包装
   */
  async withTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return prisma().$transaction(fn);
  }
}

export const adminSubscriptionRepository = new AdminSubscriptionRepository();
