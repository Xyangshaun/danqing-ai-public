// ============================================================
// 丹青有AI - Token 管理模块
// 对应设计:auth-design.md §0 约束 C3(access_token 仅存内存,不落 localStorage)
// ============================================================

/**
* access_token 内存存储(模块级闭包变量,不暴露到 window)
*
* 安全约束(auth-design.md §0):
* - C3: access_token 仅返回响应体,前端存内存(JS 变量),刷新页面即丢失
* - C6: XSS 防护 - access_token 不存 localStorage / sessionStorage
*
* refresh_token 由后端写 HttpOnly Cookie,前端不可读,刷新时浏览器自动携带
*/
let accessToken: string | null = null;

/** access_token 过期时间戳(ms),用于前端预判过期 */
let accessTokenExpiresAt: number | null = null;

const DEVICE_ID_KEY = 'danqing-ai-device-id';

/**
 * 获取设备指纹(持久化 localStorage,仅作设备标识,不含敏感信息)
 * 对应 auth-design.md §1.2 步骤 1:前端生成 device_id 持久化在 localStorage
 */
export function getDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      // 密码学安全随机源,符合 auth-design.md §2.3 state 生成规范
      id = generateUuid();
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    // localStorage 不可用(隐私模式)时,降级为会话级随机 ID
    return generateUuid();
  }
}

/** 设置 access_token(仅存内存) */
export function setAccessToken(token: string, expiresAt?: string): void {
  accessToken = token;
  if (expiresAt) {
    accessTokenExpiresAt = new Date(expiresAt).getTime();
  } else {
    // 默认 14 分钟后过期(access_token 实际有效期 15 分钟,提前 1 分钟刷新)
    accessTokenExpiresAt = Date.now() + 14 * 60 * 1000;
  }
}

/** 获取 access_token(从内存读取) */
export function getAccessToken(): string | null {
  return accessToken;
}

/** 清除 access_token(登出或 refresh 失败时调用) */
export function clearAccessToken(): void {
  accessToken = null;
  accessTokenExpiresAt = null;
}

/** access_token 是否存在 */
export function hasAccessToken(): boolean {
  return accessToken !== null;
}

/**
 * access_token 是否即将过期(提前 30 秒判定)
 * 用于 AuthContext 决定是否主动刷新
 */
export function isAccessTokenExpiringSoon(): boolean {
  if (!accessTokenExpiresAt) return true;
  return Date.now() + 30 * 1000 >= accessTokenExpiresAt;
}

/** access_token 是否已过期 */
export function isAccessTokenExpired(): boolean {
  if (!accessTokenExpiresAt) return true;
  return Date.now() >= accessTokenExpiresAt;
}

/**
 * 生成 UUID v4
 * 优先使用原生 crypto.randomUUID,降级到 Math.random 兜底
 */
function generateUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // 兜底:基于 Math.random 的 RFC4122 v4
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
