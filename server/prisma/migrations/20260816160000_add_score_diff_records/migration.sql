-- ============================================================
-- 评分链路透明化(框架二 P2):AI-教师评分差异数据表
-- 教师评审/仲裁裁定时自动记录 AI 评分与人工评分的差异,
-- 为「AI 与专业教师一致性指标」(MAE/档位一致率/偏差方向)提供数据基础
-- 全部可空或有默认值,存量数据零风险
-- ============================================================

-- CreateTable
CREATE TABLE "score_diff_records" (
    "id" UUID NOT NULL,
    "analysis_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "source" VARCHAR(32) NOT NULL,
    "reviewer_id" TEXT,
    "ai_score" JSONB NOT NULL,
    "ai_band" VARCHAR(8) NOT NULL,
    "human_score" JSONB NOT NULL,
    "human_band" VARCHAR(8) NOT NULL,
    "overall_diff" DOUBLE PRECISION NOT NULL,
    "dimension_diffs" JSONB NOT NULL,
    "band_agreement" BOOLEAN NOT NULL,
    "art_type" VARCHAR(16) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "score_diff_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "score_diff_records_tenant_id_created_at_idx" ON "score_diff_records"("tenant_id", "created_at");
CREATE INDEX "score_diff_records_analysis_id_idx" ON "score_diff_records"("analysis_id");
CREATE INDEX "score_diff_records_tenant_id_band_agreement_idx" ON "score_diff_records"("tenant_id", "band_agreement");

-- AddForeignKey
ALTER TABLE "score_diff_records" ADD CONSTRAINT "score_diff_records_analysis_id_fkey" FOREIGN KEY ("analysis_id") REFERENCES "analyses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
