// ============================================================
// 丹青有AI - 争议仲裁 Mock 数据(本地联调用)
// 注入 5 个争议场景,覆盖教师端争议仲裁页全部交互分支:
//   1. mock-dispute-general   一般争议(open)     → 列表/详情/裁定
//   2. mock-dispute-high      高争议(open)       → AI 低置信度降级分支
//   3. mock-dispute-veto      否决争议(open)     → veto 触发原因展示
//   4. mock-dispute-resolved  已裁定(resolved)   → 回写按钮/重复裁定 409
//   5. mock-dispute-other     跨租户案件         → 租户隔离验证(教师端不可见)
//
// 前置:先执行主 seed(npx prisma db seed)注入 dev-tenant / 预设
// 执行:npx tsx prisma/seed-disputes.ts
// 幂等:按固定 id 先删后建,可重复执行
// ============================================================

import { PrismaClient } from '@prisma/client';
import { DEFAULT_ARBITRATION_CONFIG } from '../src/config/arbitration-default.js';
import type { ReviewScores, SuggestionLevel } from '../src/types/arbitration.js';

const prisma = new PrismaClient();

const DEV_TENANT = 'dev-tenant';
const SCHOOL_TENANT = 'seed-tenant-school';
const PRESET_ID = 'preset_academy__painting';
/** 绘画四维(与 preset_academy__painting 一致) */
const DIMS = ['composition_form', 'color', 'technique', 'overall'] as const;

/** 分数 → 建议等级(与前端 REVIEW_LEVEL 映射一致) */
function toLevel(score: number): SuggestionLevel {
  if (score >= 90) return 'excellent';
  if (score >= 80) return 'good';
  if (score >= 70) return 'qualified';
  return 'needs_improvement';
}

/** 构造一条评审的 scores JSON(四维同分微调) */
function makeScores(overall: number, spread = 2): ReviewScores {
  const dimensions: ReviewScores['dimensions'] = {};
  DIMS.forEach((key, i) => {
    // 四维围绕 overall 微波动,保证维度分与总分自洽
    const s = Math.min(100, Math.max(0, overall + (i % 2 === 0 ? spread : -spread)));
    dimensions[key] = { score: s, level: toLevel(s) };
  });
  return { dimensions, overallScore: overall, weightedByPreset: PRESET_ID };
}

/** 由多条评审计算触发原因(与 arbitration.service.determineLevel 口径一致) */
function makeTriggerReason(scoresList: ReviewScores[]) {
  const totals = scoresList.map((s) => s.overallScore);
  const dimDiffs: Record<string, number> = {};
  for (const key of DIMS) {
    const vals = scoresList.map((s) => s.dimensions[key]?.score ?? 0);
    dimDiffs[key] = Math.max(...vals) - Math.min(...vals);
  }
  const gradeOf = (s: number) => (s >= 90 ? 'A' : s >= 80 ? 'B' : s >= 70 ? 'C' : s >= 60 ? 'D' : 'E');
  const gradeCrossCount = new Set(totals.map(gradeOf)).size - 1;
  const hasVeto = totals.some((s) => s >= 90) && totals.some((s) => s < 60);
  return {
    totalRange: Math.max(...totals) - Math.min(...totals),
    dimDiffs,
    gradeCrossCount,
    ...(hasVeto ? { vetoDetail: { lowGrade: Math.min(...totals), highGrade: Math.max(...totals) } } : {}),
  };
}

interface MockReview {
  id: string;
  reviewerId: string | null;
  reviewerType: 'professor' | 'lecturer' | 'ai';
  overall: number;
  confidence?: number;
  comment: string;
  status?: 'draft' | 'submitted' | 'superseded';
}

interface MockDispute {
  id: string;
  tenantId: string;
  analysisId: string;
  analysisTitle: string;
  analysisUserId: string;
  aiScore: number;
  triggerLevel: 'general' | 'high' | 'veto';
  status: 'open' | 'resolved';
  reviews: MockReview[];
  /** 仅 resolved 场景:已写入的裁定结果 */
  finalScore?: { overallScore: number; rule: 'weighted' | 'majority' | 'unanimous' };
}

