// ============================================================
// 管理后台路由(Phase 4)
// 对应 API:/api/admin/*(5 大模块:用户/内容/订阅/数据看板/系统)
//
// 中间件链路:authMiddleware → tenantMiddleware → apiRateLimiter → permission → handler
//   - authMiddleware:解析 JWT,注入 req.userId / req.tenantId / req.role
//   - tenantMiddleware:校验 req.tenantId 存在(管理员必须归属某租户)
//   - apiRateLimiter:按用户限流(60 次/分钟)
//   - permission:RBAC 权限检查(仅 admin/owner 拥有 admin:* 权限)
//
// 权限矩阵(仅 ADMIN/OWNER 拥有):
//   用户管理  :admin:user:read / admin:user:write / admin:user:export
//   角色管理  :admin:role:read / admin:role:write
//   内容管理  :admin:artwork:read / admin:artwork:write
//   模板管理  :admin:template:read / admin:template:write
//   订阅管理  :admin:subscription:read / admin:subscription:write
//   套餐管理  :admin:plan:read / admin:plan:write
//   数据看板  :admin:stats:read
//   租户管理  :admin:tenant:read / admin:tenant:write
//   审计日志  :admin:audit:read
//   API 密钥  :admin:apikey:read / admin:apikey:write
//   系统健康  :admin:system:health
// ============================================================

import { Router } from 'express';
import { authMiddleware } from '../middlewares/auth.js';
import { tenantMiddleware } from '../middlewares/tenant.js';
import { apiRateLimiter } from '../middlewares/rate-limit.js';
import { requirePermission } from '../middlewares/permission.js';
import { highRiskConfirmPassword } from '../middlewares/high-risk-confirm.js';
import { idempotencyMiddleware } from '../middlewares/idempotency.js';

// 用户管理模块
import {
  listUsers,
  getUser,
  updateUser,
  lockUser,
  batchUsers,
  exportUsers,
  listRoles,
  updateRole,
} from '../controllers/admin.controller.js';

// 内容管理模块
import {
  listArtworks,
  getArtwork,
  reviewArtwork,
  deleteArtwork,
  listTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
} from '../controllers/admin.controller.js';

// 订阅管理模块
import {
  listSubscriptions,
  getSubscription,
  cancelSubscription,
  refundSubscription,
  listInvoices,
  getInvoice,
  listPlans,
  createPlan,
  updatePlan,
} from '../controllers/admin.controller.js';

// 数据看板模块
import {
  getStatsOverview,
  getStatsGrowth,
  getStatsRetention,
  getStatsAiCost,
  getStatsRealtime,
  getTenantStats,
  getScoreConsistency,
} from '../controllers/admin.controller.js';

// 系统管理模块
import {
  listTenants,
  getTenant,
  createTenant,
  updateTenant,
  listAuditLogs,
  listApiKeys,
  createApiKey,
  revokeApiKey,
  getSystemHealth,
} from '../controllers/admin.controller.js';

// Phase 5 院校管理扩展模块(邀请码 / 批量导入 / 预设覆盖)
import {
  createInvitation,
  listInvitations,
  batchImportStudents,
  listAdminPresets,
  overridePreset,
} from '../controllers/admin-phase5.controller.js';

// AI 生产化:AI 配置管理(查看 / 测试)
import { getAiConfig, testAiConfig } from '../controllers/admin-ai-config.controller.js';

// 租户仲裁配置(M-1 DOC-2026-08-003/005)
import {
  getTenantArbitrationConfig,
  updateTenantArbitrationConfig,
} from '../controllers/admin-arbitration.controller.js';

// AI 用量统计模块(每次 AI 调用日志的聚合统计)
import {
  getAiUsageOverview,
  getAiUsageByProvider,
  getAiUsageByUser,
  getAiUsageTrend,
} from '../controllers/admin-ai-usage.controller.js';

// 标注反馈统计模块(反馈闭环 Phase 5 批次①:数据飞轮备料)
import {
  getFeedbackOverview,
  getFeedbackByDimension,
  getFeedbackByWorkType,
  getFeedbackTrend,
  exportFeedbackData,
} from '../controllers/admin-feedback-stats.controller.js';

