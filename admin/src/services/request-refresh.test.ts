// ============================================================
// 请求层 - 401 并发刷新失败场景测试(A1 修复)
// 目标:验证触发刷新失败时,排队请求会被唤醒(url 不永久挂起)。
// 复现:刷新 token 失败时,并发请求全部卡死。
// 根因:失败分支未 flush pendingQueue。
// 方案:finally 统一 flush,失败 redirectToLogin。
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---- 依赖 mock ----
vi.mock('antd', () => ({ message: { error: vi.fn(), warning: vi.fn() } }));

const authMock = vi.hoisted(() => ({
  getAccessToken: vi.fn(),
  setAccessToken: vi.fn(),
  clearAccessToken: vi.fn(),
  isTokenExpired: vi.fn(),
}));
vi.mock('@/utils/auth', () => authMock);

// 可调用的 axios 实例 mock(instance(config) 用于重放请求)
interface MockAxiosInstance {
  (): Promise<unknown>;
  request: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  patch: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  interceptors: { request: { use: ReturnType<typeof vi.fn> }; response: { use: ReturnType<typeof vi.fn> } };
}
const axiosInstance = vi.hoisted(() => {
  const instance = vi.fn(() => Promise.resolve({ data: { code: 0, data: null } })) as unknown as MockAxiosInstance;
  instance.request = vi.fn(() => Promise.resolve({ data: { code: 0, data: null } }));
  instance.get = vi.fn();
  instance.post = vi.fn();
  instance.patch = vi.fn();
  instance.delete = vi.fn();
  instance.interceptors = { request: { use: vi.fn() }, response: { use: vi.fn() } };
  return instance;
});
const axiosDefault = vi.hoisted(() => ({
  create: vi.fn(() => axiosInstance),
  post: vi.fn(),
  isCancel: vi.fn(() => false),
}));
vi.mock('axios', () => ({ default: axiosDefault }));

// 在 mock 后导入被测模块
import { BizError } from './request';

// 捕获响应拦截器的失败处理器
const errorHandler = axiosInstance.interceptors.response.use.mock.calls[0][1] as (
  error: unknown,
) => Promise<unknown>;

function make401Error() {
  return {
    message: 'Request failed',
    isAxiosError: true,
    response: { status: 401, data: { code: 2001, message: '未授权', traceId: 't' } },
    config: { headers: { set: vi.fn() } },
  };
}

