// ============================================================
// AuthCallbackPage 页面单元测试 (任务包 E:块3)
// 对应源码: src/pages/AuthCallbackPage.tsx
//
// 测试范围:
//   1. loading 态(正在登录...)初始渲染
//   2. 成功态(首次登录 → onboarding / 非首次 → 首页)
//   3. access_denied(用户拒绝授权)错误态
//   4. missing_params(参数缺失)错误态
//   5. ApiError 4001/4002/4003/4004 差异化提示
//   6. 普通网络错误(非 ApiError)兜底提示
//   7. "立即返回登录页"按钮调用 redirectToLogin
//
// Mock 策略:
//   - auth-sdk.handleFeishuCallback: 可控 resolve/reject
//   - api.ApiError: 保留真实类(instanceof 校验)
//   - window.location: 整体替换(jsdom 中 replace 不可配置)
//   - setTimeout: 使用 fake timers + advanceTimersByTimeAsync 刷新微任务
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import AuthCallbackPage from '../AuthCallbackPage';
import { ApiError } from '../../services/api';
import type * as ApiModule from '../../services/api';

/* ---------- mock 依赖 ---------- */

const handleFeishuCallbackMock = vi.fn();
vi.mock('../../services/auth-sdk', () => ({
  handleFeishuCallback: (...args: unknown[]) => handleFeishuCallbackMock(...args),
}));

/* api.ts 保留真实导出(需 ApiError 类用于 instanceof 校验) */
vi.mock('../../services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>();
  return { ...actual };
});

/* ---------- 工具:设置 URL 查询参数 ---------- */

/**
 * jsdom 中 location.replace 是不可配置属性,无法用 vi.spyOn 直接 spy,
 * 也无法用 Object.defineProperty 重定义单个方法。
 * 解决方案:整体替换 window.location(window.location 属性本身可配置),
 * 用普通对象模拟,replace 用 vi.fn 控制,search 直接赋值。
 */
const originalLocation = window.location;
let replaceSpy: ReturnType<typeof vi.fn>;

/** 设置当前 location.search(直接修改 mock 对象) */
function setLocationSearch(search: string): void {
  window.location.search = search;
}

beforeEach(() => {
  vi.useFakeTimers();
  handleFeishuCallbackMock.mockReset();
  replaceSpy = vi.fn();
  // 整体替换 window.location 为可控 mock(保留 origin/href 等常用字段)
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      replace: replaceSpy,
      assign: vi.fn(),
      search: '',
      href: 'http://localhost/',
      origin: 'http://localhost',
      pathname: '/auth/feishu/callback',
      hash: '',
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
  // 恢复原始 location
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: originalLocation,
  });
});

/* ---------- 测试数据工厂 ---------- */

function makeSuccessResponse(isFirstLogin = false) {
  return {
    accessToken: 'access-token-mock',
    accessTokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
    isFirstLogin,
    user: {
      id: 'user-1',
      tenantId: 'tenant-1',
      feishuOpenId: 'open-1',
      feishuUnionId: 'union-1',
      name: '张老师',
      avatar: '',
      email: 'teacher@danqing.ai',
      phone: null,
      role: 'teacher',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastLoginAt: new Date().toISOString(),
    },
  };
}

/* ============================================================
 * 1. loading 态
 * ============================================================ */
describe('AuthCallbackPage loading 态', () => {
  it('初始渲染显示"正在登录..."文案', () => {
    // 需有效参数才不会立即进入 error 态,pending promise 让状态保持 loading
    setLocationSearch('?code=abc&state=xyz');
    handleFeishuCallbackMock.mockReturnValue(new Promise(() => {}));
    render(<AuthCallbackPage />);
    expect(screen.getByText('正在登录...')).toBeInTheDocument();
    expect(screen.getByText('正在与飞书完成身份验证')).toBeInTheDocument();
  });
});

/* ============================================================
 * 2. 成功态
 * ============================================================ */
describe('AuthCallbackPage 成功态', () => {
  it('非首次登录成功后显示"登录成功"并跳转首页', async () => {
    setLocationSearch('?code=abc&state=xyz');
    handleFeishuCallbackMock.mockResolvedValue(makeSuccessResponse(false));
    render(<AuthCallbackPage />);
    // 刷新微任务让 promise resolve + React 状态更新生效
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText('登录成功')).toBeInTheDocument();
    // 800ms 后跳转首页 /#/
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(replaceSpy).toHaveBeenCalledWith('/#/');
  });

  it('首次登录成功后跳转新手引导页 /onboarding', async () => {
    setLocationSearch('?code=abc&state=xyz');
    handleFeishuCallbackMock.mockResolvedValue(makeSuccessResponse(true));
    render(<AuthCallbackPage />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText('登录成功')).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(replaceSpy).toHaveBeenCalledWith('/#/onboarding');
  });
});

