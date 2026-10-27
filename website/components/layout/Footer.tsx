import React from 'react';
import Link from 'next/link';
import { LogoMark } from './Logo';
import { MpsBeianBadge } from './MpsBeianBadge';
import { SITE, FOOTER_LINKS, CTA_LINKS } from '@/lib/site';

/**
 * 全站页脚
 * - 墨黑底,宣纸白字,与主体宣纸白形成水墨阴阳对比
 * - 三栏导航 + 品牌简介 + 法律链接
 */
export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="relative mt-30 overflow-hidden bg-ink-900 text-paper-100">
      {/* 顶部金色细线:高端感分隔 */}
      <div className="h-px w-full bg-gradient-to-r from-transparent via-gold-500/40 to-transparent" />

      {/* 背景水墨晕染 */}
      <div
        className="pointer-events-none absolute inset-0 opacity-30"
        style={{
          background:
            'radial-gradient(ellipse 60% 80% at 10% 100%, rgba(200, 57, 46, 0.12) 0%, transparent 60%), radial-gradient(ellipse 50% 70% at 90% 0%, rgba(46, 92, 110, 0.15) 0%, transparent 60%)',
        }}
        aria-hidden="true"
      />

      <div className="container-content relative py-16 md:py-20">
        <div className="grid grid-cols-1 gap-12 md:grid-cols-12">
          {/* 品牌区 */}
          <div className="md:col-span-5">
            <div className="flex items-center gap-3">
              <LogoMark size="md" />
              <div className="flex flex-col leading-none">
                <span className="font-serif text-lg font-semibold text-paper-50">
                  {SITE.name}
                </span>
                <span className="text-[10px] tracking-[0.18em] text-paper-200/60 mt-1">
                  {SITE.nameEn.toUpperCase()}
                </span>
              </div>
            </div>
            <p className="mt-5 max-w-sm text-sm leading-relaxed text-paper-200/70">
              {SITE.description}
            </p>
            <div className="mt-6 flex flex-col gap-2 text-sm text-paper-200/60">
              <a
                href={`mailto:${SITE.email}`}
                className="inline-flex items-center gap-2 transition-colors hover:text-gold-300"
              >
                <span className="inline-block h-1 w-1 rounded-full bg-gold-400" />
                {SITE.email}
              </a>
              <span className="inline-flex items-center gap-2">
                <span className="inline-block h-1 w-1 rounded-full bg-gold-400" />
                微信公众号:{SITE.wechatOfficial}
              </span>
            </div>
          </div>

          {/* 导航分组 */}
          <div className="grid grid-cols-2 gap-8 md:col-span-7 md:grid-cols-3">
            {Object.values(FOOTER_LINKS).map((group) => (
              <div key={group.title}>
                <h4 className="text-xs font-medium uppercase tracking-[0.2em] text-gold-400">
                  {group.title}
                </h4>
                <ul className="mt-4 space-y-3">
                  {group.links.map((link) => (
                    <li key={link.href}>
                      <Link
                        href={link.href}
                        className="text-sm text-paper-200/70 transition-colors hover:text-paper-50"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        {/* 底部分隔线 + 版权 */}
        <div className="mt-14 flex flex-col gap-4 border-t border-paper-200/10 pt-8 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-paper-200/50">
            <span>© {year} {SITE.name} · {SITE.nameEn}</span>
            <span className="hidden md:inline text-paper-200/20">|</span>
            <Link href="/privacy" className="transition-colors hover:text-paper-200/80">
              隐私政策
            </Link>
            <Link href="/terms" className="transition-colors hover:text-paper-200/80">
              服务条款
            </Link>
            {/* 工信部备案号:链接工信部官网(备案悬挂规范,腾讯云文档 product/243/61412) */}
            <a
              href="https://beian.miit.gov.cn/"
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-paper-200/80"
            >
              {SITE.icpNumber}
            </a>
            {/* 公网安备号:编号固化于 site.ts(官方三要素:图标+编号+链接) */}
            <MpsBeianBadge />
          </div>
          <div className="flex items-center gap-4 text-xs text-paper-200/40">
            <a
              href={CTA_LINKS.trial}
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-gold-300"
            >
              进入工作台 →
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
