// ============================================================
// Token 存储工具
// 仅存储 JWT access_token(管理后台内网部署,按需存 localStorage)
// 严禁存储业务数据,业务数据一律走接口
// ============================================================

const TOKEN_KEY = 'dq_admin_access_token';
const TOKEN_EXPIRES_KEY = 'dq_admin_token_expires_at';

/** 获取 access_token */
export function getAccessToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

/** 获取 token 过期时间(ISO 字符串) */
export function getTokenExpiresAt(): string | null {
  try {
    return localStorage.getItem(TOKEN_EXPIRES_KEY);
  } catch {
    return null;
  }
}

/** 设置 access_token + 过期时间 */
export function setAccessToken(token: string, expiresAt: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(TOKEN_EXPIRES_KEY, expiresAt);
  } catch {
    /* localStorage 不可用时静默降级 */
  }
}

/** 清除 token */
export function clearAccessToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_EXPIRES_KEY);
  } catch {
    /* noop */
  }
}

/** 判断 token 是否已过期(预留 30 秒缓冲) */
export function isTokenExpired(): boolean {
  const expiresAt = getTokenExpiresAt();
  if (!expiresAt) return true;
  const expires = new Date(expiresAt).getTime();
  return Date.now() + 30 * 1000 >= expires;
}

/** 是否已登录(token 存在且未过期) */
export function isAuthenticated(): boolean {
  return !!getAccessToken() && !isTokenExpired();
}
