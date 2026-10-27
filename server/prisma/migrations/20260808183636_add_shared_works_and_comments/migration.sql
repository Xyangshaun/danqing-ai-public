-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'SHARE';
ALTER TYPE "NotificationType" ADD VALUE 'COMMENT';

-- CreateTable
CREATE TABLE "shared_works" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "analysis_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "caption" VARCHAR(200),
    "is_pinned" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shared_works_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "share_comments" (
    "id" TEXT NOT NULL,
    "shared_work_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "content" VARCHAR(500) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "share_comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shared_works_tenant_id_created_at_idx" ON "shared_works"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "shared_works_tenant_pinned_idx" ON "shared_works"("tenant_id", "is_pinned", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "shared_works_analysis_user_unique" ON "shared_works"("analysis_id", "user_id");

-- CreateIndex
CREATE INDEX "share_comments_shared_work_id_created_at_idx" ON "share_comments"("shared_work_id", "created_at");

-- AddForeignKey
ALTER TABLE "shared_works" ADD CONSTRAINT "shared_works_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shared_works" ADD CONSTRAINT "shared_works_analysis_id_fkey" FOREIGN KEY ("analysis_id") REFERENCES "analyses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shared_works" ADD CONSTRAINT "shared_works_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "share_comments" ADD CONSTRAINT "share_comments_shared_work_id_fkey" FOREIGN KEY ("shared_work_id") REFERENCES "shared_works"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "share_comments" ADD CONSTRAINT "share_comments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
