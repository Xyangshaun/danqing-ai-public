// ============================================================
// TeacherGradingProfilesPage 页面测试(Phase 2 批次⑤)
// 对应源码: src/pages/teacher/TeacherGradingProfilesPage.tsx
//
// 测试范围:
//   1. 渲染分组:系统预设(只读+克隆按钮)/ 本校档案(编辑/启停/设默认/删除)
//   2. 空状态:本校无档案时引导文案
//   3. 克隆交互:克隆弹窗 → 提交 → fork API 调用 → 导航至新档案编辑页
//   4. 设为默认/启停/删除操作 → 对应 API 调用
//
// Mock 策略:
//   - vi.mock services/grading-profile-api(全部六个函数)
//   - vi.mock react-router-dom 的 useNavigate(Link 用真实 MemoryRouter 包裹)
//   - ToastProvider 真实包裹(提供 useToast 上下文)
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  fork: vi.fn(),
  update: vi.fn(),
  activate: vi.fn(),
  remove: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mocks.navigate };
});

vi.mock('../../../services/grading-profile-api', () => ({
  listGradingProfiles: mocks.list,
  getGradingProfile: vi.fn(),
  createGradingProfile: vi.fn(),
  forkGradingProfile: mocks.fork,
  updateGradingProfile: mocks.update,
  deleteGradingProfile: mocks.remove,
  activateGradingProfile: mocks.activate,
}));

import TeacherGradingProfilesPage from '../../teacher/TeacherGradingProfilesPage';
import { ToastProvider } from '../../../components/ToastProvider';
import type { GradingProfileSummary } from '../../../types/grading-profile';

// ============================================================
// 测试数据工厂
// ============================================================

function buildSummary(overrides: Partial<GradingProfileSummary> = {}): GradingProfileSummary {
  return {
    id: 'gp_x',
    name: '档案',
    description: null,
    category: 'sketch',
    isBuiltIn: false,
    isDefault: false,
    forkedFromId: null,
    creatorId: 'user_t1',
    enabled: true,
    sortOrder: 0,
    ...overrides,
  };
}

const BUILTIN_SKETCH = buildSummary({
  id: 'gprofile_builtin_sketch',
  name: '联考素描基准',
  description: '五维均等,联考五档线',
  isBuiltIn: true,
});

const BUILTIN_COLOR = buildSummary({
  id: 'gprofile_builtin_color',
  name: '联考色彩基准',
  description: '色彩五维均等',
  isBuiltIn: true,
  category: 'color',
});

const TENANT_PROFILE = buildSummary({
  id: 'gp_tenant_001',
  name: '联考素描 · 本校强化档',
  description: '强化造型权重',
  forkedFromId: 'gprofile_builtin_sketch',
  isDefault: true,
});

function renderPage() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <TeacherGradingProfilesPage />
      </ToastProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ============================================================
// 1. 渲染分组
// ============================================================

describe('TeacherGradingProfilesPage 渲染分组(批次⑤)', () => {
  it('系统预设与本校档案分两组展示', async () => {
    mocks.list.mockResolvedValue([BUILTIN_SKETCH, BUILTIN_COLOR, TENANT_PROFILE]);
    renderPage();

    expect(await screen.findByText('联考素描基准')).toBeInTheDocument();
    expect(screen.getByText('联考色彩基准')).toBeInTheDocument();
    expect(screen.getByText('联考素描 · 本校强化档')).toBeInTheDocument();

    // 区块标题
    expect(screen.getByText('本校档案')).toBeInTheDocument();
    expect(screen.getByText('系统预设')).toBeInTheDocument();

    // 内置卡:克隆微调 + 查看;本校卡:编辑/设默认/停用/删除
    expect(screen.getAllByText('克隆微调')).toHaveLength(2);
    expect(screen.getAllByText('查看')).toHaveLength(2);
    expect(screen.getAllByText('编辑')).toHaveLength(1);
    expect(screen.getAllByText('停用')).toHaveLength(1);
    expect(screen.getAllByText('删除')).toHaveLength(1);
    // 默认档案不显示「设为默认」按钮
    expect(screen.queryByText('设为默认')).not.toBeInTheDocument();
    // 默认徽章 + 启用状态
    expect(screen.getByText('默认')).toBeInTheDocument();
    expect(screen.getByText('启用')).toBeInTheDocument();
  });

  it('停用状态的租户档案显示「启用」按钮,但不再提供「设为默认」(后端拒绝停用档案设默认)', async () => {
    mocks.list.mockResolvedValue([
      BUILTIN_SKETCH,
      buildSummary({ id: 'gp_off', name: '停用档案', enabled: false }),
    ]);
    renderPage();

    await screen.findByText('停用档案');
    expect(screen.getByText('停用')).toBeInTheDocument(); // 状态徽章
    expect(screen.getByText('启用')).toBeInTheDocument(); // 启停按钮
    expect(screen.queryByText('设为默认')).not.toBeInTheDocument();
  });
});

