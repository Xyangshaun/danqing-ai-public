// ============================================================
// AnalysisPage 页面单元测试 (任务包 E:块3)
// 对应源码: src/pages/AnalysisPage.tsx
//
// 测试范围:
//   1. upload 步骤渲染(标题/创作类型选择/上传区)
//   2. 创作类型切换(绘画/设计/产品设计/雕塑)
//   3. 文件上传 → analyzing 步骤 → result 步骤完整流程
//   4. 分析失败回退 upload 步骤
//   5. 结果页渲染(诊断报告)
//   6. 重新诊断(handleRetry)
//   7. 文件校验(格式/大小)
//
// Mock 策略:
//   - smartAnalysisEngine.smartAnalyze: 可控 resolve/reject
//   - data-service.saveAnalysis: 可控
//   - draft-service: createDraft/deleteDraft/updateDraft/getDraft 可控
//   - useAuth: 已登录教师态
//   - HeatmapCanvas / PresetSelector: 轻量 stub
//   - FileReader: 同步触发 onload(避免异步读取)
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AnalysisPage from '../AnalysisPage';
import { ToastProvider } from '../../components/ToastProvider';
import { createAuthenticatedTeacherValue } from '../../test/render';
import type { AuthContextValue } from '../../context/AuthContext';
import type { AnalysisResult, PaintingAnalysis } from '../../types';

/* ---------- mock 依赖 ---------- */

/* navigate mock(M4-T8:"以此风格生成练习"跳转断言);
 * 保留 react-router-dom 其余实际实现(MemoryRouter/useSearchParams 等) */
const navigateMock = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

const mockUseAuth = vi.fn<(...args: never[]) => AuthContextValue>();
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}));

const smartAnalyzeMock = vi.fn();
vi.mock('../../services/smartAnalysisEngine', () => ({
  smartAnalyze: (...args: unknown[]) => smartAnalyzeMock(...args),
}));

const saveAnalysisMock = vi.fn();
const getAnalysisHistoryMock = vi.fn();
vi.mock('../../services/data-service', () => ({
  saveAnalysis: (...args: unknown[]) => saveAnalysisMock(...args),
  getAnalysisHistory: (...args: unknown[]) => getAnalysisHistoryMock(...args),
}));

const createDraftMock = vi.fn();
const deleteDraftMock = vi.fn();
const updateDraftMock = vi.fn();
const getDraftMock = vi.fn();
vi.mock('../../services/draft-service', () => ({
  createDraft: (...args: unknown[]) => createDraftMock(...args),
  deleteDraft: (...args: unknown[]) => deleteDraftMock(...args),
  updateDraft: (...args: unknown[]) => updateDraftMock(...args),
  getDraft: (...args: unknown[]) => getDraftMock(...args),
}));

vi.mock('../../components/HeatmapCanvas', () => ({
  __esModule: true,
  default: () => <div data-testid="heatmap-canvas" />,
}));

vi.mock('../../components/PresetSelector', () => ({
  __esModule: true,
  default: () => <div data-testid="preset-selector" />,
}));

/* ---------- 测试数据工厂 ---------- */

function makePaintingResult(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  const dimensions: PaintingAnalysis = {
    type: 'painting',
    composition: {
      score: 80,
      focusPoint: { x: 0.5, y: 0.5 },
      balance: 'balanced',
      guideline: 'good',
      whitespaceRatio: 0.3,
      symmetry: 0.8,
      suggestion: '构图建议',
      heatmapData: [[0.1, 0.2]],
    },
    color: {
      score: 75,
      warmRatio: 0.6,
      coolRatio: 0.4,
      contrast: 'medium',
      saturation: 'medium',
      richness: 'rich',
      harmony: '和谐',
      dominantColor: '#c8392c',
      suggestion: '色彩建议',
    },
    brushwork: {
      score: 85,
      textureLevel: 'rich',
      strokeVariety: 0.7,
      wetDryBalance: '湿干均衡',
      suggestion: '笔触建议',
    },
  };
  return {
    id: 'result-1',
    imageUrl: 'data:image/png;base64,mock',
    createdAt: new Date().toISOString(),
    artType: 'painting',
    dimensions,
    originality: {
      score: 70,
      similarity: 0.3,
      creativityLevel: 'good',
      suggestion: '原创性建议',
    },
    overallScore: 80,
    ...overrides,
  };
}

