// ============================================================
// HistoryPage 差异化展示测试 (Task 22.3)
// 对应源码: src/pages/HistoryPage.tsx (DetailModal 深度分析渲染段)
//
// 测试范围:
//   1. aiEnhanced=true → "AI 深度"徽章 + 评价阶段标签
//   2. aiEnhanced=false → 无徽章 + 无深度面板
//   3. 评价阶段标签映射(master→大师级 / enthusiast→爱好者级)
//   4. aiEnhanced + scoreCriteria → ScoreCriteriaPanel 渲染
//   5. aiEnhanced → DepthDimensionsPanel 渲染
//   6. aiEnhanced + issueMarkers → IssueAnnotationLayer(canvas)渲染
//   7. aiEnhanced + 无 issueMarkers → SmartImage 降级(无 canvas)
//
// Mock 策略:
//   - data-service: getAnalysisHistory / getAnalysisDetail 可控返回
//   - useLazyImage: mock 为始终 loaded
//   - useAuth: 返回已登录学生(RequestReviewSection 依赖)
//   - ResizeObserver: polyfill(IssueAnnotationLayer 依赖)
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../../components/ToastProvider';
import HistoryPage from '../HistoryPage';
import type { HistoryRecord, AnalysisResult, PaintingAnalysis, IssueMarker, ScoreCriteria } from '../../types';

/* ---------- mock 依赖 ---------- */

const getAnalysisHistoryMock = vi.fn<(...args: unknown[]) => Promise<HistoryRecord[]>>();
const getAnalysisDetailMock = vi.fn<(...args: unknown[]) => Promise<AnalysisResult | null>>();
vi.mock('../../services/data-service', () => ({
  getAnalysisHistory: (...args: unknown[]) => getAnalysisHistoryMock(...args),
  getAnalysisDetail: (...args: unknown[]) => getAnalysisDetailMock(...args),
  batchDeleteAnalyses: vi.fn(() => Promise.resolve({ total: 0, deleted: 0, failedCount: 0, items: [] })),
  getSavedMaterials: vi.fn(() => Promise.resolve([])),
  removeSavedMaterial: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../hooks/useLazyImage', () => ({
  useLazyImage: (src: string | undefined) => ({
    imgRef: { current: null },
    loadedSrc: src,
    isLoaded: !!src,
    isError: false,
  }),
}));

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'u-depth', name: '深度测试学生', role: 'student', tenantId: 't-1' },
    isAuthenticated: true,
    isLoading: false,
  }),
}));

/* ---------- ResizeObserver polyfill(IssueAnnotationLayer 依赖) ---------- */
class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
const originalRO = globalThis.ResizeObserver;
beforeEach(() => {
  globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
});
afterEach(() => {
  globalThis.ResizeObserver = originalRO;
});

/* ---------- 测试数据工厂 ---------- */

function makeRecord(overrides: Partial<HistoryRecord> = {}): HistoryRecord {
  return {
    id: 'rec-depth-1',
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
      score: 80, focusPoint: { x: 0.5, y: 0.5 }, balance: 'balanced',
      guideline: 'good', whitespaceRatio: 0.3, symmetry: 0.7, suggestion: '构图建议', heatmapData: [],
    },
    color: {
      score: 78, warmRatio: 0.6, coolRatio: 0.4, contrast: 'medium', saturation: 'medium',
      richness: 'moderate', harmony: '互补色', dominantColor: '#c41e3a', suggestion: '色彩建议',
    },
    brushwork: {
      score: 82, textureLevel: 'moderate', strokeVariety: 0.5, wetDryBalance: '均衡', suggestion: '笔触建议',
    },
  };
  return {
    id: 'detail-depth-1',
    imageUrl: 'https://example.com/detail.png',
    createdAt: new Date().toISOString(),
    artType: 'painting',
    dimensions,
    originality: { score: 78, similarity: 0.3, creativityLevel: 'good', suggestion: '原创性建议' },
    overallScore: 80,
    ...overrides,
  };
}

function buildIssueMarkers(): IssueMarker[] {
  return [
    { x: 0.1, y: 0.2, w: 0.3, h: 0.4, label: '构图偏移', severity: 'high', improvementHint: '建议调整重心' },
  ];
}

