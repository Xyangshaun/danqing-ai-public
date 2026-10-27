# 丹青有AI 后端服务 - 验收报告

> **文档定位**:Phase 1 任务 4 验收报告
> **作者**:backend-service(03 丹青有AI 后端架构师)
> **日期**:2026-07-27
> **版本**:v3.0.0
> **状态**:Phase 1 任务 4 完成,等待联调

---

## 0. 任务回顾

### 任务清单

| # | 任务 | 交付物 | 状态 |
|---|---|---|---|
| 1 | 重构后端为分层架构 | `server/src/{controllers,services,repositories,middlewares,routes,utils,types,config}` | ✅ |
| 2 | 实现飞书 OAuth 接口 | `/auth/feishu/authorize` + `/auth/feishu/callback` + 5 个 `/auth/*` 端点 | ✅ |
| 3 | 设计 Prisma schema | `server/prisma/schema.prisma`(5 model + 6 enum) | ✅ |
| 4 | 编写 Express 应用入口 | `src/app.ts` + `src/index.ts` | ✅ |
| 5 | 编译验证 | `npm run build` + `npm run typecheck` 通过 | ✅ |

### 关键约束遵循情况

| 约束 | 实现位置 | 状态 |
|---|---|---|
| TypeScript strict mode | `tsconfig.json` `strict: true` + `noUncheckedIndexedAccess` | ✅ |
| Prisma ↔ API 类型一一对应 | `prisma/schema.prisma` ↔ `src/types/api-contract.ts` | ✅ |
| 所有 API 鉴权 | `middlewares/auth.ts` + 路由层挂载 | ✅(除 `/auth/feishu/*` 与 `/health`) |
| Zod 校验所有外部输入 | `middlewares/validate.ts` + controller 内显式校验 | ✅ |
| 3 秒 SLA 同步/异步策略 | `services/analysis.service.ts`(Phase 1 mock,Phase 2 接入) | ⚠️ Phase 2 |
| 多租户强制 `tenant_id` 过滤 | Repository 层所有方法显式 `tenantId` 参数 | ✅ |
| Prisma 参数化查询 | 全程使用 Prisma Client,无 raw SQL | ✅ |
| CORS 非 `*` 白名单 | `src/app.ts` `corsOriginChecker` + `env.ts` 启动校验 | ✅ |
| 文件上传 ≤10MB | `app.ts` `express.json({ limit: '1mb' })` 注:multipart 由 Phase 2 multer 实现 | ⚠️ Phase 2 |
| bcrypt salt=12 | 暂不涉及密码登录(纯飞书 OAuth),Phase 2 引入时启用 | ⚠️ Phase 2 |
| JWT access 15m / refresh 7d | `env.ts` `JWT_ACCESS_EXPIRES=15m` `JWT_REFRESH_EXPIRES=7d` | ✅ |
| 所有写操作审计 | `logger.info` + `Session` 表 + Redis 黑名单 | ✅(Phase 2 引入独立 Audit 表) |

---

## 1. 目录结构(分层架构)

