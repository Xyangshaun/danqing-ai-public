import type { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { MDXRemote } from 'next-mdx-remote/rsc';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { Section } from '@/components/ui/Section';
import { RevealOnScroll } from '@/components/ui/RevealOnScroll';
import { CTASection } from '@/components/ui/CTASection';
import { JsonLd } from '@/components/seo/JsonLd';
import { buildMetadata, breadcrumbJsonLd, articleJsonLd } from '@/lib/seo';
import { getAllPosts, getPostBySlug, getRelatedPosts } from '@/lib/blog';

/** 静态导出:预生成所有文章 slug */
export function generateStaticParams() {
  return getAllPosts().map((post) => ({ slug: post.slug }));
}

/** 动态元数据 */
export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const post = getPostBySlug(params.slug);
  if (!post) {
    return buildMetadata({ title: '文章未找到', description: '您访问的文章不存在或已被移除。', path: '/blog', noIndex: true });
  }
  return buildMetadata({
    title: post.title,
    description: post.description,
    path: `/blog/${post.slug}`,
    keywords: post.tags,
    ogImage: post.cover,
  });
}

export default function BlogPostPage({ params }: { params: { slug: string } }) {
  const post = getPostBySlug(params.slug);
  if (!post) {
    notFound();
  }

  const related = getRelatedPosts(post.slug, 3);

  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: '首页', url: '/' },
          { name: '博客', url: '/blog' },
          { name: post.title, url: `/blog/${post.slug}` },
        ])}
      />
      <JsonLd
        data={articleJsonLd({
          title: post.title,
          description: post.description,
          slug: post.slug,
          datePublished: post.date,
          author: post.author,
        })}
      />

      {/* 文章头部 */}
      <section className="relative overflow-hidden bg-paper-100 pb-12 pt-12 md:pt-16">
        <div className="container-content relative">
          <Breadcrumb
            items={[
              { name: '首页', href: '/' },
              { name: '博客', href: '/blog' },
              { name: post.category, href: '/blog' },
            ]}
          />

          <div className="mt-8 max-w-3xl">
            <div className="flex flex-wrap items-center gap-3 text-sm text-ink-400">
              <span className="rounded-full bg-cinnabar-50 px-3 py-1 text-xs text-cinnabar-600">
                {post.category}
              </span>
              <time dateTime={post.date}>{post.date}</time>
              <span>·</span>
              <span>{post.readingTime}</span>
              <span>·</span>
              <span>{post.author}</span>
            </div>

            <h1 className="mt-5 text-display-md font-semibold leading-tight text-ink-900 md:text-display-lg">
              {post.title}
            </h1>
            <p className="mt-5 text-lg leading-relaxed text-ink-500">{post.description}</p>
          </div>
        </div>
      </section>

      {/* 封面图 */}
      <div className="container-content">
        <div className="relative -mt-2 aspect-[16/7] overflow-hidden rounded-lg bg-paper-200 shadow-ink">
          <Image
            src={post.cover}
            alt={post.title}
            fill
            sizes="(max-width: 1200px) 100vw, 1200px"
            className="object-cover"
            priority
          />
        </div>
      </div>

      {/* 正文 */}
      <Section spacing="md">
        <article className="prose-cn">
          <MDXRemote source={post.content} />
        </article>

        {/* 标签 */}
        {post.tags.length > 0 && (
          <div className="mx-auto mt-12 flex max-w-prose-cn flex-wrap gap-2 border-t border-ink-100 pt-8">
            {post.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-paper-200 px-3 py-1 text-xs text-ink-500"
              >
                #{tag}
              </span>
            ))}
          </div>
        )}
      </Section>

      {/* 相关文章 */}
      {related.length > 0 && (
        <Section spacing="md" background="muted">
          <h2 className="text-2xl font-semibold text-ink-900">相关阅读</h2>
          <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-3">
            {related.map((r, i) => (
              <RevealOnScroll key={r.slug} delay={i * 0.08} variant="up">
                <Link
                  href={`/blog/${r.slug}`}
                  className="group flex h-full flex-col overflow-hidden rounded-lg border border-ink-100 bg-paper-50 transition-all duration-500 ease-ink hover:shadow-ink"
                >
                  <div className="relative aspect-[16/10] overflow-hidden bg-paper-200">
                    <Image
                      src={r.cover}
                      alt={r.title}
                      fill
                      sizes="(max-width: 768px) 100vw, 33vw"
                      className="object-cover transition-transform duration-700 ease-ink group-hover:scale-105"
                    />
                  </div>
                  <div className="flex flex-1 flex-col p-5">
                    <span className="text-xs text-ink-400">{r.category} · {r.date}</span>
                    <h3 className="mt-2 text-base font-semibold leading-snug text-ink-900 transition-colors group-hover:text-cinnabar-600">
                      {r.title}
                    </h3>
                  </div>
                </Link>
              </RevealOnScroll>
            ))}
          </div>
        </Section>
      )}

      <CTASection
        title="把文章里的思考,变成你的教学实践"
        description="立即体验丹青有AI,3 秒智能分析,专业美院标准。"
      />
    </>
  );
}
