// ============================================================
// 丹青有AI - 班级讨论(聊天框 + 分享诊断报告)
// 数据:
//   GET  /api/v1/classes/:id/messages                    消息列表(初始/增量/翻页)
//   POST /api/v1/classes/:id/messages                    发送消息(text/analysis_share)
//   GET  /api/v1/classes/:id/shared-analyses/:analysisId 查看分享报告
//   GET  /api/v1/analyses?status=success                 我的可分享作品(当前空间)
//
// 实时策略:5s 增量轮询(after=最新消息 ID);组件卸载/不可见时停止
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Loader2, SendHorizontal, Share2, X, ChevronUp, MessageSquare,
  ImageOff, Eye, Flag,
} from 'lucide-react';
import {
  listClassMessages,
  sendClassMessage,
  getSharedClassAnalysis,
} from '../../services/class-api';
import type {
  ClassMessage,
  SharedAnalysisDetail,
} from '../../services/class-api';
import { get } from '../../services/api';
import type { ListAnalysesResponse } from '../../types/api-contract';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../ToastProvider';
import ReportDialog from '../report/ReportDialog';

/** 轮询间隔(毫秒) */
const POLL_INTERVAL = 5000;
/** 作品类型中文标签 */
const WORK_TYPE_LABELS: Record<string, string> = {
  painting: '绘画',
  design: '设计',
  product: '产品',
  sculpture: '雕塑',
};

interface ClassDiscussionProps {
  classId: string;
}

