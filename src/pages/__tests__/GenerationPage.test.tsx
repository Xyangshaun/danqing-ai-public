// ============================================================
// GenerationPage 页面单元测试 (M2-T7 前端生成入口,M4-T6 扩展)
// 对应源码: src/pages/GenerationPage.tsx
//
// 测试范围:
//   1. 表单渲染(标题/输入来源切换/提交按钮)
//   2. 文字模式提交 → createGeneration 收到正确请求体
//   3. 文字模式缺提示词时不提交(toast 校验提示)
//   4. 轮询状态机 pending→success 展示结果
//   5. 轮询状态机 pending→failed 展示失败原因
//   6. 一键诊断(占位)toast 提示
//   7. 配额超限(6101)/限流(6106)错误差异化提示
//   8. 风格迁移模式(M4-T6):tab 切换/上传压缩预览/请求体透传/校验
//   9. 风格迁移预填(§7.3):location.state 优先/query 兜底/非 http 忽略
//  10. 风格拆解卡(M4-T6):success 并列展示/failed 保留展示/空不渲染
//
// Mock 策略:
//   - generationService.createGeneration / getGeneration: 可控 resolve
//   - utils/imageCompress.compressImage: 可控 resolve(style 上传压缩链路)
//   - 页面其余组件(GenerationForm/Loading/Result/Failed)为真实组件
//   - ApiError: 使用真实 api.ts 导出类构造错误码
//   - 轮询用 fake timers + advanceTimersByTimeAsync 推进
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { InitialEntry } from 'react-router-dom';
import GenerationPage from '../GenerationPage';
import { ToastProvider } from '../../components/ToastProvider';
import { ApiError } from '../../services/api';

/* ---------- mock generationService ---------- */
const createGenerationMock = vi.fn();
const getGenerationMock = vi.fn();

vi.mock('../../services/generationService', async () => {
  const actual = await vi.importActual<typeof import('../../services/generationService')>(
    '../../services/generationService'
  );
  return {
    ...actual,
    createGeneration: (...args: unknown[]) => createGenerationMock(...args),
    getGeneration: (...args: unknown[]) => getGenerationMock(...args),
  };
});

/* ---------- mock imageCompress(style 参考图压缩链路,M4-T6) ---------- */
const compressImageMock = vi.fn();

vi.mock('../../utils/imageCompress', () => ({
  compressImage: (...args: unknown[]) => compressImageMock(...args),
}));

/* ---------- 渲染辅助 ---------- */
function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/generate']}>
      <ToastProvider>
        <GenerationPage />
      </ToastProvider>
    </MemoryRouter>,
  );
}

/** 按指定路由入口渲染(预填测试用:state / query 变体) */
function renderPageWithEntries(entries: InitialEntry[]) {
  return render(
    <MemoryRouter initialEntries={entries}>
      <ToastProvider>
        <GenerationPage />
      </ToastProvider>
    </MemoryRouter>,
  );
}

/** 在文字模式下输入提示词并点击"开始生成" */
async function fillPromptAndSubmit(prompt = '水墨山水') {
  const textarea = screen.getByPlaceholderText(/例如：水墨山水/);
  fireEvent.change(textarea, { target: { value: prompt } });
  fireEvent.click(screen.getByText('开始生成'));
  // 冲刷 createGeneration 的异步 resolve
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
}

/** 构造 mock 图片文件 */
function makeImageFile(name = 'style-ref.png', type = 'image/png'): File {
  return new File(['mock-image-data'], name, { type });
}

/**
 * 切到风格迁移模式,上传参考图(经 mock 压缩)并填写新画面内容描述
 */
