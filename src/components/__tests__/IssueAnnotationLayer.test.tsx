// ============================================================
// IssueAnnotationLayer 组件测试(2026-09-03 Phase 1A SVG 版)
// 对应源码: src/components/IssueAnnotationLayer.tsx
//
// 测试范围:
//   1. 空数据降级(空数组/undefined → null)
//   2. 基础渲染(img + svg role/aria-label)
//   3. SVG 绘制(rect 坐标映射/维度色标/highlight 玉色/编号徽章)
//   4. 类型兜底(无 type 时按 severity 映射)
//   5. 鼠标交互(tooltip 显示/隐藏/区域外/why-how 内容)
//   6. 点击回调 onMarkerSelect
//   7. 响应式(ResizeObserver 触发尺寸更新后重绘)
//
// Mock 策略:
//   - polyfill ResizeObserver(jsdom 不提供),triggerAll 手动触发
//   - mock img.clientWidth/clientHeight(jsdom 无布局,默认 0 → SVG 0×0 不绘制标注)
//   - mock svg getBoundingClientRect(供鼠标 hit-test 用)
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import IssueAnnotationLayer from '../IssueAnnotationLayer';
import type { IssueMarker } from '../../types';

// ============================================================
// 全局 Mock:ResizeObserver(jsdom 不提供)
// ============================================================

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
  /** 手动触发 resize 回调(测试响应式重绘用) */
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

// ============================================================
// 测试工具
// ============================================================

function buildMarker(overrides: Partial<IssueMarker> = {}): IssueMarker {
  return {
    x: 0.1,
    y: 0.2,
    w: 0.3,
    h: 0.4,
    label: '构图偏移',
    severity: 'high',
    improvementHint: '建议将视觉重心向左下偏移,靠近黄金分割点',
    ...overrides,
  };
}

/** mock img 元素的 clientWidth/clientHeight(jsdom 默认 0,SVG 不绘制标注) */
function mockImgSize(container: HTMLElement, w = 400, h = 300): HTMLElement {
  const img = container.querySelector('img')!;
  Object.defineProperty(img, 'clientWidth', { value: w, configurable: true });
  Object.defineProperty(img, 'clientHeight', { value: h, configurable: true });
  return img;
}

/** mock svg 的 getBoundingClientRect(供鼠标 hit-test 用) */
function mockSvgRect(container: HTMLElement, w = 400, h = 300): SVGSVGElement {
  const svg = container.querySelector('svg')!;
  svg.getBoundingClientRect = vi.fn(() => ({
    left: 0,
    top: 0,
    width: w,
    height: h,
    right: w,
    bottom: h,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  })) as unknown as typeof svg.getBoundingClientRect;
  return svg;
}

/** 渲染 + mock img 尺寸 + 触发 ResizeObserver 使 SVG 以该尺寸绘制标注 */
async function renderWithSize(markers: IssueMarker[], w = 400, h = 300) {
  const { container } = render(
    <IssueAnnotationLayer imageUrl="https://example.com/work.png" issueMarkers={markers} />,
  );
  mockImgSize(container, w, h);
  MockResizeObserver.triggerAll();
  await waitFor(() => {
    expect(container.querySelectorAll('svg rect').length).toBeGreaterThan(0);
  });
  mockSvgRect(container, w, h);
  return { container };
}

// ============================================================
// 测试用例
// ============================================================

