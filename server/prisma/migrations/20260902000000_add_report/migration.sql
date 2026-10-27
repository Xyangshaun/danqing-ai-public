-- CreateTable: reports(投诉举报机制,公安备案合规)
-- 任意登录用户对作品/评论/用户发起举报;管理端只读列表(GET /api/admin/reports)
-- 多租户隔离:tenant_id 强制过滤(隔离 + 审计归属)
-- 24h 去重:索引 (reporter_id, target_id, created_at) 支撑应用层窗口查询
-- 管理端列表:索引 (status, created_at) 支撑 status 过滤 + createdAt 倒序分页
-- 注:本迁移由后端按 schema.prisma 手写(与 prisma migrate 产物格式一致),
--     本地无数据库环境时需人工执行 `prisma migrate deploy` 应用

-- CreateEnum: ReportTargetType
CREATE TYPE "ReportTargetType" AS ENUM ('artwork', 'comment', 'user');

-- CreateEnum: ReportReason
CREATE TYPE "ReportReason" AS ENUM ('porn', 'violence', 'politics', 'copyright', 'spam', 'other');

-- CreateEnum: ReportStatus
CREATE TYPE "ReportStatus" AS ENUM ('pending', 'resolved', 'dismissed');

-- CreateTable: reports
CREATE TABLE "reports" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "reporter_id" TEXT NOT NULL,
    "target_type" "ReportTargetType" NOT NULL,
    "target_id" TEXT NOT NULL,
    "reason" "ReportReason" NOT NULL,
    "detail" VARCHAR(500),
    "status" "ReportStatus" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- 索引:同用户同目标 24h 去重窗口查询
CREATE INDEX "reports_reporter_id_target_id_created_at_idx" ON "reports"("reporter_id", "target_id", "created_at");

-- 索引:管理端列表(status 过滤 + createdAt 倒序分页)
CREATE INDEX "reports_status_created_at_idx" ON "reports"("status", "created_at");

-- 外键约束:租户级联删除(租户删除时一并清理举报记录)
ALTER TABLE "reports" ADD CONSTRAINT "reports_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 外键约束:举报人 Restrict(举报记录作为合规证据,不随用户物理删除级联清理;
-- 用户删除走软删除 status='deleted',物理删除被本约束拦截)
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_fkey"
    FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
