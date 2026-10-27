// ============================================================
// 丹青有AI - 教师端 · 评分档案管理页(双阶段反馈框架 Phase 2 批次⑤)
// 数据: GET    /api/v1/grading-profiles          可见档案列表
//       POST   /api/v1/grading-profiles/:id/fork 克隆档案
//       PATCH  /api/v1/grading-profiles/:id       更新(启停)
//       POST   /api/v1/grading-profiles/:id/activate 设为默认
//       DELETE /api/v1/grading-profiles/:id      删除
// 功能: 系统预设卡(只读+克隆微调)/ 本校档案卡(编辑/启停/设默认/删除)、
//       克隆弹窗、删除确认弹窗、空状态引导
// 布局: 照 TeacherClassesPage 模式(AdminSection + 卡片网格)
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  SlidersHorizontal, Copy, RefreshCw, Loader2, Star,
  Power, Trash2, ChevronRight, Pencil,
} from 'lucide-react';
import {
  listGradingProfiles,
  forkGradingProfile,
  updateGradingProfile,
  deleteGradingProfile,
  activateGradingProfile,
} from '../../services/grading-profile-api';
import type { GradingProfileSummary } from '../../types/grading-profile';
import { GRADING_PROFILE_CATEGORY_LABELS } from '../../types/grading-profile';
import { useToast } from '../../components/ToastProvider';
import { AdminSection, SectionSkeleton } from '../../components/admin/AdminUI';

