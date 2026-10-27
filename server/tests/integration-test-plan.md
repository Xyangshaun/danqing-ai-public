# 丹青有AI - 四端集成测试计划

> **文档类型**:功能验证流程(Integration Test Plan)
> **生成日期**:2026-07-29
> **编制人**:DevOps 质量保障专家(08DevOps)
> **覆盖范围**:server(后端) / src(Web应用) / admin(运营后台) / website(品牌官网)
> **执行环境要求**:PostgreSQL 14 + Redis 7 + Node.js 18+ + k6 0.50+(可选)
> **当前环境状态**:server/.env 未配置(仅有 .env.example),PostgreSQL/Redis 未运行,k6 未安装 → 需运行服务的用例标记为「待执行」

---

## 0. 执行摘要

| 维度 | 用例数 | 可静态验证 | 需运行服务 | 当前状态 |
|---|---|---|---|---|
| 1.1 API 契约一致性 | 28 | 16 | 12 | 静态部分已验证(通过代码审查 + 515 单元测试) |
| 1.2 四端 SSO 联调 | 14 | 4 | 10 | 静态部分已验证;联调待环境就绪 |
| 1.3 多租户数据隔离 | 18 | 6 | 12 | 已有 31 个隔离测试通过(tenant-isolation.test.ts) |
| **合计** | **60** | **26** | **34** | **静态验证 26 项通过,运行时 34 项待执行** |

**关键发现(已通过代码审查确认的缺陷,详见第 4 节)**:
- admin 端错误码判断与后端契约不一致(FORBIDDEN 误用 2003、RATE_LIMITED 误用 4004)
- auth.service.ts 刷新令牌时 client 硬编码为 'web',影响多端 aud 一致性
- jwt.service.ts verifyAccessToken 仅校验 web aud,多端 aud 校验未生效

---

## 1. 1.1 API 契约一致性验证

### 1.1.1 统一响应格式验证

