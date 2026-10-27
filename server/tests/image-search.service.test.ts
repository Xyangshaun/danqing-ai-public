// ============================================================
// 实时图片搜索服务测试
// 对应源码:src/services/image-search.service.ts
//
// 覆盖范围:
//   1. 分词器(中文二元 / 英文单词 / 混合)
//   2. 种子数据加载(每租户 22 条真实藏品图片,20 published + 1 draft + 1 archived)
//   3. 关键词搜索(召回 / 相关性排序 / score 归一化)
//   4. 关键词联想补全(前缀匹配 / 学生权限过滤)
//   5. 筛选(标签 AND / 分类 / 状态)
//   6. 分页(page / pageSize / hasMore)
//   7. 多租户隔离(跨租户不可见)
//   8. CRUD(创建 / 更新 / 删除 + 索引同步)
//   9. 角色权限强制(student 仅可见 published)
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { imageSearchService } from '../src/services/image-search.service.js';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';
const ADMIN_USER = 'admin-user-1';

beforeEach(() => {
  imageSearchService.__clearForTest();
});

// ============================================================
// 1. 分词器
// ============================================================
describe('tokenize 分词器', () => {
  it('应将连续中文切为滑动窗口二元组', () => {
    const tokens = imageSearchService.tokenize('素描几何');
    expect(tokens).toEqual(['素描', '描几', '几何']);
  });

  it('应保留单个汉字', () => {
    expect(imageSearchService.tokenize('画')).toEqual(['画']);
  });

  it('应将英文转小写并按单词切分', () => {
    expect(imageSearchService.tokenize('Hello World')).toEqual(['hello', 'world']);
  });

  it('应支持中英文混合分词', () => {
    const tokens = imageSearchService.tokenize('CRAP原则');
    expect(tokens).toContain('crap');
    expect(tokens).toContain('原则');
  });

  it('应对空字符串返回空数组', () => {
    expect(imageSearchService.tokenize('')).toEqual([]);
  });
});

// ============================================================
// 2. 种子数据
// ============================================================
describe('种子数据加载', () => {
  it('首次访问应自动注入 22 条种子图片(20 published + 1 draft + 1 archived)', () => {
    // 默认搜索仅返回 published(与 knowledge.service 行为一致:status 默认 published)
    const published = imageSearchService.search(TENANT_A, 'admin', {});
    expect(published.total).toBe(20);
    // admin 显式按状态查询可见全部 22 条
    const draft = imageSearchService.search(TENANT_A, 'admin', { status: 'draft' });
    const archived = imageSearchService.search(TENANT_A, 'admin', { status: 'archived' });
    expect(draft.total).toBe(1);
    expect(archived.total).toBe(1);
    // 合计 22
    expect(published.total + draft.total + archived.total).toBe(22);
  });

  it('默认搜索(admin 无 status)应仅返回 published(20 条,与 knowledge 行为一致)', () => {
    const result = imageSearchService.search(TENANT_A, 'admin', {});
    expect(result.total).toBe(20);
    expect(result.items.every((i) => i.status === 'published')).toBe(true);
  });

  it('默认搜索(student)应仅返回 published(20 条,draft/archived 各1条被强制过滤)', () => {
    const result = imageSearchService.search(TENANT_A, 'student', {});
    expect(result.total).toBe(20);
    expect(result.items.every((i) => i.status === 'published')).toBe(true);
  });
});

