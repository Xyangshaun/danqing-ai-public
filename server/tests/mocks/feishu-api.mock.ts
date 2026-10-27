// ============================================================
// 飞书 API Mock(mock axios httpClient)
// 对应源码:src/utils/http-client.ts(httpClient 单例)
// 对应文档:auth-design.md §1.2 步骤 6-7(换 token / 获取用户信息)
//
// 设计:
//   1. mock httpClient() 返回 axios-like 对象
//   2. 支持 post / get 方法
//   3. 通过 feishuMockState 控制响应(成功/失败/超时)
//   4. 测试断言请求参数(app_id / app_secret / code / Authorization)
// ============================================================

interface MockHttpResponse<T = unknown> {
  data: T;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  config: { url?: string; method?: string };
}

interface MockError {
  config?: { url?: string; method?: string };
  response?: { status?: number; data?: unknown };
  message: string;
  code?: string;
}

type ResponseConfig =
  | { kind: 'success'; data: unknown }
  | { kind: 'error'; error: MockError };

/**
 * 飞书 Mock 状态(测试中控制响应)
 */
class FeishuMockState {
  /**
   * 默认飞书 token 端点响应
   * 对应 auth-design.md §1.2 步骤 6b
   */
  tokenResponse: { accessToken: string; refreshToken: string; openId: string; unionId: string; expiresIn: number } = {
    accessToken: 'feishu-access-token-mock',
    refreshToken: 'feishu-refresh-token-mock',
    openId: 'ou_test_open_id',
    unionId: 'on_test_union_id',
    expiresIn: 7200,
  };

  /**
   * 默认飞书 userinfo 端点响应
   * 对应 auth-design.md §1.2 步骤 7d
   */
  userInfoResponse: {
    openId: string;
    unionId: string;
    name: string;
    avatarUrl: string;
    email: string | null;
    mobile: string | null;
    tenantKey: string | null;
    employeeNo: string | null;
  } = {
    openId: 'ou_test_open_id',
    unionId: 'on_test_union_id',
    name: '张老师',
    avatarUrl: 'https://feishu.cn/avatar/test.jpg',
    email: 'zhang@school.edu.cn',
    mobile: '13800001234',
    tenantKey: null,
    employeeNo: null,
  };

  /**
   * 控制 token 端点行为
   * - 'success':返回 tokenResponse 包装为飞书响应格式
   * - 'feishuError':飞书业务错误(body.code !== 0)
   * - 'httpError':HTTP 异常(网络/超时)
   */
  tokenMode: 'success' | 'feishuError' | 'httpError' = 'success';

  /**
   * 控制 userinfo 端点行为
   */
  userInfoMode: 'success' | 'feishuError' | 'httpError' = 'success';

  /**
   * 飞书业务错误码(token 端点)
   */
  tokenFeishuCode: number = 10001;

  /**
   * 飞书业务错误码(userinfo 端点)
   */
  userInfoFeishuCode: number = 10002;

  /**
   * 记录最近的请求(用于断言 app_id / app_secret / code / Authorization 头)
   */
  lastTokenRequest: { code?: string; appId?: string; appSecret?: string } | null = null;
  lastUserInfoRequest: { authorization?: string } | null = null;

  /** 重置为默认状态(每个测试 beforeEach 调用) */
  __reset(): void {
    this.tokenResponse = {
      accessToken: 'feishu-access-token-mock',
      refreshToken: 'feishu-refresh-token-mock',
      openId: 'ou_test_open_id',
      unionId: 'on_test_union_id',
      expiresIn: 7200,
    };
    this.userInfoResponse = {
      openId: 'ou_test_open_id',
      unionId: 'on_test_union_id',
      name: '张老师',
      avatarUrl: 'https://feishu.cn/avatar/test.jpg',
      email: 'zhang@school.edu.cn',
      mobile: '13800001234',
      tenantKey: null,
      employeeNo: null,
    };
    this.tokenMode = 'success';
    this.userInfoMode = 'success';
    this.tokenFeishuCode = 10001;
    this.userInfoFeishuCode = 10002;
    this.lastTokenRequest = null;
    this.lastUserInfoRequest = null;
  }

