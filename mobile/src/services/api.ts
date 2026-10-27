// ============================================================
// 丹青有AI 移动端统一网络请求封装
// - baseURL 从环境变量读取(经 app.config.js -> expo-constants.extra)
// - 请求拦截器:自动注入 Authorization: Bearer <accessToken> + X-Client: mobile
// - 响应拦截器:ApiResponse 拆包(code===0 返回 data,否则抛 ApiError)
//   * 后端业务错误伴随非 2xx HTTP 状态返回,故 token 过期等错误码在 error 分支处理
//   * code=2002(TOKEN_EXPIRED):用 refreshToken + csrfToken 静默调 /auth/refresh,
//     成功后更新 store 并重放原请求;并发请求用 isRefreshing + 队列合并刷新
//   * code=2001/2003(UNAUTHORIZED / REFRESH_TOKEN_INVALID)或刷新失败:
//     clearAuth + clearAll secure-store + router.replace('/login')(P3-1.4 已实现)
// - 对应后端 API 契约:.trae/documents/api-contract-v1.md
//   统一响应格式:{ code, message, data, traceId },code=0 成功
// ============================================================
import axios from 'axios';
import type {
  AxiosError,
  AxiosInstance,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from 'axios';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useAuthStore } from '../store';
import { authStorage } from '../utils/storage';
import { type ApiResponse, ErrorCode } from '../types/api-contract';

const extra = (Constants.expoConfig?.extra ?? {}) as {
  apiBaseUrl?: string;
  feishuRedirectUriMobile?: string;
};

// 后端 API 基础路径(本地默认 http://localhost:3000/api/v1,见 api-contract-v1.md §1.1)
export const API_BASE_URL =
  extra.apiBaseUrl || 'http://localhost:3000/api/v1';

/** 业务错误(后端返回 code!==0) */
export class ApiError extends Error {
  readonly code: number;
  readonly traceId?: string;
  constructor(code: number, message: string, traceId?: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.traceId = traceId;
  }
}

/** 标记已重试的请求配置,避免刷新后仍 401 时无限循环 */
interface RetryableConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
}

const api: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'X-Client': 'mobile',
  },
});

// 请求拦截器:自动注入 access_token(P3-1.4 飞书登录后由 store 提供)
api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers.set('Authorization', `Bearer ${token}`);
  }
  return config;
});

// ---- token 自动刷新(isRefreshing + 队列合并并发刷新)----
let isRefreshing = false;
type PendingResolver = {
  resolve: (token: string) => void;
  reject: (err: unknown) => void;
};
let pendingQueue: PendingResolver[] = [];

function flushQueue(token: string | null, error: unknown): void {
  pendingQueue.forEach((p) => {
    if (token) {
      p.resolve(token);
    } else {
      p.reject(error);
    }
  });
  pendingQueue = [];
}

/**
 * 执行一次 token 刷新(绕过 api 实例,避免响应拦截器递归)。
 * 后端 /auth/refresh 从 Cookie 读 refresh_token,且存在 Cookie 时强制 CSRF 双提交校验,
 * 故此处手动回传 `Cookie: refresh_token=...; csrf_token=...` + `X-CSRF-Token` 头。
 * 并发场景下仅首发请求真正调 /auth/refresh,其余在队列中等待同一结果。
 */
