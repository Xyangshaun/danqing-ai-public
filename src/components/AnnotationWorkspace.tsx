// ============================================================
// 丹青有AI - 锚定卡片式标注工作台(2026-09-03 Phase 1A)
//
// 对应真源文档:docs/visual-annotation-feedback-upgrade-spec-2026-09.md §3.3
//
// 结构:
//   ┌────────────────────────────────────────────────┐
//   │ [维度chips·计数] [图例:●关键○建议✦亮点] [隐藏标注] │ ← 工具栏
//   ├───────────────────────────┬────────────────────┤
//   │      作品图 + SVG 标注层    │  标注详情卡片(侧栏)  │
//   │   (编号徽章 ↔ 卡片联动)    │  问题→原理→改法→参考  │
//   └───────────────────────────┴────────────────────┘
//
// 交互(成熟产品模式合成):
//   - Frame.io:编号锚点 ↔ 卡片双向跳转
//   - Grammarly:维度色标 + 分类过滤 chips
//   - Hemingway:图例计数;"标注是指南不是判决"一键看原图
//   - 移动端:卡片折到图下方(grid 自适应)
//
// Phase 3 批次④(第④层"参考"):标注卡底部条件渲染 reference 区块——
//   - step-guide:teaser +「查看分步图」→ KnowledgeCardModal 弹层
//   - master-work:teaser + 作品缩略图 +「查看作品」→ 知识库页(/styles)
//   reference 缺失(老数据/本地分析)不渲染,纯增量不炸
//
// Phase 4 批次②(数据飞轮):标注卡底部反馈行(👍有用/👎没用)——
//   - onMarkerFeedback prop 缺失时不渲染(教师端等场景可关闭采集)
//   - 乐观更新:立即切换按钮态再异步落库(后端 upsert 幂等,重复提交无脏数据)
//   - 外层卡片是 button,内层反馈控件用 span role=button + 阻断冒泡(照 reference 先例)
//
// Phase 4 批次③(教师批注):onCardClick 可选 prop——标注卡点击透传
//   (markerId, markerIndex)给调用方(教师端打开批注表单);缺省零影响
//
// Phase 4 批次④(学生端展示):teacherAnnotations 可选查找函数——卡片
//   reference 区块后渲染第⑤层"教师批注"(action 色系徽标 + comment);
//   缺省/无匹配不渲染,纯增量不炸
// ============================================================

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, BookOpen, ExternalLink, ThumbsUp, ThumbsDown } from 'lucide-react';
import IssueAnnotationLayer, { HIGHLIGHT_COLOR, markerColor } from './IssueAnnotationLayer';
import KnowledgeCardModal from './KnowledgeCardModal';
import SmartImage from './SmartImage';
import { resolveReferenceWorks, type ReferenceWorkMeta } from '../services/referenceWork';
import { resolveMarkerType, type IssueMarker } from '../types';

