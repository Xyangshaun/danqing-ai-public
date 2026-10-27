// ============================================================
// CanvasPage 冒烟测试
// 目的:验证独立画板页在 jsdom 中能完整渲染(组件树无同步死循环),
//       排查浏览器自动化访问 #/canvas 超时是否为页面卡死。
// 注:jsdom 的 canvas.getContext 返回 null,引擎内均有 if (!ctx) return 保护。
// ============================================================

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import CanvasPage from '../CanvasPage';
import { ToastProvider } from '../../components/ToastProvider';

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/canvas']}>
      <ToastProvider>
        <CanvasPage />
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe('CanvasPage 冒烟测试', () => {
  it('页面完整渲染:标题 / 画布 / 工具栏 / 图层面板', () => {
    const { container } = renderPage();

    // 标题
    expect(screen.getByText('完整画板')).toBeTruthy();

    // 画布元素存在且内部分辨率正确
    const canvas = container.querySelector('canvas');
    expect(canvas).toBeTruthy();
    expect(canvas?.width).toBe(1280);
    expect(canvas?.height).toBe(800);

    // 图层面板:默认「背景层」
    expect(screen.getByText('背景层')).toBeTruthy();
  });

  it('切换笔刷与橡皮不崩溃', () => {
    renderPage();
    // 工具栏应包含笔刷类按钮,逐个点击验证渲染稳定
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThan(5);
    for (const btn of buttons.slice(0, 8)) {
      fireEvent.click(btn);
    }
    // 点击后页面仍存活
    expect(screen.getByText('完整画板')).toBeTruthy();
  });

  it('画布鼠标绘制一笔:stroke 计数与撤销状态更新', () => {
    const { container } = renderPage();
    const canvas = container.querySelector('canvas')!;

    // 模拟绘制一笔(jsdom getContext 为 null,引擎静默跳过绘制,但状态流应正常)
    fireEvent.mouseDown(canvas, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.mouseMove(canvas, { clientX: 150, clientY: 150 });
    fireEvent.mouseMove(canvas, { clientX: 200, clientY: 200 });
    fireEvent.mouseUp(canvas);

    // 笔画计入统计(页头「共 N 笔」)
    expect(screen.getByText(/共 1 笔/)).toBeTruthy();
  });
});