async function selectStyleModeAndFill(desc = '一位戴草帽的少女站在麦田边') {
  fireEvent.click(screen.getByText('风格迁移'));
  // style 模式下唯一的 file input(隐藏,sketch input 未渲染)
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [makeImageFile()] } });
  // 冲刷 compressImage 的异步 resolve
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  // 预览就绪后填写内容描述
  const textarea = screen.getByPlaceholderText(/例如：一位戴草帽的少女/);
  fireEvent.change(textarea, { target: { value: desc } });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  createGenerationMock.mockReset();
  getGenerationMock.mockReset();
  compressImageMock.mockReset();
  compressImageMock.mockResolvedValue('data:image/jpeg;base64,STYLE-COMPRESSED');
});

afterEach(() => {
  vi.useRealTimers();
});

/* ============================================================
 * 1. 表单渲染
 * ============================================================ */
describe('GenerationPage 表单渲染', () => {
  it('渲染页面标题"AI 生成"', () => {
    renderPage();
    // 页面标题 + 表单卡片标题均含"AI 生成",用 getAllByText 断言至少一处
    expect(screen.getAllByText('AI 生成').length).toBeGreaterThan(0);
  });

  it('渲染输入来源切换(文字/草稿图)与开始生成按钮', () => {
    renderPage();
    expect(screen.getByText('文字提示词')).toBeInTheDocument();
    expect(screen.getByText('上传草稿图')).toBeInTheDocument();
    expect(screen.getByText('开始生成')).toBeInTheDocument();
  });
});

/* ============================================================
 * 2. 文字模式提交
 * ============================================================ */
describe('GenerationPage 文字模式提交', () => {
  it('输入提示词并提交,createGeneration 收到正确请求体', async () => {
    createGenerationMock.mockResolvedValue({ taskId: 'task-1', status: 'pending', images: null });
    renderPage();
    await fillPromptAndSubmit('水墨山水');

    await waitFor(() => {
      expect(createGenerationMock).toHaveBeenCalledTimes(1);
    });
    const payload = createGenerationMock.mock.calls[0][0];
    expect(payload).toMatchObject({
      inputType: 'text',
      prompt: '水墨山水',
      artType: 'painting', // 默认绘画
      aspect: 'square',
      count: 1,
    });
    // sketch 相关字段不携带
    expect(payload.sketchImageUrl).toBeUndefined();
  });

  it('提示词为空时不提交(toast 校验提示)', async () => {
    renderPage();
    await fillPromptAndSubmit('   ');
    expect(createGenerationMock).not.toHaveBeenCalled();
  });
});

/* ============================================================
 * 3. 轮询状态机
 * ============================================================ */
