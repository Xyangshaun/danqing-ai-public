import React from 'react';

type SectionProps = {
  children: React.ReactNode;
  /** 章节标识,用于锚点 */
  id?: string;
  /** 顶部内边距档位 */
  spacing?: 'sm' | 'md' | 'lg' | 'none';
  className?: string;
  /** 背景类型 */
  background?: 'default' | 'muted' | 'ink';
  /** 是否限制最大宽度(默认是) */
  contained?: boolean;
};

const spacingMap = {
  none: 'py-0',
  sm: 'py-16 md:py-20',
  md: 'py-22 md:py-30',
  lg: 'py-30 md:py-40',
};

const backgroundMap = {
  default: '',
  muted: 'bg-paper-200/40',
  ink: 'bg-ink-900 text-paper-100',
};

/**
 * 通用章节容器
 * 统一垂直节奏与背景切换
 */
export function Section({
  children,
  id,
  spacing = 'md',
  className = '',
  background = 'default',
  contained = true,
}: SectionProps) {
  return (
    <section
      id={id}
      className={`relative ${spacingMap[spacing]} ${backgroundMap[background]} ${className}`}
    >
      {contained ? <div className="container-content">{children}</div> : children}
    </section>
  );
}

type SectionHeaderProps = {
  eyebrow?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** 英文副标题,增强排版层次和国际感(借鉴 TTT ise 封面中文大标题+英文小字层级) */
  subtitleEn?: string;
  align?: 'left' | 'center';
  variant?: 'default' | 'light';
  className?: string;
};

/**
 * 章节标题区块:小标签 + 大标题 + 描述
 */
export function SectionHeader({
  eyebrow,
  title,
  description,
  subtitleEn,
  align = 'left',
  variant = 'default',
  className = '',
}: SectionHeaderProps) {
  const isLight = variant === 'light';
  return (
    <div
      className={`max-w-2xl ${align === 'center' ? 'mx-auto text-center' : ''} ${className}`}
    >
      {eyebrow && (
        <span
          className={`section-eyebrow ${align === 'center' ? 'justify-center' : ''} ${
            isLight ? 'text-gold-400' : ''
          }`}
        >
          {eyebrow}
        </span>
      )}
      {/* 英文副标题:大标题上方的半透明小字 */}
      {subtitleEn && (
        <p
          className={`mt-3 text-xs font-medium uppercase tracking-[0.25em] ${
            isLight ? 'text-paper-200/40' : 'text-ink-300'
          }`}
        >
          {subtitleEn}
        </p>
      )}
      <h2
        className={`mt-2 text-display-md font-semibold leading-tight ${
          isLight ? 'text-paper-50' : 'text-ink-900'
        }`}
      >
        {title}
      </h2>
      {description && (
        <p
          className={`mt-5 text-base leading-relaxed md:text-lg ${
            isLight ? 'text-paper-200/70' : 'text-ink-400'
          }`}
        >
          {description}
        </p>
      )}
    </div>
  );
}
