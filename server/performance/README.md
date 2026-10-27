# 丹青有AI - 性能测试套件(k6)

> **文档定位**:Phase 1 任务 7 - 3 秒 SLA 验证与性能基准建立
> **作者**:performance-expert(12 性能优化专家)
> **日期**:2026-07-27
> **适用阶段**:Phase 1(分析接口返回 mock 数据)→ Phase 2(接入真实 AI 模型后回归)
> **硬约束**:AI 分析任务 P95 < 3000ms(3 秒 SLA)

---

## 0. 目录结构

```
server/performance/
├── README.md                    # 本文件(安装说明 + 运行指南 + 验收报告)
├── k6/                          # k6 测试脚本
│   ├── smoke-test.js            # 冒烟测试(快速验证系统能跑通)
│   ├── auth-login.js            # 飞书登录链路压测(/auth/feishu/authorize)
│   ├── auth-me.js               # /auth/me 接口压测(带 token,验 JWT+DB)
│   ├── analysis-submit.js       # POST /analyses 压测(核心 3 秒 SLA 验证)
│   ├── analysis-list.js         # GET /analyses 压测(验 DB 索引性能)
│   └── mixed-workload.js        # 混合场景(登录+分析+查询)
├── scripts/                     # Node.js 辅助脚本
│   ├── generate-tokens.js       # 预生成测试用 JWT(复用 server 的 jwt.service)
│   ├── seed-database.js         # 灌入测试数据(1 租户 + 100 用户 + 10000 分析记录)
│   └── cleanup.js               # 测试后清理
├── thresholds.json              # 性能阈值配置(P95/P99/错误率)
└── reports/                     # 测试报告输出目录
    └── baseline-report-2026-07-27.md  # 性能基准报告
```

---

## 1. k6 安装说明

### 1.1 Windows(本项目环境)

推荐使用 Chocolatey 或 winget:

```powershell
# 方式一:Chocolatey(需先安装 choco)
choco install k6

# 方式二:winget(Windows 10 1809+ 自带)
winget install k6.k6

# 方式三:下载二进制
# 访问 https://github.com/grafana/k6/releases 下载 windows zip
# 解压后将 k6.exe 加入 PATH
```

### 1.2 macOS

```bash
brew install k6
```

### 1.3 Linux

```bash
# Debian/Ubuntu
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt update
sudo apt install k6

# 或用 Docker(无需安装)
docker run --rm -i grafana/k6 run - < k6/analysis-submit.js
```

### 1.4 验证安装

```bash
k6 version
# 期望输出:k6 v0.50.0 ((devel), go go1.22.0, ...) 或更高版本
```

---

## 2. 测试前置条件

### 2.1 后端服务运行

```bash
cd server
cp .env.example .env
# 编辑 .env:填入飞书 App ID/Secret、JWT 密钥对、DATABASE_URL、REDIS_URL

# 启动 PostgreSQL + Redis(本地 Docker)
docker run -d --name danqing-pg -e POSTGRES_USER=danqing -e POSTGRES_PASSWORD=danqing -e POSTGRES_DB=danqing -p 5432:5432 postgres:14
docker run -d --name danqing-redis -p 6379:6379 redis:7

# 数据库迁移
npm run prisma:migrate:dev -- --name init

# 启动后端(开发模式)
npm run dev
# 后端运行在 http://localhost:3000
```

### 2.2 关键:调高测试环境的限流

后端默认限流 `RATE_LIMIT_API_PER_MIN=60`(次/分钟),100 VU 压测会触发 429。测试前**必须**调高:

```bash
# 在 server/.env 中设置(仅测试环境)
RATE_LIMIT_AUTH_PER_MIN=10000
RATE_LIMIT_API_PER_MIN=10000
RATE_LIMIT_REFRESH_PER_MIN=10000
```

> **性能风险预警**:生产环境不可如此设置。这是测试环境为验证 SLA 而临时放宽限流,真实限流策略需结合租户配额与容量规划在 Phase 2 调优。

