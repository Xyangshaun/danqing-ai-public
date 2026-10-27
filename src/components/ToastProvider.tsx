import {
  createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode,
} from 'react';
import {
  CheckCircle2, AlertCircle, Info, AlertTriangle, X, Loader2, type LucideIcon,
} from 'lucide-react';

/* ====== 类型 ====== */
export type ToastType = 'success' | 'error' | 'warning' | 'info';

/** 进度型 toast 的状态 */
export type ProgressStatus = 'running' | 'done' | 'error';

interface ProgressOptions {
  title: string;
  total: number;
  current: number;
  status?: ProgressStatus;
}

interface ProgressToastItem {
  id: string;
  kind: 'progress';
  title: string;
  total: number;
  current: number;
  status: ProgressStatus;
}

interface BasicToastItem {
  id: string;
  kind: 'basic';
  type: ToastType;
  title: string;
  desc?: string;
  duration: number;
}

type ToastItem = BasicToastItem | ProgressToastItem;

interface ToastContextValue {
  toast: (t: Omit<BasicToastItem, 'id' | 'duration' | 'kind'> & { duration?: number }) => void;
  success: (title: string, desc?: string) => void;
  error: (title: string, desc?: string) => void;
  warning: (title: string, desc?: string) => void;
  info: (title: string, desc?: string) => void;
  dismiss: (id: string) => void;
  /** 显示/更新进度型 toast:同 id 复用同一条 toast,不重复创建 */
  showProgress: (id: string, opts: ProgressOptions) => void;
  /** 主动关闭进度型 toast */
  dismissProgress: (id: string) => void;
}

/* ====== Context ====== */
const ToastContext = createContext<ToastContextValue | null>(null);

/* ====== 配置 ====== */
const typeConfig: Record<ToastType, { icon: LucideIcon; bg: string; iconColor: string; border: string }> = {
  success: { icon: CheckCircle2, bg: 'bg-rice-50', iconColor: 'text-jade', border: 'border-jade/30' },
  error: { icon: AlertCircle, bg: 'bg-rice-50', iconColor: 'text-cinnabar', border: 'border-cinnabar/30' },
  warning: { icon: AlertTriangle, bg: 'bg-rice-50', iconColor: 'text-gold-dark', border: 'border-gold/30' },
  info: { icon: Info, bg: 'bg-rice-50', iconColor: 'text-stone', border: 'border-stone/30' },
};

/* 进度 toast 状态 → 图标/颜色映射
 * running: 朱砂主色 + 旋转图标(表示进行中)
 * done:    玉色(成功)+ 对勾
 * error:   朱砂暗 + 警示图标
 * 进度条颜色:running=朱砂主色, done=玉色, error=朱砂红 */
const progressStatusConfig: Record<
  ProgressStatus,
  { icon: LucideIcon; iconColor: string; barColor: string; border: string }
> = {
  running: { icon: Loader2, iconColor: 'text-cinnabar', barColor: 'bg-cinnabar', border: 'border-cinnabar/30' },
  done: { icon: CheckCircle2, iconColor: 'text-jade', barColor: 'bg-jade', border: 'border-jade/30' },
  error: { icon: AlertCircle, iconColor: 'text-cinnabar', barColor: 'bg-cinnabar', border: 'border-cinnabar/30' },
};

/* ====== 各类型默认展示时长(ms) ======
 * success/info 短停留(轻提示);warning 中等;error 需充分阅读,最长 */
const defaultDurations: Record<ToastType, number> = {
  success: 2000,
  info: 2000,
  warning: 3000,
  error: 4000,
};

/* 进度型 toast 自动消失时长(ms):done 后 1.5s,error 后 3s */
const PROGRESS_DONE_DISMISS_MS = 1500;
const PROGRESS_ERROR_DISMISS_MS = 3000;

