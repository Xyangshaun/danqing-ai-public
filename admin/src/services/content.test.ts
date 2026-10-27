// ============================================================
// 内容管理 API - listArtworks 参数透传测试(A2 修复)
// 目标:验证用户详情页"关联作品"请求会携带 userId 过滤。
// 复现:用户详情页展示全量作品(未按用户过滤)。
// 根因:listArtworks 未传 userId。
// 方案:在 queryFn 中传入 userId,此处验证服务层原样透传。
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

const requestMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
}));
vi.mock('./request', () => requestMock);

import { listArtworks, getArtwork, reviewArtwork, deleteArtwork, listTemplates } from './content';

describe('content.ts - listArtworks 透传 userId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('listArtworks 将 query(含 userId)原样透传给 get', () => {
    requestMock.get.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20, hasMore: false });
    listArtworks({ userId: 'user-123', page: 1, pageSize: 20 });
    expect(requestMock.get).toHaveBeenCalledWith('/api/admin/artworks', {
      userId: 'user-123',
      page: 1,
      pageSize: 20,
    });
  });

  it('listArtworks 不传 userId 时,get 不携带 userId 字段', () => {
    requestMock.get.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20, hasMore: false });
    listArtworks({ page: 2, pageSize: 10 });
    expect(requestMock.get).toHaveBeenCalledWith('/api/admin/artworks', { page: 2, pageSize: 10 });
  });

  it('getArtwork 使用 URL 编码路径', () => {
    requestMock.get.mockResolvedValue({});
    getArtwork('art-1');
    expect(requestMock.get).toHaveBeenCalledWith('/api/admin/artworks/art-1');
  });

  it('reviewArtwork 调用 POST 审核端点', () => {
    requestMock.post.mockResolvedValue({});
    reviewArtwork('art-1', { action: 'approve', note: 'ok' });
    expect(requestMock.post).toHaveBeenCalledWith('/api/admin/artworks/art-1/review', {
      action: 'approve',
      note: 'ok',
    });
  });

  it('deleteArtwork 调用 DELETE 端点', () => {
    requestMock.del.mockResolvedValue({ id: 'art-1', deleted: true });
    deleteArtwork('art-1');
    expect(requestMock.del).toHaveBeenCalledWith('/api/admin/artworks/art-1');
  });

  it('listTemplates 透传分页参数', () => {
    requestMock.get.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20, hasMore: false });
    listTemplates({ page: 1, pageSize: 20 });
    expect(requestMock.get).toHaveBeenCalledWith('/api/admin/templates', { page: 1, pageSize: 20 });
  });
});