import { useEffect, useState } from 'react';
import { ClipboardList } from 'lucide-react';
import { listReviews } from '../services/teacher-api';
import { useAuth } from '../hooks/useAuth';
import type { ReviewRecordSummary } from '../types/teacher';

/**
 * 服务端分析 ID 为 UUID v4;本地分析结果为 `analysis-<timestamp>`。
 * 仅服务端落库的分析才有评审记录(照 RequestReviewSection 先例)。
 */
const SERVER_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 评审人类型标签 */
const REVIEWER_TYPE_LABEL: Record<string, string> = {
  professor: '教授',
  lecturer: '讲师',
  ai: 'AI 评审',
};

/** 维度等级 → 中文标签 */
const LEVEL_LABEL: Record<string, string> = {
  excellent: '优秀',
  good: '良好',
  qualified: '合格',
  needs_improvement: '待改进',
};

interface ReviewListSectionProps {
  /** 分析任务 ID(服务端 UUID;本地结果自动隐藏) */
  analysisId: string;
}

/**
 * 学生端"已有评审"展示区块(反馈闭环 Phase 4 批次④:ReviewRecord 展示断链修复)
 *
 * 断链背景:评审提交通知引导学生到 /analysis/:id,但该页此前无评审展示,
 * 学生只能再申请复核——评审结果对被评者不可见。
 *
 * 展示内容(简版,纯前端):评审人/总分/维度等级 chips/评语/时间。
 * 数据安全:
 *   - 未登录 / 本地分析结果 / 无评审记录 / 查询失败 → 组件不渲染
 *     (静默降级,不阻塞评分主流程;照 RequestReviewSection 先例)
 */
export default function ReviewListSection({ analysisId }: ReviewListSectionProps) {
  const { user } = useAuth();
  const [reviews, setReviews] = useState<ReviewRecordSummary[] | null>(null);

  const isServerId = SERVER_ID_RE.test(analysisId);

  useEffect(() => {
    if (!user || !isServerId) {
      setReviews(null);
      return;
    }
    let cancelled = false;
    listReviews(analysisId)
      .then((items) => {
        if (!cancelled) setReviews(items);
      })
      .catch(() => {
        /* 查询失败静默降级:无 review:read 可达性或网络异常,不展示区块 */
        if (!cancelled) setReviews([]);
      });
    return () => {
      cancelled = true;
    };
  }, [user, isServerId, analysisId]);

  /* 未登录 / 本地分析 / 加载中 / 无评审:不渲染(通知断链仅在有评审时修复) */
  if (!user || !isServerId || reviews === null || reviews.length === 0) return null;

  return (
    <div className="bg-rice-50 rounded-2xl p-6 shadow-card">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 bg-stone/10 rounded-lg flex items-center justify-center">
          <ClipboardList className="w-5 h-5 text-stone" />
        </div>
        <div>
          <h3 className="font-serif text-lg font-bold text-ink-900">评审记录</h3>
          <p className="text-xs text-ink-500">该作品收到的全部评审(共 {reviews.length} 条)</p>
        </div>
      </div>

      <div className="space-y-3">
        {reviews.map((r) => (
          <div key={r.id} className="border border-ink-900/10 rounded-xl p-4 bg-white/60">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-ink-900">
                  {r.reviewerName ?? REVIEWER_TYPE_LABEL[r.reviewerType] ?? r.reviewerType}
                </span>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-ink-900/5 text-ink-500">
                  {REVIEWER_TYPE_LABEL[r.reviewerType] ?? r.reviewerType}
                </span>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-xl font-semibold font-mono tabular-nums text-cinnabar">
                  {r.scores.overallScore}
                </span>
                <span className="text-xs text-ink-400">分</span>
              </div>
            </div>

            {/* 维度等级 chips(各维度 level 去重计数) */}
            <div className="flex flex-wrap gap-1.5 mb-2">
              {(() => {
                const counts = new Map<string, number>();
                for (const dim of Object.values(r.scores.dimensions ?? {})) {
                  counts.set(dim.level, (counts.get(dim.level) ?? 0) + 1);
                }
                return Array.from(counts.entries()).map(([level, count]) => (
                  <span
                    key={level}
                    className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                      level === 'excellent'
                        ? 'border-jade/40 text-jade bg-jade/5'
                        : level === 'good'
                          ? 'border-gold/50 text-gold-dark bg-gold/5'
                          : level === 'needs_improvement'
                            ? 'border-cinnabar/40 text-cinnabar bg-cinnabar/5'
                            : 'border-ink-900/20 text-ink-500 bg-ink-900/5'
                    }`}
                  >
                    {LEVEL_LABEL[level] ?? level}
                    {count > 1 ? ` ×${count}` : ''}
                  </span>
                ));
              })()}
            </div>

            {r.comment && <p className="text-xs leading-relaxed text-ink-600 mb-2">{r.comment}</p>}
            <p className="text-[10px] text-ink-300">
              {new Date(r.createdAt).toLocaleString('zh-CN')}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
