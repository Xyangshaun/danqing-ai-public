/*
  Warnings:

  - The primary key for the `score_diff_records` table will be changed. If it partially fails, the table could be left without primary key constraint.

*/
-- DropIndex
DROP INDEX "analyses_diagnosis_mode_idx";

-- AlterTable
ALTER TABLE "score_diff_records" DROP CONSTRAINT "score_diff_records_pkey",
ALTER COLUMN "id" SET DATA TYPE TEXT,
ADD CONSTRAINT "score_diff_records_pkey" PRIMARY KEY ("id");

-- CreateTable
CREATE TABLE "knowledge_cards" (
    "id" TEXT NOT NULL,
    "category" VARCHAR(16) NOT NULL,
    "topic" VARCHAR(64) NOT NULL,
    "problem_pattern" VARCHAR(255) NOT NULL,
    "difficulty" VARCHAR(16) NOT NULL,
    "explanation" TEXT NOT NULL,
    "practice_drill" TEXT NOT NULL,
    "reference_assets" JSONB,
    "related_works" JSONB,
    "is_built_in" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_cards_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "knowledge_cards_category_enabled_idx" ON "knowledge_cards"("category", "enabled");

-- CreateIndex
CREATE INDEX "knowledge_cards_problem_pattern_idx" ON "knowledge_cards"("problem_pattern");

-- CreateIndex
CREATE INDEX "knowledge_cards_is_built_in_idx" ON "knowledge_cards"("is_built_in");
