// ============================================================
// 认证 API
// 对应后端:/api/v1/auth/*
// ============================================================

import { get, post } from './request';
import type {
  AuthMeResponse,
  AuthRefreshResponse,
  AuthLogoutResponse,
  FeishuAuthorizeResponse,
  FeishuCallbackQuery,
  FeishuCallbackResponse,
} from '@/types/api';

type ClientTypeLike = 'web' | 'admin' | 'mobile' | 'marketing';

/**
 * 飞书回调地址(构建期由 define 注入)。
 * 注意:必须连续书写 process.env.FEISHU_REDIRECT_URI,
 * 以精确匹配 config/config.ts 中 define 的键,否则构建期不会替换。
 */
const FEISHU_REDIRECT_URI =
  (typeof process !== 'undefined' && process.env.FEISHU_REDIRECT_URI) ||
  'http://localhost:8000/auth/feishu/callback';

/** 获取飞书授权 URL */
export function getFeishuAuthorizeUrl(client: ClientTypeLike = 'admin'): Promise<FeishuAuthorizeResponse> {
  return get<FeishuAuthorizeResponse>('/api/v1/auth/feishu/authorize', {
    redirect_uri: FEISHU_REDIRECT_URI,
    client,
  });
}

/** 飞书 OAuth 回调 */
export function handleFeishuCallback(query: FeishuCallbackQuery): Promise<FeishuCallbackResponse> {
  return get<FeishuCallbackResponse>('/api/v1/auth/feishu/callback', {
    code: query.code,
    state: query.state,
  });
}

/** 刷新 access_token(refresh_token 在 HttpOnly Cookie) */
export function refreshAccessToken(): Promise<AuthRefreshResponse> {
  return post<AuthRefreshResponse>('/api/v1/auth/refresh');
}

/** 登出 */
export function logoutApi(revokeAll = false): Promise<AuthLogoutResponse> {
  return post<AuthLogoutResponse>('/api/v1/auth/logout', { revokeAll });
}

/** 获取当前用户信息 */
export function getCurrentUser(): Promise<AuthMeResponse> {
  return get<AuthMeResponse>('/api/v1/auth/me');
}
