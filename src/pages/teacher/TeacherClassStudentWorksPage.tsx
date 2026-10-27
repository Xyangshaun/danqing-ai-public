// ============================================================
// 丹青有AI - 教师端 · 班级学生作品列表页
// 数据: GET /api/v1/classes/:id/students/:userId/works?page=&limit=
// 功能: 作品卡片网格(图片/标题/AI分数/评审记录数/创建时间)、分页、跳转打分页
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, RefreshCw, ImageOff, ScrollText, ClipboardCheck } from 'lucide-react';
import { getStudentWorks } from '../../services/class-api';
import type { StudentWork } from '../../services/class-api';
import { AdminSection, SectionSkeleton } from '../../components/admin/AdminUI';

const WORK_TYPE_LABEL: Record<string, string> = {
  painting: '绘画',
  design: '设计',
  product: '产品',
  sculpture: '雕塑',
};

const PAGE_SIZE = 12;

export default function TeacherClassStudentWorksPage() {
  const { classId = '', studentId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const studentName = searchParams.get('name') ?? '学生';

  const [works, setWorks] = useState<StudentWork[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    if (!classId || !studentId) return;
    setLoading(true);
    try {
      const res = await getStudentWorks(classId, studentId, { page, limit: PAGE_SIZE });
      setWorks(res.items);
      setTotal(res.total);
    } catch {
      // 错误已由 api.ts 统一 Toast
    } finally {
      setLoading(false);
    }
  }, [classId, studentId, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / PAGE_SIZE)), [total]);

  return (
    <div className="max-w-6xl mx-auto px-4 md:px-6 py-6 space-y-5">
      {/* 顶部 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            to={`/teacher/classes/${classId}`}
            className="inline-flex items-center justify-center w-8 h-8 rounded-md border border-ink-900/15 text-ink-600 hover:bg-rice-100"
            title="返回班级详情"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <h1 className="text-xl font-semibold text-ink-900 font-serif">{studentName} 的作品</h1>
            <p className="text-xs text-ink-400 mt-0.5">共 {total} 件作品</p>
          </div>
        </div>
        <button
          onClick={() => void load()}
          className="inline-flex items-center gap-1.5 px-3 h-9 rounded-md border border-ink-900/15 bg-rice-50 text-sm text-ink-700 hover:bg-rice-100 transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          刷新
        </button>
      </div>

      {/* 作品列表 */}
      <AdminSection title="作品列表" desc="点击作品进入打分页">
        {loading && works.length === 0 ? (
          <SectionSkeleton lines={4} />
        ) : works.length === 0 ? (
          <p className="text-sm text-ink-400 py-8 text-center">该学生暂无作品</p>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {works.map((w) => (
                <Link
                  key={w.id}
                  to={`/teacher/classes/${classId}/students/${studentId}/works/${w.id}/review?name=${encodeURIComponent(studentName)}`}
                  className="group bg-rice-50 border border-ink-900/10 rounded-lg overflow-hidden shadow-card hover:shadow-card-hover transition-shadow"
                >
                  {w.imageUrl ? (
                    <img
                      src={w.imageUrl}
                      alt={w.title ?? '作品'}
                      loading="lazy"
                      className="w-full aspect-square object-cover bg-rice-200"
                    />
                  ) : (
                    <div className="w-full aspect-square bg-rice-200 flex items-center justify-center">
                      <ImageOff className="w-6 h-6 text-ink-300" />
                    </div>
                  )}
                  <div className="p-2.5">
                    <p className="text-xs font-medium text-ink-800 truncate">
                      {w.title ?? '未命名作品'}
                    </p>
                    <p className="text-2xs text-ink-400 mt-0.5">
                      {WORK_TYPE_LABEL[w.workType] ?? w.workType} ·{' '}
                      {new Date(w.createdAt).toLocaleDateString()}
                    </p>
                    <div className="flex items-center justify-between mt-2">
                      <span
                        className={`text-sm font-semibold font-mono tabular-nums ${
                          w.overallScore == null
                            ? 'text-ink-300'
                            : w.overallScore >= 75
                              ? 'text-jade'
                              : w.overallScore >= 60
                                ? 'text-gold-dark'
                                : 'text-cinnabar'
                        }`}
                      >
                        {w.overallScore == null ? '未评分' : `${w.overallScore} 分`}
                      </span>
                      <span className="inline-flex items-center gap-1 text-2xs text-ink-400">
                        <ScrollText className="w-3 h-3" />
                        {w.reviews.length} 条评审
                        <ClipboardCheck className="w-3 h-3 ml-1 text-stone group-hover:text-cinnabar transition-colors" />
                      </span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>

            {/* 分页 */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-4 pt-3 border-t border-ink-900/5">
                <span className="text-xs text-ink-400">
                  第 {page} / {totalPages} 页
                </span>
                <div className="flex gap-2">
                  <button
                    disabled={page <= 1}
                    onClick={() => setPage((p) => p - 1)}
                    className="px-3 h-8 rounded-md border border-ink-900/15 text-xs disabled:opacity-40"
                  >
                    上一页
                  </button>
                  <button
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                    className="px-3 h-8 rounded-md border border-ink-900/15 text-xs disabled:opacity-40"
                  >
                    下一页
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </AdminSection>
    </div>
  );
}
