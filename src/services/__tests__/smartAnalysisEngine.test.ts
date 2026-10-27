// ============================================================
// smartAnalysisEngine 单元测试 (Phase F3-11)
// 对应源码: src/services/smartAnalysisEngine.ts
//
// 测试范围:
//   1. decideAnalysisMode: 复杂度评估与模式决策
//      - server 不可用 → client 模式
//      - simple 复杂度 → client 模式
//      - normal 复杂度 + painting/design → client 模式
//      - normal 复杂度 + product/sculpture → server 模式
//      - complex 复杂度 → server 模式
//      - 大文件 (>8MB) 强制 server 模式
//   2. artType 权重:painting(1.0) < design(1.2) < product(1.3) < sculpture(1.4)
//   3. estimatedTime:不同模式/复杂度的预估耗时
//   4. getComplexityLabel: simple/normal/complex → 简单/中等/复杂
//   5. getComplexityColor: 三档颜色映射
//   6. checkServerHealth: 健康检查(成功/失败/超时)
//
// Mock 策略:
//   - setup.ts 已 polyfill fetch / Image / AbortController 等 jsdom 缺失 API
//   - 不 mock smartAnalysisEngine 内部,测试真实决策逻辑
//   - 通过 mock fetch 测试 checkServerHealth
//   - 通过构造 File / imageUrl 控制复杂度评估输入
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  decideAnalysisMode,
  getComplexityLabel,
  getComplexityColor,
  checkServerHealth,
} from '../smartAnalysisEngine';
import type { ArtType } from '../../types';

// ============================================================
// 辅助构造器
// ============================================================

/**
 * 构造 File 对象
 * - sizeBytes: 文件大小(字节)
 * - name: 文件名
 */
function createFile(sizeBytes: number, name = 'test.jpg'): File {
  // jsdom 的 File 构造器接受 BlobPart[],由于我们不实际读取内容,空数组即可
  // 但 size 属性需通过 Blob.size 反映,因此构造一个对应大小的 Blob
  const buf = new Uint8Array(sizeBytes);
  return new File([buf], name, { type: 'image/jpeg' });
}

/**
 * 构造 data URL 形式的 imageUrl (避免 jsdom Image 加载真实资源)
 * jsdom 中 new Image() 的 width/height 默认为 0,因此 assessComplexity 中
 * pixelCount = 0,需要通过其他因素(fileSize)驱动复杂度
 */
function createImageUrl(): string {
  return 'data:image/jpeg;base64, mock';
}

/**
 * Mock 全局 Image 构造器,使其返回指定 width/height
 * jsdom 默认 Image.width=0,导致 pixelCount=0 无法触发 complex 分支
 * 使用后必须调用 restoreImageMock() 恢复
 *
 * 使用模块级变量保存原始 Image,避免在函数上挂载属性(触发 no-explicit-any)。
 */
let originalImageRef: typeof globalThis.Image | undefined;

function mockImageDimensions(width: number, height: number): void {
  originalImageRef = globalThis.Image;
  vi.stubGlobal('Image', class MockImage {
    width = width;
    height = height;
    src = '';
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    addEventListener() {}
    removeEventListener() {}
  });
}

function restoreImageMock(): void {
  if (originalImageRef) {
    vi.stubGlobal('Image', originalImageRef);
    originalImageRef = undefined;
  } else {
    vi.unstubAllGlobals();
  }
}

// ============================================================
// 1. decideAnalysisMode - server 不可用分支
// ============================================================

describe('decideAnalysisMode - server 不可用', () => {
  it('server 不可用时强制 client 模式', () => {
    const file = createFile(1024 * 1024); // 1MB
    const result = decideAnalysisMode(file, createImageUrl(), 'painting', false);
    expect(result.mode).toBe('client');
    expect(result.reason).toContain('后端服务不可用');
  });

  it('server 不可用 + 大文件 (6MB) → client 模式, estimatedTime=3', () => {
    // 6MB → min(30,36)=30; >5 加 10; mp=0; colors=16→1.33; elements=3→1 → score≈42
    // painting weight=1.0 → weightedScore≈42 ≤ 60 → estimatedTime=3
    const file = createFile(6 * 1024 * 1024);
    const result = decideAnalysisMode(file, createImageUrl(), 'painting', false);
    expect(result.mode).toBe('client');
    expect(result.estimatedTime).toBe(3);
  });
});

// ============================================================
// 2. decideAnalysisMode - 复杂度分支
// ============================================================