describe('request.ts - 401 并发刷新失败(triggerRefresh)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 默认:未登录(有新 token 但已过期),刷新必然失败
    authMock.getAccessToken.mockReturnValue('old-token');
    authMock.isTokenExpired.mockReturnValue(false);
    // /api/v1/auth/refresh 失败
    axiosDefault.post.mockRejectedValue(new Error('network down'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('刷新失败时,排队请求被唤醒(不永久挂起),且最终跳登录', async () => {
    // 刷新失败后 token 仍过期 → 排队请求 `!isTokenExpired()` 为 false → 走跳登录
    authMock.isTokenExpired.mockReturnValue(true);

    // 触发第一个 401:发起刷新(模拟刷新进行中,通过可控 Promise 挂起)
    let rejectRefresh!: (e: unknown) => void;
    axiosDefault.post.mockImplementation(() => new Promise((_, rej) => {
      rejectRefresh = rej;
    }));

    // 第一个 401 进入刷新流程
    const p1 = errorHandler(make401Error());
    // 第二个 401 在刷新进行中进入 → 进入 pendingQueue
    const p2 = errorHandler(make401Error());

    // 让刷新失败
    rejectRefresh(new Error('network down'));
    await Promise.resolve();
    await Promise.resolve();

    // 断言:两个请求都被解决(没有永久挂起)
    await expect(p1).rejects.toThrow();
    await expect(p2).rejects.toThrow();

    // 断言:最终走向登录(clearAccessToken 被调用)
    expect(authMock.clearAccessToken).toHaveBeenCalled();
  });

  it('刷新成功时,排队请求通过新 token 放行(不调用跳登录)', async () => {
    // 刷新成功返回新 token
    axiosDefault.post.mockResolvedValue({
      data: { code: 0, message: 'ok', data: { accessToken: 'new-token', accessTokenExpiresAt: '2099-01-01T00:00:00Z' }, traceId: 't2' },
    });
    authMock.isTokenExpired.mockReturnValue(false);

    const p = errorHandler(make401Error());
    await Promise.resolve();
    await Promise.resolve();

    // 刷新成功 → 设置新 token,不跳登录
    expect(authMock.setAccessToken).toHaveBeenCalledWith('new-token', '2099-01-01T00:00:00Z');
    // 原请求应被重放(instance 被再次调用)
    expect(axiosInstance).toHaveBeenCalled();
    await expect(p).resolves.toBeDefined(); // 重放成功 → 请求正常返回,不挂起
  });

  it('边界:刷新进行中收到多个并发 401,全部排队且刷新失败后全部唤醒(不遗漏)', async () => {
    authMock.isTokenExpired.mockReturnValue(true);

    // 可控刷新 Promise(挂起直到手动 reject)
    let rejectRefresh!: (e: unknown) => void;
    axiosDefault.post.mockImplementation(() => new Promise((_, rej) => {
      rejectRefresh = rej;
    }));

    // 首请求触发刷新,其余 4 个进入 pendingQueue
    const requests = Array.from({ length: 5 }, () => errorHandler(make401Error()));

    // 使刷新失败
    rejectRefresh(new Error('network down'));
    await Promise.resolve();
    await Promise.resolve();

    // 全部 5 个请求都被解决(无永久挂起、无遗漏)
    for (const p of requests) {
      await expect(p).rejects.toThrow();
    }
    // 刷新只发起一次(单飞)
    expect(axiosDefault.post).toHaveBeenCalledTimes(1);
    expect(authMock.clearAccessToken).toHaveBeenCalled();
  });

  it('边界:刷新成功时排队请求共享新 token 放行,不重复刷新', async () => {
    axiosDefault.post.mockResolvedValue({
      data: { code: 0, message: 'ok', data: { accessToken: 'new-token', accessTokenExpiresAt: '2099-01-01T00:00:00Z' }, traceId: 't3' },
    });
    authMock.isTokenExpired.mockReturnValue(false);

    // 首请求触发刷新,并发 3 个排队
    const requests = Array.from({ length: 4 }, () => errorHandler(make401Error()));
    await Promise.resolve();
    await Promise.resolve();

    // 全部解决(不挂起)
    for (const p of requests) {
      await expect(p).resolves.toBeDefined();
    }
    // 刷新只发起一次(单飞),设置一次新 token
    expect(axiosDefault.post).toHaveBeenCalledTimes(1);
    expect(authMock.setAccessToken).toHaveBeenCalledTimes(1);
    // 不跳登录
    expect(authMock.clearAccessToken).not.toHaveBeenCalled();
  });

  it('边界:刷新失败后再次触发 401,可重新发起新的刷新(状态复位)', async () => {
    // 第一次刷新失败
    authMock.isTokenExpired.mockReturnValue(true);
    axiosDefault.post.mockRejectedValueOnce(new Error('network down'));

    await expect(errorHandler(make401Error())).rejects.toThrow();
    await Promise.resolve();

    // 第二次刷新成功
    axiosDefault.post.mockResolvedValueOnce({
      data: { code: 0, message: 'ok', data: { accessToken: 'new-token', accessTokenExpiresAt: '2099-01-01T00:00:00Z' }, traceId: 't4' },
    });
    authMock.isTokenExpired.mockReturnValue(false);

    const p = errorHandler(make401Error());
    await Promise.resolve();
    await Promise.resolve();

    await expect(p).resolves.toBeDefined();
    // 第二次成功设置新 token
    expect(authMock.setAccessToken).toHaveBeenCalledWith('new-token', '2099-01-01T00:00:00Z');
  });

  it('BizError 2001 携带 traceId 与 message', async () => {
    const err = new BizError(2001, '未授权,请重新登录', 'trace-2001');
    expect(err.code).toBe(2001);
    expect(err.message).toContain('未授权');
    expect(err.traceId).toBe('trace-2001');
  });
});