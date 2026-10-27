// ============================================================
// SharedWorkCard — 组织动态流作品卡片
//
// 内容:
//   - 作品缩略图 + 总分徽章 + 类型标签
//   - 分享者信息(头像/姓名/角色) + 时间
//   - 分享感言(caption)
//   - 操作:查看报告 / 评论展开收起 / 置顶(teacher+) / 删除(本人或 teacher+)
//   - 评论区:最新 3 条预览 + 完整列表 + 发表评论
// ============================================================

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Pin, PinOff, Trash2, MessageCircle, ChevronDown, ChevronUp,
  Eye, Loader2, Send, Brush, PenTool, Box, Layers, Flag,
} from 'lucide-react';
import type { SharedWorkItem, ShareCommentItem } from '../../types/api-contract';
import {
  pinSharedWork,
  unpinSharedWork,
  deleteSharedWork,
  listShareComments,
  createShareComment,
  deleteShareComment,
  ApiError,
} from '../../services/api';
import { useAuth } from '../../hooks/useAuth';
import { isTeacherRole } from '../auth/RequireTeacherRole';
import { useToast } from '../ToastProvider';
import SmartImage from '../SmartImage';
import ReportDialog from '../report/ReportDialog';

const ART_TYPE_LABELS: Record<string, string> = {
  painting: '绘画',
  design: '设计',
  product: '产品设计',
  sculpture: '雕塑',
};

const ART_TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  painting: Brush,
  design: PenTool,
  product: Box,
  sculpture: Layers,
};

