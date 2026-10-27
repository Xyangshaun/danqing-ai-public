import Link from 'next/link';
import type { Metadata } from 'next';
import { LogoMark } from '@/components/layout/Logo';
import { buildMetadata } from '@/lib/seo';

export const metadata: Metadata = buildMetadata({
  title: '页面未找到',
  description: '你访问的页面不存在或已被移除,返回丹青有AI 首页继续浏览。',
  path: '/',
  noIndex: true,
});

/**
 * 404 页面(静态导出会生成 404.html)
 */
export default function NotFound() {
  return (
    <section className="relative flex min-h-[70vh] items-center justify-center overflow-hidden bg-paper-100">
      <div
        className="pointer-events-none absolute inset-0"
        aria-hidden="true"
        style={{
          background:
            'radial-gradient(ellipse 50% 40% at 50% 40%, rgba(26, 26, 26, 0.06) 0%, transparent 60%)',
        }}
      />
      <div className="container-content relative text-center">
        <div className="mx-auto mb-8 flex justify-center">
          <LogoMark size="lg" />
        </div>
        <p className="font-serif text-7xl font-semibold text-cinnabar-500 md:text-8xl">404</p>
        <h1 className="mt-6 text-display-md font-semibold text-ink-900">这一页,像是被留白处理了</h1>
        <p className="mx-auto mt-5 max-w-md text-base leading-relaxed text-ink-500">
          你访问的页面不存在,或已被移除。不妨回到首页,重新开始浏览。
        </p>
        <div className="mt-9 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <Link href="/" className="btn-primary">
            返回首页
          </Link>
          <Link href="/blog" className="btn-secondary">
            浏览博客
          </Link>
        </div>
      </div>
    </section>
  );
}