interface AnnotationWorkspaceProps {
  /** 作品图片地址 */
  imageUrl: string;
  /** 问题标注列表(0-1 相对坐标) */
  issueMarkers: IssueMarker[];
  /** 内部 img 附加类名(约束显示尺寸) */
  imgClassName?: string;
  /** 视觉焦点(0-1 相对坐标;渲染径向渐变提示,缺省不渲染) */
  focusPoint?: { x: number; y: number };
  /** 图片区角标(分析完成/类型/模式徽标等,绝对定位由调用方内容自带) */
  cornerBadges?: ReactNode;
  /**
   * Phase 4 批次②:标注反馈提交回调(数据飞轮)。
   * 缺省时卡片不渲染反馈行(教师端批注等场景可关闭采集,纯增量不炸)。
   * @param markerId 标注稳定 ID(批次①后新数据;旧数据为 undefined)
   * @param markerIndex 标注在 issueMarkers 数组中的原始索引
   * @param action up=有用/认同,down=没用/不准确
   */
  onMarkerFeedback?: (
    markerId: string | undefined,
    markerIndex: number,
    action: 'up' | 'down',
  ) => void;
  /**
   * Phase 4 批次③:标注卡片点击回调(教师端批注入口)。
   * 缺省时无行为(学生端零影响);与卡片自身 activeIndex 联动并存。
   * @param markerId 标注稳定 ID(旧数据为 undefined)
   * @param markerIndex 标注在 issueMarkers 数组中的原始索引
   */
  onCardClick?: (markerId: string | undefined, markerIndex: number) => void;
  /**
   * Phase 4 批次④:教师批注查找函数(学生端第⑤层展示)。
   * 由调用方传入(通常基于 listAnnotations 结果构建 Map);
   * 返回该标注的教师批注(undefined=无批注不渲染);缺省不渲染该层,纯增量。
   * @param markerId 标注稳定 ID(旧数据为 undefined)
   * @param markerIndex 标注在 issueMarkers 数组中的原始索引(服务端已修正为真实索引)
   */
  teacherAnnotations?: (
    markerId: string | undefined,
    markerIndex: number,
  ) => TeacherAnnotationView | undefined;
}

/** 教师批注展示载荷(TeacherAnnotationRecord 结构子集;组件不依赖教师端类型) */
export interface TeacherAnnotationView {
  action: 'supplement' | 'correct' | 'confirm' | 'reject';
  comment: string;
  teacherName: string | null;
  updatedAt: string;
}

/** 维度统计条目 */
interface DimensionStat {
  name: string;
  color: string;
  count: number;
}

/** Phase 4 批次④:教师批注动作 → 展示标签/色系(confirm=认可 jade / reject=驳回 cinnabar,清单口径) */
const ANNOTATION_ACTION_META: Record<
  TeacherAnnotationView['action'],
  { label: string; cls: string }
> = {
  supplement: { label: '教师补充', cls: 'border-stone/30 text-stone bg-stone/5' },
  correct: { label: '教师纠正', cls: 'border-gold/50 text-gold-dark bg-gold/5' },
  confirm: { label: '教师确认', cls: 'border-jade/40 text-jade bg-jade/5' },
  reject: { label: '教师驳回', cls: 'border-cinnabar/40 text-cinnabar bg-cinnabar/5' },
};

