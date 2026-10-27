// ============================================================
// 丹青有AI - 我的班级列表页(所有登录用户可访问)
// 数据: GET /api/v1/classes   我的班级列表(含成员数)
// 入口: 侧边栏「我的班级」;学生加入班级后在此进入班级空间
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { GraduationCap, Users, ChevronRight, Loader2, Ticket } from 'lucide-react';
import { listMyClasses } from '../../services/class-api';
import type { ClassInfo } from '../../services/class-api';

export default function MyClassesPage() {
  const [classes, setClasses] = useState<ClassInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listMyClasses();
      setClasses(res);
    } catch {
      /* 错误已由 api.ts 统一 Toast */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="max-w-4xl mx-auto px-4 md:px-6 py-6 space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-ink-900 font-serif">我的班级</h1>
        <p className="text-xs text-ink-400 mt-0.5">加入的班级空间,可参与讨论、分享诊断报告</p>
      </div>

      {loading ? (
        <div className="py-16 text-center">
          <Loader2 className="w-6 h-6 text-ink-300 animate-spin mx-auto" />
        </div>
      ) : classes.length === 0 ? (
        <div className="py-16 text-center bg-rice-50 border border-ink-900/10 rounded-xl">
          <GraduationCap className="w-10 h-10 text-ink-200 mx-auto mb-3" />
          <p className="text-sm text-ink-500 mb-1">还没有加入任何班级</p>
          <p className="text-2xs text-ink-400 mb-5">使用老师分享的邀请码加入班级,提交作业并参与讨论</p>
          <Link
            to="/join-class"
            className="inline-flex items-center gap-1.5 px-4 h-9 rounded-md bg-cinnabar text-rice-50 text-sm hover:bg-cinnabar-dark transition-colors"
          >
            <Ticket className="w-4 h-4" />
            加入班级
          </Link>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {classes.map((c) => (
            <Link
              key={c.id}
              to={`/classes/${c.id}`}
              className="group flex items-center gap-3 p-4 bg-rice-50 border border-ink-900/10 rounded-xl hover:border-cinnabar/40 hover:shadow-card transition-all"
            >
              <div className="w-11 h-11 rounded-lg bg-gradient-to-br from-stone to-stone-dark flex items-center justify-center flex-shrink-0">
                <GraduationCap className="w-5 h-5 text-rice-50" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink-900 truncate">{c.name}</p>
                <p className="text-2xs text-ink-400 mt-0.5 flex items-center gap-1">
                  <Users className="w-3 h-3" />
                  {c.memberCount} 名成员
                  {c.description && (
                    <>
                      <span className="mx-1">·</span>
                      <span className="truncate">{c.description}</span>
                    </>
                  )}
                </p>
              </div>
              <ChevronRight className="w-4 h-4 text-ink-300 group-hover:text-cinnabar group-hover:translate-x-0.5 transition-all flex-shrink-0" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