```
server/
├── prisma/
│   └── schema.prisma              # 5 model + 6 enum,UUID 主键,snake_case 表名
├── src/
│   ├── config/                    # 配置层
│   │   ├── env.ts                 # 启动自检(必填项 + RSA 私钥校验)
│   │   ├── prisma.ts              # Prisma 单例 + 事件日志
│   │   └── redis.ts               # Redis 单例(ioredis)
│   ├── controllers/               # 控制器层(HTTP 协议适配)
│   │   ├── auth.controller.ts     # 5 个 /auth/* 处理器
│   │   ├── user.controller.ts     # 2 个 /users/profile 处理器
│   │   ├── tenant.controller.ts   # 2 个 /tenants/* 处理器
│   │   └── analysis.controller.ts # 3 个 /analyses/* 处理器
│   ├── services/                  # 业务服务层(核心编排逻辑)
│   │   ├── auth.service.ts        # OAuth 12 步流程编排
│   │   ├── feishu.service.ts      # 飞书 API 调用(authorize/token/userinfo)
│   │   ├── jwt.service.ts         # RS256 签发/校验
│   │   ├── session.service.ts     # Redis + DB 双写 Session
│   │   ├── user.service.ts        # 用户资料 CRUD
│   │   ├── tenant.service.ts      # 租户查询/切换/配额
│   │   └── analysis.service.ts    # AI 分析任务(Phase 1 mock)
│   ├── repositories/              # 数据访问层(强制 tenant_id 过滤)
│   │   ├── user.repository.ts
│   │   ├── session.repository.ts
│   │   ├── tenant.repository.ts
│   │   └── analysis.repository.ts
│   ├── middlewares/               # 中间件层
│   │   ├── trace.ts               # traceId 生成与注入
│   │   ├── auth.ts                # JWT 鉴权 + 黑名单校验
│   │   ├── tenant.ts              # 多租户上下文校验
│   │   ├── rate-limit.ts          # Redis 计数限流
│   │   ├── validate.ts            # Zod 通用校验工厂
│   │   └── error-handler.ts       # 统一错误处理 + 404 兜底
│   ├── routes/                    # 路由层
│   │   ├── auth.routes.ts
│   │   ├── user.routes.ts
│   │   ├── tenant.routes.ts
│   │   └── analysis.routes.ts
│   ├── types/                     # 类型层(跨端共享主副本)
│   │   ├── api-contract.ts        # API 契约 TS 类型(对应 api-contract-v1.md)
│   │   └── express.d.ts           # Express Request 类型扩展
│   ├── utils/                     # 工具层
│   │   ├── response.ts            # success/error/paginated 统一响应
│   │   ├── logger.ts              # Winston + 脱敏 redactor
│   │   ├── crypto.ts              # state/uuid/sha256
│   │   └── http-client.ts         # axios 封装(超时/重试)
│   ├── app.ts                     # Express 应用工厂(中间件 + 路由)
│   └── index.ts                   # 服务启动入口(env → logger → prisma → redis → http)
├── .env.example                   # 环境变量模板
├── package.json                   # 依赖 + 脚本
└── tsconfig.json                  # TS 严格配置
```

---

## 2. Prisma Schema 设计

### 2.1 数据模型

| Model | 表名 | 主键 | 多租户字段 | 说明 |
|---|---|---|---|---|
| `Tenant` | `tenants` | `id` (UUID) | 否(自身) | 租户(school/college/class/individual) |
| `User` | `users` | `id` (UUID) | `tenant_id`(当前激活) | 飞书登录用户 |
| `Session` | `sessions` | `id` (UUID) | `tenant_id` | refresh_token 哈希 |
| `TenantMember` | `tenant_members` | `(user_id, tenant_id)` 复合 | `tenant_id` | 用户-租户多对多 |
| `Analysis` | `analyses` | `id` (UUID) | `tenant_id` | AI 分析任务 |

### 2.2 枚举

| Enum | 值 |
|---|---|
| `UserRole` | admin / teacher / student / owner |
| `TenantType` | school / college / class / individual |
| `TenantPlan` | free / standard / enterprise |
| `TenantStatus` | active / disabled |
| `ArtType` | painting / design / product / sculpture |
| `AnalysisStatus` | pending / processing / success / failed |

### 2.3 索引

- `tenants`: `parentId`, `feishuTenantKey` (unique)
- `users`: `tenantId`, `feishuUnionId` (unique), `feishuOpenId` (unique)
- `sessions`: `userId`, `tenantId`, `expiresAt`, `revokedAt`
- `tenant_members`: 复合主键 `(userId, tenantId)`,`tenantId`, `role`
- `analyses`: 复合索引 `(tenantId, createdAt)` / `(tenantId, userId)` / `(tenantId, status)` / `(tenantId, workType)`,`overallScore`

### 2.4 设计要点