// ============================================================
// 3. 关键词搜索
// ============================================================
describe('关键词搜索', () => {
  it('搜索"素描"应召回素描相关条目并按相关性排序', () => {
    const result = imageSearchService.search(TENANT_A, 'admin', { q: '素描' });
    expect(result.total).toBeGreaterThanOrEqual(3);
    // 标签含"素描"的条目应排在最前(标签权重×4 + 精确标签加成,高于仅分类命中的条目)
    expect(result.items[0]?.tags).toContain('素描');
    // score 应归一化到 0-1,首条为 1
    expect(result.items[0]?.score).toBe(1);
    for (const item of result.items) {
      expect(item.score).toBeGreaterThan(0);
      expect(item.score).toBeLessThanOrEqual(1);
    }
  });

  it('短语"自画像"应精确命中标题并获得最高分', () => {
    const result = imageSearchService.search(TENANT_A, 'admin', { q: '自画像' });
    expect(result.total).toBeGreaterThanOrEqual(1);
    expect(result.items[0]?.title).toContain('自画像');
    expect(result.items[0]?.score).toBe(1);
  });

  it('搜索"色彩"应命中色彩相关条目', () => {
    const result = imageSearchService.search(TENANT_A, 'admin', { q: '色彩' });
    expect(result.total).toBeGreaterThanOrEqual(2);
    // 命中条目的标签或分类应含"色彩"(标题为中英文组合,不保证含该词)
    expect(
      result.items.every((i) => i.tags.includes('色彩') || i.category.includes('色彩')),
    ).toBe(true);
  });

  it('搜索"构图"应命中构图相关条目', () => {
    const result = imageSearchService.search(TENANT_A, 'admin', { q: '构图' });
    expect(result.total).toBeGreaterThanOrEqual(1);
    expect(result.items[0]?.tags).toContain('构图');
  });

  it('无匹配关键词应返回空结果', () => {
    const result = imageSearchService.search(TENANT_A, 'admin', { q: '量子力学' });
    expect(result.total).toBe(0);
    expect(result.items).toEqual([]);
    expect(result.hasMore).toBe(false);
  });

  it('空关键词应返回全部 published 条目(admin:20 条,按更新时间排序)', () => {
    const result = imageSearchService.search(TENANT_A, 'admin', { q: '' });
    expect(result.total).toBe(20);
    // 空查询不返回 score
    expect(result.items[0]?.score).toBeUndefined();
  });
});

// ============================================================
// 4. 关键词联想补全
// ============================================================
describe('关键词联想补全', () => {
  it('前缀"素"应返回素描相关 token', () => {
    const result = imageSearchService.suggest(TENANT_A, 'admin', { q: '素' });
    expect(result.suggestions.length).toBeGreaterThan(0);
    expect(result.suggestions.some((s) => s.startsWith('素'))).toBe(true);
  });

  it('前缀"色"应返回色彩相关 token', () => {
    const result = imageSearchService.suggest(TENANT_A, 'admin', { q: '色' });
    expect(result.suggestions.some((s) => s.startsWith('色'))).toBe(true);
  });

  it('空查询应返回空列表', () => {
    const result = imageSearchService.suggest(TENANT_A, 'admin', { q: '' });
    expect(result.suggestions).toEqual([]);
  });

  it('limit 应限制返回条数', () => {
    const result = imageSearchService.suggest(TENANT_A, 'admin', { q: '素', limit: 2 });
    expect(result.suggestions.length).toBeLessThanOrEqual(2);
  });

  it('所有建议词都应以查询前缀开头', () => {
    const result = imageSearchService.suggest(TENANT_A, 'admin', { q: '素描' });
    for (const s of result.suggestions) {
      expect(s.startsWith('素描')).toBe(true);
    }
  });

  it('学生角色应过滤掉仅来自 draft/archived 图片的 token', () => {
    // "铜像"标签仅出现在 draft 状态的"海鸥少女像"中
    const adminResult = imageSearchService.suggest(TENANT_A, 'admin', { q: '铜' });
    const studentResult = imageSearchService.suggest(TENANT_A, 'student', { q: '铜' });
    // admin 能看到"铜像"
    expect(adminResult.suggestions.some((s) => s === '铜像')).toBe(true);
    // student 不应看到仅来自 draft 的 token
    expect(studentResult.suggestions.some((s) => s === '铜像')).toBe(false);
  });
});

// ============================================================
// 5. 筛选
// ============================================================
describe('筛选', () => {
  it('标签筛选应为 AND 语义(同时包含全部标签)', () => {
    const result = imageSearchService.search(TENANT_A, 'admin', { tags: '素描,基础' });
    expect(result.total).toBeGreaterThanOrEqual(1);
    for (const item of result.items) {
      expect(item.tags).toContain('素描');
      expect(item.tags).toContain('基础');
    }
  });

  it('分类筛选应仅返回该分类条目', () => {
    const result = imageSearchService.search(TENANT_A, 'admin', { category: '色彩理论' });
    expect(result.total).toBeGreaterThanOrEqual(2);
    for (const item of result.items) {
      expect(item.category).toBe('色彩理论');
    }
  });

  it('状态筛选 draft 应仅返回草稿条目(admin)', () => {
    const result = imageSearchService.search(TENANT_A, 'admin', { status: 'draft' });
    expect(result.total).toBe(1);
    expect(result.items[0]?.status).toBe('draft');
  });

  it('组合筛选:q + category 应同时生效', () => {
    const result = imageSearchService.search(TENANT_A, 'admin', {
      q: '素描',
      category: '绘画基础',
    });
    expect(result.total).toBeGreaterThanOrEqual(1);
    expect(result.items[0]?.category).toBe('绘画基础');
  });
});

