// ============================================================
// AI 分析 Controller
// 对应 API:
//   POST /analyses          (JSON: artType + imageUrl)
//   POST /analyses/upload   (multipart/form-data: image 文件 + artType)
//   GET  /analyses          (分页查询历史)
//   GET  /analyses/:id      (查询单条详情)
//
// 输入校验:Zod schema,所有外部输入经校验后进入 service
// 响应格式:{code, message, data, traceId}
// ============================================================

import type { RequestHandler } from 'express';
import { z } from 'zod';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { analysisService } from '../services/analysis.service.js';
import { success, error } from '../utils/response.js';
import { ErrorCode, type ArtType, type AnalysisStatus, type HeritageCategory } from '../types/api-contract.js';
import type { EvaluationStage } from '../types/ai-analysis.js';
import { logger } from '../utils/logger.js';
import { assertSafeImageUrl } from '../middlewares/url-guard.js';
import { checkSlidingWindowRateLimit } from '../middlewares/rate-limit.js';
import { env } from '../config/env.js';

/** 合法作品类型(五类:绘画/设计/产品设计/雕塑/非遗) */
const VALID_ART_TYPES: readonly ArtType[] = [
  'painting',
  'design',
  'product',
  'sculpture',
  'heritage',
];

/** artType 校验(预检 → 友好错误信息) */
const artTypeSchema = z.enum(
  ['painting', 'design', 'product', 'sculpture', 'heritage'],
  { message: 'artType 必须为 painting/design/product/sculpture/heritage 之一' },
);

/** 诊断模式校验(2026-08-16 诊断理念重构;缺省 teaching) */
const diagnosisModeSchema = z.enum(['teaching', 'exam'], {
  message: 'diagnosisMode 必须为 teaching/exam 之一',
});

/** 艺考科目校验(仅 diagnosisMode='exam' 时有效) */
const examSubjectSchema = z.enum(['sketch', 'color', 'quickSketch'], {
  message: 'examSubject 必须为 sketch/color/quickSketch 之一',
});

/**
 * 评价阶段校验(阶段 C Task 9.1)
 * teaching:enthusiast(爱好者)/intermediate(进阶)/advanced(资深)
 * exam:unified(联考级)/academy(美院级)/master(大师级)
 */
const evaluationStageSchema = z.enum(
  ['enthusiast', 'intermediate', 'advanced', 'unified', 'academy', 'master'],
  { message: 'evaluationStage 必须为 enthusiast/intermediate/advanced/unified/academy/master 之一' },
);

/**
 * 非遗类目校验(阶段 C Task 9.1)
 * 仅 artType='heritage' 时有效(Task 9.2 refine 强制校验)
 */
/* 2026-08-18 决赛强化:非遗类目 3→10 类(对齐 HeritageCategory 类型/素材库 V3.1/前端选择器) */
const heritageCategorySchema = z.enum(
  ['papercut', 'embroidery', 'porcelain', 'nianhua', 'shadowpuppet', 'weaving', 'woodcarving', 'clay', 'lacquer', 'thangka'],
  { message: 'heritageCategory 必须为 papercut/embroidery/porcelain/nianhua/shadowpuppet/weaving/woodcarving/clay/lacquer/thangka 之一' },
);

/**
 * heritageCategory 互斥校验(阶段 C Task 9.2)
 * - artType !== 'heritage' 时,heritageCategory 必须缺省(传值 → 400 拒绝)
 * - artType === 'heritage' 时,heritageCategory 可选(缺省按通用维度评估,传值按类目工艺维度评估)
 */
function validateHeritageCategory(
  data: { artType: ArtType; heritageCategory?: HeritageCategory },
  ctx: z.RefinementCtx,
): void {
  if (data.heritageCategory && data.artType !== 'heritage') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `heritageCategory 仅在 artType='heritage' 时有效(当前 artType='${data.artType}')`,
      path: ['heritageCategory'],
    });
  }
}