- **UUID 主键**:所有表统一 `@default(uuid())`,避免自增 ID 暴露业务量
- **snake_case 表名**:Prisma model 用大驼峰,通过 `@@map` 映射到 snake_case 表
- **多租户强制**:`User` / `Session` / `TenantMember` / `Analysis` 均含 `tenantId` 字段
- **软删除**:Phase 1 暂不引入;`Analysis` 通过 `status=failed` 表达失败,`Session` 通过 `revokedAt` 表达撤销
- **敏感数据**:`Session.refreshTokenHash` 仅存 SHA-256 哈希,禁止明文
- **外键级联**:默认 `Restrict`,需级联时显式声明

---

## 3. 飞书 OAuth 接口实现

### 3.1 接口清单

| Method | Path | 鉴权 | 限流 | 说明 |
|---|---|---|---|---|
| GET | `/auth/feishu/authorize` | 否 | 10/min | 获取飞书授权 URL + state |
| GET | `/auth/feishu/callback` | 否 | 5/min | 飞书回调,code 换 JWT |
| POST | `/auth/refresh` | 否(Cookie) | 20/min | 刷新 access_token |
| POST | `/auth/logout` | 是 | api 限流 | 撤销会话 + 黑名单 |
| GET | `/auth/me` | 是 | api 限流 | 当前用户信息 + memberships |
| GET | `/users/profile` | 是 | api 限流 | 用户资料 |
| PATCH | `/users/profile` | 是 | api 限流 | 更新资料 |
| GET | `/tenants/current` | 是 | api 限流 | 当前激活租户 + 配额 |
| POST | `/tenants/switch` | 是 | api 限流 | 切换租户 + 重签 token |
| POST | `/analyses` | 是 | api 限流 | 提交分析任务 |
| GET | `/analyses` | 是 | api 限流 | 分页查询历史 |
| GET | `/analyses/:id` | 是 | api 限流 | 单条详情 |
| GET | `/health` | 否 | 无 | 健康检查(LB/K8s 探针) |

### 3.2 OAuth 12 步流程实现对照

| 步骤 | auth-design.md 章节 | 实现位置 |
|---|---|---|
| 1. 用户点击登录 | §1.2 step 1 | 前端触发(Phase 1 任务 5) |
| 2. GET /auth/feishu/authorize | §1.2 step 2 | `auth.controller.ts#feishuAuthorize` |
| 3. 生成 state 存 Redis | §1.2 step 3 | `auth.service.ts#authorize` |
| 4. 跳转飞书授权页 | §1.2 step 4 | 前端 `window.location.replace` |
| 5. 飞书回调 | §1.2 step 5 | `auth.controller.ts#feishuCallback` |
| 6. state 三重校验(IP+UA+device_id) | §1.2 step 6 | `auth.service.ts#handleCallback` |
| 7. code 换 access_token + userinfo | §1.2 step 7 | `feishu.service.ts#exchangeCodeForToken` + `getUserInfo` |
| 8. User/TenantMember upsert | §1.2 step 8 | `auth.service.ts#upsertUserAndTenant` |
| 9. 签发 JWT(access+refresh) | §1.2 step 9 | `jwt.service.ts` + `session.service.ts` |
| 10. refresh_token Cookie + access_token 响应体 | §1.2 step 10 | `auth.controller.ts#setRefreshTokenCookie` |
| 11. 后续请求带 access_token | §1.2 step 11 | `middlewares/auth.ts` |
| 12. refresh_token 刷新(滚动) | §1.2 step 12 | `auth.service.ts#refresh` |

### 3.3 安全约束(C1-C12)遵循

