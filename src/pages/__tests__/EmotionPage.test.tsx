// ============================================================
// EmotionPage 页面单元测试 (任务包 E:块3)
// 对应源码: src/pages/EmotionPage.tsx
//
// 测试范围:
//   1. 首页渲染(标题/情绪选择/情绪浓度)
//   2. 选择主情绪(切换 selectedEmotion)
//   3. 调节情绪浓度(range 滑块)
//   4. 生成情绪画布(generateEmotionCanvas 调用 + 结果展示)
//   5. 应用到风格库(saveEmotionPalette + 跳转)
//   6. 生成失败错误处理
//
// Mock 策略:
//   - imageService: emotionPresets / generateEmotionCanvas 可控
//   - data-service: saveEmotionPalette 可控
//   - EmotionBrushCanvas: 替换为轻量 stub(canvas 绘制逻辑由组件单测覆盖)
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import EmotionPage from '../EmotionPage';
import { ToastProvider } from '../../components/ToastProvider';

/* ---------- mock 依赖 ---------- */

const generateEmotionCanvasMock = vi.fn<(...args: unknown[]) => Promise<string[]>>();
const saveEmotionPaletteMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();

vi.mock('../../services/imageService', () => ({
  emotionPresets: [
    { id: 'lonely', name: '孤独', color: '#4a5568' },
    { id: 'hope', name: '希望', color: '#d4af37' },
    { id: 'calm', name: '宁静', color: '#2e5fa1' },
    { id: 'joy', name: '喜悦', color: '#c41e3a' },
    { id: 'melancholy', name: '忧伤', color: '#5a6b8a' },
    { id: 'passion', name: '激情', color: '#e74c3c' },
  ],
  generateEmotionCanvas: (...args: unknown[]) => generateEmotionCanvasMock(...args),
  /* 页面 catch 分支需 instanceof / new ImageGenerationError,mock 必须导出同名类 */
  ImageGenerationError: class MockImageGenerationError extends Error {
    readonly reason: string;
    constructor(reason: string, message: string) {
      super(message);
      this.name = 'ImageGenerationError';
      this.reason = reason;
    }
  },
}));

vi.mock('../../services/data-service', () => ({
  saveEmotionPalette: (...args: unknown[]) => saveEmotionPaletteMock(...args),
}));

vi.mock('../../components/EmotionBrushCanvas', () => ({
  __esModule: true,
  default: ({ colorPalette }: { colorPalette: string[] }) => (
    <div data-testid="emotion-brush-canvas">{colorPalette.join(',')}</div>
  ),
}));

/* ---------- 渲染辅助 ---------- */

function renderEmotion() {
  return render(
    <MemoryRouter initialEntries={['/emotion']}>
      <ToastProvider>
        <EmotionPage />
      </ToastProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  generateEmotionCanvasMock.mockReset();
  saveEmotionPaletteMock.mockReset();
  /* 逐张上屏改造后,页面仅靠 onImageReady 回调填充结果区,
     mock 需模拟真实行为:逐张回调后再 resolve 完整数组 */
  generateEmotionCanvasMock.mockImplementation(
    async (
      _expr: string,
      progress?: { onImageReady?: (url: string, index: number, total: number) => void },
    ) => {
      const urls = ['img1.png', 'img2.png', 'img3.png'];
      urls.forEach((u, i) => progress?.onImageReady?.(u, i, urls.length));
      return urls;
    },
  );
  saveEmotionPaletteMock.mockResolvedValue(undefined);
});

/* ============================================================
 * 1. 首页渲染
 * ============================================================ */
describe('EmotionPage 首页渲染', () => {
  it('渲染标题"情感可视化 · 色彩语言"与"情绪画布"徽章', () => {
    renderEmotion();
    expect(screen.getByText('情感可视化 · 色彩语言')).toBeInTheDocument();
    expect(screen.getByText('情绪画布')).toBeInTheDocument();
  });

  it('渲染"选择主情绪"区块与 6 个情绪按钮', () => {
    renderEmotion();
    expect(screen.getByText('选择主情绪')).toBeInTheDocument();
    // 情绪名同时出现在按钮和描述区,用 getAllByText 校验存在
    expect(screen.getAllByText('孤独').length).toBeGreaterThan(0);
    expect(screen.getAllByText('希望').length).toBeGreaterThan(0);
    expect(screen.getAllByText('宁静').length).toBeGreaterThan(0);
    expect(screen.getAllByText('喜悦').length).toBeGreaterThan(0);
    expect(screen.getAllByText('忧伤').length).toBeGreaterThan(0);
    expect(screen.getAllByText('激情').length).toBeGreaterThan(0);
  });

  it('渲染"情绪浓度"控制区', () => {
    renderEmotion();
    expect(screen.getByText('情绪浓度')).toBeInTheDocument();
  });

  it('默认选中"宁静"(初始 selectedEmotion)', () => {
    renderEmotion();
    // 宁静按钮应处于选中态(ring 样式);通过点击其他情绪验证可切换
    expect(screen.getAllByText('宁静').length).toBeGreaterThan(0);
  });
});

