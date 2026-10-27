// ============================================================
// 前端 Vitest 全局 Setup
// 对应任务:Phase F3 前端测试基础设施
//
// 职责:
//   1. 引入 @testing-library/jest-dom 扩展 expect 匹配器
//      (toBeInTheDocument / toHaveTextContent / toBeVisible 等)
//   2. 自动 cleanup:每个测试后清理 React Testing Library 渲染残留
//   3. mock canvas API:jsdom 不支持 canvas 2D context,需手动 stub
//   4. mock matchMedia / URL.createObjectURL(常见 jsdom 缺失 API)
// ============================================================

import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// 每个测试后自动卸载组件
afterEach(() => {
  cleanup();
});

// ============================================================
// jsdom 缺失 API polyfill
// ============================================================

// matchMedia: jsdom 不实现,部分组件可能调用
if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
}

// URL.createObjectURL: jsdom 不实现,文件上传相关测试可能需要
if (!URL.createObjectURL) {
  URL.createObjectURL = vi.fn(() => 'blob:mock-url');
  URL.revokeObjectURL = vi.fn();
}

// ============================================================
// Canvas 2D Context stub
// jsdom 不支持 canvas 实际渲染,HeatmapCanvas 使用 getContext('2d')
// 这里提供最小可用 stub,使组件不抛错并能调用 canvas API
// ============================================================

class CanvasRenderingContext2DStub {
  canvas = { width: 320, height: 240 };
  fillStyle = '';
  strokeStyle = '';
  lineWidth = 1;
  font = '';
  textAlign = 'start';
  textBaseline = 'alphabetic';
  globalAlpha = 1;
  // 模拟路径状态
  private pathStarted = false;

  // 状态保存
  save() {}
  restore() {}
  // 路径
  beginPath() { this.pathStarted = true; }
  closePath() { this.pathStarted = false; }
  moveTo(_x: number, _y: number) {}
  lineTo(_x: number, _y: number) {}
  arc(_x: number, _y: number, _r: number, _start: number, _end: number) {}
  arcTo(_x1: number, _y1: number, _x2: number, _y2: number, _r: number) {}
  rect(_x: number, _y: number, _w: number, _h: number) {}
  roundRect(_x: number, _y: number, _w: number, _h: number, _r: number) {}
  // 填充/描边
  fill() {}
  stroke() {}
  fillRect(_x: number, _y: number, _w: number, _h: number) {}
  strokeRect(_x: number, _y: number, _w: number, _h: number) {}
  clearRect(_x: number, _y: number, _w: number, _h: number) {}
  // 文本
  fillText(_text: string, _x: number, _y: number) {}
  strokeText(_text: string, _x: number, _y: number) {}
  measureText(text: string) {
    return { width: text.length * 6, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 };
  }
  // 渐变
  createRadialGradient(_x1: number, _y1: number, _r1: number, _x2: number, _y2: number, _r2: number) {
    return { addColorStop: vi.fn() };
  }
  createLinearGradient(_x1: number, _y1: number, _x2: number, _y2: number) {
    return { addColorStop: vi.fn() };
  }
  // 路径检测
  isPointInPath(_x: number, _y: number) { return false; }
  // 线型
  setLineDash(_segments: number[]) {}
  getLineDash() { return []; }
  // 变换
  translate(_x: number, _y: number) {}
  rotate(_angle: number) {}
  scale(_x: number, _y: number) {}
  transform(_a: number, _b: number, _c: number, _d: number, _e: number, _f: number) {}
  setTransform(_a: number, _b: number, _c: number, _d: number, _e: number, _f: number) {}
  // 图像
  drawImage(_image: CanvasImageSource, _dx: number, _dy: number) {}
  getImageData(_x: number, _y: number, _w: number, _h: number) {
    return { data: new Uint8ClampedArray(4), width: 1, height: 1 };
  }
  putImageData(_data: ImageData, _x: number, _y: number) {}
  createImageData(w: number, h: number) {
    return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
  }
  // 裁剪
  clip() {}
  // 像素操作
  globalCompositeOperation = 'source-over';
  shadowBlur = 0;
  shadowColor = 'rgba(0,0,0,0)';
  shadowOffsetX = 0;
  shadowOffsetY = 0;
  miterLimit = 10;
  lineCap = 'butt';
  lineJoin = 'miter';
}

// 替换 HTMLCanvasElement.prototype.getContext
HTMLCanvasElement.prototype.getContext = function getContext(_type: string) {
  return new CanvasRenderingContext2DStub() as unknown as CanvasRenderingContext2D;
};

// requestAnimationFrame: jsdom 可能不实现,使用 setTimeout fallback
if (!globalThis.requestAnimationFrame) {
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    return setTimeout(() => cb(Date.now()), 16) as unknown as number;
  }) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = ((id: number) => {
    clearTimeout(id);
  }) as typeof cancelAnimationFrame;
}