| 约束 | 实现 |
|---|---|
| C1 JWT RS256 | `jwt.service.ts` 用 `JWT_PRIVATE_KEY`(PEM),启动自检 `assertRsaPrivateKey` |
| C2 refresh_token HttpOnly Cookie | `auth.controller.ts#setRefreshTokenCookie` `httpOnly: true` |
| C3 access_token 仅响应体 | `feishuCallback` 返回 `accessToken` 字段,不写 Cookie |
| C4 禁止 URL 传 token | 路由仅接收 `code` 与 `state` query |
| C5 state 校验 | `auth.service.ts#handleCallback` 三重比对 + 一次性 DEL |
| C6 tenant_id 强制 | JWT payload 含 `tenant_id` + `role`,Repository 层强制过滤 |
| C7 token 可撤销 | access_token → Redis 黑名单 `blacklist:access:{jti}`;refresh_token → Session 表 `revokedAt` |
| C8 审计日志 | 登录/登出/刷新/切换租户均落 logger.info + Session 表 |
| C9 密钥环境变量 | `env.ts` 启动校验,禁止硬编码 |
| C10 OAuth 标准 | 严格遵循飞书 OIDC 端点,不自创流程 |
| C11 默认拒绝 | `errorHandler` 未匹配路由返回 404,鉴权失败返回 401 |
| C12 日志脱敏 | `logger.ts` `redact()` 递归脱敏 token/secret/phone/email |

---

## 4. 启动流程

### 4.1 启动顺序

`src/index.ts` 严格按以下顺序初始化,任一步失败进程退出:

1. `initEnv()` - 环境变量加载与校验(必填项 + RSA 私钥类型)
2. `initLogger()` - Winston 初始化(后续日志可用)
3. `initPrisma()` - Prisma 客户端单例
4. `initRedis()` - Redis 连接(state/限流/黑名单)
5. `createApp()` - Express 应用构建(由 `app.ts` 默认导出已自动构建)
6. `http.createServer(app).listen(port)` - HTTP 服务监听

### 4.2 优雅关闭

- `SIGTERM` / `SIGINT` 触发 `gracefulShutdown`:
  - 停止接收新连接(`server.close`)
  - 关闭 Redis(`closeRedis`)
  - 关闭 Prisma(`closePrisma`)
  - 进程退出 0
- `uncaughtException` / `unhandledRejection`:记录日志后 exit(1),交由进程管理器重启

### 4.3 健康检查

- `GET /health` 返回轻量结构,不查 DB/Redis(避免雪崩)
- 返回字段:`status / service / version / nodeEnv / timestamp`
- 供 LB / K8s liveness probe 使用

---

## 5. 编译验证

### 5.1 命令与结果

| 命令 | 用途 | 结果 |
|---|---|---|
| `npm install --no-audit --no-fund` | 安装依赖 | ✅ 143 packages |
| `npm run prisma:generate` | 生成 Prisma Client | ✅ Prisma Client v5.22.0 |
| `npm run build` | TS 编译到 dist/ | ✅ exit 0,无错误 |
| `npm run typecheck` | 纯类型检查 | ✅ exit 0,无错误 |

### 5.2 编译产物

`dist/` 目录包含所有编译后的 `.js` + `.js.map` 文件,与 `src/` 结构一一对应。

### 5.3 TypeScript 严格配置

`tsconfig.json` 启用的严格选项:

- `strict: true`(总开关)
- `noImplicitAny` / `strictNullChecks` / `strictFunctionTypes`
- `strictBindCallApply` / `strictPropertyInitialization` / `noImplicitThis`
- `alwaysStrict` / `noUnusedLocals` / `noUnusedParameters`
- `noImplicitReturns` / `noFallthroughCasesInSwitch`
- `noUncheckedIndexedAccess`(数组下标返回 `T | undefined`)

---

## 6. 关键设计决策

### 6.1 logger 调用顺序兼容

业务代码大量使用 `logger.info({ meta }, 'message')` 调用顺序(对象在前),不符合 winston 默认类型定义。在 `utils/logger.ts` 中包装了一层 `WrappedLogger`,同时支持:

- `logger.info('message', { meta })` - 标准调用
- `logger.info({ meta }, 'message')` - 业务常用调用
- `logger.info({ meta, message: 'message' })` - 完整对象
- `logger.info('plain message')` - 纯文本

