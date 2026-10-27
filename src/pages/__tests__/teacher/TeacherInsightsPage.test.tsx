// ============================================================
// TeacherInsightsPage 页面测试(反馈闭环 Phase 5 批次④)
// 对应源码: src/pages/teacher/TeacherInsightsPage.tsx
//
// 测试范围:
//   1. 画像渲染:KPI 行(总数/密度/一致率)+ 四动作分布(计数·占比)
//   2. 画像空态:无批注 → 引导文案 + 不渲染 KPI
//   3. 采纳历史:档案名/建议键标签/前后值(positiveRatio 百分比)/已删档案兜底
//   4. 采纳历史空态:引导链接到评分档案
//   5. 刷新交互:重新调用两端点
//   6. API 失败:静默不炸(空态展示)
//
// Mock 策略:
//   - vi.mock services/grading-profile-api(画像/采纳两函数 + Editor 依赖三函数 stub)
//   - Link 用真实 MemoryRouter 包裹(采纳列表含档案链接)
//   - ToastProvider 真实包裹
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mocks = vi.hoisted(() => ({
  insights: vi.fn(),
  adoptions: vi.fn(),
}));

vi.mock('../../../services/grading-profile-api', () => ({
  // 批次④画像页两函数
  getTeacherInsights: mocks.insights,
  getMySuggestionAdoptions: mocks.adoptions,
  // GradingProfileEditor(经 formatStyleSuggestionValue 导入链)依赖的函数 stub
  updateGradingProfile: vi.fn(),
  getProfileSuggestions: vi.fn(),
  recordSuggestionAdoption: vi.fn(),
}));

import TeacherInsightsPage from '../../teacher/TeacherInsightsPage';
import { ToastProvider } from '../../../components/ToastProvider';
import type {
  GradingTeacherInsightsResponse,
  GradingMyAdoptionsResponse,
} from '../../../types/grading-profile';

// ============================================================
// 测试数据工厂
// ============================================================

function buildInsights(
  overrides: Partial<GradingTeacherInsightsResponse['stats']> = {},
): GradingTeacherInsightsResponse {
  return {
    teacherId: 'user_teacher_001',
    stats: {
      annotationCount: 20,
      reviewedWorks: 5,
      annotationDensity: 4,
      actionCounts: { supplement: 4, correct: 8, confirm: 6, reject: 2 },
      actionRatios: { supplement: 0.2, correct: 0.4, confirm: 0.3, reject: 0.1 },
      upCount: 0,
      downCount: 0,
      aiAgreementRate: 0.75,
      lastActiveAt: '2026-09-08T10:00:00.000Z',
      ...overrides,
    },
  };
}

