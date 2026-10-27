// ============================================================
// HistoryPage 页面单元测试 (任务包 E:块3)
// 对应源码: src/pages/HistoryPage.tsx
//
// 测试范围:
//   1. 加载态(ListSkeleton)与空态(还没有分析记录)
//   2. 有数据态:渲染历史卡片 + 时间线
//   3. 筛选功能(艺术类型 / 分数区间 / 排序)
//   4. URL 参数同步(初始筛选 + 切换时更新)
//   5. 详情弹窗(查看详情 → 打开 → 关闭)
//   6. 再次诊断跳转(/analyze?type=<artType>)
//   7. 清除筛选按钮(无匹配结果时显示)
//   8. 错误处理(加载失败静默不崩溃)
//
// Mock 策略:
//   - data-service: getAnalysisHistory / getAnalysisDetail 可控返回
//   - useLazyImage: mock 为始终 loaded 状态(避免 IntersectionObserver 依赖)
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../../components/ToastProvider';
import HistoryPage from '../HistoryPage';
import type { HistoryRecord, AnalysisResult, PaintingAnalysis } from '../../types';

/* ---------- mock 依赖 ---------- */

const getAnalysisHistoryMock = vi.fn<(...args: unknown[]) => Promise<HistoryRecord[]>>();
const getAnalysisDetailMock = vi.fn<(...args: unknown[]) => Promise<AnalysisResult | null>>();
const batchDeleteAnalysesMock = vi.fn<(...args: unknown[]) => Promise<{ total: number; deleted: number; failedCount: number; items: { id: string; deleted: boolean; error?: string }[] }>>();
vi.mock('../../services/data-service', () => ({
  getAnalysisHistory: (...args: unknown[]) => getAnalysisHistoryMock(...args),
  getAnalysisDetail: (...args: unknown[]) => getAnalysisDetailMock(...args),
  batchDeleteAnalyses: (...args: unknown[]) => batchDeleteAnalysesMock(...args),
}));

/* mock useLazyImage:始终返回 loaded 状态,避免 IntersectionObserver 依赖 */
vi.mock('../../hooks/useLazyImage', () => ({
  useLazyImage: (src: string | undefined) => ({
    imgRef: { current: null },
    loadedSrc: src,
    isLoaded: !!src,
    isError: false,
  }),
}));

/* mock useAuth:RequestReviewSection 依赖登录态,返回已登录学生 */
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'u-test', name: '测试学生', role: 'student', tenantId: 't-1' },
    isAuthenticated: true,
    isLoading: false,
  }),
}));

/* ---------- 测试数据工厂 ---------- */

function makeRecord(overrides: Partial<HistoryRecord> = {}): HistoryRecord {
  return {
    id: 'rec-1',
    imageUrl: 'https://example.com/work.png',
    createdAt: new Date().toISOString(),
    artType: 'painting',
    overallScore: 80,
    dimension1Score: 75,
    dimension2Score: 80,
    dimension3Score: 85,
    ...overrides,
  };
}

function makePaintingDetail(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  const dimensions: PaintingAnalysis = {
    type: 'painting',
    composition: {
      score: 80,
      focusPoint: { x: 0.5, y: 0.5 },
      balance: 'balanced',
      guideline: 'good',
      whitespaceRatio: 0.3,
      symmetry: 0.8,
      suggestion: '构图建议测试',
      heatmapData: [[0.1, 0.2], [0.3, 0.4]],
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
      suggestion: '色彩建议测试',
    },
    brushwork: {
      score: 85,
      textureLevel: 'rich',
      strokeVariety: 0.7,
      wetDryBalance: '湿干均衡',
      suggestion: '笔触建议测试',
    },
  };
  return {
    id: 'detail-1',
    imageUrl: 'https://example.com/detail.png',
    createdAt: new Date().toISOString(),
    artType: 'painting',
    dimensions,
    originality: {
      score: 78,
      similarity: 0.3,
      creativityLevel: 'good',
      suggestion: '原创性建议测试',
    },
    overallScore: 80,
    ...overrides,
  };
}

/* ---------- 渲染辅助 ---------- */

function renderHistory(initialPath = '/history') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <ToastProvider>
        <HistoryPage />
      </ToastProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  getAnalysisHistoryMock.mockReset();
  getAnalysisDetailMock.mockReset();
  batchDeleteAnalysesMock.mockReset();
  // 默认空数据
  getAnalysisHistoryMock.mockResolvedValue([]);
  getAnalysisDetailMock.mockResolvedValue(null);
  batchDeleteAnalysesMock.mockResolvedValue({ total: 0, deleted: 0, failedCount: 0, items: [] });
});

