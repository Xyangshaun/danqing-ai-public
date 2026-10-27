// ============================================================
// 丹青有AI - API HTTP 客户端(fetch 封装,功能等价 axios 拦截器)
// 对应设计:auth-design.md §1.2 步骤 11/12 + api-contract-v1.md §1.2/§2.3
// ============================================================

import type {
  ApiResponse,
  AuthRefreshResponse,
  ClientType,
} from '../types/api-contract';
import { ErrorCode } from '../types/api-contract';
import {
  getAccessToken,
  setAccessToken,
  clearAccessToken,
  getDeviceId,
  hasAccessToken,
} from './token-store';

/* ============================================================
 * 设计说明(偏离 axios 的决策)
 * ------------------------------------------------------------
 * 任务文档要求"axios 实例 + 拦截器",但项目约束禁止修改 package.json
 * 添加 axios 依赖。本文件用原生 fetch 封装,功能等价:
 *   - 请求拦截器:injectAuthHeaders / injectClientHeaders
 *   - 响应拦截器:handleResponse(统一解包 + 业务错误处理)
 *   - 401 自动刷新:handleTokenExpired(静默调 /auth/refresh + 重试)
 *   - 并发刷新防护:refreshPromise 单例,多个 401 共享一次刷新
 *   - traceId 透传:响应头/体的 traceId 用于排查,前端不处理
 * ============================================================ */

/**
 * Base URL,优先 env,降级到同源相对路径 /api/v1
 *
 * 用相对路径而非绝对 URL(http://localhost:3000)的原因:
 *   - 生产环境:浏览器从 https://www.danqing.site 加载,请求自动命中
 *     https://www.danqing.site/api/v1/...(同源,无 CORS)
 *   - 开发环境:vite.config.ts 的 server.proxy['/api'] 会把 /api 代理到
 *     http://localhost:3000,无需硬编码 host
 *   - 避免构建时漏配 VITE_API_BASE_URL 导致线上请求到用户本机 localhost:3000
 *     (net::ERR_FAILED 故障)
 */
const BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? '/api/v1';

/** 默认客户端标识 */
const DEFAULT_CLIENT: ClientType = 'web';

/* ============================================================
 * 错误类型
 * ============================================================ */

/**
 * 业务错误(api-contract-v1.md §2 错误码表)
 * code !== 0 时抛出,前端 catch 后可读取 code 做差异化处理
 */
export class ApiError extends Error {
  /** 业务错误码(对应 ErrorCode 枚举) */
  readonly code: number;
  /** 链路追踪 ID,排查必备 */
  readonly traceId: string | undefined;
  /** HTTP 状态码 */
  readonly httpStatus: number;
  /** P0 深度诊断黑盒修复:后端响应 data 字段(如 aiMeta/aiEffectiveTimeoutMs/debugHint),
   *  用于前端折叠面板展示失败详情,避免 BusinessError.data 被 request 拦截丢失。 */
  readonly rawData?: unknown;

  constructor(
    code: number,
    message: string,
    traceId?: string,
    httpStatus?: number,
    rawData?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.traceId = traceId;
    this.httpStatus = httpStatus ?? 0;
    this.rawData = rawData;
  }
}

/* ============================================================
 * 外部回调注入(解耦 React)
 * ------------------------------------------------------------
 * api.ts 不在 React 树内,不能直接 useToast / useNavigate。
 * 通过 setToastHandler / setAuthFailedHandler 由 React 层注入。
 * ============================================================ */

type ToastType = 'success' | 'error' | 'warning' | 'info';
type ToastHandler = (type: ToastType, title: string, desc?: string) => void;
type AuthFailedHandler = () => void;
/** 权限不足回调(用户仍登录,仅无权限访问某资源) */
type PermissionDeniedCallback = (message: string) => void;

let toastHandler: ToastHandler | null = null;
let authFailedHandler: AuthFailedHandler | null = null;
let permissionDeniedHandler: PermissionDeniedCallback | null = null;

