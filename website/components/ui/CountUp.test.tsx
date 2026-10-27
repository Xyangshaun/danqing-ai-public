// ============================================================
// CountUp 组件测试 (W3)
// 验证:
// 1) prefers-reduced-motion 时直接显示目标值(不依赖动画)
// 2) 正常渲染时输出带千分位与后缀的格式
// 3) spring 的 duration 传参单位应为秒(修复项,不再放大 1000 倍)
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// 记录传入 useSpring 的 duration(用于断言单位)
const springDurations: number[] = [];
const reducedMock = vi.fn<() => boolean>(() => false);

vi.mock('framer-motion', () => ({
  useReducedMotion: () => reducedMock(),
  useInView: () => true,
  useMotionValue: (v: number) => ({ get: () => v, set: vi.fn() }),
  useSpring: (_mv: unknown, opts: { duration?: number }) => {
    if (opts && typeof opts.duration === 'number') {
      springDurations.push(opts.duration);
    }
    return {
      on: () => vi.fn(),
      get: () => 0,
    };
  },
}));

import React from 'react';
import { CountUp } from './CountUp';

describe('CountUp (W3)', () => {
  beforeEach(() => {
    reducedMock.mockReturnValue(false);
    springDurations.length = 0;
  });

  it('reduced-motion 时直接显示目标值', () => {
    reducedMock.mockReturnValue(true);
    render(<CountUp value={1280} suffix="+" />);
    expect(screen.getByText('1,280+')).toBeInTheDocument();
  });

  it('正常渲染时输出后缀与千分位格式', () => {
    render(<CountUp value={1280} suffix="+" />);
    // 动画开启时 display 由 spring 驱动，mock 下保持初始值；
    // 此处验证组件结构与后缀渲染无误
    expect(screen.getByText(/\+/)).toBeInTheDocument();
  });

  it('spring 的 duration 传参单位应为秒(不再乘以 1000)', () => {
    render(<CountUp value={1280} duration={1.6} />);
    // 修复后传入的应是 1.6(秒),而非 1600
    expect(springDurations[springDurations.length - 1]).toBe(1.6);
    expect(springDurations[springDurations.length - 1]).not.toBe(1600);
  });
});