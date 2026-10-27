// ============================================================
// 丹青有AI - 知识点卡片详情弹层(参考图混合方案 Phase 3 批次④)
//
// 对应真源文档:docs/visual-annotation-feedback-upgrade-spec-2026-09.md §3.3 第④层"参考"
//
// 职责:标注卡「查看分步图」入口 → 拉取 GET /knowledge-cards/:id,
//   展示分步参考图(左右切换)+ 原理讲解 + 针对性练习 + 关联作品。
// 诚实降级:referenceAssets.status !== 'ready'(pending 未生成/partial 部分成功)
//   时明确展示"参考图生成中"文案,不伪造不隐藏(spec:诚实性设计)。
// 交互:Esc 关闭/遮罩点击关闭/左右按钮与键盘方向键切换步骤。
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, ChevronLeft, ChevronRight, BookOpen, Dumbbell, Images, ArrowRight } from 'lucide-react';
import { getKnowledgeCard } from '../services/knowledge-card-api';
import { resolveReferenceWorks, type ReferenceWorkMeta } from '../services/referenceWork';
import type { KnowledgeCard } from '../types/knowledge-card';
import SmartImage from './SmartImage';

interface KnowledgeCardModalProps {
  /** 要拉取详情的卡片 ID(变化时重新加载;null 时组件返回 null) */
  cardId: string | null;
  /** 关闭回调 */
  onClose: () => void;
}

/** 难度标签 */
const DIFFICULTY_LABEL: Record<KnowledgeCard['difficulty'], string> = {
  basic: '基础',
  advanced: '进阶',
};

