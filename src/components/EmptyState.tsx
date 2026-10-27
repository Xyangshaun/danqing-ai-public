import { memo, type ReactNode } from 'react';
import { FileSearch, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';

/**
 * 通用空状态组件 —— 水墨风格简约设计
 *
 * 设计规范:
 * - 主标题 text-base font-medium text-ink-700
 * - 描述文案 text-sm text-ink-400
 * - 次要说明 secondaryHint: text-xs text-ink-400/80 (灰色小字,在副标题下方)
 * - 行动召唤按钮:朱砂红色调,hover 加深(cinnabar → cinnabar-dark)
 *   · 内部跳转:用 react-router-dom <Link>(不刷新页面)
 *   · 外部链接:用 <a target="_blank" rel="noopener noreferrer">(安全要求)
 *   · 自定义行为:用 <button> + onAction
 * - 整体居中、垂直排列,最小高度 240px(避免空状态区域过小)
 * - 图标采用 Lucide,辅以朱砂红点装饰,避免可爱卡通/二次元插画
 *
 * 优先级:onAction > to > actionHref(三者互斥使用)
 *
 * 使用方式:
 *   <EmptyState icon={History} title="还没有分析记录" desc="..." actionLabel="立即上传" to="/analyze" />
 *   <EmptyState icon={Search} title="没有找到匹配的作品" desc="..." secondaryHint="试试调整筛选条件" />
 *   <EmptyState icon={BookOpen} title="素材库为空" actionLabel="查看教程" actionHref="https://help.example.com" />
 */
export interface EmptyStateProps {
  /** 主图标,默认 FileSearch */
  icon?: LucideIcon;
  /** 主标题(如"还没有分析记录") */
  title: string;
  /** 描述文案(如"上传第一件作品,开始AI智能诊断") */
  desc?: string;
  /** 行动召唤按钮文案(如"立即上传") */
  actionLabel?: string;
  /** 按钮点击回调(与 to/actionHref 互斥,优先级最高) */
  onAction?: () => void;
  /** 内部路由跳转地址(与 onAction/actionHref 互斥) */
  to?: string;
  /** 外部链接(与 onAction/to 互斥,自动 target=_blank + rel=noopener noreferrer) */
  actionHref?: string;
  /** 次要说明文字(灰色小字,位于 desc 下方,提供更细致的引导提示) */
  secondaryHint?: string;
  /** 容器额外类名(透传给最外层) */
  className?: string;
}

function EmptyStateImpl({
  icon: Icon = FileSearch,
  title,
  desc,
  actionLabel,
  onAction,
  to,
  actionHref,
  secondaryHint,
  className = '',
}: EmptyStateProps) {
  /* 行动按钮显示条件:有文案 且 至少有一种行为(onAction / to / actionHref) */
  const showAction = Boolean(actionLabel && (onAction || to || actionHref));
  /* 主按钮样式:品牌主色 + hover + 焦点环 + 圆角 4px(按钮规范) */
  const actionClasses =
    'inline-flex items-center justify-center gap-2 px-5 h-10 bg-cinnabar text-white rounded text-sm font-medium ' +
    'hover:bg-cinnabar-dark transition-colors focus:outline-none focus:ring-2 focus:ring-cinnabar/40 focus:ring-offset-1 focus:ring-offset-rice-50';

  /* 渲染按钮:优先 onAction > to > actionHref */
  let actionNode: ReactNode = null;
  if (showAction && actionLabel) {
    if (onAction) {
      actionNode = (
        <button
          type="button"
          onClick={onAction}
          className={actionClasses}
          aria-label={actionLabel}
        >
          {actionLabel}
        </button>
      );
    } else if (to) {
      actionNode = (
        <Link
          to={to}
          className={actionClasses}
          role="button"
          aria-label={actionLabel}
        >
          {actionLabel}
        </Link>
      );
    } else if (actionHref) {
      actionNode = (
        <a
          href={actionHref}
          target="_blank"
          rel="noopener noreferrer"
          className={actionClasses}
          role="button"
          aria-label={actionLabel}
        >
          {actionLabel}
        </a>
      );
    }
  }

  return (
    <div
      className={`flex flex-col items-center justify-center text-center min-h-[240px] py-12 px-4 ${className}`}
    >
      {/* 水墨风格图标 + 朱砂红点装饰 */}
      <div className="relative mb-6">
        <div className="w-20 h-20 bg-ink-900/5 rounded-full flex items-center justify-center">
          <Icon className="w-10 h-10 text-ink-400" strokeWidth={1.5} />
        </div>
        {/* 朱砂红点装饰:置于右上角,ring 与背景同色形成镂空效果 */}
        <span
          className="absolute top-1 right-1 w-2.5 h-2.5 bg-cinnabar rounded-full ring-2 ring-rice-50"
          aria-hidden="true"
        />
      </div>

      {/* 主标题 */}
      <h3 className="text-base font-medium text-ink-700 mb-2">
        {title}
      </h3>

      {/* 描述文案 */}
      {desc && (
        <p className="text-sm text-ink-400 max-w-md mb-2 leading-relaxed">
          {desc}
        </p>
      )}

      {/* 次要说明文字(灰色小字,提供更细致的引导) */}
      {secondaryHint && (
        <p className="text-xs text-ink-400/80 max-w-md mb-6 leading-relaxed">
          {secondaryHint}
        </p>
      )}

      {/* 当存在 desc 但无 secondaryHint 时,保持按钮与标题的间距 */}
      {!secondaryHint && (desc || showAction) && <div className="mb-4" aria-hidden="true" />}

      {/* 行动召唤按钮 */}
      {actionNode}
    </div>
  );
}

/**
 * React.memo 包裹(V2-D 性能优化):
 *   - EmptyState 是纯展示组件,无 state/effect,渲染开销极低
 *   - 主要使用场景:多个页面/弹窗的空状态占位,父组件重渲染时跳过 EmptyState
 *   - 注意:icon(LucideIcon 类型)与 onAction(函数)是引用类型,
 *     调用方应使用稳定引用(模块级常量 / useCallback)才能让 memo 生效;
 *     字面量 props(title/desc/actionLabel 等)始终稳定,memo 总能起效
 */
const EmptyState = memo(EmptyStateImpl);
export default EmptyState;
