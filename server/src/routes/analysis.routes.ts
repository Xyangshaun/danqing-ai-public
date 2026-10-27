// ============================================================
// 分析路由
// 对应 API:
//   POST   /analyses          (JSON: artType + imageUrl)         (需鉴权 + analysis:create)
//   POST   /analyses/upload   (multipart/form-data: image)      (需鉴权 + analysis:create)
//   GET    /analyses          (分页查询历史)                     (需鉴权 + analysis:read:own|tenant)
//   GET    /analyses/:id      (查询单条详情)                     (需鉴权 + analysis:read:own|tenant)
//   DELETE /analyses/:id      (删除分析记录)                     (需鉴权 + analysis:delete:own|tenant)
//   POST   /analyses/:id/share   (分享作品到组织动态流)           (需鉴权 + share:create)
//   DELETE /analyses/:id/share   (取消分享,仅本人)                (需鉴权 + share:create)
//   POST   /analyses/:id/marker-feedback (标注反馈采集,数据飞轮)   (需鉴权 + analysis:read:own|tenant)
//
// 权限矩阵:
//   - 所有角色(student/teacher/admin/owner)拥有 analysis:create + analysis:read:own + analysis:delete:own
//   - teacher/admin/owner 额外拥有 analysis:read:tenant
//   - admin/owner 额外拥有 analysis:delete:tenant
//
// 数据范围过滤(service 层基于 role 实现):
//   - student:仅自己的记录(canReadTenantWide=false)
//   - teacher/admin/owner:租户内全量(canReadTenantWide=true)
//   - teacher/student 删除:仅自己的记录(canDeleteTenantWide=false)
//   - admin/owner 删除:租户内任意(canDeleteTenantWide=true)
//
// multer 配置(G4 安全修复):
//   - storage:memoryStorage(文件驻留内存,避免落盘后才校验)
//   - fileFilter:MIME 预检(早筛非图片,节省内存)
//   - 上传后:uploadMiddleware 校验 buffer 前 12 字节魔数(权威校验,防伪造 MIME)
//   - limits:fileSize ≤ 10MB(对应技术约束 ≤10MB)
//   - controller 写盘后由 service 层清理临时文件
// ============================================================

import { Router } from 'express';
import multer, { MulterError } from 'multer';
import {
  createAnalysis,
  uploadAnalysis,
  listAnalyses,
  getAnalysis,
  getReportData,
  aiEnhanceAnalysis,
  askQuestionAnalysis,
  deleteAnalysis,
  batchDeleteAnalyses,
} from '../controllers/analysis.controller.js';
import { authMiddleware } from '../middlewares/auth.js';
import { tenantMiddleware } from '../middlewares/tenant.js';
import { apiRateLimiter, markerFeedbackRateLimiter } from '../middlewares/rate-limit.js';
import { validate } from '../middlewares/validate.js';
import {
  requirePermission,
  requireAnyPermission,
} from '../middlewares/permission.js';
import { env } from '../config/env.js';
import { ErrorCode } from '../types/api-contract.js';
import { error } from '../utils/response.js';
import { logger } from '../utils/logger.js';
// Phase 5:评委评审子路由(嵌套在 /analyses/:id 下,继承父级 auth/tenant/rateLimiter)
import { reviewRouter } from './review.routes.js';
// 组织内分享:分享/取消分享(嵌套在 /analyses/:id 下)
import { shareAnalysis, unshareAnalysis } from '../controllers/share.controller.js';
// 反馈闭环 Phase 4 批次②:标注反馈采集(数据飞轮)
import {
  createMarkerFeedback,
  createMarkerFeedbackSchema,
} from '../controllers/marker-feedback.controller.js';

export const analysisRouter: Router = Router();

// ---------- 全局中间件 ----------
analysisRouter.use(authMiddleware);
analysisRouter.use(tenantMiddleware);
analysisRouter.use(apiRateLimiter());

// ---------- multer 配置(内存存储 + MIME 预检 + 魔数权威校验) ----------