// M3 可观测性:AI 指标(METRICS_DATA_UNAVAILABLE 9201 / AI_METRICS 契约已冻结)
import { getMetricsAi, getMetricsSla } from '../controllers/metrics.controller.js';

// 开发者视图模块(平台级诊断只读端点)
import { listDevAccounts, listDevDeployments } from '../controllers/admin-dev.controller.js';

// 用户在线状态 Presence 查询模块(M4-BE-2,P-09)
import { listPresenceUsers, listPresenceOnline } from '../controllers/presence.controller.js';

// 投诉举报模块(公安备案合规,管理端只读列表)
import { listReports } from '../controllers/report.controller.js';

export const adminRouter: Router = Router();

// ---------- 全局中间件(所有 /api/admin/* 路由必须经过鉴权 + 租户校验 + 限流)----------
adminRouter.use(authMiddleware);
adminRouter.use(tenantMiddleware);
adminRouter.use(apiRateLimiter());

// ============================================================
// 3.10.1 用户管理模块
// ============================================================

// GET /api/admin/users - 分页查询用户列表(响应脱敏)
adminRouter.get('/users', requirePermission('admin:user:read'), listUsers);

// GET /api/admin/users/export - 导出用户 CSV(脱敏后输出)
// 注意:此路由必须在 /users/:id 之前注册,避免 'export' 被当作 :id 参数
adminRouter.get('/users/export', requirePermission('admin:user:export'), exportUsers);

// GET /api/admin/users/:id - 查询用户详情(响应脱敏)
adminRouter.get('/users/:id', requirePermission('admin:user:read'), getUser);

// PATCH /api/admin/users/:id - 更新用户(角色/状态/资料)
adminRouter.patch('/users/:id', requirePermission('admin:user:write'), updateUser);

// POST /api/admin/users/:id/lock - 锁定/解锁用户(高危:支持 confirmPassword + Idempotency-Key)
adminRouter.post(
  '/users/:id/lock',
  requirePermission('admin:user:write'),
  idempotencyMiddleware(),
  highRiskConfirmPassword,
  lockUser,
);

// POST /api/admin/users/batch - 批量操作用户(更新角色/删除)[高危:confirmPassword + Idempotency-Key]
adminRouter.post(
  '/users/batch',
  requirePermission('admin:user:write'),
  idempotencyMiddleware(),
  highRiskConfirmPassword,
  batchUsers,
);

// GET /api/admin/roles - 查询角色权限矩阵
adminRouter.get('/roles', requirePermission('admin:role:read'), listRoles);

// PATCH /api/admin/roles/:role - 更新角色权限
adminRouter.patch('/roles/:role', requirePermission('admin:role:write'), updateRole);

// ============================================================
// 3.10.2 内容管理模块
// ============================================================

// GET /api/admin/artworks - 分页查询作品列表
adminRouter.get('/artworks', requirePermission('admin:artwork:read'), listArtworks);

// GET /api/admin/artworks/:id - 查询作品详情
adminRouter.get('/artworks/:id', requirePermission('admin:artwork:read'), getArtwork);

// POST /api/admin/artworks/:id/review - 审核作品(高危:confirmPassword + Idempotency-Key)
adminRouter.post(
  '/artworks/:id/review',
  requirePermission('admin:artwork:write'),
  idempotencyMiddleware(),
  highRiskConfirmPassword,
  reviewArtwork,
);

// DELETE /api/admin/artworks/:id - 删除作品
adminRouter.delete('/artworks/:id', requirePermission('admin:artwork:write'), deleteArtwork);

// GET /api/admin/templates - 分页查询创意模板
adminRouter.get('/templates', requirePermission('admin:template:read'), listTemplates);

// GET /api/admin/templates/:id - 查询模板详情
adminRouter.get('/templates/:id', requirePermission('admin:template:read'), getTemplate);

// POST /api/admin/templates - 创建模板
adminRouter.post('/templates', requirePermission('admin:template:write'), createTemplate);

// PATCH /api/admin/templates/:id - 更新模板
adminRouter.patch('/templates/:id', requirePermission('admin:template:write'), updateTemplate);