async function performRefresh(): Promise<string> {
  if (isRefreshing) {
    return new Promise<string>((resolve, reject) => {
      pendingQueue.push({ resolve, reject });
    });
  }
  isRefreshing = true;
  try {
    const { refreshToken, csrfToken } = useAuthStore.getState();
    if (!refreshToken) {
      throw new ApiError(
        ErrorCode.REFRESH_TOKEN_INVALID,
        '缺少 refreshToken,无法刷新',
      );
    }
    const cookieParts = [`refresh_token=${refreshToken}`];
    if (csrfToken) {
      cookieParts.push(`csrf_token=${csrfToken}`);
    }
    const resp = await axios.post<
      ApiResponse<{ accessToken: string; accessTokenExpiresAt: string }>
    >(
      `${API_BASE_URL}/auth/refresh`,
      undefined, // 后端从 Cookie 读 refresh_token,无请求体
      {
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-Client': 'mobile',
          Cookie: cookieParts.join('; '),
          ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
        },
        timeout: 10000,
        // 自行处理状态码:刷新失败后端返回 401 + ApiResponse,需读 body 提取 code
        validateStatus: () => true,
      },
    );
    const body = resp.data;
    if (!body || body.code !== ErrorCode.SUCCESS || !body.data) {
      throw new ApiError(
        body?.code ?? ErrorCode.UNAUTHORIZED,
        body?.message ?? '刷新 token 失败',
        body?.traceId,
      );
    }
    const { accessToken, accessTokenExpiresAt } = body.data;
    useAuthStore.getState().updateAccessToken(accessToken, accessTokenExpiresAt);
    flushQueue(accessToken, null);
    return accessToken;
  } catch (err) {
    flushQueue(null, err);
    throw err;
  } finally {
    isRefreshing = false;
  }
}

/**
 * 清除认证态并跳转登录页(P3-1.4)。
 * - 同步清 store 内存态(立即生效,拦截后续请求不再带 Authorization)
 * - 异步清 secure-store 持久化态(避免下次冷启动水合失效 token)
 * - 跳 /login(expo-router 非 hook 版本 router.replace,可在拦截器内调用)
 *   * router.replace 在非导航上下文或已在 /login 时可能抛错,包裹 try/catch
 *   * 仅在 code=UNAUTHORIZED/REFRESH_TOKEN_INVALID 或刷新失败时调用
 */
function redirectToLogin(): void {
  useAuthStore.getState().clearAuth();
  void authStorage.clearAll().catch(() => {
    // secure-store 清除失败不阻塞跳转
  });
  try {
    router.replace('/login');
  } catch {
    // 非导航上下文 / 已在 /login:忽略
  }
}

// 响应拦截器:ApiResponse 拆包 + token 自动刷新 + 失效清态
// 返回类型放宽为 any:成功分支实际返回已拆包的 data,供业务层直接使用
api.interceptors.response.use(
  // 成功(HTTP 2xx):后端 success() 一定 code=0,拆包返回 data
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (response: AxiosResponse): any => {
    const body = response.data as ApiResponse<unknown> | undefined;
    if (body && typeof body.code === 'number') {
      if (body.code === ErrorCode.SUCCESS) {
        return body.data;
      }
      // HTTP 2xx 但 code!==0(理论不应出现,兜底抛业务错误)
      throw new ApiError(body.code, body.message, body.traceId);
    }
    // 非 ApiResponse 结构(如二进制流),原样返回
    return response.data;
  },
  // 失败(HTTP 非 2xx):业务错误码在此分支处理
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async (error: AxiosError): Promise<any> => {
    const body = error.response?.data as ApiResponse<unknown> | undefined;
    const code = body?.code;

    // token 过期:静默刷新并重放(仅一次)
    if (code === ErrorCode.TOKEN_EXPIRED) {
      const config = error.config as RetryableConfig | undefined;
      if (config && !config._retry) {
        config._retry = true;
        try {
          const newToken = await performRefresh();
          config.headers.set('Authorization', `Bearer ${newToken}`);
          return api.request(config);
        } catch (e) {
          // 刷新失败:清态 + 跳登录页
          redirectToLogin();
          throw e;
        }
      }
      // 已重试仍过期或无 config:清态 + 跳登录页,并抛错
      redirectToLogin();
      throw new ApiError(
        ErrorCode.TOKEN_EXPIRED,
        body?.message ?? '登录已过期',
        body?.traceId,
      );
    }

    // 未授权 / refresh token 失效:清态 + 跳登录页
    if (
      code === ErrorCode.UNAUTHORIZED ||
      code === ErrorCode.REFRESH_TOKEN_INVALID
    ) {
      redirectToLogin();
    }

    if (body && typeof code === 'number') {
      throw new ApiError(code, body.message, body.traceId);
    }
    // 网络错误 / 超时等(无响应体)
    throw error;
  },
);

export default api;
