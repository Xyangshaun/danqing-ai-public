// ============================================================
// 知识库实时检索服务测试
// 对应源码:src/services/knowledge.service.ts
//
// 覆盖范围:
//   1. 分词器(中文二元 / 英文单词 / 混合)
//   2. 种子数据加载(每租户 14 条基线知识)
//   3. 关键词搜索(召回 / 相关性排序 / score 归一化)
//   4. 筛选(标签 AND / 分类 / 作品类型 / 状态)
//   5. 分页(page / pageSize / hasMore)
//   6. 多租户隔离(跨租户不可见)
//   7. CRUD(创建 / 更新 / 删除 + 索引同步)
//   8. 索引状态与重建
//   9. 搜索权限预校验(学生禁搜 draft/archived)
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { knowledgeService } from '../src/services/knowledge.service.js';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';
const ADMIN_USER = 'admin-user-1';

beforeEach(() => {
  knowledgeService.__clearForTest();
});

// ============================================================
// 1. 分词器
// ============================================================
describe('tokenize 分词器', () => {
  it('应将连续中文切为滑动窗口二元组', () => {
    const tokens = knowledgeService.tokenize('素描基础');
    expect(tokens).toEqual(['素描', '描基', '基础']);
  });

  it('应保留单个汉字', () => {
    expect(knowledgeService.tokenize('画')).toEqual(['画']);
  });

  it('应将英文转小写并按单词切分', () => {
    expect(knowledgeService.tokenize('Hello World')).toEqual(['hello', 'world']);
  });

  it('应支持中英文混合分词', () => {
    const tokens = knowledgeService.tokenize('CRAP原则');
    expect(tokens).toContain('crap');
    expect(tokens).toContain('原则');
  });

  it('应对空字符串返回空数组', () => {
    expect(knowledgeService.tokenize('')).toEqual([]);
  });
});

// ============================================================
// 2. 种子数据
// ============================================================
describe('种子数据加载', () => {
  it('首次访问应自动注入 14 条种子条目', () => {
    const status = knowledgeService.getIndexStatus(TENANT_A);
    expect(status.totalDocs).toBe(14);
    expect(status.indexedDocs).toBe(14);
    expect(status.ready).toBe(true);
    expect(status.indexType).toBe('keyword');
  });

  it('默认搜索应仅返回 published 条目(12条,draft/archived 各1条被过滤)', () => {
    const result = knowledgeService.search(TENANT_A, 'admin', {});
    expect(result.total).toBe(12);
    expect(result.items.every((i) => i.status === 'published')).toBe(true);
  });
});

// ============================================================
// 3. 关键词搜索
// ============================================================
describe('关键词搜索', () => {
  it('搜索"素描"应召回素描相关条目并按相关性排序', () => {
    const result = knowledgeService.search(TENANT_A, 'admin', { q: '素描' });
    expect(result.total).toBeGreaterThanOrEqual(3);
    // 标题含"素描"的条目应排在最前
    expect(result.items[0]?.title).toContain('素描');
    // score 应归一化到 0-1,首条为 1
    expect(result.items[0]?.score).toBe(1);
    for (const item of result.items) {
      expect(item.score).toBeGreaterThan(0);
      expect(item.score).toBeLessThanOrEqual(1);
    }
  });

  it('短语"三大面五大调"应精确命中标题并获得最高分', () => {
    const result = knowledgeService.search(TENANT_A, 'admin', { q: '三大面五大调' });
    expect(result.total).toBeGreaterThanOrEqual(1);
    expect(result.items[0]?.title).toBe('素描的三大面五大调');
  });

  it('搜索"透视"应命中透视原理条目', () => {
    const result = knowledgeService.search(TENANT_A, 'admin', { q: '透视' });
    const titles = result.items.map((i) => i.title);
    expect(titles.some((t) => t.includes('透视'))).toBe(true);
  });

  it('英文关键词"crap"应命中版式设计条目', () => {
    const result = knowledgeService.search(TENANT_A, 'admin', { q: 'crap' });
    expect(result.total).toBeGreaterThanOrEqual(1);
    expect(result.items[0]?.title).toContain('版式');
  });

  it('无匹配关键词应返回空结果', () => {
    const result = knowledgeService.search(TENANT_A, 'admin', { q: '量子力学' });
    expect(result.total).toBe(0);
    expect(result.items).toEqual([]);
    expect(result.hasMore).toBe(false);
  });

  it('空关键词应返回全部 published 条目(按更新时间排序)', () => {
    const result = knowledgeService.search(TENANT_A, 'admin', { q: '' });
    expect(result.total).toBe(12);
    // 空查询不返回 score
    expect(result.items[0]?.score).toBeUndefined();
  });
});

