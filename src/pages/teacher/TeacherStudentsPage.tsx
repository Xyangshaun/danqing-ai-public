// ============================================================
// 丹青有AI - 教师端 · 班级学生列表
// 数据: GET /api/v1/tenants/:id/members(当前租户,筛选 role=student)
// 功能: 学生列表(搜索)、跳转学生详情(作品/成长曲线/评分)
// ============================================================

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { GraduationCap, Search, RefreshCw, Users, ChevronRight, School } from 'lucide-react';
import { listClassMembers } from '../../services/teacher-api';
import type { TenantMemberInfo } from '../../types/teacher';
import { useAuth } from '../../hooks/useAuth';
import { AdminSection, SectionSkeleton } from '../../components/admin/AdminUI';

export default function TeacherStudentsPage() {
  const { tenant } = useAuth();
  const [members, setMembers] = useState<TenantMemberInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchInput, setSearchInput] = useState('');

  const load = async () => {
    if (!tenant) return;
    setLoading(true);
    try {
      const res = await listClassMembers(tenant.id);
      setMembers(res);
    } catch {
      // 错误已由 api.ts 统一 Toast
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant?.id]);

  /* 仅学生 + 搜索过滤(姓名/邮箱) */
  const students = useMemo(() => {
    const kw = searchInput.trim().toLowerCase();
    return members
      .filter((m) => m.role === 'student')
      .filter(
        (m) =>
          !kw ||
          m.user.name.toLowerCase().includes(kw) ||
          (m.user.email ?? '').toLowerCase().includes(kw),
      )
      .sort((a, b) => a.user.name.localeCompare(b.user.name, 'zh-Hans-CN'));
  }, [members, searchInput]);

  return (
    <div className="max-w-5xl mx-auto px-4 md:px-6 py-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink-900 font-serif flex items-center gap-2">
            <GraduationCap className="w-5 h-5 text-cinnabar" />
            班级学生
          </h1>
          <p className="text-xs text-ink-400 mt-1">
            {tenant?.name ?? '当前租户'} · 共 {students.length} 名学生
          </p>
        </div>
        <button
          onClick={() => void load()}
          className="inline-flex items-center gap-1.5 px-3 h-9 rounded-md border border-ink-900/15 bg-rice-50 text-sm text-ink-700 hover:bg-rice-100 transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          刷新
        </button>
      </div>

      {/* 班级管理入口卡片 */}
      <Link
        to="/teacher/classes"
        className="flex items-center gap-3 bg-rice-50 border border-ink-900/10 rounded-xl shadow-card p-4 hover:shadow-card-hover transition-shadow group"
      >
        <div className="w-10 h-10 rounded-lg bg-cinnabar/10 flex items-center justify-center flex-shrink-0">
          <School className="w-5 h-5 text-cinnabar" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink-800">班级管理</p>
          <p className="text-2xs text-ink-400">创建班级、生成邀请码、按班级查看学生作品并打分</p>
        </div>
        <ChevronRight className="w-4 h-4 text-ink-300 group-hover:text-cinnabar group-hover:translate-x-0.5 transition-all" />
      </Link>

      {/* 搜索栏 */}
      <div className="bg-rice-50 border border-ink-900/10 rounded-xl shadow-card p-4">
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-300" />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="搜索学生姓名 / 邮箱"
            className="w-full h-9 pl-9 pr-3 rounded-md border border-ink-900/15 bg-white text-sm text-ink-800 focus:outline-none focus:ring-2 focus:ring-stone/30"
          />
        </div>
      </div>

      {/* 学生列表 */}
      <AdminSection title="学生列表" desc="点击学生进入作品与成长详情">
        {loading && members.length === 0 ? (
          <SectionSkeleton lines={5} />
        ) : students.length === 0 ? (
          <div className="py-10 text-center">
            <Users className="w-8 h-8 text-ink-200 mx-auto mb-2" />
            <p className="text-sm text-ink-400">
              {searchInput ? '未找到匹配的学生' : '当前班级暂无学生成员'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-ink-900/5">
            {students.map((m) => (
              <Link
                key={m.userId}
                to={`/teacher/students/${m.userId}?name=${encodeURIComponent(m.user.name)}`}
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
    </div>
  );
}
