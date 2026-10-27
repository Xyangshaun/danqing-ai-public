// ============================================================
// AnnotationWorkspace 组件测试(2026-09-03 Phase 1A;2026-09-06 Phase 3 批次④扩展)
// 对应源码: src/components/AnnotationWorkspace.tsx
// 对应真源文档: docs/visual-annotation-feedback-upgrade-spec-2026-09.md §3.3
//
// 测试范围:
//   1. 基础渲染(工具栏 chips/图例计数/卡片列表)
//   2. 维度过滤(点击 chip → 只显示该维度标注与卡片)
//   3. 一键显隐(看原图/看标注)
//   4. 卡片内容(四层结构:label/why/how 兜底 hint)
//   5. 卡片↔图上区域联动(hover 卡片 → activeIndex 高亮)
//   6. Phase 3 批次④:第④层"参考"区块(step-guide/master-work/无 reference)
// ============================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import AnnotationWorkspace from '../AnnotationWorkspace';
import type { TeacherAnnotationView } from '../AnnotationWorkspace';
import KnowledgeCardModal from '../KnowledgeCardModal';
import type { IssueMarker } from '../../types';

/** 弹层 mock 引用(断言 cardId 透传) */
const modalMock = vi.mocked(KnowledgeCardModal);

// ---------- Phase 3 批次④依赖 mock(弹层与作品解析在各自测试文件内覆盖) ----------
vi.mock('../KnowledgeCardModal', () => ({
  default: vi.fn(() => null),
}));
vi.mock('../../services/knowledge-card-api', () => ({
  getKnowledgeCard: vi.fn(),
}));
vi.mock('../../services/referenceWork', () => ({
  resolveReferenceWorks: vi.fn().mockResolvedValue([]),
}));

// ---------- ResizeObserver polyfill(IssueAnnotationLayer 依赖) ----------
class MockResizeObserver {
  private cb: ResizeObserverCallback;
  static instances: MockResizeObserver[] = [];
  constructor(cb: ResizeObserverCallback) {
    this.cb = cb;
    MockResizeObserver.instances.push(this);
  }
  observe() {}
  unobserve() {}
  disconnect() {}
  static triggerAll(): void {
    MockResizeObserver.instances.forEach((i) => i.cb([], i));
  }
  static reset(): void {
    MockResizeObserver.instances = [];
  }
}
const originalResizeObserver = globalThis.ResizeObserver;
beforeEach(() => {
  MockResizeObserver.reset();
  globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
});
afterEach(() => {
  globalThis.ResizeObserver = originalResizeObserver;
});

// ---------- 测试数据 ----------
function buildMarkers(): IssueMarker[] {
  return [
    {
      x: 0.1, y: 0.2, w: 0.3, h: 0.2,
      label: '颧骨结构太平',
      severity: 'high',
      improvementHint: '压重暗面',
      type: 'critical',
      dimension: '造型',
      why: '颧骨是头部侧面转折的关键骨点',
      how: '将颧骨分三个朝向面处理',
    },
    {
      x: 0.5, y: 0.5, w: 0.2, h: 0.2,
      label: '色调沉闷',
      severity: 'medium',
      improvementHint: '提高明度对比',
      type: 'suggestion',
      dimension: '色彩',
      why: '明度范围压缩导致画面灰',
      how: '最重处压到 30 以下',
    },
    {
      x: 0.6, y: 0.1, w: 0.2, h: 0.15,
      label: '投影虚实佳',
      severity: 'low',
      improvementHint: '保持观察方式',
      type: 'highlight',
      dimension: '明暗',
      why: '近实远虚的空间规律运用到位',
      how: '迁移到其他物体投影',
    },
  ];
}

function renderWorkspace(markers: IssueMarker[] = buildMarkers()) {
  return render(
    <MemoryRouter>
      <AnnotationWorkspace
        imageUrl="https://example.com/work.png"
        issueMarkers={markers}
      />
    </MemoryRouter>,
  );
}

/** 带 id 的 fixture(批次①后新数据;id 为管线注入的确定性短 hash) */
function buildMarkersWithIds(): IssueMarker[] {
  return buildMarkers().map((m, i) => ({ ...m, id: `mk_testhash00${i}` }));
}