// ============================================================
// 6. 分页
// ============================================================
describe('分页', () => {
  it('应正确分页(pageSize=6,共20条 published → 4页:6+6+6+2)', () => {
    const page1 = imageSearchService.search(TENANT_A, 'admin', { page: 1, pageSize: 6 });
    expect(page1.items).toHaveLength(6);
    expect(page1.hasMore).toBe(true);
    expect(page1.page).toBe(1);
    expect(page1.pageSize).toBe(6);

    const page2 = imageSearchService.search(TENANT_A, 'admin', { page: 2, pageSize: 6 });
    expect(page2.items).toHaveLength(6);
    expect(page2.hasMore).toBe(true);

    const page3 = imageSearchService.search(TENANT_A, 'admin', { page: 3, pageSize: 6 });
    expect(page3.items).toHaveLength(6);
    expect(page3.hasMore).toBe(true);

    const page4 = imageSearchService.search(TENANT_A, 'admin', { page: 4, pageSize: 6 });
    expect(page4.items).toHaveLength(2);
    expect(page4.hasMore).toBe(false);

    // 四页无重复
    const ids = new Set(
      [...page1.items, ...page2.items, ...page3.items, ...page4.items].map((i) => i.id),
    );
    expect(ids.size).toBe(20);
  });

  it('超出页码范围应返回空列表', () => {
    const result = imageSearchService.search(TENANT_A, 'admin', { page: 99, pageSize: 5 });
    expect(result.items).toEqual([]);
    expect(result.total).toBe(20);
  });
});

// ============================================================
// 7. 多租户隔离
// ============================================================
describe('多租户隔离', () => {
  it('租户B创建的条目不应出现在租户A的搜索结果中', () => {
    const created = imageSearchService.create(TENANT_B, ADMIN_USER, {
      title: '租户B的独家作品',
      tags: ['独家'],
      category: '内部资料',
      status: 'published',
      thumbUrl: '/uploads/b-thumb.jpg',
      fullUrl: '/uploads/b-full.jpg',
      meta: { width: 800, height: 600, size: 100000 },
    });

    const resultA = imageSearchService.search(TENANT_A, 'admin', { q: '独家作品' });
    expect(resultA.total).toBe(0);

    const resultB = imageSearchService.search(TENANT_B, 'admin', { q: '独家作品' });
    expect(resultB.total).toBe(1);
    expect(resultB.items[0]?.id).toBe(created.id);
  });

  it('跨租户 getById 应返回 null(不泄露存在性)', () => {
    const created = imageSearchService.create(TENANT_B, ADMIN_USER, {
      title: '隔离测试',
      tags: [],
      category: '测试',
      status: 'published',
      thumbUrl: '/uploads/iso-thumb.jpg',
      fullUrl: '/uploads/iso-full.jpg',
    });
    expect(imageSearchService.getById(TENANT_A, 'admin', created.id)).toBeNull();
    expect(imageSearchService.getById(TENANT_B, 'admin', created.id)?.id).toBe(created.id);
  });
});

