// ============================================================
// GradingProfileEditor 组件测试(Phase 2 批次⑤ + Phase 5 批次③)
// 对应源码: src/components/teacher/GradingProfileEditor.tsx
//
// 测试范围:
//   1. 纯换算函数:computeWeightedScore(等权/归一化/缺分跳过)/
//      findTierForScore(降序区间边界)/predictFeedbackModeByScore(达标线切换)/
//      formatStyleSuggestionValue(positiveRatio 百分比,批次③)
//   2. 基础渲染:六大区块 + 权重总和徽章 + 预览默认值
//   3. 权重校验:总和≠100 → 保存禁用 + 红色提示
//   4. 滑杆联动预览:改模拟分 → 综合分/档位/反馈模式实时变化
//   5. 档位线滑杆:改动后严格降序保持
//   6. 只读模式(isBuiltIn):无保存按钮、滑杆禁用、预览仍可用
//   7. 保存交互:updateGradingProfile 调用参数 + onSaved 回调
//   8. 风格建议卡片(批次③):条件渲染/当前值→建议值+依据/
//      一键采纳链路(先采纳记录后 PATCH)/只读无按钮/失败不 PATCH
//
// Mock 策略:
//   - vi.mock services/grading-profile-api(update/getSuggestions/adopt 三函数)
//   - 默认建议为空(既有用例不受建议卡片影响)
//   - 组件不依赖 Router/Toast,直接 render
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { updateMock, suggestionsMock, adoptMock } = vi.hoisted(() => ({
  updateMock: vi.fn(),
  suggestionsMock: vi.fn(),
  adoptMock: vi.fn(),
}));

vi.mock('../../../services/grading-profile-api', () => ({
  updateGradingProfile: updateMock,
  getProfileSuggestions: suggestionsMock,
  recordSuggestionAdoption: adoptMock,
}));

import GradingProfileEditor, {
  computeWeightedScore,
  findTierForScore,
  predictFeedbackModeByScore,
  formatStyleSuggestionValue,
} from '../GradingProfileEditor';
import type {
  GradingProfileDetail,
  GradingStyleSuggestion,
  GradingProfileSuggestionsResponse,
} from '../../../types/grading-profile';

// ============================================================
// 测试数据工厂
// ============================================================

const TEST_TIERS = [
  { key: 'A', label: '一档(90-100)', min: 90 },
  { key: 'B', label: '二档(80-89)', min: 80 },
  { key: 'C', label: '三档(70-79)', min: 70 },
  { key: 'D', label: '四档(60-69)', min: 60 },
  { key: 'E', label: '五档(<60)', min: 0 },
];

const TEST_DIMENSIONS = [
  { key: 'form_proportion', label: '造型与比例', weight: 20 },
  { key: 'structure', label: '结构理解', weight: 20 },
  { key: 'value_relationship', label: '黑白灰关系', weight: 20 },
  { key: 'rendering', label: '深入塑造', weight: 20 },
  { key: 'completeness', label: '完整度', weight: 20 },
];

function buildDetail(overrides: Partial<GradingProfileDetail> = {}): GradingProfileDetail {
  return {
    id: 'gp_test_001',
    name: '联考素描 · 本校强化档',
    description: '五维均等,联考五档线',
    category: 'sketch',
    isBuiltIn: false,
    isDefault: false,
    forkedFromId: 'gprofile_builtin_sketch',
    creatorId: 'user_teacher_001',
    enabled: true,
    sortOrder: 0,
    createdAt: '2026-09-06T00:00:00.000Z',
    updatedAt: '2026-09-06T00:00:00.000Z',
    config: {
      defaultFeedbackMode: 'diagnosis',
      dimensionWeights: TEST_DIMENSIONS.map((d) => ({ ...d })),
      thresholds: {
        basicsLine: 70,
        dimensionPass: Object.fromEntries(TEST_DIMENSIONS.map((d) => [d.key, 60])),
      },
      tierMapping: TEST_TIERS.map((t) => ({ ...t })),
      feedbackStyle: { diagnosisIntensity: 3, positiveRatio: 0.5, toneStrictness: 3 },
    },
    ...overrides,
  };
}

function buildBuiltInDetail(): GradingProfileDetail {
  return buildDetail({
    id: 'gprofile_builtin_sketch',
    name: '联考素描基准',
    isBuiltIn: true,
    forkedFromId: null,
    creatorId: null,
  });
}

