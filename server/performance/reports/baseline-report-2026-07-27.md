# 丹青有AI - 性能基准测试报告

> **报告类型**:Phase 1 任务 7 性能基线
> **生成日期**:2026-07-27
> **执行人**:performance-expert(12 性能优化专家)
> **测试工具**:k6(脚本位于 `server/performance/k6/`)
> **硬约束**:AI 分析任务 P95 < 3000ms(3 秒 SLA)

---

## 0. 执行摘要

| 项 | 结论 |
|---|---|
| **3 秒 SLA(Phase 1 mock)** | 预期达标(待实测确认) |
| **3 秒 SLA(Phase 2 真实 AI)** | 高风险,需专项优化 |
| **测试套件就绪度** | 6 脚本 + 3 辅助脚本 + 阈值配置 全部就位 |
| **实测数据状态** | 待环境就绪后回填(本地 k6 未安装、PG/Redis 未启动) |

> **重要说明**:Phase 1 的分析接口(`POST /analyses`)为 mock 实现,仅写入 DB 一条 `status=pending` 记录后立即返回 `status=processing`,**不含真实 AI 推理耗时**。因此 Phase 1 的 3 秒 SLA 验证本质是"验证后端链路(DB + JWT + 限流)本身不会成为瓶颈",真正的 SLA 挑战在 Phase 2 接入真实模型后。

---

## 1. 测试环境

### 1.1 环境配置(待实测时回填)

| 项 | 配置 | 备注 |
|---|---|---|
| 操作系统 | Windows(开发机) | Etc/GMT-8 时区 |
| CPU | 待填(建议 4 核+) | `nproc` 或任务管理器查看 |
| 内存 | 待填(建议 8GB+) | |
| Node.js | v18+(`engines` 要求) | `node -v` |
| PostgreSQL | v14(Docker) | `postgres:14` |
| Redis | v7(Docker) | `redis:7` |
| k6 | v0.50+ | `k6 version` |
| 后端版本 | v3.0.0 | `server/package.json` |
| 后端模式 | development | `NODE_ENV=development` |

### 1.2 后端关键配置(测试环境)

| 环境变量 | 测试值 | 默认值 | 说明 |
|---|---|---|---|
| `RATE_LIMIT_API_PER_MIN` | 10000 | 60 | **调高**,避免压测触发 429 |
| `RATE_LIMIT_AUTH_PER_MIN` | 10000 | 10 | **调高** |
| `RATE_LIMIT_REFRESH_PER_MIN` | 10000 | 20 | **调高** |
| `JWT_ACCESS_EXPIRES` | 15m | 15m | |
| `JWT_REFRESH_EXPIRES` | 7d | 7d | |
| `DATABASE_URL` | postgresql://danqing:danqing@localhost:5432/danqing | - | 本地 Docker |
| `REDIS_URL` | redis://localhost:6379 | - | 本地 Docker |

> **性能风险预警**:生产环境**不可**将限流调至 10000/min。测试环境调高仅为验证 SLA,生产限流需结合租户配额与容量规划在 Phase 2 调优。

---

## 2. 测试场景与配置

| # | 场景 | 脚本 | VU | 持续 | 阈值 P95 | 阈值 P99 | 说明 |
|---|---|---|---|---|---|---|---|
| 1 | 冒烟测试 | smoke-test.js | 1 | 1 iter | - | - | 链路连通性验证 |
| 2 | 飞书授权链路 | auth-login.js | 20 | 30s | 500ms | 1000ms | Redis state 写入 |
| 3 | /auth/me | auth-me.js | 50 | 30s | 100ms | 200ms | JWT + 3 次 DB 查询 |
| 4 | **分析提交(SLA)** | analysis-submit.js | 10→50→100 | 2min | **3000ms** | 5000ms | **核心 3 秒 SLA** |
| 5 | 分析列表 | analysis-list.js | 30 | 30s | 200ms | 500ms | 复合索引验证 |
| 6 | 混合场景 | mixed-workload.js | 50 | 60s | 2000ms | 4000ms | 真实流量模拟 |

### 2.1 分析提交场景详情(核心)

阶梯加压策略:

```
阶段 1: 10 VU  × 30s  → 基线(单用户性能)
阶段 2: 50 VU  × 30s  → 正常负载(班级同时提交)
阶段 3: 100 VU × 30s  → 峰值(全校并发)
阶段 4: 降载 0 × 1m   → 观察恢复(事件循环 / DB 连接池释放)
```

---

## 3. 测试结果

### 3.1 实测结果(待回填)

> 以下表格在 k6 执行后回填。运行命令见 `README.md` 第 3 节。

