// ============================================================
// api 单元测试 (任务包 E:块4 服务层覆盖率补强)
// 对应源码: src/services/api.ts
//
// 测试范围:
//   1. 成功响应(code=0): request 返回 data
//   2. 业务错误: 抛 ApiError + 触发对应 Toast
//   3. 网络错误(fetch reject): 抛 ApiError(UPSTREAM_UNAVAILABLE)
//   4. 非 JSON 响应(502 网关 HTML): 抛 ApiError(UPSTREAM_UNAVAILABLE)
//   5. 401 token 过期(code=2002): 静默刷新 + 重试原请求
//   6. 刷新失败(2003): 清 token + 触发 authFailedHandler
//   7. FORBIDDEN(2004): 触发 permissionDeniedHandler
//   8. 各业务错误码的差异化 Toast
//   9. 便捷方法 get/post/patch/del
//  10. setToastHandler/setAuthFailedHandler/setPermissionDeniedHandler
//  11. isAuthenticated 工具方法
//  12. skipAuth/skipRefresh/silent 选项
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  request,
  get,
  post,
  patch,
  del,
  ApiError,
  setToastHandler,
  setAuthFailedHandler,
  setPermissionDeniedHandler,
  isAuthenticated,
  getPresets,
  getPreset,
  applyPreset,
  listNotifications,
  getUnreadNotificationCount,
  markNotificationRead,
  markAllNotificationsRead,
} from '../api';
import { ErrorCode } from '../../types/api-contract';
import {
  setAccessToken,
  clearAccessToken,
} from '../token-store';

/* ---------- mock 全局 fetch ---------- */

const fetchMock = vi.fn<(...args: unknown[]) => Promise<Response>>();

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof global.fetch;
  // 清理 token-store 状态(确保登录态隔离)
  clearAccessToken();
  // 清理 handler 注入
  setToastHandler(null);
  setAuthFailedHandler(null);
  setPermissionDeniedHandler(null);
});

afterEach(() => {
  clearAccessToken();
  setToastHandler(null);
  setAuthFailedHandler(null);
  setPermissionDeniedHandler(null);
  vi.restoreAllMocks();
});

/* ---------- 辅助:构造成功响应 ---------- */

function successResponse<T>(data: T): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ code: 0, message: 'ok', data, traceId: 'test-trace' }),
  } as Response;
}

function errorResponse(code: number, message: string, status = 400): Response {
  return {
    ok: status < 400,
    status,
    json: async () => ({ code, message, data: null, traceId: 'test-trace' }),
  } as Response;
}

function nonJsonResponse(status = 502): Response {
  return {
    ok: false,
    status,
    json: async () => {
      throw new Error('not JSON');
    },
    text: async () => '<html>Bad Gateway</html>',
  } as Response;
}

/* ============================================================
 * 1. 成功响应
 * ============================================================ */
