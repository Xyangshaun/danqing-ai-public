// ============================================================
// ErrorBoundary 组件单元测试
// 对应源码: src/components/ErrorBoundary.tsx
//
// 测试范围:
//   1. 正常子组件渲染(不触发降级 UI)
//   2. 子组件抛错时显示错误 UI + 变体识别(网络/图片/默认)
//   3. 重试按钮调用 onRetry 并 reset
//   4. 复制错误信息按钮(mock navigator.clipboard)
//   5. 开发/生产环境差异(import.meta.env.DEV)
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../ToastProvider';
import ErrorBoundary from '../ErrorBoundary';

/* 抛错的子组件 */
function Bomb({ message = '测试爆炸' }: { message?: string }) {
  throw new Error(message);
}

/* 正常子组件 */
function OkChild() {
  return <div data-testid="ok-child">正常内容</div>;
}

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <MemoryRouter>
      <ToastProvider>{ui}</ToastProvider>
    </MemoryRouter>,
  );
}

/* 捕获 console.error(ErrorBoundary/componentDidCatch 会打日志) */
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  consoleErrorSpy.mockRestore();
});

describe('ErrorBoundary 正常渲染', () => {
  it('子组件正常时不显示降级 UI', () => {
    renderWithProviders(
      <ErrorBoundary>
        <OkChild />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId('ok-child')).toBeInTheDocument();
    expect(screen.queryByText('页面出现了问题')).not.toBeInTheDocument();
  });
});

describe('ErrorBoundary 错误捕获', () => {
  it('子组件抛错时显示默认错误 UI', () => {
    renderWithProviders(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );
    expect(screen.queryByTestId('ok-child')).not.toBeInTheDocument();
    expect(screen.getByText('页面出现了问题')).toBeInTheDocument();
  });

  it('网络错误关键词(fetch/network)显示网络变体标题', () => {
    renderWithProviders(
      <ErrorBoundary>
        <Bomb message="fetch failed network error" />
      </ErrorBoundary>,
    );
    expect(screen.getByText('网络连接出现问题')).toBeInTheDocument();
  });

  it('图片错误关键词(img/image/load)显示图片变体标题', () => {
    renderWithProviders(
      <ErrorBoundary>
        <Bomb message="image load failed" />
      </ErrorBoundary>,
    );
    expect(screen.getByText('图片加载出现问题')).toBeInTheDocument();
  });

  it('使用自定义 fallback 时渲染 fallback', () => {
    renderWithProviders(
      <ErrorBoundary fallback={(error) => <div data-testid="custom">自定义:{error.message}</div>}>
        <Bomb message="自定义错误" />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId('custom')).toHaveTextContent('自定义:自定义错误');
  });
});

describe('ErrorBoundary 重试', () => {
  it('重试按钮调用 onRetry 回调', () => {
    const onRetry = vi.fn();
    renderWithProviders(
      <ErrorBoundary onRetry={onRetry}>
        <Bomb />
      </ErrorBoundary>,
    );
    fireEvent.click(screen.getByLabelText('重试加载'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('重试按钮调用后 reset error state(允许子组件重新渲染)', () => {
    let shouldThrow = true;
    function Conditional() {
      if (shouldThrow) throw new Error('条件爆炸');
      return <div data-testid="recovered">已恢复</div>;
    }
    renderWithProviders(
      <ErrorBoundary>
        <Conditional />
      </ErrorBoundary>,
    );
    expect(screen.getByText('页面出现了问题')).toBeInTheDocument();
    // 修复条件后重试
    shouldThrow = false;
    fireEvent.click(screen.getByLabelText('重试加载'));
    expect(screen.getByTestId('recovered')).toBeInTheDocument();
  });

  it('onRetry 自身抛错不阻塞 reset', () => {
    const onRetry = vi.fn(() => {
      throw new Error('onRetry 内部错误');
    });
    renderWithProviders(
      <ErrorBoundary onRetry={onRetry}>
        <Bomb />
      </ErrorBoundary>,
    );
    // 仍能点击重试(onRetry 抛错被捕获,reset 仍执行)
    expect(() => fireEvent.click(screen.getByLabelText('重试加载'))).not.toThrow();
    expect(onRetry).toHaveBeenCalled();
  });
});

describe('ErrorBoundary 复制错误信息', () => {
  beforeEach(() => {
    // mock clipboard API
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  it('点击"复制错误信息"调用 navigator.clipboard.writeText', async () => {
    renderWithProviders(
      <ErrorBoundary>
        <Bomb message="待复制的错误" />
      </ErrorBoundary>,
    );
    const btn = screen.getByLabelText('复制错误信息');
    fireEvent.click(btn);
    // 等待异步 clipboard 完成
    await vi.waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalled();
    });
    const payload = (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload).toContain('待复制的错误');
    expect(payload).toContain('Error: Error');
  });

  it('复制成功后按钮文案切换为"已复制"', async () => {
    renderWithProviders(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );
    fireEvent.click(screen.getByLabelText('复制错误信息'));
    await vi.waitFor(() => {
      expect(screen.getByText('已复制')).toBeInTheDocument();
    });
  });
});

describe('ErrorBoundary 开发/生产环境差异', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('开发环境(isDev=true)显示真实 error.message + 开发者详情', () => {
    // vitest 默认 import.meta.env.DEV = true
    renderWithProviders(
      <ErrorBoundary>
        <Bomb message="真实错误堆栈" />
      </ErrorBoundary>,
    );
    // 开发态显示 error.message 而非 desc 友好文案
    expect(screen.getByText('真实错误堆栈')).toBeInTheDocument();
    // 显示开发者信息 details
    expect(screen.getByText('开发者信息')).toBeInTheDocument();
  });

  it('生产环境(isDev=false)显示友好文案,不显示开发者详情', () => {
    vi.stubEnv('DEV', false);
    renderWithProviders(
      <ErrorBoundary>
        <Bomb message="真实错误堆栈" />
      </ErrorBoundary>,
    );
    // 生产态显示 desc 友好文案
    expect(
      screen.getByText('这个模块暂时无法正常显示,可以尝试重新加载,或返回首页继续操作。'),
    ).toBeInTheDocument();
    // 不显示开发者信息 details
    expect(screen.queryByText('开发者信息')).not.toBeInTheDocument();
  });
});
