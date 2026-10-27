import type { MetadataRoute } from 'next';
import { getCanonicalUrl } from '@/lib/site';
import { getAllPosts } from '@/lib/blog';

/**
 * 静态 sitemap.xml
 * 包含所有固定页面 + 博客文章
 * 注意:next.config.js 启用 trailingSlash:true,页面 URL 统一以 / 结尾
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const staticPages: MetadataRoute.Sitemap = [
    { url: getCanonicalUrl('/'), lastModified: now, changeFrequency: 'weekly', priority: 1 },
    { url: getCanonicalUrl('/product'), lastModified: now, changeFrequency: 'monthly', priority: 0.9 },
    { url: getCanonicalUrl('/pricing'), lastModified: now, changeFrequency: 'monthly', priority: 0.9 },
    { url: getCanonicalUrl('/cases'), lastModified: now, changeFrequency: 'monthly', priority: 0.8 },
    { url: getCanonicalUrl('/insights'), lastModified: now, changeFrequency: 'monthly', priority: 0.8 },
    { url: getCanonicalUrl('/blog'), lastModified: now, changeFrequency: 'weekly', priority: 0.8 },
    { url: getCanonicalUrl('/about'), lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
    { url: getCanonicalUrl('/privacy'), lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: getCanonicalUrl('/terms'), lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    // 2026-09-02 公安备案合规:安全管理制度公示页
    { url: getCanonicalUrl('/security'), lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
  ];

  const blogPosts: MetadataRoute.Sitemap = getAllPosts().map((post) => ({
    url: getCanonicalUrl(`/blog/${post.slug}`),
    lastModified: new Date(post.date),
    changeFrequency: 'monthly' as const,
    priority: 0.7,
  }));

  return [...staticPages, ...blogPosts];
}
