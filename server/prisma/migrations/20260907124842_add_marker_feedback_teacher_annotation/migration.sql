-- CreateTable
CREATE TABLE "marker_feedbacks" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "analysis_id" TEXT NOT NULL,
    "marker_id" VARCHAR(32),
    "marker_index" INTEGER NOT NULL,
    "action" VARCHAR(16) NOT NULL,
    "marker_snapshot" JSONB NOT NULL,
    "work_type" VARCHAR(16),
    "diagnosis_mode" VARCHAR(16),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marker_feedbacks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teacher_annotations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "analysis_id" TEXT NOT NULL,
    "teacher_id" TEXT NOT NULL,
    "marker_id" VARCHAR(32),
    "marker_index" INTEGER NOT NULL,
    "marker_snapshot" JSONB NOT NULL,
    "action" VARCHAR(16) NOT NULL DEFAULT 'supplement',
    "comment" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teacher_annotations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "marker_feedbacks_tenant_id_created_at_idx" ON "marker_feedbacks"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "marker_feedbacks_analysis_id_idx" ON "marker_feedbacks"("analysis_id");

-- CreateIndex
CREATE INDEX "marker_feedbacks_tenant_id_action_idx" ON "marker_feedbacks"("tenant_id", "action");

-- CreateIndex
CREATE UNIQUE INDEX "marker_feedbacks_analysis_user_marker_unique" ON "marker_feedbacks"("analysis_id", "user_id", "marker_index");

-- CreateIndex
CREATE INDEX "teacher_annotations_analysis_id_idx" ON "teacher_annotations"("analysis_id");

-- CreateIndex
CREATE INDEX "teacher_annotations_tenant_id_teacher_id_idx" ON "teacher_annotations"("tenant_id", "teacher_id");

-- CreateIndex
CREATE UNIQUE INDEX "teacher_annotations_analysis_marker_teacher_unique" ON "teacher_annotations"("analysis_id", "marker_index", "teacher_id");

-- AddForeignKey
ALTER TABLE "marker_feedbacks" ADD CONSTRAINT "marker_feedbacks_analysis_id_fkey" FOREIGN KEY ("analysis_id") REFERENCES "analyses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_annotations" ADD CONSTRAINT "teacher_annotations_analysis_id_fkey" FOREIGN KEY ("analysis_id") REFERENCES "analyses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
