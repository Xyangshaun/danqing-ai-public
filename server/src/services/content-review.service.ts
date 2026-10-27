// ============================================================
// 生成内容审核服务(M2-T8)
// 对应文档:.trae/documents/m2-generation-plan-2026-08-07.md §6
// 对应契约:api-contract.ts §3.17 GeneratedImage.reviewStatus + §1149 ReviewStatus(已冻结,禁止修改)
//
// 定位:
//   - 本服务只负责"生成内容"的自动审核(关键词规则 + 语义规则 + 人工复核挂点),
//     与"评委评审"(review.service,针对 Analysis 打分)和"作品审核"
//     (admin-content.service,针对 Analysis 素材库人工动作)三套体系相互独立。
//   - 复用现有 ReviewStatus 枚举(pending/approved/rejected/flagged)与
//     ReviewAction 语义,不另起炉灶,不新增枚举。
//
// 分类规则(严重级别):
//   - rejected  : 明确违禁(确定性违规,直接拒绝,不进入一键诊断)
//   - flagged   : 敏感/需人工(命中规则但需人工复核挂点确认)
//   - pending   : 未命中任何规则(待人工复核入口,对应计划 §6.2"未命中→pending")
//   - approved  : 人工/AI 复核通过后可达(本自动审核不直接产出,由人工复核流程写入)
//
// 可扩展性:
//   - 规则表随代码提交(带 id + 类别 + 关键词 + 严重级别),便于后续扩充。
//   - 预留 reviewGeneratedImage(prompt, imageMeta?) 的 imageMeta 挂点,
//     后续可接入 AI 视觉审核(分析生成图本身)或按 artType 差异化规则。
//
// 安全:
//   - 纯函数/无 IO 依赖,不触碰 DB/Redis,便于单元测试与异步 Worker 调用。
//   - 日志仅输出 reasons/ruleId/分类,不输出敏感信息。
// ============================================================

import type { ReviewStatus } from '../types/api-contract.js';

/** 审核严重级别:flagged 需人工复核,rejected 明确违禁 */
export type ContentReviewSeverity = 'flagged' | 'rejected';

/** 关键词规则项(带 id + 类别 + 关键词 + 严重级别) */
export interface ContentReviewRule {
  /** 规则唯一 id(便于审计与后续维护) */
  id: string;
  /** 违禁类别(便于审计与后台分类展示) */
  category: string;
  /** 匹配关键词列表(命中任一即触发) */
  keywords: readonly string[];
  /** 严重级别 */
  severity: ContentReviewSeverity;
}

/** 语义规则项(组合规则:每组至少命中一个关键词,所有组都命中才触发) */
export interface ContentSemanticRule {
  id: string;
  category: string;
  /** 多组关键词,需每组都至少命中一个才算命中(用于消除单关键词误报) */
  keywordGroups: readonly (readonly string[])[];
  severity: ContentReviewSeverity;
}

/** 内容审核结果(建议结构,M2-T8) */
export interface ContentReviewResult {
  /** 审核状态:本自动审核产出 rejected/flagged/pending;approved 由人工复核写入 */
  reviewStatus: ReviewStatus;
  /** 命中的规则描述(便于审计追溯) */
  reasons: string[];
  /** 命中的规则 id(多个命中时取严重级别最高的首个) */
  ruleId?: string;
  /** flagged → true,进入人工复核挂点 */
  needsManualReview: boolean;
}

/**
 * 明确违禁关键词规则(severity=rejected)
 * 命中即判定违规,reviewStatus=rejected,不进入一键诊断
 */
const REJECTED_RULES: readonly ContentReviewRule[] = [
  {
    id: 'reject-terrorism',
    category: '恐怖主义',
    keywords: ['恐怖主义', '恐怖袭击', '爆炸装置', '炸弹制作', '爆炸物配方'],
    severity: 'rejected',
  },
  {
    id: 'reject-drugs',
    category: '毒品违禁品',
    keywords: ['毒品', '海洛因', '冰毒', '可卡因', '大麻种植', '制毒', '摇头丸'],
    severity: 'rejected',
  },
  {
    id: 'reject-weapons',
    category: '枪支弹药',
    keywords: ['枪支', '枪械', '弹药', '大规模杀伤', '武器交易', '军火'],
    severity: 'rejected',
  },
  {
    id: 'reject-child-abuse',
    category: '儿童色情',
    keywords: ['儿童色情', '未成年色情', '恋童', '幼童暴露'],
    severity: 'rejected',
  },
  {
    id: 'reject-cult-extremism',
    category: '邪教极端',
    keywords: ['邪教', '极端组织', '圣战', '恐怖组织'],
    severity: 'rejected',
  },
  {
    id: 'reject-illicit-trade',
    category: '违禁交易',
    keywords: ['洗钱', '赌博网站', '博彩', '制假贩假', '违禁品买卖'],
    severity: 'rejected',
  },
];

/**
 * 敏感/需人工关键词规则(severity=flagged)
 * 命中即 reviewStatus=flagged,进入人工复核挂点(前端灰显,不进入一键诊断)
 */