// DELETE /api/admin/templates/:id - 删除模板
adminRouter.delete('/templates/:id', requirePermission('admin:template:write'), deleteTemplate);

// ============================================================
// 3.10.3 订阅管理模块
// ============================================================

// GET /api/admin/subscriptions - 分页查询订阅列表
adminRouter.get('/subscriptions', requirePermission('admin:subscription:read'), listSubscriptions);

// GET /api/admin/subscriptions/:id - 查询订阅详情
adminRouter.get('/subscriptions/:id', requirePermission('admin:subscription:read'), getSubscription);

// POST /api/admin/subscriptions/:id/cancel - 管理员取消订阅
adminRouter.post('/subscriptions/:id/cancel', requirePermission('admin:subscription:write'), cancelSubscription);

// POST /api/admin/subscriptions/:id/refund - 退款处理(高危:confirmPassword + Idempotency-Key)
adminRouter.post(
  '/subscriptions/:id/refund',
  requirePermission('admin:subscription:write'),
  idempotencyMiddleware(),
  highRiskConfirmPassword,
  refundSubscription,
);

// GET /api/admin/invoices - 分页查询发票列表
adminRouter.get('/invoices', requirePermission('admin:subscription:read'), listInvoices);

// GET /api/admin/invoices/:id - 查询发票详情
adminRouter.get('/invoices/:id', requirePermission('admin:subscription:read'), getInvoice);

// GET /api/admin/plans - 查询套餐列表
adminRouter.get('/plans', requirePermission('admin:plan:read'), listPlans);

// POST /api/admin/plans - 创建套餐
adminRouter.post('/plans', requirePermission('admin:plan:write'), createPlan);

// PATCH /api/admin/plans/:id - 更新套餐
adminRouter.patch('/plans/:id', requirePermission('admin:plan:write'), updatePlan);

// ============================================================
// 3.10.4 数据看板模块
// ============================================================

// GET /api/admin/stats/overview - 总览统计(Redis 缓存 1 分钟)
adminRouter.get('/stats/overview', requirePermission('admin:stats:read'), getStatsOverview);

// GET /api/admin/stats/growth - 成长趋势(Redis 缓存 5 分钟)
adminRouter.get('/stats/growth', requirePermission('admin:stats:read'), getStatsGrowth);

// GET /api/admin/stats/retention - 留存分析(Redis 缓存 5 分钟)
adminRouter.get('/stats/retention', requirePermission('admin:stats:read'), getStatsRetention);

// GET /api/admin/stats/ai-cost - AI 成本统计(Redis 缓存 5 分钟)
adminRouter.get('/stats/ai-cost', requirePermission('admin:stats:read'), getStatsAiCost);

// ============================================================
// AI 用量统计模块(基于 ai_usage_logs 表的精细统计)
// 权限:admin:stats:read(与数据看板共用)
// 缓存:Redis 5 分钟(由 service 层 getCached/setCached 实现)
//
// 4 个接口:
//   GET /stats/ai-usage/overview      总览(总次数/成功/失败/token/成本/平均耗时/成功率)
//   GET /stats/ai-usage/by-provider   按 Provider 分组(glm/trae/aliyun 等)
//   GET /stats/ai-usage/by-user       按用户分组 Top N(关联 users 表补姓名)
//   GET /stats/ai-usage/trend         按日期趋势(最近 N 天)
// ============================================================

// GET /api/admin/stats/ai-usage/overview - 总览统计
adminRouter.get('/stats/ai-usage/overview', requirePermission('admin:stats:read'), getAiUsageOverview);

// GET /api/admin/stats/ai-usage/by-provider - 按 Provider 分组
adminRouter.get('/stats/ai-usage/by-provider', requirePermission('admin:stats:read'), getAiUsageByProvider);

// GET /api/admin/stats/ai-usage/by-user - 按用户分组 Top N
adminRouter.get('/stats/ai-usage/by-user', requirePermission('admin:stats:read'), getAiUsageByUser);

// GET /api/admin/stats/ai-usage/trend - 按日期趋势(最近 N 天)
adminRouter.get('/stats/ai-usage/trend', requirePermission('admin:stats:read'), getAiUsageTrend);