function buildScoreCriteria(): ScoreCriteria[] {
  return [
    {
      dimension: '构图与造型', weight: 0.3, maxScore: 100, level: 'good',
      metCriteria: ['重心居中'], unmetCriteria: ['留白不足'], evidence: '重心位于(0.5,0.5)',
    },
  ];
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

/** 渲染历史列表并打开详情弹窗 */
async function openDetail(detail: AnalysisResult): Promise<void> {
  getAnalysisHistoryMock.mockResolvedValue([makeRecord({ id: 'r1' })]);
  getAnalysisDetailMock.mockResolvedValue(detail);
  renderHistory();
  await waitFor(() => {
    expect(screen.getAllByText('查看详情').length).toBeGreaterThan(0);
  });
  fireEvent.click(screen.getAllByText('查看详情')[0]);
  await waitFor(() => {
    expect(screen.getByText('分析报告详情')).toBeInTheDocument();
  });
}

beforeEach(() => {
  getAnalysisHistoryMock.mockReset();
  getAnalysisDetailMock.mockReset();
  getAnalysisHistoryMock.mockResolvedValue([]);
  getAnalysisDetailMock.mockResolvedValue(null);
});

// ============================================================
// 测试用例
// ============================================================

describe('HistoryPage 深度分析差异化展示 (Task 22.3)', () => {
  // ----------------------------------------------------------
  // 1. AI 深度徽章 + 评价阶段标签
  // ----------------------------------------------------------
  describe('AI 深度徽章', () => {
    it('should_render_AI_depth_badge_with_stage_label_when_aiEnhanced_and_evaluationStage', async () => {
      await openDetail(
        makePaintingDetail({
          aiEnhanced: true,
          evaluationStage: 'master',
        }),
      );
      // 徽章文本:"AI 深度 · 大师级"
      expect(screen.getByText(/AI 深度/)).toBeInTheDocument();
      expect(screen.getByText(/大师级/)).toBeInTheDocument();
    });

    it('should_render_enthusiast_label_for_enthusiast_stage', async () => {
      await openDetail(
        makePaintingDetail({
          aiEnhanced: true,
          evaluationStage: 'enthusiast',
        }),
      );
      expect(screen.getByText(/爱好者级/)).toBeInTheDocument();
    });

    it('should_render_unified_label_for_unified_stage', async () => {
      await openDetail(
        makePaintingDetail({
          aiEnhanced: true,
          evaluationStage: 'unified',
        }),
      );
      expect(screen.getByText(/联考级/)).toBeInTheDocument();
    });

    it('should_not_render_AI_depth_badge_when_aiEnhanced_false', async () => {
      await openDetail(makePaintingDetail({ aiEnhanced: false }));
      // 不应出现 AI 深度徽章
      expect(screen.queryByText(/AI 深度/)).not.toBeInTheDocument();
    });

    it('should_not_render_AI_depth_badge_when_aiEnhanced_true_but_no_evaluationStage', async () => {
      // aiEnhanced=true 但 evaluationStage 缺省 → 无徽章(stageMeta 为 undefined)
      await openDetail(makePaintingDetail({ aiEnhanced: true, evaluationStage: undefined }));
      expect(screen.queryByText(/AI 深度/)).not.toBeInTheDocument();
    });

    it('should_show_cinnabar_tone_for_exam_mode_stage', async () => {
      // exam 模式阶段(unified/academy/master) → cinnabar tone
      await openDetail(
        makePaintingDetail({
          aiEnhanced: true,
          evaluationStage: 'academy',
          diagnosisMode: 'exam',
        }),
      );
      const badge = screen.getByText(/美院级/).closest('span');
      expect(badge).toBeInTheDocument();
      // cinnabar tone 使用 bg-cinnabar 类
      expect(badge?.className).toContain('cinnabar');
    });

    it('should_show_jade_tone_for_teaching_mode_stage', async () => {
      // teaching 模式阶段(enthusiast/intermediate/advanced) → jade tone
      await openDetail(
        makePaintingDetail({
          aiEnhanced: true,
          evaluationStage: 'advanced',
          diagnosisMode: 'teaching',
        }),
      );
      const badge = screen.getByText(/资深层/).closest('span');
      expect(badge).toBeInTheDocument();
      // jade tone 使用 bg-jade 类
      expect(badge?.className).toContain('jade');
    });
  });

  // ----------------------------------------------------------
  // 2. ScoreCriteriaPanel 渲染
  // ----------------------------------------------------------
  describe('ScoreCriteriaPanel 渲染', () => {
    it('should_render_ScoreCriteriaPanel_when_aiEnhanced_and_scoreCriteria_present', async () => {
      await openDetail(
        makePaintingDetail({
          aiEnhanced: true,
          evaluationStage: 'master',
          scoreCriteria: buildScoreCriteria(),
        }),
      );
      // ScoreCriteriaPanel 渲染"评分标准"标题
      expect(screen.getByText('评分标准')).toBeInTheDocument();
      // 维度名可见
      expect(screen.getByText('构图与造型')).toBeInTheDocument();
    });

    it('should_not_render_ScoreCriteriaPanel_when_scoreCriteria_empty', async () => {
      await openDetail(
        makePaintingDetail({
          aiEnhanced: true,
          evaluationStage: 'master',
          scoreCriteria: [],
        }),
      );
      expect(screen.queryByText('评分标准')).not.toBeInTheDocument();
    });

    it('should_not_render_ScoreCriteriaPanel_when_aiEnhanced_false', async () => {
      await openDetail(
        makePaintingDetail({
          aiEnhanced: false,
          scoreCriteria: buildScoreCriteria(),
        }),
      );
      // 即使有 scoreCriteria,aiEnhanced=false 时不渲染
      expect(screen.queryByText('评分标准')).not.toBeInTheDocument();
    });
  });

  // ----------------------------------------------------------
  // 3. DepthDimensionsPanel 渲染
  // ----------------------------------------------------------
  describe('DepthDimensionsPanel 渲染', () => {
    it('should_render_DepthDimensionsPanel_when_aiEnhanced', async () => {
      await openDetail(
        makePaintingDetail({
          aiEnhanced: true,
          evaluationStage: 'master',
          originalityAndStyle: { score: 82, analysis: '原创性分析', suggestion: '建议A' },
          craftsmanship: { score: 88, analysis: '工艺分析', suggestion: '建议D' },
        }),
      );
      // DepthDimensionsPanel 渲染"专业深度维度"标题
      expect(screen.getByText('专业深度维度')).toBeInTheDocument();
    });

    it('should_not_render_DepthDimensionsPanel_when_aiEnhanced_false', async () => {
      await openDetail(
        makePaintingDetail({
          aiEnhanced: false,
          originalityAndStyle: { score: 82, analysis: '原创性分析', suggestion: '建议A' },
        }),
      );
      expect(screen.queryByText('专业深度维度')).not.toBeInTheDocument();
    });
  });

  // ----------------------------------------------------------
  // 4. IssueAnnotationLayer vs SmartImage
  // ----------------------------------------------------------
  describe('IssueAnnotationLayer 渲染', () => {
    it('should_render_svg_when_aiEnhanced_and_issueMarkers_present', async () => {
      await openDetail(
        makePaintingDetail({
          aiEnhanced: true,
          evaluationStage: 'master',
          issueMarkers: buildIssueMarkers(),
        }),
      );
      // IssueAnnotationLayer 渲染 SVG(2026-09-03 Phase 1A 重构:Canvas → SVG,role="img")
      const annotationSvg = document.querySelector('svg[role="img"]');
      expect(annotationSvg).toBeInTheDocument();
      expect(annotationSvg).toHaveAttribute('aria-label', expect.stringContaining('问题标注'));
    });

    it('should_not_render_annotation_svg_when_issueMarkers_empty', async () => {
      // aiEnhanced=true 但无 issueMarkers → 降级为 SmartImage(IssueAnnotationLayer 返回 null)
      await openDetail(
        makePaintingDetail({
          aiEnhanced: true,
          evaluationStage: 'master',
          issueMarkers: [],
        }),
      );
      // IssueAnnotationLayer 的 SVG(role="img")不应存在
      const annotationSvg = document.querySelector('svg[role="img"]');
      expect(annotationSvg).not.toBeInTheDocument();
    });

    it('should_not_render_annotation_svg_when_aiEnhanced_false', async () => {
      await openDetail(
        makePaintingDetail({
          aiEnhanced: false,
          issueMarkers: buildIssueMarkers(),
        }),
      );
      // 非 aiEnhanced → SmartImage,无 IssueAnnotationLayer SVG
      const annotationSvg = document.querySelector('svg[role="img"]');
      expect(annotationSvg).not.toBeInTheDocument();
    });
  });

  // ----------------------------------------------------------
  // 5. 卡片视觉差异化(gold border for aiEnhanced)
  // ----------------------------------------------------------
  describe('卡片视觉差异化', () => {
    it('should_apply_gold_border_when_aiEnhanced_true', async () => {
      await openDetail(
        makePaintingDetail({
          aiEnhanced: true,
          evaluationStage: 'master',
        }),
      );
      // aiEnhanced → 弹窗容器含 gold border 样式
      const modal = screen.getByText('分析报告详情').closest('div.rounded-2xl');
      expect(modal).toBeInTheDocument();
      expect(modal?.className).toContain('gold');
    });

    it('should_not_apply_gold_border_when_aiEnhanced_false', async () => {
      await openDetail(makePaintingDetail({ aiEnhanced: false }));
      const modal = screen.getByText('分析报告详情').closest('div.rounded-2xl');
      expect(modal).toBeInTheDocument();
      // 非 aiEnhanced → 不含 gold border(无 border-gold/50 类)
      expect(modal?.className).not.toContain('border-gold/50');
    });
  });
});