describe('GenerationPage 轮询状态机', () => {
  it('pending→success 轮询后展示生成结果', async () => {
    createGenerationMock.mockResolvedValue({ taskId: 'task-1', status: 'pending', images: null });
    // 首次查询 + 后续轮询:先 pending,后 success
    getGenerationMock
      .mockResolvedValueOnce({
        taskId: 'task-1', tenantId: 't1', status: 'pending',
        images: null, failureReason: null, usedFallback: false,
        createdAt: '', completedAt: null,
      })
      .mockResolvedValueOnce({
        taskId: 'task-1', tenantId: 't1', status: 'success',
        images: [{ imageUrl: 'https://img.example.com/a.png', reviewStatus: 'approved' }],
        failureReason: null, usedFallback: false,
        createdAt: '', completedAt: null,
      });

    renderPage();
    await fillPromptAndSubmit('水墨山水');

    // 进入 generating 态(loading 组件含"取消生成"按钮,稳定标识)
    await waitFor(() => {
      expect(screen.getByText('取消生成')).toBeInTheDocument();
    });

    // 推进一个轮询间隔(2s),触发 success 分支
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });

    await waitFor(() => {
      expect(screen.getByText('生成结果')).toBeInTheDocument();
    });
    // 图片展示
    expect(screen.getByAltText('生成作品 1')).toBeInTheDocument();
    // 一键诊断占位按钮存在
    expect(screen.getByText('一键诊断')).toBeInTheDocument();
  });

  it('pending→failed 轮询后展示失败原因', async () => {
    createGenerationMock.mockResolvedValue({ taskId: 'task-1', status: 'pending', images: null });
    getGenerationMock
      .mockResolvedValueOnce({
        taskId: 'task-1', tenantId: 't1', status: 'processing',
        images: null, failureReason: null, usedFallback: false,
        createdAt: '', completedAt: null,
      })
      .mockResolvedValueOnce({
        taskId: 'task-1', tenantId: 't1', status: 'failed',
        images: null, failureReason: 'AI 提供商均不可用', usedFallback: true,
        createdAt: '', completedAt: null,
      });

    renderPage();
    await fillPromptAndSubmit('水墨山水');
    await waitFor(() => {
      expect(screen.getByText('取消生成')).toBeInTheDocument();
    });

    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });

    await waitFor(() => {
      expect(screen.getByText('生成失败')).toBeInTheDocument();
    });
    expect(screen.getByText('AI 提供商均不可用')).toBeInTheDocument();
    expect(screen.getByText('重新生成')).toBeInTheDocument();
  });

  it('展示 loading 态(排队中/生成中)', async () => {
    createGenerationMock.mockResolvedValue({ taskId: 'task-1', status: 'pending', images: null });
    getGenerationMock.mockResolvedValue({
      taskId: 'task-1', tenantId: 't1', status: 'pending',
      images: null, failureReason: null, usedFallback: false,
      createdAt: '', completedAt: null,
    });

    renderPage();
    await fillPromptAndSubmit('水墨山水');
    // pending → "排队中" 标签
    await waitFor(() => {
      expect(screen.getByText('排队中')).toBeInTheDocument();
    });
    // loading 提示文案
    expect(screen.getByText('任务已排队')).toBeInTheDocument();
  });
});

/* ============================================================
 * 4. 一键诊断(占位)
 * ============================================================ */
