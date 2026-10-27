// ============================================================
// 丹青有AI - 班级空间页(所有班级成员可访问,含学生)
// 数据: GET /api/v1/classes/:id   班级详情 + 成员列表
// 功能: 班级讨论(聊天 + 分享诊断报告) / 成员列表
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Users, MessageSquare, Loader2 } from 'lucide-react';
import { getClassDetail } from '../../services/class-api';
import type { ClassDetailResponse } from '../../services/class-api';
import ClassDiscussion from '../../components/class/ClassDiscussion';

type TabKey = 'discussion' | 'members';

export default function ClassSpacePage() {
  const { classId = '' } = useParams();

  const [detail, setDetail] = useState<ClassDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [tab, setTab] = useState<TabKey>('discussion');

  const load = useCallback(async () => {
    if (!classId) return;
    setLoading(true);
    try {
      const res = await getClassDetail(classId);
      setDetail(res);
    } catch {
      // 非成员/不存在:api.ts 已 Toast,此处展示空态
      setForbidden(true);
    } finally {
      setLoading(false);
    }
  }, [classId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="py-24 text-center">
        <Loader2 className="w-6 h-6 text-ink-300 animate-spin mx-auto" />
      </div>
    );
  }

  if (forbidden || !detail) {
    return (
      <div className="max-w-4xl mx-auto px-4 md:px-6 py-16 text-center">
        <Users className="w-10 h-10 text-ink-200 mx-auto mb-3" />
        <p className="text-sm text-ink-500 mb-4">班级不存在或您不是该班级成员</p>
        <Link
          to="/classes"
          className="inline-flex items-center px-4 h-9 rounded-md border border-ink-900/15 text-sm text-ink-700 hover:bg-rice-100 transition-colors"
        >
          返回我的班级
        </Link>
      </div>
    );
  }

  const teachers = detail.members.filter((m) => m.role !== 'student');
  const students = detail.members.filter((m) => m.role === 'student');

  return (
    <div className="max-w-4xl mx-auto px-4 md:px-6 py-6 space-y-5">
      {/* 顶部 */}
      <div className="flex items-center gap-3">
        <Link
          to="/classes"
          className="inline-flex items-center justify-center w-8 h-8 rounded-md border border-ink-900/15 text-ink-600 hover:bg-rice-100"
          title="返回我的班级"
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div>
          <h1 className="text-xl font-semibold text-ink-900 font-serif">{detail.name}</h1>
          <p className="text-xs text-ink-400 mt-0.5">
            {detail.description ?? '暂无描述'} · {students.length} 名学生
            {teachers.length > 0 && ` · ${teachers.map((t) => t.user.name).join('、')}`}
          </p>
        </div>
      </div>

      {/* 标签页 */}
      <div className="flex items-center gap-1 border-b border-ink-900/10">
        {(
          [
            { key: 'discussion', label: '班级讨论', icon: MessageSquare },
            { key: 'members', label: `成员 (${detail.members.length})`, icon: Users },
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

      {tab === 'discussion' ? (
        <ClassDiscussion classId={classId} />
      ) : (
        <div className="bg-rice-50 border border-ink-900/10 rounded-xl divide-y divide-ink-900/5">
          {detail.members.map((m) => (
            <div key={m.userId} className="flex items-center gap-3 px-4 py-3">
              {m.user.avatar ? (
                <img
                  src={m.user.avatar}
                  alt={m.user.name}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  className="w-9 h-9 rounded-full object-cover border border-ink-900/10"
                />
              ) : (
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-stone to-stone-dark flex items-center justify-center text-xs font-bold text-white">
                  {m.user.name.charAt(0)}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink-800 truncate">{m.user.name}</p>
                <p className="text-2xs text-ink-400">
                  加入于 {new Date(m.joinedAt).toLocaleDateString()}
                </p>
              </div>
              <span
                className={`px-2 py-0.5 rounded-full text-2xs ${
                  m.role === 'student'
                    ? 'bg-ink-900/5 text-ink-500'
                    : 'bg-stone/15 text-stone-dark'
                }`}
              >
                {m.role === 'student' ? '学生' : '老师'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