/** 建议响应工厂(批次③;stats 仅作占位,组件只消费 suggestions) */
function buildSuggestionsResponse(
  suggestions: GradingStyleSuggestion[],
): GradingProfileSuggestionsResponse {
  return {
    profileId: 'gp_test_001',
    stats: {
      annotationCount: 40,
      reviewedWorks: 10,
      annotationDensity: 4,
      actionCounts: { supplement: 4, correct: 8, confirm: 24, reject: 4 },
      actionRatios: { supplement: 0.1, correct: 0.2, confirm: 0.6, reject: 0.1 },
      upCount: 5,
      downCount: 1,
      aiAgreementRate: 24 / 28,
      lastActiveAt: '2026-09-08T10:00:00.000Z',
    },
    suggestions,
  };
}

/** 批次③测试建议集(三规则各一条,与 buildDetail 的 feedbackStyle 3/0.5/3 对齐) */
const TEST_SUGGESTIONS: GradingStyleSuggestion[] = [
  {
    suggestionKey: 'toneStrictness',
    currentValue: 3,
    suggestedValue: 2,
    basis: '教师确认占比 60%(阈值 60%),语气可下调一档更亲和',
    basisSnapshot: { confirmRatio: 0.6 },
  },
  {
    suggestionKey: 'diagnosisIntensity',
    currentValue: 3,
    suggestedValue: 4,
    basis: '教师纠正/驳回占比 40%(阈值 40%),建议提高诊断强度直击要害',
    basisSnapshot: { overrideRatio: 0.4 },
  },
  {
    suggestionKey: 'positiveRatio',
    currentValue: 0.5,
    suggestedValue: 0.45,
    basis: '批注密度 4 条/作品(阈值 3),正面占比可微降以突出改进重点',
    basisSnapshot: { annotationDensity: 4 },
  },
];

function renderEditor(detail: GradingProfileDetail, handlers: {
  onSaved?: (d: GradingProfileDetail) => void;
  onCancel?: () => void;
} = {}) {
  return render(
    <GradingProfileEditor detail={detail} onSaved={handlers.onSaved} onCancel={handlers.onCancel} />,
  );
}

beforeEach(() => {
  updateMock.mockReset();
  adoptMock.mockReset();
  suggestionsMock.mockReset();
  // 默认:无建议(既有批次⑤用例不受建议卡片影响)
  suggestionsMock.mockResolvedValue(buildSuggestionsResponse([]));
});

// ============================================================
// 1. 纯换算函数
// ============================================================

describe('GradingProfileEditor 纯换算函数(批次⑤)', () => {
  describe('computeWeightedScore', () => {
    it('等权五维均分:75×5 → 75', () => {
      const scores = Object.fromEntries(TEST_DIMENSIONS.map((d) => [d.key, 75]));
      expect(computeWeightedScore(TEST_DIMENSIONS, scores)).toBe(75);
    });

    it('权重不等:60/40 × 90/60 → 78', () => {
      const dims = [
        { key: 'a', label: '甲', weight: 60 },
        { key: 'b', label: '乙', weight: 40 },
      ];
      expect(computeWeightedScore(dims, { a: 90, b: 60 })).toBe(78);
    });

    it('权重和≠100 时按当前权重归一化(预览不中断)', () => {
      const dims = [
        { key: 'a', label: '甲', weight: 60 },
        { key: 'b', label: '乙', weight: 60 },
      ];
      // (80*60 + 40*60) / 120 = 60
      expect(computeWeightedScore(dims, { a: 80, b: 40 })).toBe(60);
    });

    it('缺失维度分跳过,不计入归一化分母', () => {
      const dims = [
        { key: 'a', label: '甲', weight: 50 },
        { key: 'b', label: '乙', weight: 50 },
      ];
      // b 无分 → (100*50) / 50 = 100
      expect(computeWeightedScore(dims, { a: 100 })).toBe(100);
    });

    it('全部分缺失 → 0', () => {
      expect(computeWeightedScore(TEST_DIMENSIONS, {})).toBe(0);
    });
  });

  describe('findTierForScore(降序区间,档位线含左值)', () => {
    it('边界:90→A、89.9→B、80→B、79.9→C', () => {
      expect(findTierForScore(90, TEST_TIERS)?.key).toBe('A');
      expect(findTierForScore(89.9, TEST_TIERS)?.key).toBe('B');
      expect(findTierForScore(80, TEST_TIERS)?.key).toBe('B');
      expect(findTierForScore(79.9, TEST_TIERS)?.key).toBe('C');
    });

    it('低于末档线 → 兜底末档 E;0 → E', () => {
      expect(findTierForScore(59, TEST_TIERS)?.key).toBe('E');
      expect(findTierForScore(0, TEST_TIERS)?.key).toBe('E');
    });

    it('空映射 / NaN → undefined', () => {
      expect(findTierForScore(80, [])).toBeUndefined();
      expect(findTierForScore(Number.NaN, TEST_TIERS)).toBeUndefined();
    });
  });

  describe('predictFeedbackModeByScore(达标线切换,< 线诊断、≥ 线引导)', () => {
    it('69.9 → diagnosis;70 → guidance;70.1 → guidance', () => {
      expect(predictFeedbackModeByScore(69.9, 70)).toBe('diagnosis');
      expect(predictFeedbackModeByScore(70, 70)).toBe('guidance');
      expect(predictFeedbackModeByScore(70.1, 70)).toBe('guidance');
    });
  });

  describe('formatStyleSuggestionValue(批次③:positiveRatio 百分比,其余原值)', () => {
    it('0.5 → 50%;0.45 → 45%;diagnosisIntensity/toneStrictness 原值', () => {
      expect(formatStyleSuggestionValue('positiveRatio', 0.5)).toBe('50%');
      expect(formatStyleSuggestionValue('positiveRatio', 0.45)).toBe('45%');
      expect(formatStyleSuggestionValue('diagnosisIntensity', 4)).toBe('4');
      expect(formatStyleSuggestionValue('toneStrictness', 2)).toBe('2');
    });
  });
});

