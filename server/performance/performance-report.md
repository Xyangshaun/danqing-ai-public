# 丹青有AI - 性能验证报告

> **报告类型**:四端性能验证(Phase 1 静态分析 + 环境受限说明)
> **生成日期**:2026-07-29
> **执行人**:DevOps 质量保障专家(08DevOps)
> **硬约束**:AI 分析任务 P95 < 3000ms(3 秒 SLA)
> **测试工具**:k6(脚本位于 `server/performance/k6/`)

---

## 0. 执行摘要

| 项 | 结论 |
|---|---|
| **k6 工具状态** | 未安装(命令 `k6 version` 报 CommandNotFoundException) |
| **后端服务状态** | 无法启动(server/.env 不存在,缺失 9 个必填环境变量;PostgreSQL/Redis 未运行) |
| **3 秒 SLA(Phase 1 mock)** | 预期达标(基于代码静态分析,待 k6 实测确认) |
| **3 秒 SLA(Phase 2 真实 AI)** | 高风险(AI 推理 800-2500ms 占 SLA 27-83%) |
| **单元测试基线** | 515/515 通过,执行耗时 1.68s(无 HTTP 层,纯逻辑) |
| **限流配置** | 已就位(多端差异化:web 60/admin 120/mobile 40 次/min) |
| **缓存策略** | Redis 已用于 state/限流/黑名单/配额;分析结果缓存待补 |

**核心结论**:由于运行环境受限(k6 未装 + 后端无法启动),本报告基于代码静态分析 + 既有单元测试数据推断性能基准。Phase 1 mock 实现下 3 秒 SLA 预期达标;Phase 2 接入真实 AI 模型后为高风险,需专项优化。

---

## 1. 测试环境与工具状态

### 1.1 k6 安装检查

```
$ k6 version
k6 : The term 'k6' is not recognized as the name of a cmdlet, function, script file,
or operable program.
```

**结论**:k6 未安装,跳过 k6 实测执行。

**安装方法(供后续执行)**:
```powershell
# 方式一:Chocolatey
choco install k6
# 方式二:winget
winget install k6.k6
# 方式三:下载二进制
# https://github.com/grafana/k6/releases
```

### 1.2 后端服务启动检查

