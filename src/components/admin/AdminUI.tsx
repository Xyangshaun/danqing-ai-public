// ============================================================
// 丹青有AI - 管理后台共享 UI 组件
// 水墨风(米纸 + 墨 + 朱砂点缀),与整站设计系统一致
// ============================================================

import { type ReactNode } from 'react';
import { RefreshCw, AlertTriangle } from 'lucide-react';

/* ---------- 区块容器 ---------- */
export function AdminSection({
  title,
  desc,
  action,
  children,
}: {
  title: string;
  desc?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="bg-rice-50 border border-ink-900/10 rounded-xl shadow-card p-5">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-base font-semibold text-ink-800 font-serif">{title}</h3>
          {desc && <p className="text-xs text-ink-400 mt-0.5">{desc}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/* ---------- KPI 卡片 ---------- */
export function KpiCard({
  label,
  value,
  sub,
  tone = 'default',
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'default' | 'good' | 'warn' | 'bad';
}) {
  const toneColor =
    tone === 'good'
      ? 'text-jade'
      : tone === 'warn'
        ? 'text-gold-dark'
        : tone === 'bad'
          ? 'text-cinnabar'
          : 'text-ink-800';
  return (
    <div className="bg-rice-50 border border-ink-900/10 rounded-xl shadow-card p-4 hover:shadow-card-hover transition-shadow">
      <div className="text-xs text-ink-400 mb-1.5">{label}</div>
      <div className={`text-2xl font-semibold font-mono tabular-nums ${toneColor}`}>{value}</div>
      {sub && <div className="text-xs text-ink-400 mt-1">{sub}</div>}
    </div>
  );
}

/* ---------- 状态点 ---------- */
export function StatusDot({ status }: { status: 'up' | 'down' | 'degraded' | 'disabled' }) {
  const map = {
    up: { color: 'bg-jade', text: '正常' },
    down: { color: 'bg-cinnabar', text: '异常' },
    degraded: { color: 'bg-gold', text: '降级' },
    disabled: { color: 'bg-ink-300', text: '未启用' },
  } as const;
  const s = map[status] ?? map.disabled;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink-600">
      <span className={`w-2 h-2 rounded-full ${s.color} ${status === 'up' ? 'animate-pulse-slow' : ''}`} />
      {s.text}
    </span>
  );
}

/* ---------- 百分比 ---------- */
export function formatPct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '--';
  return `${(v * 100).toFixed(digits)}%`;
}

/* ---------- 未开启/错误占位 ---------- */
export function DisabledPlaceholder({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center gap-2">
      <AlertTriangle className="w-5 h-5 text-gold-dark" />
      <p className="text-sm text-ink-500">{text}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-1 inline-flex items-center gap-1 text-xs text-stone hover:text-stone-dark"
        >
          <RefreshCw className="w-3 h-3" /> 重试
        </button>
      )}
    </div>
  );
}

/* ---------- 加载骨架 ---------- */
export function SectionSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-2 animate-pulse">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="h-4 bg-ink-900/5 rounded" style={{ width: `${90 - i * 15}%` }} />
      ))}
    </div>
  );
}

/* ---------- 简易迷你柱状图(纯 CSS,无第三方依赖) ---------- */
export function MiniBars({
  data,
  height = 56,
  barClass = 'bg-stone/70',
}: {
  data: number[];
  height?: number;
  barClass?: string;
}) {
  const max = Math.max(1, ...data);
  return (
    <div className="flex items-end gap-1" style={{ height }}>
      {data.map((v, i) => (
        <div
          key={i}
          className={`flex-1 rounded-sm ${barClass} transition-all`}
          style={{ height: `${Math.max(4, (v / max) * 100)}%` }}
          title={String(v)}
        />
      ))}
    </div>
  );
}