const MAX_COMMENT = 500;

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = Date.now();
  const diffMin = Math.floor((now - d.getTime()) / 60000);
  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} 小时前`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return `${diffDay} 天前`;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function scoreBadgeBg(score: number | null): string {
  if (score === null) return 'bg-ink-500';
  if (score >= 85) return 'bg-jade';
  if (score >= 70) return 'bg-gold';
  return 'bg-cinnabar';
}

interface SharedWorkCardProps {
  item: SharedWorkItem;
  /** 删除/置顶后通知父级刷新 */
  onChanged: () => void;
}

export default function SharedWorkCard({ item, onChanged }: SharedWorkCardProps) {
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuth();

  const [commentsOpen, setCommentsOpen] = useState(false);
  const [comments, setComments] = useState<ShareCommentItem[]>(item.recentComments);
  const [commentCount, setCommentCount] = useState(item.commentCount);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [pinning, setPinning] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  const canManage = isTeacherRole(user?.role);
  const isMine = user?.id === item.user.id;
  /* 举报入口:仅登录用户可见(未登录不显示,公安备案合规) */
  const canReport = user !== null;
  const TypeIcon = ART_TYPE_ICONS[item.analysis.workType] ?? Brush;

  /* 展开/收起评论区;首次展开时拉取完整评论列表 */
  const toggleComments = async () => {
    const next = !commentsOpen;
    setCommentsOpen(next);
    if (next) {
      setCommentsLoading(true);
      try {
        const full = await listShareComments(item.id);
        setComments(full);
      } catch {
        /* 失败时保留预览评论 */
      } finally {
        setCommentsLoading(false);
      }
    }
  };

  const handlePin = async () => {
    if (pinning) return;
    setPinning(true);
    try {
      if (item.isPinned) {
        await unpinSharedWork(item.id);
        toast.success('已取消置顶');
      } else {
        await pinSharedWork(item.id);
        toast.success('已置顶', '该作品将展示在动态流顶部');
      }
      onChanged();
    } catch (err) {
      toast.error('操作失败', err instanceof ApiError ? err.message : '网络异常,请稍后重试');
    } finally {
      setPinning(false);
    }
  };

  const handleDelete = async () => {
    if (deleting) return;
    if (!window.confirm('确定删除这条分享吗?相关评论将一并删除。')) return;
    setDeleting(true);
    try {
      await deleteSharedWork(item.id);
      toast.success('已删除分享');
      onChanged();
    } catch (err) {
      toast.error('删除失败', err instanceof ApiError ? err.message : '网络异常,请稍后重试');
      setDeleting(false);
    }
  };

  const handleSubmitComment = async () => {
    const content = draft.trim();
    if (!content || submitting) return;
    setSubmitting(true);
    try {
      const created = await createShareComment(item.id, { content });
      setComments((prev) => [...prev, created]);
      setCommentCount((n) => n + 1);
      setDraft('');
    } catch (err) {
      toast.error('评论失败', err instanceof ApiError ? err.message : '网络异常,请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteComment = async (comment: ShareCommentItem) => {
    try {
      await deleteShareComment(item.id, comment.id);
      setComments((prev) => prev.filter((c) => c.id !== comment.id));
      setCommentCount((n) => Math.max(0, n - 1));
    } catch (err) {
      toast.error('删除失败', err instanceof ApiError ? err.message : '网络异常,请稍后重试');
    }
  };

  return (
    <div className={`bg-rice-50 rounded-2xl shadow-card overflow-hidden ${item.isPinned ? 'ring-1 ring-gold/50' : ''}`}>
      {/* 头部:分享者 + 时间 + 管理操作 */}
      <div className="flex items-center justify-between px-5 pt-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-full bg-ink-900/10 flex items-center justify-center flex-shrink-0 overflow-hidden">
            {item.user.avatar ? (
              <img src={item.user.avatar} alt={item.user.name} className="w-full h-full object-cover" />
            ) : (
              <span className="text-sm font-medium text-ink-600">{item.user.name.slice(0, 1)}</span>
            )}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink-900 truncate">
              {item.user.name}
              {item.user.role === 'teacher' && (
                <span className="ml-1.5 text-2xs px-1.5 py-0.5 bg-stone/10 text-stone rounded-full align-middle">教师</span>
              )}
            </p>
            <p className="text-xs text-ink-400">{formatTime(item.createdAt)}</p>
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {item.isPinned && (
            <span className="inline-flex items-center gap-1 text-2xs px-2 py-0.5 bg-gold/10 text-gold rounded-full font-medium">
              <Pin className="w-3 h-3" />
              置顶
            </span>
          )}
          {canManage && (
            <button
              onClick={() => void handlePin()}
              disabled={pinning}
              aria-label={item.isPinned ? '取消置顶' : '置顶'}
              title={item.isPinned ? '取消置顶' : '置顶到动态流顶部'}
              className="p-1.5 text-ink-400 hover:text-gold rounded-lg transition-colors disabled:opacity-50"
            >
              {pinning ? <Loader2 className="w-4 h-4 animate-spin" /> : item.isPinned ? <PinOff className="w-4 h-4" /> : <Pin className="w-4 h-4" />}
            </button>
          )}
          {(isMine || canManage) && (
            <button
              onClick={() => void handleDelete()}
              disabled={deleting}
              aria-label="删除分享"
              title="删除分享"
              className="p-1.5 text-ink-400 hover:text-cinnabar rounded-lg transition-colors disabled:opacity-50"
            >
              {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            </button>
          )}
        </div>
      </div>

      {/* 分享感言 */}
      {item.caption && (
        <p className="px-5 pt-3 text-sm text-ink-700 leading-relaxed">{item.caption}</p>
      )}

      {/* 作品图 + 悬浮分数徽章 */}
      <div className="relative mt-3 mx-5 rounded-xl overflow-hidden bg-ink-100">
        <SmartImage
          src={item.analysis.imageUrl}
          alt={item.analysis.title ?? '分享的作品'}
          className="w-full max-h-72"
          imgClassName="object-cover"
          fallbackText="作品图加载失败"
        />
        <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-ink-900/75 backdrop-blur-sm px-2.5 py-1 rounded-lg">
          <TypeIcon className="w-3.5 h-3.5 text-rice-100" />
          <span className="text-xs text-rice-100">{ART_TYPE_LABELS[item.analysis.workType] ?? item.analysis.workType}</span>
        </div>
        {item.analysis.overallScore !== null && (
          <div className={`absolute top-3 right-3 w-11 h-11 ${scoreBadgeBg(item.analysis.overallScore)} rounded-full flex items-center justify-center shadow-overlay`}>
            <span className="font-serif text-lg font-bold text-white">{item.analysis.overallScore}</span>
          </div>
        )}
      </div>

      {/* 底部操作栏 */}
      <div className="flex items-center gap-2 px-5 py-3">
        <button
          onClick={() => navigate(`/report/${encodeURIComponent(item.analysis.id)}`)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-ink-600 hover:text-ink-900 hover:bg-ink-900/5 rounded-lg transition-colors"
        >
          <Eye className="w-3.5 h-3.5" />
          查看报告
        </button>
        <button
          onClick={() => void toggleComments()}
          aria-expanded={commentsOpen}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-ink-600 hover:text-ink-900 hover:bg-ink-900/5 rounded-lg transition-colors"
        >
          <MessageCircle className="w-3.5 h-3.5" />
          评论{commentCount > 0 ? `(${commentCount})` : ''}
          {commentsOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
        {/* 举报(登录用户可见,靠右与内容操作区分隔) */}
        {canReport && (
          <button
            onClick={() => setReportOpen(true)}
            aria-label="举报该作品"
            title="举报"
            className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-ink-400 hover:text-cinnabar hover:bg-cinnabar/5 rounded-lg transition-colors"
          >
            <Flag className="w-3.5 h-3.5" />
            举报
          </button>
        )}
      </div>

      {/* 评论区 */}
      {commentsOpen && (
        <div className="border-t border-ink-900/8 px-5 py-4 space-y-3">
          {commentsLoading ? (
            <div className="flex items-center justify-center py-3 text-ink-400">
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
              <span className="text-xs">加载评论…</span>
            </div>
          ) : comments.length === 0 ? (
            <p className="text-xs text-ink-400 text-center py-2">还没有评论,来第一条吧</p>
          ) : (
            <ul className="space-y-3">
              {comments.map((c) => (
                <li key={c.id} className="flex items-start gap-2.5 group">
                  <div className="w-7 h-7 rounded-full bg-ink-900/10 flex items-center justify-center flex-shrink-0 overflow-hidden">
                    {c.user.avatar ? (
                      <img src={c.user.avatar} alt={c.user.name} className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-2xs font-medium text-ink-600">{c.user.name.slice(0, 1)}</span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-ink-500">
                      <span className="font-medium text-ink-800">{c.user.name}</span>
                      {c.user.role === 'teacher' && (
                        <span className="ml-1 text-2xs px-1 py-0.5 bg-stone/10 text-stone rounded-full">教师</span>
                      )}
                      <span className="ml-2 text-ink-300">{formatTime(c.createdAt)}</span>
                    </p>
                    <p className="text-sm text-ink-700 leading-relaxed mt-0.5 break-words">{c.content}</p>
                  </div>
                  {(user?.id === c.user.id || canManage) && (
                    <button
                      onClick={() => void handleDeleteComment(c)}
                      aria-label="删除评论"
                      className="p-1 text-ink-300 hover:text-cinnabar rounded opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {/* 发表评论 */}
          <div className="flex items-center gap-2 pt-1">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value.slice(0, MAX_COMMENT))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) void handleSubmitComment();
              }}
              placeholder="写下你的点评…"
              maxLength={MAX_COMMENT}
              className="flex-1 bg-white border border-ink-200 rounded-lg px-3 py-2 text-sm text-ink-800 placeholder:text-ink-300 focus:outline-none focus:border-stone"
            />
            <button
              onClick={() => void handleSubmitComment()}
              disabled={!draft.trim() || submitting}
              aria-label="发送评论"
              className="p-2 bg-ink-900 text-rice-100 rounded-lg hover:bg-cinnabar transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </div>
        </div>
      )}

      {/* 举报弹窗(组织动态流分享作品 = 作品类目标) */}
      {reportOpen && (
        <ReportDialog
          open={reportOpen}
          targetType="artwork"
          targetId={item.analysis.id}
          onClose={() => setReportOpen(false)}
        />
      )}
    </div>
  );
}
