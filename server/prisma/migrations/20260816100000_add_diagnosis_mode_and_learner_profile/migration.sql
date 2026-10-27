-- ============================================================
-- 诊断理念重构:双模式诊断(教学诊断/艺考诊断)+ 学习者画像
-- 1. users.learner_profile: 学习者画像(hobbyist/artStudent),与权限 role 正交
-- 2. analyses.diagnosis_mode: 诊断模式(teaching/exam),默认 teaching,旧数据零迁移
-- 3. analyses.exam_subject: 艺考科目(sketch/color/quickSketch),仅 exam 模式有意义
-- 全部可空或有默认值,存量数据无风险
-- ============================================================

-- User: 学习者画像
ALTER TABLE "users" ADD COLUMN "learner_profile" VARCHAR(16);

-- Analysis: 诊断模式 + 艺考科目
ALTER TABLE "analyses" ADD COLUMN "diagnosis_mode" VARCHAR(16) NOT NULL DEFAULT 'teaching';
ALTER TABLE "analyses" ADD COLUMN "exam_subject" VARCHAR(16);

-- 索引:按诊断模式筛选(管理后台/统计)
CREATE INDEX "analyses_diagnosis_mode_idx" ON "analyses"("diagnosis_mode");