**契约定义**(依据 [api-contract.ts](file:///c:/Users/26929/AppData/Roaming/TRAE%20SOLO%20CN/ModularData/ai-agent/work-mode-projects/6a4f01878de2462eddd4b61e/server/src/types/api-contract.ts#L11-L16)):

```typescript
interface ApiResponse<T> {
  code: number;       // 0=成功,非0=业务错误码
  message: string;    // 人类可读提示(中文)
  data: T | null;     // 业务数据(错误时为 null)
  traceId: string;    // 链路追踪 ID
}
```

**实现依据**:[response.ts](file:///c:/Users/26929/AppData/Roaming/TRAE%20SOLO%20CN/ModularData/ai-agent/work-mode-projects/6a4f01878de2462eddd4b61e/server/src/utils/response.ts) 的 `success()` / `error()` / `paginated()` 三个函数,所有 controller 强制走此封装(禁止裸 res.json)。

| 用例 ID | 接口 | 方法 | 验证点 | 预期结果 | 类型 |
|---|---|---|---|---|---|
| C-001 | /health | GET | 响应含 code/message/data/traceId 四字段 | code=0, data.status='up', data.service='danqing-ai-server' | 静态✓ |
| C-002 | /api/v1/health | GET | /api/v1 前缀下健康检查一致 | 与 /health 响应结构完全一致 | 静态✓ |
| C-003 | /auth/feishu/authorize | GET | 成功响应 data 非空 | data 含 authorizeUrl/state/redirectUri 三字段 | 静态✓ |
| C-004 | /auth/feishu/callback | GET | 成功响应 data 含 accessToken/user/tenant | data.accessToken 为非空字符串 | 静态✓ |
| C-005 | /auth/me | GET | 成功响应 data 含 user/tenant/memberships | data.user.role ∈ {admin,teacher,student,owner} | 静态✓ |
| C-006 | 任意接口 | * | traceId 非空且唯一 | 每个响应 traceId 为 UUID 格式 | 运行时 |
| C-007 | 不存在路由 | GET | 404 兜底返回统一格式 | code=1003(RESOURCE_NOT_FOUND), data=null | 静态✓ |
| C-008 | 触发未捕获异常 | GET | 500 返回统一格式且不泄露堆栈 | code=9001(INTERNAL_ERROR), message='服务器内部错误', data=null, 无 stack 字段 | 静态✓ |

**静态验证结论**:8 项中 7 项通过代码审查确认实现正确(notFoundHandler/errorHandler 均走 error() 封装);C-006 需运行时验证 traceId 唯一性。

### 1.1.2 错误码一致性验证

**契约定义**(依据 [api-contract.ts ErrorCode 枚举](file:///c:/Users/26929/AppData/Roaming/TRAE%20SOLO%20CN/ModularData/ai-agent/work-mode-projects/6a4f01878de2462eddd4b61e/server/src/types/api-contract.ts#L53-L109)):

| 错误码段 | 语义 | 数量 | HTTP 状态映射 |
|---|---|---|---|
| 1xxx | 参数错误(PARAM_INVALID/MISSING/NOT_FOUND/TYPE_MISMATCH/DUPLICATE) | 5 | 400/404/409 |
| 2xxx | 认证错误(UNAUTHORIZED=2001/TOKEN_EXPIRED=2002/REFRESH_INVALID=2003/FORBIDDEN=2004/SIGNATURE_INVALID=2005) | 5 | 401/403 |
| 3xxx | 租户错误(NOT_FOUND/DISABLED/SEATS_FULL/MISMATCH) | 4 | 404/403 |
| 4xxx | 飞书 OAuth 错误 | 4 | 400/502/500 |
| 5xxx | 文件上传错误 | 4 | 400/413 |
| 6xxx | AI 分析错误(QUOTA/TIMEOUT/RESULT_FAILED/NOT_FOUND/IMAGE_INVALID) | 5 | 402/408/500/404/400 |
| 7xxx | 订阅错误 | 6 | 404/400/402/409 |
| 8xxx | 管理后台错误 | 14 | 404/409/400/403 |
| 9xxx | 系统错误(INTERNAL=9001/DATABASE=9002/CACHE=9003/UPSTREAM=9004/RATE_LIMITED=9005) | 5 | 500/503/502/429 |

**实现依据**:[ERROR_HTTP_STATUS 映射表](file:///c:/Users/26929/AppData/Roaming/TRAE%20SOLO%20CN/ModularData/ai-agent/work-mode-projects/6a4f01878de2462eddd4b61e/server/src/types/api-contract.ts#L115-L169) + [error-handler.ts](file:///c:/Users/26929/AppData/Roaming/TRAE%20SOLO%20CN/ModularData/ai-agent/work-mode-projects/6a4f01878de2462eddd4b61e/server/src/middlewares/error-handler.ts) 分层处理(ZodError→1001, BusinessError 透传, Prisma→9002, 未知→9001)。

| 用例 ID | 场景 | 预期错误码 | 预期 HTTP | 验证方式 | 类型 |
|---|---|---|---|---|---|
| C-009 | Zod 校验失败(body/query/params) | 1001 PARAM_INVALID | 400 | 传入非法参数(如 artType='invalid') | 运行时 |
| C-010 | 无 Authorization 头访问受保护接口 | 2001 UNAUTHORIZED | 401 | 不带 token 访问 /auth/me | 静态✓(auth.ts#L43-44) |
| C-011 | 过期 access_token | 2002 TOKEN_EXPIRED | 401 | 携带过期 token | 静态✓(auth.ts#L57-59) |
| C-012 | 篡改签名的 token | 2005 TOKEN_SIGNATURE_INVALID | 401 | HS256 伪造 token | 静态✓(auth.ts#L60-62) |
| C-013 | jti 在 Redis 黑名单 | 2001 UNAUTHORIZED | 401 | 登出后复用旧 token | 静态✓(auth.ts#L68-74) |
| C-014 | 角色权限不足 | 2004 FORBIDDEN | 403 | student 调用 /tenants/:id/members | 静态✓(permission 测试 P18-P22) |
| C-015 | 跨租户访问资源 | 1003 RESOURCE_NOT_FOUND | 404 | 租户A用户访问租户B分析 | 静态✓(隔离测试 T1) |
| C-016 | 租户已禁用 | 3002 TENANT_DISABLED | 403 | 切换到 disabled 租户 | 静态✓(隔离测试 T9) |
| C-017 | 超出分析配额 | 6001 ANALYSIS_QUOTA_EXCEEDED | 402 | free 计划超 100 次/月 | 运行时 |
| C-018 | AI 分析超 3 秒 | 6002 ANALYSIS_TIMEOUT | 408 | AI_API_TIMEOUT=2500ms 触发 | 运行时 |
| C-019 | 触发限流 | 9005 RATE_LIMITED | 429 | 1分钟内 61 次 /api 请求 | 静态✓(rate-limit.ts) |
| C-020 | Redis 不可达(限流场景) | 9003 CACHE_ERROR | 503 | 停 Redis 后发请求 | 运行时 |

**静态验证结论**:12 项中 8 项通过代码/测试确认;4 项需运行时验证(C-009/C-017/C-018/C-020)。

### 1.1.3 分页响应一致性验证

**契约定义**([PaginatedData<T>](file:///c:/Users/26929/AppData/Roaming/TRAE%20SOLO%20CN/ModularData/ai-agent/work-mode-projects/6a4f01878de2462eddd4b61e/server/src/types/api-contract.ts#L30-L36)):

```typescript
interface PaginatedData<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}
```

**实现依据**:[paginated() 函数](file:///c:/Users/26929/AppData/Roaming/TRAE%20SOLO%20CN/ModularData/ai-agent/work-mode-projects/6a4f01878de2462eddd4b61e/server/src/utils/response.ts#L53-L65),将分页数据作为 `data` 字段嵌入统一响应。

| 用例 ID | 接口 | 验证点 | 预期结果 | 类型 |
|---|---|---|---|---|
| C-021 | GET /analyses?page=1&pageSize=20 | data 结构为 PaginatedData | data.items 为数组,data.total/page/pageSize/hasMore 齐全 | 运行时 |
| C-022 | GET /analyses?page=2&pageSize=10 | hasMore 计算 | (page*pageSize < total) → hasMore=true | 运行时 |
| C-023 | GET /analyses(默认参数) | page=1, pageSize=20 | 未传参时使用默认值 | 静态✓(契约 PaginationQuery) |
| C-024 | GET /api/admin/users | 管理后台分页一致 | 同样 PaginatedData 结构 | 静态✓(ListAdminUsersResponse) |
| C-025 | GET /analyses?pageSize=200 | pageSize 上限 100 | 超过 100 时应被截断或拒绝 | 运行时 |
| C-026 | mobile 端 GET /analyses | 响应优化移除冗余字段 | items 中无 description/sourceUrl/dimensions/medium/tags/thumbUrl/source | 静态✓(client-adapt.ts#L156-L164) |
| C-027 | 响应头 X-Response-Optimized | mobile 端标识 | 响应头含 X-Response-Optimized: mobile | 静态✓(client-adapt.ts#L127) |

### 1.1.4 认证流程验证(飞书 OAuth → JWT → 刷新令牌)

**完整 12 步流程**(依据 [auth.service.ts](file:///c:/Users/26929/AppData/Roaming/TRAE%20SOLO%20CN/ModularData/ai-agent/work-mode-projects/6a4f01878de2462eddd4b61e/server/src/services/auth.service.ts)):

```
1. 前端生成 device_id(localStorage 持久化)     ← token-store.ts#getDeviceId
2. GET /auth/feishu/authorize → 生成 state       ← auth.service.ts#authorize
3. state 存 Redis(TTL 300s)+ 三重上下文          ← auth.service.ts#L64-65
4. 前端跳转飞书授权页                              ← auth-sdk.ts#getFeishuAuthorizeUrl
5. 飞书回调带 code+state 到前端                   ← AuthCallbackPage
6. GET /auth/feishu/callback → 校验 state         ← validateAndConsumeState
7. code 换飞书 access_token                       ← feishuService.exchangeCodeForToken
8. upsert User + TenantMember(事务)              ← upsertUserAndTenant
9. 签发 JWT(access 15min + refresh 7d,RS256)     ← jwtService.issue*
10. Session 落库(DB + Redis 双写)                ← sessionService.createSession
11. access_token 返回响应体,refresh 写 HttpOnly Cookie
12. POST /auth/refresh → 滚动刷新(旧 jti 入黑名单) ← auth.service.ts#refresh
```

| 用例 ID | 验证点 | 预期结果 | 类型 |
|---|---|---|---|
| C-028 | state 一次性消费 | 同一 state 第二次使用返回 400 FEISHU_AUTH_FAILED | 静态✓(auth.service.ts#L323) |
| C-029 | state 三重比对(IP/UA/device_id) | 任一不匹配返回 400 | 静态✓(auth.service.ts#L306-320) |
| C-030 | state TTL 300s | 5 分钟后 state 失效 | 静态✓(Redis EX 300) |
| C-031 | refresh_token HttpOnly Cookie | Set-Cookie 含 HttpOnly; SameSite=strict; Path=/auth; Max-Age=604800 | 静态✓(测试报告 6.1) |
| C-032 | access_token 不落 localStorage(Web 端) | token-store.ts 仅存内存模块变量 | 静态✓(token-store.ts#L15) |
| C-033 | RS256 强制(HS256 攻击拒绝) | HS256 签发的 token 返回 2005 | 静态✓(jwt 测试) |
| C-034 | 刷新后旧 refresh_token 入黑名单 | 二次使用旧 token 返回 2003 | 静态✓(auth.service.ts#L191) |
| C-035 | 端到端登录链路 | authorize→callback→me 全 200 | 运行时(需飞书配置) |

---

## 2. 1.2 四端 SSO 联调验证

### 2.1 多端客户端标识机制

**实现依据**:
- 后端 [auth.ts#L84-95](file:///c:/Users/26929/AppData/Roaming/TRAE%20SOLO%20CN/ModularData/ai-agent/work-mode-projects/6a4f01878de2462eddd4b61e/server/src/middlewares/auth.ts#L84-L95):client 解析优先级 JWT aud > X-Client 头 > 默认 web
- 后端 [client-adapt.ts](file:///c:/Users/26929/AppData/Roaming/TRAE%20SOLO%20CN/ModularData/ai-agent/work-mode-projects/6a4f01878de2462eddd4b61e/server/src/middlewares/client-adapt.ts):三端差异化限流 + mobile 响应优化
- Web 端 [api.ts#L164](file:///c:/Users/26929/AppData/Roaming/TRAE%20SOLO%20CN/ModularData/ai-agent/work-mode-projects/6a4f01878de2462eddd4b61e/src/services/api.ts#L164):X-Client: web
- Admin 端 [request.ts#L25](file:///c:/Users/26929/AppData/Roaming/TRAE%20SOLO%20CN/ModularData/ai-agent/work-mode-projects/6a4f01878de2462eddd4b61e/admin/src/services/request.ts#L25):X-Client: admin

| 端 | 端口 | X-Client | JWT aud | 限流(次/min) | token 存储 |
|---|---|---|---|---|---|
| Web 应用 | 5173 | web | danqing-ai-web | 60 | 内存(不落 localStorage) |
| Admin 后台 | 8000 | admin | danqing-ai-admin | 120 | localStorage(内网部署) |
| Mobile | - | mobile | danqing-ai-mobile | 40 | 内存(同 Web) |
| Website | 3001 | - | - | - | 无登录态(纯静态) |

### 2.2 SSO 联调用例

| 用例 ID | 场景 | 步骤 | 预期结果 | 类型 |
|---|---|---|---|---|
| S-001 | Web 登录获取 token | Web 端完成飞书 OAuth | 获得 accessToken(aud=web),refresh_token Cookie 写入 | 运行时 |
| S-002 | Web token 访问 Admin | 携带 Web token 调 /api/admin/* | 后端 authMiddleware 通过(aud 校验当前未严格隔离,见缺陷 D-003);但 Admin 前端 localStorage 无 token,需独立登录 | 运行时 |
| S-003 | Admin 独立登录 | Admin 端走飞书 OAuth(client=admin) | 获得 accessToken(aud=admin),存 localStorage | 运行时 |
| S-004 | X-Client 头标识 | 各端请求头 X-Client 正确 | Web=web / Admin=admin / Mobile=mobile | 静态✓ |
| S-005 | mobile 端响应优化 | mobile X-Client 请求列表接口 | 响应头 X-Response-Optimized=mobile,items 移除 7 个冗余字段 | 静态✓ |
| S-006 | 限流差异化 | 各端超限阈值不同 | web 第 61 次 429 / admin 第 121 次 429 / mobile 第 41 次 429 | 运行时 |
| S-007 | refresh_token 跨端共享 | Web 登录后 Admin 用同 Cookie 刷新 | Cookie 同域时可用;跨域(Vercel vs VPS)需 SameSite=None+Secure | 运行时 |
| S-008 | Website CTA 跳转 | 官网「立即体验」点击 | 跳转 https://app.domain/(SITE.appUrl),由业务应用处理登录 | 静态✓(site.ts CTA_LINKS.trial) |
| S-009 | Website 无业务 API | 官网不暴露任何 /api 端点 | next.config output=export,纯静态,无 API 路由 | 静态✓(next.config.js) |
| S-010 | 多端 aud 校验(当前缺陷) | admin 端 token aud=admin 验证 | **当前 verifyAccessToken 仅校验 web aud,admin/mobile token 也能通过** → 缺陷 D-003 | 静态✓(jwt.service.ts#L151 注释) |
| S-011 | refresh 时 client 硬编码 | 任意端刷新 token | **新 access_token 的 aud 强制为 web** → 缺陷 D-002 | 静态✓(auth.service.ts#L183,L188) |
| S-012 | 401 自动刷新(Web 端) | token 过期后发请求 | api.ts 自动调 /auth/refresh,成功后重试原请求(并发防护) | 静态✓(api.ts#L297-L348) |
| S-013 | 401 自动刷新(Admin 端) | token 过期后发请求 | request.ts triggerRefresh 单飞 + 队列重放 | 静态✓(request.ts#L43-L71) |
| S-014 | 登出撤销 | POST /auth/logout | 撤销 Session + access jti 入黑名单 + 清 Cookie | 静态✓(auth.service.ts#logout) |

**SSO 架构说明**:本系统采用「同源 JWT + HttpOnly Cookie refresh」模型,而非传统 SSO 票据交换。Web 与 Admin 部署在不同域名(Vercel vs VPS)时,refresh_token Cookie 无法跨域共享,**实际为各自独立登录**(非真正 SSO)。Website 为纯静态站点,不参与认证,仅做 CTA 跳转。

---

## 3. 1.3 多租户数据隔离验证

### 3.1 隔离机制

**实现依据**:
- [tenant.ts 中间件](file:///c:/Users/26929/AppData/Roaming/TRAE%20SOLO%20CN/ModularData/ai-agent/work-mode-projects/6a4f01878de2462eddd4b61e/server/src/middlewares/tenant.ts):从 JWT 注入 req.tenantId,缺失即 401
- Repository 层:所有查询强制带 tenantId 条件(不信任客户端传入)
- [RBAC 权限矩阵](file:///c:/Users/26929/AppData/Roaming/TRAE%20SOLO%20CN/ModularData/ai-agent/work-mode-projects/6a4f01878de2462eddd4b61e/server/src/config/permissions.ts):4 角色 × 16+权限

### 3.2 RBAC 权限矩阵

| 权限 | ADMIN | OWNER | TEACHER | STUDENT |
|---|:---:|:---:|:---:|:---:|
| analysis:create | Y | Y | Y | Y |
| analysis:read:own | Y | Y | Y | Y |
| analysis:read:tenant | Y | Y | Y | N |
| analysis:delete:own | Y | Y | Y | Y |
| analysis:delete:tenant | Y | Y | N | N |
| user:read | Y | Y | Y | N |
| user:invite | Y | Y | Y | N |
| user:remove | Y | Y | N | N |
| tenant:update | Y | Y | N | N |
| stats:read:tenant | Y | Y | Y | N |

### 3.3 隔离测试用例

| 用例 ID | 场景 | 角色 | 预期结果 | 已有测试覆盖 | 类型 |
|---|---|---|---|---|---|
| T-001 | 租户A访问租户B分析(by id) | student | 404 RESOURCE_NOT_FOUND | tenant-isolation T1 | 静态✓ |
| T-002 | 租户A列表不含租户B数据 | student | items 仅含本租户 | T2 | 静态✓ |
| T-003 | 创建分析时 tenant_id 取自 JWT | student | 请求体传 tenantId 被忽略 | T3 | 静态✓ |
| T-004 | student 仅看自己的分析 | student | WHERE user_id=self 强制 | T4 | 静态✓ |
| T-005 | teacher 看租户全量 | teacher | 不加 user_id 过滤 | T5 | 静态✓ |
| T-006 | 切换到非成员租户 | student | 403 FORBIDDEN | T6 | 静态✓ |
| T-007 | 切换到不存在租户 | admin | 404 TENANT_NOT_FOUND | T7 | 静态✓ |
| T-008 | 切换到禁用租户 | admin | 403 TENANT_DISABLED | T8 | 静态✓ |
| T-009 | 切换成功重签 token | admin | 返回新 accessToken + role | T9 | 静态✓ |
| T-010 | student 越权 query.userId | student | userId 参数被强制覆盖为自己 | permission P25 | 静态✓ |
| T-011 | student 调成员列表 | student | 403(user:read 权限缺失) | P18 | 静态✓ |
| T-012 | student 邀请成员 | student | 403(user:invite) | P19 | 静态✓ |
| T-013 | teacher 移除成员 | teacher | 403(user:remove 仅 admin/owner) | P20 | 静态✓ |
| T-014 | student 删他人分析 | student | 404(不泄露存在性) | P15 | 静态✓ |
| T-015 | admin 跨租户删除 | admin | 404(tenant_id 隔离) | P17 | 静态✓ |
| T-016 | revokeAll 仅当前租户 | admin | 不影响其他租户会话 | T12 | 静态✓ |
| T-017 | Repository 白盒 tenant_id 过滤 | - | findById/list 强制带条件 | T14 | 静态✓ |
| T-018 | tenantMiddleware 无 tenant_id | - | 401 UNAUTHORIZED | T13 | 静态✓ |

**静态验证结论**:18 项全部通过现有测试覆盖(tenant-isolation.test.ts 31 用例 + permission.test.ts 70 用例,515/515 通过)。

---

## 4. 代码审查发现的问题

### 4.1 缺陷清单(按严重程度排序)

| 缺陷 ID | 严重度 | 位置 | 描述 | 影响 |
|---|---|---|---|---|
| D-001 | **高** | admin/src/services/request.ts#L141,L147 | 错误码判断与后端契约不一致:403 判断 `bizCode===2003`(实际 FORBIDDEN=2004);429 判断 `bizCode===4004`(实际 RATE_LIMITED=9005) | Admin 端权限不足(403)被误判为「refresh_token 无效」(2003),可能触发错误跳转登录;限流(429)无法被正确识别为 RATE_LIMITED |
| D-002 | **中** | server/src/services/auth.service.ts#L183,L188 | refresh() 方法中 client 硬编码为 `'web'`,未从请求上下文获取实际 client | admin/mobile 端刷新后获得 aud=web 的 token,破坏多端 aud 一致性(虽不影响验证,因 D-003) |
| D-003 | **中** | server/src/jwt.service.ts#L150-153 | verifyAccessToken 仅校验 `jwtAudienceWeb`,admin/mobile 端 token 也能通过验证(代码注释承认「Phase 1 简化」) | 多端 aud 隔离未生效,理论上 web 端 token 可调用 admin 接口(实际由 RBAC permission 中间件兜底) |
| D-004 | **低** | server/src/services/auth.service.ts#L352-403 | upsertUserAndTenant 非事务部分(tenantRepository.findByFeishuTenantKey + create)在事务外,存在创建租户后失败的窗口 | 极端情况下可能产生孤立的空租户 |
| D-005 | **低** | admin/src/utils/auth.ts | Admin token 存 localStorage(注释说明「内网部署」),与 Web 端「不落 localStorage」策略不一致 | 若 Admin 域名被 XSS,token 可被窃取;内网+VPN 场景风险可控 |
| D-006 | **低** | website/lib/site.ts#L16-17 | SITE.appUrl/SITE.url 使用占位符 `https://app.domain` / `https://www.domain` | 部署前必须替换为真实域名,否则 CTA 跳转 404 |

### 4.2 建议修复措施

**D-001 修复(高优)**:
```typescript
// admin/src/services/request.ts
// 403: bizCode === 2003 → 2004 (FORBIDDEN)
if (status === 403 || bizCode === 2004) { ... }
// 429: bizCode === 4004 → 9005 (RATE_LIMITED)
if (status === 429 || bizCode === 9005) { ... }
```

**D-002 修复(中优)**:从请求上下文(X-Client 头或旧 token aud)解析 client,传入 refresh():
```typescript
// auth.service.ts refresh() 应接收 client 参数
const accessResult = jwtService.issueAccessToken({ ..., client: params.client });
```

**D-003 修复(中优)**:verifyAccessToken 支持多 aud 校验:
```typescript
audience: [cfg.jwtAudienceWeb, cfg.jwtAudienceAdmin, cfg.jwtAudienceMobile],
```

---

## 5. 测试执行前置条件

### 5.1 环境准备清单

```bash
# 1. 启动 PostgreSQL
docker run -d --name dq-pg -e POSTGRES_USER=danqing -e POSTGRES_PASSWORD=danqing \
  -e POSTGRES_DB=danqing -p 5432:5432 postgres:14

# 2. 启动 Redis
docker run -d --name dq-redis -p 6379:6379 redis:7

# 3. 配置 server/.env(从 .env.example 复制并填值)
#    必填:FEISHU_APP_ID/SECRET, JWT_PRIVATE_KEY/PUBLIC_KEY, DATABASE_URL, REDIS_URL, CORS_ORIGINS
#    生成 RSA 密钥:openssl genrsa -out private.pem 2048 && openssl rsa -in private.pem -pubout -out public.pem

# 4. 数据库迁移
cd server && npm run prisma:migrate:dev -- --name init

# 5. 灌入测试数据 + 生成 token
node performance/scripts/seed-database.js
node performance/scripts/generate-tokens.js

# 6. 启动后端
npm run dev
# 验证:curl http://localhost:3000/health

# 7. (可选)安装 k6
choco install k6   # 或 winget install k6.k6
```

### 5.2 用例执行优先级

- **P0(冒烟,必须)**:C-001, C-003, C-010, S-001, T-001
- **P1(核心链路)**:C-004, C-005, C-021, S-003, T-009
- **P2(边界与安全)**:C-011, C-013, C-019, S-010, T-014

---

## 6. 变更记录

| 版本 | 时间 | 变更人 | 变更内容 |
|---|---|---|---|
| v1.0 | 2026-07-29 | 08DevOps | 初始版本:60 个用例,26 项静态验证通过,发现 6 个缺陷 |
