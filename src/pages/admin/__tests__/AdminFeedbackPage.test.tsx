// ============================================================
// AdminFeedbackPage 页面单元测试(反馈闭环 Phase 5 批次②)
// 对应源码: src/pages/admin/AdminFeedbackPage.tsx
//
// 测试范围:
//   1. KPI 卡片渲染(总反馈/有用率/近 7 天/独立用户/覆盖分析)
//   2. 维度分布 + 类型分布行渲染(飞轮定位视角)
//   3. 趋势图渲染(日期起止标签)
//   4. owner 视角:导出范围选择器可见;导出点击 → tenantId=all 透传
//   5. admin 视角:无范围选择器 + 数据主权提示;导出无 tenantId
//   6. 导出结果反馈(成功行数 / 失败文案)
//   7. 空数据占位
//
// Mock 策略:
//   - admin-feedback-api:五个接口可控返回(页面轮询走 usePolling)
//   - useAuth:可控角色(owner/admin)
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AdminFeedbackPage from '../AdminFeedbackPage';
import type {
  AdminFeedbackOverviewResponse,
  AdminFeedbackByDimensionResponse,
  AdminFeedbackByWorkTypeResponse,
  AdminFeedbackTrendResponse,
} from '../../../types/admin';

/* ---------- mock 依赖 ---------- */

const getFeedbackOverviewMock = vi.fn<() => Promise<AdminFeedbackOverviewResponse>>();
const getFeedbackByDimensionMock = vi.fn<() => Promise<AdminFeedbackByDimensionResponse>>();
const getFeedbackByWorkTypeMock = vi.fn<() => Promise<AdminFeedbackByWorkTypeResponse>>();
const getFeedbackTrendMock = vi.fn<() => Promise<AdminFeedbackTrendResponse>>();
const exportFeedbackTrainingDataMock = vi.fn<(q?: { tenantId?: string; startDate?: string; endDate?: string }) => Promise<number>>();

vi.mock('../../../services/admin-feedback-api', () => ({
  getFeedbackOverview: () => getFeedbackOverviewMock(),
  getFeedbackByDimension: () => getFeedbackByDimensionMock(),
  getFeedbackByWorkType: () => getFeedbackByWorkTypeMock(),
  getFeedbackTrend: () => getFeedbackTrendMock(),
  exportFeedbackTrainingData: (q?: { tenantId?: string; startDate?: string; endDate?: string }) =>
    exportFeedbackTrainingDataMock(q),
}));

/** 可控登录用户(角色切换:owner 全局视角 / admin 租户视角) */
let mockRole: 'owner' | 'admin' = 'owner';
vi.mock('../../../hooks/useAuth', () => ({
  useAuth: () => ({
    user: {
      id: 'u-test',
      role: mockRole,
      name: '测试管理员',
      tenantId: 't-test',
    },
  }),
}));

/* ---------- 测试数据工厂 ---------- */

function makeOverview(overrides: Partial<AdminFeedbackOverviewResponse> = {}): AdminFeedbackOverviewResponse {
  return {
    startDate: null,
    endDate: null,
    totalCount: 120,
    upCount: 80,
    downCount: 40,
    usefulRate: 0.6667,
    uniqueUsers: 25,
    analysesCovered: 50,
    last7DaysCount: 30,
    ...overrides,
  };
}

function makeDimensionStats(): AdminFeedbackByDimensionResponse {
  return {
    startDate: null,
    endDate: null,
    stats: [
      { dimension: '造型', totalCount: 8, upCount: 3, downCount: 5, usefulRate: 0.375 },
      { dimension: '构图', totalCount: 6, upCount: 4, downCount: 2, usefulRate: 0.6667 },
    ],
  };
}

function makeWorkTypeStats(): AdminFeedbackByWorkTypeResponse {
  return {
    startDate: null,
    endDate: null,
    stats: [
      { workType: 'painting', totalCount: 30, upCount: 20, downCount: 10, usefulRate: 0.6667 },
    ],
  };
}

function makeTrend(): AdminFeedbackTrendResponse {
  return {
    days: 14,
    dataPoints: [
      { date: '2026-09-01', totalCount: 5, upCount: 3, downCount: 2 },
      { date: '2026-09-02', totalCount: 9, upCount: 6, downCount: 3 },
    ],
  };
}

/* ---------- 渲染辅助 ---------- */

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/admin/feedback']}>
      <AdminFeedbackPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRole = 'owner';
  getFeedbackOverviewMock.mockResolvedValue(makeOverview());
  getFeedbackByDimensionMock.mockResolvedValue(makeDimensionStats());
  getFeedbackByWorkTypeMock.mockResolvedValue(makeWorkTypeStats());
  getFeedbackTrendMock.mockResolvedValue(makeTrend());
  exportFeedbackTrainingDataMock.mockResolvedValue(120);
});

