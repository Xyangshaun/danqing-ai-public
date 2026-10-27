import { useState, useEffect, useCallback } from 'react';
import { Scale, RotateCcw, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import type {
  EvaluationPresetSummary,
  PresetDimension,
  ApplyPresetResponse,
} from '../types/api-contract';
import { getPresets, getPreset, applyPreset } from '../services/api';
import { useToast } from './ToastProvider';

interface PresetSelectorProps {
  /** 当前分析结果 ID */
  analysisId: string;
  /** 当前艺术类型(用于过滤预设) */
  artType: string;
  /** 各维度原始分数(用于本地实时预览) */
  dimensionScores: Record<string, number>;
  /** 当前综合分(用于对比显示) */
  currentScore: number;
}

/** 预设风格标签 */
const STYLE_LABELS: Record<string, string> = {
  academy: '美院基准',
  academic: '名教授',
  artist: '艺术家',
  applied: '设计取向',
  custom: '自定义',
};

/** 阶段标签 */
const STAGE_LABELS: Record<string, string> = {
  basic: '基础',
  foundation: '专业基础',
  advanced: '高级',
  creative: '创作',
};

export default function PresetSelector({
  analysisId,
  artType,
  dimensionScores,
  currentScore,
}: PresetSelectorProps) {
  const toast = useToast();
  const [presets, setPresets] = useState<EvaluationPresetSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [customWeights, setCustomWeights] = useState<PresetDimension[]>([]);
  const [previewScore, setPreviewScore] = useState<number | null>(null);
  const [applyResult, setApplyResult] = useState<ApplyPresetResponse | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [expanded, setExpanded] = useState(false);

  /* 加载预设列表 */
  useEffect(() => {
    setListLoading(true);
    getPresets()
      .then((list) => {
        const filtered = list.filter(
          (p) => p.artType === artType && p.enabled,
        );
        setPresets(filtered);
        if (filtered.length > 0 && !selectedId) {
          const defaultPreset = filtered.find((p) => p.sortOrder === Math.min(...filtered.map((x) => x.sortOrder)));
          if (defaultPreset) setSelectedId(defaultPreset.id);
        }
      })
      .catch(() => {
        toast.error('加载预设失败', '请检查网络后重试');
      })
      .finally(() => setListLoading(false));
  }, [artType, toast, selectedId]);

  /* 选中预设变化时,获取详情并初始化权重 */
  useEffect(() => {
    if (!selectedId) return;
    getPreset(selectedId)
      .then((detail) => {
        setCustomWeights(detail.dimensions.map((d) => ({ ...d })));
        setApplyResult(null);
      })
      .catch(() => {
        toast.error('加载预设详情失败', '请稍后重试');
      });
  }, [selectedId, toast]);

  /* 本地实时预览加权分 */
  useEffect(() => {
    if (customWeights.length === 0) return;
    const total = customWeights.reduce((sum, d) => sum + d.weight, 0);
    if (total === 0) return;
    let weighted = 0;
    for (const dim of customWeights) {
      const score = dimensionScores[dim.key];
      if (score !== undefined) {
        weighted += score * (dim.weight / total);
      }
    }
    setPreviewScore(Math.round(weighted));
  }, [customWeights, dimensionScores]);

  /* 权重滑块变化 */
  const handleWeightChange = useCallback(
    (key: string, newWeight: number) => {
      setCustomWeights((prev) =>
        prev.map((d) => (d.key === key ? { ...d, weight: newWeight } : d)),
      );
    },
    [],
  );

  /* 权重总和校验 */
  const weightSum = customWeights.reduce((sum, d) => sum + d.weight, 0);
  const isWeightValid = Math.abs(weightSum - 100) < 0.01;

  /* 应用预设 */
  const handleApply = useCallback(async () => {
    if (!isWeightValid) {
      toast.error('权重总和需为 100%', `当前 ${weightSum}%`);
      return;
    }
    setApplying(true);
    try {
      const result = await applyPreset({ analysisId, presetId: selectedId });
      setApplyResult(result);
      toast.success('预设已应用', `加权总分: ${result.weightedScore} 分`);
    } catch {
      /* Toast 已由 api.ts 全局处理 */
    } finally {
      setApplying(false);
    }
  }, [analysisId, selectedId, isWeightValid, weightSum, toast]);

  /* 重置为预设默认权重 */
  const handleReset = useCallback(() => {
    if (!selectedId) return;
    getPreset(selectedId)
      .then((detail) => {
        setCustomWeights(detail.dimensions.map((d) => ({ ...d })));
        setApplyResult(null);
      })
      .catch(() => {
        toast.error('加载预设详情失败', '请稍后重试');
      });
  }, [selectedId, toast]);

  if (listLoading) {
    return (
      <div className="bg-rice-50 rounded-2xl p-6 shadow-card">
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 text-ink-400 animate-spin" />
          <span className="ml-2 text-sm text-ink-500">加载评分预设...</span>
        </div>
      </div>
    );
  }

  if (presets.length === 0) return null;

  const selectedPreset = presets.find((p) => p.id === selectedId);

  return (
    <div className="bg-rice-50 rounded-2xl p-6 shadow-card">
      {/* 标题栏 */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gold/10 rounded-lg flex items-center justify-center">
            <Scale className="w-5 h-5 text-gold" />
          </div>
          <div>
            <h3 className="font-serif text-lg font-bold text-ink-900">评分预设</h3>
            <p className="text-xs text-ink-500">选择评分标准,调节维度权重</p>
          </div>
        </div>
        {previewScore !== null && (
          <div className="text-right">
            <p className="text-xs text-ink-500">预览加权分</p>
            <p className="font-serif text-xl font-bold text-cinnabar">{previewScore}</p>
          </div>
        )}
      </div>

      {/* 预设选择下拉 */}
      <div className="mb-4">
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className="w-full bg-white border border-ink-200 rounded-lg px-3 py-2 text-sm text-ink-800 focus:outline-none focus:ring-2 focus:ring-cinnabar/30 focus:border-cinnabar"
        >
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.isBuiltIn ? ' (内置)' : ''}
              {' — '}
              {STYLE_LABELS[p.styleType] ?? p.styleType}
            </option>
          ))}
        </select>
        {selectedPreset && (
          <p className="text-xs text-ink-500 mt-1.5">
            {selectedPreset.description ?? ''}
            {' · '}
            {STAGE_LABELS[selectedPreset.applicableStage] ?? selectedPreset.applicableStage}阶段
          </p>
        )}
      </div>

      {/* 权重调节区域(可折叠) */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1.5 text-sm text-ink-600 hover:text-cinnabar transition-colors mb-2"
      >
        {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        <span className="font-medium">维度权重调节</span>
        <span className={`text-xs ml-1 ${isWeightValid ? 'text-jade' : 'text-cinnabar'}`}>
          (总和: {weightSum}%)
        </span>
      </button>

      {expanded && (
        <div className="space-y-3 mb-4 bg-white/60 rounded-xl p-4 border border-ink-100">
          {customWeights.map((dim) => (
            <div key={dim.key} className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-sm text-ink-700">{dim.label}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-ink-500 w-10 text-right">
                    {dim.weight}%
                  </span>
                </div>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={dim.weight}
                onChange={(e) => handleWeightChange(dim.key, Number(e.target.value))}
                className="w-full h-1.5 bg-ink-200 rounded-full appearance-none cursor-pointer accent-cinnabar"
              />
            </div>
          ))}

          {/* 权重分布条形图 */}
          <div className="flex h-3 rounded-full overflow-hidden mt-2">
            {customWeights.map((dim) => (
              <div
                key={dim.key}
                className="h-full transition-all duration-300"
                style={{
                  width: `${dim.weight}%`,
                  backgroundColor: `hsl(${(customWeights.indexOf(dim) * 90 + 350) % 360}, 55%, 50%)`,
                }}
                title={`${dim.label}: ${dim.weight}%`}
              />
            ))}
          </div>

          {/* 操作按钮 */}
          <div className="flex gap-2 pt-2">
            <button
              onClick={handleReset}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border border-ink-300 text-ink-600 rounded-lg hover:bg-ink-50 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              重置
            </button>
            <button
              onClick={handleApply}
              disabled={!isWeightValid || applying}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs bg-cinnabar text-white rounded-lg hover:bg-cinnabar-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {applying ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Scale className="w-3.5 h-3.5" />
              )}
              {applying ? '应用中...' : '应用预设重算'}
            </button>
          </div>
        </div>
      )}

      {/* 应用结果 */}
      {applyResult && (
        <div className="mt-4 bg-cinnabar/5 rounded-xl p-4 border border-cinnabar/20">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-ink-800">
              加权总分: <span className="font-serif text-lg font-bold text-cinnabar">{applyResult.weightedScore}</span>
              <span className="text-xs text-ink-500 ml-1">/ 100</span>
            </span>
            <span className="text-xs text-ink-500">
              原综合分: {currentScore}
              {' → '}
              <span className={applyResult.weightedScore >= currentScore ? 'text-jade' : 'text-cinnabar'}>
                {applyResult.weightedScore >= currentScore ? '+' : ''}
                {applyResult.weightedScore - currentScore}
              </span>
            </span>
          </div>
          <div className="space-y-1.5">
            {applyResult.weightedDimensions.map((d) => (
              <div key={d.key} className="flex items-center justify-between text-xs">
                <span className="text-ink-600">{d.label}</span>
                <span className="font-mono text-ink-700">
                  {d.originalScore} × {d.weight}% = {d.weightedContribution.toFixed(1)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
