// ============================================================
// 评分预设 Controller(Phase 5)
// 对应 API:
//   GET    /presets            (列出可见预设)
//   GET    /presets/:id        (预设详情)
//   POST   /presets            (创建用户预设,teacher/admin)
//   POST   /presets/:id/fork   (fork 派生预设,teacher/admin)
//   PATCH  /presets/:id        (更新预设,仅本人,非 built-in)
//   DELETE /presets/:id        (删除预设,仅本人,非 built-in)
//   POST   /presets/apply      (应用预设重算加权分)
//
// 所有输入经 Zod 校验;tenantId/userId 从 JWT 注入
// ============================================================

import type { RequestHandler } from 'express';
import { z } from 'zod';
import { presetService } from '../services/preset.service.js';
import { success, error } from '../utils/response.js';
import { ErrorCode } from '../types/api-contract.js';
import type { PresetStyle, PresetStage } from '../types/arbitration.js';

// ============================================================
// Zod Schemas
// ============================================================

const presetDimensionSchema = z.object({
  key: z.string().min(1).max(64),
  label: z.string().min(1).max(64),
  labelEn: z.string().min(1).max(64),
  weight: z.number().min(0).max(100),
});

const styleTypeSchema = z.enum(['academic', 'artist', 'academy', 'applied', 'custom']) as z.ZodType<PresetStyle>;
const stageSchema = z.enum(['basic', 'foundation', 'advanced', 'creative']) as z.ZodType<PresetStage>;
const artTypeSchema = z.enum(['painting', 'design', 'product', 'sculpture']);

const createPresetSchema = z.object({
  name: z.string().min(1).max(64),
  description: z.string().max(500).optional(),
  styleType: styleTypeSchema,
  artType: artTypeSchema,
  dimensions: z.array(presetDimensionSchema).min(1),
  applicableStage: stageSchema,
  isPrivate: z.boolean().optional(),
});

const forkPresetSchema = z.object({
  name: z.string().min(1).max(64),
  description: z.string().max(500).optional(),
  dimensions: z.array(presetDimensionSchema).min(1).optional(),
  isPrivate: z.boolean().optional(),
});

const updatePresetSchema = z.object({
  name: z.string().min(1).max(64).optional(),
  description: z.string().max(500).optional(),
  dimensions: z.array(presetDimensionSchema).min(1).optional(),
  applicableStage: stageSchema.optional(),
  isPrivate: z.boolean().optional(),
  enabled: z.boolean().optional(),
});

const applyPresetSchema = z.object({
  analysisId: z.string().min(1),
  presetId: z.string().min(1),
});

/** 路径参数 :id 校验 schema(防止 req.params.id 为 undefined) */
const idParamSchema = z.object({
  id: z.string().min(1, '缺少必填参数:id'),
});

// ============================================================
// Handlers
// ============================================================

/** GET /presets */
export const listPresets: RequestHandler = async (req, res, next) => {
  try {
    if (!req.userId || !req.tenantId) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }
    const presets = await presetService.listPresets(req.tenantId, req.userId);
    return success(res, presets, 'success');
  } catch (err) {
    return next(err);
  }
};

/** GET /presets/:id */
export const getPreset: RequestHandler = async (req, res, next) => {
  try {
    if (!req.userId || !req.tenantId) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }
    const params = idParamSchema.safeParse(req.params);
    if (!params.success) {
      return error(res, ErrorCode.PARAM_INVALID, params.error.issues[0]?.message ?? '参数错误', 400);
    }
    const preset = await presetService.getPreset(params.data.id);
    return success(res, preset, 'success');
  } catch (err) {
    return next(err);
  }
};

/** POST /presets */
export const createPreset: RequestHandler = async (req, res, next) => {
  try {
    if (!req.userId || !req.tenantId) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }
    const parseResult = createPresetSchema.safeParse(req.body);
    if (!parseResult.success) {
      return error(res, ErrorCode.PARAM_INVALID, parseResult.error.issues[0]?.message ?? '参数错误', 400);
    }
    const preset = await presetService.createPreset(req.tenantId, req.userId, parseResult.data);
    return success(res, preset, '预设已创建');
  } catch (err) {
    return next(err);
  }
};

/** POST /presets/:id/fork */
export const forkPreset: RequestHandler = async (req, res, next) => {
  try {
    if (!req.userId || !req.tenantId) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }
    const params = idParamSchema.safeParse(req.params);
    if (!params.success) {
      return error(res, ErrorCode.PARAM_INVALID, params.error.issues[0]?.message ?? '参数错误', 400);
    }
    const parseResult = forkPresetSchema.safeParse(req.body);
    if (!parseResult.success) {
      return error(res, ErrorCode.PARAM_INVALID, parseResult.error.issues[0]?.message ?? '参数错误', 400);
    }
    const preset = await presetService.forkPreset(req.tenantId, req.userId, params.data.id, parseResult.data);
    return success(res, preset, '预设已派生');
  } catch (err) {
    return next(err);
  }
};

/** PATCH /presets/:id */
export const updatePreset: RequestHandler = async (req, res, next) => {
  try {
    if (!req.userId || !req.tenantId) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }
    const params = idParamSchema.safeParse(req.params);
    if (!params.success) {
      return error(res, ErrorCode.PARAM_INVALID, params.error.issues[0]?.message ?? '参数错误', 400);
    }
    const parseResult = updatePresetSchema.safeParse(req.body);
    if (!parseResult.success) {
      return error(res, ErrorCode.PARAM_INVALID, parseResult.error.issues[0]?.message ?? '参数错误', 400);
    }
    const preset = await presetService.updatePreset(req.tenantId, req.userId, params.data.id, parseResult.data);
    return success(res, preset, '预设已更新');
  } catch (err) {
    return next(err);
  }
};

/** DELETE /presets/:id */
export const deletePreset: RequestHandler = async (req, res, next) => {
  try {
    if (!req.userId || !req.tenantId) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }
    const params = idParamSchema.safeParse(req.params);
    if (!params.success) {
      return error(res, ErrorCode.PARAM_INVALID, params.error.issues[0]?.message ?? '参数错误', 400);
    }
    await presetService.deletePreset(req.tenantId, req.userId, params.data.id);
    return success(res, { deleted: true, id: params.data.id }, '预设已删除');
  } catch (err) {
    return next(err);
  }
};

/** POST /presets/apply */
export const applyPreset: RequestHandler = async (req, res, next) => {
  try {
    if (!req.userId || !req.tenantId) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }
    const parseResult = applyPresetSchema.safeParse(req.body);
    if (!parseResult.success) {
      return error(res, ErrorCode.PARAM_INVALID, parseResult.error.issues[0]?.message ?? '参数错误', 400);
    }
    const result = await presetService.applyPreset(req.tenantId, parseResult.data);
    return success(res, result, 'success');
  } catch (err) {
    return next(err);
  }
};
