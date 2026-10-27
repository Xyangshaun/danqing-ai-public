import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Navbar } from '@/components/layout/Navbar';
import { Footer } from '@/components/layout/Footer';
import { InkLoader } from '@/components/ui/InkLoader';
import { InkCursor } from '@/components/ui/InkCursor';
import { PaperBackground } from '@/components/background/PaperBackground';
import { BackToTop } from '@/components/ui/BackToTop';
import { JsonLd } from '@/components/seo/JsonLd';
import { SITE } from '@/lib/site';
import { organizationJsonLd } from '@/lib/seo';

// 搜索引擎站长验证(百度/必应):由 deploy-website.sh 在构建后往静态 <head> 直接插入 meta。
// 注意:不能依赖 Next.js 的 metadata 或 <head> JSX——App Router 会把 head 内容 hoist 进
// RSC flight 数据(__next_f),静态 HTML 的 <head> 里没有,必应等不执行 JS 的爬虫读不到。
// 因此验证 meta 由部署脚本 sed 插入到 out/index.html 的静态 <head>。

// 全局元数据:所有页面继承,单页可覆盖
export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: {
    default: `${SITE.name} | ${SITE.slogan}`,
    template: `%s | ${SITE.name}`,
  },
  description: SITE.description,
  applicationName: SITE.name,
  keywords: [
    '丹青有AI',
    'DanQing AI',
    'AI 艺术教育',
    '艺术作业诊断',
    '高校美术教学',
    'AI 构图分析',
    'AI 色彩分析',
    'AI 笔触分析',
    '绘画 AI 评图',
    '设计 AI 诊断',
    '雕塑 AI 分析',
    '艺术教育数字化',
    '教师减负',
  ],
  authors: [{ name: SITE.name }],
  creator: SITE.name,
  publisher: SITE.name,
  alternates: {
    canonical: '/',
  },
  openGraph: {
    type: 'website',
    locale: 'zh_CN',
    url: SITE.url,
    siteName: SITE.name,
    title: `${SITE.name} | ${SITE.slogan}`,
    description: SITE.description,
    images: [
      {
        url: '/images/og-default.svg',
        width: 1200,
        height: 630,
        alt: SITE.name,
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: `${SITE.name} | ${SITE.slogan}`,
    description: SITE.description,
    images: ['/images/og-default.svg'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
    ],
    shortcut: '/favicon.svg',
    apple: '/favicon.svg',
  },
  manifest: '/manifest.webmanifest',
  formatDetection: {
    telephone: false,
    address: false,
    email: false,
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: '#faf8f3',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        {/* 组织结构化数据:全站注入 */}
        <JsonLd data={organizationJsonLd()} />
        {/*
          主题同步脚本(内联,渲染前执行,避免 FOUC 闪烁):
          读取 localStorage['danqing-ai-theme'](与业务应用 /app 共享同域 localStorage)
          - 'ink' → data-theme="dark"
          - 'rice' → data-theme="light"
          - 'auto' → 跟随系统 prefers-color-scheme
          - 未设置 → 默认 light
          同时监听 storage 事件,用户在 /app 切换主题后官网实时同步
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('danqing-ai-theme');var m='light';if(t==='ink'){m='dark'}else if(t==='auto'){m=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}document.documentElement.setAttribute('data-theme',m);window.addEventListener('storage',function(e){if(e.key==='danqing-ai-theme'){var v=e.newValue;var nm='light';if(v==='ink'){nm='dark'}else if(v==='auto'){nm=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}document.documentElement.setAttribute('data-theme',nm)}})}catch(err){}})();`,
          }}
        />
      </head>
      {/* 注意:body 不能加 depth-stage(perspective 会使所有 fixed 子元素相对 body 而非视口定位,
          导致 VideoIntro/Navbar 等全屏覆盖层塌缩到文档流)。卡片景深由 .ink-card 自带 perspective 实现。 */}
      <body className="min-h-screen flex flex-col antialiased">
        {/* 无障碍:跳转到主内容 */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-paper-50 focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-ink-900 focus:shadow-ink-lg"
        >
          跳转到主内容
        </a>
        {/* 画纸纹理背景(2.5D 远景层) — 永远在所有内容之下,提供"画纸在底,内容浮起"的景深 */}
        <PaperBackground />
        <InkLoader />
        <InkCursor />
        <Navbar />
        {/* 主内容区:顶部留白避开固定导航 */}
        <main id="main-content" className="flex-1 pt-16 md:pt-18 scroll-mt-20">
          {children}
        </main>
        <Footer />
        <BackToTop />
      </body>
    </html>
  );
}