/**
 * 允许的 MIME 类型(对应技术约束:仅图片)
 * 仅作为 fileFilter 预筛,权威校验由 detectImageType 魔数检查完成
 */
const ALLOWED_MIME_TYPES: readonly string[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/bmp',
];

/** 最大文件大小(惰性读取,避免模块加载时 env 尚未初始化) */
const getMaxFileSize = (): number => env().uploadMaxSize;

// memoryStorage:文件驻留内存,供 uploadMiddleware 读取 buffer 做魔数校验
const storage = multer.memoryStorage();

const fileFilter = (_req: unknown, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  // MIME 预检:早筛非图片类型,节省内存(memoryStorage 会读取整个文件到内存)
  // 注意:MIME 由客户端提供,可伪造;权威校验在 uploadMiddleware 中读 buffer 魔数
  if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    // 文件类型不支持:用自定义 Error(MulterError 不支持自定义 code)
    // handleUploadError 通过 error.message === 'INVALID_FILE_TYPE' 识别
    const err = new Error('INVALID_FILE_TYPE');
    err.name = 'FileTypeError';
    cb(err);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: getMaxFileSize(), // 惰性读取,模块加载时 env 可能尚未初始化
    files: 1,
    parts: 10, // 字段数上限(防止恶意构造大量字段)
  },
});

/**
 * 通过文件头魔数判断真实图片类型(防伪造 MIME 绕过)
 * 返回检测到的类型,无法识别返回 null
 *
 * 魔数参考:
 *   JPEG: FF D8 FF(3 字节)
 *   PNG:  89 50 4E 47 0D 0A 1A 0A(8 字节)
 *   WebP: 52 49 46 46 ?? ?? ?? ?? 57 45 42 50(12 字节,RIFF....WEBP)
 *   BMP:  42 4D(2 字节)
 */
function detectImageType(buf: Buffer): 'jpeg' | 'png' | 'webp' | 'bmp' | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'jpeg';
  }
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return 'png';
  }
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return 'webp';
  }
  if (buf.length >= 2 && buf[0] === 0x42 && buf[1] === 0x4d) {
    return 'bmp';
  }
  return null;
}

/**
 * multer 错误处理包装中间件
 * 将 MulterError / FileTypeError 转换为统一错误码,避免暴露内部堆栈
 */
function handleUploadError(err: unknown): { code: ErrorCode; message: string; httpStatus: number } | null {
  // 1. 自定义文件类型错误(fileFilter 抛出)
  if (err instanceof Error && err.name === 'FileTypeError' && err.message === 'INVALID_FILE_TYPE') {
    return {
      code: ErrorCode.FILE_TYPE_UNSUPPORTED,
      message: `文件类型不支持,仅允许:${ALLOWED_MIME_TYPES.join('/')}`,
      httpStatus: 400,
    };
  }
  // 2. MulterError(大小/数量/字段限制)
  if (err instanceof MulterError) {
    switch (err.code) {
      case 'LIMIT_FILE_SIZE':
        return {
          code: ErrorCode.FILE_TOO_LARGE,
          message: `文件大小超过上限(${Math.floor(getMaxFileSize() / 1024 / 1024)}MB)`,
          httpStatus: 413,
        };
      case 'LIMIT_FILE_COUNT':
        return {
          code: ErrorCode.FILE_UPLOAD_FAILED,
          message: '上传文件数量超过上限(1 个)',
          httpStatus: 400,
        };
      case 'LIMIT_UNEXPECTED_FILE':
        return {
          code: ErrorCode.FILE_UPLOAD_FAILED,
          message: '上传字段名错误,应为 image',
          httpStatus: 400,
        };
      default:
        return {
          code: ErrorCode.FILE_UPLOAD_FAILED,
          message: `文件上传失败:${err.code}`,
          httpStatus: 400,
        };
    }
  }
  return null;
}

