// ============================================================
// 丹青有AI - 教师端 · 班级管理主页
// 数据: GET  /api/v1/classes        我的班级列表
//       POST /api/v1/classes        创建班级
// 功能: 班级卡片列表、创建班级弹窗、空状态引导、跳转班级详情
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { School, Plus, RefreshCw, Users, ChevronRight, Loader2 } from 'lucide-react';
import { createClass, listMyClasses } from '../../services/class-api';
import type { ClassInfo } from '../../services/class-api';
import { useToast } from '../../components/ToastProvider';
import { AdminSection, SectionSkeleton } from '../../components/admin/AdminUI';

export default function TeacherClassesPage() {
  const toast = useToast();
  const [classes, setClasses] = useState<ClassInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listMyClasses();
      setClasses(res);
    } catch {
      // 错误已由 api.ts 统一 Toast
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="max-w-5xl mx-auto px-4 md:px-6 py-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink-900 font-serif flex items-center gap-2">
            <School className="w-5 h-5 text-cinnabar" />
            班级管理
          </h1>
          <p className="text-xs text-ink-400 mt-1">共 {classes.length} 个班级</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 px-3 h-9 rounded-md border border-ink-900/15 bg-rice-50 text-sm text-ink-700 hover:bg-rice-100 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </button>
          <button
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 h-9 rounded-md bg-cinnabar text-rice-50 text-sm hover:bg-cinnabar-dark transition-colors"
          >
            <Plus className="w-4 h-4" />
            创建班级
          </button>
        </div>
      </div>

      {/* 班级列表 */}
      <AdminSection title="我的班级" desc="点击班级卡片进入学生与邀请码管理">
        {loading && classes.length === 0 ? (
          <SectionSkeleton lines={4} />
        ) : classes.length === 0 ? (
          <div className="py-12 text-center">
            <School className="w-10 h-10 text-ink-200 mx-auto mb-3" />
            <p className="text-sm text-ink-500 mb-1">暂无班级</p>
            <p className="text-xs text-ink-400 mb-4">点击创建第一个班级,通过邀请码邀请学生加入</p>
            <button
              onClick={() => setCreateOpen(true)}
              className="inline-flex items-center gap-1.5 px-4 h-9 rounded-md bg-cinnabar text-rice-50 text-sm hover:bg-cinnabar-dark transition-colors"
            >
              <Plus className="w-4 h-4" />
              创建班级
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {classes.map((c) => (
              <Link
                key={c.id}
                to={`/teacher/classes/${c.id}`}
                className="group bg-rice-50 border border-ink-900/10 rounded-xl shadow-card p-4 hover:shadow-card-hover transition-shadow"
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="w-9 h-9 rounded-lg bg-stone/10 flex items-center justify-center flex-shrink-0">
                    <School className="w-[18px] h-[18px] text-stone" />
                  </div>
                  <ChevronRight className="w-4 h-4 text-ink-300 group-hover:text-cinnabar group-hover:translate-x-0.5 transition-all" />
                </div>
                <h3 className="text-sm font-semibold text-ink-900 font-serif truncate">{c.name}</h3>
                <p className="text-2xs text-ink-400 mt-1 line-clamp-2 min-h-[1.75rem]">
                  {c.description ?? '暂无描述'}
                </p>
                <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-ink-900/5">
                  <span className="inline-flex items-center gap-1 text-2xs text-ink-500">
                    <Users className="w-3 h-3" />
                    {c.memberCount} 名成员
                  </span>
                  <span className="text-2xs text-ink-300">
                    创建于 {new Date(c.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </AdminSection>

      {/* 创建班级弹窗 */}
      {createOpen && (
        <CreateClassModal
          onCancel={() => setCreateOpen(false)}
          onCreated={async () => {
            setCreateOpen(false);
            toast.success('班级已创建');
            await load();
          }}
        />
      )}
    </div>
  );
}

/* ============================================================
 * 创建班级弹窗
 * ============================================================ */
function CreateClassModal({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: () => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      await createClass({
        name: trimmed,
        description: description.trim() || undefined,
      });
      await onCreated();
    } catch {
      // 错误已由 api.ts 统一 Toast
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/40 backdrop-blur-sm"
      onClick={() => !submitting && onCancel()}
    >
      <div
        className="bg-rice-50 rounded-xl shadow-modal p-6 w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-ink-900 mb-4 font-serif">创建班级</h3>

        <label className="block text-xs text-ink-500 mb-1.5">班级名称 *</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={submitting}
          maxLength={50}
          placeholder="例如:油画 2026 春季班"
          className="w-full h-9 px-3 rounded-md border border-ink-900/15 bg-white text-sm text-ink-800 focus:outline-none focus:ring-2 focus:ring-stone/30"
        />

        <label className="block text-xs text-ink-500 mt-3 mb-1.5">班级描述(可选)</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={submitting}
          rows={3}
          maxLength={200}
          placeholder="班级教学目标、课程安排等"
          className="w-full px-3 py-2 rounded-md border border-ink-900/15 bg-white text-sm text-ink-800 resize-none focus:outline-none focus:ring-2 focus:ring-stone/30"
        />

        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={onCancel}
            disabled={submitting}
            className="px-4 h-9 rounded-md border border-ink-900/15 text-sm text-ink-700 disabled:opacity-50"
          >
            取消
          </button>
          <button
            onClick={() => void handleSubmit()}
            disabled={submitting || !name.trim()}
            className="inline-flex items-center gap-1.5 px-4 h-9 rounded-md bg-cinnabar text-rice-50 text-sm hover:bg-cinnabar-dark disabled:opacity-50"
          >
            {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {submitting ? '创建中…' : '创建'}
          </button>
        </div>
      </div>
    </div>
  );
}
