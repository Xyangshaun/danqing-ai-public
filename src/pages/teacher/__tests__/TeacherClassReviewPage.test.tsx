// ============================================================
// TeacherClassReviewPage 页面测试(反馈闭环 Phase 4 批次③)
// 对应源码: src/pages/teacher/TeacherClassReviewPage.tsx
//
// 测试范围(清单第四节"教师端写入口"):
//   1. 作品带标注 → 内嵌 AnnotationWorkspace(标注卡列表)
//   2. 点标注卡 → 批注表单弹层(添加教师批注/标注编号)
//   3. 填写提交 → createAnnotation 参数(markerId/markerIndex/action/comment)+弹窗关闭
//   4. 已有本人批注 → 编辑回填(标题/内容/动作)+提交走 updateAnnotation
//   5. 删除本人批注 → deleteAnnotation 调用
//   6. 作品无标注 → 回退原图(不渲染工作台)
//
// Mock 策略(照 OrgFeedPage.test.tsx 先例):
//   - mock class-api(getStudentWorks 定位作品)/teacher-api(批注四函数)
//   - mock useAuth(教师身份)/ToastProvider
//   - AnnotationWorkspace 替换为轻量 stub(点击透传 onCardClick;其自身行为单独测试)
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import TeacherClassReviewPage from '../TeacherClassReviewPage';
import type { StudentWork, StudentWorksResponse } from '../../../services/class-api';
import type { TeacherAnnotationRecord } from '../../../types/teacher';

/* ---------- mock 依赖 ---------- */

const getStudentWorksMock = vi.fn<(...args: unknown[]) => Promise<StudentWorksResponse>>();
const submitClassReviewMock = vi.fn();
vi.mock('../../../services/class-api', () => ({
  getStudentWorks: (...args: unknown[]) => getStudentWorksMock(...args),
  submitClassReview: (...args: unknown[]) => submitClassReviewMock(...args),
}));

const listAnnotationsMock = vi.fn<(...args: unknown[]) => Promise<TeacherAnnotationRecord[]>>();
const createAnnotationMock = vi.fn<(...args: unknown[]) => Promise<TeacherAnnotationRecord>>();
const updateAnnotationMock = vi.fn<(...args: unknown[]) => Promise<TeacherAnnotationRecord>>();
const deleteAnnotationMock = vi.fn<(...args: unknown[]) => Promise<void>>();
vi.mock('../../../services/teacher-api', () => ({
  listAnnotations: (...args: unknown[]) => listAnnotationsMock(...args),
  createAnnotation: (...args: unknown[]) => createAnnotationMock(...args),
  updateAnnotation: (...args: unknown[]) => updateAnnotationMock(...args),
  deleteAnnotation: (...args: unknown[]) => deleteAnnotationMock(...args),
}));

vi.mock('../../../hooks/useAuth', () => ({
  useAuth: () => ({
    tenant: { id: 't-a', name: '丹青画室' },
    user: { id: 'u-teacher', role: 'teacher' },
  }),
}));

const toastSuccess = vi.fn();
vi.mock('../../../components/ToastProvider', () => ({
  useToast: () => ({ success: toastSuccess, error: vi.fn(), warning: vi.fn() }),
}));

/* AnnotationWorkspace 轻量 stub:点卡片透传 onCardClick(markerId, markerIndex) */
vi.mock('../../../components/AnnotationWorkspace', () => ({
  default: ({
    onCardClick,
    issueMarkers,
  }: {
    onCardClick?: (markerId: string | undefined, markerIndex: number) => void;
    issueMarkers: Array<{ id?: string }>;
  }) => (
    <div data-testid="annotation-workspace">
      {issueMarkers.map((m, i) => (
        <button
          key={i}
          type="button"
          data-testid={`marker-card-${i}`}
          onClick={() => onCardClick?.(m.id, i)}
        >
          标注卡{i}
        </button>
      ))}
    </div>
  ),
}));

/* ---------- 测试数据工厂 ---------- */

const MARKER = {
  id: 'mk_hash111',
  x: 0.1, y: 0.2, w: 0.3, h: 0.2,
  label: '构图偏移',
  severity: 'high' as const,
  improvementHint: '视觉重心向左下偏移',
  type: 'critical' as const,
  dimension: '构图',
};