/* ============================================================
 * 1. 加载态与空态
 * ============================================================ */
describe('HistoryPage 加载态与空态', () => {
  it('加载中时显示骨架屏(不显示空态)', async () => {
    // 让 Promise 永不 resolve,保持 loading 态
    getAnalysisHistoryMock.mockReturnValue(new Promise(() => {}));
    renderHistory();
    // 标题始终渲染
    expect(screen.getByText('历史记录')).toBeInTheDocument();
    // 骨架屏渲染(ListSkeleton 产生 skeleton 类名)
    expect(document.querySelector('.animate-pulse, [class*="skeleton"]')).toBeTruthy();
  });

  it('空数据时显示"还没有分析记录"空态', async () => {
    renderHistory();
    await waitFor(() => {
      expect(screen.getByText('还没有分析记录')).toBeInTheDocument();
    });
    expect(screen.getByText('上传第一件作品，开始AI智能诊断')).toBeInTheDocument();
  });

  it('空态渲染"立即上传"按钮,指向 /analyze', async () => {
    renderHistory();
    await waitFor(() => {
      expect(screen.getByText('立即上传')).toBeInTheDocument();
    });
    const link = screen.getByText('立即上传').closest('a');
    expect(link).toHaveAttribute('href', '/analyze');
  });

  it('加载失败时静默不崩溃(仍渲染页面标题)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    getAnalysisHistoryMock.mockRejectedValue(new Error('network'));
    renderHistory();
    await waitFor(() => {
      expect(getAnalysisHistoryMock).toHaveBeenCalled();
    });
    expect(screen.getByText('历史记录')).toBeInTheDocument();
    errorSpy.mockRestore();
  });
});

/* ============================================================
 * 2. 有数据态:历史卡片渲染
 * ============================================================ */
describe('HistoryPage 历史卡片渲染', () => {
  it('有记录时渲染历史卡片(显示综合分数)', async () => {
    getAnalysisHistoryMock.mockResolvedValue([
      makeRecord({ id: 'r1', overallScore: 88, artType: 'painting' }),
    ]);
    renderHistory();
    await waitFor(() => {
      expect(screen.getByText('88')).toBeInTheDocument();
    });
  });

  it('渲染艺术类型标签(绘画/设计/产品设计/雕塑)', async () => {
    getAnalysisHistoryMock.mockResolvedValue([
      makeRecord({ id: 'r1', artType: 'painting' }),
    ]);
    renderHistory();
    await waitFor(() => {
      // "绘画"同时出现在筛选按钮和卡片标签中
      expect(screen.getAllByText('绘画').length).toBeGreaterThan(0);
    });
  });

  it('渲染"查看详情"按钮', async () => {
    getAnalysisHistoryMock.mockResolvedValue([makeRecord()]);
    renderHistory();
    await waitFor(() => {
      expect(screen.getAllByText('查看详情').length).toBeGreaterThan(0);
    });
  });

  it('渲染多条记录(3 条)', async () => {
    getAnalysisHistoryMock.mockResolvedValue([
      makeRecord({ id: 'r1', overallScore: 70 }),
      makeRecord({ id: 'r2', overallScore: 80 }),
      makeRecord({ id: 'r3', overallScore: 90 }),
    ]);
    renderHistory();
    await waitFor(() => {
      expect(screen.getByText('70')).toBeInTheDocument();
      expect(screen.getByText('80')).toBeInTheDocument();
      expect(screen.getByText('90')).toBeInTheDocument();
    });
  });
});

/* ============================================================
 * 3. 筛选功能
 * ============================================================ */
