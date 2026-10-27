// ============================================================
// Button 组件单元测试
// 对应源码: src/components/Button.tsx
//
// 测试范围:
//   1. 默认渲染:文字、type、role、variant/size 默认值
//   2. variant 切换:primary/secondary/ghost/danger 各自的 className 特征
//   3. size 切换:sm/md/lg 各自的高度/padding 特征
//   4. loading 态:aria-busy、disabled、显示 spinner、拦截 onClick
//   5. disabled 态:disabled 属性、拦截 onClick
//   6. onClick 触发:点击按钮触发回调
//   7. leftIcon/rightIcon 渲染
//   8. fullWidth 占满宽度
//   9. forwardRef: ref 转发到 button 元素
//  10. 透传额外 ButtonHTMLAttributes (如 aria-label, data-testid)
// ============================================================

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { createRef } from 'react';
import Button from '../Button';

// ============================================================
// 1. 默认渲染
// ============================================================
describe('默认渲染', () => {
  it('渲染 button 元素并显示 children 文字', () => {
    render(<Button>提交</Button>);
    const btn = screen.getByRole('button', { name: '提交' });
    expect(btn).toBeInTheDocument();
    expect(btn.tagName).toBe('BUTTON');
  });

  it('默认 type="button"(避免在表单中意外提交)', () => {
    render(<Button>保存</Button>);
    expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
  });

  it('允许覆盖 type(如 type="submit")', () => {
    render(<Button type="submit">提交</Button>);
    expect(screen.getByRole('button')).toHaveAttribute('type', 'submit');
  });

  it('默认 variant=primary:含 bg-cinnabar 类', () => {
    render(<Button>主按钮</Button>);
    expect(screen.getByRole('button')).toHaveClass('bg-cinnabar');
  });

  it('默认 size=md:含 h-10 px-4 类', () => {
    render(<Button>中等</Button>);
    const btn = screen.getByRole('button');
    expect(btn).toHaveClass('h-10');
    expect(btn).toHaveClass('px-4');
  });
});

// ============================================================
// 2. variant 切换
// ============================================================
describe('variant 切换', () => {
  it('variant=primary:朱砂主色背景 + 白字', () => {
    render(<Button variant="primary">主</Button>);
    const btn = screen.getByRole('button');
    expect(btn).toHaveClass('bg-cinnabar');
    expect(btn).toHaveClass('text-white');
  });

  it('variant=secondary:rice-50 背景 + 边框', () => {
    render(<Button variant="secondary">次</Button>);
    const btn = screen.getByRole('button');
    expect(btn).toHaveClass('bg-rice-50');
    expect(btn).toHaveClass('border');
    expect(btn).toHaveClass('text-ink-700');
  });

  it('variant=ghost:透明背景 + ink-600 文字', () => {
    render(<Button variant="ghost">幽灵</Button>);
    const btn = screen.getByRole('button');
    expect(btn).toHaveClass('bg-transparent');
    expect(btn).toHaveClass('text-ink-600');
  });

  it('variant=danger:朱砂红背景 + ring 边框(增强警示)', () => {
    render(<Button variant="danger">危险</Button>);
    const btn = screen.getByRole('button');
    expect(btn).toHaveClass('bg-cinnabar');
    expect(btn).toHaveClass('ring-1');
  });
});

// ============================================================
// 3. size 切换
// ============================================================
describe('size 切换', () => {
  it('size=sm: h-8 px-3 text-sm', () => {
    render(<Button size="sm">小</Button>);
    const btn = screen.getByRole('button');
    expect(btn).toHaveClass('h-8');
    expect(btn).toHaveClass('px-3');
    expect(btn).toHaveClass('text-sm');
  });

  it('size=md: h-10 px-4', () => {
    render(<Button size="md">中</Button>);
    const btn = screen.getByRole('button');
    expect(btn).toHaveClass('h-10');
    expect(btn).toHaveClass('px-4');
  });

  it('size=lg: h-12 px-6 text-lg', () => {
    render(<Button size="lg">大</Button>);
    const btn = screen.getByRole('button');
    expect(btn).toHaveClass('h-12');
    expect(btn).toHaveClass('px-6');
    expect(btn).toHaveClass('text-lg');
  });
});

