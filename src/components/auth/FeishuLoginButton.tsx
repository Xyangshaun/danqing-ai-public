// ============================================================
// 丹青有AI - 飞书登录按钮
// 设计语言:参考 LogoMark.tsx(朱印·凝眸),朱砂红 CTA + 飞书品牌蓝 Logo
// ============================================================

import { useState, useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import { getFeishuAuthorizeUrl } from '../../services/auth-sdk';
import { ApiError } from '../../services/api';
import { useToast } from '../ToastProvider';

export interface FeishuLoginButtonProps {
  /** 按钮尺寸 */
  size?: 'md' | 'lg';
  /** 自定义类名 */
  className?: string;
  /** 是否全宽 */
  block?: boolean;
  /** 点击后跳转前回调 */
  onClick?: () => void;
}

/** 飞书 Logo(inline SVG,品牌蓝 #3370FF) */
function FeishuLogo({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {/* 飞书品牌蓝圆角方块底 */}
      <rect x="2" y="2" width="28" height="28" rx="6" fill="#3370FF" />
      {/* 简化飞书标识:白色抽象"飞"字笔画 */}
      <path
        d="M 9 10 L 16 10 L 16 14 L 13 14 L 13 22 L 9 22 Z"
        fill="#FFFFFF"
      />
      <path
        d="M 19 10 L 23 10 L 23 22 L 19 22 Z"
        fill="#FFFFFF"
        opacity="0.9"
      />
      {/* 翅膀笔画 */}
      <path
        d="M 13 16 L 23 16"
        stroke="#FFFFFF"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function FeishuLoginButton({
  size = 'md',
  className = '',
  block = false,
  onClick,
}: FeishuLoginButtonProps) {
  const [loading, setLoading] = useState(false);
  const toast = useToast();

  const handleClick = useCallback(async () => {
    if (loading) return;
    onClick?.();
    setLoading(true);
    try {
      const result = await getFeishuAuthorizeUrl('web');
      // 整页跳转到飞书授权页
      // 用 replace 避免后退回登录页污染历史栈(auth-design.md §1.2 步骤 4)
      window.location.replace(result.authorizeUrl);
    } catch (err) {
      setLoading(false);
      if (err instanceof ApiError) {
        // 已知业务错误
        if (err.code === 4004) {
          toast.error('飞书应用未配置', '请联系管理员检查飞书应用配置');
        } else if (err.code === 9005) {
          toast.error('请求过于频繁', '请稍后再试');
        } else {
          toast.error('获取授权链接失败', err.message);
        }
      } else {
        // 未知错误(网络错误等,api.ts 已统一 Toast)
        toast.error('登录失败', '请检查网络后重试');
      }
    }
  }, [loading, onClick, toast]);

  const sizeClass =
    size === 'lg' ? 'h-12 px-6 text-base' : 'h-10 px-4 text-sm';
  const widthClass = block ? 'w-full' : '';

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      title="使用飞书账号登录丹青有AI"
      className={[
        'inline-flex items-center justify-center gap-2.5 rounded font-medium',
        'bg-cinnabar text-white shadow-card',
        'hover:bg-cinnabar-dark hover:shadow-card-hover',
        'active:scale-[0.98]',
        'disabled:opacity-70 disabled:cursor-not-allowed disabled:active:scale-100',
        'transition-all duration-200 ease-out',
        'focus:outline-none focus:ring-2 focus:ring-cinnabar/40 focus:ring-offset-2 focus:ring-offset-rice-50',
        sizeClass,
        widthClass,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {loading ? (
        <>
          <Loader2 className="w-4 h-4 animate-spin" />
          {/* 桌面端显示文字,移动端只显示 spinner */}
          <span className="hidden sm:inline">正在跳转飞书...</span>
          <span className="sr-only">正在跳转飞书授权页</span>
        </>
      ) : (
        <>
          <FeishuLogo className="w-5 h-5 flex-shrink-0" />
          {/* 桌面端显示完整文案,移动端只显示 Logo */}
          <span className="hidden sm:inline">飞书登录</span>
          <span className="sr-only">使用飞书账号登录</span>
        </>
      )}
    </button>
  );
}