describe('decideAnalysisMode - 复杂度评估', () => {
  /**
   * jsdom 中 Image.width=Image.height=0 → pixelCount=0
   * 因此复杂度完全由 fileSize 决定:
   *   - complexityScore = min(30, fileSizeMB*6) + 0 (mp=0) + min(20, 16/12=1.33)=1.33 + min(15, 3/3=1)=1 = ~30+
   *   - fileSize ≤ 5MB: 无额外 +10
   *   - pixelCount ≤ 4M: 无额外 +10
   *
   * 简单 (score<40): fileSizeMB*6 + 1.33 + 1 < 40 → fileSizeMB*6 < 37.67 → fileSizeMB < 6.28
   *   - 任何 fileSize ≤ 5MB → 简单 (score < 40)
   *   - fileSize > 5MB 加 10 → score=min(30, f*6)+10+1.33+1
   *     - f=5.01: 30+10+1.33+1=42.33 → normal
   *     - f=10: 30+10+1.33+1=42.33 → normal (因为 min(30,f*6)=30)
   *   - 要达到 complex (>=75) 需 fileSizeMB*6 + 加成 ≥ 75 → 不可能 (max 30+10+1.33+1=42.33)
   *   - pixelCount > 4M 触发 +10,但 jsdom 中 pixelCount=0
   * 结论:在 jsdom 环境下无法通过文件大小达到 complex 级别
   */

  it('小文件 (1MB) → simple 复杂度 → client 模式', () => {
    const file = createFile(1 * 1024 * 1024);
    const result = decideAnalysisMode(file, createImageUrl(), 'painting', true);
    expect(result.complexity.level).toBe('simple');
    expect(result.mode).toBe('client');
    expect(result.reason).toContain('复杂度较低');
    expect(result.estimatedTime).toBe(2);
  });

  it('空文件 (0MB) → simple 复杂度', () => {
    const file = createFile(0);
    const result = decideAnalysisMode(file, createImageUrl(), 'painting', true);
    expect(result.complexity.level).toBe('simple');
    expect(result.mode).toBe('client');
  });

  it('fileSize=5MB 仍是 simple 复杂度 (score<40)', () => {
    const file = createFile(5 * 1024 * 1024);
    const result = decideAnalysisMode(file, createImageUrl(), 'painting', true);
    // 5MB → min(30, 5*6)=30; 5MB 不 > 5 → 无 +10; 总分=30+0+1.33+1=32.33 < 40 → simple
    expect(result.complexity.level).toBe('simple');
  });

  it('fileSize=5.01MB 触发 >5 加成 → normal 复杂度', () => {
    const file = createFile(5.01 * 1024 * 1024);
    const result = decideAnalysisMode(file, createImageUrl(), 'painting', true);
    // 5.01MB → min(30, 5.01*6)=30.06→30; >5 → +10; 总分=30+10+0+1.33+1=42.33 → normal (40<=x<75)
    expect(result.complexity.level).toBe('normal');
  });

  it('normal 复杂度 + painting → client 模式', () => {
    const file = createFile(5.01 * 1024 * 1024);
    const result = decideAnalysisMode(file, createImageUrl(), 'painting', true);
    expect(result.complexity.level).toBe('normal');
    expect(result.mode).toBe('client');
    expect(result.reason).toContain('绘画');
    expect(result.estimatedTime).toBe(3);
  });

  it('normal 复杂度 + design → client 模式', () => {
    const file = createFile(5.01 * 1024 * 1024);
    const result = decideAnalysisMode(file, createImageUrl(), 'design', true);
    expect(result.complexity.level).toBe('normal');
    expect(result.mode).toBe('client');
    expect(result.reason).toContain('设计');
    expect(result.estimatedTime).toBe(3);
  });

  it('normal 复杂度 + product → server 模式', () => {
    const file = createFile(5.01 * 1024 * 1024);
    const result = decideAnalysisMode(file, createImageUrl(), 'product', true);
    expect(result.complexity.level).toBe('normal');
    expect(result.mode).toBe('server');
    expect(result.reason).toContain('产品');
    expect(result.estimatedTime).toBe(4);
  });

  it('normal 复杂度 + sculpture → server 模式', () => {
    const file = createFile(5.01 * 1024 * 1024);
    const result = decideAnalysisMode(file, createImageUrl(), 'sculpture', true);
    expect(result.complexity.level).toBe('normal');
    expect(result.mode).toBe('server');
    expect(result.reason).toContain('雕塑');
    expect(result.estimatedTime).toBe(4);
  });

  it('mock Image 高分辨率 → complex 复杂度 + server 可用 → server 模式, estimatedTime=5', () => {
    // mock Image 返回 4000x2000 → pixelCount=8M → +10; mp=8 → +25; colors=256 → +20; elements=50 → +15
    // 1MB → +6; 总分=76 → complex (≥75) → server 模式, estimatedTime=5
    mockImageDimensions(4000, 2000);
    try {
      const file = createFile(1 * 1024 * 1024);
      const result = decideAnalysisMode(file, createImageUrl(), 'painting', true);
      expect(result.complexity.level).toBe('complex');
      expect(result.complexity.score).toBe(76);
      expect(result.mode).toBe('server');
      expect(result.reason).toContain('复杂度');
      expect(result.estimatedTime).toBe(5);
      expect(result.complexity.factors.pixelCount).toBe(8_000_000);
    } finally {
      restoreImageMock();
    }
  });

  it('pixelCount > 4000000 分支覆盖: mock Image 3000x2000 → +10 bonus', () => {
    // 3000x2000=6M pixels → >4M → +10 bonus
    // 1MB → +6; mp=6 → +25; colors=min(256,1200)=256 → +20; elements=min(50,300)=50 → +15
    // 总分=6+25+20+15+10=76 → complex
    mockImageDimensions(3000, 2000);
    try {
      const file = createFile(1 * 1024 * 1024);
      const result = decideAnalysisMode(file, createImageUrl(), 'painting', true);
      expect(result.complexity.factors.pixelCount).toBe(6_000_000);
      expect(result.complexity.level).toBe('complex');
    } finally {
      restoreImageMock();
    }
  });
});