// ============================================================
// 测试用例
// ============================================================

describe('AnnotationWorkspace (Phase 1A)', () => {
  // ----------------------------------------------------------
  // 1. 基础渲染
  // ----------------------------------------------------------
  describe('基础渲染', () => {
    it('should_render_dimension_chips_with_counts', () => {
      renderWorkspace();
      // 全部 chip + 3 个维度 chip(造型/色彩/明暗)
      expect(screen.getByRole('button', { name: /全部 3/ })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /造型 1/ })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /色彩 1/ })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /明暗 1/ })).toBeInTheDocument();
    });

    it('should_render_type_legend_counts', () => {
      renderWorkspace();
      // 图例:关键 1 / 建议 1 / 亮点 1
      expect(screen.getByText('关键 1')).toBeInTheDocument();
      expect(screen.getByText('建议 1')).toBeInTheDocument();
      expect(screen.getByText('亮点 1')).toBeInTheDocument();
    });

    it('should_render_card_for_each_marker', () => {
      renderWorkspace();
      expect(screen.getByText('颧骨结构太平')).toBeInTheDocument();
      expect(screen.getByText('色调沉闷')).toBeInTheDocument();
      expect(screen.getByText('投影虚实佳')).toBeInTheDocument();
    });

    it('should_render_why_and_how_in_cards', () => {
      renderWorkspace();
      expect(screen.getByText(/颧骨是头部侧面转折的关键骨点/)).toBeInTheDocument();
      expect(screen.getByText(/将颧骨分三个朝向面处理/)).toBeInTheDocument();
    });
  });

  // ----------------------------------------------------------
  // 2. 维度过滤
  // ----------------------------------------------------------
  describe('维度过滤', () => {
    it('should_filter_markers_when_dimension_chip_clicked', () => {
      renderWorkspace();
      fireEvent.click(screen.getByRole('button', { name: /造型 1/ }));
      // 只剩造型的标注卡片
      expect(screen.getByText('颧骨结构太平')).toBeInTheDocument();
      expect(screen.queryByText('色调沉闷')).not.toBeInTheDocument();
      expect(screen.queryByText('投影虚实佳')).not.toBeInTheDocument();
    });

    it('should_restore_all_markers_when_all_chip_clicked', () => {
      renderWorkspace();
      fireEvent.click(screen.getByRole('button', { name: /色彩 1/ }));
      expect(screen.queryByText('颧骨结构太平')).not.toBeInTheDocument();
      // 再点"全部"恢复
      fireEvent.click(screen.getByRole('button', { name: /全部 3/ }));
      expect(screen.getByText('颧骨结构太平')).toBeInTheDocument();
      expect(screen.getByText('色调沉闷')).toBeInTheDocument();
      expect(screen.getByText('投影虚实佳')).toBeInTheDocument();
    });

    it('should_toggle_filter_off_when_same_chip_clicked_again', () => {
      renderWorkspace();
      const chip = screen.getByRole('button', { name: /明暗 1/ });
      fireEvent.click(chip); // 开启过滤
      expect(screen.queryByText('颧骨结构太平')).not.toBeInTheDocument();
      fireEvent.click(chip); // 再点关闭
      expect(screen.getByText('颧骨结构太平')).toBeInTheDocument();
    });
  });

  // ----------------------------------------------------------
  // 3. 一键显隐
  // ----------------------------------------------------------
  describe('一键显隐', () => {
    it('should_hide_all_annotations_when_eye_toggled', () => {
      const { container } = renderWorkspace();
      // 卡片仍在(侧栏不隐藏),但图上标注隐藏 + 显示原图模式提示
      fireEvent.click(screen.getByRole('button', { name: /看原图/ }));
      expect(screen.getByText(/原图模式/)).toBeInTheDocument();
      // IssueAnnotationLayer 收到空数组 → 返回 null,SVG 不存在
      const svg = container.querySelector('svg[role="img"]');
      expect(svg).not.toBeInTheDocument();
    });

    it('should_show_annotations_again_when_eye_toggled_back', () => {
      renderWorkspace();
      fireEvent.click(screen.getByRole('button', { name: /看原图/ }));
      fireEvent.click(screen.getByRole('button', { name: /看标注/ }));
      expect(screen.queryByText(/原图模式/)).not.toBeInTheDocument();
    });
  });

  // ----------------------------------------------------------
  // 4. 卡片内容兜底(旧数据无 why/how)
  // ----------------------------------------------------------
  describe('卡片内容兜底', () => {
    it('should_fallback_to_improvementHint_when_why_how_missing', () => {
      renderWorkspace([
        {
          x: 0.1, y: 0.2, w: 0.3, h: 0.2,
          label: '构图偏移',
          severity: 'high',
          improvementHint: '建议将视觉重心向左下偏移',
        },
      ]);
      expect(screen.getByText('建议将视觉重心向左下偏移')).toBeInTheDocument();
    });
  });

  // ----------------------------------------------------------
  // 5. 卡片↔图上区域联动
  // ----------------------------------------------------------
  describe('卡片联动', () => {
    it('should_highlight_marker_when_card_hovered', async () => {
      const { container } = renderWorkspace();
      // mock img 尺寸使 SVG 绘制标注
      const img = container.querySelector('img')!;
      Object.defineProperty(img, 'clientWidth', { value: 400, configurable: true });
      Object.defineProperty(img, 'clientHeight', { value: 300, configurable: true });
      MockResizeObserver.triggerAll();
      await vi.waitFor(() => {
        expect(container.querySelectorAll('svg rect').length).toBe(3);
      });

      // hover 第二张卡片 → 图上第二个标注描边加粗(activeIndex 联动)
      const cards = screen.getAllByRole('button').filter(
        (b) => b.textContent?.includes('色调沉闷'),
      );
      fireEvent.mouseEnter(cards[0]!);
      const rects = container.querySelectorAll('svg rect');
      // 第二个标注(critical strokeWidth 2.5 → active 4;suggestion 1.5 → active 3)
      await vi.waitFor(() => {
        expect(rects[1]).toHaveAttribute('stroke-width', '3');
      });
      // 非激活标注不受影响
      expect(rects[0]).toHaveAttribute('stroke-width', '2.5');
    });

    it('should_show_dimension_badge_and_type_tag_in_card', () => {
      renderWorkspace();
      const card = screen.getAllByRole('button').find(
        (b) => b.textContent?.includes('颧骨结构太平'),
      )!;
      // 维度徽章 + 类型标签
      expect(within(card).getByText('造型')).toBeInTheDocument();
      expect(within(card).getByText('关键')).toBeInTheDocument();
    });
  });
});

