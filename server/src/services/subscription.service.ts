// ============================================================
// 订阅业务服务
// 对应 API:
//   GET    /subscriptions/current      获取当前订阅
//   GET    /subscriptions/plans        列出可用计划
//   GET    /subscriptions/usage        获取配额使用情况
//   POST   /subscriptions/upgrade      升级/切换计划
//   POST   /subscriptions/cancel       取消订阅(周期结束失效)
//   GET    /subscriptions/invoices     发票列表(分页)
//
// 业务规则:
//   1. 每个租户同一时间只有一个有效订阅(active/past_due)
//   2. 升级计划:立即生效,旧订阅置 canceled,创建新订阅 + 发票
//   3. 降级计划:不允许直接降级,抛 7005(需先取消再重新订阅)
//      理由:降级涉及配额缩减,可能影响已用功能,需人工确认
//   4. 取消订阅:标记 cancelAtPeriodEnd=true,周期结束后 status→expired
//   5. free 计划:无需支付凭证,amount=0,paymentProvider=null
//   6. 计划变更同步更新 Tenant.plan + Tenant.maxSeats(事务保证一致性)
//
// 配额计算:
//   - usedQuota:从 Redis 计数器读取(与 tenant.service 一致)
//   - maxQuota:按 plan 静态映射(free=50, standard=2000, enterprise=-1)
// ============================================================

import { subscriptionRepository } from '../repositories/subscription.repository.js';
import { tenantRepository } from '../repositories/tenant.repository.js';
import { analysisRepository } from '../repositories/analysis.repository.js';
import { BusinessError } from '../middlewares/error-handler.js';
import {
  ErrorCode,
  type TenantPlan,
  type SubscriptionInfo,
  type PlanInfo,
  type GetUsageResponse,
  type UpgradeSubscriptionRequest,
  type CancelSubscriptionResponse,
  type ListInvoicesResponse,
  type InvoiceInfo,
  type SubscriptionStatus,
  type PaymentProvider,
} from '../types/api-contract.js';
import { redis } from '../config/redis.js';
import { logger } from '../utils/logger.js';
import type { Subscription, Invoice } from '@prisma/client';

// ============================================================
// 静态配置:计划详情
// ============================================================

/**
 * 计划配置(配额/席位/价格/特性)
 * 与 data-model-v1.md §3 TenantPlan 保持一致
 */
const PLAN_CONFIG: Record<TenantPlan, Omit<PlanInfo, 'plan'>> = {
  free: {
    name: '免费版',
    maxQuota: 50,
    maxSeats: 1,
    price: 0,
    currency: 'CNY',
    features: [
      '每月 50 次 AI 分析',
      '1 个席位',
      '基础构图/色彩/笔触分析',
      '历史记录 30 天',
      '社区支持',
    ],
  },
  standard: {
    name: '标准版',
    maxQuota: 2000,
    maxSeats: 50,
    price: 99,
    currency: 'CNY',
    features: [
      '每月 2000 次 AI 分析',
      '50 个席位',
      '完整 AI 语义分析(主题/风格/建议)',
      '无限历史记录',
      '成长曲线追踪',
      '优先邮件支持',
    ],
    recommended: true,
  },
  enterprise: {
    name: '院校版',
    maxQuota: -1, // 无限
    maxSeats: 500,
    price: 999,
    currency: 'CNY',
    features: [
      '无限 AI 分析',
      '500 个席位',
      '多租户层级管理(学校/学院/班级)',
      '专属客户经理',
      'API 接入支持',
      '定制评分标准',
      '7×24 小时支持',
    ],
  },
};

/**
 * 计划等级(用于判断升级/降级)
 */
const PLAN_RANK: Record<TenantPlan, number> = {
  free: 0,
  standard: 1,
  enterprise: 2,
};

// ============================================================
// 辅助函数
// ============================================================

/**
 * 计算下一个计费周期(自然月)
 * @returns { periodStart, periodEnd }
 */
function computeNextPeriod(): { periodStart: Date; periodEnd: Date } {
  const periodStart = new Date();
  // 周期结束:下月同日 23:59:59 UTC
  const periodEnd = new Date(periodStart);
  periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);
  periodEnd.setUTCHours(23, 59, 59, 999);
  return { periodStart, periodEnd };
}

