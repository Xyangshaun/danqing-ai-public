import fs from 'node:fs';
import path from 'node:path';

export type BlogPostMeta = {
  slug: string;
  title: string;
  description: string;
  date: string;
  category: string;
  tags: string[];
  author: string;
  readingTime: string;
  cover: string;
};

export type BlogPost = BlogPostMeta & {
  content: string;
};

const BLOG_DIR = path.join(process.cwd(), 'content', 'blog');

/**
 * 解析 MDX 文件头部 frontmatter(简单解析,避免额外依赖)
 * 格式:
 * ---
 * title: xxx
 * description: xxx
 * ...
 * ---
 * 正文内容
 */
function parseFrontmatter(raw: string): { meta: Record<string, string>; content: string } {
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!match) {
    return { meta: {}, content: raw };
  }
  const frontmatter = match[1];
  const content = match[2];
  const meta: Record<string, string> = {};
  for (const line of frontmatter.split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    // 去除引号
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    meta[key] = value;
  }
  return { meta, content };
}

function parseList(field: string | undefined): string[] {
  if (!field) return [];
  return field
    .replace(/[\[\]]/g, '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 获取所有博客文章元数据(按日期倒序)
 */
export function getAllPosts(): BlogPostMeta[] {
  if (!fs.existsSync(BLOG_DIR)) return [];
  const files = fs.readdirSync(BLOG_DIR).filter((f) => f.endsWith('.mdx'));
  const posts = files.map((file) => {
    const slug = file.replace(/\.mdx$/, '');
    const raw = fs.readFileSync(path.join(BLOG_DIR, file), 'utf-8');
    const { meta } = parseFrontmatter(raw);
    return {
      slug,
      title: meta.title || slug,
      description: meta.description || '',
      date: meta.date || '2026-01-01',
      category: meta.category || '艺术教育',
      tags: parseList(meta.tags),
      author: meta.author || '丹青有AI',
      readingTime: meta.readingTime || '5 分钟',
      cover: meta.cover || '/images/blog-default.svg',
    } satisfies BlogPostMeta;
  });
  return posts.sort((a, b) => (a.date < b.date ? 1 : -1));
}

/**
 * 根据 slug 获取单篇文章(含正文)
 */
export function getPostBySlug(slug: string): BlogPost | null {
  const filePath = path.join(BLOG_DIR, `${slug}.mdx`);
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf-8');
  const { meta, content } = parseFrontmatter(raw);
  return {
    slug,
    title: meta.title || slug,
    description: meta.description || '',
    date: meta.date || '2026-01-01',
    category: meta.category || '艺术教育',
    tags: parseList(meta.tags),
    author: meta.author || '丹青有AI',
    readingTime: meta.readingTime || '5 分钟',
    cover: meta.cover || '/images/blog-default.svg',
    content,
  };
}

/**
 * 获取推荐的相关文章(同分类优先,排除自身)
 */
export function getRelatedPosts(slug: string, limit = 3): BlogPostMeta[] {
  const all = getAllPosts();
  const current = all.find((p) => p.slug === slug);
  if (!current) return all.filter((p) => p.slug !== slug).slice(0, limit);
  const sameCategory = all.filter((p) => p.slug !== slug && p.category === current.category);
  const others = all.filter((p) => p.slug !== slug && p.category !== current.category);
  return [...sameCategory, ...others].slice(0, limit);
}