describe('GenerationPage 一键诊断(占位)', () => {
  it('点击一键诊断展示"功能即将上线"提示', async () => {
    createGenerationMock.mockResolvedValue({ taskId: 'task-1', status: 'pending', images: null });
    getGenerationMock.mockResolvedValue({
      taskId: 'task-1', tenantId: 't1', status: 'success',
      images: [{ imageUrl: 'https://img.example.com/a.png', reviewStatus: 'approved' }],
      failureReason: null, usedFallback: false,
      createdAt: '', completedAt: null,
    });

    renderPage();
    await fillPromptAndSubmit('水墨山水');
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    await waitFor(() => {
      expect(screen.getByText('一键诊断')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('一键诊断'));
    expect(screen.getByText('功能即将上线')).toBeInTheDocument();
  });
});

/* ============================================================
 * 5. 配额/限流错误提示
 * ============================================================ */
describe('GenerationPage 配额/限流错误', () => {
  it('配额超限(6101)展示友好提示', async () => {
    createGenerationMock.mockRejectedValue(new ApiError(6101, '生成配额已用完', 'trace', 402));
    renderPage();
    await fillPromptAndSubmit('水墨山水');
    await waitFor(() => {
      expect(screen.getByText('生成配额已用完')).toBeInTheDocument();
    });
  });

  it('限流(6106)展示友好提示', async () => {
    createGenerationMock.mockRejectedValue(new ApiError(6106, '操作过于频繁', 'trace', 429));
    renderPage();
    await fillPromptAndSubmit('水墨山水');
    await waitFor(() => {
      expect(screen.getByText('操作过于频繁')).toBeInTheDocument();
    });
  });

  it('styleTransfer 开关关闭(403 FORBIDDEN 2004)走统一错误提示', async () => {
    createGenerationMock.mockRejectedValue(new ApiError(2004, '风格迁移功能暂未开放', 'trace', 403));
    renderPage();
    await selectStyleModeAndFill();
    fireEvent.click(screen.getByText('开始生成'));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await waitFor(() => {
      expect(screen.getByText('生成失败')).toBeInTheDocument();
      expect(screen.getByText('风格迁移功能暂未开放')).toBeInTheDocument();
    });
  });
});

/* ============================================================
 * 6. 风格迁移模式(M4-T6)
 * ============================================================ */
describe('GenerationPage 风格迁移模式', () => {
  it('渲染三模式切换:文字/草稿图/风格迁移', () => {
    renderPage();
    expect(screen.getByText('文字提示词')).toBeInTheDocument();
    expect(screen.getByText('上传草稿图')).toBeInTheDocument();
    expect(screen.getByText('风格迁移')).toBeInTheDocument();
  });

  it('切到风格迁移展示参考图上传区/内容描述/预期管理副文案', () => {
    renderPage();
    fireEvent.click(screen.getByText('风格迁移'));
    // 上传区按钮文案(唯一标识,标签"风格参考图"与按钮文案会重复命中正则)
    expect(screen.getByText('点击上传风格参考图')).toBeInTheDocument();
    expect(screen.getByText(/新画面内容描述/)).toBeInTheDocument();
    expect(screen.getByText(/AI 将学习参考图的风格语言（笔触\/色彩\/构图\/手法）创作新内容，非原作复刻/)).toBeInTheDocument();
  });

  it('上传参考图后展示压缩预览,提交时透传 styleImageUrl 与内容描述', async () => {
    createGenerationMock.mockResolvedValue({ taskId: 'task-s1', status: 'pending', images: null });
    renderPage();
    await selectStyleModeAndFill('一位戴草帽的少女站在麦田边');

    // 压缩预览出现(mock compressImage 产物)
    expect(compressImageMock).toHaveBeenCalledTimes(1);
    expect(compressImageMock).toHaveBeenCalledWith(expect.any(File));
    expect(screen.getByAltText('风格参考图预览')).toHaveAttribute(
      'src',
      'data:image/jpeg;base64,STYLE-COMPRESSED',
    );
    // 原始文件名展示
    expect(screen.getByText('style-ref.png')).toBeInTheDocument();

    fireEvent.click(screen.getByText('开始生成'));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await waitFor(() => {
      expect(createGenerationMock).toHaveBeenCalledTimes(1);
    });
    const payload = createGenerationMock.mock.calls[0][0];
    expect(payload).toMatchObject({
      inputType: 'style',
      prompt: '一位戴草帽的少女站在麦田边',
      styleImageUrl: 'data:image/jpeg;base64,STYLE-COMPRESSED',
      artType: 'painting',
      aspect: 'square',
      count: 1,
    });
    // sketch 相关字段不携带
    expect(payload.sketchImageUrl).toBeUndefined();
  });

  it('未上传参考图或描述为空时不提交(toast 校验提示)', async () => {
    renderPage();
    fireEvent.click(screen.getByText('风格迁移'));

    // 无图无描述
    fireEvent.click(screen.getByText('开始生成'));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(createGenerationMock).not.toHaveBeenCalled();
    expect(screen.getByText('请上传风格参考图')).toBeInTheDocument();

    // 有图无描述
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeImageFile()] } });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    fireEvent.click(screen.getByText('开始生成'));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(createGenerationMock).not.toHaveBeenCalled();
    expect(screen.getByText('请输入新画面内容描述')).toBeInTheDocument();
  });

  it('模式切换保留各自输入(text 提示词不被 style 清空)', () => {
    renderPage();
    // 先填 text 模式提示词
    fireEvent.change(screen.getByPlaceholderText(/例如：水墨山水/), { target: { value: '水墨山水' } });
    // 切到 style 再切回 text
    fireEvent.click(screen.getByText('风格迁移'));
    fireEvent.click(screen.getByText('文字提示词'));
    expect((screen.getByPlaceholderText(/例如：水墨山水/) as HTMLTextAreaElement).value).toBe('水墨山水');
  });
});

/* ============================================================
 * 7. 风格迁移预填(§7.3:state 优先 / query 兜底 / 非 http 忽略)
 * ============================================================ */
