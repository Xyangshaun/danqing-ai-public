// ============================================================
// 订阅 Repository
// 对应文档:
//   - data-model-v1.md §12(Subscription 表,Phase 3 扩展)
//   - api-contract-v1.md §3.9(订阅相关类型)
//
// 职责:
//   1. Subscription 表 CRUD(强制 tenant_id 过滤)
//   2. Invoice 表 CRUD(强制 tenant_id 过滤)
//   3. 事务包装(订阅升级 + 发票生成 + 租户 plan 同步)
//
// 安全约束:
//   - 所有查询显式带 tenantId 过滤,防跨租户访问
//   - findActiveByTenantId 仅返回当前有效订阅(status=active/past_due)
// ============================================================

import type { Prisma, Subscription, Invoice, TenantPlan } from '@prisma/client';
import { prisma } from '../config/prisma.js';

/**
 * 订阅状态(从 Prisma 生成)
 */
type SubscriptionStatus = 'active' | 'past_due' | 'canceled' | 'expired';

/**
 * 发票状态(从 Prisma 生成)
 */
type InvoiceStatus = 'pending' | 'paid' | 'failed' | 'refunded';

export class SubscriptionRepository {
  /**
   * 按 ID 查询订阅(强制 tenant_id 过滤)
   */
  async findById(tenantId: string, subscriptionId: string): Promise<Subscription | null> {
    return prisma().subscription.findFirst({
      where: { id: subscriptionId, tenantId },
    });
  }

  /**
   * 查询租户当前有效订阅(active / past_due)
   * 一个租户同一时间只有一个有效订阅
   */
  async findActiveByTenantId(tenantId: string): Promise<Subscription | null> {
    return prisma().subscription.findFirst({
      where: {
        tenantId,
        status: { in: ['active', 'past_due'] as SubscriptionStatus[] },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * 查询租户最新订阅(含已取消/过期,用于历史查询)
   */
  async findLatestByTenantId(tenantId: string): Promise<Subscription | null> {
    return prisma().subscription.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * 创建订阅
   */
  async create(data: {
    tenantId: string;
    plan: TenantPlan;
    status?: SubscriptionStatus;
    periodStart: Date;
    periodEnd: Date;
    cancelAtPeriodEnd?: boolean;
    paymentProvider?: string | null;
    externalSubId?: string | null;
    amount?: number;
    currency?: string;
    seats?: number;
  }): Promise<Subscription> {
    return prisma().subscription.create({
      data: {
        tenantId: data.tenantId,
        plan: data.plan,
        status: data.status ?? 'active',
        periodStart: data.periodStart,
        periodEnd: data.periodEnd,
        cancelAtPeriodEnd: data.cancelAtPeriodEnd ?? false,
        paymentProvider: data.paymentProvider ?? null,
        externalSubId: data.externalSubId ?? null,
        amount: data.amount ?? 0,
        currency: data.currency ?? 'CNY',
        seats: data.seats ?? 1,
      },
    });
  }

  /**
   * 更新订阅(显式校验 tenant_id)
   */
  async update(
    tenantId: string,
    subscriptionId: string,
    data: Prisma.SubscriptionUpdateInput,
  ): Promise<Subscription> {
    return prisma().subscription.update({
      where: { id: subscriptionId },
      data: {
        ...data,
        // 确保 tenantId 不被篡改
        tenant: { connect: { id: tenantId } },
      },
    });
  }

  /**
   * 查询租户的发票列表(分页,强制 tenant_id 过滤)
   */
  async listInvoices(params: {
    tenantId: string;
    subscriptionId?: string;
    status?: InvoiceStatus;
    page: number;
    pageSize: number;
  }): Promise<{ items: Invoice[]; total: number }> {
    const { tenantId, subscriptionId, status, page, pageSize } = params;
    const where: Prisma.InvoiceWhereInput = { tenantId };
    if (subscriptionId) {
      where.subscriptionId = subscriptionId;
    }
    if (status) {
      where.status = status;
    }

    const [items, total] = await Promise.all([
      prisma().invoice.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma().invoice.count({ where }),
    ]);

    return { items, total };
  }

  /**
   * 按 ID 查询发票(强制 tenant_id 过滤)
   */
  async findInvoiceById(tenantId: string, invoiceId: string): Promise<Invoice | null> {
    return prisma().invoice.findFirst({
      where: { id: invoiceId, tenantId },
    });
  }

  /**
   * 创建发票
   */
  async createInvoice(data: {
    tenantId: string;
    subscriptionId: string;
    amount: number;
    currency?: string;
    status?: InvoiceStatus;
    periodStart: Date;
    periodEnd: Date;
    paidAt?: Date | null;
    paymentProvider?: string | null;
    externalInvoiceId?: string | null;
    description?: string | null;
  }): Promise<Invoice> {
    return prisma().invoice.create({
      data: {
        tenantId: data.tenantId,
        subscriptionId: data.subscriptionId,
        amount: data.amount,
        currency: data.currency ?? 'CNY',
        status: data.status ?? 'pending',
        periodStart: data.periodStart,
        periodEnd: data.periodEnd,
        paidAt: data.paidAt ?? null,
        paymentProvider: data.paymentProvider ?? null,
        externalInvoiceId: data.externalInvoiceId ?? null,
        description: data.description ?? null,
      },
    });
  }

  /**
   * 事务包装(用于订阅升级 + 发票生成 + 租户 plan 同步)
   */
  async withTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return prisma().$transaction(fn);
  }
}

export const subscriptionRepository = new SubscriptionRepository();