  /**
   * 配置为"新用户"(unionId 不存在)
   */
  __configureNewUser(): void {
    this.userInfoResponse = {
      openId: 'ou_new_user_open_id',
      unionId: 'on_new_user_union_id',
      name: '新用户',
      avatarUrl: 'https://feishu.cn/avatar/new.jpg',
      email: 'new@school.edu.cn',
      mobile: '1390000new0',
      tenantKey: null,
      employeeNo: null,
    };
  }

  /**
   * 配置飞书 tenant_key(用于测试租户归属)
   */
  __configureTenantKey(tenantKey: string): void {
    this.userInfoResponse.tenantKey = tenantKey;
  }
}

/**
 * 全局飞书 Mock 状态单例
 */
export const feishuMockState: FeishuMockState = new FeishuMockState();

/**
 * 判断 URL 是否为 app_access_token 端点(获取应用访问令牌)
 * 对应源码:feishu.service.ts getAppAccessToken()
 * URL:https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal
 * 必须在 isTokenEndpoint 之前判断,因为该 URL 也包含 "access_token" 子串
 */
function isAppAccessTokenEndpoint(url: string | undefined): boolean {
  if (!url) return false;
  return url.includes('app_access_token');
}

/**
 * 判断 URL 是否为 OIDC token 端点(用 code 换 access_token)
 * 对应源码:feishu.service.ts exchangeCodeForToken()
 * URL:https://open.feishu.cn/open-apis/authen/v1/oidc/access_token
 */
function isTokenEndpoint(url: string | undefined): boolean {
  if (!url) return false;
  // 排除 app_access_token 端点(已在 isAppAccessTokenEndpoint 中处理)
  if (isAppAccessTokenEndpoint(url)) return false;
  return url.includes('oidc/access_token') || url.includes('/authen/v1/oidc/');
}

/**
 * 判断 URL 是否为 userinfo 端点
 */
function isUserInfoEndpoint(url: string | undefined): boolean {
  if (!url) return false;
  return url.includes('user_info') || url.includes('userinfo');
}

/**
 * 构造飞书标准响应体:{ code, msg, data }
 */
function buildFeishuBody(data: unknown): { code: number; msg: string; data: unknown } {
  return { code: 0, msg: 'ok', data };
}

/**
 * 创建 axios-like httpClient mock
 */
