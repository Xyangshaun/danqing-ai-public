// ============================================================
// HeatmapCanvas 组件测试 (Phase F3-10)
// 对应源码: src/components/HeatmapCanvas.tsx
//
// 测试范围:
//   1. 默认渲染(canvas + 透明度滑块 + 辅助线按钮 + 图例)
//   2. title 传入时显示标题
//   3. 透明度滑块:初始值 80%,拖动改变 opacity state
//   4. 辅助线切换:无/三分线/黄金分割 三态切换
//   5. hover tooltip:mousemove 触发,显示视觉权重值;mouseleave 隐藏
//   6. harmonyData 模式:显示视图模式切换按钮,切换至色彩和谐环形
//   7. 仅 harmonyData 无 heatmapData:自动切换至 harmony 视图
//   8. 无 harmonyData:不显示视图切换按钮
//   9. focusPoint 存在时不报错(动画循环正常启动/清理)
//
// Mock 策略:
//   - setup.ts 已 stub HTMLCanvasElement.prototype.getContext(返回 CanvasRenderingContext2DStub)
//   - setup.ts 已 polyfill requestAnimationFrame(setTimeout fallback)
//   - 不 mock 组件本身,测试真实渲染与交互
// ============================================================

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import HeatmapCanvas, { type HarmonyData } from '../HeatmapCanvas';

// ============================================================
// 辅助构造器
// ============================================================

/** 构造 5×4 热力图数据 (rows×cols) */
function buildHeatmap(rows = 5, cols = 4, value = 0.5): number[][] {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => value));
}

/** 构造色彩和谐度数据 */
function buildHarmonyData(overrides: Partial<HarmonyData> = {}): HarmonyData {
  return {
    harmonyScore: 75,
    harmonyType: 'complementary',
    dominantColor: '#c41e3a',
    ...overrides,
  };
}

// ============================================================
// 1. 默认渲染与基础元素
// ============================================================

describe('默认渲染', () => {
  it('渲染 canvas 元素', () => {
    render(<HeatmapCanvas heatmapData={buildHeatmap()} />);
    const canvas = document.querySelector('canvas');
    expect(canvas).toBeInTheDocument();
    expect(canvas).toHaveAttribute('width', '320');
    expect(canvas).toHaveAttribute('height', '240');
  });

  it('传入 title 时显示标题文本', () => {
    render(<HeatmapCanvas heatmapData={buildHeatmap()} title="视觉热力分布" />);
    expect(screen.getByText('视觉热力分布')).toBeInTheDocument();
  });

  it('不传 title 时不渲染标题', () => {
    render(<HeatmapCanvas heatmapData={buildHeatmap()} />);
    expect(screen.queryByText('视觉热力分布')).not.toBeInTheDocument();
  });

  it('默认显示辅助线切换按钮组(无/三分线/黄金分割)', () => {
    render(<HeatmapCanvas heatmapData={buildHeatmap()} />);
    expect(screen.getByText('无')).toBeInTheDocument();
    expect(screen.getByText('三分线')).toBeInTheDocument();
    expect(screen.getByText('黄金分割')).toBeInTheDocument();
  });

  it('默认显示透明度滑块', () => {
    render(<HeatmapCanvas heatmapData={buildHeatmap()} />);
    const slider = screen.getByRole('slider');
    expect(slider).toBeInTheDocument();
    expect(slider).toHaveAttribute('min', '0');
    expect(slider).toHaveAttribute('max', '100');
  });

  it('默认透明度显示 80%', () => {
    render(<HeatmapCanvas heatmapData={buildHeatmap()} />);
    expect(screen.getByText('80%')).toBeInTheDocument();
  });

  it('显示图例(低 → 高)', () => {
    render(<HeatmapCanvas heatmapData={buildHeatmap()} />);
    expect(screen.getByText('低')).toBeInTheDocument();
    expect(screen.getByText('高')).toBeInTheDocument();
  });
});

// ============================================================
// 2. 透明度滑块交互
// ============================================================

