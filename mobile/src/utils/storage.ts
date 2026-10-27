// ============================================================
// 丹青有AI 移动端安全存储封装(expo-secure-store)
// - iOS: Keychain / Android: EncryptedSharedPreferences(Keystore)
// - 仅用于存储敏感凭据(access_token / refresh_token / 用户信息)
// - 注意:expo-secure-store 不支持 Web 平台,Web 降级方案在 P3-1.2 处理
// ============================================================
import * as SecureStore from 'expo-secure-store';

const KEY_ACCESS_TOKEN = 'auth.access_token';
const KEY_ACCESS_TOKEN_EXPIRES_AT = 'auth.access_token_expires_at';
const KEY_REFRESH_TOKEN = 'auth.refresh_token';
const KEY_CSRF_TOKEN = 'auth.csrf_token';
const KEY_USER = 'auth.user';
const KEY_DEVICE_ID = 'device.id';

/** 写入安全存储 */
export async function setSecureItem(
  key: string,
  value: string,
): Promise<void> {
  await SecureStore.setItemAsync(key, value);
}

/** 读取安全存储 */
export async function getSecureItem(key: string): Promise<string | null> {
  return SecureStore.getItemAsync(key);
}

/** 删除安全存储项 */
export async function removeSecureItem(key: string): Promise<void> {
  await SecureStore.deleteItemAsync(key);
}

/** 认证凭据存储(供 P3-1.4 飞书登录使用) */
export const authStorage = {
  setAccessToken: (token: string) => setSecureItem(KEY_ACCESS_TOKEN, token),
  getAccessToken: () => getSecureItem(KEY_ACCESS_TOKEN),
  removeAccessToken: () => removeSecureItem(KEY_ACCESS_TOKEN),

  setAccessTokenExpiresAt: (expiresAt: string) =>
    setSecureItem(KEY_ACCESS_TOKEN_EXPIRES_AT, expiresAt),
  getAccessTokenExpiresAt: () => getSecureItem(KEY_ACCESS_TOKEN_EXPIRES_AT),
  removeAccessTokenExpiresAt: () =>
    removeSecureItem(KEY_ACCESS_TOKEN_EXPIRES_AT),

  setRefreshToken: (token: string) => setSecureItem(KEY_REFRESH_TOKEN, token),
  getRefreshToken: () => getSecureItem(KEY_REFRESH_TOKEN),
  removeRefreshToken: () => removeSecureItem(KEY_REFRESH_TOKEN),

  setCsrfToken: (token: string) => setSecureItem(KEY_CSRF_TOKEN, token),
  getCsrfToken: () => getSecureItem(KEY_CSRF_TOKEN),
  removeCsrfToken: () => removeSecureItem(KEY_CSRF_TOKEN),

  setUser: (user: unknown) => setSecureItem(KEY_USER, JSON.stringify(user)),
  getUser: async <T>(): Promise<T | null> => {
    const raw = await getSecureItem(KEY_USER);
    return raw ? (JSON.parse(raw) as T) : null;
  },
  removeUser: () => removeSecureItem(KEY_USER),

  /** 清除全部认证凭据(不含 device.id,设备 ID 跨登录持久化) */
  clearAll: async () => {
    await Promise.all([
      removeSecureItem(KEY_ACCESS_TOKEN),
      removeSecureItem(KEY_ACCESS_TOKEN_EXPIRES_AT),
      removeSecureItem(KEY_REFRESH_TOKEN),
      removeSecureItem(KEY_CSRF_TOKEN),
      removeSecureItem(KEY_USER),
    ]);
  },
};

/** 设备 ID 存储(跨登录持久化,首次启动生成后稳定不变) */
export const deviceStorage = {
  setDeviceId: (id: string) => setSecureItem(KEY_DEVICE_ID, id),
  getDeviceId: () => getSecureItem(KEY_DEVICE_ID),
};
