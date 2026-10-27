import type { Metadata } from 'next';
import { SITE, getCanonicalUrl } from './site';

type PageSeoInput = {
  title: string;
  description: string;
  /** 相对路径,如 /product */
  path?: string;
  keywords?: string[];
  /** OG 图片(绝对 URL 或 /images/... 相对路径) */
  ogImage?: string;
  noIndex?: boolean;
};

/**
 * 构建单页 SEO 元数据(title / description / OG / Twitter / canonical)
 */
export function buildMetadata({
  title,
  description,
  path = '/',
  keywords = [],
  ogImage = '/images/og-default.svg',
  noIndex = false,
}: PageSeoInput): Metadata {
  const url = getCanonicalUrl(path);
  const fullTitle = title.includes(SITE.name) ? title : `${title} | ${SITE.name}`;
  const defaultKeywords = [
    '丹青有AI',
    'AI 艺术教育',
    '艺术作业诊断',
    '高校美术教学',
    'AI 构图分析',
    'AI 色彩分析',
    'AI 笔触分析',
    '绘画 AI 评图',
    '设计 AI 诊断',
    '艺术教育数字化',
  ];

  return {
    title: fullTitle,
    description,
    keywords: [...defaultKeywords, ...keywords],
    alternates: {
      canonical: url,
    },
    openGraph: {
      title: fullTitle,
      description,
      url,
      siteName: SITE.name,
      type: 'website',
      locale: 'zh_CN',
      images: [
        {
          url: ogImage,
          width: 1200,
          height: 630,
          alt: fullTitle,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: fullTitle,
      description,
      images: [ogImage],
    },
    robots: noIndex
      ? { index: false, follow: false }
      : { index: true, follow: true },
  };
}

/**
 * 组织 JSON-LD 结构化数据
 */
export function organizationJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE.name,
    alternateName: SITE.nameEn,
    url: SITE.url,
    logo: `${SITE.url}/images/logo.svg`,
    description: SITE.description,
    email: SITE.email,
    sameAs: [],
  };
}

/**
 * 产品 JSON-LD
 */
export function productJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: SITE.name,
    applicationCategory: 'EducationApplication',
    operatingSystem: 'Web',
    description: SITE.description,
    url: SITE.url,
    offers: [
      {
        '@type': 'Offer',
        name: '免费版',
        price: '0',
        priceCurrency: 'CNY',
      },
      {
        '@type': 'Offer',
        name: '标准版(教师)',
        price: '99',
        priceCurrency: 'CNY',
      },
    ],
    aggregateRating: {
      '@type': 'AggregateRating',
      ratingValue: '4.8',
      reviewCount: '128',
    },
  };
}

/**
 * 面包屑 JSON-LD
 */
export function breadcrumbJsonLd(items: { name: string; url: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: `${SITE.url}${item.url === '/' ? '' : item.url}`,
    })),
  };
}

/**
 * FAQ JSON-LD
 */
export function faqJsonLd(faqs: { question: string; answer: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((faq) => ({
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: faq.answer,
      },
    })),
  };
}

/**
 * WebSite JSON-LD(首页使用,支持搜索引擎 Sitelinks 搜索框)
 */
export function websiteJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE.name,
    alternateName: SITE.nameEn,
    url: getCanonicalUrl('/'),
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${getCanonicalUrl('/blog')}?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  };
}

/**
 * 文章 JSON-LD
 */
export function articleJsonLd(article: {
  title: string;
  description: string;
  slug: string;
  datePublished: string;
  dateModified?: string;
  author?: string;
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: article.title,
    description: article.description,
    url: `${SITE.url}/blog/${article.slug}`,
    datePublished: article.datePublished,
    dateModified: article.dateModified || article.datePublished,
    author: {
      '@type': 'Organization',
      name: article.author || SITE.name,
    },
    publisher: {
      '@type': 'Organization',
      name: SITE.name,
      logo: {
        '@type': 'ImageObject',
        url: `${SITE.url}/images/logo.svg`,
      },
    },
  };
}
