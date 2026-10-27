-- CreateTable
CREATE TABLE "class_messages" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'text',
    "content" VARCHAR(500) NOT NULL,
    "analysis_id" TEXT,
    "snapshot" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "class_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "class_messages_tenant_id_created_at_idx" ON "class_messages"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "class_messages_tenant_analysis_idx" ON "class_messages"("tenant_id", "analysis_id");

-- AddForeignKey
ALTER TABLE "class_messages" ADD CONSTRAINT "class_messages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_messages" ADD CONSTRAINT "class_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_messages" ADD CONSTRAINT "class_messages_analysis_id_fkey" FOREIGN KEY ("analysis_id") REFERENCES "analyses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