// ============================================================
// 标注反馈统计模块(反馈闭环 Phase 5 批次①:数据飞轮备料)
// 基于 marker_feedbacks 表(MarkerFeedback)的聚合统计
// 权限:admin:stats:read(与 AI 用量统计共用)
// 缓存:Redis 5 分钟(由 service 层 getCached/setCached 实现)
//
// 4 个接口:
//   GET /stats/feedback/overview      总览(总量/up/down/有用率/用户数/覆盖分析/近7天)
//   GET /stats/feedback/by-dimension  按维度分组(定位最常被点没用的维度)
//   GET /stats/feedback/by-worktype   按作品类型分组(分类型训练集规模盘点)
//   GET /stats/feedback/trend         按日趋势(最近 N 天)
// ============================================================

// GET /api/admin/stats/feedback/overview - 反馈总览统计
adminRouter.get('/stats/feedback/overview', requirePermission('admin:stats:read'), getFeedbackOverview);

// GET /api/admin/stats/feedback/by-dimension - 按维度分组
adminRouter.get('/stats/feedback/by-dimension', requirePermission('admin:stats:read'), getFeedbackByDimension);

// GET /api/admin/stats/feedback/by-worktype - 按作品类型分组
adminRouter.get('/stats/feedback/by-worktype', requirePermission('admin:stats:read'), getFeedbackByWorkType);

// GET /api/admin/stats/feedback/trend - 按日趋势
adminRouter.get('/stats/feedback/trend', requirePermission('admin:stats:read'), getFeedbackTrend);

// GET /api/admin/stats/feedback/export - 训练数据导出(NDJSON 流式,Phase 5 批次②)
// 数据主权:平台 owner 可全局(tenantId=all/缺省)或任意租户;租户 admin 强制本租户
adminRouter.get('/stats/feedback/export', requirePermission('admin:stats:read'), exportFeedbackData);

// ============================================================
// M3 可观测性:AI 指标(契约已冻结,api-contract.ts §3.18)
//   GET /api/admin/metrics/ai  → AiMetricsResponse(冻结)
//   GET /api/admin/metrics/sla → SlaMetricsResponse(冻结)
//   特性开关 metrics 默认 disabled,关闭时 controller 返回 403
//   多租户隔离:非平台 owner 传他人 tenantId → 403(门禁 M3-3)
// ============================================================
adminRouter.get('/metrics/ai', requirePermission('admin:stats:read'), getMetricsAi);
adminRouter.get('/metrics/sla', requirePermission('admin:stats:read'), getMetricsSla);

// GET /api/admin/stats/realtime - 实时监控(不缓存)
adminRouter.get('/stats/realtime', requirePermission('admin:stats:read'), getStatsRealtime);

// AI-教师评分一致性统计(框架二 P2):MAE/RMSE/档位一致率/偏差方向/维度级MAE
// query: tenantId?(省略跨租户聚合) / days?(默认90)
adminRouter.get('/stats/score-consistency', requirePermission('admin:stats:read'), getScoreConsistency);

// GET /api/admin/stats/tenant/:id - 单租户统计
adminRouter.get('/stats/tenant/:id', requirePermission('admin:stats:read'), getTenantStats);

// ============================================================
// 3.10.5 系统管理模块
// ============================================================

// GET /api/admin/system/tenants - 分页查询租户列表
adminRouter.get('/system/tenants', requirePermission('admin:tenant:read'), listTenants);

// GET /api/admin/system/tenants/:id - 查询租户详情
adminRouter.get('/system/tenants/:id', requirePermission('admin:tenant:read'), getTenant);

// POST /api/admin/system/tenants - 创建租户
adminRouter.post('/system/tenants', requirePermission('admin:tenant:write'), createTenant);

// PATCH /api/admin/system/tenants/:id - 更新租户
adminRouter.patch('/system/tenants/:id', requirePermission('admin:tenant:write'), updateTenant);

// GET /api/admin/system/audit-logs - 分页查询审计日志
adminRouter.get('/system/audit-logs', requirePermission('admin:audit:read'), listAuditLogs);