describe('GenerationPage 风格迁移预填', () => {
  it('location.state.prefill:模式锁定 style、参考图预载预览、artType 同步', async () => {
    createGenerationMock.mockResolvedValue({ taskId: 'task-p1', status: 'pending', images: null });
    renderPageWithEntries([{
      pathname: '/generation',
      state: {
        prefill: {
          inputType: 'style',
          styleImageUrl: 'https://cdn.example.com/master.jpg',
          artType: 'sculpture',
        },
      },
    }]);

    // 参考图预载预览:http URL 直接作 src,不经压缩
    expect(screen.getByAltText('风格参考图预览')).toHaveAttribute(
      'src',
      'https://cdn.example.com/master.jpg',
    );
    expect(compressImageMock).not.toHaveBeenCalled();
    // artType 同步:雕塑选中
    expect(screen.getByText('雕塑').closest('button')?.className).toContain('cinnabar');

    // 填写内容描述后提交:styleImageUrl 原样透传 http URL(不再压缩)
    fireEvent.change(screen.getByPlaceholderText(/例如：一位戴草帽的少女/), {
      target: { value: '海边的礁石与浪花' },
    });
    fireEvent.click(screen.getByText('开始生成'));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await waitFor(() => {
      expect(createGenerationMock).toHaveBeenCalledTimes(1);
    });
    const payload = createGenerationMock.mock.calls[0][0];
    expect(payload).toMatchObject({
      inputType: 'style',
      styleImageUrl: 'https://cdn.example.com/master.jpg',
      artType: 'sculpture',
      prompt: '海边的礁石与浪花',
    });
  });

  it('prefill artType=heritage 映射为 design(偏差#3:分析侧第五类画种兜底,不回落默认绘画)', () => {
    renderPageWithEntries([{
      pathname: '/generation',
      state: {
        prefill: {
          inputType: 'style',
          styleImageUrl: 'https://cdn.example.com/heritage.jpg',
          artType: 'heritage',
        },
      },
    }]);
    // heritage 不在生成侧四类枚举中,应映射 design 选中(若映射缺失则回落默认 painting)
    expect(screen.getByText('设计').closest('button')?.className).toContain('cinnabar');
  });

  it('query 兜底:?styleImageUrl=<http URL>&artType=design 生效', () => {
    renderPageWithEntries([
      '/generation?styleImageUrl=https%3A%2F%2Fcdn.example.com%2Fq.jpg&artType=design',
    ]);
    expect(screen.getByAltText('风格参考图预览')).toHaveAttribute(
      'src',
      'https://cdn.example.com/q.jpg',
    );
    expect(screen.getByText('设计').closest('button')?.className).toContain('cinnabar');
  });

  it('query 中非 http URL(dataURL)不触发预填,保持默认 text 模式', () => {
    renderPageWithEntries(['/generation?styleImageUrl=data%3Aimage%2Fpng%3Bbase64%2Cxxx']);
    expect(screen.getByText(/画面描述/)).toBeInTheDocument();
    expect(screen.queryByAltText('风格参考图预览')).not.toBeInTheDocument();
  });

  it('无预填信号时默认 text 模式', () => {
    renderPageWithEntries(['/generation']);
    expect(screen.getByText(/画面描述/)).toBeInTheDocument();
    expect(screen.queryByAltText('风格参考图预览')).not.toBeInTheDocument();
  });
});

/* ============================================================
 * 8. 风格拆解卡(M4-T6:success 并列展示 / failed 保留展示)
 * ============================================================ */

/** mock 风格拆解七字段(真源 §2.4 示例文案) */
const MOCK_STYLE_ANALYSIS = {
  medium: '布面油画，颜料厚堆有光泽',
  brushwork: '短促断续的厚涂笔触，笔触明显外露',
  colorSystem: '高饱和补色对比，明度对比强烈',
  composition: '三角形稳定构图，前景物体放大主导视线',
  technique: '湿画法晕染，刮刀堆叠肌理',
  expression: '后印象派主观化表现，情绪外化、形体夸张',
  styleSeed: '厚涂油画质感，短促有力的断续笔触，高饱和补色对比',
};

