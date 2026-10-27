# Phase 1 任务 6 - 飞书 OAuth 接口测试验收报告

> **生成时间**: 2026-07-27
> **任务编号**: Phase 1 - Task 6
> **测试框架**: Vitest 2.1 + Supertest 7.0 + @vitest/coverage-v8
> **执行命令**: `npm run test:coverage`

---

## 一、验收结论

### PASS - 全部验收项达标

| 验收项 | 要求 | 实际 | 状态 |
| --- | --- | --- | --- |
| 测试用例总数 | ≥ 50 | 260 | PASS |
| 测试通过率 | 100% | 100% (260/260) | PASS |
| Statements 覆盖率 | ≥ 80% | 91.61% (1879/2051) | PASS |
| Branches 覆盖率 | ≥ 80% | 80.50% (413/513) | PASS |
| Functions 覆盖率 | ≥ 80% | 91.33% (116/127) | PASS |
| Lines 覆盖率 | ≥ 80% | 91.61% (1879/2051) | PASS |
| 5 个 P0 接口覆盖 | 全部覆盖 | 全部覆盖 | PASS |
| 关键中间件覆盖 | auth/tenant/rate-limit/validate | 全部覆盖 | PASS |
| 多租户隔离测试 | 覆盖 | 31 个用例 | PASS |
| OAuth 安全测试 | state/CSRF/签名/黑名单 | 全部覆盖 | PASS |
| 执行时长 | < 30s | 1.68s | PASS |

---

## 二、测试覆盖矩阵

### 2.1 P0 接口测试覆盖 (auth.controller.test.ts)

| 接口 | 正常路径 | 边界条件 | 异常分支 | 限流 | 总计 |
| --- | --- | --- | --- | --- | --- |
| `GET /auth/feishu/authorize` | 4 | 1 | 1 | 1 | 7 |
| `GET /auth/feishu/callback` | 2 | 8 | 6 | 1 | 17 |
| `POST /auth/refresh` | 2 | 0 | 7 | 0 | 9 |
| `POST /auth/logout` | 4 | 1 | 1 | 0 | 6 |
| `GET /auth/me` | 1 | 0 | 6 | 0 | 7 |
| `GET /health` | 3 | 0 | 0 | 0 | 3 |
| **合计** | **16** | **10** | **21** | **2** | **49** |

### 2.2 服务层单元测试

| 文件 | 测试用例 | 覆盖范围 |
| --- | --- | --- |
| `jwt.service.test.ts` | 24 | access_token 签发/校验、refresh_token 签发/校验、过期/签名/iss/aud/jti 校验 |
| `feishu.service.test.ts` | 18 | getAccessToken、getUserInfo、token 交换失败、用户信息缺失 union_id |
| **合计** | **42** | |

### 2.3 中间件测试 (middlewares.test.ts)

| 中间件 | 测试用例 | 覆盖场景 |
| --- | --- | --- |
| `authMiddleware` | 7 | 有效 token、缺失 Authorization、空 token、非 Bearer、过期、签名无效、黑名单、HS256 攻击 |
| `tenantMiddleware` | 2 | tenant_id 存在/缺失 |
| `createRateLimiter` | 5 | 未达限/触发 429/Retry-After 头/IP 隔离/X-Forwarded-For |
| `validate` | 7 | body/query/params 校验、ZodError 透传、headers 校验 |
| **合计** | **22** | |

### 2.4 多租户隔离测试 (tenant-isolation.test.ts)

