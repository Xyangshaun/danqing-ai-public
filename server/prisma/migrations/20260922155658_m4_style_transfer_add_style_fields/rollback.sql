-- ============================================================
-- 回滚 M-4 风格迁移三列(DOC-2026-09-002,幂等,IF EXISTS)
-- 对应迁移:20260922155658_m4_style_transfer_add_style_fields/migration.sql
-- 执行前置:先回滚代码(停止写入新列),再执行本 SQL
-- 禁止使用 prisma migrate reset(红线命令),仅执行本文件 SQL
-- 依据:.trae/documents/m4-style-transfer-plan-2026-09-22.md §3.3
-- ============================================================
ALTER TABLE generation_tasks DROP COLUMN IF EXISTS processing_started_at;
ALTER TABLE generation_tasks DROP COLUMN IF EXISTS style_analysis;
ALTER TABLE generation_tasks DROP COLUMN IF EXISTS style_image_url;