export default function KnowledgeCardModal({ cardId, onClose }: KnowledgeCardModalProps) {
  const navigate = useNavigate();
  const [card, setCard] = useState<KnowledgeCard | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [relatedWorkMetas, setRelatedWorkMetas] = useState<ReferenceWorkMeta[]>([]);

  // cardId 变化 → 拉取卡片详情(含步进重置)
  useEffect(() => {
    if (!cardId) return;
    setLoading(true);
    setLoadError(null);
    setCard(null);
    setStep(0);
    setRelatedWorkMetas([]);
    let cancelled = false;
    getKnowledgeCard(cardId)
      .then((c) => {
        if (!cancelled) setCard(c);
      })
      .catch(() => {
        if (!cancelled) setLoadError('卡片加载失败,请稍后重试');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cardId]);

  // 关联作品元数据解析(relatedWorks ID → 标题/缩略图;失败静默为空)
  useEffect(() => {
    if (!card || !Array.isArray(card.relatedWorks) || card.relatedWorks.length === 0) return;
    let cancelled = false;
    resolveReferenceWorks(card.relatedWorks)
      .then((metas) => {
        if (!cancelled) setRelatedWorkMetas(metas);
      })
      .catch(() => {
        /* 解析失败静默:关联作品是增强信息 */
      });
    return () => {
      cancelled = true;
    };
  }, [card]);

  // Esc 关闭 + 方向键切换步骤
  useEffect(() => {
    if (!cardId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (!card) return;
      const steps = card.referenceAssets?.steps ?? 0;
      const urls = card.referenceAssets?.imageUrls ?? [];
      if (e.key === 'ArrowLeft' && steps > 1) setStep((s) => (s - 1 + steps) % steps);
      if (e.key === 'ArrowRight' && steps > 1) setStep((s) => (s + 1) % steps);
      if (e.key === 'ArrowRight' && steps === 0) return;
      void urls; // urls 仅用于说明与 steps 对齐;步进切换以 steps 为准
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cardId, card, onClose]);

  const stop = useCallback((e: React.MouseEvent) => e.stopPropagation(), []);

  if (!cardId) return null;

  const assets = card?.referenceAssets ?? null;
  const steps = assets?.steps ?? 0;
  const imageUrls = assets?.imageUrls ?? [];
  const currentUrl = imageUrls[step] ?? '';
  const imagesReady = assets?.status === 'ready' && imageUrls.length === steps;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="知识点卡片详情"
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-rice-50 rounded-2xl shadow-overlay max-w-2xl w-full max-h-[85vh] overflow-y-auto"
        onClick={stop}
      >
        {/* ---------- 头部 ---------- */}
        <div className="sticky top-0 bg-rice-50/95 backdrop-blur-sm px-5 pt-4 pb-3 flex items-start gap-3 border-b border-ink-900/10">
          <div className="w-10 h-10 bg-jade/10 rounded-lg flex items-center justify-center flex-shrink-0">
            <BookOpen className="w-5 h-5 text-jade" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-serif text-lg font-bold text-ink-900 truncate">{card?.topic ?? '知识点卡片'}</h3>
            {card && (
              <p className="text-xs text-ink-500 flex items-center gap-2 mt-0.5">
                <span className="px-1.5 py-0.5 rounded border border-jade/40 text-jade bg-jade/5">{DIFFICULTY_LABEL[card.difficulty]}</span>
                <span>分步参考 · {steps > 0 ? `${step + 1}/${steps} 步` : '未生成'}</span>
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-ink-900/10 transition-colors flex-shrink-0"
            aria-label="关闭"
          >
            <X className="w-5 h-5 text-ink-600" />
          </button>
        </div>

        {/* ---------- 主体 ---------- */}
        {loading ? (
          <div className="flex items-center justify-center py-16 gap-2 text-ink-500">
            <span className="w-5 h-5 rounded-full border-2 border-ink-300 border-t-ink-900 animate-spin" />
            <span className="text-sm">加载分步参考…</span>
          </div>
        ) : loadError ? (
          <div className="px-5 py-12 text-center">
            <p className="text-sm text-cinnabar">{loadError}</p>
            <button
              type="button"
              onClick={onClose}
              className="mt-4 px-4 py-1.5 rounded-lg border border-ink-900/20 text-sm text-ink-600 hover:border-ink-900/40 transition-colors"
            >
              关闭
            </button>
          </div>
        ) : card ? (
          <div className="p-5 space-y-5">
            {/* 分步参考图区 */}
            <div>
              <div className="flex items-center gap-1.5 mb-2 text-sm font-semibold text-ink-800">
                <Images className="w-4 h-4 text-jade" />
                分步参考图
                {assets?.caption && <span className="text-xs font-normal text-ink-400 ml-1">{assets.caption}</span>}
              </div>
              {imagesReady && currentUrl ? (
                <div className="relative rounded-xl overflow-hidden border border-ink-900/10 bg-white">
                  <SmartImage
                    src={currentUrl}
                    alt={`${card.topic}第 ${step + 1} 步参考图`}
                    className="w-full"
                    imgClassName="w-full max-h-72 object-contain"
                  />
                  {steps > 1 && (
                    <>
                      <button
                        type="button"
                        onClick={() => setStep((s) => (s - 1 + steps) % steps)}
                        className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-ink-900/60 text-white flex items-center justify-center hover:bg-ink-900/80 transition-colors"
                        aria-label="上一步"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setStep((s) => (s + 1) % steps)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-ink-900/60 text-white flex items-center justify-center hover:bg-ink-900/80 transition-colors"
                        aria-label="下一步"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </>
                  )}
                  <div className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-ink-900/70 rounded-full px-2.5 py-0.5 text-xs text-rice-100">
                    第 {step + 1} / {steps} 步
                  </div>
                </div>
              ) : (
                /* 诚实降级:pending/partial 不伪造,明确告知生成状态 */
                <div className="rounded-xl border border-dashed border-gold/50 bg-gold/5 px-4 py-8 text-center">
                  <Images className="w-6 h-6 text-gold mx-auto mb-2" />
                  <p className="text-sm text-ink-600">
                    {assets?.status === 'partial' ? '部分参考图已生成,其余步骤生成中' : '参考图生成中'}
                  </p>
                  <p className="text-xs text-ink-400 mt-1">知识点讲解与练习已可用,分步图稍后回来查看</p>
                </div>
              )}
              {/* 步骤缩略点(partial 时可见失败步骤位置) */}
              {steps > 1 && imageUrls.length === steps && (
                <div className="flex items-center justify-center gap-1.5 mt-2">
                  {imageUrls.map((u, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setStep(i)}
                      aria-label={`查看第 ${i + 1} 步`}
                      className={`w-2 h-2 rounded-full transition-colors ${
                        i === step ? 'bg-ink-900 scale-125' : u ? 'bg-ink-300' : 'bg-gold/60'
                      }`}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* 原理讲解 */}
            <div className="bg-white/70 rounded-xl p-4 border border-ink-900/10">
              <div className="flex items-center gap-1.5 mb-2 text-sm font-semibold text-ink-800">
                <BookOpen className="w-4 h-4 text-cinnabar" />
                原理讲解
              </div>
              <p className="text-sm text-ink-600 leading-relaxed whitespace-pre-line">{card.explanation}</p>
            </div>

            {/* 针对性练习 */}
            <div className="bg-white/70 rounded-xl p-4 border border-ink-900/10">
              <div className="flex items-center gap-1.5 mb-2 text-sm font-semibold text-ink-800">
                <Dumbbell className="w-4 h-4 text-gold-dark" />
                针对性练习
              </div>
              <p className="text-sm text-ink-600 leading-relaxed whitespace-pre-line">{card.practiceDrill}</p>
            </div>

            {/* 关联作品(教师策展;点击跳转知识库页) */}
            {relatedWorkMetas.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 mb-2 text-sm font-semibold text-ink-800">
                  <ArrowRight className="w-4 h-4 text-jade" />
                  关联作品
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  {relatedWorkMetas.map((w) => (
                    <button
                      key={w.id}
                      type="button"
                      onClick={() => navigate('/styles')}
                      className="flex items-center gap-2.5 rounded-xl border border-ink-900/10 bg-white/70 p-2 text-left hover:border-ink-900/30 transition-colors"
                      title={`在知识库查看《${w.title}》`}
                    >
                      {w.thumbUrl ? (
                        <SmartImage
                          src={w.thumbUrl}
                          alt={w.title}
                          className="w-12 h-12 rounded-lg overflow-hidden flex-shrink-0"
                          imgClassName="w-full h-full object-cover"
                        />
                      ) : (
                        <span className="w-12 h-12 rounded-lg bg-ink-100 flex items-center justify-center flex-shrink-0">
                          <Images className="w-4 h-4 text-ink-400" />
                        </span>
                      )}
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-ink-800 truncate">{w.title}</span>
                        <span className="block text-xs text-ink-400 truncate">{w.attribution}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