// ============================================================
// 2. 基础渲染
// ============================================================

describe('GradingProfileEditor 渲染(批次⑤)', () => {
  it('渲染六大区块与基本信息', () => {
    renderEditor(buildDetail());
    expect(screen.getByText('基本信息')).toBeInTheDocument();
    expect(screen.getByText('维度权重')).toBeInTheDocument();
    expect(screen.getByText('综合分预览')).toBeInTheDocument();
    expect(screen.getByText('阈值与档位')).toBeInTheDocument();
    expect(screen.getByText('反馈风格')).toBeInTheDocument();
    expect(screen.getByText(/客观检测阈值覆盖/)).toBeInTheDocument();
    expect(screen.getByDisplayValue('联考素描 · 本校强化档')).toBeInTheDocument();
    expect(screen.getByText('素描类目')).toBeInTheDocument();
  });

  it('默认预览:75 分 → 三档 C、引导模式(75 ≥ 达标线 70)', () => {
    renderEditor(buildDetail());
    expect(screen.getByTestId('preview-score')).toHaveTextContent('75');
    expect(screen.getByTestId('preview-tier')).toHaveTextContent('预估 C 档');
    expect(screen.getByTestId('preview-mode')).toHaveTextContent('引导模式');
  });

  it('权重总和初始 100,保存可用', () => {
    renderEditor(buildDetail());
    expect(screen.getByTestId('weight-sum')).toHaveTextContent('100%');
    expect(screen.getByTestId('save-profile')).toBeEnabled();
  });
});

// ============================================================
// 3. 权重校验(≠100 禁保存)
// ============================================================

describe('GradingProfileEditor 权重校验(批次⑤)', () => {
  it('改权重致总和≠100 → 保存禁用 + 提示;改回后恢复', () => {
    renderEditor(buildDetail());
    const slider = screen.getByTestId('weight-form_proportion');

    fireEvent.change(slider, { target: { value: '40' } });
    expect(screen.getByTestId('weight-sum')).toHaveTextContent('120%');
    expect(screen.getByTestId('weight-sum')).toHaveTextContent('须为 100% 才能保存');
    expect(screen.getByTestId('save-profile')).toBeDisabled();

    fireEvent.change(slider, { target: { value: '20' } });
    expect(screen.getByTestId('save-profile')).toBeEnabled();
  });

  it('名称清空 → 保存禁用', () => {
    renderEditor(buildDetail());
    const nameInput = screen.getByDisplayValue('联考素描 · 本校强化档');
    fireEvent.change(nameInput, { target: { value: '' } });
    expect(screen.getByTestId('save-profile')).toBeDisabled();
  });
});

// ============================================================
// 4. 滑杆联动预览
// ============================================================