// ============================================================
// 3. decideAnalysisMode - 大文件强制 server
// ============================================================

describe('decideAnalysisMode - 大文件强制 server', () => {
  it('文件 > 8MB 且原决策为 client → 强制 server', () => {
    // 8.5MB → fileSizeMB=8.5 → min(30, 8.5*6)=30; >5 → +10; 总分=42.33 → normal
    // + painting → client 模式
    // 但 file.size > 8*1024*1024 → 强制 server
    const file = createFile(8.5 * 1024 * 1024);
    const result = decideAnalysisMode(file, createImageUrl(), 'painting', true);
    expect(result.mode).toBe('server');
    expect(result.reason).toContain('文件较大');
    expect(result.estimatedTime).toBe(5);
  });

  it('文件 = 8MB 边界不强制 server (严格大于)', () => {
    // 8MB → fileSizeMB=8 → >5 触发 +10 → normal; 但 8MB 不 > 8MB → 不强制 server
    // painting + normal → client
    const file = createFile(8 * 1024 * 1024);
    const result = decideAnalysisMode(file, createImageUrl(), 'painting', true);
    expect(result.mode).toBe('client');
  });

  it('文件 > 8MB 且原决策已是 server (sculpture) → 仍 server, reason 保留原决策文本', () => {
    // 源码逻辑: `if (file.size > 8MB && mode === 'client')` 才覆盖 reason
    // sculpture+normal → mode 已是 server → 不进入 >8MB 覆盖分支 → reason 保留 "雕塑" 文本
    const file = createFile(9 * 1024 * 1024);
    const result = decideAnalysisMode(file, createImageUrl(), 'sculpture', true);
    expect(result.mode).toBe('server');
    expect(result.reason).toContain('雕塑');
  });

  it('文件 > 8MB 且 server 不可用 → >8MB 覆盖分支将 client 翻回 server', () => {
    // 源码顺序: server 不可用 → mode=client; 之后 >8MB 检查 mode==='client' → 覆盖为 server
    // 即 >8MB 强制 server 优先级高于 server 不可用 (实际为源码设计,虽不理想但符合当前实现)
    const file = createFile(9 * 1024 * 1024);
    const result = decideAnalysisMode(file, createImageUrl(), 'painting', false);
    expect(result.mode).toBe('server');
    expect(result.reason).toContain('文件较大');
  });
});

// ============================================================
// 4. artType 权重
// ============================================================