describe('透明度滑块', () => {
  it('拖动滑块改变显示的透明度百分比', () => {
    render(<HeatmapCanvas heatmapData={buildHeatmap()} />);
    const slider = screen.getByRole('slider');
    // 初始 80%
    expect(screen.getByText('80%')).toBeInTheDocument();
    // 改为 50%
    fireEvent.change(slider, { target: { value: '50' } });
    expect(screen.getByText('50%')).toBeInTheDocument();
    // 改为 100%
    fireEvent.change(slider, { target: { value: '100' } });
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('滑块 value 与 opacity*100 一致', () => {
    render(<HeatmapCanvas heatmapData={buildHeatmap()} />);
    const slider = screen.getByRole('slider') as HTMLInputElement;
    // 默认 opacity=0.8 → slider value=80
    expect(slider.value).toBe('80');
  });
});

// ============================================================
// 3. 辅助线切换
// ============================================================

describe('辅助线切换', () => {
  it('点击"三分线"切换至 thirds 模式 (按钮高亮)', () => {
    render(<HeatmapCanvas heatmapData={buildHeatmap()} />);
    const thirdsBtn = screen.getByText('三分线');
    // 初始为"无"高亮
    const noneBtn = screen.getByText('无');
    expect(noneBtn).toHaveClass('bg-cinnabar');
    expect(thirdsBtn).not.toHaveClass('bg-cinnabar');
    // 点击三分线
    fireEvent.click(thirdsBtn);
    expect(thirdsBtn).toHaveClass('bg-cinnabar');
    expect(noneBtn).not.toHaveClass('bg-cinnabar');
  });

  it('点击"黄金分割"切换至 golden 模式', () => {
    render(<HeatmapCanvas heatmapData={buildHeatmap()} />);
    const goldenBtn = screen.getByText('黄金分割');
    fireEvent.click(goldenBtn);
    expect(goldenBtn).toHaveClass('bg-cinnabar');
    // "无"取消高亮
    expect(screen.getByText('无')).not.toHaveClass('bg-cinnabar');
  });

  it('点击"无"恢复初始模式', () => {
    render(<HeatmapCanvas heatmapData={buildHeatmap()} />);
    // 先切换到三分线
    fireEvent.click(screen.getByText('三分线'));
    // 再切回无
    fireEvent.click(screen.getByText('无'));
    expect(screen.getByText('无')).toHaveClass('bg-cinnabar');
    expect(screen.getByText('三分线')).not.toHaveClass('bg-cinnabar');
  });

  it('辅助线切换不抛错 (canvas 重绘)', () => {
    render(<HeatmapCanvas heatmapData={buildHeatmap()} />);
    expect(() => {
      fireEvent.click(screen.getByText('三分线'));
      fireEvent.click(screen.getByText('黄金分割'));
      fireEvent.click(screen.getByText('无'));
    }).not.toThrow();
  });
});

// ============================================================
// 4. hover tooltip 交互
// ============================================================

describe('hover tooltip', () => {
  /**
   * jsdom 默认 getBoundingClientRect 返回全 0 (无布局),
   * 导致 scaleX/scaleY = canvas.width / 0 = Infinity,行列计算失效。
   * 此处 stub canvas.getBoundingClientRect 返回与 canvas 内部分辨率一致的矩形,
   * 使 mousemove 坐标计算正常工作。
   */
  function stubCanvasRect(canvas: HTMLCanvasElement) {
    canvas.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 320,
      height: 240,
      right: 320,
      bottom: 240,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
  }

  it('mousemove 在 canvas 上显示 tooltip 含视觉权重值', () => {
    render(<HeatmapCanvas heatmapData={buildHeatmap(5, 4, 0.62)} />);
    const canvas = document.querySelector('canvas')!;
    stubCanvasRect(canvas);
    // 模拟 mousemove (canvas 320x240, 5 rows × 4 cols → cellW=80, cellH=48)
    // (100, 80) → col=1, row=1 → 命中有效单元格
    fireEvent.mouseMove(canvas, { clientX: 100, clientY: 80 });
    // tooltip 应显示,包含 0.62 (toFixed(2))
    expect(screen.getByText(/视觉权重/)).toBeInTheDocument();
    expect(screen.getByText(/0\.62/)).toBeInTheDocument();
  });

  it('mouseleave 隐藏 tooltip', () => {
    render(<HeatmapCanvas heatmapData={buildHeatmap(5, 4, 0.5)} />);
    const canvas = document.querySelector('canvas')!;
    stubCanvasRect(canvas);
    fireEvent.mouseMove(canvas, { clientX: 100, clientY: 80 });
    expect(screen.getByText(/视觉权重/)).toBeInTheDocument();
    fireEvent.mouseLeave(canvas);
    expect(screen.queryByText(/视觉权重/)).not.toBeInTheDocument();
  });

  it('无 heatmapData 时 mousemove 不显示 tooltip', () => {
    render(<HeatmapCanvas heatmapData={[]} />);
    const canvas = document.querySelector('canvas')!;
    stubCanvasRect(canvas);
    fireEvent.mouseMove(canvas, { clientX: 100, clientY: 80 });
    expect(screen.queryByText(/视觉权重/)).not.toBeInTheDocument();
  });

  it('mousemove 超出 canvas 范围不显示 tooltip', () => {
    render(<HeatmapCanvas heatmapData={buildHeatmap(5, 4, 0.5)} />);
    const canvas = document.querySelector('canvas')!;
    stubCanvasRect(canvas);
    // 坐标超出 canvas (320×240)
    fireEvent.mouseMove(canvas, { clientX: 500, clientY: 500 });
    expect(screen.queryByText(/视觉权重/)).not.toBeInTheDocument();
  });
});

// ============================================================
// 5. 色彩和谐度环形视图 (harmonyData)
// ============================================================

describe('色彩和谐度环形视图', () => {
  it('传入 harmonyData 时显示视图模式切换按钮(热力图/色彩和谐)', () => {
    render(
      <HeatmapCanvas
        heatmapData={buildHeatmap()}
        harmonyData={buildHarmonyData()}
      />,
    );
    expect(screen.getByText('热力图')).toBeInTheDocument();
    expect(screen.getByText('色彩和谐')).toBeInTheDocument();
    expect(screen.getByText('视图')).toBeInTheDocument();
  });

  it('不传 harmonyData 时不显示视图切换按钮', () => {
    render(<HeatmapCanvas heatmapData={buildHeatmap()} />);
    expect(screen.queryByText('热力图')).not.toBeInTheDocument();
    expect(screen.queryByText('色彩和谐')).not.toBeInTheDocument();
    expect(screen.queryByText('视图')).not.toBeInTheDocument();
  });

  it('点击"色彩和谐"切换至 harmony 视图,隐藏辅助线按钮与透明度滑块', () => {
    render(
      <HeatmapCanvas
        heatmapData={buildHeatmap()}
        harmonyData={buildHarmonyData()}
      />,
    );
    // 初始为热力图模式:辅助线和滑块可见
    expect(screen.getByText('辅助线')).toBeInTheDocument();
    expect(screen.getByRole('slider')).toBeInTheDocument();
    // 切换至色彩和谐
    fireEvent.click(screen.getByText('色彩和谐'));
    // 辅助线和滑块隐藏
    expect(screen.queryByText('辅助线')).not.toBeInTheDocument();
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
    // 图例也隐藏
    expect(screen.queryByText('低')).not.toBeInTheDocument();
  });

  it('点击"色彩和谐"再切回"热力图"恢复控件', () => {
    render(
      <HeatmapCanvas
        heatmapData={buildHeatmap()}
        harmonyData={buildHarmonyData()}
      />,
    );
    fireEvent.click(screen.getByText('色彩和谐'));
    expect(screen.queryByText('辅助线')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('热力图'));
    expect(screen.getByText('辅助线')).toBeInTheDocument();
    expect(screen.getByRole('slider')).toBeInTheDocument();
  });

  it('仅 harmonyData 无 heatmapData:自动切换至 harmony 视图', () => {
    render(
      <HeatmapCanvas
        heatmapData={[]}
        harmonyData={buildHarmonyData()}
      />,
    );
    // 视图切换按钮仍显示
    expect(screen.getByText('热力图')).toBeInTheDocument();
    expect(screen.getByText('色彩和谐')).toBeInTheDocument();
    // "色彩和谐"按钮高亮 (active)
    expect(screen.getByText('色彩和谐')).toHaveClass('bg-[#5a8a7a]');
    // 辅助线/滑块/图例隐藏 (因当前为 harmony 模式)
    expect(screen.queryByText('辅助线')).not.toBeInTheDocument();
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
  });

  it('harmonyData 仅含 harmonyScore (无 harmonyType):仍可切换', () => {
    render(
      <HeatmapCanvas
        heatmapData={buildHeatmap()}
        harmonyData={{ harmonyScore: 80 }}
      />,
    );
    expect(screen.getByText('色彩和谐')).toBeInTheDocument();
  });

  it('harmonyData 完全为空对象:不显示切换按钮', () => {
    render(
      <HeatmapCanvas
        heatmapData={buildHeatmap()}
        harmonyData={{}}
      />,
    );
    // harmonyData 存在但无 harmonyType 也无 harmonyScore → canShowHarmony=false
    expect(screen.queryByText('色彩和谐')).not.toBeInTheDocument();
  });

  it('切换至 harmony 模式后 canvas 重绘不抛错', () => {
    expect(() => {
      render(
        <HeatmapCanvas
          heatmapData={buildHeatmap()}
          harmonyData={buildHarmonyData({ harmonyType: 'triadic', harmonyScore: 85 })}
        />,
      );
      fireEvent.click(screen.getByText('色彩和谐'));
      fireEvent.click(screen.getByText('热力图'));
      fireEvent.click(screen.getByText('色彩和谐'));
    }).not.toThrow();
  });

  it('不同 harmonyType (complementary/analogous/triadic/split-complementary/monochromatic/achromatic/mixed) 均不抛错', () => {
    const types = [
      'complementary',
      'analogous',
      'triadic',
      'split-complementary',
      'monochromatic',
      'achromatic',
      'mixed',
    ];
    for (const t of types) {
      expect(() => {
        render(
          <HeatmapCanvas
            heatmapData={[]}
            harmonyData={buildHarmonyData({ harmonyType: t })}
          />,
        );
      }).not.toThrow();
    }
  });
});

// ============================================================
// 6. focusPoint 动画
// ============================================================

describe('focusPoint 动画', () => {
  it('传入 focusPoint 不抛错 (启动 rAF 动画循环)', () => {
    expect(() => {
      render(
        <HeatmapCanvas
          heatmapData={buildHeatmap()}
          focusPoint={{ x: 0.5, y: 0.5 }}
        />,
      );
    }).not.toThrow();
  });

  it('focusPoint 改变不抛错 (effect 重新触发)', () => {
    const { rerender } = render(
      <HeatmapCanvas
        heatmapData={buildHeatmap()}
        focusPoint={{ x: 0.3, y: 0.4 }}
      />,
    );
    expect(() => {
      rerender(
        <HeatmapCanvas
          heatmapData={buildHeatmap()}
          focusPoint={{ x: 0.6, y: 0.7 }}
        />,
      );
    }).not.toThrow();
  });

  it('无 focusPoint 时不抛错 (单次绘制)', () => {
    expect(() => {
      render(<HeatmapCanvas heatmapData={buildHeatmap()} />);
    }).not.toThrow();
  });

  it('卸载组件不抛错 (清理 rAF)', () => {
    const { unmount } = render(
      <HeatmapCanvas
        heatmapData={buildHeatmap()}
        focusPoint={{ x: 0.5, y: 0.5 }}
      />,
    );
    expect(() => unmount()).not.toThrow();
  });
});

// ============================================================
// 7. 边界情况
// ============================================================

describe('边界情况', () => {
  it('heatmapData 为 undefined 时不抛错', () => {
    expect(() => {
      render(<HeatmapCanvas />);
    }).not.toThrow();
  });

  it('heatmapData 为空数组时不抛错', () => {
    expect(() => {
      render(<HeatmapCanvas heatmapData={[]} />);
    }).not.toThrow();
  });

  it('heatmapData 含全 0 值时不抛错 (低值单元格被跳过)', () => {
    expect(() => {
      render(<HeatmapCanvas heatmapData={buildHeatmap(5, 4, 0)} />);
    }).not.toThrow();
  });

  it('heatmapData 含高值 (0.9) 不抛错', () => {
    expect(() => {
      render(<HeatmapCanvas heatmapData={buildHeatmap(5, 4, 0.9)} />);
    }).not.toThrow();
  });

  it('不同 colorScheme (fire/blue/green/purple) 不抛错', () => {
    const schemes = ['fire', 'blue', 'green', 'purple'] as const;
    for (const cs of schemes) {
      expect(() => {
        render(<HeatmapCanvas heatmapData={buildHeatmap()} colorScheme={cs} />);
      }).not.toThrow();
    }
  });

  it('canvas 调用 getContext 后不抛错 (jsdom stub 工作)', () => {
    render(<HeatmapCanvas heatmapData={buildHeatmap()} />);
    const canvas = document.querySelector('canvas')!;
    const ctx = canvas.getContext('2d');
    expect(ctx).not.toBeNull();
  });
});