/* ====== Provider ====== */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  /* 用 ref 持有 setTimeout id,便于在更新/卸载时清理 */
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  /** 清理指定 id 的定时器 */
  const clearTimer = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const dismiss = useCallback((id: string) => {
    clearTimer(id);
    setToasts((list) => list.filter((t) => t.id !== id));
  }, [clearTimer]);

  const toast = useCallback(
    (t: Omit<BasicToastItem, 'id' | 'duration' | 'kind'> & { duration?: number }) => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const duration = t.duration ?? defaultDurations[t.type];
      const item: BasicToastItem = { ...t, id, duration, kind: 'basic' };
      setToasts((list) => [...list, item]);
      if (duration > 0) {
        const timer = setTimeout(() => dismiss(id), duration);
        timersRef.current.set(id, timer);
      }
    },
    [dismiss]
  );

  const success = useCallback((title: string, desc?: string) => toast({ type: 'success', title, desc }), [toast]);
  const error = useCallback((title: string, desc?: string) => toast({ type: 'error', title, desc }), [toast]);
  const warning = useCallback((title: string, desc?: string) => toast({ type: 'warning', title, desc }), [toast]);
  const info = useCallback((title: string, desc?: string) => toast({ type: 'info', title, desc }), [toast]);

  const dismissProgress = useCallback((id: string) => {
    dismiss(id);
  }, [dismiss]);

  /**
   * 显示或更新进度型 toast:
   *  - 同 id 已存在 → 替换为最新进度数据(并清理旧的自动消失定时器,除非状态本身需要消失)
   *  - 同 id 不存在 → 新建一条
   *  - status='done'    → 进度条满 + 1.5s 后自动消失
   *  - status='error'   → 进度条变红 + 3s 后自动消失
   *  - status='running' → 不自动消失,等待后续更新
   */
  const showProgress = useCallback((id: string, opts: ProgressOptions) => {
    const status: ProgressStatus = opts.status ?? 'running';
    /* 限制 current 在 [0, total] 范围内,避免负数或超 100% */
    const safeTotal = Math.max(1, opts.total);
    const safeCurrent = Math.min(Math.max(0, opts.current), safeTotal);

    /* 清理旧定时器(后续根据新状态决定是否再设新定时器) */
    clearTimer(id);

    setToasts((list) => {
      const existing = list.find((t) => t.id === id);
      const nextItem: ProgressToastItem = {
        id,
        kind: 'progress',
        title: opts.title,
        total: safeTotal,
        current: safeCurrent,
        status,
      };
      if (!existing) {
        return [...list, nextItem];
      }
      return list.map((t) => (t.id === id ? nextItem : t));
    });

    /* 状态对应的自动消失 */
    if (status === 'done') {
      const timer = setTimeout(() => dismiss(id), PROGRESS_DONE_DISMISS_MS);
      timersRef.current.set(id, timer);
    } else if (status === 'error') {
      const timer = setTimeout(() => dismiss(id), PROGRESS_ERROR_DISMISS_MS);
      timersRef.current.set(id, timer);
    }
  }, [clearTimer, dismiss]);

  /* 组件卸载时清理所有定时器,避免内存泄漏 */
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
    };
  }, []);

  return (
    <ToastContext.Provider
      value={{ toast, success, error, warning, info, dismiss, showProgress, dismissProgress }}
    >
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

/* ====== Hook ====== */
// eslint-disable-next-line react-refresh/only-export-components -- useToast 与 Provider/Context 同文件是 React 官方推荐组织方式
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

/* ====== 视图层(右上角堆叠,符合生态软件习惯) ====== */
function ToastViewport({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: string) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed top-16 right-4 z-[60] flex flex-col gap-2 w-80 max-w-[calc(100vw-2rem)] pointer-events-none">
      {toasts.map((t) =>
        t.kind === 'progress' ? (
          <ProgressToastCard key={t.id} item={t} onDismiss={onDismiss} />
        ) : (
          <BasicToastCard key={t.id} item={t} onDismiss={onDismiss} />
        )
      )}
      <style>{`
        @keyframes toastProgress {
          from { width: 100%; }
          to { width: 0%; }
        }
      `}</style>
    </div>
  );
}

