// ============================================================
// 管理后台 - 审计日志工具(Phase 4)
// 对应文档:auth-design.md §3.9 日志脱敏规则
//
// 职责:
//   1. 提供统一的审计日志写入入口(各 service 调用)
//   2. 自动从 Request 上下文提取 IP/UA/traceId/操作者信息
//   3. 数据脱敏:写入前清除敏感字段(password/token 等)
//   4. 双写:Prisma AuditLog 表 + Winston logger(便于 ELK 采集)
//
// 安全约束:
//   - 审计日志不可变,只增不改不删
//   - 敏感字段(password/email/phone/token)写入前必须脱敏
//   - 失败不阻塞主流程(记录 warn 日志后继续)
// ============================================================

import type { Request } from 'express';
import { adminSystemRepository, type WriteAuditLogParams } from '../repositories/admin-system.repository.js';
import { logger } from '../utils/logger.js';
import type { AuditAction, UserRole } from '../types/api-contract.js';

/** 敏感字段黑名单(写入审计日志前清除) */
const SENSITIVE_FIELDS = [
  'password',
  'passwd',
  'appSecret',
  'app_secret',
  'clientSecret',
  'client_secret',
  'secret',
  'accessToken',
  'access_token',
  'refreshToken',
  'refresh_token',
  'privateKey',
  'private_key',
  'keyHash',
  'key_hash',
  'plainKey',
  'plain_key',
] as const;

/**
 * 深度脱敏对象(递归清除敏感字段)
 */
export function redactSensitive(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map((v) => redactSensitive(v));

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const keyLower = k.toLowerCase();
    if (SENSITIVE_FIELDS.some((sf) => sf.toLowerCase() === keyLower)) {
      out[k] = '****';
    } else if (typeof v === 'object' && v !== null) {
      out[k] = redactSensitive(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * 从 Express Request 提取客户端 IP
 */
function extractIp(req: Request): string {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string') {
    return xff.split(',')[0]?.trim() ?? 'unknown';
  }
  return req.ip ?? 'unknown';
}

/**
 * 从 Express Request 提取 User-Agent
 */
function extractUserAgent(req: Request): string {
  return req.headers['user-agent'] ?? 'unknown';
}

/** 审计日志写入参数(由 service 构造) */
export interface AuditContext {
  req: Request;
  action: AuditAction;
  resource: string;
  resourceId?: string | null;
  targetTenantId?: string | null;
  beforeData?: Record<string, unknown> | null;
  afterData?: Record<string, unknown> | null;
  note?: string | null;
}

/**
 * 写入审计日志
 * 由各 admin service 在写操作完成后调用
 *
 * @param ctx 审计上下文(含 Request 与操作详情)
 */
export async function writeAudit(ctx: AuditContext): Promise<void> {
  try {
    const { req, action, resource, resourceId, targetTenantId, beforeData, afterData, note } = ctx;

    const params: WriteAuditLogParams = {
      operatorId: req.userId ?? 'unknown',
      operatorRole: req.role ?? 'unknown' as UserRole,
      operatorTenantId: req.tenantId ?? null,
      action,
      resource,
      resourceId: resourceId ?? null,
      targetTenantId: targetTenantId ?? null,
      beforeData: (beforeData ? redactSensitive(beforeData) : null) as Record<string, unknown> | null,
      afterData: (afterData ? redactSensitive(afterData) : null) as Record<string, unknown> | null,
      ip: extractIp(req),
      userAgent: extractUserAgent(req),
      traceId: req.traceId ?? null,
      note: note ?? null,
    };

    // 1. 写入数据库 AuditLog 表
    await adminSystemRepository.writeAuditLog(params);

    // 2. 双写 Winston logger(便于 ELK 采集,字段与 DB 对齐)
    logger.info(
      {
        action: `admin.${action}.${resource}`,
        operatorId: params.operatorId,
        operatorRole: params.operatorRole,
        operatorTenantId: params.operatorTenantId,
        resourceId: params.resourceId,
        targetTenantId: params.targetTenantId,
        ip: params.ip,
        traceId: params.traceId,
        note: params.note,
      },
      `[audit] ${action} ${resource}`,
    );
  } catch (err) {
    // 审计日志失败不阻塞主流程,仅记录 warn
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(
      {
        action: ctx.action,
        resource: ctx.resource,
        resourceId: ctx.resourceId,
        err: msg,
        traceId: ctx.req.traceId,
      },
      '[audit] write audit log failed, non-blocking',
    );
  }
}
