// ============================================================
// GrowthPage 页面单元测试 (任务包 E:块3)
// 对应源码: src/pages/GrowthPage.tsx
//
// 测试范围:
//   1. loading 态(骨架屏)
//   2. 数据不足空态(historyCount < 3)
//   3. 有数据态(统计卡片 / 智能洞察 / 图表 / 维度切换)
//   4. 维度切换按钮(toggleDim)显隐控制
//   5. 数据加载失败静默不崩溃
//
// Mock 策略:
//   - data-service: getGrowthData / getAnalysisHistory 可控返回
//   - recharts: 替换为轻量 stub(jsdom 无布局尺寸,避免 ResponsiveContainer 0 尺寸告警)
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import GrowthPage from '../GrowthPage';
import type { GrowthData } from '../../types';

/* ---------- mock 依赖 ---------- */

const getGrowthDataMock = vi.fn<(...args: unknown[]) => Promise<GrowthData[]>>();
const getAnalysisHistoryMock = vi.fn<(...args: unknown[]) => Promise<unknown[]>>();
vi.mock('../../services/data-service', () => ({
  getGrowthData: (...args: unknown[]) => getGrowthDataMock(...args),
  getAnalysisHistory: (...args: unknown[]) => getAnalysisHistoryMock(...args),
}));

/* recharts: jsdom 无布局,ResponsiveContainer 渲染 0 尺寸会输出告警且不渲染子节点。
 * 这里替换为轻量 stub,使页面 JSX 仍被求值(覆盖率计入页面而非图表库)。 */
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  AreaChart: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="area-chart">{children}</div>
  ),
  Area: ({ name }: { name?: string }) => <div data-testid={`area-${name}`} />,
  XAxis: () => <div data-testid="x-axis" />,
  YAxis: () => <div data-testid="y-axis" />,
  CartesianGrid: () => <div data-testid="cartesian-grid" />,
  Tooltip: () => <div data-testid="tooltip" />,
  Legend: () => <div data-testid="legend" />,
}));

/* ---------- 测试数据工厂 ---------- */

function makeGrowthData(overrides: Partial<GrowthData> = {}): GrowthData {
  return {
    date: '2026-08-01',
    dimension1: 70,
    dimension2: 75,
    dimension3: 80,
    overall: 78,
    ...overrides,
  };
}

/** 构造一组有上升趋势的成长数据(用于测试趋势判定 up) */
function makeUpTrendData(): GrowthData[] {
  return [
    makeGrowthData({ date: '2026-07-01', dimension1: 60, dimension2: 65, dimension3: 70, overall: 65 }),
    makeGrowthData({ date: '2026-07-15', dimension1: 70, dimension2: 72, dimension3: 78, overall: 73 }),
    makeGrowthData({ date: '2026-08-01', dimension1: 80, dimension2: 82, dimension3: 88, overall: 83 }),
  ];
}

/* ---------- 渲染辅助 ---------- */

function renderGrowth() {
  return render(
    <MemoryRouter initialEntries={['/growth']}>
      <GrowthPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  getGrowthDataMock.mockReset();
  getAnalysisHistoryMock.mockReset();
  // 默认空数据
  getGrowthDataMock.mockResolvedValue([]);
  getAnalysisHistoryMock.mockResolvedValue([]);
});

/* ============================================================
 * 1. loading 态
 * ============================================================ */
describe('GrowthPage loading 态', () => {
  it('加载中渲染"成长曲线"标题与骨架屏', async () => {
    // 让 Promise 永不 resolve,保持 loading 态
    getGrowthDataMock.mockReturnValue(new Promise(() => {}));
    getAnalysisHistoryMock.mockReturnValue(new Promise(() => {}));
    renderGrowth();
    expect(screen.getByText('成长曲线')).toBeInTheDocument();
    expect(screen.getByText('个人成长追踪')).toBeInTheDocument();
  });
});

/* ============================================================
 * 2. 数据不足空态
 * ============================================================ */
describe('GrowthPage 空态', () => {
  it('historyCount<3 时显示"数据还不足以生成曲线"空态', async () => {
    getAnalysisHistoryMock.mockResolvedValue([{}, {}]); // 2 条 < 3
    renderGrowth();
    await waitFor(() => {
      expect(screen.getByText('数据还不足以生成曲线')).toBeInTheDocument();
    });
    expect(screen.getByText('完成3次以上分析后即可查看成长趋势')).toBeInTheDocument();
  });

  it('空态渲染"去分析"引导按钮,指向 /analyze', async () => {
    getAnalysisHistoryMock.mockResolvedValue([]);
    renderGrowth();
    await waitFor(() => {
      expect(screen.getByText('去分析')).toBeInTheDocument();
    });
    const link = screen.getByText('去分析').closest('a');
    expect(link).toHaveAttribute('href', '/analyze');
  });
});

