# 丹青有AI - k6 性能测试脚本

> 后端服务 Express + Prisma + Redis 的性能基线与回归压测脚本集。
> 3 秒 SLA 是硬约束(`analysis_submit.http_req_duration P95 < 3000ms`)。

## 目录

- [一、环境前置](#一环境前置)
- [二、脚本清单与执行命令](#二脚本清单与执行命令)
- [三、阈值说明](#三阈值说明)
- [四、CI 集成建议](#四ci-集成建议)
- [五、故障排查](#五故障排查)
- [六、接口路径说明](#六接口路径说明)

---

## 一、环境前置

### 1. 安装 k6

```bash
# Windows (Scoop)
scoop install k6

# Windows (Chocolatey)
choco install k6

# macOS (Homebrew)
brew install k6

# Linux (官方 APT 源)
sudo gpg -k && sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt update && sudo apt install k6

# 验证
k6 version
```

### 2. 启动后端服务

```bash
cd server
cp .env.example .env        # 配置 DATABASE_URL / REDIS_URL / JWT_SECRET 等
npm install
npx prisma migrate deploy   # 执行数据库迁移
npx prisma db seed          # 灌入种子数据(含 10000 条分析记录 + 通知数据)
npm run dev                 # 默认监听 http://localhost:3000
```

健康检查验证:

```bash
curl http://localhost:3000/health
# 期望:{"code":0,"data":{"status":"up","service":"danqing-ai-server",...}}
```

### 3. 准备测试账号与 Token

压测脚本支持 3 种 token 来源(优先级从高到低):

| 优先级 | 方式 | 环境变量 | 适用场景 |
|---|---|---|---|
| 1 | 多 token 文件(推荐) | `TOKENS_FILE=scripts/tokens.json` | 所有压测,尤其 100 并发 |
| 2 | 单 token | `TEST_TOKEN=<accessToken>` | 冒烟、单接口调试 |
| 3 | 邮箱密码登录 | `TEST_USER_EMAIL` + `TEST_USER_PASSWORD` | 无预生成 token 时兜底 |

生成多 token(推荐,concurrent-100 需 ≥100 条):

```bash
cd server
node performance/scripts/generate-tokens.js --count 100
# 输出:performance/scripts/tokens.json
# 格式:[{ userId, tenantId, role, accessToken, ... }, ...]
```

> 注意:`/auth/login/admin` 限流 5 次/min,无法在 setup 阶段批量登录 100 个 token。
> concurrent-100 场景必须使用 `generate-tokens.js` 离线预生成 ≥100 个 token。

---

## 二、脚本清单与执行命令

所有脚本默认 `BASE_URL=http://localhost:3000/api/v1`(已含 `/api/v1` 前缀)。
可通过 `--env BASE_URL=...` 覆盖;兼容现有脚本的 `API_BASE` 变量。

### 公共环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `BASE_URL` | `http://localhost:3000/api/v1` | API 基址(任务约定,推荐) |
| `API_BASE` | (回退) | 兼容现有 6 个脚本,优先级低于 BASE_URL |
| `TOKENS_FILE` | `scripts/tokens.json` | 多 token 文件路径 |
| `TEST_TOKEN` | (空) | 单 token |
| `TEST_USER_EMAIL` | (空) | 管理员邮箱(登录兜底) |
| `TEST_USER_PASSWORD` | (空) | 管理员密码(登录兜底) |

> 工作目录约定:在 `server/` 下执行,使 `scripts/tokens.json` 相对路径生效。
> 若在 `server/performance/k6/` 下执行,需设 `--env TOKENS_FILE=../scripts/tokens.json`。

### 1. smoke-test.js(冒烟测试)

快速验证服务可达、鉴权链路通。1 VU,1 iteration,约 5 秒。

```bash
cd server
k6 run performance/k6/smoke-test.js \
  --env BASE_URL=http://localhost:3000/api/v1 \
  --env TEST_TOKEN=<accessToken>
```

### 2. auth-login.js(飞书授权链路)

20 VU,30s。`GET /auth/feishu/authorize`(生成授权 URL + Redis state 写入)。

```bash
k6 run performance/k6/auth-login.js \
  --env BASE_URL=http://localhost:3000/api/v1
```

### 3. auth-me.js(当前用户信息)

50 VU,30s。`GET /auth/me`(JWT RS256 校验 + 3 次 DB 查询)。

```bash
k6 run performance/k6/auth-me.js \
  --env BASE_URL=http://localhost:3000/api/v1 \
  --env TOKENS_FILE=scripts/tokens.json
```

### 4. analysis-list.js(分析列表)

30 VU,30s。`GET /analyses`(分页 + artType 筛选)。

```bash
k6 run performance/k6/analysis-list.js \
  --env BASE_URL=http://localhost:3000/api/v1 \
  --env TOKENS_FILE=scripts/tokens.json
```

### 5. analysis-submit.js(分析提交 - 3 秒 SLA 核心)

阶梯加压 10→50→100 VU(共 2 分钟)。`POST /analyses`。
★★★ 3 秒 SLA 硬约束验证(P95 < 3000ms)★★★

```bash
k6 run performance/k6/analysis-submit.js \
  --env BASE_URL=http://localhost:3000/api/v1 \
  --env TOKENS_FILE=scripts/tokens.json
```

### 6. mixed-workload.js(混合场景)

50 VU,60s。authorize 20% / me 30% / list 30% / submit 20%。

```bash
k6 run performance/k6/mixed-workload.js \
  --env BASE_URL=http://localhost:3000/api/v1 \
  --env TOKENS_FILE=scripts/tokens.json
```

### 7. notification-list.js(通知列表 - 新增)

50 VU,30s。`GET /notifications`(游标分页 + onlyUnread 筛选)。

```bash
k6 run performance/k6/notification-list.js \
  --env BASE_URL=http://localhost:3000/api/v1 \
  --env TOKENS_FILE=scripts/tokens.json

# 无预生成 token 时,用邮箱密码登录兜底(单 token 复用):
k6 run performance/k6/notification-list.js \
  --env BASE_URL=http://localhost:3000/api/v1 \
  --env TEST_USER_EMAIL=admin@demo.edu.cn \
  --env TEST_USER_PASSWORD=<password>
```

### 8. history-list.js(历史记录列表 - 新增)

30 VU,30s。`GET /analyses`(深分页 8-15 页 + artType 筛选)。

```bash
k6 run performance/k6/history-list.js \
  --env BASE_URL=http://localhost:3000/api/v1 \
  --env TOKENS_FILE=scripts/tokens.json
```

### 9. concurrent-100.js(100 并发混合负载 - 新增)

100 VU,60s。5 场景加权混合,验证 3 秒 SLA 在峰值并发下保持。
**必须使用 ≥100 个预生成 token**,否则多 VU 共享 token 会触发限流(60/min/用户)。

```bash
# 步骤 1:生成 100 个 token(一次性)
node performance/scripts/generate-tokens.js --count 100

# 步骤 2:执行 100 并发压测
k6 run performance/k6/concurrent-100.js \
  --env BASE_URL=http://localhost:3000/api/v1 \
  --env TOKENS_FILE=scripts/tokens.json
```

---

## 三、阈值说明

阈值统一配置在 [thresholds.json](../thresholds.json),脚本内 `export const options.thresholds` 与之一致。

| 场景 | 脚本 | VU | 时长 | P95 | P99 | 错误率 | 迭代数 |
|---|---|---|---|---|---|---|---|
| smoke | smoke-test.js | 1 | 1 iter | - | - | <1% | - |
| auth_login | auth-login.js | 20 | 30s | <500ms | <1000ms | <1% | >100 |
| auth_me | auth-me.js | 50 | 30s | <100ms | <200ms | <1% | >500 |
| analysis_list | analysis-list.js | 30 | 30s | <200ms | <500ms | <1% | >500 |
| analysis_submit | analysis-submit.js | 10→100 | 2min | **<3000ms** | <5000ms | <1% | >200 |
| mixed | mixed-workload.js | 50 | 60s | <2000ms | <4000ms | <1% | >1000 |
| **notification_list** | notification-list.js | 50 | 30s | <200ms | <500ms | <1% | >500 |
| **history_list** | history-list.js | 30 | 30s | <300ms | <800ms | <1% | >300 |
| **concurrent_100** | concurrent-100.js | 100 | 60s | <2000ms | <4000ms | <2% | >500 |

> 加粗为本次新增场景。
> `analysis_submit` 的 P95 < 3000ms 是 3 秒 SLA 硬约束,违反即判定回归失败。
> `concurrent_100` 的 P95 < 2000ms 比 SLA 严格 1 秒,留缓冲;P99 < 4000ms。
> `concurrent_100` 错误率放宽至 2%,因 100 并发下 `/auth/feishu/authorize` 限流(10/min)会产生 429(k6 默认 429 不计入 http_req_failed,但 check 可能失败)。

---

## 四、CI 集成建议

### 1. 基本集成(退出码控制)

k6 阈值未达标时退出码非 0,CI 流水线自动失败:

```bash
# GitHub Actions 示例
- name: Run k6 smoke test
  run: |
    k6 run performance/k6/smoke-test.js \
      --env BASE_URL=${{ secrets.API_BASE }} \
      --env TEST_TOKEN=${{ secrets.TEST_TOKEN }}
```

### 2. 输出 JSON 报告 + 阈值卡点

```bash
k6 run performance/k6/concurrent-100.js \
  --env BASE_URL=http://localhost:3000/api/v1 \
  --env TOKENS_FILE=scripts/tokens.json \
  --out json=results/concurrent-100-$(date +%s).json

# k6 退出码:0 = 全部阈值通过,1 = 有阈值未达标,107 = 无效选项
echo "k6 exit code: $?"
```

### 3. CI 流水线推荐顺序

```text
1. smoke-test        (5s,    服务可达性自检)
2. auth-login        (30s,   鉴权链路基线)
3. auth-me           (30s,   JWT + DB 基线)
4. notification-list (30s,   通知列表基线)
5. history-list      (30s,   历史列表基线)
6. analysis-list     (30s,   分析列表基线)
7. analysis-submit   (2min,  ★3秒SLA硬约束★,PR 合并门禁)
8. mixed-workload    (1min,  混合回归)
9. concurrent-100    (1min,  100并发峰值,夜间/预发布)
```

PR 合并门禁建议:`smoke` + `auth-me` + `analysis-submit`(3 秒 SLA)。
夜间/预发布跑全量(含 `concurrent-100`)。

### 4. 多报告输出

```bash
k6 run performance/k6/analysis-submit.js \
  --out json=results/submit.json \
  --out csv=results/submit.csv \
  --env BASE_URL=http://localhost:3000/api/v1
```

---

## 五、故障排查

### 1. 连接拒绝 / dial tcp: connection refused

**现象**:`k6` 报 `connection refused` 或 `dial tcp 127.0.0.1:3000`。

**原因**:后端服务未启动,或 `BASE_URL` 端口错误。

**排查**:

```bash
curl http://localhost:3000/health
# 不通 → 启动服务:cd server && npm run dev
# 通但 k6 失败 → 检查 BASE_URL 是否含 /api/v1 前缀
```

> 注意:新脚本默认 `BASE_URL=http://localhost:3000/api/v1`(含前缀)。
> 现有 6 个脚本默认 `API_BASE=http://localhost:3000`(不含前缀),需手动传 `--env API_BASE=http://localhost:3000/api/v1`。

### 2. token 失效 / 401 Unauthorized

**现象**:check 失败,`status=401`,`code=1003` 或 `UNAUTHORIZED`。

**原因**:
- JWT 过期(默认有效期见 `JWT_ACCESS_EXPIRES_IN`)
- `TEST_TOKEN` 无效或为空
- `tokens.json` 加载失败

**排查**:

```bash
# 验证 token 有效性
curl -H "Authorization: Bearer <token>" http://localhost:3000/api/v1/auth/me
# 401 → 重新生成:node performance/scripts/generate-tokens.js --count 100

# 检查 tokens.json 是否存在
ls -la server/performance/scripts/tokens.json
```

### 3. 限流 429 Too Many Requests

**现象**:`status=429`,`code=1007` 或 `RATE_LIMITED`。

**原因**:
- 单 token 被 60 次/min 限流(apiRateLimiter)
- `/auth/feishu/authorize` 限流 10/min
- `/auth/login/admin` 限流 5/min

**排查**:
- concurrent-100 出现 429 → 未使用多 token,改用 `TOKENS_FILE`(≥100 条)
- notification-list/history-list 出现 429 → 多 VU 共享单 token,改用多 token
- concurrent-100 的 authorize 场景 429 属预期(check 已接受 429)

### 4. 3 秒 SLA 突破(analysis-submit / concurrent-100)

**现象**:`sla_violations` 计数 > 0,`P95 >= 3000ms`,摘要输出 `❌ FAIL`。

**排查路径**(按层定位):

```text
1. 数据库层:EXPLAIN ANALYZE 慢查询
   - analysis-list:检查 (tenant_id, created_at) 复合索引
   - notification-list:检查 (tenant_id, user_id, created_at) 索引
2. Redis 层:redis-cli --latency,检查 state 写入 / 限流计数延迟
3. 应用层:Clinic.js doctor --on PORT,定位事件循环阻塞
4. 资源层:CPU > 80% / 内存 > 80% / 连接池耗尽
```

**常见根因**:
- N+1 查询(分析列表展开用户/作品信息)
- 缺失索引导致全表扫描(深分页 OFFSET 过大)
- Redis 连接池耗尽(authorize 频繁写 state)
- Prisma 查询未用 select 导致回表

### 5. tokens.json 加载失败

**现象**:`[xxx] 无法加载 scripts/tokens.json` + `token_exhausted` 计数 > 0。

**排查**:

```bash
# 工作目录需在 server/ 下,使相对路径 scripts/tokens.json 生效
cd server
ls performance/scripts/tokens.json

# 或显式指定绝对路径
k6 run performance/k6/concurrent-100.js \
  --env TOKENS_FILE=C:/path/to/tokens.json
```

### 6. BASE_URL 前缀错误(404 Not Found)

**现象**:`status=404`,响应为 HTML(非 JSON)。

**原因**:`BASE_URL` 未含 `/api/v1` 前缀,或路径拼写错误。

**排查**:

```bash
# 错误(缺前缀):
--env BASE_URL=http://localhost:3000    # 请求 /notifications → 404

# 正确:
--env BASE_URL=http://localhost:3000/api/v1
```

---

## 六、接口路径说明

所有接口挂载在 `/api/v1` 前缀下(见 `server/src/app.ts`: `app.use('/api/v1', apiV1)`)。

| 脚本 | 实际接口路径 | 鉴权 | 限流 | 备注 |
|---|---|---|---|---|
| smoke-test | `GET /health` + `GET /auth/feishu/authorize` + `GET /auth/me` | 部分 | - | 健康检查无需鉴权 |
| auth-login | `GET /auth/feishu/authorize` | 否 | 10/min | 不压 callback(依赖飞书) |
| auth-me | `GET /auth/me` | 是 | 60/min | JWT 校验 + DB |
| analysis-list | `GET /analyses` | 是 | 60/min | 分页 + artType 筛选 |
| analysis-submit | `POST /analyses` | 是 | 60/min | ★3秒SLA★ |
| mixed-workload | authorize/me/list/submit 混合 | 部分 | 各自限流 | - |
| **notification-list** | `GET /notifications` | 是 | 60/min | 游标分页(limit/cursor/onlyUnread) |
| **history-list** | `GET /analyses` | 是 | 60/min | 深分页,与 analysis-list 同接口不同参数 |
| **concurrent-100** | authorize/me/analyses/notifications 混合 | 部分 | 各自限流 | 100 并发峰值 |

### 关于 history-list 路径说明

`analysis.routes.ts` 中**历史记录列表接口路径为 `GET /analyses`,无独立 `/analysis/history` 路径**。
`history-list.js` 以 `analysis.routes.ts` 为准,使用 `GET /analyses` 并配合深分页(8-15 页)+ `artType` 筛选参数,与 `analysis-list.js`(浅分页 1-10 页)在参数策略上区分,共同覆盖该接口的性能基线。

### 关于 notification 路径确认

`notification.routes.ts` 已确认存在(挂载于 `/api/v1/notifications`),接口契约:
- `GET /api/v1/notifications?limit=<1-50>&cursor=<base64url>&onlyUnread=<true|1>`
- 响应:`{ code:0, data:{ items:[Notification], nextCursor:string|null } }`

无需后端确认路径,已从源码 `server/src/routes/notification.routes.ts` 核实。
