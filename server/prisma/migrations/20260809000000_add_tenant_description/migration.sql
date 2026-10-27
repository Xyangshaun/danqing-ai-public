-- AlterTable
-- 班级管理 API:Tenant 追加 description(仅 type=class 的班级租户使用,最大 500 字符)
ALTER TABLE "tenants" ADD COLUMN     "description" VARCHAR(500);