const FLAGGED_RULES: readonly ContentReviewRule[] = [
  {
    id: 'flag-gore',
    category: '血腥',
    keywords: ['血腥', '残肢', '内脏', '屠杀', '分尸'],
    severity: 'flagged',
  },
  {
    id: 'flag-violence',
    category: '暴力',
    keywords: ['暴力', '殴打', '斗殴', '血腥暴力', '虐杀'],
    severity: 'flagged',
  },
  {
    id: 'flag-pornography',
    category: '色情裸露',
    keywords: ['色情', '裸露', '露骨', '性暗示', '情色', '裸体'],
    severity: 'flagged',
  },
  {
    id: 'flag-selfharm',
    category: '自残自杀',
    keywords: ['自杀', '自残', '割腕', '轻生', '自我伤害'],
    severity: 'flagged',
  },
  {
    id: 'flag-hate',
    category: '歧视仇恨',
    keywords: ['种族歧视', '仇恨言论', '侮辱性', '歧视'],
    severity: 'flagged',
  },
  {
    id: 'flag-horror',
    category: '恐怖惊悚',
    keywords: ['恐怖', '惊悚', '鬼怪', '灵异'],
    severity: 'flagged',
  },
];

/**
 * 语义组合规则(severity=flagged)
 * 用于消除单关键词歧义误报,需组合命中才触发(如"校园+暴力"判定校园暴力)
 */
const SEMANTIC_RULES: readonly ContentSemanticRule[] = [
  {
    id: 'sem-school-violence',
    category: '校园暴力',
    keywordGroups: [['校园', '学校'], ['暴力', '殴打', '欺凌']],
    severity: 'flagged',
  },
  {
    id: 'sem-teen-porn',
    category: '青少年色情',
    keywordGroups: [['青少年', '未成年', '学生'], ['色情', '裸露', '性暗示']],
    severity: 'flagged',
  },
];

/** 严重级别优先级:rejected(2) > flagged(1) > pending(0) */
function severityRank(severity: ContentReviewSeverity): number {
  return severity === 'rejected' ? 2 : 1;
}

/** 判断文本是否命中某关键词规则(命中任一关键词即返回 true) */
function matchKeywords(text: string, keywords: readonly string[]): boolean {
  return keywords.some((kw) => text.includes(kw));
}

class ContentReviewServiceClass {
  /** 获取完整规则表(供审计/后台/测试引用,便于扩充) */
  getRuleTable(): {
    rejected: readonly ContentReviewRule[];
    flagged: readonly ContentReviewRule[];
    semantic: readonly ContentSemanticRule[];
  } {
    return { rejected: REJECTED_RULES, flagged: FLAGGED_RULES, semantic: SEMANTIC_RULES };
  }

  /**
   * 对生成内容执行自动审核
   *
   * @param prompt 生成提示词(text 模式的提示词)
   * @param imageMeta 可选扩展挂点(后续可接 AI 视觉审核:生成图本身、artType 差异化规则);
   *                  当前版本不参与关键词判定,仅为可扩展预留
   * @returns ContentReviewResult
   *
   * 分类逻辑:
   *   - 无提示词(sketch 模式)→ 无法做关键词审核,返回 pending(待人工复核),记录原因
   *   - 命中 rejected 规则 → reviewStatus=rejected(明确违禁)
   *   - 命中 flagged/语义规则 → reviewStatus=flagged(需人工)
   *   - 未命中任何规则 → reviewStatus=pending(待人工复核入口)
   *   - 多规则命中时取严重级别最高者
   */
  reviewGeneratedImage(
    prompt?: string,
    _imageMeta?: { artType?: string } | undefined,
  ): ContentReviewResult {
    const text = (prompt ?? '').trim();

    // 无提示词(如 sketch 模式):无法做关键词审核,标记 pending 并记录原因
    if (!text) {
      return {
        reviewStatus: 'pending',
        reasons: ['无提示词,交由人工复核确认'],
        needsManualReview: true,
      };
    }

    const reasons: string[] = [];
    let ruleId: string | undefined;
    let status: 'rejected' | 'flagged' | 'pending' = 'pending';
    let rank = 0;

    // 1) 关键词规则(先 rejected 组再 flagged 组,按严重级别收敛)
    for (const rule of [...REJECTED_RULES, ...FLAGGED_RULES]) {
      if (matchKeywords(text, rule.keywords)) {
        reasons.push(`[${rule.category}] 命中关键词规则 ${rule.id}`);
        if (ruleId === undefined) ruleId = rule.id;
        const r = severityRank(rule.severity);
        if (r > rank) {
          rank = r;
          status = rule.severity;
        }
      }
    }

    // 2) 语义组合规则(需每组都命中)
    for (const rule of SEMANTIC_RULES) {
      const hit = rule.keywordGroups.every((group) =>
        group.some((kw) => text.includes(kw)),
      );
      if (hit) {
        reasons.push(`[${rule.category}] 命中语义规则 ${rule.id}`);
        if (ruleId === undefined) ruleId = rule.id;
        const r = severityRank(rule.severity);
        if (r > rank) {
          rank = r;
          status = rule.severity;
        }
      }
    }

    return {
      reviewStatus: status,
      reasons,
      ruleId,
      needsManualReview: status === 'flagged',
    };
  }
}

export const contentReviewService = new ContentReviewServiceClass();
