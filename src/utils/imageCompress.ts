// ============================================================
// Canvas 图片压缩工具(M4-T6 风格迁移生图)
// ------------------------------------------------------------
// 用途:风格参考图本地上传后、提交前压缩为可控体积的 JPEG dataURL,
// 与后端防线(Zod 6M 字符上限 / 路由级 8mb body limit)配合,避免 413。
//
// 规则(真源 m4-style-transfer-plan-2026-09-22.md §八):
//   - 最长边 ≤ maxEdge(默认 1280),等比缩放,小图不放大
//   - 输出 JPEG(quality 默认 0.85)
//   - PNG/WebP 透明背景先铺白底再 drawImage
//     (JPEG 无 alpha 通道,不铺底透明区域会渲染为黑色)
//
// 流程:File → FileReader(dataURL) → Image 解码 → canvas 缩放铺底
// → toDataURL('image/jpeg', quality)。任一步失败均 reject。
// ============================================================

/** 压缩默认参数:最长边上限(像素) */
const DEFAULT_MAX_EDGE = 1280;

/** 压缩默认参数:JPEG 输出质量(0-1) */
const DEFAULT_QUALITY = 0.85;

/** 压缩选项 */
export interface CompressImageOptions {
  /** 目标最长边(像素),默认 1280 */
  maxEdge?: number;
  /** JPEG 输出质量(0-1),默认 0.85 */
  quality?: number;
}

/**
 * FileReader 读文件为 dataURL(Promise 化)
 * @throws 读取失败时 reject(onerror)
 */
function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(new Error('无法读取该图片文件'));
    reader.readAsDataURL(file);
  });
}

/**
 * 以 dataURL 加载图片元素
 * @param src 图片地址(dataURL)
 * @throws 解码失败时 reject(onerror)
 */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片加载失败，无法压缩'));
    img.src = src;
  });
}

/**
 * 压缩图片文件:等比缩放至最长边 ≤ maxEdge,铺白底后输出 JPEG dataURL
 *
 * @param file 原图文件(FileReader.readAsDataURL 可读的 image/* 文件)
 * @param options 可选:{ maxEdge = 1280, quality = 0.85 }
 * @returns 压缩后的 JPEG dataURL
 * @throws 文件读取失败 / 图片解码失败 / 尺寸无效 / 环境不支持 Canvas 时 reject
 */
export async function compressImage(
  file: File,
  options?: CompressImageOptions,
): Promise<string> {
  const maxEdge = options?.maxEdge ?? DEFAULT_MAX_EDGE;
  const quality = options?.quality ?? DEFAULT_QUALITY;

  const dataUrl = await readFileAsDataURL(file);
  const img = await loadImage(dataUrl);
  const width = img.naturalWidth || img.width;
  const height = img.naturalHeight || img.height;
  if (!width || !height) {
    throw new Error('图片尺寸无效，无法压缩');
  }

  // 等比缩放:最长边映射至 maxEdge;scale ≤ 1 保证小图不放大
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('当前环境不支持 Canvas，无法压缩');
  }

  // 透明背景先铺白底(PNG/WebP alpha → 白),JPEG 导出无透明通道
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, targetWidth, targetHeight);
  ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

  return canvas.toDataURL('image/jpeg', quality);
}