function makeWork(overrides: Partial<StudentWork> = {}): StudentWork {
  return {
    id: 'a1',
    workType: 'painting',
    imageUrl: 'https://example.com/work.png',
    title: '静物写生',
    status: 'success',
    overallScore: 82,
    result: { issueMarkers: [MARKER] },
    reviews: [],
    createdAt: '2026-09-01T00:00:00.000Z',
    completedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeAnnotationsResponse(items: TeacherAnnotationRecord[]): TeacherAnnotationRecord[] {
  return items;
}

function makeAnnotation(overrides: Partial<TeacherAnnotationRecord> = {}): TeacherAnnotationRecord {
  return {
    id: 'anno-1',
    analysisId: 'a1',
    teacherId: 'u-teacher',
    teacherName: '教师甲',
    markerId: 'mk_hash111',
    markerIndex: 0,
    action: 'supplement',
    comment: '已有批注内容',
    createdAt: '2026-09-07T00:00:00.000Z',
    updatedAt: '2026-09-07T00:00:00.000Z',
    ...overrides,
  };
}

/** 页面渲染(路由参数 classId/studentId/analysisId) */
function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/teacher/classes/c1/students/u-student/review/a1?name=小明']}>
      <Routes>
        <Route
          path="/teacher/classes/:classId/students/:studentId/review/:analysisId"
          element={<TeacherClassReviewPage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getStudentWorksMock.mockResolvedValue({
    items: [makeWork()],
    total: 1,
    page: 1,
    pageSize: 50,
    hasMore: false,
  });
  listAnnotationsMock.mockResolvedValue(makeAnnotationsResponse([]));
});

/* ============================================================
 * 测试用例
 * ============================================================ */

describe('TeacherClassReviewPage 批次③:标注批注写入口', () => {
  it('作品带标注 → 内嵌标注工作台(标注卡列表渲染)', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('annotation-workspace')).toBeInTheDocument();
    });
    expect(screen.getByTestId('marker-card-0')).toBeInTheDocument();
    // 批注计数提示未出现(无批注)
    expect(screen.queryByText(/已有教师批注/)).not.toBeInTheDocument();
  });

  it('作品无标注 → 回退原图展示,不渲染工作台', async () => {
    getStudentWorksMock.mockResolvedValue({
      items: [makeWork({ result: { overallComment: '整体尚可' } })],
      total: 1,
      page: 1,
      pageSize: 50,
      hasMore: false,
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByAltText('静物写生')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('annotation-workspace')).not.toBeInTheDocument();
  });

  it('点标注卡 → 打开批注表单弹层(添加模式,标注编号)', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('marker-card-0')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('marker-card-0'));

    expect(screen.getByText('添加教师批注')).toBeInTheDocument();
    expect(screen.getByText('标注 #1')).toBeInTheDocument();
    // 四动作 chips
    expect(screen.getByRole('button', { name: '补充' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '纠正' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确认' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '驳回' })).toBeInTheDocument();
    // 新建模式无删除按钮
    expect(screen.queryByRole('button', { name: /删除批注/ })).not.toBeInTheDocument();
  });

  it('填写并提交 → createAnnotation 收到 markerId/markerIndex/action/comment,弹窗关闭', async () => {
    const user = userEvent.setup();
    createAnnotationMock.mockResolvedValue(makeAnnotation());
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('marker-card-0')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('marker-card-0'));
    await user.click(screen.getByRole('button', { name: '纠正' }));
    await user.type(screen.getByPlaceholderText(/批注内容/), '此处结构转折需压重');
    await user.click(screen.getByRole('button', { name: '提交批注' }));

    await waitFor(() => {
      expect(createAnnotationMock).toHaveBeenCalledWith('a1', {
        markerId: 'mk_hash111',
        markerIndex: 0,
        action: 'correct',
        comment: '此处结构转折需压重',
      });
    });
    // 弹窗关闭 + 成功 toast
    await waitFor(() => {
      expect(screen.queryByText('添加教师批注')).not.toBeInTheDocument();
    });
    expect(toastSuccess).toHaveBeenCalledWith('批注已提交', expect.any(String));
  });

  it('已有本人批注 → 编辑模式(回填内容+标题),提交走 updateAnnotation', async () => {
    const user = userEvent.setup();
    listAnnotationsMock.mockResolvedValue(
      makeAnnotationsResponse([
        makeAnnotation({ action: 'supplement', comment: '已有批注内容' }),
      ]),
    );
    updateAnnotationMock.mockResolvedValue(
      makeAnnotation({ action: 'correct', comment: '修改后内容' }),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('marker-card-0')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('marker-card-0'));

    // 编辑模式:标题 + 内容回填 + 删除按钮出现
    expect(screen.getByText('编辑教师批注')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /删除批注/ })).toBeInTheDocument();
    const textarea = screen.getByPlaceholderText(/批注内容/) as HTMLTextAreaElement;
    expect(textarea.value).toBe('已有批注内容');

    // 改动作 + 改内容 → 提交走 PATCH
    await user.click(screen.getByRole('button', { name: '纠正' }));
    await user.clear(textarea);
    await user.type(textarea, '修改后内容');
    await user.click(screen.getByRole('button', { name: '保存修改' }));

    await waitFor(() => {
      expect(updateAnnotationMock).toHaveBeenCalledWith('a1', 'anno-1', {
        action: 'correct',
        comment: '修改后内容',
      });
    });
    // 未走 POST(已有批注更新不重复创建)
    expect(createAnnotationMock).not.toHaveBeenCalled();
  });

  it('编辑模式点删除 → deleteAnnotation 调用,弹窗关闭', async () => {
    const user = userEvent.setup();
    listAnnotationsMock.mockResolvedValue(
      makeAnnotationsResponse([makeAnnotation()]),
    );
    deleteAnnotationMock.mockResolvedValue(undefined);
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('marker-card-0')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('marker-card-0'));
    await user.click(screen.getByRole('button', { name: /删除批注/ }));

    await waitFor(() => {
      expect(deleteAnnotationMock).toHaveBeenCalledWith('a1', 'anno-1');
    });
    await waitFor(() => {
      expect(screen.queryByText('编辑教师批注')).not.toBeInTheDocument();
    });
  });

  it('已有他人批注 → 弹窗仍为添加模式(仅本人批注可编辑)', async () => {
    const user = userEvent.setup();
    listAnnotationsMock.mockResolvedValue(
      makeAnnotationsResponse([
        makeAnnotation({ teacherId: 'u-teacher2', teacherName: '教师乙' }),
      ]),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('marker-card-0')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('marker-card-0'));

    // 他人批注不算"已有"→ 添加模式;提示行出现(1 条)
    expect(screen.getByText('添加教师批注')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /删除批注/ })).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText(/已有教师批注 1 条/)).toBeInTheDocument();
    });
  });
});