const MOCK_DISPUTES: MockDispute[] = [
  // ---------- 1. 一般争议(open):极差 13,触发 generalDisputeTotalRange≥10 ----------
  {
    id: 'mock-dispute-general',
    tenantId: DEV_TENANT,
    analysisId: 'mock-analysis-general',
    analysisTitle: '《山间秋色》色彩静物',
    analysisUserId: 'dev-user',
    aiScore: 78,
    triggerLevel: 'general',
    status: 'open',
    reviews: [
      { id: 'mock-review-g-prof', reviewerId: 'mock-teacher-prof', reviewerType: 'professor', overall: 85, comment: '构图稳重,色彩关系处理得当,笔触可再放松。' },
      { id: 'mock-review-g-lect', reviewerId: 'mock-teacher-lect', reviewerType: 'lecturer', overall: 72, comment: '色调偏灰,暗部层次不够,建议加强冷暖对比。' },
      { id: 'mock-review-g-ai', reviewerId: null, reviewerType: 'ai', overall: 78, confidence: 0.83, comment: '画面完整度良好,色彩饱和度中等。' },
    ],
  },
  // ---------- 2. 高争议(open):极差 24 + 跨 2 档;AI 置信度 0.55 → 权重降级分支 ----------
  {
    id: 'mock-dispute-high',
    tenantId: DEV_TENANT,
    analysisId: 'mock-analysis-high',
    analysisTitle: '《城市律动》创作草图',
    analysisUserId: 'dev-user',
    aiScore: 75,
    triggerLevel: 'high',
    status: 'open',
    reviews: [
      { id: 'mock-review-h-prof', reviewerId: 'mock-teacher-prof', reviewerType: 'professor', overall: 92, comment: '构成意识突出,具有个人语言,建议冲刺优秀档。' },
      { id: 'mock-review-h-lect', reviewerId: 'mock-teacher-lect', reviewerType: 'lecturer', overall: 68, comment: '完成度不足,局部形体松散,未达到创作要求。' },
      { id: 'mock-review-h-ai', reviewerId: null, reviewerType: 'ai', overall: 75, confidence: 0.55, comment: '低置信度:画面反光影响识别,结果仅供参考。' },
    ],
  },
  // ---------- 3. 否决争议(open):教授判 A(95) vs AI 判 E(45) → veto 强制复议 ----------
  {
    id: 'mock-dispute-veto',
    tenantId: DEV_TENANT,
    analysisId: 'mock-analysis-veto',
    analysisTitle: '《静思》素描人像',
    analysisUserId: 'dev-user',
    aiScore: 45,
    triggerLevel: 'veto',
    status: 'open',
    reviews: [
      { id: 'mock-review-v-prof', reviewerId: 'mock-teacher-prof', reviewerType: 'professor', overall: 95, comment: '造型严谨,神韵到位,堪称范本。' },
      { id: 'mock-review-v-lect', reviewerId: 'mock-teacher-lect', reviewerType: 'lecturer', overall: 88, comment: '整体优秀,耳部结构略有瑕疵。' },
      { id: 'mock-review-v-ai', reviewerId: null, reviewerType: 'ai', overall: 45, confidence: 0.38, comment: '图像曝光异常,无法有效识别形体(极低置信度)。' },
    ],
  },
  // ---------- 4. 已裁定(resolved):验证回写按钮 + 重复裁定 409 ----------
  {
    id: 'mock-dispute-resolved',
    tenantId: DEV_TENANT,
    analysisId: 'mock-analysis-resolved',
    analysisTitle: '《春风十里》风景写生',
    analysisUserId: 'dev-user',
    aiScore: 80,
    triggerLevel: 'high',
    status: 'resolved',
    reviews: [
      { id: 'mock-review-r-prof', reviewerId: 'mock-teacher-prof', reviewerType: 'professor', overall: 90, status: 'superseded', comment: '色彩通透,空间层次清晰。' },
      { id: 'mock-review-r-lect', reviewerId: 'mock-teacher-lect', reviewerType: 'lecturer', overall: 70, status: 'superseded', comment: '远景处理草率,未完成度高。' },
      { id: 'mock-review-r-ai', reviewerId: null, reviewerType: 'ai', overall: 80, confidence: 0.9, status: 'superseded', comment: '画面协调,色彩和谐度高。' },
    ],
    // 加权:0.5×90 + 0.3×70 + 0.2×80 = 82
    finalScore: { overallScore: 82, rule: 'weighted' },
  },
  // ---------- 5. 跨租户案件:教师端(dev-tenant)列表不应出现 ----------
  {
    id: 'mock-dispute-other',
    tenantId: SCHOOL_TENANT,
    analysisId: 'mock-analysis-other',
    analysisTitle: '《校内作业》几何体素描',
    analysisUserId: 'seed-user-student-1',
    aiScore: 70,
    triggerLevel: 'general',
    status: 'open',
    reviews: [
      { id: 'mock-review-o-prof', reviewerId: 'seed-user-admin', reviewerType: 'professor', overall: 82, comment: '结构准确。' },
      { id: 'mock-review-o-ai', reviewerId: null, reviewerType: 'ai', overall: 70, confidence: 0.77, comment: '调子均匀。' },
    ],
  },
];