describe('artType 权重', () => {
  /**
   * weightedScore = complexity.score * artTypeWeight[artType]
   * 权重: painting=1.0, design=1.2, product=1.3, sculpture=1.4
   * 影响:
   *   - server 不可用时 estimatedTime: weightedScore > 60 → 5, 否则 3
   *   - normal 复杂度时影响模式选择 (但实际由 artType 直接决定,非 weightedScore)
   */

  it('painting 权重 1.0 (最低)', () => {
    const file = createFile(1 * 1024 * 1024);
    const result = decideAnalysisMode(file, createImageUrl(), 'painting', false);
    // painting weight=1.0, complexity.score≈32 → weightedScore=32 → estimatedTime=3
    expect(result.estimatedTime).toBe(3);
  });

  it('sculpture 权重 1.4 (最高)', () => {
    const file = createFile(1 * 1024 * 1024);
    const result = decideAnalysisMode(file, createImageUrl(), 'sculpture', false);
    // sculpture weight=1.4, complexity.score≈32 → weightedScore=44.8 → 仍 ≤60 → estimatedTime=3
    expect(result.estimatedTime).toBe(3);
  });

  it('server 不可用 + sculpture + 大文件 (6MB) → client, estimatedTime=3', () => {
    // 6MB → score≈42; sculpture weight=1.4 → weightedScore≈59 ≤ 60 → estimatedTime=3
    const file = createFile(6 * 1024 * 1024);
    const result = decideAnalysisMode(file, createImageUrl(), 'sculpture', false);
    expect(result.mode).toBe('client');
    expect(result.estimatedTime).toBe(3);
  });

  it('mock Image 高分辨率 → complex 复杂度 + server 不可用 → estimatedTime=5', () => {
    // mock Image 返回 4000x2000 → pixelCount=8M → +10; mp=8 → +25; colors=256 → +20; elements=50 → +15
    // 1MB → +6; 总分=6+25+20+15+10=76 → complex (≥75)
    // server 不可用 → client 模式; weightedScore=76*1.0=76 > 60 → estimatedTime=5
    mockImageDimensions(4000, 2000);
    try {
      const file = createFile(1 * 1024 * 1024); // 1MB
      const result = decideAnalysisMode(file, createImageUrl(), 'painting', false);
      expect(result.complexity.level).toBe('complex');
      expect(result.mode).toBe('client');
      expect(result.estimatedTime).toBe(5);
      expect(result.complexity.factors.pixelCount).toBe(8_000_000);
    } finally {
      restoreImageMock();
    }
  });
});

// ============================================================
// 5. 返回结构完整性
// ============================================================

describe('返回结构完整性', () => {
  it('返回 AnalysisDecision 完整结构', () => {
    const file = createFile(1 * 1024 * 1024);
    const result = decideAnalysisMode(file, createImageUrl(), 'painting', true);
    expect(result).toHaveProperty('mode');
    expect(result).toHaveProperty('reason');
    expect(result).toHaveProperty('estimatedTime');
    expect(result).toHaveProperty('complexity');
    expect(['client', 'server']).toContain(result.mode);
    expect(typeof result.reason).toBe('string');
    expect(result.reason.length).toBeGreaterThan(0);
    expect(typeof result.estimatedTime).toBe('number');
    expect(result.estimatedTime).toBeGreaterThan(0);
  });

  it('complexity 包含 level/score/factors', () => {
    const file = createFile(2 * 1024 * 1024);
    const result = decideAnalysisMode(file, createImageUrl(), 'painting', true);
    const c = result.complexity;
    expect(['simple', 'normal', 'complex']).toContain(c.level);
    expect(typeof c.score).toBe('number');
    expect(c).toHaveProperty('factors');
    expect(c.factors).toHaveProperty('fileSizeMB');
    expect(c.factors).toHaveProperty('pixelCount');
    expect(c.factors).toHaveProperty('estimatedColors');
    expect(c.factors).toHaveProperty('estimatedElements');
  });

  it('complexity.score 为整数 (Math.round)', () => {
    const file = createFile(1.5 * 1024 * 1024);
    const result = decideAnalysisMode(file, createImageUrl(), 'painting', true);
    expect(Number.isInteger(result.complexity.score)).toBe(true);
  });

  it('complexity.factors.fileSizeMB 保留两位小数', () => {
    const file = createFile(1.567 * 1024 * 1024);
    const result = decideAnalysisMode(file, createImageUrl(), 'painting', true);
    const mb = result.complexity.factors.fileSizeMB;
    // 1.567 → round(1.567*100)/100 = 1.57
    expect(mb).toBe(1.57);
  });
});

// ============================================================
// 6. getComplexityLabel
// ============================================================