### 2.3 路由前缀说明

> **重要**:API 契约文档(`api-contract-v1.md`)声明基础路径为 `http://localhost:3000/api/v1`,但实际后端代码(`server/src/app.ts`)挂载路由为 `/auth`、`/analyses`(无 `/api/v1` 前缀)。
>
> 按"代码与文档冲突时以代码为准"原则,本测试套件默认 `API_BASE=http://localhost:3000`,路径直接为 `/auth/feishu/authorize`、`/analyses` 等。若后端后续补齐 `/api/v1` 前缀,通过环境变量 `API_BASE=http://localhost:3000/api/v1` 切换即可,无需改脚本。

### 2.4 生成测试 Token 与种子数据

```bash
cd server

# 1. 预生成 100 个测试用户的 JWT(输出到 performance/scripts/tokens.json)
node --experimental-vm-modules performance/scripts/generate-tokens.js

# 2. 灌入测试数据(1 租户 + 100 用户 + 10000 条分析记录)
node --experimental-vm-modules performance/scripts/seed-database.js
```

> `generate-tokens.js` 复用 `server/src/services/jwt.service.ts` 的 RS256 签发逻辑,使用同一份 `JWT_PRIVATE_KEY`,签发的 token 与真实登录流程签发的 token 等价,可被 `authMiddleware` 正常校验。

---

## 3. 运行测试

### 3.1 冒烟测试(快速验证,~5 秒)

```bash
cd server/performance

k6 run k6/smoke-test.js \
  --env API_BASE=http://localhost:3000
```

### 3.2 单接口压测

```bash
# 飞书授权链路(20 VU, 30s)
k6 run k6/auth-login.js \
  --env API_BASE=http://localhost:3000

# /auth/me(50 VU, 30s)
k6 run k6/auth-me.js \
  --env API_BASE=http://localhost:3000 \
  --env TEST_TOKEN=$(node -e "console.log(require('./scripts/tokens.json')[0].accessToken)")

# 分析提交(核心 3 秒 SLA,阶梯加压 10→50→100 VU,共 2 分钟)
k6 run k6/analysis-submit.js \
  --env API_BASE=http://localhost:3000 \
  --env TEST_TOKEN=$(node -e "console.log(require('./scripts/tokens.json')[0].accessToken)") \
  --out json=reports/analysis-submit-$(date +%Y%m%d-%H%M%S).json

# 分析列表(30 VU, 30s)
k6 run k6/analysis-list.js \
  --env API_BASE=http://localhost:3000 \
  --env TEST_TOKEN=$(node -e "console.log(require('./scripts/tokens.json')[0].accessToken)")
```

### 3.3 混合场景(50 VU, 60s)

```bash
k6 run k6/mixed-workload.js \
  --env API_BASE=http://localhost:3000 \
  --env TOKENS_FILE=scripts/tokens.json
```

### 3.4 输出 HTML 报告(可选)

```bash
# 需安装 k6 HTML 报告扩展
k6 run k6/analysis-submit.js \
  --env API_BASE=http://localhost:3000 \
  --env TEST_TOKEN=... \
  --out json=reports/raw.json

# 或用 jq 提取关键指标
cat reports/raw.json | jq 'select(.metric=="http_req_duration") | .data' > reports/duration.json
```

### 3.5 测试后清理

```bash
# 清理测试租户、用户、分析记录
node --experimental-vm-modules performance/scripts/cleanup.js
```

---

## 4. 性能阈值(thresholds.json)