/**
 * 从 Redis 读取当月已用配额(降级到 DB 查询)
 */
async function getUsedQuota(tenantId: string): Promise<number> {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const monthKey = `${year}${String(month).padStart(2, '0')}`;
  const redisKey = `tenant:${tenantId}:quota:${monthKey}`;
  try {
    const cached = await redis().get(redisKey);
    return cached ? parseInt(cached, 10) : 0;
  } catch {
    // Redis 不可达时,降级到 DB 查询
    return analysisRepository.countMonthlyUsage(tenantId, year, month);
  }
}

/**
 * 将 Prisma Subscription 转换为 API 契约 SubscriptionInfo
 */
function toSubscriptionInfo(sub: Subscription, usedQuota?: number): SubscriptionInfo {
  const maxQuota = PLAN_CONFIG[sub.plan].maxQuota;
  return {
    id: sub.id,
    tenantId: sub.tenantId,
    plan: sub.plan as TenantPlan,
    status: sub.status as SubscriptionStatus,
    periodStart: sub.periodStart.toISOString(),
    periodEnd: sub.periodEnd.toISOString(),
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
    paymentProvider: sub.paymentProvider as PaymentProvider | null,
    amount: Number(sub.amount),
    currency: sub.currency,
    seats: sub.seats,
    createdAt: sub.createdAt.toISOString(),
    updatedAt: sub.updatedAt.toISOString(),
    usedQuota,
    maxQuota,
  };
}

/**
 * 将 Prisma Invoice 转换为 API 契约 InvoiceInfo
 */
function toInvoiceInfo(inv: Invoice): InvoiceInfo {
  return {
    id: inv.id,
    tenantId: inv.tenantId,
    subscriptionId: inv.subscriptionId,
    amount: Number(inv.amount),
    currency: inv.currency,
    status: inv.status as InvoiceInfo['status'],
    periodStart: inv.periodStart.toISOString(),
    periodEnd: inv.periodEnd.toISOString(),
    paidAt: inv.paidAt?.toISOString() ?? null,
    paymentProvider: inv.paymentProvider as PaymentProvider | null,
    externalInvoiceId: inv.externalInvoiceId,
    description: inv.description,
    createdAt: inv.createdAt.toISOString(),
  };
}

// ============================================================
// 服务类
// ============================================================

class SubscriptionServiceClass {
  /**
   * 获取所有可用计划
   */
  listPlans(): PlanInfo[] {
    return (Object.keys(PLAN_CONFIG) as TenantPlan[]).map((plan) => ({
      plan,
      ...PLAN_CONFIG[plan],
    }));
  }

  /**
   * 获取租户当前订阅(含配额使用情况)
   * 若无订阅记录(老租户),返回 free 计划的默认订阅信息
   */
  async getCurrentSubscription(tenantId: string): Promise<SubscriptionInfo> {
    // 校验租户存在
    const tenant = await tenantRepository.findById(tenantId);
    if (!tenant) {
      throw new BusinessError(ErrorCode.TENANT_NOT_FOUND, '租户不存在', 404);
    }

    const sub = await subscriptionRepository.findActiveByTenantId(tenantId);
    const usedQuota = await getUsedQuota(tenantId);

    if (!sub) {
      // 老租户无订阅记录:构造 free 默认订阅(向前兼容)
      const { periodStart, periodEnd } = computeNextPeriod();
      const defaultSub: SubscriptionInfo = {
        id: `default-${tenantId}`,
        tenantId,
        plan: tenant.plan as TenantPlan,
        status: 'active',
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
        cancelAtPeriodEnd: false,
        paymentProvider: null,
        amount: 0,
        currency: 'CNY',
        seats: tenant.maxSeats,
        createdAt: tenant.createdAt.toISOString(),
        updatedAt: tenant.updatedAt.toISOString(),
        usedQuota,
        maxQuota: PLAN_CONFIG[tenant.plan as TenantPlan].maxQuota,
      };
      return defaultSub;
    }

    return toSubscriptionInfo(sub, usedQuota);
  }

