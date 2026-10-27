// ============================================================
// 丹青有AI - 权限不足提示 Toast
// ------------------------------------------------------------
// 设计目标:
//   1. 订阅 api.ts 的 setPermissionDeniedHandler,接收 403 消息
//   2. 水墨风格 toast,固定页面右下角(与右上角通用 Toast 区分)
//   3. 3 秒自动消失,支持手动关闭
//   4. 多条权限提示堆叠(最多 3 条,超出挤掉最早的)
//
// 与通用 ToastProvider 的区别:
//   - 通用 Toast:右上角,业务通用(成功/失败/警告)
//   - PermissionToast:右下角,专属权限不足(朱砂边框 + 锁图标)
//   - 用户仍登录,仅提示无权限,不跳转
// ============================================================

import { useEffect, useState } from 'react';
import { Lock, X } from 'lucide-react';
import { setPermissionDeniedHandler } from '../../services/api';

/* ============================================================
 * 类型与常量
 * ============================================================ */

interface PermissionToastItem {
  id: string;
  message: string;
}

/** 自动消失时长(ms) */
const AUTO_DISMISS_MS = 3000;
/** 最大堆叠条数(超出挤掉最早) */
const MAX_STACK = 3;

/* ============================================================
 * 组件
 * ============================================================ */

export default function PermissionToast() {
  const [toasts, setToasts] = useState<PermissionToastItem[]>([]);

  /* 订阅 api.ts 权限不足事件 */
  useEffect(() => {
    const handler = (message: string) => {
      const id = `perm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setToasts((prev) => {
        const next = [...prev, { id, message }];
        // 超出最大堆叠,丢弃最早的
        return next.length > MAX_STACK ? next.slice(next.length - MAX_STACK) : next;
      });
      // 3 秒后自动消失
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, AUTO_DISMISS_MS);
    };
    setPermissionDeniedHandler(handler);
    return () => {
      setPermissionDeniedHandler(null);
    };
  }, []);

  /* 手动关闭 */
  const dismiss = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-[70] flex flex-col gap-2 w-80 max-w-[calc(100vw-3rem)] pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto bg-rice-50 border border-cinnabar/30 rounded-md shadow-overlay animate-slide-up overflow-hidden"
          role="alert"
          aria-live="assertive"
        >
          <div className="flex items-start gap-3 p-3">
            {/* 锁图标:朱砂色,表示权限受限 */}
            <div className="w-5 h-5 flex-shrink-0 mt-0.5 flex items-center justify-center">
              <Lock className="w-4 h-4 text-cinnabar" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-ink-900">权限不足</p>
              <p className="text-xs text-ink-500 mt-0.5 break-words">{t.message}</p>
            </div>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              className="w-5 h-5 flex items-center justify-center text-ink-400 hover:text-ink-700 rounded transition-colors flex-shrink-0"
              aria-label="关闭提示"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          {/* 进度条(3 秒倒计时) */}
          <div className="h-0.5 bg-ink-900/5">
            <div
              className="h-full bg-cinnabar"
              style={{
                animation: `permissionToastProgress ${AUTO_DISMISS_MS}ms linear forwards`,
              }}
            />
          </div>
        </div>
      ))}
      {/* 进度条动画 keyframes(局部作用域,避免与 ToastProvider 冲突) */}
      <style>{`
        @keyframes permissionToastProgress {
          from { width: 100%; }
          to { width: 0%; }
        }
      `}</style>
    </div>
  );
}
