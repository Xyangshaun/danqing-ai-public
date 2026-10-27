// ============================================================
// 教学行为画像 + 档案建议服务(反馈闭环 Phase 5 批次③)
// 对应 API:
//   GET /grading-profiles/insights/teacher         本人画像(只读展示)
//   GET /grading-profiles/:id/insights/suggestion  档案级建议(租户聚合推导)
//   POST /grading-profiles/:id/suggestion-adoptions 采纳记录(审计)
//
// 双层口径(真源决策):
//   - 教师画像 = 本人批注行为聚合(只读,不统计学生反馈)
//   - 租户建议 = 本租户全部教师批注 + 学生 marker 反馈聚合
//     (confirm 与 up 邻接同义 = 一致信号)→ 对租户档案 feedbackStyle 的调参建议
//
// 安全约束:
//   - 画像/建议:requirePermission('grading-profile:read') 已限教师/管理员/owner
//   - 建议对档案可见性:非内置档案跨租户按不存在处理(照 forkProfile 不泄露语义)
//   - 采纳:非内置 + 本租户 + 建议一致性重算校验(防伪造 before/after 值)
//     防重复 = 同 profile+suggestionKey+afterValue 已采纳幂等返回既有记录
//   - 采纳不自动改 config:参数变更走既有 PATCH(仅创建者,Zod 全量校验)——
//     本服务只落审计记录(先例:ScoreDiffRecord 快照固化不回写)
// ============================================================

import { gradingProfileRepository } from '../repositories/grading-profile.repository.js';
import { gradingInsightsRepository } from '../repositories/grading-insights.repository.js';
import { BusinessError } from '../middlewares/error-handler.js';
import { ErrorCode } from '../types/api-contract.js';
import {
  parseGradingProfileConfig,
  type GradingTeacherInsightsResponse,
  type GradingProfileSuggestionsResponse,
  type GradingMyAdoptionsResponse,
  type SuggestionAdoptionRecordResponse,
  type CreateSuggestionAdoptionRequest,
} from '../types/grading-profile.js';
import {
  computeBehaviorStats,
  deriveStyleSuggestions,
} from './grading-suggestion-engine.js';
import { logger } from '../utils/logger.js';

class GradingInsightsServiceClass {
  // ============================================================
  // 教师本人画像(只读)
  // ============================================================

  /**
   * GET /grading-profiles/insights/teacher
   * 本人批注行为聚合:总数/密度/四 action 占比/AI 一致率(confirm÷显式裁决)/最近活跃
   * 教师画像不统计学生反馈(up/down 恒 0;学生反馈无 teacherId 归属)
   */
  async getTeacherInsights(
    tenantId: string,
    teacherId: string,
  ): Promise<GradingTeacherInsightsResponse> {
    const annotations = await gradingInsightsRepository.findAnnotations(tenantId, teacherId);
    const stats = computeBehaviorStats(annotations);
    return { teacherId, stats };
  }

  // ============================================================
  // 档案级建议(租户聚合 → feedbackStyle 调参建议)
  // ============================================================

  /**
   * GET /grading-profiles/:id/insights/suggestion
   *
   * 流程:档案可见性校验 → 租户行为聚合(教师批注 + 学生反馈邻接信号)
   * → 引擎纯函数推导 → 已采纳防重复过滤
   */
  async getProfileSuggestions(
    tenantId: string,
    profileId: string,
  ): Promise<GradingProfileSuggestionsResponse> {
    const profile = await this.assertProfileVisible(tenantId, profileId);
    const { stats, suggestions } = await this.aggregateAndDerive(
      tenantId,
      profileId,
      profile.config,
      { excludeAdopted: true },
    );
    return { profileId, stats, suggestions };
  }

  // ============================================================
  // 建议采纳(审计落库)
  // ============================================================

  /**
   * POST /grading-profiles/:id/suggestion-adoptions
   *
   * 校验链(全部通过才落库):
   *   1. 档案存在 + 本租户可见 + 非内置(内置不可采纳,照 update 语义)
   *   2. 建议一致性:重算候选建议(不过滤已采纳——幂等重放需匹配既有建议),
   *      body 的 suggestionKey/beforeValue/afterValue 必须与引擎输出完全一致
   *      (防伪造参数;建议必须仍然有效)
   *   3. 防重复:同 profile+key+afterValue 已采纳 → 幂等返回既有记录(不重复落库)
   *
   * 注:实际参数变更由前端先走既有 PATCH /grading-profiles/:id(Zod 全量校验
   * + 仅创建者),本端点只记录「谁/何时/采纳了什么/依据快照」审计轨迹。
   */
  async recordAdoption(
    tenantId: string,
    userId: string,
    profileId: string,
    body: CreateSuggestionAdoptionRequest,
  ): Promise<{ record: SuggestionAdoptionRecordResponse; duplicated: boolean }> {
    const profile = await this.assertProfileVisible(tenantId, profileId);
    if (profile.isBuiltIn) {
      throw new BusinessError(
        ErrorCode.GRADING_PROFILE_BUILTIN_IMMUTABLE,
        '系统内置档案不可采纳建议,请先克隆',
        403,
      );
    }

    // 建议一致性重算(excludeAdopted=false:幂等重放须能匹配已被过滤的建议)
    const { suggestions } = await this.aggregateAndDerive(
      tenantId,
      profileId,
      profile.config,
      { excludeAdopted: false },
    );
    const matched = suggestions.find((s) => s.suggestionKey === body.suggestionKey);
    if (
      !matched ||
      matched.currentValue !== body.beforeValue ||
      matched.suggestedValue !== body.afterValue
    ) {
      throw new BusinessError(
        ErrorCode.PROFILE_SUGGESTION_MISMATCH,
        '采纳参数与当前建议不一致,请刷新建议后重试',
        400,
      );
    }

    // 防重复:同 profile+key+afterValue 已采纳 → 幂等返回
    const existing = await gradingInsightsRepository.findAdoptions(profileId);
    const duplicatedRecord = existing.find(
      (a) =>
        a.suggestionKey === body.suggestionKey && a.afterValue === body.afterValue,
    );
    if (duplicatedRecord) {
      return {
        record: this.toAdoptionRecord(duplicatedRecord),
        duplicated: true,
      };
    }

    const created = await gradingInsightsRepository.createAdoption({
      tenantId,
      teacherId: userId,
      profileId,
      suggestionKey: body.suggestionKey,
      beforeValue: body.beforeValue,
      afterValue: body.afterValue,
      suggestionBasis: matched.basisSnapshot,
    });

    logger.info(
      { profileId, suggestionKey: body.suggestionKey, userId, tenantId },
      '[grading-insights] suggestion adopted',
    );
    return { record: this.toAdoptionRecord(created), duplicated: false };
  }

