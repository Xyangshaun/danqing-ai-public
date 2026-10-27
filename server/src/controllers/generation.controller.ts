// ============================================================
// AI 图像生成 Controller(M2-T5)
// 对应 API(冻结契约 api-contract.ts §3.17):
//   POST /generation    (创建生成任务,返回 201 + CreateGenerationResponse)
//   GET  /generation/:id(查询生成任务,返回 GetGenerationResponse)
//
// 对应文档:.trae/documents/m2-generation-plan-2026-08-07.md §4
//
// 职责(与 analysis.controller 同源风格):
//   - controller 不写业务逻辑,仅做参数透传 + 响应序列化
//   - 所有外部输入经 Zod 校验(结构校验失败 → PARAM_INVALID 1001/400)
//   - 条件校验(text 需 prompt / sketch 需 sketchImageUrl)由
//     generation.service.validateInput 完成 → GENERATION_IMAGE_INVALID(6105)
//   - 多租户强制:tenantId/userId/role 由 auth 中间件注入,禁止从请求体读取
//   - 错误统一经 BusinessError/next(err) → errorHandler 处理,不暴露堆栈
//
// M-4 风格迁移扩展(真源 .trae/documents/m4-style-transfer-plan-2026-09-22.md §4.4):
//   - inputType 枚举追加 'style'
//   - 新增 styleImageUrlSchema(http URL / dataURL 双格式 + 6M 字符上限)
//   - 条件 refine:style 需 styleImageUrl + prompt(与 text/sketch 双保险一致)
//   - style 专属输入校验失败 → GENERATION_IMAGE_INVALID(6105,真源 §4.5)
// ============================================================

import type { RequestHandler } from 'express';
import { z } from 'zod';
import { generationService } from '../services/generation.service.js';
import { success, created, error } from '../utils/response.js';
import { ErrorCode } from '../types/api-contract.js';
import { logger } from '../utils/logger.js';
import { env } from '../config/env.js';

/** artType 校验(四类艺术形式,预检 → 友好错误信息) */
const artTypeSchema = z.enum(
  ['painting', 'design', 'product', 'sculpture'],
  { message: 'artType 必须为 painting/design/product/sculpture 之一' },
);

/** inputType 校验(text / sketch / style,M-4 风格迁移扩展) */
const inputTypeSchema = z.enum(
  ['text', 'sketch', 'style'],
  { message: 'inputType 必须为 text/sketch/style 之一' },
);

/**
 * styleImageUrl 校验(M-4,真源 §4.4):双格式(http URL 或 dataURL)
 * - http(s) URL:分析报告页"以此风格生成练习"带入的已上传图
 * - dataURL:生成页本地上传经 canvas 压缩(最长边≤1280)的产物(png/jpeg/webp)
 * - 6M 字符上限:约 4.4MB 二进制,仅作 413 前置护栏
 *   (与 generation.service validateInput 的 STYLE_IMAGE_URL_PATTERN 口径一致)
 */
const styleImageUrlSchema = z
  .string()
  .trim()
  .min(1, 'styleImageUrl 不能为空')
  .max(6_000_000, '风格参考图数据过大,请压缩后重试')
  .refine(
    (v) => /^https?:\/\//.test(v) || /^data:image\/(png|jpe?g|webp);base64,/.test(v),
    { message: 'styleImageUrl 必须为合法的图片 URL 或 dataURL' },
  );

/**
 * POST /generation 请求体 schema
 * 对应冻结契约 CreateGenerationRequest(M-4 解冻扩展:styleImageUrl?)
 *   - inputType 必填
 *   - text 需 prompt / sketch 需 sketchImageUrl(条件校验在 service 层,6105)
 *   - style 需 styleImageUrl(双格式 + 6M 上限)+ prompt 新画面内容描述
 *     (M-4,条件校验与 service 层 validateInput 双保险,均 6105)
 *   - count 上限受 env().generationMaxCount 约束(默认 4,对应契约 count 上限)
 */
