// ============================================================
// ContentReviewService 单元测试(M2-T8)
// 对应源码:src/services/content-review.service.ts(生成内容自动审核)
// 对应文档:.trae/documents/m2-generation-plan-2026-08-07.md §6
//
// 测试范围:
//   1. 明确违禁关键词命中 → rejected(恐怖主义/毒品/枪支/儿童色情/邪教/违禁交易)
//   2. 敏感/需人工关键词命中 → flagged(血腥/暴力/色情/自残/歧视/恐怖惊悚)
//   3. 语义组合规则命中 → flagged(校园暴力/青少年色情)
//   4. 未命中任何规则 → pending(待人工复核入口)
//   5. 多规则命中 → 严重级别最高者收敛(rejected > flagged > pending)
//   6. 无提示词(sketch 模式)→ pending + needsManualReview
//   7. reasons / ruleId 审计输出
//   8. 规则表可扩展性(getRuleTable)
//
// 本服务为纯函数/无 IO 依赖,无需 mock DB/Redis
// ============================================================

import { describe, it, expect } from 'vitest';
import { contentReviewService } from '../src/services/content-review.service.js';

describe('ContentReviewService.reviewGeneratedImage(内容审核)', () => {
  // ---------- 1. 明确违禁 → rejected ----------
  describe('明确违禁关键词 → rejected', () => {
    it('命中恐怖主义 → rejected + ruleId=reject-terrorism', () => {
      const r = contentReviewService.reviewGeneratedImage('一幅恐怖主义袭击的宣传海报');
      expect(r.reviewStatus).toBe('rejected');
      expect(r.ruleId).toBe('reject-terrorism');
      // "恐怖主义"同时子串命中 flag-horror 的"恐怖",故 reasons>=1 且首条为 rejected 规则
      expect(r.reasons.length).toBeGreaterThanOrEqual(1);
      expect(r.reasons[0]).toContain('恐怖主义');
      expect(r.needsManualReview).toBe(false);
    });

    it('命中毒品 → rejected', () => {
      expect(contentReviewService.reviewGeneratedImage('绘制毒品交易场景').reviewStatus).toBe('rejected');
    });

    it('命中枪支弹药 → rejected', () => {
      expect(contentReviewService.reviewGeneratedImage('枪支武器设计图').reviewStatus).toBe('rejected');
    });

    it('命中儿童色情 → rejected', () => {
      expect(contentReviewService.reviewGeneratedImage('儿童色情漫画').reviewStatus).toBe('rejected');
    });

    it('命中邪教极端 → rejected', () => {
      expect(contentReviewService.reviewGeneratedImage('邪教组织宣传画').reviewStatus).toBe('rejected');
    });
  });

  // ---------- 2. 敏感/需人工 → flagged ----------
  describe('敏感/需人工关键词 → flagged', () => {
    it('命中血腥 → flagged + needsManualReview=true', () => {
      const r = contentReviewService.reviewGeneratedImage('一幅血腥的战争场景');
      expect(r.reviewStatus).toBe('flagged');
      expect(r.ruleId).toBe('flag-gore');
      expect(r.needsManualReview).toBe(true);
    });

    it('命中暴力 → flagged(含原 M2-T4 黑名单"暴力")', () => {
      const r = contentReviewService.reviewGeneratedImage('一幅包含暴力的画');
      expect(r.reviewStatus).toBe('flagged');
      expect(r.ruleId).toBe('flag-violence');
    });

    it('命中色情/裸露 → flagged', () => {
      const r = contentReviewService.reviewGeneratedImage('一幅裸露的人物素描');
      expect(r.reviewStatus).toBe('flagged');
      expect(r.ruleId).toBe('flag-pornography');
    });

    it('命中自残自杀 → flagged', () => {
      expect(contentReviewService.reviewGeneratedImage('自残题材插画').reviewStatus).toBe('flagged');
    });

    it('命中歧视仇恨 → flagged', () => {
      expect(contentReviewService.reviewGeneratedImage('种族歧视讽刺画').reviewStatus).toBe('flagged');
    });

    it('命中恐怖惊悚 → flagged', () => {
      expect(contentReviewService.reviewGeneratedImage('恐怖鬼怪海报').reviewStatus).toBe('flagged');
    });
  });

  // ---------- 3. 语义组合规则 → flagged ----------
  describe('语义组合规则 → flagged', () => {
    it('校园+暴力组合命中 → flagged,reasons 含语义规则(ruleId=flag-violence 为首个命中)', () => {
      const r = contentReviewService.reviewGeneratedImage('校园暴力欺凌场景插画');
      expect(r.reviewStatus).toBe('flagged');
      // "暴力"先命中 flag-violence(ruleId 取首个),语义规则 sem-school-violence 同时命中并计入 reasons
      expect(r.ruleId).toBe('flag-violence');
      expect(r.reasons.some((s) => s.includes('sem-school-violence'))).toBe(true);
    });

    it('仅含"校园"不含暴力组合词 → 不触发校园暴力语义规则(pending)', () => {
      const r = contentReviewService.reviewGeneratedImage('宁静的校园一角');
      expect(r.reviewStatus).toBe('pending');
      expect(r.ruleId).toBeUndefined();
    });

    it('青少年+色情组合命中 → flagged', () => {
      expect(contentReviewService.reviewGeneratedImage('青少年色情动漫').reviewStatus).toBe('flagged');
    });
  });

  // ---------- 4. 未命中 → pending ----------
  describe('未命中任何规则 → pending', () => {
    it('正常美术提示词 → pending(待人工复核入口)', () => {
      const r = contentReviewService.reviewGeneratedImage('宁静的湖泊与远山,印象派风格');
      expect(r.reviewStatus).toBe('pending');
      expect(r.reasons).toHaveLength(0);
      expect(r.ruleId).toBeUndefined();
      expect(r.needsManualReview).toBe(false);
    });
  });

  // ---------- 5. 多规则收敛 ----------
  describe('多规则命中 → 严重级别最高者收敛', () => {
    it('同时命中暴力(flagged)+毒品(rejected) → rejected(最高级别)', () => {
      const r = contentReviewService.reviewGeneratedImage('毒品与暴力场景');
      expect(r.reviewStatus).toBe('rejected');
      // reasons 记录全部命中规则(rejected 优先收敛状态)
      expect(r.reasons.length).toBeGreaterThanOrEqual(2);
    });

    it('同时命中恐怖(flagged)+恐怖主义(rejected) → rejected', () => {
      const r = contentReviewService.reviewGeneratedImage('恐怖主义与恐怖场景');
      expect(r.reviewStatus).toBe('rejected');
    });
  });

  // ---------- 5b. 补充关键边界(trim 有效命中 / 三规则收敛 / 跨级子串 ruleId 不变量) ----------
  describe('补充边界情况', () => {
    it('含首尾空白的有效文本经 trim 后仍能命中(rejected)', () => {
      const r = contentReviewService.reviewGeneratedImage('  毒品交易  ');
      expect(r.reviewStatus).toBe('rejected');
      expect(r.ruleId).toBe('reject-drugs');
    });

    it('含首尾空白的有效文本经 trim 后仍能命中(flagged)', () => {
      const r = contentReviewService.reviewGeneratedImage('  一幅暴力场景  ');
      expect(r.reviewStatus).toBe('flagged');
      expect(r.ruleId).toBe('flag-violence');
    });

    it('rejected + flagged + semantic 三规则同时命中 → rejected 收敛', () => {
      const r = contentReviewService.reviewGeneratedImage('毒品校园暴力欺凌场景');
      // 毒品→rejected;校园+暴力/欺凌→semantic flagged;暴力→flag-violence flagged
      expect(r.reviewStatus).toBe('rejected');
      // 三组规则均被记录到 reasons
      expect(r.reasons.some((s) => s.includes('reject-drugs'))).toBe(true);
      expect(r.reasons.some((s) => s.includes('sem-school-violence'))).toBe(true);
      expect(r.reasons.some((s) => s.includes('flag-violence'))).toBe(true);
      expect(r.needsManualReview).toBe(false);
    });

    it('跨级子串命中时 ruleId 仍指向 rejected 规则(不变量:迭代 rejected 恒在前)', () => {
      // "恐怖主义"同时子串命中 reject-terrorism(rejected) 与 flag-horror(flagged 的"恐怖")
      const r = contentReviewService.reviewGeneratedImage('恐怖主义宣传海报');
      expect(r.reviewStatus).toBe('rejected');
      // ruleId 必须是 rejected 规则,而非后评估的 flagged 规则
      expect(r.ruleId).toBe('reject-terrorism');
    });

    it('两条语义规则同时命中 → 均计入 reasons,状态收敛为 flagged', () => {
      const r = contentReviewService.reviewGeneratedImage('校园暴力青少年色情');
      expect(r.reviewStatus).toBe('flagged');
      expect(r.reasons.some((s) => s.includes('sem-school-violence'))).toBe(true);
      expect(r.reasons.some((s) => s.includes('sem-teen-porn'))).toBe(true);
      expect(r.needsManualReview).toBe(true);
    });
  });

  // ---------- 6. 无提示词 ----------
  describe('无提示词(sketch 模式)', () => {
    it('prompt 为空/undefined → pending + needsManualReview=true', () => {
      const r = contentReviewService.reviewGeneratedImage(undefined);
      expect(r.reviewStatus).toBe('pending');
      expect(r.needsManualReview).toBe(true);
      expect(r.reasons).toHaveLength(1);
    });

    it('prompt 为纯空白 → pending', () => {
      expect(contentReviewService.reviewGeneratedImage('   ').reviewStatus).toBe('pending');
    });
  });

  // ---------- 7. 审计输出 ----------
  describe('审计输出 reasons/ruleId', () => {
    it('多关键词命中时 reasons 逐条记录且 ruleId 取首个命中', () => {
      const r = contentReviewService.reviewGeneratedImage('血腥暴力与毒品');
      expect(r.reasons.length).toBeGreaterThanOrEqual(2);
      expect(r.reasons.every((s) => s.includes('命中'))).toBe(true);
      expect(r.ruleId).toBeTruthy();
    });

    it('imageMeta 挂点不影响关键词判定(仅预留)', () => {
      const r = contentReviewService.reviewGeneratedImage('一幅暴力场景', { artType: 'painting' });
      expect(r.reviewStatus).toBe('flagged');
    });
  });

  // ---------- 8. 规则表可扩展性 ----------
  describe('规则表可扩展性(getRuleTable)', () => {
    it('返回三组规则且均带 id/类别/严重级别', () => {
      const table = contentReviewService.getRuleTable();
      expect(table.rejected.length).toBeGreaterThan(0);
      expect(table.flagged.length).toBeGreaterThan(0);
      expect(table.semantic.length).toBeGreaterThan(0);
      // 每条关键词规则具备完整结构(id/category/keywords/severity)
      for (const rule of [...table.rejected, ...table.flagged]) {
        expect(rule.id).toBeTruthy();
        expect(rule.category).toBeTruthy();
        expect(rule.keywords.length).toBeGreaterThan(0);
        expect(['flagged', 'rejected']).toContain(rule.severity);
      }
      // 语义规则具备 keywordGroups
      for (const rule of table.semantic) {
        expect(rule.keywordGroups.length).toBeGreaterThanOrEqual(2);
      }
    });
  });
});