// GET /api/admin/system/api-keys - 分页查询 API 密钥列表
adminRouter.get('/system/api-keys', requirePermission('admin:apikey:read'), listApiKeys);

// POST /api/admin/system/api-keys - 创建 API 密钥(完整密钥仅返回一次)
adminRouter.post('/system/api-keys', requirePermission('admin:apikey:write'), createApiKey);

// DELETE /api/admin/system/api-keys/:id - 吊销 API 密钥(高危:confirmPassword + Idempotency-Key)
adminRouter.delete(
  '/system/api-keys/:id',
  requirePermission('admin:apikey:write'),
  idempotencyMiddleware(),
  highRiskConfirmPassword,
  revokeApiKey,
);

// GET /api/admin/system/health - 系统健康检查
adminRouter.get('/system/health', requirePermission('admin:system:health'), getSystemHealth);

// ============================================================
// AI 生产化:AI 配置管理模块(查看 / 测试)
// ============================================================
// 权限:admin:system:health(与系统健康检查共用,仅 ADMIN/OWNER)
//
// 设计说明:
//   - GET  /system/ai-config      查看当前 AI 配置状态(Key 脱敏,不返回完整凭据)
//   - POST /system/ai-config/test 测试 AI 连通性(发送 1x1 测试图片,验证配置可用)
//
// 配置更新流程:
//   1. 管理员 SSH 到服务器,编辑 /var/www/danqing-ai/server/.env
//   2. 修改 AI_API_KEY / AI_API_URL / AI_API_MODEL / AI_ENABLED / AI_PROVIDER
//   3. 执行 `pm2 restart danqing-api`
//   4. 调用 GET /system/ai-config 验证配置已生效
//   5. 调用 POST /system/ai-config/test 验证 AI 可正常调用
//
// 支持的 AI Provider(任意 OpenAI 兼容端点):
//   - 智谱 GLM-4V     AI_API_URL=https://open.bigmodel.cn/api/paas/v4/chat/completions
//   - TRAE 内置 AI    AI_PROVIDER=trae + TRAE_API_KEY + TRAE_API_URL
//   - OpenAI          AI_API_URL=https://api.openai.com/v1/chat/completions
//   - Azure OpenAI    AI_API_URL=https://{resource}.openai.azure.com/openai/deployments/{deploy}/chat/completions?api-version=...
//   - 自部署 vLLM     AI_API_URL=http://your-host:8000/v1/chat/completions

// GET /api/admin/system/ai-config - 查看 AI 配置状态(Key 脱敏)
adminRouter.get('/system/ai-config', requirePermission('admin:system:health'), getAiConfig);

// POST /api/admin/system/ai-config/test - 测试 AI 连通性(发送最小化请求)
adminRouter.post('/system/ai-config/test', requirePermission('admin:system:health'), testAiConfig);

// ============================================================
// 3.10.6 Phase 5 院校管理扩展模块(邀请码 / 批量导入 / 预设覆盖)
// ============================================================
// 权限矩阵:
//   admin:invitation:write - 创建邀请码 / 批量导入学生(ADMIN/OWNER)
//   admin:preset:read      - 查看所有预设(ADMIN/OWNER)
//   admin:preset:write     - 派生覆盖预设(ADMIN/OWNER)
//
// 路由顺序说明:
//   - /tenants/:id/invitations 与 /tenants/:id/students/batch 路径段独立,无冲突
//   - /presets 与 /presets/:id/override 必须按顺序注册(避免 'presets' 被当作已有路由)
//   - 注意:/presets 不与 /system/* 冲突(顶级路径段不同)

// POST /api/admin/tenants/:id/invitations - 创建邀请码(ADMIN/OWNER)
adminRouter.post(
  '/tenants/:id/invitations',
  requirePermission('admin:invitation:write'),
  createInvitation,
);

// GET /api/admin/tenants/:id/invitations - 列出租户邀请码(ADMIN/OWNER)
adminRouter.get(
  '/tenants/:id/invitations',
  requirePermission('admin:invitation:write'),
  listInvitations,
);