### 6.2 Prisma `$on` 事件类型断言

Prisma 5.x 的 `$on` 方法在 `emit: 'event'` 配置下泛型推断为 `never`,直接调用会报类型错误。通过定义本地 `PrismaEventEmitter` 接口 + 类型断言绕过,运行时行为不变。

### 6.3 Prisma JSON null 处理

`Analysis.result` 字段为 `Json?`,Prisma 要求 `null` 显式表达为 `Prisma.DbNull`(数据库 NULL)或 `Prisma.JsonNull`(JSON null)。在 `analysis.repository.ts#updateResult` 中显式处理:

```typescript
if (data.result === null) {
  updateData.result = Prisma.DbNull;
} else if (data.result !== undefined) {
  updateData.result = data.result as Prisma.InputJsonValue;
}
```

### 6.4 CORS 函数签名

`cors` 包的 `origin` 函数签名要求 `(origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => void`。提取为独立 `corsOriginChecker` 函数,显式标注类型,避免内联函数的类型推断问题。

### 6.5 ioredis 命名导入

`import Redis from 'ioredis'` 的默认导入在 TypeScript 中被识别为命名空间而非类,导致 `Cannot use namespace 'Redis' as a type`。改为命名导入 `import { Redis } from 'ioredis'`,Redis 既是值也是类型。

### 6.6 多租户过滤策略

不在 Prisma `$extends` 全局拦截器中强制 `tenant_id`,而是在 Repository 层显式传 `tenantId` 参数。理由:

- 显式更安全,避免管理后台聚合查询难以绕过
- 调用方明确知道当前操作的租户上下文
- 单元测试可独立验证每个方法的 tenant_id 过滤行为

### 6.7 Express Request 类型扩展

`src/types/express.d.ts` 通过 module augmentation 扩展 `Request` 接口,添加 `userId / tenantId / role / feishuOpenId / jti / traceId / client / deviceId` 字段。controller 中可直接 `req.userId` 访问,无需类型断言。

---

## 7. 启动与使用

### 7.1 环境准备

```bash
# 1. 复制环境变量模板
cp .env.example .env

# 2. 生成 RSA 密钥对(开发环境)
openssl genrsa -out private.pem 2048
openssl rsa -in private.pem -pubout -out public.pem

# 3. 编辑 .env,填入飞书 App ID/Secret 与密钥内容
# 注意:JWT_PRIVATE_KEY 需将 PEM 内容单行化(\n 转义),或用引号包裹多行

# 4. 启动 PostgreSQL 与 Redis(本地或 Docker)
docker run -d --name danqing-pg -e POSTGRES_USER=danqing -e POSTGRES_PASSWORD=danqing -e POSTGRES_DB=danqing -p 5432:5432 postgres:14
docker run -d --name danqing-redis -p 6379:6379 redis:7
```

### 7.2 数据库迁移

```bash
# 创建初始迁移(首次)
npm run prisma:migrate:dev -- --name init

# 生产部署
npm run prisma:migrate:deploy
```

### 7.3 开发与生产

```bash
# 开发(热重载)
npm run dev          # tsx watch src/index.ts

# 生产构建与启动
npm run build        # tsc -p tsconfig.json
npm start            # node dist/index.js

# 类型检查(无 emit)
npm run typecheck
```

### 7.4 Prisma Studio(可视化数据库)

```bash
npm run prisma:studio
# 浏览器访问 http://localhost:5555
```

---

## 8. 后续阶段交接

### 8.1 Phase 1 剩余任务(其他 Agent)

| 任务 | Agent | 依赖 |
|---|---|---|
| 飞书登录前端按钮 + 回调 | `frontend-app` | 本任务 API 契约 |
| API 测试用例(Vitest + Supertest) | `api-test-pro` | 本任务代码 + 启动服务 |
| 3 秒 SLA 性能验证(k6) | `performance-expert` | 本任务 + 真实 AI 模型 mock |