| 场景组 | 用例数 | 验收点 |
| --- | --- | --- |
| T1: GET /analyses/:id 跨租户访问拦截 | 2 | 跨租户返回 404,同租户返回 200 |
| T2: GET /analyses 列表跨租户隔离 | 2 | 仅返回当前租户数据 |
| T3: POST /analyses 创建分析租户归属 | 1 | tenant_id 取自 JWT 而非请求体 |
| T4: GET /analyses 学生角色租户内隔离 | 2 | 学生仅能看到自己的分析 |
| T5: GET /analyses 教师/管理员全量可见 | 3 | 教师/管理员可见全租户数据 |
| T6-T9: POST /tenants/switch 切换租户 | 4 | 非成员 403、不存在 404、禁用 403、成功签发新 token |
| T10: GET /tenants/current 当前租户 | 3 | 正常返回、JWT 租户不存在 404、租户禁用 403 |
| T11: PATCH /users/profile 跨租户拦截 | 2 | 用户 tenant_id 与 JWT 不匹配 401 |
| T12: POST /auth/logout revokeAll 隔离 | 1 | revokeAll 仅撤销当前租户会话 |
| T13: tenantMiddleware 无 tenant_id 拦截 | 2 | JWT 缺 tenant_id、无 Authorization |
| T14: analysisRepository 白盒测试 | 6 | findById/list/updateResult/count 强制 tenant_id 过滤 |
| T15: 完整跨租户访问链路端到端 | 2 | 直接 ID 跨租户访问拦截 |
| 配额隔离 | 1 | 租户间配额独立计算 |
| **合计** | **31** | |

### 2.5 配置与基础设施测试

| 文件 | 用例数 | 覆盖范围 |
| --- | --- | --- |
| `env.test.ts` | 62 | loadEnv 正常路径、parseBoolean/Integer/SameSite/LogLevel/NodeEnv/TenantPlan/TenantType 全分支、assertRequired、RSA 密钥校验、CORS_ORIGINS 校验、initEnv/env 单例 |
| `error-handler.test.ts` | 20 | ZodError→400、BusinessError 透传、Prisma 错误、未知错误→500、非 Error 值、缺 traceId 兜底、notFoundHandler、response utils (success/error/paginated) |
| `utils-and-controllers.test.ts` | 34 | crypto 工具(sha256/generateState/generateJti/isValidStateFormat/safeEqual)、user.controller 防御性分支、auth.controller redirect_uri 分支 |
| **合计** | **116** | |

---

## 三、测试用例命名规范

所有测试用例均遵循 `should_expectedBehavior_when_specificCondition` 命名模式,示例:

- `should_return_401_when_token_expired`
- `should_return_404_when_tenant_a_user_access_tenant_b_analysis_by_id`
- `should_return_403_when_switch_to_tenant_user_not_member_of`
- `should_revoke_only_current_tenant_sessions_when_revokeAll`
- `should_consume_state_one_time_only`
- `should_reject_hs256_token_to_enforce_rs256`

---

## 四、Mock 与测试辅助工具

### 4.1 Mock 实现

| Mock 文件 | 用途 | 关键特性 |
| --- | --- | --- |
| `mocks/redis.mock.ts` | Redis 内存模拟 | Map 数据结构、TTL 过期、incr/expire/exists/get/set/del |
| `mocks/prisma.mock.ts` | Prisma 数据库模拟 | userStore/tenantStore/sessionStore/analysisStore/memberStore,Where 条件匹配(equals/gte/lte/gt/lt/in),Date 比较 |
| `mocks/feishu-api.mock.ts` | 飞书 OpenAPI 模拟 | getAccessToken/getUserInfo,可注入失败响应 |
| `mocks/jwt-keys.mock.ts` | RSA 密钥对 | 启动时生成 2048 位 RSA 密钥对,test-kid-2026 |

### 4.2 测试 Helper

| Helper 文件 | 用途 |
| --- | --- |
| `helpers/test-app.ts` | 构造测试 Express app(注入 mock 依赖,单例缓存) |
| `helpers/fixtures.ts` | 测试数据工厂(createTestUser/Tenant/Session/TokenSet/State) |
| `helpers/assertions.ts` | 自定义断言(assertApiResponse/assertApiError/assertRefreshTokenCookie/assertTraceIdHeader/assertNoSensitiveDataInBody) |

---

## 五、覆盖率详情

### 5.1 按目录分布