export default function TeacherGradingProfilesPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const [profiles, setProfiles] = useState<GradingProfileSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [forkTarget, setForkTarget] = useState<GradingProfileSummary | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<GradingProfileSummary | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listGradingProfiles();
      setProfiles(res);
    } catch {
      // 错误已由 api.ts 统一 Toast
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const builtIn = useMemo(() => profiles.filter((p) => p.isBuiltIn), [profiles]);
  const tenant = useMemo(() => profiles.filter((p) => !p.isBuiltIn), [profiles]);

  /* ---------- 卡片操作 ---------- */

  /** 启停切换(仅本校档案) */
  const handleToggleEnabled = async (p: GradingProfileSummary) => {
    setBusyId(p.id);
    try {
      await updateGradingProfile(p.id, { enabled: !p.enabled });
      toast.success(p.enabled ? '档案已停用' : '档案已启用');
      await load();
    } catch {
      // 统一 Toast
    } finally {
      setBusyId(null);
    }
  };

  /** 设为租户默认(同租户同类目唯一) */
  const handleActivate = async (p: GradingProfileSummary) => {
    setBusyId(p.id);
    try {
      await activateGradingProfile(p.id);
      toast.success('已设为默认档案', `${p.name} 将作为本校 ${GRADING_PROFILE_CATEGORY_LABELS[p.category]}类目的默认评分档案`);
      await load();
    } catch {
      // 统一 Toast
    } finally {
      setBusyId(null);
    }
  };

  /** 确认删除 */
  const handleDelete = async () => {
    if (!deleteTarget) return;
    setBusyId(deleteTarget.id);
    try {
      await deleteGradingProfile(deleteTarget.id);
      toast.success('档案已删除');
      setDeleteTarget(null);
      await load();
    } catch {
      // 统一 Toast
    } finally {
      setBusyId(null);
    }
  };

  const isLoading = loading && profiles.length === 0;

  return (
    <div className="max-w-5xl mx-auto px-4 md:px-6 py-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink-900 font-serif flex items-center gap-2">
            <SlidersHorizontal className="w-5 h-5 text-cinnabar" />
            评分档案
          </h1>
          <p className="text-xs text-ink-400 mt-1">
            本校评分标准:维度权重、档位线与反馈风格(系统预设可克隆微调)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 px-3 h-9 rounded-md border border-ink-900/15 bg-rice-50 text-sm text-ink-700 hover:bg-rice-100 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </button>
        </div>
      </div>

      {/* 本校档案 */}
      <AdminSection
        title="本校档案"
        desc="克隆或自建的评分档案,设为默认后对全班学生的 AI 反馈生效"
      >
        {isLoading ? (
          <SectionSkeleton lines={4} />
        ) : tenant.length === 0 ? (
          <div className="py-10 text-center">
            <SlidersHorizontal className="w-10 h-10 text-ink-200 mx-auto mb-3" />
            <p className="text-sm text-ink-500 mb-1">暂无本校档案</p>
            <p className="text-xs text-ink-400">从下方系统预设「克隆微调」,生成本校专属评分标准</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {tenant.map((p) => (
              <div
                key={p.id}
                className="bg-rice-50 border border-ink-900/10 rounded-xl shadow-card p-4 flex flex-col"
                data-testid={`tenant-profile-card-${p.id}`}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="w-9 h-9 rounded-lg bg-stone/10 flex items-center justify-center flex-shrink-0">
                    <SlidersHorizontal className="w-[18px] h-[18px] text-stone" />
                  </div>
                  <div className="flex items-center gap-1">
                    {p.isDefault && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-gold/10 text-gold-dark text-2xs">
                        <Star className="w-3 h-3" />
                        默认
                      </span>
                    )}
                    <span
                      className={`px-1.5 py-0.5 rounded text-2xs ${
                        p.enabled ? 'bg-jade/10 text-jade' : 'bg-ink-900/5 text-ink-400'
                      }`}
                    >
                      {p.enabled ? '启用' : '停用'}
                    </span>
                  </div>
                </div>
                <h3 className="text-sm font-semibold text-ink-900 font-serif truncate">{p.name}</h3>
                <p className="text-2xs text-ink-400 mt-1 line-clamp-2 min-h-[1.75rem]">
                  {p.description ?? '暂无描述'}
                </p>
                <div className="text-2xs text-ink-400 mt-2">
                  {GRADING_PROFILE_CATEGORY_LABELS[p.category]}类目
                </div>

                <div className="flex flex-wrap items-center gap-1.5 mt-3 pt-2.5 border-t border-ink-900/5">
                  <Link
                    to={`/teacher/grading-profiles/${p.id}`}
                    className="inline-flex items-center gap-1 px-2.5 h-7 rounded-md bg-cinnabar text-rice-50 text-2xs hover:bg-cinnabar-dark transition-colors"
                  >
                    <Pencil className="w-3 h-3" />
                    编辑
                  </Link>
                  {!p.isDefault && p.enabled && (
                    <button
                      onClick={() => void handleActivate(p)}
                      disabled={busyId === p.id}
                      className="inline-flex items-center gap-1 px-2.5 h-7 rounded-md border border-ink-900/15 text-ink-600 text-2xs hover:bg-rice-100 disabled:opacity-50 transition-colors"
                    >
                      <Star className="w-3 h-3" />
                      设为默认
                    </button>
                  )}
                  <button
                    onClick={() => void handleToggleEnabled(p)}
                    disabled={busyId === p.id}
                    className="inline-flex items-center gap-1 px-2.5 h-7 rounded-md border border-ink-900/15 text-ink-600 text-2xs hover:bg-rice-100 disabled:opacity-50 transition-colors"
                  >
                    <Power className="w-3 h-3" />
                    {p.enabled ? '停用' : '启用'}
                  </button>
                  <button
                    onClick={() => setDeleteTarget(p)}
                    disabled={busyId === p.id}
                    className="inline-flex items-center gap-1 px-2.5 h-7 rounded-md border border-cinnabar/30 text-cinnabar text-2xs hover:bg-cinnabar/5 disabled:opacity-50 transition-colors"
                  >
                    <Trash2 className="w-3 h-3" />
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </AdminSection>

      {/* 系统预设(只读+克隆) */}
      <AdminSection
        title="系统预设"
        desc="联考基准档案,只读;克隆后可在副本上微调权重与档位线"
      >
        {isLoading ? (
          <SectionSkeleton lines={4} />
        ) : builtIn.length === 0 ? (
          <p className="text-xs text-ink-400 py-6 text-center">暂无系统预设</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {builtIn.map((p) => (
              <div
                key={p.id}
                className="bg-white/60 border border-ink-900/10 rounded-xl p-4 flex flex-col"
                data-testid={`builtin-profile-card-${p.id}`}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="w-9 h-9 rounded-lg bg-gold/10 flex items-center justify-center flex-shrink-0">
                    <Star className="w-[18px] h-[18px] text-gold-dark" />
                  </div>
                  <span className="px-1.5 py-0.5 rounded bg-ink-900/5 text-ink-500 text-2xs">
                    内置
                  </span>
                </div>
                <h3 className="text-sm font-semibold text-ink-900 font-serif truncate">{p.name}</h3>
                <p className="text-2xs text-ink-400 mt-1 line-clamp-2 min-h-[1.75rem]">
                  {p.description ?? '暂无描述'}
                </p>
                <div className="text-2xs text-ink-400 mt-2">
                  {GRADING_PROFILE_CATEGORY_LABELS[p.category]}类目
                </div>
                <div className="flex items-center gap-1.5 mt-3 pt-2.5 border-t border-ink-900/5">
                  <button
                    onClick={() => setForkTarget(p)}
                    className="inline-flex items-center gap-1 px-2.5 h-7 rounded-md bg-cinnabar text-rice-50 text-2xs hover:bg-cinnabar-dark transition-colors"
                  >
                    <Copy className="w-3 h-3" />
                    克隆微调
                  </button>
                  <Link
                    to={`/teacher/grading-profiles/${p.id}`}
                    className="inline-flex items-center gap-1 px-2.5 h-7 rounded-md border border-ink-900/15 text-ink-600 text-2xs hover:bg-rice-100 transition-colors group"
                  >
                    查看
                    <ChevronRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </AdminSection>

      {/* 克隆弹窗 */}
      {forkTarget && (
        <ForkProfileModal
          source={forkTarget}
          onCancel={() => setForkTarget(null)}
          onForked={async (forked) => {
            setForkTarget(null);
            toast.success('档案已克隆', '可在副本上微调权重与档位线');
            navigate(`/teacher/grading-profiles/${forked.id}`);
          }}
        />
      )}

      {/* 删除确认弹窗 */}
      {deleteTarget && (
        <ConfirmDeleteModal
          profile={deleteTarget}
          submitting={busyId === deleteTarget.id}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => void handleDelete()}
        />
      )}
    </div>
  );
}

/* ============================================================
 * 克隆弹窗
 * ============================================================ */
function ForkProfileModal({
  source,
  onCancel,
  onForked,
}: {
  source: GradingProfileSummary;
  onCancel: () => void;
  onForked: (forked: GradingProfileSummary) => void | Promise<void>;
}) {
  const [name, setName] = useState(`${source.name} 副本`);
  const [description, setDescription] = useState(source.description ?? '');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      const forked = await forkGradingProfile(source.id, {
        name: trimmed,
        description: description.trim() || undefined,
      });
      await onForked(forked);
    } catch {
      // 统一 Toast
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
        <h3 className="text-base font-semibold text-ink-900 mb-1 font-serif">克隆档案</h3>
        <p className="text-xs text-ink-400 mb-4">
          将完整复制「{source.name}」的权重、档位线与反馈风格,克隆后可自由修改
        </p>

        <label className="block text-xs text-ink-500 mb-1.5">新档案名称 *</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={submitting}
          maxLength={64}
          placeholder="例如:联考素描 · 本校强化档"
          className="w-full h-9 px-3 rounded-md border border-ink-900/15 bg-white text-sm text-ink-800 focus:outline-none focus:ring-2 focus:ring-stone/30"
        />

        <label className="block text-xs text-ink-500 mt-3 mb-1.5">描述(可选)</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={submitting}
          rows={2}
          maxLength={500}
          placeholder="适用班级、评分取向等"
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
            data-testid="fork-submit"
            className="inline-flex items-center gap-1.5 px-4 h-9 rounded-md bg-cinnabar text-rice-50 text-sm hover:bg-cinnabar-dark disabled:opacity-50"
          >
            {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {submitting ? '克隆中…' : '克隆'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
 * 删除确认弹窗
 * ============================================================ */
function ConfirmDeleteModal({
  profile,
  submitting,
  onCancel,
  onConfirm,
}: {
  profile: GradingProfileSummary;
  submitting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/40 backdrop-blur-sm"
      onClick={() => !submitting && onCancel()}
    >
      <div
        className="bg-rice-50 rounded-xl shadow-modal p-6 w-full max-w-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-ink-900 mb-2 font-serif">删除档案</h3>
        <p className="text-sm text-ink-600 leading-relaxed">
          确定删除「{profile.name}」?
          {profile.isDefault && ' 该档案是当前默认档案,删除后本校同类目将回退系统预设。'}
          此操作不可撤销。
        </p>
        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={onCancel}
            disabled={submitting}
            className="px-4 h-9 rounded-md border border-ink-900/15 text-sm text-ink-700 disabled:opacity-50"
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            disabled={submitting}
            data-testid="delete-confirm"
            className="inline-flex items-center gap-1.5 px-4 h-9 rounded-md bg-cinnabar text-rice-50 text-sm hover:bg-cinnabar-dark disabled:opacity-50"
          >
            {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {submitting ? '删除中…' : '删除'}
          </button>
        </div>
      </div>
    </div>
  );
}