// POST /api/admin/tenants/:id/students/batch - 批量导入学生(ADMIN/OWNER)
adminRouter.post(
  '/tenants/:id/students/batch',
  requirePermission('admin:invitation:write'),
  batchImportStudents,
);

// GET /api/admin/tenants/:id/arbitration-config - 查询租户仲裁配置(M-1 DOC-2026-08-003)
// 权限:admin:tenant:read
adminRouter.get(
  '/tenants/:id/arbitration-config',
  requirePermission('admin:tenant:read'),
  getTenantArbitrationConfig,
);

// PUT /api/admin/tenants/:id/arbitration-config - 更新租户仲裁配置(M-1 DOC-2026-08-005)
// 权限:admin:tenant:write;深合并 + Zod 全量校验 + 权重归一化校验 + 审计日志
adminRouter.put(
  '/tenants/:id/arbitration-config',
  requirePermission('admin:tenant:write'),
  updateTenantArbitrationConfig,
);

// GET /api/admin/presets - 列出所有预设(含 built-in + 用户预设,ADMIN/OWNER)
adminRouter.get('/presets', requirePermission('admin:preset:read'), listAdminPresets);

// POST /api/admin/presets/:id/override - 从 built-in 派生覆盖预设(ADMIN/OWNER)
adminRouter.post(
  '/presets/:id/override',
  requirePermission('admin:preset:write'),
  overridePreset,
);

// ============================================================
// 开发者视图模块(平台级诊断只读端点)
// ============================================================
// 权限复用现有权限码(不新增权限,轻量方案):
//   /dev/accounts    → admin:user:read(与用户列表同款,ADMIN/OWNER)
//   /dev/deployments → admin:stats:read(与数据看板同款,ADMIN/OWNER)
//
// 说明:
//   - 均为平台级跨租户只读查询(开发者诊断用途),不做写操作
//   - 与 /api/v1/deployments/*(共享密钥鉴权,供部署脚本上报)相互独立,互不影响

// GET /api/admin/dev/accounts - 账号清单(含在线状态 / 测试账号标记)
adminRouter.get('/dev/accounts', requirePermission('admin:user:read'), listDevAccounts);

// GET /api/admin/dev/deployments?limit=20 - 部署历史(按 timestamp 倒序,limit 上限 100)
adminRouter.get('/dev/deployments', requirePermission('admin:stats:read'), listDevDeployments);

// ============================================================
// 用户在线状态 Presence 查询模块(M4-BE-2,P-09,契约 §3.12 已冻结)
// ============================================================
// 权限复用现有权限码(不新增权限):
//   /presence/users  → admin:user:read(与用户列表同款,ADMIN/OWNER)
//   /presence/online → admin:stats:read(与数据看板同款,ADMIN/OWNER)
//
// 说明:
//   - 均为平台级只读查询;三态判定语义见 presence.service.ts(单一真相)
//   - ids 上限 100:超限在进入 service 前由 controller Zod 校验拦截(→ 1001)
//   - service 内部已做 Redis 故障降级,读路径不因 Redis 异常 5xx

// GET /api/admin/presence/users?ids=a,b,c - 批量查询用户三态(单次上限 100)
adminRouter.get('/presence/users', requirePermission('admin:user:read'), listPresenceUsers);

// GET /api/admin/presence/online - 在线用户清单(含 online/idle/offline 汇总)
adminRouter.get('/presence/online', requirePermission('admin:stats:read'), listPresenceOnline);

// ============================================================
// 投诉举报模块(公安备案合规)
// ============================================================
// 权限:admin:report:read(仅 ADMIN/OWNER)
// 说明:
//   - 本期仅只读列表;status 过滤(pending/resolved/dismissed)+ 分页
//     (默认 page=1, pageSize=20,上限 100)
//   - 举报人 email/phone 在 service 层经 maskEmail/maskPhone 脱敏后输出
//   - 多租户隔离:强制按 req.tenantId 过滤(repository 硬约束)
//   - "标记处理"接口(resolved/dismissed 状态流转)为后续迭代,预留 status 字段

// GET /api/admin/reports - 举报分页列表(举报人信息脱敏)
adminRouter.get('/reports', requirePermission('admin:report:read'), listReports);