/** POST /analyses 请求体 schema */
const createAnalysisBodySchema = z.object({
  artType: artTypeSchema,
  imageUrl: z
    .string()
    .trim()
    .url('imageUrl 必须为合法 URL')
    .max(2048, 'imageUrl 长度不能超过 2048')
    .optional(),
  title: z.string().trim().max(64).optional(),
  remark: z.string().trim().max(500).optional(),
  diagnosisMode: diagnosisModeSchema.optional(),
  examSubject: examSubjectSchema.optional(),
  // ---- 深度分析增强字段(阶段 C Task 9.1) ----
  evaluationStage: evaluationStageSchema.optional(),
  heritageCategory: heritageCategorySchema.optional(),
})
  .refine(
    (data) => !!data.imageUrl,
    { message: '缺少必填参数:imageUrl(或改用 POST /analyses/upload 上传文件)', path: ['imageUrl'] },
  )
  .superRefine(validateHeritageCategory);

/** POST /analyses/upload 表单字段 schema(multipart/form-data) */
const uploadFormSchema = z.object({
  artType: artTypeSchema,
  title: z.string().trim().max(64).optional(),
  remark: z.string().trim().max(500).optional(),
  diagnosisMode: diagnosisModeSchema.optional(),
  examSubject: examSubjectSchema.optional(),
  // ---- 深度分析增强字段(阶段 C Task 9.1) ----
  evaluationStage: evaluationStageSchema.optional(),
  heritageCategory: heritageCategorySchema.optional(),
}).superRefine(validateHeritageCategory);

/** GET /analyses 查询参数 schema */
const listAnalysesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  artType: z.enum(['painting', 'design', 'product', 'sculpture', 'heritage']).optional(),
  status: z.enum(['pending', 'processing', 'success', 'failed']).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  userId: z.string().min(1).optional(),
});

/** GET /analyses/:id 路径参数 schema */
const analysisIdParamSchema = z.object({
  id: z.string().min(1, '缺少必填参数:id'),
});

/**
 * POST /analyses
 * 提交分析任务(URL 模式,同步返回完整结果)
 */
export const createAnalysis: RequestHandler = async (req, res, next) => {
  try {
    if (!req.userId || !req.tenantId || !req.role) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }

    const parsed = createAnalysisBodySchema.safeParse(req.body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const msg = `参数错误:${first?.path.join('.') ?? 'unknown'} ${first?.message ?? 'invalid'}`;
      return error(res, ErrorCode.PARAM_INVALID, msg, 400);
    }

    // SSRF 防护:校验 imageUrl 主机不指向内网/元数据
    // refine 已保证 imageUrl 存在,此处显式收窄类型供 TS 严格模式使用
    const imageUrl = parsed.data.imageUrl;
    if (!imageUrl) {
      return error(res, ErrorCode.PARAM_INVALID, '缺少必填参数:imageUrl', 400);
    }
    assertSafeImageUrl(imageUrl);

    const result = await analysisService.createAnalysis({
      tenantId: req.tenantId,
      userId: req.userId,
      body: parsed.data,
    });

    // Phase 2:AI 增强字段已嵌入 result.result(HybridAnalysisResult)
    // 前端可通过 result.result?.aiEnhanced 判断是否经过 AI 增强
    // 响应结构向后兼容:旧客户端忽略 aiEnhanced/aiVisionResult/aiMeta 字段
    logger.debug(
      {
        analysisId: result.id,
        status: result.status,
        durationMs: result.durationMs,
      },
      '[analysis.controller] createAnalysis response',
    );

    return success(res, result, '分析完成');
  } catch (err) {
    return next(err);
  }
};

/**
 * POST /analyses/upload
 * 提交分析任务(文件上传模式,multipart/form-data)
 * multer 中间件已在 routes 层注入,此处从 req.file.buffer 读取
 *
 * G4 安全修复:memoryStorage 下 file.path 不存在,需手动将 buffer 写盘
 * 再传 path 给 service(保持 service 接口不变)
 */