/** 注入 Toast 回调(由 AuthProvider 在 mount 时调用) */
export function setToastHandler(fn: ToastHandler | null): void {
  toastHandler = fn;
}

/** 注入登录失效回调(由 AuthProvider 注入,内部执行 clearToken + navigate('/login')) */
export function setAuthFailedHandler(fn: AuthFailedHandler | null): void {
  authFailedHandler = fn;
}

/**
 * 注入权限不足回调(由 PermissionToast 组件订阅)
 *
 * 与 authFailedHandler 的区别:
 *   - authFailedHandler:登录态失效(401),清 token + 跳登录页
 *   - permissionDeniedHandler:权限不足(403/FORBIDDEN),用户仍登录,
 *     仅提示无权限,不跳转,不破坏当前页面状态
 */
export function setPermissionDeniedHandler(fn: PermissionDeniedCallback | null): void {
  permissionDeniedHandler = fn;
}

function notifyError(title: string, desc?: string): void {
  toastHandler?.('error', title, desc);
}

function triggerAuthFailed(): void {
  clearAccessToken();
  authFailedHandler?.();
}

/** 触发权限不足提示(由 PermissionToast 接收,若未注册则降级到普通 Toast) */
function notifyPermissionDenied(message: string): void {
  if (permissionDeniedHandler) {
    permissionDeniedHandler(message);
  } else {
    // 降级:未注册权限 Toast 时,走普通错误 Toast
    notifyError('权限不足', message);
  }
}

/* ============================================================
 * 请求配置
 * ============================================================ */

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT';
  /** 请求体(自动 JSON.stringify) */
  body?: unknown;
  /** URL query 参数(自动拼接) */
  query?: Record<string, string | number | boolean | undefined | null>;
  /** 额外请求头 */
  headers?: Record<string, string>;
  /** 是否跳过 Authorization 头(如 /auth/feishu/authorize 公开接口) */
  skipAuth?: boolean;
  /**
   * 是否跳过 401 自动刷新(避免循环:/auth/refresh 自身 401 不再触发刷新)
   * 默认 false
   */
  skipRefresh?: boolean;
  /** 是否静默(不触发全局 Toast),默认 false */
  silent?: boolean;
  /**
   * 前端总超时(毫秒)。超时后中断请求并抛 ApiError(UPSTREAM_UNAVAILABLE,'请求超时…')。
   * 用于 AI 图像生成等长耗时端点,避免请求无限挂起(情绪画布/灵感嫁接"半天无结果"问题)。
   * 不传则不设超时(保持原行为)。
   */
  timeoutMs?: number;
  /** 客户端标识,默认 'web' */
  client?: ClientType;
}

/** 构建完整 URL(Base URL + path + query) */
function buildUrl(path: string, query?: RequestOptions['query']): string {
  // 绝对 URL 原样使用;以 /api/ 开头的路径视为完整 API 路径(如管理后台 /api/admin),
  // 不再拼接 BASE_URL(其默认值为 /api/v1,与管理后台命名空间 /api/admin 不同)。
  const url = path.startsWith('http')
    ? path
    : path.startsWith('/api/')
      ? path
      : `${BASE_URL}${path}`;
  if (!query) return url;
  const params = new URLSearchParams();
  Object.entries(query).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') {
      params.append(k, String(v));
    }
  });
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

/**
 * 读取 Cookie 值(用于 CSRF 双提交 Cookie 模式)
 * 后端 setCsrfTokenCookie 下发非 HttpOnly 的 csrf_token Cookie,
 * 前端 JS 必须读后以 X-CSRF-Token 头回传,否则被 csrfMiddleware 拒 403。
 */
function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return match ? decodeURIComponent(match[1]) : null;
}