  /**
   * 获取配额使用情况
   */
  async getUsage(tenantId: string): Promise<GetUsageResponse> {
    const tenant = await tenantRepository.findById(tenantId);
    if (!tenant) {
      throw new BusinessError(ErrorCode.TENANT_NOT_FOUND, '租户不存在', 404);
    }

    const sub = await subscriptionRepository.findActiveByTenantId(tenantId);
    const plan = (sub?.plan ?? tenant.plan) as TenantPlan;
    const config = PLAN_CONFIG[plan];
    const usedQuota = await getUsedQuota(tenantId);
    const memberCount = await tenantRepository.countMembers(tenantId);

    // 周期时间:优先用订阅记录,无则用默认自然月
    const periodStart = sub?.periodStart ?? new Date();
    const periodEnd = sub?.periodEnd ?? (() => {
      const d = new Date();
      d.setUTCMonth(d.getUTCMonth() + 1);
      d.setUTCHours(23, 59, 59, 999);
      return d;
    })();

    return {
      plan,
      usedQuota,
      maxQuota: config.maxQuota,
      remainingQuota: config.maxQuota === -1 ? -1 : Math.max(0, config.maxQuota - usedQuota),
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      usedSeats: memberCount,
      maxSeats: sub?.seats ?? tenant.maxSeats,
    };
  }

  /**
   * 升级/切换计划
   *
   * 业务流程:
   *   1. 校验目标计划合法
   *   2. 校验是否为降级(降级抛 7005)
   *   3. 校验当前订阅状态(已取消不可升级)
   *   4. 事务:旧订阅置 canceled → 创建新订阅 → 创建发票 → 同步 Tenant.plan/maxSeats
   *   5. 返回新订阅信息
   */
  async upgradePlan(params: {
    tenantId: string;
    body: UpgradeSubscriptionRequest;
  }): Promise<SubscriptionInfo> {
    const { tenantId, body } = params;
    const targetPlan = body.plan;

    // 1. 校验租户
    const tenant = await tenantRepository.findById(tenantId);
    if (!tenant) {
      throw new BusinessError(ErrorCode.TENANT_NOT_FOUND, '租户不存在', 404);
    }

    // 2. 校验目标计划与当前计划不同
    const currentSub = await subscriptionRepository.findActiveByTenantId(tenantId);
    const currentPlan = (currentSub?.plan ?? tenant.plan) as TenantPlan;
    if (targetPlan === currentPlan) {
      throw new BusinessError(
        ErrorCode.PARAM_INVALID,
        '目标计划与当前计划相同,无需切换',
        400,
      );
    }

    // 3. 校验是否为降级
    if (PLAN_RANK[targetPlan] < PLAN_RANK[currentPlan]) {
      throw new BusinessError(
        ErrorCode.SUBSCRIPTION_DOWNGRADE_NOT_ALLOWED,
        `不支持直接降级(${currentPlan} → ${targetPlan}),请先取消当前订阅再重新订阅`,
        400,
      );
    }

    // 4. 校验付费计划需要支付渠道(free 不需要)
    const targetConfig = PLAN_CONFIG[targetPlan];
    if (targetPlan !== 'free') {
      if (!body.paymentProvider) {
        throw new BusinessError(
          ErrorCode.PARAM_MISSING,
          `升级到 ${targetConfig.name} 需要提供支付渠道(paymentProvider)`,
          400,
        );
      }
      // TODO: Phase 3.5 接入真实支付渠道,当前为模拟支付
      // 实际应调用 paymentProvider 的 API 创建支付订单,返回支付链接
    }

    // 5. 校验当前订阅未处于已取消状态
    if (currentSub?.status === 'canceled') {
      throw new BusinessError(
        ErrorCode.SUBSCRIPTION_ALREADY_CANCELED,
        '当前订阅已取消,请直接重新订阅',
        409,
      );
    }

    // 6. 事务执行:旧订阅取消 + 新订阅创建 + 发票生成 + 租户同步
    const { periodStart, periodEnd } = computeNextPeriod();

    const newSub = await subscriptionRepository.withTransaction(async (tx) => {
      // 6.1 旧订阅置 canceled(若存在)
      if (currentSub) {
        await tx.subscription.update({
          where: { id: currentSub.id },
          data: {
            status: 'canceled',
            cancelAtPeriodEnd: true,
          },
        });
      }

      // 6.2 创建新订阅
      const created = await tx.subscription.create({
        data: {
          tenantId,
          plan: targetPlan,
          status: 'active',
          periodStart,
          periodEnd,
          cancelAtPeriodEnd: false,
          paymentProvider: targetPlan === 'free' ? null : (body.paymentProvider ?? null),
          externalSubId: body.paymentToken ?? null,
          amount: targetConfig.price,
          currency: targetConfig.currency,
          seats: targetConfig.maxSeats,
        },
      });

      // 6.3 创建发票(付费计划才生成;free 不生成发票)
      if (targetPlan !== 'free') {
        const now = new Date();
        await tx.invoice.create({
          data: {
            tenantId,
            subscriptionId: created.id,
            amount: targetConfig.price,
            currency: targetConfig.currency,
            // 模拟支付:直接标记为已支付(Phase 3.5 接入真实支付后改为 pending)
            status: 'paid',
            periodStart,
            periodEnd,
            paidAt: now,
            paymentProvider: body.paymentProvider ?? null,
            externalInvoiceId: body.paymentToken ?? null,
            description: `${new Date().getUTCFullYear()}年${new Date().getUTCMonth() + 1}月${targetConfig.name}订阅`,
          },
        });
      }

      // 6.4 同步 Tenant.plan + maxSeats(保持一致性)
      await tx.tenant.update({
        where: { id: tenantId },
        data: {
          plan: targetPlan,
          maxSeats: targetConfig.maxSeats,
        },
      });

      return created;
    });

    logger.info(
      { tenantId, from: currentPlan, to: targetPlan, subscriptionId: newSub.id },
      '[subscription] plan upgraded',
    );

    const usedQuota = await getUsedQuota(tenantId);
    return toSubscriptionInfo(newSub, usedQuota);
  }

