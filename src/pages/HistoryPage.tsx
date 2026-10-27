import { useState, useEffect, useMemo, useCallback, memo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { History, Calendar, Eye, ArrowRight, X, Brush, PenTool, Box, Layers, Palette, Sparkles, Type, Gem, Settings, Move, RefreshCw, ImageOff, HelpCircle, Heart, Download, Trash2, Scroll } from 'lucide-react';
import { getAnalysisHistory, getAnalysisDetail, batchDeleteAnalyses, getSavedMaterials, removeSavedMaterial, type SavedMaterial } from '../services/data-service';
import { HERITAGE_CATEGORY_LABEL } from '../services/heritageDatabase';
import { useToast } from '../components/ToastProvider';
import type { HistoryRecord, AnalysisResult, PaintingAnalysis, DesignAnalysis, ProductAnalysis, SculptureAnalysis, ArtType, EvaluationStage } from '../types';
import HeatmapCanvas from '../components/HeatmapCanvas';
import { ListSkeleton, SkeletonBox } from '../components/PageSkeleton';
import EmptyState from '../components/EmptyState';
import { useVirtualList } from '../hooks/useVirtualList';
import { useLazyImage } from '../hooks/useLazyImage';
import SmartImage from '../components/SmartImage';
import RequestReviewSection from '../components/RequestReviewSection';
import ScoreCriteriaPanel from '../components/ScoreCriteriaPanel';
import DepthDimensionsPanel from '../components/DepthDimensionsPanel';
import IssueAnnotationLayer from '../components/IssueAnnotationLayer';
import ShareToOrgButton from '../components/org/ShareToOrgButton';

type ArtTypeFilter = 'all' | ArtType;
type ScoreFilter = 'all' | 'excellent' | 'good' | 'pending';
type SortMode = 'desc' | 'score_desc' | 'score_asc';
/* 主 Tab:诊断记录 / 我的生成 */
type MainTab = 'diagnosis' | 'generation';
/* 我的生成来源筛选 */
type GenSourceFilter = 'all' | 'emotion' | 'fuse';

const genSourceOptions: { id: GenSourceFilter; name: string }[] = [
  { id: 'all', name: '全部' },
  { id: 'emotion', name: '情绪作品' },
  { id: 'fuse', name: '灵感作品' },
];

const genSourceConfig: Record<SavedMaterial['source'], { name: string; icon: React.ComponentType<{ className?: string }>; color: string }> = {
  emotion: { name: '情绪作品', icon: Heart, color: 'bg-cinnabar' },
  fuse: { name: '灵感作品', icon: Sparkles, color: 'bg-stone' },
  material: { name: '素材收藏', icon: Brush, color: 'bg-gold' },
};

const artTypeConfig: Record<string, { name: string; icon: React.ComponentType<{ className?: string }>; color: string }> = {
  painting: { name: '绘画', icon: Brush, color: 'bg-cinnabar' },
  design: { name: '设计', icon: PenTool, color: 'bg-stone' },
  product: { name: '产品设计', icon: Box, color: 'bg-gold' },
  sculpture: { name: '雕塑', icon: Layers, color: 'bg-purple-500' },
  heritage: { name: '非遗工艺', icon: Gem, color: 'bg-gold' },
};

/* 评价阶段元信息(阶段 D Task 15.1:详情面板深度徽章复用)
 * teaching 三档用青绿色系;exam 三档用朱砂色系(对齐 AnalysisPage EVALUATION_STAGE_META) */
const EVALUATION_STAGE_META: Record<EvaluationStage, { label: string; tone: 'jade' | 'cinnabar' }> = {
  enthusiast: { label: '爱好者级', tone: 'jade' },
  intermediate: { label: '进阶层', tone: 'jade' },
  advanced: { label: '资深层', tone: 'jade' },
  unified: { label: '联考级', tone: 'cinnabar' },
  academy: { label: '美院级', tone: 'cinnabar' },
  master: { label: '大师级', tone: 'cinnabar' },
};

const artTypeOptions: { id: ArtTypeFilter; name: string }[] = [
  { id: 'all', name: '全部' },
  { id: 'painting', name: '绘画' },
  { id: 'design', name: '设计' },
  { id: 'product', name: '产品设计' },
  { id: 'sculpture', name: '雕塑' },
  { id: 'heritage', name: '非遗工艺' },
];

const scoreOptions: { id: ScoreFilter; name: string }[] = [
  { id: 'all', name: '全部' },
  { id: 'excellent', name: '优秀≥85' },
  { id: 'good', name: '良好70-84' },
  { id: 'pending', name: '待改进<70' },
];

const sortOptions: { id: SortMode; name: string }[] = [
  { id: 'desc', name: '最新优先' },
  { id: 'score_desc', name: '分数从高到低' },
  { id: 'score_asc', name: '分数从低到高' },
];

function getScoreBg(score: number) {
  if (score >= 85) return 'bg-jade';
  if (score >= 70) return 'bg-gold';
  return 'bg-cinnabar';
}

function isPainting(dims: AnalysisResult['dimensions']): dims is PaintingAnalysis {
  return dims.type === 'painting';
}
function isDesign(dims: AnalysisResult['dimensions']): dims is DesignAnalysis {
  return dims.type === 'design';
}
function isProduct(dims: AnalysisResult['dimensions']): dims is ProductAnalysis {
  return dims.type === 'product';
}
function isSculpture(dims: AnalysisResult['dimensions']): dims is SculptureAnalysis {
  return dims.type === 'sculpture';
}

function FilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`h-8 px-3 text-xs rounded-md transition-colors ${
        active ? 'bg-ink-900 text-rice-100' : 'text-ink-600 hover:bg-ink-900/5'
      }`}
    >
      {children}
    </button>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-ink-500 font-medium">{label}：</span>
      <div className="flex items-center gap-1">{children}</div>
    </div>
  );
}

function ScoreCard({ icon: Icon, label, score, color }: { icon: React.ComponentType<{className?: string}>, label: string, score: number | null, color: 'cinnabar' | 'stone' | 'gold' }) {
  const textColor = color === 'cinnabar' ? 'text-cinnabar' : color === 'stone' ? 'text-stone' : 'text-gold';
  const bgColor = color === 'cinnabar' ? 'bg-cinnabar/10' : color === 'stone' ? 'bg-stone/10' : 'bg-gold/10';
  return (
    <div className="bg-white rounded-xl p-4">
      <div className="flex items-center gap-2 mb-2">
        <Icon className={`w-5 h-5 ${textColor}`} />
        <span className="font-medium text-ink-700">{label}</span>
      </div>
      <div className={`w-12 h-12 ${bgColor} rounded-lg flex items-center justify-center`}>
        {/* 批次③:维度分可空(本地引擎停分),null 显示"—" */}
        <span className={`font-serif text-xl font-bold ${textColor}`}>{score ?? '—'}</span>
      </div>
    </div>
  );
}