**启动自检流程**(依据 [index.ts](file:///c:/Users/26929/AppData/Roaming/TRAE%20SOLO%20CN/ModularData/ai-agent/work-mode-projects/6a4f01878de2462eddd4b61e/server/src/index.ts)):
1. `initEnv()` → 校验必填环境变量(缺失即抛错退出)
2. `initPrisma()` → 连接 PostgreSQL(失败退出)
3. `initRedis()` → 连接 Redis(失败退出,不可降级)
4. `http.createServer` → 监听 3000 端口

**实际状态**:
- `server/.env` 文件不存在(仅有 `.env.example`)
- 缺失必填项:`FEISHU_APP_ID` / `FEISHU_APP_SECRET` / `FEISHU_REDIRECT_URI_WEB` / `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY` / `JWT_KEY_ID` / `DATABASE_URL` / `REDIS_URL` / `CORS_ORIGINS`(共 9 项,依据 [env.ts#L192-202](file:///c:/Users/26929/AppData/Roaming/TRAE%20SOLO%20CN/ModularData/ai-agent/work-mode-projects/6a4f01878de2462eddd4b61e/server/src/config/env.ts#L192-L202))
- PostgreSQL 未运行(无 docker 容器)
- Redis 未运行(无 docker 容器)

**结论**:后端服务无法在当前环境启动,跳过所有需运行服务的性能测试。以下分析基于代码静态分析。

### 1.3 已有测试资产清单

| 资产 | 路径 | 状态 |
|---|---|---|
| k6 冒烟测试 | server/performance/k6/smoke-test.js | 就绪(待执行) |
| k6 飞书授权压测 | server/performance/k6/auth-login.js | 就绪 |
| k6 /auth/me 压测 | server/performance/k6/auth-me.js | 就绪 |
| k6 分析提交(SLA核心) | server/performance/k6/analysis-submit.js | 就绪(阶梯 10→50→100 VU) |
| k6 分析列表压测 | server/performance/k6/analysis-list.js | 就绪 |
| k6 混合场景 | server/performance/k6/mixed-workload.js | 就绪 |
| 阈值配置 | server/performance/thresholds.json | 就绪 |
| 数据灌入脚本 | server/performance/scripts/seed-database.js | 就绪 |
| Token 生成脚本 | server/performance/scripts/generate-tokens.js | 就绪 |
| 既有基线报告 | server/performance/reports/baseline-report-2026-07-27.md | 理论分析完成 |
| 单元测试 | server/tests/*.test.ts | 515/515 通过 |

---

## 2. API 响应时间基准(基于代码静态分析)

### 2.1 各接口关键操作与预期耗时

| 接口 | 关键操作(代码路径) | 预期 P95 | 依据 |
|---|---|---|---|
| GET /health | 纯内存,不查 DB/Redis | < 5ms | [app.ts#L132-145](file:///c:/Users/26929/AppData/Roaming/TRAE%20SOLO%20CN/ModularData/ai-agent/work-mode-projects/6a4f01878de2462eddd4b61e/server/src/app.ts#L132-L145) 仅返回时间戳 |
| GET /auth/feishu/authorize | Redis SET(state, EX 300) + URL 拼接 | 5-30ms | [auth.service.ts#L64-65](file:///c:/Users/26929/AppData/Roaming/TRAE%20SOLO%20CN/ModularData/ai-agent/work-mode-projects/6a4f01878de2462eddd4b61e/server/src/services/auth.service.ts#L64-L65) |
| GET /auth/feishu/callback | state 校验 + 飞书 token 交换 + 用户信息 + DB 事务 + JWT 签发 + Session 落库 | 200-800ms | 含外部飞书 API 调用(网络 RTT 占主导) |
| GET /auth/me | JWT 验签 + 3 次 DB 查询(User/Tenant/Memberships) | 15-60ms | [auth.service.ts#L246-269](file:///c:/Users/26929/AppData/Roaming/TRAE%20SOLO%20CN/ModularData/ai-agent/work-mode-projects/6a4f01878de2462eddd4b61e/server/src/services/auth.service.ts#L246-L269)(3 次串行查询) |
| POST /auth/refresh | JWT 验签 + Session 校验 + 2 次 DB + JWT 重签 + 滚动黑名单 | 20-80ms | [auth.service.ts#L152-207](file:///c:/Users/26929/AppData/Roaming/TRAE%20SOLO%20CN/ModularData/ai-agent/work-mode-projects/6a4f01878de2462eddd4b61e/server/src/services/auth.service.ts#L152-L207) |
| POST /analyses(mock) | 配额校验(2 次 DB)+ 1 次 INSERT | 20-80ms | 不含 AI 推理 |
| POST /analyses(Phase 2 AI) | 上述 + 图片下载 + AI 推理 + 结果写库 | **1000-3000ms** | 见第 3 节 SLA 分析 |
| GET /analyses | DB findMany(索引扫描)+ count | 10-50ms | count 在 10000+ 条时可能变慢 |
| GET /api/admin/users | 复杂查询 + 脱敏处理 | 20-80ms | |

### 2.2 单元测试执行基线

依据 [server/tests/README.md](file:///c:/Users/26929/AppData/Roaming/TRAE%20SOLO%20CN/ModularData/ai-agent/work-mode-projects/6a4f01878de2462eddd4b61e/server/tests/README.md):

```
Test Files  10 passed (10)
     Tests  515 passed (515)
  Duration  1.68s
```

- 单元测试为纯逻辑层(Mock DB/Redis/飞书),无网络 IO
- 515 用例 1.68s 完成 → 平均每用例 3.26ms(纯 CPU)
- 这表明**业务逻辑层本身不是性能瓶颈**,瓶颈在外部依赖(DB/Redis/AI/飞书)

### 2.3 中间件链路开销分析

每个请求经过的中间件链(依据 [app.ts](file:///c:/Users/26929/AppData/Roaming/TRAE%20SOLO%20CN/ModularData/ai-agent/work-mode-projects/6a4f01878de2462eddd4b61e/server/src/app.ts)):

```
helmet → cors → json(1mb) → urlencoded → cookieParser → traceMiddleware
  → clientIdentification → responseOptimizer
  → [路由层] authMiddleware → tenantMiddleware → clientRateLimiter → permission → controller
  → errorHandler
```

| 中间件 | 预期开销 | 备注 |
|---|---|---|
| helmet | < 1ms | 设置响应头 |
| cors | < 1ms | 白名单检查 |
| json 解析 | 1-3ms | 1mb 上限 |
| traceMiddleware | < 1ms | 生成 UUID |
| authMiddleware | 2-5ms | RS256 验签 + Redis 黑名单查询(1 次 RTT) |
| tenantMiddleware | < 1ms | 仅判空 |
| clientRateLimiter | 1-3ms | Redis incr + expire(1-2 次 RTT) |
| permission | < 1ms | 内存查表 |
| **中间件链合计** | **5-12ms** | 不含业务逻辑与 DB |

---

## 3. 3 秒 SLA 达成分析

### 3.1 SLA 阈值定义(依据 [thresholds.json](file:///c:/Users/26929/AppData/Roaming/TRAE%20SOLO%20CN/ModularData/ai-agent/work-mode-projects/6a4f01878de2462eddd4b61e/server/performance/thresholds.json))

```json
{
  "analysis_submit": {
    "http_req_duration": ["p(95)<3000", "p(99)<5000"],
    "http_req_failed": ["rate<0.01"],
    "iterations": ["count>200"]
  }
}
```

k6 脚本 [analysis-submit.js](file:///c:/Users/26929/AppData/Roaming/TRAE%20SOLO%20CN/ModularData/ai-agent/work-mode-projects/6a4f01878de2462eddd4b61e/server/performance/k6/analysis-submit.js) 配置:
- 阶梯加压:10 VU(30s)→ 50 VU(30s)→ 100 VU(30s)→ 0(1m 恢复)
- 请求超时:6s(2 倍 SLA)
- SLA 违约计数:`sla_violations` 指标,count < 10

### 3.2 Phase 1(mock 实现)SLA 分析

**Phase 1 分析接口不含真实 AI 推理**,仅写入 DB 一条 `status=pending` 记录后返回 `status=processing`。

| 环节 | 预估耗时 | 占 SLA 比例 |
|---|---|---|
| 中间件链 | 5-12ms | < 0.4% |
| 配额校验(2 次 DB:tenant + count) | 5-20ms | < 0.7% |
| DB INSERT(analysis 记录) | 5-15ms | < 0.5% |
| 响应序列化 | 1-3ms | < 0.1% |
| **合计** | **16-50ms** | **< 1.7%** |

**结论**:Phase 1 mock 下 P95 预期 < 100ms,**3 秒 SLA 达标余量充足(达 30 倍)**。此阶段 SLA 验证本质是验证「后端链路本身不会成为瓶颈」。

### 3.3 Phase 2(真实 AI 模型)SLA 分析 — 高风险

依据 [.env.example AI 配置](file:///c:/Users/26929/AppData/Roaming/TRAE%20SOLO%20CN/ModularData/ai-agent/work-mode-projects/6a4f01878de2462eddd4b61e/server/.env.example#L69-L94) 与 [env.ts#L77](file:///c:/Users/26929/AppData/Roaming/TRAE%20SOLO%20CN/ModularData/ai-agent/work-mode-projects/6a4f01878de2462eddd4b61e/server/src/config/env.ts#L77):

| 环节 | 预估耗时 | 占 SLA 比例 | 风险 |
|---|---|---|---|
| JWT 验签 + 中间件 | 5-12ms | < 0.4% | 低 |
| 配额校验 | 5-20ms | < 0.7% | 低 |
| 图片下载 | 100-500ms | 3-17% | 中(CDN 命中率) |
| **AI 模型推理(智谱 GLM-4V)** | **800-2500ms** | **27-83%** | **高(核心瓶颈)** |
| Jimp 像素分析(fallback) | 300-500ms | 10-17% | 中 |
| 结果写 DB | 5-20ms | < 0.7% | 低 |
| 响应序列化 | 1-5ms | < 0.2% | 低 |
| **合计(同步模式)** | **~1000-3000ms** | 100% | **临界** |

**关键保障机制**(已实现):
- `AI_API_TIMEOUT=2500ms`(硬性,超时立即切断走 Jimp fallback,不重试)
- `AI_ENABLED` 默认 false,生产手动开启
- 留空 `AI_API_KEY` 时自动 fallback 到 Jimp

**风险结论**:若 AI 推理 > 2500ms,同步模式将逼近 SLA 上限。需满足以下全部条件方可达标:
1. AI 推理 P95 < 2000ms(GPU 加速 + 请求批处理)
2. 图片下载 < 300ms(CDN 边缘缓存)
3. 同步/异步混合策略(< 2.5s 同步返回,≥ 2.5s 入队 BullMQ 轮询)
4. 实际耗时 > 3s 强制中断返回 6002 ANALYSIS_TIMEOUT

### 3.4 SLA 达标结论矩阵

| 阶段 | P95<3000ms | P99<5000ms | 错误率<1% | 综合结论 |
|---|---|---|---|---|
| Phase 1(mock) | 预期达标(< 100ms) | 预期达标 | 预期达标 | **预期达标(待 k6 实测)** |
| Phase 2(AI 同步) | **高风险(临界)** | **高风险** | 中风险 | **需专项优化** |
| Phase 2(AI 异步) | 达标(返回 processing) | 达标 | 达标 | **推荐方案** |

---

## 4. 缓存命中率分析

### 4.1 Redis 使用场景(依据 [redis.ts](file:///c:/Users/26929/AppData/Roaming/TRAE%20SOLO%20CN/ModularData/ai-agent/work-mode-projects/6a4f01878de2462eddd4b61e/server/src/config/redis.ts)))

| 用途 | Key 模式 | TTL | 命中策略 | 当前状态 |
|---|---|---|---|---|
| OAuth state 存储 | `oauth:state:{state}` | 300s | 一次性消费(DEL) | 已实现 |
| access_token 黑名单 | `blacklist:access:{jti}` | token 剩余有效期 | exists 查询 | 已实现 |
| refresh_token 黑名单 | `blacklist:refresh:{jti}` | 7d | exists 查询 | 已实现 |
| 限流计数器 | `rl:{scope}:{ip}:{window}` / `rl:client:{client}:{userId}:{ip}:{window}` | 60s | incr + expire | 已实现 |
| 配额计数器 | (session/subscription) | - | - | 已实现 |

### 4.2 缓存优化机会(待实现)

| 优化项 | 预期收益 | 优先级 | 状态 |
|---|---|---|---|
| 租户配额缓存(`tenant:{id}:quota`) | 减少 2 次 DB 查询(省 10-30ms/次) | P0 | **未实现** |
| /auth/me 用户信息缓存(5min TTL) | 减少 3 次 DB 查询 | P1 | **未实现** |
| analysis.list 的 total 缓存 | 避免 count 全表扫描 | P1 | **未实现** |
| 艺术品知识库缓存(静态数据) | 避免重复 DB 查询 | P2 | **未实现** |
| AI 分析结果缓存(图片 hash → result) | 相同图片不重复推理 | P1 | **未实现** |

**结论**:当前 Redis 仅用于认证与限流,**业务数据缓存尚未实现**。这是 Phase 2 性能优化的重点。

### 4.3 Redis 降级策略一致性

| 场景 | 降级行为 | 依据 | 评价 |
|---|---|---|---|
| 限流中间件(createRateLimiter) | **拒绝请求**(503 CACHE_ERROR) | [rate-limit.ts#L57-62](file:///c:/Users/26929/AppData/Roaming/TRAE%20SOLO%20CN/ModularData/ai-agent/work-mode-projects/6a4f01878de2462eddd4b61e/server/src/middlewares/rate-limit.ts#L57-L62) | 安全优先(Deny by default) |
| 多端限流(clientRateLimiter) | **放行请求**(仅记录日志) | [client-adapt.ts#L88-93](file:///c:/Users/26929/AppData/Roaming/TRAE%20SOLO%20CN/ModularData/ai-agent/work-mode-projects/6a4f01878de2462eddd4b61e/server/src/middlewares/client-adapt.ts#L88-L93) | 可用性优先 |

**不一致问题(P-001)**:两个限流中间件对 Redis 不可达的降级策略相反 — 通用 `createRateLimiter` 拒绝,多端 `clientRateLimiter` 放行。若生产用 `clientRateLimiter` 替换 `apiRateLimiter`,Redis 故障时限流将完全失效。建议统一为「拒绝」策略。

---

## 5. 限流配置验证

### 5.1 限流配置矩阵

依据 [env.ts#L254-L257](file:///c:/Users/26929/AppData/Roaming/TRAE%20SOLO%20CN/ModularData/ai-agent/work-mode-projects/6a4f01878de2462eddd4b61e/server/src/config/env.ts#L254-L257) 与 [client-adapt.ts#L42-L47](file:///c:/Users/26929/AppData/Roaming/TRAE%20SOLO%20CN/ModularData/ai-agent/work-mode-projects/6a4f01878de2462eddd4b61e/server/src/middlewares/client-adapt.ts#L42-L47):

| 限流器 | 维度 | 默认阈值 | 触发响应 | Retry-After |
|---|---|---|---|---|
| authRateLimiter | IP / scope=auth | 10 次/min | 429 + 9005 | 60s |
| callbackRateLimiter | IP / scope=callback | 5 次/min | 429 + 9005 | 60s |
| refreshRateLimiter | IP / scope=refresh | 20 次/min | 429 + 9005 | 60s |
| apiRateLimiter | IP / scope=api | 60 次/min | 429 + 9005 | 60s |
| clientRateLimiter(web) | client+ip+userId | 60 次/min | 429 + 9005 | 60s |
| clientRateLimiter(admin) | client+ip+userId | 120 次/min | 429 + 9005 | 60s |
| clientRateLimiter(mobile) | client+ip+userId | 40 次/min | 429 + 9005 | 60s |
| clientRateLimiter(marketing) | client+ip+userId | 30 次/min | 429 + 9005 | 60s |

### 5.2 限流验证(静态)

| 验证点 | 预期 | 代码依据 | 状态 |
|---|---|---|---|
| 第 N+1 次请求返回 429 | count > max → 429 | rate-limit.ts#L51-54 | 静态✓ |
| 响应含 Retry-After: 60 | res.setHeader('Retry-After','60') | rate-limit.ts#L53 | 静态✓ |
| 错误码 9005 RATE_LIMITED | ErrorCode.RATE_LIMITED | rate-limit.ts#L54 | 静态✓ |
| 多端限流头暴露 | X-RateLimit-Limit/Remaining/Client | client-adapt.ts#L82-85 | 静态✓ |
| IP 隔离 | 不同 IP 独立计数 | rate-limit.ts#L37 | 静态✓ |
| X-Forwarded-For 优先 | 取首段 | rate-limit.ts#L23-26 | 静态✓ |
| 分钟级时间窗自动滚动 | windowKey 含分钟 | rate-limit.ts#L40-41 | 静态✓ |

### 5.3 限流测试覆盖

依据测试报告,以下用例已通过:
- 未达限:正常通过
- 触发 429:第 11 次 /auth 请求返回 429
- Retry-After 头存在
- IP 隔离
- X-Forwarded-For 解析

### 5.4 压测环境限流调优

依据 [baseline-report](file:///c:/Users/26929/AppData/Roaming/TRAE%20SOLO%20CN/ModularData/ai-agent/work-mode-projects/6a4f01878de2462eddd4b61e/server/performance/reports/baseline-report-2026-07-27.md#L44-L49),压测时需调高限流避免误触发:

| 环境变量 | 测试值 | 生产值 |
|---|---|---|
| RATE_LIMIT_API_PER_MIN | 10000 | 60 |
| RATE_LIMIT_AUTH_PER_MIN | 10000 | 10 |
| RATE_LIMIT_REFRESH_PER_MIN | 10000 | 20 |

**警告**:生产环境**绝不可**使用 10000/min,否则限流失效。

---

## 6. k6 测试执行计划(环境就绪后)

### 6.1 执行顺序

```bash
# 前置:启动 PG + Redis + 配置 .env + 迁移 + 灌数据 + 生成 token

# 1. 冒烟测试(1 VU, 1 iter, ~5s)
k6 run server/performance/k6/smoke-test.js \
  --env API_BASE=http://localhost:3000 \
  --env TEST_TOKEN=$(cat server/performance/scripts/tokens.json | jq -r '.[0].accessToken')

# 2. 飞书授权压测(20 VU, 30s)
k6 run server/performance/k6/auth-login.js --env API_BASE=http://localhost:3000

# 3. /auth/me 压测(50 VU, 30s)
k6 run server/performance/k6/auth-me.js --env API_BASE=http://localhost:3000 \
  --env TEST_TOKEN=...

# 4. ★ 分析提交 SLA 验证(10→50→100 VU, 2min)★
k6 run server/performance/k6/analysis-submit.js \
  --env API_BASE=http://localhost:3000 \
  --env TOKENS_FILE=server/performance/scripts/tokens.json \
  --out json=server/performance/reports/analysis-submit-$(date +%Y%m%d).json

# 5. 分析列表压测(30 VU, 30s)
k6 run server/performance/k6/analysis-list.js --env API_BASE=http://localhost:3000

# 6. 混合场景(50 VU, 60s)
k6 run server/performance/k6/mixed-workload.js --env API_BASE=http://localhost:3000
```

### 6.2 阈值验收标准

| 场景 | 指标 | 阈值 | SLA 关联 |
|---|---|---|---|
| smoke | http_req_failed | < 1% | - |
| smoke | checks 通过率 | > 95% | - |
| auth_login | P95 | < 500ms | - |
| auth_me | P95 | < 100ms | - |
| **analysis_submit** | **P95** | **< 3000ms** | **★ 3 秒 SLA ★** |
| analysis_submit | P99 | < 5000ms | SLA |
| analysis_submit | sla_violations | < 10 | SLA |
| analysis_list | P95 | < 200ms | - |
| mixed | P95 | < 2000ms | - |

k6 在任一阈值未达标时退出码非 0,可直接接入 CI 拦截。

---

## 7. 性能问题清单

| 问题 ID | 严重度 | 描述 | 影响 | 建议 |
|---|---|---|---|---|
| P-001 | **高** | clientRateLimiter 与 createRateLimiter 的 Redis 降级策略相反(放行 vs 拒绝) | Redis 故障时多端限流失效 | 统一为 Deny by default |
| P-002 | **高** | 业务数据缓存未实现(配额/用户信息/total/AI结果) | 每次请求重复查 DB,Phase 2 增加 SLA 压力 | Phase 2 补齐 Redis 缓存 |
| P-003 | **中** | /auth/me 3 次 DB 查询串行(userRepository.findById + tenantRepository.findById + userRepository.findMemberships) | 3 次 RTT 累计延迟 | 改为 Promise.all 并行 |
| P-004 | **中** | analysis.list 的 count 查询在 10000+ 条时变慢 | 分页接口 P95 退化 | total 缓存或游标分页 |
| P-005 | **中** | Prisma 连接池默认值未显式配置 | 100 VU 并发时可能连接耗尽 | connection_limit=(CPU*2+1) |
| P-006 | **低** | 无 Prometheus 指标暴露 | 无法实时监控 P95/P99 | 补 /metrics 端点 + prom-client |
| P-007 | **低** | 无慢查询日志 | SQL 性能问题难定位 | Prisma middleware 记录 > 100ms 查询 |

---

## 8. 变更记录

| 版本 | 时间 | 变更人 | 变更内容 |
|---|---|---|---|
| v1.0 | 2026-07-29 | 08DevOps | 初始版本:环境受限说明 + 静态性能分析 + SLA 风险评估 + 7 个性能问题 |
