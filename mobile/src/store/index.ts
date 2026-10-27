// 丹青有AI 移动端全局状态(zustand)
// - user 类型使用跨端契约 UserProfile(单一真源:src/types/api-contract.ts)
// - 持有 accessToken / refreshToken / csrfToken / user
//   * accessToken:JWT,内存态;P3-1.4 启动时从 secure-store 水合
//   * refreshToken / csrfToken:后端 /auth/refresh 从 Cookie 读取(P3-1.4 登录时从
//     feishuCallback 的 Set-Cookie 捕获并存入 secure-store),刷新时以
//     `Cookie: refresh_token=...; csrf_token=...` + `X-CSRF-Token` 头回传
// - 禁止在本文件独立定义跨端类型(全部来自 api-contract.ts)
import { create } from 'zustand';
import type { UserProfile } from '../types/api-contract';

interface AuthState {
  /** JWT access_token(内存态) */
  accessToken: string | null;
  /** access_token 过期时间(ISO 8601) */
  accessTokenExpiresAt: string | null;
  /** refresh_token(P3-1.4 登录后写入,用于 /auth/refresh) */
  refreshToken: string | null;
  /** CSRF token(与 refresh_token 同周期下发,刷新时回传 X-CSRF-Token 头) */
  csrfToken: string | null;
  /** 当前用户资料(跨端契约 UserProfile) */
  user: UserProfile | null;
  /** 是否已登录(accessToken 与 user 同时存在) */
  isAuthenticated: boolean;
  /** 登录成功后写入全量凭据(P3-1.4 飞书回调 / 手机号登录调用) */
  setAuth: (params: {
    accessToken: string;
    accessTokenExpiresAt: string;
    refreshToken: string;
    csrfToken: string;
    user: UserProfile;
  }) => void;
  /** token 刷新后仅更新 access_token(供 api.ts 响应拦截器调用) */
  updateAccessToken: (
    accessToken: string,
    accessTokenExpiresAt: string,
  ) => void;
  /** 清除全部凭据(登出 / token 失效) */
  clearAuth: () => void;
}

export const useAuthStore = create<AuthState>()((set) => ({
  accessToken: null,
  accessTokenExpiresAt: null,
  refreshToken: null,
  csrfToken: null,
  user: null,
  isAuthenticated: false,
  setAuth: (params) =>
    set({
      accessToken: params.accessToken,
      accessTokenExpiresAt: params.accessTokenExpiresAt,
      refreshToken: params.refreshToken,
      csrfToken: params.csrfToken,
      user: params.user,
      isAuthenticated: true,
    }),
  updateAccessToken: (accessToken, accessTokenExpiresAt) =>
    set({ accessToken, accessTokenExpiresAt }),
  clearAuth: () =>
    set({
      accessToken: null,
      accessTokenExpiresAt: null,
      refreshToken: null,
      csrfToken: null,
      user: null,
      isAuthenticated: false,
    }),
}));
