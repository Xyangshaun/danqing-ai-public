// ============================================================
// 丹青有AI - 教师端 · 班级详情页(学生 / 邀请码 双标签)
// 数据:
//   GET  /api/v1/classes/:id                班级详情 + 成员列表
//   POST /api/v1/classes/:id/invitations    生成邀请码
//   GET  /api/v1/classes/:id/invitations    邀请码列表
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft, RefreshCw, Users, ChevronRight, Ticket, Plus,
  Copy, Check, Loader2, MessageSquare,
} from 'lucide-react';
import {
  getClassDetail,
  createClassInvitation,
  listClassInvitations,
} from '../../services/class-api';
import type { ClassInfo, ClassMemberInfo, ClassInvitation } from '../../services/class-api';
import { useToast } from '../../components/ToastProvider';
import { AdminSection, SectionSkeleton } from '../../components/admin/AdminUI';
import ClassDiscussion from '../../components/class/ClassDiscussion';

type TabKey = 'students' | 'discussion' | 'invitations';

export default function TeacherClassDetailPage() {
  const { classId = '' } = useParams();
  const toast = useToast();

  const [cls, setCls] = useState<ClassInfo | null>(null);
  const [members, setMembers] = useState<ClassMemberInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>('students');

  const loadDetail = useCallback(async () => {
    if (!classId) return;
    setLoading(true);
    try {
      const res = await getClassDetail(classId);
      // 后端契约:扁平结构(班级字段 + members),非 { class, members }
      setCls(res);
      setMembers(res.members);
    } catch {
      // 错误已由 api.ts 统一 Toast
    } finally {
      setLoading(false);
    }
  }, [classId]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  /* 学生成员(过滤非学生角色,按姓名排序) */
  const students = useMemo(
    () =>
      members
        .filter((m) => m.role === 'student')
        .sort((a, b) => a.user.name.localeCompare(b.user.name, 'zh-Hans-CN')),
    [members],
  );

  return (
    <div className="max-w-5xl mx-auto px-4 md:px-6 py-6 space-y-5">
      {/* 顶部 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            to="/teacher/classes"
            className="inline-flex items-center justify-center w-8 h-8 rounded-md border border-ink-900/15 text-ink-600 hover:bg-rice-100"
            title="返回班级列表"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <h1 className="text-xl font-semibold text-ink-900 font-serif">
              {cls?.name ?? '班级详情'}
            </h1>
            <p className="text-xs text-ink-400 mt-0.5">
              {cls?.description ?? '暂无描述'} · {students.length} 名学生
            </p>
          </div>
        </div>
        <button
          onClick={() => void loadDetail()}
          className="inline-flex items-center gap-1.5 px-3 h-9 rounded-md border border-ink-900/15 bg-rice-50 text-sm text-ink-700 hover:bg-rice-100 transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          刷新
        </button>
      </div>

      {/* 标签页切换 */}
      <div className="flex items-center gap-1 border-b border-ink-900/10">
        {(
          [
            { key: 'students', label: `学生 (${students.length})`, icon: Users },
            { key: 'discussion', label: '讨论', icon: MessageSquare },
            { key: 'invitations', label: '邀请码', icon: Ticket },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`inline-flex items-center gap-1.5 px-4 h-10 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.key
                ? 'border-cinnabar text-ink-900'
                : 'border-transparent text-ink-400 hover:text-ink-700'
            }`}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'students' ? (
        <StudentsTab
          classId={classId}
          students={students}
          loading={loading && members.length === 0}
        />
      ) : tab === 'discussion' ? (
        <ClassDiscussion classId={classId} />
      ) : (
        <InvitationsTab classId={classId} toast={toast} />
      )}
    </div>
  );
}

/* ============================================================
 * 学生标签:学生列表,点击进入作品列表
 * ============================================================ */
function StudentsTab({
  classId,
  students,
  loading,
}: {
  classId: string;
  students: ClassMemberInfo[];
  loading: boolean;
}) {
  return (
    <AdminSection title="学生列表" desc="点击学生进入作品列表与打分">
      {loading ? (
        <SectionSkeleton lines={5} />
      ) : students.length === 0 ? (
        <div className="py-10 text-center">
          <Users className="w-8 h-8 text-ink-200 mx-auto mb-2" />
          <p className="text-sm text-ink-400">暂无学生,切换到「邀请码」标签生成邀请码邀请学生加入</p>
        </div>
      ) : (
        <div className="divide-y divide-ink-900/5">
          {students.map((m) => (
            <Link
              key={m.userId}
              to={`/teacher/classes/${classId}/students/${m.userId}/works?name=${encodeURIComponent(m.user.name)}`}
              className="flex items-center gap-3 py-3 px-2 -mx-2 rounded-lg hover:bg-rice-100/70 transition-colors group"
            >
              {m.user.avatar ? (
                <img
                  src={m.user.avatar}
                  alt={m.user.name}
                  loading="lazy"
                  className="w-9 h-9 rounded-full object-cover border border-ink-900/10"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-stone to-stone-dark flex items-center justify-center text-xs font-bold text-white">
                  {m.user.name.charAt(0)}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink-800 truncate">{m.user.name}</p>
                <p className="text-2xs text-ink-400 truncate">
                  {m.user.email ?? '—'} · 加入于 {new Date(m.joinedAt).toLocaleDateString()}
                </p>
              </div>
              <ChevronRight className="w-4 h-4 text-ink-300 group-hover:text-cinnabar group-hover:translate-x-0.5 transition-all" />
            </Link>
          ))}
        </div>
      )}
    </AdminSection>
  );
}

/* ============================================================
 * 邀请码标签:生成 + 列表 + 复制
 * ============================================================ */
function InvitationsTab({
  classId,
  toast,
}: {
  classId: string;
  toast: ReturnType<typeof useToast>;
}) {
  const [invitations, setInvitations] = useState<ClassInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!classId) return;
    setLoading(true);
    try {
      const res = await listClassInvitations(classId);
      setInvitations(res);
    } catch {
      // 错误已由 api.ts 统一 Toast
    } finally {
      setLoading(false);
    }
  }, [classId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = async () => {
    setCreating(true);
    try {
      await createClassInvitation(classId);
      toast.success('邀请码已生成');
      await load();
    } catch {
      // 错误已由 api.ts 统一 Toast
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = async (inv: ClassInvitation) => {
    try {
      await navigator.clipboard.writeText(inv.code);
      setCopiedId(inv.id);
      toast.success('邀请码已复制', inv.code);
      window.setTimeout(() => setCopiedId((prev) => (prev === inv.id ? null : prev)), 2000);
    } catch {
      toast.error('复制失败', '请手动选择邀请码复制');
    }
  };

  return (
    <AdminSection
      title="邀请码"
      desc="学生凭邀请码在「加入班级」页面加入本班"
      action={
        <button
          onClick={() => void handleCreate()}
          disabled={creating}
          className="inline-flex items-center gap-1.5 px-3 h-8 rounded-md bg-cinnabar text-rice-50 text-xs hover:bg-cinnabar-dark disabled:opacity-50"
        >
          {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
          生成邀请码
        </button>
      }
    >
      {loading && invitations.length === 0 ? (
        <SectionSkeleton lines={3} />
      ) : invitations.length === 0 ? (
        <div className="py-10 text-center">
          <Ticket className="w-8 h-8 text-ink-200 mx-auto mb-2" />
          <p className="text-sm text-ink-400">暂无邀请码,点击右上角生成</p>
        </div>
      ) : (
        <div className="space-y-2">
          {invitations.map((inv) => {
            const expired = new Date(inv.expiresAt).getTime() < Date.now();
            const exhausted = inv.maxUses > 0 && inv.usedCount >= inv.maxUses;
            const invalid = expired || exhausted;
            return (
              <div
                key={inv.id}
                className={`flex items-center gap-3 px-3.5 py-3 rounded-lg border ${
                  invalid ? 'border-ink-900/8 bg-ink-900/[0.02]' : 'border-ink-900/10 bg-white/50'
                }`}
              >
                <code
                  className={`text-sm font-mono font-semibold tracking-wider ${
                    invalid ? 'text-ink-300 line-through' : 'text-cinnabar'
                  }`}
                >
                  {inv.code}
                </code>
                <div className="min-w-0 flex-1 text-2xs text-ink-400">
                  <span>
                    已用 {inv.usedCount}
                    {inv.maxUses > 0 ? ` / ${inv.maxUses}` : ' / 不限'} 次
                  </span>
                  <span className="mx-1.5">·</span>
                  <span>
                    {expired
                      ? '已过期'
                      : `${new Date(inv.expiresAt).toLocaleString('zh-CN')} 过期`}
                  </span>
                  {exhausted && (
                    <>
                      <span className="mx-1.5">·</span>
                      <span className="text-gold-dark">次数已用完</span>
                    </>
                  )}
                </div>
                <button
                  onClick={() => void handleCopy(inv)}
                  disabled={invalid}
                  className="inline-flex items-center gap-1 px-2.5 h-7 rounded-md border border-ink-900/15 text-2xs text-ink-600 hover:bg-rice-100 disabled:opacity-40 transition-colors"
                  title="复制邀请码"
                >
                  {copiedId === inv.id ? (
                    <Check className="w-3 h-3 text-jade" />
                  ) : (
                    <Copy className="w-3 h-3" />
                  )}
                  {copiedId === inv.id ? '已复制' : '复制'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </AdminSection>
  );
}
