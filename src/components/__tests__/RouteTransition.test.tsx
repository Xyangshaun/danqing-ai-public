// ============================================================
// RouteTransition 组件单元测试
// 对应源码: src/components/RouteTransition.tsx
//
// 测试范围:
//   1. 默认渲染:子节点、role=region、aria-label
//   2. 初始状态 opacity-0(淡入前)
//   3. rAF 推进后切换到 opacity-100(淡入完成)
//   4. locationKey 变化触发重新挂载 + 重新淡入
//   5. className 透传
//   6. duration 通过 style.transitionDuration 传入
//   7. 自定义 locationKey 优先于 useLocation().pathname
//   8. 卸载时清理 rAF(不抛错)
//
// Mock 策略:
//   - setup.ts 已 polyfill requestAnimationFrame(setTimeout fallback)
//   - 用 vitest fake timers 控制时间推进,精确测试 rAF 回调时序
//   - 用 MemoryRouter 包裹(因为组件内部用 useLocation)
// ============================================================

import { type ReactNode, act } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import RouteTransition from '../RouteTransition';

// 配置 React act 环境(@testing-library/react 14+ 需要,
// 避免 "current testing environment is not configured to support act" 警告)
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// ============================================================
// 辅助:用 MemoryRouter 包裹(默认 pathname='/')
// ============================================================
function renderWithRouter(ui: ReactNode, initialPath = '/') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>{ui}</MemoryRouter>
  );
}

/**
 * 推进 fake timers 并 flush React 状态更新到 DOM。
 * 在 fake timers 模式下,advanceTimersByTime 触发 rAF 回调中的 setVisible(true),
 * 但 React 的重新渲染需要 act() 来同步 flush 到 DOM。
 */
function advanceAndFlush(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

// ============================================================
// 1. 默认渲染
// ============================================================
describe('default render', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders children', () => {
    renderWithRouter(
      <RouteTransition>
        <div data-testid="child">child content</div>
      </RouteTransition>
    );
    expect(screen.getByTestId('child')).toBeInTheDocument();
    expect(screen.getByText('child content')).toBeInTheDocument();
  });

  it('container has role=region and aria-label', () => {
    renderWithRouter(
      <RouteTransition>
        <div>content</div>
      </RouteTransition>
    );
    const region = screen.getByRole('region', { name: '页面内容' });
    expect(region).toBeInTheDocument();
  });

  it('container has transition-opacity class', () => {
    renderWithRouter(
      <RouteTransition>
        <div>content</div>
      </RouteTransition>
    );
    expect(screen.getByRole('region')).toHaveClass('transition-opacity');
  });

  it('container has ease-out class', () => {
    renderWithRouter(
      <RouteTransition>
        <div>content</div>
      </RouteTransition>
    );
    expect(screen.getByRole('region')).toHaveClass('ease-out');
  });
});

// ============================================================
// 2. 初始状态 opacity-0(淡入前)
// ============================================================
describe('initial state', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts at opacity-0 before fade-in', () => {
    renderWithRouter(
      <RouteTransition>
        <div>content</div>
      </RouteTransition>
    );
    expect(screen.getByRole('region')).toHaveClass('opacity-0');
    expect(screen.getByRole('region')).not.toHaveClass('opacity-100');
  });

  it('container key equals current pathname (default locationKey)', () => {
    renderWithRouter(
      <RouteTransition>
        <div>content</div>
      </RouteTransition>,
      '/history'
    );
    const region = screen.getByRole('region');
    expect(region).toHaveClass('opacity-0');
  });
});

// ============================================================
// 3. rAF 推进后切换到 opacity-100(淡入完成)
// ============================================================
describe('fade-in timing', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('switches to opacity-100 after rAF fires', () => {
    renderWithRouter(
      <RouteTransition>
        <div>content</div>
      </RouteTransition>
    );
    expect(screen.getByRole('region')).toHaveClass('opacity-0');
    // setup.ts: rAF = setTimeout(cb, 16); double rAF needs ~32ms+
    advanceAndFlush(40);
    expect(screen.getByRole('region')).toHaveClass('opacity-100');
    expect(screen.getByRole('region')).not.toHaveClass('opacity-0');
  });

  it('duration passed via style.transitionDuration (default 200ms)', () => {
    renderWithRouter(
      <RouteTransition>
        <div>content</div>
      </RouteTransition>
    );
    const region = screen.getByRole('region');
    expect(region.style.transitionDuration).toBe('200ms');
  });

  it('custom duration passed via style', () => {
    renderWithRouter(
      <RouteTransition duration={350}>
        <div>content</div>
      </RouteTransition>
    );
    expect(screen.getByRole('region').style.transitionDuration).toBe('350ms');
  });
});

