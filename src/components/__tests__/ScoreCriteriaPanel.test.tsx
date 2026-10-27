// ============================================================
// ScoreCriteriaPanel 组件渲染测试 (Task 22.1)
// 对应源码: src/components/ScoreCriteriaPanel.tsx
//
// 测试范围:
//   1. 空数据降级(空数组/undefined → null)
//   2. 基础渲染(标题/副标题/aria-label)
//   3. 评价阶段徽章(6 种 stage 中文标签 + exam/teaching 参照系描述)
//   4. 维度卡片(维度名/权重百分比/满分/maxScore 缺省/权重钳制 0-1)
//   5. 等级徽章(excellent/good/average/poor → 优/良/中/差)
//   6. 展开详情交互(默认折叠/点击展开/再次点击折叠/无详情不可展开)
//   7. 多维度多卡片渲染
//
// Mock 策略:
//   - 无外部依赖,纯展示组件,不 mock 任何模块
//   - setup.ts 已提供 jest-dom 匹配器 + matchMedia polyfill
// ============================================================

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ScoreCriteriaPanel from '../ScoreCriteriaPanel';
import type { ScoreCriteria, EvaluationStage, DiagnosisMode } from '../../types';

// ============================================================
// 测试数据工厂
// ============================================================

function buildCriteria(overrides: Partial<ScoreCriteria> = {}): ScoreCriteria {
  return {
    dimension: '构图与造型',
    weight: 0.3,
    maxScore: 100,
    level: 'good',
    metCriteria: ['视觉重心位于黄金分割点'],
    unmetCriteria: ['留白比例略低'],
    evidence: '视觉重心(0.62,0.38)接近黄金分割,但留白仅 12%',
    ...overrides,
  };
}

interface PanelProps {
  scoreCriteria?: ScoreCriteria[];
  evaluationStage?: EvaluationStage;
  diagnosisMode?: DiagnosisMode;
}

function renderPanel(props: PanelProps = {}) {
  const { scoreCriteria = [buildCriteria()], evaluationStage, diagnosisMode } = props;
  const { container } = render(
    <ScoreCriteriaPanel
      scoreCriteria={scoreCriteria}
      evaluationStage={evaluationStage}
      diagnosisMode={diagnosisMode}
    />,
  );
  return { container };
}

// ============================================================
// 测试用例
// ============================================================

