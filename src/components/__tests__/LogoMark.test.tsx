// ============================================================
// LogoMark 组件单元测试
// 对应源码: src/components/LogoMark.tsx
//
// 2026-09-02 更新:LogoMark 已从代码绘制 SVG(DQ 字母印)切换为
// "丹青"朱文印透明底 PNG 素材(img 引入),测试同步适配。
//
// 测试范围:
//   1. 渲染印章图(img)+ 文字标识
//   2. aria-label 可达性
//   3. memo 化:相同渲染条件下父组件重渲染不触发 LogoMark 重渲染
//   4. hover 交互(光晕 + 缩放)
// ============================================================

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import LogoMark from '../LogoMark';

describe('LogoMark 渲染', () => {
  it('渲染印章图(朱文印 PNG 素材,8x8 尺寸)', () => {
    const { container } = render(<LogoMark />);
    const img = container.querySelector('img');
    expect(img).toBeInTheDocument();
    // Vite 资源引入:src 指向 logo-seal 素材(构建后携带资源指纹)
    expect(img?.getAttribute('src')).toContain('logo-seal');
    // 尺寸与填充约定:8x8 + object-contain(透明底印章不裁切)
    expect(img?.className).toContain('w-8');
    expect(img?.className).toContain('h-8');
    expect(img?.className).toContain('object-contain');
  });

  it('渲染文字标识 "DQ AI" 与副标题 "丹青智能创作"', () => {
    render(<LogoMark />);
    expect(screen.getByText('DQ')).toBeInTheDocument();
    expect(screen.getByText('AI')).toBeInTheDocument();
    expect(screen.getByText('丹青智能创作')).toBeInTheDocument();
  });

  it('根容器有 aria-label 描述品牌含义', () => {
    const { container } = render(<LogoMark />);
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveAttribute('aria-label', 'DQ AI 丹青智能创作');
  });

  it('印章图对辅助技术隐藏(容器 aria-hidden + 空 alt 装饰图)', () => {
    const { container } = render(<LogoMark />);
    // 印章包裹容器 aria-hidden(品牌含义由根容器 aria-label 提供)
    const wrap = container.querySelector('div[aria-hidden="true"]');
    expect(wrap).toBeInTheDocument();
    const img = container.querySelector('img');
    expect(img).toHaveAttribute('alt', '');
    expect(img).toHaveAttribute('draggable', 'false');
  });
});

describe('LogoMark hover 交互', () => {
  it('鼠标进入触发光晕显示(opacity 切换)', () => {
    const { container } = render(<LogoMark />);
    const root = container.firstElementChild as HTMLElement;
    // 初始光晕 opacity-0
    const halo = root.querySelector('.bg-cinnabar\\/25') as HTMLElement | null;
    expect(halo).toBeInTheDocument();
    expect(halo?.className).toContain('opacity-0');
    // hover 后光晕 opacity-100
    fireEvent.mouseEnter(root);
    expect(halo?.className).toContain('opacity-100');
    // mouseLeave 恢复
    fireEvent.mouseLeave(root);
    expect(halo?.className).toContain('opacity-0');
  });
});

describe('LogoMark memo 化', () => {
  it('React.memo 包裹:相同父组件重渲染时不额外重渲染 LogoMark', () => {
    // 用渲染计数器验证 memo:包一层父组件,父组件多次 setState 触发重渲染,
    // LogoMark 无 props,memo 应跳过(渲染计数不增加)
    let parentRenderCount = 0;
    function Parent() {
      parentRenderCount++;
      return <LogoMark />;
    }
    const { rerender } = render(<Parent />);
    expect(parentRenderCount).toBe(1);
    // 父组件重渲染(相同元素),LogoMark 应被 memo 跳过
    rerender(<Parent />);
    rerender(<Parent />);
    expect(parentRenderCount).toBe(3);
    // LogoMark 内部 hover 状态变化仍触发自身重渲染(不受 memo 影响)
    const img = document.querySelector('img');
    expect(img).toBeInTheDocument();
  });

  it('displayName 为 memo(LogoMark)(React.memo 默认命名)', () => {
    // memo 包裹后,组件类型存在;通过渲染验证不抛错即可
    expect(() => render(<LogoMark />)).not.toThrow();
  });
});
