import React from 'react';
import Link from 'next/link';
import { SITE } from '@/lib/site';

type LogoProps = {
  /** 是否显示完整文字(默认显示) */
  showText?: boolean;
  /** 尺寸 */
  size?: 'sm' | 'md' | 'lg';
  /** 文字颜色(用于深色背景) */
  variant?: 'default' | 'light';
  className?: string;
};

/**
 * 丹青有AI 品牌标识
 * - "丹青"朱文印(决赛定稿印章素材,透明底 PNG)
 * - 传统篆刻方章形态,与应用端 LogoMark 同源统一
 */
export function LogoMark({ size = 'md', className = '' }: { size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const dimensions = {
    sm: 28,
    md: 36,
    lg: 52,
  }[size];

  return (
    <span
      className={`relative inline-flex items-center justify-center ${className}`}
      style={{ width: dimensions, height: dimensions }}
      aria-hidden="true"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/images/logo-seal.png"
        alt=""
        draggable={false}
        width={dimensions}
        height={dimensions}
        className="block object-contain"
      />
    </span>
  );
}

/**
 * 完整 Logo:印章 + 中英文品牌名
 */
export function Logo({ showText = true, size = 'md', variant = 'default', className = '' }: LogoProps) {
  const textSize = {
    sm: 'text-sm',
    md: 'text-base',
    lg: 'text-xl',
  }[size];

  const textColor = variant === 'light' ? 'text-paper-50' : 'text-ink-900';
  const subColor = variant === 'light' ? 'text-paper-200/70' : 'text-ink-400';

  return (
    <Link
      href="/"
      className={`inline-flex items-center gap-2.5 group ${className}`}
      aria-label={`${SITE.name} 首页`}
    >
      <LogoMark size={size} className="transition-transform duration-500 ease-ink group-hover:rotate-[-4deg]" />
      {showText && (
        <span className="flex flex-col leading-none">
          <span className={`font-serif font-semibold ${textSize} ${textColor} tracking-tight`}>
            {SITE.name}
          </span>
          <span className={`text-[10px] tracking-[0.18em] ${subColor} mt-0.5`}>
            {SITE.nameEn.toUpperCase()}
          </span>
        </span>
      )}
    </Link>
  );
}
