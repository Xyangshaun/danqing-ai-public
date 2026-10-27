// ============================================================
// imageCompress 工具单元测试(M4-T6)
// 对应源码: src/utils/imageCompress.ts
//
// 测试范围:
//   1. 大图等比缩放(最长边 ≤ 1280,不放大)+ JPEG 0.85 输出
//   2. 小图原尺寸输出(scale ≤ 1 不放大)
//   3. 竖图以高度为最长边缩放
//   4. 自定义 maxEdge/quality 参数透传
//   5. 透明铺白底(fillStyle #ffffff 且先于 drawImage)
//   6. FileReader 读取失败 / Image 解码失败 reject
//
// Mock 策略(对齐 AnalysisPage.test.tsx 既有惯例):
//   - FileReader/Image: vi.stubGlobal 替换,setTimeout(0) 异步触发回调
//   - canvas: getContext/toDataURL spyOn 原型,记录调用参数
//   - 真实计时器(压缩链路两级 setTimeout(0),无需 fake timers)
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { compressImage } from '../imageCompress';

/* ---------- Mock FileReader:读即成功,异步触发 onload ---------- */
let mockReaderFail = false;

class MockFileReader {
  onload: ((e: { target: { result: string | ArrayBuffer | null } }) => void) | null = null;
  onerror: (() => void) | null = null;
  result: string | ArrayBuffer | null = null;
  readAsDataURL(_file: File): void {
    if (mockReaderFail) {
      setTimeout(() => this.onerror?.(), 0);
      return;
    }
    this.result = 'data:image/png;base64,MOCK';
    setTimeout(() => this.onload?.({ target: { result: this.result } }), 0);
  }
}

/* ---------- Mock Image:预设解码尺寸,src 赋值后异步触发回调 ---------- */
let mockImageMeta: { width: number; height: number; fail: boolean };

class MockImage {
  onload: ((e: Event) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  naturalWidth = 0;
  naturalHeight = 0;
  width = 0;
  height = 0;
  private _src = '';
  get src(): string {
    return this._src;
  }
  set src(value: string) {
    this._src = value;
    setTimeout(() => {
      if (mockImageMeta.fail) {
        this.onerror?.(new Event('error'));
        return;
      }
      this.naturalWidth = mockImageMeta.width;
      this.naturalHeight = mockImageMeta.height;
      this.onload?.(new Event('load'));
    }, 0);
  }
}

/* ---------- canvas mock:记录 drawImage/fillRect/toDataURL 参数 ---------- */
const drawImageMock = vi.fn();
const fillRectMock = vi.fn();
const toDataURLMock = vi.fn();
const fakeCtx = {
  fillStyle: '',
  fillRect: fillRectMock,
  drawImage: drawImageMock,
} as unknown as CanvasRenderingContext2D;

/** 构造 mock 图片文件 */
function makeImageFile(name = 'style-ref.png', type = 'image/png'): File {
  return new File(['mock-image-data'], name, { type });
}

beforeEach(() => {
  mockReaderFail = false;
  mockImageMeta = { width: 2560, height: 1920, fail: false };
  drawImageMock.mockReset();
  fillRectMock.mockReset();
  toDataURLMock.mockReset();
  toDataURLMock.mockReturnValue('data:image/jpeg;base64,COMPRESSED');
  vi.stubGlobal('FileReader', MockFileReader);
  vi.stubGlobal('Image', MockImage);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fakeCtx);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation((type?: string, quality?: number) =>
    toDataURLMock(type, quality),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/* ============================================================
 * 压缩规则(真源 §八:1280 / JPEG 0.85 / 透明铺白底 / 不放大)
 * ============================================================ */
describe('compressImage 压缩规则', () => {
  it('大图等比缩放至最长边 1280,输出 JPEG quality 0.85', async () => {
    const result = await compressImage(makeImageFile());

    // 返回压缩产物 dataURL
    expect(result).toBe('data:image/jpeg;base64,COMPRESSED');
    // 2560x1920 → 1280x960(等比缩放)
    expect(fillRectMock).toHaveBeenCalledWith(0, 0, 1280, 960);
    expect(drawImageMock).toHaveBeenCalledWith(expect.any(MockImage), 0, 0, 1280, 960);
    // 输出 JPEG quality 0.85
    expect(toDataURLMock).toHaveBeenCalledWith('image/jpeg', 0.85);
  });

  it('小图不放大,按原尺寸输出', async () => {
    mockImageMeta = { width: 800, height: 600, fail: false };
    await compressImage(makeImageFile());

    expect(drawImageMock).toHaveBeenCalledWith(expect.any(MockImage), 0, 0, 800, 600);
    expect(fillRectMock).toHaveBeenCalledWith(0, 0, 800, 600);
  });

  it('竖图以高度为最长边缩放', async () => {
    mockImageMeta = { width: 900, height: 3200, fail: false };
    await compressImage(makeImageFile());

    // 900x3200 → 360x1280(scale = 1280/3200 = 0.4)
    expect(drawImageMock).toHaveBeenCalledWith(expect.any(MockImage), 0, 0, 360, 1280);
  });

  it('自定义参数:maxEdge 640 / quality 0.7 生效', async () => {
    mockImageMeta = { width: 1280, height: 960, fail: false };
    await compressImage(makeImageFile(), { maxEdge: 640, quality: 0.7 });

    expect(drawImageMock).toHaveBeenCalledWith(expect.any(MockImage), 0, 0, 640, 480);
    expect(toDataURLMock).toHaveBeenCalledWith('image/jpeg', 0.7);
  });

  it('透明背景先铺白底再 drawImage', async () => {
    await compressImage(makeImageFile('transparent.png', 'image/png'));

    // PNG 透明 → JPEG 无 alpha,必须先铺 #ffffff 白底
    expect(fakeCtx.fillStyle).toBe('#ffffff');
    expect(fillRectMock.mock.invocationCallOrder[0]).toBeLessThan(
      drawImageMock.mock.invocationCallOrder[0],
    );
  });
});

/* ============================================================
 * 失败路径(reject,不静默返回)
 * ============================================================ */
describe('compressImage 失败路径', () => {
  it('FileReader 读取失败时 reject', async () => {
    mockReaderFail = true;
    await expect(compressImage(makeImageFile())).rejects.toThrow('无法读取该图片文件');
  });

  it('图片解码失败时 reject', async () => {
    mockImageMeta = { width: 0, height: 0, fail: true };
    await expect(compressImage(makeImageFile())).rejects.toThrow('图片加载失败，无法压缩');
  });
});
