'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Logo } from './Logo';
import { NAV_LINKS, CTA_LINKS } from '@/lib/site';

/**
 * 顶部导航
 * - 滚动时背景由透明过渡为宣纸白(带毛玻璃)
 * - 桌面端:水平导航 + CTA
 * - 移动端:汉堡 + 抽屉菜单
 */
export function Navbar() {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // 路由切换时关闭移动菜单
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  // 菜单打开时锁定滚动
  useEffect(() => {
    if (menuOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [menuOpen]);

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname?.startsWith(href);
  };

  return (
    <>
      <header
        className={`fixed inset-x-0 top-0 z-50 transition-all duration-500 ease-ink ${
          scrolled
            ? 'border-b border-ink-100/40 bg-paper-50/70 shadow-ink-sm backdrop-blur-xl'
            : 'border-b border-transparent bg-transparent'
        }`}
      >
        {/* 滚动后底部金线装饰 */}
        {scrolled && (
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-px opacity-60"
            aria-hidden="true"
            style={{
              background:
                'linear-gradient(90deg, transparent 0%, rgba(201, 169, 97, 0.4) 30%, rgba(201, 169, 97, 0.4) 70%, transparent 100%)',
            }}
          />
        )}
        <nav className="container-content flex h-16 items-center justify-between md:h-18">
          <Logo size="md" />

          {/* 桌面端导航 */}
          <div className="hidden items-center gap-1 md:flex">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`relative px-4 py-2 text-sm transition-colors duration-300 ease-ink ${
                  isActive(link.href)
                    ? 'text-ink-900 font-medium'
                    : 'text-ink-500 hover:text-ink-800'
                }`}
              >
                {link.label}
                {isActive(link.href) && (
                  <motion.span
                    layoutId="nav-active"
                    className="absolute inset-x-4 -bottom-0.5 h-0.5 bg-cinnabar-500"
                    transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                  />
                )}
              </Link>
            ))}
          </div>

          {/* 桌面端 CTA */}
          <div className="hidden items-center gap-3 md:flex">
            <a
              href={CTA_LINKS.trial}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary"
              data-track="nav-cta-trial"
            >
              立即体验
            </a>
          </div>

          {/* 移动端汉堡按钮 */}
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="inline-flex h-10 w-10 items-center justify-center rounded-ink text-ink-700 transition-colors hover:bg-paper-200 md:hidden"
            aria-label={menuOpen ? '关闭菜单' : '打开菜单'}
            aria-expanded={menuOpen}
          >
            <span className="relative block h-4 w-5">
              <span
                className={`absolute left-0 top-0 block h-0.5 w-5 bg-current transition-all duration-300 ease-ink ${
                  menuOpen ? 'top-1.5 rotate-45' : ''
                }`}
              />
              <span
                className={`absolute left-0 top-1.5 block h-0.5 w-5 bg-current transition-all duration-300 ease-ink ${
                  menuOpen ? 'opacity-0' : 'opacity-100'
                }`}
              />
              <span
                className={`absolute left-0 top-3 block h-0.5 w-5 bg-current transition-all duration-300 ease-ink ${
                  menuOpen ? 'top-1.5 -rotate-45' : ''
                }`}
              />
            </span>
          </button>
        </nav>
      </header>

      {/* 移动端抽屉菜单 */}
      <AnimatePresence>
        {menuOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="fixed inset-0 z-40 md:hidden"
          >
            {/* 遮罩 */}
            <div
              className="absolute inset-0 bg-ink-900/30 backdrop-blur-sm"
              onClick={() => setMenuOpen(false)}
              aria-hidden="true"
            />
            {/* 抽屉 */}
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              className="absolute right-0 top-0 h-full w-[80%] max-w-sm bg-paper-50 shadow-ink-lg"
            >
              <div className="flex h-16 items-center justify-between px-6 border-b border-ink-100">
                <Logo size="sm" />
              </div>
              <div className="flex flex-col px-6 py-6">
                {NAV_LINKS.map((link, i) => (
                  <motion.div
                    key={link.href}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.1 + i * 0.05, duration: 0.3 }}
                  >
                    <Link
                      href={link.href}
                      className={`block py-3.5 text-lg border-b border-ink-100/60 ${
                        isActive(link.href)
                          ? 'text-cinnabar-600 font-medium'
                          : 'text-ink-700'
                      }`}
                    >
                      {link.label}
                    </Link>
                  </motion.div>
                ))}
                <a
                  href={CTA_LINKS.trial}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-primary mt-8 w-full"
                  data-track="mobile-nav-cta-trial"
                >
                  立即体验
                </a>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
