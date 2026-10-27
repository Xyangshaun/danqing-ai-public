// ============================================================
// Sidebar 组件单元测试
// 对应源码: src/components/Sidebar.tsx
//
// 测试范围:
//   1. 3 组导航渲染(创作工具/我的-数据洞察/系统)
//   2. active 高亮(当前路由)
//   3. 点击导航跳转(Link to)
//   4. hover 预加载触发(usePrefetch 已 mock)
//   5. 折叠/展开切换 + 折叠按钮 onToggle
//   6. 新建诊断快捷按钮
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Sidebar from '../Sidebar';

/* mock usePrefetch:记录每次调用,返回可控 handler */
const prefetchMock = vi.fn();
const onMouseEnter = vi.fn();
const onFocus = vi.fn();
const onTouchStart = vi.fn();

vi.mock('../../hooks/usePrefetch', () => ({
  usePrefetch: (path: string) => {
    prefetchMock(path);
    return { onMouseEnter, onFocus, onTouchStart };
  },
}));

/* mock useAuth:未登录态(user=null),不渲染管理后台/教师工作台分组 */
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ user: null }),
}));

function renderSidebar({
  collapsed = false,
  initialPath = '/',
}: { collapsed?: boolean; initialPath?: string } = {}) {
  const onToggle = vi.fn();
  const utils = render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Sidebar collapsed={collapsed} onToggle={onToggle} />
    </MemoryRouter>,
  );
  return { ...utils, onToggle };
}

beforeEach(() => {
  prefetchMock.mockClear();
  onMouseEnter.mockClear();
  onFocus.mockClear();
  onTouchStart.mockClear();
});

describe('Sidebar 导航渲染', () => {
  it('渲染 3 组导航标题(创作工具/我的-数据洞察/系统)', () => {
    renderSidebar();
    expect(screen.getByText('创作工具')).toBeInTheDocument();
    expect(screen.getByText('我的-数据洞察')).toBeInTheDocument();
    expect(screen.getByText('系统')).toBeInTheDocument();
  });

  it('渲染全部导航项标签(AI 诊断/AI 生成/素材库/风格库/灵感嫁接/情绪画布/历史记录/成长曲线/设置)', () => {
    renderSidebar();
    expect(screen.getByText('AI 诊断')).toBeInTheDocument();
    expect(screen.getByText('AI 生成')).toBeInTheDocument();
    expect(screen.getByText('素材库')).toBeInTheDocument();
    expect(screen.getByText('风格库')).toBeInTheDocument();
    expect(screen.getByText('灵感嫁接')).toBeInTheDocument();
    expect(screen.getByText('情绪画布')).toBeInTheDocument();
    expect(screen.getByText('历史记录')).toBeInTheDocument();
    expect(screen.getByText('成长曲线')).toBeInTheDocument();
    expect(screen.getByText('设置')).toBeInTheDocument();
  });

  it('渲染新建诊断快捷按钮', () => {
    renderSidebar();
    expect(screen.getByText('新建诊断')).toBeInTheDocument();
  });
});

describe('Sidebar active 高亮', () => {
  it('当前路由 /analyze 时 AI 诊断项高亮', () => {
    renderSidebar({ initialPath: '/analyze' });
    const link = screen.getByText('AI 诊断').closest('a');
    expect(link).toHaveClass('bg-cinnabar/10');
  });

  it('当前路由 /history 时历史记录项高亮(非高亮项用 ink-900 背景)', () => {
    renderSidebar({ initialPath: '/history' });
    const link = screen.getByText('历史记录').closest('a');
    expect(link).toHaveClass('bg-ink-900');
  });

  it('当前路由 /settings 时设置项高亮', () => {
    renderSidebar({ initialPath: '/settings' });
    const link = screen.getByText('设置').closest('a');
    expect(link).toHaveClass('bg-ink-900');
  });

  it('当前路由 /generation 时 AI 生成项高亮(M4-T7 接线)', () => {
    renderSidebar({ initialPath: '/generation' });
    const link = screen.getByText('AI 生成').closest('a');
    expect(link).toHaveClass('bg-ink-900');
  });
});

describe('Sidebar 导航跳转', () => {
  it('导航项为 Link,指向对应路由(href 含路径)', () => {
    renderSidebar();
    const analyzeLink = screen.getByText('AI 诊断').closest('a');
    expect(analyzeLink).toHaveAttribute('href', '/analyze');
    const historyLink = screen.getByText('历史记录').closest('a');
    expect(historyLink).toHaveAttribute('href', '/history');
    // M4-T7 接线:AI 生成入口指向 /generation
    const generationLink = screen.getByText('AI 生成').closest('a');
    expect(generationLink).toHaveAttribute('href', '/generation');
  });
});

describe('Sidebar hover 预加载', () => {
  it('usePrefetch 为每个导航项调用一次(传入对应路径)', () => {
    renderSidebar();
    // 至少调用了 /analyze /materials /history /settings 等路径
    expect(prefetchMock).toHaveBeenCalledWith('/analyze');
    expect(prefetchMock).toHaveBeenCalledWith('/materials');
    expect(prefetchMock).toHaveBeenCalledWith('/history');
    expect(prefetchMock).toHaveBeenCalledWith('/settings');
  });

  it('鼠标悬停导航项触发 prefetch.onMouseEnter', () => {
    renderSidebar();
    const link = screen.getByText('素材库').closest('a') as HTMLElement;
    fireEvent.mouseEnter(link);
    expect(onMouseEnter).toHaveBeenCalledTimes(1);
  });

  it('聚焦导航项触发 prefetch.onFocus', () => {
    renderSidebar();
    const link = screen.getByText('风格库').closest('a') as HTMLElement;
    fireEvent.focus(link);
    expect(onFocus).toHaveBeenCalledTimes(1);
  });
});

describe('Sidebar 折叠/展开', () => {
  it('collapsed=true 时不显示导航组标题与标签(仅图标)', () => {
    renderSidebar({ collapsed: true });
    // 折叠时组标题隐藏
    expect(screen.queryByText('创作工具')).not.toBeInTheDocument();
    expect(screen.queryByText('我的-数据洞察')).not.toBeInTheDocument();
  });

  it('折叠按钮点击调用 onToggle', () => {
    const { onToggle } = renderSidebar();
    const toggleBtn = screen.getByTitle('折叠侧栏');
    fireEvent.click(toggleBtn);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('折叠态点击展开按钮(title=展开侧栏)调用 onToggle', () => {
    const { onToggle } = renderSidebar({ collapsed: true });
    const toggleBtn = screen.getByTitle('展开侧栏');
    fireEvent.click(toggleBtn);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