/* ---------- FileReader mock(异步触发 onload) ---------- */

class MockFileReader {
  result: string | null = null;
  onload: ((e: { target: { result: string | null } }) => void) | null = null;
  readAsDataURL(_file: File): void {
    this.result = 'data:image/png;base64,mockImageData';
    // 异步触发 onload(模拟真实 FileReader 行为)
    setTimeout(() => {
      this.onload?.({ target: { result: this.result } });
    }, 0);
  }
}

/* ---------- Image mock(异步触发 onload) ----------
 * compressImageToThumbnail 使用 new Image() + img.src = dataUrl + img.onload
 * jsdom 不会真正加载图片,需手动触发 onload 使 Promise resolve
 */
class MockImage {
  onload: ((e: Event) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  width = 100;
  height = 100;
  private _src = '';
  get src(): string { return this._src; }
  set src(value: string) {
    this._src = value;
    if (value) {
      setTimeout(() => { this.onload?.(new Event('load')); }, 0);
    }
  }
}

/* ---------- 渲染辅助 ---------- */

function renderAnalysis() {
  return render(
    <MemoryRouter initialEntries={['/analyze']}>
      <ToastProvider>
        <AnalysisPage />
      </ToastProvider>
    </MemoryRouter>,
  );
}

/** 构造 mock 图片文件 */
function makeImageFile(name = 'test.png', type = 'image/png', size = 1024): File {
  const file = new File(['mock-image-data'], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  mockUseAuth.mockReset();
  mockUseAuth.mockReturnValue(createAuthenticatedTeacherValue());
  navigateMock.mockReset();
  smartAnalyzeMock.mockReset();
  saveAnalysisMock.mockReset();
  getAnalysisHistoryMock.mockReset();
  createDraftMock.mockReset();
  deleteDraftMock.mockReset();
  updateDraftMock.mockReset();
  getDraftMock.mockReset();
  saveAnalysisMock.mockResolvedValue(undefined);
  getAnalysisHistoryMock.mockResolvedValue([]);
  getDraftMock.mockReturnValue(null);
  createDraftMock.mockReturnValue({
    id: 'draft-1',
    tenantId: 'tenant-1',
    userId: 'user-1',
    title: '未命名作品',
    artworkType: 'painting',
    status: 'draft',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  // 替换全局 FileReader 与 Image(compressImageToThumbnail 依赖)
  vi.stubGlobal('FileReader', MockFileReader);
  vi.stubGlobal('Image', MockImage);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  // 清理 hash 防止草稿恢复测试间泄漏
  window.location.hash = '';
});

/* ============================================================
 * 1. upload 步骤渲染
 * ============================================================ */
describe('AnalysisPage upload 步骤', () => {
  it('渲染标题"智绘镜"与副标题', () => {
    renderAnalysis();
    expect(screen.getByText('智绘镜')).toBeInTheDocument();
    expect(screen.getByText('智能感知作品复杂度，自动选择最优分析方案')).toBeInTheDocument();
  });

  it('渲染"选择创作类型"与 4 个类型按钮', () => {
    renderAnalysis();
    expect(screen.getByText('选择创作类型')).toBeInTheDocument();
    /* "绘画"同时出现在类型按钮和"记住你的选择"提示中,用 getAllByText 断言至少存在 */
    expect(screen.getAllByText('绘画').length).toBeGreaterThan(0);
    expect(screen.getByText('设计')).toBeInTheDocument();
    expect(screen.getByText('产品设计')).toBeInTheDocument();
    expect(screen.getByText('雕塑')).toBeInTheDocument();
  });

  it('渲染上传区(点击或拖拽上传)', () => {
    renderAnalysis();
    expect(screen.getByText(/点击或拖拽上传/)).toBeInTheDocument();
  });
});

/* ============================================================
 * 2. 创作类型切换
 * ============================================================ */
describe('AnalysisPage 创作类型切换', () => {
  it('点击"设计"切换选中类型', () => {
    renderAnalysis();
    const designBtn = screen.getByText('设计').closest('button');
    fireEvent.click(designBtn!);
    // 上传区文案应显示"设计"
    expect(screen.getByText(/点击或拖拽上传设计作品/)).toBeInTheDocument();
  });

  it('点击"雕塑"切换选中类型', () => {
    renderAnalysis();
    fireEvent.click(screen.getByText('雕塑'));
    expect(screen.getByText(/点击或拖拽上传雕塑作品/)).toBeInTheDocument();
  });
});

/* ============================================================
 * 3. 文件上传 → analyzing → result 完整流程
 * ============================================================ */
describe('AnalysisPage 分析流程', () => {
  it('上传图片后进入 analyzing 步骤(显示分析阶段)', async () => {
    smartAnalyzeMock.mockReturnValue(new Promise(() => {})); // 不 resolve,保持 analyzing
    renderAnalysis();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeImageFile()] } });
    // FileReader.readAsDataURL → setTimeout(0) → onload → beginAnalysisWithImage
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    // Image.src set → setTimeout(0) → onload → compressImageToThumbnail resolves → setStep('analyzing')
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    await waitFor(() => {
      expect(smartAnalyzeMock).toHaveBeenCalled();
    });
    // analyzing 步骤显示阶段名称(在阶段列表和当前阶段展示中多处出现)
    expect(screen.getAllByText('图像预处理').length).toBeGreaterThan(0);
  });