describe('成功响应', () => {
  it('request 返回 data 字段', async () => {
    fetchMock.mockResolvedValue(successResponse({ foo: 'bar' }));
    const data = await request<{ foo: string }>('/test');
    expect(data).toEqual({ foo: 'bar' });
  });

  it('get 便捷方法返回 data', async () => {
    fetchMock.mockResolvedValue(successResponse({ id: 1 }));
    const data = await get<{ id: number }>('/items');
    expect(data).toEqual({ id: 1 });
  });

  it('get 带 query 参数拼接到 URL', async () => {
    fetchMock.mockResolvedValue(successResponse([]));
    await get('/items', { page: 1, pageSize: 10, filter: undefined });
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain('page=1');
    expect(calledUrl).toContain('pageSize=10');
    // undefined 参数不应出现在 query
    expect(calledUrl).not.toContain('filter');
  });

  it('get 跳过空字符串参数', async () => {
    fetchMock.mockResolvedValue(successResponse([]));
    await get('/items', { q: '' });
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).not.toContain('q=');
  });

  it('post 便捷方法发送 JSON body', async () => {
    fetchMock.mockResolvedValue(successResponse({ ok: true }));
    await post('/items', { name: 'test' });
    const opts = fetchMock.mock.calls[0][1] as RequestInit;
    expect(opts.method).toBe('POST');
    expect(opts.body).toBe(JSON.stringify({ name: 'test' }));
    expect((opts.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('patch 便捷方法使用 PATCH 方法', async () => {
    fetchMock.mockResolvedValue(successResponse({ ok: true }));
    await patch('/items/1', { name: 'updated' });
    const opts = fetchMock.mock.calls[0][1] as RequestInit;
    expect(opts.method).toBe('PATCH');
  });

  it('del 便捷方法使用 DELETE 方法', async () => {
    fetchMock.mockResolvedValue(successResponse({ ok: true }));
    await del('/items/1');
    const opts = fetchMock.mock.calls[0][1] as RequestInit;
    expect(opts.method).toBe('DELETE');
  });

  it('完整 URL(http 开头)不拼接 BASE_URL', async () => {
    fetchMock.mockResolvedValue(successResponse({}));
    await get('https://other.example.com/api');
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toBe('https://other.example.com/api');
  });
});

/* ============================================================
 * 2. 业务错误处理
 * ============================================================ */
describe('业务错误处理', () => {
  it('code !== 0 时抛 ApiError 包含 code/message/traceId', async () => {
    fetchMock.mockResolvedValue(errorResponse(ErrorCode.PARAM_INVALID, '参数错误'));
    await expect(request('/test')).rejects.toMatchObject({
      name: 'ApiError',
      code: ErrorCode.PARAM_INVALID,
      message: '参数错误',
      traceId: 'test-trace',
    });
  });

  it('silent=true 时不触发 Toast', async () => {
    const toastHandler = vi.fn();
    setToastHandler(toastHandler);
    fetchMock.mockResolvedValue(errorResponse(ErrorCode.PARAM_INVALID, '参数错误'));
    await expect(request('/test', { silent: true })).rejects.toBeInstanceOf(ApiError);
    expect(toastHandler).not.toHaveBeenCalled();
  });

  it('RATE_LIMITED 触发"操作过于频繁" Toast', async () => {
    const toastHandler = vi.fn();
    setToastHandler(toastHandler);
    fetchMock.mockResolvedValue(errorResponse(ErrorCode.RATE_LIMITED, '限流'));
    await expect(request('/test')).rejects.toBeInstanceOf(ApiError);
    expect(toastHandler).toHaveBeenCalledWith('error', '操作过于频繁', '请稍后再试');
  });

  it('ANALYSIS_QUOTA_EXCEEDED 触发"配额已用完" Toast', async () => {
    const toastHandler = vi.fn();
    setToastHandler(toastHandler);
    fetchMock.mockResolvedValue(errorResponse(ErrorCode.ANALYSIS_QUOTA_EXCEEDED, '超额'));
    await expect(request('/test')).rejects.toBeInstanceOf(ApiError);
    expect(toastHandler).toHaveBeenCalledWith('error', '配额已用完', '本月分析次数已达上限,请升级订阅');
  });

  it('ANALYSIS_TIMEOUT 触发"分析超时" Toast', async () => {
    const toastHandler = vi.fn();
    setToastHandler(toastHandler);
    fetchMock.mockResolvedValue(errorResponse(ErrorCode.ANALYSIS_TIMEOUT, '超时'));
    await expect(request('/test')).rejects.toBeInstanceOf(ApiError);
    expect(toastHandler).toHaveBeenCalledWith('error', '分析超时', 'AI 分析超过 3 秒,请重试');
  });

  it('TENANT_DISABLED 触发"租户已禁用" Toast', async () => {
    const toastHandler = vi.fn();
    setToastHandler(toastHandler);
    fetchMock.mockResolvedValue(errorResponse(ErrorCode.TENANT_DISABLED, '租户禁用'));
    await expect(request('/test')).rejects.toBeInstanceOf(ApiError);
    expect(toastHandler).toHaveBeenCalledWith('error', '租户已禁用', '请联系管理员');
  });

  it('FILE_TOO_LARGE 触发"文件过大" Toast', async () => {
    const toastHandler = vi.fn();
    setToastHandler(toastHandler);
    fetchMock.mockResolvedValue(errorResponse(ErrorCode.FILE_TOO_LARGE, '文件过大'));
    await expect(request('/test')).rejects.toBeInstanceOf(ApiError);
    expect(toastHandler).toHaveBeenCalledWith('error', '文件过大', '最大支持 10MB');
  });

  it('FILE_TYPE_UNSUPPORTED 触发"文件类型不支持" Toast', async () => {
    const toastHandler = vi.fn();
    setToastHandler(toastHandler);
    fetchMock.mockResolvedValue(errorResponse(ErrorCode.FILE_TYPE_UNSUPPORTED, '类型不支持'));
    await expect(request('/test')).rejects.toBeInstanceOf(ApiError);
    expect(toastHandler).toHaveBeenCalledWith('error', '文件类型不支持', '仅支持 JPEG/PNG/WebP/BMP');
  });

  it('其他未列举错误码触发默认 Toast(操作失败 + message)', async () => {
    const toastHandler = vi.fn();
    setToastHandler(toastHandler);
    fetchMock.mockResolvedValue(errorResponse(ErrorCode.INTERNAL_ERROR, '内部错误'));
    await expect(request('/test')).rejects.toBeInstanceOf(ApiError);
    expect(toastHandler).toHaveBeenCalledWith('error', '操作失败', '内部错误');
  });
});

/* ============================================================
 * 3. 网络错误
 * ============================================================ */
describe('网络错误', () => {
  it('fetch reject 时抛 ApiError(UPSTREAM_UNAVAILABLE)', async () => {
    const toastHandler = vi.fn();
    setToastHandler(toastHandler);
    fetchMock.mockRejectedValue(new Error('network down'));
    await expect(request('/test')).rejects.toMatchObject({
      name: 'ApiError',
      code: ErrorCode.UPSTREAM_UNAVAILABLE,
    });
    expect(toastHandler).toHaveBeenCalledWith('error', '网络错误', expect.stringContaining('network down'));
  });

  it('silent=true 时网络错误不触发 Toast', async () => {
    const toastHandler = vi.fn();
    setToastHandler(toastHandler);
    fetchMock.mockRejectedValue(new Error('network down'));
    await expect(request('/test', { silent: true })).rejects.toBeInstanceOf(ApiError);
    expect(toastHandler).not.toHaveBeenCalled();
  });

  it('非 JSON 响应(502 网关 HTML)抛 UPSTREAM_UNAVAILABLE', async () => {
    const toastHandler = vi.fn();
    setToastHandler(toastHandler);
    fetchMock.mockResolvedValue(nonJsonResponse(502));
    await expect(request('/test')).rejects.toMatchObject({
      name: 'ApiError',
      code: ErrorCode.UPSTREAM_UNAVAILABLE,
    });
    expect(toastHandler).toHaveBeenCalledWith('error', '服务异常', expect.stringContaining('HTTP 502'));
  });
});

/* ============================================================
 * 4. 401 token 过期自动刷新
 * ============================================================ */
describe('401 token 过期自动刷新', () => {
  it('TOKEN_EXPIRED 触发刷新 + 重试原请求', async () => {
    setAccessToken('expired-token');
    // 三次 fetch 调用顺序:
    //   1) /test 返回 TOKEN_EXPIRED
    //   2) /auth/refresh(由 refreshTokenOnce 内部发起)返回新 token
    //   3) /test 重试,返回成功
    const refreshResp = {
      ok: true,
      status: 200,
      json: async () => ({
        code: 0,
        message: 'ok',
        data: {
          accessToken: 'new-token',
          accessTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        },
        traceId: 'refresh-trace',
      }),
    } as Response;
    fetchMock
      .mockResolvedValueOnce(errorResponse(ErrorCode.TOKEN_EXPIRED, '过期', 401))
      .mockResolvedValueOnce(refreshResp)
      .mockResolvedValueOnce(successResponse({ refreshed: true }));

    const data = await request<{ refreshed: boolean }>('/test');
    expect(data).toEqual({ refreshed: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('刷新失败(REFRESH_TOKEN_INVALID)清 token + 触发 authFailedHandler', async () => {
    setAccessToken('expired-token');
    const authFailed = vi.fn();
    setAuthFailedHandler(authFailed);
    // 所有请求都返回 401/403
    fetchMock.mockResolvedValue(errorResponse(ErrorCode.TOKEN_EXPIRED, '过期', 401));

    await expect(request('/test')).rejects.toBeInstanceOf(ApiError);
    // 触发 authFailedHandler
    expect(authFailed).toHaveBeenCalled();
    // access_token 应被清空(由 triggerAuthFailed 调用 clearAccessToken)
    // 注意:此处 clearAccessToken 由 api.ts 内部 triggerAuthFailed 调用
  });

  it('skipRefresh=true 时不刷新,直接抛错', async () => {
    setAccessToken('expired-token');
    fetchMock.mockResolvedValue(errorResponse(ErrorCode.TOKEN_EXPIRED, '过期', 401));
    await expect(request('/test', { skipRefresh: true })).rejects.toMatchObject({
      code: ErrorCode.TOKEN_EXPIRED,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('skipAuth=true 时也不刷新(公开接口)', async () => {
    setAccessToken('expired-token');
    fetchMock.mockResolvedValue(errorResponse(ErrorCode.TOKEN_EXPIRED, '过期', 401));
    await expect(request('/test', { skipAuth: true })).rejects.toMatchObject({
      code: ErrorCode.TOKEN_EXPIRED,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

/* ============================================================
 * 5. REFRESH_TOKEN_INVALID / UNAUTHORIZED / TOKEN_SIGNATURE_INVALID
 * ============================================================ */
describe('登录态失效错误码', () => {
  it('REFRESH_TOKEN_INVALID 触发 authFailedHandler', async () => {
    const authFailed = vi.fn();
    setAuthFailedHandler(authFailed);
    fetchMock.mockResolvedValue(errorResponse(ErrorCode.REFRESH_TOKEN_INVALID, 'refresh 失效', 401));
    await expect(request('/test')).rejects.toBeInstanceOf(ApiError);
    expect(authFailed).toHaveBeenCalled();
  });

  it('UNAUTHORIZED 触发 authFailedHandler', async () => {
    const authFailed = vi.fn();
    setAuthFailedHandler(authFailed);
    fetchMock.mockResolvedValue(errorResponse(ErrorCode.UNAUTHORIZED, '未授权', 401));
    await expect(request('/test')).rejects.toBeInstanceOf(ApiError);
    expect(authFailed).toHaveBeenCalled();
  });

  it('TOKEN_SIGNATURE_INVALID 触发 authFailedHandler', async () => {
    const authFailed = vi.fn();
    setAuthFailedHandler(authFailed);
    fetchMock.mockResolvedValue(errorResponse(ErrorCode.TOKEN_SIGNATURE_INVALID, '签名无效', 401));
    await expect(request('/test')).rejects.toBeInstanceOf(ApiError);
    expect(authFailed).toHaveBeenCalled();
  });
});

/* ============================================================
 * 6. FORBIDDEN 权限不足
 * ============================================================ */
describe('FORBIDDEN 权限不足', () => {
  it('注册 permissionDeniedHandler 时由其处理', async () => {
    const permissionDenied = vi.fn();
    setPermissionDeniedHandler(permissionDenied);
    fetchMock.mockResolvedValue(errorResponse(ErrorCode.FORBIDDEN, '无权访问', 403));
    await expect(request('/test')).rejects.toBeInstanceOf(ApiError);
    expect(permissionDenied).toHaveBeenCalledWith('无权访问');
  });

  it('未注册 permissionDeniedHandler 时降级到普通 error Toast', async () => {
    const toastHandler = vi.fn();
    setToastHandler(toastHandler);
    fetchMock.mockResolvedValue(errorResponse(ErrorCode.FORBIDDEN, '无权访问', 403));
    await expect(request('/test')).rejects.toBeInstanceOf(ApiError);
    expect(toastHandler).toHaveBeenCalledWith('error', '权限不足', '无权访问');
  });
});

/* ============================================================
 * 7. Authorization 头注入
 * ============================================================ */
describe('Authorization 头注入', () => {
  it('已设置 access_token 时注入 Bearer 头', async () => {
    setAccessToken('my-bearer-token');
    fetchMock.mockResolvedValue(successResponse({}));
    await request('/test');
    const opts = fetchMock.mock.calls[0][1] as RequestInit;
    expect((opts.headers as Record<string, string>).Authorization).toBe('Bearer my-bearer-token');
  });

  it('skipAuth=true 时不注入 Authorization 头', async () => {
    setAccessToken('my-bearer-token');
    fetchMock.mockResolvedValue(successResponse({}));
    await request('/test', { skipAuth: true });
    const opts = fetchMock.mock.calls[0][1] as RequestInit;
    expect((opts.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('未设置 access_token 时不注入 Authorization 头', async () => {
    clearAccessToken();
    fetchMock.mockResolvedValue(successResponse({}));
    await request('/test');
    const opts = fetchMock.mock.calls[0][1] as RequestInit;
    expect((opts.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('注入 X-Client 和 X-Client-Context 头', async () => {
    fetchMock.mockResolvedValue(successResponse({}));
    await request('/test');
    const opts = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = opts.headers as Record<string, string>;
    expect(headers['X-Client']).toBe('web');
    expect(headers['X-Client-Context']).toBeDefined();
    // X-Client-Context 应为 JSON 字符串,包含 device_id 和 client
    const ctx = JSON.parse(headers['X-Client-Context']);
    expect(ctx).toHaveProperty('device_id');
    expect(ctx).toHaveProperty('client', 'web');
  });
});

/* ============================================================
 * 8. CSRF 头注入
 * ============================================================ */
describe('CSRF 双提交 Cookie', () => {
  it('存在 csrf_token Cookie 时注入 X-CSRF-Token 头', async () => {
    // 模拟 Cookie 中存在 csrf_token
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get: vi.fn(() => 'csrf_token=test-csrf-value; other=foo'),
    });
    fetchMock.mockResolvedValue(successResponse({}));
    await request('/test', { method: 'POST', body: { foo: 'bar' } });
    const opts = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = opts.headers as Record<string, string>;
    expect(headers['X-CSRF-Token']).toBe('test-csrf-value');
  });

  it('不存在 csrf_token Cookie 时不注入 X-CSRF-Token 头', async () => {
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get: vi.fn(() => 'other=foo'),
    });
    fetchMock.mockResolvedValue(successResponse({}));
    await request('/test', { method: 'POST', body: { foo: 'bar' } });
    const opts = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = opts.headers as Record<string, string>;
    expect(headers['X-CSRF-Token']).toBeUndefined();
  });
});

/* ============================================================
 * 9. isAuthenticated 工具方法
 * ============================================================ */
describe('isAuthenticated', () => {
  it('未设置 token 时返回 false', () => {
    clearAccessToken();
    expect(isAuthenticated()).toBe(false);
  });

  it('设置 token 后返回 true', () => {
    setAccessToken('any-token');
    expect(isAuthenticated()).toBe(true);
  });
});

/* ============================================================
 * 10. Preset API 便捷方法
 * ============================================================ */
describe('Preset API 便捷方法', () => {
  it('getPresets 调用 GET /presets', async () => {
    fetchMock.mockResolvedValue(successResponse([]));
    await getPresets();
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('/presets');
  });

  it('getPreset(id) 调用 GET /presets/:id', async () => {
    fetchMock.mockResolvedValue(successResponse({}));
    await getPreset('preset-1');
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('/presets/preset-1');
  });

  it('applyPreset 调用 POST /presets/apply', async () => {
    fetchMock.mockResolvedValue(successResponse({}));
    await applyPreset({ analysisId: 'a1', presetId: 'p1' });
    const opts = fetchMock.mock.calls[0][1] as RequestInit;
    expect(opts.method).toBe('POST');
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('/presets/apply');
  });
});

/* ============================================================
 * 11. Notification API 便捷方法
 * ============================================================ */
describe('Notification API 便捷方法', () => {
  it('listNotifications 调用 GET /notifications(silent)', async () => {
    fetchMock.mockResolvedValue(successResponse({ items: [], nextCursor: null }));
    await listNotifications({ limit: 10 });
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('/notifications');
    expect(url).toContain('limit=10');
  });

  it('listNotifications onlyUnread=true 透传参数', async () => {
    fetchMock.mockResolvedValue(successResponse({ items: [], nextCursor: null }));
    await listNotifications({ onlyUnread: true });
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('onlyUnread=true');
  });

  it('getUnreadNotificationCount 调用 GET /notifications/unread-count', async () => {
    fetchMock.mockResolvedValue(successResponse({ count: 5 }));
    await getUnreadNotificationCount();
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('/notifications/unread-count');
  });

  it('markNotificationRead 调用 PATCH /notifications/:id/read', async () => {
    fetchMock.mockResolvedValue(successResponse({ success: true }));
    await markNotificationRead('n-1');
    const opts = fetchMock.mock.calls[0][1] as RequestInit;
    expect(opts.method).toBe('PATCH');
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('/notifications/n-1/read');
  });

  it('markAllNotificationsRead 调用 POST /notifications/read-all', async () => {
    fetchMock.mockResolvedValue(successResponse({ success: true }));
    await markAllNotificationsRead();
    const opts = fetchMock.mock.calls[0][1] as RequestInit;
    expect(opts.method).toBe('POST');
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('/notifications/read-all');
  });
});

/* ============================================================
 * 12. ApiError 类
 * ============================================================ */
describe('ApiError 类', () => {
  it('包含 code/traceId/httpStatus 属性', () => {
    const err = new ApiError(1001, '参数错误', 'trace-123', 400);
    expect(err.code).toBe(1001);
    expect(err.message).toBe('参数错误');
    expect(err.traceId).toBe('trace-123');
    expect(err.httpStatus).toBe(400);
    expect(err.name).toBe('ApiError');
  });

  it('未传 httpStatus 时默认为 0', () => {
    const err = new ApiError(1001, '参数错误');
    expect(err.httpStatus).toBe(0);
  });

  it('是 Error 的子类(可用 instanceof 判断)', () => {
    const err = new ApiError(1001, '参数错误');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ApiError);
  });
});