  /**
   * 取消订阅(周期结束自动失效)
   *
   * 业务规则:
   *   - 标记 cancelAtPeriodEnd=true,不立即终止
   *   - 当前周期内仍可正常使用(保障用户权益)
   *   - 周期结束后由定时任务将 status 置为 expired
   *   - free 计划也可取消(等同不续订,但功能不变)
   */
  async cancelSubscription(tenantId: string): Promise<CancelSubscriptionResponse> {
    const tenant = await tenantRepository.findById(tenantId);
    if (!tenant) {
      throw new BusinessError(ErrorCode.TENANT_NOT_FOUND, '租户不存在', 404);
    }

    const sub = await subscriptionRepository.findActiveByTenantId(tenantId);
    if (!sub) {
      throw new BusinessError(
        ErrorCode.SUBSCRIPTION_NOT_FOUND,
        '无有效订阅可取消',
        404,
      );
    }

    // 已标记取消的订阅不可重复取消
    if (sub.cancelAtPeriodEnd) {
      throw new BusinessError(
        ErrorCode.SUBSCRIPTION_ALREADY_CANCELED,
        '订阅已标记为取消,无需重复操作',
        409,
      );
    }

    // 标记取消
    const updated = await subscriptionRepository.update(tenantId, sub.id, {
      cancelAtPeriodEnd: true,
    });

    logger.info(
      { tenantId, subscriptionId: sub.id, periodEnd: sub.periodEnd },
      '[subscription] canceled (will expire at period end)',
    );

    return {
      id: updated.id,
      status: updated.status as SubscriptionStatus,
      periodEnd: updated.periodEnd.toISOString(),
      cancelAtPeriodEnd: updated.cancelAtPeriodEnd,
    };
  }

  /**
   * 查询发票列表(分页)
   */
  async listInvoices(params: {
    tenantId: string;
    page?: number;
    pageSize?: number;
    status?: InvoiceInfo['status'];
  }): Promise<ListInvoicesResponse> {
    const { tenantId, page = 1, pageSize = 20, status } = params;
    const effectivePageSize = Math.min(pageSize, 100);

    const result = await subscriptionRepository.listInvoices({
      tenantId,
      status,
      page,
      pageSize: effectivePageSize,
    });

    return {
      items: result.items.map(toInvoiceInfo),
      total: result.total,
      page,
      pageSize: effectivePageSize,
      hasMore: page * effectivePageSize < result.total,
    };
  }
}

export const subscriptionService = new SubscriptionServiceClass();