| 目录 | Statements | Branches | Functions | Lines |
| --- | --- | --- | --- | --- |
| src/ | 92.40% | 60.00% | 100% | 92.40% |
| src/config/ | 98.77% | 96.34% | 100% | 98.77% |
| src/controllers/ | 89.83% | 69.00% | 100% | 89.83% |
| src/middlewares/ | 92.61% | 89.70% | 93.33% | 92.61% |
| src/repositories/ | 82.92% | 79.31% | 81.48% | 82.92% |
| src/routes/ | 100% | 100% | 100% | 100% |
| src/services/ | 95.14% | 76.88% | 100% | 95.14% |
| src/utils/ | 80.90% | 81.39% | 76.19% | 80.90% |
| **All files** | **91.61%** | **80.50%** | **91.33%** | **91.61%** |

### 5.2 OAuth 关键模块覆盖率

| 模块 | Statements | Branches | 验收评价 |
| --- | --- | --- | --- |
| auth.controller.ts | 81.57% | 44.82% | branches 偏低,主要由 extractClientContext 防御性分支难以触发,但 OAuth 主链路 100% 覆盖 |
| auth.service.ts | 94.52% | 84.90% | 良好 |
| jwt.service.ts | 92.45% | 75.00% | 良好 |
| feishu.service.ts | 100% | 75.00% | 良好 |
| session.service.ts | 92.17% | 71.42% | 良好 |
| auth.ts (middleware) | 84.09% | 85.71% | 良好 |
| tenant.ts (middleware) | 100% | 100% | 优秀 |
| validate.ts (middleware) | 92.59% | 100% | 优秀 |
| rate-limit.ts | 88.88% | 80.00% | 良好 |

---

## 六、安全测试要点

### 6.1 OAuth 安全

- [x] **state 一次性消费**: 第二次使用相同 state 返回 400
- [x] **state CSRF 防护**: clientIp/userAgent/deviceId 不匹配时返回 400
- [x] **state 格式校验**: 非 64 字符 hex 返回 400
- [x] **state 不存在 Redis**: 返回 400
- [x] **refresh_token HttpOnly Cookie**: 验证 HttpOnly/SameSite=Strict/Path=/auth/Max-Age=604800
- [x] **登出清除 Cookie**: 验证 Set-Cookie 包含清除头
- [x] **refresh_token 轮转**: 刷新后旧 token 加入黑名单
- [x] **access_token 黑名单**: 登出后旧 token 不可用

### 6.2 JWT 安全

- [x] **RS256 算法强制**: HS256 token 被拒绝
- [x] **签名校验**: 错误私钥签发的 token 返回 401 (TOKEN_SIGNATURE_INVALID)
- [x] **过期校验**: 过期 token 返回 401 (TOKEN_EXPIRED)
- [x] **iss/aud 校验**: 不匹配的签发者/受众被拒绝
- [x] **clockTolerance 适配**: 过期时间设为 -100s 以超越 30s 容差

### 6.3 多租户数据隔离

- [x] **跨租户访问拦截**: 租户 A 用户无法访问租户 B 的分析记录(返回 404)
- [x] **租户切换校验**: 仅成员可切换,非成员返回 403
- [x] **学生角色隔离**: 学生仅可见自己的分析,无法通过 userId 参数越权
- [x] **教师/管理员可见全租户**: 角色权限正确分级
- [x] **JWT tenant_id 强制**: 创建分析时 tenant_id 取自 JWT 而非请求体
- [x] **revokeAll 仅当前租户**: 登出 revokeAll 不影响其他租户会话
- [x] **Repository 白盒测试**: findById/list/updateResult/count 强制 tenant_id 过滤

### 6.4 限流

- [x] **/auth/feishu/authorize**: 10 次/分钟/IP,第 11 次返回 429
- [x] **/auth/feishu/callback**: 5 次/分钟/IP
- [x] **Retry-After 头**: 429 响应包含 Retry-After: 60
- [x] **IP 隔离**: 不同 IP 独立计数
- [x] **X-Forwarded-For**: 优先取首段 IP

### 6.5 敏感数据脱敏