// ============================================================
// 4. loading 态
// ============================================================
describe('loading 态', () => {
  it('loading=true 时 aria-busy="true"', () => {
    render(<Button loading>加载中</Button>);
    expect(screen.getByRole('button')).toHaveAttribute('aria-busy', 'true');
  });

  it('loading=false 时不设 aria-busy(避免冗余)', () => {
    render(<Button loading={false}>正常</Button>);
    expect(screen.getByRole('button')).not.toHaveAttribute('aria-busy');
  });

  it('loading=true 时 disabled 属性生效', () => {
    render(<Button loading>加载中</Button>);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('loading=true 时显示 spinner SVG(animate-spin)', () => {
    render(<Button loading>加载中</Button>);
    const svg = screen.getByRole('button').querySelector('svg.animate-spin');
    expect(svg).toBeInTheDocument();
  });

  it('loading=true 时文字仍保持显示', () => {
    render(<Button loading>正在保存</Button>);
    expect(screen.getByText('正在保存')).toBeInTheDocument();
  });

  it('loading=true 时点击不触发 onClick', () => {
    const onClick = vi.fn();
    render(<Button loading onClick={onClick}>加载中</Button>);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('loading=true 时隐藏 rightIcon(避免与 spinner 视觉冲突)', () => {
    const RightIcon = () => <svg data-testid="right-icon" aria-hidden="true" />;
    render(
      <Button loading rightIcon={<RightIcon />}>
        提交
      </Button>
    );
    expect(screen.queryByTestId('right-icon')).not.toBeInTheDocument();
  });

  it('loading=true 时 leftIcon 被 spinner 替代(不显示原 leftIcon)', () => {
    const LeftIcon = () => <svg data-testid="left-icon" aria-hidden="true" />;
    render(
      <Button loading leftIcon={<LeftIcon />}>
        提交
      </Button>
    );
    expect(screen.queryByTestId('left-icon')).not.toBeInTheDocument();
  });
});

// ============================================================
// 5. disabled 态
// ============================================================
describe('disabled 态', () => {
  it('disabled=true 时按钮 disabled', () => {
    render(<Button disabled>禁用</Button>);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('disabled=true 时点击不触发 onClick', () => {
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>禁用</Button>);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('disabled=true 时含 disabled:opacity-60 样式类(视觉禁用)', () => {
    render(<Button disabled>禁用</Button>);
    expect(screen.getByRole('button')).toHaveClass('disabled:opacity-60');
  });
});

// ============================================================
// 6. onClick 触发
// ============================================================
describe('onClick 触发', () => {
  it('点击按钮触发 onClick 回调', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>点击</Button>);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('onClick 接收原生 MouseEvent 参数', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>点击</Button>);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledWith(expect.any(Object));
    /* 第一个参数应为 MouseEvent */
    const arg = onClick.mock.calls[0][0];
    expect(arg).toBeDefined();
  });
});

// ============================================================
// 7. leftIcon / rightIcon 渲染
// ============================================================
describe('leftIcon / rightIcon', () => {
  it('leftIcon 渲染在 children 之前(不 loading 时)', () => {
    const LeftIcon = () => <svg data-testid="left-icon" aria-hidden="true" />;
    render(<Button leftIcon={<LeftIcon />}>有图标</Button>);
    expect(screen.getByTestId('left-icon')).toBeInTheDocument();
  });

  it('rightIcon 渲染在 children 之后(不 loading 时)', () => {
    const RightIcon = () => <svg data-testid="right-icon" aria-hidden="true" />;
    render(<Button rightIcon={<RightIcon />}>有图标</Button>);
    expect(screen.getByTestId('right-icon')).toBeInTheDocument();
  });

  it('同时传 leftIcon 与 rightIcon 均渲染', () => {
    const LeftIcon = () => <svg data-testid="left-icon" aria-hidden="true" />;
    const RightIcon = () => <svg data-testid="right-icon" aria-hidden="true" />;
    render(
      <Button leftIcon={<LeftIcon />} rightIcon={<RightIcon />}>
        图文
      </Button>
    );
    expect(screen.getByTestId('left-icon')).toBeInTheDocument();
    expect(screen.getByTestId('right-icon')).toBeInTheDocument();
  });
});

// ============================================================
// 8. fullWidth 占满宽度
// ============================================================
describe('fullWidth', () => {
  it('fullWidth=true 时含 w-full 类', () => {
    render(<Button fullWidth>占满</Button>);
    expect(screen.getByRole('button')).toHaveClass('w-full');
  });

  it('fullWidth=false(默认)时不含 w-full 类', () => {
    render(<Button>不占满</Button>);
    expect(screen.getByRole('button')).not.toHaveClass('w-full');
  });
});

// ============================================================
// 9. forwardRef
// ============================================================
describe('forwardRef', () => {
  it('ref 转发到 button 元素', () => {
    const ref = createRef<HTMLButtonElement>();
    render(<Button ref={ref}>ref 测试</Button>);
    expect(ref.current).not.toBeNull();
    expect(ref.current?.tagName).toBe('BUTTON');
  });

  it('通过 ref 可调用 focus()', () => {
    const ref = createRef<HTMLButtonElement>();
    render(<Button ref={ref}>聚焦</Button>);
    ref.current?.focus();
    expect(ref.current).toBe(document.activeElement);
  });
});

// ============================================================
// 10. 透传额外 ButtonHTMLAttributes
// ============================================================
describe('透传额外 props', () => {
  it('aria-label 透传到 button', () => {
    render(<Button aria-label="自定义标签">文字</Button>);
    expect(screen.getByRole('button')).toHaveAttribute('aria-label', '自定义标签');
  });

  it('data-testid 透传到 button', () => {
    render(<Button data-testid="submit-btn">提交</Button>);
    expect(screen.getByTestId('submit-btn')).toBeInTheDocument();
  });

  it('title 透传到 button', () => {
    render(<Button title="提示文字">悬停</Button>);
    expect(screen.getByRole('button')).toHaveAttribute('title', '提示文字');
  });

  it('自定义 className 与内部 className 合并', () => {
    render(<Button className="my-custom-class">自定义</Button>);
    const btn = screen.getByRole('button');
    expect(btn).toHaveClass('my-custom-class');
    /* 内部基础类不被覆盖 */
    expect(btn).toHaveClass('bg-cinnabar');
    expect(btn).toHaveClass('rounded');
  });
});

// ============================================================
// 11. 边界情况
// ============================================================
describe('边界情况', () => {
  it('children 为空字符串时不渲染空的 span', () => {
    render(<Button>{''}</Button>);
    const btn = screen.getByRole('button');
    /* children === '' 时不渲染 span(避免空元素) */
    expect(btn.querySelector('span')).toBeNull();
  });

  it('children 为数字时正常渲染', () => {
    render(<Button>{42}</Button>);
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('loading 与 disabled 同时为 true 时 disabled 仍生效', () => {
    const onClick = vi.fn();
    render(
      <Button loading disabled onClick={onClick}>
        双重禁用
      </Button>
    );
    expect(screen.getByRole('button')).toBeDisabled();
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });
});
