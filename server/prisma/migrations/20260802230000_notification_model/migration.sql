-- CreateTable: notifications(任务包 B:通知系统真实数据接入)
-- 用户通知收件箱,多租户隔离(tenant_id + user_id)
-- 触发点:分析完成/失败、成长报告生成、订阅到期、邀请等
-- 3 秒 SLA:索引覆盖 (tenant_id, user_id, read_at) 与 (tenant_id, user_id, created_at)
-- 游标分页:ORDER BY created_at DESC, id DESC

-- CreateEnum: NotificationType
CREATE TYPE "NotificationType" AS ENUM ('SYSTEM', 'ANALYSIS_DONE', 'ANALYSIS_FAIL', 'REVIEW', 'SUBSCRIPTION', 'INVITATION');

-- CreateEnum: NotificationLevel
CREATE TYPE "NotificationLevel" AS ENUM ('INFO', 'SUCCESS', 'WARN', 'ERROR');

-- CreateTable: notifications
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" VARCHAR(128) NOT NULL,
    "content" TEXT NOT NULL,
    "level" "NotificationLevel" NOT NULL DEFAULT 'INFO',
    "link_url" TEXT,
    "metadata" JSONB,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- 索引:未读计数/未读列表过滤 (WHERE tenant_id+user_id AND read_at IS NULL)
CREATE INDEX "notifications_tenant_id_user_id_read_at_idx" ON "notifications"("tenant_id", "user_id", "read_at");

-- 索引:游标分页 (ORDER BY created_at DESC)
CREATE INDEX "notifications_tenant_id_user_id_created_at_idx" ON "notifications"("tenant_id", "user_id", "created_at");

-- 外键约束:租户级联删除(租户删除时一并清理通知)
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 外键约束:用户级联删除(用户删除时一并清理通知)
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