- [x] **响应体无 refresh_token**: assertNoSensitiveDataInBody 验证
- [x] **响应体无 app_secret/private_key**: 正则匹配检测
- [x] **错误信息不暴露堆栈**: errorHandler 返回固定 "服务器内部错误"
- [x] **错误信息不暴露原始错误**: unknown error 不返回 err.message

---

## 七、测试执行

### 7.1 命令

```bash
# 运行全部测试
npm test

# 运行并生成覆盖率报告
npm run test:coverage

# 监听模式
npm run test:watch

# CI 模式(JUnit + verbose)
npm run test:ci
```

### 7.2 执行结果

```
Test Files  8 passed (8)
     Tests  260 passed (260)
  Duration  1.68s (transform 492ms, setup 1.25s, collect 2.83s, tests 1.01s)
```

### 7.3 覆盖率阈值

`vitest.config.ts` 中配置的硬约束(不达标 CI 失败):

```typescript
thresholds: {
  statements: 80,
  branches: 80,
  functions: 80,
  lines: 80,
}
```

---

## 八、测试文件清单

```
server/tests/
├── README.md                          # 本验收报告
├── setup.ts                           # 全局 setup:mock 注入与 env 初始化
├── auth.controller.test.ts            # P0 接口集成测试 (49 用例)
├── feishu.service.test.ts             # 飞书服务单元测试 (18 用例)
├── jwt.service.test.ts                # JWT 服务单元测试 (24 用例)
├── middlewares.test.ts                # 中间件单元测试 (22 用例)
├── tenant-isolation.test.ts           # 多租户隔离测试 (31 用例)
├── env.test.ts                        # 环境变量加载测试 (62 用例)
├── error-handler.test.ts              # 错误处理与响应封装测试 (20 用例)
├── utils-and-controllers.test.ts      # 工具与控制器补充测试 (34 用例)
├── helpers/
│   ├── test-app.ts                    # 测试 Express app 构造
│   ├── fixtures.ts                    # 测试数据工厂
│   └── assertions.ts                  # 自定义断言
└── mocks/
    ├── redis.mock.ts                  # Redis 内存 mock
    ├── prisma.mock.ts                 # Prisma 数据库 mock
    ├── feishu-api.mock.ts             # 飞书 OpenAPI mock
    └── jwt-keys.mock.ts               # RSA 测试密钥对
```

---

## 九、关键修复记录

执行过程中发现并修复的问题:

| 问题 | 根因 | 修复方案 |
| --- | --- | --- |
| `Cannot find module '../mocks/redis.mock.js'` | `fixtures.ts` 中使用 `require()` 在 ESM 上下文失败 | 改为顶层 `import { redisMock } from '../mocks/redis.mock.js'` |
| `expected true to be false` (logout cookie) | `assertRefreshTokenCookie` 误判清除头为有效 cookie | 增加 Max-Age=0 / Expires=1970 / 空值 检测 |
| Prisma mock 日期比较失败 | Date 对象与 number 直接比较返回 false | 增加 `toMs()` 统一转换为时间戳 |
| 过期 token 未被拒绝 | JWT clockTolerance=30s 容差导致 -1s 仍通过 | 过期时间改为 -100s 超越容差 |
| `res.req.traceId` undefined | mock Response 缺少 req 回引 | createMockRes 增加 req 参数与回引 |
| `req.header()` missing | mock Request 未实现 Express header 方法 | createMockReq 实现 header() 大小写不敏感查找 |

---

## 十、后续建议

1. **提升 auth.controller.ts branches 覆盖率**: 当前 44.82% branches 主要受 extractClientContext 防御性分支影响。建议通过 supertest 传入特殊 header 触发 JSON.parse 失败分支。
2. **集成 k6 性能测试**: `server/performance/k6/` 已有 5 个 k6 脚本,需配合 3s SLA 验证(任务 7)。
3. **OWASP ZAP 安全扫描**: 任务 8 中执行,验证 SQL 注入/XSS/认证绕过。
4. **CI 集成**: `npm run test:ci` 已生成 JUnit 报告至 `coverage/junit.xml`,可直接接入 GitHub Actions。
