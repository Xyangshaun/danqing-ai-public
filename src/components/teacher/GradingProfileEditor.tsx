// ============================================================
// 丹青有AI - 评分档案 LUT 式编辑器(双阶段反馈框架 Phase 2 批次⑤)
// 对应文档:visual-annotation-feedback-upgrade-spec-2026-09.md §4
//
// 设计说明:
//   - 编辑对象:租户档案(克隆/自建);系统内置档案渲染为只读+预览
//   - 滑杆模式:
//     · 维度权重:照 PresetSelector(range + 总和=100 实时校验 + 权重分布条)
//     · 阈值/档位/风格:照 GenerationParamsPanel(range + 渐变轨道 + 两端语义标签)
//   - 本地预览:输入各维度模拟分 → 加权综合分 + 档位落点 + 将触发的反馈模式
//     (换算逻辑与后端批次③④引擎同语义:归一化加权/降序区间查档/<basicsLine 诊断)
//   - 校验失败(权重≠100/名称为空/objectiveChecks 非正值)禁用保存按钮
//   - tierMapping 滑杆联动 clamp 到相邻档位之间,保证严格降序不被破坏;
//     末档为兜底档 min=0 固定不可改
//   - 组件不直接使用 Toast(便于测试);保存成功由父级 onSaved 处理
//
// Phase 5 批次③(风格沉淀):
//   - 顶部条件渲染「风格建议卡片」(租户批注行为聚合 → 引擎推导,只读展示)
//   - 一键采纳 = 先调采纳记录端点(后端按当前档案配置做一致性校验),
//     再走既有 PATCH(Zod 全量校验)写入 feedbackStyle 参数变更
// ============================================================

import { useEffect, useMemo, useState } from 'react';
import { Save, Loader2, Lock, Eye, RotateCcw, Sparkles } from 'lucide-react';
import {
  updateGradingProfile,
  getProfileSuggestions,
  recordSuggestionAdoption,
} from '../../services/grading-profile-api';
import {
  FEEDBACK_MODE_LABELS,
  GRADING_PROFILE_CATEGORY_LABELS,
  SUGGESTION_KEY_LABELS,
  type FeedbackMode,
  type GradingProfileDetail,
  type GradingProfileDimensionWeight,
  type GradingProfileTier,
  type GradingStyleSuggestion,
  type SuggestionKey,
} from '../../types/grading-profile';

/* ============================================================
 * 导出的纯换算函数(测试消费;与后端引擎同语义)
 * ============================================================ */

/**
 * 加权综合分(本地预览用)
 * 权重和≠100 时按当前权重归一化,预览不因校验不过而中断
 * (照 PresetSelector L89-101 预览语义)
 */
export function computeWeightedScore(
  dimensions: readonly GradingProfileDimensionWeight[],
  scores: Readonly<Record<string, number>>,
): number {
  let weighted = 0;
  let total = 0;
  for (const d of dimensions) {
    const score = scores[d.key];
    if (score === undefined || !Number.isFinite(score)) continue;
    weighted += score * d.weight;
    total += d.weight;
  }
  if (total <= 0) return 0;
  return Math.round((weighted / total) * 10) / 10;
}

/**
 * 综合分 → 档位(降序区间查找,与后端 mapScoreToTier 同语义:
 * 档位线含左值——85→A、84.9→B)
 */
export function findTierForScore(
  score: number,
  tierMapping: readonly GradingProfileTier[],
): GradingProfileTier | undefined {
  if (!Number.isFinite(score) || tierMapping.length === 0) return undefined;
  for (const t of tierMapping) {
    if (score >= t.min) return t;
  }
  return tierMapping[tierMapping.length - 1];
}

/**
 * 输出层反馈模式真实判定(与批次③引擎同语义:
 * 综合分 < basicsLine → 诊断;≥ → 引导)
 */
