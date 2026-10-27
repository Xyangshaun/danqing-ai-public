// 丹青有AI 移动端认证相关 API(对应后端 /auth/*)
// 类型全部来自跨端契约 src/types/api-contract.ts
// 注意:/auth/refresh 的刷新逻辑封装在 api.ts 响应拦截器内(含并发队列),
//   此处仅暴露业务层直接调用的 feishuAuthorize / feishuCallback / getMe / logout。
import api from './api';
import type {
  AuthMeResponse,
  AuthLogoutResponse,
  FeishuAuthorizeResponse,
  FeishuCallbackResponse,
  PhoneOtpResponse,
  PhoneVerifyResponse,
  InvitationRedeemResponse,
  AdminLoginResponse,
  PhoneOtpPurpose,
} from '../types/api-contract';

/**
 * 构造 X-Client-Context 头(后端 deviceContextMiddleware 解析)。
 * mobile 分支:{"device_id":"...","client":"mobile"}
 */
function buildClientContextHeader(deviceId: string): string {
  return JSON.stringify({ device_id: deviceId, client: 'mobile' });
}

/**
 * GET /auth/feishu/authorize — 获取飞书授权 URL。
 * 后端按 device_id + client=mobile 生成 state 并返回 authorizeUrl,
 * mobile 用 expo-web-browser.openAuthSessionAsync 打开 authorizeUrl。
 *
 * 注:本接口无需鉴权(登录前调用),但 api.ts 请求拦截器会自动注入
 *     Authorization 头(若有 accessToken);登录前 store 无 token,不影响。
 */
export function feishuAuthorize(params: {
  deviceId: string;
  redirectUri?: string;
}): Promise<FeishuAuthorizeResponse> {
  return api.get('/auth/feishu/authorize', {
    params: {
      device_id: params.deviceId,
      redirect_uri: params.redirectUri,
    },
    headers: {
      'X-Client-Context': buildClientContextHeader(params.deviceId),
    },
  }) as unknown as Promise<FeishuAuthorizeResponse>;
}

/**
 * GET /auth/feishu/callback — 飞书授权回调。
 * 后端对 client=mobile 在响应体额外返回 refreshToken + csrfToken
 * (web/admin 走 Cookie 模式,不返回这两个字段)。
 * mobile 直接从响应体取值存入 store + secure-store。
 */
export function feishuCallback(params: {
  code: string;
  state: string;
  deviceId: string;
}): Promise<FeishuCallbackResponse> {
  return api.get('/auth/feishu/callback', {
    params: {
      code: params.code,
      state: params.state,
    },
    headers: {
      'X-Client-Context': buildClientContextHeader(params.deviceId),
    },
  }) as unknown as Promise<FeishuCallbackResponse>;
}

/** GET /auth/me — 当前用户 + 租户 + 成员关系(需鉴权) */
export function getMe(): Promise<AuthMeResponse> {
  return api.get('/auth/me') as unknown as Promise<AuthMeResponse>;
}

/**
 * POST /auth/logout — 登出(需鉴权)
 * 移动端不发送 refresh_token Cookie,故后端 csrfMiddleware 跳过 CSRF 校验,
 * 通过 Authorization(Bearer)+ accessJti/userId 撤销会话。
 */
export function logout(revokeAll = false): Promise<AuthLogoutResponse> {
  return api.post('/auth/logout', { revokeAll }) as unknown as Promise<AuthLogoutResponse>;
}

// ============================================================
// Phase 5:手机验证码 / 邀请码 / 院校管理员 三种登录方式
// 后端对 client=mobile 在响应体额外返回 refreshToken + csrfToken
// (与 feishuCallback 一致),由移动端自行安全存储。
// 注:phoneOtp 不需要 device_id(后端不解析 X-Client-Context);
//     其余四个接口需通过 X-Client-Context 头传 device_id + client=mobile。
// ============================================================

/**
 * POST /auth/phone/otp — 发送手机验证码(无需鉴权,限流 3/min/IP)。
 * 后端仅校验手机号 + purpose,不要求 device_id。
 */
export function phoneOtp(params: {
  phone: string;
  purpose: PhoneOtpPurpose;
  tenantId?: string;
}): Promise<PhoneOtpResponse> {
  return api.post('/auth/phone/otp', {
    phone: params.phone,
    purpose: params.purpose,
    tenantId: params.tenantId,
  }) as unknown as Promise<PhoneOtpResponse>;
}

/**
 * POST /auth/phone/verify — 验证码校验 + 登录/注册。
 * 后端对 client=mobile 在响应体返回 refreshToken + csrfToken。
 * purpose 仅限 'login' | 'register'(bind/reset 走其他流程)。
 */
export function phoneVerify(params: {
  phone: string;
  code: string;
  purpose: 'register' | 'login';
  invitationCode?: string;
  name?: string;
  deviceId: string;
}): Promise<PhoneVerifyResponse> {
  return api.post(
    '/auth/phone/verify',
    {
      phone: params.phone,
      code: params.code,
      purpose: params.purpose,
      invitationCode: params.invitationCode,
      name: params.name,
    },
    {
      headers: {
        'X-Client-Context': buildClientContextHeader(params.deviceId),
      },
    },
  ) as unknown as Promise<PhoneVerifyResponse>;
}

/**
 * POST /auth/invitation/redeem — 邀请码兑换 + 加入租户。
 * 后端对 client=mobile 在响应体返回 refreshToken + csrfToken。
 */
export function invitationRedeem(params: {
  code: string;
  name?: string;
  deviceId: string;
}): Promise<InvitationRedeemResponse> {
  return api.post(
    '/auth/invitation/redeem',
    {
      code: params.code,
      name: params.name,
    },
    {
      headers: {
        'X-Client-Context': buildClientContextHeader(params.deviceId),
      },
    },
  ) as unknown as Promise<InvitationRedeemResponse>;
}

/**
 * POST /auth/login/admin — 院校管理员登录(邮箱+密码)。
 * 后端对 client=mobile 在响应体返回 refreshToken + csrfToken。
 */
export function adminLogin(params: {
  email: string;
  password: string;
  deviceId: string;
}): Promise<AdminLoginResponse> {
  return api.post(
    '/auth/login/admin',
    {
      email: params.email,
      password: params.password,
    },
    {
      headers: {
        'X-Client-Context': buildClientContextHeader(params.deviceId),
      },
    },
  ) as unknown as Promise<AdminLoginResponse>;
}

/**
 * POST /auth/register/admin — 院校管理员注册(邮箱+密码+邀请码)。
 * 后端对 client=mobile 在响应体返回 refreshToken + csrfToken。
 */
export function adminRegister(params: {
  email: string;
  password: string;
  name: string;
  invitationCode: string;
  tenantName?: string;
  deviceId: string;
}): Promise<AdminLoginResponse> {
  return api.post(
    '/auth/register/admin',
    {
      email: params.email,
      password: params.password,
      name: params.name,
      invitationCode: params.invitationCode,
      tenantName: params.tenantName,
    },
    {
      headers: {
        'X-Client-Context': buildClientContextHeader(params.deviceId),
      },
    },
  ) as unknown as Promise<AdminLoginResponse>;
}