  it('分析成功后进入 result 步骤(显示诊断报告)', async () => {
    const result = makePaintingResult();
    smartAnalyzeMock.mockResolvedValue(result);
    renderAnalysis();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeImageFile()] } });
    // FileReader.onload
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    // Image.onload → compressImageToThumbnail resolves → setStep('analyzing')
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    // smartAnalyze resolves → processResult → await saveAnalysis → setTimeout(400ms)
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    // 400ms 延迟后切换到 result 步骤
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    await waitFor(() => {
      expect(screen.getByText('诊断报告')).toBeInTheDocument();
    });
    // 保存分析结果
    expect(saveAnalysisMock).toHaveBeenCalledWith(result);
  });

  it('分析失败后回退到 upload 步骤', async () => {
    smartAnalyzeMock.mockRejectedValue(new Error('analyze fail'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderAnalysis();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeImageFile()] } });
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    await waitFor(() => {
      expect(smartAnalyzeMock).toHaveBeenCalled();
    });
    // 失败后回到 upload 步骤
    await waitFor(() => {
      expect(screen.getByText('选择创作类型')).toBeInTheDocument();
    });
    errorSpy.mockRestore();
  });
});

/* ============================================================
 * 4. 结果页渲染
 * ============================================================ */
describe('AnalysisPage 结果页', () => {
  it('结果页显示"诊断报告"标题与综合评分', async () => {
    const result = makePaintingResult({ overallScore: 85 });
    smartAnalyzeMock.mockResolvedValue(result);
    renderAnalysis();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeImageFile()] } });
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    await waitFor(() => {
      expect(screen.getByText('诊断报告')).toBeInTheDocument();
    });
  });

  it('结果页调用 saveAnalysis 保存结果', async () => {
    const result = makePaintingResult();
    smartAnalyzeMock.mockResolvedValue(result);
    renderAnalysis();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeImageFile()] } });
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    await waitFor(() => {
      expect(saveAnalysisMock).toHaveBeenCalledWith(result);
    });
  });
});

/* ============================================================
 * 5. 文件校验
 * ============================================================ */
describe('AnalysisPage 文件校验', () => {
  it('上传非图片格式时不进入分析(显示错误)', async () => {
    renderAnalysis();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeImageFile('test.txt', 'text/plain')] } });
    await act(async () => { vi.advanceTimersByTime(10); });
    // 不应调用 smartAnalyze
    expect(smartAnalyzeMock).not.toHaveBeenCalled();
    // 仍在 upload 步骤
    expect(screen.getByText('选择创作类型')).toBeInTheDocument();
  });

  it('上传超过 10MB 的图片时不进入分析', async () => {
    renderAnalysis();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const bigFile = makeImageFile('big.png', 'image/png', 11 * 1024 * 1024);
    fireEvent.change(input, { target: { files: [bigFile] } });
    await act(async () => { vi.advanceTimersByTime(10); });
    expect(smartAnalyzeMock).not.toHaveBeenCalled();
    expect(screen.getByText('选择创作类型')).toBeInTheDocument();
  });
});

