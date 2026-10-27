// ============================================================
// ObjectiveChecksPanel 组件测试(2026-09-04 Phase 1B)
// 对应源码: src/components/ObjectiveChecksPanel.tsx
// 对应真源文档: docs/visual-annotation-feedback-upgrade-spec-2026-09.md §5b/§6
//
// 测试范围:
//   1. 基础渲染(标题/项数计数/待改进计数)
//   2. warn/pass 状态徽章与"怎么改"建议
//   3. 降级明示横幅(showLocalBanner 开关)
//   4. 明度标尺(aria-label/min-max 标签/利用率)
//   5. luminanceScale 缺省时不渲染直方图
// ============================================================

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ObjectiveChecksPanel from '../ObjectiveChecksPanel';
import type { ObjectiveChecks } from '../../types';

// ---------- 测试数据 ----------
function buildChecks(overrides: Partial<ObjectiveChecks> = {}): ObjectiveChecks {
  return {
    luminanceScale: {
      histogram: Array.from({ length: 16 }, (_, i) => (i === 2 || i === 13 ? 0.35 : 0.02)),
      min: 40,
      max: 230,
      utilization: 0.7,
    },
    checks: [
      {
        id: 'grayness',
        label: '画面灰检测',
        status: 'pass',
        value: '明度范围 40-230,标尺利用率 70%',
        detail: '画面明度两端拉开,黑白灰层次完整。',
        suggestion: '保持当前的明度对比意识。',
      },
      {
        id: 'contrast',
        label: '对比度检测',
        status: 'warn',
        value: 'Michelson 对比度 0.21(参考:扎实画面通常 ≥0.35)',
        detail: '各区域明度过于接近,画面发"平"。',
        suggestion: '主动拉开主体与背景的明度差至少 2 个层级。',
      },
    ],
    ...overrides,
  };
}

describe('ObjectiveChecksPanel', () => {
  it('渲染标题、检测项计数与待改进计数', () => {
    render(<ObjectiveChecksPanel checks={buildChecks()} />);
    expect(screen.getByText('客观画面检测')).toBeInTheDocument();
    expect(screen.getByText(/2 项/)).toBeInTheDocument();
    expect(screen.getByText(/1 项待改进/)).toBeInTheDocument();
  });

  it('warn 项显示"待改进",pass 项显示"通过",均渲染"怎么改"建议', () => {
    render(<ObjectiveChecksPanel checks={buildChecks()} />);
    expect(screen.getByText('待改进')).toBeInTheDocument();
    expect(screen.getByText('通过')).toBeInTheDocument();
    expect(screen.getByText(/主动拉开主体与背景的明度差/)).toBeInTheDocument();
  });

  it('全部通过时显示"全部通过"而非待改进计数', () => {
    const checks = buildChecks({ checks: [buildChecks().checks[0]!] });
    render(<ObjectiveChecksPanel checks={checks} />);
    expect(screen.getByText(/全部通过/)).toBeInTheDocument();
    expect(screen.queryByText('待改进')).not.toBeInTheDocument();
  });

  it('showLocalBanner=false 不显示本地模式说明,true 显示', () => {
    const { rerender } = render(<ObjectiveChecksPanel checks={buildChecks()} />);
    expect(screen.queryByText(/本地快速检测/)).not.toBeInTheDocument();
    rerender(<ObjectiveChecksPanel checks={buildChecks()} showLocalBanner />);
    expect(screen.getByText(/本地快速检测/)).toBeInTheDocument();
    expect(screen.getByText(/AI 深度分析/)).toBeInTheDocument();
  });

  it('明度标尺:aria-label 含范围,min/max 数值标签与利用率可见', () => {
    render(<ObjectiveChecksPanel checks={buildChecks()} />);
    expect(
      screen.getByRole('img', { name: /明度直方图,明度范围 40 到 230/ }),
    ).toBeInTheDocument();
    expect(screen.getByText('40')).toBeInTheDocument();
    expect(screen.getByText('230')).toBeInTheDocument();
    // 锚定正则:避免误匹配 grayness 检测项 value 中的"标尺利用率 70%"子串
    expect(screen.getByText(/^利用率 70%$/)).toBeInTheDocument();
  });

  it('luminanceScale 缺省时不渲染直方图', () => {
    render(<ObjectiveChecksPanel checks={buildChecks({ luminanceScale: undefined })} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  // ---------- Phase 2 批次⑥:按本校标准标记(档案阈值重判定版) ----------

  it('profileThresholdsApplied=true 时显示「按本校标准」标记', () => {
    render(<ObjectiveChecksPanel checks={buildChecks({ profileThresholdsApplied: true })} />);
    expect(screen.getByText('按本校标准')).toBeInTheDocument();
  });

  it('默认(引擎判定)不显示「按本校标准」标记', () => {
    render(<ObjectiveChecksPanel checks={buildChecks()} />);
    expect(screen.queryByText('按本校标准')).not.toBeInTheDocument();
  });
});