// ============================================================
// 6. Phase 3 批次④:第④层"参考"区块
// ============================================================
describe('AnnotationWorkspace Phase 3 批次④:参考区块', () => {
  const stepGuideMarker: IssueMarker = {
    x: 0.1, y: 0.2, w: 0.3, h: 0.2,
    label: '画面灰',
    severity: 'medium',
    improvementHint: '拉开明度对比',
    type: 'suggestion',
    dimension: '色彩',
    why: '明度范围压缩',
    how: '最重处压到 30 以下',
    reference: {
      kind: 'step-guide',
      cardId: 'kcard_sketch_value_gray_001',
      teaser: '分步演示:压重明度,拉开黑白灰',
    },
  };

  const masterWorkMarker: IssueMarker = {
    x: 0.1, y: 0.2, w: 0.3, h: 0.2,
    label: '色彩贫瘠',
    severity: 'medium',
    improvementHint: '提升色彩饱和度',
    type: 'suggestion',
    dimension: '色彩',
    why: '固有色平涂,缺少色彩倾向',
    how: '引入冷暖对比',
    reference: {
      kind: 'master-work',
      workId: 'heritage-dunhuang-001',
      teaser: '敦煌壁画:矿物色的撞色胆量',
    },
  };

  /** 带 /styles 路由标记的渲染(断言 master-work 跳转) */
  function renderWorkspaceWithRoutes(markers: IssueMarker[]) {
    return render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route
            path="/"
            element={
              <AnnotationWorkspace
                imageUrl="https://example.com/work.png"
                issueMarkers={markers}
              />
            }
          />
          <Route path="/styles" element={<div data-testid="styles-page" />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it('should_render_step_guide_reference_block_with_teaser_and_entry', () => {
    renderWorkspace([stepGuideMarker]);
    expect(screen.getByText('分步演示:压重明度,拉开黑白灰')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '查看分步参考图:分步演示:压重明度,拉开黑白灰' }),
    ).toBeInTheDocument();
  });

  it('should_pass_card_id_to_modal_when_step_guide_entry_clicked', () => {
    modalMock.mockClear();
    renderWorkspace([stepGuideMarker]);
    fireEvent.click(
      screen.getByRole('button', { name: /查看分步参考图/ }),
    );
    expect(modalMock).toHaveBeenCalled();
    const lastCall =
      modalMock.mock.calls[modalMock.mock.calls.length - 1]! as unknown as Array<{
        cardId: string | null;
      }>;
    expect(lastCall[0]!.cardId).toBe('kcard_sketch_value_gray_001');
  });

  it('should_navigate_to_styles_when_master_work_entry_clicked', () => {
    renderWorkspaceWithRoutes([masterWorkMarker]);
    // master-work:teaser +「查看作品」入口(resolveReferenceWorks mock 返回空 → ExternalLink 占位)
    expect(screen.getByText('敦煌壁画:矿物色的撞色胆量')).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: /在知识库查看作品/ }),
    );
    expect(screen.getByTestId('styles-page')).toBeInTheDocument();
  });

  it('should_not_render_reference_block_when_reference_missing', () => {
    renderWorkspace(buildMarkers());
    expect(screen.queryByText(/查看分步图/)).not.toBeInTheDocument();
    expect(screen.queryByText(/查看作品/)).not.toBeInTheDocument();
  });
});