/**
 * 包装 multer single('image') 中间件,统一错误处理 + 魔数权威校验(G4)
 *
 * 流程:
 *   1. multer 解析 multipart → 写入 req.file.buffer(memoryStorage)
 *   2. 读取 buffer 前 12 字节做魔数匹配,失败返回 FILE_TYPE_UNSUPPORTED
 *   3. 通过则交给 controller 写盘并调用 service
 */
const uploadImage = upload.single('image');
const uploadMiddleware: Router = Router();

uploadMiddleware.use((req, res, next) => {
  uploadImage(req, res, (err) => {
    if (err) {
      const mapped = handleUploadError(err);
      if (mapped) {
        return error(res, mapped.code, mapped.message, mapped.httpStatus);
      }
      // 非 MulterError,走统一错误处理
      return next(err);
    }
    // 魔数权威校验:memoryStorage 下 req.file.buffer 已就绪
    const file = (req as unknown as { file?: Express.Multer.File & { buffer?: Buffer } }).file;
    if (!file || !file.buffer) {
      return error(res, ErrorCode.FILE_EMPTY, '上传文件为空', 400);
    }
    const detected = detectImageType(file.buffer);
    if (!detected) {
      logger.warn(
        { mimetype: file.mimetype, size: file.buffer.length, traceId: req.traceId },
        '[analysis.routes] magic byte mismatch, rejected',
      );
      return error(
        res,
        ErrorCode.FILE_TYPE_UNSUPPORTED,
        `文件类型不支持(魔数校验失败),仅允许:${ALLOWED_MIME_TYPES.join('/')}`,
        400,
      );
    }
    next();
  });
});

// ---------- 业务路由 ----------
// 权限校验顺序:authMiddleware → tenantMiddleware → apiRateLimiter → requirePermission → handler
// 数据范围过滤由 service 层基于 req.role 实现(见 analysis.service.ts)

// POST /analyses - JSON 模式(imageUrl),需 analysis:create 权限(所有角色拥有)
analysisRouter.post('/', requirePermission('analysis:create'), createAnalysis);

// POST /analyses/upload - multipart/form-data 文件上传,需 analysis:create 权限
// 必须在 GET /:id 之前注册(避免 /upload 被解析为 :id)
analysisRouter.post('/upload', uploadMiddleware, requirePermission('analysis:create'), uploadAnalysis);

// GET /analyses - 分页查询历史,需 analysis:read:own 或 analysis:read:tenant 权限
// student 仅拥有 analysis:read:own,teacher/admin/owner 拥有两者
analysisRouter.get('/', requireAnyPermission('analysis:read:own', 'analysis:read:tenant'), listAnalyses);

// POST /analyses/batch-delete - 批量删除分析记录(P-06 跨端批删一致性)
// 需 analysis:delete:own 或 analysis:delete:tenant 权限
// student/teacher 拥有 analysis:delete:own(仅删自己),admin/owner 拥有两者(删任意)
// 注意:必须注册在 /:id 路由之前,避免 POST /batch-delete 被误解析(此处为 POST,无冲突,
// 但保持与 /upload 相同的"具体路径优先"约定,确保扩展安全)
analysisRouter.post(
  '/batch-delete',
  requireAnyPermission('analysis:delete:own', 'analysis:delete:tenant'),
  batchDeleteAnalyses,
);

// GET /analyses/:id - 查询单条详情,需 analysis:read:own 或 analysis:read:tenant 权限
analysisRouter.get('/:id', requireAnyPermission('analysis:read:own', 'analysis:read:tenant'), getAnalysis);

// GET /analyses/:id/report-data - 报告数据聚合(报告导出+分析报告增强特性)
// 返回雷达图/历史对比/成长趋势/班级百分位(teacher+),权限同 GET /:id
analysisRouter.get(
  '/:id/report-data',
  requireAnyPermission('analysis:read:own', 'analysis:read:tenant'),
  getReportData,
);