// ============================================================
// 4. 筛选
// ============================================================
describe('筛选', () => {
  it('标签筛选应为 AND 语义(同时包含全部标签)', () => {
    const result = knowledgeService.search(TENANT_A, 'admin', { tags: '素描,基础' });
    expect(result.total).toBeGreaterThanOrEqual(1);
    for (const item of result.items) {
      expect(item.tags).toContain('素描');
      expect(item.tags).toContain('基础');
    }
  });

  it('分类筛选应仅返回该分类条目', () => {
    const result = knowledgeService.search(TENANT_A, 'admin', { category: '应试指导' });
    expect(result.total).toBeGreaterThanOrEqual(2);
    for (const item of result.items) {
      expect(item.category).toBe('应试指导');
    }
  });

  it('作品类型筛选应仅返回该类型条目', () => {
    const result = knowledgeService.search(TENANT_A, 'admin', { artType: 'sculpture' });
    expect(result.total).toBe(1);
    expect(result.items[0]?.title).toContain('雕塑');
  });

  it('状态筛选 draft 应仅返回草稿条目', () => {
    const result = knowledgeService.search(TENANT_A, 'admin', { status: 'draft' });
    expect(result.total).toBe(1);
    expect(result.items[0]?.status).toBe('draft');
  });

  it('组合筛选:q + category 应同时生效', () => {
    const result = knowledgeService.search(TENANT_A, 'admin', { q: '素描', category: '应试指导' });
    expect(result.total).toBeGreaterThanOrEqual(1);
    expect(result.items[0]?.category).toBe('应试指导');
  });
});

// ============================================================
// 5. 分页
// ============================================================
describe('分页', () => {
  it('应正确分页(pageSize=5,共12条 → 3页)', () => {
    const page1 = knowledgeService.search(TENANT_A, 'admin', { page: 1, pageSize: 5 });
    expect(page1.items).toHaveLength(5);
    expect(page1.hasMore).toBe(true);
    expect(page1.page).toBe(1);
    expect(page1.pageSize).toBe(5);

    const page2 = knowledgeService.search(TENANT_A, 'admin', { page: 2, pageSize: 5 });
    expect(page2.items).toHaveLength(5);
    expect(page2.hasMore).toBe(true);

    const page3 = knowledgeService.search(TENANT_A, 'admin', { page: 3, pageSize: 5 });
    expect(page3.items).toHaveLength(2);
    expect(page3.hasMore).toBe(false);

    // 三页无重复
    const ids = new Set([...page1.items, ...page2.items, ...page3.items].map((i) => i.id));
    expect(ids.size).toBe(12);
  });

  it('超出页码范围应返回空列表', () => {
    const result = knowledgeService.search(TENANT_A, 'admin', { page: 99, pageSize: 5 });
    expect(result.items).toEqual([]);
    expect(result.total).toBe(12);
  });
});

