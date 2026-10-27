// ============================================================
// 评分风格档案 Controller(双阶段反馈框架 Phase 2 批次②)
// 对应 API:
//   GET    /grading-profiles               (列出可见档案)
//   GET    /grading-profiles/:id           (档案详情)
//   POST   /grading-profiles               (创建租户档案,teacher/admin/owner)
//   POST   /grading-profiles/:id/fork      (fork 派生档案,teacher/admin/owner)
//   PATCH  /grading-profiles/:id           (更新档案,仅本人,非内置)
//   DELETE /grading-profiles/:id           (删除档案,仅本人,非内置)
//   POST   /grading-profiles/:id/activate  (设为租户默认,同租户非内置)
//
// 所有输入经 Zod 校验;tenantId/userId 从 JWT 注入
// ============================================================

import type { RequestHandler } from 'express';
import { z } from 'zod';
import { gradingProfileService } from '../services/grading-profile.service.js';
import { gradingInsightsService } from '../services/grading-insights.service.js';
import { success, error } from '../utils/response.js';
import { ErrorCode } from '../types/api-contract.js';
import {
  gradingProfileConfigSchema,
  suggestionAdoptionSchema,
  GRADING_PROFILE_CATEGORIES,
} from '../types/grading-profile.js';

// ============================================================
// Zod Schemas
// ============================================================

const createProfileSchema = z.object({
  name: z.string().min(1).max(64),
  description: z.string().max(500).optional(),
  category: z.enum(GRADING_PROFILE_CATEGORIES),
  config: gradingProfileConfigSchema,
});

const forkProfileSchema = z.object({
  name: z.string().min(1).max(64),
  description: z.string().max(500).optional(),
});

const updateProfileSchema = z.object({
  name: z.string().min(1).max(64).optional(),
  description: z.string().max(500).optional(),
  config: gradingProfileConfigSchema.optional(),
  enabled: z.boolean().optional(),
});

/** 路径参数 :id 校验 schema(防止 req.params.id 为 undefined) */
const idParamSchema = z.object({
  id: z.string().min(1, '缺少必填参数:id'),
});

// ============================================================
// Handlers
// ============================================================

/** GET /grading-profiles */
export const listGradingProfiles: RequestHandler = async (req, res, next) => {
  try {
    if (!req.userId || !req.tenantId) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }
    const profiles = await gradingProfileService.listProfiles(req.tenantId);
    return success(res, profiles, 'success');
  } catch (err) {
    return next(err);
  }
};

/** GET /grading-profiles/:id */
export const getGradingProfile: RequestHandler = async (req, res, next) => {
  try {
    if (!req.userId || !req.tenantId) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }
    const params = idParamSchema.safeParse(req.params);
    if (!params.success) {
      return error(res, ErrorCode.PARAM_INVALID, params.error.issues[0]?.message ?? '参数错误', 400);
    }
    const profile = await gradingProfileService.getProfile(params.data.id);
    return success(res, profile, 'success');
  } catch (err) {
    return next(err);
  }
};

/** POST /grading-profiles */
export const createGradingProfile: RequestHandler = async (req, res, next) => {
  try {
    if (!req.userId || !req.tenantId) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }
    const parseResult = createProfileSchema.safeParse(req.body);
    if (!parseResult.success) {
      return error(res, ErrorCode.PARAM_INVALID, parseResult.error.issues[0]?.message ?? '参数错误', 400);
    }
    const profile = await gradingProfileService.createProfile(
      req.tenantId,
      req.userId,
      parseResult.data,
    );
    return success(res, profile, '档案已创建');
  } catch (err) {
    return next(err);
  }
};

/** POST /grading-profiles/:id/fork */
export const forkGradingProfile: RequestHandler = async (req, res, next) => {
  try {
    if (!req.userId || !req.tenantId) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }
    const params = idParamSchema.safeParse(req.params);
    if (!params.success) {
      return error(res, ErrorCode.PARAM_INVALID, params.error.issues[0]?.message ?? '参数错误', 400);
    }
    const parseResult = forkProfileSchema.safeParse(req.body);
    if (!parseResult.success) {
      return error(res, ErrorCode.PARAM_INVALID, parseResult.error.issues[0]?.message ?? '参数错误', 400);
    }
    const profile = await gradingProfileService.forkProfile(
      req.tenantId,
      req.userId,
      params.data.id,
      parseResult.data,
    );
    return success(res, profile, '档案已克隆,可在其基础上微调');
  } catch (err) {
    return next(err);
  }
};