export const uploadAnalysis: RequestHandler = async (req, res, next) => {
  try {
    if (!req.userId || !req.tenantId || !req.role) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }

    // multer 单文件字段名:image(memoryStorage → file.buffer)
    const file = (req as unknown as { file?: Express.Multer.File & { buffer?: Buffer } }).file;
    if (!file || !file.buffer) {
      return error(res, ErrorCode.FILE_EMPTY, '缺少上传文件:image', 400);
    }

    // 表单字段校验(artType 必填,title/remark 可选)
    const parsed = uploadFormSchema.safeParse(req.body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const msg = `参数错误:${first?.path.join('.') ?? 'unknown'} ${first?.message ?? 'invalid'}`;
      return error(res, ErrorCode.PARAM_INVALID, msg, 400);
    }

    // memoryStorage → 写盘生成临时文件路径(routes 层已做魔数校验)
    const uploadDir = resolve(process.cwd(), env().uploadDir);
    const ext = extname(file.originalname).toLowerCase() || '.jpg';
    const uniqueName = `${Date.now()}-${randomUUID().slice(0, 8)}${ext}`;
    const localImagePath = join(uploadDir, uniqueName);
    try {
      // 确保上传目录存在(避免目录不存在导致 writeFileSync 失败)
      mkdirSync(uploadDir, { recursive: true });
      writeFileSync(localImagePath, file.buffer);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err: msg, dir: uploadDir }, '[analysis.controller] write uploaded file failed');
      return error(res, ErrorCode.FILE_UPLOAD_FAILED, '文件保存失败', 500);
    }

    const result = await analysisService.createAnalysisFromUpload({
      tenantId: req.tenantId,
      userId: req.userId,
      artType: parsed.data.artType,
      localImagePath,
      originalFileName: file.originalname,
      title: parsed.data.title,
      remark: parsed.data.remark,
      diagnosisMode: parsed.data.diagnosisMode,
      examSubject: parsed.data.examSubject,
      // 深度分析字段透传(阶段 C Task 9.1)
      evaluationStage: parsed.data.evaluationStage as EvaluationStage | undefined,
      heritageCategory: parsed.data.heritageCategory,
    });

    return success(res, result, '分析完成');
  } catch (err) {
    return next(err);
  }
};

/**
 * GET /analyses
 * 查询分析历史(分页)
 */
export const listAnalyses: RequestHandler = async (req, res, next) => {
  try {
    if (!req.userId || !req.tenantId || !req.role) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }

    const parsed = listAnalysesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const msg = `参数错误:${first?.path.join('.') ?? 'unknown'} ${first?.message ?? 'invalid'}`;
      return error(res, ErrorCode.PARAM_INVALID, msg, 400);
    }

    const result = await analysisService.listAnalyses({
      tenantId: req.tenantId,
      userId: req.userId,
      role: req.role,
      query: {
        page: parsed.data.page,
        pageSize: parsed.data.pageSize,
        artType: parsed.data.artType as ArtType | undefined,
        status: parsed.data.status as AnalysisStatus | undefined,
        startDate: parsed.data.startDate,
        endDate: parsed.data.endDate,
        userId: parsed.data.userId,
      },
    });

    return success(res, result, 'success');
  } catch (err) {
    return next(err);
  }
};

/**
 * GET /analyses/:id
 * 查询单条分析详情
 * 数据范围过滤由 service 层基于 role 实现:
 *   - student 仅可查自己创建的(越权返回 404,不泄露存在性)
 *   - teacher / admin / owner 可查租户内任意记录
 */
export const getAnalysis: RequestHandler = async (req, res, next) => {
  try {
    if (!req.tenantId || !req.userId || !req.role) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }

    const parsed = analysisIdParamSchema.safeParse(req.params);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const msg = `参数错误:${first?.path.join('.') ?? 'unknown'} ${first?.message ?? 'invalid'}`;
      return error(res, ErrorCode.PARAM_INVALID, msg, 400);
    }

    const result = await analysisService.getAnalysis({
      tenantId: req.tenantId,
      analysisId: parsed.data.id,
      userId: req.userId,
      role: req.role,
    });

    return success(res, result, 'success');
  } catch (err) {
    return next(err);
  }
};

/**
 * GET /analyses/:id/report-data
 * 报告数据聚合(报告导出+分析报告增强特性)
 * 返回雷达图/历史对比/成长趋势/班级百分位(teacher+),供报告模板与结果页增强渲染。
 * 权限与数据范围同 getAnalysis(student 越权 → 404)
 */
