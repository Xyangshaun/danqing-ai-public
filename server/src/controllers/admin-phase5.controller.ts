// ============================================================
// 管理后台 Phase 5 Controller(院校管理扩展)
// 对应 API:
//   POST /admin/tenants/:id/invitations      (创建邀请码,admin)
//   GET  /admin/tenants/:id/invitations      (列出邀请码,admin)
//   POST /admin/tenants/:id/students/batch   (批量导入学生,admin)
//   GET  /admin/presets                       (列出所有预设,admin)
//   POST /admin/presets/:id/override          (从 built-in 派生覆盖,admin)
//
// 安全约束:
//   - tenantId 强制从 JWT 注入,禁止从请求体读取
//   - 邀请码:URL-safe 32 位,过期/用尽校验
//   - 批量导入:逐条处理,失败明细返回
//   - 所有写操作记录审计日志
// ============================================================

import type { RequestHandler } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { invitationRepository, INVITATION_CODE_LENGTH } from '../repositories/invitation.repository.js';
import { tenantRepository } from '../repositories/tenant.repository.js';
import { userRepository } from '../repositories/user.repository.js';
import { presetService } from '../services/preset.service.js';
import { writeAudit } from '../services/admin-audit.service.js';
import { success, error } from '../utils/response.js';
import { ErrorCode } from '../types/api-contract.js';
import type { UserRole } from '../types/api-contract.js';
import { logger } from '../utils/logger.js';

// ============================================================
// Zod Schemas
// ============================================================

const userRoleSchema = z.enum(['admin', 'teacher', 'student', 'owner']) as z.ZodType<UserRole>;

const createInvitationSchema = z.object({
  role: userRoleSchema,
  maxUses: z.number().int().min(1).max(100),
  expiresHours: z.number().int().min(1).max(720), // 最长 30 天
});

const batchImportStudentsSchema = z.object({
  students: z
    .array(
      z.object({
        name: z.string().min(1).max(64),
        phone: z.string().max(20).optional(),
        email: z.string().email().max(128).optional(),
      }),
    )
    .min(1)
    .max(500),
  role: userRoleSchema.optional(),
});

const overridePresetSchema = z.object({
  name: z.string().min(1).max(64),
  description: z.string().max(500).optional(),
  dimensions: z
    .array(
      z.object({
        key: z.string().min(1).max(64),
        label: z.string().min(1).max(64),
        labelEn: z.string().min(1).max(64),
        weight: z.number().min(0).max(100),
      }),
    )
    .min(1),
  isPrivate: z.boolean().optional(),
});

/** 路径参数 :id 校验 schema(防止 req.params.id 为 undefined) */
const idParamSchema = z.object({
  id: z.string().min(1, '缺少必填参数:id'),
});

/**
 * 生成 URL-safe 邀请码(32 位)
 */
function generateInvitationCode(): string {
  return crypto.randomBytes(INVITATION_CODE_LENGTH).toString('base64url').slice(0, INVITATION_CODE_LENGTH);
}

/**
 * 断言当前用户对目标租户有管理权限(租户匹配)
 */
function assertTenantAccess(req: Parameters<RequestHandler>[0], targetTenantId: string): boolean {
  return req.tenantId === targetTenantId;
}

// ============================================================
// Handlers
// ============================================================