describe('getComplexityLabel', () => {
  it('simple → 简单', () => {
    expect(getComplexityLabel('simple')).toBe('简单');
  });

  it('normal → 中等', () => {
    expect(getComplexityLabel('normal')).toBe('中等');
  });

  it('complex → 复杂', () => {
    expect(getComplexityLabel('complex')).toBe('复杂');
  });

  it('未知 level 返回原值 (fallback)', () => {
    // @ts-expect-error 测试未知 level 的容错
    expect(getComplexityLabel('unknown')).toBe('unknown');
  });
});

// ============================================================
// 7. getComplexityColor
// ============================================================

describe('getComplexityColor', () => {
  it('simple → text-jade', () => {
    expect(getComplexityColor('simple')).toBe('text-jade');
  });

  it('normal → text-gold', () => {
    expect(getComplexityColor('normal')).toBe('text-gold');
  });

  it('complex → text-cinnabar', () => {
    expect(getComplexityColor('complex')).toBe('text-cinnabar');
  });

  it('未知 level → text-ink-500 (fallback)', () => {
    // @ts-expect-error 测试未知 level 的容错
    expect(getComplexityColor('unknown')).toBe('text-ink-500');
  });
});

// ============================================================
// 8. checkServerHealth
// ============================================================

describe('checkServerHealth', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('健康响应 (code=0, status=up) → 返回 true', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ code: 0, message: 'ok', data: { status: 'up' } }),
    });
    const result = await checkServerHealth();
    expect(result).toBe(true);
  });

  it('HTTP 非 2xx → 返回 false', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ code: 500, message: 'error' }),
    });
    const result = await checkServerHealth();
    expect(result).toBe(false);
  });

  it('code != 0 → 返回 false', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ code: 1, message: 'error', data: { status: 'up' } }),
    });
    const result = await checkServerHealth();
    expect(result).toBe(false);
  });

  it('status != up → 返回 false', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ code: 0, message: 'ok', data: { status: 'down' } }),
    });
    const result = await checkServerHealth();
    expect(result).toBe(false);
  });

  it('fetch 抛错 (网络中断) → 返回 false', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('network error'));
    const result = await checkServerHealth();
    expect(result).toBe(false);
  });

  it('请求被 abort (超时) → 返回 false', async () => {
    const abortErr = new Error('The operation was aborted');
    abortErr.name = 'AbortError';
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(abortErr);
    const result = await checkServerHealth();
    expect(result).toBe(false);
  });

  it('调用 fetch 时使用 GET 方法和 AbortSignal', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ code: 0, data: { status: 'up' } }),
    });
    await checkServerHealth();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const args = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(args[0]).toContain('/health');
    expect(args[1].method).toBe('GET');
    expect(args[1].signal).toBeInstanceOf(AbortSignal);
  });
});

// ============================================================
// 9. 综合场景
// ============================================================

describe('综合场景', () => {
  it('四种 artType 在相同输入下均能返回决策', () => {
    const file = createFile(1 * 1024 * 1024);
    const types: ArtType[] = ['painting', 'design', 'product', 'sculpture'];
    for (const t of types) {
      const result = decideAnalysisMode(file, createImageUrl(), t, true);
      expect(['client', 'server']).toContain(result.mode);
      expect(result.complexity.level).toBe('simple'); // 1MB → simple
    }
  });

  it('null file + server 不可用 → client 模式,复杂度低', () => {
    const result = decideAnalysisMode(null, createImageUrl(), 'painting', false);
    expect(result.mode).toBe('client');
    expect(result.complexity.factors.fileSizeMB).toBe(0);
    // null file 不触发 >8MB 强制 server
    expect(result.reason).toContain('后端服务不可用');
  });

  it('null file + server 可用 + painting → client (simple)', () => {
    const result = decideAnalysisMode(null, createImageUrl(), 'painting', true);
    expect(result.complexity.level).toBe('simple');
    expect(result.mode).toBe('client');
    expect(result.estimatedTime).toBe(2);
  });

  it('决策结果确定性 (相同输入相同输出)', () => {
    const file = createFile(2 * 1024 * 1024);
    const r1 = decideAnalysisMode(file, createImageUrl(), 'painting', true);
    const r2 = decideAnalysisMode(file, createImageUrl(), 'painting', true);
    expect(r1.mode).toBe(r2.mode);
    expect(r1.reason).toBe(r2.reason);
    expect(r1.estimatedTime).toBe(r2.estimatedTime);
    expect(r1.complexity.score).toBe(r2.complexity.score);
  });
});
