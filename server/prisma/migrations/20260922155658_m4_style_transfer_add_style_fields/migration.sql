-- AlterTable
ALTER TABLE "generation_tasks" ADD COLUMN     "processing_started_at" TIMESTAMP(3),
ADD COLUMN     "style_analysis" JSONB,
ADD COLUMN     "style_image_url" TEXT;
