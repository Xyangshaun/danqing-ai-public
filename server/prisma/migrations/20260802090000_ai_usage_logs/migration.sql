-- CreateTable: ai_usage_logs(用量统计模块)
-- 每次 AI 调用(成功/失败均记录)异步落库一条
-- 用于管理后台 GET /api/admin/stats/ai-usage/* 系列统计接口

CREATE TABLE "ai_usage_logs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "analysis_id" TEXT,
    "provider" VARCHAR(16) NOT NULL,
    "model" VARCHAR(64) NOT NULL,
    "api_url" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "prompt_tokens" INTEGER,
    "completion_tokens" INTEGER,
    "total_tokens" INTEGER,
    "cost_yuan" DECIMAL(10,6),
    "failure_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_logs_pkey" PRIMARY KEY ("id")
);

-- 索引:覆盖按租户+时间 / 按用户 / 按 Provider / 按成功状态 4 个查询模式
CREATE INDEX "ai_usage_logs_tenant_id_created_at_idx" ON "ai_usage_logs"("tenant_id", "created_at");
CREATE INDEX "ai_usage_logs_user_id_idx" ON "ai_usage_logs"("user_id");
CREATE INDEX "ai_usage_logs_provider_idx" ON "ai_usage_logs"("provider");
CREATE INDEX "ai_usage_logs_success_idx" ON "ai_usage_logs"("success");

-- 外键约束(analysis_id 可空,关联 analyses.id;ON DELETE SET NULL 避免删除 Analysis 阻塞)
ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_analysis_id_fkey"
    FOREIGN KEY ("analysis_id") REFERENCES "analyses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