describe('IssueAnnotationLayer (Phase 1A SVG)', () => {
  // ----------------------------------------------------------
  // 1. 空数据降级
  // ----------------------------------------------------------
  describe('空数据降级', () => {
    it('should_return_null_when_issueMarkers_empty', () => {
      const { container } = render(
        <IssueAnnotationLayer imageUrl="https://example.com/test.jpg" issueMarkers={[]} />,
      );
      expect(container).toBeEmptyDOMElement();
    });

    it('should_return_null_when_issueMarkers_undefined', () => {
      const { container } = render(
        <IssueAnnotationLayer
          imageUrl="https://example.com/test.jpg"
          issueMarkers={undefined as unknown as IssueMarker[]}
        />,
      );
      expect(container).toBeEmptyDOMElement();
    });
  });

  // ----------------------------------------------------------
  // 2. 基础渲染
  // ----------------------------------------------------------
  describe('基础渲染', () => {
    it('should_render_img_with_imageUrl_when_markers_provided', () => {
      const { container } = render(
        <IssueAnnotationLayer
          imageUrl="https://example.com/work.png"
          issueMarkers={[buildMarker()]}
        />,
      );
      const img = container.querySelector('img');
      expect(img).toBeInTheDocument();
      expect(img).toHaveAttribute('src', 'https://example.com/work.png');
      expect(img).toHaveAttribute('alt', '待标注的作品');
    });

    it('should_render_svg_with_role_img', () => {
      const { container } = render(
        <IssueAnnotationLayer
          imageUrl="https://example.com/work.png"
          issueMarkers={[buildMarker()]}
        />,
      );
      const svg = container.querySelector('svg');
      expect(svg).toBeInTheDocument();
      expect(svg).toHaveAttribute('role', 'img');
    });

    it('should_aria_label_include_marker_count', () => {
      const { container } = render(
        <IssueAnnotationLayer
          imageUrl="https://example.com/work.png"
          issueMarkers={[buildMarker(), buildMarker({ label: '色彩偏差' })]}
        />,
      );
      const svg = container.querySelector('svg')!;
      expect(svg).toHaveAttribute('aria-label', '作品问题标注图,共 2 处标注区域');
    });
  });

  // ----------------------------------------------------------
  // 3. SVG 绘制(坐标映射/色标/徽章)
  // ----------------------------------------------------------
  describe('SVG 绘制', () => {
    it('should_map_relative_coords_to_pixels', async () => {
      // marker: x=0.25, y=0.5, w=0.5, h=0.25; 图片 400x300 → px=100, py=150, pw=200, ph=75
      const { container } = await renderWithSize([
        buildMarker({ x: 0.25, y: 0.5, w: 0.5, h: 0.25 }),
      ]);
      const rect = container.querySelector('svg rect')!;
      expect(rect).toHaveAttribute('x', '100');
      expect(rect).toHaveAttribute('y', '150');
      expect(rect).toHaveAttribute('width', '200');
      expect(rect).toHaveAttribute('height', '75');
    });

    it('should_render_one_rect_per_marker', async () => {
      const { container } = await renderWithSize([
        buildMarker(),
        buildMarker({ label: 'B' }),
        buildMarker({ label: 'C' }),
      ]);
      expect(container.querySelectorAll('svg rect').length).toBe(3);
    });

    it('should_use_dimension_color_when_present', async () => {
      // dimension=造型 → 赭橙 #e07b39(severity medium 兜底 type=suggestion,维度色生效)
      const { container } = await renderWithSize([
        buildMarker({ dimension: '造型', severity: 'medium' }),
      ]);
      const rect = container.querySelector('svg rect')!;
      // 2026-09-22 聚焦淡化:默认态描边 60% 透明度
      expect(rect).toHaveAttribute('stroke', 'rgba(224, 123, 57, 0.6)');
    });

    it('should_fallback_to_severity_color_without_dimension', async () => {
      const { container } = await renderWithSize([
        buildMarker({ severity: 'high' }),
      ]);
      const rect = container.querySelector('svg rect')!;
      expect(rect).toHaveAttribute('stroke', 'rgba(196, 30, 58, 0.6)');
    });

    it('should_use_jade_color_for_highlight_type', async () => {
      const { container } = await renderWithSize([
        buildMarker({ type: 'highlight', dimension: '色彩' }),
      ]);
      const rect = container.querySelector('svg rect')!;
      expect(rect).toHaveAttribute('stroke', 'rgba(91, 140, 90, 0.6)');
    });

    it('should_render_numbered_badge_for_critical', async () => {
      const { container } = await renderWithSize([
        buildMarker({ type: 'critical', severity: 'high' }),
      ]);
      const badge = container.querySelector('svg circle');
      const text = container.querySelector('svg text');
      expect(badge).toBeInTheDocument();
      expect(text).toHaveTextContent('1');
    });

    it('should_not_render_numbered_badge_for_highlight', async () => {
      const { container } = await renderWithSize([
        buildMarker({ type: 'highlight', severity: 'low' }),
      ]);
      expect(container.querySelector('svg circle')).toBeNull();
      // ✦ 星标存在
      expect(container.querySelector('svg text')?.textContent).toContain('✦');
    });

    it('should_render_dashed_stroke_for_suggestion_type', async () => {
      const { container } = await renderWithSize([
        buildMarker({ type: 'suggestion', severity: 'medium' }),
      ]);
      const rect = container.querySelector('svg rect')!;
      expect(rect).toHaveAttribute('stroke-dasharray', '8 4');
    });
  });

  // ----------------------------------------------------------
  // 4. 类型兜底映射(无 type 字段的旧数据)
  // ----------------------------------------------------------
  describe('类型兜底映射', () => {
    it('should_map_high_severity_to_critical_style', async () => {
      // 旧数据无 type:high → critical(实线 + 编号徽章)
      const { container } = await renderWithSize([buildMarker({ severity: 'high' })]);
      const rect = container.querySelector('svg rect')!;
      expect(rect).not.toHaveAttribute('stroke-dasharray');
      expect(container.querySelector('svg circle')).toBeInTheDocument();
    });

    it('should_map_medium_severity_to_suggestion_style', async () => {
      const { container } = await renderWithSize([
        buildMarker({ severity: 'medium' }),
      ]);
      const rect = container.querySelector('svg rect')!;
      expect(rect).toHaveAttribute('stroke-dasharray', '8 4');
      expect(container.querySelector('svg circle')).toBeInTheDocument();
    });

    it('should_map_low_severity_to_highlight_style', async () => {
      const { container } = await renderWithSize([buildMarker({ severity: 'low' })]);
      // low → highlight:玉色 + 无编号徽章
      const rect = container.querySelector('svg rect')!;
      expect(rect).toHaveAttribute('stroke', 'rgba(91, 140, 90, 0.6)');
      expect(container.querySelector('svg circle')).toBeNull();
    });
  });

  // ----------------------------------------------------------
  // 5. 鼠标交互(tooltip)
  // ----------------------------------------------------------
  describe('鼠标交互 tooltip', () => {
    it('should_show_tooltip_with_label_why_how_on_hover', async () => {
      const { container } = await renderWithSize([
        buildMarker({
          label: '颧骨结构太平',
          why: '颧骨是头部侧面转折的关键骨点',
          how: '将颧骨分三个朝向面处理',
          x: 0.1,
          y: 0.2,
          w: 0.3,
          h: 0.4,
        }),
      ]);
      const svg = container.querySelector('svg')!;
      fireEvent.mouseMove(svg, { clientX: 100, clientY: 100 });
      await waitFor(() => {
        expect(screen.queryByRole('tooltip')).toBeInTheDocument();
      });
      expect(screen.getByText('颧骨结构太平')).toBeInTheDocument();
      expect(screen.getByText(/颧骨是头部侧面转折的关键骨点/)).toBeInTheDocument();
      expect(screen.getByText(/将颧骨分三个朝向面处理/)).toBeInTheDocument();
    });

    it('should_show_improvementHint_when_why_how_missing', async () => {
      // 旧数据只有 improvementHint
      const { container } = await renderWithSize([
        buildMarker({ label: '构图偏移', improvementHint: '建议向左下偏移重心' }),
      ]);
      const svg = container.querySelector('svg')!;
      fireEvent.mouseMove(svg, { clientX: 100, clientY: 100 });
      await waitFor(() => {
        expect(screen.queryByRole('tooltip')).toBeInTheDocument();
      });
      expect(screen.getByText('建议向左下偏移重心')).toBeInTheDocument();
    });

    it('should_hide_tooltip_on_mouse_leave', async () => {
      const { container } = await renderWithSize([buildMarker()]);
      const svg = container.querySelector('svg')!;
      fireEvent.mouseMove(svg, { clientX: 100, clientY: 100 });
      await waitFor(() => {
        expect(screen.queryByRole('tooltip')).toBeInTheDocument();
      });
      fireEvent.mouseLeave(svg);
      await waitFor(() => {
        expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
      });
    });

    it('should_not_show_tooltip_when_hovering_outside_markers', async () => {
      const { container } = await renderWithSize([buildMarker()]);
      const svg = container.querySelector('svg')!;
      fireEvent.mouseMove(svg, { clientX: 300, clientY: 250 });
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    });

    it('should_display_type_label_in_tooltip', async () => {
      const { container } = await renderWithSize([
        buildMarker({ type: 'critical', severity: 'high' }),
      ]);
      const svg = container.querySelector('svg')!;
      fireEvent.mouseMove(svg, { clientX: 100, clientY: 100 });
      await waitFor(() => {
        expect(screen.queryByRole('tooltip')).toBeInTheDocument();
      });
      expect(screen.getByText(/关键问题/)).toBeInTheDocument();
    });

    // ----------------------------------------------------------
    // Phase 3 批次④:第④层"参考"提示行
    // ----------------------------------------------------------
    it('should_show_reference_teaser_in_tooltip_when_reference_present', async () => {
      const { container } = await renderWithSize([
        buildMarker({
          label: '画面灰',
          reference: {
            kind: 'step-guide',
            cardId: 'kcard_sketch_value_gray_001',
            teaser: '分步演示:压重明度',
          },
        }),
      ]);
      const svg = container.querySelector('svg')!;
      fireEvent.mouseMove(svg, { clientX: 100, clientY: 100 });
      await waitFor(() => {
        expect(screen.queryByRole('tooltip')).toBeInTheDocument();
      });
      expect(screen.getByText(/参考 · 分步演示:压重明度/)).toBeInTheDocument();
    });

    it('should_not_show_reference_line_when_reference_missing', async () => {
      const { container } = await renderWithSize([buildMarker()]);
      const svg = container.querySelector('svg')!;
      fireEvent.mouseMove(svg, { clientX: 100, clientY: 100 });
      await waitFor(() => {
        expect(screen.queryByRole('tooltip')).toBeInTheDocument();
      });
      expect(screen.queryByText(/^参考 · /)).not.toBeInTheDocument();
    });
  });

  // ----------------------------------------------------------
  // 6. 点击回调(卡片联动)
  // ----------------------------------------------------------
  describe('点击联动', () => {
    it('should_call_onMarkerSelect_with_index_on_click', async () => {
      const onMarkerSelect = vi.fn();
      const { container } = render(
        <IssueAnnotationLayer
          imageUrl="https://example.com/work.png"
          issueMarkers={[buildMarker(), buildMarker({ label: '第二个' })]}
          onMarkerSelect={onMarkerSelect}
        />,
      );
      mockImgSize(container, 400, 300);
      MockResizeObserver.triggerAll();
      await waitFor(() => {
        expect(container.querySelectorAll('svg g').length).toBeGreaterThan(0);
      });
      // 仅取 svg 直接子级 g(编号徽章的 g 嵌套在 marker g 内)
      const groups = container.querySelectorAll('svg > g');
      fireEvent.click(groups[1]!);
      expect(onMarkerSelect).toHaveBeenCalledWith(1);
    });
  });

  // ----------------------------------------------------------
  // 7. 响应式重绘
  // ----------------------------------------------------------
  describe('响应式重绘', () => {
    it('should_redraw_markers_on_resize', async () => {
      const { container } = await renderWithSize([buildMarker({ x: 0.25, w: 0.5 })], 400, 300);
      let rect = container.querySelector('svg rect')!;
      expect(rect).toHaveAttribute('x', '100');

      // 尺寸变化 → 重映射(x=0.25 × 800 = 200)
      mockImgSize(container, 800, 600);
      MockResizeObserver.triggerAll();
      await waitFor(() => {
        rect = container.querySelector('svg rect')!;
        expect(rect).toHaveAttribute('x', '200');
      });
    });
  });
});