  // ============================================================
  // 本人采纳历史(教师画像页展示;Phase 5 批次④)
  // ============================================================

  /**
   * GET /grading-profiles/insights/adoptions
   * 本人采纳记录列表(按时间倒序),附带档案名称(可见档案解析;已删档案 → null)
   */
  async getMyAdoptions(tenantId: string, teacherId: string): Promise<GradingMyAdoptionsResponse> {
    const [adoptions, profiles] = await Promise.all([
      gradingInsightsRepository.findAdoptionsByTeacher(tenantId, teacherId),
      gradingProfileRepository.listVisible(tenantId),
    ]);
    const nameById = new Map(profiles.map((p) => [p.id, p.name]));
    return {
      items: adoptions.map((a) => ({
        ...this.toAdoptionRecord(a),
        profileName: nameById.get(a.profileId) ?? null,
      })),
    };
  }

  // ============================================================
  // 私有工具
  // ============================================================

  /**
   * 聚合租户行为 + 引擎推导(建议端点与采纳一致性校验共用)
   * @param excludeAdopted true=过滤已采纳(展示口径);false=保留全量候选
   *   (采纳一致性校验用——幂等重放须匹配已被展示层过滤的建议)
   */
  private async aggregateAndDerive(
    tenantId: string,
    profileId: string,
    rawConfig: unknown,
    options: { excludeAdopted: boolean },
  ): Promise<GradingProfileSuggestionsResponse> {
    const config = parseGradingProfileConfig(rawConfig);
    if (!config) {
      throw new BusinessError(
        ErrorCode.GRADING_PROFILE_CONFIG_INVALID,
        '档案配置数据损坏,无法推导建议',
        500,
      );
    }

    const [annotations, feedbacks, adoptionRows] = await Promise.all([
      gradingInsightsRepository.findAnnotations(tenantId),
      gradingInsightsRepository.findStudentFeedbacks(tenantId),
      options.excludeAdopted
        ? gradingInsightsRepository.findAdoptions(profileId)
        : (Promise.resolve([]) as Promise<Array<never>>),
    ]);
    const adoptions: ReadonlyArray<{ suggestionKey: string; afterValue: number }> =
      adoptionRows.map((a) => ({ suggestionKey: a.suggestionKey, afterValue: a.afterValue }));

    const stats = computeBehaviorStats(annotations, feedbacks);
    const suggestions = deriveStyleSuggestions({
      stats,
      currentStyle: config.feedbackStyle,
      adoptedSuggestions: adoptions,
    });
    return { profileId, stats, suggestions };
  }

  /**
   * 档案可见性断言(照 forkProfile:非内置跨租户按不存在处理,不泄露存在性)
   */
  private async assertProfileVisible(tenantId: string, profileId: string) {
    const profile = await gradingProfileRepository.findById(profileId);
    if (!profile || (!profile.isBuiltIn && profile.tenantId !== tenantId)) {
      throw new BusinessError(ErrorCode.GRADING_PROFILE_NOT_FOUND, '档案不存在', 404);
    }
    return profile;
  }

  /** DB 行 → 采纳记录 DTO */
  private toAdoptionRecord(row: {
    id: string;
    tenantId: string;
    teacherId: string;
    profileId: string;
    suggestionKey: string;
    beforeValue: number;
    afterValue: number;
    suggestionBasis: unknown;
    createdAt: Date;
  }): SuggestionAdoptionRecordResponse {
    const basis =
      typeof row.suggestionBasis === 'object' && row.suggestionBasis !== null
        ? (row.suggestionBasis as Record<string, number>)
        : {};
    return {
      id: row.id,
      tenantId: row.tenantId,
      teacherId: row.teacherId,
      profileId: row.profileId,
      suggestionKey: row.suggestionKey as SuggestionAdoptionRecordResponse['suggestionKey'],
      beforeValue: row.beforeValue,
      afterValue: row.afterValue,
      suggestionBasis: basis,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

export const gradingInsightsService = new GradingInsightsServiceClass();
