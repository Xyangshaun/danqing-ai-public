// ============================================================
// CrossDomainInspiration 组件测试(参考图混合方案 Phase 3 批次④)
// 对应源码: src/components/CrossDomainInspiration.tsx
//
// 测试范围:
//   1. pickInspirationStyles 纯函数映射(exam 科目优先/artType 兜底)
//   2. 渲染门控(仅 guidance;diagnosis/缺失不渲染)
//   3. guidance 渲染(标题 + 2 风格卡 + 启发文案)
//   4. 点击跳转 /fuse?style=<id>(风格预填协同)
// ============================================================

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import CrossDomainInspiration, {
  pickInspirationStyles,
} from '../CrossDomainInspiration';
import { fuseStyles } from '../../services/fuseStandards';

// ============================================================
// 1. pickInspirationStyles 纯函数映射
// ============================================================
describe('pickInspirationStyles 类目映射', () => {
  it('should_pick_dunhuang_and_blue_white_for_exam_color', () => {
    const styles = pickInspirationStyles({
      diagnosisMode: 'exam',
      examSubject: 'color',
      artType: 'painting',
    });
    expect(styles.map((s) => s.styleId)).toEqual(['dunhuang', 'blue-white']);
  });

  it('should_pick_ink_and_nianhua_for_exam_quick_sketch', () => {
    const styles = pickInspirationStyles({
      diagnosisMode: 'exam',
      examSubject: 'quickSketch',
      artType: 'painting',
    });
    expect(styles.map((s) => s.styleId)).toEqual(['ink', 'nianhua']);
  });

  it('should_fallback_to_sketch_pair_for_exam_sketch_or_unknown_subject', () => {
    for (const examSubject of ['sketch', null, undefined]) {
      const styles = pickInspirationStyles({
        diagnosisMode: 'exam',
        examSubject: examSubject as string | null | undefined,
        artType: 'painting',
      });
      expect(styles.map((s) => s.styleId)).toEqual(['lacquer', 'song-academy']);
    }
  });

  it('should_pick_by_art_type_when_not_exam_mode', () => {
    const cases: Array<[string, string[]]> = [
      ['design', ['art-nouveau', 'minimal']],
      ['product', ['lacquer', 'art-nouveau']],
      ['sculpture', ['thangka', 'papercut']],
      ['heritage', ['embroidery-su', 'nianhua']],
      ['painting', ['ink', 'song-academy']],
    ];
    for (const [artType, expected] of cases) {
      const styles = pickInspirationStyles({
        diagnosisMode: 'teaching',
        examSubject: 'color',
        artType,
      });
      expect(styles.map((s) => s.styleId)).toEqual(expected);
    }
  });

  it('should_only_return_styles_existing_in_fuse_standards', () => {
    // 启发跳转目标必须真实存在于灵感嫁接风格库(否则 /fuse?style= 预填无效)
    const validIds = new Set(fuseStyles.map((s) => s.id));
    const scenarios = [
      { diagnosisMode: 'exam', examSubject: 'color', artType: 'painting' },
      { diagnosisMode: 'exam', examSubject: 'quickSketch', artType: 'painting' },
      { diagnosisMode: 'exam', examSubject: 'sketch', artType: 'painting' },
      { diagnosisMode: 'teaching', examSubject: null, artType: 'design' },
      { diagnosisMode: 'teaching', examSubject: null, artType: 'product' },
      { diagnosisMode: 'teaching', examSubject: null, artType: 'sculpture' },
      { diagnosisMode: 'teaching', examSubject: null, artType: 'heritage' },
      { diagnosisMode: 'teaching', examSubject: null, artType: 'painting' },
    ];
    for (const scenario of scenarios) {
      for (const s of pickInspirationStyles(scenario)) {
        expect(validIds.has(s.styleId)).toBe(true);
      }
    }
  });
});

// ============================================================
// 2. 渲染门控(仅 guidance)
// ============================================================
describe('CrossDomainInspiration 渲染门控', () => {
  it('should_return_null_when_feedback_mode_missing', () => {
    const { container } = render(
      <MemoryRouter>
        <CrossDomainInspiration diagnosisMode="teaching" artType="painting" />
      </MemoryRouter>,
    );
    expect(container.innerHTML).toBe('');
  });

  it('should_return_null_when_feedback_mode_is_diagnosis', () => {
    const { container } = render(
      <MemoryRouter>
        <CrossDomainInspiration
          feedbackMode="diagnosis"
          diagnosisMode="teaching"
          artType="painting"
        />
      </MemoryRouter>,
    );
    expect(container.innerHTML).toBe('');
  });
});

// ============================================================
// 3. guidance 渲染与跳转
// ============================================================
describe('CrossDomainInspiration guidance 渲染', () => {
  /** 带 /fuse 路由标记的渲染(跳转断言) */
  function renderInspiration(initialEntry = '/') {
    return render(
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route
            path="/"
            element={
              <CrossDomainInspiration
                feedbackMode="guidance"
                diagnosisMode="teaching"
                artType="painting"
              />
            }
          />
          <Route path="/fuse" element={<div data-testid="fuse-page" />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it('should_render_title_and_two_style_cards_in_guidance_mode', () => {
    renderInspiration();
    expect(screen.getByText('跨域启发')).toBeInTheDocument();
    // painting 默认映射:水墨写意 + 宋代院体
    expect(screen.getByText('水墨写意')).toBeInTheDocument();
    expect(screen.getByText('宋代院体')).toBeInTheDocument();
    expect(screen.getAllByTitle(/风格预填,进入灵感嫁接/).length).toBe(2);
  });

  it('should_navigate_to_fuse_with_style_param_when_card_clicked', () => {
    renderInspiration();
    fireEvent.click(screen.getByTitle('带「水墨写意」风格预填,进入灵感嫁接'));
    expect(screen.getByTestId('fuse-page')).toBeInTheDocument();
  });
});
