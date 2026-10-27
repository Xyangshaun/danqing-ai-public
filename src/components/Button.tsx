import {
  forwardRef, type ButtonHTMLAttributes, type ReactNode,
} from 'react';

/* ============================================================
 * 统一按钮组件 Button
 *
 * 设计目标:
 *  - 替代散落各处的原生 <button>,统一视觉与交互
 *  - 支持 4 个 variant(primary/secondary/ghost/danger)与 3 个 size(sm/md/lg)
 *  - 支持 loading 态(显示 spinner + 文字保持显示 + 禁用点击)
 *  - 支持 leftIcon/rightIcon 图标插槽
 *  - 支持 fullWidth 占满父容器宽度
 *  - forwardRef 暴露 ref,便于业务方聚焦/测量
 *  - 严格 TypeScript:所有 props 显式声明,继承 ButtonHTMLAttributes
 *
 * 无障碍:
 *  - loading 时 aria-busy="true"
 *  - loading/disabled 时按钮 disabled,不可点击
 *  - 焦点环:focus:ring-2(品牌色 40% 透明度)
 *  - spinner 用 SVG + animate-spin(纯 Tailwind,不引入动画库)
 *
 * 设计规范对齐:
 *  - 按钮圆角 4px(rounded)
 *  - 8px 网格:h-8/h-10/h-12 + px-3/px-4/px-6
 *  - 品牌主色:primary 用 cinnabar(朱砂),danger 用 cinnabar(与品牌色一致,避免引入新红)
 *    注:cinnabar 本身就是红色系,与 danger 语义一致,故 danger 与 primary 颜色相同;
 *        为区分两者,danger 加 ring 边框增强警示感
 * ============================================================ */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** 视觉变体,默认 primary */
  variant?: ButtonVariant;
  /** 尺寸,默认 md */
  size?: ButtonSize;
  /** 加载态:显示 spinner + 禁用按钮 */
  loading?: boolean;
  /** 左侧图标(在文字之前) */
  leftIcon?: ReactNode;
  /** 右侧图标(在文字之后) */
  rightIcon?: ReactNode;
  /** 占满父容器宽度 */
  fullWidth?: boolean;
}

/* variant → Tailwind class 映射 */
const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-cinnabar text-white hover:bg-cinnabar-dark active:bg-cinnabar-dark',
  secondary:
    'bg-rice-50 text-ink-700 border border-ink-900/10 hover:bg-rice-100 active:bg-rice-200',
  ghost: 'bg-transparent text-ink-600 hover:bg-ink-900/5 active:bg-ink-900/8',
  /* danger:朱砂红背景(与 primary 同色,但加 ring 边框增强警示感) */
  danger:
    'bg-cinnabar text-white hover:bg-cinnabar-dark active:bg-cinnabar-dark ring-1 ring-inset ring-cinnabar-dark/30',
};

/* size → Tailwind class 映射(对齐 8px 网格) */
const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-sm gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-12 px-6 text-lg gap-2',
};

/* 通用基础类:布局 + 圆角 + 字重 + 过渡 + 焦点环 + 禁用态 */
const BASE_CLASSES = [
  'inline-flex items-center justify-center',
  'rounded font-medium',
  'transition-colors duration-150',
  'focus:outline-none focus:ring-2 focus:ring-cinnabar/40 focus:ring-offset-1 focus:ring-offset-rice-50',
  'disabled:cursor-not-allowed disabled:opacity-60',
  'select-none',
].join(' ');

/* loading 态 spinner:纯 SVG + Tailwind animate-spin */
function Spinner({ sizeClass }: { sizeClass: string }) {
  return (
    <svg
      className={`animate-spin ${sizeClass}`}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="3"
        className="opacity-25"
      />
      <path
        d="M22 12a10 10 0 0 1-10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        className="opacity-90"
      />
    </svg>
  );
}

/* 各 size 对应的 spinner 尺寸 */
const SPINNER_SIZE: Record<ButtonSize, string> = {
  sm: 'w-3.5 h-3.5',
  md: 'w-4 h-4',
  lg: 'w-5 h-5',
};

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    leftIcon,
    rightIcon,
    fullWidth = false,
    disabled,
    className = '',
    children,
    type = 'button',
    onClick,
    ...rest
  },
  ref,
) {
  /* loading 或 disabled 任一为 true 都禁用按钮 */
  const isDisabled = disabled || loading;
  /* spinner 尺寸随 size 变化 */
  const spinnerClass = SPINNER_SIZE[size];

  /* 点击拦截:loading 时不触发外部 onClick */
  const handleClick: React.MouseEventHandler<HTMLButtonElement> = (e) => {
    if (loading) return;
    onClick?.(e);
  };

  const composed = [
    BASE_CLASSES,
    VARIANT_CLASSES[variant],
    SIZE_CLASSES[size],
    fullWidth ? 'w-full' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      ref={ref}
      type={type}
      className={composed}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      onClick={handleClick}
      {...rest}
    >
      {/* loading 时左侧显示 spinner(替代 leftIcon,但保持文字位置一致) */}
      {loading ? <Spinner sizeClass={spinnerClass} /> : leftIcon}
      {/* 文字:即使 loading 也保持显示(用户能看到正在做什么) */}
      {children != null && children !== '' && (
        <span className="inline-flex items-center">{children}</span>
      )}
      {/* rightIcon:loading 时隐藏(避免与 spinner 视觉冲突) */}
      {!loading && rightIcon}
    </button>
  );
});

export default Button;