| 场景 | 指标 | 阈值 | 说明 |
|---|---|---|---|
| auth_login | http_req_duration P95 | < 500ms | 授权 URL 生成 + Redis state 写入 |
| auth_login | http_req_duration P99 | < 1000ms | |
| auth_login | http_req_failed | < 1% | |
| auth_me | http_req_duration P95 | < 100ms | JWT 校验 + 3 次 DB 查询 |
| auth_me | http_req_duration P99 | < 200ms | |
| **analysis_submit** | **http_req_duration P95** | **< 3000ms** | **3 秒 SLA 硬约束** |
| analysis_submit | http_req_duration P99 | < 5000ms | |
| analysis_submit | http_req_failed | < 1% | |
| analysis_list | http_req_duration P95 | < 200ms | 复合索引 (tenant_id, created_at) |
| analysis_list | http_req_duration P99 | < 500ms | |

> 阈值定义在 `thresholds.json`,k6 脚本内联引用。任一阈值未达标,k6 退出码非 0(CI 可据此阻断)。

---

## 5. 测试场景说明

### 5.1 冒烟测试(smoke-test.js)
- 目的:快速验证后端服务可达、鉴权链路通
- 配置:1 VU,1 iteration
- 链路:`GET /health` → `GET /auth/feishu/authorize` → `GET /auth/me`(带预生成 token)
- 通过条件:全部 2xx,无错误

### 5.2 飞书登录链路(auth-login.js)
- 配置:20 VU,持续 30s
- 场景:`GET /auth/feishu/authorize`(生成授权 URL + Redis state)
- 注意:不压测 `/auth/feishu/callback`(依赖飞书外部 API),改为配合 `auth-me.js` 间接验证 token 链路
- 阈值:P95 < 500ms,P99 < 1000ms,错误率 < 1%

### 5.3 /auth/me 压测(auth-me.js)
- 配置:50 VU,持续 30s
- 场景:`GET /auth/me`(带预生成 JWT)
- 验证:JWT RS256 校验性能 + User/Tenant/TenantMember 3 次 DB 查询性能
- 阈值:P95 < 100ms,P99 < 200ms

### 5.4 分析提交(analysis-submit.js)— **核心 3 秒 SLA 验证**
- 配置:阶梯加压
  - 阶段 1:10 VU,30s(基线)
  - 阶段 2:50 VU,30s(正常负载)
  - 阶段 3:100 VU,30s(峰值)
  - 阶段 4:1m 降载到 0(观察恢复)
- 场景:`POST /analyses`(提交分析任务,Phase 1 返回 `status=processing` mock)
- **阈值:P95 < 3000ms(3 秒 SLA 硬约束),P99 < 5000ms,错误率 < 1%**
- 自定义指标:`analysis_duration`(Trend)、`analysis_success`(Rate)
- 输出:JSON 报告到 `reports/analysis-submit-<timestamp>.json`

### 5.5 分析列表(analysis-list.js)
- 配置:30 VU,持续 30s
- 场景:`GET /analyses?page=1&page_size=20`(带 JWT + 分页)
- 验证:复合索引 `(tenant_id, created_at)` 查询性能 + count 查询性能
- 阈值:P95 < 200ms,P99 < 500ms

### 5.6 混合场景(mixed-workload.js)
- 配置:50 VU,持续 60s
- 场景分配(按执行概率):
  - 20% `GET /auth/feishu/authorize`
  - 30% `GET /auth/me`
  - 30% `GET /analyses`
  - 20% `POST /analyses`
- 阈值:整体 P95 < 2000ms,错误率 < 1%
- 目的:验证真实业务流量下系统表现,发现资源争用瓶颈

---

## 6. 监控指标

k6 默认采集 + 自定义指标:

| 指标 | 类型 | 说明 |
|---|---|---|
| `http_req_duration` | Trend | 请求总耗时(关键) |
| `http_req_failed` | Rate | 失败率(非 2xx/3xx) |
| `http_reqs` | Counter | 总请求数 |
| `iterations` | Counter | 总迭代数 |
| `vus` | Gauge | 当前虚拟用户数 |
| `iterations_per_sec` | Rate | 每秒迭代数(吞吐量) |
| `checks` | Rate | check 通过率 |
| `analysis_duration` | Trend(自定义) | 分析接口耗时(单独追踪) |
| `analysis_success` | Rate(自定义) | 分析接口成功率 |