// ============================================================
// 7. Phase 4 批次②:标注反馈行(数据飞轮)
//    对应 spec §7.3 第 1 项:onMarkerFeedback prop 存在时每张卡片
//    底部渲染 👍有用/👎没用;点击回调 (markerId, markerIndex, action);
//    乐观更新切换按钮态;不冒泡触发卡片点击;prop 缺失不渲染(纯增量)
// ============================================================
describe('AnnotationWorkspace Phase 4 批次②:标注反馈行(数据飞轮)', () => {
  /** 传入反馈回调的渲染(props 缺省场景用现有 renderWorkspace) */
  function renderWorkspaceWithFeedback(
    markers: IssueMarker[],
    onMarkerFeedback: (markerId: string | undefined, markerIndex: number, action: 'up' | 'down') => void,
  ) {
    return render(
      <MemoryRouter>
        <AnnotationWorkspace
          imageUrl="https://example.com/work.png"
          issueMarkers={markers}
          onMarkerFeedback={onMarkerFeedback}
        />
      </MemoryRouter>,
    );
  }

  it('should_render_feedback_row_per_card_when_callback_provided', () => {
    renderWorkspaceWithFeedback(buildMarkers(), vi.fn());
    // 3 张卡片各一行:提示语 + 👍 + 👎
    expect(screen.getAllByRole('button', { name: '反馈:有用' })).toHaveLength(3);
    expect(screen.getAllByRole('button', { name: '反馈:没用' })).toHaveLength(3);
    expect(screen.getAllByText('这条标注:')).toHaveLength(3);
  });

  it('should_call_callback_with_marker_id_and_original_index_when_up_clicked', () => {
    const onFeedback = vi.fn();
    renderWorkspaceWithFeedback(buildMarkersWithIds(), onFeedback);
    // 第一张卡片(原始索引 0)的「有用」
    fireEvent.click(screen.getAllByRole('button', { name: '反馈:有用' })[0]!);
    expect(onFeedback).toHaveBeenCalledWith('mk_testhash000', 0, 'up');
  });

  it('should_call_callback_with_undefined_marker_id_for_legacy_data', () => {
    const onFeedback = vi.fn();
    renderWorkspaceWithFeedback(buildMarkers(), onFeedback);
    // 旧数据无 marker id → 回调收 undefined,由 markerIndex 兜底定位
    fireEvent.click(screen.getAllByRole('button', { name: '反馈:没用' })[1]!);
    expect(onFeedback).toHaveBeenCalledWith(undefined, 1, 'down');
  });

  it('should_switch_optimistic_state_when_feedback_clicked', () => {
    renderWorkspaceWithFeedback(buildMarkers(), vi.fn());
    const up = screen.getAllByRole('button', { name: '反馈:有用' })[0]!;
    const down = screen.getAllByRole('button', { name: '反馈:没用' })[0]!;
    // 初始未选中
    expect(up).toHaveAttribute('aria-pressed', 'false');
    // 点「有用」→ 乐观置位(jade 激活态)
    fireEvent.click(up);
    expect(up).toHaveAttribute('aria-pressed', 'true');
    expect(up.className).toContain('text-jade');
    // 切到「没用」→ down 激活、up 恢复未选中
    fireEvent.click(down);
    expect(down).toHaveAttribute('aria-pressed', 'true');
    expect(down.className).toContain('text-cinnabar');
    expect(up).toHaveAttribute('aria-pressed', 'false');
    expect(up.className).not.toContain('text-jade');
  });

  it('should_not_trigger_card_click_when_feedback_clicked', () => {
    renderWorkspaceWithFeedback(buildMarkers(), vi.fn());
    // 卡片 onClick 会切换 activeIndex(激活态样式 shadow-overlay);
    // 反馈控件 span 阻断冒泡 → 点反馈不应激活卡片
    const up = screen.getAllByRole('button', { name: '反馈:有用' })[0]!;
    const card = up.closest('button')!;
    fireEvent.click(up);
    expect(card.className).not.toContain('shadow-overlay');
    // 对照:直接点击卡片本体则激活(证明断言有效)
    fireEvent.click(card);
    expect(card.className).toContain('shadow-overlay');
  });

  it('should_not_render_feedback_row_when_callback_missing', () => {
    // 现有 renderWorkspace 不传 onMarkerFeedback(教师端等场景)
    renderWorkspace();
    expect(screen.queryByRole('button', { name: '反馈:有用' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '反馈:没用' })).not.toBeInTheDocument();
    expect(screen.queryByText('这条标注:')).not.toBeInTheDocument();
  });
});

