-- DropForeignKey
ALTER TABLE "ai_usage_logs" DROP CONSTRAINT "ai_usage_logs_analysis_id_fkey";

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "arbitration_config" JSONB;
