// ============================================================
// AnalysisInsights 组件测试 (Phase 3:分析报告增强)
// 对应源码: src/components/AnalysisInsights.tsx
//
// 测试范围:
//   1. 本地分析 ID(非 UUID)→ 不渲染
//   2. 加载中 → 显示加载提示
//   3. 接口失败 → 静默不渲染(降级)
//   4. 有数据 → 渲染标题/历史对比分数/成长趋势区块
//   5. 无历史数据 → 显示引导文案
//   6. 趋势徽章:up / down / flat 文案
//
// Mock 策略:
//   - mock services/api 的 getReportData
//   - Recharts ResponsiveContainer 在 jsdom 下宽高为 0,不断言图表内部元素
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import AnalysisInsights from '../AnalysisInsights';
import type { ReportDataResponse } from '../../types/api-contract';

/* ---------- mock 依赖 ---------- */

const getReportDataMock = vi.fn<(...args: unknown[]) => Promise<ReportDataResponse>>();
vi.mock('../../services/api', () => ({
  getReportData: (...args: unknown[]) => getReportDataMock(...args),
}));

/* recharts: jsdom 无布局且缺 ResizeObserver,替换为轻量 stub(与 GrowthPage 测试同款) */
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  LineChart: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="line-chart">{children}</div>
  ),
  Line: () => <div data-testid="line" />,
  XAxis: () => <div data-testid="x-axis" />,
  YAxis: () => <div data-testid="y-axis" />,
  Tooltip: () => <div data-testid="tooltip" />,
  RadarChart: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="radar-chart">{children}</div>
  ),
  PolarGrid: () => <div data-testid="polar-grid" />,
  PolarAngleAxis: () => <div data-testid="polar-angle-axis" />,
  PolarRadiusAxis: () => <div data-testid="polar-radius-axis" />,
  Radar: () => <div data-testid="radar" />,
}));

/* ---------- 测试数据工厂 ---------- */

const SERVER_ID = '123e4567-e89b-42d3-a456-426614174000';
const LOCAL_ID = 'analysis-1717500000000';

function makeReportData(overrides: Partial<ReportDataResponse> = {}): ReportDataResponse {
  return {
    analysis: {
      id: SERVER_ID,
      tenantId: 't-1',
      userId: 'u-1',
      workType: 'painting',
      imageUrl: 'https://example.com/work.png',
      title: null,
      remark: null,
      status: 'succeeded',
      result: { overallScore: 85 },
      failureReason: null,
      durationMs: 1200,
      createdAt: '2026-08-01T00:00:00.000Z',
      completedAt: '2026-08-01T00:00:01.200Z',
    } as unknown as ReportDataResponse['analysis'],
    radarData: [
      { dimension: 'composition', label: '构图', score: 82, fullMark: 100 },
      { dimension: 'color', label: '色彩', score: 78, fullMark: 100 },
      { dimension: 'brushwork', label: '笔触', score: 85, fullMark: 100 },
    ],
    historyComparison: {
      previous: { score: 76, date: '2026-07-20T00:00:00.000Z' },
      average: 74,
      trend: 'up',
    },
    growthMini: [
      { date: '2026-07-01T00:00:00.000Z', score: 70 },
      { date: '2026-07-20T00:00:00.000Z', score: 76 },
      { date: '2026-08-01T00:00:00.000Z', score: 85 },
    ],
    classPercentile: null,
    ...overrides,
  };
}

beforeEach(() => {
  getReportDataMock.mockReset();
});

/* ============================================================
 * 1. 渲染条件
 * ============================================================ */
describe('AnalysisInsights 渲染条件', () => {
  it('本地分析 ID(非 UUID)不渲染,且不发起请求', () => {
    const { container } = render(<AnalysisInsights analysisId={LOCAL_ID} />);
    expect(container).toBeEmptyDOMElement();
    expect(getReportDataMock).not.toHaveBeenCalled();
  });

  it('接口失败时静默不渲染(降级)', async () => {
    getReportDataMock.mockRejectedValue(new Error('network'));
    const { container } = render(<AnalysisInsights analysisId={SERVER_ID} />);
    await waitFor(() => {
      expect(getReportDataMock).toHaveBeenCalledWith(SERVER_ID);
    });
    await waitFor(() => {
      expect(container).toBeEmptyDOMElement();
    });
  });

  it('加载中显示"正在聚合历史数据"提示', () => {
    getReportDataMock.mockReturnValue(new Promise(() => {}));
    render(<AnalysisInsights analysisId={SERVER_ID} />);
    expect(screen.getByText('正在聚合历史数据…')).toBeInTheDocument();
  });
});

/* ============================================================
 * 2. 有数据渲染
 * ============================================================ */
describe('AnalysisInsights 数据渲染', () => {
  it('渲染"维度洞察"标题与历史对比分数', async () => {
    getReportDataMock.mockResolvedValue(makeReportData());
    render(<AnalysisInsights analysisId={SERVER_ID} />);
    await waitFor(() => {
      expect(screen.getByText('维度洞察')).toBeInTheDocument();
    });
    // 历史对比:本次 85 / 上次 76 / 平均 74
    expect(screen.getByText('85')).toBeInTheDocument();
    expect(screen.getByText('76')).toBeInTheDocument();
    expect(screen.getByText('74')).toBeInTheDocument();
  });

  it('渲染成长趋势区块标题(近 3 次)', async () => {
    getReportDataMock.mockResolvedValue(makeReportData());
    render(<AnalysisInsights analysisId={SERVER_ID} />);
    await waitFor(() => {
      expect(screen.getByText('成长趋势(近 3 次)')).toBeInTheDocument();
    });
  });

  it('趋势 up 显示"较上次进步"徽章', async () => {
    getReportDataMock.mockResolvedValue(makeReportData());
    render(<AnalysisInsights analysisId={SERVER_ID} />);
    await waitFor(() => {
      expect(screen.getByText('较上次进步')).toBeInTheDocument();
    });
  });

  it('趋势 down 显示"较上次回落"徽章', async () => {
    getReportDataMock.mockResolvedValue(
      makeReportData({
        historyComparison: {
          previous: { score: 90, date: '2026-07-20T00:00:00.000Z' },
          average: 80,
          trend: 'down',
        },
      }),
    );
    render(<AnalysisInsights analysisId={SERVER_ID} />);
    await waitFor(() => {
      expect(screen.getByText('较上次回落')).toBeInTheDocument();
    });
  });

  it('趋势 flat 显示"与上次持平"徽章', async () => {
    getReportDataMock.mockResolvedValue(
      makeReportData({
        historyComparison: {
          previous: { score: 85, date: '2026-07-20T00:00:00.000Z' },
          average: 85,
          trend: 'flat',
        },
      }),
    );
    render(<AnalysisInsights analysisId={SERVER_ID} />);
    await waitFor(() => {
      expect(screen.getByText('与上次持平')).toBeInTheDocument();
    });
  });
});

/* ============================================================
 * 3. 无历史数据降级
 * ============================================================ */
describe('AnalysisInsights 无历史数据', () => {
  it('无历史且无趋势时显示引导文案', async () => {
    getReportDataMock.mockResolvedValue(
      makeReportData({
        historyComparison: { previous: null, average: null, trend: null },
        growthMini: [{ date: '2026-08-01T00:00:00.000Z', score: 85 }],
      }),
    );
    render(<AnalysisInsights analysisId={SERVER_ID} />);
    await waitFor(() => {
      expect(
        screen.getByText(/完成更多同类型作品诊断后/),
      ).toBeInTheDocument();
    });
  });
});