/* 普通类型 toast 卡片 */
function BasicToastCard({ item, onDismiss }: { item: BasicToastItem; onDismiss: (id: string) => void }) {
  const cfg = typeConfig[item.type];
  const Icon = cfg.icon;
  return (
    <div
      className={`pointer-events-auto ${cfg.bg} ${cfg.border} border rounded-md shadow-overlay animate-slide-down overflow-hidden`}
      role={item.type === 'error' ? 'alert' : 'status'}
      aria-live={item.type === 'error' ? 'assertive' : 'polite'}
    >
      <div className="flex items-start gap-3 p-3">
        <div className="w-5 h-5 flex-shrink-0 mt-0.5">
          <Icon className={`w-5 h-5 ${cfg.iconColor}`} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-ink-900">{item.title}</p>
          {item.desc && <p className="text-xs text-ink-500 mt-0.5 break-words">{item.desc}</p>}
        </div>
        <button
          type="button"
          onClick={() => onDismiss(item.id)}
          aria-label="关闭通知"
          className="w-5 h-5 flex items-center justify-center text-ink-400 hover:text-ink-700 rounded transition-colors flex-shrink-0 focus:outline-none focus:ring-2 focus:ring-cinnabar/40"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      {/* 倒计时进度条(自动消失的视觉提示) */}
      {item.duration > 0 && (
        <div className="h-0.5 bg-ink-900/5" aria-hidden="true">
          <div
            className={`h-full ${cfg.iconColor.replace('text-', 'bg-')}`}
            style={{ animation: `toastProgress ${item.duration}ms linear forwards` }}
          />
        </div>
      )}
    </div>
  );
}

/* 进度型 toast 卡片 */
function ProgressToastCard({ item, onDismiss }: { item: ProgressToastItem; onDismiss: (id: string) => void }) {
  const cfg = progressStatusConfig[item.status];
  const Icon = cfg.icon;
  /* 百分比:0-100,done 状态强制 100(防止 current 未传到 total) */
  const percent = item.status === 'done' ? 100 : Math.round((item.current / item.total) * 100);
  /* running 时图标旋转 */
  const iconClass = `w-5 h-5 ${cfg.iconColor}${item.status === 'running' ? ' animate-spin' : ''}`;

  return (
    <div
      className={`pointer-events-auto bg-rice-50 ${cfg.border} border rounded-md shadow-overlay animate-slide-down overflow-hidden`}
      role="status"
      aria-live="polite"
      aria-busy={item.status === 'running'}
    >
      <div className="flex items-start gap-3 p-3">
        <div className="w-5 h-5 flex-shrink-0 mt-0.5">
          <Icon className={iconClass} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-ink-900">{item.title}</p>
          <p className="text-xs text-ink-500 mt-0.5 font-mono">
            {item.current} / {item.total} · {percent}%
          </p>
          {/* 进度条本体:width 用 transition 平滑过渡(300ms ease-out) */}
          <div
            className="mt-2 h-1.5 bg-ink-900/8 rounded-full overflow-hidden"
            role="progressbar"
            aria-valuenow={item.current}
            aria-valuemin={0}
            aria-valuemax={item.total}
            aria-label={`${item.title} 进度`}
          >
            <div
              className={`h-full ${cfg.barColor} rounded-full transition-[width] duration-300 ease-out`}
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
        <button
          type="button"
          onClick={() => onDismiss(item.id)}
          aria-label="关闭进度提示"
          className="w-5 h-5 flex items-center justify-center text-ink-400 hover:text-ink-700 rounded transition-colors flex-shrink-0 focus:outline-none focus:ring-2 focus:ring-cinnabar/40"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