// ============================================================
// 2. 空状态
// ============================================================

describe('TeacherGradingProfilesPage 空状态(批次⑤)', () => {
  it('本校无档案时显示引导文案', async () => {
    mocks.list.mockResolvedValue([BUILTIN_SKETCH]);
    renderPage();

    await screen.findByText('联考素描基准');
    expect(screen.getByText('暂无本校档案')).toBeInTheDocument();
    expect(screen.getByText(/从下方系统预设「克隆微调」/)).toBeInTheDocument();
  });
});

// ============================================================
// 3. 克隆交互
// ============================================================

describe('TeacherGradingProfilesPage 克隆交互(批次⑤)', () => {
  it('克隆弹窗提交 → fork API 调用 → 导航至新档案编辑页', async () => {
    mocks.list.mockResolvedValue([BUILTIN_SKETCH]);
    const forked = buildSummary({
      id: 'gp_new_001',
      name: '联考素描基准 副本',
      forkedFromId: 'gprofile_builtin_sketch',
    });
    mocks.fork.mockResolvedValueOnce(forked);
    renderPage();

    // 打开克隆弹窗
    fireEvent.click(await screen.findByText('克隆微调'));
    expect(screen.getByText('克隆档案')).toBeInTheDocument();
    // 名称预填「源档案名 副本」
    expect(screen.getByDisplayValue('联考素描基准 副本')).toBeInTheDocument();

    // 提交
    fireEvent.click(screen.getByTestId('fork-submit'));

    await waitFor(() => expect(mocks.fork).toHaveBeenCalledTimes(1));
    expect(mocks.fork).toHaveBeenCalledWith('gprofile_builtin_sketch', {
      name: '联考素描基准 副本',
      description: '五维均等,联考五档线',
    });
    // 导航至新档案编辑页
    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith('/teacher/grading-profiles/gp_new_001'),
    );
  });
});

// ============================================================
// 4. 档案操作
// ============================================================

describe('TeacherGradingProfilesPage 档案操作(批次⑤)', () => {
  it('设为默认 → activate API 调用', async () => {
    mocks.list.mockResolvedValue([
      BUILTIN_SKETCH,
      buildSummary({ id: 'gp_t2', name: '候选档案', isDefault: false }),
    ]);
    renderPage();

    fireEvent.click(await screen.findByText('设为默认'));
    await waitFor(() => expect(mocks.activate).toHaveBeenCalledWith('gp_t2'));
  });

  it('停用 → update API 携带 enabled:false;重新加载列表', async () => {
    mocks.list.mockResolvedValue([
      BUILTIN_SKETCH,
      buildSummary({ id: 'gp_t3', name: '停用目标', isDefault: true }),
    ]);
    renderPage();

    fireEvent.click(await screen.findByText('停用'));
    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith('gp_t3', { enabled: false }),
    );
    // 操作后重新拉取列表
    await waitFor(() => expect(mocks.list.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it('删除:确认弹窗 → delete API 调用', async () => {
    mocks.list.mockResolvedValue([BUILTIN_SKETCH, TENANT_PROFILE]);
    renderPage();

    fireEvent.click(await screen.findByText('删除'));
    // 确认弹窗含档案名
    expect(screen.getByText(/确定删除「联考素描 · 本校强化档」/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('delete-confirm'));

    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith('gp_tenant_001'));
  });
});