/** POST /admin/tenants/:id/invitations */
export const createInvitation: RequestHandler = async (req, res, next) => {
  try {
    if (!req.userId || !req.tenantId) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }
    const params = idParamSchema.safeParse(req.params);
    if (!params.success) {
      return error(res, ErrorCode.PARAM_INVALID, params.error.issues[0]?.message ?? '参数错误', 400);
    }
    const targetTenantId = params.data.id;
    // 多租户隔离:管理员仅可为本租户创建邀请码
    if (!assertTenantAccess(req, targetTenantId)) {
      return error(res, ErrorCode.TENANT_MISMATCH, '无权操作其他租户', 403);
    }

    const parseResult = createInvitationSchema.safeParse(req.body);
    if (!parseResult.success) {
      return error(res, ErrorCode.PARAM_INVALID, parseResult.error.issues[0]?.message ?? '参数错误', 400);
    }

    const code = generateInvitationCode();
    const expiresAt = new Date(Date.now() + parseResult.data.expiresHours * 3600 * 1000);
    const invitation = await invitationRepository.create({
      code,
      tenantId: targetTenantId,
      role: parseResult.data.role,
      maxUses: parseResult.data.maxUses,
      expiresAt,
      createdBy: req.userId,
    });

    await writeAudit({
      req,
      action: 'create',
      resource: 'invitation',
      resourceId: invitation.id,
      targetTenantId,
      beforeData: null,
      afterData: { code: invitation.code, role: invitation.role, maxUses: invitation.maxUses, expiresAt: invitation.expiresAt.toISOString() },
      note: `创建邀请码(role=${parseResult.data.role})`,
    });

    logger.info({ invitationId: invitation.id, tenantId: targetTenantId, userId: req.userId }, '[admin-phase5] invitation created');

    return success(
      res,
      {
        id: invitation.id,
        code: invitation.code,
        tenantId: invitation.tenantId,
        role: invitation.role,
        maxUses: invitation.maxUses,
        usedCount: invitation.usedCount,
        expiresAt: invitation.expiresAt.toISOString(),
        createdBy: invitation.createdBy,
        createdAt: invitation.createdAt.toISOString(),
      },
      '邀请码已创建',
    );
  } catch (err) {
    return next(err);
  }
};

/** GET /admin/tenants/:id/invitations */
export const listInvitations: RequestHandler = async (req, res, next) => {
  try {
    if (!req.userId || !req.tenantId) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }
    const params = idParamSchema.safeParse(req.params);
    if (!params.success) {
      return error(res, ErrorCode.PARAM_INVALID, params.error.issues[0]?.message ?? '参数错误', 400);
    }
    const targetTenantId = params.data.id;
    if (!assertTenantAccess(req, targetTenantId)) {
      return error(res, ErrorCode.TENANT_MISMATCH, '无权操作其他租户', 403);
    }
    const invitations = await invitationRepository.listByTenant(targetTenantId);
    return success(
      res,
      invitations.map((i) => ({
        id: i.id,
        code: i.code,
        tenantId: i.tenantId,
        role: i.role,
        maxUses: i.maxUses,
        usedCount: i.usedCount,
        expiresAt: i.expiresAt.toISOString(),
        createdBy: i.createdBy,
        createdAt: i.createdAt.toISOString(),
      })),
      'success',
    );
  } catch (err) {
    return next(err);
  }
};