export default function AnnotationWorkspace({
  imageUrl,
  issueMarkers,
  imgClassName,
  focusPoint,
  cornerBadges,
  onMarkerFeedback,
  onCardClick,
  teacherAnnotations,
}: AnnotationWorkspaceProps) {
  const navigate = useNavigate();
  /** 当前过滤维度(null=全部) */
  const [filterDimension, setFilterDimension] = useState<string | null>(null);
  /** 标注显隐总开关(一键看原图) */
  const [showAnnotations, setShowAnnotations] = useState(true);
  /** 联动高亮的标注索引(-1 无) */
  const [activeIndex, setActiveIndex] = useState(-1);
  /** Phase 3 批次④:弹层打开的知识点卡片 ID(null 关闭) */
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  /** master-work 参考作品元数据(workId → meta;解析失败为空,缩略图占位) */
  const [workMetas, setWorkMetas] = useState<Map<string, ReferenceWorkMeta>>(new Map());
  /** Phase 4 批次②:反馈乐观态(原始索引 → 当前动作;仅本组件内展示,不回填后端) */
  const [feedbacks, setFeedbacks] = useState<Map<number, 'up' | 'down'>>(new Map());

  /** 反馈提交:乐观切换按钮态,再透传调用方落库(后端 upsert 幂等,重复提交无脏数据) */
  const handleFeedback = (
    markerId: string | undefined,
    markerIndex: number,
    action: 'up' | 'down',
  ) => {
    setFeedbacks((prev) => {
      const next = new Map(prev);
      next.set(markerIndex, action);
      return next;
    });
    onMarkerFeedback?.(markerId, markerIndex, action);
  };

  /** 待解析的 master-work 作品 ID 列表(去重;空数组时不触发加载) */
  const masterWorkIds = useMemo(() => {
    const ids: string[] = [];
    for (const m of issueMarkers) {
      if (m.reference?.kind === 'master-work' && m.reference.workId) ids.push(m.reference.workId);
    }
    return [...new Set(ids)];
  }, [issueMarkers]);

  // 关联作品元数据解析(双库缓存幂等;失败静默——参考是增强不是依赖)
  useEffect(() => {
    if (masterWorkIds.length === 0) return;
    let cancelled = false;
    resolveReferenceWorks(masterWorkIds)
      .then((metas) => {
        if (!cancelled) setWorkMetas(new Map(metas.map((w) => [w.id, w])));
      })
      .catch(() => {
        /* 解析失败:缩略图占位,跳转入口仍可用 */
      });
    return () => {
      cancelled = true;
    };
  }, [masterWorkIds]);

  /** 维度统计(保留标注原始顺序去重) */
  const dimensionStats = useMemo<DimensionStat[]>(() => {
    const order: string[] = [];
    const counts = new Map<string, number>();
    for (const m of issueMarkers) {
      const name = m.dimension || '综合';
      if (!counts.has(name)) order.push(name);
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return order.map((name) => ({
      name,
      color: markerColor(issueMarkers.find((m) => (m.dimension || '综合') === name)!),
      count: counts.get(name)!,
    }));
  }, [issueMarkers]);

  /** 类型计数(图例) */
  const typeCounts = useMemo(() => {
    let critical = 0;
    let suggestion = 0;
    let highlight = 0;
    for (const m of issueMarkers) {
      const t = resolveMarkerType(m);
      if (t === 'critical') critical++;
      else if (t === 'suggestion') suggestion++;
      else highlight++;
    }
    return { critical, suggestion, highlight };
  }, [issueMarkers]);

  /** 过滤后的标注(维度过滤;保持原始索引用于联动) */
  const indexed = useMemo(() => {
    return issueMarkers
      .map((m, i) => ({ m, i }))
      .filter(({ m }) => !filterDimension || (m.dimension || '综合') === filterDimension);
  }, [issueMarkers, filterDimension]);

  const visibleMarkers = showAnnotations ? indexed.map((x) => x.m) : [];

  /** 全局编号映射(原始索引 → 徽章号;2026-09-22 编号断档修复):
   *  highlight(✦)不占号,critical/suggestion 按画面顺序连续编号——
   *  图上徽章与侧栏卡片共用同一映射,维度过滤后编号仍保持全局稳定 */
  const badgeNumbers = useMemo(() => {
    const map = new Map<number, number>();
    let n = 0;
    issueMarkers.forEach((m, i) => {
      if (resolveMarkerType(m) !== 'highlight') map.set(i, ++n);
    });
    return map;
  }, [issueMarkers]);

  /** 传给标注层的编号映射(过滤后局部索引 → 全局徽章号;highlight 无号不映射) */
  const visibleBadgeNumbers = useMemo(() => {
    const map = new Map<number, number>();
    indexed.forEach(({ i }, local) => {
      const n = badgeNumbers.get(i);
      if (n !== undefined) map.set(local, n);
    });
    return map;
  }, [indexed, badgeNumbers]);

  /** 图上区域 ↔ 卡片联动:过滤后可见列表中的局部索引 → 原始索引映射 */
  const localToOriginal = new Map(indexed.map(({ i }, local) => [local, i]));
  /** 反向映射:原始索引 → 过滤后局部索引(传给标注层做联动高亮) */
  const originalToLocal = new Map(indexed.map(({ i }, local) => [i, local]));

  return (
    <div>
      {/* ---------- 工具栏:维度过滤 chips + 图例计数 + 显隐开关 ---------- */}
      <div className="flex flex-wrap items-center gap-2 px-4 pt-4 pb-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setFilterDimension(null)}
            className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
              filterDimension === null
                ? 'bg-ink-900 text-rice-100 border-ink-900'
                : 'bg-white/70 text-ink-600 border-ink-900/15 hover:border-ink-900/40'
            }`}
          >
            全部 {issueMarkers.length}
          </button>
          {dimensionStats.map((d) => (
            <button
              key={d.name}
              type="button"
              onClick={() => setFilterDimension(filterDimension === d.name ? null : d.name)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                filterDimension === d.name
                  ? 'text-white border-transparent'
                  : 'bg-white/70 text-ink-600 border-ink-900/15 hover:border-ink-900/40'
              }`}
              style={filterDimension === d.name ? { backgroundColor: d.color } : undefined}
            >
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{ backgroundColor: filterDimension === d.name ? '#fff' : d.color }}
              />
              {d.name} {d.count}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3 ml-auto text-xs text-ink-500">
          {typeCounts.critical > 0 && (
            <span className="inline-flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-cinnabar" />关键 {typeCounts.critical}
            </span>
          )}
          {typeCounts.suggestion > 0 && (
            <span className="inline-flex items-center gap-1">
              <span className="inline-block w-2.5 h-2.5 rounded-full border border-gold" />建议 {typeCounts.suggestion}
            </span>
          )}
          {typeCounts.highlight > 0 && (
            <span className="inline-flex items-center gap-1" style={{ color: HIGHLIGHT_COLOR }}>
              <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: HIGHLIGHT_COLOR }} />
             亮点 {typeCounts.highlight}
            </span>
          )}
          <button
            type="button"
            onClick={() => setShowAnnotations((v) => !v)}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-ink-900/15 bg-white/70 hover:border-ink-900/40 transition-colors"
            title={showAnnotations ? '隐藏全部标注,查看原图' : '显示标注'}
          >
            {showAnnotations ? (
              <Eye className="w-3.5 h-3.5" />
            ) : (
              <EyeOff className="w-3.5 h-3.5" />
            )}
            <span>{showAnnotations ? '看原图' : '看标注'}</span>
          </button>
        </div>
      </div>

      {/* ---------- 主体:图 + SVG 标注层 | 侧栏卡片 ---------- */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_20rem] gap-4 px-4 pb-4">
        <div className="relative">
          <IssueAnnotationLayer
            imageUrl={imageUrl}
            issueMarkers={visibleMarkers}
            className="w-full"
            imgClassName={imgClassName ?? 'w-full max-h-96 min-h-[200px] object-contain'}
            activeIndex={showAnnotations ? (originalToLocal.get(activeIndex) ?? -1) : -1}
            badgeNumbers={visibleBadgeNumbers}
            onMarkerSelect={(localIdx) => {
              const original = localToOriginal.get(localIdx);
              if (original !== undefined) setActiveIndex(original);
            }}
          />
          {focusPoint && (
            <div
              className="absolute inset-0 pointer-events-none opacity-60"
              style={{
                background: `radial-gradient(circle at ${focusPoint.x * 100}% ${focusPoint.y * 100}%,
                  rgba(196, 30, 58, 0.4) 0%,
                  rgba(196, 30, 58, 0.15) 30%,
                  transparent 60%)`,
              }}
            />
          )}
          {cornerBadges && (
            <div className="absolute inset-0 pointer-events-none">{cornerBadges}</div>
          )}
          {!showAnnotations && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-ink-900/75 backdrop-blur-sm px-3 py-1 rounded-full pointer-events-none">
              <span className="text-xs text-rice-100">原图模式 · 标注已隐藏</span>
            </div>
          )}
        </div>

        {/* 侧栏:标注详情卡片(四层结构:问题→原理→改法) */}
        <div className="flex flex-col gap-2.5 lg:max-h-[28rem] lg:overflow-y-auto pr-1">
          {indexed.map(({ m, i }, localIdx) => {
            const type = resolveMarkerType(m);
            const color = markerColor(m);
            const isActive = i === activeIndex;
            return (
              <button
                key={i}
                type="button"
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => {
                  setActiveIndex(isActive ? -1 : i);
                  // Phase 4 批次③:教师端批注入口(与 activeIndex 联动并存,缺省零影响)
                  onCardClick?.(m.id, i);
                }}
                className={`text-left rounded-xl border bg-white/80 backdrop-blur-sm px-3.5 py-3 transition-all duration-200 ${
                  isActive
                    ? 'border-transparent shadow-overlay'
                    : 'border-ink-900/10 hover:border-ink-900/30 hover:shadow-card'
                }`}
                style={isActive ? { boxShadow: `0 0 0 1.5px ${color}, 0 8px 24px rgba(28,28,28,0.12)` } : undefined}
              >
                <div className="flex items-center gap-2 mb-1.5">
                  {type !== 'highlight' ? (
                    <span
                      className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[11px] font-bold text-white flex-shrink-0"
                      style={{ backgroundColor: color }}
                    >
                      {badgeNumbers.get(i) ?? localIdx + 1}
                    </span>
                  ) : (
                    <span
                      className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[11px] font-bold text-white flex-shrink-0"
                      style={{ backgroundColor: HIGHLIGHT_COLOR }}
                    >
                      ✦
                    </span>
                  )}
                  <span className="font-semibold text-sm text-ink-900">{m.label}</span>
                  <span className="ml-auto flex items-center gap-1.5 flex-shrink-0">
                    {m.dimension && (
                      <span
                        className="px-1.5 py-0.5 rounded text-[10px] font-medium text-white"
                        style={{ backgroundColor: color }}
                      >
                        {m.dimension}
                      </span>
                    )}
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                        type === 'critical'
                          ? 'border-cinnabar/40 text-cinnabar bg-cinnabar/5'
                          : type === 'highlight'
                            ? 'border-jade/40 text-jade bg-jade/5'
                            : 'border-gold/50 text-gold-dark bg-gold/5'
                      }`}
                    >
                      {type === 'critical' ? '关键' : type === 'highlight' ? '亮点' : '建议'}
                    </span>
                  </span>
                </div>
                {m.why && (
                  <p className="text-xs leading-relaxed text-ink-600 mb-1">
                    <span className="text-ink-400">原理</span>
                    <span className="mx-1 text-ink-300">|</span>
                    {m.why}
                  </p>
                )}
                {m.how && (
                  <p className="text-xs leading-relaxed text-ink-600">
                    <span className="text-ink-400">改法</span>
                    <span className="mx-1 text-ink-300">|</span>
                    {m.how}
                  </p>
                )}
                {!m.why && !m.how && m.improvementHint && (
                  <p className="text-xs leading-relaxed text-ink-600">{m.improvementHint}</p>
                )}
                {/* Phase 3 批次④:第④层"参考"(reference 缺失不渲染;纯增量) */}
                {m.reference && (
                  <div className="flex items-center gap-2 rounded-lg bg-jade/5 border border-jade/25 px-2 py-1.5 mt-2">
                    {m.reference.kind === 'step-guide' ? (
                      <>
                        <BookOpen className="w-3.5 h-3.5 text-jade flex-shrink-0" />
                        <span className="text-xs text-ink-600 truncate flex-1" title={m.reference.teaser}>
                          {m.reference.teaser}
                        </span>
                        {/* 外层卡片是 button,内层嵌套 button 非法 → span role=button + 阻断冒泡 */}
                        <span
                          role="button"
                          tabIndex={0}
                          aria-label={`查看分步参考图:${m.reference.teaser}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            setActiveCardId(m.reference!.cardId ?? null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.stopPropagation();
                              e.preventDefault();
                              setActiveCardId(m.reference!.cardId ?? null);
                            }
                          }}
                          className="text-xs font-medium text-jade hover:text-jade/80 whitespace-nowrap cursor-pointer flex-shrink-0"
                        >
                          查看分步图 →
                        </span>
                      </>
                    ) : (
                      <>
                        {(() => {
                          const meta = workMetas.get(m.reference!.workId ?? '');
                          return meta?.thumbUrl ? (
                            <SmartImage
                              src={meta.thumbUrl}
                              alt={meta.title}
                              className="w-9 h-9 rounded-md overflow-hidden flex-shrink-0"
                              imgClassName="w-full h-full object-cover"
                            />
                          ) : (
                            <ExternalLink className="w-3.5 h-3.5 text-jade flex-shrink-0" />
                          );
                        })()}
                        <span className="text-xs text-ink-600 truncate flex-1" title={m.reference.teaser}>
                          {m.reference.teaser}
                        </span>
                        <span
                          role="button"
                          tabIndex={0}
                          aria-label={`在知识库查看作品:${m.reference.teaser}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            navigate('/styles');
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.stopPropagation();
                              e.preventDefault();
                              navigate('/styles');
                            }
                          }}
                          className="text-xs font-medium text-jade hover:text-jade/80 whitespace-nowrap cursor-pointer flex-shrink-0"
                        >
                          查看作品 →
                        </span>
                      </>
                    )}
                  </div>
                )}
                {/* Phase 4 批次④:第⑤层"教师批注"(teacherAnnotations 缺省/无匹配不渲染;纯增量)。
                    学生端只读展示——照 reference 区块条件渲染范式,教师端写入口在 TeacherClassReviewPage */}
                {(() => {
                  const anno = teacherAnnotations?.(m.id, i);
                  if (!anno) return null;
                  const meta = ANNOTATION_ACTION_META[anno.action];
                  return (
                    <div className={`rounded-lg border px-2 py-1.5 mt-2 ${meta.cls}`}>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-medium">{meta.label}</span>
                        <span className="text-[10px] opacity-70">{anno.teacherName ?? '教师'}</span>
                        <span className="ml-auto text-[10px] opacity-50">
                          {new Date(anno.updatedAt).toLocaleDateString('zh-CN')}
                        </span>
                      </div>
                      <p className="text-xs leading-relaxed text-ink-600 mt-0.5">{anno.comment}</p>
                    </div>
                  );
                })()}
                {/* Phase 4 批次②:标注反馈行(数据飞轮;onMarkerFeedback 缺失不渲染,纯增量)。
                    外层卡片是 button,内层控件用 span role=button + 阻断冒泡(照 reference 先例) */}
                {onMarkerFeedback && (
                  <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-ink-900/5">
                    <span className="text-[11px] text-ink-400 mr-0.5">这条标注:</span>
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label="反馈:有用"
                      aria-pressed={feedbacks.get(i) === 'up'}
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        handleFeedback(m.id, i, 'up');
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.stopPropagation();
                          e.preventDefault();
                          handleFeedback(m.id, i, 'up');
                        }
                      }}
                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium cursor-pointer transition-colors ${
                        feedbacks.get(i) === 'up'
                          ? 'text-jade bg-jade/10'
                          : 'text-ink-400 hover:text-ink-600 hover:bg-ink-900/5'
                      }`}
                    >
                      <ThumbsUp className="w-3 h-3" />
                      有用
                    </span>
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label="反馈:没用"
                      aria-pressed={feedbacks.get(i) === 'down'}
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        handleFeedback(m.id, i, 'down');
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.stopPropagation();
                          e.preventDefault();
                          handleFeedback(m.id, i, 'down');
                        }
                      }}
                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium cursor-pointer transition-colors ${
                        feedbacks.get(i) === 'down'
                          ? 'text-cinnabar bg-cinnabar/10'
                          : 'text-ink-400 hover:text-ink-600 hover:bg-ink-900/5'
                      }`}
                    >
                      <ThumbsDown className="w-3 h-3" />
                      没用
                    </span>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Phase 3 批次④:知识点卡片详情弹层(查看分步图) */}
      <KnowledgeCardModal cardId={activeCardId} onClose={() => setActiveCardId(null)} />
    </div>
  );
}
