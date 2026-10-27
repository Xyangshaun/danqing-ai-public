import type { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { PageHeader } from '@/components/ui/PageHeader';
import { Section } from '@/components/ui/Section';
import { RevealOnScroll } from '@/components/ui/RevealOnScroll';
import { JsonLd } from '@/components/seo/JsonLd';
import { buildMetadata, breadcrumbJsonLd } from '@/lib/seo';
import { getAllPosts } from '@/lib/blog';

export const metadata: Metadata = buildMetadata({
  title: '博客 - 艺术教育 · AI 评图 · 教学实践',
  description:
    '丹青有AI 博客:分享 AI 在高校艺术教育中的应用思考,涵盖构图分析、色彩理论、教师减负、学生成长等专业话题。',
  path: '/blog',
  keywords: ['博客', '艺术教育', 'AI 评图', '教学实践', '水墨美学'],
});

export default function BlogPage() {
  const posts = getAllPosts();

  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: '首页', url: '/' },
          { name: '博客', url: '/blog' },
        ])}
      />

      <PageHeader
        breadcrumb={[
          { name: '首页', href: '/' },
          { name: '博客', href: '/blog' },
        ]}
        eyebrow='博客 · 资源'
        title={<>关于艺术教育与 AI 的思考</>}
        description="从构图理论到教师减负,从水墨美学到学生成长——丹青有AI 团队的一线观察与方法论。"
      />

      <Section spacing="lg">
        {/* 精选文章(最新一篇,大图) */}
        {posts[0] && (
          <RevealOnScroll variant="clip">
            <Link
              href={`/blog/${posts[0].slug}`}
              className="group grid grid-cols-1 overflow-hidden rounded-lg border border-ink-100 bg-paper-50 shadow-ink-sm transition-all duration-500 ease-ink hover:border-gold-300/60 hover:shadow-ink lg:grid-cols-2"
            >
              <div className="relative aspect-[16/10] overflow-hidden bg-paper-200 lg:aspect-auto">
                <Image
                  src={posts[0].cover}
                  alt={posts[0].title}
                  fill
                  sizes="(max-width: 1024px) 100vw, 50vw"
                  className="object-cover transition-transform duration-700 ease-ink group-hover:scale-105"
                  priority
                />
              </div>
              <div className="flex flex-col justify-center p-8 md:p-10">
                <div className="flex items-center gap-3 text-xs text-ink-400">
                  <span className="rounded-full bg-cinnabar-50 px-2.5 py-1 text-cinnabar-600">{posts[0].category}</span>
                  <span>{posts[0].date}</span>
                  <span>·</span>
                  <span>{posts[0].readingTime}</span>
                </div>
                <h2 className="mt-4 text-2xl font-semibold leading-snug text-ink-900 transition-colors group-hover:text-cinnabar-600 md:text-3xl">
                  {posts[0].title}
                </h2>
                <p className="mt-4 text-[15px] leading-relaxed text-ink-500 line-clamp-3">
                  {posts[0].description}
                </p>
                <span className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-cinnabar-600">
                  阅读全文
                  <span className="transition-transform duration-300 group-hover:translate-x-1">→</span>
                </span>
              </div>
            </Link>
          </RevealOnScroll>
        )}

        {/* 文章列表 */}
        <div className="mt-12 grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-3">
          {posts.slice(1).map((post, i) => (
            <RevealOnScroll key={post.slug} delay={(i % 3) * 0.08} variant="scale">
              <Link
                href={`/blog/${post.slug}`}
                className="group flex h-full flex-col overflow-hidden rounded-lg border border-ink-100 bg-paper-50 shadow-ink-sm transition-all duration-500 ease-ink hover:-translate-y-1.5 hover:border-gold-300/50 hover:shadow-ink"
              >
                <div className="relative aspect-[16/10] overflow-hidden bg-paper-200">
                  <Image
                    src={post.cover}
                    alt={post.title}
                    fill
                    sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
                    className="object-cover transition-transform duration-700 ease-ink group-hover:scale-105"
                  />
                </div>
                <div className="flex flex-1 flex-col p-6">
                  <div className="flex items-center gap-2 text-xs text-ink-400">
                    <span className="rounded-full bg-paper-200 px-2.5 py-1 text-ink-500">{post.category}</span>
                    <span>{post.date}</span>
                  </div>
                  <h3 className="mt-3 text-lg font-semibold leading-snug text-ink-900 transition-colors group-hover:text-cinnabar-600">
                    {post.title}
                  </h3>
                  <p className="mt-2 flex-1 text-sm leading-relaxed text-ink-500 line-clamp-2">
                    {post.description}
                  </p>
                  <span className="mt-4 text-xs text-ink-400">{post.readingTime}</span>
                </div>
              </Link>
            </RevealOnScroll>
          ))}
        </div>
      </Section>
    </>
  );
}