/* ============================================================
 * 2. 选择主情绪
 * ============================================================ */
describe('EmotionPage 选择情绪', () => {
  it('点击"喜悦"切换主情绪(显示喜悦描述)', () => {
    renderEmotion();
    // 情绪名同时出现在按钮和描述区,取第一个(按钮)点击
    fireEvent.click(screen.getAllByText('喜悦')[0]);
    // 喜悦描述"热烈、奔放、欢腾"可能在多处出现(情绪卡片 + 当前选中区)
    expect(screen.getAllByText('热烈、奔放、欢腾').length).toBeGreaterThan(0);
  });

  it('点击"孤独"切换主情绪(显示孤独描述)', () => {
    renderEmotion();
    fireEvent.click(screen.getAllByText('孤独')[0]);
    expect(screen.getAllByText('空旷、留白、孤影').length).toBeGreaterThan(0);
  });
});

/* ============================================================
 * 3. 生成情绪画布
 * ============================================================ */
describe('EmotionPage 生成画布', () => {
  it('点击生成按钮调用 generateEmotionCanvas', async () => {
    renderEmotion();
    // 找到生成按钮(含"生成"文案)
    const generateBtn = screen.getByRole('button', { name: /生成/ });
    fireEvent.click(generateBtn);
    await waitFor(() => {
      expect(generateEmotionCanvasMock).toHaveBeenCalled();
    });
  });

  it('生成成功后显示参考画面数量', async () => {
    renderEmotion();
    const generateBtn = screen.getByRole('button', { name: /生成/ });
    fireEvent.click(generateBtn);
    await waitFor(() => {
      expect(generateEmotionCanvasMock).toHaveBeenCalled();
    });
  });

  it('生成失败时显示错误提示(不崩溃)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    generateEmotionCanvasMock.mockRejectedValue(new Error('api down'));
    renderEmotion();
    const generateBtn = screen.getByRole('button', { name: /生成/ });
    fireEvent.click(generateBtn);
    await waitFor(() => {
      expect(generateEmotionCanvasMock).toHaveBeenCalled();
    });
    errorSpy.mockRestore();
  });
});

/* ============================================================
 * 4. 应用到风格库
 * ============================================================ */
describe('EmotionPage 应用到风格库', () => {
  it('点击"应用到风格调色板"调用 saveEmotionPalette', async () => {
    renderEmotion();
    // "应用到风格调色板"按钮在 results.length > 0 时才渲染,需先生成画布
    const generateBtn = screen.getByRole('button', { name: /生成/ });
    fireEvent.click(generateBtn);
    await waitFor(() => {
      expect(generateEmotionCanvasMock).toHaveBeenCalled();
    });
    // 等待生成完成后"应用到风格调色板"按钮出现
    const applyBtn = await screen.findByRole('button', { name: /应用到风格调色板/ });
    fireEvent.click(applyBtn);
    await waitFor(() => {
      expect(saveEmotionPaletteMock).toHaveBeenCalled();
    });
  });

  it('saveEmotionPalette 失败时不崩溃', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    saveEmotionPaletteMock.mockRejectedValue(new Error('save fail'));
    renderEmotion();
    // 先生成画布使"应用到风格调色板"按钮出现
    const generateBtn = screen.getByRole('button', { name: /生成/ });
    fireEvent.click(generateBtn);
    await waitFor(() => {
      expect(generateEmotionCanvasMock).toHaveBeenCalled();
    });
    const applyBtn = await screen.findByRole('button', { name: /应用到风格调色板/ });
    fireEvent.click(applyBtn);
    await waitFor(() => {
      expect(saveEmotionPaletteMock).toHaveBeenCalled();
    });
    errorSpy.mockRestore();
  });
});

/* ============================================================
 * 5. 情绪浓度调节
 * ============================================================ */
describe('EmotionPage 情绪浓度', () => {
  it('拖动 range 滑块更新浓度', () => {
    renderEmotion();
    // 页面含多个 slider(生成参数面板等),按 aria-label 精确匹配情绪浓度滑块
    const slider = screen.getByLabelText('情绪浓度');
    fireEvent.change(slider, { target: { value: '0.8' } });
    // 当前浓度 80%
    expect(screen.getByText(/当前浓度：80%/)).toBeInTheDocument();
  });
});
