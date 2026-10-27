-- CreateTable: deployment_logs(任务包 C:部署日志同步机制)
-- 记录项目本体(前端 dist)每次部署完成/失败的系统级日志
-- 由部署脚本(deploy-ssh.sh)通过共享密钥 X-Deploy-Secret 上报
-- 供下游任务/运维通过 GET /api/v1/deployments/latest 可靠查询部署状态

-- CreateTable: deployment_logs
CREATE TABLE "deployment_logs" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" VARCHAR(64) NOT NULL,
    "server_id" VARCHAR(64) NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "deployer" VARCHAR(64),
    "branch" VARCHAR(64),
    "commit_sha" VARCHAR(64),
    "details" JSONB,
    "error_message" TEXT,
    "source_ip" VARCHAR(45),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deployment_logs_pkey" PRIMARY KEY ("id")
);

-- 索引:按状态筛选(运维只看失败记录)
CREATE INDEX "deployment_logs_status_idx" ON "deployment_logs"("status");

-- 索引:按时间倒序(最新部署)
CREATE INDEX "deployment_logs_timestamp_idx" ON "deployment_logs"("timestamp");

-- 索引:按服务器+时间(单机部署历史)
CREATE INDEX "deployment_logs_server_id_timestamp_idx" ON "deployment_logs"("server_id", "timestamp");