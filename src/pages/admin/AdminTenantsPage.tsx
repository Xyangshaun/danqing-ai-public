// ============================================================
// 丹青有AI - 管理员 · 租户管理
// 对应文档: docs/superpowers/specs/2026-08-08-admin-dashboard-api-design.md §3
// 功能: 租户列表(搜索/筛选/分页)、单租户统计面板、编辑(名称/套餐/席位)、
//       创建租户、禁用/启用(二次确认)
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Search, RefreshCw, Building2, Plus, BarChart3, Pencil, Ban, CheckCircle2,
} from 'lucide-react';
import {
  listAdminTenants,
  getAdminTenantStats,
  createAdminTenant,
  updateAdminTenant,
} from '../../services/admin-api';
import type {
  AdminTenantListItem,
  AdminTenantStats,
  TenantType,
  TenantPlan,
  TenantStatus,
} from '../../types/admin';
import { useToast } from '../../components/ToastProvider';
import { AdminSection, SectionSkeleton, KpiCard, formatPct } from '../../components/admin/AdminUI';

const TYPE_LABEL: Record<string, string> = {
  school: '学校',
  college: '学院',
  class: '班级',
  individual: '个人',
};
const PLAN_LABEL: Record<string, string> = { free: '免费版', standard: '标准版', enterprise: '企业版' };
const STATUS_LABEL: Record<string, string> = { active: '正常', disabled: '已禁用' };