// POST /analyses/:id/ai-enhance - 阶段 2 AI 增强分析(方案 A)
// 用户主动触发,对已存的本地分析结果追加 AI 语义增强。
// 权限:复用 analysis:read:own / analysis:read:tenant(student/teacher 仅增强自己的;admin/owner 租户内任意)
// 幂等:已 aiEnhanced=true 的记录再次调用,直接返回当前结果(不重复调 AI、不重复计费)
// 注:POST 方法与 GET /:id / DELETE /:id 无冲突;注册在 reviewRouter.use(/:id) 之前确保优先匹配
analysisRouter.post(
  '/:id/ai-enhance',
  requireAnyPermission('analysis:read:own', 'analysis:read:tenant'),
  aiEnhanceAnalysis,
);

// POST /analyses/:id/ask-question - 阶段 3 问题分析(2026-08-16 新增)
// AI 深度分析完成后,用户就诊断结果提问,AI 携带原图+诊断摘要定向解答。
// 权限:复用 analysis:read:own / analysis:read:tenant(与 ai-enhance 一致)
// 前置条件:status=success 且 aiEnhanced=true(未增强返回 409);即时返回,不落库
analysisRouter.post(
  '/:id/ask-question',
  requireAnyPermission('analysis:read:own', 'analysis:read:tenant'),
  askQuestionAnalysis,
);

// POST /analyses/:id/marker-feedback - 标注反馈采集(反馈闭环 Phase 4 批次②/数据飞轮)
// 用户对 AI issueMarker 提交"有用/没用"反馈,积累供未来训练专属评审模型(spec §7.3 第 1 项)
// 权限:复用 analysis:read:own / analysis:read:tenant(student/teacher 仅反馈自己可见的;
//       admin/owner 租户内任意)——service 层再做归属二次校验(照 getAnalysis 先例统一 404)
// 幂等:upsert 语义,同用户同 marker 仅一条记录,切换 up/down 走 update
// 限流:通用 60/min 之外叠加专属 30/min(单分析多 marker 连续反馈场景)
analysisRouter.post(
  '/:id/marker-feedback',
  requireAnyPermission('analysis:read:own', 'analysis:read:tenant'),
  markerFeedbackRateLimiter(),
  validate({ body: createMarkerFeedbackSchema }),
  createMarkerFeedback,
);

// POST /analyses/:id/share - 分享作品到组织动态流(组织分享特性)
// 权限:share:create(所有角色);service 层强制仅可分享自己的 status=success 作品
// 幂等:同一作品同一用户仅可分享一次,重复分享返回 409 SHARE_ALREADY_EXISTS
analysisRouter.post('/:id/share', requirePermission('share:create'), shareAnalysis);

// DELETE /analyses/:id/share - 取消分享(仅本人;教师删除他人分享走 DELETE /org/feed/:id)
// 与 DELETE /:id 无冲突(段数不同,Express 按段匹配)
analysisRouter.delete('/:id/share', requirePermission('share:create'), unshareAnalysis);

// DELETE /analyses/:id - 删除分析记录,需 analysis:delete:own 或 analysis:delete:tenant 权限
// student/teacher 拥有 analysis:delete:own(仅删自己),admin/owner 拥有两者(删任意)
analysisRouter.delete('/:id', requireAnyPermission('analysis:delete:own', 'analysis:delete:tenant'), deleteAnalysis);

// ---------- Phase 5:评委评审子路由(嵌套在 /analyses/:id 下)----------
// reviewRouter 处理以下路径(继承父级 auth/tenant/rateLimiter):
//   POST /analyses/:id/reviews
//   GET  /analyses/:id/reviews
//   GET  /analyses/:id/reviews/:rid
//   POST /analyses/:id/disputes/check
//
// 注意:此挂载点必须在 /:id 的 GET/DELETE 之后,以避免 reviewRouter 拦截单段路径请求
// reviewRouter 内部所有路由都至少有两段路径(/reviews / /disputes/check),不会与 GET /:id 冲突
analysisRouter.use('/:id', reviewRouter);