async function main(): Promise<void> {
  console.log('[seed-disputes] 开始注入争议 mock 数据...');

  // ---------- 0. 依赖检查:dev-tenant 必须已存在(主 seed 注入) ----------
  const devTenant = await prisma.tenant.findUnique({ where: { id: DEV_TENANT } });
  if (!devTenant) {
    throw new Error('[seed-disputes] dev-tenant 不存在,请先执行 npx prisma db seed');
  }

  // ---------- 1. mock 评委用户(professor / lecturer,挂在 dev-tenant) ----------
  for (const u of [
    { id: 'mock-teacher-prof', name: '陈教授', email: 'prof@mock.local' },
    { id: 'mock-teacher-lect', name: '林讲师', email: 'lect@mock.local' },
  ]) {
    await prisma.user.upsert({
      where: { id: u.id },
      update: {},
      create: {
        id: u.id,
        tenantId: DEV_TENANT,
        authType: 'password',
        email: u.email,
        name: u.name,
        avatar: '',
        role: 'teacher',
        status: 'active',
      },
    });
    await prisma.tenantMember.upsert({
      where: { userId_tenantId: { userId: u.id, tenantId: DEV_TENANT } },
      update: {},
      create: { userId: u.id, tenantId: DEV_TENANT, role: 'teacher' },
    });
  }

  // ---------- 2. 幂等清理:按固定 id 删除旧 mock(多对多关联表自动清除) ----------
  const disputeIds = MOCK_DISPUTES.map((d) => d.id);
  const analysisIds = MOCK_DISPUTES.map((d) => d.analysisId);
  await prisma.disputeCase.deleteMany({ where: { id: { in: disputeIds } } });
  await prisma.reviewRecord.deleteMany({ where: { analysisId: { in: analysisIds } } });
  await prisma.analysis.deleteMany({ where: { id: { in: analysisIds } } });

  // ---------- 3. 逐场景注入 ----------
  for (const d of MOCK_DISPUTES) {
    // 3.1 Analysis(已完成状态,overallScore 为 AI 初评,待裁定回写)
    await prisma.analysis.create({
      data: {
        id: d.analysisId,
        tenantId: d.tenantId,
        userId: d.analysisUserId,
        workType: 'painting',
        imageUrl: '/mock/dispute-sample.jpg',
        title: d.analysisTitle,
        status: 'success',
        overallScore: d.aiScore,
        result: { overallScore: d.aiScore, summary: 'AI 初评完成,等待多评委评审。' },
        completedAt: new Date(),
      },
    });

    // 3.2 ReviewRecord(submitted;resolved 场景为 superseded)
    const reviewIds: string[] = [];
    for (const r of d.reviews) {
      await prisma.reviewRecord.create({
        data: {
          id: r.id,
          analysisId: d.analysisId,
          reviewerId: r.reviewerId,
          reviewerType: r.reviewerType,
          presetId: PRESET_ID,
          scores: makeScores(r.overall),
          confidence: r.confidence ?? null,
          comment: r.comment,
          status: r.status ?? 'submitted',
        },
      });
      reviewIds.push(r.id);
    }

    // 3.3 DisputeCase(触发原因按真实口径计算)
    const triggerReason = makeTriggerReason(d.reviews.map((r) => makeScores(r.overall)));
    await prisma.disputeCase.create({
      data: {
        id: d.id,
        analysisId: d.analysisId,
        tenantId: d.tenantId,
        triggerLevel: d.triggerLevel,
        triggerReason,
        arbitrationConfig: DEFAULT_ARBITRATION_CONFIG,
        status: d.status,
        reviews: { connect: reviewIds.map((id) => ({ id })) },
        ...(d.finalScore
          ? {
              finalScore: {
                overallScore: d.finalScore.overallScore,
                dimensions: { composition_form: d.finalScore.overallScore, color: d.finalScore.overallScore, technique: d.finalScore.overallScore, overall: d.finalScore.overallScore },
                rule: d.finalScore.rule,
                weightsUsed: {},
              },
              finalRule: d.finalScore.rule,
              resolvedBy: 'dev-user',
              resolvedAt: new Date(),
              resolutionNote: '委员会复议后按加权规则裁定',
            }
          : {}),
      },
    });

    console.log(
      `[seed-disputes] ✓ ${d.id} (${d.triggerLevel}/${d.status}) tenant=${d.tenantId} reviews=${reviewIds.length}`,
    );
  }

  console.log('[seed-disputes] 注入完成:4 条 dev-tenant(教师端可见)+ 1 条跨租户(隔离验证)');
}

main()
  .catch((err) => {
    console.error('[seed-disputes] failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
