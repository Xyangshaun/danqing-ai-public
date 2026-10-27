// ============================================================
// Jimp Mock(内存实现,避免测试发起真实 HTTP 请求)
// 对应源码:src/services/analysis-engine.service.ts
//
// 设计要点:
//   1. Jimp.read(source) 在生产中会通过 HTTP 下载 URL 或读取本地文件
//   2. 测试环境无网络,且测试用例使用 https://example.com/*.jpg 占位 URL
//   3. 本 mock 返回一个 100x100 的伪 Jimp 实例,bitmap 数据为混合像素
//   4. 支持resize()(链式调用,返回 this),供 analyzePixels 使用
//
// 像素构造:
//   - 4 个象限使用不同颜色,确保分析维度(色彩/亮度/边缘)有差异化输出
//   - 避免全黑/全白导致 fallback 路径触发
// ============================================================

import { vi } from 'vitest';

/**
 * 构造 100x100 混合像素 Buffer(RGBA,4 字节/像素)
 * 4 象限:红 / 绿 / 蓝 / 黄,确保色彩/边缘/亮度统计有数据
 */
function createFakeBitmap(width = 100, height = 100): {
  width: number;
  height: number;
  data: Buffer;
} {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      // 4 象限:左上红 / 右上绿 / 左下蓝 / 右下黄
      if (x < width / 2 && y < height / 2) {
        data[idx] = 220;     // R
        data[idx + 1] = 50;  // G
        data[idx + 2] = 50;  // B
      } else if (x >= width / 2 && y < height / 2) {
        data[idx] = 50;
        data[idx + 1] = 220;
        data[idx + 2] = 50;
      } else if (x < width / 2 && y >= height / 2) {
        data[idx] = 50;
        data[idx + 1] = 50;
        data[idx + 2] = 220;
      } else {
        data[idx] = 220;
        data[idx + 1] = 220;
        data[idx + 2] = 50;
      }
      data[idx + 3] = 255; // A
    }
  }
  return { width, height, data };
}

/**
 * 伪 Jimp 实例(支持 resize 链式调用)
 */
interface FakeJimp {
  bitmap: { width: number; height: number; data: Buffer };
  resize(w: number, h: number): FakeJimp;
}

function createFakeJimp(width = 100, height = 100): FakeJimp {
  const bitmap = createFakeBitmap(width, height);
  const instance: FakeJimp = {
    bitmap,
    resize(w: number, h: number): FakeJimp {
      // 简化:直接更新 bitmap 尺寸,不实际重采样(分析逻辑只关心像素统计)
      instance.bitmap = createFakeBitmap(w, h);
      return instance;
    },
  };
  return instance;
}

/**
 * 创建匹配 src/services/analysis-engine.service.ts 导入的 Jimp 模块
 * 默认导出对象,包含静态 read 方法
 */
export function createJimpModule(): {
  default: { read: (source: string) => Promise<FakeJimp> };
  read: (source: string) => Promise<FakeJimp>;
} {
  const readFn = async (_source: string): Promise<FakeJimp> => {
    // 忽略 source(URL 或文件路径),统一返回伪图像
    return createFakeJimp(100, 100);
  };
  return {
    default: { read: readFn },
    read: readFn,
  };
}

/**
 * 注册 Jimp mock(必须在 setup.ts 中调用,在任何 analysis-engine import 之前)
 */
export function registerJimpMock(): void {
  vi.mock('jimp', () => createJimpModule());
}