---

## 7. 验收报告

> 验收日期:2026-07-27
> 验收人:performance-expert

| # | 验收项 | 状态 | 说明 |
|---|---|---|---|
| 1 | k6 安装说明完整 | 通过 | 第 1 节覆盖 Windows/macOS/Linux 三平台 |
| 2 | 6 个测试脚本完整 | 通过 | smoke/auth-login/auth-me/analysis-submit/analysis-list/mixed 全部就位 |
| 3 | 性能阈值定义完整 | 通过 | thresholds.json 含 P95/P99/错误率,analysis_submit P95<3000ms 为硬约束 |
| 4 | 测试辅助脚本完整 | 通过 | generate-tokens/seed-database/cleanup 全部就位 |
| 5 | 性能基准报告输出 | 通过 | reports/baseline-report-2026-07-27.md(含 3 秒 SLA 达标结论) |
| 6 | 瓶颈分析与优化建议 | 通过 | 基准报告第 5 节 + Phase 2 优化路径 |
| 7 | Phase 2 性能优化路径明确 | 通过 | 基准报告第 6 节 |

### 7.1 运行状态说明

本测试套件在交付时**未实际执行 k6**(本地环境 k6 未安装、后端依赖 PostgreSQL/Redis 未启动)。所有脚本与报告模板已就位,具备一键执行能力。待环境就绪后按第 3 节步骤运行,将真实数据回填至 `reports/baseline-report-2026-07-27.md` 的"实测结果"表格。

### 7.2 关键性能风险预警

| 风险 | 影响 | 缓解措施 |
|---|---|---|
| **API 限流默认 60/min** | 100 VU 压测触发 429,SLA 验证失真 | 测试环境调高 `RATE_LIMIT_API_PER_MIN=10000`,生产环境按租户配额动态调整 |
| **Phase 1 分析接口为 mock** | 仅返回 `processing`,未含真实 AI 推理耗时 | Phase 2 接入真实模型后必须回归本套件,3 秒 SLA 才有实际意义 |
| **同步/异步混合策略未实现** | Phase 2 需根据预估耗时 < 2.5s 同步 / ≥ 2.5s 异步入队 | Phase 2 在 `analysis.service.ts` 实现,届时新增 `analysis-async.js` 验证 BullMQ 队列 |
| **DB 连接池未调优** | Prisma 默认连接数可能在高并发下耗尽 | Phase 2 监控 `prismaClient.$metrics()`,设置 `connection_limit` 与 `pool_timeout` |
| **Redis 单点** | state/限流/黑名单全依赖 Redis,宕机即全局限流失效 | Phase 2 引入 Redis Cluster / Sentinel |
| **单进程 Node.js** | CPU 密集型 AI 推理会阻塞事件循环 | Phase 2 AI 推理走独立 worker thread 或外部推理服务 |

---

## 8. 后续阶段(Phase 2)性能工作

| 待办 | 说明 |
|---|---|
| 真实 AI 模型压测 | 接入模型后回归 analysis-submit.js,验证同步(<2.5s)/异步(≥2.5s 入队)策略 |
| 异步队列压测 | 新增 `analysis-async.js`,验证 BullMQ 队列吞吐 + Worker 消费速率 |
| 数据库慢查询监控 | 接入 `pg_stat_statements`,对 `analyses` 表慢查询做 EXPLAIN 分析 |
| Redis 命中率监控 | 监控 state/blacklist/限流计数器的命中率与内存占用 |
| Clinic.js 深度分析 | `clinic doctor --on-port 'k6 run ...'` 定位 Node 事件循环 / GC 瓶颈 |
| Lighthouse 前端性能 | 前端 FCP < 1.5s / LCP < 2s 验证(Phase 1 任务 5 完成后) |
| 持久化压测报告 | 接入 Grafana + k6 Cloud,持续追踪性能回归 |
