import type { MetadataRoute } from 'next';
import { SITE } from '@/lib/site';

/**
 * robots.txt
 * 允许全部爬取,指向 sitemap
 * 官网为纯静态,无敏感端点
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
    },
    sitemap: `${SITE.url}/sitemap.xml`,
    host: 'www.danqing.site',
  };
}