/** POST /admin/tenants/:id/students/batch */
export const batchImportStudents: RequestHandler = async (req, res, next) => {
  try {
    if (!req.userId || !req.tenantId) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }
    const params = idParamSchema.safeParse(req.params);
    if (!params.success) {
      return error(res, ErrorCode.PARAM_INVALID, params.error.issues[0]?.message ?? '参数错误', 400);
    }
    const targetTenantId = params.data.id;
    if (!assertTenantAccess(req, targetTenantId)) {
      return error(res, ErrorCode.TENANT_MISMATCH, '无权操作其他租户', 403);
    }

    const parseResult = batchImportStudentsSchema.safeParse(req.body);
    if (!parseResult.success) {
      return error(res, ErrorCode.PARAM_INVALID, parseResult.error.issues[0]?.message ?? '参数错误', 400);
    }

    // 校验租户存在 + 席位上限
    const tenant = await tenantRepository.findById(targetTenantId);
    if (!tenant) {
      return error(res, ErrorCode.TENANT_NOT_FOUND, '租户不存在', 404);
    }
    const memberCount = await tenantRepository.countMembers(targetTenantId);
    if (memberCount + parseResult.data.students.length > tenant.maxSeats) {
      return error(res, ErrorCode.TENANT_SEATS_FULL, '租户席位不足,无法批量导入', 403);
    }

    const role = parseResult.data.role ?? 'student';
    let imported = 0;
    const failed: { name: string; reason: string }[] = [];
    const invitationCodes: { name: string; code: string }[] = [];

    for (const student of parseResult.data.students) {
      try {
        if (student.phone) {
          // 有手机号:直接建用户(authType=phone)+ 加入租户
          const existing = await userRepository.findByPhone(student.phone);
          if (existing) {
            failed.push({ name: student.name, reason: '手机号已存在' });
            continue;
          }
          const user = await userRepository.create({
            tenant: { connect: { id: targetTenantId } },
            authType: 'phone',
            feishuOpenId: null,
            feishuUnionId: null,
            phone: student.phone,
            phoneVerified: true,
            email: student.email ?? null,
            name: student.name,
            avatar: '',
            role,
            lastLoginAt: new Date(),
          });
          await tenantRepository.createMembership({
            userId: user.id,
            tenantId: targetTenantId,
            role,
          });
          imported += 1;
        } else {
          // 无手机号:生成邀请码,返回给学生自行注册
          const code = generateInvitationCode();
          const expiresAt = new Date(Date.now() + 168 * 3600 * 1000); // 7 天有效
          await invitationRepository.create({
            code,
            tenantId: targetTenantId,
            role,
            maxUses: 1,
            expiresAt,
            createdBy: req.userId,
          });
          invitationCodes.push({ name: student.name, code });
          imported += 1;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        failed.push({ name: student.name, reason: msg });
      }
    }

    await writeAudit({
      req,
      action: 'batch',
      resource: 'student',
      resourceId: null,
      targetTenantId,
      beforeData: { total: parseResult.data.students.length, role },
      afterData: { imported, failed: failed.length, invitationCodes: invitationCodes.length },
      note: `批量导入学生 ${parseResult.data.students.length} 人,成功 ${imported} 失败 ${failed.length}`,
    });

    logger.info(
      { tenantId: targetTenantId, userId: req.userId, imported, failed: failed.length },
      '[admin-phase5] batch import students',
    );

    return success(res, { imported, failed, invitationCodes }, '批量导入完成');
  } catch (err) {
    return next(err);
  }
};

/** GET /admin/presets */
export const listAdminPresets: RequestHandler = async (_req, res, next) => {
  try {
    const presets = await presetService.listAllPresets();
    return success(res, presets, 'success');
  } catch (err) {
    return next(err);
  }
};

/** POST /admin/presets/:id/override */
export const overridePreset: RequestHandler = async (req, res, next) => {
  try {
    if (!req.userId || !req.tenantId) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }
    const params = idParamSchema.safeParse(req.params);
    if (!params.success) {
      return error(res, ErrorCode.PARAM_INVALID, params.error.issues[0]?.message ?? '参数错误', 400);
    }
    const sourcePresetId = params.data.id;
    const parseResult = overridePresetSchema.safeParse(req.body);
    if (!parseResult.success) {
      return error(res, ErrorCode.PARAM_INVALID, parseResult.error.issues[0]?.message ?? '参数错误', 400);
    }
    const preset = await presetService.overridePreset(req.tenantId, req.userId, sourcePresetId, {
      name: parseResult.data.name,
      description: parseResult.data.description,
      dimensions: parseResult.data.dimensions,
      isPrivate: parseResult.data.isPrivate,
    });

    await writeAudit({
      req,
      action: 'create',
      resource: 'preset',
      resourceId: preset.id,
      targetTenantId: req.tenantId,
      beforeData: { forkedFromId: sourcePresetId },
      afterData: { presetId: preset.id, name: preset.name },
      note: `从内置预设 ${sourcePresetId} 派生覆盖预设`,
    });

    return success(res, preset, '覆盖预设已创建');
  } catch (err) {
    return next(err);
  }
};