// ============================================================
// 6. 多租户隔离
// ============================================================
describe('多租户隔离', () => {
  it('租户B创建的条目不应出现在租户A的搜索结果中', () => {
    const created = knowledgeService.create(TENANT_B, ADMIN_USER, {
      title: '租户B的独家秘方',
      summary: '这是租户B特有的知识条目',
      content: '内容保密',
      category: '内部资料',
      status: 'published',
    });

    const resultA = knowledgeService.search(TENANT_A, 'admin', { q: '独家秘方' });
    expect(resultA.total).toBe(0);

    const resultB = knowledgeService.search(TENANT_B, 'admin', { q: '独家秘方' });
    expect(resultB.total).toBe(1);
    expect(resultB.items[0]?.id).toBe(created.id);
  });

  it('跨租户 getById 应返回 null(不泄露存在性)', () => {
    const created = knowledgeService.create(TENANT_B, ADMIN_USER, {
      title: '隔离测试',
      summary: '摘要',
      content: '内容',
      category: '测试',
    });
    expect(knowledgeService.getById(TENANT_A, created.id)).toBeNull();
    expect(knowledgeService.getById(TENANT_B, created.id)?.id).toBe(created.id);
  });
});

// ============================================================
// 7. CRUD
// ============================================================
describe('CRUD', () => {
  it('创建条目后应立即可被搜索到(索引同步)', () => {
    const before = knowledgeService.search(TENANT_A, 'admin', { q: '岩彩画' });
    expect(before.total).toBe(0);

    const created = knowledgeService.create(TENANT_A, ADMIN_USER, {
      title: '岩彩画材料入门',
      summary: '岩彩颜料与基底处理',
      content: '岩彩画使用天然矿物颜料',
      category: '材料技法',
      status: 'published',
    });
    expect(created.id).toMatch(/^kn-/);
    expect(created.createdById).toBe(ADMIN_USER);

    const after = knowledgeService.search(TENANT_A, 'admin', { q: '岩彩画' });
    expect(after.total).toBe(1);
    expect(after.items[0]?.id).toBe(created.id);
  });

  it('更新标题后搜索新词应命中,旧词不再命中该条目', () => {
    const created = knowledgeService.create(TENANT_A, ADMIN_USER, {
      title: '旧标题甲',
      summary: '摘要',
      content: '内容',
      category: '测试',
      status: 'published',
    });

    const updated = knowledgeService.update(TENANT_A, created.id, ADMIN_USER, {
      title: '水彩风景写生',
    });
    expect(updated?.title).toBe('水彩风景写生');
    expect(updated?.updatedById).toBe(ADMIN_USER);

    const hitNew = knowledgeService.search(TENANT_A, 'admin', { q: '水彩风景' });
    expect(hitNew.items.some((i) => i.id === created.id)).toBe(true);

    // 注:二元分词下共享 bigram 会模糊命中(与 ES n-gram 行为一致),
    // 此处新旧标题完全无公共字,旧词不应再命中
    const hitOld = knowledgeService.search(TENANT_A, 'admin', { q: '旧标题甲' });
    expect(hitOld.items.some((i) => i.id === created.id)).toBe(false);
  });

  it('删除条目后应不可见', () => {
    const created = knowledgeService.create(TENANT_A, ADMIN_USER, {
      title: '待删除条目',
      summary: '摘要',
      content: '内容',
      category: '测试',
    });
    expect(knowledgeService.remove(TENANT_A, created.id)).toBe(true);
    expect(knowledgeService.getById(TENANT_A, created.id)).toBeNull();
    // 重复删除返回 false
    expect(knowledgeService.remove(TENANT_A, created.id)).toBe(false);
  });

  it('更新不存在的条目应返回 null', () => {
    expect(knowledgeService.update(TENANT_A, 'kn-nonexistent', ADMIN_USER, { title: 'x' })).toBeNull();
  });
});