export default function AdminTenantsPage() {
  const toast = useToast();
  const [items, setItems] = useState<AdminTenantListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [type, setType] = useState('');
  const [plan, setPlan] = useState('');
  const [status, setStatus] = useState('');

  // 统计面板
  const [stats, setStats] = useState<AdminTenantStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  // 编辑 / 创建弹窗
  const [editing, setEditing] = useState<AdminTenantListItem | null>(null);
  const [creating, setCreating] = useState(false);

  // 状态切换确认弹窗(禁用/启用;契约仅需 CSRF,非高危密码操作)
  const [confirm, setConfirm] = useState<null | {
    title: string;
    run: () => Promise<void>;
  }>(null);
  const [acting, setActing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listAdminTenants({
        page,
        pageSize,
        search: search || undefined,
        type: (type || undefined) as TenantType | undefined,
        plan: (plan || undefined) as TenantPlan | undefined,
        status: (status || undefined) as TenantStatus | undefined,
      });
      setItems(res.items);
      setTotal(res.total);
    } catch {
      // 错误已由 api.ts 统一 Toast
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, search, type, plan, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [total, pageSize]);

  /* ---------- 统计 ---------- */
  const onShowStats = async (t: AdminTenantListItem) => {
    setStats(null);
    setStatsLoading(true);
    try {
      const data = await getAdminTenantStats(t.id);
      setStats(data);
    } catch {
      // 统一 Toast
    } finally {
      setStatsLoading(false);
    }
  };

  /* ---------- 禁用 / 启用 ---------- */
  const onToggleStatus = (t: AdminTenantListItem) => {
    const disable = t.status === 'active';
    setConfirm({
      title: disable
        ? `禁用租户「${t.name}」?禁用后该租户下所有用户将无法登录。`
        : `启用租户「${t.name}」?`,
      run: async () => {
        await updateAdminTenant(t.id, { status: disable ? 'disabled' : 'active' });
        toast.success(disable ? '已禁用' : '已启用', t.name);
      },
    });
  };

  const execConfirm = async () => {
    if (!confirm) return;
    setActing(true);
    try {
      await confirm.run();
      setConfirm(null);
      await load();
    } catch {
      // 统一 Toast
    } finally {
      setActing(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-6 space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-ink-900 font-serif flex items-center gap-2">
          <Building2 className="w-5 h-5 text-cinnabar" />
          租户管理
        </h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-1.5 px-3 h-9 rounded-md bg-cinnabar text-rice-50 text-sm hover:bg-cinnabar-dark transition-colors"
          >
            <Plus className="w-4 h-4" /> 创建租户
          </button>
          <button
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 px-3 h-9 rounded-md border border-ink-900/15 bg-rice-50 text-sm text-ink-700 hover:bg-rice-100"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> 刷新
          </button>
        </div>
      </div>

      {/* 筛选栏 */}
      <div className="bg-rice-50 border border-ink-900/10 rounded-xl shadow-card p-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-300" />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                setPage(1);
                setSearch(searchInput.trim());
              }
            }}
            placeholder="搜索租户名称,回车确认"
            className="w-full h-9 pl-9 pr-3 rounded-md border border-ink-900/15 bg-white text-sm text-ink-800 focus:outline-none focus:ring-2 focus:ring-stone/30"
          />
        </div>
        <select
          value={type}
          onChange={(e) => {
            setPage(1);
            setType(e.target.value);
          }}
          className="h-9 px-3 rounded-md border border-ink-900/15 bg-white text-sm text-ink-800"
        >
          <option value="">全部类型</option>
          <option value="school">学校</option>
          <option value="college">学院</option>
          <option value="class">班级</option>
          <option value="individual">个人</option>
        </select>
        <select
          value={plan}
          onChange={(e) => {
            setPage(1);
            setPlan(e.target.value);
          }}
          className="h-9 px-3 rounded-md border border-ink-900/15 bg-white text-sm text-ink-800"
        >
          <option value="">全部套餐</option>
          <option value="free">免费版</option>
          <option value="standard">标准版</option>
          <option value="enterprise">企业版</option>
        </select>
        <select
          value={status}
          onChange={(e) => {
            setPage(1);
            setStatus(e.target.value);
          }}
          className="h-9 px-3 rounded-md border border-ink-900/15 bg-white text-sm text-ink-800"
        >
          <option value="">全部状态</option>
          <option value="active">正常</option>
          <option value="disabled">已禁用</option>
        </select>
      </div>

      {/* 租户表格 */}
      <AdminSection title="租户列表" desc={`共 ${total} 个租户`}>
        {loading && items.length === 0 ? (
          <SectionSkeleton lines={6} />
        ) : items.length === 0 ? (
          <p className="text-sm text-ink-400 py-8 text-center">暂无租户</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-ink-400 border-b border-ink-900/10">
                  <th className="py-2 pr-3">名称</th>
                  <th className="py-2 pr-3">类型</th>
                  <th className="py-2 pr-3">套餐</th>
                  <th className="py-2 pr-3">成员</th>
                  <th className="py-2 pr-3">状态</th>
                  <th className="py-2 pr-3">创建时间</th>
                  <th className="py-2 pr-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {items.map((t) => (
                  <tr key={t.id} className="border-b border-ink-900/5 hover:bg-rice-100/60">
                    <td className="py-2.5 pr-3 text-ink-800 font-medium">{t.name}</td>
                    <td className="py-2.5 pr-3 text-xs text-ink-500">{TYPE_LABEL[t.type] ?? t.type}</td>
                    <td className="py-2.5 pr-3">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-full text-2xs ${
                          t.plan === 'enterprise'
                            ? 'bg-gold/15 text-gold-dark'
                            : t.plan === 'standard'
                              ? 'bg-stone/10 text-stone'
                              : 'bg-ink-900/5 text-ink-500'
                        }`}
                      >
                        {PLAN_LABEL[t.plan] ?? t.plan}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 text-xs text-ink-500 font-mono tabular-nums">
                      {t.memberCount} / {t.maxSeats}
                    </td>
                    <td className="py-2.5 pr-3">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-full text-2xs ${
                          t.status === 'disabled'
                            ? 'bg-cinnabar/10 text-cinnabar'
                            : 'bg-jade/10 text-jade'
                        }`}
                      >
                        {STATUS_LABEL[t.status] ?? t.status}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 text-xs text-ink-400">
                      {new Date(t.createdAt).toLocaleDateString()}
                    </td>
                    <td className="py-2.5 pr-3 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          onClick={() => void onShowStats(t)}
                          className="inline-flex items-center gap-1 px-2.5 h-7 rounded text-xs bg-stone/10 text-stone hover:bg-stone/20"
                        >
                          <BarChart3 className="w-3 h-3" /> 统计
                        </button>
                        <button
                          onClick={() => setEditing(t)}
                          className="inline-flex items-center gap-1 px-2.5 h-7 rounded text-xs bg-ink-900/5 text-ink-700 hover:bg-ink-900/10"
                        >
                          <Pencil className="w-3 h-3" /> 编辑
                        </button>
                        <button
                          onClick={() => onToggleStatus(t)}
                          className={`inline-flex items-center gap-1 px-2.5 h-7 rounded text-xs ${
                            t.status === 'disabled'
                              ? 'bg-jade/10 text-jade hover:bg-jade/20'
                              : 'bg-cinnabar/10 text-cinnabar hover:bg-cinnabar/20'
                          }`}
                        >
                          {t.status === 'disabled' ? (
                            <>
                              <CheckCircle2 className="w-3 h-3" /> 启用
                            </>
                          ) : (
                            <>
                              <Ban className="w-3 h-3" /> 禁用
                            </>
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

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
      </AdminSection>

      {/* 单租户统计面板 */}
      {(stats || statsLoading) && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/40 backdrop-blur-sm"
          onClick={() => !statsLoading && setStats(null)}
        >
          <div
            className="bg-rice-50 rounded-xl shadow-modal p-6 w-full max-w-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-ink-900 mb-4 font-serif">
              {stats?.tenantName ?? '加载中…'} · 用量统计
            </h3>
            {statsLoading ? (
              <SectionSkeleton lines={4} />
            ) : stats ? (
              <div className="grid grid-cols-2 gap-3">
                <KpiCard label="用户数" value={stats.userCount} sub={`席位 ${stats.usedSeats}/${stats.maxSeats}`} />
                <KpiCard label="作品数" value={stats.artworkCount} sub={`近7日 +${stats.last7dArtworks}`} />
                <KpiCard
                  label="本月 AI 调用"
                  value={stats.monthlyAiCalls}
                  sub={stats.monthlyQuota === -1 ? '配额不限' : `配额 ${stats.monthlyQuota}`}
                />
                <KpiCard
                  label="配额使用率"
                  value={stats.monthlyQuota === -1 ? '不限' : formatPct(stats.quotaUsageRate, 0)}
                  tone={
                    stats.monthlyQuota !== -1 && stats.quotaUsageRate > 0.9
                      ? 'bad'
                      : stats.monthlyQuota !== -1 && stats.quotaUsageRate > 0.7
                        ? 'warn'
                        : 'default'
                  }
                  sub={PLAN_LABEL[stats.plan]}
                />
                <KpiCard label="平均评分" value={stats.avgScore.toFixed(1)} sub="本租户作品均值" />
              </div>
            ) : null}
            <div className="flex justify-end mt-5">
              <button
                onClick={() => setStats(null)}
                disabled={statsLoading}
                className="px-4 h-9 rounded-md border border-ink-900/15 text-sm text-ink-700"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 编辑弹窗 */}
      {editing && (
        <TenantFormModal
          title={`编辑租户 · ${editing.name}`}
          initial={{
            name: editing.name,
            type: editing.type,
            plan: editing.plan,
            maxSeats: editing.maxSeats,
          }}
          hideType
          submittingText="保存中…"
          onCancel={() => setEditing(null)}
          onSubmit={async (v) => {
            await updateAdminTenant(editing.id, {
              name: v.name,
              plan: v.plan,
              maxSeats: v.maxSeats,
            });
            toast.success('已保存', editing.name);
            setEditing(null);
            await load();
          }}
        />
      )}

      {/* 创建弹窗 */}
      {creating && (
        <TenantFormModal
          title="创建租户"
          initial={{ name: '', type: 'school' as TenantType, plan: 'free' as TenantPlan, maxSeats: 50 }}
          submittingText="创建中…"
          onCancel={() => setCreating(false)}
          onSubmit={async (v) => {
            await createAdminTenant({
              name: v.name,
              type: v.type,
              plan: v.plan,
              maxSeats: v.maxSeats,
            });
            toast.success('已创建', v.name);
            setCreating(false);
            await load();
          }}
        />
      )}

      {/* 状态切换确认弹窗(禁用/启用) */}
      {confirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/40 backdrop-blur-sm"
          onClick={() => !acting && setConfirm(null)}
        >
          <div
            className="bg-rice-50 rounded-xl shadow-modal p-6 w-full max-w-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-ink-900 mb-2">操作确认</h3>
            <p className="text-sm text-ink-600 mb-5">{confirm.title}</p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirm(null)}
                disabled={acting}
                className="px-4 h-9 rounded-md border border-ink-900/15 text-sm text-ink-700"
              >
                取消
              </button>
              <button
                onClick={() => void execConfirm()}
                disabled={acting}
                className="px-4 h-9 rounded-md bg-cinnabar text-rice-50 text-sm hover:bg-cinnabar-dark disabled:opacity-50"
              >
                {acting ? '执行中…' : '确认'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================================================
 * 租户表单弹窗(创建 / 编辑共用)
 * ============================================================ */
function TenantFormModal({
  title,
  initial,
  hideType = false,
  submittingText,
  onCancel,
  onSubmit,
}: {
  title: string;
  initial: { name: string; type: TenantType; plan: TenantPlan; maxSeats: number };
  hideType?: boolean;
  submittingText: string;
  onCancel: () => void;
  onSubmit: (v: { name: string; type: TenantType; plan: TenantPlan; maxSeats: number }) => Promise<void>;
}) {
  const toast = useToast();
  const [name, setName] = useState(initial.name);
  const [type, setType] = useState<TenantType>(initial.type);
  const [plan, setPlan] = useState<TenantPlan>(initial.plan);
  const [maxSeats, setMaxSeats] = useState<number>(initial.maxSeats);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!name.trim()) {
      toast.warning('请填写租户名称');
      return;
    }
    if (!Number.isFinite(maxSeats) || maxSeats < 1) {
      toast.warning('席位上限必须为正整数');
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit({ name: name.trim(), type, plan, maxSeats: Math.floor(maxSeats) });
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
        className="bg-rice-50 rounded-xl shadow-modal p-6 w-full max-w-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-ink-900 mb-4 font-serif">{title}</h3>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-ink-500 mb-1">名称</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="租户名称"
              className="w-full h-9 px-3 rounded-md border border-ink-900/15 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-stone/30"
            />
          </div>
          {!hideType && (
            <div>
              <label className="block text-xs text-ink-500 mb-1">类型</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as TenantType)}
                className="w-full h-9 px-3 rounded-md border border-ink-900/15 bg-white text-sm"
              >
                <option value="school">学校</option>
                <option value="college">学院</option>
                <option value="class">班级</option>
                <option value="individual">个人</option>
              </select>
            </div>
          )}
          <div>
            <label className="block text-xs text-ink-500 mb-1">套餐</label>
            <select
              value={plan}
              onChange={(e) => setPlan(e.target.value as TenantPlan)}
              className="w-full h-9 px-3 rounded-md border border-ink-900/15 bg-white text-sm"
            >
              <option value="free">免费版</option>
              <option value="standard">标准版</option>
              <option value="enterprise">企业版</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-ink-500 mb-1">席位上限</label>
            <input
              type="number"
              min={1}
              value={maxSeats}
              onChange={(e) => setMaxSeats(Number(e.target.value))}
              className="w-full h-9 px-3 rounded-md border border-ink-900/15 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-stone/30"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={onCancel}
            disabled={submitting}
            className="px-4 h-9 rounded-md border border-ink-900/15 text-sm text-ink-700"
          >
            取消
          </button>
          <button
            onClick={() => void submit()}
            disabled={submitting}
            className="px-4 h-9 rounded-md bg-cinnabar text-rice-50 text-sm hover:bg-cinnabar-dark disabled:opacity-50"
          >
            {submitting ? submittingText : '确认'}
          </button>
        </div>
      </div>
    </div>
  );
}
