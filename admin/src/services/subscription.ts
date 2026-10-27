// ============================================================
// 订阅管理 API
// 对应后端:/api/admin/subscriptions + /api/admin/invoices + /api/admin/plans
// ============================================================

import { get, post, patch } from './request';
import type {
  ListAdminSubscriptionsQuery,
  ListAdminSubscriptionsResponse,
  AdminSubscriptionDetail,
  AdminCancelSubscriptionResponse,
  AdminRefundRequest,
  AdminRefundResponse,
  ListAdminInvoicesQuery,
  ListAdminInvoicesResponse,
  AdminInvoiceDetail,
  ListAdminPlansResponse,
  CreateAdminPlanRequest,
  CreateAdminPlanResponse,
  UpdateAdminPlanRequest,
  UpdateAdminPlanResponse,
} from './types';

/** 订阅列表 */
export function listSubscriptions(
  params: ListAdminSubscriptionsQuery,
): Promise<ListAdminSubscriptionsResponse> {
  return get<ListAdminSubscriptionsResponse>('/api/admin/subscriptions', params);
}

/** 订阅详情 */
export function getSubscription(id: string): Promise<AdminSubscriptionDetail> {
  return get<AdminSubscriptionDetail>(`/api/admin/subscriptions/${id}`);
}

/** 管理员取消订阅(周期结束生效) */
export function cancelSubscription(id: string): Promise<AdminCancelSubscriptionResponse> {
  return post<AdminCancelSubscriptionResponse>(`/api/admin/subscriptions/${id}/cancel`);
}

/** 退款处理 */
export function refundSubscription(
  id: string,
  data: AdminRefundRequest,
): Promise<AdminRefundResponse> {
  return post<AdminRefundResponse>(`/api/admin/subscriptions/${id}/refund`, data);
}

/** 发票列表 */
export function listInvoices(params: ListAdminInvoicesQuery): Promise<ListAdminInvoicesResponse> {
  return get<ListAdminInvoicesResponse>('/api/admin/invoices', params);
}

/** 发票详情 */
export function getInvoice(id: string): Promise<AdminInvoiceDetail> {
  return get<AdminInvoiceDetail>(`/api/admin/invoices/${id}`);
}

/** 套餐列表 */
export function listPlans(): Promise<ListAdminPlansResponse> {
  return get<ListAdminPlansResponse>('/api/admin/plans');
}

/** 创建套餐 */
export function createPlan(data: CreateAdminPlanRequest): Promise<CreateAdminPlanResponse> {
  return post<CreateAdminPlanResponse>('/api/admin/plans', data);
}

/** 更新套餐 */
export function updatePlan(
  id: string,
  data: UpdateAdminPlanRequest,
): Promise<UpdateAdminPlanResponse> {
  return patch<UpdateAdminPlanResponse>(`/api/admin/plans/${id}`, data);
}