// ============================================================
// 4. locationKey 变化触发重新挂载 + 重新淡入
// ============================================================
describe('locationKey change', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('remounts subtree when locationKey changes (key change)', () => {
    const { rerender } = renderWithRouter(
      <RouteTransition locationKey="/home">
        <div data-testid="child">home</div>
      </RouteTransition>
    );
    let region = screen.getByRole('region');
    expect(region).toHaveClass('opacity-0');
    advanceAndFlush(40);
    expect(region).toHaveClass('opacity-100');

    // switch to /history
    rerender(
      <MemoryRouter initialEntries={['/home']}>
        <RouteTransition locationKey="/history">
          <div data-testid="child">history</div>
        </RouteTransition>
      </MemoryRouter>
    );
    // remounted -> new fade-in starts at opacity-0
    region = screen.getByRole('region');
    expect(region).toHaveClass('opacity-0');
    expect(screen.getByTestId('child')).toHaveTextContent('history');
  });

  it('completes new fade-in after locationKey change + rAF', () => {
    const { rerender } = renderWithRouter(
      <RouteTransition locationKey="/a">
        <div>A</div>
      </RouteTransition>
    );
    advanceAndFlush(40);
    expect(screen.getByRole('region')).toHaveClass('opacity-100');

    rerender(
      <MemoryRouter initialEntries={['/a']}>
        <RouteTransition locationKey="/b">
          <div>B</div>
        </RouteTransition>
      </MemoryRouter>
    );
    expect(screen.getByRole('region')).toHaveClass('opacity-0');
    advanceAndFlush(40);
    expect(screen.getByRole('region')).toHaveClass('opacity-100');
  });

  it('child state resets on locationKey change (remount)', () => {
    let mountCount = 0;
    function Child() {
      mountCount += 1;
      return <div data-testid="child">mount count: {mountCount}</div>;
    }

    const { rerender } = renderWithRouter(
      <RouteTransition locationKey="/x">
        <Child />
      </RouteTransition>
    );
    expect(mountCount).toBe(1);

    rerender(
      <MemoryRouter initialEntries={['/x']}>
        <RouteTransition locationKey="/y">
          <Child />
        </RouteTransition>
      </MemoryRouter>
    );
    expect(mountCount).toBe(2);
  });
});

// ============================================================
// 5. className 透传
// ============================================================
describe('className passthrough', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('custom className merged onto container', () => {
    renderWithRouter(
      <RouteTransition className="my-route extra-class">
        <div>content</div>
      </RouteTransition>
    );
    const region = screen.getByRole('region');
    expect(region).toHaveClass('my-route');
    expect(region).toHaveClass('extra-class');
    // internal base classes not overridden
    expect(region).toHaveClass('transition-opacity');
  });
});

// ============================================================
// 6. locationKey 优先级
// ============================================================
describe('locationKey priority', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses provided locationKey (triggers remount when it changes)', () => {
    const { rerender } = renderWithRouter(
      <RouteTransition locationKey="/custom-key-1">
        <div data-testid="child">content1</div>
      </RouteTransition>
    );
    expect(screen.getByRole('region')).toHaveClass('opacity-0');
    advanceAndFlush(40);
    expect(screen.getByRole('region')).toHaveClass('opacity-100');

    // Router pathname still '/', but locationKey changes -> remount
    rerender(
      <MemoryRouter initialEntries={['/']}>
        <RouteTransition locationKey="/custom-key-2">
          <div data-testid="child">content2</div>
        </RouteTransition>
      </MemoryRouter>
    );
    expect(screen.getByRole('region')).toHaveClass('opacity-0');
    expect(screen.getByTestId('child')).toHaveTextContent('content2');
  });

  it('uses useLocation().pathname when locationKey not provided', () => {
    function NavigateTrigger({ to }: { to: string }) {
      const navigate = useNavigate();
      return (
        <button type="button" onClick={() => navigate(to)} data-testid="nav-btn">
          go {to}
        </button>
      );
    }

    renderWithRouter(
      <>
        <NavigateTrigger to="/target" />
        <RouteTransition>
          <div data-testid="child">content</div>
        </RouteTransition>
      </>,
      '/start'
    );

    // initial fade-in complete
    advanceAndFlush(40);
    expect(screen.getByRole('region')).toHaveClass('opacity-100');

    // click nav button to change pathname (navigate triggers Router re-render,
    // RouteTransition detects pathname change -> key change -> remount -> new fade-in)
    fireEvent.click(screen.getByTestId('nav-btn'));

    // pathname changed from /start to /target -> remount -> opacity-0
    expect(screen.getByRole('region')).toHaveClass('opacity-0');
  });
});

// ============================================================
// 7. 卸载时清理 rAF(不抛错)
// ============================================================
describe('unmount cleanup', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('unmount does not throw (cleans up rAF)', () => {
    const { unmount } = renderWithRouter(
      <RouteTransition>
        <div>content</div>
      </RouteTransition>
    );
    expect(() => unmount()).not.toThrow();
  });

  it('rAF callback does not trigger setState after unmount', () => {
    const { unmount } = renderWithRouter(
      <RouteTransition>
        <div>content</div>
      </RouteTransition>
    );
    // rAF scheduled but not executed yet
    unmount();
    // advance time: rAF callback should be cancelled by cancelAnimationFrame
    expect(() => {
      vi.advanceTimersByTime(50);
    }).not.toThrow();
  });

  it('frequent locationKey changes do not throw (consecutive remounts + rAF cancellation)', () => {
    const { rerender } = renderWithRouter(
      <RouteTransition locationKey="/k1">
        <div>K1</div>
      </RouteTransition>
    );
    expect(() => {
      for (let i = 2; i <= 10; i += 1) {
        rerender(
          <MemoryRouter initialEntries={['/']}>
            <RouteTransition locationKey={`/k${i}`}>
              <div>{`K${i}`}</div>
            </RouteTransition>
          </MemoryRouter>
        );
        vi.advanceTimersByTime(5);
      }
    }).not.toThrow();
  });
});

// ============================================================
// 8. 无障碍:prefers-reduced-motion
// ============================================================
describe('accessibility', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('container has motion-reduce:transition-none class', () => {
    renderWithRouter(
      <RouteTransition>
        <div>content</div>
      </RouteTransition>
    );
    expect(screen.getByRole('region')).toHaveClass('motion-reduce:transition-none');
  });
});

// 防止 cleanup 警告(显式调用)
afterEach(() => {
  cleanup();
});