/* ============================================================
 * 3. 用户拒绝授权
 * ============================================================ */
describe('AuthCallbackPage 拒绝授权', () => {
  it('error=access_denied 显示"授权已取消"', async () => {
    setLocationSearch('?error=access_denied');
    render(<AuthCallbackPage />);
    // access_denied 不走 async handleFeishuCallback,直接同步设状态
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText('授权已取消')).toBeInTheDocument();
    expect(screen.getByText('您已取消飞书授权,请重新点击登录')).toBeInTheDocument();
  });
});

/* ============================================================
 * 4. 参数缺失
 * ============================================================ */
describe('AuthCallbackPage 参数缺失', () => {
  it('无 code/state 时显示"回调参数缺失"', async () => {
    render(<AuthCallbackPage />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText('回调参数缺失')).toBeInTheDocument();
    expect(screen.getByText('未收到有效的授权码,请重新登录')).toBeInTheDocument();
  });

  it('仅有 code 无 state 时显示"回调参数缺失"', async () => {
    setLocationSearch('?code=abc');
    render(<AuthCallbackPage />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText('回调参数缺失')).toBeInTheDocument();
  });
});

/* ============================================================
 * 5. ApiError 差异化提示
 * ============================================================ */
describe('AuthCallbackPage ApiError 错误码', () => {
  it('4001 显示"授权校验失败"', async () => {
    setLocationSearch('?code=abc&state=xyz');
    handleFeishuCallbackMock.mockRejectedValue(new ApiError(4001, 'state invalid'));
    render(<AuthCallbackPage />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText('授权校验失败')).toBeInTheDocument();
  });

  it('4002 显示"飞书服务异常"', async () => {
    setLocationSearch('?code=abc&state=xyz');
    handleFeishuCallbackMock.mockRejectedValue(new ApiError(4002, 'feishu error'));
    render(<AuthCallbackPage />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText('飞书服务异常')).toBeInTheDocument();
  });

  it('4003 显示"飞书服务异常"', async () => {
    setLocationSearch('?code=abc&state=xyz');
    handleFeishuCallbackMock.mockRejectedValue(new ApiError(4003, 'feishu error'));
    render(<AuthCallbackPage />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText('飞书服务异常')).toBeInTheDocument();
  });

  it('4004 显示"应用配置错误"', async () => {
    setLocationSearch('?code=abc&state=xyz');
    handleFeishuCallbackMock.mockRejectedValue(new ApiError(4004, 'app config'));
    render(<AuthCallbackPage />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText('应用配置错误')).toBeInTheDocument();
  });

  it('其他 ApiError 码显示原始 message', async () => {
    setLocationSearch('?code=abc&state=xyz');
    handleFeishuCallbackMock.mockRejectedValue(new ApiError(5000, '未知错误XYZ'));
    render(<AuthCallbackPage />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText('未知错误XYZ')).toBeInTheDocument();
  });
});

/* ============================================================
 * 6. 普通网络错误
 * ============================================================ */
describe('AuthCallbackPage 网络错误', () => {
  it('非 ApiError 异常显示"网络错误"', async () => {
    setLocationSearch('?code=abc&state=xyz');
    handleFeishuCallbackMock.mockRejectedValue(new Error('network down'));
    render(<AuthCallbackPage />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText('网络错误')).toBeInTheDocument();
    expect(screen.getByText('请检查网络连接后重试')).toBeInTheDocument();
  });
});

/* ============================================================
 * 7. 错误态"立即返回登录页"按钮
 * ============================================================ */
describe('AuthCallbackPage 返回登录按钮', () => {
  it('点击"立即返回登录页"调用 redirectToLogin', async () => {
    setLocationSearch('?error=access_denied');
    render(<AuthCallbackPage />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const btn = screen.getByText('立即返回登录页');
    await act(async () => {
      btn.click();
    });
    expect(replaceSpy).toHaveBeenCalledWith('/#/login');
  });

  it('错误态 3 秒后自动跳转登录页', async () => {
    setLocationSearch('?error=access_denied');
    render(<AuthCallbackPage />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText('授权已取消')).toBeInTheDocument();
    replaceSpy.mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(replaceSpy).toHaveBeenCalledWith('/#/login');
  });
});