export default function ClassDiscussion({ classId }: ClassDiscussionProps) {
  const { user } = useAuth();
  const toast = useToast();

  const [messages, setMessages] = useState<ClassMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState('');
  const [shareOpen, setShareOpen] = useState(false);
  const [viewing, setViewing] = useState<{ analysisId: string } | null>(null);

  const listRef = useRef<HTMLDivElement>(null);
  const stickBottomRef = useRef(true);
  const timerRef = useRef<number | null>(null);

  /* 滚动到底部 */
  const scrollToBottom = useCallback(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  /* 初始加载 */
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listClassMessages(classId, { limit: 30 })
      .then((res) => {
        if (cancelled) return;
        setMessages(res.items);
        setHasMore(res.hasMore);
        window.setTimeout(scrollToBottom, 50);
      })
      .catch(() => {
        /* 错误已由 api.ts 统一 Toast */
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [classId, scrollToBottom]);

  /* 增量轮询(5s):after=当前最后一条消息 */
  useEffect(() => {
    const tick = async () => {
      const last = messages[messages.length - 1];
      try {
        const res = last
          ? await listClassMessages(classId, { after: last.id, limit: 50 })
          : await listClassMessages(classId, { limit: 30 });
        if (res.items.length > 0) {
          setMessages((prev) => {
            const seen = new Set(prev.map((m) => m.id));
            const fresh = res.items.filter((m) => !seen.has(m.id));
            return fresh.length > 0 ? [...prev, ...fresh] : prev;
          });
          if (stickBottomRef.current) window.setTimeout(scrollToBottom, 30);
        }
      } catch {
        /* 轮询失败静默,下轮重试 */
      }
    };
    timerRef.current = window.setInterval(() => void tick(), POLL_INTERVAL);
    return () => {
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
    };
    // messages 最新一条作为轮询游标;仅取长度避免逐条依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId, messages.length, scrollToBottom]);

  /* 跟踪是否贴底(贴底时新消息自动滚动) */
  const handleScroll = () => {
    const el = listRef.current;
    if (!el) return;
    stickBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  };

  /* 加载更早消息 */
  const loadOlder = async () => {
    const first = messages[0];
    if (!first || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await listClassMessages(classId, { before: first.id, limit: 30 });
      setMessages((prev) => [...res.items, ...prev]);
      setHasMore(res.hasMore);
    } catch {
      /* 错误已由 api.ts 统一 Toast */
    } finally {
      setLoadingMore(false);
    }
  };

  /* 发送文本消息 */
  const handleSend = async () => {
    const content = draft.trim();
    if (!content || sending) return;
    setSending(true);
    try {
      const msg = await sendClassMessage(classId, { type: 'text', content });
      setMessages((prev) => [...prev, msg]);
      setDraft('');
      window.setTimeout(scrollToBottom, 30);
    } catch {
      /* 错误已由 api.ts 统一 Toast */
    } finally {
      setSending(false);
    }
  };

  /* 分享成功后追加消息 */
  const handleShared = (msg: ClassMessage) => {
    setMessages((prev) => [...prev, msg]);
    setShareOpen(false);
    window.setTimeout(scrollToBottom, 30);
  };

  return (
    <div className="flex flex-col h-[600px] max-h-[70vh] bg-rice-50 border border-ink-900/10 rounded-xl shadow-card overflow-hidden">
      {/* 头部 */}
      <div className="flex items-center gap-2 px-4 h-11 border-b border-ink-900/8 bg-rice-100/60 flex-shrink-0">
        <MessageSquare className="w-4 h-4 text-stone" />
        <span className="text-sm font-medium text-ink-800">班级讨论</span>
        <span className="text-2xs text-ink-400 ml-auto">实时讨论 · 分享诊断报告</span>
      </div>

      {/* 消息列表 */}
      <div
        ref={listRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 py-3 space-y-3"
      >
        {hasMore && (
          <div className="text-center">
            <button
              onClick={() => void loadOlder()}
              disabled={loadingMore}
              className="inline-flex items-center gap-1 px-3 h-7 rounded-full border border-ink-900/15 text-2xs text-ink-500 hover:bg-rice-100 disabled:opacity-50 transition-colors"
            >
              {loadingMore ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <ChevronUp className="w-3 h-3" />
              )}
              加载更早消息
            </button>
          </div>
        )}

        {loading ? (
          <div className="py-16 text-center">
            <Loader2 className="w-6 h-6 text-ink-300 animate-spin mx-auto" />
          </div>
        ) : messages.length === 0 ? (
          <div className="py-16 text-center">
            <MessageSquare className="w-8 h-8 text-ink-200 mx-auto mb-2" />
            <p className="text-sm text-ink-400">还没有讨论,来发第一条消息吧</p>
            <p className="text-2xs text-ink-300 mt-1">可分享你的诊断报告,与同学老师交流</p>
          </div>
        ) : (
          messages.map((m) => (
            <MessageBubble
              key={m.id}
              message={m}
              isOwn={m.sender.id === user?.id}
              onViewReport={(analysisId) => setViewing({ analysisId })}
            />
          ))
        )}
      </div>

      {/* 输入区 */}
      <div className="flex items-end gap-2 px-3 py-2.5 border-t border-ink-900/8 bg-rice-100/60 flex-shrink-0">
        <button
          onClick={() => setShareOpen(true)}
          className="inline-flex items-center justify-center w-9 h-9 rounded-md border border-ink-900/15 text-ink-600 hover:bg-rice-100 hover:text-cinnabar transition-colors flex-shrink-0"
          title="分享诊断报告"
        >
          <Share2 className="w-4 h-4" />
        </button>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
          rows={1}
          maxLength={500}
          placeholder="输入消息,Enter 发送,Shift+Enter 换行"
          className="flex-1 resize-none max-h-28 px-3 py-2 rounded-md border border-ink-900/15 bg-white text-sm text-ink-900 placeholder:text-ink-300 focus:outline-none focus:ring-2 focus:ring-stone/30"
        />
        <button
          onClick={() => void handleSend()}
          disabled={sending || !draft.trim()}
          className="inline-flex items-center justify-center w-9 h-9 rounded-md bg-cinnabar text-rice-50 hover:bg-cinnabar-dark disabled:opacity-40 transition-colors flex-shrink-0"
          title="发送"
        >
          {sending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <SendHorizontal className="w-4 h-4" />
          )}
        </button>
      </div>

      {/* 分享诊断报告对话框 */}
      {shareOpen && (
        <ShareAnalysisDialog
          classId={classId}
          onClose={() => setShareOpen(false)}
          onShared={handleShared}
          toast={toast}
        />
      )}

      {/* 查看分享报告 */}
      {viewing && (
        <SharedReportModal
          classId={classId}
          analysisId={viewing.analysisId}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );
}

/* ============================================================
 * 单条消息气泡(文本 / 分享报告卡片)
 * ============================================================ */
function MessageBubble({
  message,
  isOwn,
  onViewReport,
}: {
  message: ClassMessage;
  isOwn: boolean;
  onViewReport: (analysisId: string) => void;
}) {
  const { isAuthenticated } = useAuth();
  const [reportOpen, setReportOpen] = useState(false);
  /* 举报入口:仅登录用户可举报他人消息(自己的消息无需举报) */
  const canReport = isAuthenticated && !isOwn;
  const time = new Date(message.createdAt);
  const timeLabel = `${time.getMonth() + 1}/${time.getDate()} ${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`;
  const roleLabel = message.sender.role === 'teacher' ? '老师' : message.sender.role === 'admin' || message.sender.role === 'owner' ? '管理员' : null;

  return (
    <div className={`flex gap-2 ${isOwn ? 'flex-row-reverse' : ''}`}>
      {/* 头像 */}
      {message.sender.avatar ? (
        <img
          src={message.sender.avatar}
          alt={message.sender.name}
          loading="lazy"
          referrerPolicy="no-referrer"
          className="w-8 h-8 rounded-full object-cover border border-ink-900/10 flex-shrink-0"
        />
      ) : (
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-stone to-stone-dark flex items-center justify-center text-2xs font-bold text-white flex-shrink-0">
          {message.sender.name.charAt(0)}
        </div>
      )}

      <div className={`group min-w-0 max-w-[75%] ${isOwn ? 'text-right' : ''}`}>
        {/* 发送者 + 时间 + 举报(悬停显示) */}
        <p className="text-2xs text-ink-400 mb-0.5">
          {!isOwn && (
            <>
              <span className="font-medium text-ink-600">{message.sender.name}</span>
              {roleLabel && (
                <span className="ml-1 px-1 py-px rounded bg-stone/15 text-stone-dark">{roleLabel}</span>
              )}
              <span className="mx-1">·</span>
            </>
          )}
          {timeLabel}
          {canReport && (
            <button
              type="button"
              onClick={() => setReportOpen(true)}
              title="举报"
              aria-label="举报该消息"
              className="ml-1.5 inline-flex items-center gap-0.5 text-ink-300 hover:text-cinnabar opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity align-middle"
            >
              <Flag className="w-3 h-3" />
              举报
            </button>
          )}
        </p>

        {/* 文本消息 */}
        {message.type === 'text' && (
          <div
            className={`inline-block px-3 py-2 rounded-xl text-sm leading-relaxed whitespace-pre-wrap break-words text-left ${
              isOwn
                ? 'bg-cinnabar text-rice-50 rounded-tr-sm'
                : 'bg-white border border-ink-900/10 text-ink-800 rounded-tl-sm'
            }`}
          >
            {message.content}
          </div>
        )}

        {/* 分享报告卡片 */}
        {message.type === 'analysis_share' && message.snapshot && (
          <div className="text-left">
            <button
              onClick={() => message.analysisId && onViewReport(message.analysisId)}
              className="inline-block w-64 bg-white border border-ink-900/10 rounded-xl overflow-hidden hover:border-cinnabar/40 hover:shadow-card transition-all group"
            >
              <div className="h-32 bg-ink-900/5 overflow-hidden">
                <SnapshotImage src={message.snapshot.imageUrl} alt={message.snapshot.title ?? '作品'} />
              </div>
              <div className="px-3 py-2">
                <p className="text-xs font-medium text-ink-800 truncate">
                  {message.snapshot.title ?? '未命名作品'}
                </p>
                <p className="text-2xs text-ink-400 mt-0.5 flex items-center gap-1.5">
                  <span>{WORK_TYPE_LABELS[message.snapshot.workType] ?? message.snapshot.workType}</span>
                  {typeof message.snapshot.overallScore === 'number' && (
                    <>
                      <span>·</span>
                      <span className="text-cinnabar font-semibold">
                        {message.snapshot.overallScore} 分
                      </span>
                    </>
                  )}
                  <span className="ml-auto inline-flex items-center gap-0.5 text-stone group-hover:text-cinnabar transition-colors">
                    <Eye className="w-3 h-3" />
                    查看报告
                  </span>
                </p>
              </div>
            </button>
            {message.content && (
              <div
                className={`mt-1 inline-block px-3 py-2 rounded-xl text-sm leading-relaxed whitespace-pre-wrap break-words ${
                  isOwn
                    ? 'bg-cinnabar text-rice-50 rounded-tr-sm'
                    : 'bg-white border border-ink-900/10 text-ink-800 rounded-tl-sm'
                }`}
              >
                {message.content}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 举报弹窗(班级讨论消息 = 评论类目标) */}
      {reportOpen && (
        <ReportDialog
          open={reportOpen}
          targetType="comment"
          targetId={message.id}
          onClose={() => setReportOpen(false)}
        />
      )}
    </div>
  );
}

/* 快照图片(加载失败显示占位) */
function SnapshotImage({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <ImageOff className="w-6 h-6 text-ink-200" />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
      className="w-full h-full object-cover"
    />
  );
}

/* ============================================================
 * 分享诊断报告对话框(列出当前空间的成功作品供选择)
 * ============================================================ */
function ShareAnalysisDialog({
  classId,
  onClose,
  onShared,
  toast,
}: {
  classId: string;
  onClose: () => void;
  onShared: (msg: ClassMessage) => void;
  toast: ReturnType<typeof useToast>;
}) {
  const [works, setWorks] = useState<ListAnalysesResponse['items']>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    get<ListAnalysesResponse>('/analyses', { status: 'success', pageSize: 50 })
      .then((res) => {
        if (!cancelled) setWorks(res.items);
      })
      .catch(() => {
        /* 错误已由 api.ts 统一 Toast */
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleShare = async () => {
    if (!selectedId || sharing) return;
    setSharing(true);
    try {
      const msg = await sendClassMessage(classId, {
        type: 'analysis_share',
        analysisId: selectedId,
        content: note.trim() || undefined,
      });
      toast.success('已分享到班级讨论');
      onShared(msg);
    } catch {
      /* 错误已由 api.ts 统一 Toast(如作品不属于本班级) */
    } finally {
      setSharing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg bg-rice-50 border border-ink-900/10 rounded-xl shadow-elevated overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 h-12 border-b border-ink-900/8">
          <h3 className="text-sm font-semibold text-ink-900 font-serif">分享诊断报告</h3>
          <button onClick={onClose} className="w-7 h-7 inline-flex items-center justify-center rounded-md text-ink-400 hover:bg-rice-100" title="关闭">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="max-h-72 overflow-y-auto p-3">
          {loading ? (
            <div className="py-12 text-center">
              <Loader2 className="w-5 h-5 text-ink-300 animate-spin mx-auto" />
            </div>
          ) : works.length === 0 ? (
            <p className="py-12 text-center text-sm text-ink-400">
              当前空间暂无诊断成功的作品可分享
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {works.map((w) => (
                <button
                  key={w.id}
                  onClick={() => setSelectedId(w.id)}
                  className={`text-left rounded-lg border overflow-hidden transition-all ${
                    selectedId === w.id
                      ? 'border-cinnabar ring-2 ring-cinnabar/25'
                      : 'border-ink-900/10 hover:border-ink-900/25'
                  }`}
                >
                  <div className="h-20 bg-ink-900/5 overflow-hidden">
                    <SnapshotImage src={w.imageUrl} alt={w.title ?? '作品'} />
                  </div>
                  <div className="px-2 py-1.5">
                    <p className="text-2xs font-medium text-ink-800 truncate">{w.title ?? '未命名作品'}</p>
                    <p className="text-2xs text-ink-400">
                      {WORK_TYPE_LABELS[w.workType] ?? w.workType}
                      {typeof w.overallScore === 'number' && (
                        <span className="text-cinnabar font-semibold ml-1">{w.overallScore} 分</span>
                      )}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-ink-900/8 space-y-2.5">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            placeholder="附言(可选):说点什么…"
            className="w-full h-9 px-3 rounded-md border border-ink-900/15 bg-white text-sm text-ink-900 placeholder:text-ink-300 focus:outline-none focus:ring-2 focus:ring-stone/30"
          />
          <p className="text-2xs text-ink-300">仅可分享当前工作空间(班级)内诊断成功的作品</p>
          <div className="flex justify-end gap-2">
            <button
              onClick={onClose}
              className="px-3.5 h-9 rounded-md border border-ink-900/15 text-sm text-ink-600 hover:bg-rice-100 transition-colors"
            >
              取消
            </button>
            <button
              onClick={() => void handleShare()}
              disabled={!selectedId || sharing}
              className="inline-flex items-center gap-1.5 px-4 h-9 rounded-md bg-cinnabar text-rice-50 text-sm hover:bg-cinnabar-dark disabled:opacity-40 transition-colors"
            >
              {sharing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              分享
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
 * 查看分享报告弹窗
 * ============================================================ */
function SharedReportModal({
  classId,
  analysisId,
  onClose,
}: {
  classId: string;
  analysisId: string;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<SharedAnalysisDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getSharedClassAnalysis(classId, analysisId)
      .then((res) => {
        if (!cancelled) setDetail(res);
      })
      .catch(() => {
        if (!cancelled) onClose();
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId, analysisId]);

  const dimensions = useMemo(() => {
    const dims = detail?.result?.dimensions;
    if (!dims) return [];
    return Object.entries(dims).filter(
      (entry): entry is [string, { score?: number; level?: string; comment?: string }] =>
        entry[0] !== 'type' && entry[1] !== null && typeof entry[1] === 'object',
    );
  }, [detail]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl max-h-[85vh] bg-rice-50 border border-ink-900/10 rounded-xl shadow-elevated overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 h-12 border-b border-ink-900/8 flex-shrink-0">
          <h3 className="text-sm font-semibold text-ink-900 font-serif">
            {detail?.title ?? '诊断报告'}
          </h3>
          <button onClick={onClose} className="w-7 h-7 inline-flex items-center justify-center rounded-md text-ink-400 hover:bg-rice-100" title="关闭">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="py-16 text-center">
              <Loader2 className="w-6 h-6 text-ink-300 animate-spin mx-auto" />
            </div>
          ) : !detail ? null : (
            <div className="space-y-4">
              {/* 作品图 + 总分 */}
              <div className="flex gap-4">
                <div className="w-40 h-40 rounded-lg overflow-hidden bg-ink-900/5 flex-shrink-0">
                  <SnapshotImage src={detail.imageUrl} alt={detail.title ?? '作品'} />
                </div>
                <div className="min-w-0">
                  <p className="text-2xs text-ink-400">
                    {WORK_TYPE_LABELS[detail.workType] ?? detail.workType}
                    {detail.aiEnhanced && (
                      <span className="ml-1.5 px-1.5 py-px rounded bg-jade/15 text-jade-dark">AI 增强</span>
                    )}
                  </p>
                  {typeof detail.result?.overallScore === 'number' && (
                    <p className="mt-1">
                      <span className="text-3xl font-bold text-cinnabar font-serif">
                        {detail.result.overallScore}
                      </span>
                      <span className="text-sm text-ink-400 ml-1">分</span>
                    </p>
                  )}
                  {detail.result?.summary && (
                    <p className="text-xs text-ink-600 leading-relaxed mt-2">{detail.result.summary}</p>
                  )}
                </div>
              </div>

              {/* 维度评分 */}
              {dimensions.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-ink-700 mb-2">维度评分</h4>
                  <div className="grid grid-cols-3 gap-2">
                    {dimensions.map(([key, dim]) => (
                      <div key={key} className="px-3 py-2 rounded-lg bg-white border border-ink-900/10">
                        <p className="text-2xs text-ink-400">{key}</p>
                        {typeof dim.score === 'number' && (
                          <p className="text-sm font-semibold text-ink-900">{dim.score}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 改进建议 */}
              {detail.result?.suggestions && detail.result.suggestions.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-ink-700 mb-2">改进建议</h4>
                  <ul className="space-y-1.5">
                    {detail.result.suggestions.slice(0, 5).map((s, i) => (
                      <li key={i} className="flex gap-2 text-xs text-ink-600 leading-relaxed">
                        <span className="w-4 h-4 rounded-full bg-stone/15 text-stone-dark text-2xs font-semibold inline-flex items-center justify-center flex-shrink-0 mt-px">
                          {i + 1}
                        </span>
                        <span>{s.title ?? s.description ?? ''}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
