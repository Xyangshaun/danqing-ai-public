// ============================================================
// 管理后台 - 订阅业务服务(Phase 4)
// 对应 API:/api/admin/subscriptions + /api/admin/invoices + /api/admin/plans
//
// 职责:
//   1. 订阅列表/详情查询(支持跨租户)
//   2. 管理员取消订阅 + 审计日志
//   3. 退款处理(事务:发票状态 + 订阅状态)+ 审计日志
//   4. 发票列表/详情查询
//   5. 套餐列表/创建/更新(静态配置 + 内存覆盖)
//
// 安全约束:
//   - tenant_id 强制从 JWT 注入
//   - 退款需事务保证订阅状态 + 发票状态一致
//   - 退款金额校验(不超过发票金额)
// ============================================================

import type { Request } from 'express';
import type { Subscription, Invoice, TenantPlan, SubscriptionStatus } from '@prisma/client';
import {
  adminSubscriptionRepository,
  type ListAdminSubscriptionsFilter,
  type ListAdminInvoicesFilter,
} from '../repositories/admin-subscription.repository.js';
import { subscriptionService } from './subscription.service.js';
import { writeAudit } from './admin-audit.service.js';
import { BusinessError } from '../middlewares/error-handler.js';
import { ErrorCode } from '../types/api-contract.js';
import type {
  AdminSubscriptionListItem,
  AdminSubscriptionDetail,
  ListAdminSubscriptionsQuery,
  AdminCancelSubscriptionResponse,
  AdminRefundRequest,
  AdminRefundResponse,
  AdminInvoiceListItem,
  AdminInvoiceDetail,
  ListAdminInvoicesQuery,
  ListAdminPlansResponse,
  CreateAdminPlanRequest,
  CreateAdminPlanResponse,
  UpdateAdminPlanRequest,
  UpdateAdminPlanResponse,
  ListAdminSubscriptionsResponse,
  ListAdminInvoicesResponse,
} from '../types/api-contract.js';

class AdminSubscriptionServiceClass {
  // ============================================================
  // 订阅列表/详情
  // ============================================================

  async listSubscriptions(query: ListAdminSubscriptionsQuery, ctx: { tenantId: string }): Promise<ListAdminSubscriptionsResponse> {
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 20, 100);

    const filter: ListAdminSubscriptionsFilter = {
      currentTenantId: ctx.tenantId,
      targetTenantId: query.tenantId,
      plan: query.plan as TenantPlan | undefined,
      status: query.status as SubscriptionStatus | undefined,
      startDate: query.startDate ? new Date(query.startDate) : undefined,
      endDate: query.endDate ? new Date(query.endDate) : undefined,
      page,
      pageSize,
    };

    const { items, total } = await adminSubscriptionRepository.listSubscriptions(filter);

