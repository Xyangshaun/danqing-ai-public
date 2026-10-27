// ============================================================
// 举报业务服务(投诉举报机制,公安备案合规)
// 对应 API:
//   POST /api/v1/reports       提交举报(任意登录角色)
//   GET  /api/admin/reports    举报分页列表(ADMIN/OWNER)
//
// 职责:
//   1. 24h 去重:同用户对同目标 24 小时内仅允许一次举报
//      (重复提交抛 BusinessError DUPLICATE_RESOURCE 1005 / HTTP 409)
//   2. 状态机:举报落库固定 status='pending'(处理动作为后续迭代)
//   3. 审计日志:写操作记录结构化日志(Winston),不含举报补充说明内容
//   4. 脱敏:管理端列表举报人 email/phone 经 maskEmail/maskPhone 掩码
//
// 安全约束:
//   - tenantId 由 controller 从 JWT 注入,service 不从请求体读取
//   - 管理端列表在 Repository 层强制 tenantId 过滤(多租户硬约束)
//   - 日志不输出 detail(用户自由文本,最小化采集原则)
// ============================================================

import type { ReportStatus } from '@prisma/client';
import { reportRepository } from '../repositories/report.repository.js';
import { BusinessError } from '../middlewares/error-handler.js';
import { logger } from '../utils/logger.js';
import { maskEmail, maskPhone } from '../utils/redact.js';
import {
  ErrorCode,
  type CreateReportResponse,
  type AdminReportListItem,
  type ReportTargetType,
  type ReportReason,
} from '../types/api-contract.js';
import type { ReportWithReporter } from '../repositories/report.repository.js';

/** 重复举报判定窗口(24 小时) */
const DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** 创建举报输入(tenantId/reporterId 由鉴权上下文注入) */
export interface CreateReportInput {
  tenantId: string;
  reporterId: string;
  targetType: ReportTargetType;
  targetId: string;
  reason: ReportReason;
  detail?: string;
}

/** 管理端列表输入(tenantId 强制) */
export interface ListReportsInput {
  tenantId: string;
  status?: ReportStatus;
  page: number;
  pageSize: number;
}

export class ReportService {
  /**
   * 提交举报
   * 行为:24h 去重校验 → 落库(status=pending)→ 审计日志 → 返回契约响应
   * @throws BusinessError(DUPLICATE_RESOURCE) 同用户同目标 24h 内重复举报
   */
  async createReport(input: CreateReportInput): Promise<CreateReportResponse> {
    // 1. 24h 去重(命中索引 (reporter_id, target_id, created_at) 窗口查询)
    const since = new Date(Date.now() - DUPLICATE_WINDOW_MS);
    const duplicated = await reportRepository.findRecentDuplicate(
      input.reporterId,
      input.targetId,
      since,
    );
    if (duplicated) {
      throw new BusinessError(
        ErrorCode.DUPLICATE_RESOURCE,
        '24 小时内已举报过该内容,请勿重复提交',
        409,
      );
    }

    // 2. 落库(初始状态固定 pending)
    const report = await reportRepository.create({
      tenantId: input.tenantId,
      reporterId: input.reporterId,
      targetType: input.targetType,
      targetId: input.targetId,
      reason: input.reason,
      detail: input.detail ?? null,
      status: 'pending',
    });

    // 3. 审计日志(写操作留痕;不记录 detail 自由文本,避免日志收集用户输入)
    logger.info(
      {
        reportId: report.id,
        tenantId: input.tenantId,
        reporterId: input.reporterId,
        targetType: input.targetType,
        targetId: input.targetId,
        reason: input.reason,
      },
      '[report] report created',
    );

    // 4. 实体 → API 契约映射
    return {
      id: report.id,
      status: report.status,
      createdAt: report.createdAt.toISOString(),
    };
  }

  /**
   * 管理端分页列表(举报人信息脱敏后输出)
   * tenantId 强制过滤由 Repository 层保证(多租户隔离)
   */
  async listForAdmin(input: ListReportsInput): Promise<{
    items: AdminReportListItem[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const { items, total } = await reportRepository.list({
      tenantId: input.tenantId,
      status: input.status,
      page: input.page,
      pageSize: input.pageSize,
    });

    return {
      items: items.map((item) => this.toAdminReportListItem(item)),
      total,
      page: input.page,
      pageSize: input.pageSize,
    };
  }

  /**
   * Prisma Report(含举报人)→ AdminReportListItem 映射
   * 举报人 email/phone 经 maskEmail/maskPhone 脱敏(合规输出)
   */
  private toAdminReportListItem(item: ReportWithReporter): AdminReportListItem {
    return {
      id: item.id,
      tenantId: item.tenantId,
      reporter: {
        id: item.reporter.id,
        name: item.reporter.name,
        email: maskEmail(item.reporter.email),
        phone: maskPhone(item.reporter.phone),
      },
      targetType: item.targetType,
      targetId: item.targetId,
      reason: item.reason,
      detail: item.detail,
      status: item.status,
      createdAt: item.createdAt.toISOString(),
    };
  }
}

export const reportService = new ReportService();
