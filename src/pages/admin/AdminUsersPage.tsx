// ============================================================
// 丹青有AI - 管理员 · 用户管理
// 对应文档: docs/superpowers/specs/2026-08-08-admin-dashboard-api-design.md §2
// 功能: 用户列表(搜索/筛选/分页)、改角色、锁定/解锁(高危)、批量操作
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, RefreshCw, Lock, Unlock, Users as UsersIcon } from 'lucide-react';
import {
  listAdminUsers,
  updateAdminUser,
  lockAdminUser,
  batchAdminUsers,
} from '../../services/admin-api';
import type { AdminUserListItem } from '../../types/admin';
import { useToast } from '../../components/ToastProvider';
import { AdminSection, SectionSkeleton } from '../../components/admin/AdminUI';

const ROLE_LABEL: Record<string, string> = {
  student: '学生',
  teacher: '教师',
  admin: '管理员',
  owner: '负责人',
};
const STATUS_LABEL: Record<string, string> = { active: '正常', locked: '已锁定', deleted: '已删除' };

function newIdemKey(): string {
  return `admin-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export default function AdminUsersPage() {
  const toast = useToast();
  const [items, setItems] = useState<AdminUserListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // 高危确认弹窗
  const [confirm, setConfirm] = useState<null | {
    title: string;
    needPassword: boolean;
    run: (pwd: string) => Promise<void>;
  }>(null);
  const [pwd, setPwd] = useState('');
  const [acting, setActing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listAdminUsers({
        page,
        pageSize,
        search: search || undefined,
        role: (role || undefined) as never,
        status: (status || undefined) as never,
      });
      setItems(res.items);
      setTotal(res.total);
    } catch {
      // 错误已由 api.ts 统一 Toast
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, search, role, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [total, pageSize]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleAll = () => {
    setSelected((prev) => (prev.size === items.length ? new Set() : new Set(items.map((i) => i.id))));
  };

  const openConfirm = (title: string, needPassword: boolean, run: (pwd: string) => Promise<void>) => {
    setPwd('');
    setConfirm({ title, needPassword, run });
  };

  const execConfirm = async () => {
    if (!confirm) return;
    if (confirm.needPassword && !pwd) {
      toast.warning('请输入密码', '高危操作需输入管理员密码确认');
      return;
    }
    setActing(true);
    try {
      await confirm.run(pwd);
      setConfirm(null);
      setSelected(new Set());
      await load();
    } catch {
      // 统一 Toast
    } finally {
      setActing(false);
    }
  };

  /* ---------- 操作 ---------- */
  const onChangeRole = (u: AdminUserListItem, newRole: string) => {
    openConfirm(`将「${u.name}」角色改为 ${ROLE_LABEL[newRole]}?`, false, async () => {
      await updateAdminUser(u.id, { role: newRole as never });
      toast.success('已更新', `${u.name} 角色已改为 ${ROLE_LABEL[newRole]}`);
    });
  };

  const onToggleLock = (u: AdminUserListItem) => {
    const lock = u.status !== 'locked';
    openConfirm(lock ? `锁定用户「${u.name}」?` : `解锁用户「${u.name}」?`, true, async (password) => {
      await lockAdminUser(u.id, { locked: lock, confirmPassword: password }, newIdemKey());
      toast.success(lock ? '已锁定' : '已解锁', u.name);
    });
  };

  const onBatchRole = (newRole: string) => {
    if (selected.size === 0) return;
    openConfirm(`将选中的 ${selected.size} 个用户角色改为 ${ROLE_LABEL[newRole]}?`, false, async () => {
      const res = await batchAdminUsers(
        { userIds: [...selected], action: 'updateRole', role: newRole as never },
        newIdemKey(),
      );
      toast.success('批量完成', `成功 ${res.succeeded} / 失败 ${res.failed}`);
    });
  };

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-6 space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-ink-900 font-serif flex items-center gap-2">
          <UsersIcon className="w-5 h-5 text-cinnabar" />
          用户管理
        </h1>
        <button
          onClick={() => void load()}
          className="inline-flex items-center gap-1.5 px-3 h-9 rounded-md border border-ink-900/15 bg-rice-50 text-sm text-ink-700 hover:bg-rice-100"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> 刷新
        </button>
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
            placeholder="搜索姓名 / 邮箱,回车确认"
            className="w-full h-9 pl-9 pr-3 rounded-md border border-ink-900/15 bg-white text-sm text-ink-800 focus:outline-none focus:ring-2 focus:ring-stone/30"
          />
        </div>
        <select
          value={role}
          onChange={(e) => {
            setPage(1);
            setRole(e.target.value);
          }}
          className="h-9 px-3 rounded-md border border-ink-900/15 bg-white text-sm text-ink-800"
        >
          <option value="">全部角色</option>
          <option value="student">学生</option>
          <option value="teacher">教师</option>
          <option value="admin">管理员</option>
          <option value="owner">负责人</option>
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
          <option value="locked">已锁定</option>
        </select>
        {selected.size > 0 && (
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-xs text-ink-500">已选 {selected.size}</span>
            <button
              onClick={() => onBatchRole('teacher')}
              className="px-2.5 h-8 rounded-md bg-stone text-rice-50 text-xs hover:bg-stone-dark"
            >
              设为教师
            </button>
            <button
              onClick={() => onBatchRole('student')}
              className="px-2.5 h-8 rounded-md bg-ink-700 text-rice-50 text-xs hover:bg-ink-600"
            >
              设为学生
            </button>
          </div>
        )}
      </div>

      {/* 用户表格 */}
      <AdminSection title={`用户列表`} desc={`共 ${total} 个用户`}>
        {loading && items.length === 0 ? (
          <SectionSkeleton lines={6} />
        ) : items.length === 0 ? (
          <p className="text-sm text-ink-400 py-8 text-center">暂无用户</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-ink-400 border-b border-ink-900/10">
                  <th className="py-2 pr-2 w-8">
                    <input type="checkbox" checked={selected.size === items.length && items.length > 0} onChange={toggleAll} />
                  </th>
                  <th className="py-2 pr-3">用户</th>
                  <th className="py-2 pr-3">联系方式</th>
                  <th className="py-2 pr-3">角色</th>
                  <th className="py-2 pr-3">状态</th>
                  <th className="py-2 pr-3">最近登录</th>
                  <th className="py-2 pr-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {items.map((u) => (
                  <tr key={u.id} className="border-b border-ink-900/5 hover:bg-rice-100/60">
                    <td className="py-2.5 pr-2">
                      <input type="checkbox" checked={selected.has(u.id)} onChange={() => toggleSelect(u.id)} />
                    </td>
                    <td className="py-2.5 pr-3">
                      <div className="flex items-center gap-2.5">
                        {u.avatar ? (
                          <img src={u.avatar} alt="" className="w-8 h-8 rounded-full object-cover" />
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-stone/20 flex items-center justify-center text-stone text-xs">
                            {u.name.slice(0, 1)}
                          </div>
                        )}
                        <span className="text-ink-800 font-medium">{u.name}</span>
                      </div>
                    </td>
                    <td className="py-2.5 pr-3 text-ink-500 text-xs">
                      <div>{u.email ?? '—'}</div>
                      <div>{u.phone ?? ''}</div>
                    </td>
                    <td className="py-2.5 pr-3">
                      <select
                        value={u.role}
                        onChange={(e) => onChangeRole(u, e.target.value)}
                        className="h-7 px-2 rounded border border-ink-900/15 bg-white text-xs text-ink-800"
                      >
                        <option value="student">学生</option>
                        <option value="teacher">教师</option>
                        <option value="admin">管理员</option>
                        <option value="owner">负责人</option>
                      </select>
                    </td>
                    <td className="py-2.5 pr-3">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-full text-2xs ${
                          u.status === 'locked'
                            ? 'bg-cinnabar/10 text-cinnabar'
                            : 'bg-jade/10 text-jade'
                        }`}
                      >
                        {STATUS_LABEL[u.status] ?? u.status}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 text-xs text-ink-400">
                      {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString() : '—'}
                    </td>
                    <td className="py-2.5 pr-3 text-right">
                      <button
                        onClick={() => onToggleLock(u)}
                        className={`inline-flex items-center gap-1 px-2.5 h-7 rounded text-xs ${
                          u.status === 'locked'
                            ? 'bg-jade/10 text-jade hover:bg-jade/20'
                            : 'bg-cinnabar/10 text-cinnabar hover:bg-cinnabar/20'
                        }`}
                      >
                        {u.status === 'locked' ? (
                          <>
                            <Unlock className="w-3 h-3" /> 解锁
                          </>
                        ) : (
                          <>
                            <Lock className="w-3 h-3" /> 锁定
                          </>
                        )}
                      </button>
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

      {/* 高危确认弹窗 */}
      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/40 backdrop-blur-sm" onClick={() => !acting && setConfirm(null)}>
          <div className="bg-rice-50 rounded-xl shadow-modal p-6 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-ink-900 mb-2">操作确认</h3>
            <p className="text-sm text-ink-600 mb-4">{confirm.title}</p>
            {confirm.needPassword && (
              <input
                type="password"
                value={pwd}
                onChange={(e) => setPwd(e.target.value)}
                placeholder="输入管理员密码确认"
                className="w-full h-9 px-3 rounded-md border border-ink-900/15 bg-white text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-cinnabar/30"
              />
            )}
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