/** PATCH /grading-profiles/:id */
export const updateGradingProfile: RequestHandler = async (req, res, next) => {
  try {
    if (!req.userId || !req.tenantId) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }
    const params = idParamSchema.safeParse(req.params);
    if (!params.success) {
      return error(res, ErrorCode.PARAM_INVALID, params.error.issues[0]?.message ?? '参数错误', 400);
    }
    const parseResult = updateProfileSchema.safeParse(req.body);
    if (!parseResult.success) {
      return error(res, ErrorCode.PARAM_INVALID, parseResult.error.issues[0]?.message ?? '参数错误', 400);
    }
    const profile = await gradingProfileService.updateProfile(
      req.tenantId,
      req.userId,
      params.data.id,
      parseResult.data,
    );
    return success(res, profile, '档案已更新');
  } catch (err) {
    return next(err);
  }
};

/** DELETE /grading-profiles/:id */
export const deleteGradingProfile: RequestHandler = async (req, res, next) => {
  try {
    if (!req.userId || !req.tenantId) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }
    const params = idParamSchema.safeParse(req.params);
    if (!params.success) {
      return error(res, ErrorCode.PARAM_INVALID, params.error.issues[0]?.message ?? '参数错误', 400);
    }
    await gradingProfileService.deleteProfile(req.tenantId, req.userId, params.data.id);
    return success(res, { deleted: true, id: params.data.id }, '档案已删除');
  } catch (err) {
    return next(err);
  }
};

/** POST /grading-profiles/:id/activate */
export const activateGradingProfile: RequestHandler = async (req, res, next) => {
  try {
    if (!req.userId || !req.tenantId) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }
    const params = idParamSchema.safeParse(req.params);
    if (!params.success) {
      return error(res, ErrorCode.PARAM_INVALID, params.error.issues[0]?.message ?? '参数错误', 400);
    }
    const profile = await gradingProfileService.activateProfile(
      req.tenantId,
      req.userId,
      params.data.id,
    );
    return success(res, profile, '已设为租户默认档案');
  } catch (err) {
    return next(err);
  }
};

// ============================================================
// Phase 5 批次③:教学行为画像 + 档案建议 + 采纳链路
// ============================================================

/** GET /grading-profiles/insights/teacher - 本人画像(只读) */
export const getTeacherInsights: RequestHandler = async (req, res, next) => {
  try {
    if (!req.userId || !req.tenantId) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }
    const insights = await gradingInsightsService.getTeacherInsights(req.tenantId, req.userId);
    return success(res, insights, 'success');
  } catch (err) {
    return next(err);
  }
};

/** GET /grading-profiles/insights/adoptions - 本人采纳历史(Phase 5 批次④) */
export const getMySuggestionAdoptions: RequestHandler = async (req, res, next) => {
  try {
    if (!req.userId || !req.tenantId) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }
    const result = await gradingInsightsService.getMyAdoptions(req.tenantId, req.userId);
    return success(res, result, 'success');
  } catch (err) {
    return next(err);
  }
};

/** GET /grading-profiles/:id/insights/suggestion - 档案级建议(租户聚合推导) */
export const getProfileSuggestions: RequestHandler = async (req, res, next) => {
  try {
    if (!req.userId || !req.tenantId) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }
    const params = idParamSchema.safeParse(req.params);
    if (!params.success) {
      return error(res, ErrorCode.PARAM_INVALID, params.error.issues[0]?.message ?? '参数错误', 400);
    }
    const result = await gradingInsightsService.getProfileSuggestions(
      req.tenantId,
      params.data.id,
    );
    return success(res, result, 'success');
  } catch (err) {
    return next(err);
  }
};

/** POST /grading-profiles/:id/suggestion-adoptions - 采纳记录(审计落库) */
export const recordSuggestionAdoption: RequestHandler = async (req, res, next) => {
  try {
    if (!req.userId || !req.tenantId) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }
    const params = idParamSchema.safeParse(req.params);
    if (!params.success) {
      return error(res, ErrorCode.PARAM_INVALID, params.error.issues[0]?.message ?? '参数错误', 400);
    }
    const body = suggestionAdoptionSchema.safeParse(req.body);
    if (!body.success) {
      return error(res, ErrorCode.PARAM_INVALID, body.error.issues[0]?.message ?? '参数错误', 400);
    }
    const { record, duplicated } = await gradingInsightsService.recordAdoption(
      req.tenantId,
      req.userId,
      params.data.id,
      body.data,
    );
    return success(res, record, duplicated ? '该建议已采纳过,幂等返回' : '建议采纳已记录');
  } catch (err) {
    return next(err);
  }
};
