-- ============================================================
-- 阶段 A:深度分析增强 + 非遗类目扩展
-- 1. ArtType 枚举新增 heritage(非遗),配合 heritage_category 细分剪纸/刺绣/瓷器
-- 2. analyses 新增 evaluation_stage:评价阶段(评分参照系档位,teaching/exam 各 3 档)
-- 3. analyses 新增 heritage_category:非遗类目(仅 workType='heritage')
-- 4. analyses 新增 score_criteria:评分标准(各维度权重/评级/符合项/证据),JSON 冗余便于列表查询
-- 5. analyses 新增 issue_markers:问题区域标注(Canvas 叠层用,相对坐标 0-1),JSON 冗余便于列表查询
-- 全部新增字段可空,存量数据零迁移风险;旧记录读取时为 null,前端按默认渲染
-- ============================================================

-- AlterEnum
ALTER TYPE "ArtType" ADD VALUE 'heritage';

-- AlterTable
ALTER TABLE "analyses" ADD COLUMN     "evaluation_stage" VARCHAR(16),
ADD COLUMN     "heritage_category" VARCHAR(16),
ADD COLUMN     "issue_markers" JSONB,
ADD COLUMN     "score_criteria" JSONB;