describe('ScoreCriteriaPanel (Task 22.1)', () => {
  // ----------------------------------------------------------
  // 1. 空数据降级
  // ----------------------------------------------------------
  describe('空数据降级', () => {
    it('should_return_null_when_scoreCriteria_empty', () => {
      const { container } = renderPanel({ scoreCriteria: [] });
      expect(container).toBeEmptyDOMElement();
    });

    it('should_return_null_when_scoreCriteria_undefined', () => {
      const { container } = render(
        <ScoreCriteriaPanel
          scoreCriteria={undefined as unknown as ScoreCriteria[]}
        />,
      );
      expect(container).toBeEmptyDOMElement();
    });
  });

  // ----------------------------------------------------------
  // 2. 基础渲染
  // ----------------------------------------------------------
  describe('基础渲染', () => {
    it('should_render_title_and_subtitle_when_criteria_provided', () => {
      renderPanel();
      expect(screen.getByText('评分标准')).toBeInTheDocument();
      expect(screen.getByText('各维度权重 · 等级 · 符合项 · 评分证据')).toBeInTheDocument();
    });

    it('should_render_section_with_aria_label', () => {
      renderPanel();
      const section = document.querySelector('section[aria-label="评分标准"]');
      expect(section).toBeInTheDocument();
    });
  });

  // ----------------------------------------------------------
  // 3. 评价阶段徽章
  // ----------------------------------------------------------
  describe('评价阶段徽章', () => {
    it('should_render_stage_badge_with_label_when_evaluationStage_provided', () => {
      renderPanel({ evaluationStage: 'master' });
      expect(screen.getByText('大师级')).toBeInTheDocument();
    });

    it('should_not_render_stage_badge_when_evaluationStage_absent', () => {
      renderPanel();
      // 无徽章:不应出现 Award 图标对应的徽章文本
      const badgeCandidates = ['大师级', '美院级', '联考级', '爱好者', '进阶', '资深'];
      for (const label of badgeCandidates) {
        expect(screen.queryByText(label)).not.toBeInTheDocument();
      }
    });

    it('should_render_enthusiast_label_for_enthusiast_stage', () => {
      renderPanel({ evaluationStage: 'enthusiast' });
      expect(screen.getByText('爱好者')).toBeInTheDocument();
    });

    it('should_render_intermediate_label_for_intermediate_stage', () => {
      renderPanel({ evaluationStage: 'intermediate' });
      expect(screen.getByText('进阶')).toBeInTheDocument();
    });

    it('should_render_advanced_label_for_advanced_stage', () => {
      renderPanel({ evaluationStage: 'advanced' });
      expect(screen.getByText('资深')).toBeInTheDocument();
    });

    it('should_render_unified_label_for_unified_stage', () => {
      renderPanel({ evaluationStage: 'unified' });
      expect(screen.getByText('联考级')).toBeInTheDocument();
    });

    it('should_render_academy_label_for_academy_stage', () => {
      renderPanel({ evaluationStage: 'academy' });
      expect(screen.getByText('美院级')).toBeInTheDocument();
    });

    it('should_show_exam_reference_in_badge_title_when_diagnosisMode_exam', () => {
      renderPanel({ evaluationStage: 'master', diagnosisMode: 'exam' });
      const badge = screen.getByText('大师级').closest('span');
      expect(badge).toHaveAttribute('title', '按艺考参照系评定');
    });

    it('should_show_teaching_reference_in_badge_title_when_diagnosisMode_teaching', () => {
      renderPanel({ evaluationStage: 'advanced', diagnosisMode: 'teaching' });
      const badge = screen.getByText('资深').closest('span');
      expect(badge).toHaveAttribute('title', '按教学参照系评定');
    });

    it('should_default_to_teaching_reference_when_diagnosisMode_absent', () => {
      // diagnosisMode 缺省按 teaching 处理
      renderPanel({ evaluationStage: 'master' });
      const badge = screen.getByText('大师级').closest('span');
      expect(badge).toHaveAttribute('title', '按教学参照系评定');
    });
  });

  // ----------------------------------------------------------
  // 4. 维度卡片:维度名 / 权重 / 满分
  // ----------------------------------------------------------
  describe('维度卡片渲染', () => {
    it('should_render_dimension_name_and_weight_percentage', () => {
      renderPanel({ scoreCriteria: [buildCriteria({ dimension: '色彩与色调', weight: 0.3 })] });
      expect(screen.getByText('色彩与色调')).toBeInTheDocument();
      expect(screen.getByText('30%')).toBeInTheDocument();
    });

    it('should_render_maxScore_when_provided', () => {
      renderPanel({ scoreCriteria: [buildCriteria({ maxScore: 100 })] });
      expect(screen.getByText('满分')).toBeInTheDocument();
      expect(screen.getByText('100')).toBeInTheDocument();
    });

    it('should_not_render_maxScore_when_absent', () => {
      renderPanel({
        scoreCriteria: [buildCriteria({ maxScore: undefined })],
      });
      expect(screen.queryByText('满分')).not.toBeInTheDocument();
    });

    it('should_clamp_weight_to_100_percent_when_above_1', () => {
      renderPanel({
        scoreCriteria: [buildCriteria({ weight: 1.5 })],
      });
      // weight=1.5 被 clamp 到 1.0 → 显示 100%(非 150%)
      expect(screen.queryByText('150%')).not.toBeInTheDocument();
      expect(screen.getByText('100%')).toBeInTheDocument();
    });

    it('should_clamp_weight_to_0_percent_when_negative', () => {
      renderPanel({
        scoreCriteria: [buildCriteria({ weight: -0.5 })],
      });
      expect(screen.getByText('0%')).toBeInTheDocument();
    });

    it('should_render_exact_50_percent_for_half_weight', () => {
      renderPanel({
        scoreCriteria: [buildCriteria({ weight: 0.5 })],
      });
      expect(screen.getByText('50%')).toBeInTheDocument();
    });
  });

  // ----------------------------------------------------------
  // 5. 等级徽章
  // ----------------------------------------------------------
  describe('等级徽章', () => {
    it('should_render_excellent_badge_for_excellent_level', () => {
      renderPanel({
        scoreCriteria: [buildCriteria({ level: 'excellent' })],
      });
      expect(screen.getByText('优')).toBeInTheDocument();
    });

    it('should_render_good_badge_for_good_level', () => {
      renderPanel({
        scoreCriteria: [buildCriteria({ level: 'good' })],
      });
      expect(screen.getByText('良')).toBeInTheDocument();
    });

    it('should_render_average_badge_for_average_level', () => {
      renderPanel({
        scoreCriteria: [buildCriteria({ level: 'average' })],
      });
      expect(screen.getByText('中')).toBeInTheDocument();
    });

    it('should_render_poor_badge_for_poor_level', () => {
      renderPanel({
        scoreCriteria: [buildCriteria({ level: 'poor' })],
      });
      expect(screen.getByText('差')).toBeInTheDocument();
    });
  });

  // ----------------------------------------------------------
  // 6. 展开详情交互
  // ----------------------------------------------------------
  describe('展开详情交互', () => {
    it('should_not_show_detail_when_collapsed_by_default', () => {
      renderPanel({
        scoreCriteria: [
          buildCriteria({
            metCriteria: ['符合项A'],
            unmetCriteria: ['不符合项B'],
            evidence: '证据文本X',
          }),
        ],
      });
      // 默认折叠:详情内容不可见
      expect(screen.queryByText('符合项A')).not.toBeInTheDocument();
      expect(screen.queryByText('不符合项B')).not.toBeInTheDocument();
      expect(screen.queryByText('证据文本X')).not.toBeInTheDocument();
    });

    it('should_expand_and_show_metCriteria_unmetCriteria_evidence_when_clicked', () => {
      renderPanel({
        scoreCriteria: [
          buildCriteria({
            metCriteria: ['重心居中'],
            unmetCriteria: ['边缘留白不足'],
            evidence: '重心(0.5,0.5)居中,留白比 8%',
          }),
        ],
      });
      // 点击维度卡片展开
      const button = screen.getByRole('button', { name: /构图与造型/ });
      fireEvent.click(button);
      // 展开后:符合项/不符合项/证据均可见
      expect(screen.getByText('重心居中')).toBeInTheDocument();
      expect(screen.getByText('边缘留白不足')).toBeInTheDocument();
      expect(screen.getByText('重心(0.5,0.5)居中,留白比 8%')).toBeInTheDocument();
      // 区域标题也可见
      expect(screen.getByText('符合项')).toBeInTheDocument();
      expect(screen.getByText('不符合项')).toBeInTheDocument();
      expect(screen.getByText('评分证据')).toBeInTheDocument();
    });

    it('should_collapse_when_clicked_again', () => {
      renderPanel({
        scoreCriteria: [
          buildCriteria({
            metCriteria: ['可见项'],
          }),
        ],
      });
      const button = screen.getByRole('button', { name: /构图与造型/ });
      // 第一次点击:展开
      fireEvent.click(button);
      expect(screen.getByText('可见项')).toBeInTheDocument();
      // 第二次点击:折叠
      fireEvent.click(button);
      expect(screen.queryByText('可见项')).not.toBeInTheDocument();
    });

    it('should_not_show_chevron_when_no_detail_available', () => {
      // metCriteria/unmetCriteria 均空 + evidence 空串 → 无展开箭头
      const { container } = renderPanel({
        scoreCriteria: [
          buildCriteria({
            metCriteria: [],
            unmetCriteria: [],
            evidence: '',
          }),
        ],
      });
      // 无 chevron 图标(展开/折叠箭头)
      // 验证:按钮存在但点击不会展开详情
      const button = screen.getByRole('button', { name: /构图与造型/ });
      // 无详情时 aria-expanded 不渲染(undefined → 属性不存在)
      expect(button).not.toHaveAttribute('aria-expanded');
      // 点击不应产生详情区域
      fireEvent.click(button);
      expect(screen.queryByText('符合项')).not.toBeInTheDocument();
    });

    it('should_show_chevron_when_only_evidence_present', () => {
      // evidence 存在但 met/unmet 为空 → 仍可展开(有详情)
      renderPanel({
        scoreCriteria: [
          buildCriteria({
            metCriteria: [],
            unmetCriteria: [],
            evidence: '仅证据无符合项',
          }),
        ],
      });
      const button = screen.getByRole('button', { name: /构图与造型/ });
      fireEvent.click(button);
      expect(screen.getByText('仅证据无符合项')).toBeInTheDocument();
      // 符合项/不符合项区域标题不应出现(对应列表为空时整块不渲染)
      expect(screen.queryByText('符合项')).not.toBeInTheDocument();
    });
  });

  // ----------------------------------------------------------
  // 7. 多维度渲染
  // ----------------------------------------------------------
  describe('多维度渲染', () => {
    it('should_render_multiple_dimension_cards', () => {
      renderPanel({
        scoreCriteria: [
          buildCriteria({ dimension: '构图维度', weight: 0.4 }),
          buildCriteria({ dimension: '色彩维度', weight: 0.35 }),
          buildCriteria({ dimension: '笔触维度', weight: 0.25 }),
        ],
      });
      expect(screen.getByText('构图维度')).toBeInTheDocument();
      expect(screen.getByText('色彩维度')).toBeInTheDocument();
      expect(screen.getByText('笔触维度')).toBeInTheDocument();
      // 权重分别渲染
      expect(screen.getByText('40%')).toBeInTheDocument();
      expect(screen.getByText('35%')).toBeInTheDocument();
      expect(screen.getByText('25%')).toBeInTheDocument();
    });

    it('should_render_empty_lists_silently_without_crash', () => {
      // 边界:metCriteria/unmetCriteria 为空数组(非 undefined)
      const { container } = renderPanel({
        scoreCriteria: [
          buildCriteria({
            metCriteria: [],
            unmetCriteria: [],
            evidence: '仅证据',
          }),
        ],
      });
      expect(container).not.toBeEmptyDOMElement();
    });
  });
});
