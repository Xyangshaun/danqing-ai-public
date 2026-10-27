-- CreateEnum
CREATE TYPE "GenerationStatus" AS ENUM ('pending', 'processing', 'success', 'failed');

-- AlterTable
ALTER TABLE "ai_usage_logs" ADD COLUMN     "generation_id" TEXT,
ADD COLUMN     "usage_type" VARCHAR(16) NOT NULL DEFAULT 'diagnose';

-- CreateTable
CREATE TABLE "generation_tasks" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "input_type" VARCHAR(16) NOT NULL,
    "prompt" TEXT,
    "sketch_image_url" TEXT,
    "art_type" "ArtType" NOT NULL,
    "aspect" VARCHAR(16),
    "count" INTEGER NOT NULL DEFAULT 1,
    "status" "GenerationStatus" NOT NULL DEFAULT 'pending',
    "images" JSONB,
    "failure_reason" TEXT,
    "used_fallback" BOOLEAN NOT NULL DEFAULT false,
    "provider" VARCHAR(16),
    "model" VARCHAR(64),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "generation_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "generation_tasks_tenant_id_created_at_idx" ON "generation_tasks"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "generation_tasks_tenant_id_user_id_idx" ON "generation_tasks"("tenant_id", "user_id");

-- CreateIndex
CREATE INDEX "generation_tasks_tenant_id_status_idx" ON "generation_tasks"("tenant_id", "status");

-- AddForeignKey
ALTER TABLE "generation_tasks" ADD CONSTRAINT "generation_tasks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_tasks" ADD CONSTRAINT "generation_tasks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
