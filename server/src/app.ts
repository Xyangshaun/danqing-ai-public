// ============================================================
// 丹青有AI - Express 应用入口
// 对应文档:
//   - api-contract-v1.md §1(统一响应规范)
//   - auth-design.md §3(安全防护)+ §0 C10(OIDC 合规)
//   - context-log-2026-07-27.md(技术约束)
//
// 职责:
//   1. 注册全局中间件(helmet/cors/cookie/json/trace)
//   2. 挂载业务路由(/auth /users /tenants /analyses)
//   3. 注册 404 与统一错误处理中间件
//   4. 暴露 /health 健康检查(无需鉴权,供 LB/K8s 探针)
//
// 设计原则:
//   - app.ts 仅组装中间件与路由,不启动 HTTP server(由 index.ts 负责)
//   - 便于 Vitest supertest 直接 import app 做集成测试
//   - 所有错误统一走 errorHandler,禁止裸 res.json
// ============================================================

import express, { Router, type Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { traceMiddleware } from './middlewares/trace.js';
import { errorHandler, notFoundHandler } from './middlewares/error-handler.js';
import { clientIdentification, responseOptimizer } from './middlewares/client-adapt.js';
import { authRouter } from './routes/auth.routes.js';
import { userRouter } from './routes/user.routes.js';
import { tenantRouter } from './routes/tenant.routes.js';
import { analysisRouter } from './routes/analysis.routes.js';
// M-2 AI 图像生成路由(POST /generation + GET /generation/:id)
import { generationRouter } from './routes/generation.routes.js';
import { artworkRouter } from './routes/artwork.routes.js';
import { growthRouter } from './routes/growth.routes.js';
import { subscriptionRouter } from './routes/subscription.routes.js';
import { adminRouter } from './routes/admin.routes.js';
import { redisMetrics } from './services/redis-metrics.service.js';
// Phase 5 预留接口路由(返回 501 Not Implemented,为 v2.0 扩展做准备)
import { knowledgeRouter } from './routes/knowledge.routes.js';
import { modulesRouter } from './routes/modules.routes.js';
import { uiConfigRouter } from './routes/ui-config.routes.js';
import { configRouter } from './routes/config.routes.js';
// 实时图片搜索路由(P0 落地实现,详见 docs/realtime-image-search-solution.md)
import { imageSearchRouter } from './routes/image-search.routes.js';
// Phase 5 业务路由(评分预设 + 争议仲裁,已落地实现)
import { presetRouter } from './routes/preset.routes.js';
import { disputeRouter } from './routes/dispute.routes.js';
// 双阶段反馈框架 Phase 2 评分档案路由(LUT 式可调评分风格)
import { gradingProfileRouter } from './routes/grading-profile.routes.js';
import { knowledgeCardRouter } from './routes/knowledge-card.routes.js';
// 任务包 B:通知系统路由(通知列表 / 未读计数 / 标记已读)
import { notificationRouter } from './routes/notification.routes.js';
// 任务包 C:部署日志同步路由(共享密钥鉴权,接收部署结果 + 查询最新状态)
import { deploymentRouter } from './routes/deployment.routes.js';
// 班级管理路由(班级即租户 type='class',复用 Tenant/TenantMember/InvitationCode)
import { classRouter } from './routes/class.routes.js';
// 组织动态流路由(报告导出+组织分享特性,挂载 /org/feed)
import { shareRouter } from './routes/share.routes.js';
// 投诉举报路由(公安备案合规,POST /reports)
import { reportRouter } from './routes/report.routes.js';
import { ErrorCode } from './types/api-contract.js';

/**
 * 创建并配置 Express 应用
 * 抽成工厂函数便于测试时重建实例
 */
export function createApp(): Express {
  const app = express();
  const cfg = env();

  // 信任第一跳代理(X-Forwarded-For / X-Forwarded-Proto)
  // 生产部署在 LB/Nginx 后,需启用以正确获取客户端 IP
  app.set('trust proxy', 1);
  // 关闭 x-powered-by(避免暴露技术栈)
  app.disable('x-powered-by');

  // ---------- 安全中间件 ----------
  app.use(
    helmet({
      contentSecurityPolicy: {
        // API 服务默认不返回 HTML,CSP 收紧(对 preflight 与 JSON 友好)
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
      // HSTS 仅在显式开启时启用(开发环境 HTTPS 不必强开)
      hsts: cfg.enableHsts
        ? { maxAge: 31536000, includeSubDomains: true, preload: true }
        : false,
      // 禁用 MIME 嗅探
      noSniff: true,
      // 防点击劫持
      frameguard: { action: 'deny' },
      // 隐藏 Server 头
      hidePoweredBy: true,
    }),
  );

  // ---------- CORS(白名单,禁止 *)----------
  // 对应 auth-design.md §0 C10 + context-log 安全约束
  const corsOriginChecker = (
    origin: string | undefined,
    callback: (err: Error | null, allow?: boolean) => void,
  ): void => {
    // 允许同源请求(无 Origin 头,如 curl/Postman)
    if (!origin) return callback(null, true);
    if (cfg.corsOrigins.includes(origin)) {
      return callback(null, true);
    }
    logger.warn({ origin }, '[cors] rejected');
    // 不暴露资源存在性,统一返回 false
    return callback(null, false);
  };
  app.use(
    cors({
      origin: corsOriginChecker,
      credentials: true, // 允许携带 Cookie(refresh_token)
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: [
        'Authorization',
        'Content-Type',
        'X-Trace-Id',
        'X-Client-Context',
        'X-Device-Id',
        'X-Client',
        'X-CSRF-Token',
      ],
      exposedHeaders: ['X-Trace-Id'],
      maxAge: 600, // preflight 缓存 10 分钟
    }),
  );

  // ---------- traceId 注入(必须在 body parser 之前)----------
  // 原因:body parser 解析失败时(express.json 抛 entity.parse.failed)需先有 traceId
  // 才能通过 errorHandler 返回带 UUID 的错误响应,避免 traceId='unknown' 断链
  // trace 中间件仅读 header / 生成 UUID,不依赖 body 或 cookie,顺序提前无副作用
  app.use(traceMiddleware);

  // ---------- 路由级请求体放宽(M-4 风格迁移,真源 §2.9)----------
  // 风格迁移 dataURL 请求体放宽:仅 /api/v1/generation 前缀生效,其余路径维持 1mb
  // (前端 canvas 压缩后 base64 通常 300KB-700KB,复杂画面可超 1mb 叠加触发 413;
  //  413 防线 = 前端压缩 1280/0.85 + Zod 6M 字符上限 + 路由级 8mb 三层,
  //  POST 另受 auth + 租户 + 限流约束。Express 挂载顺序保证:该前缀请求先被
  //  8mb parser 消费,下方全局 1mb parser 对已解析 body 自动跳过)
  app.use('/api/v1/generation', express.json({ limit: '8mb' }));

  // ---------- 请求体解析 ----------
  // JSON/URL-encoded body 上限 1MB(文件上传走 multer,另有限制)
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  // Cookie 解析(refresh_token HttpOnly)
  app.use(cookieParser());

  // ---------- 多端适配中间件(Phase 3)----------
  // 1. clientIdentification:为未鉴权路由(/auth/feishu/authorize 等)注入 req.client
  //    已鉴权路由由 authMiddleware 从 JWT aud / X-Client 头解析并覆盖
  // 2. responseOptimizer:按客户端类型优化响应(mobile 端移除冗余字段)
  //    必须在路由前挂载,以包装 res.json
  app.use(clientIdentification());
  app.use(responseOptimizer());

  // ---------- 健康检查(无需鉴权,供探针)----------
  // 返回轻量结构,不查 DB/Redis(避免雪崩);如需深度检查走 /health/ready
  // /health 供 LB/K8s 探针(render.yaml),/api/v1/health 供 API 契约一致性检查
  //
  // G8 安全修复:健康检查脱敏
  //   仅返回 { status: 'up', timestamp },不暴露 service / version / nodeEnv
  //   防止攻击者通过公开的 /health 端点探测服务类型与运行环境,降低信息收集面
  const healthHandler = (_req: express.Request, res: express.Response) => {
    res.status(200).json({
      code: ErrorCode.SUCCESS,
      message: 'ok',
      data: {
        status: 'up',
        timestamp: new Date().toISOString(),
      },
      traceId: res.req.traceId,
    });
  };
  app.get('/health', healthHandler);
  app.get('/api/v1/health', healthHandler);

  // ---------- Redis 指标端点(运维监控用)----------
  // 返回连接状态 / 命令耗时 / BRPOP-RPOP 统计 / 限流指标
  // 不含敏感信息(无密码/URL),但限制仅内网访问(生产环境由 Nginx 拦截外网)
  // 对应文档:redis-brpop-fix-2026-08-07.md §7 后续改进
  app.get('/api/v1/metrics/redis', (_req: express.Request, res: express.Response) => {
    res.status(200).json({
      code: ErrorCode.SUCCESS,
      message: 'ok',
      data: redisMetrics.getSnapshot(),
      traceId: res.req.traceId,
    });
  });

  // ---------- 静态资源(种子作品图等,无需鉴权)----------
  // /uploads/* 由 express.static 直接服务,供前端 <img> 引用种子原画作
  // 路径解析:__dirname = server/src,静态目录 = server/public/uploads
  // 长缓存(immutable):种子图内容不变,7 天缓存降低重复请求
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  app.use(
    '/uploads',
    express.static(path.resolve(__dirname, '../public/uploads'), {
      maxAge: '7d',
      immutable: true,
    }),
  );

  // ---------- 业务路由(统一挂载在 /api/v1 下,与 API 契约一致)----------
  const apiV1 = Router();
  apiV1.use('/auth', authRouter);
  apiV1.use('/users', userRouter);
  apiV1.use('/tenants', tenantRouter);
  apiV1.use('/analyses', analysisRouter);
  // M-2 AI 图像生成(POST /generation + GET /generation/:id,契约 §3.17)
  apiV1.use('/generation', generationRouter);
  apiV1.use('/artworks', artworkRouter);
  apiV1.use('/growth', growthRouter);
  apiV1.use('/subscriptions', subscriptionRouter);
  // Phase 5 业务路由:评分预设 + 争议仲裁(已落地实现)
  apiV1.use('/presets', presetRouter);
  apiV1.use('/disputes', disputeRouter);
  // 双阶段反馈框架 Phase 2:评分档案(系统内置 + 租户克隆 + 默认解析)
  apiV1.use('/grading-profiles', gradingProfileRouter);
  // 参考图混合方案 Phase 3:知识点卡片(纯系统内置;列表/详情读端点)
  apiV1.use('/knowledge-cards', knowledgeCardRouter);
  // 任务包 B:通知系统(通知列表 / 未读计数 / 标记已读)
  apiV1.use('/notifications', notificationRouter);
  // 任务包 C:部署日志同步(接收部署结果 / 查询最新状态,共享密钥鉴权)
  apiV1.use('/deployments', deploymentRouter);
  // 班级管理(创建班级 / 邀请码 / 学生作品查看 / 教师打分,班级即租户 type='class')
  apiV1.use('/classes', classRouter);
  // Phase 5 预留接口路由(返回 501 Not Implemented,鉴权与权限校验已就位)
  apiV1.use('/knowledge', knowledgeRouter);
  apiV1.use('/modules', modulesRouter);
  apiV1.use('/ui', uiConfigRouter);
  apiV1.use('/config', configRouter);
  // 实时图片搜索(P0 落地实现:内存倒排索引 + 字段加权 + 多租户隔离)
  apiV1.use('/images', imageSearchRouter);
  // 组织动态流(组织内分享:动态列表 / 置顶 / 评论)
  apiV1.use('/org/feed', shareRouter);
  // 投诉举报(公安备案合规:POST /reports)
  apiV1.use('/reports', reportRouter);
  app.use('/api/v1', apiV1);

  // 投诉举报契约字面路径别名(POST /api/reports,与前端团队契约一致;
  // 同一 router 实例复用,中间件无状态,请求仅命中一条挂载链)
  app.use('/api/reports', reportRouter);

  // ---------- 管理后台路由(独立命名空间 /api/admin,供 admin-dashboard 调用)----------
  // 中间件链路在 adminRouter 内部统一注册:auth → tenant → rateLimiter → permission → handler
  app.use('/api/admin', adminRouter);

  // ---------- 404 兜底 ----------
  app.use(notFoundHandler);

  // ---------- 统一错误处理(必须最后注册,4 参数)----------
  app.use(errorHandler);

  return app;
}

/**
 * 默认导出已构建的 app 实例
 * 生产入口 src/index.ts 直接 import;测试可调用 createApp() 重建
 */
const app = createApp();
export default app;