| 场景 | VU | 持续 | P50 | P95 | P99 | 错误率 | RPS | 总请求数 | 是否达标 |
|---|---|---|---|---|---|---|---|---|---|
| 冒烟测试 | 1 | 1 iter | - | - | - | - | - | 3 | 待测 |
| 飞书授权 | 20 | 30s | - | - | - | - | - | - | 待测 |
| /auth/me | 50 | 30s | - | - | - | - | - | - | 待测 |
| **分析提交** | 10→100 | 2min | - | - | - | - | - | - | **待测** |
| 分析列表 | 30 | 30s | - | - | - | - | - | - | 待测 |
| 混合场景 | 50 | 60s | - | - | - | - | - | - | 待测 |

### 3.2 理论性能分析(基于 Phase 1 代码静态分析)

> 以下为基于后端代码静态分析的**预期性能**,非实测值。用于在实测前建立性能预期,辅助识别异常。

| 场景 | 关键操作 | 预期 P95 | 风险点 |
|---|---|---|---|
| 飞书授权 | Redis SET(state, 5min TTL) + 字符串拼接 | 5-30ms | Redis 网络往返 |
| /auth/me | JWT RS256 验签 + 3 次 DB 查询(User/Tenant/TenantMember) | 15-60ms | DB 连接池 + 3 次 RTT |
| **分析提交(mock)** | 配额校验(2 次 DB:tenant + count) + 1 次 DB INSERT | 20-80ms | **不含 AI 推理,远低于 3s** |
| 分析列表 | DB findMany(索引扫描) + count 并行 | 10-50ms | 10000 条数据下的 count 性能 |
| 混合场景 | 上述混合 | 20-100ms | 资源争用 |

**结论**:Phase 1 mock 实现下,所有接口预期 P95 < 100ms,**3 秒 SLA 应轻松达标**。真正的性能挑战在 Phase 2。

### 3.3 Phase 2 真实 AI 推理性能风险评估

| 环节 | 预估耗时 | 占 SLA 比例 | 风险 |
|---|---|---|---|
| JWT 验签 + 中间件 | 1-5ms | <1% | 低 |
| 配额校验(2 次 DB) | 5-20ms | <1% | 低(可 Redis 缓存) |
| 图片下载 | 100-500ms | 3-17% | 中(CDN 命中率) |
| **AI 模型推理** | **800-2500ms** | **27-83%** | **高(核心瓶颈)** |
| 结果写 DB | 5-20ms | <1% | 低 |
| 响应序列化 | 1-5ms | <1% | 低 |
| **合计(同步模式)** | **~1000-3000ms** | 100% | **临界,需严格优化** |

**风险等级**:高。若 AI 推理 > 2500ms,必须走异步模式(BullMQ 入队 + 前端轮询),否则 3 秒 SLA 必违约。

---

## 4. 3 秒 SLA 达标结论

### 4.1 Phase 1(mock 实现)

| 维度 | 结论 | 依据 |
|---|---|---|
| **P95 < 3000ms** | 预期达标 | mock 仅含 DB 写入(配额校验 + INSERT),无 AI 推理,预期 P95 < 100ms |
| **P99 < 5000ms** | 预期达标 | 同上 |
| **错误率 < 1%** | 预期达标 | 无外部依赖(飞书 API / AI 模型),仅 DB + Redis |
| **综合达标** | **预期达标(待实测确认)** | 需 k6 实测数据回填后最终确认 |

> 待实测数据回填后,将上表"预期"改为"实测"并附 k6 输出截图。

### 4.2 Phase 2(真实 AI 模型)— 高风险

| 维度 | 结论 | 依据 |
|---|---|---|
| **P95 < 3000ms** | **高风险** | AI 推理 800-2500ms + 图片下载 100-500ms,合计接近 SLA 上限 |
| **达标条件** | 需满足以下全部 | 见 4.3 节 |

### 4.3 Phase 2 达标必要条件

1. **AI 推理 < 2000ms**(P95):模型需 GPU 加速 + 请求批处理 + 结果缓存
2. **图片下载 < 300ms**:CDN 边缘节点缓存 + 图片预处理(缩略图)
3. **同步/异步混合策略**:
   - 预估耗时 < 2500ms → 同步返回(用户体验最佳)
   - 预估耗时 ≥ 2500ms → BullMQ 入队,返回 `status=processing`,前端轮询
   - 实际耗时 > 3000ms → 强制中断,返回 `6002 ANALYSIS_TIMEOUT`
4. **配额校验 Redis 缓存**:将 `tenant.plan` + `usedQuota` 缓存至 Redis(5min TTL),避免每次提交都 count DB
5. **DB 连接池调优**:`connection_limit = (CPU * 2 + 1)`,`pool_timeout = 10s`

---