function DetailModal({ result, onClose, onRediagnose }: { result: AnalysisResult; onClose: () => void; onRediagnose?: (artType: string) => void }) {
  const navigate = useNavigate();
  const dims = result.dimensions;
  /* Task 15:深度分析字段提取(仅 aiEnhanced 时非空) */
  const stage = result.evaluationStage;
  const stageMeta = stage ? EVALUATION_STAGE_META[stage] : undefined;
  const issueMarkers = result.issueMarkers ?? result.aiVisionResult?.issueMarkers;

  const renderPaintingDetail = (d: PaintingAnalysis) => (
    <>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <ScoreCard icon={Eye} label="构图" score={d.composition.score} color="cinnabar" />
        <ScoreCard icon={Palette} label="色彩" score={d.color.score} color="stone" />
        <ScoreCard icon={PenTool} label="笔触" score={d.brushwork.score} color="gold" />
      </div>
      <div className="bg-white rounded-xl p-4">
        <p className="font-medium text-ink-700 mb-3">视觉焦点热力图</p>
        <div className="flex justify-center">
          <HeatmapCanvas heatmapData={d.composition.heatmapData} focusPoint={d.composition.focusPoint} />
        </div>
      </div>
      <div className="space-y-3">
        <div className="bg-cinnabar/5 rounded-xl p-4 border border-cinnabar/20">
          <p className="text-sm font-medium text-cinnabar mb-1">构图建议</p>
          <p className="text-sm text-ink-600">{d.composition.suggestion}</p>
        </div>
        <div className="bg-stone/5 rounded-xl p-4 border border-stone/20">
          <p className="text-sm font-medium text-stone mb-1">色彩建议</p>
          <p className="text-sm text-ink-600">{d.color.suggestion}</p>
        </div>
        <div className="bg-gold/5 rounded-xl p-4 border border-gold/20">
          <p className="text-sm font-medium text-gold mb-1">笔触建议</p>
          <p className="text-sm text-ink-600">{d.brushwork.suggestion}</p>
        </div>
      </div>
    </>
  );

  const renderDesignDetail = (d: DesignAnalysis) => (
    <>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <ScoreCard icon={Eye} label="视觉层次" score={d.visualHierarchy.score} color="cinnabar" />
        <ScoreCard icon={Type} label="排版" score={d.typography.score} color="stone" />
        <ScoreCard icon={Palette} label="色彩应用" score={d.colorApplication.score} color="gold" />
      </div>
      <div className="bg-white rounded-xl p-4">
        <p className="font-medium text-ink-700 mb-3">视觉层次热力图</p>
        <div className="flex justify-center">
          <HeatmapCanvas heatmapData={d.visualHierarchy.heatmapData} focusPoint={d.visualHierarchy.focusPoint} />
        </div>
      </div>
      <div className="space-y-3">
        <div className="bg-cinnabar/5 rounded-xl p-4 border border-cinnabar/20">
          <p className="text-sm font-medium text-cinnabar mb-1">视觉层次建议</p>
          <p className="text-sm text-ink-600">{d.visualHierarchy.suggestion}</p>
        </div>
        <div className="bg-stone/5 rounded-xl p-4 border border-stone/20">
          <p className="text-sm font-medium text-stone mb-1">排版建议</p>
          <p className="text-sm text-ink-600">{d.typography.suggestion}</p>
        </div>
        <div className="bg-gold/5 rounded-xl p-4 border border-gold/20">
          <p className="text-sm font-medium text-gold mb-1">色彩应用建议</p>
          <p className="text-sm text-ink-600">{d.colorApplication.suggestion}</p>
        </div>
      </div>
    </>
  );

  const renderProductDetail = (d: ProductAnalysis) => (
    <>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <ScoreCard icon={Box} label="形态" score={d.form.score} color="cinnabar" />
        <ScoreCard icon={Gem} label="材质表现" score={d.materialExpression.score} color="stone" />
        <ScoreCard icon={Settings} label="功能表达" score={d.functionExpression.score} color="gold" />
      </div>
      <div className="bg-white rounded-xl p-4">
        <p className="font-medium text-ink-700 mb-3">形态焦点热力图</p>
        <div className="flex justify-center">
          <HeatmapCanvas heatmapData={d.form.heatmapData} focusPoint={d.form.focusPoint} />
        </div>
      </div>
      <div className="space-y-3">
        <div className="bg-cinnabar/5 rounded-xl p-4 border border-cinnabar/20">
          <p className="text-sm font-medium text-cinnabar mb-1">形态建议</p>
          <p className="text-sm text-ink-600">{d.form.suggestion}</p>
        </div>
        <div className="bg-stone/5 rounded-xl p-4 border border-stone/20">
          <p className="text-sm font-medium text-stone mb-1">材质表现建议</p>
          <p className="text-sm text-ink-600">{d.materialExpression.suggestion}</p>
        </div>
        <div className="bg-gold/5 rounded-xl p-4 border border-gold/20">
          <p className="text-sm font-medium text-gold mb-1">功能表达建议</p>
          <p className="text-sm text-ink-600">{d.functionExpression.suggestion}</p>
        </div>
      </div>
    </>
  );

  const renderSculptureDetail = (d: SculptureAnalysis) => (
    <>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <ScoreCard icon={Box} label="空间构成" score={d.spatialComposition.score} color="cinnabar" />
        <ScoreCard icon={Move} label="形体语言" score={d.bodyLanguage.score} color="stone" />
        <ScoreCard icon={Gem} label="材料语言" score={d.materialLanguage.score} color="gold" />
      </div>
      <div className="bg-white rounded-xl p-4">
        <p className="font-medium text-ink-700 mb-3">空间焦点热力图</p>
        <div className="flex justify-center">
          <HeatmapCanvas heatmapData={d.spatialComposition.heatmapData} focusPoint={d.spatialComposition.focusPoint} />
        </div>
      </div>
      <div className="space-y-3">
        <div className="bg-cinnabar/5 rounded-xl p-4 border border-cinnabar/20">
          <p className="text-sm font-medium text-cinnabar mb-1">空间构成建议</p>
          <p className="text-sm text-ink-600">{d.spatialComposition.suggestion}</p>
        </div>
        <div className="bg-stone/5 rounded-xl p-4 border border-stone/20">
          <p className="text-sm font-medium text-stone mb-1">形体语言建议</p>
          <p className="text-sm text-ink-600">{d.bodyLanguage.suggestion}</p>
        </div>
        <div className="bg-gold/5 rounded-xl p-4 border border-gold/20">
          <p className="text-sm font-medium text-gold mb-1">材料语言建议</p>
          <p className="text-sm text-ink-600">{d.materialLanguage.suggestion}</p>
        </div>
      </div>
    </>
  );

  return (
    <div
      className="fixed inset-0 bg-ink-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className={`rounded-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto ${
          result.aiEnhanced === true
            ? 'bg-rice-100 border-2 border-gold/50 shadow-[0_0_0_4px_rgba(202,169,89,0.08)]'
            : 'bg-rice-100'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-rice-100 border-b border-ink-200 p-4 flex items-center justify-between z-10">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="font-serif text-xl font-bold text-ink-900">分析报告详情</h2>
            {/* Task 15.1:AI 深度徽章 + 评价阶段标签(仅 aiEnhanced 且 stageMeta 时渲染) */}
            {result.aiEnhanced === true && stageMeta && (
              <span
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-xs font-medium ${
                  stageMeta.tone === 'cinnabar'
                    ? 'bg-cinnabar/10 border-cinnabar/30 text-cinnabar'
                    : 'bg-jade/10 border-jade/30 text-jade'
                }`}
                title={`AI 深度分析 · ${stageMeta.label}参照系`}
              >
                <Sparkles className="w-3 h-3" />
                AI 深度 · {stageMeta.label}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="关闭"
            className="p-2 hover:bg-ink-100 rounded-lg transition-colors"
          >
            <X className="w-6 h-6 text-ink-600" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          <div className="bg-white rounded-xl overflow-hidden relative min-h-[200px] flex items-center justify-center">
            {/* Task 15.2:aiEnhanced 且 issueMarkers 非空时用 IssueAnnotationLayer
                (自包含 img+canvas+tooltip)替代 SmartImage,避免双图;否则 SmartImage。 */}
            {(() => {
              if (result.aiEnhanced === true && issueMarkers && issueMarkers.length > 0) {
                return (
                  <IssueAnnotationLayer
                    imageUrl={result.imageUrl}
                    issueMarkers={issueMarkers}
                    className="w-full"
                    imgClassName="w-full max-h-64 min-h-[200px] object-contain"
                  />
                );
              }
              return (
                <SmartImage
                  src={result.imageUrl}
                  alt="分析的作品"
                  className="w-full max-h-64 min-h-[200px]"
                  imgClassName="object-contain transition-opacity duration-300"
                  fallbackText="作品图加载失败"
                />
              );
            })()}
          </div>

          <div className="flex items-center justify-center gap-4">
            <div className={`w-16 h-16 ${result.overallScore == null ? 'bg-ink-400' : getScoreBg(result.overallScore)} rounded-full flex items-center justify-center`}>
              <span className="font-serif text-3xl font-bold text-white">
                {result.overallScore ?? '—'}
              </span>
            </div>
            <div>
              <p className="font-serif text-lg font-semibold text-ink-900">
                {result.overallScore == null ? '待 AI 评分' : result.overallScore >= 85 ? '优秀' : result.overallScore >= 70 ? '良好' : '需改进'}
              </p>
              <p className="text-sm text-ink-500">创作类型：{artTypeConfig[result.artType]?.name}</p>
            </div>
          </div>

          {isPainting(dims) && renderPaintingDetail(dims)}
          {isDesign(dims) && renderDesignDetail(dims)}
          {isProduct(dims) && renderProductDetail(dims)}
          {isSculpture(dims) && renderSculptureDetail(dims)}

          <div className="bg-white rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="w-5 h-5 text-gold" />
              <span className="font-medium text-ink-700">原创性</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="w-12 h-12 bg-gold/10 rounded-lg flex items-center justify-center">
                <span className="font-serif text-xl font-bold text-gold">{result.originality.score}</span>
              </div>
              <div className="text-right">
                <p className="text-xs text-ink-500">相似度</p>
                <p className="text-sm font-medium text-ink-700">{(result.originality.similarity * 100).toFixed(0)}%</p>
              </div>
            </div>
          </div>

          <div className="bg-gold/5 rounded-xl p-4 border border-gold/20">
            <p className="text-sm font-medium text-gold mb-1">原创性建议</p>
            <p className="text-sm text-ink-600">{result.originality.suggestion}</p>
          </div>

          {/* Task 15.2:AI 深度分析专属内容(仅 aiEnhanced 时渲染)
            - 评分标准面板(各维度权重/等级/符合项/证据)
            - 专业深度维度面板(原创性/完整度/情感/工艺 4 维度) */}
          {result.aiEnhanced === true && result.scoreCriteria && result.scoreCriteria.length > 0 && (
            <ScoreCriteriaPanel
              scoreCriteria={result.scoreCriteria}
              evaluationStage={result.evaluationStage}
              diagnosisMode={result.diagnosisMode}
            />
          )}
          {result.aiEnhanced === true && (
            <DepthDimensionsPanel
              originalityAndStyle={result.aiVisionResult?.originalityAndStyle ?? result.originalityAndStyle}
              completenessAndRhythm={result.aiVisionResult?.completenessAndRhythm ?? result.completenessAndRhythm}
              emotionAndMood={result.aiVisionResult?.emotionAndMood ?? result.emotionAndMood}
              craftsmanship={result.aiVisionResult?.craftsmanship ?? result.craftsmanship}
            />
          )}

          {/* 评审/复核入口:对结果有疑问时可申请 AI 复评或教师人工复核 */}
          <RequestReviewSection analysisId={result.id} />
        </div>

        <div className="sticky bottom-0 bg-rice-100 border-t border-ink-200 px-6 py-3 flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 h-9 text-sm font-medium text-ink-600 hover:text-ink-900 hover:bg-ink-900/5 rounded-md transition-colors"
          >
            关闭
          </button>
          <button
            onClick={() => navigate(`/report/${encodeURIComponent(result.id)}`)}
            aria-label="导出报告"
            className="inline-flex items-center gap-2 border border-ink-900 text-ink-900 hover:bg-ink-900 hover:text-rice-100 rounded-md px-4 h-9 text-sm font-medium transition-colors"
          >
            <Eye className="w-4 h-4" />
            导出报告
          </button>
          {/* 分享到组织动态流(本地分析结果组件自动隐藏) */}
          <ShareToOrgButton
            analysisId={result.id}
            iconClassName="w-4 h-4"
            className="border border-jade text-jade hover:bg-jade hover:text-white rounded-md px-4 h-9 text-sm font-medium transition-colors"
          />
          {onRediagnose && (
            <button
              onClick={() => onRediagnose(result.artType)}
              aria-label="重新诊断"
              className="inline-flex items-center gap-2 bg-cinnabar hover:bg-cinnabar-dark text-white rounded-md px-4 h-9 text-sm font-medium transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              用相同参数重新诊断
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============================================================
 * 虚拟列表常量(任务包D:性能优化)
 *   - VIRTUAL_THRESHOLD: 超过此数量才启用虚拟滚动,小列表保持原渲染
 *   - HISTORY_ITEM_HEIGHT: 固定行高 = 卡片(176px) + 间距(24px)
 *   - HISTORY_CONTAINER_HEIGHT: 虚拟容器视口高度
 * ============================================================ */
const VIRTUAL_THRESHOLD = 50;
const HISTORY_ITEM_HEIGHT = 200;
const HISTORY_CONTAINER_HEIGHT = 640;

/* formatDate 纯函数,提取到组件外避免每次渲染重建 */
function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${month}月${day}日 ${hours}:${minutes}`;
}

/* ============================================================
 * HistoryCard — 单条历史记录卡片(memo + useLazyImage)
 *
 * 提取为独立组件以:
 *   1. 通过 React.memo 跳过未变化卡片的重渲染(筛选/排序时仅重渲染变化项)
 *   2. 使用 useLazyImage 实现缩略图懒加载(IntersectionObserver + 占位图)
 *   3. 缩略图加载失败时显示 ImageOff 占位,避免 broken image 图标
 * ============================================================ */

interface HistoryCardProps {
  record: HistoryRecord;
  index: number;
  onViewDetail: (record: HistoryRecord) => void;
  onRediagnose: (artType: string) => void;
  /** 是否为批量选择模式(P-06 批删) */
  selectionMode: boolean;
  /** 当前记录是否被选中 */
  checked: boolean;
  /** 切换选中状态 */
  onToggleSelect: (id: string) => void;
}

const HistoryCard = memo(function HistoryCard({
  record,
  index,
  onViewDetail,
  onRediagnose,
  selectionMode,
  checked,
  onToggleSelect,
}: HistoryCardProps) {
  const artConfig = artTypeConfig[record.artType] || artTypeConfig.painting;
  const Icon = artConfig.icon;
  const { imgRef, loadedSrc, isLoaded, isError } = useLazyImage(record.imageUrl);

  return (
    <div className="relative pl-16 group">
      <div className={`absolute left-4 top-6 w-5 h-5 ${record.overallScore == null ? 'bg-ink-400' : getScoreBg(record.overallScore)} rounded-full border-4 border-rice-200 z-10`} />

      <div className="bg-rice-50 rounded-2xl p-6 shadow-card hover:shadow-card-hover transition-all duration-300 transform hover:-translate-y-1 relative">
        {/* 批量选择模式:顶部左侧显示勾选框,替代 hover 快捷操作 */}
        {selectionMode ? (
          <button
            type="button"
            onClick={() => onToggleSelect(record.id)}
            aria-label={checked ? '取消选中' : '选中该项'}
            className={`absolute top-3 left-3 w-8 h-8 rounded-md flex items-center justify-center border transition-colors ${
              checked
                ? 'bg-cinnabar border-cinnabar text-white'
                : 'bg-white/95 border-ink-900/15 text-transparent hover:border-cinnabar hover:text-cinnabar/40'
            }`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
              <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        ) : (
        /* 卡片 hover 时显示的快捷操作 */
        <div className="absolute top-3 right-3 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
          <button
            onClick={() => onViewDetail(record)}
            title="查看详情"
            aria-label="查看详情"
            className="w-8 h-8 bg-white/95 backdrop-blur rounded-md flex items-center justify-center text-ink-600 hover:text-ink-900 hover:bg-white shadow-card border border-ink-900/6 transition-colors"
          >
            <Eye className="w-4 h-4" />
          </button>
          <button
            onClick={() => onRediagnose(record.artType)}
            title="再次诊断"
            aria-label="再次诊断"
            className="w-8 h-8 bg-white/95 backdrop-blur rounded-md flex items-center justify-center text-ink-600 hover:text-cinnabar hover:bg-white shadow-card border border-ink-900/6 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
        )}

        <div className="flex flex-col md:flex-row md:items-center gap-4">
          <div className="flex-shrink-0 relative">
            {isError ? (
              <div className="w-32 h-32 flex flex-col items-center justify-center bg-ink-100 rounded-xl">
                <ImageOff className="w-8 h-8 text-ink-300 mb-1" />
                <span className="text-2xs text-ink-400">加载失败</span>
              </div>
            ) : (
              <img
                ref={imgRef}
                src={loadedSrc}
                alt={`分析记录 ${index + 1}`}
                loading="lazy"
                className={`w-32 h-32 object-cover rounded-xl transition-opacity duration-300 ${
                  isLoaded ? 'opacity-100' : 'opacity-0'
                }`}
              />
            )}
            {/* 加载中骨架占位 */}
            {!isLoaded && !isError && (
              <div className="absolute inset-0 w-32 h-32 rounded-xl overflow-hidden">
                <SkeletonBox className="absolute inset-0" />
              </div>
            )}
          </div>

          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <Calendar className="w-4 h-4 text-ink-400" />
              <span className="text-sm text-ink-500">
                {formatDate(record.createdAt)}
              </span>
              <span className={`inline-flex items-center gap-1 px-2 py-1 ${artConfig.color}/10 text-ink-700 text-xs rounded-full`}>
                <Icon className="w-3 h-3" />
                {artConfig.name}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-4 mb-3">
              <div className="flex items-center gap-2">
                <span className="text-sm text-ink-500">综合</span>
                <div className={`w-10 h-10 ${record.overallScore == null ? 'bg-ink-400' : getScoreBg(record.overallScore)} rounded-full flex items-center justify-center`}>
                  <span className="font-serif text-lg font-bold text-white">
                    {record.overallScore ?? '—'}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-ink-500">维度一</span>
                <span className="font-medium text-ink-700">
                  {record.dimension1Score}分
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-ink-500">维度二</span>
                <span className="font-medium text-ink-700">
                  {record.dimension2Score}分
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-ink-500">维度三</span>
                <span className="font-medium text-ink-700">
                  {record.dimension3Score}分
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <button
              onClick={() => onViewDetail(record)}
              aria-label="查看详情"
              className="flex items-center gap-2 px-4 py-2 bg-ink-900/5 text-ink-700 rounded-lg hover:bg-ink-900 hover:text-rice-100 transition-all duration-300"
            >
              <Eye className="w-4 h-4" />
              <span className="text-sm font-medium">查看详情</span>
              <ArrowRight className="w-4 h-4" />
            </button>
            <button
              onClick={() => onViewDetail(record)}
              aria-label="对结果有疑问"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-stone hover:text-cinnabar transition-colors"
            >
              <HelpCircle className="w-3.5 h-3.5" />
              <span>对结果有疑问?</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});

/* ============================================================
 * MaterialDetailModal — 我的生成作品详情弹窗
 *   操作:下载 / 用于嫁接(跳转灵感嫁接) / 删除
 * ============================================================ */
function MaterialDetailModal({
  material,
  onClose,
  onDelete,
}: {
  material: SavedMaterial;
  onClose: () => void;
  onDelete: (id: string) => void;
}) {
  const navigate = useNavigate();
  const srcConfig = genSourceConfig[material.source] ?? genSourceConfig.material;
  const SrcIcon = srcConfig.icon;

  const handleDownload = () => {
    const link = document.createElement('a');
    link.href = material.imageUrl;
    link.download = `${material.title}.png`;
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleSendToFuse = () => {
    navigate(
      `/fuse?src=material&imageUrl=${encodeURIComponent(material.imageUrl)}&title=${encodeURIComponent(material.title)}`
    );
  };

  return (
    <div
      className="fixed inset-0 bg-ink-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-rice-100 rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-rice-100 border-b border-ink-200 p-4 flex items-center justify-between z-10">
          <h2 className="font-serif text-xl font-bold text-ink-900 truncate">{material.title}</h2>
          <button
            onClick={onClose}
            aria-label="关闭"
            className="p-2 hover:bg-ink-100 rounded-lg transition-colors"
          >
            <X className="w-6 h-6 text-ink-600" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="bg-ink-900 rounded-xl overflow-hidden flex items-center justify-center min-h-[200px]">
            <img
              src={material.imageUrl}
              alt={material.title}
              className="w-full max-h-[55vh] object-contain"
            />
          </div>
          <div className="flex items-center gap-3 text-sm text-ink-500">
            <span className={`inline-flex items-center gap-1 px-2 py-1 ${srcConfig.color}/10 text-ink-700 text-xs rounded-full`}>
              <SrcIcon className="w-3 h-3" />
              {srcConfig.name}
            </span>
            <span className="inline-flex items-center gap-1">
              <Calendar className="w-4 h-4 text-ink-400" />
              {formatDate(material.createdAt)}
            </span>
          </div>
        </div>

        <div className="sticky bottom-0 bg-rice-100 border-t border-ink-200 px-6 py-3 flex items-center justify-end gap-3">
          <button
            onClick={() => onDelete(material.id)}
            aria-label="删除"
            className="inline-flex items-center gap-2 border border-cinnabar/40 text-cinnabar hover:bg-cinnabar hover:text-white rounded-md px-4 h-9 text-sm font-medium transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            删除
          </button>
          <button
            onClick={handleDownload}
            aria-label="下载"
            className="inline-flex items-center gap-2 border border-ink-900 text-ink-900 hover:bg-ink-900 hover:text-rice-100 rounded-md px-4 h-9 text-sm font-medium transition-colors"
          >
            <Download className="w-4 h-4" />
            下载
          </button>
          <button
            onClick={handleSendToFuse}
            aria-label="用于嫁接"
            className="inline-flex items-center gap-2 bg-cinnabar hover:bg-cinnabar-dark text-white rounded-md px-4 h-9 text-sm font-medium transition-colors"
          >
            <Sparkles className="w-4 h-4" />
            用于嫁接
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
 * GenerationGallery — 我的生成(情绪作品 / 灵感作品)
 *   数据来源:getSavedMaterials(source=emotion|fuse)
 *   生成页已自动存档,此处按来源筛选展示
 * ============================================================ */
function GenerationGallery({
  materials,
  sourceFilter,
  onSourceFilterChange,
  onView,
  onDelete,
}: {
  materials: SavedMaterial[];
  sourceFilter: GenSourceFilter;
  onSourceFilterChange: (v: GenSourceFilter) => void;
  onView: (m: SavedMaterial) => void;
  onDelete: (id: string) => void;
}) {
  const filtered = useMemo(() => {
    let list = materials.filter((m) => m.source === 'emotion' || m.source === 'fuse');
    if (sourceFilter !== 'all') {
      list = list.filter((m) => m.source === sourceFilter);
    }
    return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [materials, sourceFilter]);

  return (
    <div className="max-w-5xl mx-auto">
      {/* 来源筛选 */}
      <div className="bg-rice-50 rounded-lg p-3 border border-ink-900/6 mb-6">
        <FilterGroup label="作品分类">
          {genSourceOptions.map((opt) => (
            <FilterButton
              key={opt.id}
              active={sourceFilter === opt.id}
              onClick={() => onSourceFilterChange(opt.id)}
            >
              {opt.name}
            </FilterButton>
          ))}
        </FilterGroup>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="还没有生成作品"
          desc="情绪画布与灵感嫁接生成的作品会自动保存在这里"
          actionLabel="前往情绪画布"
          to="/emotion"
        />
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {filtered.map((m) => {
            const srcConfig = genSourceConfig[m.source] ?? genSourceConfig.material;
            const SrcIcon = srcConfig.icon;
            return (
              <div
                key={m.id}
                className="bg-rice-50 rounded-xl overflow-hidden shadow-card hover:shadow-card-hover transition-all duration-300 hover:-translate-y-1 group cursor-pointer"
                onClick={() => onView(m)}
              >
                <div className="relative aspect-square overflow-hidden bg-ink-100">
                  <img
                    src={m.imageUrl}
                    alt={m.title}
                    loading="lazy"
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                  />
                  {/* 来源徽章 */}
                  <span className={`absolute top-2 left-2 inline-flex items-center gap-1 px-2 py-0.5 ${srcConfig.color} text-white text-2xs rounded-full`}>
                    <SrcIcon className="w-3 h-3" />
                    {srcConfig.name}
                  </span>
                  {/* 非遗标记(Task 20.3:heritage 嫁接结果显示非遗徽章) */}
                  {m.heritageCategory && (
                    <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 px-2 py-0.5 bg-gold-dark text-white text-2xs rounded-full shadow-subtle">
                      <Scroll className="w-3 h-3" />
                      {HERITAGE_CATEGORY_LABEL[m.heritageCategory]}
                    </span>
                  )}
                  {/* hover 删除 */}
                  <button
                    onClick={(e) => { e.stopPropagation(); onDelete(m.id); }}
                    aria-label={`删除 ${m.title}`}
                    title="删除"
                    className="absolute top-2 right-2 p-1.5 rounded-full bg-white/25 backdrop-blur-md text-white hover:bg-cinnabar transition-colors opacity-0 group-hover:opacity-100 z-10"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="p-3">
                  <p className="text-sm font-medium text-ink-900 truncate">{m.title}</p>
                  <p className="text-xs text-ink-400 mt-0.5 flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    {formatDate(m.createdAt)}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function HistoryPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [history, setHistory] = useState<HistoryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRecord, setSelectedRecord] = useState<AnalysisResult | null>(null);

  /* ---------- 我的生成(情绪作品/灵感作品) ---------- */
  const [savedMaterials, setSavedMaterials] = useState<SavedMaterial[]>([]);
  const [loadingMaterials, setLoadingMaterials] = useState(true);
  const [selectedMaterial, setSelectedMaterial] = useState<SavedMaterial | null>(null);

  /* ---------- 批量选择 & 批删(P-06 跨端批删一致性) ---------- */
  const toast = useToast();
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  /** 进入批量选择模式(清空历史选中) */
  const enterSelectionMode = useCallback(() => {
    setSelectionMode(true);
    setSelectedIds(new Set());
  }, []);

  /** 退出选择模式(清空选中项) */
  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }, []);

  /** 切换某项选中状态 */
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  /**
   * 批量删除(乐观更新 + 回滚):
   *  1. 快照当前 history,先本地剔除选中项(乐观更新,立即反馈)
   *  2. 调用服务端 POST /analyses/batch-delete
   *  3. 成功:逐条 toast 失败原因 + 重新拉取以服务端为准(等价 invalidateQueries(['analyses']))
   *  4. 失败(网络/超时/业务错误):回滚恢复快照
   */
  const handleBatchDelete = useCallback(async () => {
    if (selectedIds.size === 0) {
      toast.warning('请先选择要删除的记录');
      return;
    }
    const ids = Array.from(selectedIds);
    const snapshot = history;
    // 乐观更新:先本地剔除选中项
    setHistory((prev) => prev.filter((r) => !ids.includes(r.id)));
    setDeleting(true);
    try {
      const resp = await batchDeleteAnalyses(ids);
      // 任一 deleted=false:逐条展示对应 error
      const failed = resp.items.filter((i) => !i.deleted);
      if (failed.length > 0) {
        toast.warning(
          `部分删除失败(${failed.length} 条)`,
          failed.map((i) => `${i.id.slice(0, 8)}… ${i.error ?? '未知原因'}`).join('；'),
        );
      }
      if (resp.deleted > 0) {
        toast.success(`已删除 ${resp.deleted} 条记录`);
      }
      // 成功后重新拉取,以服务端为准(等价 invalidateQueries(['analyses']))
      try {
        const records = await getAnalysisHistory();
        setHistory(records);
      } catch {
        /* 重新拉取失败,保留本地乐观结果 */
      }
      exitSelectionMode();
    } catch (err) {
      // 请求失败:回滚恢复快照
      setHistory(snapshot);
      toast.error('删除失败', err instanceof Error ? err.message : '请稍后重试');
    } finally {
      setDeleting(false);
    }
  }, [selectedIds, history, toast, exitSelectionMode]);

  // 初始化筛选状态：从 URL 参数读取
  const typeParam = searchParams.get('type') as ArtTypeFilter | null;
  const filterParam = searchParams.get('filter') as ScoreFilter | null;
  const sortParam = searchParams.get('sort') as SortMode | null;
  const tabParam = searchParams.get('tab') as MainTab | null;
  const genParam = searchParams.get('gen') as GenSourceFilter | null;

  const [mainTab, setMainTab] = useState<MainTab>(tabParam === 'generation' ? 'generation' : 'diagnosis');
  const [genSourceFilter, setGenSourceFilter] = useState<GenSourceFilter>(
    genParam && genSourceOptions.some((o) => o.id === genParam) ? genParam : 'all'
  );

  const [typeFilter, setTypeFilter] = useState<ArtTypeFilter>(
    typeParam && artTypeOptions.some((o) => o.id === typeParam) ? typeParam : 'all'
  );
  const [scoreFilter, setScoreFilter] = useState<ScoreFilter>(
    filterParam && scoreOptions.some((o) => o.id === filterParam) ? filterParam : 'all'
  );
  const [sortMode, setSortMode] = useState<SortMode>(
    sortParam && sortOptions.some((o) => o.id === sortParam) ? sortParam : 'desc'
  );

  // 异步加载历史记录：通过 data-service 自动选择 API 或 LocalStorage
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const records = await getAnalysisHistory();
        if (!cancelled) setHistory(records);
      } catch (err) {
        console.error('加载历史记录失败:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // 异步加载我的生成素材(情绪画布/灵感嫁接自动存档)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const materials = await getSavedMaterials();
        if (!cancelled) setSavedMaterials(materials);
      } catch (err) {
        console.error('加载我的生成失败:', err);
      } finally {
        if (!cancelled) setLoadingMaterials(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  /* 主 Tab 切换:同步 URL,切换时清空另一 Tab 的筛选参数 */
  const handleTabChange = (tab: MainTab) => {
    setMainTab(tab);
    if (tab === 'generation') {
      const params: Record<string, string> = { tab: 'generation' };
      if (genSourceFilter !== 'all') params.gen = genSourceFilter;
      setSearchParams(params, { replace: true });
    } else {
      setSearchParams({}, { replace: true });
    }
  };

  /* 生成作品来源筛选:同步 URL */
  const handleGenSourceChange = (v: GenSourceFilter) => {
    setGenSourceFilter(v);
    const params: Record<string, string> = { tab: 'generation' };
    if (v !== 'all') params.gen = v;
    setSearchParams(params, { replace: true });
  };

  /* 删除生成作品(乐观更新 + 失败回滚) */
  const handleDeleteMaterial = useCallback(async (id: string) => {
    const snapshot = savedMaterials;
    setSavedMaterials((prev) => prev.filter((m) => m.id !== id));
    setSelectedMaterial((prev) => (prev?.id === id ? null : prev));
    try {
      await removeSavedMaterial(id);
      toast.success('已删除');
    } catch (err) {
      setSavedMaterials(snapshot);
      toast.error('删除失败', '请稍后重试');
    }
  }, [savedMaterials, toast]);

  // 切换筛选时同步 URL 参数（保持可分享）
  const syncUrlParams = (next: { type?: ArtTypeFilter; filter?: ScoreFilter; sort?: SortMode }) => {
    const params: Record<string, string> = {};
    const t = next.type ?? typeFilter;
    const f = next.filter ?? scoreFilter;
    const s = next.sort ?? sortMode;
    if (t !== 'all') params.type = t;
    if (f !== 'all') params.filter = f;
    if (s !== 'desc') params.sort = s;
    setSearchParams(params, { replace: true });
  };

  const handleTypeChange = (v: ArtTypeFilter) => {
    setTypeFilter(v);
    syncUrlParams({ type: v });
  };
  const handleScoreChange = (v: ScoreFilter) => {
    setScoreFilter(v);
    syncUrlParams({ filter: v });
  };
  const handleSortChange = (v: SortMode) => {
    setSortMode(v);
    syncUrlParams({ sort: v });
  };

  const handleClearFilters = () => {
    setTypeFilter('all');
    setScoreFilter('all');
    setSortMode('desc');
    setSearchParams({}, { replace: true });
  };

  // 使用 useMemo 计算筛选 + 排序后的列表
  const filteredHistory = useMemo(() => {
    let list = [...history];
    if (typeFilter !== 'all') {
      list = list.filter((r) => r.artType === typeFilter);
    }
    if (scoreFilter !== 'all') {
      list = list.filter((r) => {
        // 批次②:无评分记录(基础检测)不参与分数档筛选
        if (r.overallScore == null) return false;
        if (scoreFilter === 'excellent') return r.overallScore >= 85;
        if (scoreFilter === 'good') return r.overallScore >= 70 && r.overallScore < 85;
        return r.overallScore < 70;
      });
    }
    if (sortMode === 'desc') {
      list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    } else if (sortMode === 'score_desc') {
      // 批次②:无评分记录兜底 -1,分数降序时排末尾
      list.sort((a, b) => (b.overallScore ?? -1) - (a.overallScore ?? -1));
    } else {
      // 分数升序:无评分记录兜底 101,排末尾
      list.sort((a, b) => (a.overallScore ?? 101) - (b.overallScore ?? 101));
    }
    return list;
  }, [history, typeFilter, scoreFilter, sortMode]);

  // 查看详情：异步调用 data-service 获取完整分析结果
  // useCallback 稳定引用,避免 HistoryCard(memo) 因回调变化而重渲染
  const handleViewDetail = useCallback(async (record: HistoryRecord) => {
    try {
      const result = await getAnalysisDetail(record.id);
      if (result) {
        setSelectedRecord(result);
      }
    } catch (err) {
      console.error('加载分析详情失败:', err);
    }
  }, []);

  const handleRediagnose = useCallback((artType: string) => {
    navigate(`/analyze?type=${artType}`);
  }, [navigate]);

  const handleCloseModal = useCallback(() => {
    setSelectedRecord(null);
  }, []);

  /* 虚拟列表:超过阈值时启用,仅渲染可视区 + overscan 行 */
  const useVirtual = filteredHistory.length > VIRTUAL_THRESHOLD;
  const { visibleItems, totalHeight, onScroll } = useVirtualList(
    filteredHistory,
    {
      itemHeight: HISTORY_ITEM_HEIGHT,
      containerHeight: HISTORY_CONTAINER_HEIGHT,
      overscan: 5,
    },
  );

  /* 调试日志(V2-D 性能验证):与 useLazyImage 风格一致
   *   localStorage.setItem('lazyimg-debug', '0') 同时关闭本日志(共用开关)
   *   测试环境(import.meta.env.MODE === 'test')自动关闭,避免 vitest 输出噪声
   *   输出事件:
   *   - [HistoryVirtual] enabled   虚拟列表启用(>50 条),展示真实/可见/总数
   *   - [HistoryVirtual] disabled  数据量回落到普通列表
   *   - [HistoryVirtual] scroll    可视范围跨行变化(可选,帮助观察滚动行为)
   */
  useEffect(() => {
    // 测试环境自动关闭(与 useLazyImage/usePrefetch 一致)
    const isTestEnv = (import.meta as { env?: { MODE?: string } }).env?.MODE === 'test';
    if (isTestEnv) return;
    const flag = typeof localStorage !== 'undefined' && localStorage.getItem('lazyimg-debug') !== '0';
    if (!flag) return;
    const ts = new Date().toISOString().slice(11, 23);
    if (useVirtual) {
      console.debug(
        `[HistoryVirtual ${ts}] enabled`,
        `total=${filteredHistory.length}`,
        `visible=${visibleItems.length}`,
        `containerH=${HISTORY_CONTAINER_HEIGHT}`,
        `itemH=${HISTORY_ITEM_HEIGHT}`,
      );
    } else {
      console.debug(`[HistoryVirtual ${ts}] disabled`, `total=${filteredHistory.length}`);
    }
    // 仅在启用状态 / 总数变化时触发,避免每次滚动都打印
  }, [useVirtual, filteredHistory.length, visibleItems.length]);

  return (
    <div className="min-h-screen bg-rice-200 ink-texture pt-20 pb-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-8">
          <h1 className="font-serif text-3xl md:text-4xl font-bold text-ink-900 mb-4">
            历史记录
          </h1>
          <p className="text-ink-600">查看过往的分析报告与生成作品，追踪你的进步轨迹</p>
        </div>

        {/* 主 Tab:诊断记录 / 我的生成 */}
        <div className="flex justify-center mb-8">
          <div className="inline-flex bg-rice-50 rounded-full p-1 border border-ink-900/6 shadow-card">
            <button
              onClick={() => handleTabChange('diagnosis')}
              aria-label="诊断记录"
              className={`flex items-center gap-2 px-5 py-2 rounded-full text-sm font-medium transition-all ${
                mainTab === 'diagnosis'
                  ? 'bg-ink-900 text-rice-100 shadow-sm'
                  : 'text-ink-600 hover:text-ink-900'
              }`}
            >
              <History className="w-4 h-4" />
              诊断记录
            </button>
            <button
              onClick={() => handleTabChange('generation')}
              aria-label="我的生成"
              className={`flex items-center gap-2 px-5 py-2 rounded-full text-sm font-medium transition-all ${
                mainTab === 'generation'
                  ? 'bg-ink-900 text-rice-100 shadow-sm'
                  : 'text-ink-600 hover:text-ink-900'
              }`}
            >
              <Sparkles className="w-4 h-4" />
              我的生成
              {savedMaterials.length > 0 && (
                <span className={`px-1.5 py-0.5 text-2xs rounded-full ${
                  mainTab === 'generation' ? 'bg-cinnabar text-white' : 'bg-cinnabar/10 text-cinnabar'
                }`}>
                  {savedMaterials.filter((m) => m.source === 'emotion' || m.source === 'fuse').length}
                </span>
              )}
            </button>
          </div>
        </div>

        {mainTab === 'generation' ? (
          /* ---------- 我的生成:情绪作品 / 灵感作品 ---------- */
          loadingMaterials ? (
            <div className="max-w-4xl mx-auto">
              <ListSkeleton count={4} />
            </div>
          ) : (
            <GenerationGallery
              materials={savedMaterials}
              sourceFilter={genSourceFilter}
              onSourceFilterChange={handleGenSourceChange}
              onView={setSelectedMaterial}
              onDelete={handleDeleteMaterial}
            />
          )
        ) : loading ? (
          /* 加载中：列表骨架占位，避免误显示空状态 */
          <div className="max-w-4xl mx-auto">
            <ListSkeleton count={4} />
          </div>
        ) : history.length === 0 ? (
          <EmptyState
            icon={History}
            title="还没有分析记录"
            desc="上传第一件作品，开始AI智能诊断"
            actionLabel="立即上传"
            to="/analyze"
          />
        ) : (
          <div className="max-w-4xl mx-auto">
            {/* 筛选功能栏 */}
            <div className="bg-rice-50 rounded-lg p-3 border border-ink-900/6 mb-6">
              <div className="flex flex-wrap items-center gap-4">
                <FilterGroup label="艺术类型">
                  {artTypeOptions.map((opt) => (
                    <FilterButton
                      key={opt.id}
                      active={typeFilter === opt.id}
                      onClick={() => handleTypeChange(opt.id)}
                    >
                      {opt.name}
                    </FilterButton>
                  ))}
                </FilterGroup>
                <FilterGroup label="分数区间">
                  {scoreOptions.map((opt) => (
                    <FilterButton
                      key={opt.id}
                      active={scoreFilter === opt.id}
                      onClick={() => handleScoreChange(opt.id)}
                    >
                      {opt.name}
                    </FilterButton>
                  ))}
                </FilterGroup>
                <FilterGroup label="排序">
                  {sortOptions.map((opt) => (
                    <FilterButton
                      key={opt.id}
                      active={sortMode === opt.id}
                      onClick={() => handleSortChange(opt.id)}
                    >
                      {opt.name}
                    </FilterButton>
                  ))}
                </FilterGroup>
                {/* 批量删除入口(P-06):进入选择模式 */}
                <button
                  onClick={enterSelectionMode}
                  aria-label="批量删除"
                  className="ml-auto h-8 px-3 text-xs font-medium rounded-md text-cinnabar border border-cinnabar/30 hover:bg-cinnabar/10 transition-colors"
                >
                  批量删除
                </button>
              </div>
            </div>

            {/* 批量选择操作栏(P-06):选择模式下的删除/取消 */}
            {selectionMode && (
              <div className="sticky top-20 z-20 bg-rice-50/95 backdrop-blur rounded-lg border border-cinnabar/30 mb-6 px-4 py-3 flex items-center gap-3 shadow-card">
                <span className="text-sm text-ink-700">
                  已选 <b className="text-cinnabar">{selectedIds.size}</b> 项
                </span>
                <div className="ml-auto flex items-center gap-2">
                  <button
                    onClick={exitSelectionMode}
                    disabled={deleting}
                    className="h-8 px-3 text-xs font-medium rounded-md text-ink-600 hover:bg-ink-900/5 transition-colors disabled:opacity-50"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleBatchDelete}
                    disabled={deleting || selectedIds.size === 0}
                    className="inline-flex items-center gap-1.5 h-8 px-4 text-xs font-medium rounded-md bg-cinnabar text-white hover:bg-cinnabar-dark transition-colors disabled:opacity-50"
                  >
                    {deleting ? '删除中…' : '确认删除'}
                  </button>
                </div>
              </div>
            )}

            {filteredHistory.length === 0 ? (
              <div className="text-center py-16">
                <div className="w-20 h-20 bg-ink-900/5 rounded-full flex items-center justify-center mx-auto mb-6">
                  <History className="w-10 h-10 text-ink-400" />
                </div>
                <h3 className="font-serif text-xl font-semibold text-ink-700 mb-2">
                  没有符合筛选条件的记录
                </h3>
                <p className="text-ink-500 mb-4">尝试调整筛选条件或清除全部筛选</p>
                <button
                  onClick={handleClearFilters}
                  aria-label="清除筛选"
                  className="inline-flex items-center gap-2 px-4 h-9 bg-ink-900 text-rice-100 rounded-md hover:bg-ink-800 transition-colors text-sm font-medium"
                >
                  <RefreshCw className="w-4 h-4" />
                  清除筛选
                </button>
              </div>
            ) : (
              useVirtual ? (
                /* 虚拟列表模式:超过 50 条记录时启用,仅渲染可视区 + overscan 行 */
                <div
                  onScroll={onScroll}
                  style={{ height: HISTORY_CONTAINER_HEIGHT, overflowY: 'auto', position: 'relative' }}
                  className="scrollbar-thin"
                >
                  <div style={{ height: totalHeight, position: 'relative' }}>
                    {/* 时间线竖线 */}
                    <div className="absolute left-6 top-0 bottom-0 w-0.5 bg-ink-200" />
                    {visibleItems.map(({ item, index, offsetTop }) => (
                      <div
                        key={item.id}
                        style={{
                          position: 'absolute',
                          top: offsetTop,
                          left: 0,
                          right: 0,
                          height: HISTORY_ITEM_HEIGHT,
                        }}
                      >
                        <HistoryCard
                          record={item}
                          index={index}
                          onViewDetail={handleViewDetail}
                          onRediagnose={handleRediagnose}
                          selectionMode={selectionMode}
                          checked={selectedIds.has(item.id)}
                          onToggleSelect={toggleSelect}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                /* 普通列表模式:小列表保持原有视觉,使用 memo 化的 HistoryCard */
                <div className="relative">
                  <div className="absolute left-6 top-0 bottom-0 w-0.5 bg-ink-200" />
                  <div className="space-y-6">
                    {filteredHistory.map((record, index) => (
                      <HistoryCard
                        key={record.id}
                        record={record}
                        index={index}
                        onViewDetail={handleViewDetail}
                        onRediagnose={handleRediagnose}
                        selectionMode={selectionMode}
                        checked={selectedIds.has(record.id)}
                        onToggleSelect={toggleSelect}
                      />
                    ))}
                  </div>
                </div>
              )
            )}
          </div>
        )}
      </div>

      {selectedRecord && (
        <DetailModal
          result={selectedRecord}
          onClose={handleCloseModal}
          onRediagnose={handleRediagnose}
        />
      )}

      {selectedMaterial && (
        <MaterialDetailModal
          material={selectedMaterial}
          onClose={() => setSelectedMaterial(null)}
          onDelete={handleDeleteMaterial}
        />
      )}
    </div>
  );
}