// ============================================================
// 8. 索引状态与重建
// ============================================================
describe('索引状态与重建', () => {
  it('重建索引应返回 completed 与正确文档数', () => {
    const result = knowledgeService.rebuildIndex(TENANT_A);
    expect(result.status).toBe('completed');
    expect(result.rebuiltCount).toBe(14);
    expect(result.taskId).toMatch(/^rebuild-/);
  });

  it('创建/删除后索引状态文档数应同步变化', () => {
    const created = knowledgeService.create(TENANT_A, ADMIN_USER, {
      title: '计数测试',
      summary: '摘要',
      content: '内容',
      category: '测试',
    });
    expect(knowledgeService.getIndexStatus(TENANT_A).totalDocs).toBe(15);

    knowledgeService.remove(TENANT_A, created.id);
    expect(knowledgeService.getIndexStatus(TENANT_A).totalDocs).toBe(14);
  });
});

// ============================================================
// 9. 搜索权限预校验
// ============================================================
describe('搜索权限预校验', () => {
  it('学生检索 published 应放行并校准分页参数', () => {
    const result = knowledgeService.validateSearch('student', {
      q: '  素描  ',
      page: 0,
      pageSize: 500,
    });
    expect(result.allowed).toBe(true);
    expect(result.reason).toBeNull();
    expect(result.sanitizedQuery.page).toBe(1);
    expect(result.sanitizedQuery.pageSize).toBe(100);
    expect(result.sanitizedQuery.q).toBe('素描');
    expect(result.sanitizedQuery.status).toBe('published');
  });

  it('学生检索 draft 应拒绝并回退为 published', () => {
    const result = knowledgeService.validateSearch('student', { status: 'draft' });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('无权');
    expect(result.sanitizedQuery.status).toBe('published');
  });

  it('教师检索 archived 应放行', () => {
    const result = knowledgeService.validateSearch('teacher', { status: 'archived' });
    expect(result.allowed).toBe(true);
    expect(result.sanitizedQuery.status).toBe('archived');
  });

  it('管理员检索 draft 应放行', () => {
    const result = knowledgeService.validateSearch('admin', { status: 'draft' });
    expect(result.allowed).toBe(true);
  });
});

// ============================================================
// 10. 服务端角色策略强制(安全回归:防越权检索 draft/archived)
// ============================================================
describe('服务端角色策略强制(安全回归)', () => {
  it('学生显式传 status=draft 应被强制回退为 published', () => {
    const result = knowledgeService.search(TENANT_A, 'student', { status: 'draft' });
    expect(result.total).toBe(12);
    expect(result.items.every((i) => i.status === 'published')).toBe(true);
  });

  it('学生传 status=archived 同样被强制回退为 published', () => {
    const result = knowledgeService.search(TENANT_A, 'student', { status: 'archived' });
    expect(result.total).toBe(12);
    expect(result.items.every((i) => i.status === 'published')).toBe(true);
  });

  it('学生默认搜索不应包含 draft/archived 条目', () => {
    const result = knowledgeService.search(TENANT_A, 'student', {});
    expect(result.total).toBe(12);
  });

  it('教师传 status=draft 应正常返回草稿条目', () => {
    const result = knowledgeService.search(TENANT_A, 'teacher', { status: 'draft' });
    expect(result.total).toBe(1);
    expect(result.items[0]?.status).toBe('draft');
  });

  it('教师传 status=archived 应正常返回归档条目', () => {
    const result = knowledgeService.search(TENANT_A, 'teacher', { status: 'archived' });
    expect(result.total).toBe(1);
    expect(result.items[0]?.status).toBe('archived');
  });

  it('学生关键词搜索命中草稿条目时应被过滤', () => {
    // 种子中 draft 条目含"速写"标签,学生搜索"速写"不应召回该草稿
    const result = knowledgeService.search(TENANT_A, 'student', { q: '校考创意速写' });
    expect(result.items.every((i) => i.status === 'published')).toBe(true);
    // 教师搜索同一词应召回草稿
    const teacherResult = knowledgeService.search(TENANT_A, 'teacher', { q: '校考创意速写', status: 'draft' });
    expect(teacherResult.total).toBe(1);
  });
});