describe('GradingProfileEditor 滑杆联动预览(批次⑤)', () => {
  it('改模拟分 → 综合分/档位/反馈模式实时变化', () => {
    renderEditor(buildDetail());

    // 全部拉满 100 → 100 分 → A 档、引导
    for (const d of TEST_DIMENSIONS) {
      fireEvent.change(screen.getByTestId(`preview-score-${d.key}`), { target: { value: '100' } });
    }
    expect(screen.getByTestId('preview-score')).toHaveTextContent('100');
    expect(screen.getByTestId('preview-tier')).toHaveTextContent('预估 A 档');
    expect(screen.getByTestId('preview-mode')).toHaveTextContent('引导模式');

    // 全部降到 50 → 50 分 → E 档、诊断(50 < 70)
    for (const d of TEST_DIMENSIONS) {
      fireEvent.change(screen.getByTestId(`preview-score-${d.key}`), { target: { value: '50' } });
    }
    expect(screen.getByTestId('preview-score')).toHaveTextContent('50');
    expect(screen.getByTestId('preview-tier')).toHaveTextContent('预估 E 档');
    expect(screen.getByTestId('preview-mode')).toHaveTextContent('诊断模式');
  });

  it('档位线滑杆改动后严格降序保持(A 拉到 85 仍 > B=80)', () => {
    renderEditor(buildDetail());
    const sliderA = screen.getByTestId('slider-A 档线(一档(90-100))');
    fireEvent.change(sliderA, { target: { value: '85' } });
    // 预览 75 分仍落 C 档(不受 A 档线影响)
    expect(screen.getByTestId('preview-tier')).toHaveTextContent('预估 C 档');
    // 滑杆值展示更新(range input value 为字符串)
    expect(sliderA).toHaveValue('85');
  });
});

// ============================================================
// 5. 只读模式(系统内置)
// ============================================================

describe('GradingProfileEditor 只读模式(isBuiltIn,批次⑤)', () => {
  it('无保存按钮、权重滑杆禁用、预览输入仍可用', () => {
    renderEditor(buildBuiltInDetail());
    expect(screen.queryByTestId('save-profile')).not.toBeInTheDocument();
    expect(screen.getByTestId('weight-form_proportion')).toBeDisabled();
    expect(screen.getByText(/系统内置档案,只读展示/)).toBeInTheDocument();
    // 预览模拟分不受只读限制(单维拉满 100、其余 75 → (100+75×4)/5 = 80)
    const previewInput = screen.getByTestId('preview-score-form_proportion');
    expect(previewInput).toBeEnabled();
    fireEvent.change(previewInput, { target: { value: '100' } });
    expect(screen.getByTestId('preview-score')).toHaveTextContent('80');
  });
});

// ============================================================
// 6. 保存交互
// ============================================================

describe('GradingProfileEditor 保存交互(批次⑤)', () => {
  it('点击保存 → updateGradingProfile 携带名称/描述/config;onSaved 收到后端结果', async () => {
    const updated = buildDetail({ name: '改名后' });
    updateMock.mockResolvedValueOnce(updated);
    const onSaved = vi.fn();
    renderEditor(buildDetail(), { onSaved });

    fireEvent.change(screen.getByDisplayValue('联考素描 · 本校强化档'), {
      target: { value: '改名后' },
    });
    fireEvent.click(screen.getByTestId('save-profile'));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(updated));
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock).toHaveBeenCalledWith(
      'gp_test_001',
      expect.objectContaining({ name: '改名后', description: '五维均等,联考五档线' }),
    );
    const callBody = updateMock.mock.calls[0]![1]!;
    expect(callBody.config).toBeDefined();
    expect(callBody.config.dimensionWeights).toHaveLength(5);
    expect(callBody.config.tierMapping[0]).toMatchObject({ key: 'A', min: 90 });
  });
});

// ============================================================
// 7. 风格建议卡片(Phase 5 批次③)
// ============================================================