/* ============================================================
 * 3. 有数据态
 * ============================================================ */
describe('GrowthPage 有数据态', () => {
  beforeEach(() => {
    getGrowthDataMock.mockResolvedValue(makeUpTrendData());
    getAnalysisHistoryMock.mockResolvedValue(Array.from({ length: 5 }, () => ({})));
  });

  it('渲染 4 个统计卡片(平均评分/最高评分/分析次数/当前趋势)', async () => {
    renderGrowth();
    await waitFor(() => {
      expect(screen.getByText('平均评分')).toBeInTheDocument();
    });
    expect(screen.getByText('最高评分')).toBeInTheDocument();
    expect(screen.getByText('分析次数')).toBeInTheDocument();
    // "当前趋势"在页面中出现多次(统计卡片 + 洞察区),用 getAllByText 校验
    expect(screen.getAllByText('当前趋势').length).toBeGreaterThan(0);
  });

  it('分析次数卡片显示 historyCount(5)', async () => {
    renderGrowth();
    await waitFor(() => {
      expect(screen.getByText('5')).toBeInTheDocument();
    });
  });

  it('渲染"智能成长洞察"区块(整体变化/最强维度/波动指数)', async () => {
    renderGrowth();
    await waitFor(() => {
      expect(screen.getByText('智能成长洞察')).toBeInTheDocument();
    });
    expect(screen.getByText('整体变化')).toBeInTheDocument();
    expect(screen.getByText('最强维度')).toBeInTheDocument();
    expect(screen.getByText('波动指数')).toBeInTheDocument();
  });

  it('渲染"能力成长趋势"图表区与维度切换按钮', async () => {
    renderGrowth();
    await waitFor(() => {
      expect(screen.getByText('能力成长趋势')).toBeInTheDocument();
    });
    // 维度名在图表 legend / 标题 / 按钮中多次出现,用 getAllByText 校验存在
    expect(screen.getAllByText('维度一').length).toBeGreaterThan(0);
    expect(screen.getAllByText('维度二').length).toBeGreaterThan(0);
    expect(screen.getAllByText('维度三').length).toBeGreaterThan(0);
    expect(screen.getAllByText('综合').length).toBeGreaterThan(0);
  });

  it('上升趋势时当前趋势显示"上升趋势"', async () => {
    renderGrowth();
    await waitFor(() => {
      expect(screen.getAllByText('上升趋势').length).toBeGreaterThan(0);
    });
  });
});

/* ============================================================
 * 4. 维度切换交互
 * ============================================================ */
describe('GrowthPage 维度切换', () => {
  beforeEach(() => {
    getGrowthDataMock.mockResolvedValue(makeUpTrendData());
    getAnalysisHistoryMock.mockResolvedValue(Array.from({ length: 5 }, () => ({})));
  });

  it('点击"维度一"按钮切换 aria-pressed 状态', async () => {
    renderGrowth();
    // "维度一"在多处出现,需找到带 aria-pressed 的切换按钮
    await waitFor(() => {
      expect(screen.getAllByText('维度一').length).toBeGreaterThan(0);
    });
    // 找到所有含"维度一"文本且属于 button 的元素
    const dim1Buttons = screen.getAllByText('维度一')
      .map((el) => el.closest('button'))
      .filter((b): b is HTMLButtonElement => b !== null);
    expect(dim1Buttons.length).toBeGreaterThan(0);
    const dim1Btn = dim1Buttons[0];
    // 初始为 pressed(可见)
    expect(dim1Btn).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(dim1Btn);
    expect(dim1Btn).toHaveAttribute('aria-pressed', 'false');
    // 再次点击恢复
    fireEvent.click(dim1Btn);
    expect(dim1Btn).toHaveAttribute('aria-pressed', 'true');
  });

  it('点击"综合"按钮隐藏综合曲线', async () => {
    renderGrowth();
    await waitFor(() => {
      expect(screen.getAllByText('综合').length).toBeGreaterThan(0);
    });
    const overallButtons = screen.getAllByText('综合')
      .map((el) => el.closest('button'))
      .filter((b): b is HTMLButtonElement => b !== null);
    expect(overallButtons.length).toBeGreaterThan(0);
    fireEvent.click(overallButtons[0]);
    expect(overallButtons[0]).toHaveAttribute('aria-pressed', 'false');
  });
});

/* ============================================================
 * 5. 错误处理
 * ============================================================ */
describe('GrowthPage 错误处理', () => {
  it('getGrowthData 抛错时静默不崩溃(仍渲染标题)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    getGrowthDataMock.mockRejectedValue(new Error('network'));
    getAnalysisHistoryMock.mockResolvedValue([]);
    renderGrowth();
    await waitFor(() => {
      expect(screen.getByText('成长曲线')).toBeInTheDocument();
    });
    errorSpy.mockRestore();
  });
});