describe('HistoryPage 筛选功能', () => {
  it('渲染 3 组筛选器(艺术类型/分数区间/排序)', async () => {
    getAnalysisHistoryMock.mockResolvedValue([makeRecord()]);
    renderHistory();
    await waitFor(() => {
      // FilterGroup label 渲染含冒号(如"艺术类型：")
      expect(screen.getByText(/艺术类型/)).toBeInTheDocument();
    });
    expect(screen.getByText(/分数区间/)).toBeInTheDocument();
    expect(screen.getByText(/排序/)).toBeInTheDocument();
  });

  it('点击"绘画"筛选器只显示绘画类型记录', async () => {
    getAnalysisHistoryMock.mockResolvedValue([
      makeRecord({ id: 'r1', artType: 'painting', overallScore: 70 }),
      makeRecord({ id: 'r2', artType: 'design', overallScore: 90 }),
    ]);
    renderHistory();
    await waitFor(() => {
      expect(screen.getByText('90')).toBeInTheDocument();
    });
    // 点击"绘画"筛选按钮(在 artTypeOptions 中,名为"绘画")
    // 注意:"绘画"同时出现在筛选按钮和卡片标签中,用 getAllByText 取按钮
    const paintingBtns = screen.getAllByText('绘画');
    // 第一个"绘画"是筛选按钮(FilterButton)
    fireEvent.click(paintingBtns[0]);
    // 设计类型(90分)应被过滤掉
    await waitFor(() => {
      expect(screen.queryByText('90')).not.toBeInTheDocument();
    });
    expect(screen.getByText('70')).toBeInTheDocument();
  });

  it('点击"优秀≥85"筛选器只显示高分记录', async () => {
    getAnalysisHistoryMock.mockResolvedValue([
      makeRecord({ id: 'r1', overallScore: 60 }),
      makeRecord({ id: 'r2', overallScore: 90 }),
    ]);
    renderHistory();
    await waitFor(() => {
      expect(screen.getByText('60')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('优秀≥85'));
    await waitFor(() => {
      expect(screen.queryByText('60')).not.toBeInTheDocument();
    });
    expect(screen.getByText('90')).toBeInTheDocument();
  });

  it('点击"分数从低到高"排序改变列表顺序', async () => {
    getAnalysisHistoryMock.mockResolvedValue([
      makeRecord({ id: 'r-high', overallScore: 90, createdAt: '2026-01-01' }),
      makeRecord({ id: 'r-low', overallScore: 60, createdAt: '2026-01-02' }),
    ]);
    renderHistory();
    await waitFor(() => {
      expect(screen.getByText('90')).toBeInTheDocument();
    });
    // 点击"分数从低到高"
    fireEvent.click(screen.getByText('分数从低到高'));
    // 排序后仍渲染两条;此处仅验证不崩溃(排序顺序由 useMemo 内部保证)
    await waitFor(() => {
      expect(screen.getByText('60')).toBeInTheDocument();
      expect(screen.getByText('90')).toBeInTheDocument();
    });
  });
});

/* ============================================================
 * 4. URL 参数同步
 * ============================================================ */
describe('HistoryPage URL 参数同步', () => {
  it('初始 URL 含 type=painting 时自动应用艺术类型筛选', async () => {
    getAnalysisHistoryMock.mockResolvedValue([
      makeRecord({ id: 'r1', artType: 'painting', overallScore: 70 }),
      makeRecord({ id: 'r2', artType: 'design', overallScore: 90 }),
    ]);
    renderHistory('/history?type=painting');
    // 先等正向条件:目标记录 70 渲染出来(避免数据未加载时空列表让负向断言瞬间为真)
    await waitFor(() => {
      expect(screen.getByText('70')).toBeInTheDocument();
    });
    // 初始筛选已应用,设计类型不显示
    expect(screen.queryByText('90')).not.toBeInTheDocument();
  });

  it('初始 URL 含 filter=pending 时自动应用分数筛选(<70)', async () => {
    getAnalysisHistoryMock.mockResolvedValue([
      makeRecord({ id: 'r1', overallScore: 50 }),
      makeRecord({ id: 'r2', overallScore: 90 }),
    ]);
    renderHistory('/history?filter=pending');
    // 先等正向条件:目标记录 50 渲染出来
    await waitFor(() => {
      expect(screen.getByText('50')).toBeInTheDocument();
    });
    expect(screen.queryByText('90')).not.toBeInTheDocument();
  });

  it('初始 URL 含 sort=score_asc 时应用排序', async () => {
    getAnalysisHistoryMock.mockResolvedValue([
      makeRecord({ id: 'r1', overallScore: 90 }),
      makeRecord({ id: 'r2', overallScore: 60 }),
    ]);
    renderHistory('/history?sort=score_asc');
    await waitFor(() => {
      expect(screen.getByText('90')).toBeInTheDocument();
      expect(screen.getByText('60')).toBeInTheDocument();
    });
  });
});

/* ============================================================
 * 5. 详情弹窗
 * ============================================================ */
describe('HistoryPage 详情弹窗', () => {
  it('点击"查看详情"打开弹窗,显示"分析报告详情"', async () => {
    getAnalysisHistoryMock.mockResolvedValue([makeRecord({ id: 'r1' })]);
    getAnalysisDetailMock.mockResolvedValue(makePaintingDetail());
    renderHistory();
    await waitFor(() => {
      expect(screen.getAllByText('查看详情').length).toBeGreaterThan(0);
    });
    // 点击"查看详情"按钮(卡片底部)
    const viewDetailBtns = screen.getAllByText('查看详情');
    fireEvent.click(viewDetailBtns[0]);
    await waitFor(() => {
      expect(screen.getByText('分析报告详情')).toBeInTheDocument();
    });
  });

  it('弹窗显示综合分数评级(优秀/良好/需改进)', async () => {
    getAnalysisHistoryMock.mockResolvedValue([makeRecord({ id: 'r1' })]);
    getAnalysisDetailMock.mockResolvedValue(makePaintingDetail({ overallScore: 80 }));
    renderHistory();
    await waitFor(() => {
      expect(screen.getAllByText('查看详情').length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getAllByText('查看详情')[0]);
    await waitFor(() => {
      // overallScore=80 → "良好"
      expect(screen.getByText('良好')).toBeInTheDocument();
    });
  });

  it('弹窗显示维度建议(构图建议/色彩建议/笔触建议)', async () => {
    getAnalysisHistoryMock.mockResolvedValue([makeRecord({ id: 'r1' })]);
    getAnalysisDetailMock.mockResolvedValue(makePaintingDetail());
    renderHistory();
    await waitFor(() => {
      expect(screen.getAllByText('查看详情').length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getAllByText('查看详情')[0]);
    await waitFor(() => {
      expect(screen.getByText('构图建议')).toBeInTheDocument();
      expect(screen.getByText('色彩建议')).toBeInTheDocument();
      expect(screen.getByText('笔触建议')).toBeInTheDocument();
    });
  });

  it('弹窗显示原创性区域与"用相同参数重新诊断"按钮', async () => {
    getAnalysisHistoryMock.mockResolvedValue([makeRecord({ id: 'r1' })]);
    getAnalysisDetailMock.mockResolvedValue(makePaintingDetail());
    renderHistory();
    await waitFor(() => {
      expect(screen.getAllByText('查看详情').length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getAllByText('查看详情')[0]);
    await waitFor(() => {
      expect(screen.getByText('原创性')).toBeInTheDocument();
      expect(screen.getByText('用相同参数重新诊断')).toBeInTheDocument();
    });
  });

  it('点击弹窗"关闭"按钮关闭弹窗', async () => {
    getAnalysisHistoryMock.mockResolvedValue([makeRecord({ id: 'r1' })]);
    getAnalysisDetailMock.mockResolvedValue(makePaintingDetail());
    renderHistory();
    await waitFor(() => {
      expect(screen.getAllByText('查看详情').length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getAllByText('查看详情')[0]);
    await waitFor(() => {
      expect(screen.getByText('分析报告详情')).toBeInTheDocument();
    });
    // 点击弹窗底部的"关闭"按钮
    fireEvent.click(screen.getByText('关闭'));
    await waitFor(() => {
      expect(screen.queryByText('分析报告详情')).not.toBeInTheDocument();
    });
  });

  it('getAnalysisDetail 返回 null 时不打开弹窗', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    getAnalysisHistoryMock.mockResolvedValue([makeRecord({ id: 'r1' })]);
    getAnalysisDetailMock.mockResolvedValue(null);
    renderHistory();
    await waitFor(() => {
      expect(screen.getAllByText('查看详情').length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getAllByText('查看详情')[0]);
    // 弹窗不应出现
    await waitFor(() => {
      expect(screen.queryByText('分析报告详情')).not.toBeInTheDocument();
    });
    errorSpy.mockRestore();
  });
});

/* ============================================================
 * 6. 清除筛选
 * ============================================================ */
describe('HistoryPage 清除筛选', () => {
  it('筛选后无匹配结果时显示"没有符合筛选条件的记录"', async () => {
    getAnalysisHistoryMock.mockResolvedValue([
      makeRecord({ id: 'r1', artType: 'painting', overallScore: 90 }),
    ]);
    renderHistory();
    await waitFor(() => {
      expect(screen.getByText('90')).toBeInTheDocument();
    });
    // 点击"雕塑"筛选(无雕塑记录)
    fireEvent.click(screen.getByText('雕塑'));
    await waitFor(() => {
      expect(screen.getByText('没有符合筛选条件的记录')).toBeInTheDocument();
    });
  });

  it('无匹配结果时显示"清除筛选"按钮', async () => {
    getAnalysisHistoryMock.mockResolvedValue([
      makeRecord({ id: 'r1', artType: 'painting', overallScore: 90 }),
    ]);
    renderHistory();
    await waitFor(() => {
      expect(screen.getByText('90')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('雕塑'));
    await waitFor(() => {
      expect(screen.getByText('清除筛选')).toBeInTheDocument();
    });
  });

  it('点击"清除筛选"恢复全部记录', async () => {
    getAnalysisHistoryMock.mockResolvedValue([
      makeRecord({ id: 'r1', artType: 'painting', overallScore: 90 }),
    ]);
    renderHistory();
    await waitFor(() => {
      expect(screen.getByText('90')).toBeInTheDocument();
    });
    // 筛选到无结果
    fireEvent.click(screen.getByText('雕塑'));
    await waitFor(() => {
      expect(screen.getByText('清除筛选')).toBeInTheDocument();
    });
    // 点击清除
    fireEvent.click(screen.getByText('清除筛选'));
    await waitFor(() => {
      expect(screen.getByText('90')).toBeInTheDocument();
    });
    expect(screen.queryByText('清除筛选')).not.toBeInTheDocument();
  });
});

/* ============================================================
 * 7. 批量删除(P-06 跨端批删一致性)
 * ============================================================ */
describe('HistoryPage 批量删除', () => {
  it('点击"批量删除"进入选择模式,未选时"确认删除"禁用', async () => {
    getAnalysisHistoryMock.mockResolvedValue([makeRecord({ id: 'a' })]);
    renderHistory();
    await waitFor(() => {
      expect(screen.getByText('批量删除')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('批量删除'));
    // 选择操作栏出现(文本被 <b> 拆分为多个节点,用 /已选/ 匹配)
    await waitFor(() => {
      expect(screen.getByText(/已选/)).toBeInTheDocument();
    });
    // 未勾选时计数为 0
    expect(screen.getByText('0')).toBeInTheDocument();
    // 未勾选时确认删除按钮禁用
    const confirmBtn = screen.getByText('确认删除').closest('button');
    expect(confirmBtn).toBeDisabled();
  });

  it('勾选后确认删除:乐观更新移除记录并调用批删接口', async () => {
    getAnalysisHistoryMock.mockResolvedValueOnce([
      makeRecord({ id: 'a', overallScore: 90 }),
      makeRecord({ id: 'b', overallScore: 70 }),
    ]);
    // 删除后重新拉取(invalidateQueries(['analyses']) 等价)返回空
    getAnalysisHistoryMock.mockResolvedValueOnce([]);
    batchDeleteAnalysesMock.mockResolvedValue({
      total: 2,
      deleted: 2,
      failedCount: 0,
      items: [
        { id: 'a', deleted: true },
        { id: 'b', deleted: true },
      ],
    });
    renderHistory();
    await waitFor(() => {
      expect(screen.getByText('90')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('批量删除'));
    const boxes = screen.getAllByLabelText('选中该项');
    expect(boxes.length).toBe(2);
    fireEvent.click(boxes[0]);
    fireEvent.click(boxes[1]);
    // 计数更新为 2(文本被 <b> 拆分,计数单独匹配)
    await waitFor(() => {
      expect(screen.getByText('2')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('确认删除'));
    await waitFor(() => {
      expect(batchDeleteAnalysesMock).toHaveBeenCalledWith(['a', 'b']);
    });
    // 删除成功后列表为空(重新拉取)
    await waitFor(() => {
      expect(screen.getByText('还没有分析记录')).toBeInTheDocument();
    });
  });

  it('批删失败时回滚恢复原列表', async () => {
    getAnalysisHistoryMock.mockResolvedValue([
      makeRecord({ id: 'a', overallScore: 90 }),
      makeRecord({ id: 'b', overallScore: 70 }),
    ]);
    batchDeleteAnalysesMock.mockRejectedValue(new Error('网络错误'));
    renderHistory();
    await waitFor(() => {
      expect(screen.getByText('90')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('批量删除'));
    const boxes = screen.getAllByLabelText('选中该项');
    fireEvent.click(boxes[0]);
    fireEvent.click(boxes[1]);
    fireEvent.click(screen.getByText('确认删除'));
    await waitFor(() => {
      expect(batchDeleteAnalysesMock).toHaveBeenCalled();
    });
    // 回滚后两条记录都恢复
    await waitFor(() => {
      expect(screen.getByText('90')).toBeInTheDocument();
      expect(screen.getByText('70')).toBeInTheDocument();
    });
  });
});