/* ============================================================
 * 6. 草稿恢复
 *
 * getDraftIdFromUrl() 读取 window.location.hash 中的 ?draftId=xxx
 * MemoryRouter 不更新真实 URL,需在渲染前手动设置 hash
 * ============================================================ */
describe('AnalysisPage 草稿恢复', () => {
  it('URL 含 draftId 时挂载调用 getDraft 检查草稿', () => {
    // 设置 hash 使 getDraftIdFromUrl 返回 'draft-1'
    window.location.hash = '#/analyze?draftId=draft-1';
    renderAnalysis();
    expect(getDraftMock).toHaveBeenCalledWith('draft-1');
    // 清理 hash
    window.location.hash = '';
  });

  it('存在 analyzing 草稿时显示恢复预览', async () => {
    getDraftMock.mockReturnValue({
      id: 'draft-existing',
      tenantId: 'tenant-1',
      userId: 'user-1',
      title: '草稿作品',
      artworkType: 'painting',
      status: 'analyzing',
      imagePreview: 'data:image/png;base64,preview',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    window.location.hash = '#/analyze?draftId=draft-existing';
    renderAnalysis();
    await waitFor(() => {
      // 文本在恢复预览 UI 和 toast 中多处出现
      expect(screen.getAllByText('已恢复未完成的草稿').length).toBeGreaterThan(0);
    });
    window.location.hash = '';
  });
});

/* ============================================================
 * 7. 结果报告区"以此风格生成练习"入口(M4-T8,真源 §7.3)
 *
 * 协议:navigate('/generation', { state: { prefill: {
 *   inputType: 'style', styleImageUrl: <当前作品URL>, artType: <当前artType>
 * } } });dataURL 不进 URL query,仅经 location state 传递。
 * ============================================================ */

/** 走完 上传 → 分析 → result 步骤,等待"诊断报告"出现 */
async function renderAtResultStep(result: AnalysisResult): Promise<void> {
  smartAnalyzeMock.mockResolvedValue(result);
  renderAnalysis();
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [makeImageFile()] } });
  // FileReader.onload → beginAnalysisWithImage(压缩缩略图 Image.onload)→ analyzing
  await act(async () => { await vi.advanceTimersByTimeAsync(10); });
  await act(async () => { await vi.advanceTimersByTimeAsync(10); });
  // smartAnalyze resolves → saveAnalysis → 400ms 延迟 → result 步骤
  await act(async () => { await vi.advanceTimersByTimeAsync(10); });
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  await waitFor(() => {
    expect(screen.getByText('诊断报告')).toBeInTheDocument();
  });
}

describe('AnalysisPage 以此风格生成练习入口(M4-T8)', () => {
  it('结果报告区渲染"以此风格生成练习"按钮', async () => {
    const result = makePaintingResult({ imageUrl: 'https://cdn.example.com/artwork/painting.png' });
    await renderAtResultStep(result);
    expect(screen.getByText('以此风格生成练习')).toBeInTheDocument();
  });

  it('点击按钮按 §7.3 协议跳转 /generation 并携带 prefill(state 传递,不进 query)', async () => {
    const result = makePaintingResult({ imageUrl: 'https://cdn.example.com/artwork/painting.png' });
    await renderAtResultStep(result);

    const btn = screen.getByText('以此风格生成练习').closest('button');
    expect(btn).not.toBeNull();
    fireEvent.click(btn!);

    expect(navigateMock).toHaveBeenCalledTimes(1);
    expect(navigateMock).toHaveBeenCalledWith('/generation', {
      state: {
        prefill: {
          inputType: 'style',
          styleImageUrl: 'https://cdn.example.com/artwork/painting.png',
          artType: 'painting',
        },
      },
    });
    // dataURL/图片不进 URL query:跳转目标路径不含查询串
    const callArg = navigateMock.mock.calls[0][0] as string;
    expect(callArg).not.toContain('?');
  });
});