    return {
      items: items.map((s) => this.toSubscriptionListItem(s)),
      total,
      page,
      pageSize,
      hasMore: page * pageSize < total,
    };
  }

  async getSubscription(subscriptionId: string, ctx: { tenantId: string }): Promise<AdminSubscriptionDetail> {
    const sub = await adminSubscriptionRepository.findSubscriptionById(ctx.tenantId, subscriptionId);
    if (!sub) {
      throw new BusinessError(ErrorCode.SUBSCRIPTION_NOT_FOUND, '订阅不存在', 404);
    }
    return this.toSubscriptionDetail(sub);
  }

  // ============================================================
  // 取消订阅
  // ============================================================

  async cancelSubscription(
    subscriptionId: string,
    ctx: { req: Request; tenantId: string },
  ): Promise<AdminCancelSubscriptionResponse> {
    const before = await adminSubscriptionRepository.findSubscriptionById(ctx.tenantId, subscriptionId);
    if (!before) {
      throw new BusinessError(ErrorCode.SUBSCRIPTION_NOT_FOUND, '订阅不存在', 404);
    }
    if (before.cancelAtPeriodEnd) {
      throw new BusinessError(ErrorCode.SUBSCRIPTION_ALREADY_CANCELED, '订阅已标记为取消', 409);
    }

    const after = await adminSubscriptionRepository.cancelSubscription(subscriptionId);

    await writeAudit({
      req: ctx.req,
      action: 'cancel',
      resource: 'subscription',
      resourceId: subscriptionId,
      targetTenantId: after.tenantId,
      beforeData: { cancelAtPeriodEnd: before.cancelAtPeriodEnd, status: before.status },
      afterData: { cancelAtPeriodEnd: after.cancelAtPeriodEnd, status: after.status },
      note: '管理员取消订阅(周期结束生效)',
    });

    return {
      id: after.id,
      status: after.status as 'active' | 'past_due' | 'canceled' | 'expired',
      cancelAtPeriodEnd: after.cancelAtPeriodEnd,
      periodEnd: after.periodEnd.toISOString(),
    };
  }

  // ============================================================
  // 退款处理
  // ============================================================

  async refundSubscription(
    subscriptionId: string,
    body: AdminRefundRequest,
    ctx: { req: Request; tenantId: string },
  ): Promise<AdminRefundResponse> {
    const sub = await adminSubscriptionRepository.findSubscriptionById(ctx.tenantId, subscriptionId);
    if (!sub) {
      throw new BusinessError(ErrorCode.SUBSCRIPTION_NOT_FOUND, '订阅不存在', 404);
    }

    // 查询最新发票
    const invoice = await adminSubscriptionRepository.findLatestInvoiceBySubscription(subscriptionId);
    if (!invoice) {
      throw new BusinessError(ErrorCode.INVOICE_NOT_FOUND, '未找到关联发票,无法退款', 404);
    }

    // 退款金额校验(不超过发票金额)
    const invoiceAmount = Number(invoice.amount);
    if (body.amount <= 0) {
      throw new BusinessError(ErrorCode.PARAM_INVALID, '退款金额必须大于 0', 400);
    }
    if (body.amount > invoiceAmount) {
      throw new BusinessError(
        ErrorCode.ADMIN_REFUND_FAILED,
        `退款金额 ${body.amount} 超过发票金额 ${invoiceAmount}`,
        400,
      );
    }

    // 退款原因必填
    if (!body.reason || body.reason.trim().length === 0) {
      throw new BusinessError(ErrorCode.PARAM_MISSING, '退款原因不能为空', 400);
    }

    try {
      // 事务:更新发票状态为 refunded + 订阅状态为 canceled
      const updated = await adminSubscriptionRepository.refund(
        subscriptionId,
        invoice.id,
        'canceled' as SubscriptionStatus,
      );

      await writeAudit({
        req: ctx.req,
        action: 'refund',
        resource: 'subscription',
        resourceId: subscriptionId,
        targetTenantId: updated.tenantId,
        beforeData: {
          subscriptionStatus: sub.status,
          invoiceStatus: invoice.status,
          invoiceAmount,
        },
        afterData: {
          subscriptionStatus: updated.status,
          invoiceStatus: 'refunded',
          refundAmount: body.amount,
          reason: body.reason,
          externalRefundId: body.externalRefundId ?? null,
        },
        note: `退款 ${body.amount} 元,原因:${body.reason}`,
      });

      return {
        subscriptionId: updated.id,
        invoiceId: invoice.id,
        refundedAmount: body.amount,
        status: updated.status as 'active' | 'past_due' | 'canceled' | 'expired',
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new BusinessError(ErrorCode.ADMIN_REFUND_FAILED, `退款处理失败: ${msg}`, 402);
    }
  }

  // ============================================================
  // 发票列表/详情
  // ============================================================

  async listInvoices(query: ListAdminInvoicesQuery, ctx: { tenantId: string }): Promise<ListAdminInvoicesResponse> {
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 20, 100);

    const filter: ListAdminInvoicesFilter = {
      currentTenantId: ctx.tenantId,
      targetTenantId: query.tenantId,
      status: query.status,
      startDate: query.startDate ? new Date(query.startDate) : undefined,
      endDate: query.endDate ? new Date(query.endDate) : undefined,
      page,
      pageSize,
    };

    const { items, total } = await adminSubscriptionRepository.listInvoices(filter);

    return {
      items: items.map((i) => this.toInvoiceListItem(i)),
      total,
      page,
      pageSize,
      hasMore: page * pageSize < total,
    };
  }

  async getInvoice(invoiceId: string, ctx: { tenantId: string }): Promise<AdminInvoiceDetail> {
    const invoice = await adminSubscriptionRepository.findInvoiceById(ctx.tenantId, invoiceId);
    if (!invoice) {
      throw new BusinessError(ErrorCode.INVOICE_NOT_FOUND, '发票不存在', 404);
    }
    return this.toInvoiceDetail(invoice);
  }

  // ============================================================
  // 套餐管理(基于静态配置 + 内存覆盖)
  // ============================================================

  /**
   * 查询套餐列表
   * 复用 subscriptionService.listPlans() 并追加 enabled 字段
   */
  listPlans(): ListAdminPlansResponse {
    const plans = subscriptionService.listPlans();
    return plans.map((p) => ({ ...p, enabled: true }));
  }

  /**
   * 创建套餐(Phase 4:仅记录审计日志,实际套餐为静态配置)
   */
  async createPlan(body: CreateAdminPlanRequest, ctx: { req: Request }): Promise<CreateAdminPlanResponse> {
    await writeAudit({
      req: ctx.req,
      action: 'create',
      resource: 'plan',
      resourceId: body.plan,
      targetTenantId: null,
      beforeData: null,
      afterData: { name: body.name, maxQuota: body.maxQuota, price: body.price },
      note: `创建套餐 ${body.name}(${body.plan})`,
    });

    return {
      plan: body.plan,
      name: body.name,
      maxQuota: body.maxQuota,
      maxSeats: body.maxSeats,
      price: body.price,
      currency: body.currency ?? 'CNY',
      features: body.features,
      recommended: body.recommended ?? false,
      enabled: body.enabled ?? true,
    };
  }

  /**
   * 更新套餐(Phase 4:仅记录审计日志)
   */
  async updatePlan(planId: string, body: UpdateAdminPlanRequest, ctx: { req: Request }): Promise<UpdateAdminPlanResponse> {
    await writeAudit({
      req: ctx.req,
      action: 'update',
      resource: 'plan',
      resourceId: planId,
      targetTenantId: null,
      beforeData: null,
      afterData: body as unknown as Record<string, unknown>,
      note: `更新套餐 ${planId}`,
    });

    // 返回更新后的套餐信息(基于静态配置覆盖)
    const plans = this.listPlans();
    const existing = plans.find((p) => p.plan === planId);
    if (!existing) {
      throw new BusinessError(ErrorCode.SUBSCRIPTION_PLAN_INVALID, `套餐 ${planId} 不存在`, 400);
    }

    return {
      ...existing,
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.maxQuota !== undefined ? { maxQuota: body.maxQuota } : {}),
      ...(body.maxSeats !== undefined ? { maxSeats: body.maxSeats } : {}),
      ...(body.price !== undefined ? { price: body.price } : {}),
      ...(body.features !== undefined ? { features: body.features } : {}),
      ...(body.recommended !== undefined ? { recommended: body.recommended } : {}),
      ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
    };
  }

  // ============================================================
  // 内部工具方法
  // ============================================================

  private toSubscriptionListItem(s: Subscription & { tenant: { name: string } }): AdminSubscriptionListItem {
    return {
      id: s.id,
      tenantId: s.tenantId,
      tenantName: s.tenant.name,
      plan: s.plan as 'free' | 'standard' | 'enterprise',
      status: s.status as 'active' | 'past_due' | 'canceled' | 'expired',
      periodStart: s.periodStart.toISOString(),
      periodEnd: s.periodEnd.toISOString(),
      cancelAtPeriodEnd: s.cancelAtPeriodEnd,
      amount: Number(s.amount),
      currency: s.currency,
      seats: s.seats,
      createdAt: s.createdAt.toISOString(),
    };
  }

  private toSubscriptionDetail(s: Subscription & { tenant: { name: string } }): AdminSubscriptionDetail {
    return {
      ...this.toSubscriptionListItem(s),
      paymentProvider: (s.paymentProvider as 'stripe' | 'alipay' | 'wechat' | 'manual' | null) ?? null,
      externalSubId: s.externalSubId,
      updatedAt: s.updatedAt.toISOString(),
    };
  }

  private toInvoiceListItem(i: Invoice & { tenant: { name: string } }): AdminInvoiceListItem {
    return {
      id: i.id,
      tenantId: i.tenantId,
      tenantName: i.tenant.name,
      subscriptionId: i.subscriptionId,
      amount: Number(i.amount),
      currency: i.currency,
      status: i.status as 'pending' | 'paid' | 'failed' | 'refunded',
      periodStart: i.periodStart.toISOString(),
      periodEnd: i.periodEnd.toISOString(),
      paidAt: i.paidAt?.toISOString() ?? null,
      createdAt: i.createdAt.toISOString(),
    };
  }

  private toInvoiceDetail(i: Invoice & { tenant: { name: string } }): AdminInvoiceDetail {
    return {
      ...this.toInvoiceListItem(i),
      paymentProvider: (i.paymentProvider as 'stripe' | 'alipay' | 'wechat' | 'manual' | null) ?? null,
      externalInvoiceId: i.externalInvoiceId,
      description: i.description,
    };
  }
}

export const adminSubscriptionService = new AdminSubscriptionServiceClass();
