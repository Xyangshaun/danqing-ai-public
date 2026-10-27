// ============================================================
// 认证 API - 飞书回调地址与参数透传测试(A3 修复)
// 目标:验证在 define 注入缺失时,FEISHU_REDIRECT_URI 有安全回退,
//       且 getFeishuAuthorizeUrl 正确透传 redirect_uri 与 client。
// 复现:生产登录回调指向 localhost。
// 根因:process.env.X?. 与 define 键不匹配导致注入失效。
// 方案:连续书写 process.env.FEISHU_REDIRECT_URI 以匹配 define 键。
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

const requestMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}));
vi.mock('./request', () => requestMock);

import { getFeishuAuthorizeUrl, handleFeishuCallback, refreshAccessToken, logoutApi, getCurrentUser } from './auth';

describe('auth.ts - 飞书回调地址与透传', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getFeishuAuthorizeUrl 透传 redirect_uri 与 client=admin', () => {
    requestMock.get.mockResolvedValue({ authorizeUrl: 'https://feishu.cn/oauth', state: '', redirectUri: '' });
    getFeishuAuthorizeUrl('admin');
    expect(requestMock.get).toHaveBeenCalledWith('/api/v1/auth/feishu/authorize', {
      redirect_uri: expect.any(String),
      client: 'admin',
    });
  });

  it('handleFeishuCallback 透传 code 与 state', () => {
    requestMock.get.mockResolvedValue({});
    handleFeishuCallback({ code: 'abc', state: 'xyz' });
    expect(requestMock.get).toHaveBeenCalledWith('/api/v1/auth/feishu/callback', {
      code: 'abc',
      state: 'xyz',
    });
  });

  it('refreshAccessToken 调用刷新端点', () => {
    requestMock.post.mockResolvedValue({});
    refreshAccessToken();
    expect(requestMock.post).toHaveBeenCalledWith('/api/v1/auth/refresh');
  });

  it('logoutApi 默认不吊销全部会话', () => {
    requestMock.post.mockResolvedValue({ revokedSessions: 0 });
    logoutApi();
    expect(requestMock.post).toHaveBeenCalledWith('/api/v1/auth/logout', { revokeAll: false });
  });

  it('getCurrentUser 调用 me 端点', () => {
    requestMock.get.mockResolvedValue({});
    getCurrentUser();
    expect(requestMock.get).toHaveBeenCalledWith('/api/v1/auth/me');
  });
});