export const getReportData: RequestHandler = async (req, res, next) => {
  try {
    if (!req.tenantId || !req.userId || !req.role) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }

    const parsed = analysisIdParamSchema.safeParse(req.params);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const msg = `参数错误:${first?.path.join('.') ?? 'unknown'} ${first?.message ?? 'invalid'}`;
      return error(res, ErrorCode.PARAM_INVALID, msg, 400);
    }

    const result = await analysisService.getReportData({
      tenantId: req.tenantId,
      analysisId: parsed.data.id,
      userId: req.userId,
      role: req.role,
    });

    return success(res, result, 'success');
  } catch (err) {
    return next(err);
  }
};

/**
 * POST /analyses/:id/ai-enhance
 * 阶段 2:AI 增强分析(方案 A)
 * 用户主动触发,对已存的本地分析结果追加 AI 语义增强。
 *
 * 权限:requireAnyPermission('analysis:read:own', 'analysis:read:tenant')(路由层)
 *   - student/teacher 仅可增强自己的记录
 *   - admin/owner 可增强租户内任意记录
 *
 * 幂等:已 aiEnhanced=true 的记录再次调用,直接返回当前结果(不重复调 AI、不重复计费)
 *
 * 响应:返回 AnalysisDetail(含 aiEnhanced=true、aiDurationMs、保留原 jimpDurationMs)
 */
export const aiEnhanceAnalysis: RequestHandler = async (req, res, next) => {
  try {
    if (!req.tenantId || !req.userId || !req.role) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }

    const parsed = analysisIdParamSchema.safeParse(req.params);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const msg = `参数错误:${first?.path.join('.') ?? 'unknown'} ${first?.message ?? 'invalid'}`;
      return error(res, ErrorCode.PARAM_INVALID, msg, 400);
    }

    const result = await analysisService.aiEnhanceAnalysis({
      tenantId: req.tenantId,
      analysisId: parsed.data.id,
      userId: req.userId,
      role: req.role,
    });

    logger.debug(
      {
        analysisId: result.id,
        aiEnhanced: result.aiEnhanced,
        aiDurationMs: result.aiDurationMs,
      },
      '[analysis.controller] aiEnhanceAnalysis response',
    );

    return success(res, result, 'AI 增强完成');
  } catch (err) {
    return next(err);
  }
};

/**
 * POST /analyses/:id/ask-question 请求体 schema(阶段 3 问题分析)
 * 问题长度 10-500 字:过短无法聚焦,过长稀释画面上下文
 */
const askQuestionBodySchema = z.object({
  question: z
    .string()
    .trim()
    .min(10, '问题至少 10 个字')
    .max(500, '问题不能超过 500 字'),
});

/**
 * POST /analyses/:id/ask-question
 * 阶段 3:问题分析(AI 深度分析完成后的用户追问)
 * 用户就诊断结果提问,AI 携带原图 + 诊断摘要围绕问题定向解答。
 *
 * 前置条件:记录 status=success 且已 aiEnhanced=true(未增强返回 409 引导先完成阶段 2)
 * 响应:AskQuestionResponse(answer/focusDimension/suggestions),即时返回不落库
 */
export const askQuestionAnalysis: RequestHandler = async (req, res, next) => {
  try {
    if (!req.tenantId || !req.userId || !req.role) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }

    const parsedParams = analysisIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      const first = parsedParams.error.issues[0];
      const msg = `参数错误:${first?.path.join('.') ?? 'unknown'} ${first?.message ?? 'invalid'}`;
      return error(res, ErrorCode.PARAM_INVALID, msg, 400);
    }

    const parsedBody = askQuestionBodySchema.safeParse(req.body);
    if (!parsedBody.success) {
      const first = parsedBody.error.issues[0];
      const msg = `参数错误:${first?.path.join('.') ?? 'unknown'} ${first?.message ?? 'invalid'}`;
      return error(res, ErrorCode.PARAM_INVALID, msg, 400);
    }

    // per-user 频控(ask-question 是计费 AI 调用,IP 级 api 限流粒度不足;
    // 复用 rate-limit.ts 滑动窗口脚本,key 维度为 userId;Redis 异常 fail open)
    try {
      const count = await checkSlidingWindowRateLimit(`rl:askq:${req.userId}`);
      if (count > env().rateLimitAskQuestionPerMin) {
        logger.warn(
          { userId: req.userId, count, max: env().rateLimitAskQuestionPerMin, traceId: req.traceId },
          '[analysis.controller] askQuestion rate limit hit',
        );
        res.setHeader('Retry-After', '60');
        return error(res, ErrorCode.RATE_LIMITED, '提问过于频繁,请稍后再试', 429);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err: msg, userId: req.userId }, '[analysis.controller] askQuestion rate check error, fail open');
    }

    const result = await analysisService.askQuestionAnalysis({
      tenantId: req.tenantId,
      analysisId: parsedParams.data.id,
      userId: req.userId,
      role: req.role,
      question: parsedBody.data.question,
    });

    logger.debug(
      {
        analysisId: result.analysisId,
        focusDimension: result.focusDimension,
        durationMs: result.durationMs,
      },
      '[analysis.controller] askQuestionAnalysis response',
    );

    return success(res, result, '问题分析完成');
  } catch (err) {
    return next(err);
  }
};