export function predictFeedbackModeByScore(score: number, basicsLine: number): FeedbackMode {
  return score < basicsLine ? 'diagnosis' : 'guidance';
}

/** 建议值展示文本(positiveRatio 百分比,其余原值;建议卡片共用) */
export function formatStyleSuggestionValue(key: SuggestionKey, value: number): string {
  return key === 'positiveRatio' ? `${Math.round(value * 100)}%` : `${value}`;
}

/* ============================================================
 * 常量
 * ============================================================ */

/** 四项客观检测的引擎默认阈值(analysis-engine.service.ts;批次⑥消费覆盖值) */
export const DEFAULT_OBJECTIVE_CHECKS = {
  graynessUtil: 0.5,
  contrastMichelson: 0.35,
  saturationLow: 0.75,
  focusOffset: 0.18,
} as const;

/** 预览区各维度模拟分默认值 */
const PREVIEW_SCORE_DEFAULT = 75;

/** 权重总和容差(照 PresetSelector) */
const WEIGHT_SUM_TOLERANCE = 0.01;

/* ============================================================
 * 内部小组件:滑杆行(照 GenerationParamsPanel 渐变轨道 + 两端语义标签)
 * ============================================================ */

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  onChange,
  disabled,
  accent = '#b5443a',
  lowLabel,
  highLabel,
  valueText,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  accent?: string;
  lowLabel?: string;
  highLabel?: string;
  valueText?: string;
}) {
  const ratio = max > min ? (value - min) / (max - min) : 0;
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm text-ink-700">{label}</p>
        <span className="text-xs font-mono text-ink-500">{valueText ?? value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
        data-testid={`slider-${label}`}
        className="w-full h-2 rounded-full appearance-none cursor-pointer bg-ink-100 disabled:opacity-50 disabled:cursor-not-allowed"
        style={{
          background: `linear-gradient(to right, ${accent} 0%, ${accent} ${ratio * 100}%, #e8e3dd ${ratio * 100}%, #e8e3dd 100%)`,
        }}
      />
      {(lowLabel || highLabel) && (
        <div className="flex justify-between mt-1">
          <span className="text-xs text-ink-400">{lowLabel}</span>
          <span className="text-xs text-ink-400">{highLabel}</span>
        </div>
      )}
    </div>
  );
}

/** 区块卡片(编辑器内小节,视觉层级低于页面 AdminSection) */
function EditorBlock({
  title,
  desc,
  children,
}: {
  title: string;
  desc?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-white/70 border border-ink-900/10 rounded-xl p-4">
      <div className="mb-3">
        <h4 className="text-sm font-semibold text-ink-800">{title}</h4>
        {desc && <p className="text-xs text-ink-400 mt-0.5">{desc}</p>}
      </div>
      {children}
    </section>
  );
}

/* ============================================================
 * 主组件
 * ============================================================ */

interface GradingProfileEditorProps {
  detail: GradingProfileDetail;
  /** 保存成功回调(返回后端更新后的详情;内置档案无保存按钮) */
  onSaved?: (detail: GradingProfileDetail) => void;
  /** 取消/返回回调 */
  onCancel?: () => void;
}