/** 构建请求头(请求拦截器) */
function buildHeaders(options: RequestOptions): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Client': options.client ?? DEFAULT_CLIENT,
    'X-Client-Context': JSON.stringify({
      device_id: getDeviceId(),
      client: options.client ?? DEFAULT_CLIENT,
    }),
    ...options.headers,
  };

  // CSRF 双提交 Cookie 模式(对应 server/src/middlewares/csrf.ts):
  // 后端对带 refresh_token Cookie 的 POST/PATCH/PUT/DELETE 强制校验 X-CSRF-Token 头,
  // 缺失或不等 → 403 FORBIDDEN。此处从 csrf_token Cookie 读值并回传头。
  // 纯 Bearer token 调用(无 Cookie)时 csrf_token 不存在,自然不注入,后端也跳过校验。
  const csrfToken = getCookie('csrf_token');
  if (csrfToken && !headers['X-CSRF-Token']) {
    headers['X-CSRF-Token'] = csrfToken;
  }

  // 注入 Authorization(对应 auth-design.md §1.2 步骤 11d)
  if (!options.skipAuth) {
    const token = getAccessToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
  }

  // POST/PATCH/PUT 默认 JSON Content-Type(有 body 且非 FormData 时)
  // FormData 由浏览器自动设置 multipart/form-data + boundary,不能手动设 Content-Type
  const hasBody = options.body !== undefined && options.body !== null;
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  if (hasBody && !isFormData && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  return headers;
}

/* ============================================================
 * 并发刷新防护
 * ------------------------------------------------------------
 * 多个请求同时收到 401(code=2002)时,只发一次 /auth/refresh,
 * 其他请求 await 同一个 Promise,刷新成功后各自重试原请求。
 * 刷新失败则清空 token 并触发跳转登录页。
 * ============================================================ */

let refreshPromise: Promise<string> | null = null;

/**
 * 触发 access_token 刷新(并发安全)
 * @returns 新的 access_token
 * @throws ApiError(2003) 刷新失败
 */