describe('GenerationPage 风格拆解卡', () => {
  it('success 且 styleAnalysis 非空:结果页并列展示拆解卡七字段', async () => {
    createGenerationMock.mockResolvedValue({ taskId: 'task-a1', status: 'pending', images: null });
    getGenerationMock.mockResolvedValue({
      taskId: 'task-a1', tenantId: 't1', status: 'success',
      images: [{ imageUrl: 'https://img.example.com/a.png', reviewStatus: 'approved' }],
      failureReason: null, usedFallback: false,
      createdAt: '', completedAt: null,
      styleAnalysis: MOCK_STYLE_ANALYSIS,
    });

    renderPage();
    await fillPromptAndSubmit('水墨山水');
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });

    await waitFor(() => {
      expect(screen.getByText('生成结果')).toBeInTheDocument();
    });
    // 拆解卡与生成图并列展示
    expect(screen.getByText('风格拆解')).toBeInTheDocument();
    expect(screen.getByAltText('生成作品 1')).toBeInTheDocument();
    // styleSeed 首行摘要 + 六字段标签
    expect(screen.getByText('风格种子')).toBeInTheDocument();
    expect(screen.getByText('媒介材料')).toBeInTheDocument();
    expect(screen.getByText('笔触特征')).toBeInTheDocument();
    expect(screen.getByText('色彩体系')).toBeInTheDocument();
    expect(screen.getByText('构图法则')).toBeInTheDocument();
    expect(screen.getByText('技法手法')).toBeInTheDocument();
    expect(screen.getByText('表现倾向')).toBeInTheDocument();
    // 字段内容渲染
    expect(screen.getByText(MOCK_STYLE_ANALYSIS.styleSeed)).toBeInTheDocument();
    expect(screen.getByText(MOCK_STYLE_ANALYSIS.medium)).toBeInTheDocument();
  });

  it('failed 且 styleAnalysis 非空:失败视图保留拆解卡并附重试提示', async () => {
    createGenerationMock.mockResolvedValue({ taskId: 'task-a2', status: 'pending', images: null });
    getGenerationMock.mockResolvedValueOnce({
      taskId: 'task-a2', tenantId: 't1', status: 'failed',
      images: null, failureReason: 'AI_TIMEOUT', usedFallback: false,
      createdAt: '', completedAt: null,
      styleAnalysis: MOCK_STYLE_ANALYSIS,
    });

    renderPage();
    await fillPromptAndSubmit('水墨山水');
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });

    await waitFor(() => {
      expect(screen.getByText('生成失败')).toBeInTheDocument();
    });
    // 两阶段落库:拆解保留展示 + 可重试提示
    expect(screen.getByText('风格拆解')).toBeInTheDocument();
    expect(screen.getByText('风格拆解已完成，生图失败可重试')).toBeInTheDocument();
    expect(screen.getByText(MOCK_STYLE_ANALYSIS.styleSeed)).toBeInTheDocument();
  });

  it('styleAnalysis 为空(非 style 任务)不渲染拆解卡', async () => {
    createGenerationMock.mockResolvedValue({ taskId: 'task-a3', status: 'pending', images: null });
    getGenerationMock.mockResolvedValue({
      taskId: 'task-a3', tenantId: 't1', status: 'success',
      images: [{ imageUrl: 'https://img.example.com/a.png', reviewStatus: 'approved' }],
      failureReason: null, usedFallback: false,
      createdAt: '', completedAt: null,
    });

    renderPage();
    await fillPromptAndSubmit('水墨山水');
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });

    await waitFor(() => {
      expect(screen.getByText('生成结果')).toBeInTheDocument();
    });
    expect(screen.queryByText('风格拆解')).not.toBeInTheDocument();
  });
});
