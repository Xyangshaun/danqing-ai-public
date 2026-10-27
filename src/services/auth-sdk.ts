// ============================================================
// 丹青有AI - 认证 SDK
// 对应接口:api-contract-v1.md §4.1-§4.5 + §4.7 + Phase 2 §4 tenants/switch
// ============================================================

import type {
  AuthLogoutResponse,
  AuthMeResponse,
  AuthRefreshResponse,
  ClientType,
  FeishuAuthorizeResponse,
  FeishuCallbackResponse,
  FeishuCallbackQuery,
  GetCurrentTenantResponse,
  SwitchTenantRequest,
  SwitchTenantResponse,
  TenantInfo,
  TenantMembership,
  UpdateRoleRequest,
  UpdateRoleResponse,
  UpdateLearnerProfileRequest,
  UpdateLearnerProfileResponse,
  UserProfile,
} from '../types/api-contract';
import { get, patch, post } from './api';
import { clearAccessToken, setAccessToken } from './token-store';

/** 飞书重定向 URI(从 env 读取,默认本地开发地址) */
const FEISHU_REDIRECT_URI =
  import.meta.env.VITE_FEISHU_REDIRECT_URI ?? 'http://localhost:5173/auth/feishu/callback';

/* ============================================================
 * 1. 获取飞书授权 URL
 * 对应:GET /auth/feishu/authorize(api-contract-v1.md §4.1)
 * 前端调用此接口获取飞书授权页 URL,然后 location.href 跳转
 * ============================================================ */
export async function getFeishuAuthorizeUrl(
  client: ClientType = 'web'
): Promise<FeishuAuthorizeResponse> {
  return get<FeishuAuthorizeResponse>(
    '/auth/feishu/authorize',
    {
      redirect_uri: FEISHU_REDIRECT_URI,
      client,
    },
    {
      skipAuth: true, // 公开接口,无需 access_token
      silent: true, // 失败由调用方(FeishuLoginButton)处理 Toast
    }
  );
}

/* ============================================================
 * 2. 飞书 OAuth 回调处理
 * 对应:GET /auth/feishu/callback(api-contract-v1.md §4.2)
 * 前端在 AuthCallbackPage 解析 code/state 后调用本方法
 * 后端校验 state + 用 code 换 token + 设置 HttpOnly Cookie + 返回 access_token
 * ============================================================ */
export async function handleFeishuCallback(
  query: FeishuCallbackQuery
): Promise<FeishuCallbackResponse> {
  const result = await get<FeishuCallbackResponse>(
    '/auth/feishu/callback',
    {
      code: query.code,
      state: query.state,
    },
    {
      skipAuth: true, // 公开接口
      silent: true, // 失败由 AuthCallbackPage 处理 Toast
    }
  );
  // 存 access_token 到内存(token-store)
  setAccessToken(result.accessToken, result.accessTokenExpiresAt);
  return result;
}

/* ============================================================
 * 3. 刷新 access_token
 * 对应:POST /auth/refresh(api-contract-v1.md §4.3)
 * refresh_token 在 HttpOnly Cookie 中,前端无需传
 * ============================================================ */
export async function refreshAccessToken(): Promise<AuthRefreshResponse> {
  const result = await post<AuthRefreshResponse>(
    '/auth/refresh',
    undefined,
    {
      skipAuth: true, // refresh 不校验 access_token
      skipRefresh: true, // 避免循环
      silent: true, // 失败由调用方处理
    }
  );
  setAccessToken(result.accessToken, result.accessTokenExpiresAt);
  return result;
}

/* ============================================================
 * 4. 登出
 * 对应:POST /auth/logout(api-contract-v1.md §4.4)
 * 后端撤销当前 Session + 清除 refresh_token Cookie
 * 前端清除内存中的 access_token
 * ============================================================ */
export async function logout(revokeAll = false): Promise<AuthLogoutResponse> {
  try {
    const result = await post<AuthLogoutResponse>(
      '/auth/logout',
      { revokeAll },
      { silent: true }
    );
    return result;
  } finally {
    // 无论后端是否成功,前端都清除本地 token
    clearAccessToken();
  }
}

/* ============================================================
 * 5. 获取当前用户信息
 * 对应:GET /auth/me(api-contract-v1.md §4.5)
 * 返回当前用户、激活租户、所有租户成员关系
 * ============================================================ */
export async function getCurrentUser(): Promise<AuthMeResponse> {
  return get<AuthMeResponse>('/auth/me', undefined, { silent: true });
}

/* ============================================================
 * 6. 获取当前激活租户信息
 * 对应:GET /tenants/current(api-contract-v1.md §4.7)
 * 返回租户详情 + 当月配额使用情况
 * ============================================================ */
export async function getCurrentTenant(): Promise<GetCurrentTenantResponse> {
  return get<GetCurrentTenantResponse>('/tenants/current', undefined, {
    silent: true,
  });
}

/* ============================================================
 * 6.1 列出用户所有租户成员关系
 * 对应:GET /tenants(返回 TenantMember 列表)
 * 用于租户切换下拉刷新;AuthContext 在 /auth/me 已返回 memberships,
 * 本方法供"租户列表可能变化"场景(如新加入租户后)主动刷新
 * ============================================================ */
export async function listTenants(): Promise<TenantMembership[]> {
  return get<TenantMembership[]>('/tenants', undefined, {
    silent: true,
  });
}

/* ============================================================
 * 7. 切换租户(Phase 2 接口,SDK 先行实现)
 * 对应:POST /tenants/switch(api-contract-v1.md §6.3 Phase 2 计划)
 * 后端校验用户属于该租户 + 重新签发 access_token(refresh_token 不变)
 * ============================================================ */