describe('GradingProfileEditor 风格建议卡片(批次③)', () => {
  it('S1: 有建议时渲染卡片(标签 + 当前值→建议值 + 依据 + 采纳按钮)', async () => {
    suggestionsMock.mockResolvedValueOnce(buildSuggestionsResponse(TEST_SUGGESTIONS));
    renderEditor(buildDetail());

    const card = await screen.findByTestId('suggestion-card');
    expect(card).toHaveTextContent('风格建议(基于本校批注行为数据)');

    // 三条建议逐条渲染:值展示(positiveRatio 百分比格式)与依据
    const tone = screen.getByTestId('suggestion-toneStrictness');
    expect(tone).toHaveTextContent('语气严格度');
    expect(tone).toHaveTextContent('3');
    expect(tone).toHaveTextContent('2');
    expect(screen.getByTestId('suggestion-basis-toneStrictness')).toHaveTextContent(
      '教师确认占比 60%',
    );

    const positive = screen.getByTestId('suggestion-positiveRatio');
    expect(positive).toHaveTextContent('正面反馈占比');
    expect(positive).toHaveTextContent('50%');
    expect(positive).toHaveTextContent('45%');

    expect(screen.getByTestId('suggestion-diagnosisIntensity')).toHaveTextContent('诊断强度');
    expect(screen.getByTestId('adopt-toneStrictness')).toBeEnabled();
    expect(screen.getByTestId('adopt-diagnosisIntensity')).toBeEnabled();
    expect(screen.getByTestId('adopt-positiveRatio')).toBeEnabled();
  });

  it('S2: 无建议时不渲染卡片(条件渲染)', async () => {
    renderEditor(buildDetail());
    await waitFor(() => expect(suggestionsMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('suggestion-card')).not.toBeInTheDocument();
  });

  it('S3: 一键采纳:先调采纳记录端点,再走既有 PATCH 写入建议值,卡片移除该条', async () => {
    suggestionsMock.mockResolvedValueOnce(buildSuggestionsResponse(TEST_SUGGESTIONS));
    adoptMock.mockResolvedValueOnce({
      id: 'adopt-001',
      tenantId: 't-001',
      teacherId: 'user_teacher_001',
      profileId: 'gp_test_001',
      suggestionKey: 'toneStrictness',
      beforeValue: 3,
      afterValue: 2,
      suggestionBasis: { confirmRatio: 0.6 },
      createdAt: '2026-09-09T00:00:00.000Z',
    });
    const updated = buildDetail();
    updateMock.mockResolvedValueOnce(updated);
    const onSaved = vi.fn();
    renderEditor(buildDetail(), { onSaved });

    fireEvent.click(await screen.findByTestId('adopt-toneStrictness'));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(updated));

    // 1. 采纳记录端点参数(建议 key + 前后值,来自建议条目)
    expect(adoptMock).toHaveBeenCalledWith('gp_test_001', {
      suggestionKey: 'toneStrictness',
      beforeValue: 3,
      afterValue: 2,
    });
    // 2. 顺序:采纳记录先于 PATCH(后端一致性校验基于当前档案配置)
    expect(adoptMock.mock.invocationCallOrder[0]).toBeLessThan(
      updateMock.mock.invocationCallOrder[0]!,
    );
    // 3. PATCH 携带建议值:toneStrictness 3→2,其余风格参数不变
    expect(updateMock).toHaveBeenCalledTimes(1);
    const callBody = updateMock.mock.calls[0]![1]!;
    expect(callBody.config.feedbackStyle.toneStrictness).toBe(2);
    expect(callBody.config.feedbackStyle.diagnosisIntensity).toBe(3);
    expect(callBody.config.feedbackStyle.positiveRatio).toBe(0.5);
    // 4. 本地滑杆同步(suggestion 移除后仍可见反馈风格区)
    expect(screen.getByText('反馈风格')).toBeInTheDocument();
    // 5. 卡片移除已采纳条目,保留其余两条
    await waitFor(() =>
      expect(screen.queryByTestId('suggestion-toneStrictness')).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId('suggestion-diagnosisIntensity')).toBeInTheDocument();
    expect(screen.getByTestId('suggestion-positiveRatio')).toBeInTheDocument();
  });

  it('S4: 采纳记录端点失败 → 不走 PATCH,卡片保留供重试', async () => {
    suggestionsMock.mockResolvedValueOnce(buildSuggestionsResponse(TEST_SUGGESTIONS));
    adoptMock.mockRejectedValueOnce(new Error('9304 mismatch'));
    renderEditor(buildDetail());

    fireEvent.click(await screen.findByTestId('adopt-toneStrictness'));
    // 按钮恢复可用 = 异步流程结束(采纳失败被吞,PATCH 未触发)
    await waitFor(() => expect(screen.getByTestId('adopt-toneStrictness')).toBeEnabled());
    expect(updateMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('suggestion-toneStrictness')).toBeInTheDocument();
  });

  it('S5: 只读模式(内置档案):建议可见但无采纳按钮', async () => {
    suggestionsMock.mockResolvedValueOnce(buildSuggestionsResponse(TEST_SUGGESTIONS));
    renderEditor(buildBuiltInDetail());

    expect(await screen.findByTestId('suggestion-card')).toBeInTheDocument();
    expect(screen.getByTestId('suggestion-toneStrictness')).toBeInTheDocument();
    expect(screen.queryByTestId('adopt-toneStrictness')).not.toBeInTheDocument();
    expect(screen.queryByTestId('adopt-diagnosisIntensity')).not.toBeInTheDocument();
    expect(screen.getByText(/克隆档案后可在副本中应用调整/)).toBeInTheDocument();
  });
});