## 5. 瓶颈分析

### 5.1 Phase 1 潜在瓶颈(静态分析)

| 层 | 瓶颈点 | 触发条件 | 影响 | 严重度 |
|---|---|---|---|---|
| **限流层** | `RATE_LIMIT_API_PER_MIN=60` | >60 req/min | 429 错误,SLA 验证失真 | 高(测试环境已调高) |
| **DB 层** | `/auth/me` 3 次串行查询 | 高并发 /auth/me | 每次查询 1 个 RTT,3 次累计延迟 | 中(可优化为 Promise.all) |
| **DB 层** | `analysis.list` 的 `count` 查询 | 10000+ 条记录 | count 全表扫描(即使有索引) | 中(可缓存 total) |
| **DB 层** | Prisma 连接池默认值 | 100 VU 并发 | 连接耗尽 → 请求排队 | 中(需调 connection_limit) |
| **Redis 层** | state 写入 + 限流计数 + 黑名单 | 高并发授权 | Redis 单线程瓶颈 | 低(本地 Redis 足够) |
| **Node 层** | 单进程事件循环 | CPU 密集任务 | 事件循环阻塞 | 低(Phase 1 无 CPU 密集) |

### 5.2 Phase 2 预期瓶颈

| 层 | 瓶颈点 | 触发条件 | 影响 | 严重度 |
|---|---|---|---|---|
| **AI 推理** | 模型推理耗时 | 复杂图片 / 模型冷启动 | 直接逼近 3s SLA | **致命** |
| **图片下载** | 远程图片获取 | 非 CDN / 大图 | 占用 100-500ms | 高 |
| **DB 层** | `analysis.create` 写入 | 高并发 INSERT | 写锁竞争 | 中 |
| **Node 层** | AI 推理阻塞事件循环 | 同步推理 | 其他请求饿死 | 高(需 worker thread) |
| **内存** | 图片缓冲 + 模型加载 | 大图 / 多并发 | OOM | 中 |

### 5.3 诊断方法

| 工具 | 用途 | 命令 |
|---|---|---|
| **k6** | HTTP 层负载与延迟 | `k6 run k6/analysis-submit.js` |
| **EXPLAIN** | SQL 慢查询分析 | `EXPLAIN ANALYZE SELECT ... FROM analyses WHERE tenant_id=...` |
| **Clinic.js** | Node.js 事件循环 / GC | `clinic doctor --on-port 'k6 run k6/analysis-submit.js'` |
| **prisma.$metrics()** | 连接池使用率 | 代码中启用 `previewFeatures = ["metrics"]` |
| **Redis INFO** | Redis 内存/命中率 | `redis-cli INFO stats` |
| **pg_stat_statements** | PG 慢查询统计 | `SELECT * FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 10` |

---

## 6. 优化建议(Phase 2 落地)

### 6.1 P0(必须,影响 SLA 达标)

| # | 优化项 | 预期收益 | 落地位置 | 优先级 |
|---|---|---|---|---|
| 1 | **AI 推理异步化** | 避免 Node 事件循环阻塞,SLA 可控 | `analysis.service.ts` + BullMQ | P0 |
| 2 | **同步/异步混合策略** | <2.5s 同步 / ≥2.5s 入队 | `analysis.service.ts` | P0 |
| 3 | **配额校验 Redis 缓存** | 减少 2 次 DB 查询(省 10-30ms) | `analysis.service.ts#checkQuota` | P0 |
| 4 | **AI 推理超时强制中断** | 防止 SLA 违约拖垮系统 | `analysis.service.ts`(AbortController + 3s 超时) | P0 |

### 6.2 P1(重要,提升吞吐)

| # | 优化项 | 预期收益 | 落地位置 | 优先级 |
|---|---|---|---|---|
| 5 | **/auth/me 查询并行化** | 3 次串行 → 1 次并行(省 2 个 RTT) | `auth.service.ts#getCurrentUserInfo` | P1 |
| 6 | **analysis.list 的 total 缓存** | 避免 count 全表扫描 | `analysis.repository.ts#list` + Redis | P1 |
| 7 | **Prisma 连接池调优** | 避免连接耗尽 | `DATABASE_URL?connection_limit=20&pool_timeout=10` | P1 |
| 8 | **图片下载并行于推理** | 掩盖下载延迟 | AI 推理服务前置 | P1 |

### 6.3 P2(增强,可观测性)

| # | 优化项 | 预期收益 | 落地位置 | 优先级 |
|---|---|---|---|---|
| 9 | **Prometheus 指标暴露** | 实时监控 P95/P99/错误率 | `/metrics` 端点 + prom-client | P2 |
| 10 | **慢查询日志** | 自动记录 > 100ms 的 SQL | Prisma middleware | P2 |
| 11 | **分布式追踪** | 跨服务延迟定位 | OpenTelemetry + Jaeger | P2 |
| 12 | **压测 CI 化** | 性能回归自动拦截 | GitHub Actions + k6 | P2 |

