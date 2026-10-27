// ============================================================
// 丹青有AI - 租户切换器 + 角色标签
// ------------------------------------------------------------
// 设计目标:
//   1. 水墨风格下拉,显示当前租户名 + 角色标签
//   2. 展开后列出用户所有租户,每项标注角色(ADMIN/TEACHER/STUDENT)
//   3. 当前租户墨色高亮,点击其他租户触发 switchTenant
//   4. 切换中显示 loading,成功后关闭
//   5. 只有一个租户时返回 null(不渲染)
//
// 角色色板(对齐 tailwind.config.js):
//   - admin / owner: cinnabar(朱砂 #c41e3a)
//   - teacher:       stone(石青 #2e5fa1)
//   - student:       ink-500(墨灰 #595959)
// ============================================================

import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, Check, Building2, Loader2, UserPlus } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import type { UserRole } from '../../types/api-contract';

/* ============================================================
 * 角色元数据(供 TenantSwitcher 与 Header 复用)
 * ============================================================ */

export interface RoleMeta {
  /** 中文标签 */
  label: string;
  /** badge 背景色类(Tailwind) */
  badgeClass: string;
  /** 文本色类 */
  textClass: string;
  /** 圆点色类 */
  dotClass: string;
}

const ROLE_META: Record<UserRole, RoleMeta> = {
  admin: {
    label: '管理员',
    badgeClass: 'bg-cinnabar/10',
    textClass: 'text-cinnabar',
    dotClass: 'bg-cinnabar',
  },
  owner: {
    label: '所有者',
    badgeClass: 'bg-cinnabar/10',
    textClass: 'text-cinnabar',
    dotClass: 'bg-cinnabar',
  },
  teacher: {
    label: '教师',
    badgeClass: 'bg-stone/10',
    textClass: 'text-stone',
    dotClass: 'bg-stone',
  },
  student: {
    label: '学生',
    badgeClass: 'bg-ink-900/8',
    textClass: 'text-ink-500',
    dotClass: 'bg-ink-500',
  },
};

/** 获取角色元数据(未知角色降级为 student) */
// eslint-disable-next-line react-refresh/only-export-components -- 角色元数据查询与 RoleBadge 组件强耦合,同文件便于维护
export function getRoleMeta(role: UserRole): RoleMeta {
  return ROLE_META[role] ?? ROLE_META.student;
}

/* ============================================================
 * RoleBadge - 角色小标签(供 Header 用户区直接复用)
 * ============================================================ */

export interface RoleBadgeProps {
  role: UserRole;
  /** 尺寸:xs 极小(用户头像旁),sm 小(列表项) */
  size?: 'xs' | 'sm';
}

export function RoleBadge({ role, size = 'sm' }: RoleBadgeProps) {
  const meta = getRoleMeta(role);
  const sizeClass =
    size === 'xs' ? 'h-4 px-1.5 text-2xs' : 'h-5 px-2 text-xs';
  return (
    <span
      className={`inline-flex items-center gap-1 ${sizeClass} ${meta.badgeClass} ${meta.textClass} rounded font-medium whitespace-nowrap`}
    >
      <span className={`w-1 h-1 rounded-full ${meta.dotClass}`} />
      {meta.label}
    </span>
  );
}

/* ============================================================
 * TenantSwitcher - 租户切换下拉
 * ============================================================ */