/**
 * DELETE /analyses/:id
 * 删除分析记录
 * 权限校验:requireAnyPermission('analysis:delete:own', 'analysis:delete:tenant')
 * 数据范围:
 *   - admin / owner 可删租户内任意记录
 *   - teacher / student 仅可删自己创建的(越权返回 404,不泄露存在性)
 */
export const deleteAnalysis: RequestHandler = async (req, res, next) => {
  try {
    if (!req.tenantId || !req.userId || !req.role) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }

    const parsed = analysisIdParamSchema.safeParse(req.params);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const msg = `参数错误:${first?.path.join('.') ?? 'unknown'} ${first?.message ?? 'invalid'}`;
      return error(res, ErrorCode.PARAM_INVALID, msg, 400);
    }

    const result = await analysisService.deleteAnalysis({
      tenantId: req.tenantId,
      analysisId: parsed.data.id,
      operatorUserId: req.userId,
      role: req.role,
    });

    return success(res, result, '已删除');
  } catch (err) {
    return next(err);
  }
};

/**
 * 批删请求体 schema
 * 契约:api-contract.ts BatchDeleteAnalysesRequest { ids: string[] }
 * 条数上限:≤100,超限返回 ANALYSIS_BATCH_LIMIT_EXCEEDED(6006)
 */
const batchDeleteBodySchema = z.object({
  ids: z
    .array(z.string().min(1, 'id 不能为空'))
    .min(1, 'ids 至少包含 1 个元素')
    .max(100, 'ids 最多包含 100 个元素'),
});

/**
 * POST /analyses/batch-delete
 * 批量删除分析记录(跨端批删一致性,P-06)
 * 契约:api-contract.ts BatchDeleteAnalysesRequest/Response
 *
 * 设计要点:
 *   - 条数上限 ≤100(超限返回 ANALYSIS_BATCH_LIMIT_EXCEEDED=6006)
 *   - 多租户强制:所有 ids 归属 req.tenantId,任一越权/不存在则该条记入 failed(不整体回滚)
 *   - 数据范围过滤(基于 RBAC canDeleteTenantWide):
 *       - admin/owner:可删租户内任意记录
 *       - teacher/student:仅可删自己创建的记录(越权记 failed)
 *   - 鉴权:analysis:delete:own 或 analysis:delete:tenant(路由层)
 */
export const batchDeleteAnalyses: RequestHandler = async (req, res, next) => {
  try {
    if (!req.userId || !req.tenantId || !req.role) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }

    const parsed = batchDeleteBodySchema.safeParse(req.body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const msg = `参数错误:${first?.path.join('.') ?? 'unknown'} ${first?.message ?? 'invalid'}`;
      return error(
        res,
        ErrorCode.ANALYSIS_BATCH_LIMIT_EXCEEDED,
        msg,
        400,
      );
    }

    const result = await analysisService.batchDeleteAnalyses({
      tenantId: req.tenantId,
      userId: req.userId,
      role: req.role,
      ids: parsed.data.ids,
    });

    return success(res, result, '批量删除完成');
  } catch (err) {
    return next(err);
  }
};

/**
 * 导出 VALID_ART_TYPES(供 routes 层校验使用)
 */
export { VALID_ART_TYPES };
