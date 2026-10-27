# ============================================================
# 丹青有AI - Node.js 后端 Dockerfile
# 多阶段构建:build(tsc 编译) → runtime(仅生产依赖 + dist)
#
# 对应文档:.trae/documents/redis-brpop-fix-2026-08-07.md
# 监控配置固化:通过环境变量 RATE_LIMIT_REDIS_TIMEOUT_MS /
#               REDIS_METRICS_LOG_INTERVAL_MS 控制
# ============================================================

# ---------- Stage 1: Build ----------
FROM node:20-alpine AS builder

WORKDIR /app

# 先复制 package 文件,利用 Docker 层缓存
COPY server/package.json server/package-lock.json* ./server/
COPY server/prisma ./server/prisma/

# 安装所有依赖(含 devDependencies,用于 tsc 编译)
RUN cd server && npm ci || npm install

# 复制源码
COPY server/tsconfig.json ./server/
COPY server/src ./server/src/

# 编译 TypeScript → dist/
RUN cd server && npx prisma generate && npx tsc -p tsconfig.json

# ---------- Stage 2: Runtime ----------
FROM node:20-alpine AS runtime

# 安装 dumb-init(正确的 PID 1 信号处理)
RUN apk add --no-cache dumb-init curl

# 创建非 root 用户
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001 -G nodejs

WORKDIR /app

# 复制 package 文件,仅安装生产依赖
COPY server/package.json server/package-lock.json* ./server/
COPY server/prisma ./server/prisma/

RUN cd server && npm ci --omit=dev || npm install --omit=dev
RUN cd server && npx prisma generate

# 从 builder 复制编译产物
COPY --from=builder /app/server/dist ./server/dist

# 复制 Prisma schema(运行时 migrate 需要)
COPY server/prisma ./server/prisma/

# 复制前端构建产物(如果有,由 CI 先构建好)
COPY dist ./dist

# 切换非 root 用户
USER nodejs

# 暴露端口
EXPOSE 3000

# 健康检查(含 Redis metrics 端点可达性)
# /health 为基础存活检查;/api/v1/metrics/redis 为 Redis 监控端点
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -sf http://localhost:3000/health || exit 1

# 使用 dumb-init 处理信号(优雅退出)
ENTRYPOINT ["dumb-init", "--"]

# Node 20 原生 --env-file 加载环境变量(对应项目硬约束)
CMD ["node", "--env-file=server/.env", "server/dist/index.js"]
