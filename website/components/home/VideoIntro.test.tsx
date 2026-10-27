// ============================================================
// VideoIntro 开场动画单元测试
// 验证:1) 4.5s 后自动回调 onComplete
//       2) doneRef 防止重复触发(仅回调一次)
//       3) 渲染包含状态条、笔触 SVG、品牌名、副标题、步骤、数据指标
//       4) ?slow=N 调试参数放慢退出计时
//       5) ?pause=1 调试参数暂停自动完成
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';

// 在导入组件前 mock framer-motion 的 useReducedMotion
const reducedMotionMock = vi.fn<() => boolean>(() => false);
vi.mock('framer-motion', () => ({
  useReducedMotion: () => reducedMotionMock(),
}));

import React from 'react';
import { VideoIntro } from './VideoIntro';

describe('VideoIntro 开场动画 (v7 CSS-first)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    reducedMotionMock.mockReturnValue(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllTimers();
  });

  it('4.5s 后自动回调 onComplete', () => {
    const onComplete = vi.fn();
    render(<VideoIntro onComplete={onComplete} />);

    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(onComplete).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('doneRef 防止重复触发:多次推进定时器仅回调一次', () => {
    const onComplete = vi.fn();
    render(<VideoIntro onComplete={onComplete} />);

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(onComplete).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('渲染包含品牌名与副标题', () => {
    const onComplete = vi.fn();
    const { container } = render(<VideoIntro onComplete={onComplete} />);

    expect(container.textContent).toContain('丹青有AI');
    expect(container.textContent).toContain('AI 助你看见作品的每一笔墨');
  });

  it('渲染包含笔触 SVG', () => {
    const onComplete = vi.fn();
    const { container } = render(<VideoIntro onComplete={onComplete} />);

    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    const path = container.querySelector('svg path');
    expect(path).not.toBeNull();
    expect(path?.getAttribute('d') || '').toMatch(/^M\s/);
  });

  it('渲染包含顶部状态条:运行中 v1.0 + live demo', () => {
    const onComplete = vi.fn();
    const { container } = render(<VideoIntro onComplete={onComplete} />);

    expect(container.textContent).toContain('运行中');
    expect(container.textContent).toContain('v1.0');
    expect(container.textContent).toContain('live demo');
  });

  it('渲染包含 4 步骤编号:01·upload·上传 等', () => {
    const onComplete = vi.fn();
    const { container } = render(<VideoIntro onComplete={onComplete} />);

    expect(container.textContent).toContain('01');
    expect(container.textContent).toContain('upload');
    expect(container.textContent).toContain('上传');
    expect(container.textContent).toContain('analyze');
    expect(container.textContent).toContain('诊断');
    expect(container.textContent).toContain('feedback');
    expect(container.textContent).toContain('建议');
    expect(container.textContent).toContain('archive');
    expect(container.textContent).toContain('沉淀');
  });

  it('渲染包含 4 数据指标:4 创意形式·12 评估维度·3s 诊断响应·128+ 风格预设', () => {
    const onComplete = vi.fn();
    const { container } = render(<VideoIntro onComplete={onComplete} />);

    expect(container.textContent).toContain('4');
    expect(container.textContent).toContain('创意形式');
    expect(container.textContent).toContain('12');
    expect(container.textContent).toContain('评估维度');
    expect(container.textContent).toContain('3s');
    expect(container.textContent).toContain('诊断响应');
    expect(container.textContent).toContain('128+');
    expect(container.textContent).toContain('风格预设');
  });

  it('?slow=2 调试参数将定时器时长放慢 2 倍(9.0s 才完成)', () => {
    const originalLocation = window.location;
    delete (window as { location?: unknown }).location;
    (window as { location: unknown }).location = {
      ...originalLocation,
      search: '?slow=2',
    } as Location;

    const onComplete = vi.fn();
    render(<VideoIntro onComplete={onComplete} />);

    act(() => {
      vi.advanceTimersByTime(8000);
    });
    expect(onComplete).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onComplete).toHaveBeenCalledTimes(1);

    (window as { location?: unknown }).location = originalLocation;
  });

  it('?pause=1 调试参数暂停自动完成', () => {
    const originalLocation = window.location;
    delete (window as { location?: unknown }).location;
    (window as { location: unknown }).location = {
      ...originalLocation,
      search: '?pause=1',
    } as Location;

    const onComplete = vi.fn();
    render(<VideoIntro onComplete={onComplete} />);

    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(onComplete).not.toHaveBeenCalled();

    (window as { location?: unknown }).location = originalLocation;
  });

  it('减弱动态偏好时添加 intro-reduced class', () => {
    reducedMotionMock.mockReturnValue(true);
    const onComplete = vi.fn();
    const { container } = render(<VideoIntro onComplete={onComplete} />);

    const overlay = container.querySelector('.intro-overlay');
    expect(overlay?.classList.contains('intro-reduced')).toBe(true);
  });
});