function buildAdoptions(
  items: GradingMyAdoptionsResponse['items'] = [],
): GradingMyAdoptionsResponse {
  return { items };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <TeacherInsightsPage />
      </ToastProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ============================================================
// 1. 画像渲染
// ============================================================

describe('TeacherInsightsPage 画像渲染(批次④)', () => {
  it('KPI 行(总数/密度/一致率)+ 四动作分布(计数·占比)', async () => {
    mocks.insights.mockResolvedValue(buildInsights());
    mocks.adoptions.mockResolvedValue(buildAdoptions());
    renderPage();

    // KPI 值(一致率 75%)
    expect(await screen.findByTestId('kpi-批注总数')).toHaveTextContent('20');
    expect(screen.getByTestId('kpi-批注总数')).toHaveTextContent('5 幅作品');
    expect(screen.getByTestId('kpi-批注密度')).toHaveTextContent('4.0');
    expect(screen.getByTestId('kpi-AI 一致率')).toHaveTextContent('75%');

    // 四动作分布:标签 + 计数·占比
    const correct = screen.getByTestId('action-bar-correct');
    expect(correct).toBeInTheDocument();
    expect(screen.getByText('纠正 AI')).toBeInTheDocument();
    expect(screen.getByText('确认 AI')).toBeInTheDocument();
    expect(screen.getByText('8 条 · 40%')).toBeInTheDocument();
    expect(screen.getByText('6 条 · 30%')).toBeInTheDocument();
    expect(screen.getByText('4 条 · 20%')).toBeInTheDocument();
    expect(screen.getByText('2 条 · 10%')).toBeInTheDocument();
  });

  it('画像空态:无批注 → 引导文案 + KPI 不渲染', async () => {
    mocks.insights.mockResolvedValue(
      buildInsights({
        annotationCount: 0,
        reviewedWorks: 0,
        annotationDensity: 0,
        actionCounts: { supplement: 0, correct: 0, confirm: 0, reject: 0 },
        actionRatios: { supplement: 0, correct: 0, confirm: 0, reject: 0 },
        aiAgreementRate: null,
        lastActiveAt: null,
      }),
    );
    mocks.adoptions.mockResolvedValue(buildAdoptions());
    renderPage();

    expect(await screen.findByText('暂无批注数据')).toBeInTheDocument();
    expect(
      screen.getByText(/在班级评审页对 AI 标注做批注/),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('kpi-批注总数')).not.toBeInTheDocument();
  });
});

// ============================================================
// 3. 采纳历史
// ============================================================

describe('TeacherInsightsPage 采纳历史(批次④)', () => {
  it('历史列表:档案名/建议键/前后值(positiveRatio 百分比)/时间', async () => {
    mocks.insights.mockResolvedValue(buildInsights());
    mocks.adoptions.mockResolvedValue(
      buildAdoptions([
        {
          id: 'adopt-001',
          tenantId: 't-001',
          teacherId: 'user_teacher_001',
          profileId: 'gp_tenant_001',
          profileName: '联考素描 · 本校强化档',
          suggestionKey: 'diagnosisIntensity',
          beforeValue: 3,
          afterValue: 4,
          suggestionBasis: { overrideRatio: 0.4 },
          createdAt: '2026-09-08T00:00:00.000Z',
        },
        {
          id: 'adopt-002',
          tenantId: 't-001',
          teacherId: 'user_teacher_001',
          profileId: 'gp_tenant_002',
          profileName: '色彩反馈 · 温和档',
          suggestionKey: 'positiveRatio',
          beforeValue: 0.5,
          afterValue: 0.45,
          suggestionBasis: { annotationDensity: 4 },
          createdAt: '2026-09-07T00:00:00.000Z',
        },
      ]),
    );
    renderPage();

    const list = await screen.findByTestId('adoption-list');
    expect(list).toBeInTheDocument();

    // 条目 1:档案名 + 建议键 + 原值格式(3→4)
    expect(screen.getByText('联考素描 · 本校强化档')).toBeInTheDocument();
    expect(screen.getByText('诊断强度')).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(screen.getByText('45%')).toBeInTheDocument();
    // 条目 2:档案名 + 建议键(百分比格式来自 positiveRatio)
    expect(screen.getByText('色彩反馈 · 温和档')).toBeInTheDocument();
    expect(screen.getByText('正面反馈占比')).toBeInTheDocument();
    expect(screen.getAllByText('查看档案')).toHaveLength(2);
  });

  it('已删档案兜底:profileName=null → 「已删除档案」+ 档案列表链接', async () => {
    mocks.insights.mockResolvedValue(buildInsights());
    mocks.adoptions.mockResolvedValue(
      buildAdoptions([
        {
          id: 'adopt-gone',
          tenantId: 't-001',
          teacherId: 'user_teacher_001',
          profileId: 'gp_deleted',
          profileName: null,
          suggestionKey: 'toneStrictness',
          beforeValue: 3,
          afterValue: 2,
          suggestionBasis: { confirmRatio: 0.6 },
          createdAt: '2026-09-05T00:00:00.000Z',
        },
      ]),
    );
    renderPage();

    expect(await screen.findByText('已删除档案')).toBeInTheDocument();
    expect(screen.getByText(/档案已删除,仅存审计记录/)).toBeInTheDocument();
    expect(screen.getByText('档案列表')).toBeInTheDocument();
    expect(screen.queryByText('查看档案')).not.toBeInTheDocument();
  });

  it('采纳历史空态:引导链接到评分档案', async () => {
    mocks.insights.mockResolvedValue(buildInsights());
    mocks.adoptions.mockResolvedValue(buildAdoptions());
    renderPage();

    expect(await screen.findByText('暂无采纳记录')).toBeInTheDocument();
    const link = screen.getByText('前往评分档案');
    expect(link.closest('a')).toHaveAttribute('href', '/teacher/grading-profiles');
  });
});

// ============================================================
// 5. 交互与容错
// ============================================================

describe('TeacherInsightsPage 交互与容错(批次④)', () => {
  it('刷新按钮重新调用两端点', async () => {
    mocks.insights.mockResolvedValue(buildInsights());
    mocks.adoptions.mockResolvedValue(buildAdoptions());
    renderPage();

    await screen.findByTestId('insights-stats');
    fireEvent.click(screen.getByRole('button', { name: /刷新/ }));

    await waitFor(() => expect(mocks.insights).toHaveBeenCalledTimes(2));
    expect(mocks.adoptions).toHaveBeenCalledTimes(2);
  });

  it('API 失败:静默不炸(画像空态 + 采纳空态)', async () => {
    mocks.insights.mockRejectedValue(new Error('network'));
    mocks.adoptions.mockRejectedValue(new Error('network'));
    renderPage();

    expect(await screen.findByText('暂无批注数据')).toBeInTheDocument();
    expect(screen.getByText('暂无采纳记录')).toBeInTheDocument();
  });
});