### 8.2 Phase 2 待办(本 Agent 接续)

| 待办 | 说明 |
|---|---|
| AI 模型集成 | 接入真实 AI 服务,同步(<2.5s)/异步(BullMQ 入队)/超时(3s)策略 |
| BullMQ + WebSocket | 长任务异步处理 + 实时进度推送 |
| 文件上传 | multer 中间件(≤10MB)+ OSS/CDN 集成 |
| 订阅管理 | `Subscription` model + 订阅计划升级/降级 + 配额续期 |
| 独立 Audit 表 | 写操作审计从 logger 升级为持久化 Audit 表 |
| 密码登录(可选) | 邮箱/手机号 + bcrypt(salt=12)+ 验证码 |
| Rate Limit 升级 | 从 Redis 计数升级为滑动窗口 + 用户级配额 |

### 8.3 已知技术债

| 项 | 影响 | 缓解措施 |
|---|---|---|
| `analysis.service.ts` 为 mock | 提交分析返回固定 `processing` 状态 | Phase 2 接入真实模型 |
| 无单元测试 | 覆盖率 0%(要求 ≥80%) | 待 `api-test-pro` 编写 |
| CORS 允许同源请求(无 Origin 头) | curl/Postman 可绕过白名单 | 生产环境强制要求 Origin |
| Prisma `$on` 类型断言 | 类型安全略有削弱 | 运行时行为正确,可监控 |
| 日志未落文件 | 仅控制台输出 | Phase 2 接入文件 transport + 日志聚合 |

---

## 9. 验收清单

### 9.1 代码质量

- [x] TypeScript strict mode 全部通过
- [x] 无 `any` 类型(`tsconfig.json` `noImplicitAny: true`)
- [x] 无未使用变量(`noUnusedLocals` + `noUnusedParameters`)
- [x] 无隐式 any 返回(`noImplicitReturns`)
- [x] 编译产物完整(dist/ 与 src/ 一一对应)

### 9.2 架构规范

- [x] 分层清晰(controller/service/repository/middleware)
- [x] 依赖单向(controller → service → repository → prisma)
- [x] Repository 层强制 `tenantId` 参数
- [x] 所有错误统一 `errorHandler` 处理
- [x] 所有响应统一 `success` / `error` / `paginated` 包装

### 9.3 安全规范

- [x] JWT RS256(启动自检 RSA 私钥)
- [x] refresh_token HttpOnly Cookie
- [x] state 三重校验(IP + UA + device_id)
- [x] CORS 白名单(禁止 `*`)
- [x] Helmet 安全头(CSP / HSTS / noSniff / frameguard)
- [x] 日志脱敏(token / secret / phone / email)
- [x] 限流(Redis 计数,Deny by default)
- [x] 404 兜底(不暴露路由存在性)

### 9.4 API 契约一致性

- [x] 统一响应 `{ code, message, data, traceId }`
- [x] 错误码与 `api-contract-v1.md` 一致(0/1xxx/2xxx/3xxx/4xxx/5xxx/9xxx)
- [x] Prisma schema 与 `data-model-v1.md` 一一对应
- [x] 飞书 OAuth 流程与 `auth-design.md` §1.2 12 步对齐
- [x] 多租户过滤符合 `data-model-v1.md` §7.2

### 9.5 可运维性

- [x] 健康检查 `/health`(无需鉴权)
- [x] 启动自检(缺失必填 env 拒绝启动)
- [x] 优雅关闭(SIGTERM / SIGINT)
- [x] 进程级兜底(uncaughtException / unhandledRejection)
- [x] traceId 全链路追踪(X-Trace-Id 头)

---

## 10. 文件清单