const createGenerationBodySchema = z
  .object({
    inputType: inputTypeSchema,
    prompt: z
      .string()
      .trim()
      .min(1, 'prompt 不能为空')
      .max(2000, 'prompt 长度不能超过 2000')
      .optional(),
    sketchImageUrl: z
      .string()
      .trim()
      .url('sketchImageUrl 必须为合法 URL')
      .max(2048, 'sketchImageUrl 长度不能超过 2048')
      .optional(),
    styleImageUrl: styleImageUrlSchema.optional(),
    artType: artTypeSchema.optional(),
    aspect: z
      .enum(['portrait', 'landscape', 'square'], { message: 'aspect 必须为 portrait/landscape/square 之一' })
      .optional(),
    count: z
      .coerce
      .number()
      .int('count 必须为整数')
      .min(1, 'count 至少为 1')
      .max(env().generationMaxCount, `count 不能超过 ${env().generationMaxCount}`)
      .optional(),
    /** 同步模式:为 true 时直接同步生成并返回最终结果,不走异步队列(前端快速体验用) */
    sync: z.boolean().optional(),
  })
  .refine(
    (data) => data.inputType === 'text' ? !!data.prompt?.trim() : true,
    { message: '文字模式必须提供 prompt 提示词', path: ['prompt'] },
  )
  .refine(
    (data) => data.inputType === 'sketch' ? !!data.sketchImageUrl?.trim() : true,
    { message: '草图模式必须提供 sketchImageUrl 草稿图地址', path: ['sketchImageUrl'] },
  )
  // M-4 style 条件 refine(对齐 text/sketch 双保险模式,真源 §4.4):
  // style 必填 styleImageUrl(风格参考图)+ prompt(新画面内容描述)
  .refine(
    (data) => data.inputType === 'style' ? !!data.styleImageUrl?.trim() : true,
    { message: '风格迁移模式必须提供 styleImageUrl 风格参考图', path: ['styleImageUrl'] },
  )
  .refine(
    (data) => data.inputType === 'style' ? !!data.prompt?.trim() : true,
    { message: '风格迁移模式必须提供 prompt 新画面内容描述', path: ['prompt'] },
  );

/** GET /generation/:id 路径参数 schema */
const generationIdParamSchema = z.object({
  id: z.string().min(1, '缺少必填参数:id'),
});

/**
 * POST /generation
 * 创建 AI 图像生成任务(异步,返回 201 + pending 状态,前端轮询 GET)
 *
 * 3 秒 SLA:生成走异步队列,不阻塞诊断主链路;本接口同步返回任务创建结果
 * (pending 或降级同步模式下的最终状态,由 service 决策)
 */
export const createGeneration: RequestHandler = async (req, res, next) => {
  try {
    if (!req.userId || !req.tenantId || !req.role) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }

    const parsed = createGenerationBodySchema.safeParse(req.body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const msg = `参数错误:${first?.path.join('.') ?? 'unknown'} ${first?.message ?? 'invalid'}`;
      // M-4 错误码映射(真源 §4.5):style 专属输入校验失败
      // (styleImageUrl 缺失/格式非法/超限,或 style 模式 prompt 缺失)→
      // GENERATION_IMAGE_INVALID(6105),与 service 层 validateInput 口径一致;
      // 其余字段(inputType/artType/aspect/count 及既有 text/sketch 条件)维持
      // PARAM_INVALID(1001),既有对外行为零变化
      const firstPath = first?.path[0];
      const isStyleInputIssue =
        firstPath === 'styleImageUrl' ||
        (firstPath === 'prompt' &&
          (req.body as { inputType?: unknown } | undefined)?.inputType === 'style');
      if (isStyleInputIssue) {
        return error(res, ErrorCode.GENERATION_IMAGE_INVALID, msg, 400);
      }
      return error(res, ErrorCode.PARAM_INVALID, msg, 400);
    }

    const result = await generationService.createGeneration({
      tenantId: req.tenantId,
      userId: req.userId,
      body: parsed.data,
      traceId: req.traceId,
    });

    logger.debug(
      {
        taskId: result.taskId,
        status: result.status,
        tenantId: req.tenantId,
      },
      '[generation.controller] createGeneration response',
    );

    return created(res, result, '生成任务已创建');
  } catch (err) {
    return next(err);
  }
};

/**
 * GET /generation/:id
 * 查询生成任务详情
 * 数据范围过滤由 service 层基于 role 实现:
 *   - 跨租户 → 404(不泄露存在性)
 *   - student 查询他人记录 → 404(强制 ownership)
 *   - teacher/admin/owner 可查租户内任意
 */
export const getGeneration: RequestHandler = async (req, res, next) => {
  try {
    if (!req.tenantId || !req.userId || !req.role) {
      return error(res, ErrorCode.UNAUTHORIZED, '未授权,请先登录', 401);
    }

    const parsed = generationIdParamSchema.safeParse(req.params);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const msg = `参数错误:${first?.path.join('.') ?? 'unknown'} ${first?.message ?? 'invalid'}`;
      return error(res, ErrorCode.PARAM_INVALID, msg, 400);
    }

    const result = await generationService.getGeneration({
      tenantId: req.tenantId,
      generationId: parsed.data.id,
      userId: req.userId,
      role: req.role,
    });

    return success(res, result, 'success');
  } catch (err) {
    return next(err);
  }
};