export async function switchTenant(
  tenantId: string
): Promise<SwitchTenantResponse> {
  const body: SwitchTenantRequest = { tenantId };
  const result = await post<SwitchTenantResponse>('/tenants/switch', body);
  // 更新本地 access_token
  setAccessToken(result.accessToken, result.accessTokenExpiresAt);
  return result;
}

/* ============================================================
 * 8. 设置用户角色(首次登录新手引导 onboarding)
 * 对应:PATCH /users/role
 * 业务规则(后端强制):
 *   - 仅允许当前 role='student'(首次登录默认)的用户自选一次
 *   - 已切换到 teacher/admin 的账户调用会返回 403 FORBIDDEN
 * 成功后返回更新后的完整 UserProfile,调用方需更新 AuthContext 的 user 状态
 * ============================================================ */
export async function setUserRole(
  role: UpdateRoleRequest['role']
): Promise<UpdateRoleResponse> {
  const body: UpdateRoleRequest = { role };
  return patch<UpdateRoleResponse>('/users/role', body);
}

/* ============================================================
 * 8.1 设置学习者画像(onboarding 二级选择 + 设置页修改)
 * 对应:PATCH /users/learner-profile
 * 业务规则:所有已认证用户均可设置/修改(非一次性,区别于 role)
 * 成功后返回更新后的完整 UserProfile,调用方需更新 AuthContext 的 user 状态
 * ============================================================ */
export async function setLearnerProfile(
  learnerProfile: UpdateLearnerProfileRequest['learnerProfile']
): Promise<UpdateLearnerProfileResponse> {
  const body: UpdateLearnerProfileRequest = { learnerProfile };
  return patch<UpdateLearnerProfileResponse>('/users/learner-profile', body);
}

/* ============================================================
 * 9. 通用账号注册(邮箱+密码,无需邀请码)
 * 对应:POST /auth/register
 * 后端创建个人租户(individual),role=owner,authType=password
 * @returns 登录响应(含 access_token,已存入内存)
 * ============================================================ */
export async function registerAccount(
  email: string,
  password: string,
  name: string
): Promise<FeishuCallbackResponse> {
  const result = await post<FeishuCallbackResponse>(
    '/auth/register',
    { email, password, name },
    {
      skipAuth: true, // 公开接口
      silent: true, // 失败由调用方(RegisterPage)处理 Toast
    }
  );
  setAccessToken(result.accessToken, result.accessTokenExpiresAt);
  return result;
}

/* ============================================================
 * 10. 通用账号登录(邮箱+密码)
 * 对应:POST /auth/login
 * @returns 登录响应(含 access_token,已存入内存)
 * ============================================================ */
export async function loginAccount(
  email: string,
  password: string
): Promise<FeishuCallbackResponse> {
  const result = await post<FeishuCallbackResponse>(
    '/auth/login',
    { email, password },
    {
      skipAuth: true, // 公开接口
      silent: true, // 失败由调用方(LoginPage)处理 Toast
    }
  );
  setAccessToken(result.accessToken, result.accessTokenExpiresAt);
  return result;
}

/* ============================================================
 * 11. 创建飞书扫码登录二维码
 * 对应:POST /auth/feishu/qrcode
 * @returns { qrCodeUrl, qrToken, state } - 前端用 qrCodeUrl 渲染图片,
 *          用 qrToken+state 轮询状态
 * ============================================================ */
export interface FeishuQrCodeResponse {
  /** 二维码图片 URL(可直接 <img src>) */
  qrCodeUrl: string;
  /** 二维码 token,用于查询状态 */
  qrToken: string;
  /** 状态 token,用于查询状态 */
  state: string;
}

export async function createFeishuQR(): Promise<FeishuQrCodeResponse> {
  return post<FeishuQrCodeResponse>(
    '/auth/feishu/qrcode',
    undefined,
    {
      skipAuth: true,
      silent: true, // 失败由调用方(FeishuQrLogin)处理
    }
  );
}

/* ============================================================
 * 12. 查询飞书扫码状态(轮询)
 * 对应:POST /auth/feishu/qrcode/status
 *
 * - status: 'new' | 'scanned' — 等待中,继续轮询
 * - status: 'expired' | 'canceled' — 终态,需刷新二维码
 * - status: 'confirmed' — 登录成功,响应包含完整登录 payload(已 setAccessToken)
 * ============================================================ */
export type FeishuQrStatus =
  | 'new'
  | 'scanned'
  | 'expired'
  | 'canceled'
  | 'confirmed';

export interface FeishuQrStatusResponse {
  status: FeishuQrStatus;
  /** 仅 status='confirmed' 时存在 */
  accessToken?: string;
  accessTokenExpiresAt?: string;
  isFirstLogin?: boolean;
  user?: UserProfile;
  tenant?: TenantInfo;
}

export async function pollFeishuQRStatus(
  qrToken: string,
  state: string
): Promise<FeishuQrStatusResponse> {
  const result = await post<FeishuQrStatusResponse>(
    '/auth/feishu/qrcode/status',
    { qrToken, state },
    {
      skipAuth: true,
      silent: true, // 失败由调用方(FeishuQrLogin)处理
    }
  );
  // confirmed 时后端返回完整登录 payload,存 token
  if (result.status === 'confirmed' && result.accessToken) {
    setAccessToken(result.accessToken, result.accessTokenExpiresAt);
  }
  return result;
}

/* ============================================================
 * 便捷类型导出(供组件直接使用)
 * ============================================================ */
export type {
  AuthMeResponse,
  FeishuAuthorizeResponse,
  FeishuCallbackResponse,
  TenantInfo,
  TenantMembership,
  UserProfile,
};