export default function GradingProfileEditor({
  detail,
  onSaved,
  onCancel,
}: GradingProfileEditorProps) {
  // 系统内置档案只读(克隆后可微调;后端对 isBuiltIn 强制禁改)
  const readOnly = detail.isBuiltIn;

  const [name, setName] = useState(detail.name);
  const [description, setDescription] = useState(detail.description ?? '');
  const [config, setConfig] = useState(() => structuredClone(detail.config));
  const [previewScores, setPreviewScores] = useState<Record<string, number>>(() =>
    Object.fromEntries(
      detail.config.dimensionWeights.map((d) => [d.key, PREVIEW_SCORE_DEFAULT]),
    ),
  );
  const [saving, setSaving] = useState(false);

  /* ---------- 风格建议(Phase 5 批次③) ---------- */
  const [suggestions, setSuggestions] = useState<GradingStyleSuggestion[] | null>(null);
  const [adoptingKey, setAdoptingKey] = useState<SuggestionKey | null>(null);

  // 档案级建议加载(失败静默:建议是增值信息,不阻塞编辑主流程)
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await getProfileSuggestions(detail.id);
        if (!cancelled) setSuggestions(res.suggestions);
      } catch {
        if (!cancelled) setSuggestions(null);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [detail.id]);

  /* ---------- 校验 ---------- */
  const weightSum = useMemo(
    () => config.dimensionWeights.reduce((sum, d) => sum + d.weight, 0),
    [config.dimensionWeights],
  );
  const isWeightValid = Math.abs(weightSum - 100) < WEIGHT_SUM_TOLERANCE;

  /** objectiveChecks 覆盖值(启用时来自 config,否则展示引擎默认) */
  const checksValues = config.objectiveChecks ?? DEFAULT_OBJECTIVE_CHECKS;
  const checksEnabled = !!config.objectiveChecks;
  const isChecksValid = !checksEnabled || Object.values(checksValues).every((v) => v > 0);

  const nameValid = name.trim().length > 0;
  const canSave = !readOnly && nameValid && isWeightValid && isChecksValid && !saving;

  /** 一键采纳可用性(与保存同一校验口径:PATCH 会整体提交当前编辑态) */
  const canAdopt =
    !readOnly && nameValid && isWeightValid && isChecksValid && !saving && adoptingKey === null;

  /* ---------- 预览计算 ---------- */
  const weightedScore = useMemo(
    () => computeWeightedScore(config.dimensionWeights, previewScores),
    [config.dimensionWeights, previewScores],
  );
  const previewTier = useMemo(
    () => findTierForScore(weightedScore, config.tierMapping),
    [weightedScore, config.tierMapping],
  );
  const previewMode = predictFeedbackModeByScore(weightedScore, config.thresholds.basicsLine);

  /* ---------- 变更 handlers ---------- */

  const handleWeightChange = (key: string, newWeight: number) => {
    setConfig((prev) => ({
      ...prev,
      dimensionWeights: prev.dimensionWeights.map((d) =>
        d.key === key ? { ...d, weight: newWeight } : d,
      ),
    }));
  };

  /**
   * 档位线滑杆:clamp 到 (下一档 min, 上一档 min) 开区间内,
   * 恒保证严格降序;末档兜底 min=0 固定不渲染滑杆
   */
  const handleTierMinChange = (index: number, raw: number) => {
    setConfig((prev) => {
      const mapping = [...prev.tierMapping];
      const next = mapping[index + 1];
      const upper = mapping[index - 1];
      const lo = next ? next.min + 1 : 1;
      const hi = upper ? upper.min - 1 : 100;
      const clamped = Math.max(lo, Math.min(hi, raw));
      mapping[index] = { ...mapping[index]!, min: clamped };
      return { ...prev, tierMapping: mapping };
    });
  };

  const handleFeedbackStyleChange = (key: 'diagnosisIntensity' | 'positiveRatio' | 'toneStrictness', value: number) => {
    setConfig((prev) => ({
      ...prev,
      feedbackStyle: { ...prev.feedbackStyle, [key]: value },
    }));
  };

  /** objectiveChecks 覆盖值变更(undefined 视为清除该项走默认) */
  const handleChecksValueChange = (key: keyof typeof DEFAULT_OBJECTIVE_CHECKS, raw: string) => {
    const parsed = Number(raw);
    setConfig((prev) => {
      const base = prev.objectiveChecks ?? { ...DEFAULT_OBJECTIVE_CHECKS };
      return {
        ...prev,
        objectiveChecks: { ...base, [key]: Number.isFinite(parsed) ? parsed : 0 },
      };
    });
  };

  /** 重置为加载时的原始配置 */
  const handleReset = () => {
    setName(detail.name);
    setDescription(detail.description ?? '');
    setConfig(structuredClone(detail.config));
  };

  /* ---------- 保存 ---------- */

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const updated = await updateGradingProfile(detail.id, {
        name: name.trim(),
        description: description.trim(),
        config,
      });
      onSaved?.(updated);
    } catch {
      // 错误已由 api.ts 统一 Toast
    } finally {
      setSaving(false);
    }
  };

  /* ---------- 一键采纳(Phase 5 批次③) ---------- */

  /**
   * 采纳流程(顺序不可换):
   *   1. 采纳记录端点——后端按「当前档案配置」做建议一致性校验,
   *      必须在 PATCH 之前调用(PATCH 后 currentValue 变化会导致校验 400)
   *   2. 既有 PATCH 写入参数变更(Zod 全量校验,携带当前编辑态整体保存)
   *   3. 本地移除该条建议(后端防重复过滤的镜像;失败静默重试)
   */
  const handleAdopt = async (s: GradingStyleSuggestion) => {
    if (!canAdopt) return;
    setAdoptingKey(s.suggestionKey);
    try {
      await recordSuggestionAdoption(detail.id, {
        suggestionKey: s.suggestionKey,
        beforeValue: s.currentValue,
        afterValue: s.suggestedValue,
      });
      const nextConfig = structuredClone(config);
      nextConfig.feedbackStyle = {
        ...nextConfig.feedbackStyle,
        [s.suggestionKey]: s.suggestedValue,
      };
      const updated = await updateGradingProfile(detail.id, {
        name: name.trim(),
        description: description.trim(),
        config: nextConfig,
      });
      setConfig(nextConfig);
      onSaved?.(updated);
      setSuggestions((prev) =>
        prev ? prev.filter((x) => x.suggestionKey !== s.suggestionKey) : prev,
      );
    } catch {
      // 错误已由 api.ts 统一 Toast;保持卡片状态供刷新后重试
    } finally {
      setAdoptingKey(null);
    }
  };

  /* ---------- 渲染 ---------- */

  return (
    <div className="space-y-4" data-testid="grading-profile-editor">
      {/* 只读横幅(系统内置) */}
      {readOnly && (
        <div className="flex items-start gap-2 bg-gold/5 border border-gold/25 rounded-xl p-4">
          <Lock className="w-4 h-4 text-gold-dark flex-shrink-0 mt-0.5" />
          <p className="text-xs text-ink-600 leading-relaxed">
            系统内置档案,只读展示。点击「克隆微调」生成本校专属副本后即可修改权重与档位线。
          </p>
        </div>
      )}

      {/* 风格建议卡片(Phase 5 批次③:租户批注行为聚合推导,有建议时显示) */}
      {suggestions !== null && suggestions.length > 0 && (
        <section
          data-testid="suggestion-card"
          className="bg-jade/5 border border-jade/30 rounded-xl p-4"
        >
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="w-4 h-4 text-jade flex-shrink-0" />
            <h4 className="text-sm font-semibold text-ink-800">风格建议(基于本校批注行为数据)</h4>
          </div>
          <ul className="space-y-2">
            {suggestions.map((s) => (
              <li
                key={s.suggestionKey}
                data-testid={`suggestion-${s.suggestionKey}`}
                className="flex items-start justify-between gap-3 bg-white/70 border border-jade/15 rounded-lg p-3"
              >
                <div className="min-w-0">
                  <p className="text-sm text-ink-700">
                    {SUGGESTION_KEY_LABELS[s.suggestionKey]}:
                    <span className="font-mono text-ink-500 mx-1">
                      {formatStyleSuggestionValue(s.suggestionKey, s.currentValue)}
                    </span>
                    <span className="text-ink-400 mx-0.5">→</span>
                    <span className="font-mono font-semibold text-jade ml-1">
                      {formatStyleSuggestionValue(s.suggestionKey, s.suggestedValue)}
                    </span>
                  </p>
                  <p className="text-xs text-ink-400 mt-1 leading-relaxed" data-testid={`suggestion-basis-${s.suggestionKey}`}>
                    {s.basis}
                  </p>
                </div>
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => void handleAdopt(s)}
                    disabled={!canAdopt}
                    data-testid={`adopt-${s.suggestionKey}`}
                    className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 h-8 rounded-md border border-jade/40 bg-jade/10 text-jade text-xs font-medium hover:bg-jade/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {adoptingKey === s.suggestionKey ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : null}
                    {adoptingKey === s.suggestionKey ? '采纳中…' : '一键采纳'}
                  </button>
                )}
              </li>
            ))}
          </ul>
          <p className="text-xs text-ink-400 mt-2">
            {readOnly
              ? '建议基于本校批注行为推导;克隆档案后可在副本中应用调整'
              : '一键采纳 = 写入档案配置并记录审计;也可直接拖动「反馈风格」滑杆手动调整'}
          </p>
        </section>
      )}

      {/* 基本信息 */}
      <EditorBlock title="基本信息" desc="档案名称与用途说明(教师本人可见)">
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-ink-500 mb-1.5">档案名称 *</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={readOnly || saving}
              maxLength={64}
              placeholder="例如:联考素描 · 本校强化档"
              className="w-full h-9 px-3 rounded-md border border-ink-900/15 bg-white text-sm text-ink-800 focus:outline-none focus:ring-2 focus:ring-stone/30 disabled:opacity-60"
            />
            {!nameValid && (
              <p className="text-xs text-cinnabar mt-1">名称不能为空</p>
            )}
          </div>
          <div>
            <label className="block text-xs text-ink-500 mb-1.5">描述(可选)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={readOnly || saving}
              rows={2}
              maxLength={500}
              placeholder="适用班级、评分取向等"
              className="w-full px-3 py-2 rounded-md border border-ink-900/15 bg-white text-sm text-ink-800 resize-none focus:outline-none focus:ring-2 focus:ring-stone/30 disabled:opacity-60"
            />
          </div>
          <div className="flex items-center gap-2 text-xs text-ink-400">
            <span className="inline-flex items-center px-2 py-0.5 rounded bg-stone/10 text-stone">
              {GRADING_PROFILE_CATEGORY_LABELS[detail.category]}类目
            </span>
            {detail.forkedFromId && <span>克隆档案</span>}
          </div>
        </div>
      </EditorBlock>

      {/* 维度权重(照 PresetSelector 模式) */}
      <EditorBlock
        title="维度权重"
        desc="各维度在综合分中的占比,总和须为 100"
      >
        <div className="space-y-3">
          {config.dimensionWeights.map((dim) => (
            <div key={dim.key} className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-sm text-ink-700">{dim.label}</span>
                <span className="text-xs font-mono text-ink-500 w-12 text-right">
                  {dim.weight}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={dim.weight}
                disabled={readOnly || saving}
                onChange={(e) => handleWeightChange(dim.key, Number(e.target.value))}
                aria-label={`${dim.label}权重`}
                data-testid={`weight-${dim.key}`}
                className="w-full h-1.5 bg-ink-200 rounded-full appearance-none cursor-pointer accent-cinnabar disabled:opacity-50 disabled:cursor-not-allowed"
              />
            </div>
          ))}

          {/* 权重分布条形图(照 PresetSelector) */}
          <div className="flex h-3 rounded-full overflow-hidden mt-2">
            {config.dimensionWeights.map((dim, i) => (
              <div
                key={dim.key}
                className="h-full transition-all duration-300"
                style={{
                  width: `${dim.weight}%`,
                  backgroundColor: `hsl(${(i * 90 + 350) % 360}, 55%, 50%)`,
                }}
                title={`${dim.label}: ${dim.weight}%`}
              />
            ))}
          </div>

          <p
            className={`text-xs mt-1 ${
              isWeightValid ? 'text-jade' : 'text-cinnabar'
            }`}
            data-testid="weight-sum"
          >
            权重总和:{weightSum}%{!isWeightValid && '(须为 100% 才能保存)'}
          </p>
        </div>
      </EditorBlock>

      {/* 综合分预览 */}
      <EditorBlock
        title="综合分预览"
        desc="输入各维度模拟分,实时查看加权综合分、预估档位与将触发的反馈模式(纯本地模拟,不保存)"
      >
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {config.dimensionWeights.map((dim) => (
              <label key={dim.key} className="flex items-center justify-between gap-2 text-sm">
                <span className="text-ink-700 truncate">{dim.label}</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={previewScores[dim.key] ?? 0}
                  onChange={(e) =>
                    setPreviewScores((prev) => ({
                      ...prev,
                      [dim.key]: Number(e.target.value),
                    }))
                  }
                  aria-label={`${dim.label}模拟分`}
                  data-testid={`preview-score-${dim.key}`}
                  className="w-16 h-8 px-2 rounded-md border border-ink-900/15 bg-white text-sm text-ink-800 text-right font-mono focus:outline-none focus:ring-2 focus:ring-stone/30"
                />
              </label>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-ink-900/5">
            <div className="flex items-baseline gap-1.5">
              <span className="text-xs text-ink-500">加权综合分</span>
              <span className="font-serif text-xl font-semibold text-cinnabar" data-testid="preview-score">
                {weightedScore}
              </span>
            </div>
            {previewTier && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-gold/10 text-gold-dark text-xs" data-testid="preview-tier">
                预估 {previewTier.key} 档
              </span>
            )}
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${
                previewMode === 'diagnosis'
                  ? 'bg-cinnabar/10 text-cinnabar'
                  : 'bg-jade/10 text-jade'
              }`}
              data-testid="preview-mode"
            >
              {FEEDBACK_MODE_LABELS[previewMode]}
            </span>
          </div>
        </div>
      </EditorBlock>

      {/* 阈值与档位 */}
      <EditorBlock
        title="阈值与档位"
        desc="达标线决定反馈模式切换;档位线将综合分换算为预估档(末档为兜底档,固定 0 分)"
      >
        <div className="space-y-5">
          <SliderRow
            label="综合分达标线"
            value={config.thresholds.basicsLine}
            min={0}
            max={100}
            step={1}
            disabled={readOnly || saving}
            lowLabel="低门槛"
            highLabel="高标准"
            valueText={`${config.thresholds.basicsLine} 分`}
            onChange={(v) =>
              setConfig((prev) => ({
                ...prev,
                thresholds: { ...prev.thresholds, basicsLine: v },
              }))
            }
          />
          <p className="text-xs text-ink-400 -mt-3">
            综合分低于达标线输出诊断模式,达到则切换引导模式
          </p>

          <div className="space-y-3">
            {config.tierMapping.map((tier, i) => {
              const next = config.tierMapping[i + 1];
              const upper = config.tierMapping[i - 1];
              const isLast = i === config.tierMapping.length - 1;
              if (isLast) {
                return (
                  <div key={tier.key} className="flex items-center justify-between text-xs text-ink-400">
                    <span>{tier.key} 档(兜底档)</span>
                    <span className="font-mono">min = 0(固定)</span>
                  </div>
                );
              }
              return (
                <SliderRow
                  key={tier.key}
                  label={`${tier.key} 档线(${tier.label})`}
                  value={tier.min}
                  min={next ? next.min + 1 : 1}
                  max={upper ? upper.min - 1 : 100}
                  step={1}
                  disabled={readOnly || saving}
                  lowLabel={next ? `> ${next.key} 档` : undefined}
                  highLabel={upper ? `< ${upper.key} 档` : undefined}
                  valueText={`≥ ${tier.min} 分`}
                  onChange={(v) => handleTierMinChange(i, v)}
                />
              );
            })}
          </div>
        </div>
      </EditorBlock>

      {/* 反馈风格 */}
      <EditorBlock title="反馈风格" desc="AI 反馈的语气与侧重(冷启动时的默认反馈模式也在此选择)">
        <div className="space-y-5">
          {/* 默认反馈模式(分段选择) */}
          <div>
            <p className="text-sm text-ink-700 mb-2">冷启动默认反馈模式</p>
            <div className="grid grid-cols-2 gap-2">
              {(['diagnosis', 'guidance'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  disabled={readOnly || saving}
                  onClick={() =>
                    setConfig((prev) => ({ ...prev, defaultFeedbackMode: mode }))
                  }
                  className={`px-3 py-2 rounded-lg border text-sm transition-colors disabled:opacity-50 ${
                    config.defaultFeedbackMode === mode
                      ? 'border-cinnabar bg-cinnabar/5 text-cinnabar'
                      : 'border-ink-900/10 bg-white text-ink-600 hover:bg-rice-100'
                  }`}
                >
                  {FEEDBACK_MODE_LABELS[mode]}
                </button>
              ))}
            </div>
            <p className="text-xs text-ink-400 mt-1">
              学生有历史成绩后将按达标线自动切换,此处仅作冷启动默认
            </p>
          </div>

          <SliderRow
            label="诊断强度"
            value={config.feedbackStyle.diagnosisIntensity}
            min={1}
            max={5}
            step={1}
            disabled={readOnly || saving}
            lowLabel="温和指出"
            highLabel="直击要害"
            onChange={(v) => handleFeedbackStyleChange('diagnosisIntensity', v)}
          />
          <SliderRow
            label="正面反馈占比"
            value={config.feedbackStyle.positiveRatio}
            min={0}
            max={1}
            step={0.05}
            disabled={readOnly || saving}
            lowLabel="严格为主"
            highLabel="鼓励为主"
            valueText={`${Math.round(config.feedbackStyle.positiveRatio * 100)}%`}
            onChange={(v) => handleFeedbackStyleChange('positiveRatio', v)}
          />
          <SliderRow
            label="语气严格度"
            value={config.feedbackStyle.toneStrictness}
            min={1}
            max={5}
            step={1}
            disabled={readOnly || saving}
            lowLabel="轻松亲切"
            highLabel="严谨正式"
            onChange={(v) => handleFeedbackStyleChange('toneStrictness', v)}
          />
        </div>
      </EditorBlock>

      {/* 客观检测阈值覆盖(批次⑥消费) */}
      <EditorBlock
        title="客观检测阈值覆盖(进阶)"
        desc="覆盖画面灰/对比度/饱和度/构图重心四项检测的判定线;不勾选则使用系统默认"
      >
        <label className="flex items-center gap-2 text-sm text-ink-700 mb-3">
          <input
            type="checkbox"
            checked={checksEnabled}
            disabled={readOnly || saving}
            onChange={(e) => {
              setConfig((prev) => ({
                ...prev,
                objectiveChecks: e.target.checked
                  ? { ...(prev.objectiveChecks ?? DEFAULT_OBJECTIVE_CHECKS) }
                  : undefined,
              }));
            }}
            className="accent-cinnabar"
          />
          启用本校阈值覆盖
        </label>

        {checksEnabled && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-xs text-ink-500 mb-1">
                画面灰:利用率下限(默认 {DEFAULT_OBJECTIVE_CHECKS.graynessUtil})
              </span>
              <input
                type="number"
                min={0}
                step={0.01}
                value={checksValues.graynessUtil}
                disabled={readOnly || saving}
                onChange={(e) => handleChecksValueChange('graynessUtil', e.target.value)}
                aria-label="画面灰利用率下限"
                className="w-full h-8 px-2 rounded-md border border-ink-900/15 bg-white text-sm text-ink-800 font-mono focus:outline-none focus:ring-2 focus:ring-stone/30"
              />
            </label>
            <label className="block">
              <span className="block text-xs text-ink-500 mb-1">
                对比度:Michelson 下限(默认 {DEFAULT_OBJECTIVE_CHECKS.contrastMichelson})
              </span>
              <input
                type="number"
                min={0}
                step={0.01}
                value={checksValues.contrastMichelson}
                disabled={readOnly || saving}
                onChange={(e) => handleChecksValueChange('contrastMichelson', e.target.value)}
                aria-label="对比度 Michelson 下限"
                className="w-full h-8 px-2 rounded-md border border-ink-900/15 bg-white text-sm text-ink-800 font-mono focus:outline-none focus:ring-2 focus:ring-stone/30"
              />
            </label>
            <label className="block">
              <span className="block text-xs text-ink-500 mb-1">
                饱和度:低饱和占比上限(默认 {DEFAULT_OBJECTIVE_CHECKS.saturationLow})
              </span>
              <input
                type="number"
                min={0}
                step={0.01}
                value={checksValues.saturationLow}
                disabled={readOnly || saving}
                onChange={(e) => handleChecksValueChange('saturationLow', e.target.value)}
                aria-label="低饱和占比上限"
                className="w-full h-8 px-2 rounded-md border border-ink-900/15 bg-white text-sm text-ink-800 font-mono focus:outline-none focus:ring-2 focus:ring-stone/30"
              />
            </label>
            <label className="block">
              <span className="block text-xs text-ink-500 mb-1">
                构图重心:偏移容差上限(默认 {DEFAULT_OBJECTIVE_CHECKS.focusOffset})
              </span>
              <input
                type="number"
                min={0}
                step={0.01}
                value={checksValues.focusOffset}
                disabled={readOnly || saving}
                onChange={(e) => handleChecksValueChange('focusOffset', e.target.value)}
                aria-label="构图重心偏移容差上限"
                className="w-full h-8 px-2 rounded-md border border-ink-900/15 bg-white text-sm text-ink-800 font-mono focus:outline-none focus:ring-2 focus:ring-stone/30"
              />
            </label>
            {!isChecksValid && (
              <p className="text-xs text-cinnabar sm:col-span-2">阈值须为正数</p>
            )}
          </div>
        )}
        {!checksEnabled && (
          <p className="text-xs text-ink-400">
            当前使用系统默认阈值:画面灰利用率 ≥ 0.5、Michelson ≥ 0.35、低饱和占比 ≤ 0.75、重心偏移 ≤ 0.18
          </p>
        )}
      </EditorBlock>

      {/* 操作区 */}
      {!readOnly && (
        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            onClick={handleReset}
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-3 h-9 rounded-md border border-ink-900/15 text-sm text-ink-700 hover:bg-rice-100 disabled:opacity-50 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            重置
          </button>
          {onCancel && (
            <button
              onClick={onCancel}
              disabled={saving}
              className="px-4 h-9 rounded-md border border-ink-900/15 text-sm text-ink-700 hover:bg-rice-100 disabled:opacity-50 transition-colors"
            >
              取消
            </button>
          )}
          <button
            onClick={() => void handleSave()}
            disabled={!canSave}
            data-testid="save-profile"
            className="inline-flex items-center gap-1.5 px-4 h-9 rounded-md bg-cinnabar text-rice-50 text-sm hover:bg-cinnabar-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            {saving ? '保存中…' : '保存档案'}
          </button>
        </div>
      )}

      {/* 内置档案只读时的预览提示 */}
      {readOnly && (
        <p className="flex items-center gap-1.5 text-xs text-ink-400">
          <Eye className="w-3.5 h-3.5" />
          预览区可自由输入模拟分,查看这套预设的换算效果
        </p>
      )}
    </div>
  );
}
