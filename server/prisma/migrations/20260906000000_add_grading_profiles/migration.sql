-- AlterTable
ALTER TABLE "analyses" ADD COLUMN     "tier_estimate" JSONB;

-- CreateTable
CREATE TABLE "grading_profiles" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "description" VARCHAR(500),
    "category" VARCHAR(16) NOT NULL,
    "config" JSONB NOT NULL,
    "is_built_in" BOOLEAN NOT NULL DEFAULT false,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "forked_from_id" TEXT,
    "creator_id" TEXT,
    "tenant_id" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "grading_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "grading_profiles_tenant_id_enabled_idx" ON "grading_profiles"("tenant_id", "enabled");

-- CreateIndex
CREATE INDEX "grading_profiles_category_idx" ON "grading_profiles"("category");

-- CreateIndex
CREATE INDEX "grading_profiles_is_built_in_idx" ON "grading_profiles"("is_built_in");

-- CreateIndex
CREATE UNIQUE INDEX "grading_profiles_tenant_name_unique" ON "grading_profiles"("tenant_id", "name");

-- AddForeignKey
ALTER TABLE "grading_profiles" ADD CONSTRAINT "grading_profiles_forked_from_id_fkey" FOREIGN KEY ("forked_from_id") REFERENCES "grading_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grading_profiles" ADD CONSTRAINT "grading_profiles_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grading_profiles" ADD CONSTRAINT "grading_profiles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