// ============================================================
// 8. Phase 4 批次③:onCardClick(教师端批注入口)
//    点标注卡透传 (markerId, markerIndex);与反馈行互不干扰;
//    无 prop 时点击无异常(学生端零影响)
// ============================================================
describe('AnnotationWorkspace Phase 4 批次③:onCardClick 批注入口', () => {
  /** 传入 onCardClick 的渲染 */
  function renderWorkspaceWithCardClick(
    markers: IssueMarker[],
    onCardClick: (markerId: string | undefined, markerIndex: number) => void,
  ) {
    return render(
      <MemoryRouter>
        <AnnotationWorkspace
          imageUrl="https://example.com/work.png"
          issueMarkers={markers}
          onCardClick={onCardClick}
        />
      </MemoryRouter>,
    );
  }

  /** 卡片元素(按标注 label 定位外层 button) */
  function getCard(label: string): HTMLElement {
    const card = screen.getAllByRole('button').find((b) => b.textContent?.includes(label));
    if (!card) throw new Error(`card ${label} not found`);
    return card;
  }

  it('should_call_onCardClick_with_marker_id_and_original_index_when_card_clicked', () => {
    const onCardClick = vi.fn();
    renderWorkspaceWithCardClick(buildMarkersWithIds(), onCardClick);
    // 点击第二张卡片(原始索引 1)
    fireEvent.click(getCard('色调沉闷'));
    expect(onCardClick).toHaveBeenCalledWith('mk_testhash001', 1);
  });

  it('should_pass_undefined_marker_id_for_legacy_data', () => {
    const onCardClick = vi.fn();
    renderWorkspaceWithCardClick(buildMarkers(), onCardClick);
    fireEvent.click(getCard('颧骨结构太平'));
    expect(onCardClick).toHaveBeenCalledWith(undefined, 0);
  });

  it('should_not_call_onCardClick_when_feedback_button_clicked', () => {
    // 反馈行 span 阻断冒泡 → 点反馈不触发卡片 onClick(即不打开批注表单)
    const onCardClick = vi.fn();
    render(
      <MemoryRouter>
        <AnnotationWorkspace
          imageUrl="https://example.com/work.png"
          issueMarkers={buildMarkers()}
          onMarkerFeedback={vi.fn()}
          onCardClick={onCardClick}
        />
      </MemoryRouter>,
    );
    const up = screen.getAllByRole('button', { name: '反馈:有用' })[0]!;
    fireEvent.click(up);
    expect(onCardClick).not.toHaveBeenCalled();
  });

  it('should_not_crash_when_card_clicked_without_prop', () => {
    // 无 onCardClick(学生端)时点击卡片仍正常(activeIndex 联动)
    renderWorkspace();
    const card = getCard('颧骨结构太平');
    fireEvent.click(card);
    expect(card.className).toContain('shadow-overlay');
  });
});