function createHttpClientInstance(): {
  post: (url: string, data?: unknown, config?: unknown) => Promise<MockHttpResponse>;
  get: (url: string, config?: unknown) => Promise<MockHttpResponse>;
} {
  async function post(url: string, data?: unknown, _config?: unknown): Promise<MockHttpResponse> {
    // 优先处理 app_access_token 端点(获取应用访问令牌)
    // 该端点响应结构:{ code, msg, app_access_token, expire_in }
    // 与 OIDC token 端点不同,app_access_token 直接在顶层而非 data 字段
    if (isAppAccessTokenEndpoint(url)) {
      // 记录请求参数(用于断言 app_id/app_secret)
      const body = (data ?? {}) as Record<string, unknown>;
      feishuMockState.lastTokenRequest = {
        code: undefined,
        appId: body['app_id'] as string | undefined,
        appSecret: body['app_secret'] as string | undefined,
      };

      // app_access_token 端点复用 tokenMode 控制错误行为
      if (feishuMockState.tokenMode === 'httpError') {
        const err: MockError = {
          config: { url, method: 'post' },
          message: 'timeout of 5000ms exceeded',
          code: 'ECONNABORTED',
        };
        throw err;
      }

      if (feishuMockState.tokenMode === 'feishuError') {
        return {
          data: { code: feishuMockState.tokenFeishuCode, msg: 'invalid app credentials', app_access_token: '' },
          status: 200,
          statusText: 'OK',
          headers: {},
          config: { url, method: 'post' },
        };
      }

      // success:返回 app_access_token(顶层字段,非 data 包裹)
      return {
        data: {
          code: 0,
          msg: 'ok',
          app_access_token: 'mock-app-access-token',
          expire_in: 7200,
        },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: { url, method: 'post' },
      };
    }

    if (isTokenEndpoint(url)) {
      // 记录请求参数用于断言
      // OIDC 端点 body 仅含 grant_type/code,app_id/app_secret 已在 app_access_token 端点发送
      // 保留前一次 app_access_token 请求记录的 appId/appSecret,使测试可断言完整凭证
      const body = (data ?? {}) as Record<string, unknown>;
      feishuMockState.lastTokenRequest = {
        code: body['code'] as string | undefined,
        appId: feishuMockState.lastTokenRequest?.appId,
        appSecret: feishuMockState.lastTokenRequest?.appSecret,
      };

      if (feishuMockState.tokenMode === 'httpError') {
        const err: MockError = {
          config: { url, method: 'post' },
          message: 'timeout of 5000ms exceeded',
          code: 'ECONNABORTED',
        };
        throw err;
      }

      if (feishuMockState.tokenMode === 'feishuError') {
        return {
          data: { code: feishuMockState.tokenFeishuCode, msg: 'invalid code', data: null },
          status: 200,
          statusText: 'OK',
          headers: {},
          config: { url, method: 'post' },
        };
      }

      // success
      const feishuData = {
        access_token: feishuMockState.tokenResponse.accessToken,
        refresh_token: feishuMockState.tokenResponse.refreshToken,
        open_id: feishuMockState.tokenResponse.openId,
        union_id: feishuMockState.tokenResponse.unionId,
        expires_in: feishuMockState.tokenResponse.expiresIn,
        refresh_expires_in: 2592000,
        token_type: 'Bearer',
      };
      return {
        data: buildFeishuBody(feishuData),
        status: 200,
        statusText: 'OK',
        headers: {},
        config: { url, method: 'post' },
      };
    }

    // 其他 POST 端点:默认成功
    return {
      data: buildFeishuBody({}),
      status: 200,
      statusText: 'OK',
      headers: {},
      config: { url, method: 'post' },
    };
  }

  async function get(url: string, config?: unknown): Promise<MockHttpResponse> {
    if (isUserInfoEndpoint(url)) {
      const cfg = (config ?? {}) as { headers?: Record<string, string> };
      const authHeader = cfg.headers?.['Authorization'] ?? cfg.headers?.['authorization'];
      feishuMockState.lastUserInfoRequest = {
        authorization: authHeader,
      };

      if (feishuMockState.userInfoMode === 'httpError') {
        const err: MockError = {
          config: { url, method: 'get' },
          message: 'timeout of 5000ms exceeded',
          code: 'ECONNABORTED',
        };
        throw err;
      }

      if (feishuMockState.userInfoMode === 'feishuError') {
        return {
          data: { code: feishuMockState.userInfoFeishuCode, msg: 'invalid token', data: null },
          status: 200,
          statusText: 'OK',
          headers: {},
          config: { url, method: 'get' },
        };
      }

      // success
      const u = feishuMockState.userInfoResponse;
      const feishuData = {
        open_id: u.openId,
        union_id: u.unionId,
        name: u.name,
        avatar_url: u.avatarUrl,
        email: u.email,
        mobile: u.mobile,
        tenant_key: u.tenantKey,
        employee_no: u.employeeNo,
      };
      return {
        data: buildFeishuBody(feishuData),
        status: 200,
        statusText: 'OK',
        headers: {},
        config: { url, method: 'get' },
      };
    }

    // 其他 GET 端点:默认成功
    return {
      data: buildFeishuBody({}),
      status: 200,
      statusText: 'OK',
      headers: {},
      config: { url, method: 'get' },
    };
  }

  return { post, get };
}

/**
 * 创建匹配 src/utils/http-client.ts 导出的模块对象
 */
export function createHttpClientModule(): {
  httpClient: () => ReturnType<typeof createHttpClientInstance>;
} {
  const instance = createHttpClientInstance();
  return {
    httpClient: () => instance,
  };
}
