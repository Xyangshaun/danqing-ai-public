// ============================================================
// Vitest 全局设置
// - 引入 jest-dom 匹配器(如 toBeInTheDocument)
// - CSS 与 next/image 的 stub 处理
// ============================================================

import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// 抑制 jsdom 中关于未被支持的 CSS 属性警告
const originalConsoleError = console.error;
console.error = (...args: unknown[]) => {
  const msg = String(args[0] ?? '');
  if (msg.includes('not implemented') || msg.includes('Error: Could not parse CSS')) {
    return;
  }
  originalConsoleError(...args);
};

// framer-motion 在 jsdom 中依赖的 matchMedia:jsdom 未实现,补一个 stub
if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

// HTMLMediaElement 的 play/pause 在 jsdom 为 stub,避免 autoPlay 报错
Object.defineProperty(HTMLMediaElement.prototype, 'play', {
  writable: true,
  value: vi.fn().mockResolvedValue(undefined),
});
Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
  writable: true,
  value: vi.fn(),
});