// ============================================================
// 8. CRUD
// ============================================================
describe('CRUD', () => {
  it('创建条目后应立即可被搜索到(索引同步)', () => {
    const before = imageSearchService.search(TENANT_A, 'admin', { q: '岩彩画' });
    expect(before.total).toBe(0);

    const created = imageSearchService.create(TENANT_A, ADMIN_USER, {
      title: '岩彩画材料入门',
      tags: ['岩彩', '材料'],
      category: '材料技法',
      status: 'published',
      thumbUrl: '/uploads/yancai-thumb.jpg',
      fullUrl: '/uploads/yancai-full.jpg',
      meta: { width: 1000, height: 800, size: 200000 },
    });
    expect(created.id).toMatch(/^img-/);
    expect(created.createdById).toBe(ADMIN_USER);

    const after = imageSearchService.search(TENANT_A, 'admin', { q: '岩彩画' });
    expect(after.total).toBe(1);
    expect(after.items[0]?.id).toBe(created.id);
  });

  it('更新标题后搜索新词应命中,旧词不再命中该条目', () => {
    const created = imageSearchService.create(TENANT_A, ADMIN_USER, {
      title: '旧标题甲',
      tags: ['测试'],
      category: '测试',
      status: 'published',
      thumbUrl: '/uploads/old-thumb.jpg',
      fullUrl: '/uploads/old-full.jpg',
    });

    const updated = imageSearchService.update(TENANT_A, created.id, ADMIN_USER, {
      title: '水彩风景写生',
    });
    expect(updated?.title).toBe('水彩风景写生');
    expect(updated?.updatedById).toBe(ADMIN_USER);

    const hitNew = imageSearchService.search(TENANT_A, 'admin', { q: '水彩风景' });
    expect(hitNew.items.some((i) => i.id === created.id)).toBe(true);

    // 新旧标题完全无公共字,旧词不应再命中
    const hitOld = imageSearchService.search(TENANT_A, 'admin', { q: '旧标题' });
    expect(hitOld.items.some((i) => i.id === created.id)).toBe(false);
  });

  it('删除条目后应不可见', () => {
    const created = imageSearchService.create(TENANT_A, ADMIN_USER, {
      title: '待删除条目',
      tags: [],
      category: '测试',
      status: 'published',
      thumbUrl: '/uploads/del-thumb.jpg',
      fullUrl: '/uploads/del-full.jpg',
    });
    expect(imageSearchService.remove(TENANT_A, created.id)).toBe(true);
    expect(imageSearchService.getById(TENANT_A, 'admin', created.id)).toBeNull();
    // 重复删除返回 false
    expect(imageSearchService.remove(TENANT_A, created.id)).toBe(false);
  });

  it('更新不存在的条目应返回 null', () => {
    expect(
      imageSearchService.update(TENANT_A, 'img-nonexistent', ADMIN_USER, { title: 'x' }),
    ).toBeNull();
  });
});

// ============================================================
// 9. 角色权限强制
// ============================================================
describe('角色权限强制', () => {
  it('student 即使传 status=draft 也应被强制为 published', () => {
    const result = imageSearchService.search(TENANT_A, 'student', { status: 'draft' });
    // student 被强制为 published,返回 20 条而非 1 条 draft
    expect(result.total).toBe(20);
    expect(result.items.every((i) => i.status === 'published')).toBe(true);
  });

  it('student 即使传 status=archived 也应被强制为 published', () => {
    const result = imageSearchService.search(TENANT_A, 'student', { status: 'archived' });
    expect(result.total).toBe(20);
    expect(result.items.every((i) => i.status === 'published')).toBe(true);
  });

  it('teacher 可检索 draft 状态', () => {
    const result = imageSearchService.search(TENANT_A, 'teacher', { status: 'draft' });
    expect(result.total).toBe(1);
    expect(result.items[0]?.status).toBe('draft');
  });

  it('admin 可检索 archived 状态', () => {
    const result = imageSearchService.search(TENANT_A, 'admin', { status: 'archived' });
    expect(result.total).toBe(1);
    expect(result.items[0]?.status).toBe('archived');
  });

  it('student getById 不可见 draft 条目(返回 null)', () => {
    // 先查出 draft 条目的 id(admin 视角)
    const draft = imageSearchService.search(TENANT_A, 'admin', { status: 'draft' });
    expect(draft.total).toBe(1);
    const draftId = draft.items[0]!.id;

    // student 查看该 id 应返回 null(不泄露存在性)
    expect(imageSearchService.getById(TENANT_A, 'student', draftId)).toBeNull();
    // teacher / admin 可见
    expect(imageSearchService.getById(TENANT_A, 'teacher', draftId)?.id).toBe(draftId);
    expect(imageSearchService.getById(TENANT_A, 'admin', draftId)?.id).toBe(draftId);
  });

  it('student getById 可见 published 条目', () => {
    const published = imageSearchService.search(TENANT_A, 'admin', {
      status: 'published',
      pageSize: 1,
    });
    expect(published.items[0]?.status).toBe('published');
    const pubId = published.items[0]!.id;
    expect(imageSearchService.getById(TENANT_A, 'student', pubId)?.id).toBe(pubId);
  });
});
