import type { MetadataRoute } from 'next';
import { SITE } from '@/lib/site';

/**
 * PWA manifest.json
 * 官网为内容型站点,manifest 仅提供基础安装信息
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE.name,
    short_name: SITE.shortName,
    description: SITE.description,
    start_url: '/',
    display: 'standalone',
    background_color: '#faf8f3',
    theme_color: '#faf8f3',
    icons: [
      {
        src: '/favicon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
      },
      {
        src: '/images/logo.svg',
        sizes: 'any',
        type: 'image/svg+xml',
      },
    ],
  };
}