export default function TenantSwitcher() {
  const { user, tenant, memberships, switchTenant } = useAuth();
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const switchingIdRef = useRef<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  /* 点击外部关闭(必须在条件 return 之前注册,遵守 Hooks 规则) */
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (containerRef.current && !containerRef.current.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  /* ESC 关闭 */
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);

  /* 只有一个租户(或未登录)时不渲染 */
  if (!tenant || memberships.length <= 1) {
    return null;
  }

  /* 当前激活租户的角色:优先从 memberships 取,降级用 user.role */
  const currentMembership = memberships.find((m) => m.tenantId === tenant.id);
  const currentRole: UserRole = currentMembership?.role ?? user?.role ?? 'student';

  const handleSwitch = async (tenantId: string) => {
    // 当前租户不重复切换;切换中拒绝重复点击
    if (tenantId === tenant.id || switching) return;
    switchingIdRef.current = tenantId;
    setSwitching(true);
    try {
      await switchTenant(tenantId);
      setOpen(false);
    } catch {
      // 错误已由 api.ts 拦截器统一 Toast,这里静默
    } finally {
      setSwitching(false);
      switchingIdRef.current = null;
    }
  };

  return (
    <div ref={containerRef} className="relative">
      {/* 触发器:租户名 + 角色标签 + 展开箭头 */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={switching}
        className={`flex items-center gap-1.5 h-8 pl-2 pr-1.5 rounded-md border transition-colors ${
          open
            ? 'bg-rice-100 border-ink-900/15'
            : 'bg-rice-100/60 border-ink-900/8 hover:bg-rice-100 hover:border-ink-900/15'
        } ${switching ? 'opacity-70 cursor-wait' : ''}`}
        title={`当前租户:${tenant.name}`}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Building2 className="w-3.5 h-3.5 text-ink-500 flex-shrink-0" />
        <span className="hidden lg:block text-xs font-medium text-ink-800 max-w-[120px] truncate">
          {tenant.name}
        </span>
        <RoleBadge role={currentRole} size="xs" />
        {switching ? (
          <Loader2 className="w-3 h-3 text-ink-400 animate-spin flex-shrink-0" />
        ) : (
          <ChevronDown
            className={`w-3 h-3 text-ink-400 transition-transform flex-shrink-0 ${open ? 'rotate-180' : ''}`}
          />
        )}
      </button>

      {/* 下拉面板:租户列表 */}
      {open && (
        <div className="absolute top-full right-0 mt-1 w-64 bg-rice-50 rounded-md shadow-overlay border border-ink-900/8 z-50 animate-slide-down overflow-hidden">
          {/* 头部说明 */}
          <div className="px-3 pt-2.5 pb-1.5 flex items-center justify-between">
            <p className="text-2xs font-semibold text-ink-400 uppercase tracking-wider">
              切换租户
            </p>
            <span className="text-2xs text-ink-300">
              {memberships.length} 个
            </span>
          </div>

          {/* 租户列表 */}
          <div className="p-1 max-h-64 overflow-y-auto scrollbar-thin" role="listbox">
            {memberships.map((m) => {
              const active = m.tenantId === tenant.id;
              const isSwitchingThis =
                switching && switchingIdRef.current === m.tenantId;
              return (
                <button
                  key={m.tenantId}
                  type="button"
                  onClick={() => void handleSwitch(m.tenantId)}
                  disabled={switching}
                  className={`w-full flex items-center gap-2.5 h-11 px-2 rounded-md text-left transition-colors ${
                    active
                      ? 'bg-ink-900/8 text-ink-900'
                      : 'text-ink-700 hover:bg-ink-900/5'
                  } ${switching && !isSwitchingThis ? 'opacity-50' : ''}`}
                  role="option"
                  aria-selected={active}
                >
                  <Building2
                    className={`w-4 h-4 flex-shrink-0 ${active ? 'text-ink-700' : 'text-ink-400'}`}
                  />
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm truncate ${active ? 'font-semibold text-ink-900' : 'font-medium'}`}>
                      {m.tenantName}
                    </p>
                    <p className="text-2xs text-ink-400 truncate">
                      {tenantTypeLabel(m.tenantType)}
                    </p>
                  </div>
                  {isSwitchingThis ? (
                    <Loader2 className="w-3.5 h-3.5 text-cinnabar animate-spin flex-shrink-0" />
                  ) : (
                    <RoleBadge role={m.role} size="xs" />
                  )}
                  {active && !isSwitchingThis && (
                    <Check className="w-3.5 h-3.5 text-ink-700 flex-shrink-0" />
                  )}
                </button>
              );
            })}
          </div>

          {/* 底部:加入班级入口 + 提示 */}
          <div className="px-3 py-1.5 border-t border-ink-900/8 bg-rice-100 flex items-center justify-between gap-2">
            <p className="text-2xs text-ink-400">
              切换租户后,当前页面数据将刷新
            </p>
            <Link
              to="/join-class"
              onClick={() => setOpen(false)}
              className="inline-flex items-center gap-1 text-2xs text-stone hover:text-stone-dark font-medium whitespace-nowrap"
            >
              <UserPlus className="w-3 h-3" />
              加入班级
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================================================
 * 工具:租户类型中文标签
 * ============================================================ */
function tenantTypeLabel(type: string): string {
  const map: Record<string, string> = {
    school: '学校',
    college: '学院',
    class: '班级',
    individual: '个人',
  };
  return map[type] ?? '组织';
}
