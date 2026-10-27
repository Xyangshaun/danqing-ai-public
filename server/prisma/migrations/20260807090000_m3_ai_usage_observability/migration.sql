-- AlterTable (M3-T1 可观测性:AI 用量日志追加降级标记 + traceId)
-- 向后兼容:used_fallback 非空默认 false;trace_id 可空
ALTER TABLE "ai_usage_logs" ADD COLUMN     "used_fallback" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "trace_id" VARCHAR(64);