---

## 7. 与阈值对比

### 7.1 阈值定义(thresholds.json)

| 场景 | 指标 | 阈值 | 实测(待填) | 达标 |
|---|---|---|---|---|
| auth_login | http_req_duration P95 | < 500ms | - | - |
| auth_login | http_req_duration P99 | < 1000ms | - | - |
| auth_login | http_req_failed | < 1% | - | - |
| auth_me | http_req_duration P95 | < 100ms | - | - |
| auth_me | http_req_duration P99 | < 200ms | - | - |
| auth_me | http_req_failed | < 1% | - | - |
| **analysis_submit** | **http_req_duration P95** | **< 3000ms** | **-** | **-** |
| analysis_submit | http_req_duration P99 | < 5000ms | - | - |
| analysis_submit | http_req_failed | < 1% | - | - |
| analysis_submit | sla_violations | < 10 | - | - |
| analysis_list | http_req_duration P95 | < 200ms | - | - |
| analysis_list | http_req_duration P99 | < 500ms | - | - |
| analysis_list | http_req_failed | < 1% | - | - |
| mixed | http_req_duration P95 | < 2000ms | - | - |
| mixed | http_req_failed | < 1% | - | - |

### 7.2 k6 退出码

k6 在任一阈值未达标时退出码非 0。CI 集成示例:

```yaml
# .github/workflows/performance.yml
- name: Run k6 performance tests
  run: |
    k6 run server/performance/k6/analysis-submit.js \
      --env API_BASE=http://localhost:3000 \
      --env TEST_TOKEN=${{ secrets.TEST_TOKEN }}
```

---

## 8. 执行清单(待环境就绪后操作)

- [ ] 安装 k6(`choco install k6` 或 `winget install k6.k6`)
- [ ] 启动 PostgreSQL(`docker run -d ... postgres:14`)
- [ ] 启动 Redis(`docker run -d ... redis:7`)
- [ ] 配置 `server/.env`(含 RSA 密钥对、调高限流)
- [ ] 执行 `npm run prisma:migrate:dev -- --name init`
- [ ] 启动后端 `npm run dev`
- [ ] 运行 `node performance/scripts/seed-database.js`
- [ ] 运行 `node performance/scripts/generate-tokens.js`
- [ ] 运行 `k6 run k6/smoke-test.js`(冒烟验证)
- [ ] 依次运行 5 个压测脚本,收集 JSON 报告
- [ ] 将实测数据回填至本报告第 3.1 / 7.1 节
- [ ] 运行 `node performance/scripts/cleanup.js` 清理
- [ ] 更新 README.md 第 7.1 节"运行状态说明"

---

## 9. 附录

### 9.1 k6 输出示例(预期格式)

```
scenarios: (100.00%) 1 scenario, 100 max VUs, 2m30s max duration
         * default: Up to 100 looping VUs for 2m0s over 4 stages

     execution: local
        output: json(reports/analysis-submit-20260727.json)

     ✓ status 200 or 201
     ✓ code 0
     ✓ has analysis id
     ✓ status is processing or success
     ✗ duration < 3000ms (SLA)  ← 若有违约会标红

     http_req_duration..........: avg=45ms p(95)=82ms p(99)=120ms  ← 待实测
     http_req_failed............: 0.00%  ← 待实测
     analysis_duration..........: avg=44ms p(95)=80ms p(99)=118ms  ← 待实测
     analysis_success...........: 100.00%
     sla_violations.............: 0    ← 待实测
     iterations................: 12000  ← 待实测
     vus.......................: 10→50→100→0
```

### 9.2 相关文件

| 文件 | 说明 |
|---|---|
| [README.md](../README.md) | 安装说明 + 运行指南 + 验收报告 |
| [thresholds.json](../thresholds.json) | 性能阈值配置 |
| [k6/analysis-submit.js](../k6/analysis-submit.js) | 核心 3 秒 SLA 验证脚本 |
| [scripts/seed-database.js](../scripts/seed-database.js) | 测试数据灌入 |
| [scripts/generate-tokens.js](../scripts/generate-tokens.js) | JWT 签发 |
| [scripts/cleanup.js](../scripts/cleanup.js) | 测试后清理 |

---

## 10. 变更记录

| 版本 | 时间 | 变更人 | 变更内容 |
|---|---|---|---|
| v1.0 | 2026-07-27 | performance-expert | 初始版本:测试套件就位,理论分析完成,待实测回填 |