| 路径 | 行数 | 说明 |
|---|---|---|
| `prisma/schema.prisma` | ~200 | 5 model + 6 enum |
| `src/config/env.ts` | ~280 | 启动自检 + 类型化配置 |
| `src/config/prisma.ts` | ~60 | Prisma 单例 + 事件日志 |
| `src/config/redis.ts` | ~60 | Redis 单例 |
| `src/controllers/auth.controller.ts` | ~250 | 5 个 /auth/* 处理器 |
| `src/controllers/user.controller.ts` | ~80 | 用户资料 CRUD |
| `src/controllers/tenant.controller.ts` | ~55 | 租户查询/切换 |
| `src/controllers/analysis.controller.ts` | ~115 | 分析任务 3 端点 |
| `src/services/auth.service.ts` | ~320 | OAuth 12 步编排 |
| `src/services/feishu.service.ts` | ~210 | 飞书 API 调用 |
| `src/services/jwt.service.ts` | ~150 | RS256 签发/校验 |
| `src/services/session.service.ts` | ~190 | Session 双写 |
| `src/services/user.service.ts` | ~80 | 用户业务 |
| `src/services/tenant.service.ts` | ~130 | 租户业务 |
| `src/services/analysis.service.ts` | ~190 | 分析业务(Phase 1 mock) |
| `src/repositories/*.ts` | 各 60-130 | 4 个 Repository |
| `src/middlewares/*.ts` | 各 30-90 | 6 个中间件 |
| `src/routes/*.ts` | 各 20-55 | 4 个路由文件 |
| `src/types/api-contract.ts` | ~510 | API 契约 TS 类型 |
| `src/types/express.d.ts` | ~30 | Express Request 扩展 |
| `src/utils/*.ts` | 各 50-220 | 4 个工具 |
| `src/app.ts` | ~150 | Express 应用工厂 |
| `src/index.ts` | ~165 | 服务启动入口 |
| **合计** | **~3500 行** | 全部 TypeScript 严格模式 |

---

## 11. 联调对接

### 11.1 前端对接要点(`frontend-app`)

1. **登录按钮**:点击后调用 `GET /auth/feishu/authorize`,带 `X-Client-Context: { device_id, client }` 头
2. **跳转**:`window.location.replace(data.authorizeUrl)`(注意 `replace` 防止后退)
3. **回调处理**:飞书回调 `/auth/feishu/callback?code=xxx&state=xxx`,后端返回 Set-Cookie + 响应体 `accessToken`
4. **token 存储**:`accessToken` 存内存变量(不落 localStorage);`refreshToken` 由 Cookie 自动管理
5. **后续请求**:`Authorization: Bearer {accessToken}` 头
6. **刷新**:401 时调用 `POST /auth/refresh`(浏览器自动带 Cookie)

### 11.2 测试对接要点(`api-test-pro`)

1. **测试入口**:import `createApp` from `../src/app.js`,用 supertest 发请求
2. **mock 依赖**:Vitest `vi.mock` 替换 `feishu.service` / `prisma` / `redis`
3. **覆盖率要求**:`statements` / `branches` / `functions` / `lines` ≥ 80%
4. **关键场景**:
   - OAuth 完整流程(authorize → callback → me → refresh → logout)
   - state 三重校验失败(IP/UA/device_id 不匹配)
   - 限流触发(429)
   - 多租户过滤(跨租户访问 → 3004)
   - 错误码与 HTTP 状态码映射

### 11.3 性能对接要点(`performance-expert`)

1. **3 秒 SLA 验证**:k6 负载测试 `POST /analyses`,P95 < 3000ms
2. **同步/异步切换**:Phase 2 接入真实模型后,验证同步(<2.5s)与异步(≥2.5s 入队)策略
3. **限流验证**:并发请求触发 429,验证 Redis 计数准确性
4. **资源监控**:CPU / 内存 / 事件循环延迟 / GC 频率

---

**验收结论**:Phase 1 任务 4 全部完成,代码编译通过,架构与契约对齐,等待前端联调与测试用例补充。

**下一阶段**:Phase 1 任务 5(前端飞书登录)→ 任务 6(API 测试)→ 任务 7(性能验证)。
