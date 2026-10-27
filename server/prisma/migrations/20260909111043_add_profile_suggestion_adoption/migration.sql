-- CreateTable
CREATE TABLE "profile_suggestion_adoptions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "teacher_id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "suggestion_key" VARCHAR(32) NOT NULL,
    "before_value" DOUBLE PRECISION NOT NULL,
    "after_value" DOUBLE PRECISION NOT NULL,
    "suggestion_basis" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profile_suggestion_adoptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "profile_suggestion_adoptions_profile_id_idx" ON "profile_suggestion_adoptions"("profile_id");

-- CreateIndex
CREATE INDEX "profile_suggestion_adoptions_dedup_idx" ON "profile_suggestion_adoptions"("profile_id", "suggestion_key", "after_value");
