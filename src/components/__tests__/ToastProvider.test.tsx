// ============================================================
// ToastProvider 组件单元测试
// 对应源码: src/components/ToastProvider.tsx
//
// 测试范围:
//   1. info/success/error/warning 基本 toast 行为
//   2. showProgress 进度更新(同 id 复用)+ 进度条 aria 属性
//   3. dismissProgress 主动关闭
//   4. done/error 状态自动消失(fake timers)
//   5. dismiss 手动关闭 + 关闭按钮 aria-label
//   6. 自动消失定时器(duration)
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider, useToast } from '../ToastProvider';

/* 测试用消费者:暴露 toast API 供测试调用 */
function ToastConsumer() {
  const toast = useToast();
  return (
    <div>
      <button onClick={() => toast.success('成功标题', '成功描述')}>success</button>
      <button onClick={() => toast.error('错误标题', '错误描述')}>error</button>
      <button onClick={() => toast.warning('警告标题')}>warning</button>
      <button onClick={() => toast.info('信息标题')}>info</button>
      <button onClick={() => toast.showProgress('p1', { title: '上传中', total: 100, current: 30 })}>
        progress-start
      </button>
      <button
        onClick={() => toast.showProgress('p1', { title: '上传中', total: 100, current: 60 })}
      >
        progress-update
      </button>
      <button
        onClick={() =>
          toast.showProgress('p1', { title: '完成', total: 100, current: 100, status: 'done' })
        }
      >
        progress-done
      </button>
      <button
        onClick={() =>
          toast.showProgress('p1', { title: '失败', total: 100, current: 40, status: 'error' })
        }
      >
        progress-error
      </button>
      <button onClick={() => toast.dismissProgress('p1')}>progress-dismiss</button>
    </div>
  );
}

function renderToast() {
  return render(
    <ToastProvider>
      <ToastConsumer />
    </ToastProvider>,
  );
}

/** 同步点击按钮(配合 act,兼容真实/fake 定时器) */
function clickByName(name: string) {
  act(() => {
    screen.getByRole('button', { name }).click();
  });
}

describe('ToastProvider 基本 toast', () => {
  it('success 显示标题与描述,role=status', () => {
    renderToast();
    clickByName('success');
    expect(screen.getByText('成功标题')).toBeInTheDocument();
    expect(screen.getByText('成功描述')).toBeInTheDocument();
    expect(screen.getByText('成功标题').closest('[role]')).toHaveAttribute('role', 'status');
  });

  it('error 用 role=alert + aria-live=assertive(强提示)', () => {
    renderToast();
    clickByName('error');
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('错误标题');
    expect(alert).toHaveAttribute('aria-live', 'assertive');
  });

  it('warning/info 显示标题', () => {
    renderToast();
    clickByName('warning');
    expect(screen.getByText('警告标题')).toBeInTheDocument();
    clickByName('info');
    expect(screen.getByText('信息标题')).toBeInTheDocument();
  });

  it('关闭按钮有 aria-label(无障碍)', () => {
    renderToast();
    clickByName('info');
    expect(screen.getByLabelText('关闭通知')).toBeInTheDocument();
  });

  it('点击关闭按钮移除 toast', async () => {
    const user = userEvent.setup();
    renderToast();
    clickByName('info');
    expect(screen.getByText('信息标题')).toBeInTheDocument();
    await user.click(screen.getByLabelText('关闭通知'));
    expect(screen.queryByText('信息标题')).not.toBeInTheDocument();
  });
});

describe('ToastProvider 进度型 toast', () => {
  it('showProgress 显示进度文本与进度条(aria-valuenow/valuemax)', () => {
    renderToast();
    clickByName('progress-start');
    expect(screen.getByText('上传中')).toBeInTheDocument();
    expect(screen.getByText(/30 \/ 100/)).toBeInTheDocument();
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '30');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
    expect(bar).toHaveAttribute('aria-label', '上传中 进度');
  });

  it('同 id 复用同一条 toast(不重复创建),更新进度值', () => {
    renderToast();
    clickByName('progress-start');
    clickByName('progress-update');
    const bars = screen.getAllByRole('progressbar');
    expect(bars).toHaveLength(1);
    expect(bars[0]).toHaveAttribute('aria-valuenow', '60');
  });

  it('dismissProgress 主动关闭进度 toast', () => {
    renderToast();
    clickByName('progress-start');
    expect(screen.getByText('上传中')).toBeInTheDocument();
    clickByName('progress-dismiss');
    expect(screen.queryByText('上传中')).not.toBeInTheDocument();
  });

  it('running 状态 aria-busy=true', () => {
    renderToast();
    clickByName('progress-start');
    // 进度条三层父级为 role=status 卡片(含 aria-busy)
    const card = screen.getByRole('progressbar').closest('[aria-busy]');
    expect(card).toHaveAttribute('aria-busy', 'true');
  });
});

describe('ToastProvider 进度自动消失(fake timers)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('done 状态 1.5s 后自动消失', () => {
    renderToast();
    clickByName('progress-start');
    clickByName('progress-done');
    expect(screen.getByText('完成')).toBeInTheDocument();
    // done 强制 100%
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(screen.queryByText('完成')).not.toBeInTheDocument();
  });

  it('error 状态 3s 后自动消失', () => {
    renderToast();
    clickByName('progress-start');
    clickByName('progress-error');
    expect(screen.getByText('失败')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.queryByText('失败')).not.toBeInTheDocument();
  });

  it('running 状态不自动消失(等待后续更新)', () => {
    renderToast();
    clickByName('progress-start');
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(screen.getByText('上传中')).toBeInTheDocument();
  });
});

describe('ToastProvider 自动消失定时器', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('success 默认 2s 后自动消失', () => {
    renderToast();
    clickByName('success');
    expect(screen.getByText('成功标题')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.queryByText('成功标题')).not.toBeInTheDocument();
  });

  it('error 默认 4s 后自动消失', () => {
    renderToast();
    clickByName('error');
    act(() => {
      vi.advanceTimersByTime(3999);
    });
    expect(screen.getByText('错误标题')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText('错误标题')).not.toBeInTheDocument();
  });
});