async function refreshTokenOnce(): Promise<string> {
  if (refreshPromise) {
    return refreshPromise;
  }
  refreshPromise = (async () => {
    try {
      const resp = await rawRequest<AuthRefreshResponse>(
        '/auth/refresh',
        {
          method: 'POST',
          skipAuth: true, // refresh 不校验 access_token
          skipRefresh: true, // 避免循环
          silent: true, // 静默,失败由调用方处理
        }
      );
      setAccessToken(resp.accessToken, resp.accessTokenExpiresAt);
      return resp.accessToken;
    } finally {
      // 清除进行中的 Promise,允许下次失败后再次尝试
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

/* ============================================================
 * 核心 fetch 封装
 * ============================================================ */

/**
 * 原始请求(不做 401 自动刷新,只做响应解包 + 业务错误抛出)
 * 内部使用,供 refreshTokenOnce 和 request 调用
 */
async function rawRequest<T>(path: string, options: RequestOptions): Promise<T> {
  const url = buildUrl(path, options.query);
  const headers = buildHeaders(options);
  const method = options.method ?? 'GET';
  const hasBody = options.body !== undefined && options.body !== null;
  // FormData 直接透传(浏览器自动设 boundary),普通对象 JSON.stringify
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const body = hasBody ? (isFormData ? (options.body as FormData) : JSON.stringify(options.body)) : undefined;

  let resp: Response;
  /* 前端总超时:AbortController 到点中断 fetch,防止长耗时端点无限挂起 */
  let timeoutTimer: number | undefined;
  let abortController: AbortController | undefined;
  if (options.timeoutMs && options.timeoutMs > 0) {
    abortController = new AbortController();
    timeoutTimer = window.setTimeout(() => abortController?.abort(), options.timeoutMs);
  }
  try {
    resp = await fetch(url, {
      method,
      headers,
      body,
      credentials: 'include', // 携带 Cookie(refresh_token 在 HttpOnly Cookie 中)
      signal: abortController?.signal,
    });
  } catch (err) {
    // 主动超时中断(区别于其他网络错误,给出明确"超时"语义)
    if (abortController?.signal.aborted) {
      const msg = `请求超时(超过 ${Math.round((options.timeoutMs ?? 0) / 1000)} 秒未响应)`;
      if (!options.silent) {
        notifyError('请求超时', 'AI 服务响应时间过长,请重试');
      }
      throw new ApiError(ErrorCode.UPSTREAM_UNAVAILABLE, msg, undefined, 0);
    }
    // 网络错误(后端不可达 / CORS 拦截 / 断网)
    const msg = err instanceof Error ? err.message : '网络请求失败';
    if (!options.silent) {
      notifyError('网络错误', `请检查网络连接后重试(${msg})`);
    }
    throw new ApiError(ErrorCode.UPSTREAM_UNAVAILABLE, msg, undefined, 0);
  } finally {
    if (timeoutTimer !== undefined) {
      window.clearTimeout(timeoutTimer);
    }
  }

  // 尝试解析 JSON(后端统一返回 JSON;若非 JSON 如 502 网关 HTML,降级处理)
  let payload: ApiResponse<T> | null = null;
  try {
    payload = (await resp.json()) as ApiResponse<T>;
  } catch {
    // 非 JSON 响应(可能是网关错误页)
    const msg = `服务异常(HTTP ${resp.status})`;
    if (!options.silent) {
      notifyError('服务异常', msg);
    }
    throw new ApiError(ErrorCode.UPSTREAM_UNAVAILABLE, msg, undefined, resp.status);
  }

  // 业务错误处理(code !== 0)
  if (!payload || payload.code !== ErrorCode.SUCCESS) {
    const code = payload?.code ?? ErrorCode.UPSTREAM_UNAVAILABLE;
    const message = payload?.message ?? '未知错误';
    const traceId = payload?.traceId;
    // P0 黑盒修复:把后端 data(BusinessError.data 透传的 aiMeta/debugHint 等)
    // 挂到 ApiError.rawData 上,供 handleAiEnhance 折叠面板直接读
    throw new ApiError(code, message, traceId, resp.status, payload?.data);
  }

  // 成功:返回 data(此处 data 一定非 null,因为 code === 0)
  return payload.data as T;
}

/**
 * 发起 API 请求(带 401 自动刷新 + 并发防护)
 *
 * 响应拦截器逻辑(api-contract-v1.md §2.3):
 * - code === 0:返回 data
 * - code === 2002(token 过期):静默刷新 + 重试原请求
 * - code === 2001 / 2003:清 token + 跳登录页
 * - 其他错误:抛 ApiError(调用方 catch 处理)
 *
 * @throws ApiError 业务错误
 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  try {
    return await rawRequest<T>(path, options);
  } catch (err) {
    if (!(err instanceof ApiError)) {
      throw err;
    }

    // 跳过刷新的场景:刷新接口自身失败、显式 skipRefresh、跳过鉴权的公开接口
    if (options.skipRefresh || options.skipAuth) {
      handleBusinessError(err, options.silent);
      throw err;
    }

    // token 过期:静默刷新 + 重试原请求(仅一次)
    if (err.code === ErrorCode.TOKEN_EXPIRED) {
      try {
        await refreshTokenOnce();
        // 刷新成功,重试原请求(用最新 token)
        return await rawRequest<T>(path, options);
      } catch (refreshErr) {
        // 刷新失败:清 token + 跳登录页
        if (!options.silent) {
          const msg =
            refreshErr instanceof ApiError && refreshErr.code === ErrorCode.REFRESH_TOKEN_INVALID
              ? '登录已过期,请重新登录'
              : '会话刷新失败,请重新登录';
          notifyError('登录失效', msg);
        }
        triggerAuthFailed();
        throw refreshErr;
      }
    }

    // refresh_token 无效 / 未授权:清 token + 跳登录页
    if (
      err.code === ErrorCode.REFRESH_TOKEN_INVALID ||
      err.code === ErrorCode.UNAUTHORIZED ||
      err.code === ErrorCode.TOKEN_SIGNATURE_INVALID
    ) {
      if (!options.silent) {
        notifyError('登录失效', err.message);
      }
      triggerAuthFailed();
      throw err;
    }

    // 其他业务错误:按错误码做差异化 Toast
    handleBusinessError(err, options.silent);
    throw err;
  }
}

/**
 * 业务错误 Toast 处理(api-contract-v1.md §2.3 前端错误处理约定)
 */
function handleBusinessError(err: ApiError, silent?: boolean): void {
  if (silent) return;

  // 按错误码差异化提示
  switch (err.code) {
    case ErrorCode.RATE_LIMITED:
      notifyError('操作过于频繁', '请稍后再试');
      break;
    case ErrorCode.ANALYSIS_QUOTA_EXCEEDED:
      notifyError('配额已用完', '本月分析次数已达上限,请升级订阅');
      break;
    case ErrorCode.ANALYSIS_TIMEOUT:
      notifyError('分析超时', 'AI 分析超过 3 秒,请重试');
      break;
    case ErrorCode.FORBIDDEN:
      // 权限不足:不跳登录页(用户仍登录),触发 PermissionToast 专属提示
      // 返回 rejected promise 让调用方可差异化处理(如隐藏按钮/跳转)
      notifyPermissionDenied(err.message);
      break;
    case ErrorCode.TENANT_DISABLED:
      notifyError('租户已禁用', '请联系管理员');
      break;
    case ErrorCode.FILE_TOO_LARGE:
      notifyError('文件过大', '最大支持 10MB');
      break;
    case ErrorCode.FILE_TYPE_UNSUPPORTED:
      notifyError('文件类型不支持', '仅支持 JPEG/PNG/WebP/BMP');
      break;
    // 其他业务错误统一 Toast message
    default:
      notifyError('操作失败', err.message);
      break;
  }
}

/* ============================================================
 * 便捷方法
 * ============================================================ */

export function get<T>(
  path: string,
  query?: RequestOptions['query'],
  options?: Omit<RequestOptions, 'method' | 'query'>
): Promise<T> {
  return request<T>(path, { ...options, method: 'GET', query });
}

export function post<T>(
  path: string,
  body?: unknown,
  options?: Omit<RequestOptions, 'method' | 'body'>
): Promise<T> {
  return request<T>(path, { ...options, method: 'POST', body });
}

export function patch<T>(
  path: string,
  body?: unknown,
  options?: Omit<RequestOptions, 'method' | 'body'>
): Promise<T> {
  return request<T>(path, { ...options, method: 'PATCH', body });
}

export function del<T>(
  path: string,
  options?: Omit<RequestOptions, 'method'>
): Promise<T> {
  return request<T>(path, { ...options, method: 'DELETE' });
}

/* ============================================================
 * 工具方法(供 AuthProvider 判断初始登录态)
 * ============================================================ */

/** 当前是否持有 access_token(从内存读取) */
export function isAuthenticated(): boolean {
  return hasAccessToken();
}

/* ============================================================
 * Preset API(Phase 5 评分预设)
 * ============================================================ */

import type {
  EvaluationPresetSummary,
  EvaluationPresetDetail,
  ApplyPresetRequest,
  ApplyPresetResponse,
  NotificationListResponse,
  UnreadCountResponse,
  MarkNotificationReadResponse,
  MarkAllNotificationsReadResponse,
  UpdateProfileRequest,
  UserProfile,
  PhoneOtpRequest,
  PhoneOtpResponse,
  PhoneBindRequest,
  PhoneBindResponse,
} from '../types/api-contract';

/** GET /presets - 列出当前用户可见的评分预设 */
export function getPresets(): Promise<EvaluationPresetSummary[]> {
  return get<EvaluationPresetSummary[]>('/presets');
}

/** GET /presets/:id - 获取预设详情(含维度权重) */
export function getPreset(id: string): Promise<EvaluationPresetDetail> {
  return get<EvaluationPresetDetail>(`/presets/${id}`);
}

/** POST /presets/apply - 对已有分析结果应用预设权重重新计算 */
export function applyPreset(body: ApplyPresetRequest): Promise<ApplyPresetResponse> {
  return post<ApplyPresetResponse>('/presets/apply', body);
}

/* ============================================================
 * Notification API(任务包 B:通知系统)
 * ============================================================ */

/** GET /notifications - 通知列表(游标分页)
 * @param query.limit 每页数量(默认 20,最大 50)
 * @param query.cursor 上一页返回的 nextCursor
 * @param query.onlyUnread 仅未读
 */
export function listNotifications(query?: {
  limit?: number;
  cursor?: string;
  onlyUnread?: boolean;
}): Promise<NotificationListResponse> {
  return get<NotificationListResponse>('/notifications', query, { silent: true });
}

/** GET /notifications/unread-count - 未读通知计数(轻量轮询端点) */
export function getUnreadNotificationCount(): Promise<UnreadCountResponse> {
  return get<UnreadCountResponse>('/notifications/unread-count', undefined, { silent: true });
}

/** PATCH /notifications/:id/read - 单条通知标记已读 */
export function markNotificationRead(id: string): Promise<MarkNotificationReadResponse> {
  return patch<MarkNotificationReadResponse>(`/notifications/${id}/read`, undefined, { silent: true });
}

/** POST /notifications/read-all - 全部通知标记已读 */
export function markAllNotificationsRead(): Promise<MarkAllNotificationsReadResponse> {
  return post<MarkAllNotificationsReadResponse>('/notifications/read-all', undefined, { silent: true });
}

/** 导出 Notification 类型供组件使用 */
export type { Notification } from '../types/api-contract';

/* ============================================================
 * User Profile API(账户设置)
 * ============================================================ */

/** PATCH /users/profile - 更新当前用户资料(name/avatar/email/phone) */
export function updateUserProfile(body: UpdateProfileRequest): Promise<UserProfile> {
  return patch<UserProfile>('/users/profile', body);
}

/** POST /auth/phone/otp - 发送手机验证码(bind 场景需鉴权) */
export function sendPhoneOtp(body: PhoneOtpRequest): Promise<PhoneOtpResponse> {
  return post<PhoneOtpResponse>('/auth/phone/otp', body);
}

/** POST /auth/phone/bind - 已登录用户绑定手机号(需鉴权) */
export function bindPhone(body: PhoneBindRequest): Promise<PhoneBindResponse> {
  return post<PhoneBindResponse>('/auth/phone/bind', body);
}

/* ============================================================
 * 跨端批删一致性 API(P-06,DOC-2026-08-001/002,M1-T3)
 * ------------------------------------------------------------
 * 镜像冻结契约 server/src/types/api-contract.ts L3314 的传输层类型。
 * 因 src/types/api-contract.ts 为只读同步副本(不含批删新增类型),
 * 此处按冻结契约原文定义本地镜像类型,不改动只读副本。
 * 接口:POST /api/v1/analyses/batch-delete
 * 鉴权:已登录 + analysis:delete:own/tenant(按角色)
 * CSRF:api.ts 的 buildHeaders 已自动注入 X-CSRF-Token(读 csrf_token Cookie)
 * ============================================================ */

/** POST /analyses/batch-delete 请求体(镜像冻结契约) */
export interface BatchDeleteAnalysesRequest {
  /** 待删除的分析记录 ID 列表(最多 100 条) */
  ids: string[];
}

/** 批删单条结果(镜像冻结契约) */
export interface BatchDeleteAnalysisItem {
  /** 分析记录 ID */
  id: string;
  /** 是否删除成功 */
  deleted: boolean;
  /** 删除失败原因(deleted=false 时非空,如跨租户越权/不存在) */
  error?: string;
}

/** POST /analyses/batch-delete 响应(镜像冻结契约) */
export interface BatchDeleteAnalysesResponse {
  /** 请求总数 */
  total: number;
  /** 成功删除数 */
  deleted: number;
  /** 失败数 */
  failedCount: number;
  /** 每条删除结果(供前端精确提示) */
  items: BatchDeleteAnalysisItem[];
}

/**
 * 批量删除分析记录
 * @param ids 待删除 ID 列表(最多 100 条)
 * @returns 服务端逐条结果;失败时抛出 ApiError(调用方据此回滚)
 */
export function batchDeleteAnalyses(ids: string[]): Promise<BatchDeleteAnalysesResponse> {
  const body: BatchDeleteAnalysesRequest = { ids };
  return post<BatchDeleteAnalysesResponse>('/analyses/batch-delete', body);
}

/* ============================================================
 * 报告数据聚合 API(报告导出 + 分析报告增强)
 * ------------------------------------------------------------
 * 接口:GET /analyses/:id/report-data
 * 鉴权:已登录 + analysis:read:own/tenant(按角色,后端强制租户隔离)
 * 契约类型:src/types/api-contract.ts §3.18(ReportDataResponse)
 * ============================================================ */

import type { ReportDataResponse } from '../types/api-contract';

/**
 * 获取报告数据聚合(雷达图/历史对比/成长趋势/班级百分位)
 * @param analysisId 分析记录 ID
 */
export function getReportData(analysisId: string): Promise<ReportDataResponse> {
  return get<ReportDataResponse>(`/analyses/${encodeURIComponent(analysisId)}/report-data`);
}

/* ============================================================
 * 组织内分享 API(组织动态流)
 * ------------------------------------------------------------
 * 接口:
 *   POST   /analyses/:id/share           分享作品到组织
 *   DELETE /analyses/:id/share           取消分享(本人)
 *   GET    /org/feed                     组织动态流列表(分页+筛选)
 *   DELETE /org/feed/:id                 删除分享(本人/share:manage)
 *   POST   /org/feed/:id/pin             置顶(share:manage)
 *   DELETE /org/feed/:id/pin             取消置顶(share:manage)
 *   POST   /org/feed/:id/comments        发表评论
 *   GET    /org/feed/:id/comments        评论列表
 *   DELETE /org/feed/:id/comments/:cid   删除评论(本人/share:manage)
 * 契约类型:src/types/api-contract.ts §3.19
 * ============================================================ */

import type {
  ShareAnalysisRequest,
  ShareAnalysisResponse,
  ListOrgFeedQuery,
  ListOrgFeedResponse,
  CreateShareCommentRequest,
  CreateShareCommentResponse,
  ListShareCommentsResponse,
  PinSharedWorkResponse,
} from '../types/api-contract';

/** 分享作品到组织动态流(同一作品同一用户仅可分享一次,409 幂等冲突) */
export function shareAnalysis(
  analysisId: string,
  body: ShareAnalysisRequest = {},
): Promise<ShareAnalysisResponse> {
  return post<ShareAnalysisResponse>(`/analyses/${encodeURIComponent(analysisId)}/share`, body);
}

/** 取消分享(仅本人;教师删除他人分享走 deleteSharedWork) */
export function unshareAnalysis(analysisId: string): Promise<void> {
  return del<void>(`/analyses/${encodeURIComponent(analysisId)}/share`);
}

/** 组织动态流列表(分页 + 类型筛选,租户隔离) */
export function listOrgFeed(query: ListOrgFeedQuery = {}): Promise<ListOrgFeedResponse> {
  const params = new URLSearchParams();
  if (query.page) params.set('page', String(query.page));
  if (query.pageSize) params.set('pageSize', String(query.pageSize));
  if (query.workType) params.set('workType', query.workType);
  const qs = params.toString();
  return get<ListOrgFeedResponse>(`/org/feed${qs ? `?${qs}` : ''}`);
}

/** 删除分享(本人或 share:manage) */
export function deleteSharedWork(sharedWorkId: string): Promise<void> {
  return del<void>(`/org/feed/${encodeURIComponent(sharedWorkId)}`);
}

/** 置顶分享(share:manage:teacher/admin/owner) */
export function pinSharedWork(sharedWorkId: string): Promise<PinSharedWorkResponse> {
  return post<PinSharedWorkResponse>(`/org/feed/${encodeURIComponent(sharedWorkId)}/pin`);
}

/** 取消置顶(share:manage) */
export function unpinSharedWork(sharedWorkId: string): Promise<PinSharedWorkResponse> {
  return del<PinSharedWorkResponse>(`/org/feed/${encodeURIComponent(sharedWorkId)}/pin`);
}

/** 发表评论(1-500 字) */
export function createShareComment(
  sharedWorkId: string,
  body: CreateShareCommentRequest,
): Promise<CreateShareCommentResponse> {
  return post<CreateShareCommentResponse>(
    `/org/feed/${encodeURIComponent(sharedWorkId)}/comments`,
    body,
  );
}

/** 评论列表(完整) */
export function listShareComments(sharedWorkId: string): Promise<ListShareCommentsResponse> {
  return get<ListShareCommentsResponse>(`/org/feed/${encodeURIComponent(sharedWorkId)}/comments`);
}

/** 删除评论(本人或 share:manage) */
export function deleteShareComment(sharedWorkId: string, commentId: string): Promise<void> {
  return del<void>(
    `/org/feed/${encodeURIComponent(sharedWorkId)}/comments/${encodeURIComponent(commentId)}`,
  );
}

/* ============================================================
 * Image Search API(实时图片搜索,详见 docs/realtime-image-search-solution.md)
 * ------------------------------------------------------------
 * 接口:
 *   GET  /images/search   全文检索(内存倒排索引,中文二元分词 + 字段加权)
 *   GET  /images/suggest   关键词联想补全
 *   GET  /images/:id       图片详情
 *   POST /images           创建条目(仅 ADMIN/OWNER)
 *   PATCH /images/:id      更新条目(仅 ADMIN/OWNER)
 *   DELETE /images/:id     删除条目(仅 ADMIN/OWNER)
 *
 * 设计:
 *   - 搜索/联想使用 silent:true,避免高频请求触发全局 Toast 噪声
 *   - 前端 hook 层使用 AbortController 取消竞态,此处仅做传输
 * ============================================================ */

import type {
  ImageSearchQuery,
  ImageSearchResponse,
  ImageSuggestResponse,
  GetImageResponse,
  CreateImageRequest,
  CreateImageResponse,
  UpdateImageRequest,
  UpdateImageResponse,
  DeleteImageResponse,
} from '../types/api-contract';

/**
 * GET /images/search - 全文检索图片
 * @param query 查询参数(q/tags/category/artType/status + 分页)
 */
export function searchImages(query: ImageSearchQuery): Promise<ImageSearchResponse> {
  // 显式构造 Record 类型,避免 interface 缺少 index signature 导致的 TS 报错
  const params: Record<string, string | number | boolean | undefined | null> = {
    q: query.q,
    tags: query.tags,
    category: query.category,
    artType: query.artType,
    status: query.status,
    page: query.page,
    pageSize: query.pageSize,
  };
  return get<ImageSearchResponse>('/images/search', params, { silent: true });
}

/**
 * GET /images/suggest - 关键词联想补全
 * @param q 前缀关键词(≥1 字符触发)
 * @param limit 返回条数上限,默认 8,最大 20
 */
export function suggestImages(q: string, limit?: number): Promise<ImageSuggestResponse> {
  return get<ImageSuggestResponse>(
    '/images/suggest',
    { q, limit },
    { silent: true },
  );
}

/**
 * GET /images/:id - 获取图片详情
 */
export function getImage(id: string): Promise<GetImageResponse> {
  return get<GetImageResponse>(`/images/${id}`);
}

/**
 * POST /images - 创建图片条目(仅 ADMIN/OWNER)
 */
export function createImage(body: CreateImageRequest): Promise<CreateImageResponse> {
  return post<CreateImageResponse>('/images', body);
}

/**
 * PATCH /images/:id - 更新图片条目(仅 ADMIN/OWNER)
 */
export function updateImage(id: string, body: UpdateImageRequest): Promise<UpdateImageResponse> {
  return patch<UpdateImageResponse>(`/images/${id}`, body);
}

/**
 * DELETE /images/:id - 删除图片条目(仅 ADMIN/OWNER)
 */
export function deleteImage(id: string): Promise<DeleteImageResponse> {
  return del<DeleteImageResponse>(`/images/${id}`);
}