/* ============================================================
 * 1. KPI 卡片 + 标题
 * ============================================================ */
describe('AdminFeedbackPage KPI 卡片', () => {
  it('渲染标题与五张 KPI 卡片数值', async () => {
    renderPage();

    expect(screen.getByText('标注反馈看板')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('120')).toBeInTheDocument(); // 总反馈
    });
    expect(screen.getAllByText('66.7%').length).toBeGreaterThan(0); // 有用率(KPI 卡 + 分布行共用数值)
    expect(screen.getByText('30')).toBeInTheDocument(); // 近 7 天(与总反馈数值不同,无歧义)
    expect(screen.getByText('25')).toBeInTheDocument(); // 独立用户
    expect(screen.getByText('50')).toBeInTheDocument(); // 覆盖分析
    expect(screen.getByText('认同 80 · 没用 40')).toBeInTheDocument();
  });
});

/* ============================================================
 * 2. 维度分布 + 类型分布
 * ============================================================ */
describe('AdminFeedbackPage 分布区块', () => {
  it('渲染维度分布行(按总量降序)与类型分布中文标签', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('造型')).toBeInTheDocument();
    });
    expect(screen.getByText('构图')).toBeInTheDocument();
    // 类型分布:painting → 绘画
    expect(screen.getByText('绘画')).toBeInTheDocument();
    // 条数(维度 8 条 / 类型 30 条)
    expect(screen.getByText('8 条')).toBeInTheDocument();
    expect(screen.getByText('30 条')).toBeInTheDocument();
  });

  it('空数据时渲染「暂无反馈数据」占位', async () => {
    getFeedbackOverviewMock.mockResolvedValue(makeOverview({ totalCount: 0, upCount: 0, downCount: 0, usefulRate: 0, uniqueUsers: 0, analysesCovered: 0, last7DaysCount: 0 }));
    getFeedbackByDimensionMock.mockResolvedValue({ startDate: null, endDate: null, stats: [] });
    getFeedbackByWorkTypeMock.mockResolvedValue({ startDate: null, endDate: null, stats: [] });
    getFeedbackTrendMock.mockResolvedValue({ days: 14, dataPoints: [] });

    renderPage();

    await waitFor(() => {
      expect(screen.getAllByText('暂无反馈数据').length).toBeGreaterThan(0);
    });
  });
});

/* ============================================================
 * 3. 趋势图
 * ============================================================ */
describe('AdminFeedbackPage 趋势图', () => {
  it('渲染趋势日期起止标签', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('09-01')).toBeInTheDocument();
      expect(screen.getByText('09-02')).toBeInTheDocument();
    });
  });
});

/* ============================================================
 * 4. owner 视角导出
 * ============================================================ */
describe('AdminFeedbackPage 导出(owner 视角)', () => {
  it('显示导出范围选择器;点击导出透传 tenantId=all 并显示行数结果', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('全局(所有租户)')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /导出训练数据/ }));

    await waitFor(() => {
      expect(exportFeedbackTrainingDataMock).toHaveBeenCalledWith({ tenantId: 'all' });
    });
    expect(screen.getByText('已导出 120 行训练数据(.jsonl)')).toBeInTheDocument();
  });

  it('填写日期范围后导出透传 startDate/endDate', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('全局(所有租户)')).toBeInTheDocument();
    });
    fireEvent.change(screen.getByLabelText(/开始日期/), { target: { value: '2026-09-01' } });
    fireEvent.click(screen.getByRole('button', { name: /导出训练数据/ }));

    await waitFor(() => {
      expect(exportFeedbackTrainingDataMock).toHaveBeenCalledWith({
        tenantId: 'all',
        startDate: '2026-09-01',
      });
    });
  });

  it('导出失败时显示错误文案', async () => {
    exportFeedbackTrainingDataMock.mockRejectedValue(new Error('导出失败(HTTP 403)'));
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /导出训练数据/ })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /导出训练数据/ }));

    await waitFor(() => {
      expect(screen.getByText('导出失败(HTTP 403)')).toBeInTheDocument();
    });
  });
});

/* ============================================================
 * 5. admin 视角(租户数据主权)
 * ============================================================ */
describe('AdminFeedbackPage 导出(admin 视角)', () => {
  it('无导出范围选择器 + 数据主权提示;导出不携带 tenantId', async () => {
    mockRole = 'admin';
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('数据主权:租户管理员仅可导出本租户的反馈数据')).toBeInTheDocument();
    });
    // owner 专属的范围选择器不存在
    expect(screen.queryByText('全局(所有租户)')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /导出训练数据/ }));

    await waitFor(() => {
      expect(exportFeedbackTrainingDataMock).toHaveBeenCalledWith({});
    });
  });
});