// ============================================================
// 9. Phase 4 批次④:教师批注第⑤层(学生端展示)
//    teacherAnnotations 查找函数传入时卡片渲染批注块(action 色系 +
//    教师名 + comment);无匹配/无 prop 不渲染(纯增量不炸)
// ============================================================
describe('AnnotationWorkspace Phase 4 批次④:教师批注展示', () => {
  /** 批注展示载荷(结构子集;与 TeacherAnnotationRecord 兼容) */
  const makeAnno = (overrides: Partial<TeacherAnnotationView> = {}): TeacherAnnotationView => ({
    action: 'supplement',
    comment: '注意颧骨三个朝向面的明度差',
    teacherName: '王老师',
    updatedAt: '2026-09-08T10:00:00.000Z',
    ...overrides,
  });

  /** 传入批注查找函数的渲染 */
  function renderWorkspaceWithAnnotations(
    lookup: (markerId: string | undefined, markerIndex: number) => TeacherAnnotationView | undefined,
  ) {
    return render(
      <MemoryRouter>
        <AnnotationWorkspace
          imageUrl="https://example.com/work.png"
          issueMarkers={buildMarkersWithIds()}
          teacherAnnotations={lookup}
        />
      </MemoryRouter>,
    );
  }

  it('should_render_annotation_block_when_marker_has_annotation', () => {
    renderWorkspaceWithAnnotations((_markerId, markerIndex) =>
      markerIndex === 0 ? makeAnno() : undefined,
    );
    // 第⑤层:动作标签 + 教师名 + 批注内容
    expect(screen.getByText('教师补充')).toBeInTheDocument();
    expect(screen.getByText('王老师')).toBeInTheDocument();
    expect(screen.getByText('注意颧骨三个朝向面的明度差')).toBeInTheDocument();
    // 其他无批注卡片不渲染块
    expect(screen.getAllByText('教师补充')).toHaveLength(1);
  });

  it('should_apply_action_specific_colors(confirm=jade/reject=cinnabar)', () => {
    renderWorkspaceWithAnnotations((_markerId, markerIndex) =>
      markerIndex === 1 ? makeAnno({ action: 'confirm', comment: '判断准确' }) : undefined,
    );
    const confirmBlock = screen.getByText('教师确认').closest('div.rounded-lg')!;
    expect(confirmBlock.className).toContain('border-jade');
    expect(confirmBlock.className).not.toContain('border-cinnabar');
  });

  it('should_show_reject_label_with_cinnabar_color', () => {
    renderWorkspaceWithAnnotations((_markerId, markerIndex) =>
      markerIndex === 0 ? makeAnno({ action: 'reject', comment: '以画面为准' }) : undefined,
    );
    const rejectBlock = screen.getByText('教师驳回').closest('div.rounded-lg')!;
    expect(rejectBlock.className).toContain('border-cinnabar');
  });

  it('should_not_render_annotation_block_when_no_match', () => {
    renderWorkspaceWithAnnotations(() => undefined);
    expect(screen.queryByText('教师补充')).not.toBeInTheDocument();
    expect(screen.queryByText('教师纠正')).not.toBeInTheDocument();
    expect(screen.queryByText('教师确认')).not.toBeInTheDocument();
    expect(screen.queryByText('教师驳回')).not.toBeInTheDocument();
  });

  it('should_not_render_annotation_block_when_prop_missing', () => {
    renderWorkspace();
    expect(screen.queryByText('教师补充')).not.toBeInTheDocument();
  });

  it('should_fallback_to_teacher_label_when_name_null', () => {
    renderWorkspaceWithAnnotations((_markerId, markerIndex) =>
      markerIndex === 0 ? makeAnno({ teacherName: null }) : undefined,
    );
    expect(screen.getByText('教师')).toBeInTheDocument();
  });
});
